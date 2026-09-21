# Babel Content Downloader：浏览器联调记录

## 0.1.21 数据集说明卡真实回验

补构建实际加载目录 `dist/extension-dev` 后，用户重载，心跳确认 .21 connected／unpaused。新任务 `job_01929b66-5771-49bf-baf7-1d9449d26b31` 一次尝试 succeeded，无自动或手工重试；public_free、31 blocks、0 附件，snapshot complete 且 requested_components_complete=true。持久 proof 为 `huggingface.dataset.public-card-root.v1`，两次采样／3885ms、零 pending，规则版本 2026.09.20.7。

三个实际产物大小和 SHA-256 独立核验通过；2567 字节正文与 .20 已完成来源对照的文档逐字节一致。只保存 AllNLI 说明卡，无数据行、数据文件或权重下载。保留 BROWSER_VALIDATION_PENDING 平台提示，本轮不执行 CUA／前台 observe，不提升整站或全生命周期静音验收。旧 .20 partial 不改写。证据 `.audit/e2e/browser-0.1.21/root-proof-validation.json`、`hf-dataset-artifact-validation.json` 及 `.audit/build-0.1.21/check-user-reload.json`。

## 0.1.20 Hugging Face 数据集卡片后台验收

新任务 `job_d546fd08-85f2-45ab-804e-7ce24464439b` 采集 `sentence-transformers/all-nli` 数据集说明卡，save_as=document、new 后台自有任务页、allow_focus=false。一次尝试稳定 partial／CONTENT_INCOMPLETE，无自动或手工重试；public_free、31 blocks、零来源附件，正文完整性 unknown。交付 2,567 字节 content.md 与 assets／metadata 两份 JSON，三个文件大小和 SHA-256 独立核验通过。没有请求或下载数据集文件／权重，也没有 CUA、前台浏览器或额外 observe；不附加前台可见性或全程静音的实测结论。

证据 `.audit/e2e/browser-0.1.20/hf-dataset-job.json`、`hf-dataset-artifact-validation.json` 和 `hf-dataset-root-hashes.json`。普通 HTTP 唯一 DatasetHeader 的 ID 与目标相符、private=false／gated=false，唯一说明根位于 `.audit/hf-dataset-discovery-0.1.20/`，`comparison.md/json` 已完成对照：生产适配器离线提取／schema／渲染与真实交付正文逐字节一致（SHA-256 `1ad8e38fc555902bf03e8657d9c36fc0413fd72ce8639cdd08c27846ab0458c4`）；6 个标题、21 段正文、4 段保留缩进的 Python 代码、2 条引用及末尾一致，来源无表格。Viewer／API／Parquet 和侧栏均在说明根之外。这些对照不补造旧任务的双快照 proof。

## 0.1.20 模型卡完整性真实回归

实际扩展 .20 已通过心跳确认。新任务 `job_deb926e1-6fea-433d-8d19-da87c5f7b95b` 首轮 CONTENT_SCRIPT_TIMEOUT 后一次自动重试 succeeded，未手动 resume／重复提交；public_free、snapshot complete、requested_components_complete=true，规则 2026.09.20.6。持久 proof 为 `huggingface.model.public-card-root.v1`，两次采样、3831ms 窗口、零 pending，绑定当前模型 ID；并非仅从任务状态推断通过。

三产物实际大小／SHA-256 通过，10,506 字节 content.md 与 .19 已按原页面逐项对照的正文完全相同，保留代码、34 行表格和结尾 Total。没有模型权重／数据集下载。保留 BROWSER_VALIDATION_PENDING 平台级警告，本轮未另建诊断页，不增加采集标签全生命周期静音或整站验证声明。旧 .19 partial 记录不改写。证据 `.audit/e2e/browser-0.1.20/hf-model-artifact-validation.json` 与 `root-proof-validation.json`。

## 0.1.19 Hugging Face 模型卡与 OpenAI 发现

HF 模型卡 `sentence-transformers/all-MiniLM-L6-v2` 的新任务 `job_645299a4-6462-41eb-8952-d791e5c17a62` 一次尝试 partial／CONTENT_INCOMPLETE：public_free，26 个正文 block，零附件，交付 content.md／assets.json／metadata.json，三个文件大小和 SHA-256 独立核验通过。普通 HTTP 取得唯一 ModelHeader（相同 ID、非 private／非 gated）及唯一 model-card-content 根。成功后另建的诊断页 AX 对照确认正文止于训练表 Total 1,170,060,424，之后下载量、推理控件、模型树与页脚没有混入文档。此证据不能把旧任务 unknown 改写为 complete，也不覆盖 dataset／blog。见 `.audit/e2e/browser-0.1.19/hf-model-*` 与 `.audit/hf-model-discovery-0.1.19/`。

OpenAI GPT-4 文章在普通 Chrome 可读，并跳转 zh-Hans-CN 路由；AX 显示正文和相关内容边界，但没有精确 DOM／图片 host，且有加载占位。对该实际本地化 URL 的普通 HTTP 请求仍返回 403，未绕过访问限制。OpenAI 尚无适配器／权限，见 `.audit/openai-discovery-0.1.19/`。

## 0.1.19 字幕修复与恢复验收

运行时 .19／实际扩展 .18，扩展字节未变。修复 WebVTT Kind／Language 头部兼容并按指定语言精确优先；时间轴校验不放宽。原任务 `job_507e7d20-8430-43ca-b63d-8e04c81f0030` 的首次手工恢复经一次页面自动重试进入采集，随后因 yt-dlp API IncompleteRead 阻断（attempts=3，automatic_retries=1，ENGINE_FAILED／retryable，未计划自动重试），仍仅两份旧 JSON、无字幕。同任务第二次且最后一次手工网络恢复后交付 27,333 字节 VTT 与两份 JSON（总 attempts=5、automatic_retries=2），最终 partial／CONTENT_INCOMPLETE。manifest 将文件与 engine-subtitle-6、language=en、SHA-256 b7c03fd6e3ab262f1f373fc7b6005cdd3cc9a427de563b554f439448909f599f 直接绑定；三个文件哈希、286 条字幕时间轴、ffprobe 286 packets 与完整 ffmpeg 字幕解码通过。时间范围 4.22–1105.64 秒。任务完整性仍未确认，不把该恢复计作首次自动成功。证据 `.audit/e2e/browser-0.1.19/youtube-subtitles-resume-validation.json` 与 `root-subtitle-verification.json`。

## 0.1.18 YouTube 自动采集

用户重载后的实际扩展为 0.1.18。新任务 `job_a02a442c-52f5-497b-8ff9-3dfcfc4e05df` 首次 ADAPTER_CHANGED 后经一次自动重试 succeeded（attempts=2），未手动预热、resume 或重复提交。交付 52,784,790 字节、1280×720、1119.933333 秒 MP4 与两份 JSON，三个文件大小／SHA-256 已独立复核，清单与元数据一致，完整音视频解码及首／中／尾定位检查通过。所请求 video 完成，页面 snapshot 仍 partial，保留完整性警告。

成功后 observe 新建诊断页，产品检查与 CUA AX 显示该页静音；此证据不代表原下载页的全生命周期静音记录。该页含 59 个正文块，不能用于证明无正文 bundle 入口。显式英文字幕任务 `job_507e7d20-8430-43ca-b63d-8e04c81f0030` 一次尝试后 failed／ASSETS_PARTIAL：en 与 en-orig 两个来源均未通过 WebVTT 文件头检查，仅留下 manifest／metadata 两份 JSON，没有字幕交付；原因正在排查，未重复提交。证据位于 `.audit/e2e/browser-0.1.18/`。

## 0.1.18 回归前置状态

295 项测试、类型与变更文件 LSP 通过；正式／开发构建均为 .18。实际运行时 .18 已通过 stdio initialize，用户重载后已通过实时心跳确认扩展 .18（connected／unpaused），消息分类与无正文 bundle 入口回归进行中。YouTube 新自动任务为 `job_a02a442c-52f5-497b-8ff9-3dfcfc4e05df`，终态另记。既有 .17 的 UNAVAILABLE 是旧消息层统一映射的错误码，不能反推出必然没有接收端；失败现场标签已在后续库存检查中不存在，未重建假现场。

