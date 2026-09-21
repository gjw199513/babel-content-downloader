# Third-party sources

Project source is independently implemented and licensed under MIT. Dependencies keep their own licenses. The checked-in package-lock.json pins the versions below; each installed dependency supplies its own license notice.

| Runtime dependency | Locked version | License | Source |
|---|---|---|---|
| @mozilla/readability | 0.6.0 | Apache-2.0 | https://github.com/mozilla/readability |
| jsdom | 29.1.1 | MIT | https://github.com/jsdom/jsdom |
| @modelcontextprotocol/server | 2.0.0 | MIT | https://github.com/modelcontextprotocol/typescript-sdk |
| @modelcontextprotocol/node | 2.0.0 | MIT | https://github.com/modelcontextprotocol/typescript-sdk |
| @modelcontextprotocol/core | 2.0.0 | MIT | https://github.com/modelcontextprotocol/typescript-sdk |
| @hono/node-server | 1.19.17 | MIT | https://github.com/honojs/node-server |
| hono | 4.13.8 | MIT | https://github.com/honojs/hono |
| image-size | 2.0.4 | MIT | https://github.com/image-size/image-size |
| sharp | 0.35.4 | Apache-2.0 | https://github.com/lovell/sharp |
| @img/colour | 1.1.0 | MIT | https://github.com/lovell/colour |
| detect-libc | 2.1.2 | Apache-2.0 | https://github.com/lovell/detect-libc |
| semver | 7.8.5 | ISC | https://github.com/npm/node-semver |
| @img/sharp platform binaries | 0.35.4 | Apache-2.0; bundled components may additionally declare LGPL-3.0-or-later and MIT | https://github.com/lovell/sharp |
| @img/sharp-libvips platform binaries | 1.3.3 | LGPL-3.0-or-later, with bundled dependency notices | https://github.com/lovell/sharp-libvips |
| pdfjs-dist | 6.3.289 | Apache-2.0 | https://github.com/mozilla/pdf.js |
| saxes | 6.0.0 | ISC | https://github.com/lddubeau/saxes |
| xmlchars | 2.2.0 | MIT | https://github.com/lddubeau/xmlchars |
| @napi-rs/canvas (optional; platform bindings use the same version) | 1.0.9 | MIT | https://github.com/Brooooooklyn/canvas |
| zod | 4.6.5 | MIT | https://github.com/colinhacks/zod |

Generic webpage extraction uses Mozilla Readability with a jsdom document. Page scripts and subresource loading are disabled. These packages and their transitive DOM, HTML, URL, and encoding dependencies are installed by npm with their original license notices; they are not bundled into the browser extension. Their exact dependency graph is recorded in package-lock.json.

PDF.js is installed as a dependency, with its upstream notices retained. Its bundled CMaps, fonts, ICC profiles and WebAssembly codecs have additional notices in `cmaps/LICENSE`, `standard_fonts/LICENSE_*`, `iccs/LICENSE` and `wasm/LICENSE_*` inside the installed `pdfjs-dist` package. The PDF validator parses local files without rendering; optional native canvas packages are not required for that path. Platform-specific optional bindings are selected by the package manager and are not copied into Babel's runtime or extension archives.

Image validation uses sharp/libvips to decode all input pixels and animation frames without changing the saved source. Keep package-manager optional dependencies enabled so the required sharp platform binary and its libvips dependency are installed. Their original license and dependency notices remain in the installed packages; Babel does not embed them in its JavaScript or extension bundles. See the upstream [installation guide](https://sharp.pixelplumbing.com/install/) and [input validation options](https://sharp.pixelplumbing.com/api-constructor/).

The optional media executables [yt-dlp](https://github.com/yt-dlp/yt-dlp#license) and [FFmpeg/ffprobe](https://ffmpeg.org/legal.html) are installed separately and are not redistributed in this package. Their specific distributions and dependencies retain their respective licenses. Build/development dependencies are recorded in package-lock.json and are not bundled into the Node runtime package; the extension bundle uses this project's browser adapter code.

## Upstream architecture audit

[hangwin/mcp-chrome](https://github.com/hangwin/mcp-chrome/tree/f48e71751e00bc09725c7e173423cff4f2ccd12a) was inspected at commit `f48e71751e00bc09725c7e173423cff4f2ccd12a` on 2026-09-18. Its LICENSE is MIT, copyright 2024 hangye. No upstream source files were copied into this project. Its extension/native bridge architecture informed the audit; this implementation uses an independently written authenticated loopback bridge and has its own extension, runtime, storage, configuration and tool names. The audit checkout is excluded from release packages.

Protocol behavior is based on the official [TypeScript MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk), [Chromium extension APIs](https://developer.chrome.com/docs/extensions/reference/api/tabs), and command-line interfaces of the external media tools. Network classification refers to the [IANA IPv6 special-purpose registry](https://www.iana.org/assignments/iana-ipv6-special-registry/), with restrictive task-level destination checks.
