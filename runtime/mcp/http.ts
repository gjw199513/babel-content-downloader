import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { toNodeHandler } from "@modelcontextprotocol/node";
import type { RuntimeConfig, ClientGrant } from "../policy/config.js";
import type { BrowserBridge } from "../bridge/server.js";
import { makeMcpHandler, type McpServices } from "./server.js";

function equal(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function clientFor(req: IncomingMessage, config: RuntimeConfig): ClientGrant | undefined {
  const token = req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]+)$/)?.[1];
  return token ? config.clients.find((client) => equal(token, client.token)) : undefined;
}

function error(res: ServerResponse, status: number, code: string): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify({ error: { code } }));
}

export function createRuntimeHttpServer(config: RuntimeConfig, bridge: BrowserBridge, services: McpServices): Server {
  const handler = makeMcpHandler(services);
  const nodeHandler = toNodeHandler(handler);
  const server = createServer((req, res) => {
    const host = req.headers.host;
    if (host !== `127.0.0.1:${config.port}` && host !== `localhost:${config.port}`) return error(res, 403, "HOST_DENIED");
    if (req.url?.startsWith("/v1/bridge/")) { void bridge.handle(req, res); return; }
    if (req.url?.split("?")[0] !== "/mcp") return error(res, 404, "NOT_FOUND");
    const origin = req.headers.origin;
    if (origin && origin !== `http://127.0.0.1:${config.port}` && origin !== `http://localhost:${config.port}`) return error(res, 403, "ORIGIN_DENIED");
    const client = clientFor(req, config);
    if (!client) return error(res, 401, "CLIENT_UNAUTHORIZED");
    (req as IncomingMessage & { auth: { token: string; clientId: string; scopes: string[] } }).auth = { token: client.token, clientId: client.id, scopes: ["content:read", "content:collect"] };
    void nodeHandler(req, res);
  });
  server.on("close", () => { void handler.close(); });
  return server;
}

export async function listenRuntime(server: Server, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
}
