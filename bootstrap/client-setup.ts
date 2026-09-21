import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type McpClient = "codex" | "claude";
export const MCP_SERVER_NAME = "babel-content-downloader";

export interface ClientSetupOptions {
  client: McpClient;
  clientId: string;
  stateDir: string;
  /** Exact owner-only runtime config used by the installed stdio proxy. */
  runtimeConfigPath: string;
  /** Overrides are for isolated tests or a trusted operator-selected CLI. */
  cliExecutable?: string;
  nodeExecutable?: string;
  proxyScript?: string;
  claudeConfigPath?: string;
  commandEnv?: NodeJS.ProcessEnv;
}

export interface ClientSetupStatus {
  client: McpClient;
  server_name: string;
  state: "uninstalled" | "waiting_client_reload" | "foreign_name_conflict" | "configuration_changed";
  next_action: string;
}

interface Receipt {
  schema_version: 1;
  client: McpClient;
  client_id: string;
  runtime_config_path: string;
  server_name: typeof MCP_SERVER_NAME;
  fingerprint: string;
}

interface ExistingServer { config: Record<string, unknown>; scope: "user" | "other" }
interface CommandResult { code: number | null; stdout: string; stderr: string; failedToStart: boolean; timedOut: boolean }

function digest(value: unknown): string {
  const sorted = (input: unknown): unknown => Array.isArray(input) ? input.map(sorted)
    : input && typeof input === "object" ? Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sorted(item)])) : input;
  return createHash("sha256").update(JSON.stringify(sorted(value))).digest("hex");
}

async function command(binary: string, args: string[], options: ClientSetupOptions): Promise<CommandResult> {
  return await new Promise((resolveResult) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"], shell: false, windowsHide: true, env: options.commandEnv ?? process.env });
    let stdout = ""; let stderr = ""; let failedToStart = false; let timedOut = false; let settled = false;
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult({ code, stdout, stderr, failedToStart, timedOut });
    };
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 15_000);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = (stdout + chunk.toString("utf8")).slice(0, 262_144);
      if (stdout.length >= 262_144) child.kill("SIGKILL");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(0, 262_144);
      if (stderr.length >= 262_144) child.kill("SIGKILL");
    });
    child.on("error", () => { failedToStart = true; finish(null); });
    child.on("close", finish);
  });
}

function cli(options: ClientSetupOptions): string { return options.cliExecutable ?? options.client; }
function fail(result: CommandResult, action: string): never {
  throw new Error(result.failedToStart ? "CLIENT_CLI_UNAVAILABLE" : result.timedOut ? "CLIENT_CLI_TIMEOUT" : `${action}_FAILED`);
}

