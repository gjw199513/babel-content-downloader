import type { ContentExecutionRequest, ContentExecutionResponse } from "../bridge-messages.js";

export type ContentMessageSender = (tabId: number, message: ContentExecutionRequest) => Promise<unknown>;

export interface ContentMessageTiming {
  now?: () => number;
  pause?: (milliseconds: number) => Promise<void>;
}

export interface ContentCaptureTiming extends ContentMessageTiming {
  validateCurrent?: () => Promise<void>;
  hydrationPauseMs?: number;
}

/** Shared tab/content deadline that avoids a long per-item wait in the serial poll loop. */
export const CONTENT_COMMAND_BUDGET_MS = 20_000;
// Chromium reports this exact message when no content-script receiver exists.
// Other rejected messages are transport failures, not evidence that injection
// is still pending.
const CHROME_NO_RECEIVER_MESSAGE = "Could not establish connection. Receiving end does not exist.";

type ContentAttempt =
  | { kind: "response"; value: unknown }
  | { kind: "rejected"; known_no_receiver: boolean }
  | { kind: "timed_out" };

function pause(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function isContentResponse(value: unknown): value is ContentExecutionResponse {
  return !!value && typeof value === "object" && typeof (value as { ok?: unknown }).ok === "boolean";
}

function isKnownNoReceiver(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  try {
    return error.message === CHROME_NO_RECEIVER_MESSAGE;
  } catch {
    // A hostile or malformed Error-like object must not escape its message
    // through the bridge or be mistaken for Chrome's known no-receiver case.
    return false;
  }
}

function transportFailure(): ContentExecutionResponse {
  return {
    ok: false,
    error: {
      code: "CONTENT_SCRIPT_TRANSPORT_FAILED",
      message: "The content-script message channel failed before a response was received.",
      retryable: true,
    },
  };
}

/**
 * Chrome may leave the Promise returned by tabs.sendMessage pending when a
 * listener never replies. Bound it to the command's one shared readiness
 * deadline so an inactive task tab cannot hold the bridge command forever.
 */
function awaitContentResponse(
  sender: ContentMessageSender,
  message: ContentExecutionRequest,
  deadline: number,
  now: () => number,
): Promise<ContentAttempt> {
  const remaining = deadline - now();
  if (remaining <= 0) return Promise.resolve({ kind: "timed_out" });
  return new Promise(resolve => {
    let settled = false;
    const finish = (result: ContentAttempt): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const timeout = setTimeout(() => finish({ kind: "timed_out" }), remaining);
    Promise.resolve()
      .then(() => sender(message.tab_id, message))
      .then(value => finish({ kind: "response", value }), error => finish({ kind: "rejected", known_no_receiver: isKnownNoReceiver(error) }));
  });
}

/**
 * Retries only Chromium's exact no-receiver result while a newly-created
 * inactive tab receives its static content script. This exact no-receiver
 * result proves that no command was delivered, including an action. A pending
 * response and all other transport failures are not retried: they may
 * represent an executing action, a closed port, or a browser transport
 * failure.
 */
export async function sendToContentWithDeadline(
  message: ContentExecutionRequest,
  deadline: number,
  sender: ContentMessageSender,
  timing: ContentMessageTiming = {},
): Promise<ContentExecutionResponse> {
  const now = timing.now ?? Date.now;
  const wait = timing.pause ?? pause;
  let attempt = 0;
  while (now() < deadline) {
    const outcome = await awaitContentResponse(sender, message, deadline, now);
    if (outcome.kind === "response") {
      if (isContentResponse(outcome.value)) return outcome.value;
      return { ok: false, error: { code: "CONTENT_RESPONSE_INVALID", message: "The content script returned an invalid response.", retryable: true } };
    }
    if (outcome.kind === "timed_out") {
      return {
        ok: false,
        error: {
          code: "CONTENT_SCRIPT_TIMEOUT",
          message: "The target page content script did not respond before the bounded execution deadline.",
          retryable: true,
        },
      };
    }
    if (!outcome.known_no_receiver) return transportFailure();
    attempt++;
    const remaining = deadline - now();
    if (remaining <= 0) break;
    await wait(Math.min(remaining, Math.min(1_000, 150 * attempt)));
  }
  return { ok: false, error: { code: "CONTENT_SCRIPT_UNAVAILABLE", message: "The target page was not ready for the extension content script.", retryable: true } };
}

/**
 * Retries only an adapter's explicit empty-shell result within the same
 * shared command deadline.
 */
export async function captureContentWhenReady(
  message: ContentExecutionRequest,
  deadline: number,
  sender: ContentMessageSender,
  timing: ContentCaptureTiming = {},
): Promise<ContentExecutionResponse> {
  const now = timing.now ?? Date.now;
  const wait = timing.pause ?? pause;
  const hydrationPauseMs = timing.hydrationPauseMs ?? 350;
  for (;;) {
    const content = await sendToContentWithDeadline(message, deadline, sender, { now, pause: wait });
    const retryableHydrationResult = content.error?.code === "ADAPTER_CHANGED"
      || (message.command.request.web_document !== undefined
        && content.error?.code === "CONTENT_NOT_FOUND"
        && content.error.retryable === true);
    if (message.command.request.capture_mode !== "snapshot" || content.ok || !retryableHydrationResult) return content;
    const remaining = deadline - now();
    if (remaining <= 0) return content;
    await wait(Math.min(hydrationPauseMs, remaining));
    await timing.validateCurrent?.();
    if (now() >= deadline) return content;
  }
}
