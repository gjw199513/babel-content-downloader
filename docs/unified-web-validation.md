# 普通网页统一采集（Q8）

2026-09-20，已构建并接入 0.1.22 联调运行时；扩展保持 0.1.21，既有 0.1.21 发行归档不修改。本记录不代表全部博客、平台或客户端已验收。

## 实现

普通博客 URL 的文档、图片和资料包任务使用同一 HTTP 获取路径和 Mozilla Readability 0.6.0 正文提取器。JSDOM 29.1.1 仅提供 HTML DOM，不执行页面脚本或加载子资源。应用代码负责将提取结果转为已有文档块、保存图片、生成来源记录和接入任务恢复，不维护博客站点专用 CSS 流程。

提取器漏掉代码、表格、公式或主内容配图时，回退页面的通用主语义区域；没有主区域时保留整页可读内容。允许附带目录、评论、推荐和页尾文字，不因这些额外内容判失败。图片下载仍逐项记录真实结果；正文截断、缺图不会声称完整。链接只作为引用保留，不递归抓站、不自动下载权重或任意附件。

URL、逐跳 DNS、公网地址、端口、正文体积与图片格式继续校验。HTTP 获取支持 gzip/deflate 和 BOM、HTTP/meta charset。明确门控、空页面、非 HTML 和 401/403 返回实际错误。HTTP 完成记录只供本机采集使用，浏览器响应不能伪造该记录。

明确的现有标签页任务、媒体用途或关系展开仍走专用路径；已剔除平台不通过通用入口重新启用。URL 普通文章任务不要求连接浏览器，`babel_content_check` 返回 `ready_http` / `browser_required: false`。0.1.23 已接入已许可 URL 的通用浏览器 DOM 回退，详见下节；显式标签页目标仍待统一。

## 本轮验证

- 全量：40 个测试文件、314 项测试通过。
- TypeScript typecheck 与独立目录生产编译通过；变更 TS 文件 LSP 零错误、零警告。
- 覆盖 HTML 解码/压缩/体积限制、私网和重定向拒绝、代码/表格/图片/公式、空壳和门控、通用回退、截断告警、脱敏 URL 完整性绑定、无浏览器收集及续跑。
- 独立编译产物通过实际本机 MCP HTTP 服务调用：无扩展连接，Anthropic 正文任务 `job_176210fe-2791-4316-bc9d-c35b96fcf558` 成功。验证服务已关闭，未修改用户客户端配置或现有运行服务。

相同 collection executor 的真实公开网络采集：

| 页面 | 结果 | 实际文件 |
|---|---|---|
| Hugging Face `/blog/llama2` | partial | 正文、代码、表格及 25 张图片已保存；一个附带 SVG 因现有校验器不支持注释内容而未保存，共 28 个文件 |
| Anthropic `/engineering/effective-context-engineering-for-ai-agents` | succeeded | 正文、3 张图片和 2 个来源/资源记录，共 6 个文件 |
| DeepMind `/blog/teaching-ai-to-see-the-world-more-like-we-do/` | succeeded | 正文、9 张图片和 2 个来源/资源记录，共 12 个文件 |

以上文件均重新计算大小与 SHA-256，与 artifact 记录一致；浏览器调用次数为 0。此处“完整”指指定当前页面的可读内容与所选图片，不包含递归文章、站点全集或浏览器执行后的隐藏内容。

证据位于 `.audit/unified-web-q8/`：`live-validation.json`、`mcp-validation.json`、`full-tests-final.log`、`typecheck-final.log`、`lsp.log`、`mcp-lsp.log`、`parser-final-lsp.log`。`initial-live-validation.json` 是主语义范围调整前的历史结果；最终结果以 `live-validation.json` 为准。真实输出位于 `live-output-semantic/`。

## 尚未闭合

0.1.23 通用浏览器回退的真实验收仍在进行；0.1.22 runtime TGZ 独立安装验证已通过，详情见下节。OpenAI `/index/gpt-4-research/` 的本轮普通 HTTP 抓取返回 `ACCESS_NOT_PUBLIC`（证据 `openai-http.json`），仍需另外处理，不继承以上样本通过。现有动态自媒体平台的访问或媒体缺口也不因通用网页实现而自动解决。

## 当前联调服务验证

