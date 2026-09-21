# 单内容 DOM 完整性按次证明方案

> 范围更新：2026-09-20。当前按 AI／学习资料来源清单实施；知乎专栏和 Substack 已有具体文章闭环，其他保留来源和新增一手资料仍需逐项验证。下文涉及已退出平台的例子仅为历史问题来源，不是当前支持或后续工作。通用完整性规则保留，不用 proof 代替阅读质量检查。

## 判定边界

平台覆盖状态和一次捕获的完整性是不同维度：

- `coverage.verification` / `validation_status` 表示某个适配规则的发布验证状态；它不会直接使一次捕获成为 `complete`。
- `complete` 只表示本次目标单内容有一份受信任、与路由和内容 ID 绑定的 `ContentCompletenessProof`，并且该证明通过 bridge、运行时和采集器的校验。
- 规则、选择器、边界和稳定性参数只存在于随扩展发布的适配器代码。页面文字、HTML 属性、MCP 参数和外部响应均不能声明“已完整”或提供新的完成规则。
- 无规则、无法确认边界、仍有展开／加载标记、资源未按正文顺序放置、关联范围被请求，都会保留 `unknown` 或 `partial`，而不是补造 `complete`。

`browser_verified` 仍只影响平台验证提示，不会跳过按次 proof。当前生产平台的覆盖标签保持原值；本轮没有把任何平台升级为 `browser_verified`。

## 已落地的受信任规则

适配器的 `DomCompletionPlan` 是路由级、正文根级的受控规则，实际形态为：

```ts
interface DomCompletionPlan {
  id: string;
  content_types: readonly ContentType[];
  applies(url: URL): boolean;
  content_root: string;
  boundary:
    | { type: "root_exhausted" }
    | {
        type: "terminal_observed";
        selectors: readonly string[];
        scope?: "content_root" | "metadata_root";
        anchor_selector?: string;
        immediately_after_anchor?: boolean;
      };
  pending_or_truncation: readonly string[];
  external_file_attachment?: true; // 适配器明确声明的单个正文外文件
  stability?: { sample_count: number; minimum_window_ms: number };
}
```

注册表把每个计划映射为 `AdapterDefinition.completion_rules`。运行时验证时，rule id 必须同时匹配：

1. 适配器 ID 和版本；
2. 来源、规范化和任务目标 URL 的受支持路由；
3. 由同一适配器从 URL 解析出的 `platform_content_id`；
4. 内容类型、声明的 `boundary`，以及声明时所需的稳定性门槛。

这样，同一个平台上不同路由、不同内容 ID，或把 `root_exhausted` 冒充为 `terminal_observed` 都不能复用 proof。

## 提取器的静态资格条件

提取器只会为已选中的唯一正文根评估计划。可生成静态资格候选的条件包括：

1. 当前 URL 与计划精确匹配，内容 ID 存在且正文根选择器就是该计划的 `content_root`。
2. 访问分类为公开可读；目标不是登录、付费、私有或空壳页。
3. 没有目标正文的可见展开动作，没有计划定义的待加载／截断标记；若规则要求终点，必须在该规则指定的正文或唯一绑定的 metadata scope 中满足锚点和相邻关系。
4. 未请求关联内容，且没有收集到关系范围。单条 proof 不能替代作者续帖、引用或转发的独立边界。
5. 所有非封面资源都有实际可用来源；没有被 host policy 阻断的必要资源。
6. 正文树遍历生成的资源 ID 与 `blocks` 中实际引用的主资源集合完全一致，顺序一致，且没有 fallback 追加的未放置资源。
7. 若规则声明元数据根，必须能唯一绑定；缺失或模糊的文章头范围不能生成 proof。
8. 独立遍历所选正文内可见的 `img/video/audio/iframe`，每个 occurrence 必须由非封面的对应媒体候选覆盖；未被平台选择器识别的媒体只阻止 proof，不猜测来源或自动扩展选择器。隐藏节点、明确排除的正文区域、关联内容及跳过的 UI／脚本子树不计入目标正文。

`buildBlocks()` 记录 `orderedAssetIds`、`unplacedAssetIds` 和内部的未映射标准媒体数量。未放置资源仍可作为部分结果保存，但未放置或未映射媒体存在时均不能产生 proof。新增计数不改变公共 proof 格式。封面、字幕不进入主正文资源计数；图片、视频、音频和正文内文件必须在 `assets` 与正文 block 中一一对应。适配器明确声明的单个正文外文件使用下述独立附件证明，不计入正文顺序。

