import { spawn } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { SaveAs } from "../../shared/contracts.js";
import type { MediaToolPaths } from "../policy/config.js";

export type MediaToolId = "yt-dlp" | "ffmpeg" | "ffprobe";
export interface DependencyStatus {
  name: MediaToolId;
  available: boolean;
  version?: string;
  executable: string;
  source: "configured" | "path";
  required_for: string[];
  potentially_needed_for_request: boolean;
  help_url: string;
  error?: string;
}

const DEPENDENCIES = [
  { name: "yt-dlp", configKey: "yt_dlp", args: ["--version"], required_for: ["video", "audio"], help_url: "https://github.com/yt-dlp/yt-dlp#installation" },
  { name: "ffmpeg", configKey: "ffmpeg", args: ["-version"], required_for: ["video-merge", "audio-extract"], help_url: "https://ffmpeg.org/download.html" },
  { name: "ffprobe", configKey: "ffprobe", args: ["-version"], required_for: ["media-verification"], help_url: "https://ffmpeg.org/download.html" },
] as const;

function versionMatches(id: MediaToolId, version: string): boolean {
  return id === "yt-dlp" ? /^\d{4}\.\d{1,2}\.\d{1,2}(?:[.-][A-Za-z0-9]+)?$/.test(version)
    : /^(ffmpeg|ffprobe) version \S+/.test(version) && version.startsWith(id);
}

async function probe(id: MediaToolId, command: string, args: readonly string[]): Promise<{ available: boolean; version?: string; error?: string }> {
  return await new Promise((resolve) => {
    const child = spawn(command, [...args], { stdio: ["ignore", "pipe", "pipe"], shell: false, windowsHide: true, env: process.env });
    let stdout = ""; let stderr = ""; let settled = false;
    const finish = (value: { available: boolean; version?: string; error?: string }) => {
      if (settled) return;
      settled = true; clearTimeout(timer); resolve(value);
    };
    // A cold Python-based yt-dlp launch can exceed three seconds on this host.
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish({ available: false, error: "version probe timed out" }); }, 10_000);
    timer.unref();
    child.stdout.on("data", (chunk: Buffer) => { stdout = (stdout + chunk.toString("utf8")).slice(0, 1024); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(0, 1024); });
    child.on("error", () => finish({ available: false, error: "executable could not start" }));
    child.on("close", (code) => {
      const first = (stdout.trim() || stderr.trim()).split(/\r?\n/)[0]?.slice(0, 160) ?? "";
      finish(code === 0 && versionMatches(id, first)
        ? { available: true, version: first }
        : { available: false, error: code === 0 ? "unexpected version output" : `version probe exited ${code ?? "unknown"}` });
    });
  });
}

/** The operator explicitly chooses a file; version probing still uses fixed argv and no shell. */
export async function probeMediaTool(id: MediaToolId, absolutePath: string): Promise<{ path: string; version: string }> {
  const entry = DEPENDENCIES.find((item) => item.name === id);
  if (!entry || !isAbsolute(absolutePath) || absolutePath.includes("\0")) throw new Error("MEDIA_TOOL_PATH_INVALID");
  const path = await realpath(absolutePath);
  if (!(await stat(path)).isFile()) throw new Error("MEDIA_TOOL_NOT_A_FILE");
  const result = await probe(id, path, entry.args);
  if (!result.available || !result.version) throw new Error(`MEDIA_TOOL_PROBE_FAILED: ${result.error ?? "unknown"}`);
  return { path, version: result.version };
}

/** Business tools remain available when optional media programs are absent. */
export async function checkDependencies(saveAs?: SaveAs, mediaTools: MediaToolPaths = {}): Promise<DependencyStatus[]> {
  return await Promise.all(DEPENDENCIES.map(async (entry) => {
    const configured = mediaTools[entry.configKey];
    const executable = configured ?? entry.name;
    return {
      name: entry.name,
      ...(await probe(entry.name, executable, entry.args)),
      executable,
      source: configured ? "configured" as const : "path" as const,
      required_for: [...entry.required_for],
      potentially_needed_for_request: saveAs === "video" || saveAs === "audio",
      help_url: entry.help_url,
    };
  }));
}
