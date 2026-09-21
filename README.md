<p align="center"><img src="docs/brand/logo-preview.png" alt="Babel Content Downloader Logo" width="128" height="128"></p>

# Babel Content Downloader

[English](docs/i18n/README.en.md) · [简体中文](README.md) · [繁體中文](docs/i18n/README.zh-TW.md) · [日本語](docs/i18n/README.ja.md) · [한국어](docs/i18n/README.ko.md)

[![Release](https://img.shields.io/github/v/release/gjw199513/babel-content-downloader?display_name=tag)](https://github.com/gjw199513/babel-content-downloader/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-2f6f61.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.13.0-3c873a.svg)](package.json)

让本地 AI Agent 把公开网页、文章、论文、视频和播客，保存成可以阅读、观看、收听的本地资料。

**当前版本：0.1.26 · MIT 开源 · 首版推荐环境：macOS + Chrome + 本地 MCP Agent。**

**[下载 v0.1.26 发行附件](https://github.com/gjw199513/babel-content-downloader/releases/tag/v0.1.26)**：普通用户下载运行时 TGZ 与扩展 ZIP；安装扩展不需要下载源码包。

你只需要给 Agent 一个链接，说明想保存什么。例如：“把这个视频播客存成音频，放进我的学习资料目录。”下载器负责获取内容、保存文件和报告结果；不要求你先理解音轨或编码。


点击工具栏中的扩展图标会打开宽屏概览页；扩展详情里的“选项”会打开独立设置页。两个页面都可以切换语言，接入命令、连接控制和技术信息集中在设置页。

## 导航

- [语言切换](#语言切换)
- [能做什么](#能做什么)
- [来源与支持边界](#来源与支持边界)
- [安装与接入](#安装与接入)
- [第一次使用与功能测试](#第一次使用与功能测试)
- [输出文件与任务状态](#输出文件与任务状态)
- [MCP 调用示例](#mcp-调用示例)
- [常见问题](#常见问题)
- [升级停止与卸载](#升级停止与卸载)
- [开发与其他文档](#开发与其他文档)

## 语言切换

概览页和设置页右上角都提供“自动（跟随浏览器）”、English、简体中文、繁體中文、日本語、한국어。默认使用浏览器的语言优先列表；没有对应语言时回退到 English。手动指定某种语言后会保存在本机，并优先于浏览器语言；选择“自动（跟随浏览器）”即可恢复自动模式。产品介绍、连接状态、接入命令、使用示例和错误提示都会即时切换。Chrome 扩展管理页的简介始终跟随浏览器语言，不受页内手动选择影响。

软件名始终为 **Babel Content Downloader**。命令、API 标识、文件名和下载的原内容不翻译。原始技术错误保留在折叠详情中，CLI／MCP 技术输出可能保留原语言。

## 能做什么

| 你想做的事 | 对 Agent 的说法 | 保存类型 |
|---|---|---|
| 离线阅读文章 | 把这个链接的正文和配图保存下来 | `document` |
| 听视频播客 | 把这个视频存成音频，路上听 | `audio` |
| 离线观看视频 | 保存这个视频为 MP4 | `video` |
| 收集图片 | 只保存这条内容的图片 | `images` |
| 保存已有字幕 | 保存这个视频的英文字幕 | `subtitles` |
| 阅读论文原文 | 保存论文信息和原版 PDF | `bundle` |
| 只要附件 | 保存这条内容中支持下载的文件 | `files` |
| 按主体自动选择 | 把这个链接保存下来 | `auto` |

音频默认 M4A、视频默认 MP4；可明确指定 MP3／WAV／FLAC、MKV、来源画质、音视频片段、字幕语言或图片序号。保存的是来源内容，可以为观看和收听提取音频、合并音视频轨或转换格式；不内置 OCR、语音转写、摘要和翻译。

普通博客统一使用 HTTP + Mozilla Readability 提取当前页，必要时回退到浏览器读取，不逐个博客维护正文选择器。动态自媒体、论文和媒体内容使用对应适配器。只处理明确目标及支持的资源，不递归爬取整站。

任务自己新建的浏览器页会先静音再打开目标；后台处理不启动播放器。你原来打开的页面不会被自动播放、静音、导航或关闭。

## 来源与支持边界

以下是首版的**真实样本验证情况**，不是整个平台所有页面的兼容承诺。网站结构、地区、网络和访问状态可能影响结果。

| 来源 | 已有样本证据／当前边界 |
|---|---|
| 普通公开博客、技术文章 | 通用当前页提取；受 URL、网络和访问策略约束，不代表所有网站均可读取 |
| Medium、Substack | 已有正文与图片交付；Medium 已验证通用浏览器回退和显式标签页读取 |
| OpenAI、Anthropic、Google DeepMind | 已有文章与图片交付；DeepMind 另有 publication PDF 样本 |
| GitHub | 公开仓库 README 有交付；Markdown blob 当前存在 `ACCESS_UNCONFIRMED`，release 等路由不继承 README 验收结果 |
| Hugging Face | model card、dataset card、paper 有样本；blog 曾有图片缺失的部分完成结果；不下载整套模型权重或数据集 |
| arXiv | 已有摘要及原版 PDF 交付 |
| YouTube、B站 | 已有音视频文件交付和完整解码验证；YouTube 英文字幕已有 VTT 文件，但样本任务仍为 `partial` |
| 知乎 | 已有公开文章及配图交付 |
| X | 有可见正文的部分结果，图片、页面加载和超时仍有缺口 |
| Reddit | 已测环境被安全／登录页面阻断，尚无文件闭环 |
| 小红书 | 已测样本遇到 404／App 门控，尚无文件闭环 |
| 微信公众号 | 存在目标漂移和访问限制，仍需改进 |

共有 15 个登记来源，外加符合策略的普通公开网页提取。搜狐、快手等已移除的来源不会通过通用网页入口重新启用。只处理免费公开内容，不绕过付费、私有内容或 DRM。具体限制见 [首版说明](docs/first-release.md)。

## 安装与接入

这是“本机运行时 + 浏览器扩展 + Agent MCP 连接”的组合，**只装扩展还不能下载**。三者在同一台电脑运行。

### 1. 准备环境与发行文件

- Node.js **22.13.0 或以上**，并可在终端运行 `node`、`npm`。
- Chrome **120 或以上**；Edge 等 Chromium 浏览器尚需独立环境验证。
- 本机 Agent。自动接入命令支持 Codex／Claude Code，需先安装其对应 CLI。
- 保存音视频时，另需 `yt-dlp`、`ffmpeg`、`ffprobe`。基础网页提取不要求这些媒体工具。
- 首版托管后台服务只实现 macOS；Windows／Linux 尚未完成正式安装支持。

发行附件：

| 文件 | 用途 |
|---|---|
| `babel-content-downloader-0.1.26.tgz` | 已编译运行时，普通用户安装这个 |
| `babel-content-downloader-extension-0.1.26.zip` | 正式扩展，解压后加载 |
| `babel-content-downloader-source-0.1.26.zip` | 完整源码，用于开发或自行构建 |
| `SHA256SUMS`、`release-manifest.json`、`verification.json` | 校验值、发行清单和验证记录 |

普通用户可以直接从 Release 下载扩展 ZIP，不需要下载源码包或自行构建。五语言的独立安装步骤见 [浏览器扩展安装说明](docs/extension-install.md)。Chrome 对站外 ZIP 的当前安装方式仍是“解压后加载”；真正的一键安装需要 Chrome Web Store，已列入 [发布路线图](docs/release-roadmap.md)。

以下命令在 macOS 终端执行。把 `/absolute/path/...` 替换为你自己的**绝对路径**；不要照抄占位符。新开终端后需要重新设置示例中的变量。

```sh
export BABEL_RELEASE_DIR=/absolute/path/to/release-files
cd "$BABEL_RELEASE_DIR"
shasum -a 256 -c SHA256SUMS

export BABEL_INSTALL_ROOT="$HOME/Applications/babel-content-downloader"
npm install --prefix "$BABEL_INSTALL_ROOT" --omit=dev "$BABEL_RELEASE_DIR/babel-content-downloader-0.1.26.tgz"
export BABEL_CLI="$BABEL_INSTALL_ROOT/node_modules/babel-content-downloader/dist/bootstrap/cli.js"
node "$BABEL_CLI" init
```

保留 npm 默认可选依赖，不要加 `--omit=optional`，图片处理需要对应系统的二进制组件。TGZ 已编译，不必再执行 `npm run build`。校验全部文件时，请把发行清单内的附件一并下载到同一目录。

### 2. 加载扩展

运行时包已包含与 ZIP 相同的正式扩展，最简单的做法是直接加载它：

```sh
export BABEL_EXTENSION_DIR="$BABEL_INSTALL_ROOT/node_modules/babel-content-downloader/dist/extension"
printf '%s\n' "$BABEL_EXTENSION_DIR"
```

在 Chrome 打开 `chrome://extensions`，开启“开发者模式”，点击“加载已解压的扩展程序”，选择上面输出的目录。也可以把正式扩展 ZIP 解压到长期保留的目录，再加载其中直接包含 `manifest.json` 的目录。**两种方式选一种，不必重复加载。**

确认扩展版本为 `0.1.26`。首次安装会自动打开欢迎页；若已关闭，从扩展管理页复制实际的 32 位 ID，在 Chrome 地址栏打开 `chrome-extension://实际扩展ID/welcome/index.html`。欢迎页也会显示该 ID。不要加载 `dist/extension-dev`，它是开发夹具版本。

### 3. 授权输出目录并启动

首次使用 Codex 时：

```sh
export BABEL_EXTENSION_ID=替换为扩展页面显示的32位ID
export BABEL_OUTPUT_ROOT="$HOME/Documents/BabelLibrary"
node "$BABEL_CLI" allow-extension "$BABEL_EXTENSION_ID"
node "$BABEL_CLI" add-client codex "$BABEL_OUTPUT_ROOT"
node "$BABEL_CLI" runtime-install
node "$BABEL_CLI" runtime-status
printf '资料保存目录：%s\n' "$BABEL_OUTPUT_ROOT"
```

记录最后输出的绝对资料目录，稍后告诉 Agent。每个任务只能写入该客户端获授权的目录内。

`runtime-status` 应显示 `state: "running"`、`health: "ready"`、`loaded: true`、`restart_required: false`。随后回到扩展概览页点击“连接本机运行时”，确认“已连接到本机运行时”；如果暂停过，请到设置页点击“恢复”。

已安装过的用户先看[升级说明](#升级停止与卸载)，不要反复 `add-client`。更换授权、工具路径或客户端后，运行 `runtime-start` 应用配置。

### 4. 接入 Agent

Codex：

```sh
node "$BABEL_CLI" install-client-config codex
```

返回 `waiting_client_reload` 后重新加载 Codex。在新会话中发送：

> 请调用 Babel Content Downloader 的 babel_content_check，检查本机运行时、浏览器连接和媒体依赖，告诉我哪些功能已经可以使用。

应能找到八个 `babel_content_*` 工具。需要浏览器的任务应有目标扩展实例已连接且未暂停；普通 URL 正文检查可能返回 `ready_http`、`browser_required: false`，表示可先直接抓取，不保证随后网络请求一定成功。

使用 Claude Code 时，在首次安装的第 3 步把 `codex` 改为 `claude`，然后执行 `install-client-config claude`。若是在已有运行时上增添客户端，按顺序执行：

```sh
node "$BABEL_CLI" add-client claude "$BABEL_OUTPUT_ROOT"
node "$BABEL_CLI" runtime-start
node "$BABEL_CLI" install-client-config claude
```

重新加载 Claude Code 后同样实际调用检查工具。自动安装只管理本项目的 MCP 条目，遇到已存在且非本项目管理的同名配置会拒绝覆盖。

其他 stdio MCP 客户端先注册独立客户端，例如 `add-client my-agent "$BABEL_OUTPUT_ROOT"`，再 `runtime-start`。客户端 MCP 配置形状通常如下，具体外层格式按客户端要求填写：

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

路径必须实际存在，JSON 中不展开 `$HOME`、`~` 或 `$BABEL_CLI`。配置中不需要粘贴运行时令牌。

### 5. 准备音视频工具（需要时）

从各工具官方分发渠道安装媒体依赖后，在终端确认：

```sh
yt-dlp --version
ffmpeg -version
ffprobe -version
```

若终端能找到、后台服务找不到，显式登记可执行文件路径：

```sh
node "$BABEL_CLI" set-tool yt-dlp "$(command -v yt-dlp)"
node "$BABEL_CLI" set-tool ffmpeg "$(command -v ffmpeg)"
node "$BABEL_CLI" set-tool ffprobe "$(command -v ffprobe)"
node "$BABEL_CLI" runtime-start
```

再让 Agent 执行检查并恢复之前阻塞的任务。缺少工具时不需要重装扩展。

## 第一次使用与功能测试

安装完成后，**在 Agent 对话里操作，不是在扩展页粘贴下载链接**。扩展页负责连接、暂停和撤销。

建议先测文章，再测论文，最后测音视频。复制下面的提示词，把 `<文章URL>` 等占位内容和 `/你的绝对资料目录` 替换为真实值。推荐选无需登录、你可以在浏览器正常阅读的内容；网站临时访问失败不代表安装失败。

### A. 保存一篇文章

> 使用 Babel Content Downloader，把这篇公开文章 `<文章URL>` 的正文和配图保存到 `/你的绝对资料目录`。按 document 保存。请等待任务结束，返回任务 ID、实际状态、正文路径、图片数量和缺失项，不要只告诉我已经提交。

验收：打开返回的 `content.md`，正文可读；配图指向本地文件；`metadata.json` 有来源。只有 `succeeded` 才表示请求范围完成；`partial` 时同时查看缺项。

### B. 保存论文与 PDF

> 使用 Babel Content Downloader，把这篇论文 `<arXiv摘要页URL>` 按 bundle 保存到 `/你的绝对资料目录`，包含论文信息和原版全文 PDF。完成后给我 PDF 路径和缺失项。

使用论文摘要详情页，通常形如 `https://arxiv.org/abs/论文编号`，不要直接把原始 PDF 地址当作这个测试的入口。验收时实际打开 PDF。

### C. 把视频播客保存为音频

> 使用 Babel Content Downloader，把这个视频 `<YouTube或B站视频URL>` 保存成 MP3，放到 `/你的绝对资料目录`。处理期间保持任务页静音，不要自动播放导出文件。结束后给我音频路径、时长、状态和缺失项。

验收：自己打开 MP3，确认有声音、时长合理。不要以“文件已经创建”代替实际收听检查。

### D. 保存视频或片段

> 使用 Babel Content Downloader，把 `<视频URL>` 的第 60 秒到第 120 秒保存为 MP4，放到 `/你的绝对资料目录`。完成后给我文件路径、实际时长和状态，不要自动播放。

验收：源视频应长于 120 秒；导出应约为 60 秒，画面和声音可以正常播放。若明确要求 720p 而来源不提供，会报告缺项，不保证自动换为其他画质。

### E. 保存图片与字幕

> 把 `<公开图文URL>` 的图片保存到 `/你的绝对资料目录`，只要图片，返回全部文件路径和缺失项。

> 把 `<YouTube视频URL>` 的英文字幕保存到 `/你的绝对资料目录`，指定语言 en。只保存来源已有字幕，不做语音转写；报告真实任务状态和字幕文件路径。

字幕需要来源提供对应语言。首版已有字幕文件可用但任务仍显示 `partial` 的已知情况，不应隐藏此状态。字幕裁切尚不支持。

### F. 查进度、恢复和取消

> 查看 Babel Content Downloader 最近的任务。对任务 `<job_id>` 检查状态、失败原因和所有已保存文件；文件多时继续读取后续分页。

> 我已补齐依赖／恢复浏览器连接，请恢复 Babel Content Downloader 任务 `<job_id>`，不要重新创建重复任务。

> 取消 Babel Content Downloader 任务 `<job_id>`。

遇到 `SELECTION_REQUIRED`，告诉 Agent 选择“文章／视频／音频”等返回选项即可，它会恢复同一个任务。取消任务不会删除已经交付的文件。

更完整的逐项测试和结果记录模板见 [使用与测试手册](docs/usage-guide.md)。

## 输出文件与任务状态

任务会在授权目录中生成自己的结果目录。实际文件数量和名称以 `job_get` 返回值为准，例如：

```text
BabelLibrary/
└── 某篇文章或视频的结果目录/
    ├── content.md       # 可读正文或资料入口，按任务用途生成
    ├── assets/          # 图片、音频、视频、字幕、PDF 等实际文件
    ├── metadata.json   # 来源、内容信息、交付清单与已记录的媒体处理信息
    └── assets.json     # 资源关联清单
```

图片在 Markdown 中使用相对链接，移动资料时请保留整个结果目录。`job_get` 提供文件路径、大小、SHA256 和分页信息；完整正文在本地文件内，不会全部塞回 MCP 响应。

| 状态 | 含义与下一步 |
|---|---|
| `queued`／`resolving`／`collecting`／`downloading`／`finalizing`／`verifying` | 已入队或处理中，按工具返回的间隔继续查询 |
| `succeeded` | 本次明确请求的范围已完成，打开产物确认是否满足使用需求 |
| `partial` | 有结果但缺少部分请求内容，查看 `error`、`warnings` 和失败组件 |
| `blocked` | 等待连接、依赖、用途选择或自动重试；先读具体原因及 `retry_at` |
| `failed` | 本次未完成，查看错误；解决可恢复问题后再恢复 |
| `cancelled` | 已取消；已有文件仍可能保留 |

## MCP 调用示例

下面是 **MCP 工具参数 JSON**，供 Agent 或客户端开发者参考，不是终端命令，也不是 HTTP API 请求体。普通用户直接用上面的自然语言即可。

`babel_content_collect` 保存正文：

```json
{
  "target": { "type": "url", "url": "https://example.org/articles/my-article" },
  "save_as": "document",
  "output": { "directory": "/absolute/path/to/authorized/materials" }
}
```

`example.org` 仅为格式示例，测试时换成实际可访问的文章。提取 MP3 音频片段：

```json
{
  "target": { "type": "url", "url": "https://www.youtube.com/watch?v=REPLACE_WITH_VIDEO_ID" },
  "save_as": "audio",
  "preferences": { "audio_format": "mp3", "clip": { "start_seconds": 60, "end_seconds": 120 } },
  "output": { "directory": "/absolute/path/to/authorized/materials" }
}
```

提交返回 `job_id` 后，调用 `babel_content_job_get`：

```json
{ "job_id": "替换为实际job_id", "artifact_offset": 0, "artifact_limit": 50 }
```

若 `artifact_page.next_offset` 非空，用该值继续读取。不要把 `collect` 返回 `queued` 当成下载完成。

| 工具 | 用途 |
|---|---|
| `babel_content_check` | 检查运行时、目标路由、扩展和依赖；可传 `target` 与 `save_as` |
| `babel_content_collect` | 创建单个明确 URL 或标签页任务 |
| `babel_content_job_get` | 查询状态、缺项和分页文件 |
| `babel_content_job_resume` | 恢复；可传 `save_as` 用途选择或 `refreshed_url` 同内容新链接 |
| `babel_content_job_cancel` | 取消任务 |
| `babel_content_jobs_list` | 查看当前客户端任务，支持 `offset`／`limit` |
| `babel_content_browser_observe` | 观察指定 `job_id` 的页面 |
| `babel_content_browser_act` | 在任务权限内执行允许的滚动、展开、静音播放等操作 |

`save_as` 与 `include` 互斥。`include` 可选 `text`、`images`、`video`、`audio`、`subtitles`、`cover`、`files`。其他偏好与标签页示例见 [使用与测试手册](docs/usage-guide.md)。

## 常见问题

| 现象 | 处理方式 |
|---|---|
| Agent 找不到工具 | 确认对应 CLI 已安装；检查 `client-config-status codex`；重载 Agent，再实际调用检查工具 |
| 扩展“等待本机授权” | 核对真实扩展 ID，执行 `allow-extension` 后 `runtime-start`，欢迎页再点连接 |
| `waiting_browser` 或扩展已暂停 | 保持 Chrome 开启，扩展点连接／恢复；检查任务所绑定的实例，不要只看总连接状态 |
| 版本仍是旧的 | 构建不会让 Chrome 自动重载；核对加载目录，在扩展管理页点一次重新加载，再看欢迎页版本 |
| `CLIENT_ALREADY_EXISTS` | 客户端已授权，不要重复注册或为此删除旧授权；直接检查当前配置和运行时状态 |
| 端口被占用 | 先识别占用进程；已有手动 `serve` 与托管服务不能同时使用同一端口，不要盲目结束其他服务 |
| 输出目录被拒绝 | 使用 `add-client` 授权根目录内的绝对路径；聊天文字不能扩展目录权限 |
| 缺少媒体依赖 | 按上文安装并用 `set-tool` 登记，重启运行时后恢复原任务 |
| `ACCESS_UNCONFIRMED`／`ACCESS_NOT_PUBLIC` | 当前页面无法确认公开性或遇到访问门槛；核对链接与平台限制，不把错误页当成功 |
| `ADAPTER_CHANGED`／`CONTENT_SCRIPT_TIMEOUT` | 页面结构或加载状态可能变化；保留错误及任务 ID，不能靠重复下载保证成功 |
| `PRIVATE_ADDRESS_BLOCKED` | DNS 返回了保留／内网地址；核对本机网络配置，运行时不会放行内网地址；可选 DNS 设置见运行时文档 |
| 有文件但 `partial` | 查看真实缺项；可能缺图片、全文、字幕或源内容完整性证明，已有可用文件可以先使用 |
| 博客带有导航／相关内容或日期为空 | 通用提取可能保留额外可读区域；无法确定发布日期时允许为空 |

本机配置默认在 `~/.config/babel-content-downloader/config.json`，任务记录在 `~/.local/share/babel-content-downloader/jobs/`。配置包含客户端凭据，不要附到公开 Issue 或源码包中。反馈时提供版本、平台、任务状态、错误码和去除敏感参数的链接即可。

## 升级停止与卸载

升级前让正在处理的任务结束或取消。保留配置、任务目录和已下载文件；在原稳定安装目录更新运行时包，避免改变服务入口路径。把命令中的版本文件名换成实际新包：

```sh
node "$BABEL_CLI" runtime-stop
npm install --prefix "$BABEL_INSTALL_ROOT" --omit=dev "$BABEL_RELEASE_DIR/babel-content-downloader-0.1.26.tgz"
node "$BABEL_CLI" runtime-start
node "$BABEL_CLI" runtime-status
```

在 Chrome 对同一个扩展目录点“重新加载”，再检查版本和连接。若扩展来自独立 ZIP，更新原解压目录；若改了目录导致 ID 改变，需要授权新的实际 ID 并重启运行时。不要重新运行 `add-client`。

如果原来使用源码目录、手动 `serve` 或其他配置文件，应继续使用同一份配置和原入口，按 [运行时文档](docs/runtime-setup.md) 迁移；不能直接把上面的全新 TGZ 安装路径当成现有服务路径。

只暂停扩展可在设置页点击“暂停”；暂停不会等同于取消全部已启动任务。管理本项目后台服务：

```sh
node "$BABEL_CLI" runtime-stop
node "$BABEL_CLI" runtime-start
```

移除 Codex 接入及本项目后台服务：

```sh
node "$BABEL_CLI" remove-client-config codex
node "$BABEL_CLI" remove-client codex
node "$BABEL_CLI" runtime-uninstall
```

这些步骤会影响同一运行时的其他客户端；如果只是停用一个客户端，请保留后台服务并重启应用授权变更。扩展可在设置页撤销连接后由 Chrome 移除。上述命令不删除已收集资料；删除安装目录前先卸载其后台服务。

## 开发与其他文档

从仓库或源码 ZIP 构建：

```sh
npm ci
npm run typecheck
npm test -- --maxWorkers=2
npm run build
```

然后以 `dist/bootstrap/cli.js` 为入口、`dist/extension` 为正式扩展，按上文授权与接入。音视频测试需要本机 FFmpeg。`npm run lsp` 另需 `typescript-language-server`；测试夹具不代表真实网站验收。

0.1.26 新增五语言宽屏概览页、独立设置页和完整 README；最新校验与测试结果见发行目录的 `verification.json`。以下为历史验证记录。

0.1.25 代码基线：43 个测试文件、340 项测试通过；运行时 TGZ 独立安装及八个 MCP 工具验证通过；源码 ZIP 可重新构建，60 个生成文件与交付构建逐字节一致。真实浏览器基线为 0.1.24；0.1.25 新增媒体处理元数据及文章日期修正，包验证不代表用户已重载新版本。

- [使用与测试手册](docs/usage-guide.md)：更多参数、逐项测试和反馈模板。
- [首版安装与限制](docs/first-release.md)、[运行时配置](docs/runtime-setup.md)、[Agent 接入](docs/agent-setup.md)。
- [发布操作清单与发布说明](docs/publishing.md)：维护者上传源码和附件时使用。
- [CHANGELOG](CHANGELOG.md)、[实施记录](docs/implementation-status.md)、[平台历史验证](docs/platform-status.md)、[通用网页验证](docs/unified-web-validation.md)。历史记录中的旧版本结果不替代当前支持边界。
- [产品 Spec](docs/specs/Babel_Content_Downloader_内容收集与使用契约_2026-09-18.md)、[LICENSE](LICENSE)、[第三方依赖说明](THIRD_PARTY.md)。

源码采用 MIT；第三方依赖及下载内容的权利分别归其权利人。请按来源条款和你拥有的权限使用保存的资料。
