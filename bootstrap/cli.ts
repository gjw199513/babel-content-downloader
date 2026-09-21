#!/usr/bin/env node
import { createInterface } from "node:readline";
import { mkdir, realpath } from "node:fs/promises";
import { resolve, join } from "node:path";
import { clientConfigStatus, installClientConfig, removeClientConfig, type McpClient } from "./client-setup.js";
import { installRuntimeService, runtimeServiceStatus, startRuntimeService, stopRuntimeService, uninstallRuntimeService } from "./runtime-service.js";
import { createAdapterRegistry } from "../adapters/registry.js";
import { createCollectionExecutor } from "../runtime/collection/collector.js";
import { BrowserBridge } from "../runtime/bridge/server.js";
import { probeMediaTool, type MediaToolId } from "../runtime/diagnostics/dependencies.js";
import { JobManager } from "../runtime/jobs/manager.js";
import { createRuntimeHttpServer, listenRuntime } from "../runtime/mcp/http.js";
import { proxyMcpStdio, type JsonRpcMessage } from "../runtime/mcp/stdio-proxy.js";
import { configPath, loadConfig, newClient, saveConfig } from "../runtime/policy/config.js";
import { JobStore } from "../runtime/storage/job-store.js";

async function serve(): Promise<void> {
  const config = await loadConfig();
  const registry = createAdapterRegistry({ fixture_origins: config.fixture_origins });
  const bridge = new BrowserBridge(config, registry, { enforceVersionMatch: true });
  const store = new JobStore(join(config.state_dir, "jobs"));
  const executor = createCollectionExecutor({ bridge, registry, config, mediaTools: { ytDlp: config.media_tools?.yt_dlp, ffmpeg: config.media_tools?.ffmpeg, ffprobe: config.media_tools?.ffprobe } });
  const jobs = new JobManager(store, executor, config.clients, 2, { checkpointRetentionDays: config.checkpoint_retention_days, logRetentionDays: config.log_retention_days });
  await jobs.init();
  const server = createRuntimeHttpServer(config, bridge, { jobs, bridge, registry, mediaTools: config.media_tools });
  await listenRuntime(server, config.port);
  console.error(`Babel Content Downloader runtime listening on 127.0.0.1:${config.port}`);
}

async function mcpProxy(clientId: string): Promise<void> {
  const config = await loadConfig();
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  await proxyMcpStdio({
    config,
    clientId,
    lines: input,
    write: (line) => process.stdout.write(line + "\n"),
    report: (message) => console.error(message),
    localRequest: async (message: JsonRpcMessage) => {
      if (message.method !== "tools/call" || !message.params || typeof message.params !== "object") return undefined;
      const params = message.params as { name?: unknown; arguments?: unknown };
      if (params.name !== "update_mcp") return undefined;
      if (message.id === undefined) return undefined;
      const options = { config, configPath: configPath() };
      const before = await runtimeServiceStatus(options);
      const after = await startRuntimeService(options);
      const value = {
        updated: before.restart_required,
        action: before.restart_required ? "runtime_restarted" : "already_current",
        installed_version: after.installed_version,
        applied_version: after.applied_version,
        running_version: after.running_version,
        restart_required: after.restart_required,
        state: after.state,
        health: after.health,
        next_action: after.next_action,
      };
      return JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [{ type: "text", text: JSON.stringify(value) }],
          structuredContent: value,
        },
      });
    },
  });
}