同一图片 URL 出现在正文两个不同 DOM 节点时，两个 occurrence 会取得不同的 asset ID 和两个有序 block，不会因 URL 去重而丢失一个位置。相反，同一 DOM 节点被多个选择器命中只保留一次；播放器与其内部 `<source>` 归到同一媒体组，避免把同一播放器伪造为两个附件。

## WeakMap 资格与双快照稳定 proof

没有稳定性要求的规则，在所有静态条件通过后可立即产生 `adapter_bounded_dom` proof。带稳定性要求的规则不同：

- 第一次提取只得到 `unknown` 快照和内部资格候选。候选保存在 `WeakMap<ContentSnapshot, CompletionCandidate>`，不持久化，不经 bridge 发送，也不包含可由页面利用的选择器。
- 稳定采样阶段仅对同一页面执行只读重复提取；不滚动、不播放、不遍历轮播或回复，也不执行额外页面操作。
- 适配器声明的次数和时间窗决定采样。两份样本必须有相同的适配器、路由／内容 ID、正文 blocks 以及按序主资源身份和来源；内容脚本对这些材料计算小写 SHA-256。
- 只有第二份快照仍能在 WeakMap 找到同一适配器计划的资格，且实际采样数、实际窗口和摘要都满足计划，`finalizeStableCompletion()` 才添加 `stability` 字段、proof 和 `complete`。

proof 的公共结构为：

```ts
interface ContentCompletenessProof {
  version: 1;
  scope: "single_item";
  method: "adapter_bounded_dom";
  rule_id: string;
  platform_content_id: string;
  boundary: "root_exhausted" | "terminal_observed";
  pending_marker_count: 0;
  ordered_asset_count: number;
  unplaced_asset_count: 0;
  external_file_asset_id?: string; // 与正文有序资源分开，不得出现在正文 blocks
  stability?: {
    sample_count: number;
    window_ms: number;
    fingerprint: string; // 小写 SHA-256
  };
}
```

稳定字段不是 MCP 参数，也不是页面声明。规则未要求稳定性时携带它会被拒绝；规则要求时缺失、次数不足、窗口不足或摘要格式不正确也会被拒绝。

## bridge、运行时与续跑校验

证明不是扩展单方面的成功标记：

1. bridge 的 schema 和 `evaluateContentCompleteness()` 检查 proof 的结构、资源集合、正文 block 引用、访问条件、关联范围和规则绑定。
2. bridge server 用任务目标 URL、快照来源 URL 和规范化 URL 重新构造 adapter binding；路由漂移、未知 rule、内容 ID 不符和边界不符都以 `SNAPSHOT_INVALID` 拒绝。
3. collector 对新快照和可复用的本地 checkpoint 都重新构造同一 binding 并调用 evaluator；无效 proof 以 `COMPLETENESS_PROOF_INVALID` 阻止采集继续把来源称为完整。
4. 存储中的 snapshot 会先做 URL、文本和资产字段脱敏。续跑使用已保存 snapshot 时并不盲信其中的 `complete` 字符串：collector 仍按当时的适配器／URL binding 再次验证。媒体的“单个有界项目完整解码”例外只适用于请求的单项音频或视频，不替代文章正文 proof。

因此，持久化记录可以用于恢复，但不能把旧页面或错误规则的 complete 声明带入新一次采集。

## 知乎公开专栏的受控规则

0.1.2 的知乎样本曾出现长段落聚合和图片追加到末尾；0.1.3 已恢复图文交错顺序，但真实 DOM 仍证明外层 `.Post-RichTextContainer` 会混入目录和“收起”。0.1.4 只为以下精确范围接入 production completion plan：

- 路由仅为 `https://zhuanlan.zhihu.com/p/:numericId`；回答路由不启用该计划。
- 正文根必须是 `.Post-RichTextContainer .RichText.ztext.Post-RichText`，而非外层容器。根不唯一或页面结构变化会失败关闭。
- metadata 只从唯一包含该正文根的 `article.Post-Main.Post-NormalMain` 读取。作者取该范围内的 `[itemprop='author'] .AuthorInfo-name`；发表时间只取 `[itemprop='datePublished']`。`.ContentItem-time` 的“编辑于”不是 `published_at` 的后备值。
- 完成边界是同一 metadata root 内：`.Post-RichTextContainer` 后面紧邻 `.ContentItem-time[role='button']`。它是有界终点，不是正文发布时间字段，也不是全局页面搜索结果。
- 若 `.RichContent .ContentItem-more` 存在，或正文资源未按序放置，则不生成 proof。
- 计划要求两次只读采样，最小窗口 700 ms；两次正文／资源材料不相同就仍为 `unknown`。

