import { createHash, randomUUID } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { CollectionExecutor, CollectRequest, JobError, JobRecord, JobStatus, SaveAs } from "../../shared/contracts.js";
import { assertAuthorizedDirectory } from "../policy/output.js";
import type { ClientGrant } from "../policy/config.js";
import { JobStore, publicJob, redactUrl } from "../storage/job-store.js";
import { cleanupTemporaryFiles, hashOwnedTemporaryFile, type TemporaryCleanupResult } from "../storage/temporary-files.js";
import { requestedComponents } from "../collection/selection.js";

const TERMINAL = new Set<JobStatus>(["succeeded", "partial", "failed", "cancelled"]);
const ACTIVE = new Set<JobStatus>(["queued", "resolving", "collecting", "downloading", "finalizing", "verifying"]);
const TRANSIENT = new Set(["RATE_LIMITED", "SERVICE_UNAVAILABLE", "NETWORK_TIMEOUT", "DNS_RESOLUTION_FAILED", "ENGINE_TIMEOUT", "BROWSER_TIMEOUT", "CONTENT_SCRIPT_UNAVAILABLE", "CONTENT_SCRIPT_TIMEOUT", "TASK_TAB_NOT_READY", "ADAPTER_CHANGED"]);
const DAY_MS = 24 * 60 * 60_000;
const MAX_AUTO_RETRIES = 2;
// In one observed heavy page, early captures had no supported root while a
// later observation at about 308 seconds did. These are bounded product-level
// readiness checks, not a measured minimum page-ready time.
const ADAPTER_READINESS_RETRY_DELAYS_MS = [60_000, 240_000] as const;
// A background tab may have a content script that is still starting, or a
// page may spend longer than one bridge command budget hydrating its DOM.
// Give those browser-readiness errors two short, bounded windows before
// leaving the task for manual inspection.
const BROWSER_READINESS_RETRY_DELAYS_MS = [10_000, 30_000] as const;

export interface JobPolicy {
  checkpointRetentionDays?: number;
  logRetentionDays?: number;
  /** Override the default exponential backoff, including adapter readiness. */
  retryBaseMs?: number;
  /** Explicit ceiling for every retry delay, including adapter readiness. */
  maxRetryWaitMs?: number;
}

function fingerprint(request: CollectRequest): string {
  return createHash("sha256").update(JSON.stringify(request)).digest("hex");
}

function hasOfflineCheckpoint(job: JobRecord): boolean {
  if (!job.snapshot) return false;
  const completed = new Set(job.checkpoint?.completed_components ?? []);
  const components = requestedComponents(job.request, job.snapshot);
  return components.length > 0 && components.every((component) => completed.has(component) || Boolean(job.checkpoint?.media_files?.[component]?.length));
}

function asJobError(error: unknown): JobError {
  if (error && typeof error === "object" && "code" in error && "message" in error) {
    const value = error as { code: unknown; message: unknown; retryable?: unknown; dependency?: unknown; retry_after_ms?: unknown };
    return { code: String(value.code), message: String(value.message), retryable: value.retryable === true, dependency: typeof value.dependency === "string" ? value.dependency : undefined,
      retry_after_ms: typeof value.retry_after_ms === "number" && Number.isFinite(value.retry_after_ms) && value.retry_after_ms >= 0 ? value.retry_after_ms : undefined };
  }
  return { code: "COLLECTION_FAILED", message: error instanceof Error ? error.message : String(error), retryable: false };
}

export class JobManager {
  private running = new Map<string, AbortController>();
  private queue: string[] = [];
  private originRunning = new Set<string>();
  private draining = false;
  private drainRequested = false;
  private submitTail: Promise<void> = Promise.resolve();
  private cancelled = new Set<string>();
  private volatileRequests = new Map<string, CollectRequest>();
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private writeTails = new Map<string, Promise<void>>();
  private readonly concurrency: number;

  constructor(readonly store: JobStore, readonly executor: CollectionExecutor, readonly clients: ClientGrant[], concurrency = 2, readonly policy: JobPolicy = {}) {
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("INVALID_JOB_CONCURRENCY");
    this.concurrency = Math.min(concurrency, 2);
  }

