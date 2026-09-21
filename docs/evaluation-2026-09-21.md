# Babel Content Downloader 可用性评测与修复（2026-09-21）

## 结论摘要

本轮按当前 Spec、内容收集与使用契约、平台覆盖清单和子项目文档进行了一次从接入到本地文件的真实验收。Chrome 中实际加载了当前正式 `dist/extension` 构建（版本 0.1.26，发布构建不含夹具 origin），本机 runtime bridge 恢复连接，stdio MCP 返回 8 个工具，图文与音频任务均通过真实浏览器任务页进入本地交付。

本轮发现并修复了一个功能性状态阻断：运行时不可达时扩展保留旧配对，原界面会同时显示“已连接”和 `BRIDGE_UNREACHABLE`，而且设置页没有重新连接入口。修复后错误状态会明确进入 error，保留技术诊断，欢迎页显示重连入口，设置页隐藏暂停/恢复并保留重连和撤销。

基于本轮已经取得的真实证据，修复后分为 **88/100**：核心闭环 22/25（≥20）、MCP/本地桥接 18/20（≥15），没有发现主流程 P0/P1。正式构建已在当前 Chrome 重新加载并完成正常态、断桥异常态、设置页控制可见性和恢复连接的现场签收，因此可用硬门槛 **通过**。

## 评分标准与前后分

| 维度 | 权重 | 初始分 | 本轮分 | 依据 |
|---|---:|---:|---:|---|
| 核心闭环 | 25 | 13 | 22 | 真实 Chrome 任务页 → bridge → MCP → 本地 `content.md`/图片和 M4A；未把受控夹具外推为 15 个生产来源全通过 |
| MCP / 本地桥接 | 20 | 8 | 18 | runtime ready、stdio 初始化、8 工具、check、observe/act、任务轮询与诊断均通过；夹具仍标记 `fixture_verified` |
| 浏览器兼容、权限与状态 | 15 | 10 | 13 | Chrome 真实加载、实际扩展 ID、配对/暂停/撤销/恢复和自有静音任务页通过；Edge/Firefox、浏览器重启尚未实测 |
| 交互 / 跳转 / 反馈 / 错误恢复 | 15 | 10 | 14 | 断桥矛盾状态修复；失败阻塞、resume、cancel、任务详情和技术折叠通过；没有扩展内下载提交页（按 Spec 由 Agent 提交） |
| 安装 / 上手 / 诊断 | 10 | 8 | 9 | Load unpacked、welcome/settings、setup 文案、技术信息和 runtime-status 通过；真实用户 Agent 配置未写入 |
| 视觉 / 响应式 / 键盘 / 基础无障碍 | 10 | 8 | 8 | 宽屏真实 UI、focus-visible、ARIA live 状态、五语言、disabled/loading/error/success 样式和 reduced-motion 源码均通过；修复后窄宽现场验收因锁屏未完成 |
| 性能 / 隐私 / 稳健性 | 5 | 4 | 4 | 任务页静音、用户页不导航/不关闭、音频完整解码；未做外部平台大媒体和跨浏览器压力验收 |
| **总分** | **100** | **61** | **88** | 初始分为 runtime 未安装/4318 不可达且状态反馈矛盾时的基线；本轮分不包含未覆盖平台的假设性加分 |

硬门槛复核：总分 88≥75、核心 22≥20、MCP 18≥15，且未发现 P0/P1；Spec 的本地接入、显式 URL、任务状态、浏览器保护、媒体工具检查、产物关系和取消/恢复关键要求已取得本轮证据。当前正式构建也已在 Chrome Reload/打开后完成正常态与断桥恢复签收，整体结论为“通过”。`BROWSER_VALIDATION_PENDING` 是夹具 adapter 的诚实覆盖标记，不是把 fixture 宣称为生产平台通过。

## 范围与依据

已阅读并对照：

- 根目录 `docs/Babel_Content_Downloader_核心PRD与技术方案_2026-09-18-spec.md`
- `docs/Babel_Content_Downloader_内容收集与使用契约_2026-09-18.md`
- `docs/Babel_Content_Downloader_平台覆盖清单_2026-09-18.md`
- `README.md`、`design.md`、`docs/acceptance-matrix.md`
- `docs/extension-install.md`、`docs/runtime-setup.md`、`docs/agent-setup.md`、`docs/package-validation.md` 及 MCP/运行时文档
- `package.json` 及构建、fixture、桥接、任务页、collector 代码

评分只针对易用性和当前“可用”目标。受控开发夹具证明扩展、runtime、MCP 和本地文件闭环，不证明所有 15 个来源的兼容性；付费、私密、DRM 和需要登录的内容未被绕过。