`.audit/e2e/browser-0.1.2/zhihu-content-layout-evidence.json` 与 0.1.3 的 `zhihu-dom-*.md`、`zhihu-proof-samples.json` 是规则收窄和双样本参数的历史输入：它们不等于 0.1.4 新扩展已成功采集。新包仍需在真实任务中确认 rule id、相邻终点、双样本摘要、24 张正文图的实际顺序与可用资源，且没有 `COMPLETENESS_NOT_CONFIRMED_BY_BROWSER` 后，才能为那一次捕获得到完整性结论。单个样本通过也不代表同平台其他路由或全部内容类型通过，平台覆盖状态仍需另行验收。

## Substack 图片来源与正文范围

0.1.3 的真实 DOM 证据显示，Substack CDN `/image/fetch/` 的 `srcset` URL 本身可含逗号。0.1.4 的解析器按响应式候选的 descriptor 边界解析 `srcset`，而不是简单 `split(',')`，并按尺寸／密度选择候选，避免把一个代理 URL 拆成多个失效 URL。

图片选择器收窄为已观察到的 `article.typography.newsletter-post.post .body.markup figure img`。头像、文章头图、订阅弹窗和页面其他区域不会因全局图片扫描进入正文。基于同一证据，`images.unsplash.com` 仅在这一精确正文 figure 范围的已选图片来源中被允许；这不是对任意外链或全页面图片的放宽。

该修复没有宣称既有 404 全部消失。新版真实采集仍须检查每张正文图片的实际 URL、host policy、下载结果和正文位置。

## 历史证据、当前验证与待验收项

0.1.2 的知乎任务曾保存 27 个产物并完成 JPEG 解码，但快照把目录混进正文、把 9202 字正文压成一段，并把 24 张图放在文末。那些文件和哈希只证明已保存字节，不证明正文边界或图文顺序；它们继续作为历史反例保留，不被改写为 `complete`。

0.1.4 候选阶段的源码验证结果为：

- `npm test`：19 个文件、131 个测试通过；
- `npm run typecheck`：0 个错误；
- LSP：65 个 TypeScript 文件，0 error、0 warning。

这些源码结果不能替代真实浏览器验收。随后 0.1.5 完整检查达到 23 文件／166 测试通过，LSP 76 文件零诊断；实际知乎新任务 `job_ca0226ca-360c-4ab7-a297-b08122a555de` 已验证精确正文根与终点、两个相隔 3247 ms 的稳定快照、24 个按序且可用的主资源，以及 bridge／运行时接受 proof 后的完整本地文档。150 个正文 block 中的 24 张图片与 Markdown 顺序一致，27 个产物的哈希、清单、链接和图片完整解码均通过，旧目录 UI 已排除。实际版本组合为运行时 0.1.5／扩展 0.1.4，后者与 0.1.5 构建的扩展代码相同，仅 manifest 版本不同。

其他平台仍须分别取得对应边界证据，不能借用此次知乎结果声明完整。


## 一手资料路由与正文外附件（0.1.14 源码与五类样本实证）

新计划限定 GitHub README、Hugging Face paper 详情、Anthropic engineering、DeepMind publication 和 arXiv abs 五类路由；不自动扩展到同站其他路由。均要求两份实际快照、至少 700 ms 的稳定窗口，以及既有访问、目标身份、根唯一性、待加载与未映射媒体检查。Hugging Face 保存的是目标 paper 详情中的真实摘要，不将其称为论文全文。Anthropic 保留 hero、介绍和正文图片。

arXiv 的桌面 PDF 入口位于摘要正文根之外。`external_file_attachment` 只由随产品发布的规则声明，实际链接必须可见、由既有文件选择器选中且通过 `file_matches` 的论文／版本绑定；存在两个可见匹配入口仍不能生成该证明。文件保留在 `assets`，不会生成虚假的正文位置。proof 用 `external_file_asset_id` 单独引用，正文计数不含它；bridge 和运行时核对角色、唯一性、可用性、正文引用与受信任规则声明。正文外图片等资源没有这个例外。

稳定采样包含文件身份和来源，附件变化后不得沿用旧证明。文档渲染器在末尾追加已经交付的本地附件链接；文件本身仍须通过现有下载与格式验证。arXiv 全平台论文文档用途及 DeepMind publication 路由的文档用途均要求 `files`，缺少全文时不能仅凭页面摘要证明返回任务成功；DeepMind 普通博客不强制 PDF，明确的图片／音频用途保持原选择。

实际扩展 0.1.14 的五类样本均已取得稳定 proof 与独立文件核验证据，见浏览器验收记录。该结论仅覆盖这些路由／样本，不推广到同站其他内容或未测试用途。