## 0.1.17 新任务自动回归结果

新 YouTube 自动任务 `job_2083f432-a6ce-4fdb-b8ac-4dae5712cb46` 经 3 次尝试／2 次自动重试后 blocked，最终 CONTENT_SCRIPT_UNAVAILABLE，早期观察为 CONTENT_SCRIPT_TIMEOUT，0 产物；没有手动续跑、重复提交或提前 observe。未触发新增 ADAPTER_CHANGED 等待分支，不能据此宣称自动慢加载恢复已通过。独立产物验证器 exit 1 表示零产物，不表示某个已交付视频解码失败。详见 `.audit/e2e/browser-0.1.17/regression-summary.md` 与 `youtube-job.json`。之前 .16 手动恢复的视频成功与文件核验结论保持独立。

## 0.1.17 自动就绪回归前置状态

实际运行时 .17 与已连接扩展 .16；扩展字节未变，无需重新加载。282 项测试、类型与变更文件 LSP 通过。新的 YouTube 720p 视频任务将单独验证 60 秒／240 秒自动重试路径，不手动 resume，不提前 observe 刷新任务页使用时间。此处只记录前置状态，终态另记。

## 0.1.16 诊断回归前置状态

运行时已通过实际 stdio initialize 确认为 0.1.16；扩展正式／开发构建通过，规则 2026.09.20.5。Chrome 已通过心跳确认 0.1.16。首次实际诊断确认 Medium 的唯一公开 article 及 figure 祖先链；YouTube 同一静音任务页首观测及延后观测的两个 watch metadata 根均为 0，仍 unknown。两站均有产品静音证据，无 collect／resume／play。见 `.audit/e2e/browser-0.1.16/`；这只验证诊断链路，不是下载成功或正文完整性证明。


0.1.16 后续证据：Medium 同一页延后观察出现 text input／checkbox 的真实祖先链，AX 同时确认 newsletter；首次无 input 不能证明订阅区已消除。X 新任务 `job_25777458-2429-4984-92c4-ba50af26da54` 在 3 次尝试后 blocked／ADAPTER_CHANGED、0 产物；一次 observe 已返回未知正文根与自有页静音证据。与 .15 的 CONTENT_SCRIPT_TIMEOUT 相比，本次获得了可用响应，但不能仅据此把变化归因于缓存优化，也不能宣称采集成功。

### YouTube 同页延后就绪与续跑（0.1.16）

同一自有静音页 `144022754` 的初次和约 15 秒后观察均无 metadata 根；距初次约 308 秒的观察得到唯一可见根与 public_free。只证明这段观察间隔内已就绪，不能据此认定固定加载耗时为 5 分钟。证据 `youtube-observe-final.json`。

在确认原页仍存在后，仅恢复历史任务 `job_80b1d3cf-d8c4-4078-8022-26e26e69f7bd` 一次；原来的两次自动重试计数使续跑复用已就绪页。运行时／扩展均为 0.1.16，输出目录仍为原任务的 `browser-0.1.15/youtube/`。0.1.16 同任务一次续跑已 succeeded，交付 52,784,790 字节的 H.264 1280×720／AAC 双声道 MP4，时长 1119.933333 秒；3 个产物大小、SHA-256、清单／元数据映射及完整音视频解码、首中尾定位通过。所请求 video 完整，页面 snapshot 仍 partial；这不是首次自动成功。证据 `artifact-validation.json` 与 `youtube-resumed-job.json`。

## 0.1.15 实际回归与独立产物核验

- Medium：`job_da290b45-8068-4fe1-92ef-be67010b550b`，一次尝试 partial／CONTENT_INCOMPLETE，正文、5 张 WebP 与旁车共 8 个产物。8/8 大小／SHA-256、5 图生产校验器全像素解码、来源映射和本地引用顺序通过；作者头像已排除。首／末图有 brain／Plinko 标签，中间三图仅证明来源和顺序，不扩大语义结论。
- 本次保存正文未包含 newsletter 的已知字符串，但稍后同页 AX 仍出现订阅表单，不能认定边界已修复。正文还混入阅读时长和放大图片提示，完整性仍 unknown。普通 HTTP 请求仍为 403，AX 工具不提供精确 HTML 祖先。
- YouTube：`job_80b1d3cf-d8c4-4078-8022-26e26e69f7bd`，3 次尝试／2 次自动重试后 blocked／ADAPTER_CHANGED，0 文件；没有手动恢复，也没有媒体验证通过。重试行为已发生，不等于下载修复成功。
- X AI 单帖 `job_15df4b79-b0ea-4148-8532-0d9fe1d74acb`：3 次尝试／2 次自动重试后 blocked／CONTENT_SCRIPT_TIMEOUT，0 文件；唯一 observe 同样超时，因此没有取得该任务的实际页面或静音证据。未手动恢复或重复提交。
- YouTube 与 Medium 两站 observe 均确认规则 2026.09.20.4 和自有任务标签静音。证据见 `.audit/e2e/browser-0.1.15/artifact-validation.json`；验证器整体 exit 1 如实反映 YouTube 零产物。

## 0.1.15 回归前置状态

运行时实际 initialize 已确认 0.1.15；正式／开发扩展已构建，规则 2026.09.20.4，267 项测试及类型／LSP 检查通过。实际 Chrome 心跳已确认 0.1.15、connected／unpaused，开始回验 YouTube 有限就绪重试和 Medium 图片处理；不使用旧扩展为新规则提供成功证据。

## 0.1.14 保留来源学习样本（部分通过，2026-09-20）

B 站官方 3Blue1Brown 神经网络教程 `BV1bx411M7Zx`，任务 `job_59174006-8a85-4bbc-ac83-bb6138778272` 一次尝试 succeeded，所请求 video 已交付。720p MP4 为 94,836,447 字节、1153.239833 秒；3 个产物大小和 SHA-256 一致，视频和音频全程解码及首／中／尾定位解码均通过。observe 确認自有任务页静音。页面 snapshot 完整性仍 unknown，并保留浏览器完整性警告；该结果只证明指定视频文件交付，不代表整页或整个平台通过。独立验证见 `.audit/e2e/retained-learning-0.1.14/bilibili-artifact-validation.json`。

Medium `Neural Networks, in a Nutshell` 任务 `job_7852cd51-819f-4ea6-a462-38f017e8b4c8` 返回 partial／CONTENT_INCOMPLETE，共 4 个字节校验通过的文件；唯一图片实际为作者头像，5 个正文 figure 图片槽未交付，article 内还包含 newsletter。已据真实结构补充未构建的图片选择／头像排除修复，27 项定向测试、类型检查及 scoped LSP 通过；订阅表单精确祖先仍未取证，不宣称已修复。旧页自动清理后，新的产品静音 observe 页进入安全验证，未绕过。

YouTube 指定 `aircAruvnKk` 720p 视频任务 `job_1b7433c8-0c17-4061-b2e4-2d79743021c5` 终态 blocked／ADAPTER_CHANGED，0 文件。新 observe 的实际 URL 和视频标题正确，AX 可见静音播放器与 18:39 时长，没有观察到登录／年龄提示；精确 DOM 查询超时，因此不能判定 selector 是否过时或宣称根已修复。没有手动 resume 或重新采集。

补充只读证据：YouTube 同一自有静音 tab `144022710` 的延后 observe 已报告 public_free／visible-supported-content-root，并得到正确标题；证明初始观察与稍后页面就绪状态不同。原 job 状态仍 blocked，未执行 resume：原请求 tab_strategy=new 会新建页，无法直接用已就绪页证明视频交付。见 `youtube-delayed-same-tab-observe.json` 和 `youtube-root-followup.md`。

