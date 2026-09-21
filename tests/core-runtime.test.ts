import { createServer } from "node:http";
import { access, mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AdapterDefinition, AdapterRegistry, CollectionExecutor, CollectRequest, JobRecord } from "../shared/contracts.js";
import { BrowserBridge } from "../runtime/bridge/server.js";
import { JobManager } from "../runtime/jobs/manager.js";
import { createRuntimeHttpServer } from "../runtime/mcp/http.js";
import { assertAuthorizedDirectory, createJobWorkspace } from "../runtime/policy/output.js";
import { loadConfig, newConfig, saveConfig, type RuntimeConfig } from "../runtime/policy/config.js";
import { JobStore, redactUrl, sanitizeSnapshot } from "../runtime/storage/job-store.js";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
async function temp(): Promise<string> { const dir = await mkdtemp(join(tmpdir(), "babel-runtime-test-")); dirs.push(dir); return dir; }

const completionRuleId = "example-article-complete-v1";
const adapter: AdapterDefinition = {
  id: "example", version: "1", hosts: ["example.com"], content_types: ["article"], status: "experimental",
  match: (url) => url.hostname === "example.com" && url.pathname === "/article",
  completion_rules: [{ id: completionRuleId, content_types: ["article"], boundary: "terminal_observed", stability: { sample_count: 2, minimum_window_ms: 700 }, matches: (url, contentId) => url.pathname === "/article" && contentId === "article" }],
};
const registry: AdapterRegistry = { match: (url) => adapter.match(url) ? adapter : undefined, list: () => [adapter] };

async function until<T>(read: () => Promise<T>, predicate: (value: T) => boolean): Promise<T> {
  for (let i = 0; i < 100; i++) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for test state");
}

