<p align="center"><img src="../brand/logo-preview.png" alt="Babel Content Downloader Logo" width="128" height="128"></p>

# Babel Content Downloader

[簡中](../../README.md) | [English](README.en.md) | [繁中](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md)

讓本機 AI Agent 將公開網頁、文章、論文、影片與 Podcast，儲存為可閱讀、觀看與收聽的本機資料。

**目前版本：0.1.26 · MIT 開源 · 首版建議環境：macOS + Chrome + 本機 MCP Agent。**

**[下載 v0.1.26 發行附件](https://github.com/gjw199513/babel-content-downloader/releases/tag/v0.1.26)**：一般使用者下載執行階段 TGZ 與擴充功能 ZIP；安裝擴充功能不需要下載原始碼封存檔。

你只要提供一個連結，並說明想儲存什麼。例如：「把這個影片 Podcast 存成音訊，放進我的學習資料夾。」下載器會負責取得內容、儲存檔案與回報結果；你不需要先了解音軌或編碼。


按一下工具列的擴充功能圖示會開啟寬版概覽頁；擴充功能詳細資料中的「選項」會開啟獨立設定頁。兩個頁面都能切換語言，接入命令、連線控制與技術資訊集中在設定頁。

## 導覽

- [能做什麼](#能做什麼)
- [語言與介面](#語言與介面)
- [來源與支援邊界](#來源與支援邊界)
- [安裝與接入](#安裝與接入)
- [首次使用與功能測試](#首次使用與功能測試)
- [輸出檔案與任務狀態](#輸出檔案與任務狀態)
- [MCP 呼叫範例](#mcp-呼叫範例)
- [常見問題](#常見問題)
- [升級、停止與解除安裝](#升級停止與解除安裝)
- [開發與其他文件](#開發與其他文件)

## 能做什麼

| 你想做的事 | 對 Agent 的說法 | 儲存類型 |
|---|---|---|
| 離線閱讀文章 | 把這個連結的正文和配圖儲存下來 | `document` |
| 聽影片 Podcast | 把這個影片存成音訊，在路上聽 | `audio` |
| 離線觀看影片 | 儲存這個影片為 MP4 | `video` |
| 蒐集圖片 | 只儲存這則內容的圖片 | `images` |
| 儲存既有字幕 | 儲存這個影片的英文字幕 | `subtitles` |
| 閱讀論文原文 | 儲存論文資訊與原版 PDF | `bundle` |
| 只要附件 | 儲存這則內容中支援下載的檔案 | `files` |
| 依主體自動選擇 | 把這個連結儲存下來 | `auto` |

音訊預設為 M4A、影片預設為 MP4；可明確指定 MP3／WAV／FLAC、MKV、來源畫質、音影片片段、字幕語言或圖片序號。儲存的是來源內容，可為觀看與收聽擷取音訊、合併影音軌或轉換格式；不內建 OCR、語音轉寫、摘要或翻譯。

一般部落格統一以 HTTP + Mozilla Readability 擷取目前頁面，必要時回退至瀏覽器讀取，不為每個部落格維護正文選擇器。動態自媒體、論文與媒體內容會使用對應的適配器。只處理明確指定的目標與受支援資源，不會遞迴爬取整個網站。

任務自行建立的瀏覽器頁面會先靜音，再開啟目標；背景處理不會啟動播放器。你原本開啟的頁面不會被自動播放、靜音、導覽或關閉。

## 語言與介面

概覽頁與設定頁都提供「自動（跟隨瀏覽器）」、簡中、English、繁中、日本語與 한국어。自動模式會依瀏覽器語言的優先順序選擇；若沒有受支援的語言，會回退至 English。手動指定的語言會儲存在此電腦並優先於瀏覽器語言；再次選擇「自動（跟隨瀏覽器）」即可恢復自動模式。

介紹、連線狀態、安裝與操作說明、複製按鈕和使用方式會一併切換。Chrome 擴充功能管理頁的 description 則依瀏覽器本身的顯示語言決定，不會隨歡迎頁內的選擇改變。

Babel Content Downloader 品牌名稱、CLI／MCP 命令與 API、檔名，以及下載來源的原始內容不會翻譯。技術錯誤原文會保留在可展開的詳細資料中；CLI 與 MCP 的技術輸出也可能維持原始語言。

## 來源與支援邊界

以下是首版的**實際樣本驗證情況**，不是對整個平台所有頁面的相容性承諾。網站結構、地區、網路與存取狀態都可能影響結果。

| 來源 | 已有樣本證據／目前邊界 |
|---|---|
| 一般公開部落格、技術文章 | 通用目前頁面擷取；受 URL、網路與存取策略限制，不代表所有網站都可讀取 |
| Medium、Substack | 已有正文與圖片交付；Medium 已驗證通用瀏覽器回退與明確分頁讀取 |
| OpenAI、Anthropic、Google DeepMind | 已有文章與圖片交付；DeepMind 另有 publication PDF 樣本 |
| GitHub | 公開儲存庫 README 已有交付；Markdown blob 目前存在 `ACCESS_UNCONFIRMED`，release 等路由不繼承 README 的驗收結果 |
| Hugging Face | model card、dataset card、paper 有樣本；blog 曾出現圖片缺失的部分完成結果；不會下載整套模型權重或資料集 |
| arXiv | 已有摘要與原版 PDF 交付 |
| YouTube、B站 | 已有影音檔交付與完整解碼驗證；YouTube 英文字幕已有 VTT 檔案，但樣本任務仍為 `partial` |
| 知乎 | 已有公開文章與配圖交付 |
| X | 有可見正文的部分結果，圖片、頁面載入與逾時仍有缺口 |
| Reddit | 已測環境被安全／登入頁面阻擋，尚無檔案閉環 |
| 小紅書 | 已測樣本遇到 404／App 門檻，尚無檔案閉環 |
| 微信公眾號 | 存在目標漂移與存取限制，仍需改善 |

共有 15 個登錄來源，另加符合策略的一般公開網頁擷取。搜狐、快手等已移除來源不會透過通用網頁入口重新啟用。只處理免費公開內容，不會繞過付費、私有內容或 DRM。具體限制見[首版說明](../first-release.md)。

## 安裝與接入

這是「本機執行階段 + 瀏覽器擴充功能 + Agent MCP 連線」的組合，**只安裝擴充功能還不能下載**。三者必須在同一台電腦上執行。

### 1. 準備環境與發行檔案

- Node.js **22.13.0 或更新版本**，且可在終端機執行 `node`、`npm`。
- Chrome **120 或更新版本**；Edge 等 Chromium 瀏覽器仍需獨立驗證環境。
- 本機 Agent。自動接入命令支援 Codex／Claude Code，須先安裝對應 CLI。
- 儲存影音時，另需 `yt-dlp`、`ffmpeg`、`ffprobe`。基礎網頁擷取不需要這些媒體工具。
- 首版受管理的背景服務只實作 macOS；Windows／Linux 尚未完成正式安裝支援。

發行附件：

| 檔案 | 用途 |
|---|---|
| `babel-content-downloader-0.1.26.tgz` | 已編譯執行階段，一般使用者安裝此檔 |
| `babel-content-downloader-extension-0.1.26.zip` | 正式擴充功能，解壓縮後載入 |
| `babel-content-downloader-source-0.1.26.zip` | 完整原始碼，供開發或自行建置使用 |
| `SHA256SUMS`、`release-manifest.json`、`verification.json` | 校驗值、發行清單與驗證紀錄 |

一般使用者可直接從 Release 下載擴充功能 ZIP，不需下載或建置原始碼套件。請參閱[五語擴充功能安裝說明](../extension-install.md)。Chrome 目前仍需「解壓縮後載入未封裝項目」；真正的一鍵安裝需透過後續的 Chrome Web Store 發佈，已列入[發佈路線圖](../release-roadmap.md)。

以下命令請在 macOS 終端機執行。將 `/absolute/path/...` 替換成你自己的**絕對路徑**；不要照抄預留字串。開啟新終端機後，需要重新設定範例中的變數。

```sh
export BABEL_RELEASE_DIR=/absolute/path/to/release-files
cd "$BABEL_RELEASE_DIR"
shasum -a 256 -c SHA256SUMS

export BABEL_INSTALL_ROOT="$HOME/Applications/babel-content-downloader"
npm install --prefix "$BABEL_INSTALL_ROOT" --omit=dev "$BABEL_RELEASE_DIR/babel-content-downloader-0.1.26.tgz"
export BABEL_CLI="$BABEL_INSTALL_ROOT/node_modules/babel-content-downloader/dist/bootstrap/cli.js"
node "$BABEL_CLI" init
```

保留 npm 預設的可選相依套件，不要加上 `--omit=optional`，圖片處理需要對應系統的二進位元件。TGZ 已編譯，不必再執行 `npm run build`。若要校驗所有檔案，請將發行清單中的附件一併下載到同一個目錄。

### 2. 載入擴充功能

執行階段套件已包含與 ZIP 相同的正式擴充功能，最簡單的方式是直接載入它：

```sh
export BABEL_EXTENSION_DIR="$BABEL_INSTALL_ROOT/node_modules/babel-content-downloader/dist/extension"
printf '%s\n' "$BABEL_EXTENSION_DIR"
```

在 Chrome 開啟 `chrome://extensions`，啟用「開發人員模式」，點選「載入未封裝項目」，選擇上面輸出的目錄。也可以將正式擴充功能 ZIP 解壓縮到長期保留的目錄，再載入其中直接包含 `manifest.json` 的目錄。**兩種方式擇一即可，不必重複載入。**

確認擴充功能版本為 `0.1.26`。首次安裝會自動開啟歡迎頁；如果已關閉，請從擴充功能管理頁複製實際的 32 位 ID，並在 Chrome 位址列開啟 `chrome-extension://實際擴充功能ID/welcome/index.html`。歡迎頁也會顯示該 ID。不要載入 `dist/extension-dev`，它是開發夾具版本。

### 3. 授權輸出目錄並啟動

首次使用 Codex 時：

```sh
export BABEL_EXTENSION_ID=替換為擴充功能頁面顯示的32位ID
export BABEL_OUTPUT_ROOT="$HOME/Documents/BabelLibrary"
node "$BABEL_CLI" allow-extension "$BABEL_EXTENSION_ID"
node "$BABEL_CLI" add-client codex "$BABEL_OUTPUT_ROOT"
node "$BABEL_CLI" runtime-install
node "$BABEL_CLI" runtime-status
printf '資料儲存目錄：%s\n' "$BABEL_OUTPUT_ROOT"
```

記下最後輸出的絕對資料目錄，稍後告訴 Agent。每個任務只能寫入該客戶端已獲授權的目錄內。

`runtime-status` 應顯示 `state: "running"`、`health: "ready"`、`loaded: true`、`restart_required: false`。接著回到擴充功能概覽頁點選「連線本機執行階段」，確認顯示「已連線到本機執行階段」；若曾暫停，請到設定頁點選「恢復」。

已安裝過的使用者請先看[升級說明](#升級停止與解除安裝)，不要反覆執行 `add-client`。變更授權、工具路徑或客戶端後，執行 `runtime-start` 來套用設定。

### 4. 接入 Agent

Codex：

```sh
node "$BABEL_CLI" install-client-config codex
```

回傳 `waiting_client_reload` 後重新載入 Codex。在新工作階段中傳送：

> 請呼叫 Babel Content Downloader 的 babel_content_check，檢查本機執行階段、瀏覽器連線與媒體相依套件，告訴我哪些功能已經可以使用。

應能找到八個 `babel_content_*` 工具。需要瀏覽器的任務應有目標擴充功能執行個體已連線且未暫停；一般 URL 正文檢查可能回傳 `ready_http`、`browser_required: false`，表示可先直接擷取，不保證後續網路請求必定成功。

使用 Claude Code 時，在首次安裝的第 3 步將 `codex` 改為 `claude`，再執行 `install-client-config claude`。若要在既有執行階段新增客戶端，請依序執行：

```sh
node "$BABEL_CLI" add-client claude "$BABEL_OUTPUT_ROOT"
node "$BABEL_CLI" runtime-start
node "$BABEL_CLI" install-client-config claude
```

重新載入 Claude Code 後，同樣要實際呼叫檢查工具。自動安裝只管理本專案的 MCP 項目；若遇到已存在且非本專案管理的同名設定，會拒絕覆寫。

其他 stdio MCP 客戶端請先註冊獨立客戶端，例如 `add-client my-agent "$BABEL_OUTPUT_ROOT"`，再執行 `runtime-start`。客戶端 MCP 設定通常如下；實際外層格式請依客戶端需求填寫：

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

路徑必須實際存在，JSON 中不可展開 `$HOME`、`~` 或 `$BABEL_CLI`。設定中不需要貼上執行階段權杖。

### 5. 準備影音工具（需要時）

從各工具官方發行管道安裝媒體相依套件後，在終端機確認：

```sh
yt-dlp --version
ffmpeg -version
ffprobe -version
```

若終端機能找到、背景服務找不到，請明確登錄可執行檔路徑：

```sh
node "$BABEL_CLI" set-tool yt-dlp "$(command -v yt-dlp)"
node "$BABEL_CLI" set-tool ffmpeg "$(command -v ffmpeg)"
node "$BABEL_CLI" set-tool ffprobe "$(command -v ffprobe)"
node "$BABEL_CLI" runtime-start
```

再請 Agent 執行檢查，並恢復先前被阻擋的任務。缺少工具時不必重裝擴充功能。

## 首次使用與功能測試

安裝完成後，**請在 Agent 對話中操作，而不是在擴充功能頁面貼上下載連結**。擴充功能頁面負責連線、暫停與撤銷。

建議先測文章，再測論文，最後測影音。複製下列提示詞，將 `<文章URL>` 等預留內容與 `/你的絕對資料目錄` 替換為真實值。建議選擇不需登入、你可在瀏覽器正常閱讀的內容；網站暫時存取失敗不代表安裝失敗。

### A. 儲存一篇文章

> 使用 Babel Content Downloader，將這篇公開文章 `<文章URL>` 的正文與配圖儲存到 `/你的絕對資料目錄`。以 document 儲存。請等待任務結束，回傳任務 ID、實際狀態、正文路徑、圖片數量與缺失項，不要只告訴我已經提交。

驗收：開啟回傳的 `content.md`，正文應可讀；配圖應指向本機檔案；`metadata.json` 應有來源。只有 `succeeded` 表示要求範圍已完成；若為 `partial`，也請查看缺失項。

### B. 儲存論文與 PDF

> 使用 Babel Content Downloader，將這篇論文 `<arXiv摘要頁URL>` 以 bundle 儲存到 `/你的絕對資料目錄`，包含論文資訊與原版全文 PDF。完成後給我 PDF 路徑與缺失項。

請使用論文摘要詳情頁，通常形式為 `https://arxiv.org/abs/論文編號`，不要直接將原始 PDF 位址當作這項測試的入口。驗收時請實際開啟 PDF。

### C. 將影片 Podcast 儲存為音訊

> 使用 Babel Content Downloader，將這個影片 `<YouTube或B站影片URL>` 儲存成 MP3，放到 `/你的絕對資料目錄`。處理期間保持任務頁面靜音，不要自動播放匯出的檔案。結束後給我音訊路徑、時長、狀態與缺失項。

驗收：自行開啟 MP3，確認有聲音且時長合理。不要以「檔案已建立」取代實際收聽檢查。

### D. 儲存影片或片段

> 使用 Babel Content Downloader，將 `<影片URL>` 的第 60 秒到第 120 秒儲存為 MP4，放到 `/你的絕對資料目錄`。完成後給我檔案路徑、實際時長與狀態，不要自動播放。

驗收：來源影片應長於 120 秒；匯出內容應約 60 秒，畫面與聲音可正常播放。若明確要求 720p 而來源未提供，會回報缺失項，不保證自動改用其他畫質。

### E. 儲存圖片與字幕

> 將 `<公開圖文URL>` 的圖片儲存到 `/你的絕對資料目錄`，只要圖片，回傳所有檔案路徑與缺失項。

> 將 `<YouTube影片URL>` 的英文字幕儲存到 `/你的絕對資料目錄`，指定語言 en。只儲存來源已有字幕，不做語音轉寫；回報真實任務狀態與字幕檔案路徑。

字幕需要來源提供對應語言。首版已有字幕檔可用但任務仍顯示 `partial` 的已知情況，不應隱藏此狀態。尚未支援字幕裁切。

### F. 查詢進度、恢復與取消

> 查看 Babel Content Downloader 最近的任務。針對任務 `<job_id>` 檢查狀態、失敗原因與所有已儲存檔案；檔案很多時繼續讀取後續分頁。

> 我已補齊相依套件／恢復瀏覽器連線，請恢復 Babel Content Downloader 任務 `<job_id>`，不要重新建立重複任務。

> 取消 Babel Content Downloader 任務 `<job_id>`。

遇到 `SELECTION_REQUIRED` 時，告訴 Agent 選擇「文章／影片／音訊」等回傳選項即可，它會恢復同一個任務。取消任務不會刪除已交付的檔案。

更完整的逐項測試與結果紀錄範本，請見[使用與測試手冊](../usage-guide.md)。

## 輸出檔案與任務狀態

任務會在授權目錄內建立自己的結果目錄。實際檔案數量與名稱以 `job_get` 回傳值為準，例如：

```text
BabelLibrary/
└── 某篇文章或影片的結果目錄/
    ├── content.md       # 可讀正文或資料入口，依任務用途產生
    ├── assets/          # 圖片、音訊、影片、字幕、PDF 等實際檔案
    ├── metadata.json   # 來源、內容資訊、交付清單與已記錄的媒體處理資訊
    └── assets.json     # 資源關聯清單
```

圖片在 Markdown 中使用相對連結，移動資料時請保留整個結果目錄。`job_get` 提供檔案路徑、大小、SHA256 與分頁資訊；完整正文在本機檔案內，不會全部塞進 MCP 回應。

| 狀態 | 意義與下一步 |
|---|---|
| `queued`／`resolving`／`collecting`／`downloading`／`finalizing`／`verifying` | 已入列或處理中，依工具回傳的間隔繼續查詢 |
| `succeeded` | 本次明確要求的範圍已完成，開啟產物確認是否滿足使用需求 |
| `partial` | 有結果但缺少部分要求內容，查看 `error`、`warnings` 與失敗元件 |
| `blocked` | 等待連線、相依套件、用途選擇或自動重試；先讀取具體原因與 `retry_at` |
| `failed` | 本次未完成，查看錯誤；解決可恢復問題後再恢復 |
| `cancelled` | 已取消；既有檔案仍可能保留 |

## MCP 呼叫範例

以下是 **MCP 工具參數 JSON**，供 Agent 或客戶端開發者參考，不是終端機命令，也不是 HTTP API 請求本文。一般使用者直接使用上面的自然語言即可。

`babel_content_collect` 儲存正文：

```json
{
  "target": { "type": "url", "url": "https://example.org/articles/my-article" },
  "save_as": "document",
  "output": { "directory": "/absolute/path/to/authorized/materials" }
}
```

`example.org` 僅作格式範例，測試時請換成實際可存取的文章。擷取 MP3 音訊片段：

```json
{
  "target": { "type": "url", "url": "https://www.youtube.com/watch?v=REPLACE_WITH_VIDEO_ID" },
  "save_as": "audio",
  "preferences": { "audio_format": "mp3", "clip": { "start_seconds": 60, "end_seconds": 120 } },
  "output": { "directory": "/absolute/path/to/authorized/materials" }
}
```

提交後會回傳 `job_id`，再呼叫 `babel_content_job_get`：

```json
{ "job_id": "替換為實際job_id", "artifact_offset": 0, "artifact_limit": 50 }
```

若 `artifact_page.next_offset` 非空，使用該值繼續讀取。不要把 `collect` 回傳 `queued` 當成下載完成。

| 工具 | 用途 |
|---|---|
| `babel_content_check` | 檢查執行階段、目標路由、擴充功能與相依套件；可傳入 `target` 與 `save_as` |
| `babel_content_collect` | 建立單一明確 URL 或分頁任務 |
| `babel_content_job_get` | 查詢狀態、缺失項與分頁檔案 |
| `babel_content_job_resume` | 恢復；可傳入 `save_as` 用途選擇或 `refreshed_url` 的同內容新連結 |
| `babel_content_job_cancel` | 取消任務 |
| `babel_content_jobs_list` | 查看目前客戶端任務，支援 `offset`／`limit` |
| `babel_content_browser_observe` | 觀察指定 `job_id` 的頁面 |
| `babel_content_browser_act` | 在任務權限內執行允許的捲動、展開、靜音播放等操作 |

`save_as` 與 `include` 互斥。`include` 可選 `text`、`images`、`video`、`audio`、`subtitles`、`cover`、`files`。其他偏好與分頁範例請見[使用與測試手冊](../usage-guide.md)。

## 常見問題

| 現象 | 處理方式 |
|---|---|
| Agent 找不到工具 | 確認對應 CLI 已安裝；檢查 `client-config-status codex`；重新載入 Agent，再實際呼叫檢查工具 |
| 擴充功能顯示「等待本機授權」 | 核對實際擴充功能 ID，執行 `allow-extension` 後再執行 `runtime-start`，並在歡迎頁重新點選連線 |
| `waiting_browser` 或擴充功能已暫停 | 保持 Chrome 開啟，在擴充功能點選連線／恢復；檢查任務綁定的執行個體，不要只看總連線狀態 |
| 版本仍是舊的 | 建置不會讓 Chrome 自動重新載入；核對載入目錄，在擴充功能管理頁點選一次重新載入，再查看歡迎頁版本 |
| `CLIENT_ALREADY_EXISTS` | 客戶端已獲授權，不要重複註冊或因此刪除舊授權；直接檢查目前設定與執行階段狀態 |
| 連接埠被占用 | 先辨識占用程序；既有手動 `serve` 與受管理服務不可同時使用同一連接埠，不要盲目結束其他服務 |
| 輸出目錄被拒絕 | 使用 `add-client` 授權根目錄內的絕對路徑；聊天文字無法擴大目錄權限 |
| 缺少媒體相依套件 | 依上文安裝並以 `set-tool` 登錄，重新啟動執行階段後恢復原任務 |
| `ACCESS_UNCONFIRMED`／`ACCESS_NOT_PUBLIC` | 目前頁面無法確認公開性或遇到存取門檻；核對連結與平台限制，不要把錯誤頁面當成成功 |
| `ADAPTER_CHANGED`／`CONTENT_SCRIPT_TIMEOUT` | 頁面結構或載入狀態可能改變；保留錯誤與任務 ID，不能靠重複下載保證成功 |
| `PRIVATE_ADDRESS_BLOCKED` | DNS 回傳保留／內網位址；核對本機網路設定，執行階段不會放行內網位址；可選 DNS 設定請見執行階段文件 |
| 有檔案但為 `partial` | 查看實際缺失項；可能缺圖片、全文、字幕或來源內容完整性證明，既有可用檔案可先使用 |
| 部落格含有導覽／相關內容或日期為空 | 通用擷取可能保留額外可讀區域；無法確定發布日期時允許為空 |

本機設定預設位於 `~/.config/babel-content-downloader/config.json`，任務紀錄位於 `~/.local/share/babel-content-downloader/jobs/`。設定含有客戶端憑證，請不要附到公開 Issue 或原始碼套件中。回報問題時，提供版本、平台、任務狀態、錯誤碼與已移除敏感參數的連結即可。

## 升級、停止與解除安裝

升級前，先讓正在處理的任務結束或取消。保留設定、任務目錄與已下載檔案；在原本穩定的安裝目錄更新執行階段套件，避免變更服務入口路徑。將命令中的版本檔名改為實際新套件：

```sh
node "$BABEL_CLI" runtime-stop
npm install --prefix "$BABEL_INSTALL_ROOT" --omit=dev "$BABEL_RELEASE_DIR/babel-content-downloader-0.1.26.tgz"
node "$BABEL_CLI" runtime-start
node "$BABEL_CLI" runtime-status
```

在 Chrome 對同一個擴充功能目錄點選「重新載入」，再檢查版本與連線。若擴充功能來自獨立 ZIP，請更新原本解壓縮的目錄；若變更目錄導致 ID 改變，須授權新的實際 ID 並重新啟動執行階段。不要重新執行 `add-client`。

若原先使用原始碼目錄、手動 `serve` 或其他設定檔，應繼續使用同一份設定與原入口，依[執行階段文件](../runtime-setup.md)遷移；不可直接將上面的全新 TGZ 安裝路徑當成既有服務路徑。

只要暫停擴充功能，可在設定頁點選「暫停」；暫停不等同取消所有已啟動的任務。管理本專案背景服務：

```sh
node "$BABEL_CLI" runtime-stop
node "$BABEL_CLI" runtime-start
```

移除 Codex 接入與本專案背景服務：

```sh
node "$BABEL_CLI" remove-client-config codex
node "$BABEL_CLI" remove-client codex
node "$BABEL_CLI" runtime-uninstall
```

這些步驟會影響同一執行階段的其他客戶端；若只是停用一個客戶端，請保留背景服務並重新啟動應用程式以套用授權變更。擴充功能可在設定頁撤銷連線後，由 Chrome 移除。上述命令不會刪除已蒐集資料；刪除安裝目錄前，先解除安裝其背景服務。

## 開發與其他文件

從儲存庫或原始碼 ZIP 建置：

```sh
npm ci
npm run typecheck
npm test -- --maxWorkers=2
npm run build
```

接著以 `dist/bootstrap/cli.js` 為入口、`dist/extension` 為正式擴充功能，依上文進行授權與接入。影音測試需要本機 FFmpeg。`npm run lsp` 另需 `typescript-language-server`；測試夾具不代表真實網站驗收。

0.1.25 的歷史程式基線曾記錄：43 個測試檔案、340 項測試通過；執行階段 TGZ 獨立安裝及八個 MCP 工具驗證通過；原始碼 ZIP 可重新建置，60 個生成檔案與交付建置逐位元組一致。真實瀏覽器基線為 0.1.24。0.1.26 新增五語介面與 README；最新套件與驗證狀態請以發行附件 `verification.json` 為準，歷史數字不代表使用者已重新載入新版本。

- [使用與測試手冊](../usage-guide.md)：更多參數、逐項測試與回報範本。
- [首版安裝與限制](../first-release.md)、[執行階段設定](../runtime-setup.md)、[Agent 接入](../agent-setup.md)。
- [發行操作清單與發行說明](../publishing.md)：維護者上傳原始碼與附件時使用。
- [CHANGELOG](../../CHANGELOG.md)、[實作紀錄](../implementation-status.md)、[平台歷史驗證](../platform-status.md)、[通用網頁驗證](../unified-web-validation.md)。歷史紀錄中的舊版本結果不取代目前支援邊界。
- [產品 Spec](../specs/Babel_Content_Downloader_内容收集与使用契约_2026-09-18.md)、[LICENSE](../../LICENSE)、[第三方相依套件說明](../../THIRD_PARTY.md)。

原始碼採用 MIT；第三方相依套件及下載內容的權利分別歸其權利人。請依來源條款與你擁有的權限使用已儲存資料。