证据：`.audit/e2e/retained-learning-0.1.14/` 与 `.audit/medium-fix/`。以上失败不改写此前五类一手资料的成功，也不把播放器可见当成视频已下载。

## 0.1.14 五类资料实际验收（2026-09-20）

运行时与真实扩展均为 0.1.14，规则 `2026.09.20.3`。五个新 document 任务全部 succeeded／complete，合计 21 个产物通过独立大小、SHA-256、清单／元数据映射及本地引用检查；五份持久化 proof 均核对了规则、实际双采样窗口、摘要与运行时绑定。所有 observe 均有自有任务页静音证据，没有手动 resume。

| 具体内容与用途 | 交付与验证 | 尝试次数／自动重试 |
|---|---|---|
| GitHub openai-python README | 正文、原 SVG 徽章及旁车共 4 文件；134×20 完整解码，50 个代码块与已核验前版一致 | 1／0 |
| HF paper 1706.03762 详情 | 真实 Abstract 与元数据，共 3 文件；未混入生成摘要卡，不将详情摘要称为论文全文 | 1／0 |
| Anthropic context engineering | 正文与原 SVG／PNG／WebP 共 6 文件；3 图完整解码，未混入订阅表单 | 3／2 |
| arXiv 1706.03762v7 | 摘要及同版本全文 PDF 共 4 文件；PDF 2,215,244 字节、15 页逐页解析；外部附件独立证明，文档末尾本地链接有效 | 2／1 |
| DeepMind publication 265605 | document 自动包含全文 PDF，共 4 文件；PDF 2,947,875 字节、30 页逐页解析 | 3／2 |

详细任务和 proof 见 `.audit/e2e/browser-0.1.14/artifact-validation.json` 及同目录 Markdown。仅这些路由、样本和用途获得本次实证；OpenAI 官网仍未实现，其他路由不继承通过，整个产品尚未完成验收。

## 0.1.14 回归前置状态（2026-09-20）

源码与统一检查、正式／开发构建已通过；本地运行时已确认 0.1.14。新构建包含 README、HF paper、Anthropic engineering、DeepMind publication、arXiv abs 的完整性规则，规则版本 `2026.09.20.3`。当前桥接仍为扩展 0.1.12，等待用户加载 0.1.14 后才创建新回归任务；不以旧页面观察宣称本版 complete 已验证。


## 0.1.13 GitHub 徽章回归（2026-09-20）

实际运行时 0.1.13、扩展 0.1.12、规则 `2026.09.20.2`。新任务 `job_aab944ba-7126-4d3d-90d5-7933c36ccef0` 一次尝试保存 41,539 字节 README、1,331 字节 134×20 原 SVG 徽章、清单和元数据，共 4 文件；observe 返回 `background:owned_task_tab_muted`。不再出现 ASSETS_PARTIAL；终态仍为 partial／CONTENT_INCOMPLETE，来源完整性 unknown，尚无 completion plan。新证据位于 `.audit/e2e/browser-0.1.13/`，独立核验已确认 4/4 文件大小、哈希、清单与相对链接一致，SVG 完整解码，50 个代码块与前版逐块相同；旧任务缺图事实保留。

## 0.1.12 三站修复回归（2026-09-20）

实际运行时和扩展均为 0.1.12，三次新任务均通过自有静音标签页执行。GitHub README 正文与元数据共 3 文件已保存，但 SVG 徽章被属性校验拒绝；arXiv v7 已保存 2,215,244 字节、15 页全文 PDF，共 4 文件；Anthropic 正文与 3 张原图（SVG／PNG／WebP）共 6 文件已保存。合计 13 个已交付文件通过独立大小、哈希、清单、相对链接和适用的解码检查。

三任务仍为 partial／unknown：GitHub 当次确实缺图；arXiv 和 Anthropic 尚无来源完整性证明，不因交付字节完整而升级为 complete。证据位于 `.audit/e2e/browser-0.1.12/artifact-validation.json`。徽章后续由运行时 0.1.13 修复，扩展仍为 0.1.12，另开新任务验证，不改写旧结果。


## 0.1.11 AI／学习来源真实采集（2026-09-20）

用户重载后实际扩展与运行时均为 0.1.11。GitHub README 因实际页面改用新标题组件而无法匹配旧 Public 标记，任务失败、0 文件；Hugging Face paper 保存真实 Abstract 和元数据，3 文件；arXiv 保存摘要和元数据，3 文件，但移动 PDF 入口在桌面隐藏，未交付全文。Anthropic 工程文章保存正文和 2 张 WebP，共 5 文件，静态 SVG 头图被现有位图校验器拒收。DeepMind publication 文档用途保存摘要和元数据 3 文件；独立 files 用途交付 2,947,875 字节 PDF 和 2 个辅助文件，PDF 30 页逐页解析通过。

合计 17 个已交付文件通过大小／SHA-256／清单核验，两张 WebP 全像素解码通过；已知 HF 生成摘要和 Anthropic 订阅表单污染均未混入。5 站 6 个任务中，GitHub failed，其余 partial；0 个任务达到完整完成。静音与实际 DOM 诊断由产品自有标签页取得，未刷新或绕过门控；DeepMind 首次脚本超时后由产品自动重试一次，没有手动重试。

完整任务、只读 DOM 证据和文件核验在 `.audit/e2e/browser-0.1.11/`。GitHub 当前标题组件和 arXiv 桌面 PDF 入口已取得证据；静态 SVG 支持正在修复，尚未用新构建回验。本文不提升整个平台为 browser_verified。


## 2026-09-20 范围变更

用户明确取消全平台覆盖并剔除搜狐、快手等来源，当前范围见 [来源状态](platform-status.md)。本日恢复本机服务后，已确认运行时与实际扩展均为 0.1.10、connected／unpaused。范围变化前只提交了搜狐 `job_dced9391-69ed-4d8f-af30-4fc375b39288`；收尾查询为 blocked／CONTENT_SCRIPT_TIMEOUT，3 次尝试／2 次自动重试、0 文件，无在途工作或计划重试，未再恢复或检查产物。快手和 X 新任务未提交，旧三站计划撤销。

后文保留版本与采集事实，已退出来源的记录不再作为当前支持或继续联调依据。新保留来源的回归和一手资料适配将单独记录。证据：`.audit/e2e/browser-0.1.10/sohu-scope-change-cancellation.json`。

## 0.1.9 真实五站回归与有界诊断（2026-09-19）

用户重载后，fresh heartbeat 确认实际扩展和运行时均为 0.1.9，规则 `2026.09.19.5`，实例 `4cecca34-0f1a-4a63-9f3a-3708d0268e2d` 连接正常。五站分别一个新任务，均为自有后台静音页；没有手动 resume、登录、播放或绕过门控。以下任务全部终态，已取得文件的任务由 Root 独立核对哈希、清单、相对引用及适用媒体完整解码。

| 平台 | 实际结果 | 文件与内容核对 |
|---|---|---|
| 搜狐 | `job_d5f616fc-df40-41d6-ad7c-8b5edf6fb321`：succeeded，17 文件、14 图 | 字节／清单／图片解码通过，14 图按序 SHA 与 0.1.7 完全相同；但仍混入 14 段“放大看”，阅读清理未通过，不能仅凭任务 complete 宣称该修复生效 |
| 快手 | `job_3b482bfb-0383-4a23-9a9f-4501c2f40215`：failed / MEDIA_UNAVAILABLE，2 份旁车 | 正文根、标题、作者可提取，播放器来源在采集当次没有可用 HTTP(S)，0 source assets、没有视频；两份旁车完整性通过不等于交付视频 |
| Facebook | `job_f7a20a84-906e-48c8-898a-29407466a349`：failed / LOGIN_REQUIRED | 目标为 pfbid permalink，实际返回登录门控，0 文件，没有继续访问或绕过 |
| 抖音 | `job_f2df4952-5dc3-40d9-8fbc-03f7a81db26d`：blocked / CONTENT_SCRIPT_TIMEOUT | 3 次尝试、2 次自动重试后仍没有内容脚本响应，0 snapshot／0 文件；未将超时归因于媒体来源或选择器，也没有再开页诊断 |
| X | `job_fcea1847-d2a5-4311-8c0b-c62915eb127f`：partial / CONTENT_INCOMPLETE，3 文件 | 文件完整性通过；作者已正确，200 字符正文与本次页面可见原文一致。仍有图片说明 UI 和分隔符，0 图片，不能判定完整 |

