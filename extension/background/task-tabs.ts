import type { BrowserCommand } from "../../shared/bridge-protocol.js";
import type { PlatformAdapter, PlatformRegistry } from "../../adapters/types.js";
import { publicReferenceUrl } from "../../adapters/shared-extractors/url.js";

export interface BrowserTab {
  id?: number;
  url?: string;
  status?: "unloaded" | "loading" | "complete";
  mutedInfo?: { muted?: boolean };
}

export interface TabsGateway {
  create(properties: { url: string; active: boolean }): Promise<BrowserTab>;
  update(tabId: number, properties: { url?: string; active?: boolean; muted?: boolean }): Promise<BrowserTab>;
  get(tabId: number): Promise<BrowserTab>;
  remove(tabId: number): Promise<void>;
}

export interface OwnedTaskTab {
  tab_id: number;
  job_id: string;
  instance_id: string;
  /** Public reference only. Raw signed navigation URLs never enter chrome.storage. */
  target_reference_url: string;
  expected_origin: string;
  adapter_id: string;
  content_id: string;
  muted: true;
  created_at: string;
  last_used_at: string;
}

export interface OwnedTaskTabStore {
  read(): Promise<OwnedTaskTab[]>;
  write(tabs: OwnedTaskTab[]): Promise<void>;
}

export class TaskTabError extends Error {
  constructor(
    public readonly code:
      | "TARGET_INSTANCE_MISMATCH"
      | "TARGET_OWNERSHIP_REQUIRED"
      | "TARGET_ORIGIN_MISMATCH"
      | "TARGET_URL_MISMATCH"
      | "TARGET_DISCOVERY_FORBIDDEN"
      | "OWNED_TASK_TAB_NOT_FOUND"
      | "TASK_TAB_CREATE_FAILED"
      | "TASK_TAB_MUTE_FAILED"
      | "TASK_TAB_NOT_READY"
      | "TARGET_DRIFTED"
      | "USER_TAB_ACTION_FORBIDDEN",
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "TaskTabError";
  }
}

export interface ResolvedTaskTab {
  tab_id: number;
  /** User-selected tabs may only receive observe/snapshot work. */
  extension_owned: boolean;
  expected_url: URL;
  expected_content_id: string;
  adapter: PlatformAdapter;
}

function exactOrigin(value: string): string | null {
  try { return new URL(value).origin; } catch { return null; }
}

function tabUrl(tab: BrowserTab): URL {
  if (!tab.url) throw new TaskTabError("TASK_TAB_NOT_READY", "The task tab did not report a URL.", true);
  try { return new URL(tab.url); } catch { throw new TaskTabError("TARGET_URL_MISMATCH", "The task tab has a non-web URL.", false); }
}

