# 使用与功能测试手册

适用版本：0.1.25。首次安装请先完成 [README 安装与接入](../README.md#安装与接入)。本手册帮助你判断“安装是否连通”“文件是否可用”和“某个平台是否仍有限制”。

## 测试前准备

1. 记下 `add-client` 授权的绝对资料目录，例如 `/Users/你的用户名/Documents/BabelLibrary`。提示词里的目录必须换成实际值。
2. 保持 Chrome 开启，扩展欢迎页显示已连接、未暂停。文章 HTTP 路径可不依赖浏览器；回退和媒体任务需要浏览器。
3. 让 Agent 调用 `babel_content_check`，确认客户端和依赖。若测音视频，先准备 `yt-dlp`、`ffmpeg`、`ffprobe`。
4. 选择你可以正常打开的免费公开详情页。优先用较短的视频测试，避免第一次就下载大型内容。
5. 不在同一时刻同时启动多种测试。逐项观察后再开始下一项，便于判断问题来源。

给 Agent 一次性发送下面的工作约定：

> 本轮使用 Babel Content Downloader 测试。资料目录是 `/替换为实际授权目录`。每次先检查目标，再提交任务，按工具返回间隔查询直到结束或需要我处理。报告任务 ID、实际状态、文件路径、缺失项和恢复方式。工具提交成功不代表下载完成，不要自动播放导出的音视频，不要为了测试覆盖已有文件。遇到平台门槛说明原因即可。

## 功能测试清单

| 编号 | 操作 | 你需要确认的结果 |
|---|---|---|
| T01 | 对一个公开文章 URL 使用 `document` | 正文可读、标题和来源正确、图片为本地路径；可保存额外当前页内容 |
| T02 | 对 arXiv 摘要页使用 `bundle` | 有论文信息与可以打开的原版 PDF；缺 PDF 必须报告 |
| T03 | 对公开视频使用 `audio`，格式 MP3 | 实际 MP3 可听、时长合理、任务页未发声 |
| T04 | 对公开视频使用 `video` | 实际文件有画面；来源有音轨时也应有声音 |
| T05 | 视频 60–120 秒音视频片段 | 源长度足够；导出约 60 秒且可播放 |
| T06 | 图文详情页使用 `images` | 返回的图片可以打开；有序号要求时符合选择 |
| T07 | 视频使用 `subtitles`，语言 `en` | 来源有字幕时保存字幕文件；没有该语言时说明缺项，不合成转写 |
| T08 | 提交后查询 `job_get` 与 `jobs_list` | 能找到当前客户端任务；大文件下载不会让 Agent 误报立即完成 |
| T09 | 对仍在执行的较长任务调用取消 | 任务进入取消状态，已有文件不被当作完整交付；已结束任务不适合这个测试 |
| T10 | 连接或依赖问题解决后恢复原任务 | 沿用同一任务 ID；不要用重新提交掩盖原失败 |
| T11 | 查询超过 10 个文件的任务 | 按 `artifact_page.next_offset` 翻页，文件总数与结果匹配 |
| T12 | 用授权目录外路径提交 | 请求被拒绝，越界目录没有收到输出 |

T07 的首版已知情况：英文 VTT 曾实际保存成功，但任务由于源内容完整性仍为 `partial`。把“字幕文件可用”和“任务完成状态”分别记录。

第一次可以只做 T01–T04，其他项目按需要测试。支持表中的实验性来源不要求测试成功才能使用已可用的功能。

## 常用参数

以下均为 `babel_content_collect` 的工具参数。使用自然语言时由 Agent 生成，不必手工编辑 JSON。

### 保存指定语言字幕

```json
{
  "target": { "type": "url", "url": "https://www.youtube.com/watch?v=REPLACE_WITH_VIDEO_ID" },
  "save_as": "subtitles",
  "preferences": { "subtitle_languages": ["en"] },
  "output": { "directory": "/absolute/path/to/authorized/materials" }
}
```

只保存来源已有字幕；不提供 ASR。字幕语言用来源实际提供的语言代码，不能假设任意视频都有 `en`。不要为字幕请求传 `clip`，首版未实现字幕裁切。

### 选择图片序号

```json
{
  "target": { "type": "url", "url": "https://example.org/articles/my-article" },
  "save_as": "images",
  "preferences": { "image_indices": [1, 3] },
  "output": { "directory": "/absolute/path/to/authorized/materials" }
}
```

图片从 1 开始编号，按提取结果顺序排列；页面头像、封面等也可能影响提取结果，应以返回的资源清单为准。没有所选图片时会报告缺项。

### 指定视频画质与格式

```json
{
  "target": { "type": "url", "url": "https://www.youtube.com/watch?v=REPLACE_WITH_VIDEO_ID" },
  "save_as": "video",
  "preferences": { "video_format": "mp4", "video_height": 720 },
  "output": { "directory": "/absolute/path/to/authorized/materials", "collision_policy": "version" }
}
```

明确指定画质代表请求来源提供的这一高度，不代表把任意来源升频或缩放成该规格。不存在时报告限制。`collision_policy` 支持 `version` 与 `fail`；不要依赖文件名猜测是否覆盖，以返回路径为准。

### 精确选择组成部分

```json
{
  "target": { "type": "url", "url": "https://example.org/articles/my-article" },
  "include": ["text", "images"],
  "output": { "directory": "/absolute/path/to/authorized/materials" }
}
```

`include` 与 `save_as` 只能选一个。对于希望阅读全文的用户，优先直接用 `document`，不必拆分组件。

### 读取一个已知标签页

```json
{
  "target": { "type": "tab", "instance_ref": "REPLACE_WITH_ACTUAL_INSTANCE_REF", "tab_id": 123 },
  "save_as": "document",
  "output": { "directory": "/absolute/path/to/authorized/materials" }
}
```

`instance_ref` 与 `tab_id` 必须来自实际浏览器连接和目标页信息，不能照抄示例。首版没有 MCP“列出所有浏览器标签页”工具，不要让 Agent 猜当前页 ID。普通使用优先提供 URL；URL 模式也可传 `browser: { "tab_strategy": "existing" }` 尝试匹配已有页，页面匹配仍需通过验证。已有用户页面只读，不自动导航、播放或修改静音状态。

## 任务进度与恢复

`collect` 立即返回任务引用；`job_get` 才是任务结果入口。完整流程：

1. 记录 `job_id`。
2. 按 `poll_after_ms` 查询，避免无间隔刷请求。
3. 读取 `status`、`error`、`warnings`、`completeness` 和 `checkpoint.failed_components`。
4. 读取 `content_files` 与 `artifacts`；文件多时继续分页。
5. 打开实际 Markdown、图片、音频、视频或 PDF，确认符合用途。

恢复工具参数：

```json
{ "job_id": "REPLACE_WITH_ACTUAL_JOB_ID" }
```

有 `SELECTION_REQUIRED` 时，把返回选项中的用途传给 `babel_content_job_resume`：

```json
{ "job_id": "REPLACE_WITH_ACTUAL_JOB_ID", "save_as": "audio" }
```

若任务提示需要刷新已脱敏或失效的链接，可以给 `refreshed_url`，但必须仍指向**同一条内容**。恢复不能把旧任务转成另一篇文章或另一条视频。

自动重试等待会给出 `retry_at`。不要一边等待自动重试一边反复手动恢复。付费、私有内容和访问门控不通过自动恢复绕过。

## 如何判断文件可用

- 文章：看正文、代码缩进、表格及相对图片路径。正文含少量推荐内容是首版允许的通用提取行为。
- 图片：用看图工具打开，不能只检查扩展名或大小。
- PDF：用 PDF 阅读器打开，确认是论文正文，不是网站错误页。
- 音频：抽听开头、中间、结尾；片段检查是否对应选择区间。
- 视频：抽看几个位置，确认画面、声音与时长；回音等实际听感问题需要与源视频比较。
- 字幕：用文本编辑器或支持字幕的播放器打开，检查文字、时间轴和语言。

程序已有媒体探测、时长与静音完整解码检查，但这不替代你对实际收听、观看体验的确认。`metadata.json` 的交付条目会记录可用的格式、时长和处理信息；旧任务可能没有新版本的处理元数据。

## 反馈模板

将以下内容贴到你选择的反馈渠道。不要附整个本机配置、令牌、cookies、签名资源 URL 或未经脱敏的日志。

```text
运行时版本：
扩展版本：
系统 / 浏览器 / Agent：
测试项：T01 / T02 / ...
来源平台与公开页面链接（移除敏感查询参数）：
期望保存：文章 / 音频 / 视频 / 图片 / 字幕 / PDF
任务 ID：
实际状态：
错误码与简短信息：
已保存的文件类型和数量：
实际打开文件后的问题：
是否能在浏览器正常访问源页面：
复现步骤：
```

维护者可以据此区分安装连接问题、平台访问问题、提取缺项与文件体验问题，避免要求你不断重新安装。
