# Babel Content Downloader：A01–A30 当前证据矩阵

0.1.24 增量：43文件/338测试、typecheck/LSP与正式/开发构建通过；实际runtime/extension均0.1.24。Medium真实URL浏览器回退及同自有页explicit-tab任务均成功，各9产物/metadata7交付项大小SHA独立通过。内嵌内容auto/bundle转交与metadata字段已有受控验证，不能由Medium纯图文样本代替媒体真实验收。0.1.24 TGZ隔离安装/MCP八工具通过。旧版本记录保留历史语义，当前范围仍为15类来源，未宣称全部完成。

Q8 最新增量：运行时与实际扩展均0.1.23，统一HTTP/Readability与已许可URL的浏览器DOM回退已接入。42文件/327项测试通过，真实Anthropic/DeepMind图文与OpenAI本地化GPT-4两次HTTP任务通过；Medium回退在URL匹配失败，真实浏览器回退成功验收仍待完成。0.1.23运行时包隔离安装验证通过；详见 [通用网页验收](unified-web-validation.md)。下方0.1.21及以前是历史验收快照，不能用其博客逐站规则否定Q8通用路径；已排除平台仍不可采集。

历史0.1.21快照（范围仍适用，版本和实现状态以本页顶部增量为准）：用户 Q6 替代全平台覆盖，只验收明确的 15 个 AI／学习资料来源。源码保留 9 站、新增 5 站，OpenAI 官方文章尚未实现；16 个旧基线和 13 个候选已经退出。实际运行时为 0.1.21，修正开发构建遗漏后实际扩展已确认 0.1.21；38 文件／303 项测试、类型检查及四个变更 TS 文件 LSP 零诊断通过。0.1.20 Hugging Face 模型卡新任务已取得独立双快照 proof 并完整交付；数据集卡旧任务的正文与来源离线重放逐字节一致，但仍保留 partial。0.1.21 dataset 专用规则真实回验一次成功，取得两次采样／3885ms proof，三产物校验通过；仅限 AllNLI 说明卡样本。0.1.14 五类一手资料的 21 个产物／完整性 proof、B站教程视频已有对应证据；0.1.18 全新 YouTube 视频任务经一次自动重试成功，三个产物的哈希、清单映射、完整音视频解码与定位通过。页面 snapshot 仍 partial。0.1.18 英文字幕因头部校验误拒失败；0.1.19 已修复并通过离线检查，原任务首次恢复因上游网络中断阻断，第二次有界恢复已交付英文字幕，直接来源映射、286 条字幕时间轴与完整解码通过；任务仍 partial。历史失败与恢复过程保留，详细版本／样本见浏览器和平台记录。


更新：2026-09-20。范围：根据核心 PRD §18、规范说明书、内容收集契约、平台覆盖清单以及当前源码、测试和已有验证记录整理。此表是当前证据盘点，不是发布通过表。

## 证据口径

