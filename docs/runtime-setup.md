# Local runtime setup

This covers a source checkout/source ZIP and a verified, precompiled local TGZ for Babel Content Downloader. See [package validation](package-validation.md) for the exact build and archive evidence, and [Agent setup](agent-setup.md) for managed runtime installation. No package registry or extension-store address is claimed here. The extension and runtime must run on the same computer. A local candidate release uses the completed `release-manifest.json` and `SHA256SUMS` beside its artifacts; the `bootstrap-manifest.json` shipped in the source and TGZ is only an unpublished template.

## Prepare and register

Use Node.js 22.13.0 or newer and retain the package manager's default optional dependencies: sharp needs the binary selected for this OS and CPU. Do not use `--omit=optional` for a normal installation.

For a source checkout or unpacked source ZIP, build from its root and keep that directory at a stable absolute path:

```sh
npm ci
npm run build
export BABEL_CLI="$PWD/dist/bootstrap/cli.js"
export BABEL_EXTENSION_DIR="$PWD/dist/extension"
```

For a verified precompiled local TGZ, verify the artifact against the completed release manifest and checksums, then install it into an absolute directory that will remain in place. It is already built:

```sh
export BABEL_INSTALL_ROOT=/absolute/path/to/babel-content-downloader-install
export BABEL_TGZ=/absolute/path/to/babel-content-downloader-0.1.26.tgz
npm install --prefix "$BABEL_INSTALL_ROOT" --omit=dev "$BABEL_TGZ"
export BABEL_CLI="$BABEL_INSTALL_ROOT/node_modules/babel-content-downloader/dist/bootstrap/cli.js"
export BABEL_EXTENSION_DIR="$BABEL_INSTALL_ROOT/node_modules/babel-content-downloader/dist/extension"
```

Do not run the source-only `npm ci` or `npm run build` steps inside the TGZ installation. Both paths continue with the compiled absolute entrypoint:

```sh
node "$BABEL_CLI" init
```

Load the actual absolute directory represented by `$BABEL_EXTENSION_DIR` as an unpacked Chromium 120+ extension. Copy its actual extension ID from the welcome page or browser extension details. Authorize only that ID, and give each local Agent client an explicit output root:

```sh
node "$BABEL_CLI" allow-extension <actual-32-character-extension-id>
node "$BABEL_CLI" add-client codex /absolute/path/to/authorized/materials
node "$BABEL_CLI" runtime-install
node "$BABEL_CLI" install-client-config codex
node "$BABEL_CLI" runtime-status
```

On macOS, `runtime-install` starts an owned user LaunchAgent, independent of the installing terminal, on `127.0.0.1:4318` by default. It refuses a port or service label already used by another process. Status must report `running`, `health: ready`, and no required restart; an accepted launchd command alone is not readiness. Use `runtime-stop`, `runtime-start`, and `runtime-uninstall` to manage only this project's owned service. A changed config or installed runtime version requires `runtime-start` to restart the service. Other operating systems do not yet have a managed startup implementation; `serve` remains the explicit foreground development command. Actual validation limits are recorded in [Agent setup](agent-setup.md).

The config lives at `~/.config/babel-content-downloader/config.json` by default, and job records live under `~/.local/share/babel-content-downloader/jobs/`. The runtime creates the config with owner-only permissions and stores client tokens there; do not paste those tokens into the extension welcome text or chat.