随后仅对搜狐、快手、X 各做一次现有任务的 observe，并在自有静音页只读核对：

- 搜狐当前精确选择器命中 14 个控件，全部 wrapper 为 `display:none`。源码排除逻辑先按可见性过滤，导致隐藏控件漏排，再由正文遍历读入文字；已用受控 fixture 复现并修补，现已进入 0.1.10 构建，尚未取得新版浏览器结果。
- 快手同一精确目标播放器稍后提供 HTTPS `k0u2ay61y24y19z.djvod.ndcimgs.com` 来源，720×1280、muted=true，没有读取框架私有状态或调用播放。该来源不在既有许可列表；此前 0 资产错误发生在来源解析之前，不能反推为域名拒绝。来源等待和这一个已证实域名的修复已进入 0.1.10 构建，尚待真实回归。
- X 当前可见正文确为 200 字符，与交付文本一致；先前 263 字符观察不能证明本次被截断。AX 显示 ALT，但没有 literal “read image description”；DOM evaluate 在 Page.getFrameTree 超时后停止，没有将 ALT 当成同一节点，也未宣称图片 DOM 属性已验证。

证据在 `.audit/e2e/browser-0.1.9/`：`regression-result.json`、三个 artifact-validation 报告、`sohu-content-comparison.json`、`x-content-comparison.json` 和 `diagnostics/`。本批没有增加整个平台的 browser_verified 标签，23 个基线平台有任务尝试的计数不变。


## X 同实例有界续跑补充（运行时 0.1.8／扩展 0.1.7）

任务 `job_651a2522-234b-48d9-a3de-549d4b37c863` 的第一尝试三份文件和校验记录已独立保留。一次带用途参数的恢复调用因任务没有 selection_required 返回 `INVALID_SAVE_SELECTION`，未改变任务；随后仅传 job_id 的一次合法恢复进入队列。最终为 `blocked / ADAPTER_CHANGED`，累计 attempts=3、automatic_retries=1，仍为原有 3 个产物、0 个 source asset，没有新增图片。没有再创建任务或进行页面点击、播放、登录；本次失败不覆盖此前 partial 文件记录，也不证明之后的页面补证就是采集时状态。

证据：`.audit/e2e/diagnostic-social-runtime-0.1.8/x-resume-summary.md`、`x-resume-job-get-final.json` 与 `x-first-attempt-artifacts/`。


日期：2026-09-18 至 2026-09-19
执行者：Luna Max（所有浏览器 UI 与产品 MCP 采集操作）；Root／Sol 做运行时集成和本地文件校验。

## 2026-09-19：运行时 0.1.8／扩展 0.1.7 的追加诊断

主运行时 initialize 已确认为 0.1.8，扩展持续心跳仍报告 0.1.7、规则 `2026.09.19.3`。因此本段不能用于证明 0.1.8 扩展修复；搜狐、快手和 Facebook 的新版回归尚未提交。以下操作均绑定自有静音任务页，没有登录、手动播放或改变用户页面声音。

- 抖音旧任务的一次 observe 确认唯一可见 video 没有 `src` 属性，但标准 `currentSrc` 是允许主机 `v26-web.douyinvod.com` 的 HTTPS 来源。已取得播放器、含目标 ID 的说明区域及独立评论边界；媒体本身尚未重新采集。完整路径和签名查询未写入诊断文档。
- 微博旧任务的一次 observe 确认 `m.weibo.cn/detail/5062595839264600` 公开正文可读，作者、正文图片与外部评论区域可区分。只读样本尚未证明目标 DOM 身份属性／自链接，也未证明高于所见 `orj360` 图片的来源，不能由可见页面推断完整图片已取得。
- X 的旧任务绑定已离线实例，observe 返回 `BROWSER_DISCONNECTED`；这不代表当前实例或目标站点不可用。保留旧归属后，在当前活跃实例新建同一 NASA 帖子的任务 `job_651a2522-234b-48d9-a3de-549d4b37c863`，一次执行获得正文及两份旁车文件，3 个产物的哈希、清单和本地引用通过。任务仍为 `partial / CONTENT_INCOMPLETE`、0 个源媒体资源。实际阅读发现作者字段混入日期、浏览量及 quotes 链接，正文有界面文字；稍后的同页 DOM 可见一张目标图片，故该结果不能宣告完整图文交付。

具体证据位于本地 `.audit/e2e/diagnostic-douyin-runtime-0.1.8/` 和 `.audit/e2e/diagnostic-social-runtime-0.1.8/`。三个平台此前均已有任务尝试，总数仍为 23。新源码修复与这些历史采集结果分别记录。

## 2026-09-19：0.1.7 四站回归

用户确认重载后，实际扩展报告 0.1.7，连接正常且未暂停；运行时亦为 0.1.7，规则版本 `2026.09.19.3`。四项各提交一次新任务，绑定同一活跃实例，未手动续跑。任务页由扩展静音，观察返回 `background:owned_task_tab_muted`；没有登录、点击播放或改变用户页面的声音设置。

| 平台与任务 | 实际结果 | 独立核验与仍存缺口 |
|---|---|---|
| 搜狐 `job_56c046c2-90fc-4c84-996b-e605d0944da4` | succeeded；46 个 block、14 张图片、17 个产物 | 作者、发表时间已取得；`sohu.article.content-main-detail.v1` proof 接受，2 次采样相隔 5917 ms，14 个按序资源、0 个未放置资源／待加载标记。17 文件哈希、清单、相对链接及全部图片完整静默解码通过。人工复核仍发现每图后混入“放大看”控件文字，共 14 处；文件完整不代表阅读清理已完成 |
| 头条 `job_7837d3fd-a25c-48e7-a94a-937b47f77638` | succeeded；24 个 block、2 张图片、5 个产物 | 作者“云读暖阳小筑”和页面发表时间已恢复；`toutiao.article.syl-page-article.v1` proof 接受，2 次采样相隔 4591 ms，2 个按序资源、0 个未放置资源／待加载标记。5 文件哈希、清单、相对链接及 2 图完整静默解码通过 |
| Facebook `job_b9b25007-6c1a-4ac5-9e59-b9ad4c546619` | failed / LOGIN_REQUIRED；0 个产物 | 顶部 banner 的登录 form 被全局 gate 命中；同页只读观察可见 NASA 公开目标帖、正文和图片。目标范围内还嵌套评论，日期 permalink 使用 pfbid 而请求地址使用数字 ID；需明确身份绑定及正文／评论边界后修正规则，不能直接放宽登录判断 |
| Instagram `job_a927510e-19ee-4039-977f-2e60072a59b7` | blocked / ADAPTER_CHANGED；0 个产物 | 观察为 content-root-not-confirmed；只读页面可见 nasaearth Reel、说明文字、静音播放器及登录提示，后方还有评论／推荐。需按目标内容确定正文和媒体范围；页面可见不等于已保存视频 |

头条这一公开文章样本的文档用途通过；搜狐图片缺失已修复，仍有控件文字清理问题。Facebook 和 Instagram 首次加入实际任务记录，本批结束时合计 **21 个基线平台有尝试**，不等于 21 个平台通过。

请求、终态、观察、DOM 补证及 Root 的独立产物核验位于本地 `.audit/e2e/browser-0.1.7/`。后续观察不改写失败任务，后续源码修复也不追溯为本批已通过。

### 同版追加：快手与 Threads

