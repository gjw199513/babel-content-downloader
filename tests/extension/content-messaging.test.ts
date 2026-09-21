import { describe, expect, it } from "vitest";
import { EXTENSION_CHANNEL, type ContentExecutionRequest } from "../../extension/bridge-messages.js";
import { captureContentWhenReady, CONTENT_COMMAND_BUDGET_MS, sendToContentWithDeadline, type ContentMessageSender } from "../../extension/background/content-messaging.js";

const CHROME_NO_RECEIVER_MESSAGE = "Could not establish connection. Receiving end does not exist.";

function request(): ContentExecutionRequest {
  return {
    channel: EXTENSION_CHANNEL,
    type: "execute",
    tab_id: 42,
    instance_id: "instance-test",
    extension_owned: true,
    command: {} as ContentExecutionRequest["command"],
  };
}

function snapshotRequest(): ContentExecutionRequest {
  const message = request();
  message.command = { request: { capture_mode: "snapshot" } } as ContentExecutionRequest["command"];
  return message;
}

function webDocumentSnapshotRequest(): ContentExecutionRequest {
  const message = request();
  message.command = {
    request: {
      capture_mode: "snapshot",
      web_document: { content_id: "a".repeat(64) },
    },
  } as ContentExecutionRequest["command"];
  return message;
}

function actionRequest(): ContentExecutionRequest {
  const message = request();
  message.command = { request: { capture_mode: "act" } } as ContentExecutionRequest["command"];
  return message;
}