function pause(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function isExplicitTabDiscovery(command: BrowserCommand): boolean {
  return command.request.capture_mode === "observe"
    && command.request.target.type === "tab"
    && command.request.adapter_id === ""
    && command.request.expected_origin === "";
}

/**
 * Owns only background-created task tabs. It never queries an active tab and
 * never navigates/closes a tab supplied by the user as an explicit target.
 */
export class TaskTabRegistry {
  constructor(
    private readonly tabs: TabsGateway,
    private readonly store: OwnedTaskTabStore,
    private readonly adapters: PlatformRegistry,
  ) {}

  async resolve(command: BrowserCommand, instanceId: string): Promise<ResolvedTaskTab> {
    const request = command.request;
    if (request.target.type === "tab") {
      if (request.target.instance_ref !== instanceId) {
        throw new TaskTabError("TARGET_INSTANCE_MISMATCH", "The explicit tab belongs to another browser instance.", false);
      }
      if (command.tab_id !== request.target.tab_id) {
        throw new TaskTabError("TARGET_OWNERSHIP_REQUIRED", "The command tab id does not match its explicit target.", false);
      }
      const tab = await this.tabs.get(request.target.tab_id);
      return this.validate(command, tab, false);
    }

    if (command.tab_id !== undefined) {
      throw new TaskTabError("TARGET_OWNERSHIP_REQUIRED", "A URL target must not silently reuse an unrelated tab id.", false);
    }
    const target = this.requestedUrl(command);
    const adapter = this.adapterFor(command, target);
    const contentId = adapter.rule.contentId(target);
    if (!contentId) throw new TaskTabError("TARGET_URL_MISMATCH", "The requested URL is not a supported single-content route.", false);

    const strategy = request.tab_strategy ?? "auto";
    if (!(["auto", "existing", "new"] as const).includes(strategy)) {
      throw new TaskTabError("TARGET_URL_MISMATCH", "The task tab strategy is invalid.", false);
    }
    if (strategy !== "new") {
      const reusable = await this.reuse(command, instanceId, adapter, target, contentId);
      if (reusable) return reusable;
      if (strategy === "existing") {
        throw new TaskTabError("OWNED_TASK_TAB_NOT_FOUND", "No still-owned task tab exists for this job and target content.", false);
      }
    }

    // Loading about:blank first prevents a media page from playing before muting takes effect.
    const created = await this.tabs.create({ url: "about:blank", active: false });
    if (typeof created.id !== "number") {
      throw new TaskTabError("TASK_TAB_CREATE_FAILED", "Chrome did not return an id for the task tab.", true);
    }
    const record: OwnedTaskTab = {
      tab_id: created.id,
      job_id: command.job_id,
      instance_id: instanceId,
      target_reference_url: publicReferenceUrl(adapter.rule.canonicalize(target)).href,
      expected_origin: target.origin,
      adapter_id: adapter.id,
      content_id: contentId,
      muted: true,
      created_at: new Date().toISOString(),
      last_used_at: new Date().toISOString(),
    };
    await this.add(record);
    try {
      await this.ensureMuted(record.tab_id);
    } catch (error) {
      await this.forget(record.tab_id);
      await this.tabs.remove(record.tab_id).catch(() => undefined);
      throw new TaskTabError("TASK_TAB_MUTE_FAILED", "The task tab could not be muted before target navigation.", true);
    }
    try {
      await this.tabs.update(record.tab_id, { url: target.href, active: request.allow_focus });
    } catch (error) {
      await this.forget(record.tab_id);
      await this.tabs.remove(record.tab_id).catch(() => undefined);
      throw new TaskTabError("TASK_TAB_CREATE_FAILED", "The muted task tab could not navigate to the requested target.", true);
    }
    const resolved: ResolvedTaskTab = { tab_id: record.tab_id, extension_owned: true, expected_url: target, expected_content_id: contentId, adapter };
    await this.waitForTarget(command, resolved);
    return resolved;
  }

  async validateCurrent(command: BrowserCommand, resolved: ResolvedTaskTab): Promise<void> {
    const current = await this.tabs.get(resolved.tab_id);
    const currentUrl = tabUrl(current);
    const adapter = this.adapterFor(command, currentUrl);
    const currentId = adapter.rule.contentId(currentUrl);
    if (adapter.id !== resolved.adapter.id || currentId !== resolved.expected_content_id) {
      throw new TaskTabError("TARGET_DRIFTED", "The task tab moved away from the requested content; no capture was returned.", false);
    }
    if (resolved.extension_owned && current.mutedInfo?.muted !== true) {
      throw new TaskTabError("TASK_TAB_MUTE_FAILED", "The extension-owned task tab is no longer muted.", true);
    }
  }

  async assertActionAllowed(command: BrowserCommand, resolved: ResolvedTaskTab): Promise<void> {
    if (!resolved.extension_owned) {
      throw new TaskTabError("USER_TAB_ACTION_FORBIDDEN", "An explicitly supplied user tab is read-only for this extension.", false);
    }
    await this.validateCurrent(command, resolved);
    const current = await this.tabs.get(resolved.tab_id);
    if (current.mutedInfo?.muted !== true) {
      throw new TaskTabError("TASK_TAB_MUTE_FAILED", "Media actions require a muted extension-owned task tab.", true);
    }
  }

  /**
   * The protocol permits a same-target refresh. It is performed here rather
   * than in the page so ownership and mute confirmation cannot be bypassed.
   */
  async navigateExact(command: BrowserCommand, resolved: ResolvedTaskTab): Promise<void> {
    const action = command.request.action;
    if (!action || action.type !== "navigate") {
      throw new TaskTabError("TARGET_URL_MISMATCH", "The browser command is not an exact task navigation.", false);
    }
    await this.assertActionAllowed(command, resolved);
    if (command.request.target.type !== "url") {
      throw new TaskTabError("USER_TAB_ACTION_FORBIDDEN", "An explicitly supplied user tab is never navigated by this extension.", false);
    }
    const target = this.requestedUrl(command);
    let requestedNavigation: URL;
    try { requestedNavigation = new URL(action.url); } catch {
      throw new TaskTabError("TARGET_URL_MISMATCH", "The requested navigation URL is invalid.", false);
    }
    if (requestedNavigation.href !== target.href || requestedNavigation.href !== resolved.expected_url.href) {
      throw new TaskTabError("TARGET_URL_MISMATCH", "The extension may only navigate to the exact URL of its current task.", false);
    }
    await this.ensureMuted(resolved.tab_id);
    try {
      await this.tabs.update(resolved.tab_id, { url: requestedNavigation.href, active: false });
    } catch {
      throw new TaskTabError("TASK_TAB_CREATE_FAILED", "The muted task tab could not refresh the requested target.", true);
    }
    await this.waitForTarget(command, resolved);
    await this.touch(resolved.tab_id);
  }

  async revoke(instanceId: string): Promise<{ closed: number[]; left_open: number[] }> {
    const records = await this.store.read();
    const retained = records.filter(record => record.instance_id !== instanceId);
    const mine = records.filter(record => record.instance_id === instanceId);
    const closed: number[] = [];
    const leftOpen: number[] = [];
    for (const record of mine) {
      try {
        const tab = await this.tabs.get(record.tab_id);
        if (this.stillOwns(record, tab)) {
          await this.tabs.remove(record.tab_id);
          closed.push(record.tab_id);
        } else {
          // A user navigated it after we created it. Removing the record hands it back without closing it.
          leftOpen.push(record.tab_id);
        }
      } catch {
        // A closed tab is already clean; revoke must remain idempotent.
      }
    }
    await this.store.write(retained);
    return { closed, left_open: leftOpen };
  }

  /** Removes only expired, still-owned task tabs; user-navigated tabs are left alone. */
  async cleanupIdle(instanceId: string, maxIdleMs: number, now = Date.now()): Promise<{ closed: number[]; left_open: number[] }> {
    const records = await this.store.read();
    const retained: OwnedTaskTab[] = [];
    const closed: number[] = [];
    const leftOpen: number[] = [];
    for (const record of records) {
      const lastUsed = Date.parse(record.last_used_at);
      if (record.instance_id !== instanceId || !Number.isFinite(lastUsed) || now - lastUsed < maxIdleMs) {
        retained.push(record);
        continue;
      }
      try {
        const tab = await this.tabs.get(record.tab_id);
        if (this.stillOwns(record, tab)) {
          await this.tabs.remove(record.tab_id);
          closed.push(record.tab_id);
        } else {
          // The user moved this once-owned tab elsewhere, so hand it back.
          leftOpen.push(record.tab_id);
        }
      } catch {
        // A closed tab no longer needs an ownership record.
      }
    }
    await this.store.write(retained);
    return { closed, left_open: leftOpen };
  }

  /** Snapshot completion makes an owned page unnecessary for downstream media work. */
  async complete(command: BrowserCommand, resolved: ResolvedTaskTab): Promise<void> {
    if (!resolved.extension_owned || command.request.capture_mode !== "snapshot") return;
    const records = await this.store.read();
    const record = records.find(item => item.tab_id === resolved.tab_id && item.job_id === command.job_id
      && item.adapter_id === resolved.adapter.id && item.content_id === resolved.expected_content_id);
    if (!record) return;
    await this.forget(record.tab_id);
    try {
      const tab = await this.tabs.get(record.tab_id);
      if (this.stillOwns(record, tab)) await this.tabs.remove(record.tab_id);
    } catch {
      // It is already gone or no longer ours; both outcomes leave user tabs untouched.
    }
  }

  async forgetClosed(tabId: number): Promise<void> { await this.forget(tabId); }

  /**
   * Reuse is limited to a tab this instance created for the same job and
   * platform content identity. It deliberately never searches browser tabs.
   */
  private async reuse(
    command: BrowserCommand,
    instanceId: string,
    adapter: PlatformAdapter,
    target: URL,
    contentId: string,
  ): Promise<ResolvedTaskTab | undefined> {
    const records = await this.store.read();
    for (const record of records) {
      if (record.instance_id !== instanceId || record.job_id !== command.job_id || record.adapter_id !== adapter.id || record.content_id !== contentId) continue;
      try {
        const current = await this.tabs.get(record.tab_id);
        if (!this.stillOwns(record, current)) {
          await this.forget(record.tab_id);
          continue;
        }
        await this.ensureMuted(record.tab_id);
        const resolved: ResolvedTaskTab = {
          tab_id: record.tab_id,
          extension_owned: true,
          expected_url: target,
          expected_content_id: contentId,
          adapter,
        };
        await this.waitForTarget(command, resolved);
        await this.touch(record.tab_id);
        return resolved;
      } catch (error) {
        if (error instanceof TaskTabError) {
          if (error.code === "TASK_TAB_MUTE_FAILED") await this.discardOwnedRecord(record);
          // A redirect to a different item is never recovered by silently
          // opening a second page; the runtime must report the drift.
          if (error.code === "TASK_TAB_MUTE_FAILED" || error.code === "TARGET_DRIFTED") throw error;
        }
        // A tab closed while the worker was asleep cannot be reused. Its stale
        // ownership record must not cause a later command to touch another tab.
        await this.forget(record.tab_id);
      }
    }
    return undefined;
  }

  private async ensureMuted(tabId: number): Promise<void> {
    try {
      const muted = await this.tabs.update(tabId, { muted: true });
      if (muted.mutedInfo?.muted !== true) {
        throw new Error("Chrome did not confirm muted=true");
      }
    } catch {
      throw new TaskTabError("TASK_TAB_MUTE_FAILED", "The task tab could not be muted before target navigation.", true);
    }
  }

  /** Wait for Chrome to commit the target rather than validating the transient about:blank document. */
  private async waitForTarget(command: BrowserCommand, resolved: ResolvedTaskTab): Promise<void> {
    const deadline = Date.now() + 10_000;
    let lastNotReady: TaskTabError | undefined;
    while (Date.now() < deadline) {
      try {
        const current = await this.tabs.get(resolved.tab_id);
        if (resolved.extension_owned && current.mutedInfo?.muted !== true) {
          throw new TaskTabError("TASK_TAB_MUTE_FAILED", "The extension-owned task tab is no longer muted.", true);
        }
        if (!current.url || current.url === "about:blank") {
          lastNotReady = new TaskTabError("TASK_TAB_NOT_READY", "The target tab is still loading its requested content.", true);
        } else {
          const currentUrl = tabUrl(current);
          const adapter = this.adapterFor(command, currentUrl);
          const currentId = adapter.rule.contentId(currentUrl);
          if (adapter.id === resolved.adapter.id && currentId === resolved.expected_content_id) return;
          if (current.status !== "loading") {
            throw new TaskTabError("TARGET_DRIFTED", "The task tab moved away from the requested content; no capture was returned.", false);
          }
          lastNotReady = new TaskTabError("TASK_TAB_NOT_READY", "The target tab is still committing its requested content.", true);
        }
      } catch (error) {
        if (error instanceof TaskTabError) {
          if (error.code === "TASK_TAB_MUTE_FAILED" || error.code === "TARGET_DRIFTED") throw error;
          lastNotReady = error;
        } else {
          lastNotReady = new TaskTabError("TASK_TAB_NOT_READY", "The target tab is not ready for bounded capture.", true);
        }
      }
      await pause(200);
    }
    throw lastNotReady ?? new TaskTabError("TASK_TAB_NOT_READY", "The target tab did not finish loading in time.", true);
  }

  private async discardOwnedRecord(record: OwnedTaskTab): Promise<void> {
    await this.forget(record.tab_id);
    try {
      const tab = await this.tabs.get(record.tab_id);
      if (this.stillOwns(record, tab)) await this.tabs.remove(record.tab_id);
    } catch {
      // The tab already disappeared or changed hands; no further action is safe.
    }
  }

  private requestedUrl(command: BrowserCommand): URL {
    if (command.request.target.type !== "url") throw new TaskTabError("TARGET_URL_MISMATCH", "Expected a URL target.", false);
    let target: URL;
    try { target = new URL(command.request.target.url); } catch {
      throw new TaskTabError("TARGET_URL_MISMATCH", "The requested target URL is invalid.", false);
    }
    if (target.protocol !== "https:" && target.protocol !== "http:") {
      throw new TaskTabError("TARGET_URL_MISMATCH", "Only HTTP(S) target URLs are allowed.", false);
    }
    const expectedOrigin = exactOrigin(command.request.expected_origin);
    if (!expectedOrigin || expectedOrigin !== target.origin) {
      throw new TaskTabError("TARGET_ORIGIN_MISMATCH", "The target URL does not match the command's expected origin.", false);
    }
    return target;
  }

  private adapterFor(command: BrowserCommand, url: URL): PlatformAdapter {
    if (isExplicitTabDiscovery(command)) {
      const adapter = this.adapters.match(url);
      if (!adapter) {
        throw new TaskTabError("TARGET_URL_MISMATCH", "The explicit tab is not on an enabled single-content platform route.", false);
      }
      return adapter;
    }
    const expectedOrigin = exactOrigin(command.request.expected_origin);
    if (!expectedOrigin || url.origin !== expectedOrigin) {
      throw new TaskTabError("TARGET_ORIGIN_MISMATCH", "The tab origin does not match the command's expected origin.", false);
    }
    const adapter = this.adapters.match(url);
    if (!adapter || adapter.id !== command.request.adapter_id) {
      throw new TaskTabError("TARGET_URL_MISMATCH", "The current tab is not the requested adapter's supported route.", false);
    }
    return adapter;
  }

  private validate(command: BrowserCommand, tab: BrowserTab, extensionOwned: boolean): ResolvedTaskTab {
    if ((command.request.adapter_id === "" || command.request.expected_origin === "") && !isExplicitTabDiscovery(command)) {
      throw new TaskTabError("TARGET_DISCOVERY_FORBIDDEN", "Only a read-only observation of an explicitly supplied tab may discover its platform.", false);
    }
    if (typeof tab.id !== "number") {
      throw new TaskTabError("TASK_TAB_NOT_READY", "Chrome did not return an id for the explicit target tab.", true);
    }
    const url = tabUrl(tab);
    const adapter = this.adapterFor(command, url);
    const contentId = adapter.rule.contentId(url);
    if (!contentId) throw new TaskTabError("TARGET_URL_MISMATCH", "The explicit tab is not on a supported single-content route.", false);
    return { tab_id: tab.id, extension_owned: extensionOwned, expected_url: url, expected_content_id: contentId, adapter };
  }

  private stillOwns(record: OwnedTaskTab, tab: BrowserTab): boolean {
    if (tab.url === "about:blank") return true;
    try {
      const url = tabUrl(tab);
      if (url.origin !== record.expected_origin) return false;
      const adapter = this.adapters.get(record.adapter_id);
      return !!adapter && adapter.rule.contentId(url) === record.content_id;
    } catch {
      return false;
    }
  }

  private async add(record: OwnedTaskTab): Promise<void> {
    const records = await this.store.read();
    await this.store.write([...records.filter(item => item.tab_id !== record.tab_id), record]);
  }

  private async forget(tabId: number): Promise<void> {
    const records = await this.store.read();
    await this.store.write(records.filter(record => record.tab_id !== tabId));
  }

  private async touch(tabId: number): Promise<void> {
    const records = await this.store.read();
    const last_used_at = new Date().toISOString();
    await this.store.write(records.map(record => record.tab_id === tabId ? { ...record, last_used_at } : record));
  }
}