- 快手 `job_8816cc24-9367-42b1-9142-49efc6e65940`：blocked / ADAPTER_CHANGED，2 次执行（包含 1 次 CONTENT_SCRIPT_TIMEOUT 后的自动重试），0 产物，无手动续跑。一次 observe 返回静音标记；只读 DOM 可见标题、作者和唯一静音 video，未见登录或付费门控。实际 `.short-video-detail-container` 与当前适配器正文根不匹配，评论区也需完整排除。页面自行播放时视频仍静音，本轮没有播放／暂停／seek 操作。
- Threads `job_77773a5c-873b-443a-b54f-6ff7b160d393`：failed / TARGET_URL_MISMATCH，1 次执行，0 产物；observe 同样在返回页面引用前被目标路由检查拒绝，没有可用于判断登录状态或正文结构的 CUA 证据。此前一次提交因测试请求漏写输出目录的一层路径而报 OUTPUT_NOT_AUTHORIZED；已保留该原始失败，只修正请求为既有授权目录后提交上述任务，未放宽目录授权。

至此 **23 个基线平台有真实任务尝试**；视频号和 TikTok 仍无实际任务，既有访问限制与入口缺口保留。两个新增平台均未交付，不能将“已尝试”当作可用。详细证据位于同一私有审计目录的 `kuaishou-*` 与 `threads-*` 文件。

## 2026-09-19：0.1.6 新会话注册与回归

用户确认扩展重载后，旧会话仍显示注册时的 0.1.5。代码核查确认版本只在 `register` 写入，普通心跳不会刷新它，因此不能仅凭该字段要求用户再次重载。确认 29 项任务均已结束、无待重试后，只重启本项目 4318 运行时，使扩展重新注册。`build-0.1.6/check-after-session-refresh.json` 已报告 0.1.6、连接正常、未暂停；开始 Substack、搜狐、企鹅号、头条及 Pinterest 的有界真实回归。

历史记录中的扩展版本是对应会话的注册报告；它可与当次任务和规则证据对照，但不单独证明之后的扩展重载是否发生。0.1.4／0.1.5 扩展代码已逐字节确认相同，既有文件验证结果保持有效。版本自动刷新已补源码与定向测试，尚未进入本轮 0.1.6 构建。

### 0.1.6 五站回归结果

本轮运行时和新会话注册的扩展均为 0.1.6，适配器规则为 `2026.09.19.2`。每个样本各提交一次新任务，明确绑定同一活跃实例。全部 observe 返回 `background:owned_task_tab_muted`；未登录、点击播放或改变用户其他页面。

| 平台与任务 | 实际结果 | 独立核验与仍存缺口 |
|---|---|---|
| Substack `job_39e29bfc-6ded-423e-9e9a-75436fe127c7` | succeeded；126 个正文 block、6 张图片、9 个产物 | 作者、发表时间及副标题已恢复，订阅介绍及点赞／转发界面文字不再混入正文。`substack.public-post.body-root.v1` proof 获接受，两次采样间隔 4850 ms，6 个按序资源、0 个未放置资源／待加载标记。9 文件哈希、清单、相对链接及 6 图完整静默解码通过 |
| 搜狐 `job_728a77cc-8079-4f89-8abd-bfcf16be894c` | partial / ASSETS_PARTIAL；46 个 block、14 个源图片项、6 个产物 | 已保存正文、3 张图片及两份旁车文件，文件校验和图片完整解码通过；11 张图片报 ASSET_HOST_NOT_ALLOWED，无完整性 proof。已保存文字不代表全文及图片完整。渲染中的占位图 host 不能代替每项 data-src 的实际 host，未据此扩张白名单 |
| 企鹅号 `job_b2777798-6eea-4f65-9ecc-81631ebea362` | succeeded；34 个正文 block、0 张正文图片、3 个产物 | 标题、作者、页面显示的日期已取得；正文没有媒体，二维码和头像在正文外。`penguin.page.normal-article.v1` proof 获接受，两次采样间隔 5817 ms，正文后投票容器作为终点。3 文件哈希、清单与本地引用核验通过 |
| 头条 `job_69aaa441-b75e-4efa-8ea7-a83f0fca67a8` | partial / CONTENT_INCOMPLETE；24 个 block、2 张图片、5 个产物 | 标题已恢复；作者和发表时间仍空，无完整性 proof。5 文件哈希、清单、相对链接及 2 图完整静默解码通过。唯一正文 ARTICLE 与外部评论／推荐边界已有只读 DOM 证据，仍需补规则和重新采集 |
| Pinterest `job_29cd505c-8460-4903-ab8b-0e3e44082580` | blocked / ADAPTER_CHANGED；0 个产物 | 后续只读 DOM 显示空 main 和登录／注册弹窗，没有 Pin 正文或源图片。同页稍后 observe 已识别登录门控；不能把它追溯改写为任务当时已返回 LOGIN_REQUIRED |

Substack 与企鹅号两个具体公开文章样本的文档用途通过。搜狐和头条仅 `artifact_integrity_pass=true`，`overall_pass=false`，保留 partial；本轮不提高整个平台覆盖等级。实际尝试仍为 19 个基线平台，本次回归没有新增平台。

请求、任务、观察、DOM 证据及 Root 的产物核验位于本地 `.audit/e2e/browser-0.1.6/`。最终 `check-final.json` 确认 0.1.6 连接正常、未暂停，回归任务均已结束。后续补证和源码变更不改写以上任务结果。

补证定位：搜狐真实延迟图片的 `data-src` 来自 q0／q1／q2／q3／q4／q5／q6／q7／q9.itc.cn，渲染中的 m1.auto.itc.cn 仅为 `sohu-default.png` 占位；新源码仅补已观察的精确 CDN host 并移除占位 host。头条取得唯一 `.article-content` 元数据容器及两次间隔 882 ms 的正文结构样本，作为后续规则输入，不能替代新任务的双快照 proof。

Pinterest 同一自有页的后续 `pinterest-observe-supplement-3.json` 返回 `login_public_free`、`login:selector:[data-test-id='fullPageSignupModal']`。稍后 DOM 还显示可见的 `login-modal-redesign` 登录容器。0.1.6 已包含这两个精确选择器，因此没有重复添加 gate，也没有把早先 unknown 的根因臆定为 class 属性错误。各次观察时点不同，首次 blocked 任务保留。

## 2026-09-19：0.1.5 运行时接续联调

实际执行器复现并修复了无有效时间的 VTT、截断 SRT、仅文件头的 PDF、损坏 DOCX 和截断图片被误报完整的问题。0.1.5 全量 166 项测试、76 文件 LSP、构建及独立安装／升级回滚通过。重启后的 MCP initialize 明确报告运行时 0.1.5，最新只读 `check` 确认 Chrome 已加载 0.1.4、连接正常且未暂停。

0.1.4 与 0.1.5 正式扩展的全部代码／UI 字节一致，manifest 仅版本号变化；从 0.1.4 独立源码重建的三个开发扩展脚本也与当前产物一致。新附件解析位于本机运行时，因此继续使用已加载的 0.1.4 扩展联调，证据明确标为“运行时 0.1.5／扩展 0.1.4”，不冒称扩展 0.1.5 已加载。

### 知乎公开专栏：首次完整图文闭环

公开专栏 `https://zhuanlan.zhihu.com/p/595291507` 的新任务 `job_ca0226ca-360c-4ab7-a297-b08122a555de` 返回 `succeeded`，请求范围完整。保存 27 个产物：正文、24 张 JPEG、来源元数据和文件清单；150 个正文 block 中的图片 occurrence 与 Markdown 顺序一致，正文只有一个一级标题，未混入此前的目录或“收起”界面文字。作者和发表时间已取得，未把编辑时间用作发表时间。

运行时接受的按次 proof 为 `zhihu.column.richtext.time-terminal.v1`，`terminal_observed`，两个稳定快照间隔 3247 ms，24 个按序主资源、0 个未放置资源、0 个待加载标记。独立核验 27 个产物大小／SHA-256、清单、相对链接及 24 张图片的完整静默像素解码，全部通过。详细审计为本地 `browser-0.1.5/root-zhihu-*.json` 与该 job 的 artifact-validation 记录。

