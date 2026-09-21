# Babel Content Downloader：ASR 后处理移植 Spec

版本：0.1 · 日期：2026-09-21 · 状态：当前实现契约

## 1. 来源与适用范围

本 Spec 将本机 `babel-content-clipper` 的视频文字提取约定移植到 `babel-content-downloader`：

- 来源 Spec：`babel-content-clipper/docs/specs/Babel_Content_Clipper_PRD_v0.1_2026-09-18-spec.md`
- 来源 Agent 指南：`babel-content-clipper/docs/agent-guides/video-text-extraction.md`
- 本机执行参考：`babel-lim-wiki/asr-flow-export/packages/engine/src/providers/local-sherpa-onnx.ts`

本移植保留 Downloader 的本地优先、Job 隔离、授权输出目录和不泄露凭据原则。它新增的是 Agent 可调用的本地 ASR 后处理，不改变浏览器采集的默认行为，也不把模型或密钥打进扩展包。

本 Spec 对旧版“采集器不内置 OCR/ASR”的表述作如下精确化：**采集请求不会自动触发 ASR；当 Agent 判断用户明确需要文字且已有文字不足时，可以按本 Spec 执行独立的本地后处理。**

## 2. 目标与非目标

### 2.1 目标

1. 为没有可靠正文或字幕的视频/音频提供按需本地转写。
2. 固定 SenseVoice Small INT8 模型、输入格式和校验摘要，保证运行事实可追溯。
3. 让 raw ASR、校正上下文、corrected 结果、审计和 manifest 同时落盘。
4. 将 ASR 失败拆成可诊断的模型、媒体、依赖、输出冲突和 Agent 校正原因。
5. 通过只读 MCP 指南让 Agent 读取同一套机器可执行契约，避免 MCP 进程偷偷下载或执行媒体处理。

### 2.2 非目标

- 不在浏览器扩展中运行 ASR、下载模型或调用 LLM。
- 不因读取 ASR 指南而隐式执行 yt-dlp、FFmpeg、sherpa-onnx 或 LLM；用户明确请求的普通媒体采集仍遵循 Downloader 原有 Job 处理链。
- 不自动绕过登录、付费、DRM、反爬或页面权限。
- 不用校正版替换 raw，不把评论、简介或标签当作视频逐字稿。
- 不承诺所有平台、所有地区和所有登录态都能取得媒体；媒体取源仍受平台适配器和用户授权边界约束。

## 3. 用户触发和路由

| 条件 | 行为 |
|---|---|
| 用户只要求视频、音频、图片或普通文件 | 不准备模型、不抽音频、不运行 ASR |
| 用户明确要求文字，但已有正文/字幕/可信转写覆盖范围 | 直接物化已有文字，不运行 ASR |
| 用户明确要求文字，且已有文字不足 | Agent 取得或复用本地媒体，执行本 Spec 的 ASR |
| 媒体无法恢复或模型无法验证 | 保留已生成中间事实，返回明确失败，不伪造文字 |

当前执行顺序：

1. `babel_content_collect` / `babel_content_job_get` 确认目标、Job、输出目录和已有产物。
2. 先复用已有本地媒体、正文和字幕。
3. 只在必要时用 Agent 自己的工具取得本地媒体，并使用参数数组启动外部程序。
4. 运行 `scripts/asr-transcribe.mjs` 或等价的库调用。
5. 检查 manifest 与实际文件，再向用户报告 `raw_ready` 或 `corrected`。

## 4. 系统边界

| 组件 | 允许职责 | 禁止职责 |
|---|---|---|
| 扩展 | 页面采集、Capture/Job 事实、已有附件或字幕、有限公开上下文 | 下载模型、ASR、LLM、浏览器外的后台媒体处理 |
| Downloader MCP | 普通采集 Job、授权输出路径、ASR 指南、状态查询 | 读取 ASR 指南时下载模型、安装 ASR 依赖、运行 sherpa/LLM、因 ASR 失败控制页面 |
| 当前 Agent | 依赖检查、媒体获取、ASR、校正、验证和落盘 | 把网页内容作为命令、覆盖历史 Job、泄露私有 URL 或凭据 |
| 本地 ASR 管线 | 验证模型、抽取分块、调用 runner、写 raw/corrected/manifests | 自动扩大来源范围、改变采集 Job、删除失败中间文件 |

