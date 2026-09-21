import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access, chmod, link, lstat, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RuntimeConfig } from "../runtime/policy/config.js";

export const RUNTIME_SERVICE_LABEL = "com.babel-content-downloader.runtime";

type ServiceState = "unsupported" | "uninstalled" | "stopped" | "running" | "unhealthy" | "configuration_changed";
type HealthState = "not_applicable" | "ready" | "unavailable" | "restart_required";

export interface RuntimeServiceStatus {
  supported: boolean;
  platform: string;
  label: typeof RUNTIME_SERVICE_LABEL;
  state: ServiceState;
  health: HealthState;
  loaded: boolean;
  pid?: number;
  restart_required: boolean;
  installed_version?: string;
  applied_version?: string;
  running_version?: string;
  config_path: string;
  plist_path?: string;
  next_action: string;
}

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  failedToStart: boolean;
  timedOut: boolean;
}

interface ServiceReceipt {
  schema_version: 1;
  label: typeof RUNTIME_SERVICE_LABEL;
  config_path: string;
  node_path: string;
  cli_path: string;
  plist_path: string;
  plist_sha256: string;
  applied_config_sha256?: string;
  applied_port?: number;
  applied_runtime_version?: string;
}

interface LoadedService {
  loaded: boolean;
  running: boolean;
  pid?: number;
  identityMatches: boolean;
}

export interface RuntimeHealthResult {
  ready: boolean;
  reason: "ready" | "client_required" | "unreachable" | "unexpected_response";
  version?: string;
}

export interface RuntimeServiceOptions {
  config: RuntimeConfig;
  configPath: string;
  platform?: NodeJS.Platform;
  uid?: number;
  launchAgentDirectory?: string;
  nodePath?: string;
  cliPath?: string;
  launchctlPath?: string;
  runtimeVersion?: string;
  runCommand?: (file: string, args: string[], timeoutMs?: number) => Promise<CommandResult>;
  checkPortAvailable?: (port: number) => Promise<boolean>;
  probeHealth?: (config: RuntimeConfig, timeoutMs?: number) => Promise<RuntimeHealthResult>;
  wait?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}

interface ResolvedOptions {
  config: RuntimeConfig;
  configPath: string;
  platform: NodeJS.Platform;
  uid: number;
  launchAgentDirectory: string;
  nodePath: string;
  cliPath: string;
  launchctlPath: string;
  runtimeVersion?: string;
  runCommand: (file: string, args: string[], timeoutMs?: number) => Promise<CommandResult>;
  checkPortAvailable: (port: number) => Promise<boolean>;
  probeHealth: (config: RuntimeConfig, timeoutMs?: number) => Promise<RuntimeHealthResult>;
  wait: (milliseconds: number) => Promise<void>;
  now: () => number;
}

const MAX_COMMAND_OUTPUT = 262_144;
const COMMAND_TIMEOUT_MS = 15_000;
const READY_TIMEOUT_MS = 5_000;

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

async function defaultCommand(file: string, args: string[], timeoutMs = COMMAND_TIMEOUT_MS): Promise<CommandResult> {
  return await new Promise((resolveResult) => {
    const child = spawn(file, args, { stdio: ["ignore", "pipe", "pipe"], shell: false, windowsHide: true });
    let stdout = ""; let stderr = ""; let failedToStart = false; let timedOut = false; let settled = false;
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult({ code, stdout, stderr, failedToStart, timedOut });
    };
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, Math.max(1, Math.min(COMMAND_TIMEOUT_MS, timeoutMs)));
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = (stdout + chunk.toString("utf8")).slice(0, MAX_COMMAND_OUTPUT);
      if (stdout.length >= MAX_COMMAND_OUTPUT) child.kill("SIGKILL");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(0, MAX_COMMAND_OUTPUT);
      if (stderr.length >= MAX_COMMAND_OUTPUT) child.kill("SIGKILL");
    });
    child.on("error", () => { failedToStart = true; finish(null); });
    child.on("close", finish);
  });
}

async function defaultPortAvailable(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolveAvailable, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") resolveAvailable(false);
      else reject(error);
    });
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close((error) => error ? reject(error) : resolveAvailable(true));
    });
  });
}