## 测试矩阵与现场证据

### 自动检查与构建

| 检查 | 命令 / 结果 |
|---|---|
| 单测基线 | 默认 5 秒超时曾有 345/348，3 项是环境超时而非断言失败；改用 `npm test -- --testTimeout 30000 --reporter=dot` 后 **44 文件、348/348 通过** |
| UI 状态回归 | `npm test -- --run tests/extension/i18n.test.ts --reporter=dot`，**8/8 通过** |
| TypeScript | `npm run typecheck`，通过 |
| LSP | `npm run lsp`，**109 files: 0 errors, 0 warnings** |
| 正式构建 | `npm run build`，通过，生成 `dist/extension` 0.1.26 |
| 夹具构建 | `BABEL_DEV_FIXTURES=1 npm run build:extension`，通过，生成 `dist/extension-dev`；仅用于本轮受控浏览器验收 |

### 真实 Chrome 与扩展 UI

- 通过 Chrome `chrome://extensions` 的 **Load unpacked** 实际加载扩展；真实 ID 为 `fcjbmfgcdfgliebffnhecgjdldachdgh`，版本 0.1.26。
- 本轮重新绑定并签收当前正式目录 `/Users/guojingwei/develop/ai-project/babel-ai-tutoring-system/babel-content-downloader/dist/extension`；Chrome 扩展页显示 **Extension loaded**，welcome 技术信息现场读到 ID `fcjbmfgcdfgliebffnhecgjdldachdgh`、版本 `0.1.26`、bridge `http://127.0.0.1:4318`。
- 通过扩展工具栏打开真实 welcome/settings 页面，确认连接状态、扩展 ID、版本和 `http://127.0.0.1:4318` bridge 信息可见。
- 停止 bridge 后重新加载/进入正式 welcome，AX 读到“本机运行时连接异常”及 `BRIDGE_UNREACHABLE`，错误态存在可见“连接本机运行时”入口；进入正式 settings，AX 只读到“连接本机运行时”和“撤销连接”，未读到“暂停/恢复”。随后以前台 runtime `serve` 恢复 bridge，点击重连，settings/welcome 均恢复“已连接到本机运行时”。本轮 CUA AX 与截图证据均来自当前 0.1.26 正式构建。
- 逐项点击并观察可见反馈：连接、撤销、重新连接、暂停、恢复；状态文案分别变为等待授权、已连接、已暂停，任务控制说明与按钮层级一致。
- 切换 English、简体中文和其他语言选项，页面文本和 `lang` 随选择更新；展开技术详情和错误详情；键盘 Tab 能移动到“返回概览”等可操作链接，焦点可见。
- 宽屏页面无明显横向溢出；静态 Hallmark 审计确认共享 focus-visible、disabled、error/success 状态、按钮不换行、窄宽媒体查询、reduced-motion 和技术内容折叠。未做全量视觉重做；没有发现功能性嵌套卡片问题。
- 本轮已完成正式构建在 Chrome 的 Reload/打开签收；断桥时主状态显示“本机运行时连接异常”，可点击重连，settings 不再提供失联 runtime 的暂停/恢复。

### runtime / MCP / 桥接

使用隔离的评测配置 `.audit/live-eval-20260921/config.json`，输出根目录也在该评测目录内；没有触碰用户 Agent 配置或外部敏感数据。

`runtime-status` 实测：`state=running`、`health=ready`、`loaded=true`、`restart_required=false`、版本 0.1.26。实际登记并探测了 `yt-dlp` 2025.11.12、`ffmpeg`/`ffprobe` 8.0.1，`babel_content_check` 对三项均返回 `available=true`。

本次最后一次 Chrome 断桥恢复使用同一隔离配置以前台 `node dist/bootstrap/cli.js serve` 保持 bridge 运行，CUA 点击“连接本机运行时”后现场恢复正常；此前的 LaunchAgent 运行/停止与 runtime-status 证据仍保留在本轮隔离评测记录中。

真实 stdio MCP 初始化并调用 `tools/list` 返回这 8 个工具：

`babel_content_check`、`babel_content_collect`、`babel_content_job_get`、`babel_content_job_resume`、`babel_content_job_cancel`、`babel_content_jobs_list`、`babel_content_browser_observe`、`babel_content_browser_act`。

`babel_content_check` 返回 `connection_state=connected`、`browser_required=true`、bridge instance connected、`paused=false`，目标 adapter 为 `development_fixture` / `fixture_verified`。

### 图文采集

真实 Chrome 自有夹具页：`http://127.0.0.1:4319/fixture/content/article`。MCP 任务成功，实际输出：

