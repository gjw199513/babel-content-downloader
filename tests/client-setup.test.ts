import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clientConfigStatus, installClientConfig, removeClientConfig, type ClientSetupOptions, type McpClient } from "../bootstrap/client-setup.js";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

const fixtureCli = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const client = path.basename(process.argv[1]);
const argv = process.argv.slice(2);
const file = process.env.BABEL_TEST_CLIENT_FILE;
fs.appendFileSync(process.env.BABEL_TEST_LOG, JSON.stringify({ client, argv }) + "\n");
const initial = client === "codex" ? { entries: [{ name: "other", enabled: true, transport: { type: "stdio", command: "other", args: [] } }] } : { mcpServers: { other: { type: "stdio", command: "other", args: [] } } };
const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : initial;
function save() { fs.writeFileSync(file, JSON.stringify(data)); }
function entry(name) { return client === "codex" ? data.entries.find(item => item.name === name) : data.mcpServers[name]; }
function add(name, command, args, env) {
  if (entry(name)) process.exit(3);
  if (client === "codex") data.entries.push({ name, enabled: true, disabled_reason: null, transport: { type: "stdio", command, args, env, env_vars: [], cwd: null }, startup_timeout_sec: null, tool_timeout_sec: null, auth_status: "unsupported" });
  else data.mcpServers[name] = { type: "stdio", command, args, env };
  save();
}
const envValue = argv[argv.indexOf("--env") + 1];
const env = envValue ? { BABEL_CONTENT_CONFIG: envValue.slice("BABEL_CONTENT_CONFIG=".length) } : {};
if (process.env.BABEL_TEST_DROP_ENV === "1") delete env.BABEL_CONTENT_CONFIG;
if (client === "codex") {
  if (argv.join(" ") === "mcp list --json") console.log(JSON.stringify(data.entries));
  else if (argv[0] === "mcp" && argv[1] === "get" && argv[3] === "--json") { const found = entry(argv[2]); if (!found) process.exit(2); console.log(JSON.stringify(found)); }
  else if (argv[0] === "mcp" && argv[1] === "add") { const separator = argv.indexOf("--"); add(argv[2], argv[separator + 1], argv.slice(separator + 2), env); }
  else if (argv[0] === "mcp" && argv[1] === "remove") { data.entries = data.entries.filter(item => item.name !== argv[2]); save(); }
  else process.exit(4);
} else {
  if (argv[0] === "mcp" && argv[1] === "get") { if (!entry(argv[2])) { console.error("No MCP server found with name: " + argv[2]); process.exit(1); } console.log(argv[2] + "\n  Scope: User config\n  Type: stdio"); }
  else if (argv[0] === "mcp" && argv[1] === "add") { const separator = argv.indexOf("--"); add(argv[separator - 1], argv[separator + 1], argv.slice(separator + 2), env); }
  else if (argv[0] === "mcp" && argv[1] === "remove") { delete data.mcpServers[argv[4]]; save(); }
  else process.exit(4);
}
`;

async function fixture(client: McpClient): Promise<{ options: ClientSetupOptions; file: string; log: string; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), `babel-client-${client}-`)); dirs.push(dir);
  const cli = join(dir, client);
  const file = join(dir, "client-config.json");
  const log = join(dir, "cli-calls.jsonl");
  const proxyScript = join(dir, "cli.js");
  await writeFile(cli, `#!${process.execPath}\n${fixtureCli}`);
  await chmod(cli, 0o700);
  await writeFile(proxyScript, "// fixture proxy path\n");
  const options: ClientSetupOptions = { client, clientId: `${client}-grant`, stateDir: join(dir, "runtime-state"), runtimeConfigPath: join(dir, "runtime config with spaces", "config.json"), cliExecutable: cli, nodeExecutable: process.execPath, proxyScript,
    claudeConfigPath: file, commandEnv: { ...process.env, BABEL_TEST_CLIENT_FILE: file, BABEL_TEST_LOG: log } };
  return { options, file, log, dir };
}