`install-client-config` uses the installed Codex CLI's official `mcp list/get/add` commands to add only a server named `babel-content-downloader`. It refuses an existing server with that name unless its own prior installation receipt matches exactly. The result is `waiting_client_reload`: reload Codex, then actually call `babel_content_check` through its tools and inspect the paired browser status before declaring the connection usable. A successful CLI add or MCP listing alone does not prove that the host loaded the tool or that the browser connected. See [Codex's MCP configuration guide](https://developers.openai.com/zh-Hans/docs/extend/mcp).

On 2026-09-19, a read-only check of the installed macOS Codex CLI (`0.155.0-alpha.9`) confirmed that `mcp list --json` returns the expected array and the project's status reader reports `uninstalled`. There were six existing entries and no Babel entry; the actual Codex configuration hash was unchanged. This verifies the read path against a real CLI, not MCP installation or host tool loading. Claude Code was not available on that `PATH`, so its actual-client check remains pending.

For Claude Code, register a separate client grant and use its official CLI. The installer chooses Claude's private user scope so the entry is available across the user's projects without adding a repository `.mcp.json` file:

```sh
node "$BABEL_CLI" add-client claude /absolute/path/to/authorized/materials
node "$BABEL_CLI" install-client-config claude
```

Reload Claude Code and call `babel_content_check` through that host. Claude's local/project/user MCP scopes and CLI commands are described in its [official MCP guide](https://code.claude.com/docs/en/mcp). If a named CLI is missing, installation stops without changing the existing client configuration. Configuration entries remain separate from any pre-existing MCP services, including an installed `mcp-chrome`.

The local stdio proxy command is also available for other MCP clients. Configure an entry to launch it with that client's registered ID:

```sh
# Source checkout or source ZIP:
node /absolute/source/root/dist/bootstrap/cli.js mcp codex

# Precompiled local TGZ:
node /absolute/install/root/node_modules/babel-content-downloader/dist/bootstrap/cli.js mcp codex
```

Replace the example with the resolved absolute value of `$BABEL_CLI`: for a TGZ installation this includes `node_modules/babel-content-downloader/dist/bootstrap/cli.js`. Store that literal path in an MCP client's argument array rather than the shell variable. The proxy reads the client's token from the owner-only config and forwards MCP messages to the local runtime. The installer records the exact absolute `BABEL_CONTENT_CONFIG` path as a per-server environment variable, including when a custom path contains spaces; it never copies the token into the MCP entry. Clients that support authenticated Streamable HTTP may instead use `http://127.0.0.1:4318/mcp` with their own bearer token. Keep each client's grant separate; a client can list and resume only its own jobs, and every output directory must remain inside its authorized root. The `BABEL_CONTENT_CONFIG` environment variable can select a different operator-owned config file.

Check or remove the managed Codex/Claude entry without rewriting the client's whole configuration:

```sh
node "$BABEL_CLI" client-config-status codex
node "$BABEL_CLI" remove-client-config codex
node "$BABEL_CLI" remove-client codex
node "$BABEL_CLI" revoke-extension <actual-32-character-extension-id>
```

Replace `codex` with `claude` for Claude Code. Remove the MCP entry before revoking its runtime client grant. Removal uses only that client's official `mcp remove` command and only if the current named entry still matches this runtime's saved fingerprint; a changed or unowned entry is left untouched. The last two commands remove only the named client grant and actual extension ID. Restart the runtime to apply these revocations, and use the extension's **Revoke** control to clear its current pairing. These commands do not delete collected files, job records, or shared media dependencies. Keep a backup before removing the runtime package or operator configuration, because existing jobs and their authorization belong there.

The default DNS mode is `system`. If the computer's DNS returns reserved interception addresses for a supported platform, the local operator can choose Cloudflare's DNS-over-HTTPS resolver and restart the runtime:

```sh
node "$BABEL_CLI" set-dns cloudflare
```

Use `set-dns system` to restore the default. This setting is read only from the operator's runtime config, never from a page or MCP request. The alternate resolver receives only allowed platform and asset hostnames, without page paths, query parameters, or credentials. Resolved addresses must still pass the same public-address check; private and reserved addresses remain blocked. It does not change the operating system's DNS or VPN settings.

## Check the actual connection

Once the runtime is running and the extension has registered, call `babel_content_check`. It reports the paired browser instance, matching adapter, and optional dependency state. A browser connection, an installed command-line dependency, a successful platform extraction, and a usable final file are distinct checks. A missing `yt-dlp`, `ffmpeg`, or `ffprobe` is reported when relevant; it does not prevent the basic MCP tools from starting. Install media programs from their official distribution channels, then call `babel_content_job_resume` for a blocked job. The runtime does not run installation commands supplied by a page.

The aggregate browser connection only means that at least one paired instance is available. Check the heartbeat and paused state of the specific `instance_ref` bound to a task; a new instance does not automatically take over a task assigned to an offline instance. Runtime 0.1.4 also reports per-instance `connected` and `state` values, using the same 90-second heartbeat boundary as task routing. Rebuilding an unpacked extension directory alone does not reload it in Chrome.

Through 0.1.6, the reported extension version is cached when the bridge session registers. Reloading the extension can reuse that session, so an active heartbeat with an old version does not prove the reload failed. Once all collections and scheduled retries are idle, restarting only this runtime forces a fresh registration and version report. Do not repeatedly ask the user to reload based solely on the cached field. From 0.1.7, the extension includes its current version in authenticated polls and the matching runtime refreshes that status without replacing the session. Legacy clients can omit the field. This remains the extension's reported version, not an attestation of its loaded file bytes.

If an installed media program is outside the runtime's `PATH`, an operator can register its actual absolute executable path. `set-tool` runs a bounded version probe with fixed arguments before saving, accepts only the three named tools, and does not change the system `PATH`. Restart the runtime, confirm the configured path and version with `babel_content_check`, then resume the blocked job:

```sh
node "$BABEL_CLI" set-tool yt-dlp /absolute/path/to/yt-dlp
node "$BABEL_CLI" set-tool ffmpeg /absolute/path/to/ffmpeg
node "$BABEL_CLI" set-tool ffprobe /absolute/path/to/ffprobe
```

Normal collection uses `babel_content_collect` with one URL or an explicit `{instance_ref, tab_id}` target, a `save_as` purpose or nonempty `include` list, and an authorized absolute output directory. `save_as` and `include` are mutually exclusive. Long work returns a job ID; `babel_content_job_get` reports progress, actual artifacts, missing components, and recovery details. `babel_content_browser_observe` and `babel_content_browser_act` require a client-owned job ID. Browser actions use adapter-approved target IDs from a fresh observation, never arbitrary page selectors.

## Pairing and recovery

Extension registration requires its configured ID and `chrome-extension://<ID>` Origin. The runtime returns a session token directly to the extension; subsequent polling and responses require that token, session ID, and matching request nonce. An unregistered extension receives `PAIRING_NEEDED`. Pausing stops its polling; revoking clears its session and keeps the extension paused until the user explicitly connects again. Closing or restarting the browser leaves persistent jobs in the local runtime. After a runtime restart, interrupted jobs are marked `blocked` with `INTERRUPTED` and can be resumed after the browser reconnects. Signed URL parameters are not written to job records; if such a URL is needed after restart, `job_get` reports `FRESH_URL_REQUIRED` and `job_resume` accepts `refreshed_url` for the same content identity.

The job runner executes at most two collections globally and one per source origin. Transient network, DNS, browser, or engine timeouts can retry automatically at most twice, with a bounded wait; dependency, access, scope, and output errors remain blocked or failed for explicit repair. A source wait signal longer than the one-minute automatic budget leaves the task blocked for a later resume. Pending automatic retries survive a runtime restart. Cancelling a job clears its pending retry and preserves the cancelled state across restarts.

For a URL request with `tab_strategy: new`, the first attempt creates the task's own muted tab. An automatic retry may reuse only that same task's owned tab; it does not keep creating new tabs or alter the saved request. Temporary content-script readiness failures share the bounded retry budget. A manual resume after a stable error is a separate recovery action; inspect the error and actual browser instance before using it.

Temporary checkpoints and detailed job diagnostics expire after seven days by default. The runner removes only temporary files explicitly recorded as generated by that job whose size and SHA-256 still match; unrecorded or modified files remain untouched, and final artifacts never expire automatically. Operators may set the retention periods in days and restart the runtime to apply them:

```sh
node "$BABEL_CLI" set-retention checkpoint 7
node "$BABEL_CLI" set-retention logs 7
```

The operator-only `add-fixture-origin` command exists for local development test servers. It is never a field accepted from a content page or an MCP collection request. `BABEL_DEV_FIXTURES=1 npm run build:extension` produces a separate `dist/extension-dev/` with a local fixture host permission; ordinary `dist/extension/` omits it. Published platform coverage must be reported from actual per-platform evidence, not inferred from an adapter name or a media engine's supported-site list.