describe("job persistence and authorization", () => {
  it("keeps DNS mode in operator config and rejects unsupported values", async () => {
    const path = join(await temp(), "config.json");
    const config = newConfig();
    expect(config.dns_mode).toBe("system");
    config.dns_mode = "cloudflare";
    await saveConfig(config, path);
    expect((await loadConfig(path)).dns_mode).toBe("cloudflare");
    await saveConfig({ ...config, dns_mode: "insecure" as RuntimeConfig["dns_mode"] }, path);
    await expect(loadConfig(path)).rejects.toThrow("Invalid DNS mode");
  });

  it("keeps identity parameters while stripping signed asset URLs from persisted snapshots", () => {
    const snapshot = sanitizeSnapshot({
      schema_version: "1", platform: "bilibili", adapter_version: "1", source_url: "https://www.bilibili.com/video/BV1?p=2&token=secret", canonical_url: "https://www.bilibili.com/video/BV1?p=2&signature=secret", content_type: "video", title: "Mirror https://example.com/watch?id=3&token=secret", authors: ["https://example.com/author?signature=secret"], published_at: null, blocks: [{ type: "paragraph", text: "See https://example.com/search?q=lesson&token=secret" }, { type: "image", asset_id: "v1", caption: "https://example.com/caption?auth=secret" }, { type: "list", ordered: false, items: ["https://example.com/item?access_token=secret"] }], assets: [{ id: "v1", role: "video", url: "https://cdn.example/media.mp4?token=secret", title: "https://example.com/asset?token=secret", order: 1, availability: "available" }], access_class: "public_free", completeness: "complete", warnings: [],
    });
    expect(snapshot.source_url).toContain("?p=2");
    expect(snapshot.blocks[0]).toMatchObject({ text: "See https://example.com/search?q=lesson" });
    expect(JSON.stringify(snapshot)).not.toContain("secret");
    expect(redactUrl("https://mp.weixin.qq.com/s?__biz=MzA0MTIzNDU2Nw==&mid=1234567890&idx=2&sn=abcdef1234567890abcdef1234567890&chksm=secret"))
      .toBe("https://mp.weixin.qq.com/s?__biz=MzA0MTIzNDU2Nw%3D%3D&mid=1234567890&idx=2&sn=abcdef1234567890abcdef1234567890");
  });

  it("keeps owner isolation, deduplicates retries, and resumes from a blocked checkpoint", async () => {
    const dir = await temp();
    const output = join(dir, "materials");
    await mkdir(output);
    const store = new JobStore(join(dir, "jobs"));
    let runs = 0;
    const executor: CollectionExecutor = {
      execute: async (_job, _signal, checkpoint) => {
        runs++;
        await checkpoint({ checkpoint: { completed_components: ["text"] } });
        if (runs === 1) throw { code: "DEPENDENCY_MISSING", message: "ffmpeg unavailable", retryable: true, dependency: "ffmpeg" };
        return { status: "succeeded", completeness: { requested_components_complete: true, scope: "single_item" } };
      },
    };
    const clients = [{ id: "alice", token: "alice-token", output_roots: [output] }, { id: "bob", token: "bob-token", output_roots: [output] }];
    const manager = new JobManager(store, executor, clients);
    await manager.init();
    const request: CollectRequest = { target: { type: "url", url: "https://example.com/article" }, save_as: "document", output: { directory: output }, idempotency_key: "once" };
    await expect(manager.submit("alice", { target: { type: "tab", instance_ref: "browser-a", tab_id: 7 }, browser: { instance_ref: "browser-b" }, output: { directory: output } })).rejects.toThrow("BROWSER_INSTANCE_MISMATCH");
    const first = await manager.submit("alice", request);
    await until(() => manager.get("alice", first.id), (job) => job?.status === "blocked");
    expect(await manager.get("bob", first.id)).toBeUndefined();
    expect((await manager.list("bob")).length).toBe(0);
    expect((await manager.submit("alice", request)).id).toBe(first.id);
    await expect(manager.submit("alice", { ...request, save_as: "video" })).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    expect((await store.get(first.id))?.checkpoint?.completed_components).toEqual(["text"]);
    await manager.resume("alice", first.id);
    const result = await until(() => manager.get("alice", first.id), (job) => job?.status === "succeeded");
    expect(result?.completeness.requested_components_complete).toBe(true);
    expect(runs).toBe(2);
  });

  it("never persists signed target parameters and requires a fresh URL after restart", async () => {
    const dir = await temp();
    const output = join(dir, "materials");
    await mkdir(output);
    const store = new JobStore(join(dir, "jobs"));
    const clients = [{ id: "alice", token: "secret", output_roots: [output] }];
    const executor: CollectionExecutor = { execute: async (job) => {
      if (job.request.target.type !== "url") throw new Error("Unexpected target");
      expect(job.request.target.url).toContain("token=secret");
      return { status: "blocked", error: { code: "TEST_BLOCK", message: "retry", retryable: true } };
    } };
    const manager = new JobManager(store, executor, clients);
    await manager.init();
    const request: CollectRequest = { target: { type: "url", url: "https://example.com/article?id=abc123&token=secret" }, output: { directory: output }, idempotency_key: "signed" };
    const job = await manager.submit("alice", request);
    await until(() => manager.get("alice", job.id), (value) => value?.status === "blocked");
    const stored = await store.get(job.id);
    expect(stored?.request.target.type === "url" && stored.request.target.url).toBe("https://example.com/article?id=abc123");
    expect(stored?.checkpoint?.requires_fresh_url).toBe(true);
    if (stored) {
      stored.warnings = ["failed at https://example.com/file?xsec_token=secret"];
      stored.error = { code: "TEST", message: "token=secret", retryable: true };
      stored.checkpoint = { ...stored.checkpoint, failed_components: { audio: "https://example.com/a?signature=secret" } };
      await store.put(stored);
      expect(JSON.stringify(await store.get(job.id))).not.toContain("secret");
    }
    const restarted = new JobManager(store, executor, clients);
    await restarted.init();
    await expect(restarted.resume("alice", job.id)).rejects.toMatchObject({ code: "FRESH_URL_REQUIRED" });
    await restarted.resume("alice", job.id, "https://example.com/article?id=abc123&token=secret");
    await until(() => restarted.get("alice", job.id), (value) => value?.status === "blocked" && value.attempts === 2);
  });

  it("allows local-only completion checkpoint to resume without a fresh signed URL", async () => {
    const dir = await temp();
    const output = join(dir, "materials");
    await mkdir(output);
    const store = new JobStore(join(dir, "jobs"));
    const now = new Date().toISOString();
    const job: JobRecord = {
      id: "job_00000000-0000-4000-8000-000000000001", client_id: "alice", request: { target: { type: "url", url: "https://example.com/article?id=abc123&token=secret" }, save_as: "document", output: { directory: output } },
      status: "blocked", stage: "finalizing", created_at: now, updated_at: now, artifacts: [], completeness: { requested_components_complete: false, scope: "single_item" }, warnings: [], attempts: 1,
      snapshot: { schema_version: "1", platform: "example", adapter_version: "1", source_url: "https://example.com/article?id=abc123", canonical_url: "https://example.com/article?id=abc123", content_type: "article", authors: [], published_at: null, blocks: [{ type: "paragraph", text: "Saved text" }], assets: [], access_class: "public_free", completeness: "complete", warnings: [] },
      checkpoint: { completed_components: ["text"], requires_fresh_url: true },
    };
    await store.put(job);
    let invoked = false;
    const manager = new JobManager(store, { execute: async () => { invoked = true; return { status: "succeeded", completeness: { requested_components_complete: true, scope: "single_item" } }; } }, [{ id: "alice", token: "x", output_roots: [output] }]);
    await manager.init();
    await manager.resume("alice", job.id);
    await until(() => manager.get("alice", job.id), (value) => value?.status === "succeeded");
    expect(invoked).toBe(true);
  });

  it("marks interrupted work resumable on restart and rejects symlink escape", async () => {
    const dir = await temp();
    const output = join(dir, "allowed");
    const outside = join(dir, "outside");
    await Promise.all([mkdir(output), mkdir(outside)]);
    await symlink(outside, join(output, "escape"));
    await expect(assertAuthorizedDirectory(join(output, "escape", "x"), [output])).rejects.toThrow("OUTPUT_NOT_AUTHORIZED");
    await symlink(outside, join(output, ".babel-content"));
    await expect(createJobWorkspace(output, [output], "job_00000000-0000-4000-8000-000000000000")).rejects.toThrow("OUTPUT_NOT_AUTHORIZED");
    await expect(access(join(outside, "job_00000000-0000-4000-8000-000000000000"))).rejects.toThrow();
    const store = new JobStore(join(dir, "jobs"));
    const now = new Date().toISOString();
    const record: JobRecord = { id: "job_00000000-0000-4000-8000-000000000000", client_id: "alice", request: { target: { type: "url", url: "https://example.com/article" }, output: { directory: output } }, status: "downloading", stage: "downloading", created_at: now, updated_at: now, artifacts: [], completeness: { requested_components_complete: false, scope: "single_item" }, warnings: [], attempts: 1 };
    await store.put(record);
    const manager = new JobManager(store, { execute: async () => ({}) }, [{ id: "alice", token: "x", output_roots: [output] }]);
    await manager.init();
    expect((await manager.get("alice", record.id))?.error?.code).toBe("INTERRUPTED");
  });
});

