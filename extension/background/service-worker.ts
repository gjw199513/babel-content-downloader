import { createAdapterRegistry, createBaselineAdapterRegistry } from "../../adapters/registry.js";
import type { BrowserCommand, BridgeResponse } from "../../shared/bridge-protocol.js";
import { EXTENSION_CHANNEL, type ContentExecutionRequest, type ContentExecutionResponse, type UiRequest, type UiResponse } from "../bridge-messages.js";
import { DEVELOPMENT_FIXTURE_ORIGINS } from "../environment.js";
import { BridgeClient, BridgeClientError, DEFAULT_BRIDGE_URL } from "./bridge-client.js";
import { captureContentWhenReady, CONTENT_COMMAND_BUDGET_MS } from "./content-messaging.js";
import { PendingTabClosures, SerialCycle } from "./serial-cycle.js";
import { ChromeExtensionStorage, ChromeOwnedTaskTabStore, findActionReceipt, rememberActionReceipt, type ExtensionStorage } from "./storage.js";
import { TaskTabError, TaskTabRegistry, type BrowserTab, type TabsGateway } from "./task-tabs.js";

declare const __BABEL_DEV_FIXTURES__: boolean;

const POLL_ALARM = "babel-content-downloader.poll";
const ACTIVE_POLL_INTERVAL_MS = 1_000;
const FALLBACK_ALARM_MINUTES = 0.5;
const OWNED_TAB_IDLE_MS = 5 * 60_000;
const registry = __BABEL_DEV_FIXTURES__
  ? createAdapterRegistry({ fixture_origins: DEVELOPMENT_FIXTURE_ORIGINS })
  : createBaselineAdapterRegistry();
const storage = new ChromeExtensionStorage();
let activePollTimer: ReturnType<typeof setTimeout> | undefined;
const pollCycle = new SerialCycle(() => scheduleActivePoll());

const tabs: TabsGateway = {
  async create(properties): Promise<BrowserTab> {
    const tab = await chrome.tabs.create(properties);
    if (!tab) throw new Error("Chrome did not create a task tab.");
    return tab;
  },
  async update(tabId, properties): Promise<BrowserTab> {
    const tab = await chrome.tabs.update(tabId, properties);
    if (!tab) throw new Error("Chrome did not update a task tab.");
    return tab;
  },
  async get(tabId): Promise<BrowserTab> { return chrome.tabs.get(tabId); },
  async remove(tabId): Promise<void> { await chrome.tabs.remove(tabId); },
};

const tabRegistry = new TaskTabRegistry(tabs, new ChromeOwnedTaskTabStore(storage), registry);
const pendingTabClosures = new PendingTabClosures(tabId => tabRegistry.forgetClosed(tabId));
const bridge = new BridgeClient(storage, {
  extension_id: chrome.runtime.id,
  extension_version: chrome.runtime.getManifest().version,
});

function responseFor(command: BrowserCommand, content: ContentExecutionResponse): BridgeResponse {
  if (!content.ok) {
    return {
      version: 1, request_id: command.request_id, nonce: command.nonce, session_id: command.session_id, ok: false,
      error: content.error ?? { code: "ADAPTER_EXECUTION_FAILED", message: "The page adapter did not return a safe result.", retryable: true },
    };
  }
  return {
    version: 1, request_id: command.request_id, nonce: command.nonce, session_id: command.session_id, ok: true,
    result: {
      ...(content.snapshot ? { snapshot: content.snapshot } : {}),
      ...(content.observation ? { observation: content.observation } : {}),
      ...(content.action_applied !== undefined ? { action_applied: content.action_applied } : {}),
    },
  };
}

function errorResponse(command: BrowserCommand, error: unknown): BridgeResponse {
  const structured = error instanceof TaskTabError || error instanceof BridgeClientError
    ? { code: error.code, message: error.message, retryable: error.retryable }
    : { code: "EXTENSION_COMMAND_FAILED", message: "The extension could not complete this bounded browser command.", retryable: true };
  return { version: 1, request_id: command.request_id, nonce: command.nonce, session_id: command.session_id, ok: false, error: structured };
}

async function captureWhenReady(message: ContentExecutionRequest, tab: Parameters<TaskTabRegistry["validateCurrent"]>[1], deadline: number): Promise<ContentExecutionResponse> {
  return captureContentWhenReady(message, deadline, (tabId, request) => chrome.tabs.sendMessage(tabId, request), {
    validateCurrent: () => tabRegistry.validateCurrent(message.command, tab),
  });
}

function withOwnedMutedEvidence(content: ContentExecutionResponse, tab: Parameters<TaskTabRegistry["validateCurrent"]>[1]): ContentExecutionResponse {
  if (!content.ok || !content.observation || !tab.extension_owned) return content;
  const evidence = [...new Set([...content.observation.evidence, "background:owned_task_tab_muted"])];
  return { ...content, observation: { ...content.observation, evidence } };
}

