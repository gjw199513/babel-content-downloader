import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import type { AdapterDefinition, AdapterRegistry } from "../shared/contracts.js";
import type { BrowserObservation, BridgeResponse } from "../shared/bridge-protocol.js";
import { BrowserBridge } from "../runtime/bridge/server.js";
import { validateBridgeResponse } from "../runtime/bridge/validation.js";
import { publicObservation } from "../runtime/mcp/server.js";
import type { RuntimeConfig } from "../runtime/policy/config.js";

const extensionId = "a".repeat(32);
const target = { type: "url" as const, url: "https://medium.com/@reader/source-aaaaaaaa" };

const diagnosticAdapter: AdapterDefinition & {
  rule: {
    contentId: (url: URL) => string | null;
    dom_diagnostic: { id: string; applies: (url: URL) => boolean };
  };
} = {
  id: "medium",
  version: "test",
  hosts: ["medium.com"],
  content_types: ["article"],
  status: "experimental" as const,
  match: (url: URL) => url.hostname === "medium.com" && /^\/@reader\/source-[a-f0-9]{8}$/.test(url.pathname),
  rule: {
    contentId: (url: URL) => /-([a-f0-9]{8})$/i.exec(url.pathname)?.[1] ?? null,
    dom_diagnostic: {
      id: "medium.article.static-root.v1",
      applies: (url: URL) => /^\/@reader\/source-[a-f0-9]{8}$/.test(url.pathname),
    },
  },
};
const registry: AdapterRegistry = {
  match: (url) => diagnosticAdapter.match(url) ? diagnosticAdapter : undefined,
  list: () => [diagnosticAdapter],
};

function diagnostic(contentId = "aaaaaaaa") {
  return {
    version: 1 as const,
    plan_id: "medium.article.static-root.v1",
    platform_content_id: contentId,
    roots: [{ id: "article", visible_match_count: 1, count_truncated: false, selected: true }],
    unique_visible_root_count: 1,
    root_count_truncated: false,
    outline: { nodes: [{ node_index: 0, depth: 0, kinds: ["root" as const], tag: "article" }], truncated: false },
    truncated: false,
  };
}

function observation(contentId = "aaaaaaaa"): BrowserObservation {
  return {
    instance_id: "instance-diagnostic",
    tab_id: 1,
    url: target.url,
    title: "Source title",
    origin: "https://medium.com",
    adapter_id: "medium",
    access_class: "public_free",
    diagnostic: diagnostic(contentId),
    evidence: [],
  };
}

function response(value: BrowserObservation): BridgeResponse {
  return {
    version: 1,
    request_id: "11111111-1111-4111-8111-111111111111",
    nonce: "a".repeat(24),
    session_id: "22222222-2222-4222-8222-222222222222",
    ok: true,
    result: { observation: value },
  };
}

describe("bounded DOM diagnostic bridge contract", () => {
  it("rejects non-public outlines, invalid parent chains, and extra page-derived fields", () => {
    expect(validateBridgeResponse(response(observation())).ok).toBe(true);

    const nonPublic = response({ ...observation(), access_class: "unknown" });
    expect(validateBridgeResponse(nonPublic)).toMatchObject({ ok: false, code: "INVALID_RESPONSE", issue: "DIAGNOSTIC_OUTLINE_ACCESS" });

    const forwardParent = response(observation());
    forwardParent.result!.observation!.diagnostic!.outline!.nodes.push({
      node_index: 1,
      parent_node_index: 1,
      depth: 1,
      kinds: ["input"],
      tag: "input",
      input_type: "email",
    });
    expect(validateBridgeResponse(forwardParent)).toMatchObject({ ok: false, code: "INVALID_RESPONSE", issue: "DIAGNOSTIC_PARENT_INDEX_INVALID" });

    const extraField = response(observation()) as unknown as {
      result: { observation: { diagnostic: Record<string, unknown> } };
    };
    extraField.result.observation.diagnostic.text = "page-derived secret";
    const invalid = validateBridgeResponse(extraField);
    expect(invalid).toMatchObject({ ok: false, code: "INVALID_RESPONSE" });
    expect(JSON.stringify(invalid)).not.toContain("page-derived secret");
  });

  it("whitelists only schema-approved diagnostic fields for MCP presentation", () => {
    const unsafe = observation() as unknown as BrowserObservation & {
      diagnostic: NonNullable<BrowserObservation["diagnostic"]> & { text: string; href: string; data_private: string };
    };
    unsafe.diagnostic.text = "full source text";
    unsafe.diagnostic.href = "https://private.example/credential";
    unsafe.diagnostic.data_private = "do-not-expose";

    const presented = publicObservation(unsafe);
    const serialized = JSON.stringify(presented);
    expect(serialized).not.toContain("full source text");
    expect(serialized).not.toContain("private.example");
    expect(serialized).not.toContain("do-not-expose");
    expect(presented.diagnostic).toEqual(diagnostic());
  });

  it("binds a diagnostic content id to both the requested and observed source route", async () => {
    const config: RuntimeConfig = {
      schema_version: 1,
      port: 0,
      state_dir: "/tmp",
      allowed_extension_ids: [extensionId],
      clients: [],
      fixture_origins: [],
    };
    const bridge = new BrowserBridge(config, registry);
    const server = createServer((req, res) => { void bridge.handle(req, res); });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test listener unavailable");
    config.port = address.port;
    const origin = `chrome-extension://${extensionId}`;
    const post = async (path: string, body: unknown, token?: string) => await fetch(`http://127.0.0.1:${address.port}/v1/bridge/${path}`, {
      method: "POST",
      headers: { origin, "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    try {
      const registration = await post("register", { version: 1, extension_id: extensionId, instance_id: "instance-diagnostic", extension_version: "0.1.15" });
      expect(registration.status).toBe(200);
      const session = await registration.json() as { session_id: string; token: string };

      const pending = bridge.observe(target, "instance-diagnostic", new AbortController().signal, "job_11111111-1111-4111-8111-111111111111");
      const poll = await post("poll", { version: 1, session_id: session.session_id }, session.token);
      const [command] = (await poll.json() as { commands: { request_id: string; nonce: string }[] }).commands;
      if (!command) throw new Error("Expected observe command");
      const mismatchRejected = expect(pending).rejects.toMatchObject({ code: "OBSERVATION_DIAGNOSTIC_MISMATCH" });
      const mismatched = await post("respond", {
        version: 1,
        request_id: command.request_id,
        nonce: command.nonce,
        session_id: session.session_id,
        ok: true,
        result: { observation: observation("bbbbbbbb") },
      }, session.token);
      expect(mismatched.status).toBe(200);
      await mismatchRejected;

      const validPending = bridge.observe(target, "instance-diagnostic", new AbortController().signal, "job_22222222-2222-4222-8222-222222222222");
      const validPoll = await post("poll", { version: 1, session_id: session.session_id }, session.token);
      const [validCommand] = (await validPoll.json() as { commands: { request_id: string; nonce: string }[] }).commands;
      if (!validCommand) throw new Error("Expected second observe command");
      const matched = await post("respond", {
        version: 1,
        request_id: validCommand.request_id,
        nonce: validCommand.nonce,
        session_id: session.session_id,
        ok: true,
        result: { observation: observation() },
      }, session.token);
      expect(matched.status).toBe(200);
      await expect(validPending).resolves.toMatchObject({ diagnostic: { platform_content_id: "aaaaaaaa" } });
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
