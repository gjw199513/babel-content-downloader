<p align="center"><img src="../brand/logo-preview.png" alt="Babel Content Downloader Logo" width="128" height="128"></p>

<p align="center">
  <a href="../../README.md">中文</a> ·
  <a href="README.en.md">English</a> ·
  <a href="README.zh-TW.md">繁中</a> ·
  <a href="README.ja.md"><strong>日本語</strong></a> ·
  <a href="README.ko.md">한국어</a>
</p>

# Babel Content Downloader

ローカル AI Agent を使って、公開ウェブページ、記事、論文、動画、ポッドキャストを、読める・見られる・聴けるローカル資料として保存します。

**現在のバージョン：0.1.26 · MIT オープンソース · 初回リリースの推奨環境：macOS + Chrome + ローカル MCP Agent。**

**[v0.1.26 のリリース添付ファイルをダウンロード](https://github.com/gjw199513/babel-content-downloader/releases/tag/v0.1.26)**：通常の利用にはランタイム TGZ と拡張機能 ZIP を使います。拡張機能の導入にソースアーカイブは不要です。

Agent にリンクと保存したい内容を伝えるだけで利用できます。たとえば「この動画ポッドキャストを音声として学習資料フォルダーに保存して」と依頼します。ダウンローダーがコンテンツの取得、ファイル保存、結果報告を行うため、音声トラックやコーデックを事前に理解する必要はありません。


ツールバーの拡張機能アイコンは横幅の広い概要ページを開き、拡張機能の詳細にある「オプション」は独立した設定ページを開きます。どちらでも言語を変更でき、接続コマンド、接続操作、技術情報は設定ページにまとめられています。

## ナビゲーション

- [できること](#できること)
- [言語切り替え](#言語切り替え)
- [ソースとサポート範囲](#ソースとサポート範囲)
- [インストールと接続](#インストールと接続)
- [初回利用と機能テスト](#初回利用と機能テスト)
- [出力ファイルとタスク状態](#出力ファイルとタスク状態)
- [MCP 呼び出し例](#mcp-呼び出し例)
- [よくある問題](#よくある問題)
- [アップグレード停止アンインストール](#アップグレード停止アンインストール)
- [開発とその他のドキュメント](#開発とその他のドキュメント)

## 言語切り替え

概要ページと設定ページでは「自動（ブラウザーの言語）」、中文、English、繁體中文、日本語、한국어を選べます。自動モードはブラウザーの言語優先順位を使用し、対応する言語がなければ英語になります。手動で指定した言語はこのコンピューターに保存され、ブラウザー言語より優先されます。「自動」を選び直すとブラウザー追従へ戻ります。

ページ内で言語を切り替えると、製品紹介、接続状態、インストール手順、コピー用の接続手順、使用例がすぐに切り替わります。Chrome の拡張機能管理ページに表示される description はブラウザーの言語に従うため、ウェルカムページ内の切り替えでは変更されません。

ブランド名 `Babel Content Downloader` は変わりません。コマンド、API／MCP 識別子、ファイル名、ダウンロードしたソースの原文は翻訳しません。技術エラーの原文は折りたたみ式の詳細に残され、CLI／MCP の技術出力も元の言語のままになる場合があります。

## できること

| やりたいこと | Agent への依頼例 | 保存タイプ |
|---|---|---|
| 記事をオフラインで読む | このリンクの本文と画像を保存して | `document` |
| 動画ポッドキャストを聴く | この動画を移動中に聴ける音声として保存して | `audio` |
| 動画をオフラインで見る | この動画を MP4 として保存して | `video` |
| 画像を収集する | このコンテンツの画像だけを保存して | `images` |
| 既存字幕を保存する | この動画の英語字幕を保存して | `subtitles` |
| 論文原文を読む | 論文情報と原版 PDF を保存して | `bundle` |
| 添付ファイルだけを保存する | このコンテンツでダウンロード可能なファイルを保存して | `files` |
| 主コンテンツに合わせて自動選択する | このリンクを保存して | `auto` |

音声の既定形式は M4A、動画の既定形式は MP4 です。MP3／WAV／FLAC、MKV、ソース画質、音声・動画区間、字幕言語、画像番号を明示指定できます。保存対象はソースコンテンツです。視聴用に音声抽出、音声・動画トラックの結合、形式変換は行えますが、OCR、音声文字起こし、要約、翻訳は内蔵していません。

通常のブログは HTTP + Mozilla Readability で現在のページを統一抽出し、必要な場合のみブラウザー読み取りへフォールバックします。ブログごとの本文セレクターは保守しません。動的なソーシャルメディア、論文、メディアコンテンツには対応するアダプターを使用します。明示された対象と対応リソースだけを処理し、サイト全体を再帰クロールしません。

タスクが新規作成したブラウザーページは、対象を開く前にミュートされます。バックグラウンド処理はプレーヤーを起動しません。ユーザーがもともと開いていたページを自動再生、ミュート、移動、終了することはありません。

## ソースとサポート範囲

以下は初回リリースにおける**実サンプルの検証状況**であり、各プラットフォームの全ページに対する互換性保証ではありません。サイト構造、地域、ネットワーク、アクセス状態によって結果は変わります。

| ソース | 既存サンプルの証拠／現在の範囲 |
|---|---|
| 一般公開ブログ、技術記事 | 現在のページを汎用抽出。URL、ネットワーク、アクセス方針の制約を受け、すべてのサイトを読めるという意味ではありません |
| Medium、Substack | 本文と画像の配信実績あり。Medium は汎用ブラウザーフォールバックと明示タブ読み取りを検証済み |
| OpenAI、Anthropic、Google DeepMind | 記事と画像の配信実績あり。DeepMind には publication PDF のサンプルもあり |
| GitHub | 公開リポジトリ README の配信実績あり。Markdown blob は現在 `ACCESS_UNCONFIRMED`。release などのルートは README の検証結果を継承しません |
| Hugging Face | model card、dataset card、paper のサンプルあり。blog には画像欠落を伴う部分完了結果あり。モデル重みやデータセット全体はダウンロードしません |
| arXiv | 要旨と原版 PDF の配信実績あり |
| YouTube、Bilibili | 音声・動画ファイルの配信と完全デコード検証あり。YouTube 英語字幕の VTT ファイルはありますが、サンプルタスクは引き続き `partial` |
| Zhihu | 公開記事と挿絵の配信実績あり |
| X | 表示本文の部分結果あり。画像、ページ読み込み、タイムアウトには未解決点あり |
| Reddit | 検証環境ではセキュリティ／ログインページに阻まれ、ファイル配信の完結実績なし |
| Xiaohongshu | 検証サンプルは 404／App ゲートに遭遇し、公開サンプルの完結実績なし |
| WeChat 公式アカウント | 対象ドリフトとアクセス制限があり、改善が必要 |

登録済みソースは 15 件で、さらにポリシーに合う一般公開ウェブページを抽出できます。Sohu、Kuaishou など削除済みのソースを汎用ウェブ入口から再び有効化することはありません。無料公開コンテンツだけを扱い、有料、非公開、DRM を迂回しません。詳しい制限は[初回リリース説明](../first-release.md)を参照してください。

## インストールと接続

本製品は「ローカルランタイム + ブラウザー拡張 + Agent MCP 接続」の組み合わせです。**拡張機能だけをインストールしてもダウンロードはできません。** 3 つは同じコンピューター上で動作します。

### 1. 環境とリリースファイルを準備する

- Node.js **22.13.0 以上**。ターミナルで `node` と `npm` を実行できること。
- Chrome **120 以上**。Edge など他の Chromium ブラウザーは環境ごとの追加検証が必要です。
- ローカル Agent。自動接続コマンドは Codex／Claude Code に対応し、それぞれの CLI が先に必要です。
- 音声・動画を保存する場合は `yt-dlp`、`ffmpeg`、`ffprobe` も必要です。基本的なウェブ抽出では不要です。
- 初回リリースの管理対象バックグラウンドサービスは macOS のみ実装済みです。Windows／Linux の正式インストール対応は未完了です。

リリース添付ファイル：

| ファイル | 用途 |
|---|---|
| `babel-content-downloader-0.1.26.tgz` | コンパイル済みランタイム。通常のユーザーはこれをインストール |
| `babel-content-downloader-extension-0.1.26.zip` | 正式拡張。展開して読み込む |
| `babel-content-downloader-source-0.1.26.zip` | 完全なソース。開発または自己ビルド用 |
| `SHA256SUMS`、`release-manifest.json`、`verification.json` | チェックサム、リリース一覧、検証記録 |

通常の利用者は Release から拡張機能 ZIP を直接ダウンロードでき、ソースパッケージの取得やビルドは不要です。[5 言語の拡張機能インストール手順](../extension-install.md)を参照してください。現在の Chrome では「展開してからパッケージ化されていない拡張機能を読み込む」必要があります。ワンクリック導入は Chrome Web Store 公開後に対応し、[リリースロードマップ](../release-roadmap.md)に登録済みです。

以下のコマンドは macOS のターミナルで実行します。`/absolute/path/...` を自分の**絶対パス**に置き換えてください。プレースホルダーをそのままコピーしないでください。新しいターミナルを開いた場合、例の変数を再設定する必要があります。

```sh
export BABEL_RELEASE_DIR=/absolute/path/to/release-files
cd "$BABEL_RELEASE_DIR"
shasum -a 256 -c SHA256SUMS

export BABEL_INSTALL_ROOT="$HOME/Applications/babel-content-downloader"
npm install --prefix "$BABEL_INSTALL_ROOT" --omit=dev "$BABEL_RELEASE_DIR/babel-content-downloader-0.1.26.tgz"
export BABEL_CLI="$BABEL_INSTALL_ROOT/node_modules/babel-content-downloader/dist/bootstrap/cli.js"
node "$BABEL_CLI" init
```

npm の既定の optional dependencies を残し、`--omit=optional` を付けないでください。画像処理には OS に対応するバイナリコンポーネントが必要です。TGZ はコンパイル済みなので、`npm run build` は不要です。全ファイルを検証する場合は、リリース一覧内の添付ファイルを同じディレクトリに置いてください。

### 2. 拡張機能を読み込む

ランタイムパッケージには ZIP と同一の正式拡張が含まれています。最も簡単なのは、これを直接読み込む方法です。

```sh
export BABEL_EXTENSION_DIR="$BABEL_INSTALL_ROOT/node_modules/babel-content-downloader/dist/extension"
printf '%s\n' "$BABEL_EXTENSION_DIR"
```

Chrome で `chrome://extensions` を開き、「デベロッパーモード」を有効にし、「パッケージ化されていない拡張機能を読み込む」を選択して、上記で出力されたディレクトリを指定します。正式拡張 ZIP を長期間保持するディレクトリへ展開し、その直下に `manifest.json` があるディレクトリを読み込むこともできます。**どちらか一方だけを使用し、重複して読み込まないでください。**

拡張バージョンが `0.1.26` であることを確認します。初回インストール時はウェルカムページが自動で開きます。閉じてしまった場合は、拡張管理画面で実際の 32 文字 ID をコピーし、Chrome のアドレスバーで `chrome-extension://実際の拡張ID/welcome/index.html` を開きます。ウェルカムページにも ID が表示されます。`dist/extension-dev` は開発用フィクスチャ版なので読み込まないでください。

### 3. 出力ディレクトリを許可して起動する

Codex を初めて使用する場合：

```sh
export BABEL_EXTENSION_ID=拡張画面に表示された32文字IDに置換
export BABEL_OUTPUT_ROOT="$HOME/Documents/BabelLibrary"
node "$BABEL_CLI" allow-extension "$BABEL_EXTENSION_ID"
node "$BABEL_CLI" add-client codex "$BABEL_OUTPUT_ROOT"
node "$BABEL_CLI" runtime-install
node "$BABEL_CLI" runtime-status
printf '資料の保存先：%s\n' "$BABEL_OUTPUT_ROOT"
```

最後に出力された資料ディレクトリの絶対パスを記録し、後で Agent に伝えます。各タスクが書き込めるのは、そのクライアントに許可されたディレクトリ内だけです。

`runtime-status` には `state: "running"`、`health: "ready"`、`loaded: true`、`restart_required: false` が表示される必要があります。その後、拡張の概要ページに戻って「ローカルランタイムに接続」をクリックし、「ローカルランタイムに接続済み」を確認します。一時停止した場合は設定ページで「再開」をクリックします。

すでにインストール済みの場合は先に[アップグレード説明](#アップグレード停止アンインストール)を確認し、`add-client` を繰り返さないでください。権限、ツールパス、クライアントを変更した後は `runtime-start` で設定を反映します。

### 4. Agent に接続する

Codex：

```sh
node "$BABEL_CLI" install-client-config codex
```

`waiting_client_reload` が返ったら Codex を再読み込みします。新しい会話で次のように依頼します。

> Babel Content Downloader の babel_content_check を呼び出して、ローカルランタイム、ブラウザー接続、メディア依存関係を確認し、現在利用できる機能を教えてください。

8 個の `babel_content_*` ツールが見つかる必要があります。ブラウザーが必要なタスクでは、対象拡張インスタンスが接続済みで一時停止していないことを確認します。一般 URL の本文チェックでは `ready_http`、`browser_required: false` が返ることがあります。これは直接取得を先に試せるという意味で、その後のネットワーク要求の成功を保証するものではありません。

Claude Code を使用する場合は、初回インストールの手順 3 で `codex` を `claude` に置き換え、`install-client-config claude` を実行します。既存ランタイムにクライアントを追加する場合は、次の順で実行します。

```sh
node "$BABEL_CLI" add-client claude "$BABEL_OUTPUT_ROOT"
node "$BABEL_CLI" runtime-start
node "$BABEL_CLI" install-client-config claude
```

Claude Code の再読み込み後にも実際にチェックツールを呼び出します。自動インストールが管理するのは本プロジェクトの MCP エントリーだけです。同名で本プロジェクトの管理外にある既存設定は上書きせず拒否します。

その他の stdio MCP クライアントでは、まず `add-client my-agent "$BABEL_OUTPUT_ROOT"` のように独立クライアントを登録してから `runtime-start` を実行します。クライアント MCP 設定は通常、次のような形です。外側の形式は各クライアントの要件に従ってください。

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

パスは実在する必要があります。JSON 内では `$HOME`、`~`、`$BABEL_CLI` は展開されません。設定にランタイムトークンを貼り付ける必要はありません。

### 5. 音声・動画ツールを準備する（必要な場合）

各ツールの公式配布元からメディア依存関係をインストールし、ターミナルで確認します。

```sh
yt-dlp --version
ffmpeg -version
ffprobe -version
```

ターミナルでは見つかるのにバックグラウンドサービスから見つからない場合は、実行ファイルのパスを明示登録します。

```sh
node "$BABEL_CLI" set-tool yt-dlp "$(command -v yt-dlp)"
node "$BABEL_CLI" set-tool ffmpeg "$(command -v ffmpeg)"
node "$BABEL_CLI" set-tool ffprobe "$(command -v ffprobe)"
node "$BABEL_CLI" runtime-start
```

その後 Agent に再チェックさせ、以前ブロックされたタスクを再開します。ツールが不足していても拡張機能を再インストールする必要はありません。

## 初回利用と機能テスト

インストール後の操作は、**拡張ページにダウンロードリンクを貼るのではなく、Agent との会話で行います**。拡張ページは接続、一時停止、取り消しを管理します。

記事、論文、音声・動画の順にテストすることを推奨します。以下のプロンプトをコピーし、`<記事URL>` などのプレースホルダーと `/あなたの絶対資料ディレクトリ` を実際の値に置き換えてください。ログイン不要でブラウザーから通常閲覧できる内容を選ぶことを推奨します。一時的なサイトアクセス失敗だけではインストール失敗とは判断できません。

### A. 記事を保存する

> Babel Content Downloader を使用して、この公開記事 `<記事URL>` の本文と画像を `/あなたの絶対資料ディレクトリ` に保存してください。document として保存し、タスク終了まで待ってから、タスク ID、実際の状態、本文パス、画像数、不足項目を返してください。提出済みとだけ報告しないでください。

確認：返された `content.md` を開き、本文が読め、画像がローカルファイルを参照し、`metadata.json` にソースがあることを確認します。`succeeded` の場合だけ依頼範囲が完了しています。`partial` の場合は不足項目も確認します。

### B. 論文と PDF を保存する

> Babel Content Downloader を使用して、この論文 `<arXiv要旨ページURL>` を bundle として `/あなたの絶対資料ディレクトリ` に保存し、論文情報と原版全文 PDF を含めてください。完了後、PDF パスと不足項目を返してください。

通常 `https://arxiv.org/abs/論文番号` の形式になっている論文要旨詳細ページを使用し、生の PDF URL をこのテストの入口にしないでください。確認時は実際に PDF を開きます。

### C. 動画ポッドキャストを音声として保存する

> Babel Content Downloader を使用して、この動画 `<YouTubeまたはBilibili動画URL>` を MP3 として `/あなたの絶対資料ディレクトリ` に保存してください。処理中はタスクページをミュートしたままにし、書き出したファイルを自動再生しないでください。終了後、音声パス、長さ、状態、不足項目を返してください。

確認：自分で MP3 を開き、音が出て長さが妥当であることを確認します。「ファイルが作成された」だけで実際の聴取確認を代替しないでください。

### D. 動画または区間を保存する

> Babel Content Downloader を使用して、`<動画URL>` の 60 秒から 120 秒までを MP4 として `/あなたの絶対資料ディレクトリ` に保存してください。完了後、ファイルパス、実際の長さ、状態を返し、自動再生はしないでください。

確認：ソース動画が 120 秒より長いこと、出力がおよそ 60 秒で映像と音声を正常に再生できることを確認します。720p を明示指定してソースに存在しない場合は不足として報告され、別画質へ自動変更されるとは限りません。

### E. 画像と字幕を保存する

> `<公開画像記事URL>` の画像を `/あなたの絶対資料ディレクトリ` に保存してください。画像だけを保存し、すべてのファイルパスと不足項目を返してください。

> `<YouTube動画URL>` の英語字幕を `/あなたの絶対資料ディレクトリ` に保存し、言語 en を指定してください。ソースに既存の字幕だけを保存し、音声文字起こしは行わず、実際のタスク状態と字幕ファイルパスを報告してください。

字幕はソースが対象言語を提供している必要があります。初回リリースでは字幕ファイルが利用可能でもタスクが `partial` のままになる既知の状況があり、これを隠してはいけません。字幕区間の切り抜きは未対応です。

### F. 進捗確認、再開、キャンセル

> Babel Content Downloader の最近のタスクを確認してください。タスク `<job_id>` の状態、失敗理由、保存済みファイルをすべて確認し、ファイルが多い場合は次のページも読み取ってください。

> 依存関係を追加／ブラウザー接続を復旧しました。重複タスクを新規作成せず、Babel Content Downloader タスク `<job_id>` を再開してください。

> Babel Content Downloader タスク `<job_id>` をキャンセルしてください。

`SELECTION_REQUIRED` が発生した場合は、Agent に返された「記事／動画／音声」などの選択肢を伝えるだけで、同じタスクが再開されます。タスクをキャンセルしても、すでに配信されたファイルは削除されません。

さらに詳しいテスト項目と結果記録テンプレートは[利用・テストガイド](../usage-guide.md)を参照してください。

## 出力ファイルとタスク状態

タスクは許可されたディレクトリ内に独自の結果ディレクトリを作成します。実際のファイル数と名前は `job_get` の戻り値を基準にしてください。例：

```text
BabelLibrary/
└── 記事または動画の結果ディレクトリ/
    ├── content.md       # タスク用途に応じた可読本文または資料入口
    ├── assets/          # 画像、音声、動画、字幕、PDF などの実ファイル
    ├── metadata.json   # ソース、コンテンツ情報、配信一覧、記録済みメディア処理情報
    └── assets.json     # リソース関連一覧
```

Markdown の画像は相対リンクです。資料を移動する場合は結果ディレクトリ全体を保持してください。`job_get` はファイルパス、サイズ、SHA256、ページ情報を返します。本文全体はローカルファイルにあり、MCP 応答へすべて埋め込みません。

| 状態 | 意味と次の手順 |
|---|---|
| `queued`／`resolving`／`collecting`／`downloading`／`finalizing`／`verifying` | キュー投入済みまたは処理中。ツールが返す間隔に従って再確認 |
| `succeeded` | 今回明示された依頼範囲が完了。成果物を開いて目的を満たすか確認 |
| `partial` | 結果はあるが依頼内容の一部が不足。`error`、`warnings`、失敗コンポーネントを確認 |
| `blocked` | 接続、依存関係、用途選択、自動再試行を待機。具体的な理由と `retry_at` を先に確認 |
| `failed` | 今回は未完了。エラーを確認し、回復可能な問題を解決してから再開 |
| `cancelled` | キャンセル済み。既存ファイルが残る場合があります |

## MCP 呼び出し例

以下は Agent またはクライアント開発者向けの **MCP ツール引数 JSON** です。ターミナルコマンドでも HTTP API リクエスト本文でもありません。一般ユーザーは上記の自然言語を使用できます。

`babel_content_collect` で本文を保存：

```json
{
  "target": { "type": "url", "url": "https://example.org/articles/my-article" },
  "save_as": "document",
  "output": { "directory": "/absolute/path/to/authorized/materials" }
}
```

`example.org` は形式例です。テスト時は実際にアクセス可能な記事へ置き換えてください。MP3 音声区間を抽出：

```json
{
  "target": { "type": "url", "url": "https://www.youtube.com/watch?v=REPLACE_WITH_VIDEO_ID" },
  "save_as": "audio",
  "preferences": { "audio_format": "mp3", "clip": { "start_seconds": 60, "end_seconds": 120 } },
  "output": { "directory": "/absolute/path/to/authorized/materials" }
}
```

提出後に返された `job_id` を使って `babel_content_job_get` を呼び出します。

```json
{ "job_id": "実際のjob_idに置換", "artifact_offset": 0, "artifact_limit": 50 }
```

`artifact_page.next_offset` が空でない場合は、その値で続きを読み取ります。`collect` が返した `queued` をダウンロード完了と解釈しないでください。

| ツール | 用途 |
|---|---|
| `babel_content_check` | ランタイム、対象ルート、拡張、依存関係を確認。`target` と `save_as` を指定可能 |
| `babel_content_collect` | 明示された 1 件の URL またはタブのタスクを作成 |
| `babel_content_job_get` | 状態、不足項目、ページ分割されたファイルを取得 |
| `babel_content_job_resume` | 再開。用途選択の `save_as` または同一内容の新しい `refreshed_url` を指定可能 |
| `babel_content_job_cancel` | タスクをキャンセル |
| `babel_content_jobs_list` | 現在のクライアントのタスクを `offset`／`limit` 付きで表示 |
| `babel_content_browser_observe` | 指定 `job_id` のページを観察 |
| `babel_content_browser_act` | タスク権限内で許可されたスクロール、展開、ミュート再生などを実行 |

`save_as` と `include` は同時に使用できません。`include` には `text`、`images`、`video`、`audio`、`subtitles`、`cover`、`files` を指定できます。その他の設定やタブ例は[利用・テストガイド](../usage-guide.md)を参照してください。

## よくある問題

| 症状 | 対処方法 |
|---|---|
| Agent がツールを見つけられない | 対応 CLI のインストールを確認し、`client-config-status codex` を確認。Agent を再読み込みして実際にチェックツールを呼び出す |
| 拡張に「ローカル認証を待機中」と表示される | 実際の拡張 ID を確認し、`allow-extension` の後に `runtime-start` を実行して、ウェルカムページで再接続 |
| `waiting_browser` または拡張が一時停止中 | Chrome を起動したまま拡張で接続／再開。全体接続だけでなく、タスクに結び付いたインスタンスを確認 |
| バージョンが古いまま | ビルドだけでは Chrome は自動再読み込みしません。読み込みディレクトリを確認し、拡張管理画面で再読み込みを一度押して、ウェルカムページのバージョンを確認 |
| `CLIENT_ALREADY_EXISTS` | クライアントはすでに許可済みです。再登録や旧権限削除をせず、現在の設定とランタイム状態を確認 |
| ポートが使用中 | 使用プロセスを先に特定。手動 `serve` と管理サービスは同じポートを同時利用できません。他サービスを闇雲に終了しない |
| 出力ディレクトリが拒否される | `add-client` で許可したルート内の絶対パスを使用。チャット内の文言でディレクトリ権限は拡張できません |
| メディア依存関係がない | 上記の方法でインストールして `set-tool` で登録。ランタイム再起動後に元のタスクを再開 |
| `ACCESS_UNCONFIRMED`／`ACCESS_NOT_PUBLIC` | 現在のページを公開と確認できないか、アクセスゲートに遭遇。リンクとプラットフォーム制限を確認し、エラーページを成功扱いしない |
| `ADAPTER_CHANGED`／`CONTENT_SCRIPT_TIMEOUT` | ページ構造または読み込み状態が変化した可能性あり。エラーとタスク ID を保持し、反復ダウンロードだけで成功を保証しない |
| `PRIVATE_ADDRESS_BLOCKED` | DNS が予約／プライベートアドレスを返しています。ローカルネットワーク設定を確認。ランタイムは内部アドレスを許可しません。任意 DNS 設定はランタイム文書を参照 |
| ファイルはあるが `partial` | 実際の不足項目を確認。画像、全文、字幕、ソース完全性の証明が不足している可能性があり、既存の利用可能ファイルは先に使用できます |
| ブログにナビゲーション／関連記事が含まれる、または日付が空 | 汎用抽出では追加の可読領域を保持する場合があります。公開日を確定できない場合は空を許容します |

ローカル設定の既定パスは `~/.config/babel-content-downloader/config.json`、タスク記録は `~/.local/share/babel-content-downloader/jobs/` です。設定にはクライアント認証情報が含まれるため、公開 Issue やソースパッケージへ添付しないでください。フィードバックでは、バージョン、プラットフォーム、タスク状態、エラーコード、機密パラメーターを除いたリンクだけを提供してください。

## アップグレード停止アンインストール

アップグレード前に、処理中のタスクを終了またはキャンセルします。設定、タスクディレクトリ、ダウンロード済みファイルを保持し、サービス入口パスを変えないよう、元の安定したインストールディレクトリでランタイムパッケージを更新します。コマンドのバージョンファイル名を実際の新しいパッケージに置き換えます。

```sh
node "$BABEL_CLI" runtime-stop
npm install --prefix "$BABEL_INSTALL_ROOT" --omit=dev "$BABEL_RELEASE_DIR/babel-content-downloader-0.1.26.tgz"
node "$BABEL_CLI" runtime-start
node "$BABEL_CLI" runtime-status
```

Chrome で同じ拡張ディレクトリの「再読み込み」を押し、バージョンと接続を再確認します。独立 ZIP から読み込んだ場合は、元の展開ディレクトリを更新します。ディレクトリ変更によって ID が変わった場合は、新しい実 ID を許可してランタイムを再起動する必要があります。`add-client` を再実行しないでください。

以前にソースディレクトリ、手動 `serve`、別の設定ファイルを使っていた場合は、同じ設定と元の入口を継続使用し、[ランタイム文書](../runtime-setup.md)に従って移行してください。上記の新規 TGZ インストールパスを既存サービスのパスとしてそのまま置き換えることはできません。

拡張だけを一時停止する場合は、設定ページの「一時停止」をクリックします。一時停止は、開始済みタスクをすべてキャンセルする操作ではありません。本プロジェクトのバックグラウンドサービスを管理するには：

```sh
node "$BABEL_CLI" runtime-stop
node "$BABEL_CLI" runtime-start
```

Codex 接続と本プロジェクトのバックグラウンドサービスを削除するには：

```sh
node "$BABEL_CLI" remove-client-config codex
node "$BABEL_CLI" remove-client codex
node "$BABEL_CLI" runtime-uninstall
```

これらの手順は同一ランタイムの他クライアントへ影響する可能性があります。1 クライアントだけを無効化する場合はバックグラウンドサービスを残し、権限変更の適用のため再起動します。拡張は設定ページで接続を取り消した後、Chrome から削除できます。上記コマンドは収集済み資料を削除しません。インストールディレクトリを削除する前にバックグラウンドサービスをアンインストールしてください。

## 開発とその他のドキュメント

リポジトリまたはソース ZIP からビルド：

```sh
npm ci
npm run typecheck
npm test -- --maxWorkers=2
npm run build
```

その後 `dist/bootstrap/cli.js` を入口、`dist/extension` を正式拡張として、上記と同じ方法で許可・接続します。音声・動画テストにはローカル FFmpeg が必要です。`npm run lsp` には別途 `typescript-language-server` が必要です。テストフィクスチャは実ウェブサイト検証の代わりにはなりません。

履歴上の 0.1.25 コードベースラインでは 43 テストファイル、340 テストが成功しました。ランタイム TGZ の独立インストールと 8 個の MCP ツール検証も成功し、ソース ZIP から再ビルドした 60 個の生成ファイルは配布ビルドとバイト単位で一致しました。実ブラウザーのベースラインは 0.1.24 です。0.1.25 で追加されたメディア処理メタデータと記事日付修正について、パッケージ検証だけではユーザーが新バージョンを再読み込みしたことを証明しません。0.1.26 の現在の検証結果は、リリースに同梱された `verification.json` を確認してください。

- [利用・テストガイド](../usage-guide.md)：追加パラメーター、段階的テスト、フィードバックテンプレート。
- [初回インストールと制限](../first-release.md)、[ランタイム設定](../runtime-setup.md)、[Agent 接続](../agent-setup.md)。
- [公開作業チェックリストとリリースノート](../publishing.md)：メンテナーがソースと添付ファイルをアップロードするときに使用。
- [CHANGELOG](../../CHANGELOG.md)、[実装記録](../implementation-status.md)、[プラットフォーム履歴検証](../platform-status.md)、[汎用ウェブ検証](../unified-web-validation.md)。履歴中の旧バージョン結果は現在のサポート範囲を置き換えません。
- [製品 Spec](../specs/Babel_Content_Downloader_内容收集与使用契约_2026-09-18.md)、[LICENSE](../../LICENSE)、[第三者依存関係](../../THIRD_PARTY.md)。

ソースコードは MIT ライセンスです。第三者依存関係とダウンロードコンテンツの権利は、それぞれの権利者に帰属します。ソースの利用規約と自身の権限に従って保存資料を使用してください。
