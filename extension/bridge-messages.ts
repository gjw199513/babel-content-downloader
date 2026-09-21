import type { BrowserCommand, BrowserObservation } from "../shared/bridge-protocol.js";
import type { ContentSnapshot } from "../shared/contracts.js";

export const EXTENSION_CHANNEL = "babel_content_downloader.v1";

export interface ContentExecutionRequest {
  channel: typeof EXTENSION_CHANNEL;
  type: "execute";
  command: BrowserCommand;
  instance_id: string;
  tab_id: number;
  extension_owned: boolean;
}

export interface ContentExecutionResponse {
  ok: boolean;
  snapshot?: ContentSnapshot;
  observation?: BrowserObservation;
  action_applied?: boolean;
  error?: { code: string; message: string; retryable: boolean };
}

export interface UiRequest {
  channel: typeof EXTENSION_CHANNEL;
  type: "get_state" | "connect" | "pause" | "resume" | "revoke";
}

export interface UiResponse {
  ok: boolean;
  state?: {
    extension_id: string;
    extension_version: string;
    instance_id: string;
    bridge_url: string;
    paired: boolean;
    paused: boolean;
    error?: { code: string; message: string };
  };
  error?: { code: string; message: string };
}
