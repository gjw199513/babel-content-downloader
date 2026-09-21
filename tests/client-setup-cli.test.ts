import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, newConfig, saveConfig } from "../runtime/policy/config.js";

const exec = promisify(execFile);
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

describe("client setup CLI revocation", () => {
  it("removes only the named runtime grant and extension ID in an isolated config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "babel-setup-cli-")); dirs.push(dir);
    const configPath = join(dir, "runtime config with spaces", "config.json");
    const config = newConfig();
    config.state_dir = join(dir, "state");
    config.clients = [
      { id: "codex", token: "codex-token", output_roots: [dir] },
      { id: "claude", token: "claude-token", output_roots: [dir] },
    ];
    const first = "abcdefghijklmnopabcdefghijklmnop";
    const second = "ponmlkjihgfedcbaponmlkjihgfedcba";
    config.allowed_extension_ids = [first, second];
    await saveConfig(config, configPath);
    const env = { ...process.env, BABEL_CONTENT_CONFIG: configPath };
    const run = (...args: string[]) => exec(process.execPath, ["--import", "tsx", "bootstrap/cli.ts", ...args], { cwd: process.cwd(), env });
    await run("remove-client", "codex");
    await run("revoke-extension", first);
    const after = await loadConfig(configPath);
    expect(after.clients).toEqual([config.clients[1]]);
    expect(after.allowed_extension_ids).toEqual([second]);
    await expect(run("remove-client", "../other")).rejects.toThrow();
    await expect(run("revoke-extension", "wrong-id")).rejects.toThrow();
    expect(await loadConfig(configPath)).toEqual(after);
  });
});