这证明此公开专栏样本在当前版本组合中的文章用途可用，不提升知乎回答等其他路由，也不扩大为整个平台通过。旧 0.1.3 partial 任务及其缺口保留。

### Substack：正文配图已恢复，完整性仍待确认

相同版本组合下，新任务 `job_57a9ee2d-81e2-42ce-93ec-7bcc08b26168` 已保存正文、六张正文图片和两份旁车文件，共 9 个产物。此前代理 `srcset` 被错误拆分及 Unsplash 图片来源不在许可范围的问题不再出现；这次没有图片 404 或域名拒绝缺项。九个文件的哈希、清单、相对链接及六张图片的完整静默像素解码全部通过。

任务仍明确返回 `partial / CONTENT_INCOMPLETE`，文章整体边界尚无可接受的按次 proof。复查 136 个 block 还确认订阅介绍及点赞／转发计数混入首尾，作者字段为空；下一版需要按实际 `.body.markup` 正文容器收窄范围并补齐同文章元数据。文件校验通过不改变这个状态，不宣称该平台文章已完整通过。

两份公开正常 PDF 已经通过 0.1.5 源码逐页解析：[W3C 一页样本](https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf)和 [Mozilla 14 页样本](https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf)。这是本地解析兼容性检查，没有调用浏览器采集，也不计为网站覆盖。

### 搜狐／头条／网易／企鹅号：新增四站实际尝试

四个公开单内容任务均使用运行时 0.1.5／扩展 0.1.4；产品 observe 均返回自有任务标签静音标记，未执行播放、登录或滚动。任务结果与后续只读页面证据分别保留：

| 平台 | 实际任务结果 | 产物及页面证据 |
|---|---|---|
| 搜狐 | `job_28f3aecf-6103-4756-8974-c675b7d92b16`，blocked / CONTENT_SCRIPT_UNAVAILABLE，3 次尝试含 2 次自动重试，0 文件 | 后续 observe 能响应，页面可读；唯一 `.content-main-detail` 有 14 张正文图，后面是标签、声明、评论及推荐区。两次只读结构记录稳定，不表示此前桥接失败已修复 |
| 头条 | `job_f03d1f26-d17a-4407-8d50-91a5113f4ba6`，partial / CONTENT_INCOMPLETE，5 文件 | 正文、2 张 JPEG、清单及元数据的大小／哈希／本地链接／完整像素解码均通过。标题、日期和作者文字在正文中，但快照未识别为相应元数据。页面第二张图仍显示 data 来源和 loading 类；已保存的 480×610 JPEG 可解码，两类证据不能相互替代，来源完整性仍待确认 |
| 网易 | `job_31a2ec59-5ec6-469b-9e1d-d758164af729`，partial / CONTENT_INCOMPLETE，8 文件 | 正文、5 张 JPEG 和两份旁车文件的独立产物校验全部通过；作者／日期未取得。产品 observe 成功，CUA DOM 读取被站点安全策略拒绝，未绕过，不据此补写正文边界证据 |
| 企鹅号 | `job_08d23ca6-5873-4f39-a220-270d93d84bdc`，blocked / CONTENT_SCRIPT_UNAVAILABLE，3 次尝试含 2 次自动重试，0 文件 | 页面可读，但 observe 的正文根仍未确认。唯一 `section.article.normal-article` 在 header 后、投票与评论前，正文无图片；页面二维码和头像位于正文外，不作为正文配图 |

头条与网易的独立报告均为 `artifact_integrity_pass=true`、`overall_pass=false`，保留真实 partial。原始请求、任务、观察、DOM 记录及只读文件核验位于本机 `.audit/e2e/browser-0.1.5/`，不随源码分发。至此有 15 个基线平台的实际尝试；这不是 15 个平台通过。

### 西瓜／百家号／LinkedIn／Pinterest：访问与页面准备缺口

以下继续使用运行时 0.1.5／扩展 0.1.4，各提交一次任务，不追加手动重试；四项均没有交付文件：

| 平台 | 任务与实际结果 | 后续观察与边界 |
|---|---|---|
| 西瓜 | `job_83296599-ae49-476b-8186-2f96a409be61`，failed / TARGET_ORIGIN_MISMATCH，1 次执行 | 原 www 单视频 URL 重定向到同 ID 的 m.ixigua.com 页面；observe 同样拒绝 origin 漂移。只读可见“打开App看完整内容”门控，未取得音视频元素；不打开 App、不放宽 origin 检查 |
| 百家号 | `job_d3b17671-fca6-46bf-8cff-f53bd38b6f5c`，blocked / CONTENT_SCRIPT_UNAVAILABLE，3 次执行含 2 次自动重试 | observe 随后返回原路由、文章标题与自有页静音标记，但正文根未确认。CUA 读取被站点安全策略拒绝，未绕过，没有 DOM 边界证据 |
| LinkedIn | `job_04ee21eb-601e-4d08-8437-25439f295d37`，failed / LOGIN_REQUIRED，1 次执行 | 未登录；随后独立 observe 能识别一个可见根并确认自有页静音，但 CUA 在读取前超时，未取得 DOM。这是不同时间的观察，不能用它改写采集时的登录门控或确认正文完整 |
| Pinterest | `job_7f713d24-98cd-4701-b026-2345cbba4fbe`，blocked / CONTENT_SCRIPT_UNAVAILABLE，3 次执行含 2 次自动重试 | observe 确认自有页静音但正文根未确认；CUA 只读看到 fullPageSignupModal／login-modal-redesign 登录注册弹窗。仅见扩展界面的两张 chrome-extension 图片，没有确认 Pin 正文或配图；未点击登录／注册 |

证据位于本机 `.audit/e2e/browser-0.1.5/` 的对应 job／observe／dom-evidence 文件。当前合计 19 个基线平台有真实任务尝试，仍有快手、视频号、TikTok、Instagram、Facebook 和 Threads 尚无真实采集记录；不把访问阻断、候选链接或平台注册记为支持通过。

## 0.1.4 候选构建的历史状态

0.1.4 已完成 131 项完整测试、类型检查、65 个 TS 文件的零 LSP 诊断及正式／开发扩展构建。独立安装、stdio MCP 和隔离 0.1.3 → 0.1.4 → 0.1.3 运行时升级回滚均通过，详见 [打包验证](package-validation.md)。4318 联调运行时已替换为 0.1.4；构建后的一次实际 `check` 仍报告 Chrome 加载 0.1.3，因此没有把新源码当成已加载扩展启动新版采集。后续统一更新再验证知乎和 Substack，旧结果保留。

另对先前保存的受控 PNG、两版知乎图片和 Medium PNG 共 50 个图片文件做了离线完整像素解码，先核对大小和 SHA-256，再经 `ffmpeg -xerror` 静默解码，全部通过。这补充了原有格式／尺寸／链接检查，不改变原任务的 partial 状态，也不是 0.1.4 新采集。原始记录为本地 `.audit/e2e/saved-image-pixel-decode-20260919.json`。

## 2026-09-19 恢复检查

中断后确认 4318／4319 均无监听，随后构建并恢复本项目运行时和自有夹具服务器。首次实际 MCP 检查为 `waiting_browser`、实例列表为空；媒体工具仍可用。CUA 当时为 `browsers: []`。用户重新加载后，实际 MCP 确认扩展 0.1.3，CUA 普通浏览器入口也恢复。

旧实例的心跳已经过期，因此原 YouTube／Bilibili 任务续跑分别返回 `BROWSER_DISCONNECTED`，没有产物。后续验证为当前活跃实例明确创建新请求，保留旧失败记录，不把总连接状态或另一实例在线当成旧任务可以执行。

## 2026-09-19：真实 YouTube／Bilibili 音频闭环