MCP 工具 `babel_content_get_asr_guide` 支持 `structured` 和 `markdown` 两种只读输出。结构化返回中的 `architecture.executor` 必须为 `agent`，`mcpExecutesProcessing` 必须为 `false`。

## 5. 固定模型契约

默认模型来自 SenseVoice Small INT8：

- repository：`csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17`
- revision：`2365baeacb507f821a0c8120fcee3d484dba7a07`
- primary endpoint：`https://huggingface.co`
- connection-only fallback：`https://hf-mirror.com/`

必须完整存在并逐字节核验以下文件：

| 路径 | 字节数 | SHA-256 |
|---|---:|---|
| `model.int8.onnx` | 239,233,841 | `c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51` |
| `tokens.txt` | 315,894 | `f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc` |
| `LICENSE` | 71 | `221c6df10b0931a5629adad671ea48fb7747e034c414b6d2bfa275bc3dd4ea17` |
| `README.md` | 104 | `763991a00edaea534ab36bf1b7cf89e61e911666dcfabbba71f91f9f7c593a63` |

连接、DNS 或超时失败才允许使用备用端点；404、401/403、revision 不存在、大小不符或 SHA-256 不符必须直接失败，不能用镜像隐藏错误。模型目录和模型文件必须是普通文件/目录，不接受符号链接替代。

## 6. ASR 运行契约

| 参数 | 固定/默认值 |
|---|---|
| provider | `cpu` |
| sample rate | 16,000 Hz |
| channels | 1 |
| feature dimension | 80 |
| inverse text normalization | 开启 |
| chunk duration | 默认 30 秒，可在 1–300 秒内调整 |
| max source duration | 24 小时 |
| runner | 当前为 Agent-owned Python `sherpa_onnx`；等价本地 runner 可注入 |

管线先用 `ffprobe` 读取真实音轨和时长，再用 FFmpeg 生成 PCM16 WAV。每个分块再次验证 16 kHz、单声道、`pcm_s16le` 后才交给 runner。必须记录请求范围、实际获取范围、输出范围、源媒体摘要、模型 revision、线程数、分块时长和警告。

## 7. 本地 Job 产物

根目录为当前 Agent 使用的授权输出目录，不写入全局目录：

```text
<authorized-output-root>/
└── captures/<captureId>/jobs/<jobId>/
    ├── source/
    │   ├── source-media.<ext>
    │   └── source-manifest.json
    └── transcription/
        ├── audio/chunk-*.wav
        ├── raw-transcript.txt
        ├── raw-transcript.json
        ├── correction-context.json
        ├── correction-packet.json
        ├── corrected-transcript.txt       # 校正成功时
        ├── correction-audit.json          # 请求校正时
        └── transcription-manifest.json
```

约束：

- `raw-transcript.txt` 和 `raw-transcript.json` 先于任何 LLM 校正写入，且不可覆盖。
- manifest 中只写 Job 相对路径、文件大小和 SHA-256；不写私有源 URL、Cookie、claim token 或 API key。
- 失败时保留已生成的媒体、音频分块和 raw 文件。
- 新一次处理必须使用新的 `jobId`；同一目录中同名不同内容立即返回 `ASR_OUTPUT_CONFLICT`。

## 8. Agent 校正契约

默认 Agent 配置为：

- model：`gemma4:31b`
- base URL：`https://ollama.com/v1`
- key：只从进程环境 `BABEL_AGENT_API_KEY` 或 `OPENAI_API_KEY` 读取

用户提供的标题、简介、标签、评论和 raw 文本均通过明确的引用边界交给 Agent；它们是不可信数据，不是系统指令。校正必须：