- “自动／静态证据”表示源码路径和项目测试覆盖了该边界；它不能代替真实扩展、真实 MCP 客户端、真实平台页面或最终文件的使用验收。
- `fixture_verified` 只表示项目自有受控 DOM／媒体夹具；平台记录中没有任何整体 `browser_verified`。用户安装扩展后，自有 HTTP 图文／播客夹具及真实 YouTube／Bilibili 单视频保存音频已走通 Chrome 扩展 → MCP → 本地文件。两个真实音频均经独立产物校验；首次采集失败仍作为历史证据保留。单个用途成功不提升其他内容类型或路由。
- 0.1.3 统一修复验证：`npm test` 97/97（15 个测试文件）、TypeScript 类型检查通过、实际 LSP 检查 59 个 TS 文件，0 errors / 0 warnings。9月18日受控闭环使用已加载0.1.2扩展；9月19日用户重新加载后，实际MCP确认当前活跃扩展0.1.3，不能把两个版本的实测混为同一结果。
- 0.1.5 源码验证：完整测试 166/166（23 个文件），TypeScript 通过，LSP 76 个 TS 文件、0 errors / 0 warnings。新增完整附件解析、坏旧缓存拒绝与有效缓存复用，并保留 0.1.4 的正文 proof、稳定采样和逐实例状态检查；构建、安装与新扩展实际采集仍分别验收。
- 0.1.6 冻结构建统一检查：`npm test -- --maxWorkers=2` 为 24 个文件／193 项测试通过；首次默认并发运行的两项在 5 秒期限到时被记录，未改断言或期限。TypeScript 通过，LSP 检查 77 个 TS 文件、0 errors / 0 warnings，正式与开发构建通过。之后运行时和新注册扩展均为 0.1.6 的五站真实回归完成：Substack 与企鹅号公开文章样本完整交付，搜狐与头条仍 partial，Pinterest blocked。旧会话只缓存注册版本，不能据此判断用户未重载；后续未构建源码修复不属于本轮实测。
- 自动测试通过表示相应代码边界已有验证；真实扩展、客户端和平台闭环仍单独记录。
- 0.1.7 新构建统一检查：25 个文件／202 项测试通过、TypeScript 通过、79 个 TS 文件 LSP 零诊断、正式／开发构建通过。运行时与实际扩展均为 0.1.7。四站新任务中，搜狐 17 文件含 14 图、头条 5 文件含 2 图均完整交付并通过独立核验；搜狐控件文字仍待清理。Facebook LOGIN_REQUIRED、Instagram ADAPTER_CHANGED，均无产物；保留失败结果，继续修正规则。单次样本不替代整个平台或全部并发行为的验收。
- 0.1.8 统一检查：26 个文件／216 项测试通过，TypeScript 通过，81 个 TS 文件 LSP 零诊断，93 个检查输入未变，正式／开发构建通过。113 文件源码包独立安装构建得到的 49 个编译文件与当前构建一致；真实隔离 LaunchAgent 在安装命令退出后可用，两个 stdio 客户端均初始化为 0.1.8 并取得 8 个工具，停止、重启、卸载和清理通过。此证据限本机独立运行时和协议客户端；没有写入用户实际 Agent 配置，没有验证电脑重启或新增浏览器采集。主运行时已更新为 0.1.8，实际扩展仍报告 0.1.7，等待重载。

## 本轮源码行为

- 0.1.18 的纯媒体／附件 bundle 现在有独立 `entry` 角色的 content.md 导航；不增加 source text 或 text 完成组件。文件链接存在、零有效产物不假成功、partial 续跑更新入口／替换为正文的本地集成测试通过。音频成功立即清理登记临时文件并保留未知用户文件也有 collector 级回归；新增行为仍待加载 .18 扩展后的真实 MCP／浏览器联调。

- `auto` 对有唯一明确主体的 `mixed` 内容直接选择可交付结果：保留可确认的正文／图片，并加入对应的视频、音频或文件；不再因只有这些媒体而返回空组件。
- 只有同一目标同时有独立 `video` 与 `audio`，且调用未给出 `include`、非 `auto` 的 `save_as` 或相关偏好时，任务才以 `SELECTION_REQUIRED` 停在解析阶段。`job_get` 返回 `video`、`audio`、有正文时的 `document` 和 `bundle` 选项；`babel_content_job_resume({ job_id, save_as })` 只接受其中一项并继续同一任务。
- `content.md` 的本地附件链接依据实际 artifact role／MIME 标注；从视频得到的音频标为“已保存音频（源视频：…）”。来源 paragraph 中形似 Markdown 的标题、引用、列表、围栏或分隔线不会成为文档结构，显式提取的 heading／quote／list 保持结构。
- 上述均是当前源码与 targeted tests 的边界证据，不新增真实扩展、浏览器、MCP 客户端或平台页面通过项。

## 真实媒体引擎样本（非浏览器 E2E）

