import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { mkdir, readFile, rename, writeFile, chmod } from "node:fs/promises";

export interface ClientGrant {
  id: string;
  token: string;
  output_roots: string[];
}

export interface MediaToolPaths {
  yt_dlp?: string;
  ffmpeg?: string;
  ffprobe?: string;
}

export interface RuntimeConfig {
  schema_version: 1;
  port: number;
  state_dir: string;
  allowed_extension_ids: string[];
  clients: ClientGrant[];
  /** Operator-owned development fixture origins; never accepted from an MCP request. */
  fixture_origins: string[];
  /** DNS resolver choice is operator-owned; network policy still requires public addresses. */
  dns_mode?: "system" | "cloudflare";
  /** Temporary, resumable input/checkpoint retention; final artifacts are never pruned. */
  checkpoint_retention_days?: number;
  /** Detailed job warnings/error messages retention; status and error code remain. */
  log_retention_days?: number;
  /** Trusted operator executable paths; content and MCP requests cannot set these. */
  media_tools?: MediaToolPaths;
}

export const DEFAULT_CONFIG_PATH = join(homedir(), ".config", "babel-content-downloader", "config.json");
export const DEFAULT_STATE_DIR = join(homedir(), ".local", "share", "babel-content-downloader");
export const DEFAULT_PORT = 4318;

export function configPath(): string {
  return resolve(process.env.BABEL_CONTENT_CONFIG ?? DEFAULT_CONFIG_PATH);
}

export function newConfig(): RuntimeConfig {
  return { schema_version: 1, port: DEFAULT_PORT, state_dir: DEFAULT_STATE_DIR, allowed_extension_ids: [], clients: [], fixture_origins: [], dns_mode: "system", checkpoint_retention_days: 7, log_retention_days: 7 };
}

export function newClient(id: string, outputRoots: string[]): ClientGrant {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new Error("Invalid client ID");
  return { id, token: randomBytes(32).toString("base64url"), output_roots: outputRoots.map((root) => resolve(root)) };
}

export async function loadConfig(path = configPath()): Promise<RuntimeConfig> {
  let raw: unknown;
  try { raw = JSON.parse(await readFile(path, "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return newConfig();
    throw error;
  }
  if (!raw || typeof raw !== "object") throw new Error("Invalid runtime configuration");
  const value = raw as Partial<RuntimeConfig>;
  if (value.schema_version !== 1 || !Number.isInteger(value.port) || (value.port ?? 0) < 1 || (value.port ?? 0) > 65535 || !Array.isArray(value.allowed_extension_ids) || !Array.isArray(value.clients) || !Array.isArray(value.fixture_origins) || typeof value.state_dir !== "string") throw new Error("Invalid runtime configuration");
  if (value.dns_mode !== undefined && value.dns_mode !== "system" && value.dns_mode !== "cloudflare") throw new Error("Invalid DNS mode in runtime configuration");
  for (const [name, days] of [["checkpoint_retention_days", value.checkpoint_retention_days], ["log_retention_days", value.log_retention_days]] as const) {
    if (days !== undefined && (!Number.isInteger(days) || days < 1 || days > 3650)) throw new Error(`Invalid ${name} in runtime configuration`);
  }
  if (value.media_tools !== undefined) {
    if (!value.media_tools || typeof value.media_tools !== "object" || Array.isArray(value.media_tools)) throw new Error("Invalid media_tools in runtime configuration");
    for (const [name, path] of Object.entries(value.media_tools)) {
      if (!["yt_dlp", "ffmpeg", "ffprobe"].includes(name) || typeof path !== "string" || !isAbsolute(path) || path.includes("\0")) throw new Error("Invalid media_tools in runtime configuration");
    }
  }
  return value as RuntimeConfig;
}

export async function saveConfig(config: RuntimeConfig, path = configPath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700);
  const temp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temp, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  await chmod(temp, 0o600);
  await rename(temp, path);
}