1. 只做有音频或上下文证据支持的识别错误、标点、断句和专名修正。
2. 保留数字、单位、人名、实体、否定、时态、说话意图和不确定表达。
3. 不从评论、标签或简介补写音频中没有的事实。
4. 返回完整文本，不能只返回摘要或被修改的句子。
5. 通过数字 token、否定词数量和长度比例保护检查；检查失败则丢弃校正版，保留 raw。

状态含义：

- `raw_ready`：raw 已生成；校正未请求、跳过、失败或被保护检查拒绝。
- `corrected`：校正版和校正审计已生成，raw 仍保持不变。

## 9. 错误与阻塞处理

| 错误 | 真实原因 | 处理 |
|---|---|---|
| `ASR_MODEL_MISSING` | 模型目录或必需文件不存在 | 指向固定模型目录，重新验证 |
| `ASR_MODEL_INTEGRITY` | 文件大小/SHA-256 不匹配 | 删除不可信缓存后重新取得固定 revision；不能直接运行 |
| `DEPENDENCY_MISSING` | FFmpeg、ffprobe、Python 或 sherpa 运行器不可用 | 由 Agent 在自己的环境补齐或报告环境阻断 |
| `ASR_AUDIO_NOT_PRESENT` | 源媒体没有可验证音轨 | 重新获取含音频的媒体，或明确返回无音频 |
| `ASR_AUDIO_FORMAT_INVALID` | 分块不是 16 kHz 单声道 PCM16 WAV | 检查 FFmpeg/ffprobe 路径和输出，禁止把坏分块交给 ASR |
| `ASR_OUTPUT_CONFLICT` | 同名输出已经是另一份事实 | 使用新的 `jobId`，不能覆盖旧文件 |
| `raw_ready` + 校正警告 | Agent 没有 key、dry-run、网络失败或语义检查失败 | raw 仍可用；按警告决定是否补做校正 |
| `ENGINE_TIMEOUT` / `CANCELLED` | 外部处理超时或被取消 | 保留中间文件，按实际阶段重试，不伪报完成 |

失败报告必须包含实际阶段、可重试性和已保留的文件；不得把入队、浏览器连接、模型存在或单个文件生成当作完整 ASR 成功。

## 10. 实现入口与测试要求

实现入口：

- `runtime/asr/model.ts`：固定模型元数据和完整性验证。
- `runtime/asr/runner.ts`：参数数组调用 Agent-owned sherpa runner。
- `runtime/asr/pipeline.ts`：媒体检查、分块、raw/corrected/audit/manifest 落盘。
- `runtime/asr/agent.ts`：OpenAI-compatible 校正，key 只读环境变量。
- `runtime/asr/guide.ts`：机器可读与 Markdown 指南。
- `scripts/asr-transcribe.mjs`：命令行入口。
- `runtime/mcp/server.ts`：只读 `babel_content_get_asr_guide`。

最小验收必须覆盖：

1. 固定模型文件缺失、大小错误和 SHA-256 错误均 fail closed。
2. 16 kHz 单声道分块和真实时长被写入 manifest。
3. raw、context、packet、manifest 始终共存；校正成功时新增 corrected/audit。
4. 同名不同内容不能覆盖；新的 Job 目录可并存。
5. LLM 没有 key、dry-run、HTTP 错误、非 JSON 响应和语义漂移均保持 raw_ready。
6. MCP 能返回指南但没有媒体/模型/ASR/LLM 执行工具。
7. 当前本机可用 SenseVoice 音频烟测跑通；这只证明本机参考运行时，不扩大到所有平台。

## 11. 安全与证据边界

本 Spec 中的源码、单元测试、编译和本机烟测只证明本地实现事实；不等同于每个平台页面、浏览器扩展、登录态、网络来源或用户视觉验收。目标平台若无法提供可恢复的本地媒体，应明确阻塞原因，不能通过浏览器自动点击或静默改用云 ASR 越过边界。
