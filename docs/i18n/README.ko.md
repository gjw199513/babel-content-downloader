<p align="center"><img src="../brand/logo-preview.png" alt="Babel Content Downloader Logo" width="128" height="128"></p>

<p align="center">
  <a href="../../README.md">中文</a> ·
  <a href="README.en.md">English</a> ·
  <a href="README.zh-TW.md">繁中</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md"><strong>한국어</strong></a>
</p>

# Babel Content Downloader

로컬 AI Agent가 공개 웹페이지, 글, 논문, 동영상, 팟캐스트를 읽고 보고 들을 수 있는 로컬 자료로 저장하도록 합니다.

**현재 버전: 0.1.26 · MIT 오픈 소스 · 최초 릴리스 권장 환경: macOS + Chrome + 로컬 MCP Agent.**

**[v0.1.26 릴리스 첨부 파일 다운로드](https://github.com/gjw199513/babel-content-downloader/releases/tag/v0.1.26)**: 일반 사용자는 런타임 TGZ와 확장 프로그램 ZIP을 사용합니다. 확장 프로그램 설치에 소스 아카이브는 필요하지 않습니다.

Agent에게 링크와 저장하려는 내용을 알려 주기만 하면 됩니다. 예: “이 동영상 팟캐스트를 오디오로 저장해서 내 학습 자료 폴더에 넣어 줘.” 다운로더가 콘텐츠 가져오기, 파일 저장, 결과 보고를 담당하므로 오디오 트랙이나 코덱을 먼저 이해할 필요가 없습니다.


도구 모음의 확장 프로그램 아이콘은 넓은 개요 페이지를 열고 확장 프로그램 세부 정보의 옵션은 별도 설정 페이지를 엽니다. 두 페이지에서 모두 언어를 바꿀 수 있으며 연결 명령, 연결 관리, 기술 정보는 설정 페이지에 모여 있습니다.

## 탐색

- [할 수 있는 일](#할-수-있는-일)
- [언어 전환](#언어-전환)
- [소스와 지원 범위](#소스와-지원-범위)
- [설치와 연결](#설치와-연결)
- [첫 사용과 기능 테스트](#첫-사용과-기능-테스트)
- [출력 파일과 작업 상태](#출력-파일과-작업-상태)
- [MCP 호출 예시](#mcp-호출-예시)
- [자주 발생하는 문제](#자주-발생하는-문제)
- [업그레이드-중지-제거](#업그레이드-중지-제거)
- [개발과 기타 문서](#개발과-기타-문서)

## 언어 전환

개요 페이지와 설정 페이지에서 **자동（브라우저 언어）**, 中文, English, 繁體中文, 日本語, 한국어를 선택할 수 있습니다. 자동 모드는 브라우저의 언어 우선순위를 사용하고 지원되는 언어가 없으면 영어로 표시합니다. 직접 지정한 언어는 이 컴퓨터에 저장되어 브라우저 언어보다 우선하며, 다시 자동을 선택하면 브라우저를 따릅니다.

페이지 안에서 언어를 바꾸면 제품 소개, 연결 상태, 설치 안내, 복사용 연결 안내, 사용 예시가 즉시 번역됩니다. Chrome 확장 프로그램 관리 페이지에 표시되는 description은 브라우저 언어를 따르므로 환영 페이지 안의 언어 전환으로 바뀌지 않습니다.

브랜드 이름 `Babel Content Downloader`는 바뀌지 않습니다. 명령, API／MCP 식별자, 파일명, 다운로드한 소스 원문은 번역하지 않습니다. 기술 오류 원문은 접을 수 있는 상세 정보에 보존되며 CLI／MCP 기술 출력도 원래 언어로 남을 수 있습니다.

## 할 수 있는 일

| 하고 싶은 일 | Agent에게 말하는 방법 | 저장 유형 |
|---|---|---|
| 글을 오프라인으로 읽기 | 이 링크의 본문과 이미지를 저장해 줘 | `document` |
| 동영상 팟캐스트 듣기 | 이동 중에 들을 수 있도록 이 동영상을 오디오로 저장해 줘 | `audio` |
| 동영상 오프라인 시청 | 이 동영상을 MP4로 저장해 줘 | `video` |
| 이미지 수집 | 이 콘텐츠의 이미지만 저장해 줘 | `images` |
| 기존 자막 저장 | 이 동영상의 영어 자막을 저장해 줘 | `subtitles` |
| 논문 원문 읽기 | 논문 정보와 원본 PDF를 저장해 줘 | `bundle` |
| 첨부 파일만 저장 | 이 콘텐츠에서 다운로드할 수 있는 파일을 저장해 줘 | `files` |
| 주 콘텐츠에 따라 자동 선택 | 이 링크를 저장해 줘 | `auto` |

기본 오디오 형식은 M4A, 기본 동영상 형식은 MP4입니다. MP3／WAV／FLAC, MKV, 소스 화질, 오디오·동영상 구간, 자막 언어, 이미지 번호를 명시할 수 있습니다. 소스 콘텐츠를 저장하며, 시청과 청취를 위해 오디오 추출, 오디오·비디오 트랙 병합, 형식 변환을 수행할 수 있습니다. OCR, 음성 전사, 요약, 번역은 내장하지 않습니다.

일반 블로그는 HTTP + Mozilla Readability로 현재 페이지를 통합 추출하고, 필요할 때 브라우저 읽기로 대체합니다. 블로그마다 본문 선택자를 따로 유지하지 않습니다. 동적 소셜 미디어, 논문, 미디어 콘텐츠는 해당 어댑터를 사용합니다. 명시한 대상과 지원되는 리소스만 처리하며 사이트 전체를 재귀적으로 크롤링하지 않습니다.

작업이 새로 만든 브라우저 페이지는 대상을 열기 전에 음소거됩니다. 백그라운드 처리는 플레이어를 실행하지 않습니다. 사용자가 원래 열어 둔 페이지를 자동 재생, 음소거, 이동 또는 닫지 않습니다.

## 소스와 지원 범위

아래 내용은 최초 릴리스의 **실제 샘플 검증 상황**이며 플랫폼의 모든 페이지에 대한 호환성 보장이 아닙니다. 사이트 구조, 지역, 네트워크, 접근 상태에 따라 결과가 달라질 수 있습니다.

| 소스 | 기존 샘플 근거／현재 범위 |
|---|---|
| 일반 공개 블로그, 기술 글 | 현재 페이지 범용 추출. URL, 네트워크, 접근 정책의 제약을 받으며 모든 사이트를 읽을 수 있다는 뜻이 아님 |
| Medium, Substack | 본문과 이미지 전달 사례 있음. Medium은 범용 브라우저 대체 경로와 명시적 탭 읽기 검증 완료 |
| OpenAI, Anthropic, Google DeepMind | 글과 이미지 전달 사례 있음. DeepMind에는 publication PDF 샘플도 있음 |
| GitHub | 공개 저장소 README 전달 사례 있음. Markdown blob은 현재 `ACCESS_UNCONFIRMED`이며 release 등의 경로가 README 검증 결과를 상속하지 않음 |
| Hugging Face | model card, dataset card, paper 샘플 있음. blog에는 이미지 누락이 있는 부분 완료 결과가 있음. 모델 가중치 전체나 데이터셋 전체를 다운로드하지 않음 |
| arXiv | 초록과 원본 PDF 전달 사례 있음 |
| YouTube, Bilibili | 오디오·동영상 파일 전달과 전체 디코딩 검증 사례 있음. YouTube 영어 자막 VTT 파일이 있지만 샘플 작업 상태는 여전히 `partial` |
| Zhihu | 공개 글과 삽화 전달 사례 있음 |
| X | 표시된 본문의 부분 결과가 있으나 이미지, 페이지 로딩, 시간 초과 문제가 남아 있음 |
| Reddit | 테스트 환경에서 보안／로그인 페이지에 차단되어 파일 전달이 끝까지 완료된 사례 없음 |
| Xiaohongshu | 테스트 샘플이 404／앱 게이트에 걸려 공개 샘플 완료 사례 없음 |
| WeChat 공식 계정 | 대상 드리프트와 접근 제한이 있어 개선 필요 |

등록된 소스는 15개이며 정책에 맞는 일반 공개 웹페이지도 추출할 수 있습니다. Sohu, Kuaishou 등 제거된 소스가 범용 웹 진입점을 통해 다시 활성화되지는 않습니다. 무료 공개 콘텐츠만 처리하며 유료, 비공개 콘텐츠 또는 DRM을 우회하지 않습니다. 구체적인 제한은 [최초 릴리스 안내](../first-release.md)를 참조하세요.

## 설치와 연결

이 제품은 “로컬 런타임 + 브라우저 확장 프로그램 + Agent MCP 연결”로 구성됩니다. **확장 프로그램만 설치해서는 다운로드할 수 없습니다.** 세 구성 요소는 같은 컴퓨터에서 실행됩니다.

### 1. 환경과 릴리스 파일 준비

- Node.js **22.13.0 이상**, 터미널에서 `node`, `npm`을 실행할 수 있어야 합니다.
- Chrome **120 이상**. Edge 등 다른 Chromium 브라우저는 별도 환경 검증이 필요합니다.
- 로컬 Agent. 자동 연결 명령은 Codex／Claude Code를 지원하며 해당 CLI가 먼저 설치되어 있어야 합니다.
- 오디오·동영상 저장에는 `yt-dlp`, `ffmpeg`, `ffprobe`가 추가로 필요합니다. 기본 웹 추출에는 이 미디어 도구가 필요하지 않습니다.
- 최초 릴리스의 관리형 백그라운드 서비스는 macOS에만 구현되어 있습니다. Windows／Linux 정식 설치 지원은 아직 완료되지 않았습니다.

릴리스 첨부 파일:

| 파일 | 용도 |
|---|---|
| `babel-content-downloader-0.1.26.tgz` | 컴파일된 런타임. 일반 사용자는 이것을 설치 |
| `babel-content-downloader-extension-0.1.26.zip` | 정식 확장 프로그램. 압축 해제 후 로드 |
| `babel-content-downloader-source-0.1.26.zip` | 전체 소스. 개발 또는 직접 빌드용 |
| `SHA256SUMS`, `release-manifest.json`, `verification.json` | 체크섬, 릴리스 목록, 검증 기록 |

일반 사용자는 Release에서 확장 프로그램 ZIP을 바로 다운로드할 수 있으며 소스 패키지를 받거나 빌드할 필요가 없습니다. [5개 언어 확장 프로그램 설치 안내](../extension-install.md)를 참고하세요. 현재 Chrome에서는 “압축 해제 후 압축해제된 확장 프로그램 로드”가 필요합니다. 진정한 원클릭 설치는 향후 Chrome Web Store 배포로 제공하며 [릴리스 로드맵](../release-roadmap.md)에 등록되어 있습니다.

다음 명령은 macOS 터미널에서 실행합니다. `/absolute/path/...`를 자신의 **절대 경로**로 바꾸고 자리 표시자를 그대로 복사하지 마세요. 새 터미널을 열면 예시에 나온 변수를 다시 설정해야 합니다.

```sh
export BABEL_RELEASE_DIR=/absolute/path/to/release-files
cd "$BABEL_RELEASE_DIR"
shasum -a 256 -c SHA256SUMS

export BABEL_INSTALL_ROOT="$HOME/Applications/babel-content-downloader"
npm install --prefix "$BABEL_INSTALL_ROOT" --omit=dev "$BABEL_RELEASE_DIR/babel-content-downloader-0.1.26.tgz"
export BABEL_CLI="$BABEL_INSTALL_ROOT/node_modules/babel-content-downloader/dist/bootstrap/cli.js"
node "$BABEL_CLI" init
```

npm의 기본 optional dependencies를 유지하고 `--omit=optional`을 추가하지 마세요. 이미지 처리에는 운영체제에 맞는 바이너리 구성 요소가 필요합니다. TGZ는 이미 컴파일되어 있으므로 `npm run build`를 실행할 필요가 없습니다. 모든 파일을 검증하려면 릴리스 목록의 첨부 파일을 같은 디렉터리에 준비하세요.

### 2. 확장 프로그램 로드

런타임 패키지에는 ZIP과 동일한 정식 확장 프로그램이 들어 있습니다. 가장 간단한 방법은 이를 직접 로드하는 것입니다.

```sh
export BABEL_EXTENSION_DIR="$BABEL_INSTALL_ROOT/node_modules/babel-content-downloader/dist/extension"
printf '%s\n' "$BABEL_EXTENSION_DIR"
```

Chrome에서 `chrome://extensions`를 열고 “개발자 모드”를 켠 다음 “압축 해제된 확장 프로그램을 로드합니다”를 선택하여 위에서 출력한 디렉터리를 지정합니다. 정식 확장 ZIP을 장기간 유지할 디렉터리에 풀고 그 안에서 `manifest.json`을 직접 포함한 디렉터리를 로드해도 됩니다. **두 방법 중 하나만 사용하고 중복 로드하지 마세요.**

확장 버전이 `0.1.26`인지 확인합니다. 처음 설치하면 환영 페이지가 자동으로 열립니다. 닫았다면 확장 관리 페이지에서 실제 32자 ID를 복사하고 Chrome 주소창에서 `chrome-extension://실제확장ID/welcome/index.html`을 엽니다. 환영 페이지에도 ID가 표시됩니다. `dist/extension-dev`는 개발용 픽스처 버전이므로 로드하지 마세요.

### 3. 출력 디렉터리 승인과 시작

Codex를 처음 사용하는 경우:

```sh
export BABEL_EXTENSION_ID=확장페이지에표시된32자ID로교체
export BABEL_OUTPUT_ROOT="$HOME/Documents/BabelLibrary"
node "$BABEL_CLI" allow-extension "$BABEL_EXTENSION_ID"
node "$BABEL_CLI" add-client codex "$BABEL_OUTPUT_ROOT"
node "$BABEL_CLI" runtime-install
node "$BABEL_CLI" runtime-status
printf '자료 저장 디렉터리: %s\n' "$BABEL_OUTPUT_ROOT"
```

마지막에 출력된 절대 자료 디렉터리를 기록하고 나중에 Agent에게 알려 주세요. 각 작업은 해당 클라이언트가 승인받은 디렉터리 안에만 쓸 수 있습니다.

`runtime-status`에는 `state: "running"`, `health: "ready"`, `loaded: true`, `restart_required: false`가 표시되어야 합니다. 그런 다음 확장 개요 페이지로 돌아가 “로컬 런타임에 연결”을 누르고 “로컬 런타임에 연결됨”을 확인합니다. 일시 중지한 적이 있다면 설정 페이지에서 “재개”를 누릅니다.

이미 설치한 사용자는 먼저 [업그레이드 안내](#업그레이드-중지-제거)를 읽고 `add-client`를 반복 실행하지 마세요. 권한, 도구 경로, 클라이언트를 변경한 후에는 `runtime-start`로 설정을 적용합니다.

### 4. Agent 연결

Codex:

```sh
node "$BABEL_CLI" install-client-config codex
```

`waiting_client_reload`가 반환되면 Codex를 다시 로드합니다. 새 대화에서 다음과 같이 요청하세요.

> Babel Content Downloader의 babel_content_check를 호출해 로컬 런타임, 브라우저 연결, 미디어 의존성을 점검하고 현재 사용할 수 있는 기능을 알려 주세요.

8개의 `babel_content_*` 도구를 찾을 수 있어야 합니다. 브라우저가 필요한 작업은 대상 확장 인스턴스가 연결되어 있고 일시 중지되지 않았는지 확인해야 합니다. 일반 URL 본문 검사에는 `ready_http`, `browser_required: false`가 반환될 수 있습니다. 이는 먼저 직접 가져오기를 시도할 수 있다는 뜻이며 뒤이은 네트워크 요청의 성공을 보장하지는 않습니다.

Claude Code를 사용할 때는 최초 설치의 3단계에서 `codex`를 `claude`로 바꾸고 `install-client-config claude`를 실행합니다. 기존 런타임에 클라이언트를 추가한다면 다음 순서대로 실행합니다.

```sh
node "$BABEL_CLI" add-client claude "$BABEL_OUTPUT_ROOT"
node "$BABEL_CLI" runtime-start
node "$BABEL_CLI" install-client-config claude
```

Claude Code를 다시 로드한 뒤에도 실제 검사 도구를 호출하세요. 자동 설치는 이 프로젝트의 MCP 항목만 관리합니다. 같은 이름의 기존 설정이 이 프로젝트가 관리하는 항목이 아니면 덮어쓰지 않고 거부합니다.

다른 stdio MCP 클라이언트는 먼저 `add-client my-agent "$BABEL_OUTPUT_ROOT"`처럼 독립 클라이언트를 등록한 후 `runtime-start`를 실행합니다. 클라이언트 MCP 설정은 보통 다음과 같은 모양이며 바깥쪽 형식은 각 클라이언트 요구에 맞추세요.

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

경로는 실제로 존재해야 합니다. JSON에서는 `$HOME`, `~`, `$BABEL_CLI`가 확장되지 않습니다. 설정에 런타임 토큰을 붙여 넣을 필요가 없습니다.

### 5. 오디오·동영상 도구 준비(필요할 때)

각 도구의 공식 배포 경로에서 미디어 의존성을 설치한 뒤 터미널에서 확인합니다.

```sh
yt-dlp --version
ffmpeg -version
ffprobe -version
```

터미널에서는 찾을 수 있지만 백그라운드 서비스에서 찾지 못하면 실행 파일의 실제 경로를 명시적으로 등록합니다.

```sh
node "$BABEL_CLI" set-tool yt-dlp "$(command -v yt-dlp)"
node "$BABEL_CLI" set-tool ffmpeg "$(command -v ffmpeg)"
node "$BABEL_CLI" set-tool ffprobe "$(command -v ffprobe)"
node "$BABEL_CLI" runtime-start
```

그다음 Agent에게 다시 점검하게 하고 이전에 차단된 작업을 재개합니다. 도구가 없다고 확장 프로그램을 다시 설치할 필요는 없습니다.

## 첫 사용과 기능 테스트

설치 후에는 **확장 페이지에 다운로드 링크를 붙여 넣지 말고 Agent 대화에서 작업합니다.** 확장 페이지는 연결, 일시 중지, 연결 취소를 담당합니다.

글, 논문, 오디오·동영상 순서로 테스트하기를 권장합니다. 아래 프롬프트를 복사하고 `<글URL>` 같은 자리 표시자와 `/내절대자료디렉터리`를 실제 값으로 바꾸세요. 로그인이 필요 없고 브라우저에서 정상적으로 읽을 수 있는 콘텐츠를 권장합니다. 사이트의 일시적인 접근 실패만으로 설치 실패를 뜻하지는 않습니다.

### A. 글 저장

> Babel Content Downloader를 사용하여 이 공개 글 `<글URL>`의 본문과 이미지를 `/내절대자료디렉터리`에 저장해 주세요. document로 저장하고 작업이 끝날 때까지 기다린 뒤 작업 ID, 실제 상태, 본문 경로, 이미지 수, 누락 항목을 반환하세요. 제출했다는 말만 하지 마세요.

검수: 반환된 `content.md`를 열어 본문을 읽을 수 있고 이미지가 로컬 파일을 가리키며 `metadata.json`에 소스가 있는지 확인합니다. `succeeded`만 요청 범위가 완료되었다는 뜻입니다. `partial`이면 누락 항목도 함께 확인합니다.

### B. 논문과 PDF 저장

> Babel Content Downloader를 사용하여 이 논문 `<arXiv초록페이지URL>`을 bundle로 `/내절대자료디렉터리`에 저장하고 논문 정보와 원본 전체 PDF를 포함해 주세요. 완료 후 PDF 경로와 누락 항목을 알려 주세요.

보통 `https://arxiv.org/abs/논문번호` 형식인 논문 초록 상세 페이지를 사용하고 원시 PDF 주소를 이 테스트의 진입점으로 사용하지 마세요. 검수할 때 실제로 PDF를 엽니다.

### C. 동영상 팟캐스트를 오디오로 저장

> Babel Content Downloader를 사용하여 이 동영상 `<YouTube또는Bilibili동영상URL>`을 MP3로 `/내절대자료디렉터리`에 저장해 주세요. 처리 중 작업 페이지를 음소거 상태로 유지하고 내보낸 파일을 자동 재생하지 마세요. 끝나면 오디오 경로, 길이, 상태, 누락 항목을 알려 주세요.

검수: 직접 MP3를 열어 소리가 나고 길이가 적절한지 확인합니다. “파일이 생성됨”만으로 실제 청취 검사를 대신하지 마세요.

### D. 동영상 또는 구간 저장

> Babel Content Downloader를 사용하여 `<동영상URL>`의 60초부터 120초까지를 MP4로 `/내절대자료디렉터리`에 저장해 주세요. 완료 후 파일 경로, 실제 길이, 상태를 알려 주고 자동 재생하지 마세요.

검수: 원본 동영상이 120초보다 길고 출력이 약 60초이며 화면과 소리를 정상 재생할 수 있는지 확인합니다. 720p를 명시했지만 소스에 없으면 누락으로 보고되며 다른 화질로 자동 대체된다고 보장하지 않습니다.

### E. 이미지와 자막 저장

> `<공개이미지글URL>`의 이미지를 `/내절대자료디렉터리`에 저장해 주세요. 이미지만 저장하고 전체 파일 경로와 누락 항목을 반환하세요.

> `<YouTube동영상URL>`의 영어 자막을 `/내절대자료디렉터리`에 저장하고 언어 en을 지정하세요. 소스에 이미 있는 자막만 저장하고 음성 전사는 하지 말며 실제 작업 상태와 자막 파일 경로를 보고하세요.

소스에서 해당 언어의 자막을 제공해야 합니다. 최초 릴리스에는 자막 파일을 사용할 수 있어도 작업이 `partial`로 남는 알려진 상황이 있으므로 이 상태를 숨기지 마세요. 자막 구간 자르기는 아직 지원하지 않습니다.

### F. 진행 확인, 재개, 취소

> Babel Content Downloader의 최근 작업을 확인하세요. 작업 `<job_id>`의 상태, 실패 원인, 저장된 모든 파일을 확인하고 파일이 많으면 다음 페이지도 계속 읽으세요.

> 의존성을 추가／브라우저 연결을 복구했습니다. 중복 작업을 새로 만들지 말고 Babel Content Downloader 작업 `<job_id>`를 재개하세요.

> Babel Content Downloader 작업 `<job_id>`를 취소하세요.

`SELECTION_REQUIRED`가 나오면 Agent에게 반환된 “글／동영상／오디오” 등의 선택지를 알려 주면 같은 작업을 재개합니다. 작업 취소는 이미 전달된 파일을 삭제하지 않습니다.

더 자세한 단계별 테스트와 결과 기록 양식은 [사용 및 테스트 가이드](../usage-guide.md)를 참조하세요.

## 출력 파일과 작업 상태

작업은 승인된 디렉터리 안에 자체 결과 디렉터리를 만듭니다. 실제 파일 수와 이름은 `job_get` 반환값을 기준으로 하세요. 예:

```text
BabelLibrary/
└── 글 또는 동영상 결과 디렉터리/
    ├── content.md       # 작업 목적에 따라 생성된 읽을 수 있는 본문 또는 자료 진입점
    ├── assets/          # 이미지, 오디오, 동영상, 자막, PDF 등의 실제 파일
    ├── metadata.json   # 소스, 콘텐츠 정보, 전달 목록, 기록된 미디어 처리 정보
    └── assets.json     # 리소스 연결 목록
```

Markdown 이미지는 상대 링크를 사용합니다. 자료를 옮길 때 결과 디렉터리 전체를 유지하세요. `job_get`은 파일 경로, 크기, SHA256, 페이지 정보를 제공합니다. 전체 본문은 로컬 파일에 있으며 MCP 응답에 전부 넣지 않습니다.

| 상태 | 의미와 다음 단계 |
|---|---|
| `queued`／`resolving`／`collecting`／`downloading`／`finalizing`／`verifying` | 대기열에 있거나 처리 중. 도구가 반환한 간격에 맞춰 다시 조회 |
| `succeeded` | 이번에 명시한 요청 범위가 완료됨. 결과물을 열어 사용 목적을 충족하는지 확인 |
| `partial` | 결과는 있지만 요청 내용 일부가 부족함. `error`, `warnings`, 실패 구성 요소 확인 |
| `blocked` | 연결, 의존성, 목적 선택, 자동 재시도를 기다리는 중. 구체적인 원인과 `retry_at`을 먼저 확인 |
| `failed` | 이번 작업 미완료. 오류를 확인하고 복구 가능한 문제를 해결한 뒤 재개 |
| `cancelled` | 취소됨. 기존 파일이 남아 있을 수 있음 |

## MCP 호출 예시

아래는 Agent 또는 클라이언트 개발자를 위한 **MCP 도구 인자 JSON**입니다. 터미널 명령이나 HTTP API 요청 본문이 아닙니다. 일반 사용자는 위의 자연어를 사용하면 됩니다.

`babel_content_collect`로 본문 저장:

```json
{
  "target": { "type": "url", "url": "https://example.org/articles/my-article" },
  "save_as": "document",
  "output": { "directory": "/absolute/path/to/authorized/materials" }
}
```

`example.org`는 형식 예시입니다. 테스트할 때 실제 접근 가능한 글로 바꾸세요. MP3 오디오 구간 추출:

```json
{
  "target": { "type": "url", "url": "https://www.youtube.com/watch?v=REPLACE_WITH_VIDEO_ID" },
  "save_as": "audio",
  "preferences": { "audio_format": "mp3", "clip": { "start_seconds": 60, "end_seconds": 120 } },
  "output": { "directory": "/absolute/path/to/authorized/materials" }
}
```

제출 후 반환된 `job_id`로 `babel_content_job_get`을 호출합니다.

```json
{ "job_id": "실제job_id로교체", "artifact_offset": 0, "artifact_limit": 50 }
```

`artifact_page.next_offset`가 비어 있지 않다면 그 값으로 다음 페이지를 읽습니다. `collect`가 반환한 `queued`를 다운로드 완료로 해석하지 마세요.

| 도구 | 용도 |
|---|---|
| `babel_content_check` | 런타임, 대상 경로, 확장, 의존성 검사. `target`과 `save_as` 전달 가능 |
| `babel_content_collect` | 명시된 URL 또는 탭 하나의 작업 생성 |
| `babel_content_job_get` | 상태, 누락 항목, 페이지로 나뉜 파일 조회 |
| `babel_content_job_resume` | 재개. 목적 선택용 `save_as` 또는 같은 콘텐츠의 새 `refreshed_url` 전달 가능 |
| `babel_content_job_cancel` | 작업 취소 |
| `babel_content_jobs_list` | 현재 클라이언트의 작업을 `offset`／`limit`으로 조회 |
| `babel_content_browser_observe` | 지정한 `job_id`의 페이지 관찰 |
| `babel_content_browser_act` | 작업 권한 안에서 허용된 스크롤, 펼치기, 음소거 재생 등의 동작 수행 |

`save_as`와 `include`는 함께 사용할 수 없습니다. `include`는 `text`, `images`, `video`, `audio`, `subtitles`, `cover`, `files`를 선택할 수 있습니다. 다른 설정과 탭 예시는 [사용 및 테스트 가이드](../usage-guide.md)를 참조하세요.

## 자주 발생하는 문제

| 증상 | 해결 방법 |
|---|---|
| Agent가 도구를 찾지 못함 | 해당 CLI 설치를 확인하고 `client-config-status codex`를 확인. Agent를 다시 로드한 뒤 실제 검사 도구 호출 |
| 확장에 “로컬 승인 대기” 표시 | 실제 확장 ID를 확인하고 `allow-extension` 후 `runtime-start` 실행. 환영 페이지에서 다시 연결 |
| `waiting_browser` 또는 확장이 일시 중지됨 | Chrome을 켜 둔 채 확장에서 연결／재개. 전체 연결 상태만 보지 말고 작업에 연결된 인스턴스 확인 |
| 버전이 계속 이전 버전임 | 빌드만으로 Chrome이 자동 다시 로드되지 않음. 로드 디렉터리를 확인하고 확장 관리 페이지에서 한 번 다시 로드한 뒤 환영 페이지 버전 확인 |
| `CLIENT_ALREADY_EXISTS` | 클라이언트가 이미 승인됨. 재등록하거나 기존 승인을 삭제하지 말고 현재 설정과 런타임 상태 확인 |
| 포트 사용 중 | 먼저 점유 프로세스를 확인. 수동 `serve`와 관리형 서비스가 같은 포트를 동시에 사용할 수 없음. 다른 서비스를 무작정 종료하지 말 것 |
| 출력 디렉터리 거부 | `add-client`로 승인한 루트 안의 절대 경로 사용. 채팅 문구로 디렉터리 권한을 확대할 수 없음 |
| 미디어 의존성 없음 | 위 방법으로 설치하고 `set-tool`로 등록. 런타임을 다시 시작한 뒤 원래 작업 재개 |
| `ACCESS_UNCONFIRMED`／`ACCESS_NOT_PUBLIC` | 현재 페이지의 공개 상태를 확인할 수 없거나 접근 게이트를 만남. 링크와 플랫폼 제한을 확인하고 오류 페이지를 성공으로 취급하지 말 것 |
| `ADAPTER_CHANGED`／`CONTENT_SCRIPT_TIMEOUT` | 페이지 구조 또는 로딩 상태가 변했을 수 있음. 오류와 작업 ID를 보존하고 반복 다운로드만으로 성공을 보장하지 말 것 |
| `PRIVATE_ADDRESS_BLOCKED` | DNS가 예약／사설 주소를 반환함. 로컬 네트워크 설정을 확인. 런타임은 내부 주소를 허용하지 않음. 선택적 DNS 설정은 런타임 문서 참조 |
| 파일은 있지만 `partial` | 실제 누락 항목 확인. 이미지, 전체 본문, 자막, 소스 완전성 증명이 부족할 수 있으며 이미 사용 가능한 파일은 먼저 활용 가능 |
| 블로그에 내비게이션／관련 콘텐츠가 포함되거나 날짜가 비어 있음 | 범용 추출이 추가로 읽을 수 있는 영역을 유지할 수 있음. 게시일을 확정할 수 없으면 빈 값을 허용 |

기본 로컬 설정은 `~/.config/babel-content-downloader/config.json`, 작업 기록은 `~/.local/share/babel-content-downloader/jobs/`에 있습니다. 설정에는 클라이언트 자격 증명이 들어 있으므로 공개 Issue나 소스 패키지에 첨부하지 마세요. 피드백에는 버전, 플랫폼, 작업 상태, 오류 코드, 민감한 매개변수를 제거한 링크만 제공하세요.

## 업그레이드-중지-제거

업그레이드 전에 처리 중인 작업을 완료하거나 취소합니다. 설정, 작업 디렉터리, 다운로드 파일을 보존하고 서비스 진입 경로가 바뀌지 않도록 기존의 안정적인 설치 디렉터리에서 런타임 패키지를 업데이트합니다. 명령의 버전 파일명을 실제 새 패키지로 바꾸세요.

```sh
node "$BABEL_CLI" runtime-stop
npm install --prefix "$BABEL_INSTALL_ROOT" --omit=dev "$BABEL_RELEASE_DIR/babel-content-downloader-0.1.26.tgz"
node "$BABEL_CLI" runtime-start
node "$BABEL_CLI" runtime-status
```

Chrome에서 같은 확장 디렉터리의 “다시 로드”를 누르고 버전과 연결을 확인합니다. 독립 ZIP에서 로드했다면 기존 압축 해제 디렉터리를 업데이트합니다. 디렉터리를 바꿔 ID가 변경되면 새 실제 ID를 승인하고 런타임을 다시 시작해야 합니다. `add-client`를 다시 실행하지 마세요.

이전에 소스 디렉터리, 수동 `serve`, 다른 설정 파일을 사용했다면 같은 설정과 기존 진입점을 계속 사용하고 [런타임 문서](../runtime-setup.md)에 따라 이전하세요. 위의 신규 TGZ 설치 경로를 기존 서비스 경로로 그대로 대체해서는 안 됩니다.

확장만 일시 중지하려면 설정 페이지의 “일시 중지”를 누릅니다. 일시 중지는 이미 시작된 모든 작업을 취소하는 것과 다릅니다. 이 프로젝트의 백그라운드 서비스를 관리하려면:

```sh
node "$BABEL_CLI" runtime-stop
node "$BABEL_CLI" runtime-start
```

Codex 연결과 이 프로젝트의 백그라운드 서비스를 제거하려면:

```sh
node "$BABEL_CLI" remove-client-config codex
node "$BABEL_CLI" remove-client codex
node "$BABEL_CLI" runtime-uninstall
```

이 단계는 같은 런타임의 다른 클라이언트에 영향을 줄 수 있습니다. 클라이언트 하나만 비활성화하려면 백그라운드 서비스를 유지하고 권한 변경 적용을 위해 다시 시작합니다. 확장은 설정 페이지에서 연결을 취소한 뒤 Chrome에서 제거할 수 있습니다. 위 명령은 수집한 자료를 삭제하지 않습니다. 설치 디렉터리를 삭제하기 전에 백그라운드 서비스를 제거하세요.

## 개발과 기타 문서

저장소 또는 소스 ZIP에서 빌드:

```sh
npm ci
npm run typecheck
npm test -- --maxWorkers=2
npm run build
```

그다음 `dist/bootstrap/cli.js`를 진입점으로, `dist/extension`을 정식 확장으로 사용하여 위 방식대로 승인하고 연결합니다. 오디오·동영상 테스트에는 로컬 FFmpeg가 필요합니다. `npm run lsp`에는 `typescript-language-server`가 별도로 필요합니다. 테스트 픽스처는 실제 웹사이트 검증을 대신하지 않습니다.

과거 0.1.25 코드 기준에서는 43개 테스트 파일의 340개 테스트가 통과했습니다. 런타임 TGZ의 독립 설치와 8개 MCP 도구 검증도 통과했고, 소스 ZIP에서 다시 빌드한 60개 생성 파일은 배포 빌드와 바이트 단위로 일치했습니다. 실제 브라우저 기준 버전은 0.1.24입니다. 0.1.25에 추가된 미디어 처리 메타데이터와 글 날짜 수정은 패키지 검증만으로 사용자가 새 버전을 다시 로드했음을 증명하지 않습니다. 0.1.26의 현재 검증 결과는 릴리스에 포함된 `verification.json`에서 확인하세요.

- [사용 및 테스트 가이드](../usage-guide.md): 추가 매개변수, 단계별 테스트, 피드백 양식.
- [최초 설치와 제한](../first-release.md), [런타임 설정](../runtime-setup.md), [Agent 연결](../agent-setup.md).
- [공개 작업 체크리스트와 릴리스 노트](../publishing.md): 관리자가 소스와 첨부 파일을 업로드할 때 사용.
- [CHANGELOG](../../CHANGELOG.md), [구현 기록](../implementation-status.md), [플랫폼 과거 검증](../platform-status.md), [범용 웹 검증](../unified-web-validation.md). 과거 기록의 이전 버전 결과는 현재 지원 범위를 대체하지 않습니다.
- [제품 Spec](../specs/Babel_Content_Downloader_内容收集与使用契约_2026-09-18.md), [LICENSE](../../LICENSE), [서드파티 의존성 안내](../../THIRD_PARTY.md).

소스 코드는 MIT 라이선스로 제공됩니다. 서드파티 의존성과 다운로드 콘텐츠의 권리는 각각 해당 권리자에게 있습니다. 소스 약관과 자신이 가진 권한에 따라 저장 자료를 사용하세요.