切换前实际查询 77 个任务，无 running/queued 或待定 retry_at；仅停止本任务持有的旧运行时。更新后实际 MCP initialize 返回 0.1.22，原 0.1.21 扩展正常重连。通过当前 4318 服务提交的 Anthropic document 任务 `job_e11c4039-1a7c-498a-80e7-2f59ee5564bc` 一次完成，3 张配图与正文/来源记录共 6 个产物全部通过大小和 SHA-256 复核。`check` 返回 ready_http，browser_required 为 false。证据：`current-runtime-validation.json`、`current-check.json`、`current-job.json`，均位于本页上述 audit 目录。未修改用户 Agent 配置或安装持久后台服务。

## 0.1.22 独立安装包

`.audit/package-smoke-0.1.22/candidate/babel-content-downloader-0.1.22.tgz` 为已冻结的运行时候选，375,194 字节，77 项文件；SHA-256 `2de9410083edbe916e42dc444f9ae18199d81f5d4d67fb57b3bfaee269476101`。独立 `npm install --omit=dev` 后，新依赖与三个网页模块齐全，真实 Readability 提取保留正文、代码和表格；已安装 CLI 的 stdio MCP initialize 为0.1.22，8个工具齐全，临时验证服务已停止且端口释放。包内正式扩展仍为0.1.21，无开发夹具权限。

包内文档是打包时快照；此安装结果在冻结后追加到工作区文档，不重写原候选包。报告和逐项证据在 `.audit/package-smoke-0.1.22/validation-report.json` 与 `install-validation.json`。本轮未另建源码或扩展 ZIP，也未发布到公共仓库。

## 0.1.23 通用浏览器 DOM 回退

普通网页 HTTP 无法返回正文且目标已在扩展许可路由内时，运行时显式下发 `web_document`，扩展复用同一个通用DOM转换器，不添加博客专用正文选择器。私网、非法目标、取消、体积上限不触发回退，429/503继续原有Retry-After重试。

浏览器结果使用独立的当前页DOM回执，限定原URL、article和image/cover；无需站点终点或双快照。未完成/截断结果保留partial。明确门控、paid/private继续阻断；login_public_free保留原访问语义。加载初期无正文可在已有20秒预算内只读重试，不点击/展开/播放。

本轮42文件/327项测试通过；typecheck、12个运行时/共享文件LSP与9个扩展文件LSP通过。正式/开发manifest与实际bundle均核对0.1.23及新策略；`check-after-user-reload.json` 已证实真实扩展0.1.23 connected/unpaused。证据位于 `.audit/browser-web-q8/`。新增OpenAI路由只提供导航身份及精确站点权限，真实产品任务结果见下一节。显式标签页目标尚沿用原适配器路径，不将本轮URL回退宣称为所有入口已统一。


## 0.1.23 重载后的实际任务与安装包

实际连接扩展已确认0.1.23。OpenAI本地化GPT-4文章的两个独立任务（`job_12819cf2-670f-4778-8152-8413ebd9a2fa`、`job_16f74556-505d-49a4-baa6-8f191803fdad`）均一次成功，各保存99个内容块、3张WebP和正文/资源清单/元数据共6个文件，大小与SHA-256已独立复核。两份持久回执都是`http_page_capture / response_received`，不是浏览器回退成功证据。同URL另一次直接HTTP诊断返回403，保留响应波动事实，不将后续成功改写为从未受限。

Medium任务`job_2c3e8d04-2201-4bb5-b9d1-3d0ae51d4772`一次失败，HTTP为`ACCESS_NOT_PUBLIC`，随后通用浏览器分支返回`TARGET_DRIFTED`，没有保存快照或文件。错误文本可对应扩展的URL一致性检查；没有成功DOM回执，不能宣称浏览器采集已验收。事后只读检查发现任务标签仍在，URL与请求一致；这只能证明检查时已回到同一地址，不能排除采集瞬间的临时跳转或解释失败。未再提交任务、未激活/导航或读取页面正文。诊断见`.audit/e2e/browser-0.1.23/medium-target-drift-diagnostic.md`，不据此放宽到任意页面。

OpenAI元数据的published_at为2024-01-12，保存正文显示2023年3月14日；日期一致性待查，当前只确认正文/图片与文件交付，不将元数据准确性标记通过。原始HTML未保留，不能断言是来源元数据还是提取优先级导致。