async function existingCodex(options: ClientSetupOptions): Promise<ExistingServer | undefined> {
  const listed = await command(cli(options), ["mcp", "list", "--json"], options);
  if (listed.code !== 0) fail(listed, "CLIENT_CONFIG_READ");
  let servers: unknown;
  try { servers = JSON.parse(listed.stdout); } catch { throw new Error("CLIENT_CONFIG_READ_INVALID"); }
  if (!Array.isArray(servers)) throw new Error("CLIENT_CONFIG_READ_INVALID");
  if (!servers.some((item) => item && typeof item === "object" && item.name === MCP_SERVER_NAME)) return undefined;
  const found = await command(cli(options), ["mcp", "get", MCP_SERVER_NAME, "--json"], options);
  if (found.code !== 0) fail(found, "CLIENT_CONFIG_READ");
  let raw: unknown;
  try { raw = JSON.parse(found.stdout); } catch { throw new Error("CLIENT_CONFIG_READ_INVALID"); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("CLIENT_CONFIG_READ_INVALID");
  const value = raw as Record<string, unknown>;
  if (value.name !== MCP_SERVER_NAME) throw new Error("CLIENT_CONFIG_READ_INVALID");
  // Connection/auth status can change after a client reload; only configuration is fingerprinted.
  const { name: _name, auth_status: _auth, disabled_reason: _reason, ...config } = value;
  return { config, scope: "user" };
}

async function existingClaude(options: ClientSetupOptions): Promise<ExistingServer | undefined> {
  const found = await command(cli(options), ["mcp", "get", MCP_SERVER_NAME], options);
  if (found.code !== 0) {
    if (!found.failedToStart && !found.timedOut && /^No MCP server found with name:\s*babel-content-downloader\s*$/m.test(`${found.stdout}\n${found.stderr}`)) return undefined;
    fail(found, "CLIENT_CONFIG_READ");
  }
  if (process.env.CLAUDE_CONFIG_DIR && !options.claudeConfigPath) throw new Error("CLAUDE_CUSTOM_CONFIG_REQUIRES_MANUAL_SETUP");
  const configPath = options.claudeConfigPath ?? join(homedir(), ".claude.json");
  let root: unknown;
  try { root = JSON.parse(await readFile(configPath, "utf8")); }
  catch { throw new Error("CLAUDE_CONFIG_READ_FAILED"); }
  const userEntry = (root as { mcpServers?: Record<string, unknown> })?.mcpServers?.[MCP_SERVER_NAME];
  if (!userEntry || typeof userEntry !== "object" || Array.isArray(userEntry)) return { config: {}, scope: "other" };
  return { config: userEntry as Record<string, unknown>, scope: "user" };
}

async function existing(options: ClientSetupOptions): Promise<ExistingServer | undefined> {
  return options.client === "codex" ? existingCodex(options) : existingClaude(options);
}

function receiptPath(options: ClientSetupOptions): string {
  if (!isAbsolute(options.stateDir) || !isAbsolute(options.runtimeConfigPath) || !/^[a-zA-Z0-9_-]{1,64}$/.test(options.clientId)) throw new Error("CLIENT_SETUP_SCOPE_INVALID");
  return join(options.stateDir, "client-setups", `${options.client}.json`);
}

async function readReceipt(options: ClientSetupOptions): Promise<Receipt | undefined> {
  let raw: unknown;
  try { raw = JSON.parse(await readFile(receiptPath(options), "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error("CLIENT_SETUP_RECEIPT_INVALID");
  }
  const value = raw as Partial<Receipt>;
  if (!value || value.schema_version !== 1 || value.client !== options.client || value.server_name !== MCP_SERVER_NAME || !/^[a-f0-9]{64}$/.test(value.fingerprint ?? "") || !/^[a-zA-Z0-9_-]{1,64}$/.test(value.client_id ?? "") || !isAbsolute(value.runtime_config_path ?? "")) throw new Error("CLIENT_SETUP_RECEIPT_INVALID");
  return value as Receipt;
}

async function proxyCommand(options: ClientSetupOptions): Promise<{ command: string; args: string[]; env: Record<string, string> }> {
  const node = resolve(options.nodeExecutable ?? process.execPath);
  const script = resolve(options.proxyScript ?? join(dirname(fileURLToPath(import.meta.url)), "cli.js"));
  if (!isAbsolute(node) || !isAbsolute(script) || !(await stat(node)).isFile() || !(await stat(script)).isFile()) throw new Error("CLIENT_PROXY_NOT_BUILT");
  return { command: node, args: [script, "mcp", options.clientId], env: { BABEL_CONTENT_CONFIG: options.runtimeConfigPath } };
}

function matchesExpected(found: ExistingServer, expected: { command: string; args: string[]; env: Record<string, string> }, client: McpClient): boolean {
  const transport = client === "codex" ? found.config.transport as Record<string, unknown> | undefined : found.config;
  return found.scope === "user" && transport?.type === "stdio" && transport.command === expected.command
    && Array.isArray(transport.args) && JSON.stringify(transport.args) === JSON.stringify(expected.args)
    && Boolean(transport.env) && typeof transport.env === "object" && digest(transport.env) === digest(expected.env)
    && (!transport.env_vars || (Array.isArray(transport.env_vars) && transport.env_vars.length === 0));
}

export async function clientConfigStatus(options: ClientSetupOptions): Promise<ClientSetupStatus> {
  const receipt = await readReceipt(options);
  const found = await existing(options);
  const base = { client: options.client, server_name: MCP_SERVER_NAME };
  if (!receipt) return found
    ? { ...base, state: "foreign_name_conflict", next_action: "Inspect the existing named MCP entry before changing it." }
    : { ...base, state: "uninstalled", next_action: "Register the client grant, then install its MCP entry." };
  if (receipt.client_id !== options.clientId || receipt.runtime_config_path !== options.runtimeConfigPath || !found || found.scope !== "user" || digest(found.config) !== receipt.fingerprint)
    return { ...base, state: "configuration_changed", next_action: "The named entry changed or disappeared; automatic removal is disabled." };
  return { ...base, state: "waiting_client_reload", next_action: "Reload this client and call babel_content_check through its actual MCP tools; confirm the browser bridge is paired." };
}

export async function installClientConfig(options: ClientSetupOptions): Promise<ClientSetupStatus> {
  const path = receiptPath(options);
  const receipt = await readReceipt(options);
  if (receipt) {
    const status = await clientConfigStatus(options);
    if (status.state !== "waiting_client_reload") throw new Error("CLIENT_SETUP_RECEIPT_CONFLICT");
    return status;
  }
  if (await existing(options)) throw new Error("CLIENT_MCP_NAME_CONFLICT");
  const proxy = await proxyCommand(options);
  const configEnv = `BABEL_CONTENT_CONFIG=${options.runtimeConfigPath}`;
  const args = options.client === "codex"
    ? ["mcp", "add", MCP_SERVER_NAME, "--env", configEnv, "--", proxy.command, ...proxy.args]
    : ["mcp", "add", "--scope", "user", "--transport", "stdio", "--env", configEnv, MCP_SERVER_NAME, "--", proxy.command, ...proxy.args];
  const added = await command(cli(options), args, options);
  if (added.code !== 0) fail(added, "CLIENT_CONFIG_ADD");
  const found = await existing(options);
  if (!found || !matchesExpected(found, proxy, options.client)) throw new Error("CLIENT_CONFIG_VERIFY_FAILED: the CLI may have added the named entry; inspect it before retrying. No ownership receipt was written.");
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const saved: Receipt = { schema_version: 1, client: options.client, client_id: options.clientId, runtime_config_path: options.runtimeConfigPath, server_name: MCP_SERVER_NAME, fingerprint: digest(found.config) };
  try { await writeFile(path, JSON.stringify(saved) + "\n", { flag: "wx", mode: 0o600 }); }
  catch { throw new Error("CLIENT_RECEIPT_WRITE_FAILED: the CLI added the named entry; inspect it before retrying. Automatic removal is disabled without an ownership receipt."); }
  return await clientConfigStatus(options);
}

export async function removeClientConfig(options: ClientSetupOptions): Promise<ClientSetupStatus> {
  const receipt = await readReceipt(options);
  if (!receipt || receipt.client_id !== options.clientId || receipt.runtime_config_path !== options.runtimeConfigPath) throw new Error("CLIENT_SETUP_RECEIPT_MISSING");
  const found = await existing(options);
  if (found) {
    if (found.scope !== "user" || digest(found.config) !== receipt.fingerprint) throw new Error("CLIENT_MCP_ENTRY_CHANGED");
    const args = options.client === "codex" ? ["mcp", "remove", MCP_SERVER_NAME] : ["mcp", "remove", "--scope", "user", MCP_SERVER_NAME];
    const removed = await command(cli(options), args, options);
    if (removed.code !== 0) fail(removed, "CLIENT_CONFIG_REMOVE");
    if (await existing(options)) throw new Error("CLIENT_CONFIG_REMOVE_VERIFY_FAILED");
  }
  await unlink(receiptPath(options));
  return { client: options.client, server_name: MCP_SERVER_NAME, state: "uninstalled", next_action: "Only this project's named MCP entry was removed. The runtime and saved content remain." };
}