describe("browser bridge", () => {
  it("requires configured extension Origin and bearer session, and verifies request nonce", async () => {
    const extensionId = "a".repeat(32);
    const config: RuntimeConfig = { schema_version: 1, port: 0, state_dir: await temp(), allowed_extension_ids: [extensionId], clients: [], fixture_origins: [] };
    const bridge = new BrowserBridge(config, registry);
    const server = createServer((req, res) => { void bridge.handle(req, res); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test listener");
    config.port = address.port;
    const base = `http://127.0.0.1:${address.port}`;
    const post = async (path: string, body: unknown, origin: string, token?: string) => await fetch(`${base}/v1/bridge/${path}`, { method: "POST", headers: { origin, "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    try {
      const reg = { version: 1, extension_id: extensionId, instance_id: "instance-test", extension_version: "0.1.0" };
      expect((await post("register", reg, "https://attacker.example")).status).toBe(403);
      const unpaired = await post("register", reg, `chrome-extension://${"b".repeat(32)}`);
      expect(unpaired.status).toBe(403);
      expect(unpaired.headers.get("access-control-allow-origin")).toBe(`chrome-extension://${"b".repeat(32)}`);
      expect((await unpaired.json() as { error: { code: string } }).error.code).toBe("PAIRING_NEEDED");
      const response = await post("register", reg, `chrome-extension://${extensionId}`);
      expect(response.status).toBe(200);
      const session = await response.json() as { session_id: string; token: string };
      expect((await post("poll", { version: 1, session_id: session.session_id }, `chrome-extension://${extensionId}`, "wrong")).status).toBe(401);
      const request: CollectRequest = { target: { type: "url", url: "https://example.com/article" }, browser: { tab_strategy: "new" }, limits: { max_related_items: 2 }, output: { directory: "/tmp" } };
      const capture = bridge.capture(request.target, request, new AbortController().signal, "job_00000000-0000-4000-8000-000000000000");
      const poll = await post("poll", { version: 1, session_id: session.session_id }, `chrome-extension://${extensionId}`, session.token);
      const commands = (await poll.json() as { commands: { request_id: string; nonce: string; session_id: string; request: { adapter_id: string; expected_origin: string; capture_mode: string; tab_strategy?: string; max_related_items?: number } }[] }).commands;
      expect(commands).toHaveLength(1);
      const command = commands[0]!;
      expect(command.request.tab_strategy).toBe("new");
      expect(command.request.max_related_items).toBe(2);
      const snapshot = {
        schema_version: "1", platform: "example", adapter_version: "1", source_url: "https://example.com/article", canonical_url: "https://example.com/article", content_type: "article", authors: [], published_at: null, blocks: [{ type: "paragraph", text: "hello" }], assets: [],
        relations: [{ type: "quote", from_content_id: "article", to_content_id: "quoted", order: 1, source_url: "https://example.com/quoted", authors: ["Quoted author"], published_at: null, content_type: "article", blocks: [{ type: "paragraph", text: "quoted text" }], assets: [], completeness: "unknown", evidence: ["relation:explicit_item_link"] }],
        access_class: "public_free", completeness: "unknown", warnings: [],
      };
      const bad = await post("respond", { version: 1, request_id: command.request_id, nonce: "bad", session_id: session.session_id, ok: true, result: { snapshot } }, `chrome-extension://${extensionId}`, session.token);
      expect(bad.status).toBe(400);
      const good = await post("respond", { version: 1, request_id: command.request_id, nonce: command.nonce, session_id: session.session_id, ok: true, result: { snapshot } }, `chrome-extension://${extensionId}`, session.token);
      expect(good.status).toBe(200);
      expect((await capture).blocks).toHaveLength(1);
      expect((await capture).relations?.[0]).toMatchObject({ type: "quote", to_content_id: "quoted" });
      const action = bridge.act(request.target, undefined, { type: "scroll", delta_y: 200 }, new AbortController().signal, "job_00000000-0000-4000-8000-000000000000");
      const actionRejected = expect(action).rejects.toMatchObject({ code: "BROWSER_ACTION_UNCONFIRMED" });
      const pollCommands = async (): Promise<typeof commands> => {
        const next = await post("poll", { version: 1, session_id: session.session_id }, `chrome-extension://${extensionId}`, session.token);
        return (await next.json() as { commands: typeof commands }).commands;
      };
      const [observeCommand] = await until(pollCommands, (items) => items.length > 0);
      expect(observeCommand?.request).toMatchObject({ adapter_id: "example", expected_origin: "https://example.com", capture_mode: "observe" });
      const observation = { instance_id: "instance-test", tab_id: 1, url: "https://example.com/article", title: "Article", origin: "https://example.com", adapter_id: "example", evidence: [] };
      expect((await post("respond", { version: 1, request_id: observeCommand!.request_id, nonce: observeCommand!.nonce, session_id: session.session_id, ok: true, result: { observation } }, `chrome-extension://${extensionId}`, session.token)).status).toBe(200);
      const [actCommand] = await until(pollCommands, (items) => items.length > 0);
      expect((await post("respond", { version: 1, request_id: actCommand!.request_id, nonce: actCommand!.nonce, session_id: session.session_id, ok: true, result: { action_applied: false } }, `chrome-extension://${extensionId}`, session.token)).status).toBe(200);
      await actionRejected;
      const otherRegistration = await post("register", { ...reg, instance_id: "instance-other" }, `chrome-extension://${extensionId}`);
      expect(otherRegistration.status).toBe(200);
      const otherSession = await otherRegistration.json() as { session_id: string; token: string };
      const tabTarget = { type: "tab" as const, instance_ref: "instance-test", tab_id: 5 };
      const discovery = bridge.observe(tabTarget, undefined, new AbortController().signal, "job_00000000-0000-4000-8000-000000000000");
      const otherPoll = await post("poll", { version: 1, session_id: otherSession.session_id }, `chrome-extension://${extensionId}`, otherSession.token);
      expect((await otherPoll.json() as { commands: unknown[] }).commands).toHaveLength(0);
      const [discoverCommand] = await until(pollCommands, (items) => items.length > 0);
      expect(discoverCommand?.request).toMatchObject({ adapter_id: "", expected_origin: "", capture_mode: "observe" });
      expect((await post("respond", { version: 1, request_id: discoverCommand!.request_id, nonce: discoverCommand!.nonce, session_id: session.session_id, ok: true, result: { observation: { ...observation, tab_id: 5 } } }, `chrome-extension://${extensionId}`, session.token)).status).toBe(200);
      expect((await discovery).tab_id).toBe(5);
    } finally { server.close(); }
  });

  it("accepts only legacy zero dimensions and immediately rejects matched malformed responses", async () => {
    const extensionId = "a".repeat(32);
    const config: RuntimeConfig = { schema_version: 1, port: 0, state_dir: await temp(), allowed_extension_ids: [extensionId], clients: [], fixture_origins: [] };
    const bridge = new BrowserBridge(config, registry);
    const server = createServer((req, res) => { void bridge.handle(req, res); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test listener");
    config.port = address.port;
    const origin = `chrome-extension://${extensionId}`;
    const post = async (path: string, body: unknown, token?: string) => fetch(`http://127.0.0.1:${config.port}/v1/bridge/${path}`, {
      method: "POST", headers: { origin, "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
    });
    const controller = new AbortController();
    try {
      const registered = await post("register", { version: 1, extension_id: extensionId, instance_id: "instance-test", extension_version: "0.1.2" });
      expect(registered.status).toBe(200);
      const session = await registered.json() as { session_id: string; token: string };
      const request: CollectRequest = { target: { type: "url", url: "https://example.com/article" }, output: { directory: "/tmp" } };
      const nextCommand = async () => {
        const polled = await post("poll", { version: 1, session_id: session.session_id }, session.token);
        expect(polled.status).toBe(200);
        const body = await polled.json() as { commands: { request_id: string; nonce: string }[] };
        expect(body.commands).toHaveLength(1);
        return body.commands[0]!;
      };
      const snapshot = {
        schema_version: "1", platform: "example", adapter_version: "1", source_url: "https://example.com/article", canonical_url: "https://example.com/article",
        platform_content_id: "article", content_type: "article", title: "Never echo page content", authors: [], published_at: null,
        blocks: [{ type: "image", asset_id: "image-1" }],
        assets: [{ id: "image-1", role: "image", url: "https://example.com/image.png?token=secret", order: 1, width: 0, height: 0, availability: "available" }],
        access_class: "public_free", completeness: "complete",
        completeness_proof: { version: 1, scope: "single_item", method: "adapter_bounded_dom", rule_id: completionRuleId, platform_content_id: "article", boundary: "terminal_observed", pending_marker_count: 0, ordered_asset_count: 1, unplaced_asset_count: 0,
          stability: { sample_count: 2, window_ms: 700, fingerprint: "a".repeat(64) } },
        warnings: [],
      };
      const capture = bridge.capture(request.target, request, controller.signal);
      const command = await nextCommand();
      const response = { version: 1, request_id: command.request_id, nonce: command.nonce, session_id: session.session_id, ok: true, result: { snapshot } };
      expect((await post("respond", { ...response, nonce: "wrong" }, session.token)).status).toBe(400);
      expect((await post("respond", response, session.token)).status).toBe(200);
      const accepted = await capture;
      expect(accepted.assets[0]).toMatchObject({ id: "image-1", role: "image" });
      expect(accepted.assets[0]).not.toHaveProperty("width");
      expect(accepted.assets[0]).not.toHaveProperty("height");

      const stabilityCapture = bridge.capture(request.target, request, controller.signal);
      const stabilityRejected = expect(stabilityCapture).rejects.toMatchObject({ code: "SNAPSHOT_INVALID", message: expect.stringContaining("STABILITY_PROOF_REQUIRED") });
      const stabilityCommand = await nextCommand();
      const { stability: _omittedStability, ...proofWithoutStability } = snapshot.completeness_proof;
      expect((await post("respond", { ...response, request_id: stabilityCommand.request_id, nonce: stabilityCommand.nonce,
        result: { snapshot: { ...snapshot, completeness_proof: proofWithoutStability } } }, session.token)).status).toBe(200);
      await stabilityRejected;

      const bareCapture = bridge.capture(request.target, request, controller.signal);
      const bareRejected = expect(bareCapture).rejects.toMatchObject({ code: "SNAPSHOT_INVALID", retryable: false });
      const bareCommand = await nextCommand();
      const { completeness_proof: _omittedProof, ...bareSnapshot } = snapshot;
      const bareResponse = await post("respond", { ...response, request_id: bareCommand.request_id, nonce: bareCommand.nonce, result: { snapshot: bareSnapshot } }, session.token);
      expect(bareResponse.status).toBe(400);
      expect(await bareResponse.json()).toMatchObject({ error: { code: "SNAPSHOT_INVALID" } });
      await bareRejected;

      const contentIdCapture = bridge.capture(request.target, request, controller.signal);
      const contentIdRejected = expect(contentIdCapture).rejects.toMatchObject({ code: "SNAPSHOT_INVALID", retryable: false });
      const contentIdCommand = await nextCommand();
      const contentIdResponse = await post("respond", { ...response, request_id: contentIdCommand.request_id, nonce: contentIdCommand.nonce,
        result: { snapshot: { ...snapshot, platform_content_id: "other-article" } } }, session.token);
      expect(contentIdResponse.status).toBe(400);
      expect(JSON.stringify(await contentIdResponse.json())).not.toContain("Never echo page content");
      await contentIdRejected;

      const versionCapture = bridge.capture(request.target, request, controller.signal);
      const versionRejected = expect(versionCapture).rejects.toMatchObject({ code: "SNAPSHOT_INVALID", message: expect.stringContaining("ADAPTER_VERSION_MISMATCH") });
      const versionCommand = await nextCommand();
      expect((await post("respond", { ...response, request_id: versionCommand.request_id, nonce: versionCommand.nonce,
        result: { snapshot: { ...snapshot, adapter_version: "old-version" } } }, session.token)).status).toBe(200);
      await versionRejected;

      const routeCapture = bridge.capture(request.target, request, controller.signal);
      const routeRejected = expect(routeCapture).rejects.toMatchObject({ code: "SNAPSHOT_INVALID", message: expect.stringContaining("COMPLETION_ROUTE_MISMATCH") });
      const routeCommand = await nextCommand();
      expect((await post("respond", { ...response, request_id: routeCommand.request_id, nonce: routeCommand.nonce,
        result: { snapshot: { ...snapshot, source_url: "https://example.com/other", canonical_url: "https://example.com/other" } } }, session.token)).status).toBe(200);
      await routeRejected;

      const malformedCapture = bridge.capture(request.target, request, controller.signal);
      const malformedRejected = expect(malformedCapture).rejects.toMatchObject({ code: "SNAPSHOT_INVALID", retryable: false });
      const malformedCommand = await nextCommand();
      const malformed = { ...response, request_id: malformedCommand.request_id, nonce: malformedCommand.nonce,
        result: { snapshot: { ...snapshot, assets: [{ ...snapshot.assets[0], width: -1 }] } } };
      expect((await post("respond", malformed, "wrong-token")).status).toBe(401);
      const invalidResponse = await post("respond", malformed, session.token);
      expect(invalidResponse.status).toBe(400);
      const invalidBody = await invalidResponse.json() as { error: { code: string; message: string } };
      expect(invalidBody.error).toMatchObject({ code: "SNAPSHOT_INVALID" });
      expect(invalidBody.error.message).toContain("response.result.snapshot.assets[0].width");
      expect(JSON.stringify(invalidBody)).not.toContain("secret");
      expect(JSON.stringify(invalidBody)).not.toContain("Never echo page content");
      await malformedRejected;

      const genericCapture = bridge.capture(request.target, request, controller.signal);
      const genericRejected = expect(genericCapture).rejects.toMatchObject({ code: "INVALID_RESPONSE", retryable: false });
      const genericCommand = await nextCommand();
      const generic = await post("respond", { ...response, request_id: genericCommand.request_id, nonce: genericCommand.nonce, ok: "yes" }, session.token);
      expect(generic.status).toBe(400);
      expect((await generic.json() as { error: { code: string } }).error.code).toBe("INVALID_RESPONSE");
      await genericRejected;
    } finally {
      controller.abort();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});

describe("MCP HTTP", () => {
  it("propagates client disconnect to a pending browser observation", async () => {
    const dir = await temp();
    const config: RuntimeConfig = { schema_version: 1, port: 0, state_dir: dir, allowed_extension_ids: [], clients: [{ id: "alice", token: "secret-token", output_roots: [dir] }], fixture_origins: [] };
    const bridge = new BrowserBridge(config, registry);
    let browserSignal: AbortSignal | undefined;
    bridge.observe = async (_target, _instance, signal) => {
      browserSignal = signal;
      await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
      throw new Error("unreachable");
    };
    const jobs = new JobManager(new JobStore(join(dir, "jobs")), { execute: async () => ({ status: "succeeded", completeness: { requested_components_complete: true, scope: "single_item" } }) }, config.clients);
    await jobs.init();
    const job = await jobs.submit("alice", { target: { type: "url", url: "https://example.com/article" }, output: { directory: dir } });
    // Finish the independent fixture job before the disconnect test can tear down its store.
    await until(() => jobs.get("alice", job.id), (value) => value?.status === "succeeded");
    const server = createRuntimeHttpServer(config, bridge, { bridge, jobs, registry });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test listener");
    config.port = address.port;
    const controller = new AbortController();
    try {
      const response = fetch(`http://127.0.0.1:${config.port}/mcp`, { method: "POST", signal: controller.signal,
        headers: { authorization: "Bearer secret-token", "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 77, method: "tools/call", params: { name: "babel_content_browser_observe", arguments: { job_id: job.id } } }),
      });
      await until(async () => browserSignal, (signal) => Boolean(signal));
      controller.abort();
      await response.catch(() => undefined);
      await until(async () => browserSignal?.aborted, (aborted) => aborted === true);
      expect(browserSignal?.aborted).toBe(true);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });

  it("requires a client token and exposes the eight scoped tools", async () => {
    const dir = await temp();
    const config: RuntimeConfig = { schema_version: 1, port: 0, state_dir: dir, allowed_extension_ids: [], clients: [{ id: "alice", token: "secret-token", output_roots: [dir] }], fixture_origins: [] };
    const bridge = new BrowserBridge(config, registry);
    const jobs = new JobManager(new JobStore(join(dir, "jobs")), { execute: async () => ({}) }, config.clients);
    await jobs.init();
    const server = createRuntimeHttpServer(config, bridge, { bridge, jobs, registry });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test listener");
    config.port = address.port;
    const endpoint = `http://127.0.0.1:${address.port}/mcp`;
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    try {
      const unauthorized = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body });
      expect(unauthorized.status).toBe(401);
      const deniedOrigin = await fetch(endpoint, { method: "POST", headers: { authorization: "Bearer secret-token", origin: "https://attacker.example", "content-type": "application/json", accept: "application/json" }, body });
      expect(deniedOrigin.status).toBe(403);
      const response = await fetch(endpoint, { method: "POST", headers: { authorization: "Bearer secret-token", "content-type": "application/json", accept: "application/json, text/event-stream" }, body });
      expect(response.status).toBe(200);
      const responseText = await response.text();
      const payload = response.headers.get("content-type")?.includes("text/event-stream") ? responseText.split(/\r?\n/).find((line) => line.startsWith("data: "))?.slice(6) : responseText;
      const value = JSON.parse(payload ?? "null") as { result?: { tools?: { name: string }[] } };
      expect(value.result?.tools?.map((tool) => tool.name)).toEqual([
        "babel_content_check", "babel_content_collect", "babel_content_job_get", "babel_content_job_resume", "babel_content_job_cancel", "babel_content_jobs_list", "babel_content_browser_observe", "babel_content_browser_act",
      ]);
      for (const [url, browserRequired] of [["https://example.org/articles/current", false], ["https://youtube.com/watch?v=sample", true]] as const) {
        const checked = await fetch(endpoint, { method: "POST", headers: { authorization: "Bearer secret-token", "content-type": "application/json", accept: "application/json, text/event-stream" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "babel_content_check", arguments: { target: { type: "url", url }, save_as: "document" } } }) });
        expect(checked.status).toBe(200);
        const raw = await checked.text();
        const message = checked.headers.get("content-type")?.includes("text/event-stream") ? raw.split(/\r?\n/).find(line => line.startsWith("data: "))?.slice(6) : raw;
        const result = JSON.parse(message ?? "null").result.structuredContent;
        expect(result.browser_required).toBe(browserRequired);
        expect(result.connection_state).toBe(browserRequired ? "waiting_browser" : "ready_http");
        if (!browserRequired) expect(result.adapter.id).toBe("web_page");
      }
    } finally { server.close(); }
  });
});
