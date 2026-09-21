import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { proxyMcpStdio } from "../runtime/mcp/stdio-proxy.js";
import type { RuntimeConfig } from "../runtime/policy/config.js";

const config: RuntimeConfig = {
  schema_version: 1, port: 4318, state_dir: "/unused", allowed_extension_ids: [], fixture_origins: [],
  clients: [{ id: "alice", token: "local-test-token", output_roots: ["/unused"] }],
};

function rpc(id: number, name: string): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: {} } });
}

function ok(id: number): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result: { content: [] } }), { headers: { "content-type": "application/json" } });
}

describe("stdio MCP proxy", () => {
  it("can apply the owned runtime update locally without forwarding the lifecycle tool", async () => {
    const output: string[] = [];
    const forwarded: string[] = [];
    await proxyMcpStdio({
      config,
      clientId: "alice",
      lines: Readable.from([rpc(9, "update_mcp"), rpc(10, "babel_content_check")]),
      write: (line) => { output.push(line); },
      localRequest: async (message) => message.method === "tools/call" && (message.params as { name?: unknown }).name === "update_mcp"
        ? JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: JSON.stringify({ action: "already_current" }) }] } })
        : undefined,
      fetcher: async (_url, init) => {
        forwarded.push(String(init.body));
        return ok(10);
      },
    });
    expect(output.map((line) => JSON.parse(line) as { id: number }).map((item) => item.id)).toEqual([9, 10]);
    expect(forwarded).toHaveLength(1);
    expect(JSON.parse(forwarded[0]!).params.name).toBe("babel_content_check");
  });

  it("lets job_cancel finish while an earlier browser observation is pending", async () => {
    let releaseSlow!: (value: Response) => void;
    const slow = new Promise<Response>((resolve) => { releaseSlow = resolve; });
    const output: string[] = [];
    const run = proxyMcpStdio({
      config, clientId: "alice", lines: Readable.from([rpc(1, "babel_content_browser_observe"), rpc(2, "babel_content_job_cancel")]),
      write: (line) => { output.push(line); },
      fetcher: async (_url, init) => {
        const request = JSON.parse(String(init.body)) as { id: number };
        expect((init.headers as Record<string, string>).authorization).toBe("Bearer local-test-token");
        return request.id === 1 ? slow : ok(request.id);
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(output.map((line) => JSON.parse(line) as { id: number }).map((item) => item.id)).toEqual([2]);
    releaseSlow(ok(1));
    await run;
    expect(output.map((line) => JSON.parse(line) as { id: number }).map((item) => item.id)).toEqual([2, 1]);
  });

  it("turns notifications/cancelled into an abort of the matching HTTP request", async () => {
    const output: string[] = [];
    let aborted = false;
    await proxyMcpStdio({
      config, clientId: "alice", lines: Readable.from([rpc(7, "babel_content_browser_observe"), JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 7 } })]),
      write: (line) => { output.push(line); },
      fetcher: async (_url, init) => await new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); }, { once: true });
      }),
    });
    expect(aborted).toBe(true);
    expect(output.map((line) => JSON.parse(line))).toEqual([{ jsonrpc: "2.0", id: 7, error: { code: -32800, message: "Request cancelled" } }]);
  });
});