async function main(args: string[]): Promise<void> {
  const [command, ...rest] = args;
  if (command === "serve") return await serve();
  if (command === "mcp") {
    const id = rest[0];
    if (!id) throw new Error("Usage: babel-content-downloader mcp <client-id>");
    return await mcpProxy(id);
  }
  if (command === "asr") {
    const { ASR_CLI_USAGE, asrCliSummary, runAsrCli } = await import("../runtime/asr/cli.js");
    if (rest.includes("--help") || rest.includes("-h")) {
      console.log(ASR_CLI_USAGE);
      return;
    }
    console.log(JSON.stringify(asrCliSummary(await runAsrCli(rest)), null, 2));
    return;
  }
  if (command === "init") {
    const config = await loadConfig();
    await saveConfig(config);
    console.log("Babel Content Downloader runtime config initialized.");
    return;
  }
  if (["runtime-install", "runtime-update", "runtime-start", "runtime-status", "runtime-stop", "runtime-uninstall"].includes(command ?? "")) {
    if (rest.length !== 0) throw new Error(`Usage: babel-content-downloader ${command}`);
    const config = await loadConfig();
    const options = { config, configPath: configPath() };
    const status = command === "runtime-install" ? await installRuntimeService(options)
      : command === "runtime-update" ? await startRuntimeService(options)
      : command === "runtime-start" ? await startRuntimeService(options)
        : command === "runtime-stop" ? await stopRuntimeService(options)
          : command === "runtime-uninstall" ? await uninstallRuntimeService(options)
            : await runtimeServiceStatus(options);
    console.log(JSON.stringify(status, null, 2));
    return;
  }
  if (command === "allow-extension") {
    const id = rest[0];
    if (!id || !/^[a-p]{32}$/.test(id)) throw new Error("Expected a 32-character Chromium extension ID");
    const config = await loadConfig();
    if (!config.allowed_extension_ids.includes(id)) config.allowed_extension_ids.push(id);
    await saveConfig(config);
    console.log(`Authorized extension ${id}. Restart the runtime to apply configuration.`);
    return;
  }
  if (command === "revoke-extension") {
    const id = rest[0];
    if (rest.length !== 1 || !id || !/^[a-p]{32}$/.test(id)) throw new Error("Usage: babel-content-downloader revoke-extension <actual-32-character-extension-id>");
    const config = await loadConfig();
    config.allowed_extension_ids = config.allowed_extension_ids.filter((allowed) => allowed !== id);
    await saveConfig(config);
    console.log(`Revoked extension ${id}. Restart the runtime to terminate any existing bridge session.`);
    return;
  }
  if (command === "add-client") {
    const [id, root] = rest;
    if (!id || !root) throw new Error("Usage: babel-content-downloader add-client <client-id> <authorized-output-root>");
    await mkdir(resolve(root), { recursive: true });
    const actualRoot = await realpath(resolve(root));
    const config = await loadConfig();
    if (config.clients.some((client) => client.id === id)) throw new Error("CLIENT_ALREADY_EXISTS");
    config.clients.push(newClient(id, [actualRoot]));
    await saveConfig(config);
    console.log(`Registered client ${id} with output root ${actualRoot}. Use the local 'mcp ${id}' command in that client's MCP configuration. Restart runtime to apply.`);
    return;
  }
  if (command === "install-client-config" || command === "client-config-status" || command === "remove-client-config") {
    const [client, requestedId] = rest;
    if (rest.length < 1 || rest.length > 2 || (client !== "codex" && client !== "claude")) throw new Error(`Usage: babel-content-downloader ${command} <codex|claude> [client-id]`);
    const clientId = requestedId ?? client;
    const config = await loadConfig();
    if (command === "install-client-config" && !config.clients.some((grant) => grant.id === clientId)) throw new Error("CLIENT_NOT_AUTHORIZED: run add-client first");
    const options = { client: client as McpClient, clientId, stateDir: config.state_dir, runtimeConfigPath: configPath() };
    const status = command === "install-client-config" ? await installClientConfig(options)
      : command === "remove-client-config" ? await removeClientConfig(options) : await clientConfigStatus(options);
    console.log(JSON.stringify(status, null, 2));
    return;
  }
  if (command === "remove-client") {
    const id = rest[0];
    if (rest.length !== 1 || !id || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new Error("Usage: babel-content-downloader remove-client <client-id>");
    const config = await loadConfig();
    config.clients = config.clients.filter((grant) => grant.id !== id);
    await saveConfig(config);
    console.log(`Revoked client ${id}. Restart the runtime to apply; its existing jobs and files remain on disk.`);
    return;
  }
  if (command === "add-fixture-origin") {
    const value = rest[0];
    if (!value) throw new Error("Usage: babel-content-downloader add-fixture-origin <http-origin>");
    const url = new URL(value);
    if (url.origin !== value || url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("Fixture origin must be an exact local HTTP origin");
    const config = await loadConfig();
    if (!config.fixture_origins.includes(value)) config.fixture_origins.push(value);
    await saveConfig(config);
    console.log(`Authorized development fixture origin ${value}. Restart runtime to apply.`);
    return;
  }
  if (command === "set-dns") {
    const mode = rest[0];
    if (rest.length !== 1 || (mode !== "system" && mode !== "cloudflare")) throw new Error("Usage: babel-content-downloader set-dns <system|cloudflare>");
    const config = await loadConfig();
    config.dns_mode = mode;
    await saveConfig(config);
    console.log(`DNS mode set to ${mode}. Restart the runtime to apply configuration.`);
    return;
  }
  if (command === "set-retention") {
    const [kind, daysText] = rest;
    const days = Number(daysText);
    if (rest.length !== 2 || (kind !== "checkpoint" && kind !== "logs") || !Number.isInteger(days) || days < 1 || days > 3650) throw new Error("Usage: babel-content-downloader set-retention <checkpoint|logs> <days:1-3650>");
    const config = await loadConfig();
    if (kind === "checkpoint") config.checkpoint_retention_days = days;
    else config.log_retention_days = days;
    await saveConfig(config);
    console.log(`${kind} retention set to ${days} day(s). Restart the runtime to apply configuration.`);
    return;
  }
  if (command === "set-tool") {
    const [id, path] = rest;
    if (rest.length !== 2 || (id !== "yt-dlp" && id !== "ffmpeg" && id !== "ffprobe") || !path) throw new Error("Usage: babel-content-downloader set-tool <yt-dlp|ffmpeg|ffprobe> <absolute-executable-path>");
    const verified = await probeMediaTool(id as MediaToolId, path);
    const config = await loadConfig();
    config.media_tools = { ...config.media_tools, [id === "yt-dlp" ? "yt_dlp" : id]: verified.path };
    await saveConfig(config);
    console.log(`Configured ${id} at ${verified.path} (${verified.version}). Restart the runtime to apply configuration.`);
    return;
  }
  throw new Error("Usage: babel-content-downloader <init|runtime-install|runtime-update|runtime-start|runtime-status|runtime-stop|runtime-uninstall|allow-extension|revoke-extension|add-client|remove-client|install-client-config|client-config-status|remove-client-config|add-fixture-origin|set-dns|set-retention|set-tool|serve|mcp|asr>");
}

void main(process.argv.slice(2)).catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