实际运行时和已加载扩展均为 0.1.3。以下请求通过真实扩展读取公开单视频页面，MCP 任务获取音频并保存本地文件，再由独立检查器读回核验：

| 项目 | YouTube | Bilibili |
|---|---|---|
| 源内容 ID | `dQw4w9WgXcQ` | `BV1GJ411x7h7` |
| 任务 | `job_4ace59b3-75a5-4cb6-b384-82053650c18b` | `job_169c39f2-ccb6-459e-b434-f504fccbc674` |
| 结果 | succeeded，3/3 产物核验通过 | succeeded，3/3 产物核验通过 |
| 执行次数 | 3 次，其中 2 次为同任务自动重试 | 1 次 |
| 文件 | M4A，AAC 双声道，无视频轨 | M4A，AAC 双声道，无视频轨 |
| 时长／字节数 | 213.089524 秒／3,446,985 B | 212.308833 秒／5,401,083 B |
| SHA-256 | `00d5ff466dceddf838070503a3fbd1fb48337335d4d02eb2fb2cd197288a5d91` | `2e9dbc29d6d8c87e1c98c9b320058ea1f0e5f7dfecb89d0b304581d79681f0d4` |
| 完整静默解码 | `ffmpeg -xerror` 通过 | `ffmpeg -xerror` 通过 |
| seek 检查 | 6 秒及约 170.472 秒处有时间戳数据包 | 6 秒及约 169.847 秒处有时间戳数据包 |

每份音频、清单和元数据的大小与 SHA-256 均一致。音频请求的完整性由有界媒体来源、来源时长与完整解码确认；页面正文仍有完整性／折叠警告，这不意味着正文和全平台已经验收。没有手动播放网页或输出音频；设备试听和所有浏览器组合未验证。

原始请求、任务响应及产物核验记录位于本机 `.audit/e2e/browser-0.1.3/`，媒体位于对应的私有审计输出目录，均不随源码包分发。此处是两条真实视频保存音频的完整链路证据，不提升图片、正文、字幕、视频保存或其他路由的状态。

## 2026-09-19：Bilibili 视频闭环与网络恢复

独立视频任务 `job_f3c0f218-26cd-4230-85ef-74ce91e0b8ec` 请求同一公开内容 `BV1GJ411x7h7`，用途为 video，大小上限为 128 MiB。首轮遇到 TLS 握手超时，只有清单与元数据，没有视频；同一任务仅手动续跑一次后成功，总计 2 次执行。旧失败记录保留。

最终 3 个产物经独立大小／SHA-256、manifest 和 metadata 核对通过。视频为 75,234,015 字节 MP4，H.264 1920×1080 + AAC 双声道，212.308833 秒；SHA-256 为 `37aac2a443fead756421f36c5bb7fc68e7efcf7b22262c765773814196ae6fd0`。`ffmpeg -xerror` 全文件静默解码通过，6 秒和约 169.847 秒处的 seek 能取得有效时间戳包，视频定位回退到前一个关键帧。

任务页 observe 返回实际自有标签静音标记。未手动播放网页或最终文件。此结果证明这一个 Bilibili 公开单视频的扩展到 MP4 交付，以及该任务的网络失败后恢复，不代表其他视频、字幕或全部平台已验收。

## 2026-09-19：知乎图文结构复核

任务 `job_9d179d4e-9bb7-4a5d-8818-57f9250eaacc` 返回 `partial`，保存 27 个产物。0.1.3 快照含 169 个 block，图片已与正文交错；目录仍混在正文中，完整性为 unknown。一次有界 observe 重试成功，扩展返回实际自有标签静音标记。

只读 DOM 取证确认 `.Post-RichTextContainer` 宽根包含目录，实际正文为其后代 `.RichText.ztext.Post-RichText`，有 127 个直接元素子节点、24 张正文图片。此证据用于后续收窄正文根；0.1.3 尚未包含该平台专属修正，也没有据此宣称完整正文成功。当时元数据与正文终点仍待进一步取证，后续证据见下方回归小节。

重建同一任务的自有静音页后，又确认作者头部、正文与时间节点同属 `article.Post-Main.Post-NormalMain`。可见时间写的是“编辑于”，因此不能将它当成发表时间；文章级 `datePublished` 元数据与作者范围用于后续修正。正文根后的时间节点及尾部引用区是结构观察，本轮未用它们单独确认正文完整性。

## 2026-09-19：微博／抖音回归与知乎 proof 输入证据

本批次仍是 0.1.3 已加载扩展的现场证据，用来定位后续源码修正，不是 0.1.4 构建或新扩展验收。

- 微博任务 `job_bdf92ed7-ef95-4a7e-bd83-45b40c8fb8f3` 的三次采集尝试均以 `CONTENT_SCRIPT_UNAVAILABLE` 结束，其中两次为自动重试；任务保持 `blocked`，0 个产物。任务结束后的独立 `browser_observe` 在 3.612 秒内成功返回同一单帖路由、自有任务标签静音证据和 `access:content-root-not-confirmed`。只读页面观察可见目标帖、作者／日期和评论列表，但后续 observe 能响应只说明内容脚本后来可用，不能补写此前采集结果，也没有确认正文根或评论排除边界。
- 抖音任务 `job_a934b63c-07ba-4d83-a72a-255acb074029` 执行两次（一次自动重试）后以 `MEDIA_UNAVAILABLE` 失败。快照有 35 个 block、0 个 source asset，任务只写出 `assets.json` 和 `metadata.json` 两个 sidecar，没有视频文件，因此不能称为媒体交付。独立 observe 仍为 `access:content-root-not-confirmed`。只读页面样本中两个 `video` 元素均为 `muted=true`；一个当时 `paused=false/readyState=4`，另一个 `paused=true/readyState=0`，本轮没有发出播放或其他媒体动作。
- 知乎专栏页在同一产品自有任务标签上做了两次只读 DOM 采样，间隔 700ms，未滚动、点击或展开。两次均只有一个正文候选，`.RichText.ztext.Post-RichText` 有 127 个直接元素子节点；24 张正文图片的 `src/currentSrc` 指纹、article 直接子节点顺序，以及正文外层 `.Post-RichTextContainer` 后紧邻 `.ContentItem-time[role=button]` 的关系一致。该证据用于实现按次采集的正文根、终点与稳定采样规则。同期 MCP `check` 只确认已加载扩展版本为 0.1.3、连接正常且未暂停；它没有执行新 proof 协议，也没有证明 0.1.4 包或新扩展通过真实知乎采集。

原始记录为 `.audit/e2e/browser-0.1.3/weibo-regression-*.json`、`douyin-regression-*.json`、`zhihu-proof-samples.json` 和 `check-20260919-zhihu-proof.json`。这些文件保留在本地审计目录，不进入发布包。

## 2026-09-19：Reddit／Medium／Substack 首次实际采集

此批次仍使用运行时和扩展 0.1.3，每个平台只有一个公开单内容请求。所有观察均返回自有任务标签静音标记，未执行登录、订阅或播放。

| 平台 | 任务与结果 | 页面与产物证据 |
|---|---|---|
| Reddit | `job_a0c5cd39-362e-49c7-98af-22fb90a94220`，blocked，3 次尝试（2 次自动重试），0 文件 | 页面明确显示网络安全拦截，要求登录或开发者令牌，未找到正文。产品报 CONTENT_SCRIPT_UNAVAILABLE，需保留实际访问阻断，不能视为普通空页面 |
| Medium | `job_09271a17-ca01-4572-a2bd-adc61ca3d634`，partial，2 次尝试（1 次自动重试），4 文件 | 公开文章、作者及日期可见；正文、1 张 PNG、清单与元数据的大小／哈希／链接独立核对通过。仍有图片源警告与未知完整性。稍后只读 DOM 的两张图片均为 HTTPS，未能定位早前缺失源警告，不猜测原因 |
| Substack | `job_bb405612-bac3-4e54-872c-789693a7eb92`，partial，1 次尝试，3 文件 | 正文 137 个 block，公开文章可见；正文、清单与元数据的大小／哈希／链接独立核对通过。7 个图片资源未交付，其中 6 个 HTTP 404、1 个来源域名不允许；图片源解析与边界需定位 |