0.1.23 runtime TGZ已冻结：407135字节、77项文件，SHA-256 `d57a7cf35231c3fff4226f763b0edaa1e514e5a62a9d0fc521943eb5273963bd`。隔离生产依赖安装、包内Readability保留段落/代码/表格、已安装stdio MCP版本和8个工具通过；临时服务已清理。包内正式扩展0.1.23，无开发夹具权限。候选包保留打包时文档快照，本节后补记录不重写归档，未公开发布。

证据：`.audit/e2e/browser-0.1.23/`、`.audit/browser-web-q8/final-root-verification.json`与`.audit/package-smoke-0.1.23/validation-report.md`。显式标签页入口统一、真实浏览器回退成功样本和其他来源缺口仍未闭合。

## 0.1.24 入口统一、内嵌内容与交付证据

普通博客的显式tab和existing URL入口已接入同一DOM提取。显式tab先只读确认站点身份，再绑定观察地址和原tab/instance；不调用博客正文CSS作为发现前提，不导航或改动用户页面。敏感或跟踪参数被来源脱敏后若与实际地址不一致，仍严格拒绝，未以宽松URL匹配掩盖该限制。

通用解析在Readability之前检测主内容的可见audio/video/iframe/object/embed。auto/bundle有内嵌内容时转交已注册平台处理；没有对应平台或未取得媒体/附件时保留partial。明确document或图文请求仍交付图文。该转交不授权抓取任意嵌入URL，也不恢复已退出平台。

metadata.json新增已核验deliverables：相对路径、大小、SHA-256及实际存在的尺寸/时长/语言/媒体解码证明，不写资源URL或绝对目录。具体直存/提取/合并/转码动作尚无完整逐项记录，静态processing说明不作为动作证据。

43文件/338测试通过；修正一个可选布尔返回值后，扩展定向7项重新通过；typecheck、12文件LSP零诊断，独立目录运行时编译/浏览器bundle和正式/开发完整构建通过。实际MCP initialize已确认0.1.24，磁盘正式及开发manifest/bundle均核对0.1.24。扩展用户重载与新路径真实采集尚待确认，不能以构建代替浏览器验收。历史0.1.23冻结包未改写。

证据：`.audit/web-tab-unification/`及`.audit/metadata-delivery/`。Medium采集瞬时地址差异、OpenAI日期元数据、指定字幕/图片/附件组成的独立完成判定和其他来源缺口继续保留。

### 0.1.24 当前服务与冻结包实证

用户重载后实际check已确认扩展0.1.24 connected/unpaused。Medium新URL任务`job_849b01cd-e0ea-44d7-9092-16e11a7309d0`一次成功，HTTP受限后转浏览器，持久proof为`browser_page_capture / web_page.browser-document.v1 / dom_read`；42个块、6图、9个产物均通过大小/SHA复核。正文实际覆盖神经网络文章首尾，包含少量页面附带文字/头像，按Q8允许保留。metadata内7项deliverables逐项与真实文件一致。产品observe证明准确任务页且含`background:owned_task_tab_muted`。这证明本次URL浏览器回退成功，不覆盖其他文章或入口。

0.1.24 runtime TGZ冻结为411687字节、77文件，SHA-256 `c5622e65a5e0fa300b967b5c93b0ca791b5eae7a6f2fb4a02de8f3f96b69aafd`。隔离prod安装、逐字节载荷对照、已安装通用提取/metadata摘要、stdio MCP版本与8工具均通过；临时服务已退出、端口释放。包内正式扩展无开发夹具权限。工作区后补报告不改写冻结包。证据：`.audit/package-smoke-0.1.24/validation-report.md`和`.audit/web-tab-unification/job_849b01cd-e0ea-44d7-9092-16e11a7309d0-verification.json`。

OpenAI日期追查的新独立请求被公共网络地址校验拒绝，未取得原HTML，日期不一致原因仍未确定；未放宽地址校验。

显式tab随后也取得真实成功：`job_e20a35ef-1097-4120-9ab0-74d4202754e4`绑定上述自有页`144023178`和同一实例，持久proof为`browser_page_capture`，9个产物与metadata7项deliverables再次独立核验通过。该结果证明本次显式tab通用DOM入口可用；并不解决已记录的Medium早先瞬时URL漂移原因，也不证明所有带参数页面或所有来源。根证据：`.audit/web-tab-unification/job_e20a35ef-1097-4120-9ab0-74d4202754e4-verification.json`。
