# Browser extension installation / 浏览器扩展安装

Version: **0.1.26**

[English](#english) · [简体中文](#简体中文) · [繁體中文](#繁體中文) · [日本語](#日本語) · [한국어](#한국어)

## English

Download `babel-content-downloader-extension-0.1.26.zip` directly from the Release attachments. You do not need the source ZIP to install the extension.

1. Unzip it into a stable directory. Its root must directly contain `manifest.json`.
2. Open `chrome://extensions` in Chrome 120 or newer.
3. Enable **Developer mode**, choose **Load unpacked**, and select that directory.
4. Confirm that **Babel Content Downloader 0.1.26** appears, then open its welcome page.

The interface follows the browser's ordered language preferences by default and falls back to English when none is supported. You can choose a language manually or select **Automatic (browser language)** to resume automatic matching.

Chrome does not install an arbitrary off-store ZIP directly. A true one-click installation requires a Chrome Web Store release, which is tracked in the project roadmap. The extension UI can be loaded from this ZIP, but actual collection also requires the matching runtime TGZ and Agent connection described in the README.

## 简体中文

直接从 Release 附件下载 `babel-content-downloader-extension-0.1.26.zip`。安装扩展不需要下载源码 ZIP。

1. 把 ZIP 解压到一个长期保留的目录，目录根部应直接看到 `manifest.json`。
2. 在 Chrome 120 或以上版本打开 `chrome://extensions`。
3. 开启“开发者模式”，点击“加载已解压的扩展程序”，选择上述目录。
4. 确认出现 **Babel Content Downloader 0.1.26**，再打开欢迎页完成接入。

界面默认按浏览器语言的优先顺序自动匹配；没有支持的语言时使用英文。你也可以手动选择语言，或选择“自动（跟随浏览器）”恢复自动匹配。

Chrome 不能直接安装任意站外 ZIP。真正的一键安装需要发布到 Chrome Web Store，这项工作已列入路线图。扩展界面可以直接从本 ZIP 加载，但实际采集还需要同版本运行时 TGZ 和 README 中的 Agent 接入步骤。

## 繁體中文

直接從 Release 附件下載 `babel-content-downloader-extension-0.1.26.zip`，安裝擴充功能不需要下載原始碼 ZIP。

1. 將 ZIP 解壓縮至長期保留的目錄；目錄根層應直接包含 `manifest.json`。
2. 在 Chrome 120 或以上版本開啟 `chrome://extensions`。
3. 開啟「開發人員模式」，按「載入未封裝項目」，選取上述目錄。
4. 確認出現 **Babel Content Downloader 0.1.26**，再開啟歡迎頁完成連線。

介面預設依瀏覽器語言的優先順序自動比對；沒有支援的語言時使用英文。你也可以手動選擇語言，或選擇「自動（跟隨瀏覽器）」恢復自動比對。

Chrome 無法直接安裝任意非商店 ZIP。真正的一鍵安裝需要發佈至 Chrome Web Store，此項目已列入路線圖。擴充功能介面可直接從此 ZIP 載入，但實際收集仍需同版本執行環境 TGZ 與 README 中的 Agent 連線步驟。

## 日本語

Release の添付ファイルから `babel-content-downloader-extension-0.1.26.zip` を直接ダウンロードしてください。拡張機能の導入にソース ZIP は不要です。

1. ZIP を今後も保持するフォルダーへ展開します。フォルダー直下に `manifest.json` が必要です。
2. Chrome 120 以降で `chrome://extensions` を開きます。
3. **デベロッパー モード**を有効にし、**パッケージ化されていない拡張機能を読み込む**から上記フォルダーを選びます。
4. **Babel Content Downloader 0.1.26** が表示されたことを確認し、ようこそページを開いて接続します。

画面はブラウザーの言語設定の優先順に従って自動的に切り替わり、対応する言語がない場合は英語を使用します。言語を手動で選ぶことも、**自動（ブラウザーの言語）**を選んで自動判定に戻すこともできます。

Chrome はストア外の任意の ZIP をそのままインストールできません。ワンクリック導入には Chrome Web Store での公開が必要で、ロードマップに登録済みです。拡張機能の画面はこの ZIP から読み込めますが、実際の収集には同じバージョンのランタイム TGZ と README の Agent 接続も必要です。

## 한국어

Release 첨부 파일에서 `babel-content-downloader-extension-0.1.26.zip`을 바로 다운로드하세요. 확장 프로그램 설치에 소스 ZIP은 필요하지 않습니다.

1. ZIP을 계속 유지할 폴더에 압축 해제합니다. 폴더 최상위에 `manifest.json`이 바로 있어야 합니다.
2. Chrome 120 이상에서 `chrome://extensions`를 엽니다.
3. **개발자 모드**를 켜고 **압축해제된 확장 프로그램을 로드합니다**를 선택한 뒤 위 폴더를 지정합니다.
4. **Babel Content Downloader 0.1.26**이 표시되는지 확인하고 시작 페이지에서 연결을 완료합니다.

화면은 기본적으로 브라우저 언어의 우선순서에 따라 자동으로 전환되며 지원 언어가 없으면 영어를 사용합니다. 언어를 직접 선택하거나 **자동(브라우저 언어)**을 선택해 자동 감지로 돌아갈 수 있습니다.

Chrome은 스토어 밖의 임의 ZIP을 그대로 설치할 수 없습니다. 진정한 원클릭 설치에는 Chrome Web Store 배포가 필요하며 프로젝트 로드맵에 등록되어 있습니다. 확장 프로그램 화면은 이 ZIP에서 바로 불러올 수 있지만 실제 수집에는 같은 버전의 런타임 TGZ와 README의 Agent 연결도 필요합니다.