async function processCommand(command: BrowserCommand): Promise<void> {
  const state = await storage.readState();
  if (state.paused || !state.session || state.session.session_id !== command.session_id) return;
  if (command.request.capture_mode === "act") {
    const receipt = await findActionReceipt(storage, command.request_id, command.nonce);
    if (receipt?.response.session_id === command.session_id) {
      await bridge.respond(receipt.response);
      return;
    }
  }

  let response: BridgeResponse;
  let resolved: Awaited<ReturnType<TaskTabRegistry["resolve"]>> | undefined;
  let completedSnapshot = false;
  const deadline = Date.now() + CONTENT_COMMAND_BUDGET_MS;
  try {
    resolved = await tabRegistry.resolve(command, state.instance_id);
    await tabRegistry.validateCurrent(command, resolved);
    if (command.request.capture_mode === "act") await tabRegistry.assertActionAllowed(command, resolved);
    const content = command.request.capture_mode === "act" && command.request.action?.type === "navigate"
      ? (await tabRegistry.navigateExact(command, resolved), { ok: true, action_applied: true } satisfies ContentExecutionResponse)
      : await captureWhenReady({
        channel: EXTENSION_CHANNEL,
        type: "execute",
        command,
        instance_id: state.instance_id,
        tab_id: resolved.tab_id,
        extension_owned: resolved.extension_owned,
      }, resolved, deadline);
    // A redirect/autoplay may change a page while a content script is running.
    await tabRegistry.validateCurrent(command, resolved);
    response = responseFor(command, withOwnedMutedEvidence(content, resolved));
    completedSnapshot = command.request.capture_mode === "snapshot" && content.ok && !!content.snapshot;
  } catch (error) {
    response = errorResponse(command, error);
  }
  // Store only an action acknowledgement, never page text or media URLs. A retry cannot replay a click/play.
  if (command.request.capture_mode === "act") {
    await rememberActionReceipt(storage, { request_id: command.request_id, nonce: command.nonce, response, recorded_at: new Date().toISOString() });
  }
  await bridge.respond(response);
  if (completedSnapshot && resolved) await tabRegistry.complete(command, resolved);
}

async function pollAndProcess(): Promise<void> {
  try {
    const polled = await bridge.poll();
    if (!polled || polled.paused) return;
    for (const command of polled.commands) await processCommand(command);
  } catch (error) {
    await rememberError(storage, error);
  }
}

function scheduleActivePoll(delay = ACTIVE_POLL_INTERVAL_MS): void {
  if (activePollTimer !== undefined) clearTimeout(activePollTimer);
  activePollTimer = setTimeout(() => {
    activePollTimer = undefined;
    void runPollingCycle();
  }, delay);
}

async function runPollingCycle(cleanupAfter = false): Promise<void> {
  await pollCycle.run(
    async () => {
      await pendingTabClosures.drain();
      await pollAndProcess();
    },
    async () => {
      if (cleanupAfter) await cleanupIdleTaskTabs().catch(() => undefined);
      await pendingTabClosures.drain();
    },
  );
}

async function revokeTaskTabs(instanceId: string): Promise<void> {
  await pollCycle.enqueue(
    async () => {
      await pendingTabClosures.drain();
      await tabRegistry.revoke(instanceId);
    },
    async () => { await pendingTabClosures.drain(); },
  );
}

async function cleanupIdleTaskTabs(): Promise<void> {
  const state = await storage.readState();
  await tabRegistry.cleanupIdle(state.instance_id, OWNED_TAB_IDLE_MS);
}

async function rememberError(store: ExtensionStorage, error: unknown): Promise<void> {
  const state = await store.readState();
  const item = error instanceof BridgeClientError
    ? { code: error.code, message: error.message }
    : { code: "BRIDGE_UNAVAILABLE", message: "The local runtime could not be contacted." };
  await store.writeState({ ...state, last_error: item });
}

function isUiRequest(value: unknown): value is UiRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<UiRequest>;
  return request.channel === EXTENSION_CHANNEL && ["get_state", "connect", "pause", "resume", "revoke"].includes(request.type ?? "");
}

async function uiState(): Promise<UiResponse> {
  const state = await storage.readState();
  return {
    ok: true,
    state: {
      extension_id: chrome.runtime.id,
      extension_version: chrome.runtime.getManifest().version,
      instance_id: state.instance_id,
      bridge_url: DEFAULT_BRIDGE_URL,
      paired: !!state.session,
      paused: state.paused,
      ...(state.last_error ? { error: state.last_error } : {}),
    },
  };
}

async function handleUi(request: UiRequest): Promise<UiResponse> {
  try {
    if (request.type === "connect") await bridge.register();
    if (request.type === "pause") await bridge.pause();
    if (request.type === "resume") await bridge.resume();
    if (request.type === "revoke") {
      const state = await storage.readState();
      try { await bridge.revoke(); } finally { await revokeTaskTabs(state.instance_id); }
    }
    if (request.type === "connect" || request.type === "resume") scheduleActivePoll(0);
    return uiState();
  } catch (error) {
    await rememberError(storage, error);
    const item = error instanceof BridgeClientError
      ? { code: error.code, message: error.message }
      : { code: "EXTENSION_CONTROL_FAILED", message: "The requested extension control could not be completed." };
    return { ok: false, error: item, state: (await uiState()).state };
  }
}

async function initialize(): Promise<void> {
  await chrome.alarms.create(POLL_ALARM, { periodInMinutes: FALLBACK_ALARM_MINUTES });
  scheduleActivePoll(0);
}

chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === "install") void chrome.tabs.create({ url: chrome.runtime.getURL("welcome/index.html"), active: true });
  void initialize();
});
chrome.runtime.onStartup.addListener(() => { void initialize(); });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== POLL_ALARM) return;
  void runPollingCycle(true);
});
chrome.tabs.onRemoved.addListener(tabId => {
  pendingTabClosures.record(tabId);
  void runPollingCycle();
});
chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse: (response: UiResponse) => void) => {
  if (sender.id !== chrome.runtime.id || !isUiRequest(message)) return undefined;
  void handleUi(message).then(sendResponse).catch(() => sendResponse({ ok: false, error: { code: "EXTENSION_CONTROL_FAILED", message: "The extension control did not return a response." } }));
  return true;
});

void initialize();

// Keep setup, usage and language controls reachable after first installation.
chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({ url: chrome.runtime.getURL("welcome/index.html"), active: true });
});
