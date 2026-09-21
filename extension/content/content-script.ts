import { createAdapterRegistry, createBaselineAdapterRegistry } from "../../adapters/registry.js";
import { DomPageReader } from "../../adapters/shared-extractors/dom-reader.js";
import { automaticExpandTarget, finalizeStableCompletion, nodeForAdapterAction } from "../../adapters/shared-extractors/extractor.js";
import { AdapterExtractionError } from "../../adapters/types.js";
import { WebHtmlExtractionError } from "../../runtime/web/web-document-extractor.js";
import { EXTENSION_CHANNEL, type ContentExecutionRequest, type ContentExecutionResponse } from "../bridge-messages.js";
import { DEVELOPMENT_FIXTURE_ORIGINS } from "../environment.js";
import { sampleStableSnapshot } from "./stable-snapshot.js";
import {
  extractWebDocumentSnapshot,
  isWebDocumentCaptureRequest,
  routeOnlyExplicitTabObservation,
  sameWebDocumentTarget,
} from "./web-document-snapshot.js";

declare const __BABEL_DEV_FIXTURES__: boolean;

const registry = __BABEL_DEV_FIXTURES__
  ? createAdapterRegistry({ fixture_origins: DEVELOPMENT_FIXTURE_ORIGINS })
  : createBaselineAdapterRegistry();
const AUTO_EXPAND_SETTLE_MS = 650;

function isExecutionRequest(value: unknown): value is ContentExecutionRequest {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<ContentExecutionRequest>;
  return message.channel === EXTENSION_CHANNEL && message.type === "execute" && !!message.command
    && typeof message.instance_id === "string" && typeof message.tab_id === "number" && typeof message.extension_owned === "boolean";
}

function failure(code: string, message: string, retryable = false): ContentExecutionResponse {
  return { ok: false, error: { code, message, retryable } };
}

function isExplicitTabDiscovery(command: ContentExecutionRequest["command"]): boolean {
  return command.request.capture_mode === "observe"
    && command.request.target.type === "tab"
    && command.request.adapter_id === ""
    && command.request.expected_origin === "";
}

function adapterForCurrentPage(command: ContentExecutionRequest["command"]) {
  const current = new URL(location.href);
  if (isExplicitTabDiscovery(command)) return registry.match(current);
  if (current.origin !== command.request.expected_origin) return undefined;
  const adapter = registry.get(command.request.adapter_id);
  return adapter?.match(current) ? adapter : undefined;
}

function sameTarget(command: ContentExecutionRequest["command"]): boolean {
  const current = new URL(location.href);
  const adapter = adapterForCurrentPage(command);
  if (!adapter) return false;
  if (isExplicitTabDiscovery(command)) return true;
  if (command.request.target.type !== "url") return true;
  try {
    const requested = new URL(command.request.target.url);
    return requested.origin === current.origin && adapter.rule.contentId(requested) === adapter.rule.contentId(current);
  } catch {
    return false;
  }
}

async function applyAction(message: ContentExecutionRequest): Promise<ContentExecutionResponse> {
  if (!message.extension_owned) return failure("USER_TAB_ACTION_FORBIDDEN", "Actions are never applied to an explicitly supplied user tab.");
  const adapter = registry.get(message.command.request.adapter_id);
  const action = message.command.request.action;
  if (!adapter || !action || !adapter.allowsAction(action)) return failure("ACTION_NOT_ALLOWED", "This is not an adapter-approved read-only action.");
  if (action.type === "navigate") return failure("ACTION_NOT_ALLOWED", "Content scripts do not navigate pages.");
  if (action.type === "scroll") {
    window.scrollBy({ top: action.delta_y, left: 0, behavior: "auto" });
    return { ok: true, action_applied: true };
  }
  const reader = new DomPageReader(document);
  const node = nodeForAdapterAction(reader, adapter, action);
  if (!node) return failure("ACTION_TARGET_STALE", "The approved action target is no longer present on the target page.", true);
  const element = node as HTMLElement;
  if (action.type === "expand") {
    element.click();
    return { ok: true, action_applied: true };
  }
  const media = element instanceof HTMLMediaElement ? element : element.querySelector<HTMLMediaElement>("video,audio");
  if (!media) return failure("ACTION_TARGET_STALE", "The approved play target is no longer media.", true);
  try {
    await media.play();
    return { ok: true, action_applied: true };
  } catch {
    return failure("PLAY_NOT_AVAILABLE", "The target media could not be played in the muted task tab.", true);
  }
}