Medium／Substack 的报告仅 `artifact_integrity_pass=true`，`overall_pass=false`：已写出的文件完整不等于来源和请求内容完整。本批次在 0.1.3 归档后继续取证，旧归档保持不变。

## 2026-09-18：用户安装扩展后的实际结果

以下为首次安装后的历史证据，已解除旧记录中的“扩展未加载”阻断。当时运行时为 0.1.3，实际已加载扩展仍报告 0.1.2；不能由磁盘构建版本推断浏览器已更新。

- 实际 MCP `check` 返回 `connected`、`paused=false`；运行时重启后扩展自动重新注册。当前用隔离的 `e2e` 客户端授权和输出目录，未改用户已有 Agent MCP 配置。
- 原图文任务 `job_2e41655f-e67d-4376-922a-ac672fe01f55` 初次遇到旧扩展把缺失图片尺寸传为 0 的问题。修复运行时兼容和无效响应诊断后，通过 `resume` 继续同一任务成功，未重新提交。4 个产物大小／SHA-256 与清单一致，正文按首段、图前文、图片、图后文、末段排序；唯一相对图片链接指向真实 320×180 PNG。首次产物的标题重复属于已记录的排版问题。
- 播客任务 `job_9d97f87c-2a32-4151-a269-89758a0b263a` 在 0.1.2 运行时／扩展组合上成功，3 个文件通过大小／SHA-256 与清单校验。音频为 2.4 秒 AAC 单声道 M4A，完整静默解码、1.2 秒和 1.92 秒 seek 检查通过；没有播放声音。
- 两个任务的实际 MCP `browser_observe` 均返回 `background:owned_task_tab_muted`。该标记由扩展在实际 Tabs API 核对当前自有页静音后添加。播客经过精确原 URL 导航、复用同一个任务标签后再次返回该标记。
- CUA 只读查看自有 HTTP 任务页，图文正文与图片顺序可见，播客音频控件／时间轴可见。CUA 本身不暴露 `mutedInfo`，静音证据来自产品扩展的实际 API 检查；未手动播放、未调整系统音量或站点级静音。
- 实际欢迎页已出现在浏览器清单，但选择 `chrome-extension://…/welcome/index.html` 被浏览器自动化 URL 策略拒绝。未绕过，欢迎页暂停／恢复／撤销按钮仍未测试。这不阻断普通网站任务的产品 MCP 联调。

受控样本地址为 `http://127.0.0.1:4319/fixture/content/article` 与 `/fixture/content/podcast`。这些结果证明真实扩展和本地交付链路，不能计为第三方平台覆盖。

## 2026-09-18：真实平台首次尝试（历史）

| 目标 | 产品 MCP 结果 | CUA 只读观察 | 当前结论 |
|---|---|---|---|
| YouTube `dQw4w9WgXcQ` 保存音频 | `blocked / CONTENT_SCRIPT_UNAVAILABLE`，1 次尝试，无 `retry_at`、0 个产物 | 目标 URL、标题、频道、描述、播放器和推荐可见；播放器按钮为“取消静音”，未点击播放 | 页面后来可见，首次注入／准备时序仍待定位和同任务续跑 |
| Bilibili `BV1GJ411x7h7` 保存音频 | `blocked / ADAPTER_EXECUTION_FAILED`，1 次尝试，无 `retry_at`、0 个产物 | 目标页标题、作者、日期、播放器容器和推荐可见，未点击播放 | DOM 提取异常待定位，不能报告浏览器采集通过 |

原始任务响应、文件验证与页面观察保留在本地 `.audit/e2e/browser-0.1.2/`，该目录名是历史批次名，不代表后续运行时版本；不随开源分发包发布。公开证据以本文和验收矩阵为准。

## 历史记录：用户安装前

以下保留前两轮加载入口的失败背景，不代表当前连接状态。

## 联调边界

本轮目标是使用真实 Chrome UI 加载 `babel-content-downloader/dist/extension-dev`，验证欢迎页连接/暂停/撤销、任务标签页默认静音，以及本地 fixture 的阅读和媒体控件。保留用户已有标签页、登录状态和既有扩展；不使用站点级 `Mute Site`、系统静音、隐藏 extension state、cookies 或任意 `chrome.*` API。

## 构建与加载前状态

- `dist/extension-dev` 已出现完整 MV3 文件：`manifest.json`、`background/service-worker.js`、`content/content-script.js`、`welcome/index.html`、`welcome/index.js`、`welcome/style.css`。
- Chrome `chrome://extensions/` 可见开发人员模式为开启状态，现有扩展保持不变；“Load unpacked”按钮已在 UI 中定位。
- 第二轮尝试时，已有 `Extensions` 管理页仍可见，但当前选中页被用户操作切回其他内容页。对最新状态执行了一次有界重定位；此前几次点击 `Extensions` 页的“Load unpacked”均被 CUA 报告用户已改变 Chrome 前台状态、需要重新读取状态。未出现文件选择器，也未观察到 Babel 欢迎页或真实扩展 ID。
- 通过 `createBrowserTab("1", "chrome://extensions")` 建立独立管理页也被浏览器安全策略拒绝：`Browser Use rejected this action due to browser security policy. Reason: The browser URL policy blocks this action. ... do not attempt ... workaround ... raw CDP or browser commands ...` 因此未采用任何替代或绕过方式。
- 截至记录结束，尚未完成“Load unpacked”，未写入真实扩展 ID，也未声称 Babel 已加载。本轮唯一创建的 `about:blank` 测试标签已用 CUA 关闭；用户已有页面与扩展未操作。
- 本地 fixture 入口待加载完成后验证：`http://127.0.0.1:4319/fixture/content/article`、`/fixture/content/podcast`。

## 本轮结果与阻断

由于 Chrome 焦点持续被用户操作改变，且 `chrome://extensions/` 无法由 CUA 新建独立标签，以下真实联调证据尚未产生；不能把构建产物或预期 ID 当成浏览器已加载证据。

## 后续只读确认

- 已按要求刷新 CUA 文档并读取最新浏览器状态。当前前台仍是用户的其他内容页；`Extensions` 管理页仍存在但未在前台。
- 本次只做状态读取，没有点击、导航、创建 `chrome://` 页面或修改任何标签、扩展、登录状态和音频设置；没有观察到新的 Babel 欢迎页或真实扩展 ID。
- 按边界条件停止 UI 操作，等待用户提供可用时间或将现有 `Extensions` 页面留在前台后再继续。

## 初次测试页的静音与清理

- 初次公共页面观察时，Bilibili 和小红书验证页曾通过 Chrome 的 `Mute Site` 设置站点级静音；这项设置可能影响同一站点的其他标签页，不能描述为只影响当前标签。YouTube 当时原本已处于站点静音，未把它改成其他状态。
- 根据当时的清理记录，关闭了本轮创建的 Bilibili、小红书测试页以及本轮唯一的 `about:blank` 临时页；随后把 Bilibili 和小红书的站点静音设置恢复到观察到的原始值，保留 YouTube 原有静音状态。YouTube 验证页的关闭状态没有单独记录；这里只确认其站点静音设置未被改动。没有改系统音量。该记录不等同于真实扩展任务标签的 `mutedInfo` 验收。

## 首次加载时的待补证据（历史）

1. 选择 `dist/extension-dev` 后欢迎页显示的真实 extension ID、连接状态及暂停/撤销状态。
2. Root 通过真实 MCP 发起任务后，任务标签页的可见 URL、`mutedInfo` 证据、导航/复用后静音保持，以及后台 decode 不播放声音。
3. article 的阅读控件、podcast 的播放控件和自有 2.4 秒媒体可用性。
4. Chrome 原有用户页面/扩展在联调前后未被修改。