- `Babel 离线图文验收/content.md`：正文顺序和图片相对引用保留；
- `assets.json`、`metadata.json`；
- `assets/images-002-c027137c.png`，PNG、320×180，哈希与 manifest 一致；
- 任务状态 `succeeded`，`requested_components_complete=true`，artifact_count=4。

在另一个真实运行中的任务窗口调用 `babel_content_browser_observe`，返回实际 tab `144023737`，目标页标题为“Babel 离线图文验收”，evidence 包含 `background:owned_task_tab_muted`；随后调用 `babel_content_browser_act` 的只读 scroll，返回 `action_applied=true`。快照完成后自有临时任务页被清理，用户原标签页仍保留。

### 音频采集

真实 Chrome 自有夹具页：`http://127.0.0.1:4319/fixture/content/podcast`。MCP `save_as=audio` 任务成功，输出 `Babel 可收听内容验收/assets/audio-6b04c5c9.m4a`。独立 `ffprobe` 结果：AAC audio/mp4、时长 2.400000 秒；metadata 标记 `requested_components_complete=true`、`full_decode=true`，没有自动播放导出文件。

夹具输出的 `BROWSER_VALIDATION_PENDING` 是当前 adapter 的 `fixture_verified` 覆盖策略，已在结果 metadata 中保留；它没有被隐藏或改写为 production `browser_verified`。

### 失败、恢复、取消

- 对不存在的 fixture route `http://127.0.0.1:4319/fixture/unknown`，任务进入 `blocked`，返回 `DOWNLOAD_HTTP_ERROR`、HTTP 404、`retryable=true`，没有伪造产物；调用 `job_resume` 后仍明确保持 blocked。
- 提交音频任务后立即调用 `babel_content_job_cancel`，任务及随后 `job_get` 都返回 `cancelled`，没有假报 succeeded。
- 图文任务在 resolving/downloading/finalizing/verifying 过程中通过 `job_get` 轮询到最终状态；任务列表只返回当前授权 client 的任务。

## 修复内容

功能修复采用最小范围，没有改动采集策略或全量视觉：

- `extension/welcome/index.ts`：当当前错误不是 `PAIRING_NEEDED` 时进入 error 状态，主文案不再显示“已连接”；配对但 bridge 不可达时重新显示连接按钮。
- `extension/settings/index.ts`：错误状态下显示重连和撤销，隐藏暂停/恢复，避免对失联 runtime 做无效控制。
- `extension/_locales/{en,zh_CN,zh_TW,ja,ko}/messages.json`：补充连接异常主状态和恢复提示文案，保持所有语言 catalog keys 一致。
- `tests/extension/i18n.test.ts`：覆盖 `BRIDGE_UNREACHABLE` 时的主状态、error data-state、重连入口、设置页控制可见性。
- 新增本报告 `docs/evaluation-2026-09-21.md`。

## 功能阻断与纯审美问题

### 已修的功能阻断

- 断桥时“已连接”与 `BRIDGE_UNREACHABLE` 同时出现，导致用户误判可用性；已改为显式连接异常并提供重连。

### 当前没有发现的 P0/P1

- 没有发现会误操作用户现有标签页、自动播放、静音或关闭用户页面的行为。
- 没有发现 MCP 工具缺失、未经授权调用、任务取消后继续交付或媒体文件假成功。
- 没有发现主流程阻断级的 focus、disabled、loading 或 error 状态缺失。

### 纯审美/覆盖项，不阻断可用

- 五语言长文案、窄宽和不同系统字体仍需更多真实浏览器截图；这是覆盖项，不应在本轮做全量视觉重做。
- 生产 adapter 仍按平台清单逐站维护 `fixture_verified`/未验证边界；本轮没有把自有 fixture 的成功外推为所有 15 个平台通过。

## 未覆盖与残余风险

- 未在本轮访问真实登录、付费、私密或 DRM 内容，也未使用用户 cookies、账号或签名 URL。
- 未完成 Edge/Firefox 现场验收；README 已明确首版 Chrome 120+、macOS 托管 runtime 边界。
- 未完成 Chrome 重启后任务恢复的现场样本；源码和自动测试覆盖了持久检查点及重试策略。
- `BROWSER_VALIDATION_PENDING` 对 development fixture 是有意的诚实提示；真实生产来源需要各自的 live DOM、访问策略和最终文件证据，不能只看 build/test。
- 本轮使用隔离评测配置和本地夹具服务；完成后应停止本轮启动的 LaunchAgent runtime 和 fixture server，保留 `.audit/live-eval-20260921` 证据，不清理用户其他服务或文件。
