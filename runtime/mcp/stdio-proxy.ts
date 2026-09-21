import type { RuntimeConfig } from "../policy/config.js";

type RequestId = string | number | null;
type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

export interface JsonRpcMessage {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

export interface StdioProxyOptions {
  config: RuntimeConfig;
  clientId: string;
  lines: AsyncIterable<string>;
  write: (line: string) => void;
  report?: (message: string) => void;
  fetcher?: Fetcher;
  /** Handles local lifecycle tools without forwarding them to the runtime HTTP process. */
  localRequest?: (message: JsonRpcMessage) => Promise<string | undefined>;
}

function requestId(value: unknown): value is RequestId {
  return value === null || typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}

function key(id: RequestId): string { return `${typeof id}:${String(id)}`; }

function error(id: RequestId, code: number, message: string): string {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
}

/** Concurrent JSON-RPC forwarding keeps job_cancel responsive during a slow browser observation. */
export async function proxyMcpStdio(options: StdioProxyOptions): Promise<void> {
  const client = options.config.clients.find((item) => item.id === options.clientId);
  if (!client) throw new Error("CLIENT_NOT_REGISTERED");
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  const pending = new Set<Promise<void>>();
  const controllers = new Map<string, AbortController>();

  async function forward(line: string, id: RequestId | undefined, controller: AbortController): Promise<void> {
    try {
      const response = await fetcher(`http://127.0.0.1:${options.config.port}/mcp`, {
        method: "POST",
        headers: { authorization: `Bearer ${client!.token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: line,
        signal: controller.signal,
      });
      if (response.status === 202 || response.status === 204) return;
      const body = await response.text();
      if (!response.ok) throw new Error(`Runtime HTTP ${response.status}`);
      if (!body) return;
      if (response.headers.get("content-type")?.includes("text/event-stream")) {
        for (const eventLine of body.split(/\r?\n/)) if (eventLine.startsWith("data: ")) options.write(eventLine.slice(6));
      } else options.write(JSON.stringify(JSON.parse(body)));
    } catch {
      if (id !== undefined) options.write(error(id, controller.signal.aborted ? -32800 : -32603,
        controller.signal.aborted ? "Request cancelled" : "Local runtime unavailable or request failed"));
      else options.report?.("Local runtime notification failed");
    } finally {
      if (id !== undefined) controllers.delete(key(id));
    }
  }

  for await (const line of options.lines) {
    if (!line.trim()) continue;
    let message: JsonRpcMessage;
    try { message = JSON.parse(line) as JsonRpcMessage; }
    catch { options.write(error(null, -32700, "Invalid JSON-RPC JSON")); continue; }
    if (!message || typeof message !== "object" || message.jsonrpc !== "2.0" || (message.id !== undefined && !requestId(message.id))) {
      options.write(error(null, -32600, "Invalid JSON-RPC message"));
      continue;
    }
    if (message.method === "notifications/cancelled") {
      const params = message.params && typeof message.params === "object" ? message.params as { requestId?: unknown } : undefined;
      if (requestId(params?.requestId)) controllers.get(key(params!.requestId))?.abort();
      continue;
    }
    const id = message.id as RequestId | undefined;
    if (id !== undefined && controllers.has(key(id))) {
      options.write(error(id, -32600, "Duplicate in-flight request ID"));
      continue;
    }
    if (options.localRequest) {
      try {
        const localResponse = await options.localRequest(message);
        if (localResponse !== undefined) {
          options.write(localResponse);
          continue;
        }
      } catch (caught) {
        if (id !== undefined) options.write(error(id, -32603, caught instanceof Error ? caught.message : "Local MCP lifecycle operation failed"));
        else options.report?.("Local MCP lifecycle operation failed");
        continue;
      }
    }
    const controller = new AbortController();
    if (id !== undefined) controllers.set(key(id), controller);
    const task = forward(line, id, controller);
    pending.add(task);
    void task.finally(() => { pending.delete(task); });
  }
  await Promise.allSettled([...pending]);
}
