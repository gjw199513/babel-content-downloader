# 多平台自动验收流程

这个流程验证的是当前 URL 的真实链路：

浏览器页面 → 已连接扩展 → 本机运行时 → MCP → 本地 Markdown/媒体文件 → 链接与脱敏检查 → Agent 验收摘要。

当前矩阵覆盖源码中保留的 15 个来源：小红书、B站、微信公众号、知乎、YouTube、X、Reddit、Medium、Substack、GitHub、Hugging Face、arXiv、OpenAI Blog、Anthropic Blog、Google DeepMind。平台没有提供具体内容 URL 时，脚本会显示“跳过”，不会把适配器存在误报成平台通过。

## 1. 运行前检查

先确认当前项目的运行时配置和 MCP 都是项目级的，并确认运行时状态满足：

    state=running
    health=ready
    restart_required=false

再在当前浏览器扩展欢迎页点击“连接本机运行时”，重载 Codex，并通过 MCP 调用 babel_content_check。必须看到目标扩展 ID、版本、connected=true、paused=false；waiting_client_reload 只表示需要重载客户端，不代表浏览器已经连接。

音视频用途还需要本机已经配置 yt-dlp、ffmpeg 和 ffprobe。文档矩阵默认保存 document，避免把正文验收和大媒体下载混成一个结论；某个平台需要视频或音频时，可在私有 URL manifest 中设置 save_as。

## 2. 提供平台 URL

不要把带 xsec_token、Cookie、签名或其他短期凭证的 URL 写进 Git、报告或聊天。最简单的方式是只在当前 shell 中提供 URL：

    export BABEL_PLATFORM_XIAOHONGSHU_URL='从浏览器当前页面复制的完整 URL'
    export BABEL_PLATFORM_YOUTUBE_URL='当前登录状态可访问的视频 URL'

也可以建立一个仅本机可读的 JSON 文件，例如 /absolute/path/to/private/platform-urls.json。文件内容可以使用下列结构：

    {
      "cases": [
        {
          "platform": "xiaohongshu",
          "url": "当前内容的完整 URL",
          "save_as": "document"
        },
        {
          "platform": "youtube",
          "url": "当前视频的完整 URL",
          "save_as": "document"
        }
      ]
    }

执行前把该文件权限收紧为 600，并通过 BABEL_PLATFORM_URLS_FILE 指向它。脚本只把脱敏后的公开身份 URL 写入报告；原始访问 URL 不写入报告和 result.json。

## 3. Agent 配置

Agent 调度器使用 OpenAI-compatible chat/completions，不把凭据写入代码。默认配置正是本次约定的：

    type=openai-compatible
    model=gemma4:31b
    baseUrl=https://ollama.com/v1
    capabilities=chat,structured,embeddings

只在当前 shell 提供 API key：

    export BABEL_AGENT_BASE_URL='https://ollama.com/v1'
    export BABEL_AGENT_MODEL='gemma4:31b'
    export BABEL_AGENT_API_KEY='仅从可信配置注入，不写入文件'

如果只验证脚本、报告和脱敏流程，不调用远程模型：

    export BABEL_AGENT_DRY_RUN=1

## 4. 单平台浏览器回归

先构建当前源码，然后只跑用户提供的一个平台：

    npm run build
    BABEL_CONTENT_CONFIG='/absolute/path/to/project-runtime-config.json' \
    BABEL_PLATFORM_XIAOHONGSHU_URL='当前小红书完整 URL' \
    BABEL_AGENT_DRY_RUN=1 \
    npm run test:platform-matrix -- --only xiaohongshu

脚本会通过项目 MCP stdio 入口调用 babel_content_check、babel_content_collect 和 babel_content_job_get。浏览器任务使用 tab_strategy=auto、allow_focus=false，不执行点赞、评论、发布或其他写操作。

## 5. 全矩阵

当 15 个平台都有当前、可访问的具体 URL 时，使用：

    BABEL_CONTENT_CONFIG='/absolute/path/to/project-runtime-config.json' \
    BABEL_PLATFORM_URLS_FILE='/absolute/path/to/private/platform-urls.json' \
    npm run test:platform-matrix -- --strict

每个平台依次执行：

1. 检查运行时、扩展连接、暂停状态、平台适配器和媒体依赖。
2. 提交 document 或 manifest 指定的保存任务。
3. 轮询任务直到 succeeded、partial、failed，或 blocked 且没有 retry_at；带 retry_at 的 blocked 只是有界自动重试等待，不会被矩阵提前记成失败。
4. 检查 content.md、assets.json、metadata.json 是否存在。
5. 检查 Markdown 是否有公开来源链接；原 URL 含短期参数时，再检查是否有“打开原始页面”直达链接。
6. 检查 assets.json 和 metadata.json 没有带凭证的查询参数。
7. 把脱敏后的平台状态交给 Agent，生成派发摘要。

报告写入 .audit/platform-matrix/运行批次/report.md，结果文件写入 .audit/platform-matrix/运行批次/result.json，平台本地产物写入 .babel-content/platform-matrix/运行批次。报告、result.json 和 Agent 摘要都是 600 权限。

## 6. Markdown 原始链接行为

公开身份仍使用脱敏的 canonical_url/source_url，保证 MCP 响应、metadata.json、assets.json 和持久化任务记录不泄露签名参数。

在首次采集、同一运行时的重试或使用 refreshed_url 的恢复中，当前任务内存里的原始 URL 会额外写入本地 content.md：

    ## 来源信息
    - 公开身份链接：<脱敏后的 URL>
    - 本次访问链接：<本次任务的完整 URL>

结果目录由运行时创建为 700，Markdown 文件为 600。原始访问链接可能过期，也可能包含短期凭证，不能把 content.md 当作公开分享文件。运行时重启后不会从脱敏任务记录反推旧凭证；应通过 babel_content_job_resume 提供同一内容的新 URL。

## 7. 结果解释

通过表示当前 URL 完成了本次 check、任务、文件存在性、链接和脱敏检查；不表示该平台所有路由、登录状态、媒体类型或未来页面结构都已通过。

部分完成表示有可验证交付物但来源完整性或部分组件未确认。阻塞表示浏览器、权限、适配器、页面门控或运行时条件未达到。跳过表示没有提供当前具体 URL。使用 --strict 时，任何缺 URL、部分完成、阻塞或失败都会让命令以非零状态退出。

常见的“失败”要按错误码处理：

- `PRIVATE_ADDRESS_BLOCKED`：本机系统 DNS 返回了保留地址；在确认网络允许后，可对本项目运行时执行 `set-dns cloudflare` 并重启，不要关闭公网地址校验。
- `CONTENT_SCRIPT_TIMEOUT`、`CONTENT_SCRIPT_UNAVAILABLE`、`TASK_TAB_NOT_READY`：重型动态页面或后台标签尚未就绪。运行时最多增加 10 秒、30 秒两个浏览器就绪窗口；仍失败时保留任务证据，不无限刷新。
- `TARGET_URL_MISMATCH`：当前页面已经离开目标内容路由。微信公众号遇到 `wappoc_appmsgcaptcha` 等验证跳转时属于访问门控，需要用户在浏览器完成验证或提供新的可访问 URL，不能自动跟随或绕过验证页。
- GitHub 的 Markdown blob 路由可能没有唯一的 `Public` 可见性证据；矩阵样本应优先使用公开仓库 README 根路由。
