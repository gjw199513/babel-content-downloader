# Babel Content Downloader 0.1.26 首次本地发行说明

本次交付是本地安装包，不是 npm 或浏览器商店发布。三个发行物应与同目录的 `release-manifest.json`、`SHA256SUMS` 一起使用：

- `babel-content-downloader-0.1.26.tgz`：已编译的本机运行时与 MCP 入口。
- `babel-content-downloader-extension-0.1.26.zip`：Chrome 120+ 正式扩展；不要加载开发版扩展。
- `babel-content-downloader-source-0.1.26.zip`：对应源码、许可证与构建材料，不是运行 TGZ 的必需文件。

只安装浏览器扩展时，直接下载扩展 ZIP 即可，不需要源码 ZIP。请按同目录的 `EXTENSION-INSTALL.md` 操作。Chrome 目前需要先解压，再通过“加载已解压的扩展程序”选择该目录；真正的一键安装需要后续发布到 Chrome Web Store。

日常用法与可复制的功能测试指令见 [README](../README.md#第一次使用与功能测试)；详细测试表见 [使用与测试手册](usage-guide.md)。

宽屏概览页与独立设置页支持 English、简体中文、繁體中文、日本語、한국어。默认按浏览器语言优先级自动匹配；没有受支持语言时使用 English。用户可手动切换并记住选择，也可选“自动（跟随浏览器）”恢复自动匹配。接入命令、暂停／恢复／撤销和技术信息位于设置页，概览页只保留连接状态和常用请求。五语 README 入口见仓库首页。

## 1. 安装运行时和正式扩展

需要 Node.js 22.13.0 或以上。保留 npm 默认可选依赖，不要使用 `--omit=optional`。先在发行目录核对完成版清单和摘要，再把 TGZ 安装到不会移动的绝对路径：

```sh
export BABEL_RELEASE_DIR=/absolute/path/to/babel-content-downloader-0.1.26
cd "$BABEL_RELEASE_DIR"
shasum -a 256 -c SHA256SUMS

export BABEL_INSTALL_ROOT=/absolute/path/to/babel-content-downloader-install
export BABEL_TGZ="$BABEL_RELEASE_DIR/babel-content-downloader-0.1.26.tgz"
npm install --prefix "$BABEL_INSTALL_ROOT" --omit=dev "$BABEL_TGZ"
export BABEL_CLI="$BABEL_INSTALL_ROOT/node_modules/babel-content-downloader/dist/bootstrap/cli.js"
node "$BABEL_CLI" init
```

把正式扩展 ZIP 解压到一个新的、长期保留的空目录。Chrome 打开 `chrome://extensions`，启用开发者模式，选择“加载已解压的扩展程序”，加载其中直接包含 `manifest.json` 的目录：

```sh
export BABEL_EXTENSION_DIR=/absolute/path/to/babel-content-downloader-extension-0.1.26
mkdir "$BABEL_EXTENSION_DIR"
unzip "$BABEL_RELEASE_DIR/babel-content-downloader-extension-0.1.26.zip" -d "$BABEL_EXTENSION_DIR"
test -f "$BABEL_EXTENSION_DIR/manifest.json"
```

首次安装会打开欢迎页；若已关闭，从扩展管理页取得实际 ID 后，在 Chrome 地址栏打开 `chrome-extension://实际扩展ID/welcome/index.html`。从扩展详情页或欢迎页复制实际的 32 位扩展 ID。下面的输出目录必须是该 Agent 可以写入、且你愿意授权给它的绝对目录：

```sh
export BABEL_EXTENSION_ID=替换为扩展页面显示的32位ID
node "$BABEL_CLI" allow-extension "$BABEL_EXTENSION_ID"
node "$BABEL_CLI" add-client codex /absolute/path/to/authorized/materials
node "$BABEL_CLI" runtime-install
node "$BABEL_CLI" runtime-status
```

首版托管后台启动只支持 macOS 用户会话。`runtime-status` 必须显示 `state: "running"`、`health: "ready"`、`loaded: true`、`restart_required: false`。Windows 和 Linux 尚无托管启动实现，不能把前台开发命令当成已完成的正式安装。

运行时启动后，在扩展概览页点击“连接本机运行时”；已暂停的实例到设置页点击“恢复”。确认显示“已连接到本机运行时”。

## 2. 接入 Agent

Codex 使用其官方 MCP CLI 安装这个项目自己的命名条目：

```sh
node "$BABEL_CLI" install-client-config codex
```

期望状态是 `waiting_client_reload`。重新加载 Codex 后，确认工具列表出现十个 MCP 工具，并实际调用 `babel_content_check`。其中九个是 `babel_content_*`，`babel_content_get_asr_guide` 只返回本地 ASR 指南。只有运行时 ready、目标扩展实例 `connected` 且未暂停，才算接入完成；仅看到配置条目或进程 PID 不够。

Claude Code 需要独立授权，不能复用 Codex 的客户端身份：

```sh
node "$BABEL_CLI" add-client claude /absolute/path/to/authorized/materials
node "$BABEL_CLI" runtime-start
node "$BABEL_CLI" install-client-config claude
```

其他支持 stdio MCP 的本地 Agent，可把以下命令作为 MCP server，并将 `codex` 换成已通过 `add-client` 注册的独立客户端 ID。配置中要写展开后的绝对 CLI 路径，不要写 shell 变量：

```sh
node /absolute/path/to/babel-content-downloader-install/node_modules/babel-content-downloader/dist/bootstrap/cli.js mcp codex
```

默认配置位于 `~/.config/babel-content-downloader/config.json`，其中含本机客户端凭据；不要把内容复制到聊天、扩展页面或公开日志。

## 3. 可用核心用途

- 保存一个明确的免费公开 URL 或本任务拥有的标签页，输出可读 `content.md`、本地 `assets/`、`metadata.json` 和 `assets.json`。
- 以 `document`、`video`、`audio`、`images`、`subtitles`、`files`、`bundle` 或 `auto` 指定用途；`save_as` 与 `include` 不能同时使用。
- 将视频保存为可播放视频，或提取为可播放音频；可明确选择受支持格式、来源画质、片段、字幕语言或图片序号。媒体处理需要时会检查 `yt-dlp`、`ffmpeg`、`ffprobe`，缺少依赖会返回可恢复状态，不阻止 MCP 启动。
- 任务持久化，可用 `babel_content_job_get` 查看状态和分页文件、用 `babel_content_job_resume` 恢复、用 `babel_content_job_cancel` 取消。结果目录必须位于该客户端获授权的根目录内。
- 普通公开文章优先走受限 HTTP 当前页提取，必要时使用正式扩展读取当前页；动态自媒体和音视频仍走对应适配器。不会递归抓取整站，也不绕过登录、付费、私有或 DRM 门槛。

## 4. 首版已知限制

- 源码注册了 15 个当前范围来源：小红书、B站、微信公众号、知乎、YouTube、X、Reddit、Medium、Substack、GitHub、Hugging Face、arXiv、OpenAI 官方文章、Anthropic 官方文章、DeepMind 官方文章。注册表示存在受限路由，不表示整个来源、所有内容类型或所有账号环境都已全面验证；当前没有整个平台被声明为全面 `browser_verified`。
- GitHub 只接受受限的公开 README、Markdown blob 和单条 release 路由。仓库／blob 页面必须取得精确且唯一的 `Public` 标记；README 样本已有交付证据，但当前公开 Markdown blob 实测为 `ACCESS_UNCONFIRMED`。普通代码 blob、目录、Issue、下载资产和私有仓库不在此入口范围。
- YouTube 英文字幕已有一条真实 VTT 交付并通过哈希和 286 条字幕 cue 检查，但经历手工恢复，任务仍为 `partial / CONTENT_INCOMPLETE`。其他视频、语言及首次自动完成状态不能由该样本推断。
- X 的已测单帖曾保存正确作者与可见正文，但仍有图片和页面准备问题；后续真实任务出现 `CONTENT_SCRIPT_TIMEOUT` 或 `ADAPTER_CHANGED`。Reddit 的真实页面被网络安全／登录门控阻断，尚无文件闭环。
- 小红书现有真实样本为 404／App 门控，尚无公开样本闭环。微信公众号样本出现目标漂移，且浏览器访问受策略限制；不得绕过这些门槛或把无文件结果称为成功。
- OCR、摘要、翻译、付费内容、私有内容和凭据导出不属于首版采集层内置能力。ASR 也不会由扩展或 MCP 自动触发；用户明确需要文字且已有字幕/正文不足时，Agent 可按独立的 [ASR 后处理 Spec](specs/Babel_Content_Downloader_ASR后处理移植Spec_2026-09-21.md) 执行本地转写。页面、产物存在与任务 `succeeded` 是不同证据；遇到 `partial`、`blocked` 或 `failed` 应读取 `job_get` 的实际缺项后再决定是否恢复。

更完整的配置、停止与卸载方法见 [runtime-setup.md](runtime-setup.md) 和 [agent-setup.md](agent-setup.md)。