describe("extension content message deadline", () => {
  it("returns after the shared deadline when a content listener never responds", async () => {
    let calls = 0;
    const sender: ContentMessageSender = async () => {
      calls++;
      return new Promise<unknown>(() => undefined);
    };
    const started = Date.now();
    const response = await sendToContentWithDeadline(request(), started + 20, sender);

    expect(response).toEqual({
      ok: false,
      error: {
        code: "CONTENT_SCRIPT_TIMEOUT",
        message: "The target page content script did not respond before the bounded execution deadline.",
        retryable: true,
      },
    });
    expect(calls).toBe(1);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("uses only the deadline left after tab preparation instead of granting a fresh content budget", async () => {
    let clock = 15_000;
    const commandStartedAt = 0;
    const response = await sendToContentWithDeadline(request(), commandStartedAt + CONTENT_COMMAND_BUDGET_MS, async () => {
      throw new Error(CHROME_NO_RECEIVER_MESSAGE);
    }, {
      now: () => clock,
      pause: async milliseconds => { clock += milliseconds; },
    });

    expect(clock).toBe(commandStartedAt + CONTENT_COMMAND_BUDGET_MS);
    expect(response.error?.code).toBe("CONTENT_SCRIPT_UNAVAILABLE");
  });

  it("bounds two serial missing-receiver commands to two command budgets", async () => {
    let clock = 0;
    let calls = 0;
    for (let item = 0; item < 2; item++) {
      const deadline = clock + CONTENT_COMMAND_BUDGET_MS;
      const response = await sendToContentWithDeadline(request(), deadline, async () => {
        calls++;
        throw new Error(CHROME_NO_RECEIVER_MESSAGE);
      }, {
        now: () => clock,
        pause: async milliseconds => { clock += milliseconds; },
      });
      expect(response.error?.code).toBe("CONTENT_SCRIPT_UNAVAILABLE");
    }

    expect(clock).toBe(2 * CONTENT_COMMAND_BUDGET_MS);
    expect(clock).toBeLessThan(90_000);
    expect(calls).toBeGreaterThan(2);
  });

  it("waits through a bounded delayed receiver and succeeds within the runtime command budget", async () => {
    let clock = 0;
    let calls = 0;
    const sender: ContentMessageSender = async () => {
      calls++;
      if (clock < 12_000) throw new Error(CHROME_NO_RECEIVER_MESSAGE);
      return { ok: true, action_applied: true };
    };

    const response = await sendToContentWithDeadline(request(), CONTENT_COMMAND_BUDGET_MS, sender, {
      now: () => clock,
      pause: async milliseconds => { clock += milliseconds; },
    });

    expect(CONTENT_COMMAND_BUDGET_MS).toBe(20_000);
    expect(clock).toBeGreaterThanOrEqual(12_000);
    expect(clock).toBeLessThan(CONTENT_COMMAND_BUDGET_MS);
    expect(calls).toBeGreaterThan(3);
    expect(response).toEqual({ ok: true, action_applied: true });
  });

  it("reports a missing receiver as unavailable only after the readiness window expires", async () => {
    let clock = 0;
    const response = await sendToContentWithDeadline(request(), 2_000, async () => {
      throw new Error(CHROME_NO_RECEIVER_MESSAGE);
    }, {
      now: () => clock,
      pause: async milliseconds => { clock += milliseconds; },
    });

    expect(clock).toBe(2_000);
    expect(response).toEqual({
      ok: false,
      error: {
        code: "CONTENT_SCRIPT_UNAVAILABLE",
        message: "The target page was not ready for the extension content script.",
        retryable: true,
      },
    });
  });

  it("retries a rejected static-message delivery but preserves the first valid response", async () => {
    let calls = 0;
    const sender: ContentMessageSender = async () => {
      calls++;
      if (calls === 1) throw new Error(CHROME_NO_RECEIVER_MESSAGE);
      return { ok: true, action_applied: true };
    };

    const response = await sendToContentWithDeadline(request(), Date.now() + 1_000, sender, { pause: async () => undefined });

    expect(calls).toBe(2);
    expect(response).toEqual({ ok: true, action_applied: true });
  });

  it("rejects a closed message port action once without treating it as a missing receiver", async () => {
    let calls = 0;
    const response = await sendToContentWithDeadline(actionRequest(), Date.now() + 1_000, async () => {
      calls++;
      throw new Error("The message port closed before a response was received.");
    });

    expect(calls).toBe(1);
    expect(response).toEqual({
      ok: false,
      error: {
        code: "CONTENT_SCRIPT_TRANSPORT_FAILED",
        message: "The content-script message channel failed before a response was received.",
        retryable: true,
      },
    });
  });

  it("does not classify an unknown lookalike action rejection as a receiver-missing retry", async () => {
    let calls = 0;
    const response = await sendToContentWithDeadline(actionRequest(), Date.now() + 1_000, async () => {
      calls++;
      throw new Error(`${CHROME_NO_RECEIVER_MESSAGE} unexpected suffix`);
    });

    expect(calls).toBe(1);
    expect(response.error?.code).toBe("CONTENT_SCRIPT_TRANSPORT_FAILED");
  });

  it("does not leak a rejected transport message", async () => {
    const secret = "https://private.example/path?token=secret-value";
    const response = await sendToContentWithDeadline(request(), Date.now() + 1_000, async () => {
      throw new Error(`Delivery rejected for ${secret}`);
    });

    expect(response.error?.code).toBe("CONTENT_SCRIPT_TRANSPORT_FAILED");
    expect(JSON.stringify(response)).not.toContain(secret);
    expect(JSON.stringify(response)).not.toContain("secret-value");
  });

  it("retries an action only after Chrome's exact no-receiver result", async () => {
    let calls = 0;
    const response = await sendToContentWithDeadline(actionRequest(), Date.now() + 1_000, async () => {
      calls++;
      if (calls === 1) throw new Error(CHROME_NO_RECEIVER_MESSAGE);
      return { ok: true, action_applied: true };
    }, { pause: async () => undefined });

    expect(calls).toBe(2);
    expect(response).toEqual({ ok: true, action_applied: true });
  });

  it("contains a throwing Error message getter as a fixed transport failure", async () => {
    const poisoned = Object.create(Error.prototype, {
      message: {
        get: () => { throw new Error("https://private.example/?token=secret-value"); },
      },
    }) as Error;
    const response = await sendToContentWithDeadline(request(), Date.now() + 1_000, async () => {
      throw poisoned;
    });

    expect(response).toEqual({
      ok: false,
      error: {
        code: "CONTENT_SCRIPT_TRANSPORT_FAILED",
        message: "The content-script message channel failed before a response was received.",
        retryable: true,
      },
    });
    expect(JSON.stringify(response)).not.toContain("secret-value");
  });

  it("does not retry an invalid response as though it were a missing receiver", async () => {
    let calls = 0;
    const sender: ContentMessageSender = async () => {
      calls++;
      return { unexpected: true };
    };

    const response = await sendToContentWithDeadline(request(), Date.now() + 1_000, sender);

    expect(calls).toBe(1);
    expect(response).toEqual({
      ok: false,
      error: {
        code: "CONTENT_RESPONSE_INVALID",
        message: "The content script returned an invalid response.",
        retryable: true,
      },
    });
  });

  it("preserves a controlled adapter error instead of calling it an injection failure", async () => {
    const response = await sendToContentWithDeadline(request(), Date.now() + 1_000, async () => ({
      ok: false,
      error: { code: "CONTENT_ROOT_NOT_FOUND", message: "The supported content root was not observed.", retryable: true },
    }));

    expect(response).toEqual({
      ok: false,
      error: { code: "CONTENT_ROOT_NOT_FOUND", message: "The supported content root was not observed.", retryable: true },
    });
  });

  it("preserves ADAPTER_CHANGED when its bounded hydration retry reaches the shared deadline", async () => {
    let clock = 0;
    let validations = 0;
    const response = await captureContentWhenReady(snapshotRequest(), 500, async () => ({
      ok: false,
      error: { code: "ADAPTER_CHANGED", message: "The expected content root is still an empty shell.", retryable: true },
    }), {
      now: () => clock,
      pause: async milliseconds => { clock += milliseconds; },
      validateCurrent: async () => { validations++; },
    });

    expect(clock).toBe(500);
    expect(validations).toBe(2);
    expect(response).toEqual({
      ok: false,
      error: { code: "ADAPTER_CHANGED", message: "The expected content root is still an empty shell.", retryable: true },
    });
  });

  it("returns the first successful result after a bounded generic hydration retry", async () => {
    let clock = 0;
    let calls = 0;
    let validations = 0;
    const response = await captureContentWhenReady(snapshotRequest(), 1_000, async () => {
      calls++;
      return calls === 1
        ? { ok: false, error: { code: "ADAPTER_CHANGED", message: "The content shell is still hydrating.", retryable: true } }
        : { ok: true, action_applied: true };
    }, {
      now: () => clock,
      pause: async milliseconds => { clock += milliseconds; },
      validateCurrent: async () => { validations++; },
      hydrationPauseMs: 350,
    });

    expect(calls).toBe(2);
    expect(validations).toBe(1);
    expect(clock).toBe(350);
    expect(response).toEqual({ ok: true, action_applied: true });
  });

  it("retries a generic DOM document only after a retryable empty-page result", async () => {
    let clock = 0;
    let calls = 0;
    let validations = 0;
    const response = await captureContentWhenReady(webDocumentSnapshotRequest(), 1_000, async () => {
      calls++;
      return calls === 1
        ? { ok: false, error: { code: "CONTENT_NOT_FOUND", message: "The current page is still empty.", retryable: true } }
        : { ok: true, action_applied: true };
    }, {
      now: () => clock,
      pause: async milliseconds => { clock += milliseconds; },
      validateCurrent: async () => { validations++; },
      hydrationPauseMs: 350,
    });

    expect(calls).toBe(2);
    expect(validations).toBe(1);
    expect(clock).toBe(350);
    expect(response).toEqual({ ok: true, action_applied: true });
  });
});
