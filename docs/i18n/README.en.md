<p align="center"><img src="../brand/logo-preview.png" alt="Babel Content Downloader Logo" width="128" height="128"></p>

# Babel Content Downloader

[English](README.en.md) · [简体中文](../../README.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md)

Let your local AI agent save public webpages, articles, papers, videos and podcasts as material you can read, watch or listen to offline.

**Version 0.1.26 · MIT licensed · Recommended initial environment: macOS + Chrome + a local MCP agent.**

**[Download the v0.1.26 release assets](https://github.com/gjw199513/babel-content-downloader/releases/tag/v0.1.26):** regular users need the runtime TGZ and extension ZIP; installing the extension does not require the source archive.

Give your agent a link and a purpose: “Save this video podcast as audio in my learning folder.” The downloader retrieves content, writes files and reports results. You do not need to choose individual tracks or understand codecs.


The toolbar extension icon opens the wide overview page. **Options** in extension details opens the separate settings page. Both pages can change language; setup commands, connection controls and technical details live in settings.

## Contents

- [Features](#features)
- [Sources and support limits](#sources-and-support-limits)
- [Installation and connection](#installation-and-connection)
- [First use and functional tests](#first-use-and-functional-tests)
- [Output files and job status](#output-files-and-job-status)
- [MCP examples](#mcp-examples)
- [Troubleshooting](#troubleshooting)
- [Updating, stopping and uninstalling](#updating-stopping-and-uninstalling)
- [Development and documentation](#development-and-documentation)

## Language

The overview and settings pages offer **Automatic (browser language)**, English, Simplified Chinese, Traditional Chinese, Japanese and Korean. Automatic mode reads the browser's ordered language preferences and falls back to English when none are supported. A manually selected language is remembered on this computer and takes priority until you choose Automatic again. The selector updates the introduction, setup instructions, usage examples, connection states and common error guidance immediately. Chrome's extension description always follows the browser's language, independently of the in-page selector.

The product name remains **Babel Content Downloader**. Commands, API identifiers, filenames and original downloaded content are not translated. Original technical errors are available under a separate details section; CLI/MCP technical output may retain its original language.

## Features

| What you want | Tell your agent | Save type |
|---|---|---|
| Read an article offline | Save the text and images from this link | `document` |
| Listen to a video podcast | Save this video as audio | `audio` |
| Watch a video offline | Save this video as MP4 | `video` |
| Collect images | Save only this item's images | `images` |
| Keep existing subtitles | Save this video's English subtitles | `subtitles` |
| Read a paper | Save the paper information and original PDF | `bundle` |
| Keep attachments | Save the supported downloadable files in this item | `files` |
| Choose automatically | Save this link | `auto` |

Audio defaults to M4A and video to MP4. You can request MP3/WAV/FLAC, MKV, a source resolution, an audio/video clip, subtitle languages or image indices. Files preserve the source content while allowing audio extraction, track merging and format conversion for use. OCR, transcription, summaries and translation are not built in.

Ordinary blogs use shared HTTP + Mozilla Readability extraction, with browser fallback when needed. Dynamic platforms, papers and media use their corresponding adapters. The downloader processes the explicit target and supported resources, not an entire website recursively.

Task-created tabs are muted before navigation. Background processing does not open a player. Existing user tabs are not automatically played, muted, navigated or closed.

## Sources and support limits

These are **individual sample results**, not a promise that every page on a platform works. Page structure, region, network and access state can change outcomes.

| Source | Sample evidence / limits |
|---|---|
| Public blogs and technical articles | Shared current-page extraction subject to URL, network and access policy; not universal website access |
| Medium, Substack | Text and image delivery; Medium browser fallback and explicit-tab reads verified |
| OpenAI, Anthropic, Google DeepMind | Article and image samples; a DeepMind publication PDF sample also delivered |
| GitHub | Public repository README delivered; Markdown blob currently has `ACCESS_UNCONFIRMED`; release and other routes do not inherit README validation |
| Hugging Face | Model card, dataset card and paper samples; blog sample partially complete due to an image; entire model weights/datasets are not downloaded |
| arXiv | Abstract and original PDF delivered |
| YouTube, Bilibili | Audio/video files delivered and fully decoded; English YouTube VTT delivered, but its job remains `partial` |
| Zhihu | Public article and images delivered |
| X | Partial visible text; image, readiness and timeout gaps remain |
| Reddit | Tested environment blocked by security/login pages; no completed file delivery |
| Xiaohongshu | Tested samples encountered 404/app gates; no completed file delivery |
| WeChat articles | Target drift and access restrictions remain |

There are 15 registered sources, plus eligible ordinary public webpages. Removed sources such as Sohu and Kuaishou are not re-enabled through generic extraction. Only public, free content is in scope; paywalls, private content and DRM are not bypassed.

## Installation and connection

The system has three parts on the same computer: **local runtime, browser extension and agent MCP connection**. Installing the extension alone is not enough.

### 1. Prerequisites and release files

- Node.js **22.13.0 or newer**, with `node` and `npm` available in your terminal.
- Chrome **120 or newer**. Edge and other Chromium browsers need separate environment validation.
- A local agent. Automatic setup supports Codex and Claude Code, with the corresponding CLI already installed.
- Media saving additionally uses `yt-dlp`, `ffmpeg` and `ffprobe`; basic article extraction does not require them.
- Managed background startup currently supports macOS only. Windows/Linux installation support is not complete.

| Release file | Purpose |
|---|---|
| `babel-content-downloader-0.1.26.tgz` | Precompiled runtime for normal installation |
| `babel-content-downloader-extension-0.1.26.zip` | Formal extension; unpack before loading |
| `babel-content-downloader-source-0.1.26.zip` | Source for development or building yourself |
| `SHA256SUMS`, `release-manifest.json`, `verification.json` | Checksums, release inventory and validation record |

Normal users can download the extension ZIP directly from the Release without downloading or building the source package. See the [multilingual extension installation guide](../extension-install.md). Chrome currently requires “unpack, then Load unpacked”; a true one-click install requires the planned Chrome Web Store release in the [release roadmap](../release-roadmap.md).

Run the following in a macOS terminal. Replace `/absolute/path/...` with your actual **absolute paths**. Set the shell variables again if you open another terminal.

```sh
export BABEL_RELEASE_DIR=/absolute/path/to/release-files
cd "$BABEL_RELEASE_DIR"
shasum -a 256 -c SHA256SUMS

export BABEL_INSTALL_ROOT="$HOME/Applications/babel-content-downloader"
npm install --prefix "$BABEL_INSTALL_ROOT" --omit=dev "$BABEL_RELEASE_DIR/babel-content-downloader-0.1.26.tgz"
export BABEL_CLI="$BABEL_INSTALL_ROOT/node_modules/babel-content-downloader/dist/bootstrap/cli.js"
node "$BABEL_CLI" init
```

Keep npm's default optional dependencies; do not use `--omit=optional`. Image handling needs the OS-specific binary. The TGZ is already compiled, so do not run `npm run build` inside it. For full checksum verification, download all files listed in `SHA256SUMS` into the same directory.

### 2. Load the extension

The runtime package includes the same formal extension as the ZIP. The simplest option is to load it directly:

```sh
export BABEL_EXTENSION_DIR="$BABEL_INSTALL_ROOT/node_modules/babel-content-downloader/dist/extension"
printf '%s\n' "$BABEL_EXTENSION_DIR"
```

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the directory printed above. Alternatively, unpack the extension ZIP into a stable directory and load the directory directly containing `manifest.json`. Choose one method; do not load duplicate copies.

Confirm version `0.1.26`. Installation opens the welcome page. If closed, copy the actual 32-character extension ID from the extension manager and open `chrome-extension://ACTUAL_EXTENSION_ID/welcome/index.html` in Chrome. Do not use `dist/extension-dev`; it is for development fixtures.

Choose your language at the top of the welcome page. This changes instructions and labels without changing pairing or permissions.

### 3. Authorize a folder and start the runtime

For first-time Codex setup:

```sh
export BABEL_EXTENSION_ID=REPLACE_WITH_ACTUAL_32_CHARACTER_ID
export BABEL_OUTPUT_ROOT="$HOME/Documents/BabelLibrary"
node "$BABEL_CLI" allow-extension "$BABEL_EXTENSION_ID"
node "$BABEL_CLI" add-client codex "$BABEL_OUTPUT_ROOT"
node "$BABEL_CLI" runtime-install
node "$BABEL_CLI" runtime-status
printf 'Library folder: %s\n' "$BABEL_OUTPUT_ROOT"
```

Remember the printed absolute folder and give it to your agent. Jobs may write only within that client's authorized root.

`runtime-status` should show `state: "running"`, `health: "ready"`, `loaded: true` and `restart_required: false`. Return to the overview and select **Connect local runtime**. If paused, open settings and select **Resume**.

Existing users should follow the update section instead of repeatedly calling `add-client`. After changing authorization, tool paths or clients, use `runtime-start` to apply the configuration.

### 4. Connect your agent

For Codex:

```sh
node "$BABEL_CLI" install-client-config codex
```

After `waiting_client_reload`, reload Codex and ask:

> Call Babel Content Downloader's babel_content_check. Check the local runtime, browser connection and media dependencies, and tell me which functions are ready.

There should be ten MCP tools, including nine `babel_content_*` tools. `babel_content_get_asr_guide` is read-only Agent-side ASR guidance and does not run transcription. Browser-based work needs its target extension instance connected and not paused. A URL document check may return `ready_http` with `browser_required: false`; this means HTTP extraction can be attempted, not that the network request has already succeeded.

For first-time Claude Code setup, replace `codex` with `claude` in step 3, then run `install-client-config claude`. To add Claude Code to an existing runtime:

```sh
node "$BABEL_CLI" add-client claude "$BABEL_OUTPUT_ROOT"
node "$BABEL_CLI" runtime-start
node "$BABEL_CLI" install-client-config claude
```

Reload Claude Code and actually call the check tool. Setup manages only this project's MCP entry. It refuses to overwrite an existing same-name entry not owned by this installation.

For another stdio MCP client, register a separate ID, for example with `add-client my-agent "$BABEL_OUTPUT_ROOT"`, then `runtime-start`. A typical client configuration looks like this; adapt the outer structure to your client:

```json
{
  "mcpServers": {
    "babel-content-downloader": {
      "command": "/absolute/path/to/node",
      "args": [
        "/absolute/path/to/babel-content-downloader-install/node_modules/babel-content-downloader/dist/bootstrap/cli.js",
        "mcp",
        "my-agent"
      ]
    }
  }
}
```

Use real paths. JSON does not expand `$HOME`, `~` or `$BABEL_CLI`. Do not paste runtime tokens into this configuration.

### 5. Media dependencies, when needed

Install media tools from their official distributions and verify:

```sh
yt-dlp --version
ffmpeg -version
ffprobe -version
```

If they work in your terminal but the background service cannot find them, register their executable paths:

```sh
node "$BABEL_CLI" set-tool yt-dlp "$(command -v yt-dlp)"
node "$BABEL_CLI" set-tool ffmpeg "$(command -v ffmpeg)"
node "$BABEL_CLI" set-tool ffprobe "$(command -v ffprobe)"
node "$BABEL_CLI" runtime-start
```

Have the agent check again and resume the original blocked job. Missing tools do not require reinstalling the extension.

## First use and functional tests

**Submit requests in the agent conversation, not on the extension page.** The extension page manages connection, pause and revocation.

Start with an article, then a paper, then media. Replace `<URL>` and folder placeholders with real values. Pick public content you can read in your browser without logging in. A site's temporary access failure is not necessarily an installation failure.

### A. Article

> Use Babel Content Downloader to save the text and images of this public article `<ARTICLE_URL>` to `/MY/ABSOLUTE/LIBRARY`. Use document. Wait for the job to finish and return the job ID, actual status, document path, image count and missing items, not just a submission confirmation.

Open `content.md`: the text should be readable, images should reference local files, and metadata should identify the source. `partial` requires inspecting missing items.

### B. Paper and PDF

> Save this paper `<ARXIV_ABSTRACT_URL>` as a bundle to `/MY/ABSOLUTE/LIBRARY`, including the paper information and original PDF. Return the PDF path and any missing items.

Use a paper detail/abstract URL such as `https://arxiv.org/abs/PAPER_ID`, rather than a raw PDF URL for this test. Actually open the PDF.

### C. Audio from a video podcast

> Save this video `<YOUTUBE_OR_BILIBILI_VIDEO_URL>` as MP3 to `/MY/ABSOLUTE/LIBRARY`. Keep the task tab muted and do not play the exported file automatically. Return the audio path, duration, status and missing items.

Open the MP3 yourself, listen and check its duration. File existence alone is not a listening check.

### D. Video or clip

> Save seconds 60–120 of `<VIDEO_URL>` as MP4 to `/MY/ABSOLUTE/LIBRARY`. Return the path, actual duration and status. Do not automatically play it.

The source must be longer than 120 seconds. Expect about 60 seconds of playable output with the source's picture and audio. A requested source resolution, such as 720p, may be unavailable; the tool reports this rather than promising another resolution.

### E. Images and existing subtitles

> Save only the images from `<PUBLIC_POST_URL>` to `/MY/ABSOLUTE/LIBRARY`. Return all file paths and missing items.

> Save the existing English subtitles from `<YOUTUBE_VIDEO_URL>` to `/MY/ABSOLUTE/LIBRARY`, with language en. Do not transcribe audio. Report the true job status and subtitle file path.

The source must provide that language. A known initial limitation is usable subtitle output with a `partial` job status. Subtitle clipping is not implemented.

### F. Inspect, resume and cancel

> List recent Babel Content Downloader jobs. Inspect `<JOB_ID>` for status, failure reasons and all saved files, following pagination if needed.

> I have installed the missing dependencies / restored the browser connection. Resume `<JOB_ID>` without submitting a duplicate job.

> Cancel Babel Content Downloader job `<JOB_ID>`.

For `SELECTION_REQUIRED`, tell the agent which returned option you want, such as article, video or audio. It resumes the same job. Cancellation does not delete delivered files.

Additional checks: confirm a job with more than ten files is fully paginated; test that an unauthorized output folder is rejected; record both usable files and job status. For a problem report, include versions, OS/browser/agent, source platform, a sanitized public URL, requested format, job ID, status, error code, saved file count, what happened when opening files, and reproduction steps. Never include tokens or the whole runtime configuration.

## Output files and job status

Each job creates its own result directory inside the authorized folder. Actual names and counts come from `job_get`:

```text
BabelLibrary/
└── Result directory/
    ├── content.md       # Readable document or entry, depending on the task
    ├── assets/          # Images, media, subtitles, PDFs and other saved files
    ├── metadata.json   # Source information, deliverables and recorded processing
    └── assets.json     # Resource relationship manifest
```

Keep the whole directory together when moving it: Markdown uses relative image links. `job_get` returns paths, sizes, SHA256 and pagination; full text stays in local files.

| Status | Meaning |
|---|---|
| `queued`, `resolving`, `collecting`, `downloading`, `finalizing`, `verifying` | Pending or processing; poll at the suggested interval |
| `succeeded` | Requested scope completed; open the files to confirm usability |
| `partial` | Some content is missing; inspect errors, warnings and failed components |
| `blocked` | Waiting for connection, dependencies, a choice or retry; inspect `retry_at` |
| `failed` | Not completed; resolve a recoverable cause before resuming |
| `cancelled` | Cancelled; some files may remain |

## MCP examples

These are **MCP tool arguments**, not terminal commands or HTTP request bodies.

For `babel_content_collect`, save a document:

```json
{
  "target": { "type": "url", "url": "https://example.org/articles/my-article" },
  "save_as": "document",
  "output": { "directory": "/absolute/path/to/authorized/materials" }
}
```

`example.org` is a format placeholder. Replace it with a real article. To extract an MP3 clip:

```json
{
  "target": { "type": "url", "url": "https://www.youtube.com/watch?v=REPLACE_WITH_VIDEO_ID" },
  "save_as": "audio",
  "preferences": { "audio_format": "mp3", "clip": { "start_seconds": 60, "end_seconds": 120 } },
  "output": { "directory": "/absolute/path/to/authorized/materials" }
}
```

Then call `babel_content_job_get`:

```json
{ "job_id": "REPLACE_WITH_ACTUAL_JOB_ID", "artifact_offset": 0, "artifact_limit": 50 }
```

Use `artifact_page.next_offset` for the next page when non-null. A `queued` submission is not a completed download.

| Tool | Purpose |
|---|---|
| `babel_content_check` | Inspect runtime, route, browser and dependencies; optional `target` and `save_as` |
| `babel_content_collect` | Submit one explicit URL or tab |
| `babel_content_job_get` | Read status, missing items and file pages |
| `babel_content_job_resume` | Resume; optional `save_as` choice or `refreshed_url` for the same content |
| `babel_content_job_cancel` | Cancel a job |
| `babel_content_jobs_list` | List current-client jobs with `offset` and `limit` |
| `babel_content_browser_observe` | Observe the page for a specified `job_id` |
| `babel_content_browser_act` | Perform allowed task-scoped scroll, expand or muted-play actions |

Use either `save_as` or `include`, never both. `include` accepts `text`, `images`, `video`, `audio`, `subtitles`, `cover`, `files`.

Optional `preferences`: `audio_format` (`m4a`, `mp3`, `wav`, `flac`), `video_format` (`mp4`, `mkv`), `video_height`, `subtitle_languages` (for example `["en"]`), `image_indices` (1-based, for example `[1,3]`), and `clip` with start/end seconds. Source availability still applies. `output.collision_policy` is `version` or `fail`.

An explicit tab target is `{"type":"tab","instance_ref":"ACTUAL_INSTANCE","tab_id":123}`. Obtain actual values rather than guessing; the MCP interface has no tool to list all browser tabs. Prefer URLs for ordinary use. `browser.tab_strategy: "existing"` can attempt to match an existing page. Matching and read-only restrictions still apply.

## Troubleshooting

| Symptom | What to check |
|---|---|
| Agent has no tools | Verify its CLI, run `client-config-status codex`, reload the agent and actually call the check tool |
| Waiting for authorization | Verify the actual extension ID; use `allow-extension`, `runtime-start`, then connect |
| `waiting_browser` or paused | Keep Chrome open, connect/resume the extension, and check the specific instance bound to the job |
| Old extension version | Building does not reload Chrome; verify the loaded directory, reload once and check the welcome page |
| `CLIENT_ALREADY_EXISTS` | The client is registered; do not repeatedly register or delete it just to clear the error |
| Port occupied | Identify the owner first; foreground `serve` and the managed service cannot share the port |
| Output path rejected | Use an absolute path inside the client's authorized root |
| Missing media tools | Install/register tools, restart the runtime and resume the original job |
| `ACCESS_UNCONFIRMED` / `ACCESS_NOT_PUBLIC` | Public access cannot be verified or is gated; check source limitations |
| `ADAPTER_CHANGED` / `CONTENT_SCRIPT_TIMEOUT` | Structure or readiness may have changed; keep the job ID and error |
| `PRIVATE_ADDRESS_BLOCKED` | DNS returned a reserved/private address; check network settings; private addresses remain blocked |
| Files exist but status is `partial` | Inspect missing images, full text, subtitles or completeness evidence; usable files can still be used |
| Extra blog navigation / empty publication date | Generic extraction may retain extra readable content; uncertain publication dates may be empty |

Default configuration: `~/.config/babel-content-downloader/config.json`. Job records: `~/.local/share/babel-content-downloader/jobs/`. The configuration contains credentials; never attach it to a public issue or source package. Original technical diagnostics retain their language and codes to aid debugging.

## Updating, stopping and uninstalling

Let active jobs finish or cancel them first. Keep configuration, job records and saved files. Update the runtime in its stable installation directory. Replace the archive filename with the version you actually downloaded:

```sh
node "$BABEL_CLI" runtime-stop
npm install --prefix "$BABEL_INSTALL_ROOT" --omit=dev "$BABEL_RELEASE_DIR/babel-content-downloader-0.1.26.tgz"
node "$BABEL_CLI" runtime-start
node "$BABEL_CLI" runtime-status
```

Reload the same extension directory in Chrome, then verify version and connection. For a separately unpacked ZIP, update that directory. If the actual extension ID changes, authorize it and restart. Do not re-run `add-client`.

If you previously used a source directory, foreground `serve` or another config path, retain that context and migrate deliberately. Do not assume a fresh TGZ path is the existing service entrypoint.

Pause in settings only pauses the extension; it does not cancel all running work. Manage this project's background service with:

```sh
node "$BABEL_CLI" runtime-stop
node "$BABEL_CLI" runtime-start
```

Remove the Codex connection and this runtime service:

```sh
node "$BABEL_CLI" remove-client-config codex
node "$BABEL_CLI" remove-client codex
node "$BABEL_CLI" runtime-uninstall
```

Uninstalling the shared service affects other clients too. If removing just one client, keep the service and restart to apply its revoked authorization. Revoke pairing in the extension before removing it from Chrome. These commands do not delete collected files. Uninstall the service before deleting its installation directory.

## Development and documentation

Build from the repository or unpacked source ZIP:

```sh
npm ci
npm run typecheck
npm test -- --maxWorkers=2
npm run build
```

Use `dist/bootstrap/cli.js` and the formal `dist/extension` directory for setup. Media tests need FFmpeg. `npm run lsp` additionally needs `typescript-language-server`. Fixtures are not real-platform validation.

Version 0.1.26 adds the five-language interface and README set. The previous functional baseline passed 340 tests and package installation checks. Current release checks and counts are recorded in the release's `verification.json`; package validation does not prove the user's browser has reloaded the new extension.

Further engineering documents below retain their original Chinese/English language; this README contains the complete user installation and usage path in English:

- [Detailed test guide](../usage-guide.md), [initial release notes](../first-release.md), [runtime configuration](../runtime-setup.md), [agent setup](../agent-setup.md).
- [Publishing checklist](../publishing.md), [CHANGELOG](../../CHANGELOG.md), [implementation history](../implementation-status.md), [platform evidence](../platform-status.md), [generic webpage evidence](../unified-web-validation.md).
- [Product specification](../specs/Babel_Content_Downloader_内容收集与使用契约_2026-09-18.md), [LICENSE](../../LICENSE), [third-party notices](../../THIRD_PARTY.md).

The source is MIT licensed. Third-party dependencies and downloaded content remain subject to their respective rights and terms.