  async init(): Promise<void> {
    await this.store.init();
    await this.sweepRetention();
    for (const job of await this.store.list()) {
      const interrupted = ACTIVE.has(job.status);
      const freshUrlRequired = job.checkpoint?.requires_fresh_url && !hasOfflineCheckpoint(job) && job.status !== "succeeded" && job.status !== "cancelled";
      if (interrupted || freshUrlRequired) {
        if (interrupted || freshUrlRequired) { job.status = "blocked"; job.retry_at = undefined; }
        job.error = freshUrlRequired
          ? { code: "FRESH_URL_REQUIRED", message: "This task used a signed URL. Supply a fresh URL for the same content when resuming.", retryable: true }
          : { code: "INTERRUPTED", message: "Runtime stopped before this task finished; resume to recheck and continue.", retryable: true };
        job.updated_at = new Date().toISOString();
        await this.store.put(job);
      }
      if (job.status === "blocked" && job.retry_at) this.scheduleRetry(job);
    }
    // An idle daemon still expires temporary inputs; this timer never keeps the process alive.
    setInterval(() => { void this.sweepRetention().catch(() => undefined); }, 6 * 60 * 60_000).unref();
  }

  private async locked<T>(id: string, action: () => Promise<T>): Promise<T> {
    const previous = this.writeTails.get(id) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => { release = resolve; });
    this.writeTails.set(id, next);
    await previous;
    try { return await action(); }
    finally { release(); if (this.writeTails.get(id) === next) this.writeTails.delete(id); }
  }

  private async verifiedWorkspace(job: JobRecord): Promise<string | undefined> {
    const workspace = job.checkpoint?.workspace;
    if (!workspace) return undefined;
    const grant = this.clients.find((client) => client.id === job.client_id);
    if (!grant) return undefined;
    try {
      const parent = await assertAuthorizedDirectory(job.request.output.directory, grant.output_roots);
      const container = join(parent, ".babel-content");
      const expected = join(container, job.id);
      if (resolve(workspace) !== expected) return undefined;
      for (const path of [container, expected]) {
        const info = await lstat(path);
        if (!info.isDirectory() || info.isSymbolicLink()) return undefined;
      }
      return await realpath(expected) === expected ? expected : undefined;
    } catch { return undefined; }
  }

  private async recordTemporaryInputs(job: JobRecord, signal: AbortSignal): Promise<void> {
    const workspace = await this.verifiedWorkspace(job);
    if (!workspace || !job.checkpoint) return;
    const tracked = new Map((job.checkpoint.temporary_artifacts ?? []).filter((item) => {
      const rel = relative(workspace, item.path);
      return isAbsolute(item.path) && rel && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel) && Number.isSafeInteger(item.size) && item.size >= 0 && /^[a-f0-9]{64}$/.test(item.sha256);
    }).slice(0, 1_000).map((item) => [item.path, item]));
    const inputs = [...new Set(Object.values(job.checkpoint.media_files ?? {}).flat())];
    for (const input of inputs.slice(0, 1_000)) {
      // These paths come from the collector's onInputs callback, after engine hashing.
      const candidates = /^input-[a-zA-Z0-9-]+\.bin$/.test(basename(input)) ? [input, join(dirname(input), "inputs.json")] : [input];
      for (const path of candidates) {
        if (tracked.has(path) || signal.aborted) continue;
        const digest = await hashOwnedTemporaryFile(path, workspace, signal);
        if (digest) tracked.set(path, { path, ...digest });
      }
    }
    job.checkpoint.temporary_artifacts = [...tracked.values()];
  }

  private async removeExpiredWorkspace(job: JobRecord): Promise<TemporaryCleanupResult | undefined> {
    if (!job.checkpoint?.workspace) return { removed_count: 0, retained_count: 0, retained_paths: [], retained_truncated: false };
    const workspace = await this.verifiedWorkspace(job);
    if (!workspace) return undefined;
    return await cleanupTemporaryFiles(workspace, workspace, job.checkpoint.temporary_artifacts ?? []);
  }

  /** Only temporary inputs and detailed diagnostics expire; final artifacts and job identity remain. */
  async sweepRetention(nowMs = Date.now()): Promise<void> {
    const checkpointCutoff = nowMs - (this.policy.checkpointRetentionDays ?? 7) * DAY_MS;
    const logCutoff = nowMs - (this.policy.logRetentionDays ?? 7) * DAY_MS;
    for (const listed of await this.store.list()) {
      await this.locked(listed.id, async () => {
        const job = await this.store.get(listed.id);
        if (!job || this.running.has(job.id) || this.queue.includes(job.id)) return;
        let changed = false;
        const logTime = Date.parse(job.diagnostics_saved_at ?? job.updated_at);
        if (Number.isFinite(logTime) && logTime < logCutoff && (job.warnings.length > 0 || Boolean(job.error?.message))) {
          job.warnings = [];
          if (job.error) job.error = { ...job.error, message: "Detailed diagnostics expired; the error code is retained." };
          job.diagnostics_saved_at = new Date(nowMs).toISOString();
          changed = true;
        }
        const checkpointTime = Date.parse(job.checkpoint_saved_at ?? job.updated_at);
        const hasRetainedInputs = Boolean(job.checkpoint?.workspace || job.checkpoint?.completed_components?.length || job.checkpoint?.temporary_artifacts?.length || Object.keys(job.checkpoint?.media_files ?? {}).length || Object.keys(job.checkpoint?.failed_components ?? {}).length);
        const checkpointExpired = hasRetainedInputs && job.checkpoint && Number.isFinite(checkpointTime) && checkpointTime < checkpointCutoff;
        const cleaned = checkpointExpired ? await this.removeExpiredWorkspace(job) : undefined;
        if (checkpointExpired && job.checkpoint) {
          job.checkpoint = job.checkpoint.requires_fresh_url ? { requires_fresh_url: true } : undefined;
          job.checkpoint_saved_at = undefined;
          job.checkpoint_expired_at = new Date(nowMs).toISOString();
          if (!cleaned) {
            job.warnings.push("The temporary workspace could not be verified; no files were removed when its checkpoint expired.");
            job.diagnostics_saved_at = new Date(nowMs).toISOString();
          } else if (cleaned.retained_count > 0) {
            job.warnings.push(`Some untracked or changed temporary entries were preserved (${cleaned.retained_count}${cleaned.retained_truncated ? "+" : ""}).`);
            job.diagnostics_saved_at = new Date(nowMs).toISOString();
          }
          changed = true;
        }
        if (changed) { job.updated_at = new Date(nowMs).toISOString(); await this.store.put(job); }
      });
    }
  }

  private clearRetry(id: string): void {
    const timer = this.retryTimers.get(id);
    if (timer) clearTimeout(timer);
    this.retryTimers.delete(id);
  }

  private retryDelay(job: JobRecord, error: JobError): number | undefined {
    if (!error.retryable || !TRANSIENT.has(error.code) || (job.automatic_retries ?? 0) >= MAX_AUTO_RETRIES) return undefined;
    if (error.code === "ADAPTER_CHANGED" && error.retry_after_ms === undefined && this.policy.retryBaseMs === undefined) {
      const delay = ADAPTER_READINESS_RETRY_DELAYS_MS[job.automatic_retries ?? 0];
      if (delay === undefined) return undefined;
      return this.policy.maxRetryWaitMs === undefined || delay <= this.policy.maxRetryWaitMs ? delay : undefined;
    }
    if (["CONTENT_SCRIPT_UNAVAILABLE", "CONTENT_SCRIPT_TIMEOUT", "TASK_TAB_NOT_READY"].includes(error.code)
      && error.retry_after_ms === undefined && this.policy.retryBaseMs === undefined) {
      const delay = BROWSER_READINESS_RETRY_DELAYS_MS[job.automatic_retries ?? 0];
      if (delay === undefined) return undefined;
      return this.policy.maxRetryWaitMs === undefined || delay <= this.policy.maxRetryWaitMs ? delay : undefined;
    }
    const base = this.policy.retryBaseMs ?? (error.code === "RATE_LIMITED" ? 5_000 : 1_000);
    const delay = error.retry_after_ms ?? base * 2 ** (job.automatic_retries ?? 0);
    return delay <= (this.policy.maxRetryWaitMs ?? 60_000) ? Math.max(0, delay) : undefined;
  }

  private prepareRetry(job: JobRecord): void {
    const retryCandidate = job.status === "blocked" || job.status === "partial";
    const delay = retryCandidate && job.error ? this.retryDelay(job, job.error) : undefined;
    job.retry_at = delay === undefined ? undefined : new Date(Date.now() + delay).toISOString();
    if (delay !== undefined) job.status = "blocked";
    else if (job.status === "blocked" && job.error && TRANSIENT.has(job.error.code) && (job.automatic_retries ?? 0) >= MAX_AUTO_RETRIES && job.artifacts.some((artifact) => !["manifest", "metadata"].includes(artifact.role))) job.status = "partial";
  }

  private scheduleRetry(job: JobRecord): void {
    this.clearRetry(job.id);
    if (!job.retry_at) return;
    const scheduledFor = job.retry_at;
    const wait = Math.max(0, Date.parse(scheduledFor) - Date.now());
    if (!Number.isFinite(wait)) return;
    const timer = setTimeout(() => {
      this.retryTimers.delete(job.id);
      void this.enqueueRetry(job.id, scheduledFor).catch(() => undefined);
    }, wait);
    timer.unref();
    this.retryTimers.set(job.id, timer);
  }

  private async enqueueRetry(id: string, scheduledFor: string): Promise<void> {
    const queued = await this.locked(id, async () => {
      const job = await this.store.get(id);
      if (!job || job.status !== "blocked" || job.retry_at !== scheduledFor || this.cancelled.has(id)) return false;
      if (job.checkpoint?.requires_fresh_url && !this.volatileRequests.has(id) && !hasOfflineCheckpoint(job)) {
        job.retry_at = undefined;
        job.error = { code: "FRESH_URL_REQUIRED", message: "A fresh URL is required to continue this task.", retryable: true };
        job.diagnostics_saved_at = new Date().toISOString();
        await this.store.put(job);
        return false;
      }
      job.status = "queued";
      job.retry_at = undefined;
      job.automatic_retries = (job.automatic_retries ?? 0) + 1;
      job.updated_at = new Date().toISOString();
      await this.store.put(job);
      return true;
    });
    if (queued && !this.queue.includes(id)) { this.queue.push(id); void this.drain(); }
  }

  private grant(clientId: string): ClientGrant {
    const grant = this.clients.find((client) => client.id === clientId);
    if (!grant) throw new Error("CLIENT_NOT_AUTHORIZED");
    return grant;
  }

  async submit(clientId: string, request: CollectRequest): Promise<JobRecord> {
    const previous = this.submitTail;
    let unlock!: () => void;
    this.submitTail = new Promise<void>((resolve) => { unlock = resolve; });
    await previous;
    try { return await this.submitLocked(clientId, request); }
    finally { unlock(); }
  }

  private async submitLocked(clientId: string, request: CollectRequest): Promise<JobRecord> {
    const grant = this.grant(clientId);
    await assertAuthorizedDirectory(request.output.directory, grant.output_roots);
    if ((request.save_as && request.include) || (request.include && request.include.length === 0)) throw new Error("INVALID_SELECTION");
    if (request.target.type === "tab" && request.browser?.instance_ref && request.browser.instance_ref !== request.target.instance_ref) throw new Error("BROWSER_INSTANCE_MISMATCH");
    if (request.idempotency_key) {
      const existing = (await this.store.list()).find((job) => job.client_id === clientId && job.request.idempotency_key === request.idempotency_key);
      if (existing) {
        if ((existing.request_fingerprint ?? fingerprint(existing.request)) !== fingerprint(request)) throw new Error("IDEMPOTENCY_CONFLICT");
        return publicJob(existing);
      }
    }
    const now = new Date().toISOString();
    const job: JobRecord = {
      id: `job_${randomUUID()}`, client_id: clientId, request, status: "queued", stage: "queued", created_at: now, updated_at: now,
      artifacts: [], completeness: { requested_components_complete: false, scope: "single_item" }, warnings: [], attempts: 0,
      request_fingerprint: fingerprint(request),
    };
    this.volatileRequests.set(job.id, request);
    await this.store.put(job);
    this.queue.push(job.id);
    void this.drain();
    return publicJob(job);
  }

  async get(clientId: string, id: string): Promise<JobRecord | undefined> {
    this.grant(clientId);
    const job = await this.store.get(id);
    return job?.client_id === clientId ? publicJob(job) : undefined;
  }

  async list(clientId: string, offset = 0, limit = 20): Promise<JobRecord[]> {
    this.grant(clientId);
    const jobs = await this.store.list();
    return jobs.filter((job) => job.client_id === clientId).slice(offset, offset + Math.min(Math.max(limit, 1), 100)).map(publicJob);
  }

  async resume(clientId: string, id: string, refreshedUrl?: string, saveAs?: Exclude<SaveAs, "auto">): Promise<JobRecord> {
    const result = await this.locked(id, async () => {
      const job = await this.owned(clientId, id);
      if (job.status === "cancelled" || job.status === "succeeded") throw new Error("JOB_NOT_RESUMABLE");
      if (saveAs && !job.selection_required?.options.some(option => option.save_as === saveAs)) throw new Error("INVALID_SAVE_SELECTION");
      if (job.selection_required && !saveAs) throw { code: "SELECTION_REQUIRED", message: job.selection_required.prompt, retryable: false };
      if (this.running.has(id) || this.queue.includes(id)) {
        if (saveAs) throw { code: "JOB_STILL_RUNNING", message: "The job is still settling. Retry the selection after the next status check.", retryable: true };
        return { job: publicJob(job), queued: false };
      }
      let request = this.volatileRequests.get(id) ?? job.request;
      if (refreshedUrl) {
        if (job.request.target.type !== "url" || !/^https?:\/\//i.test(refreshedUrl) || redactUrl(refreshedUrl) !== job.request.target.url) throw new Error("REFRESHED_URL_SCOPE_MISMATCH");
        request = { ...request, target: { type: "url", url: refreshedUrl } };
      }
      if (saveAs) request = { ...request, save_as: saveAs };
      if (job.checkpoint?.requires_fresh_url && !refreshedUrl && !this.volatileRequests.has(id) && !hasOfflineCheckpoint({ ...job, request })) throw { code: "FRESH_URL_REQUIRED", message: "This job used an expiring or credential-bearing URL. Provide a fresh URL for the same content when resuming.", retryable: true };
      if (refreshedUrl || saveAs) this.volatileRequests.set(id, request);
      this.clearRetry(id);
      job.request = request;
      job.selection_required = undefined;
      job.status = "queued";
      job.error = undefined;
      job.retry_at = undefined;
      job.updated_at = new Date().toISOString();
      await this.store.put(job);
      return { job: publicJob(job), queued: true };
    });
    if (result.queued) { this.queue.push(id); void this.drain(); }
    return result.job;
  }

  async cancel(clientId: string, id: string): Promise<JobRecord> {
    this.grant(clientId);
    const existing = await this.owned(clientId, id);
    if (TERMINAL.has(existing.status)) return publicJob(existing);
    this.cancelled.add(id);
    this.volatileRequests.delete(id);
    this.clearRetry(id);
    this.running.get(id)?.abort();
    this.queue = this.queue.filter((queued) => queued !== id);
    return await this.locked(id, async () => {
      const job = await this.owned(clientId, id);
      if (!TERMINAL.has(job.status)) {
        job.status = "cancelled";
        job.retry_at = undefined;
        job.updated_at = new Date().toISOString();
        await this.store.put(job);
      }
      return publicJob(job);
    });
  }

  private async owned(clientId: string, id: string): Promise<JobRecord> {
    this.grant(clientId);
    const job = await this.store.get(id);
    if (!job || job.client_id !== clientId) throw new Error("JOB_NOT_FOUND");
    return job;
  }

  private origin(job: JobRecord): string {
    try { return job.request.target.type === "url" ? new URL(job.request.target.url).origin : `tab:${job.request.target.instance_ref}`; }
    catch { return "invalid"; }
  }

  private async drain(): Promise<void> {
    if (this.draining) { this.drainRequested = true; return; }
    this.draining = true;
    try {
      while (this.running.size < this.concurrency && this.queue.length) {
        let selected = -1;
        for (let i = 0; i < this.queue.length; i++) {
          const job = await this.store.get(this.queue[i]!);
          if (job && !this.originRunning.has(this.origin(job))) { selected = i; break; }
        }
        if (selected < 0) break;
        const [id] = this.queue.splice(selected, 1);
        const job = await this.store.get(id!);
        if (!job || job.status === "cancelled") continue;
        const volatile = this.volatileRequests.get(job.id);
        if (volatile) job.request = volatile;
        const controller = new AbortController();
        this.running.set(job.id, controller);
        this.originRunning.add(this.origin(job));
        void this.run(job, controller).catch(() => {
          // A persistence failure cannot be reported through that same store.
          console.error("Babel job runner could not persist a task state.");
        }).finally(() => {
          this.running.delete(job.id);
          this.originRunning.delete(this.origin(job));
          void this.drain();
        });
      }
    } finally {
      this.draining = false;
      if (this.drainRequested) { this.drainRequested = false; void this.drain(); }
    }
  }

  private async run(job: JobRecord, controller: AbortController): Promise<void> {
    if (this.cancelled.has(job.id) || controller.signal.aborted) return;
    await this.locked(job.id, async () => {
      if (this.cancelled.has(job.id) || controller.signal.aborted) return;
      job.status = "resolving";
      job.stage = "resolving";
      job.attempts += 1;
      job.updated_at = new Date().toISOString();
      await this.store.put(job);
    });
    if (this.cancelled.has(job.id) || controller.signal.aborted) return;
    try {
      const patch = await this.executor.execute(job, controller.signal, async (partial) => {
        await this.locked(job.id, async () => {
          if (controller.signal.aborted || this.cancelled.has(job.id)) throw new Error("JOB_CANCELLED");
          const current = await this.store.get(job.id);
          if (!current || current.status === "cancelled") throw new Error("JOB_CANCELLED");
          const now = new Date().toISOString();
          Object.assign(job, partial, { updated_at: now });
          if (partial.checkpoint) job.checkpoint_saved_at = now;
          if (partial.error || partial.warnings) job.diagnostics_saved_at = now;
          if (partial.checkpoint) await this.recordTemporaryInputs(job, controller.signal);
          await this.store.put(job);
        });
      });
      await this.locked(job.id, async () => {
        if (controller.signal.aborted || this.cancelled.has(job.id)) return;
        const current = await this.store.get(job.id);
        if (!current || current.status === "cancelled") return;
        const now = new Date().toISOString();
        Object.assign(job, patch, { updated_at: now });
        if (patch.checkpoint) job.checkpoint_saved_at = now;
        if (patch.error || patch.warnings) job.diagnostics_saved_at = now;
        const proposedStatus: JobStatus = patch.status ?? job.status;
        if (!TERMINAL.has(proposedStatus) && proposedStatus !== "blocked") job.status = job.completeness.requested_components_complete ? "succeeded" : "partial";
        this.prepareRetry(job);
        await this.store.put(job);
        if (TERMINAL.has(job.status)) this.volatileRequests.delete(job.id);
        else if (job.retry_at) this.scheduleRetry(job);
      });
    } catch (error) {
      await this.locked(job.id, async () => {
        const current = await this.store.get(job.id);
        if (!current || current.status === "cancelled" || controller.signal.aborted || this.cancelled.has(job.id)) return;
        const mapped = asJobError(error);
        const now = new Date().toISOString();
        Object.assign(job, current, { status: mapped.retryable ? "blocked" : "failed", error: mapped, updated_at: now, diagnostics_saved_at: now });
        this.prepareRetry(job);
        await this.store.put(job);
        if (!mapped.retryable) this.volatileRequests.delete(job.id);
        else if (job.retry_at) this.scheduleRetry(job);
      });
    }
  }
}