[媒体验证记录](media-validation.md) 记录了受限 yt-dlp／FFmpeg 链路的两个真实输出：YouTube `dQw4w9WgXcQ` 为 1920×1080 H.264 + AAC 双声道 MP4、213.089524 秒，Bilibili `BV1GJ411x7h7` 为同编码／声道组合的 MP4、212.308833 秒。两份输出均经独立 ffprobe 核验，且由 `downloadMedia` 内部的 `ffmpeg -xerror` 完整解码；验证过程没有播放输出文件，也未加载扩展、浏览器或 MCP 客户端。这只证明媒体引擎输出，不提升任何平台为 `browser_verified`，也不构成扩展到本地文件的端到端验收。

## A01–A30

| 编号与目标 | 代码路径 | 已有自动／真实媒体证据 | 当前判断与尚缺真实验收 |
|---|---|---|---|
| **A01 接入**：新电脑安装扩展后完成最小接入 | `extension/welcome/index.ts`；`bootstrap/cli.ts`；`runtime/bridge/server.ts` | `docs/package-validation.md` 记录隔离安装包的 `init`、`add-client`、4322 启动和 stdio MCP；`tests/client-setup.test.ts` 有 Codex／Claude setup fixture；桥接 Origin／配对协议有 `tests/core-runtime.test.ts` | **实际 Chrome 接入部分通过**。用户手动加载后，真实 MCP 确认扩展 ID、connected 与 paused=false；受控采集通过。欢迎页暂停／撤销 UI 受自动化 URL 策略限制未验，独立 Agent 客户端闭环未验。 |
| **A02 保留已有 MCP 配置** | `runtime/policy/config.ts`；`bootstrap/cli.ts`；`bootstrap/client-setup.ts` | `tests/client-setup.test.ts` 的 Codex／Claude fixture 在保留既有 `other` 条目的前提下只添加／删除 Babel 自有条目，并拒绝已有同名或被改动的条目；package smoke 使用隔离配置 | **源码／fixture已补，真实客户端接入未验**。尚缺用户实际配置前后差异检查；隔离 fixture 不代表真实客户端配置已接入。 |
| **A03 与原版 mcp-chrome 同装** | `runtime/bridge/server.ts` 绑定 `chrome-extension://<id>` Origin；`extension/background/bridge-client.ts` 使用自身 ID | 非授权 Origin、错误扩展 ID 和错误 bearer 的桥接测试通过（`tests/core-runtime.test.ts`） | **自动边界已测，真实未验**。缺同一 Chrome 配置中并装 mcp-chrome 的实际注册、任务路由和服务互不覆盖证据。 |
| **A04 客户端需要重载** | `extension/background/bridge-client.ts` 清除失效 session；`welcome/index.ts` 显示配对／错误状态；`bootstrap/client-setup.ts` | `tests/client-setup.test.ts` 验证安装后状态为 `waiting_client_reload`；`tests/extension/bridge-client.test.ts` 覆盖 `SESSION_UNAUTHORIZED` 后重新注册；`docs/runtime-setup.md` 要求授权或配置变化后重启运行时 | **源码／fixture已补，真实客户端接入未验**。缺真实客户端收到“等待重载”、实际重载并通过 MCP 工具确认桥接的验收。 |
| **A05 只缺媒体引擎** | `runtime/diagnostics/dependencies.ts`；`runtime/collection/collector.ts`；`runtime/mcp/server.ts` | `tests/collection.test.ts` 缺 ffmpeg 后保留检查点并续跑；`tests/media-tool-config.test.ts` 覆盖固定工具探测；基础 MCP 不依赖媒体工具的 package smoke | **自动部分证据**。缺真实 MCP 中依赖缺失时正文仍可交付、诊断清楚且不误报完整媒体成功的客户端验收。 |
| **A06 适配来源的文章和图片** | `adapters/shared-extractors/extractor.ts`；`runtime/collection/document.ts`；`runtime/collection/collector.ts` | 自动测试覆盖可读文档、相对图片、原图字节和完整性 proof；真实知乎保存 150 个 block／24 图／27 产物，0.1.6 Substack 126 个 block／6 图／9 产物，均有双快照 proof 及独立文件校验 | **受控样本及知乎、Substack 各一篇公开文章闭环通过**。其他内容类型／路由仍需各自证据；退出来源的历史记录不再计入本项当前范围。 |
| **A07 图片含主要文案** | `runtime/collection/collector.ts` 按图片内容校验并保存；`runtime/storage/job-store.ts` 只清理敏感信息，不生成 OCR；README 明确无 OCR | 0.1.5 运行时／0.1.4 扩展的 Substack 真实任务中，两张 1456×367 JPEG／1380×370 PNG 教程截图经实际本地查看，文字、控件和指示箭头可辨；新核对哈希与清单一致，`content.md` 保留两个相对图片引用，未把图片中文字生成正文；此前完整像素解码通过 | **两张含教学信息截图的保存与可读性已有实物证据**。未重新访问源页面，未生成 OCR；该文章整体仍为 partial，不能据此提升全文完整性、其他图片或平台状态。 |
| **A08 单条社交笔记** | 各平台 `PlatformRule.contentId`、`target_link_selectors`；`extension/background/task-tabs.ts` 只解析单内容路由 | `tests/platforms/adapters.test.ts` 覆盖 XHS 单笔记和 X 单帖目标卡；适配器拒绝主页／搜索路由的测试在 `tests/platforms/adapters.test.ts` | **fixture／自动证据**。缺真实 XHS、X 及其他社交平台单条内容的浏览器到本地文件验收；不扩大到主页的真实证据尚未取得。 |
| **A09 帖子串** | `shared/contracts.ts` 的 relation 类型；`runtime/bridge/validation.ts`；`adapters/platforms/spec.ts` 的 `relations`；X 规则 | `tests/platforms/adapters.test.ts` 只用合成 target/reply roots 验证排除回复和限制展开 | **关系算法 fixture 验证通过**。当前没有完成验收的 X 真实帖子串；作者续帖、他人回复、引用卡的 live DOM／permalink／parent 关系未证明，不能宣告通过。 |
| **A10 免费非 DRM 视频** | `runtime/engines/media.ts` 过滤 DRM、限定单媒体、封装和完整解码；`runtime/collection/collector.ts` 交付校验 | 真实 YouTube／Bilibili 引擎 MP4 见 [媒体验证记录](media-validation.md)。新增 Bilibili 实际扩展 → MCP → MP4，1080p H.264 + AAC、212.308833 秒，独立哈希／完整静默解码／seek 通过；[浏览器记录](browser-validation-e2e.md) 保留首次网络超时及同任务续跑成功 | **Bilibili 单视频闭环通过，整项仍部分验收**。未手动播放文件；其他平台及内容、登录页／清单不会被当成视频的真实场景仍缺。 |
| **A11 分离音视频且缺 FFmpeg** | `runtime/engines/media.ts` 输入检查点；`runtime/collection/collector.ts` 恢复与合并 | `tests/collection.test.ts` 明确只下载一次并在 ffmpeg 恢复后续跑；`tests/core-runtime.test.ts` 覆盖依赖阻塞后恢复 | **自动证据；本轮媒体完整性自动验证通过**。缺真实平台分离轨道、修复依赖、续跑并验证最终音频／视频的客户端样本。 |
| **A12 运行时找不到已安装 Agent 工具** | `runtime/diagnostics/dependencies.ts`；`bootstrap/cli.ts` 的 `set-tool`；`runtime/policy/config.ts` | `tests/media-tool-config.test.ts` 验证绝对路径、版本探测和拒绝相对路径；package smoke 验证独立安装 | **自动部分证据**。缺真实运行时 PATH 差异、配置绝对路径、重启后 `check` 与同一任务续跑。 |
| **A13 保存到指定项目目录** | `runtime/policy/output.ts`；`runtime/collection/collector.ts`；`runtime/mcp/server.ts` | `tests/collection.test.ts` 读取最终文档和图片；`tests/core-runtime.test.ts` 覆盖授权目录／符号链接；package smoke 使用隔离 output root | **隔离授权目录实际交付通过**。真实扩展采集的图文和音频已保存到本项目 e2e 客户端授权目录，并实际读回核验。用户日常 Agent 客户端配置尚未安装，此证据不代替其接入。 |
| **A14 重名与重复请求** | `runtime/collection/collector.ts`；`runtime/jobs/manager.ts` 的幂等键和冲突 | `tests/collection.test.ts` 不覆盖现有文件；`tests/core-runtime.test.ts` 覆盖同幂等请求复用和冲突 | **实际本地 MCP 幂等复用／冲突通过**。.21 对既有 HF 数据集任务重复原请求返回同一 ID；同键改保存用途返回 IDEMPOTENCY_CONFLICT。任务列表不变，原任务记录及三产物字节不变，见 `.audit/e2e/runtime-0.1.21-idempotency/validation.json`。用户既有同名资料并存和真实 Agent 客户端尚未验收。 |
| **A15 图片／字幕等部分失败** | `runtime/collection/collector.ts` 逐项状态、`partial` 和 manifest；`runtime/mcp/presentation.ts` 暴露缺失项 | `tests/collection.test.ts` 覆盖坏图片、限流、字幕缺失和 resume；0.1.3 运行时／扩展的真实 Substack 任务逐项记录 7 张图片的 HTTP 404／`ASSET_HOST_NOT_ALLOWED`，`checkpoint.failed_components.images` 保留逐项错误，任务为 `partial`；后续 0.1.5 运行时／0.1.4 扩展的 Substack（6 图／9 产物）、头条（2 图／5 产物）、网易（5 图／8 产物）附件字节校验通过，但仍分别为 `partial`、`requested_components_complete=false` | **真实图片部分失败与不误报 complete 已有证据**。这些记录确认已保存可验证部分会如实保持 `partial`；尚无真实字幕部分失败、真实 MCP 客户端逐项展示或其他平台附件失败验收。 |
| **A16 任务标签采集** | `extension/background/task-tabs.ts`；`extension/background/service-worker.ts` | `tests/extension/task-tabs.test.ts` 覆盖仅操作自有标签、用户标签只读、完成／撤销／空闲清理 | **自有任务标签实际部分通过**。图文／播客页由已安装扩展创建；产品观察返回实际自有页静音标记，播客导航后复用同一标签。CUA仅查看自有页；完整用户页面保护矩阵和撤销操作仍待验收。 |
| **A17 后台标签停滞** | `runtime/bridge/server.ts` 90s bridge timeout；`extension/background/task-tabs.ts` 10s bounded target wait；`bridge-client.ts` 15s loopback timeout | `tests/extension/bridge-client.test.ts` 覆盖 stalled loopback；task-tab tests 覆盖 mute／target drift failure；内容脚本响应设有期限，同任务自动重试复用自有静音页 | **自动边界与实际恢复部分通过**。0.1.3 YouTube 音频任务在 2 次自动重试后成功，B 站音频首次成功；不能仅凭最终次数确定每次重试原因。首次版本的准备超时／DOM 异常记录保留，其他站点后台停滞仍待验。 |
| **A18 浏览器或运行时重启** | `runtime/jobs/manager.ts`；`runtime/storage/job-store.ts`；`bridge-client.ts` | `tests/core-runtime.test.ts` 覆盖签名 URL、fresh URL、interrupted checkpoint；`tests/job-policy.test.ts` 覆盖 retry／取消／TTL 清理，当前 TTL targeted tests 已通过 | **运行时重启实际部分通过**。4318运行时更新后，已加载0.1.2扩展自动重连；原图文任务通过resume续跑成功并完成文件检查。尚未重启Chrome，也未验证真实平台任务跨浏览器重启。 |
| **A19 两个 Agent 同时调用** | `runtime/jobs/manager.ts` 的客户端归属、全局／来源并发；`runtime/bridge/server.ts` 的实例选择；`runtime/mcp/server.ts` 鉴权 | `tests/core-runtime.test.ts` 覆盖 Alice/Bob 隔离和不同 bridge session；`tests/job-policy.test.ts` 覆盖最多两任务、同来源串行 | **自动证据**。缺两个真实 MCP 客户端并行连接、各自任务标签／取消／结果互不影响。 |
| **A20 登录或新增权限** | `adapters/shared-extractors/access.ts`；`adapters/platforms/spec.ts` 默认 gate；`extension/welcome/index.ts` 配对提示 | `tests/platforms/adapters.test.ts` 覆盖标题壳、paywall 和无正文拒绝；访问分类代码区分 `login_public_free`／paid／private | **自动部分证据**。缺真实登录页、必要权限提示和用户动作后的继续采集；不能把已有登录状态当成已验收。 |
| **A21 明确限流** | `runtime/engines/network.ts` 解析 `Retry-After`；`runtime/jobs/manager.ts` 最多两次有界 retry | `tests/collection.test.ts`；`tests/job-policy.test.ts` 覆盖 429、503、等待上限、partial、取消；当前 Sol retry targeted tests 已通过 | **代码边界与 targeted tests 已验证**。缺真实平台 429／503、有限退避、状态报告和不轮换账号的端到端记录。 |
| **A22 付费／私密／受保护内容** | `adapters/shared-extractors/access.ts`；`runtime/collection/collector.ts`；`runtime/engines/media.ts` 过滤 DRM | `tests/platforms/adapters.test.ts` 覆盖 paywall；媒体选择拒绝 `has_drm`；collector 对 paid/private 抛出范围错误 | **合成／代码证据**。缺真实付费、私密、DRM 页面在所有回退路径中的阻塞记录；不允许用已登录页面替代。 |
| **A23 网页提示安装恶意依赖** | `runtime/engines/process.ts` 固定 executable／argv、`shell:false`；`runtime/collection/collector.ts` 原文只写入资料 | `tests/collection.test.ts` 保留网页指令为正文并验证取消，不执行网页文本；媒体依赖只由 `set-tool` 固定 ID 探测 | **代码边界自动验证通过**：网页文本不会驱动系统命令，进程参数和 shell 边界固定。相关真实浏览器到 MCP 场景尚未验，但不覆盖已有代码证据。 |
| **A24 路径穿越或内部地址附件** | `runtime/policy/output.ts`；`runtime/engines/network.ts`；`runtime/storage/temporary-files.ts` | `tests/collection.test.ts` 覆盖私网／保留地址、重定向、端口和大小；`tests/core-runtime.test.ts` 覆盖 symlink escape | **代码边界自动验证通过**：输出路径、内部地址、重定向和临时文件边界已有测试。相关真实浏览器附件链路尚未验。 |
| **A25 日志与工具响应不泄露会话资料** | `runtime/storage/job-store.ts`；`runtime/mcp/server.ts`；`runtime/engines/process.ts`；`runtime/mcp/presentation.ts` | 自动测试覆盖脱敏和有限引用。已只读审计历史 0.1.3–0.1.5 的 170 个 JSON（含 84 个实际 MCP 返回）、32 个 MD/log、22 个交付 metadata/assets、7 个文档、65 个二进制结构化元数据及 29 个持久任务；在这些语料中未发现认证头、会话凭据或短期签名参数 | **列明真实输出语料的脱敏检查通过**。不覆盖浏览器内部状态、进程内存、网络包、未持久化桥接注册响应或系统日志；字段／模式扫描不是所有未知秘密的穷尽证明。受控公开内容身份参数与客户端／扩展引用不当作认证凭据。 |
| **A26 长文章、大视频** | `runtime/mcp/presentation.ts` 分页文件引用；`runtime/mcp/server.ts` job get/list；collector 有大小预算 | 0.1.5 运行时／0.1.4 扩展的知乎实际文章有 150 个 block、24 张按序图片、27 个产物和 26,366 字节文档，产物验证通过。0.1.6 运行时只读查询该历史任务，两页实际 HTTP SSE 响应为 9189／4714 字节，分别返回 20／7 个文件引用，合计 27 项无重复；响应省略全文 blocks | **一条较大图文的本地文件、实际响应大小和分页引用已有证据**。不是 0.1.6 新浏览器采集，也未完成整篇人工阅读体验；没有真实大视频任务、播放或声音体验验收，不能将本项整体提升为通过。 |
| **A27 平台结构变化** | `extension/background/service-worker.ts` 对空壳有限重试；`runtime/bridge/server.ts` snapshot／origin／adapter 校验；`task-tabs.ts` drift | `tests/platforms/adapters.test.ts`；`tests/extension/task-tabs.test.ts` 推荐视频漂移返回 `TARGET_DRIFTED`；collector 返回 `partial`／不完整状态 | **合成／自动证据**。缺真实页面结构变化或登录壳样本，需确认明确失败／不完整而非空正文成功。 |
| **A28 安装与升级回滚** | `scripts/build-extension.mjs`、`package.json`；配置写入 `runtime/policy/config.ts` | `docs/package-validation.md` 记录 0.1.5 独立生产安装、源码 ZIP 重建 48 个产物一致、实际已安装解析器及 0.1.3→0.1.5→0.1.3 隔离运行时升级回滚，任务／授权配置／用户资料模拟文件保持正确；较早版本检查保留 | **运行时包升级／回滚部分通过**。限本机和所测版本／任务状态；Chrome 已从 0.1.3 更新至 0.1.4 并实际重连，卸载、其他系统和日常 Agent 客户端仍需分别验收。 |
| **A29 未适配的平台** | `adapters/registry.ts` 仅注册当前 14 站（9 个保留来源＋5 个实验性新来源）；扩展权限与注入列表同步收窄 | `tests/platforms/adapters.test.ts` 按明确 ID 集合和排除域名验证 registry／coverage／manifest 边界，新增目标在实现前不注册 | 本次范围单元检查已通过；不能以通用正文或媒体引擎接管已移除／未实现来源。历史任务与用户文件保留，不恢复旧网络权限。 |
| **A30 首版课程专项任务** | `README.md`、`docs/specs/Babel_Content_Downloader_核心PRD与技术方案_2026-09-18-spec.md` 明确公开免费范围；`collector.ts` 付费／私密阻塞 | 现有安全／访问测试验证公开免费范围和 paid/private 阻塞；当前没有课程平台专项适配 | **通用范围／安全代码边界已验证**。课程专项功能本身尚未实现，后续若接入课程平台再单独做真实场景验收；不把缺少课程样本当作上述安全边界未验证。 |

