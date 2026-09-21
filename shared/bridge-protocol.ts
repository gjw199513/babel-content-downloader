import type { ContentSnapshot, Target } from "./contracts.js";

export const BRIDGE_PROTOCOL_VERSION = 1 as const;

export interface ExtensionRegistration {
  version: 1;
  extension_id: string;
  instance_id: string;
  extension_version: string;
}

export interface ExtensionSession {
  version: 1;
  session_id: string;
  token: string;
  poll_after_ms: number;
  runtime_version?: string;
  update_required?: boolean;
}

export type BrowserAction =
  | { type: "scroll"; delta_y: number }
  | { type: "expand"; target_id: string }
  | { type: "play"; target_id: string }
  | { type: "navigate"; url: string };

export interface CaptureRequest {
  target: Target;
  adapter_id: string;
  expected_origin: string;
  allow_focus: boolean;
  /** URL task-tab selection; never authorizes searching arbitrary user tabs. */
  tab_strategy?: "auto" | "existing" | "new";
  /**
   * Explicit bounded related-post scope. Undefined or zero preserves the
   * default single-item capture and never asks the page to extend a thread.
   */
  max_related_items?: number;
  /**
   * Runtime-selected current-page DOM extraction; never supplied by page
   * content or MCP arguments. An explicit user-tab capture carries the exact
   * URL observed for that tab after discovery. URL targets retain their own
   * target URL and may omit this duplicate binding.
   */
  web_document?: { content_id: string; url?: string };
  capture_mode: "snapshot" | "observe" | "act";
  action?: BrowserAction;
}

export interface BrowserCommand {
  version: 1;
  request_id: string;
  nonce: string;
  session_id: string;
  job_id: string;
  /** For a tab target, this is the caller-owned tab. Extension must not choose another. */
  tab_id?: number;
  request: CaptureRequest;
}

/**
 * A small, adapter-authored structural summary for diagnosing a bounded
 * content root. It deliberately contains no page text, markup, URLs, form
 * values, arbitrary data attributes, or layout state.
 */
export type BoundedDomDiagnosticInputType = "text" | "email" | "search" | "checkbox" | "radio" | "other";

export interface BoundedDomDiagnosticRoot {
  /** Stable identifier from the shipped adapter plan, never a caller selector. */
  id: string;
  /** Capped count of visible matches for this one shipped root selector. */
  visible_match_count: number;
  count_truncated: boolean;
  selected: boolean;
}

export interface BoundedDomDiagnosticNode {
  node_index: number;
  parent_node_index?: number;
  /** Depth within the returned chain segment; maximum is five. */
  depth: number;
  /** Adapter-authored root/probe roles; never page text or a page attribute. */
  kinds: ("root" | "ancestor" | "input" | "figure")[];
  tag: string;
  id?: string;
  class_tokens?: string[];
  test_id?: string;
  role?: string;
  input_type?: BoundedDomDiagnosticInputType;
  /** This probe's retained ancestor segment did not reach the selected root. */
  chain_truncated?: true;
}

export interface BoundedDomDiagnostic {
  version: 1;
  /** Static plan identifier shipped with the matched adapter. */
  plan_id: string;
  /** Adapter-derived source identifier for the exact currently observed route. */
  platform_content_id: string;
  roots: BoundedDomDiagnosticRoot[];
  /** Capped de-duplicated visible root count across the static root list. */
  unique_visible_root_count: number;
  root_count_truncated: boolean;
  /** Present only for a unique public-free root whose static plan permits an outline. */
  outline?: { nodes: BoundedDomDiagnosticNode[]; truncated: boolean };
  /** Any root count, probe count, chain-depth, or node-budget cap was reached. */
  truncated: boolean;
}

export interface BrowserObservation {
  instance_id: string;
  tab_id: number;
  url: string;
  title: string;
  origin: string;
  adapter_id?: string;
  access_class?: ContentSnapshot["access_class"];
  /** Opaque, adapter-approved read-only actions. Never expose raw CSS selectors. */
  action_targets?: { id: string; type: "expand" | "play"; label: string }[];
  /** Optional bounded, static-plan diagnostic; it has no caller-controlled selectors. */
  diagnostic?: BoundedDomDiagnostic;
  evidence: string[];
}

export interface BridgeResponse {
  version: 1;
  request_id: string;
  nonce: string;
  session_id: string;
  ok: boolean;
  result?: { snapshot?: ContentSnapshot; observation?: BrowserObservation; action_applied?: boolean };
  error?: { code: string; message: string; retryable: boolean };
}

export interface ExtensionPoll {
  version: 1;
  session_id: string;
  /** Authenticated extension self-report for status metadata; absent on legacy clients. */
  extension_version?: string;
}

export interface ExtensionPollResult {
  version: 1;
  paused: boolean;
  commands: BrowserCommand[];
  poll_after_ms: number;
  runtime_version?: string;
  update_required?: boolean;
}

/** POST /v1/bridge/register, /poll, /respond, /pause, /resume, /revoke. */
export type BridgeLifecycleAction = "pause" | "resume" | "revoke";
