import { describe, expect, it } from "vitest";
import type { BrowserCommand } from "../../shared/bridge-protocol.js";
import { createAdapterRegistry } from "../../adapters/registry.js";
import { TaskTabRegistry, type BrowserTab, type OwnedTaskTab, type OwnedTaskTabStore, type TabsGateway } from "../../extension/background/task-tabs.js";

type Event = { type: "create" | "update" | "get" | "remove" | "store"; detail: string };

class MemoryOwnedTabs implements OwnedTaskTabStore {
  records: OwnedTaskTab[] = [];
  constructor(private readonly events: Event[]) {}

  async read(): Promise<OwnedTaskTab[]> { return this.records.map(record => ({ ...record })); }
  async write(records: OwnedTaskTab[]): Promise<void> {
    this.records = records.map(record => ({ ...record }));
    this.events.push({ type: "store", detail: records.map(record => `${record.tab_id}:${record.target_reference_url}`).join(",") });
  }
}

class FakeTabs implements TabsGateway {
  readonly events: Event[];
  readonly tabs = new Map<number, BrowserTab>();
  readonly removed: number[] = [];
  muteReturnsFalse = false;
  muteReturnsUnknown = false;
  muteThrows = false;
  private nextId = 41;

  constructor(events: Event[]) { this.events = events; }

  async create(properties: { url: string; active: boolean }): Promise<BrowserTab> {
    this.events.push({ type: "create", detail: `${properties.url}|${String(properties.active)}` });
    const id = this.nextId++;
    const tab = { id, url: properties.url, mutedInfo: { muted: false } };
    this.tabs.set(id, tab);
    return { ...tab, mutedInfo: { ...tab.mutedInfo } };
  }

  async update(tabId: number, properties: { url?: string; active?: boolean; muted?: boolean }): Promise<BrowserTab> {
    this.events.push({ type: "update", detail: `${tabId}|${JSON.stringify(properties)}` });
    const current = this.tabs.get(tabId);
    if (!current) throw new Error("tab missing");
    if (properties.muted) {
      if (this.muteThrows) throw new Error("mute denied");
      current.mutedInfo = this.muteReturnsUnknown ? undefined : { muted: !this.muteReturnsFalse };
    }
    if (properties.url) current.url = properties.url;
    return { ...current, mutedInfo: { ...current.mutedInfo } };
  }

  async get(tabId: number): Promise<BrowserTab> {
    this.events.push({ type: "get", detail: String(tabId) });
    const current = this.tabs.get(tabId);
    if (!current) throw new Error("tab missing");
    return { ...current, mutedInfo: current.mutedInfo ? { ...current.mutedInfo } : undefined };
  }

  async remove(tabId: number): Promise<void> {
    this.events.push({ type: "remove", detail: String(tabId) });
    this.removed.push(tabId);
    this.tabs.delete(tabId);
  }

  redirect(tabId: number, url: string): void {
    const current = this.tabs.get(tabId);
    if (!current) throw new Error("tab missing");
    current.url = url;
  }

  addUserTab(id: number, url: string): void { this.tabs.set(id, { id, url, mutedInfo: { muted: false } }); }
}

function command(url: string, adapterId: string, mode: "snapshot" | "observe" | "act" = "snapshot"): BrowserCommand {
  return {
    version: 1,
    request_id: "request-1",
    nonce: "nonce-1",
    session_id: "session-1",
    job_id: "job-1",
    request: {
      target: { type: "url", url },
      adapter_id: adapterId,
      expected_origin: new URL(url).origin,
      allow_focus: false,
      capture_mode: mode,
      ...(mode === "act" ? { action: { type: "scroll" as const, delta_y: 100 } } : {}),
    },
  };
}

function taskRegistry(events: Event[]): { registry: TaskTabRegistry; tabs: FakeTabs; store: MemoryOwnedTabs } {
  const tabs = new FakeTabs(events);
  const store = new MemoryOwnedTabs(events);
  return { registry: new TaskTabRegistry(tabs, store, createAdapterRegistry()), tabs, store };
}

