# Agent setup and local runtime lifecycle

This is the authoritative Agent-facing setup flow for a source checkout/source ZIP or a verified, precompiled local TGZ. The project is not published to npm or an extension store yet. A local candidate release must be accompanied by its completed `release-manifest.json` and `SHA256SUMS`. The `bootstrap-manifest.json` template in the checkout and TGZ deliberately has `template: true` and no version, download URL, or archive digest; it is not completed release metadata.

Managed background startup in this revision is implemented only for a macOS user session. Version 0.1.8 passed both isolated fixtures and a real launchctl check using an independently built source archive, a temporary plist directory, and a separate config/port. A persistent user installation and actual Agent host reload remain separate acceptance steps. Windows and Linux return `unsupported`; do not present the foreground development command as equivalent managed delivery on those systems.

## Prepare the exact installation

Node.js 22.13.0 or newer is required. Keep npm's default optional dependencies; do not use `--omit=optional`.

For a source checkout or unpacked source ZIP, run the build in its root and retain that absolute directory:

```sh
npm ci
npm run build
export BABEL_CLI="$PWD/dist/bootstrap/cli.js"
export BABEL_EXTENSION_DIR="$PWD/dist/extension"
```

For a verified precompiled local TGZ, first verify its filename, size, and digest against the completed `release-manifest.json` and `SHA256SUMS` beside the release artifacts. Install it into an absolute directory that will remain in place. The TGZ already contains compiled runtime and extension files, so do not run `npm ci` or `npm run build` inside it:

```sh
export BABEL_INSTALL_ROOT=/absolute/path/to/babel-content-downloader-install
export BABEL_TGZ=/absolute/path/to/babel-content-downloader-0.1.21.tgz
npm install --prefix "$BABEL_INSTALL_ROOT" --omit=dev "$BABEL_TGZ"
export BABEL_CLI="$BABEL_INSTALL_ROOT/node_modules/babel-content-downloader/dist/bootstrap/cli.js"
export BABEL_EXTENSION_DIR="$BABEL_INSTALL_ROOT/node_modules/babel-content-downloader/dist/extension"
```

Both paths now use the same compiled entrypoint:

```sh
node "$BABEL_CLI" init
```

Load the actual absolute directory represented by `$BABEL_EXTENSION_DIR` as an unpacked Chromium 120+ extension. Read its actual extension ID, choose an absolute output root for this Agent, then create the two scoped grants:

```sh
node "$BABEL_CLI" allow-extension <actual-32-character-extension-id>
node "$BABEL_CLI" add-client codex /absolute/authorized/output/root
```

The config must be an owner-only regular file. If `BABEL_CONTENT_CONFIG` selects a custom config, keep that exact absolute path in the environment for every command below. The managed service receipt binds that path, the current Node executable, and the compiled CLI at the resolved absolute `$BABEL_CLI` path. Do not move or delete the source or installation directory while the service is installed. The receipt never copies a client bearer token into the LaunchAgent plist.

## Install and verify the macOS service

Stop any manually launched runtime using the same configured port before installation. `runtime-install` refuses an occupied loopback port and never kills or adopts the process using it.

```sh
node "$BABEL_CLI" runtime-install
node "$BABEL_CLI" runtime-status
```

The owned LaunchAgent uses the fixed label `com.babel-content-downloader.runtime`, `RunAtLoad=true`, `KeepAlive=true`, and a ten-second launchd throttle. It launches the exact absolute Node and compiled CLI paths with `serve`, passing only the exact `BABEL_CONTENT_CONFIG` path. Runtime output goes to the config's state directory under `runtime-service/`.

Installation is successful only when status reports all of the following:

- `state: "running"`
- `health: "ready"`
- `loaded: true`
- `restart_required: false`

`launchctl bootstrap` returning success or a PID appearing is not enough. The installer also makes an authenticated MCP `initialize` request with an existing client grant and verifies both the Babel server identity and its reported version against the currently installed package. Status distinguishes `installed_version`, the last health-verified `applied_version`, and a currently observed `running_version`. A foreign job using the same label, a changed plist or ownership receipt, or an unexpected loaded program/path is reported as `configuration_changed` and is never stopped or replaced automatically.

The service is shared by all registered local clients. Each client starts only its small stdio proxy; proxies authenticate independently and forward to the same loopback runtime instance.

## Add the Agent MCP entry

For Codex:

```sh
node "$BABEL_CLI" install-client-config codex
```

The expected result is `waiting_client_reload`. Reload Codex, confirm that its actual tool list contains the eight `babel_content_*` tools, then call `babel_content_check` through that host. Confirm the specific browser instance is connected and not paused before declaring setup complete. An MCP config entry, CLI list result, launchd PID, or direct HTTP call alone is not this proof.

For Claude Code, first create a separate `claude` client grant and use `install-client-config claude`. The implementation has isolated CLI fixtures, but a real Claude Code installation was not available in the recorded macOS preflight; keep that client marked pending until it is actually loaded and calls the tools.

## Runtime operations

```sh
node "$BABEL_CLI" runtime-status
node "$BABEL_CLI" runtime-stop
node "$BABEL_CLI" runtime-start
```

`runtime-stop` unloads only the receipt-owned LaunchAgent and leaves its plist available for a later start. `runtime-start` loads a stopped service. If operator config content changed, status reports `restart_required`; the same command restarts the owned service and records the new config hash only after the authenticated endpoint becomes ready. Config changes never remove ownership of the existing service, so stop and uninstall remain available.

The service controls launchd by its verified label, plist path, absolute program and arguments. It does not find or signal a PID by port. If another process occupies the configured port, it reports the conflict and leaves that process untouched.

## Reversible removal

Remove the client MCP entry while its ownership receipt still matches, then uninstall the service:

```sh
node "$BABEL_CLI" remove-client-config codex
node "$BABEL_CLI" runtime-uninstall
node "$BABEL_CLI" remove-client codex
node "$BABEL_CLI" revoke-extension <actual-32-character-extension-id>
```

`runtime-uninstall` unloads the verified job and deletes only its LaunchAgent plist and service receipt. It preserves the runtime config, client/job records, logs, collected artifacts, output roots, media tools, and unrelated services. A changed or unowned service is left in place for manual inspection.

## Current evidence boundary

On 2026-09-19, an independent 0.1.8 source archive installed dependencies and produced 49 compiled files identical to the checked build. A real launchctl job, using an isolated plist directory/config/port, remained healthy after the installing command exited. Two actual stdio proxy processes authenticated as separate clients to the shared 0.1.8 runtime and each discovered eight tools. Stop/start changed the owned PID; uninstall removed only the plist and receipt, preserved the config/job directory/output sentinel, and left no listener or owned process.

This check did not write the user's real `~/Library/LaunchAgents`, change actual Codex/Claude configuration, connect a browser, or touch the development runtime on port 4318. Login/reboot persistence from the default LaunchAgents directory and actual Codex reload/tool discovery remain unverified. The local evidence is under `.audit/build-0.1.8/real-service-*` and is excluded from distributed packages.