function textExpanderActivator(node: object): HTMLElement | undefined {
  const element = node as Element;
  if (!(element instanceof Element)) return undefined;
  const activator = element.closest<HTMLElement>("button, [role='button']");
  // Automatic snapshot preparation never follows links, submits forms, or
  // presses disabled controls. Platform selectors are shipped code and the
  // target-root check happens before this point.
  if (!activator || !activator.isConnected || activator.closest("form") || activator.hasAttribute("disabled") || activator.getAttribute("aria-disabled") === "true") return undefined;
  return activator;
}

async function prepareOwnedSnapshot(command: ContentExecutionRequest["command"], extensionOwned: boolean, adapter: NonNullable<ReturnType<typeof adapterForCurrentPage>>): Promise<boolean> {
  if (!extensionOwned) return false;
  const reader = new DomPageReader(document);
  const target = automaticExpandTarget(reader, adapter);
  const activator = target ? textExpanderActivator(target) : undefined;
  if (!activator) return false;
  try {
    // One target-scoped click only. It is intentionally not a scroll, carousel
    // traversal, media play, reply expansion, or continuation traversal.
    activator.click();
    await new Promise<void>(resolve => window.setTimeout(resolve, AUTO_EXPAND_SETTLE_MS));
    return true;
  } catch {
    // A static capture still reports its existing partial/completeness state.
    return false;
  }
}

function webDocumentAccessFailure(accessClass: ReturnType<NonNullable<ReturnType<typeof adapterForCurrentPage>>["observe"]>["access_class"]): ContentExecutionResponse | undefined {
  switch (accessClass) {
    case "public_free": return undefined;
    case "login_public_free": return undefined;
    case "paid": return failure("PAID_CONTENT_EXCLUDED", "The requested content is marked as paid or subscription-only.");
    case "private": return failure("PRIVATE_CONTENT_EXCLUDED", "The requested content is private or outside the allowed scope.");
    case "unknown": return undefined;
  }
}

/**
 * Runtime may explicitly select the generic current-page extractor after its
 * public HTTP path could not read the page. This branch is DOM-read-only: it
 * never invokes platform extraction, double sampling, expansion, scrolling,
 * media playback, or focus changes.
 */
function captureWebDocument(message: ContentExecutionRequest, adapter: NonNullable<ReturnType<typeof adapterForCurrentPage>>): ContentExecutionResponse {
  const request = message.command.request;
  if (!isWebDocumentCaptureRequest(request)) {
    return failure("BRIDGE_PROTOCOL_INVALID", "Generic current-page capture is valid only for one URL snapshot without related items or actions.");
  }
  const current = new URL(location.href);
  if (!sameWebDocumentTarget(request, current)) {
    return failure("TARGET_DRIFTED", "The page no longer represents the exact requested document target.");
  }
  const reader = new DomPageReader(document);
  let accessClass: "public_free" | "login_public_free" = "public_free";
  try {
    const access = adapter.observe(reader, message.instance_id, message.tab_id);
    const blocked = webDocumentAccessFailure(access.access_class);
    if (blocked) return blocked;
    if (access.access_class === "login_public_free") accessClass = access.access_class;
  } catch (error) {
    // A platform-specific positive-public marker can be absent while the
    // generic current-page parser still sees readable public DOM. It must not
    // become a second, selector-based body prerequisite. Explicit paid/private
    // classification above remains a hard boundary.
    if (!(error instanceof AdapterExtractionError) || error.code !== "ACCESS_UNCONFIRMED") throw error;
  }
  const snapshot = extractWebDocumentSnapshot(document, request, current, accessClass);
  if (!sameTarget(message.command) || !sameWebDocumentTarget(request, new URL(location.href))) {
    return failure("TARGET_DRIFTED", "The page moved away from the requested document while it was being read.");
  }
  return { ok: true, snapshot };
}

