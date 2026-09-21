import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CollectionExecutor, JobRecord } from "../shared/contracts.js";
import { JobManager } from "../runtime/jobs/manager.js";
import { newConfig } from "../runtime/policy/config.js";
import { JobStore } from "../runtime/storage/job-store.js";

const dirs: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "babel-job-policy-")); dirs.push(dir);
  const output = join(dir, "materials"); await mkdir(output);
  const store = new JobStore(join(dir, "jobs"));
  const clients = [{ id: "alice", token: "test", output_roots: [output] }];
  return { dir, output, store, clients };
}

async function until<T>(read: () => Promise<T>, matches: (value: T) => boolean): Promise<T> {
  for (let n = 0; n < 200; n++) {
    const value = await read();
    if (matches(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for job policy state");
}

async function untilWithoutTimers<T>(read: () => Promise<T>, matches: (value: T) => boolean): Promise<T> {
  for (let n = 0; n < 500; n++) {
    const value = await read();
    if (matches(value)) return value;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("Timed out waiting for job policy state without wall-clock timers");
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  return { promise: new Promise<void>((done) => { resolve = done; }), resolve };
}

describe("job execution policy", () => {
  it("runs at most two jobs globally and one per origin", async () => {
    const { output, store, clients } = await fixture();
    const gates = new Map<string, ReturnType<typeof deferred>>();
    const active = new Map<string, number>();
    let maximum = 0;
    const executor: CollectionExecutor = { execute: async (job) => {
      if (job.request.target.type !== "url") throw new Error("Unexpected tab");
      const origin = new URL(job.request.target.url).origin;
      active.set(origin, (active.get(origin) ?? 0) + 1);
      maximum = Math.max(maximum, [...active.values()].reduce((sum, count) => sum + count, 0));
      expect(active.get(origin)).toBe(1);
      const gate = deferred(); gates.set(job.id, gate);
      await gate.promise;
      active.set(origin, active.get(origin)! - 1);
      return { status: "succeeded", completeness: { requested_components_complete: true, scope: "single_item" } };
    } };
    const manager = new JobManager(store, executor, clients, 5);
    await manager.init();
    const a1 = await manager.submit("alice", { target: { type: "url", url: "https://a.example/1" }, output: { directory: output } });
    const a2 = await manager.submit("alice", { target: { type: "url", url: "https://a.example/2" }, output: { directory: output } });
    const b1 = await manager.submit("alice", { target: { type: "url", url: "https://b.example/1" }, output: { directory: output } });
    const c1 = await manager.submit("alice", { target: { type: "url", url: "https://c.example/1" }, output: { directory: output } });
    await until(async () => gates.size, (size) => size === 2);
    expect(gates.has(a1.id)).toBe(true);
    expect(gates.has(b1.id)).toBe(true);
    expect(gates.has(a2.id)).toBe(false);
    gates.get(b1.id)!.resolve();
    await until(async () => gates.size, (size) => size === 3);
    expect(gates.has(c1.id)).toBe(true);
    gates.get(a1.id)!.resolve();
    await until(async () => gates.size, (size) => size === 4);
    expect(gates.has(a2.id)).toBe(true);
    gates.get(a2.id)!.resolve(); gates.get(c1.id)!.resolve();
    await until(() => manager.get("alice", a2.id), (job) => job?.status === "succeeded");
    expect(maximum).toBe(2);
  });

  it("automatically retries transient failures twice, while dependency and over-budget waits stay blocked", async () => {
    const { output, store, clients } = await fixture();
    let runs = 0;
    const manager = new JobManager(store, { execute: async () => { runs++; throw { code: "NETWORK_TIMEOUT", message: "transient", retryable: true }; } }, clients, 2, { retryBaseMs: 5 });
    await manager.init();
    const job = await manager.submit("alice", { target: { type: "url", url: "https://a.example/item" }, output: { directory: output } });
    const finished = await until(() => manager.get("alice", job.id), (value) => value?.attempts === 3 && value.status === "blocked" && !value.retry_at);
    expect(finished?.automatic_retries).toBe(2);
    expect(runs).toBe(3);
    const dependency = new JobManager(store, { execute: async () => { throw { code: "DEPENDENCY_MISSING", message: "Install ffmpeg", retryable: true }; } }, clients, 2, { retryBaseMs: 5 });
    const blocked = await dependency.submit("alice", { target: { type: "url", url: "https://b.example/item" }, output: { directory: output } });
    await until(() => dependency.get("alice", blocked.id), (value) => value?.status === "blocked");
    expect((await dependency.get("alice", blocked.id))?.retry_at).toBeUndefined();
    const rateLimited = new JobManager(store, { execute: async () => { throw { code: "RATE_LIMITED", message: "Wait", retryable: true, retry_after_ms: 61_000 }; } }, clients, 2, { maxRetryWaitMs: 60_000 });
    const delayed = await rateLimited.submit("alice", { target: { type: "url", url: "https://c.example/item" }, output: { directory: output } });
    await until(() => rateLimited.get("alice", delayed.id), (value) => value?.status === "blocked");
    expect((await rateLimited.get("alice", delayed.id))?.retry_at).toBeUndefined();
  });

  it("recovers a late content script on the same job and permits manual resume after its two automatic retries", async () => {
    const { output, store, clients } = await fixture();
    const runIds: string[] = [];
    const manager = new JobManager(store, { execute: async (job) => {
      runIds.push(job.id);
      if (runIds.length === 1) throw { code: "CONTENT_SCRIPT_UNAVAILABLE", message: "The content script was not ready", retryable: true };
      return { status: "succeeded", completeness: { requested_components_complete: true, scope: "single_item" } };
    } }, clients, 2, { retryBaseMs: 100 });
    await manager.init();
    const first = await manager.submit("alice", { target: { type: "url", url: "https://a.example/item" }, output: { directory: output } });
    const waiting = await until(() => manager.get("alice", first.id), (job) => job?.status === "blocked" && Boolean(job.retry_at));
    expect(waiting?.error?.code).toBe("CONTENT_SCRIPT_UNAVAILABLE");
    expect(waiting?.attempts).toBe(1);
    const completed = await until(() => manager.get("alice", first.id), (job) => job?.status === "succeeded");
    expect(completed?.attempts).toBe(2);
    expect(completed?.automatic_retries).toBe(1);
    expect(runIds).toEqual([first.id, first.id]);
    expect((await manager.list("alice")).map(job => job.id)).toEqual([first.id]);

    const exhaustedIds: string[] = [];
    const exhausted = new JobManager(new JobStore(join(output, "exhausted-jobs")), { execute: async (job) => {
      exhaustedIds.push(job.id);
      if (exhaustedIds.length <= 3) throw { code: "CONTENT_SCRIPT_UNAVAILABLE", message: "The content script was not ready", retryable: true };
      return { status: "succeeded", completeness: { requested_components_complete: true, scope: "single_item" } };
    } }, clients, 2, { retryBaseMs: 5 });
    await exhausted.init();
    const second = await exhausted.submit("alice", { target: { type: "url", url: "https://b.example/item" }, output: { directory: output } });
    const stopped = await until(() => exhausted.get("alice", second.id), (job) => job?.status === "blocked" && job.attempts === 3 && !job.retry_at);
    expect(stopped?.automatic_retries).toBe(2);
    expect(exhaustedIds).toEqual([second.id, second.id, second.id]);
    await exhausted.resume("alice", second.id);
    const resumed = await until(() => exhausted.get("alice", second.id), (job) => job?.status === "succeeded");
    expect(resumed?.attempts).toBe(4);
    expect(resumed?.automatic_retries).toBe(2);
    expect(exhaustedIds).toEqual([second.id, second.id, second.id, second.id]);
  });

  it("retries a content script response that exceeded its execution deadline", async () => {
    const { output, store, clients } = await fixture();
    let runs = 0;
    const manager = new JobManager(store, { execute: async () => {
      runs++;
      if (runs === 1) throw { code: "CONTENT_SCRIPT_TIMEOUT", message: "The content script did not answer before the deadline", retryable: true };
      return { status: "succeeded", completeness: { requested_components_complete: true, scope: "single_item" } };
    } }, clients, 2, { retryBaseMs: 5 });
    await manager.init();
    const submitted = await manager.submit("alice", { target: { type: "url", url: "https://a.example/slow-extraction" }, output: { directory: output } });
    const completed = await until(() => manager.get("alice", submitted.id), (job) => job?.status === "succeeded");

    expect(completed?.attempts).toBe(2);
    expect(completed?.automatic_retries).toBe(1);
    expect(runs).toBe(2);
  });

  it("retries a task tab that is still loading instead of treating readiness as a manual block", async () => {
    const { output, store, clients } = await fixture();
    let runs = 0;
    const manager = new JobManager(store, { execute: async () => {
      runs++;
      if (runs === 1) throw { code: "TASK_TAB_NOT_READY", message: "The target tab is still loading", retryable: true };
      return { status: "succeeded", completeness: { requested_components_complete: true, scope: "single_item" } };
    } }, clients, 2, { retryBaseMs: 5 });
    await manager.init();
    const submitted = await manager.submit("alice", { target: { type: "url", url: "https://a.example/slow-page" }, output: { directory: output } });
    const completed = await until(() => manager.get("alice", submitted.id), (job) => job?.status === "succeeded");

    expect(completed?.attempts).toBe(2);
    expect(completed?.automatic_retries).toBe(1);
    expect(runs).toBe(2);
  });

  it("uses bounded browser-readiness windows for default content-script retries", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date("2026-09-20T00:00:00.000Z"));
    const { output, store, clients } = await fixture();
    const manager = new JobManager(store, { execute: async () => {
      throw { code: "CONTENT_SCRIPT_TIMEOUT", message: "The target page did not finish hydrating", retryable: true };
    } }, clients);
    await manager.init();
    const submitted = await manager.submit("alice", { target: { type: "url", url: "https://a.example/heavy-page" }, output: { directory: output } });
    const firstWait = await untilWithoutTimers(() => manager.get("alice", submitted.id), (job) => job?.status === "blocked" && Boolean(job.retry_at));
    expect(Date.parse(firstWait!.retry_at!) - Date.now()).toBe(10_000);

    await vi.advanceTimersByTimeAsync(10_000);
    const secondWait = await untilWithoutTimers(() => manager.get("alice", submitted.id), (job) => job?.status === "blocked" && job.attempts === 2 && Boolean(job.retry_at));
    expect(Date.parse(secondWait!.retry_at!) - Date.now()).toBe(30_000);

    await vi.advanceTimersByTimeAsync(30_000);
    const exhausted = await untilWithoutTimers(() => manager.get("alice", submitted.id), (job) => job?.status === "blocked" && job.attempts === 3 && !job.retry_at);
    expect(exhausted?.automatic_retries).toBe(2);
  });

  it("retries retryable adapter readiness drift on the same job and stops after the existing two-retry budget", async () => {
    const { output, store, clients } = await fixture();
    const delayedRuns: string[] = [];
    const delayed = new JobManager(store, { execute: async (job) => {
      delayedRuns.push(job.id);
      if (delayedRuns.length <= 2) throw { code: "ADAPTER_CHANGED", message: "The supported content root is not ready yet", retryable: true };
      return { status: "succeeded", completeness: { requested_components_complete: true, scope: "single_item" } };
    } }, clients, 2, { retryBaseMs: 5 });
    await delayed.init();
    const first = await delayed.submit("alice", { target: { type: "url", url: "https://a.example/late-root" }, output: { directory: output }, browser: { tab_strategy: "new" } });
    const recovered = await until(() => delayed.get("alice", first.id), (job) => job?.status === "succeeded");
    expect(recovered?.attempts).toBe(3);
    expect(recovered?.automatic_retries).toBe(2);
    expect(recovered?.request.browser?.tab_strategy).toBe("new");
    expect(delayedRuns).toEqual([first.id, first.id, first.id]);

    let permanentRuns = 0;
    const permanent = new JobManager(new JobStore(join(output, "permanent-adapter-jobs")), { execute: async () => {
      permanentRuns++;
      throw { code: "ADAPTER_CHANGED", message: "The supported content root remains absent", retryable: true };
    } }, clients, 2, { retryBaseMs: 5 });
    await permanent.init();
    const second = await permanent.submit("alice", { target: { type: "url", url: "https://b.example/missing-root" }, output: { directory: output } });
    const exhausted = await until(() => permanent.get("alice", second.id), (job) => job?.status === "blocked" && job.attempts === 3 && !job.retry_at);
    expect(exhausted?.automatic_retries).toBe(2);
    expect(exhausted?.error?.code).toBe("ADAPTER_CHANGED");
    expect(permanentRuns).toBe(3);
  });

  it("uses 60s/240s adapter-readiness delays while releasing global and same-origin capacity", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date("2026-09-20T00:00:00.000Z"));
    const { output, store, clients } = await fixture();
    const runs = new Map<string, number>();
    const manager = new JobManager(store, { execute: async (job) => {
      const url = job.request.target.type === "url" ? job.request.target.url : "";
      runs.set(job.id, (runs.get(job.id) ?? 0) + 1);
      if (url.endsWith("/late-root")) throw { code: "ADAPTER_CHANGED", message: "The supported root is not ready", retryable: true };
      if (url.endsWith("/network")) throw { code: "NETWORK_TIMEOUT", message: "Network timed out", retryable: true };
      return { status: "succeeded", completeness: { requested_components_complete: true, scope: "single_item" } };
    } }, clients);
    await manager.init();

    const readiness = await manager.submit("alice", { target: { type: "url", url: "https://a.example/late-root" }, output: { directory: output } });
    const firstWait = await untilWithoutTimers(
      () => manager.get("alice", readiness.id),
      (job) => job?.status === "blocked" && Boolean(job.retry_at),
    );
    expect(Date.parse(firstWait!.retry_at!) - Date.now()).toBe(60_000);
    expect(firstWait?.attempts).toBe(1);

    // A sleeping retry owns neither a global worker nor its origin lease.
    const sameOrigin = await manager.submit("alice", { target: { type: "url", url: "https://a.example/other" }, output: { directory: output } });
    await untilWithoutTimers(() => manager.get("alice", sameOrigin.id), (job) => job?.status === "succeeded");

    const ordinary = await manager.submit("alice", { target: { type: "url", url: "https://b.example/network" }, output: { directory: output } });
    const ordinaryWait = await untilWithoutTimers(
      () => manager.get("alice", ordinary.id),
      (job) => job?.status === "blocked" && Boolean(job.retry_at),
    );
    expect(Date.parse(ordinaryWait!.retry_at!) - Date.now()).toBe(1_000);
    await manager.cancel("alice", ordinary.id);

    await vi.advanceTimersByTimeAsync(60_000);
    const secondWait = await untilWithoutTimers(
      () => manager.get("alice", readiness.id),
      (job) => job?.status === "blocked" && job.attempts === 2 && Boolean(job.retry_at),
    );
    expect(secondWait?.automatic_retries).toBe(1);
    expect(Date.parse(secondWait!.retry_at!) - Date.now()).toBe(240_000);

    await vi.advanceTimersByTimeAsync(239_999);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect((await manager.get("alice", readiness.id))?.attempts).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    const exhausted = await untilWithoutTimers(
      () => manager.get("alice", readiness.id),
      (job) => job?.status === "blocked" && job.attempts === 3 && !job.retry_at,
    );
    expect(exhausted?.automatic_retries).toBe(2);
    expect(runs.get(readiness.id)).toBe(3);
    expect(runs.get(sameOrigin.id)).toBe(1);
    expect(runs.get(ordinary.id)).toBe(1);
  });

  it("cancels a default readiness wait before retry and honors an explicit retry ceiling", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date("2026-09-20T00:00:00.000Z"));
    const { output, store, clients } = await fixture();
    const runs = new Map<string, number>();
    const execute: CollectionExecutor = { execute: async (job) => {
      runs.set(job.id, (runs.get(job.id) ?? 0) + 1);
      throw { code: "ADAPTER_CHANGED", message: "The supported root is not ready", retryable: true };
    } };

    const cancellable = new JobManager(store, execute, clients);
    await cancellable.init();
    const pending = await cancellable.submit("alice", { target: { type: "url", url: "https://a.example/cancel" }, output: { directory: output } });
    await untilWithoutTimers(() => cancellable.get("alice", pending.id), (job) => job?.status === "blocked" && Boolean(job.retry_at));
    expect((await cancellable.cancel("alice", pending.id)).status).toBe("cancelled");
    await vi.advanceTimersByTimeAsync(300_000);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(runs.get(pending.id)).toBe(1);
    expect((await cancellable.get("alice", pending.id))?.status).toBe("cancelled");

    const capped = new JobManager(new JobStore(join(output, "capped-adapter-jobs")), execute, clients, 2, { maxRetryWaitMs: 120_000 });
    await capped.init();
    const limited = await capped.submit("alice", { target: { type: "url", url: "https://b.example/limited" }, output: { directory: output } });
    const firstWait = await untilWithoutTimers(
      () => capped.get("alice", limited.id),
      (job) => job?.status === "blocked" && Boolean(job.retry_at),
    );
    expect(Date.parse(firstWait!.retry_at!) - Date.now()).toBe(60_000);
    await vi.advanceTimersByTimeAsync(60_000);
    const limitedStop = await untilWithoutTimers(
      () => capped.get("alice", limited.id),
      (job) => job?.status === "blocked" && job.attempts === 2 && !job.retry_at,
    );
    expect(limitedStop?.automatic_retries).toBe(1);
    expect(runs.get(limited.id)).toBe(2);
  });

  it("cancels an adapter-readiness retry and never retries adapter execution or scope safety failures", async () => {
    const { output, store, clients } = await fixture();
    const runs = new Map<string, number>();
    const manager = new JobManager(store, { execute: async (job) => {
      const url = job.request.target.type === "url" ? job.request.target.url : "";
      runs.set(job.id, (runs.get(job.id) ?? 0) + 1);
      const code = url.endsWith("/execution") ? "ADAPTER_EXECUTION_FAILED" : url.endsWith("/scope") ? "CONTENT_OUT_OF_SCOPE" : "ADAPTER_CHANGED";
      throw { code, message: "Bounded adapter failure", retryable: true };
    } }, clients, 2, { retryBaseMs: 150 });
    await manager.init();

    const cancellable = await manager.submit("alice", { target: { type: "url", url: "https://a.example/readiness" }, output: { directory: output } });
    await until(() => manager.get("alice", cancellable.id), (job) => job?.status === "blocked" && Boolean(job.retry_at));
    expect((await manager.cancel("alice", cancellable.id)).status).toBe("cancelled");

    const execution = await manager.submit("alice", { target: { type: "url", url: "https://b.example/execution" }, output: { directory: output } });
    const scope = await manager.submit("alice", { target: { type: "url", url: "https://c.example/scope" }, output: { directory: output } });
    const executionBlocked = await until(() => manager.get("alice", execution.id), (job) => job?.status === "blocked");
    const scopeBlocked = await until(() => manager.get("alice", scope.id), (job) => job?.status === "blocked");
    expect(executionBlocked?.retry_at).toBeUndefined();
    expect(scopeBlocked?.retry_at).toBeUndefined();
    await new Promise(resolve => setTimeout(resolve, 180));
    expect(runs.get(cancellable.id)).toBe(1);
    expect(runs.get(execution.id)).toBe(1);
    expect(runs.get(scope.id)).toBe(1);
    expect((await manager.get("alice", cancellable.id))?.status).toBe("cancelled");
  });

  it("cancels a scheduled content-script retry and leaves adapter execution failures manual", async () => {
    const { output, store, clients } = await fixture();
    const runs = new Map<string, number>();
    const manager = new JobManager(store, { execute: async (job) => {
      const url = job.request.target.type === "url" ? job.request.target.url : "";
      runs.set(job.id, (runs.get(job.id) ?? 0) + 1);
      throw { code: url.endsWith("/adapter") ? "ADAPTER_EXECUTION_FAILED" : "CONTENT_SCRIPT_UNAVAILABLE", message: "Browser command could not complete", retryable: true };
    } }, clients, 2, { retryBaseMs: 150 });
    await manager.init();
    const cancellable = await manager.submit("alice", { target: { type: "url", url: "https://a.example/content" }, output: { directory: output } });
    await until(() => manager.get("alice", cancellable.id), (job) => job?.status === "blocked" && Boolean(job.retry_at));
    expect((await manager.cancel("alice", cancellable.id)).status).toBe("cancelled");
    const manual = await manager.submit("alice", { target: { type: "url", url: "https://b.example/adapter" }, output: { directory: output } });
    const blocked = await until(() => manager.get("alice", manual.id), (job) => job?.status === "blocked");
    expect(blocked?.error?.code).toBe("ADAPTER_EXECUTION_FAILED");
    expect(blocked?.retry_at).toBeUndefined();
    await new Promise(resolve => setTimeout(resolve, 180));
    expect(runs.get(cancellable.id)).toBe(1);
    expect(runs.get(manual.id)).toBe(1);
    expect((await manager.get("alice", cancellable.id))?.status).toBe("cancelled");
  });

  it("keeps saved text in a cancellable blocked retry, then ends partial after two retries", async () => {
    const { output, store, clients } = await fixture();
    const file = join(output, "saved.txt"); await writeFile(file, "saved text");
    const artifact = { role: "text", path: file, media_type: "text/plain", size: 10, sha256: createHash("sha256").update("saved text").digest("hex") };
    let runs = 0;
    const manager = new JobManager(store, { execute: async () => {
      runs++;
      return { status: "partial", artifacts: [artifact], error: { code: "RATE_LIMITED", message: "HTTP 429", retryable: true, retry_after_ms: 5 }, completeness: { requested_components_complete: false, scope: "single_item" } };
    } }, clients, 2, { retryBaseMs: 5 });
    await manager.init();
    const job = await manager.submit("alice", { target: { type: "url", url: "https://a.example/item" }, output: { directory: output } });
    const partial = await until(() => manager.get("alice", job.id), (value) => value?.status === "partial" && value.attempts === 3);
    expect(partial?.automatic_retries).toBe(2);
    expect(partial?.retry_at).toBeUndefined();
    expect(await readFile(file, "utf8")).toBe("saved text");
    expect(runs).toBe(3);

    let cancelledRuns = 0;
    const slow = new JobManager(new JobStore(join(output, "slow-jobs")), { execute: async () => {
      cancelledRuns++;
      return { status: "partial", artifacts: [artifact], error: { code: "SERVICE_UNAVAILABLE", message: "HTTP 503", retryable: true, retry_after_ms: 150 }, completeness: { requested_components_complete: false, scope: "single_item" } };
    } }, clients);
    await slow.init();
    const pending = await slow.submit("alice", { target: { type: "url", url: "https://b.example/item" }, output: { directory: output } });
    await until(() => slow.get("alice", pending.id), (value) => value?.status === "blocked" && Boolean(value.retry_at));
    expect((await slow.cancel("alice", pending.id)).status).toBe("cancelled");
    await new Promise((resolve) => setTimeout(resolve, 180));
    expect(cancelledRuns).toBe(1);
    expect((await slow.get("alice", pending.id))?.status).toBe("cancelled");
  });

  it("resumes a durable retry after restart and preserves cancelled state across restart", async () => {
    const { output, store, clients } = await fixture();
    const now = new Date().toISOString();
    const record: JobRecord = { id: "job_00000000-0000-4000-8000-000000000201", client_id: "alice", request: { target: { type: "url", url: "https://a.example/item" }, output: { directory: output } }, status: "blocked", stage: "collecting", created_at: now, updated_at: now, artifacts: [], completeness: { requested_components_complete: false, scope: "single_item" }, warnings: [], attempts: 1, automatic_retries: 0, retry_at: new Date(Date.now() + 50).toISOString(), error: { code: "RATE_LIMITED", message: "Wait", retryable: true } };
    await store.put(record);
    let runs = 0;
    const manager = new JobManager(store, { execute: async () => { runs++; return { status: "succeeded", completeness: { requested_components_complete: true, scope: "single_item" } }; } }, clients);
    await manager.init();
    const completed = await until(() => manager.get("alice", record.id), (job) => job?.status === "succeeded");
    expect(completed?.automatic_retries).toBe(1);
    expect(runs).toBe(1);
    await store.put({ ...record, id: "job_00000000-0000-4000-8000-000000000202", status: "cancelled", retry_at: undefined });
    const restarted = new JobManager(store, { execute: async () => { throw new Error("Cancelled job executed"); } }, clients);
    await restarted.init();
    expect((await restarted.get("alice", "job_00000000-0000-4000-8000-000000000202"))?.status).toBe("cancelled");
  });

  it("serializes cancellation behind an in-flight checkpoint write", async () => {
    const { output, clients } = await fixture();
    const entered = deferred(); const release = deferred();
    class SlowStore extends JobStore {
      override async put(job: JobRecord): Promise<void> {
        if (job.status === "collecting") { entered.resolve(); await release.promise; }
        await super.put(job);
      }
    }
    const store = new SlowStore(join(output, "jobs"));
    const manager = new JobManager(store, { execute: async (_job, _signal, checkpoint) => {
      await checkpoint({ status: "collecting", stage: "collecting" });
      return { status: "succeeded", completeness: { requested_components_complete: true, scope: "single_item" } };
    } }, clients);
    await manager.init();
    const job = await manager.submit("alice", { target: { type: "url", url: "https://a.example/item" }, output: { directory: output } });
    await entered.promise;
    const cancellation = manager.cancel("alice", job.id);
    release.resolve();
    await cancellation;
    const state = await until(() => manager.get("alice", job.id), (value) => value?.status === "cancelled");
    expect(state?.status).toBe("cancelled");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await store.get(job.id))?.status).toBe("cancelled");
  });

  it("expires only owned temporary inputs and detailed logs after seven days", async () => {
    const { output, store, clients } = await fixture();
    const config = newConfig();
    expect(config.checkpoint_retention_days).toBe(7);
    expect(config.log_retention_days).toBe(7);
    const id = "job_00000000-0000-4000-8000-000000000203";
    const workspace = join(await realpath(output), ".babel-content", id);
    await mkdir(workspace, { recursive: true });
    const trackedPath = join(workspace, "partial.bin");
    const modifiedPath = join(workspace, "modified.bin");
    await writeFile(trackedPath, "temporary");
    await writeFile(modifiedPath, "original");
    await writeFile(join(workspace, "user.txt"), "user-added");
    const finalPath = join(output, "final.txt"); await writeFile(finalPath, "final content");
    const old = new Date(Date.now() - 8 * 24 * 60 * 60_000).toISOString();
    const now = new Date().toISOString();
    const record: JobRecord = { id, client_id: "alice", request: { target: { type: "url", url: "https://a.example/item" }, output: { directory: output } }, status: "failed", stage: "downloading", created_at: old, updated_at: now,
      checkpoint_saved_at: old, diagnostics_saved_at: old, checkpoint: { workspace, completed_components: ["text"], failed_components: { audio: "old failure" }, temporary_artifacts: [
        { path: trackedPath, size: 9, sha256: createHash("sha256").update("temporary").digest("hex") },
        { path: modifiedPath, size: 8, sha256: createHash("sha256").update("original").digest("hex") },
      ] }, warnings: ["old warning"], error: { code: "DOWNLOAD_FAILED", message: "old detail", retryable: false }, artifacts: [{ role: "text", path: finalPath, media_type: "text/plain", size: 13, sha256: "x" }], completeness: { requested_components_complete: false, scope: "single_item" }, attempts: 1 };
    await store.put(record);
    await writeFile(modifiedPath, "user-modified");
    const manager = new JobManager(store, { execute: async () => ({}) }, clients);
    await manager.init();
    const pruned = await store.get(id);
    await expect(readFile(trackedPath)).rejects.toThrow();
    expect(await readFile(modifiedPath, "utf8")).toBe("user-modified");
    expect(await readFile(join(workspace, "user.txt"), "utf8")).toBe("user-added");
    expect(await readFile(finalPath, "utf8")).toBe("final content");
    expect(pruned?.checkpoint).toBeUndefined();
    expect(pruned?.checkpoint_expired_at).toBeTruthy();
    expect(pruned?.warnings).toHaveLength(1);
    expect(pruned?.warnings[0]).toContain("preserved");
    expect(pruned?.warnings).not.toContain("old warning");
    expect(pruned?.error?.code).toBe("DOWNLOAD_FAILED");
    expect(pruned?.error?.message).toContain("expired");
    const outside = join(output, "outside"); await mkdir(outside); await writeFile(join(outside, "keep"), "keep");
    await store.put({ ...record, id: "job_00000000-0000-4000-8000-000000000204", checkpoint: { workspace: outside, completed_components: ["text"] } });
    await manager.sweepRetention();
    expect(await readFile(join(outside, "keep"), "utf8")).toBe("keep");
    const unverified = await store.get("job_00000000-0000-4000-8000-000000000204");
    expect(unverified?.checkpoint).toBeUndefined();
    expect(unverified?.checkpoint_expired_at).toBeTruthy();
    expect(unverified?.warnings).toContain("The temporary workspace could not be verified; no files were removed when its checkpoint expired.");

    const missing = join(output, ".babel-content", "job_00000000-0000-4000-8000-000000000205");
    await store.put({ ...record, id: "job_00000000-0000-4000-8000-000000000205", checkpoint: { workspace: missing, completed_components: ["text"] } });
    await manager.sweepRetention();
    expect((await store.get("job_00000000-0000-4000-8000-000000000205"))?.checkpoint_expired_at).toBeTruthy();
  });
});
