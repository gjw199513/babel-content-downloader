import { publicReferenceUrl } from "../../adapters/shared-extractors/url.js";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AdapterDefinition, AdapterRegistry, CollectRequest, ContentSnapshot, Target } from "../../shared/contracts.js";
import { evaluateContentCompleteness } from "../../shared/completeness.js";
import type { BridgeResponse, BrowserCommand, BrowserObservation, CaptureRequest, ExtensionPoll, ExtensionPollResult, ExtensionRegistration } from "../../shared/bridge-protocol.js";
import { BRIDGE_PROTOCOL_VERSION } from "../../shared/bridge-protocol.js";
import type { RuntimeConfig } from "../policy/config.js";
import { requiresWebMediaHandling, shouldCaptureWebDocument, validateBrowserWebSnapshot, webPageIdentity } from "../web/http-capture.js";
import { validateBridgeResponse } from "./validation.js";

interface Session {
  id: string;
  instanceId: string;
  extensionId: string;
  extensionVersion: string;
  token: string;
  paused: boolean;
  lastSeen: number;
  queue: BrowserCommand[];
}

const SESSION_TTL_MS = 90_000;
type ConnectionState = "connected" | "paused" | "disconnected";

function connectionState(session: Session, now: number): ConnectionState {
  if (now - session.lastSeen >= SESSION_TTL_MS) return "disconnected";
  return session.paused ? "paused" : "connected";
}

