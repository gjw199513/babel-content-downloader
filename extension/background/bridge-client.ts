import type {
  BridgeLifecycleAction,
  BrowserCommand,
  ExtensionPoll,
  ExtensionPollResult,
  ExtensionRegistration,
  ExtensionSession,
} from "../../shared/bridge-protocol.js";
import type { ExtensionStorage, PersistedBridgeState } from "./storage.js";

export const DEFAULT_BRIDGE_URL = "http://127.0.0.1:4318";
const REQUEST_TIMEOUT_MS = 15_000;

export class BridgeClientError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable: boolean) {
    super(message);
    this.name = "BridgeClientError";
  }
}

export interface FetchLike {
  (input: string, init: RequestInit): Promise<Response>;
}

export interface BridgeIdentity {
  extension_id: string;
  extension_version: string;
}

export class BridgeClient {
  constructor(
    private readonly storage: ExtensionStorage,
    private readonly identity: BridgeIdentity,
    private readonly baseUrl = DEFAULT_BRIDGE_URL,
    private readonly fetcher: FetchLike = globalThis.fetch.bind(globalThis),
    private readonly requestTimeoutMs = REQUEST_TIMEOUT_MS,
  ) {}

  async state(): Promise<PersistedBridgeState> { return this.storage.readState(); }

  async register(): Promise<ExtensionSession> {
    const state = await this.storage.readState();
    const payload: ExtensionRegistration = {
      version: 1,
      extension_id: this.identity.extension_id,
      instance_id: state.instance_id,
      extension_version: this.identity.extension_version,
    };
    const session = await this.post<ExtensionSession>("/v1/bridge/register", payload);
    if (!isSession(session)) throw new BridgeClientError("BRIDGE_PROTOCOL_INVALID", "The local runtime returned an invalid pairing response.", true);
    // A direct connect request is the user's signal to leave a paused/revoked state.
    await this.storage.writeState({ ...state, session, paused: false, last_error: undefined });
    return session;
  }

  async poll(): Promise<ExtensionPollResult | null> {
    const state = await this.storage.readState();
    if (state.paused) return null;
    const session = state.session ?? await this.register();
    const payload: ExtensionPoll = { version: 1, session_id: session.session_id, extension_version: this.identity.extension_version };
    try {
      const result = await this.post<ExtensionPollResult>("/v1/bridge/poll", payload, session.token);
      if (!isPollResult(result)) throw new BridgeClientError("BRIDGE_PROTOCOL_INVALID", "The local runtime returned an invalid poll response.", true);
      await this.storage.writeState({ ...(await this.storage.readState()), paused: result.paused, last_error: undefined });
      return result;
    } catch (error) {
      if (error instanceof BridgeClientError && ["UNAUTHORIZED", "SESSION_UNAUTHORIZED", "SESSION_EXPIRED", "PAIRING_NEEDED"].includes(error.code)) {
        const fresh = await this.storage.readState();
        await this.storage.writeState({ ...fresh, session: undefined, last_error: { code: error.code, message: error.message } });
      }
      throw error;
    }
  }

  async respond(payload: unknown): Promise<void> {
    const state = await this.storage.readState();
    if (!state.session) throw new BridgeClientError("BRIDGE_UNPAIRED", "The extension is not paired with a local runtime.", true);
    await this.post("/v1/bridge/respond", payload, state.session.token);
  }

  async pause(): Promise<void> {
    const state = await this.storage.readState();
    // Stop local command processing first, even when the runtime is offline.
    await this.storage.writeState({ ...state, paused: true, last_error: undefined });
    if (state.session) await this.lifecycle("pause", state.session);
  }

  async resume(): Promise<void> {
    const state = await this.storage.readState();
    const session = state.session ?? await this.register();
    await this.lifecycle("resume", session);
    await this.storage.writeState({ ...(await this.storage.readState()), paused: false, last_error: undefined });
  }

  /** Local revocation is final even if the runtime cannot be reached. */
  async revoke(): Promise<void> {
    const state = await this.storage.readState();
    await this.storage.writeState({ ...state, paused: true });
    try {
      if (state.session) await this.lifecycle("revoke", state.session);
    } finally {
      await this.storage.writeState({ instance_id: crypto.randomUUID(), paused: true, action_receipts: [] });
    }
  }

  private async lifecycle(action: BridgeLifecycleAction, session: ExtensionSession): Promise<void> {
    await this.post(`/v1/bridge/${action}`, { version: 1, session_id: session.session_id }, session.token);
  }

  private async post<T = unknown>(path: string, body: unknown, token?: string): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new BridgeClientError("BRIDGE_TIMEOUT", "The local runtime did not answer within the request time limit.", true));
        controller.abort();
      }, this.requestTimeoutMs);
    });
    const request = (async (): Promise<T> => {
      let response: Response;
      try {
        response = await this.fetcher(`${this.baseUrl}${path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          credentials: "omit",
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch {
        throw new BridgeClientError("BRIDGE_UNREACHABLE", "The local Babel Content Downloader runtime is not reachable.", true);
      }
      const parsed = await response.json().catch(() => null) as unknown;
      if (!response.ok) {
        const error = parsed && typeof parsed === "object" ? (parsed as { error?: { code?: unknown; message?: unknown } }).error : undefined;
        const code = typeof error?.code === "string" ? error.code : response.status === 403 ? "PAIRING_NEEDED" : "BRIDGE_REQUEST_FAILED";
        const message = typeof error?.message === "string" ? error.message : `The local runtime rejected ${path}.`;
        throw new BridgeClientError(code, message, response.status >= 500 || response.status === 401);
      }
      return parsed as T;
    })();
    try { return await Promise.race([request, timeout]); }
    finally { if (timer) clearTimeout(timer); }
  }
}

function isSession(value: unknown): value is ExtensionSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<ExtensionSession>;
  return session.version === 1 && typeof session.session_id === "string" && typeof session.token === "string"
    && typeof session.poll_after_ms === "number";
}

function isCommand(value: unknown): value is BrowserCommand {
  if (!value || typeof value !== "object") return false;
  const command = value as Partial<BrowserCommand>;
  return command.version === 1 && typeof command.request_id === "string" && typeof command.nonce === "string"
    && typeof command.session_id === "string" && typeof command.job_id === "string" && !!command.request;
}

function isPollResult(value: unknown): value is ExtensionPollResult {
  if (!value || typeof value !== "object") return false;
  const poll = value as Partial<ExtensionPollResult>;
  return poll.version === 1 && typeof poll.paused === "boolean" && typeof poll.poll_after_ms === "number"
    && Array.isArray(poll.commands) && poll.commands.every(isCommand);
}