describe("extension-owned task tabs", () => {
  it("records and mutes an inactive blank tab before it navigates to the raw signed target URL", async () => {
    const events: Event[] = [];
    const { registry, store } = taskRegistry(events);
    const target = "https://www.bilibili.com/video/BV1GJ411x7h7/?p=2&xsec_token=temporary-signature";

    const resolved = await registry.resolve(command(target, "bilibili"), "instance-1");

    expect(resolved.extension_owned).toBe(true);
    expect(store.records).toHaveLength(1);
    expect(store.records[0]?.target_reference_url).toBe("https://www.bilibili.com/video/BV1GJ411x7h7/?p=2");
    expect(JSON.stringify(store.records)).not.toContain("temporary-signature");
    expect(events).toEqual([
      { type: "create", detail: "about:blank|false" },
      { type: "store", detail: "41:https://www.bilibili.com/video/BV1GJ411x7h7/?p=2" },
      { type: "update", detail: "41|{\"muted\":true}" },
      { type: "update", detail: `41|${JSON.stringify({ url: target, active: false })}` },
      { type: "get", detail: "41" },
    ]);
  });

  it("does not load a media target when Chrome cannot confirm mute", async () => {
    const events: Event[] = [];
    const { registry, tabs, store } = taskRegistry(events);
    tabs.muteReturnsFalse = true;
    const target = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

    await expect(registry.resolve(command(target, "youtube"), "instance-1")).rejects.toMatchObject({ code: "TASK_TAB_MUTE_FAILED" });

    expect(events.some(event => event.type === "update" && event.detail.includes(target))).toBe(false);
    expect(tabs.removed).toEqual([41]);
    expect(store.records).toEqual([]);
  });

  it("treats a missing mutedInfo confirmation as a mute failure before navigation", async () => {
    const events: Event[] = [];
    const { registry, tabs } = taskRegistry(events);
    tabs.muteReturnsUnknown = true;
    const target = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

    await expect(registry.resolve(command(target, "youtube"), "instance-1")).rejects.toMatchObject({ code: "TASK_TAB_MUTE_FAILED" });

    expect(events.some(event => event.type === "update" && event.detail.includes(target))).toBe(false);
  });

  it("reuses only the same instance/job/content task tab and refreshes its muted state without navigating it again", async () => {
    const events: Event[] = [];
    const { registry, tabs } = taskRegistry(events);
    const target = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    const first = await registry.resolve(command(target, "youtube"), "instance-1");
    events.splice(0);

    const reused = await registry.resolve(command(target, "youtube"), "instance-1");

    expect(reused.tab_id).toBe(first.tab_id);
    expect(events.filter(event => event.type === "create")).toEqual([]);
    expect(events.filter(event => event.type === "update").map(event => event.detail)).toEqual(["41|{\"muted\":true}"]);
    expect(tabs.removed).toEqual([]);
  });

  it("honors existing and new strategies without selecting any user browser tab", async () => {
    const events: Event[] = [];
    const { registry } = taskRegistry(events);
    const target = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    const existingOnly: BrowserCommand = {
      ...command(target, "youtube"),
      request: { ...command(target, "youtube").request, tab_strategy: "existing" },
    };

    await expect(registry.resolve(existingOnly, "instance-1")).rejects.toMatchObject({ code: "OWNED_TASK_TAB_NOT_FOUND" });
    expect(events).toEqual([]);

    const first = await registry.resolve(command(target, "youtube"), "instance-1");
    events.splice(0);
    const forceNew: BrowserCommand = {
      ...command(target, "youtube"),
      request_id: "request-new",
      request: { ...command(target, "youtube").request, tab_strategy: "new" },
    };
    const second = await registry.resolve(forceNew, "instance-1");

    expect(second.tab_id).not.toBe(first.tab_id);
    expect(events.filter(event => event.type === "create")).toEqual([{ type: "create", detail: "about:blank|false" }]);
    expect(events.filter(event => event.type === "get" && event.detail === String(first.tab_id))).toEqual([]);
  });

  it("refuses actions in an explicitly supplied user tab without creating, muting, navigating, or closing it", async () => {
    const events: Event[] = [];
    const { registry, tabs } = taskRegistry(events);
    const target = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    tabs.addUserTab(7, target);
    const actionCommand: BrowserCommand = {
      ...command(target, "youtube", "act"),
      tab_id: 7,
      request: {
        ...command(target, "youtube", "act").request,
        target: { type: "tab", instance_ref: "instance-1", tab_id: 7 },
      },
    };

    const resolved = await registry.resolve(actionCommand, "instance-1");
    await expect(registry.assertActionAllowed(actionCommand, resolved)).rejects.toMatchObject({ code: "USER_TAB_ACTION_FORBIDDEN" });

    expect(events.map(event => event.type)).toEqual(["get"]);
  });

  it("allows only the empty-adapter read-only discovery shape for an explicitly supplied supported tab", async () => {
    const events: Event[] = [];
    const { registry, tabs } = taskRegistry(events);
    const target = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    tabs.addUserTab(7, target);
    const discovery: BrowserCommand = {
      ...command(target, "youtube", "observe"),
      tab_id: 7,
      request: {
        ...command(target, "youtube", "observe").request,
        target: { type: "tab", instance_ref: "instance-1", tab_id: 7 },
        adapter_id: "",
        expected_origin: "",
      },
    };

    const resolved = await registry.resolve(discovery, "instance-1");
    await registry.validateCurrent(discovery, resolved);

    expect(resolved).toMatchObject({ tab_id: 7, extension_owned: false, adapter: { id: "youtube" }, expected_content_id: "dQw4w9WgXcQ" });
    expect(events.map(event => event.type)).toEqual(["get", "get"]);
  });

  it("refreshes only the exact current task URL in a confirmed-muted owned tab", async () => {
    const events: Event[] = [];
    const { registry } = taskRegistry(events);
    const target = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    const action: BrowserCommand = {
      ...command(target, "youtube", "act"),
      request: { ...command(target, "youtube", "act").request, action: { type: "navigate", url: target } },
    };
    const resolved = await registry.resolve(action, "instance-1");
    events.splice(0);

    await registry.navigateExact(action, resolved);

    expect(events.filter(event => event.type === "update").map(event => event.detail)).toEqual([
      "41|{\"muted\":true}",
      `41|${JSON.stringify({ url: target, active: false })}`,
    ]);

    const outsideTask: BrowserCommand = {
      ...action,
      request: { ...action.request, action: { type: "navigate", url: "https://www.youtube.com/watch?v=otherVideo12" } },
    };
    await expect(registry.navigateExact(outsideTask, resolved)).rejects.toMatchObject({ code: "TARGET_URL_MISMATCH" });
  });

  it("fails instead of capturing a Bilibili recommendation after the owned tab drifts", async () => {
    const events: Event[] = [];
    const { registry, tabs } = taskRegistry(events);
    const target = "https://www.bilibili.com/video/BV1GJ411x7h7/?p=1";
    const request = command(target, "bilibili");
    const resolved = await registry.resolve(request, "instance-1");
    tabs.redirect(resolved.tab_id, "https://www.bilibili.com/video/BV1xx411c7mD/");

    await expect(registry.validateCurrent(request, resolved)).rejects.toMatchObject({ code: "TARGET_DRIFTED" });
  });

  it("revoke only closes a task tab while it still represents the owned target", async () => {
    const events: Event[] = [];
    const { registry, tabs, store } = taskRegistry(events);
    const target = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    const resolved = await registry.resolve(command(target, "youtube"), "instance-1");
    tabs.redirect(resolved.tab_id, "https://example.com/user-navigation");

    const result = await registry.revoke("instance-1");

    expect(result).toEqual({ closed: [], left_open: [resolved.tab_id] });
    expect(tabs.removed).toEqual([]);
    expect(store.records).toEqual([]);
  });

  it("closes an owned task after a successful snapshot and expires idle owned tabs without touching user-navigated pages", async () => {
    const events: Event[] = [];
    const { registry, tabs, store } = taskRegistry(events);
    const target = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    const request = command(target, "youtube");
    const first = await registry.resolve(request, "instance-1");

    await registry.complete(request, first);
    expect(tabs.removed).toEqual([first.tab_id]);
    expect(store.records).toEqual([]);

    const second = await registry.resolve({ ...request, request_id: "request-2", job_id: "job-2" }, "instance-1");
    tabs.redirect(second.tab_id, "https://example.com/user-navigation");
    const cleanup = await registry.cleanupIdle("instance-1", 1, Date.now() + 60_000);

    expect(cleanup).toEqual({ closed: [], left_open: [second.tab_id] });
    expect(tabs.removed).toEqual([first.tab_id]);
    expect(store.records).toEqual([]);
  });
});
