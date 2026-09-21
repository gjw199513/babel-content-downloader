import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { checkDependencies, probeMediaTool } from "../runtime/diagnostics/dependencies.js";
import { loadConfig, newConfig, saveConfig } from "../runtime/policy/config.js";

const exec = promisify(execFile);
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "babel-tool-config-")); dirs.push(dir);
  const path = join(dir, "ffmpeg-test");
  await writeFile(path, "#!/bin/sh\nprintf 'ffmpeg version 8.0.1\\n'\n");
  await chmod(path, 0o700);
  return { dir, path: await realpath(path), configPath: join(dir, "config.json") };
}

describe("operator-owned media executables", () => {
  it("probes a fixed tool ID and reports the exact configured executable", async () => {
    const { path } = await fixture();
    expect(await probeMediaTool("ffmpeg", path)).toEqual({ path, version: "ffmpeg version 8.0.1" });
    const reported = (await checkDependencies("audio", { ffmpeg: path })).find((item) => item.name === "ffmpeg");
    expect(reported).toMatchObject({ available: true, version: "ffmpeg version 8.0.1", executable: path, source: "configured" });
    await expect(probeMediaTool("ffmpeg", "relative/ffmpeg")).rejects.toThrow("MEDIA_TOOL_PATH_INVALID");
    await expect(probeMediaTool("other" as "ffmpeg", path)).rejects.toThrow("MEDIA_TOOL_PATH_INVALID");
    const wrong = join(path, "..");
    await expect(probeMediaTool("ffmpeg", wrong)).rejects.toThrow("MEDIA_TOOL_NOT_A_FILE");
  });

  it("rejects a version mismatch and invalid config path before it can be selected", async () => {
    const { dir, path, configPath } = await fixture();
    await writeFile(path, "#!/bin/sh\nprintf 'not ffmpeg\\n'\n");
    await expect(probeMediaTool("ffmpeg", path)).rejects.toThrow("MEDIA_TOOL_PROBE_FAILED");
    const config = newConfig();
    config.media_tools = { ffmpeg: "relative/tool" };
    await saveConfig(config, configPath);
    await expect(loadConfig(configPath)).rejects.toThrow("Invalid media_tools");
    config.media_tools = { unknown: join(dir, "tool") } as typeof config.media_tools;
    await saveConfig(config, configPath);
    await expect(loadConfig(configPath)).rejects.toThrow("Invalid media_tools");
  });

  it("sets only an approved absolute tool path in an isolated config", async () => {
    const { path, configPath } = await fixture();
    const env = { ...process.env, BABEL_CONTENT_CONFIG: configPath };
    const command = (...args: string[]) => exec(process.execPath, ["--import", "tsx", "bootstrap/cli.ts", ...args], { cwd: process.cwd(), env });
    await command("set-tool", "ffmpeg", path);
    expect((await loadConfig(configPath)).media_tools).toEqual({ ffmpeg: path });
    await expect(command("set-tool", "ffmpeg", "relative/ffmpeg")).rejects.toThrow();
    await expect(command("set-tool", "other", path)).rejects.toThrow();
    expect((await loadConfig(configPath)).media_tools).toEqual({ ffmpeg: path });
    expect(await readFile(configPath, "utf8")).not.toContain("relative/ffmpeg");
  });

  it("allows a valid cold-starting executable to finish its bounded version probe", async () => {
    const { path } = await fixture();
    await writeFile(path, "#!/bin/sh\nsleep 3.2\nprintf 'ffmpeg version 8.0.1\\n'\n");
    expect(await probeMediaTool("ffmpeg", path)).toEqual({ path, version: "ffmpeg version 8.0.1" });
  }, 12_000);
});
