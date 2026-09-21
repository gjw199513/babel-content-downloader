import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdapterDefinition, AdapterRegistry } from "../shared/contracts.js";
import { BrowserBridge } from "../runtime/bridge/server.js";
import type { RuntimeConfig } from "../runtime/policy/config.js";

const extensionId = "a".repeat(32);
const adapter: AdapterDefinition = { id: "example", version: "1", hosts: ["example.com"], content_types: ["article"], status: "experimental", match: url => url.hostname === "example.com" };
const registry: AdapterRegistry = { match: url => adapter.match(url) ? adapter : undefined, list: () => [adapter] };
const target = { type: "url" as const, url: "https://example.com/article" };
type TestSession = { session_id: string; token: string };

afterEach(() => vi.restoreAllMocks());

async function setup() {
  const config: RuntimeConfig = { schema_version: 1, port: 0, state_dir: tmpdir(), allowed_extension_ids: [extensionId], clients: [], fixture_origins: [] };
  const bridge = new BrowserBridge(config, registry);
  const server = createServer((req, res) => { void bridge.handle(req, res); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test listener unavailable");
  config.port = address.port;
  const request = async (path: string, body: unknown, token?: string) => await fetch(`http://127.0.0.1:${config.port}/v1/bridge/${path}`, { method: "POST", headers: { origin: `chrome-extension://${extensionId}`, "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const post = async (path: string, body: unknown, token?: string) => {
    const response = await request(path, body, token);
    expect(response.status).toBe(200);
    return await response.json();
  };
  return {
    bridge,
    request,
    register: async (id: string, extensionVersion = "0.1.4") => await post("register", { version: 1, extension_id: extensionId, instance_id: id, extension_version: extensionVersion }) as TestSession,
    update: async (path: string, session: TestSession) => await post(path, { session_id: session.session_id }, session.token),
    close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); },
  };
}

async function selectedThenCancelled(bridge: BrowserBridge, instance?: string): Promise<void> {
  const controller = new AbortController();
  const pending = bridge.observe(target, instance, controller.signal);
  controller.abort();
  await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
}

describe("browser instance connection status", () => {
  it("refreshes authenticated version metadata without replacing the session or pending command", async () => {
    const { bridge, register, request, close } = await setup();
    try {
      const session = await register("instance-version", "0.1.5");
      const pending = bridge.observe(target, "instance-version", new AbortController().signal, "job_00000000-0000-4000-8000-000000000001");
      const poll = await request("poll", { version: 1, session_id: session.session_id, extension_version: "0.1.6" }, session.token);
      expect(poll.status).toBe(200);
      const polled = await poll.json() as { paused: boolean; commands: { request_id: string; nonce: string; session_id: string }[] };
      expect(polled).toMatchObject({ paused: false });
      expect(polled.commands).toHaveLength(1);
      expect(polled.commands[0]?.session_id).toBe(session.session_id);
      expect(bridge.status()).toMatchObject({ instances: [{ instance_ref: "instance-version", version: "0.1.6", paused: false }] });

      const command = polled.commands[0]!;
      const observation = { instance_id: "instance-version", tab_id: 1, url: target.url, title: "Article", origin: "https://example.com", adapter_id: "example", evidence: [] };
      const responded = await request("respond", { version: 1, request_id: command.request_id, nonce: command.nonce, session_id: session.session_id, ok: true, result: { observation } }, session.token);
      expect(responded.status).toBe(200);
      await expect(pending).resolves.toMatchObject({ instance_id: "instance-version", tab_id: 1 });

      expect((await request("pause", { version: 1, session_id: session.session_id }, session.token)).status).toBe(200);
      const pausedPoll = await request("poll", { version: 1, session_id: session.session_id, extension_version: "0.1.6" }, session.token);
      expect(pausedPoll.status).toBe(200);
      expect(await pausedPoll.json()).toMatchObject({ paused: true, commands: [] });
      expect(bridge.status()).toMatchObject({ instances: [{ version: "0.1.6", paused: true }] });

      const legacyPoll = await request("poll", { version: 1, session_id: session.session_id }, session.token);
      expect(legacyPoll.status).toBe(200);
      expect(await legacyPoll.json()).toMatchObject({ paused: true, commands: [] });
      expect(bridge.status()).toMatchObject({ instances: [{ version: "0.1.6", paused: true }] });

      expect((await request("poll", { version: 1, session_id: session.session_id, extension_version: "9.9.9" }, "wrong-token")).status).toBe(401);
      const wrongSession = await request("poll", { version: 1, session_id: "wrong-session", extension_version: "9.9.9" }, session.token);
      expect(wrongSession.status).toBe(400);
      expect(await wrongSession.json()).toMatchObject({ error: { code: "SESSION_MISMATCH" } });
      expect(bridge.status()).toMatchObject({ instances: [{ version: "0.1.6", paused: true }] });
    } finally { await close(); }
  });

  it("rejects malformed heartbeat versions without changing metadata or consuming queued work", async () => {
    const { bridge, register, request, close } = await setup();
    const controller = new AbortController();
    try {
      const session = await register("instance-invalid-version", "0.1.5");
      const pending = bridge.observe(target, "instance-invalid-version", controller.signal, "job_00000000-0000-4000-8000-000000000002");
      for (const extensionVersion of [null, "", "   ", "x".repeat(41), "0.1.6\nforged", 6]) {
        const response = await request("poll", { version: 1, session_id: session.session_id, extension_version: extensionVersion }, session.token);
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ error: { code: "INVALID_POLL" } });
        expect(bridge.status()).toMatchObject({ instances: [{ version: "0.1.5", paused: false }] });
      }

      const legacyPoll = await request("poll", { version: 1, session_id: session.session_id }, session.token);
      expect(legacyPoll.status).toBe(200);
      expect((await legacyPoll.json() as { commands: unknown[] }).commands).toHaveLength(1);
      expect(bridge.status()).toMatchObject({ instances: [{ version: "0.1.5", paused: false }] });
      controller.abort();
      await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    } finally { controller.abort(); await close(); }
  });

  it("reports the same heartbeat boundary that command routing uses", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { bridge, register, close } = await setup();
    try {
      await register("instance-boundary");
      now += 89_750;
      expect(bridge.status()).toMatchObject({ connected: true, instances: [{ instance_ref: "instance-boundary", connected: true, state: "connected", seconds_since_seen: 89 }] });
      await selectedThenCancelled(bridge, "instance-boundary");
      now += 250;
      expect(bridge.status()).toMatchObject({ connected: false, instances: [{ connected: false, state: "disconnected", seconds_since_seen: 90 }] });
      await expect(bridge.observe(target, "instance-boundary", new AbortController().signal)).rejects.toMatchObject({ code: "BROWSER_DISCONNECTED" });
    } finally { await close(); }
  });

  it("keeps stale bindings disconnected while identifying paused and live instances", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { bridge, register, update, close } = await setup();
    try {
      const old = await register("instance-old");
      now += 90_000;
      const fresh = await register("instance-fresh");
      expect(bridge.status()).toMatchObject({ connected: true, instances: [{ instance_ref: "instance-old", connected: false, state: "disconnected" }, { instance_ref: "instance-fresh", connected: true, state: "connected" }] });
      await expect(bridge.observe(target, "instance-old", new AbortController().signal)).rejects.toMatchObject({ code: "BROWSER_DISCONNECTED" });
      await selectedThenCancelled(bridge);
      await update("pause", fresh);
      expect(bridge.status()).toMatchObject({ connected: false, instances: [{ state: "disconnected" }, { connected: false, state: "paused", paused: true }] });
      await expect(bridge.observe(target, "instance-fresh", new AbortController().signal)).rejects.toMatchObject({ code: "BROWSER_DISCONNECTED" });
      await update("poll", old);
      expect(bridge.status()).toMatchObject({ connected: true, instances: [{ connected: true, state: "connected" }, { connected: false, state: "paused" }] });
      await selectedThenCancelled(bridge);
      await update("resume", fresh);
      await expect(bridge.observe(target, undefined, new AbortController().signal)).rejects.toMatchObject({ code: "BROWSER_AMBIGUOUS" });
      await selectedThenCancelled(bridge, "instance-fresh");
    } finally { await close(); }
  });
});
