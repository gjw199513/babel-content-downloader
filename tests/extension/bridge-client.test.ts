import { describe, expect, it } from "vitest";
import { BridgeClient, type FetchLike } from "../../extension/background/bridge-client.js";
import type { ExtensionStorage, PersistedBridgeState } from "../../extension/background/storage.js";

function memoryStorage(initial: PersistedBridgeState): ExtensionStorage {
  let state = structuredClone(initial);
  return {
    readState: async () => structuredClone(state),
    writeState: async (next) => { state = structuredClone(next); },
    readOwnedTabs: async () => [],
    writeOwnedTabs: async () => undefined,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const identity = { extension_id: "a".repeat(32), extension_version: "0.1.0" };
const session = { version: 1 as const, session_id: "session-1", token: "test-token", poll_after_ms: 1000 };

describe("extension bridge client lifecycle", () => {
  it("reports the current extension version when reusing a stored session", async () => {
    const storage = memoryStorage({ instance_id: "instance-test", session, paused: false, action_receipts: [] });
    const requests: { path: string; body: unknown }[] = [];
    const fetcher: FetchLike = async (input, init) => {
      requests.push({ path: new URL(input).pathname, body: JSON.parse(String(init.body)) });
      return json({ version: 1, paused: false, commands: [], poll_after_ms: 1000 });
    };
    const client = new BridgeClient(storage, { ...identity, extension_version: "0.1.6" }, "http://127.0.0.1:4318", fetcher);

    await client.poll();

    expect(requests).toEqual([{
      path: "/v1/bridge/poll",
      body: { version: 1, session_id: session.session_id, extension_version: "0.1.6" },
    }]);
  });

  it("clears SESSION_UNAUTHORIZED and re-registers after runtime restart", async () => {
    const storage = memoryStorage({ instance_id: "instance-test", paused: false, action_receipts: [] });
    const paths: string[] = [];
    const fetcher: FetchLike = async (input) => {
      const path = new URL(input).pathname;
      paths.push(path);
      if (path.endsWith("register")) return json(session);
      if (paths.filter((item) => item.endsWith("poll")).length === 1) return json({ error: { code: "SESSION_UNAUTHORIZED" } }, 401);
      return json({ version: 1, paused: false, commands: [], poll_after_ms: 1000 });
    };
    const client = new BridgeClient(storage, identity, "http://127.0.0.1:4318", fetcher);
    await expect(client.poll()).rejects.toMatchObject({ code: "SESSION_UNAUTHORIZED" });
    expect((await storage.readState()).session).toBeUndefined();
    expect(await client.poll()).toMatchObject({ paused: false, commands: [] });
    expect(paths).toEqual(["/v1/bridge/register", "/v1/bridge/poll", "/v1/bridge/register", "/v1/bridge/poll"]);
  });

  it("keeps revoke paused until an explicit connect", async () => {
    const storage = memoryStorage({ instance_id: "instance-test", session, paused: false, action_receipts: [] });
    const paths: string[] = [];
    const fetcher: FetchLike = async (input) => {
      const path = new URL(input).pathname;
      paths.push(path);
      return path.endsWith("register") ? json(session) : json({ ok: true });
    };
    const client = new BridgeClient(storage, identity, "http://127.0.0.1:4318", fetcher);
    await client.revoke();
    expect(await client.poll()).toBeNull();
    expect((await storage.readState()).paused).toBe(true);
    expect((await storage.readState()).session).toBeUndefined();
    expect(paths).toEqual(["/v1/bridge/revoke"]);
    await client.register();
    expect((await storage.readState()).paused).toBe(false);
    expect(paths).toEqual(["/v1/bridge/revoke", "/v1/bridge/register"]);
  });

  it("bounds a stalled loopback request", async () => {
    const storage = memoryStorage({ instance_id: "instance-test", paused: false, action_receipts: [] });
    const stalled: FetchLike = async () => new Promise<Response>(() => undefined);
    const client = new BridgeClient(storage, identity, "http://127.0.0.1:4318", stalled, 10);
    await expect(client.register()).rejects.toMatchObject({ code: "BRIDGE_TIMEOUT" });
  });
});
