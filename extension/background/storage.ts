import type { ExtensionSession } from "../../shared/bridge-protocol.js";
import type { BridgeResponse } from "../../shared/bridge-protocol.js";
import type { OwnedTaskTab, OwnedTaskTabStore } from "./task-tabs.js";

const STATE_KEY = "babel_content_downloader.bridge_state.v1";
const OWNED_TABS_KEY = "babel_content_downloader.owned_task_tabs.v1";
const ACTION_RECEIPTS_LIMIT = 64;

export interface ActionReceipt {
  request_id: string;
  nonce: string;
  response: BridgeResponse;
  recorded_at: string;
}

export interface PersistedBridgeState {
  instance_id: string;
  session?: ExtensionSession;
  paused: boolean;
  last_error?: { code: string; message: string };
  action_receipts: ActionReceipt[];
}

export interface ExtensionStorage {
  readState(): Promise<PersistedBridgeState>;
  writeState(state: PersistedBridgeState): Promise<void>;
  readOwnedTabs(): Promise<OwnedTaskTab[]>;
  writeOwnedTabs(tabs: OwnedTaskTab[]): Promise<void>;
}

function freshState(): PersistedBridgeState {
  return { instance_id: crypto.randomUUID(), paused: false, action_receipts: [] };
}

export class ChromeExtensionStorage implements ExtensionStorage {
  async readState(): Promise<PersistedBridgeState> {
    const values = await chrome.storage.local.get(STATE_KEY);
    const stored = values[STATE_KEY] as Partial<PersistedBridgeState> | undefined;
    if (!stored || typeof stored.instance_id !== "string") return freshState();
    return {
      instance_id: stored.instance_id,
      ...(stored.session && typeof stored.session.session_id === "string" && typeof stored.session.token === "string" ? { session: stored.session } : {}),
      paused: stored.paused === true,
      ...(stored.last_error && typeof stored.last_error.code === "string" && typeof stored.last_error.message === "string" ? { last_error: stored.last_error } : {}),
      action_receipts: Array.isArray(stored.action_receipts) ? stored.action_receipts.filter(validReceipt).slice(-ACTION_RECEIPTS_LIMIT) : [],
    };
  }

  async writeState(state: PersistedBridgeState): Promise<void> {
    await chrome.storage.local.set({ [STATE_KEY]: state });
  }

  async readOwnedTabs(): Promise<OwnedTaskTab[]> {
    const values = await chrome.storage.local.get(OWNED_TABS_KEY);
    const candidate = values[OWNED_TABS_KEY];
    return Array.isArray(candidate) ? candidate.filter(validOwnedTab) : [];
  }

  async writeOwnedTabs(tabs: OwnedTaskTab[]): Promise<void> {
    await chrome.storage.local.set({ [OWNED_TABS_KEY]: tabs.filter(validOwnedTab) });
  }
}

function validOwnedTab(value: unknown): value is OwnedTaskTab {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<OwnedTaskTab>;
  return typeof item.tab_id === "number" && typeof item.job_id === "string" && typeof item.instance_id === "string"
    && typeof item.target_reference_url === "string" && typeof item.expected_origin === "string" && typeof item.adapter_id === "string"
    && typeof item.content_id === "string" && item.muted === true && typeof item.created_at === "string" && typeof item.last_used_at === "string";
}

function validReceipt(value: unknown): value is ActionReceipt {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ActionReceipt>;
  return typeof item.request_id === "string" && typeof item.nonce === "string" && !!item.response && typeof item.recorded_at === "string";
}

export class ChromeOwnedTaskTabStore implements OwnedTaskTabStore {
  constructor(private readonly storage: ExtensionStorage) {}
  read(): Promise<OwnedTaskTab[]> { return this.storage.readOwnedTabs(); }
  write(tabs: OwnedTaskTab[]): Promise<void> { return this.storage.writeOwnedTabs(tabs); }
}

export async function rememberActionReceipt(storage: ExtensionStorage, receipt: ActionReceipt): Promise<void> {
  const state = await storage.readState();
  const retained = state.action_receipts.filter(item => item.request_id !== receipt.request_id && item.nonce !== receipt.nonce);
  await storage.writeState({ ...state, action_receipts: [...retained, receipt].slice(-ACTION_RECEIPTS_LIMIT) });
}

export async function findActionReceipt(storage: ExtensionStorage, requestId: string, nonce: string): Promise<ActionReceipt | undefined> {
  return (await storage.readState()).action_receipts.find(item => item.request_id === requestId && item.nonce === nonce);
}