function parseMcpResponse(contentType: string | null, body: string): unknown {
  if (!contentType?.includes("text/event-stream")) return JSON.parse(body);
  const data = body.split(/\r?\n/).find((line) => line.startsWith("data: "))?.slice(6);
  if (!data) throw new Error("Missing SSE data");
  return JSON.parse(data);
}

export async function probeRuntimeHealth(config: RuntimeConfig, timeoutMs = 1_500): Promise<RuntimeHealthResult> {
  const client = config.clients[0];
  if (!client?.token) return { ready: false, reason: "client_required" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(1_500, timeoutMs)));
  try {
    const response = await fetch(`http://127.0.0.1:${config.port}/mcp`, {
      method: "POST",
      redirect: "error",
      headers: { authorization: `Bearer ${client.token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "runtime-service-health", method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "babel-runtime-service-health", version: "1" } } }),
      signal: controller.signal,
    });
    if (!response.ok) return { ready: false, reason: "unexpected_response" };
    const value = parseMcpResponse(response.headers.get("content-type"), await response.text()) as { result?: { serverInfo?: { name?: unknown; version?: unknown } } };
    return value?.result?.serverInfo?.name === "babel-content-downloader" && typeof value.result.serverInfo.version === "string"
      ? { ready: true, reason: "ready", version: value.result.serverInfo.version } : { ready: false, reason: "unexpected_response" };
  } catch {
    return { ready: false, reason: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

function resolved(options: RuntimeServiceOptions): ResolvedOptions {
  const platform = options.platform ?? process.platform;
  const detectedUid = options.uid ?? process.getuid?.();
  if (platform === "darwin" && (detectedUid === undefined || !Number.isSafeInteger(detectedUid) || detectedUid < 0)) throw new Error("RUNTIME_SERVICE_UID_UNAVAILABLE");
  const uid = detectedUid ?? 0;
  const configPath = resolve(options.configPath);
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  return {
    config: options.config,
    configPath,
    platform,
    uid,
    launchAgentDirectory: resolve(options.launchAgentDirectory ?? join(homedir(), "Library", "LaunchAgents")),
    nodePath: resolve(options.nodePath ?? process.execPath),
    cliPath: resolve(options.cliPath ?? join(moduleDirectory, "cli.js")),
    launchctlPath: resolve(options.launchctlPath ?? "/bin/launchctl"),
    runtimeVersion: options.runtimeVersion,
    runCommand: options.runCommand ?? defaultCommand,
    checkPortAvailable: options.checkPortAvailable ?? defaultPortAvailable,
    probeHealth: options.probeHealth ?? probeRuntimeHealth,
    wait: options.wait ?? (async (milliseconds) => await new Promise((resolveWait) => setTimeout(resolveWait, milliseconds))),
    now: options.now ?? Date.now,
  };
}

function plistPath(options: ResolvedOptions): string {
  return join(options.launchAgentDirectory, `${RUNTIME_SERVICE_LABEL}.plist`);
}

function receiptPath(options: ResolvedOptions): string {
  return join(dirname(options.configPath), "babel-content-downloader-runtime-service.json");
}

function logDirectory(options: ResolvedOptions): string {
  return join(resolve(options.config.state_dir), "runtime-service");
}

function renderPlist(options: ResolvedOptions): string {
  const logs = logDirectory(options);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xml(RUNTIME_SERVICE_LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(options.nodePath)}</string>
    <string>${xml(options.cliPath)}</string>
    <string>serve</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>BABEL_CONTENT_CONFIG</key><string>${xml(options.configPath)}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${xml(join(logs, "runtime.stdout.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(join(logs, "runtime.stderr.log"))}</string>
</dict>
</plist>
`;
}

async function readOptional(path: string): Promise<Buffer | undefined> {
  try { return await readFile(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeNew(path: string, content: string, mode: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.${randomBytes(8).toString("hex")}.tmp`);
  try {
    await writeFile(temporary, content, { flag: "wx", mode });
    await chmod(temporary, mode);
    await link(temporary, path);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

async function replaceOwned(path: string, content: string, mode: number): Promise<void> {
  const temporary = join(dirname(path), `.${randomBytes(8).toString("hex")}.tmp`);
  try {
    await writeFile(temporary, content, { flag: "wx", mode });
    await chmod(temporary, mode);
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

function validReceipt(value: unknown): value is ServiceReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const receipt = value as Partial<ServiceReceipt>;
  return receipt.schema_version === 1 && receipt.label === RUNTIME_SERVICE_LABEL
    && typeof receipt.config_path === "string" && isAbsolute(receipt.config_path)
    && typeof receipt.node_path === "string" && isAbsolute(receipt.node_path)
    && typeof receipt.cli_path === "string" && isAbsolute(receipt.cli_path)
    && typeof receipt.plist_path === "string" && isAbsolute(receipt.plist_path)
    && typeof receipt.plist_sha256 === "string" && /^[a-f0-9]{64}$/.test(receipt.plist_sha256)
    && (receipt.applied_config_sha256 === undefined || /^[a-f0-9]{64}$/.test(receipt.applied_config_sha256))
    && (receipt.applied_port === undefined || (Number.isInteger(receipt.applied_port) && receipt.applied_port! >= 1 && receipt.applied_port! <= 65535))
    && (receipt.applied_runtime_version === undefined || (typeof receipt.applied_runtime_version === "string" && receipt.applied_runtime_version.trim().length > 0 && receipt.applied_runtime_version.length <= 128 && !/[\u0000-\u001f\u007f]/.test(receipt.applied_runtime_version)));
}

async function readReceipt(options: ResolvedOptions): Promise<ServiceReceipt | undefined> {
  const bytes = await readOptional(receiptPath(options));
  if (!bytes) return undefined;
  try {
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    return validReceipt(value) ? value : undefined;
  } catch { return undefined; }
}

function receiptMatchesInvocation(receipt: ServiceReceipt, options: ResolvedOptions): boolean {
  return receipt.label === RUNTIME_SERVICE_LABEL && receipt.config_path === options.configPath
    && receipt.node_path === options.nodePath && receipt.cli_path === options.cliPath
    && receipt.plist_path === plistPath(options);
}

function launchTarget(options: ResolvedOptions): string {
  return `gui/${options.uid}/${RUNTIME_SERVICE_LABEL}`;
}

function launchDomain(options: ResolvedOptions): string {
  return `gui/${options.uid}`;
}

function blockValues(output: string, name: string): string[] | undefined {
  const lines = output.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `${name} = {`);
  if (start < 0) return undefined;
  const values: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.trim() === "}") return values;
    const value = line.trim().replace(/^\d+\s*=\s*/, "");
    if (value) values.push(value);
  }
  return undefined;
}

function scalar(output: string, name: string): string | undefined {
  return output.match(new RegExp(`^\\s*${name}\\s*=\\s*(.+?)\\s*$`, "m"))?.[1];
}

function parseLoaded(output: string, receipt: ServiceReceipt): LoadedService {
  const path = scalar(output, "path");
  const program = scalar(output, "program");
  const args = blockValues(output, "arguments");
  const state = scalar(output, "state");
  const pidText = scalar(output, "pid");
  const pid = pidText && /^\d+$/.test(pidText) ? Number(pidText) : undefined;
  const identityMatches = path === receipt.plist_path && program === receipt.node_path
    && JSON.stringify(args) === JSON.stringify([receipt.node_path, receipt.cli_path, "serve"]);
  return { loaded: true, running: state === "running" && pid !== undefined, pid, identityMatches };
}

async function loadedService(options: ResolvedOptions, receipt?: ServiceReceipt, timeoutMs?: number): Promise<LoadedService> {
  const result = await options.runCommand(options.launchctlPath, ["print", launchTarget(options)], timeoutMs);
  if (result.failedToStart) throw new Error("RUNTIME_SERVICE_LAUNCHCTL_UNAVAILABLE");
  if (result.timedOut) throw new Error("RUNTIME_SERVICE_LAUNCHCTL_TIMEOUT");
  if (result.code !== 0) return { loaded: false, running: false, identityMatches: true };
  if (!receipt) return { loaded: true, running: false, identityMatches: false };
  return parseLoaded(result.stdout, receipt);
}

async function currentConfigHash(options: ResolvedOptions): Promise<string | undefined> {
  const bytes = await readOptional(options.configPath);
  return bytes ? sha256(bytes) : undefined;
}

function validRuntimeVersion(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value);
}

async function installedRuntimeVersion(options: ResolvedOptions): Promise<string> {
  if (validRuntimeVersion(options.runtimeVersion)) return options.runtimeVersion;
  const packagePath = join(dirname(dirname(dirname(options.cliPath))), "package.json");
  let value: unknown;
  try { value = JSON.parse(await readFile(packagePath, "utf8")); }
  catch { throw new Error("RUNTIME_SERVICE_PACKAGE_VERSION_UNAVAILABLE"); }
  const version = (value as { version?: unknown })?.version;
  if (!validRuntimeVersion(version)) throw new Error("RUNTIME_SERVICE_PACKAGE_VERSION_INVALID");
  return version;
}

async function ownership(options: ResolvedOptions): Promise<{ receipt?: ServiceReceipt; valid: boolean; plistExists: boolean }> {
  const receiptBytes = await readOptional(receiptPath(options));
  const plistBytes = await readOptional(plistPath(options));
  if (!receiptBytes && !plistBytes) return { valid: true, plistExists: false };
  if (!receiptBytes || !plistBytes) return { valid: false, plistExists: Boolean(plistBytes) };
  let value: unknown;
  try { value = JSON.parse(receiptBytes.toString("utf8")); } catch { return { valid: false, plistExists: true }; }
  if (!validReceipt(value) || !receiptMatchesInvocation(value, options) || sha256(plistBytes) !== value.plist_sha256) return { valid: false, plistExists: true };
  return { receipt: value, valid: true, plistExists: true };
}

function baseStatus(options: ResolvedOptions, state: ServiceState, health: HealthState, loaded: boolean, nextAction: string, extras: Partial<RuntimeServiceStatus> = {}): RuntimeServiceStatus {
  return {
    supported: options.platform === "darwin", platform: options.platform, label: RUNTIME_SERVICE_LABEL,
    state, health, loaded, restart_required: false, config_path: options.configPath,
    plist_path: plistPath(options), next_action: nextAction, ...extras,
  };
}

export async function runtimeServiceStatus(raw: RuntimeServiceOptions): Promise<RuntimeServiceStatus> {
  const options = resolved(raw);
  if (options.platform !== "darwin") return baseStatus(options, "unsupported", "not_applicable", false, "This release supports managed runtime startup on macOS only.");
  const own = await ownership(options);
  if (!own.valid) return baseStatus(options, "configuration_changed", "not_applicable", false, "The service receipt or plist changed; inspect it manually. No automatic stop or removal is allowed.");
  const loaded = await loadedService(options, own.receipt);
  if (!own.receipt) {
    if (loaded.loaded) return baseStatus(options, "configuration_changed", "not_applicable", true, "A foreign service uses this label; it will not be changed.");
    return baseStatus(options, "uninstalled", "not_applicable", false, "Run runtime-install after initializing the config and adding a client grant.");
  }
  if (loaded.loaded && !loaded.identityMatches) return baseStatus(options, "configuration_changed", "not_applicable", true, "The loaded service identity does not match the owned plist; it will not be changed.");
  const configHash = await currentConfigHash(options);
  const runtimeVersion = await installedRuntimeVersion(options);
  const restartRequired = !configHash || configHash !== own.receipt.applied_config_sha256 || options.config.port !== own.receipt.applied_port
    || runtimeVersion !== own.receipt.applied_runtime_version;
  const versions = { installed_version: runtimeVersion, applied_version: own.receipt.applied_runtime_version };
  if (!loaded.loaded) return baseStatus(options, "stopped", "not_applicable", false, "Run runtime-start to load the owned service.", { ...versions, restart_required: restartRequired });
  if (!loaded.running) return baseStatus(options, "unhealthy", restartRequired ? "restart_required" : "unavailable", true, "The owned launchd job is loaded but not running; run runtime-start and inspect its private log if needed.", { ...versions, restart_required: restartRequired, pid: loaded.pid });
  if (restartRequired) return baseStatus(options, "running", "restart_required", true, "The config or installed runtime version changed after the last healthy start; run runtime-start to restart this owned service.", { ...versions, restart_required: true, pid: loaded.pid });
  const health = await options.probeHealth(options.config, 1_500);
  if (health.ready && health.version !== runtimeVersion) return baseStatus(options, "running", "restart_required", true, "The loaded runtime version differs from this installation; run runtime-start to restart this owned service.", { ...versions, running_version: health.version, restart_required: true, pid: loaded.pid });
  return health.ready
    ? baseStatus(options, "running", "ready", true, "Reload the Agent client if needed, then call babel_content_check through its MCP tools.", { ...versions, running_version: health.version, pid: loaded.pid })
    : baseStatus(options, "unhealthy", "unavailable", true, "launchd accepted the job, but its authenticated MCP endpoint is not ready; inspect the private runtime log.", { ...versions, pid: loaded.pid });
}

async function ensureInstallInputs(options: ResolvedOptions): Promise<void> {
  if (options.platform !== "darwin") throw new Error("RUNTIME_SERVICE_UNSUPPORTED_PLATFORM");
  if (!isAbsolute(options.configPath) || !isAbsolute(options.config.state_dir)) throw new Error("RUNTIME_SERVICE_PATH_INVALID");
  if (!options.config.clients.some((client) => typeof client.token === "string" && client.token.length > 0)) throw new Error("RUNTIME_SERVICE_CLIENT_REQUIRED");
  const [configInfo, nodeInfo, cliInfo] = await Promise.all([lstat(options.configPath), stat(options.nodePath), stat(options.cliPath)]);
  if (!configInfo.isFile() || configInfo.isSymbolicLink() || (configInfo.mode & 0o077) !== 0 || configInfo.uid !== options.uid) throw new Error("RUNTIME_SERVICE_CONFIG_NOT_PRIVATE");
  if (!nodeInfo.isFile() || !cliInfo.isFile()) throw new Error("RUNTIME_SERVICE_EXECUTABLE_INVALID");
  await access(options.nodePath, constants.X_OK);
}

function commandFailed(result: CommandResult, action: string): never {
  if (result.failedToStart) throw new Error("RUNTIME_SERVICE_LAUNCHCTL_UNAVAILABLE");
  if (result.timedOut) throw new Error("RUNTIME_SERVICE_LAUNCHCTL_TIMEOUT");
  throw new Error(`${action}_FAILED`);
}

async function assertPortAvailable(options: ResolvedOptions): Promise<void> {
  if (!(await options.checkPortAvailable(options.config.port))) throw new Error("RUNTIME_SERVICE_PORT_IN_USE");
}

async function assertOwnedLoadedIdentity(options: ResolvedOptions, receipt: ServiceReceipt, timeoutMs?: number): Promise<LoadedService> {
  const loaded = await loadedService(options, receipt, timeoutMs);
  if (loaded.loaded && !loaded.identityMatches) throw new Error("RUNTIME_SERVICE_LOADED_IDENTITY_MISMATCH");
  return loaded;
}

function remaining(options: ResolvedOptions, deadline: number): number {
  return Math.max(0, deadline - options.now());
}

async function waitForHealth(options: ResolvedOptions, expectedVersion: string, deadline: number): Promise<RuntimeHealthResult> {
  let result: RuntimeHealthResult = { ready: false, reason: "unreachable" };
  while (remaining(options, deadline) > 0) {
    result = await options.probeHealth(options.config, remaining(options, deadline));
    if (result.ready && result.version === expectedVersion) return result;
    if (remaining(options, deadline) <= 0) break;
    await options.wait(Math.min(100, remaining(options, deadline)));
  }
  return result.ready && result.version !== expectedVersion ? { ready: false, reason: "unexpected_response", version: result.version } : result;
}

async function waitForRunningIdentity(options: ResolvedOptions, receipt: ServiceReceipt, deadline: number, previousPid?: number): Promise<LoadedService> {
  let loaded: LoadedService = { loaded: false, running: false, identityMatches: true };
  while (remaining(options, deadline) > 0) {
    loaded = await assertOwnedLoadedIdentity(options, receipt, remaining(options, deadline));
    if (loaded.running && (previousPid === undefined || loaded.pid !== previousPid)) return loaded;
    if (remaining(options, deadline) <= 0) break;
    await options.wait(Math.min(100, remaining(options, deadline)));
  }
  throw new Error("RUNTIME_SERVICE_LAUNCHD_NOT_RUNNING");
}

async function saveAppliedReceipt(options: ResolvedOptions, receipt: ServiceReceipt, expectedConfigHash: string, expectedVersion: string): Promise<ServiceReceipt> {
  const [configHash, runtimeVersion] = await Promise.all([currentConfigHash(options), installedRuntimeVersion(options)]);
  if (!configHash) throw new Error("RUNTIME_SERVICE_CONFIG_MISSING");
  if (configHash !== expectedConfigHash) throw new Error("RUNTIME_SERVICE_CONFIG_CHANGED_DURING_START");
  if (runtimeVersion !== expectedVersion) throw new Error("RUNTIME_SERVICE_VERSION_CHANGED_DURING_START");
  const current = await readReceipt(options);
  if (!current || JSON.stringify(current) !== JSON.stringify(receipt)) throw new Error("RUNTIME_SERVICE_OWNERSHIP_CONFLICT");
  const updated = { ...receipt, applied_config_sha256: configHash, applied_port: options.config.port, applied_runtime_version: runtimeVersion };
  await replaceOwned(receiptPath(options), JSON.stringify(updated, null, 2) + "\n", 0o600);
  return updated;
}

async function startOwned(options: ResolvedOptions, receipt: ServiceReceipt): Promise<RuntimeServiceStatus> {
  await ensureInstallInputs(options);
  const [startingConfigHash, startingVersion] = await Promise.all([currentConfigHash(options), installedRuntimeVersion(options)]);
  if (!startingConfigHash) throw new Error("RUNTIME_SERVICE_CONFIG_MISSING");
  const deadline = options.now() + READY_TIMEOUT_MS;
  const loaded = await assertOwnedLoadedIdentity(options, receipt, remaining(options, deadline));
  const portChanged = receipt.applied_port !== undefined && receipt.applied_port !== options.config.port;
  if (!loaded.loaded || portChanged) await assertPortAvailable(options);
  let result: CommandResult;
  if (loaded.loaded) {
    result = await options.runCommand(options.launchctlPath, ["kickstart", "-k", launchTarget(options)], remaining(options, deadline));
  } else {
    result = await options.runCommand(options.launchctlPath, ["bootstrap", launchDomain(options), receipt.plist_path], remaining(options, deadline));
  }
  if (result.code !== 0) commandFailed(result, "RUNTIME_SERVICE_START");
  await waitForRunningIdentity(options, receipt, deadline, loaded.running ? loaded.pid : undefined);
  const health = await waitForHealth(options, startingVersion, deadline);
  if (!health.ready) {
    const after = await assertOwnedLoadedIdentity(options, receipt, 1_000);
    if (after.loaded) await options.runCommand(options.launchctlPath, ["bootout", launchDomain(options), receipt.plist_path], 1_000);
    throw new Error(`RUNTIME_SERVICE_HEALTH_FAILED_${health.reason.toUpperCase()}`);
  }
  try { await saveAppliedReceipt(options, receipt, startingConfigHash, startingVersion); }
  catch (error) {
    const after = await assertOwnedLoadedIdentity(options, receipt, 1_000);
    if (after.loaded) await options.runCommand(options.launchctlPath, ["bootout", launchDomain(options), receipt.plist_path], 1_000);
    throw error;
  }
  return await runtimeServiceStatus(rawFromResolved(options));
}

function rawFromResolved(options: ResolvedOptions): RuntimeServiceOptions {
  return {
    config: options.config, configPath: options.configPath, platform: options.platform, uid: options.uid,
    launchAgentDirectory: options.launchAgentDirectory, nodePath: options.nodePath, cliPath: options.cliPath,
    launchctlPath: options.launchctlPath, runCommand: options.runCommand, checkPortAvailable: options.checkPortAvailable,
    runtimeVersion: options.runtimeVersion, probeHealth: options.probeHealth, wait: options.wait, now: options.now,
  };
}

export async function installRuntimeService(raw: RuntimeServiceOptions): Promise<RuntimeServiceStatus> {
  const options = resolved(raw);
  await ensureInstallInputs(options);
  const own = await ownership(options);
  const loaded = await loadedService(options, own.receipt);
  if (!own.valid || (!own.receipt && (own.plistExists || loaded.loaded)) || (loaded.loaded && !loaded.identityMatches)) throw new Error("RUNTIME_SERVICE_OWNERSHIP_CONFLICT");
  if (own.receipt) {
    const status = await runtimeServiceStatus(rawFromResolved(options));
    if (status.state === "running" && !status.restart_required && status.health === "ready") return status;
    return await startOwned(options, own.receipt);
  }
  await assertPortAvailable(options);
  await mkdir(options.launchAgentDirectory, { recursive: true, mode: 0o700 });
  await mkdir(logDirectory(options), { recursive: true, mode: 0o700 });
  await chmod(logDirectory(options), 0o700);
  const plist = renderPlist(options);
  const receipt: ServiceReceipt = {
    schema_version: 1, label: RUNTIME_SERVICE_LABEL, config_path: options.configPath,
    node_path: options.nodePath, cli_path: options.cliPath, plist_path: plistPath(options), plist_sha256: sha256(plist),
  };
  await writeNew(receipt.plist_path, plist, 0o600);
  try { await writeNew(receiptPath(options), JSON.stringify(receipt, null, 2) + "\n", 0o600); }
  catch (error) {
    const bytes = await readOptional(receipt.plist_path);
    if (bytes && sha256(bytes) === receipt.plist_sha256) await unlink(receipt.plist_path);
    throw error;
  }
  return await startOwned(options, receipt);
}

export async function startRuntimeService(raw: RuntimeServiceOptions): Promise<RuntimeServiceStatus> {
  const options = resolved(raw);
  if (options.platform !== "darwin") return await runtimeServiceStatus(rawFromResolved(options));
  const own = await ownership(options);
  if (!own.valid) throw new Error("RUNTIME_SERVICE_OWNERSHIP_CONFLICT");
  if (!own.receipt) throw new Error("RUNTIME_SERVICE_NOT_INSTALLED");
  const status = await runtimeServiceStatus(rawFromResolved(options));
  if (status.state === "configuration_changed") throw new Error("RUNTIME_SERVICE_OWNERSHIP_CONFLICT");
  if (status.state === "running" && !status.restart_required && status.health === "ready") return status;
  return await startOwned(options, own.receipt);
}

export async function stopRuntimeService(raw: RuntimeServiceOptions): Promise<RuntimeServiceStatus> {
  const options = resolved(raw);
  if (options.platform !== "darwin") return await runtimeServiceStatus(rawFromResolved(options));
  const own = await ownership(options);
  if (!own.valid) throw new Error("RUNTIME_SERVICE_OWNERSHIP_CONFLICT");
  if (!own.receipt) return await runtimeServiceStatus(rawFromResolved(options));
  const loaded = await assertOwnedLoadedIdentity(options, own.receipt);
  if (loaded.loaded) {
    const result = await options.runCommand(options.launchctlPath, ["bootout", launchDomain(options), own.receipt.plist_path]);
    if (result.code !== 0) commandFailed(result, "RUNTIME_SERVICE_STOP");
  }
  return await runtimeServiceStatus(rawFromResolved(options));
}

export async function uninstallRuntimeService(raw: RuntimeServiceOptions): Promise<RuntimeServiceStatus> {
  const options = resolved(raw);
  if (options.platform !== "darwin") return await runtimeServiceStatus(rawFromResolved(options));
  const own = await ownership(options);
  if (!own.valid) throw new Error("RUNTIME_SERVICE_OWNERSHIP_CONFLICT");
  if (!own.receipt) return await runtimeServiceStatus(rawFromResolved(options));
  const loaded = await assertOwnedLoadedIdentity(options, own.receipt);
  if (loaded.loaded) {
    const result = await options.runCommand(options.launchctlPath, ["bootout", launchDomain(options), own.receipt.plist_path]);
    if (result.code !== 0) commandFailed(result, "RUNTIME_SERVICE_STOP");
  }
  const plist = await readOptional(own.receipt.plist_path);
  if (!plist || sha256(plist) !== own.receipt.plist_sha256) throw new Error("RUNTIME_SERVICE_OWNERSHIP_CONFLICT");
  await unlink(own.receipt.plist_path);
  await unlink(receiptPath(options));
  return await runtimeServiceStatus(rawFromResolved(options));
}
