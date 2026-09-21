import type { AccessSignals, AllowedActions, PageNode, PageReader } from "../types.js";
import {
  baselineCoverage,
  firstId,
  pathId,
  plan,
  preserveQuery,
  rule,
  type PlatformSpec,
} from "./spec.js";

const NOTE_ACTIONS: AllowedActions = {
  expand: ["[data-testid='note-text-expand']", ".note-text .expand", ".content .expand"],
  play: ["video", "[data-testid='video-player'] video"],
  max_scroll_delta: 700,
};

const VIDEO_ACTIONS: AllowedActions = {
  expand: ["[data-testid='expand']", ".desc-more", ".fold-btn"],
  play: ["video", ".bpx-player-video-wrap video", "[data-e2e='video-player'] video"],
  max_scroll_delta: 700,
};

/**
 * XHS frequently hydrates the player with a blob URL and keeps the signed
 * CDN rendition only in SSR state or an inline bootstrap script. Keep this
 * fallback adapter-owned and narrow: read script text, decode the URL escape
 * forms used by JSON/HTML, and accept only XHS video hosts and MP4-like paths.
 * This mirrors the proven Open CLI fallback without evaluating page code.
 */
function xiaohongshuVideoSourceUrls(reader: PageReader, _root: PageNode): readonly string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string, originVideoKey = false): void => {
    let value = raw.trim()
      .replace(/\\u002f/gi, "/")
      .replace(/\\u003a/gi, ":")
      .replace(/\\u0026/gi, "&")
      .replace(/\\\//g, "/")
      .replace(/&amp;/gi, "&")
      .replace(/[),\]}]+$/g, "");
    if (originVideoKey && !/^https?:\/\//i.test(value)) value = `https://sns-video-bd.xhscdn.com/${value.replace(/^\/+/, "")}`;
    if (!/^https?:\/\//i.test(value) || !/(?:xhscdn|xiaohongshu|rednote)/i.test(value) || !/\.mp4(?:[?#]|$)/i.test(value)) return;
    if (seen.has(value)) return;
    seen.add(value);
    candidates.push(value);
  };

  for (const script of reader.select(["script"])) {
    const text = reader.rawText?.(script) ?? reader.text(script);
    if (!text) continue;
    const normalized = text
      .replace(/\\u002f/gi, "/")
      .replace(/\\u003a/gi, ":")
      .replace(/\\u0026/gi, "&")
      .replace(/\\\//g, "/")
      .replace(/&quot;/gi, '"');
    for (const match of normalized.matchAll(/https?:\/\/[^"'\\\s]+/gi)) add(match[0]);
    for (const match of normalized.matchAll(/(?:masterUrl|videoUrl|video_url)\s*["']?\s*:\s*["']([^"']+)["']/gi)) add(match[1]!);
    for (const match of normalized.matchAll(/originVideoKey\s*["']?\s*:\s*["']([^"']+)["']/gi)) add(match[1]!, true);
  }
  return candidates.slice(0, 1);
}

const WECHAT_ACCESS: AccessSignals = {
  login_gates: ["#js_pc_qr_code", ".weui-desktop-wxpay-dialog", "[data-testid='login-gate']"],
  paid_gates: [".js_paywall", ".paid-content", "[data-testid='paywall']"],
  private_gates: [".profile_nickname[aria-disabled='true']", "[data-testid='private-content']"],
  login_text: ["请在微信客户端打开", "登录后查看"],
  paid_text: ["付费阅读", "会员专享", "订阅后查看"],
  private_text: ["该内容已不可见", "内容已删除"],
};

/**
 * Baseline domestic platforms. `fixture_verified` means the rule has a
 * deterministic fixture, never that a current logged-in browser run passed.
 */
export const DOMESTIC_SPECS: readonly PlatformSpec[] = [
  {
    rule: rule({
      id: "xiaohongshu",
      hosts: ["www.xiaohongshu.com", "xiaohongshu.com"],
      patterns: ["/explore/:noteId", "/discovery/item/:noteId"],
      contentTypes: ["image_note", "video", "mixed"],
      defaultType: "image_note",
      contentId: firstId(pathId(/^\/explore\/([A-Za-z0-9]+)/), pathId(/^\/discovery\/item\/([A-Za-z0-9]+)/)),
      selectors: plan({
        roots: ["#noteContainer", "[data-testid='note-detail']", ".note-container"],
        title: ["#detail-title", "[data-testid='note-title']", ".note-content .title"],
        authors: ["#userPageContainer .username", "[data-testid='author-name']", ".author-wrapper .name"],
        published: ["time", ".date", "[data-testid='publish-time']"],
        images: [".swiper-slide img", ".note-slider img", "[data-testid='note-image'] img"],
        // XHS has used several player wrappers over time. The current public
        // note page mounts a real <video> directly under the bounded note
        // root, so keep the generic selector as the final compatibility path
        // instead of requiring a wrapper class that is not part of the
        // platform contract.
        videos: ["[data-testid='note-video'] video", ".note-video video", "video"],
        video_source_urls: xiaohongshuVideoSourceUrls,
        subtitles: ["video track[kind='captions']", "video track[kind='subtitles']"],
        cover: ["meta[property='og:image']", ".note-video poster"],
      }),
      actions: NOTE_ACTIONS,
    }),
    asset_hosts: ["www.xiaohongshu.com", "*.xhscdn.com", "ci.xiaohongshu.com"],
    engine: "browser",
    status: "experimental",
    coverage: baselineCoverage("fixture_verified", "Route, note root, ordered gallery, and video fixture are verified; browser and policy verification remain pending."),
  },
  {
    rule: rule({
      id: "bilibili",
      hosts: ["www.bilibili.com", "bilibili.com"],
      patterns: ["/video/BV…", "/video/av…", "/read/cv:articleId", "/opus/:opusId", "/dynamic/:dynamicId"],
      contentTypes: ["video", "article", "post", "image_note", "mixed"],
      defaultType: "video",
      contentId: firstId(
        pathId(/^\/video\/(BV[0-9A-Za-z]+)/),
        pathId(/^\/video\/av(\d+)/),
        pathId(/^\/read\/cv(\d+)/),
        pathId(/^\/opus\/(\d+)/),
        pathId(/^\/dynamic\/(\d+)/),
      ),
      canonicalize: preserveQuery("p"),
      selectors: plan({
        roots: ["#viewbox_report", "#mirror-vdcon", ".video-container-v1", "#read-article-holder", ".opus-modules", ".bili-dyn-item__main"],
        title: ["h1.video-title", "#viewbox_report h1", "#mirror-vdcon h1", "#article-title", ".opus-title", "meta[property='og:title']"],
        authors: [".up-name", ".up-info__name", ".article-up-info .up-name", ".opus-module-author__name"],
        published: ["time", ".pubdate-text", ".article-time", ".opus-module-author__pub__text"],
        images: [".opus-module-content img", ".bili-dyn-content img", "#read-article-holder img", ".article-content img"],
        videos: ["#playerWrap video", ".bpx-player-video-wrap video", "#bilibili-player video"],
        subtitles: ["video track[kind='captions']", "video track[kind='subtitles']"],
        cover: ["meta[property='og:image']", ".video-cover img"],
        asset_scope: "document",
      }),
      actions: VIDEO_ACTIONS,
    }),
    asset_hosts: [
      "www.bilibili.com",
      "api.bilibili.com",
      "*.hdslb.com",
      "*.bilivideo.com",
      "*.biliimg.com",
      "*.mcdn.bilivideo.cn",
      "*.edge.mountaintoys.cn",
    ],
    asset_https_ports: [
      { host: "*.mcdn.bilivideo.cn", ports: [8082] },
      { host: "*.edge.mountaintoys.cn", ports: [4483] },
    ],
    engine: "yt-dlp",
    status: "experimental",
    coverage: baselineCoverage("fixture_verified", "Video metadata, cover, native track, and opus-image ordering have deterministic fixtures; browser/media validation is pending."),
  },
  {
    rule: rule({
      id: "weixin_article",
      hosts: ["mp.weixin.qq.com"],
      patterns: ["/s?__biz=…&mid=…&idx=…", "/s/:opaqueArticleId"],
      contentTypes: ["article", "mixed", "video", "audio"],
      defaultType: "article",
      contentId: (url: URL) => {
        const opaque = /^\/s\/([A-Za-z0-9_-]{6,})$/.exec(url.pathname)?.[1];
        if (opaque) return opaque;
        if (url.pathname !== "/s") return null;
        const biz = url.searchParams.get("__biz");
        const mid = url.searchParams.get("mid");
        const idx = url.searchParams.get("idx") ?? "1";
        return biz && mid && /^\d+$/.test(mid) ? `${biz}:${mid}:${idx}` : null;
      },
      canonicalize: preserveQuery("__biz", "mid", "idx"),
      selectors: plan({
        roots: ["#js_content", ".rich_media_content"],
        title: ["#activity-name", ".rich_media_title", "meta[property='og:title']"],
        authors: ["#js_name", ".profile_nickname", "#js_author_name"],
        published: ["#publish_time", "time", ".rich_media_meta_text"],
        images: ["#js_content img", ".rich_media_content img"],
        videos: ["#js_content video", "#js_content iframe[data-src*='video']"],
        audio: ["#js_content audio", ".js_audio_container audio"],
        subtitles: ["#js_content track[kind='captions']", "#js_content track[kind='subtitles']"],
        files: ["#js_content a[href*='weixin.qq.com']"],
      }),
      access: WECHAT_ACCESS,
      actions: { expand: ["#js_content .js_unfold", ".js_expand"], play: ["#js_content video", "#js_content audio"], max_scroll_delta: 650 },
    }),
    asset_hosts: ["mp.weixin.qq.com", "mmbiz.qpic.cn", "mmbiz.qlogo.cn", "*.qq.com"],
    engine: "browser",
    status: "experimental",
    coverage: baselineCoverage("fixture_verified", "Article root, author, ordered inline images, and embedded media relation have deterministic fixtures; browser and access-path validation are pending."),
  },
  {
    rule: rule({
      id: "zhihu",
      hosts: ["www.zhihu.com", "zhihu.com", "zhuanlan.zhihu.com"],
      patterns: ["/question/:questionId/answer/:answerId", "/p/:articleId"],
      contentTypes: ["article", "post", "video", "mixed"],
      defaultType: "article",
      contentId: firstId(pathId(/^\/question\/\d+\/answer\/(\d+)/), pathId(/^\/p\/(\d+)/)),
      selectors: plan({
        // The broad Post-RichTextContainer also contains the article TOC and
        // controls. The observed public-column body is its RichText child;
        // selecting that narrow root fails closed if the structure changes.
        roots: [".QuestionAnswer-content", ".Post-RichTextContainer .RichText.ztext.Post-RichText", ".RichContent-inner"],
        // On public columns, the header and body are siblings in this one
        // article container. Metadata is read only if that exact container
        // uniquely contains the selected body root.
        metadata_roots: ["article.Post-Main.Post-NormalMain"],
        title: [".QuestionHeader-title", ".Post-Title", "meta[property='og:title']"],
        authors: ["[itemprop='author'] .AuthorInfo-name"],
        published: ["[itemprop='datePublished']"],
        images: [".RichContent-inner img", ".Post-RichTextContainer img"],
        videos: [".RichContent-inner video", ".VideoAnswerPlayer video"],
        subtitles: ["video track[kind='captions']", "video track[kind='subtitles']"],
      }),
      // Evidence-backed only for public column articles, never Q&A answers:
      // the narrow RichText body is inside one article, its outer container is
      // immediately followed by the article's edit-time terminal element, and
      // two 700ms read-only samples had matching body/image identities. The
      // content script must still satisfy this stability gate per capture.
      completion: [{
        id: "zhihu.column.richtext.time-terminal.v1",
        content_types: ["article"],
        applies: url => url.hostname === "zhuanlan.zhihu.com" && /^\/p\/\d+$/.test(url.pathname),
        content_root: ".Post-RichTextContainer .RichText.ztext.Post-RichText",
        boundary: {
          type: "terminal_observed",
          selectors: [".ContentItem-time[role='button']"],
          scope: "metadata_root",
          anchor_selector: ".Post-RichTextContainer",
          immediately_after_anchor: true,
        },
        pending_or_truncation: [".RichContent .ContentItem-more"],
        stability: { sample_count: 2, minimum_window_ms: 700 },
      }],
      actions: { expand: [".RichContent .ContentItem-more", ".RichContent .Button--plain"], play: ["video"], max_scroll_delta: 700 },
    }),
    asset_hosts: ["www.zhihu.com", "zhuanlan.zhihu.com", "*.zhimg.com", "*.zhihu.com"],
    engine: "browser",
    status: "experimental",
    coverage: baselineCoverage("unverified", "One public column sample has evidence-backed root and boundary capture; answer routes and other Zhihu pages remain unverified."),
  },
];