async function calls(path: string): Promise<Array<{ client: string; argv: string[] }>> {
  return (await readFile(path, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
}

describe("single-entry client MCP setup", () => {
  for (const client of ["codex", "claude"] as const) {
    it(`${client} adds and removes only its named entry with official argument arrays`, async () => {
      const { options, file, log } = await fixture(client);
      expect((await clientConfigStatus(options)).state).toBe("uninstalled");
      const installed = await installClientConfig(options);
      expect(installed.state).toBe("waiting_client_reload");
      expect(installed.next_action).toContain("babel_content_check");
      const data = JSON.parse(await readFile(file, "utf8"));
      expect(client === "codex" ? data.entries.find((item: { name: string }) => item.name === "other") : data.mcpServers.other).toBeTruthy();
      const named = client === "codex" ? data.entries.find((item: { name: string }) => item.name === "babel-content-downloader").transport : data.mcpServers["babel-content-downloader"];
      expect(named.command).toBe(process.execPath);
      expect(named.args).toEqual([options.proxyScript, "mcp", options.clientId]);
      expect(named.env).toEqual({ BABEL_CONTENT_CONFIG: options.runtimeConfigPath });
      const recorded = await calls(log);
      expect(recorded.find((item) => item.argv[1] === "add")?.argv).toEqual(client === "codex"
        ? ["mcp", "add", "babel-content-downloader", "--env", `BABEL_CONTENT_CONFIG=${options.runtimeConfigPath}`, "--", process.execPath, options.proxyScript!, "mcp", options.clientId]
        : ["mcp", "add", "--scope", "user", "--transport", "stdio", "--env", `BABEL_CONTENT_CONFIG=${options.runtimeConfigPath}`, "babel-content-downloader", "--", process.execPath, options.proxyScript!, "mcp", options.clientId]);
      expect((await installClientConfig(options)).state).toBe("waiting_client_reload");
      expect((await removeClientConfig(options)).state).toBe("uninstalled");
      const after = JSON.parse(await readFile(file, "utf8"));
      expect(client === "codex" ? after.entries.map((item: { name: string }) => item.name) : Object.keys(after.mcpServers)).toEqual(["other"]);
      expect((await calls(log)).find((item) => item.argv[1] === "remove")?.argv).toEqual(client === "codex"
        ? ["mcp", "remove", "babel-content-downloader"] : ["mcp", "remove", "--scope", "user", "babel-content-downloader"]);
    });

    it(`${client} refuses preexisting names and changed entries without touching other servers`, async () => {
      const { options, file, log } = await fixture(client);
      await writeFile(file, JSON.stringify(client === "codex" ? { entries: [{ name: "other", transport: { type: "stdio", command: "other", args: [] } }, { name: "babel-content-downloader", transport: { type: "stdio", command: "foreign", args: [] } }] }
        : { mcpServers: { other: { command: "other" }, "babel-content-downloader": { type: "stdio", command: "foreign", args: [] } } }));
      expect((await clientConfigStatus(options)).state).toBe("foreign_name_conflict");
      await expect(installClientConfig(options)).rejects.toThrow("CLIENT_MCP_NAME_CONFLICT");
      expect((await calls(log)).some((item) => item.argv[1] === "remove" || item.argv[1] === "add")).toBe(false);
      await writeFile(file, JSON.stringify(client === "codex" ? { entries: [{ name: "other", transport: { type: "stdio", command: "other", args: [] } }] }
        : { mcpServers: { other: { command: "other" } } }));
      await installClientConfig(options);
      const changed = JSON.parse(await readFile(file, "utf8"));
      if (client === "codex") changed.entries.find((item: { name: string }) => item.name === "babel-content-downloader").transport.env.EXTRA = "changed";
      else changed.mcpServers["babel-content-downloader"].env.EXTRA = "changed";
      await writeFile(file, JSON.stringify(changed));
      expect((await clientConfigStatus(options)).state).toBe("configuration_changed");
      await expect(removeClientConfig(options)).rejects.toThrow("CLIENT_MCP_ENTRY_CHANGED");
      expect(JSON.parse(await readFile(file, "utf8"))).toEqual(changed);
    });
  }

  it("reports a partially added entry when post-add verification fails, without claiming ownership", async () => {
    const { options, file, log } = await fixture("codex");
    options.commandEnv = { ...options.commandEnv, BABEL_TEST_DROP_ENV: "1" };
    await expect(installClientConfig(options)).rejects.toThrow("the CLI may have added the named entry");
    const entries = JSON.parse(await readFile(file, "utf8")).entries;
    expect(entries.map((item: { name: string }) => item.name)).toEqual(["other", "babel-content-downloader"]);
    expect((await clientConfigStatus(options)).state).toBe("foreign_name_conflict");
    expect((await calls(log)).some((item) => item.argv[1] === "remove")).toBe(false);
  });
});