interface Pending {
  command: BrowserCommand;
  resolve: (value: BridgeResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class BridgeError extends Error {
  constructor(readonly code: string, message: string, readonly retryable = true) { super(message); }
}

function equalSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

type DiagnosticRule = {
  contentId?: (url: URL) => string | null;
  dom_diagnostic?: { id?: string; applies?: (url: URL) => boolean };
};

/**
 * A diagnostic is useful only when it describes the adapter's exact source
 * route. The extension already checks sameTarget before observation; repeat
 * the binding here so an authenticated response cannot attach one route's
 * outline to another route on the same origin.
 */
function diagnosticMatchesAdapter(
  adapter: AdapterDefinition,
  url: URL,
  diagnostic: NonNullable<BrowserObservation["diagnostic"]>,
): boolean {
  const rule = (adapter as AdapterDefinition & { rule?: DiagnosticRule }).rule;
  if (!rule?.contentId || !rule.dom_diagnostic?.id || !rule.dom_diagnostic.applies) return false;
  try {
    return rule.dom_diagnostic.id === diagnostic.plan_id
      && rule.dom_diagnostic.applies(url)
      && rule.contentId(url) === diagnostic.platform_content_id;
  } catch {
    return false;
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage, limit = 8 * 1024 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) throw new BridgeError("MESSAGE_TOO_LARGE", "Bridge message exceeds limit", false);
    chunks.push(buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new BridgeError("INVALID_JSON", "Invalid JSON body", false); }
}

function isRegistration(value: unknown): value is ExtensionRegistration {
  if (!value || typeof value !== "object") return false;
  const r = value as Partial<ExtensionRegistration>;
  return r.version === 1 && typeof r.extension_id === "string" && /^[a-p]{32}$/.test(r.extension_id) && typeof r.instance_id === "string" && /^[a-zA-Z0-9_-]{8,128}$/.test(r.instance_id) && typeof r.extension_version === "string" && r.extension_version.length <= 40;
}

function isHeartbeatExtensionVersion(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 40 && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}

/** The extension initiates every HTTP exchange; MCP requests only enqueue typed work. */
export class BrowserBridge {
  private sessions = new Map<string, Session>();
  private pending = new Map<string, Pending>();

  constructor(readonly config: RuntimeConfig, readonly registry: AdapterRegistry) {}

  status(): { connected: boolean; instances: { instance_ref: string; extension_id: string; version: string; connected: boolean; state: ConnectionState; paused: boolean; seconds_since_seen: number }[] } {
    const now = Date.now();
    const instances = [...this.sessions.values()].map((session) => {
      const state = connectionState(session, now);
      return { instance_ref: session.instanceId, extension_id: session.extensionId, version: session.extensionVersion, connected: state === "connected", state, paused: session.paused, seconds_since_seen: Math.max(0, Math.floor((now - session.lastSeen) / 1000)) };
    });
    return { connected: instances.some((session) => session.connected), instances };
  }

  private choose(instanceRef?: string): Session {
    const now = Date.now();
    const live = [...this.sessions.values()].filter((s) => connectionState(s, now) === "connected" && (!instanceRef || s.instanceId === instanceRef));
    if (live.length === 0) throw new BridgeError("BROWSER_DISCONNECTED", "No paired browser instance is connected");
    if (live.length > 1) throw new BridgeError("BROWSER_AMBIGUOUS", "Multiple browser instances are connected; specify instance_ref", false);
    return live[0]!;
  }

  private async command(jobId: string, instanceRef: string | undefined, request: CaptureRequest, signal: AbortSignal): Promise<BridgeResponse> {
    const session = this.choose(instanceRef);
    if (request.web_document) {
      const minimumPatch = request.target.type === "tab" ? 24 : 23;
      const version = /^(\d+)\.(\d+)\.(\d+)(?:\.\d+)?$/.exec(session.extensionVersion);
      if (!version || !(Number(version[1]) > 0 || Number(version[2]) > 1 || (Number(version[2]) === 1 && Number(version[3]) >= minimumPatch))) {
        throw new BridgeError("EXTENSION_UPDATE_REQUIRED", `通用网页浏览器读取需要扩展 0.1.${minimumPatch} 或更高版本，请重新加载已更新的扩展目录`, false);
      }
    }
    const command: BrowserCommand = {
      version: 1, request_id: randomUUID(), nonce: randomBytes(24).toString("base64url"), session_id: session.id,
      job_id: jobId, tab_id: request.target.type === "tab" ? request.target.tab_id : undefined, request,
    };
    if (signal.aborted) throw new BridgeError("CANCELLED", "Task was cancelled", false);
    return await new Promise<BridgeResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(command.request_id);
        session.queue = session.queue.filter((item) => item.request_id !== command.request_id);
        reject(new BridgeError("BROWSER_TIMEOUT", "Browser did not answer the capture request"));
      }, 90_000);
      const abort = () => {
        clearTimeout(timer);
        this.pending.delete(command.request_id);
        session.queue = session.queue.filter((item) => item.request_id !== command.request_id);
        reject(new BridgeError("CANCELLED", "Task was cancelled", false));
      };
      signal.addEventListener("abort", abort, { once: true });
      this.pending.set(command.request_id, { command, resolve: (response) => { signal.removeEventListener("abort", abort); resolve(response); }, reject: (error) => { signal.removeEventListener("abort", abort); reject(error); }, timer });
      session.queue.push(command);
    });
  }

  async capture(target: Target, request: CollectRequest, signal: AbortSignal, jobId = `job_${randomUUID()}`, options?: { web_document: true } | { platform_media: true }): Promise<ContentSnapshot> {
    let origin: string;
    let adapter: AdapterDefinition;
    let targetUrl: URL;
    let instanceRef = request.browser?.instance_ref;
    if (target.type === "tab") {
      if (instanceRef && instanceRef !== target.instance_ref) throw new BridgeError("BROWSER_INSTANCE_MISMATCH", "Explicit tab and browser instance references differ", false);
      instanceRef = target.instance_ref;
      const observation = await this.observe(target, instanceRef, signal, jobId);
      const url = new URL(observation.url);
      const matched = this.registry.match(url);
      if (!matched) throw new BridgeError("PLATFORM_UNSUPPORTED", "No enabled adapter matches the tab URL", false);
      adapter = matched;
      targetUrl = url;
      origin = url.origin;
    } else {
      const url = new URL(target.url);
      const matched = this.registry.match(url);
      if (!matched) throw new BridgeError("PLATFORM_UNSUPPORTED", "No enabled adapter matches the target URL", false);
      adapter = matched;
      targetUrl = url;
      origin = url.origin;
    }
    const documentEligible = shouldCaptureWebDocument({ ...request, target: { type: "url", url: targetUrl.href } }, adapter);
    const explicitDocument = options && "web_document" in options;
    const platformMedia = options && "platform_media" in options;
    const useWebDocument = !platformMedia && (explicitDocument === true
      || (documentEligible && (target.type === "tab" || request.browser?.tab_strategy === "existing")));
    if (explicitDocument && !documentEligible) {
      throw new BridgeError("WEB_DOCUMENT_OUT_OF_SCOPE", "当前任务不允许通用网页浏览器读取", false);
    }
    let response = await this.command(jobId, instanceRef, {
      ...(useWebDocument ? { web_document: { content_id: webPageIdentity(targetUrl.href), ...(target.type === "tab" ? { url: targetUrl.href } : {}) } } : {}),
      target, adapter_id: adapter.id, expected_origin: origin, allow_focus: request.browser?.allow_focus === true,
      ...(target.type === "url" ? { tab_strategy: request.browser?.tab_strategy ?? "auto" } : {}),
      max_related_items: request.limits?.max_related_items ?? 0,
      capture_mode: "snapshot",
    }, signal);
    if (!response.ok || !response.result?.snapshot) throw new BridgeError(response.error?.code ?? "SNAPSHOT_MISSING", response.error?.message ?? "Browser did not return a content snapshot", response.error?.retryable ?? true);
    let snapshot = response.result.snapshot;
    if (useWebDocument) {
      const pageAdapter = validateBrowserWebSnapshot(snapshot, targetUrl);
      const evaluation = evaluateContentCompleteness(snapshot, { adapter: pageAdapter, urls: [targetUrl, new URL(snapshot.source_url), new URL(snapshot.canonical_url)] });
      if (!evaluation.valid) throw new BridgeError("SNAPSHOT_INVALID", `Browser current-page receipt failed (${evaluation.issue.code})`, false);
      if (!requiresWebMediaHandling(request, snapshot)) return snapshot;
      // Keep the already-observed tab/URL binding for the media attempt.
      response = await this.command(jobId, instanceRef, {
        target, adapter_id: adapter.id, expected_origin: origin, allow_focus: request.browser?.allow_focus === true,
        ...(target.type === "url" ? { tab_strategy: request.browser?.tab_strategy ?? "auto" } : {}),
        max_related_items: request.limits?.max_related_items ?? 0, capture_mode: "snapshot",
      }, signal);
      if (!response.ok || !response.result?.snapshot) throw new BridgeError(response.error?.code ?? "SNAPSHOT_MISSING", response.error?.message ?? "Media capture did not return a snapshot", response.error?.retryable ?? true);
      snapshot = response.result.snapshot;
      if (publicReferenceUrl(new URL(snapshot.source_url)).href !== publicReferenceUrl(targetUrl).href) {
        throw new BridgeError("TARGET_DRIFTED", "The media page moved away from the observed document", false);
      }
    }
    if ((platformMedia || useWebDocument) && !snapshot.assets.some(asset => ['audio', 'video', 'file'].includes(asset.role) && asset.availability !== 'not_present')) {
      snapshot = { ...snapshot, completeness: "partial", completeness_proof: undefined,
        warnings: [...snapshot.warnings, "content_pending:embedded_media"] };
    }
    if (snapshot.schema_version !== "1" || snapshot.platform !== adapter.id || !Array.isArray(snapshot.blocks) || !Array.isArray(snapshot.assets)) throw new BridgeError("SNAPSHOT_INVALID", "Browser snapshot failed validation", false);
    const finalUrl = new URL(snapshot.source_url);
    if (finalUrl.origin !== origin) throw new BridgeError("SNAPSHOT_ORIGIN_MISMATCH", "Browser snapshot left the target origin", false);
    const completeness = evaluateContentCompleteness(snapshot, {
      adapter,
      urls: [targetUrl, finalUrl, new URL(snapshot.canonical_url)],
    });
    if (!completeness.valid) throw new BridgeError("SNAPSHOT_INVALID", `Browser snapshot completeness proof failed (${completeness.issue.code})`, false);
    return snapshot;
  }

  async observe(target: Target, instanceRef: string | undefined, signal: AbortSignal, jobId = `job_${randomUUID()}`): Promise<BrowserObservation> {
    if (target.type === "tab" && instanceRef && instanceRef !== target.instance_ref) throw new BridgeError("BROWSER_INSTANCE_MISMATCH", "Explicit tab and browser instance references differ", false);
    const boundInstance = target.type === "tab" ? target.instance_ref : instanceRef;
    const origin = target.type === "url" ? new URL(target.url).origin : "";
    const expectedAdapter = target.type === "url" ? this.registry.match(new URL(target.url)) : undefined;
    if (target.type === "url" && !expectedAdapter) throw new BridgeError("PLATFORM_UNSUPPORTED", "No enabled adapter matches the target URL", false);
    // Explicit tab discovery is read-only and binds only the caller's tab ID and instance.
    // The extension validates that tab against its shipped adapter registry before responding.
    const response = await this.command(jobId, boundInstance, { target, adapter_id: expectedAdapter?.id ?? "", expected_origin: origin, allow_focus: false, capture_mode: "observe" }, signal);
    if (!response.ok || !response.result?.observation) throw new BridgeError(response.error?.code ?? "OBSERVATION_MISSING", response.error?.message ?? "Browser did not return an observation", response.error?.retryable ?? true);
    const observation = response.result.observation;
    const observedUrl = new URL(observation.url);
    if (observation.origin !== observedUrl.origin || (target.type === "url" && observedUrl.origin !== origin) || (target.type === "tab" && (observation.tab_id !== target.tab_id || observation.instance_id !== target.instance_ref))) throw new BridgeError("OBSERVATION_SCOPE_MISMATCH", "Browser observation did not match the specified target", false);
    const observedAdapter = this.registry.match(observedUrl);
    if (!observedAdapter || observedAdapter.id !== observation.adapter_id || (expectedAdapter && observedAdapter.id !== expectedAdapter.id)) throw new BridgeError("OBSERVATION_ADAPTER_MISMATCH", "Browser observation did not match an enabled adapter", false);
    if (observation.diagnostic && (
      !diagnosticMatchesAdapter(observedAdapter, observedUrl, observation.diagnostic)
      || (target.type === "url" && (!expectedAdapter || !diagnosticMatchesAdapter(expectedAdapter, new URL(target.url), observation.diagnostic)))
    )) {
      throw new BridgeError("OBSERVATION_DIAGNOSTIC_MISMATCH", "Browser diagnostic did not match the exact observed source route", false);
    }
    return observation;
  }

  async act(target: Target, instanceRef: string | undefined, action: CaptureRequest["action"], signal: AbortSignal, jobId = `job_${randomUUID()}`): Promise<NonNullable<BridgeResponse["result"]>> {
    if (!action) throw new BridgeError("ACTION_REQUIRED", "No browser action supplied", false);
    if (target.type === "tab" && instanceRef && instanceRef !== target.instance_ref) throw new BridgeError("BROWSER_INSTANCE_MISMATCH", "Explicit tab and browser instance references differ", false);
    const boundInstance = target.type === "tab" ? target.instance_ref : instanceRef;
    const observation = await this.observe(target, boundInstance, signal, jobId);
    const adapter = this.registry.match(new URL(observation.url));
    if (!adapter) throw new BridgeError("PLATFORM_UNSUPPORTED", "No enabled adapter matches the tab URL", false);
    if (action.type === "navigate" && new URL(action.url).href !== new URL(target.type === "url" ? target.url : observation.url).href) throw new BridgeError("ACTION_SCOPE_DENIED", "Navigation would leave the exact task URL", false);
    if ((action.type === "expand" || action.type === "play") && !observation.action_targets?.some((item) => item.id === action.target_id && item.type === action.type)) throw new BridgeError("ACTION_SCOPE_DENIED", "Action target was not approved by the platform adapter", false);
    const response = await this.command(jobId, boundInstance, { target, adapter_id: adapter.id, expected_origin: observation.origin, allow_focus: false, capture_mode: "act", action }, signal);
    if (!response.ok) throw new BridgeError(response.error?.code ?? "BROWSER_ACTION_FAILED", response.error?.message ?? "Browser action failed", response.error?.retryable ?? true);
    if (response.result?.action_applied !== true) throw new BridgeError("BROWSER_ACTION_UNCONFIRMED", "Browser did not confirm the requested action", true);
    return response.result;
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const host = req.headers.host;
    if (host !== `127.0.0.1:${this.config.port}` && host !== `localhost:${this.config.port}`) return send(res, 403, { error: { code: "HOST_DENIED" } });
    const origin = req.headers.origin;
    const extensionId = typeof origin === "string" && /^chrome-extension:\/\/[a-p]{32}$/.test(origin) ? origin.slice("chrome-extension://".length) : undefined;
    if (!extensionId) return send(res, 403, { error: { code: "ORIGIN_DENIED" } });
    res.setHeader("Access-Control-Allow-Origin", origin!);
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Vary", "Origin");
    if (!this.config.allowed_extension_ids.includes(extensionId)) return send(res, 403, { error: { code: "PAIRING_NEEDED" } });
    if (req.method === "OPTIONS") return send(res, 200, { ok: true });
    if (req.method !== "POST" || !req.url?.startsWith("/v1/bridge/")) return send(res, 404, { error: { code: "NOT_FOUND" } });
    try {
      const path = req.url.split("?")[0];
      const body = await readJson(req);
      if (path === "/v1/bridge/register") {
        if (!isRegistration(body) || body.extension_id !== extensionId) throw new BridgeError("INVALID_REGISTRATION", "Extension registration does not match Origin", false);
        const session: Session = {
          id: randomUUID(), instanceId: body.instance_id, extensionId, extensionVersion: body.extension_version,
          token: randomBytes(32).toString("base64url"), paused: false, lastSeen: Date.now(), queue: [],
        };
        for (const old of this.sessions.values()) if (old.instanceId === session.instanceId) this.revoke(old.id);
        this.sessions.set(session.id, session);
        return send(res, 200, { version: BRIDGE_PROTOCOL_VERSION, session_id: session.id, token: session.token, poll_after_ms: 1000 });
      }
      const token = req.headers.authorization?.replace(/^Bearer /, "");
      const session = [...this.sessions.values()].find((s) => s.extensionId === extensionId && token && equalSecret(s.token, token));
      if (!session) return send(res, 401, { error: { code: "SESSION_UNAUTHORIZED" } });
      session.lastSeen = Date.now();
      if (!body || typeof body !== "object" || (body as { session_id?: unknown }).session_id !== session.id) throw new BridgeError("SESSION_MISMATCH", "Session ID does not match token", false);
      if (path === "/v1/bridge/poll") {
        const poll = body as Partial<ExtensionPoll>;
        if (poll.extension_version !== undefined) {
          if (!isHeartbeatExtensionVersion(poll.extension_version)) throw new BridgeError("INVALID_POLL", "Extension poll version is invalid", false);
          // This is authenticated self-reported status metadata, not build-byte attestation.
          session.extensionVersion = poll.extension_version;
        }
        const result: ExtensionPollResult = { version: 1, paused: session.paused, commands: session.paused ? [] : session.queue.splice(0, 4), poll_after_ms: 1000 };
        return send(res, 200, result);
      }
      if (path === "/v1/bridge/respond") {
        // Match the authenticated envelope before examining page-derived data.
        // A forged nonce or another session must never be able to end a task.
        const envelope = body as { request_id?: unknown; nonce?: unknown };
        const pending = typeof envelope.request_id === "string" ? this.pending.get(envelope.request_id) : undefined;
        if (!pending || pending.command.nonce !== envelope.nonce || pending.command.session_id !== session.id) throw new BridgeError("RESPONSE_UNEXPECTED", "No matching browser request", false);
        const validation = validateBridgeResponse(body);
        if (!validation.ok) {
          clearTimeout(pending.timer);
          this.pending.delete(pending.command.request_id);
          // Field names/array indexes and Zod issue codes are the entire
          // diagnostic. Never send an invalid value or source page text back.
          const error = new BridgeError(validation.code, `Browser response failed validation at ${validation.field} (${validation.issue})`, false);
          pending.reject(error);
          throw error;
        }
        clearTimeout(pending.timer);
        this.pending.delete(validation.response.request_id);
        pending.resolve(validation.response);
        return send(res, 200, { ok: true });
      }
      if (path === "/v1/bridge/pause") { session.paused = true; return send(res, 200, { ok: true, paused: true }); }
      if (path === "/v1/bridge/resume") { session.paused = false; return send(res, 200, { ok: true, paused: false }); }
      if (path === "/v1/bridge/revoke") { this.revoke(session.id); return send(res, 200, { ok: true }); }
      return send(res, 404, { error: { code: "NOT_FOUND" } });
    } catch (error) {
      const code = error instanceof BridgeError ? error.code : "BRIDGE_INTERNAL";
      return send(res, error instanceof BridgeError ? 400 : 500, { error: { code, message: error instanceof Error ? error.message : String(error) } });
    }
  }

  revoke(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    for (const [id, pending] of this.pending) {
      if (pending.command.session_id === sessionId) {
        clearTimeout(pending.timer);
        pending.reject(new BridgeError("BROWSER_REVOKED", "Browser pairing was revoked"));
        this.pending.delete(id);
      }
    }
  }
}
