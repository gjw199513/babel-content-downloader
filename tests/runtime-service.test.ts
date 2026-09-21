import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  RUNTIME_SERVICE_LABEL,
  installRuntimeService,
  probeRuntimeHealth,
  runtimeServiceStatus,
  startRuntimeService,
  stopRuntimeService,
  uninstallRuntimeService,
  type RuntimeServiceOptions,
} from "../bootstrap/runtime-service.js";
import { proxyMcpStdio } from "../runtime/mcp/stdio-proxy.js";
import { newConfig, saveConfig, type RuntimeConfig } from "../runtime/policy/config.js";

const temporaryDirectories: string[] = [];
afterEach(async () => { await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

interface LaunchFixture {
  loaded: boolean;
  running: boolean;
  foreign: boolean;
  pid: number;
  calls: string[][];
  timeouts: Array<number | undefined>;
  run: NonNullable<RuntimeServiceOptions["runCommand"]>;
}

function launchFixture(expected: { plist: string; node: string; cli: string }): LaunchFixture {
  const fixture: LaunchFixture = {
    loaded: false, running: false, foreign: false, pid: 4000, calls: [], timeouts: [],
    run: async (_file, args, timeoutMs) => {
      fixture.calls.push(args);
      fixture.timeouts.push(timeoutMs);
      if (args[0] === "print") {
        if (!fixture.loaded) return { code: 3, stdout: "", stderr: "not found", failedToStart: false, timedOut: false };
        const path = fixture.foreign ? "/tmp/foreign.plist" : expected.plist;
        const node = fixture.foreign ? "/tmp/foreign-node" : expected.node;
        const cli = fixture.foreign ? "/tmp/foreign-cli.js" : expected.cli;
        return { code: 0, stderr: "", failedToStart: false, timedOut: false, stdout: `gui/501/${RUNTIME_SERVICE_LABEL} = {
  path = ${path}
  state = ${fixture.running ? "running" : "exited"}
  program = ${node}
  arguments = {
    ${node}
    ${cli}
    serve
  }
  pid = ${fixture.pid}
}\n` };
      }
      if (args[0] === "bootstrap") {
        fixture.loaded = true; fixture.running = true; fixture.pid += 1;
        return { code: 0, stdout: "", stderr: "", failedToStart: false, timedOut: false };
      }
      if (args[0] === "kickstart") {
        fixture.loaded = true; fixture.running = true; fixture.pid += 1;
        return { code: 0, stdout: "", stderr: "", failedToStart: false, timedOut: false };
      }
      if (args[0] === "bootout") {
        fixture.loaded = false; fixture.running = false;
        return { code: 0, stdout: "", stderr: "", failedToStart: false, timedOut: false };
      }
      return { code: 2, stdout: "", stderr: "unsupported fixture command", failedToStart: false, timedOut: false };
    },
  };
  return fixture;
}

async function serviceFixture(port = 4318): Promise<{ root: string; config: RuntimeConfig; configPath: string; cliPath: string; plistPath: string; receiptPath: string; launch: LaunchFixture; clock: { value: number }; options: RuntimeServiceOptions }> {
  const root = await mkdtemp(join(tmpdir(), "babel-runtime-service-")); temporaryDirectories.push(root);
  const configPath = join(root, "operator config", "config.json");
  const cliPath = join(root, "installed package", "dist", "bootstrap", "cli.js");
  const launchAgentDirectory = join(root, "Library", "LaunchAgents");
  const plistPath = join(launchAgentDirectory, `${RUNTIME_SERVICE_LABEL}.plist`);
  const receiptPath = join(root, "operator config", "babel-content-downloader-runtime-service.json");
  await mkdir(join(root, "installed package", "dist", "bootstrap"), { recursive: true });
  await writeFile(cliPath, "// compiled CLI fixture\n");
  const config = newConfig();
  config.port = port;
  config.state_dir = join(root, "runtime state");
  config.clients = [
    { id: "codex", token: "codex-secret-token", output_roots: [join(root, "output")] },
    { id: "claude", token: "claude-secret-token", output_roots: [join(root, "output")] },
  ];
  await saveConfig(config, configPath);
  await chmod(configPath, 0o600);
  const launch = launchFixture({ plist: plistPath, node: process.execPath, cli: cliPath });
  const clock = { value: 0 };
  const options: RuntimeServiceOptions = {
    config, configPath, platform: "darwin", uid: process.getuid!(), launchAgentDirectory,
    nodePath: process.execPath, cliPath, launchctlPath: join(root, "fake-launchctl"), runCommand: launch.run,
    runtimeVersion: "fixture-1.0.0", checkPortAvailable: async () => true,
    probeHealth: async () => ({ ready: true, reason: "ready", version: String(options.runtimeVersion) }),
    wait: async (milliseconds) => { clock.value += milliseconds; }, now: () => clock.value,
  };
  return { root, config, configPath, cliPath, plistPath, receiptPath, launch, clock, options };
}

describe("managed macOS runtime service", () => {
  it("installs one exact private LaunchAgent, survives stop/start, and removes only its service files", async () => {
    const fixture = await serviceFixture();
    const userJob = join(fixture.config.state_dir, "jobs", "user-job.json");
    await mkdir(join(fixture.config.state_dir, "jobs"), { recursive: true });
    await writeFile(userJob, "user-owned persisted job\n");

    const installed = await installRuntimeService(fixture.options);
    expect(installed).toMatchObject({ state: "running", health: "ready", loaded: true, restart_required: false });
    const plist = await readFile(fixture.plistPath, "utf8");
    expect(plist).toContain(`<string>${process.execPath}</string>`);
    expect(plist).toContain(`<string>${fixture.cliPath}</string>`);
    expect(plist).toContain(`<key>BABEL_CONTENT_CONFIG</key><string>${fixture.configPath}</string>`);
    expect(plist).toContain("<key>RunAtLoad</key><true/>");
    expect(plist).toContain("<key>KeepAlive</key><true/>");
    expect(plist).toContain("<key>ThrottleInterval</key><integer>10</integer>");
    expect(plist).not.toContain("codex-secret-token");
    expect((await stat(fixture.plistPath)).mode & 0o777).toBe(0o600);
    expect((await stat(fixture.receiptPath)).mode & 0o777).toBe(0o600);
    expect(await readFile(fixture.receiptPath, "utf8")).not.toContain("codex-secret-token");
    const serviceLog = join(fixture.config.state_dir, "runtime-service", "operator-note.log");
    await writeFile(serviceLog, "retained lifecycle log\n");

    const bootstraps = fixture.launch.calls.filter((args) => args[0] === "bootstrap").length;
    expect((await installRuntimeService(fixture.options)).state).toBe("running");
    expect(fixture.launch.calls.filter((args) => args[0] === "bootstrap")).toHaveLength(bootstraps);

    expect((await stopRuntimeService(fixture.options)).state).toBe("stopped");
    expect(await readFile(userJob, "utf8")).toBe("user-owned persisted job\n");
    expect((await startRuntimeService(fixture.options)).state).toBe("running");
    expect((await uninstallRuntimeService(fixture.options)).state).toBe("uninstalled");
    await expect(stat(fixture.plistPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(fixture.receiptPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(fixture.configPath, "utf8")).toContain('"schema_version": 1');
    expect(await readFile(userJob, "utf8")).toBe("user-owned persisted job\n");
    expect(await readFile(serviceLog, "utf8")).toBe("retained lifecycle log\n");
  });

  it("reports config changes as restart-required without losing stop or uninstall ownership", async () => {
    const fixture = await serviceFixture();
    await installRuntimeService(fixture.options);
    fixture.config.dns_mode = "cloudflare";
    await saveConfig(fixture.config, fixture.configPath);
    const changed = await runtimeServiceStatus(fixture.options);
    expect(changed).toMatchObject({ state: "running", health: "restart_required", restart_required: true });
    expect((await stopRuntimeService(fixture.options)).state).toBe("stopped");
    expect((await uninstallRuntimeService(fixture.options)).state).toBe("uninstalled");
  });

  it("refuses a changed plist or a foreign loaded label without stopping either", async () => {
    const fixture = await serviceFixture();
    await installRuntimeService(fixture.options);
    await writeFile(fixture.plistPath, `${await readFile(fixture.plistPath, "utf8")}<!-- changed -->\n`);
    expect((await runtimeServiceStatus(fixture.options)).state).toBe("configuration_changed");
    await expect(stopRuntimeService(fixture.options)).rejects.toThrow("RUNTIME_SERVICE_OWNERSHIP_CONFLICT");
    await expect(uninstallRuntimeService(fixture.options)).rejects.toThrow("RUNTIME_SERVICE_OWNERSHIP_CONFLICT");
    expect(fixture.launch.calls.filter((args) => args[0] === "bootout")).toHaveLength(0);

    const foreign = await serviceFixture();
    foreign.launch.loaded = true; foreign.launch.running = true; foreign.launch.foreign = true;
    expect((await runtimeServiceStatus(foreign.options)).state).toBe("configuration_changed");
    await expect(installRuntimeService(foreign.options)).rejects.toThrow("RUNTIME_SERVICE_OWNERSHIP_CONFLICT");
    expect(foreign.launch.calls.filter((args) => args[0] === "bootout")).toHaveLength(0);
  });

  it("rejects an occupied loopback port and leaves the unrelated listener running", async () => {
    const listener = createNetServer();
    await new Promise<void>((resolveListen, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", resolveListen); });
    const port = (listener.address() as AddressInfo).port;
    try {
      const fixture = await serviceFixture(port);
      delete fixture.options.checkPortAvailable;
      await expect(installRuntimeService(fixture.options)).rejects.toThrow("RUNTIME_SERVICE_PORT_IN_USE");
      expect(listener.listening).toBe(true);
      expect(fixture.launch.calls.filter((args) => args[0] === "bootout")).toHaveLength(0);
      await expect(stat(fixture.plistPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await new Promise<void>((resolveClose) => listener.close(() => resolveClose()));
    }
  });

  it("distinguishes launchd acceptance from authenticated MCP readiness", async () => {
    const fixture = await serviceFixture();
    fixture.options.probeHealth = async () => ({ ready: false, reason: "unexpected_response" });
    await expect(installRuntimeService(fixture.options)).rejects.toThrow("RUNTIME_SERVICE_HEALTH_FAILED_UNEXPECTED_RESPONSE");
    expect(fixture.launch.calls.some((args) => args[0] === "bootstrap")).toBe(true);
    expect(fixture.launch.calls.some((args) => args[0] === "bootout")).toBe(true);
    expect((await runtimeServiceStatus(fixture.options)).state).toBe("stopped");
  });

  it("restarts an owned healthy process when the installed runtime version changes", async () => {
    const fixture = await serviceFixture();
    await installRuntimeService(fixture.options);
    const firstPid = fixture.launch.pid;
    fixture.options.runtimeVersion = "fixture-1.1.0";
    expect((await runtimeServiceStatus(fixture.options))).toMatchObject({ state: "running", health: "restart_required", restart_required: true });
    expect((await startRuntimeService(fixture.options))).toMatchObject({ state: "running", health: "ready", restart_required: false });
    expect(fixture.launch.pid).toBeGreaterThan(firstPid);
    expect(fixture.launch.calls.some((args) => args[0] === "kickstart" && args[1] === "-k")).toBe(true);
    fixture.options.probeHealth = async () => ({ ready: true, reason: "ready", version: "fixture-1.0.0" });
    expect((await runtimeServiceStatus(fixture.options))).toMatchObject({ state: "running", health: "restart_required", restart_required: true });
  });

  it("uses one real deadline across slow readiness probes", async () => {
    const fixture = await serviceFixture();
    const probeTimeouts: number[] = [];
    fixture.options.probeHealth = async (_config, timeoutMs = 0) => {
      probeTimeouts.push(timeoutMs);
      fixture.clock.value += Math.min(1_600, timeoutMs);
      return { ready: false, reason: "unreachable" };
    };
    await expect(installRuntimeService(fixture.options)).rejects.toThrow("RUNTIME_SERVICE_HEALTH_FAILED_UNREACHABLE");
    expect(fixture.clock.value).toBeLessThanOrEqual(15_000);
    expect(probeTimeouts.length).toBeLessThanOrEqual(10);
    expect(probeTimeouts.every((value) => value > 0 && value <= 15_000)).toBe(true);
    const boundedLaunchCalls = fixture.launch.timeouts.filter((value): value is number => value !== undefined && value <= 15_000);
    expect(boundedLaunchCalls.length).toBeGreaterThan(0);
  });

  it("does not record a config that changes while the service is starting", async () => {
    const fixture = await serviceFixture();
    let changed = false;
    fixture.options.probeHealth = async () => {
      if (!changed) {
        changed = true;
        fixture.config.dns_mode = "cloudflare";
        await saveConfig(fixture.config, fixture.configPath);
      }
      return { ready: true, reason: "ready", version: "fixture-1.0.0" };
    };
    await expect(installRuntimeService(fixture.options)).rejects.toThrow("RUNTIME_SERVICE_CONFIG_CHANGED_DURING_START");
    expect(fixture.launch.calls.some((args) => args[0] === "bootout")).toBe(true);
    expect((await runtimeServiceStatus(fixture.options))).toMatchObject({ state: "stopped", restart_required: true });
  });

  it("returns an explicit unsupported state without invoking launchctl", async () => {
    const fixture = await serviceFixture();
    const status = await runtimeServiceStatus({ ...fixture.options, platform: "linux" });
    expect(status).toMatchObject({ supported: false, state: "unsupported", health: "not_applicable" });
    expect(fixture.launch.calls).toHaveLength(0);
    await expect(installRuntimeService({ ...fixture.options, platform: "linux" })).rejects.toThrow("RUNTIME_SERVICE_UNSUPPORTED_PLATFORM");
  });
});

describe("shared runtime health and stdio access", () => {
  it("does not follow redirects away from the fixed loopback health endpoint", async () => {
    let redirectedRequests = 0;
    const server = createHttpServer((request, response) => {
      if (request.url === "/mcp") {
        response.writeHead(307, { location: "/redirected" });
        response.end();
        return;
      }
      redirectedRequests += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: "runtime-service-health",
        result: { protocolVersion: "2025-11-25", capabilities: {}, serverInfo: { name: "babel-content-downloader", version: "fixture" } },
      }));
    });
    await new Promise<void>((resolveListen, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolveListen); });
    const config = newConfig();
    config.port = (server.address() as AddressInfo).port;
    config.clients = [{ id: "health", token: "health-token", output_roots: ["/unused"] }];
    try {
      expect(await probeRuntimeHealth(config)).toEqual({ ready: false, reason: "unreachable" });
      expect(redirectedRequests).toBe(0);
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  });

  it("authenticates health and two client proxies against one loopback runtime", async () => {
    const requests: string[] = [];
    const server = createHttpServer((request, response) => {
      requests.push(request.headers.authorization ?? "");
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        const message = JSON.parse(body) as { id: string | number; method: string };
        const result = message.method === "initialize"
          ? { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "babel-content-downloader", version: "fixture" } }
          : { content: [] };
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
      });
    });
    await new Promise<void>((resolveListen, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolveListen); });
    const port = (server.address() as AddressInfo).port;
    const config = newConfig();
    config.port = port;
    config.clients = [
      { id: "alice", token: "alice-token", output_roots: ["/unused"] },
      { id: "bob", token: "bob-token", output_roots: ["/unused"] },
    ];
    const rpc = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    try {
      expect(await probeRuntimeHealth(config)).toEqual({ ready: true, reason: "ready", version: "fixture" });
      const alice: string[] = []; const bob: string[] = [];
      await Promise.all([
        proxyMcpStdio({ config, clientId: "alice", lines: Readable.from([rpc]), write: (line) => { alice.push(line); } }),
        proxyMcpStdio({ config, clientId: "bob", lines: Readable.from([rpc]), write: (line) => { bob.push(line); } }),
      ]);
      expect(alice).toHaveLength(1); expect(bob).toHaveLength(1);
      expect(requests[0]).toBe("Bearer alice-token");
      expect(requests.slice(1).sort()).toEqual(["Bearer alice-token", "Bearer bob-token"]);
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  });
});