## 静音专项（R13a，关联 A16–A17）

代码和 mocked Tabs API 已覆盖预期顺序：`extension/background/task-tabs.ts` 先创建后台 `about:blank`，调用 `tabs.update({muted:true})` 并确认 `mutedInfo.muted === true`，再导航；`task-tabs.ts` 在复用、导航、等待目标和动作前继续核对静音。`tests/extension/task-tabs.test.ts` 覆盖默认静音、静音确认缺失／失败不加载目标、复用、精确导航；`runtime/engines/media.ts` 只读文件、ffprobe、ffmpeg 解码，不播放系统声音。

用户安装后已取得实际产品证据：图文／播客的MCP观察返回 `background:owned_task_tab_muted`，该标记由已加载扩展在实际 `chrome.tabs.get` 核对后添加；播客精确导航后仍使用同一自有标签并再次通过静音核对。CUA可见图文和音频控件，未手动播放或修改系统／站点音量。CUA本身不暴露mutedInfo，未做系统声道录音；其他真实平台自动播放及完整用户标签保护矩阵仍待验。此前站点级静音记录不是本项证据。

## 结论边界

当前证据新增真实扩展接入、受控图文／音频完整保存、YouTube／Bilibili 单视频保存音频的实际闭环、运行时重启后的同任务恢复，以及实际自有标签静音／复用检查。旧的“扩展未加载”阻断已解除；欢迎页 UI 仍受自动化 URL 策略限制。A01–A30 的整项验收仍有第三方平台、其他客户端和环境缺口，不能将局部通过升级为全项通过。平台状态以 `docs/platform-status.md` 为准，注册、fixture 和媒体引擎不能替代真实平台交付。