async function execute(message: ContentExecutionRequest): Promise<ContentExecutionResponse> {
  const command = message.command;
  if (command.session_id.length === 0 || command.nonce.length === 0) return failure("BRIDGE_PROTOCOL_INVALID", "The bridge command is missing session proof.", false);
  if (!sameTarget(command)) return failure("TARGET_DRIFTED", "The page no longer represents the requested content target.", false);
  const adapter = adapterForCurrentPage(command);
  if (!adapter) return failure("ADAPTER_NOT_ENABLED", "The requested platform adapter is not enabled in this extension build.", false);
  try {
    if (command.request.web_document !== undefined) return captureWebDocument(message, adapter);
    if (command.request.capture_mode === "observe") {
      // An explicit user tab must first disclose only its route-bound page
      // identity. For ordinary blog routes, do not let specialised roots,
      // access markers, canonicalisation, or action targets become a gate for
      // the later generic DOM read. The task-tab registry already bound this
      // exact tab and extension instance; this branch neither navigates nor
      // reads body selectors.
      if (isExplicitTabDiscovery(command)) {
        const routeOnly = routeOnlyExplicitTabObservation(
          adapter,
          new URL(location.href),
          document.title,
          message.instance_id,
          message.tab_id,
        );
        if (routeOnly) return { ok: true, observation: routeOnly };
      }
      const reader = new DomPageReader(document);
      return { ok: true, observation: adapter.observe(reader, message.instance_id, message.tab_id) };
    }
    if (command.request.capture_mode === "act") return await applyAction(message);
    const autoExpanded = await prepareOwnedSnapshot(command, message.extension_owned, adapter);
    if (!sameTarget(command)) return failure("TARGET_DRIFTED", "The page moved away from the requested content while preparing the snapshot.", false);
    const sampled = await sampleStableSnapshot(adapter, new URL(location.href), () => adapter.extract(new DomPageReader(document), {
      max_related_items: command.request.max_related_items,
    }));
    if (!sameTarget(command)) return failure("TARGET_DRIFTED", "The page moved away from the requested content while sampling the snapshot.", false);
    const snapshot = sampled.stability
      ? finalizeStableCompletion(sampled.snapshot, adapter, sampled.stability)
      : sampled.snapshot;
    return {
      ok: true,
      snapshot: autoExpanded
        ? { ...snapshot, evidence: [...new Set([...(snapshot.evidence ?? []), "extension:auto_expand:target_root"])] }
        : snapshot,
    };
  } catch (error) {
    if (error instanceof AdapterExtractionError) return failure(error.code, error.message, error.retryable);
    if (error instanceof WebHtmlExtractionError) {
      return failure(
        error.code,
        error.code === "ACCESS_NOT_PUBLIC"
          ? "The current page is an access gate, not readable public content."
          : "The current page did not contain readable current-page content.",
        error.code === "CONTENT_NOT_FOUND",
      );
    }
    if (error instanceof Error && (error.message === "WEB_DOCUMENT_TARGET_DRIFTED" || error.message === "WEB_DOCUMENT_ASSET_OUT_OF_SCOPE")) {
      return failure("WEB_DOCUMENT_INVALID", "The generic current-page result did not meet its bounded source rules.", false);
    }
    return failure("ADAPTER_EXECUTION_FAILED", "The page adapter could not safely read this target.", true);
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse: (response: ContentExecutionResponse) => void) => {
  if (sender.id !== chrome.runtime.id || !isExecutionRequest(message)) return undefined;
  void execute(message).then(sendResponse).catch(() => sendResponse(failure("ADAPTER_EXECUTION_FAILED", "The page adapter did not return a response.", true)));
  return true;
});
