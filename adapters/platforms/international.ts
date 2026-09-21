import type { AccessSignals, AllowedActions, RelationPlan } from "../types.js";
import {
  baselineCoverage,
  firstId,
  pathId,
  plan,
  preserveQuery,
  rule,
  type PlatformSpec,
} from "./spec.js";

const SOCIAL_ACTIONS: AllowedActions = {
  expand: ["[data-testid='tweet-text-show-more-link']", "[data-testid='post-text-show-more-link']", "button[aria-label='See more']"],
  play: ["video", "[data-testid='videoPlayer'] video"],
  max_scroll_delta: 650,
};

/**
 * These two selectors describe text expanders, rather than feeds, replies,
 * carousel controls, or media controls. The content script still requires an
 * extension-owned muted tab and scopes the lookup to the target post root.
 */
const MICROBLOG_AUTO_EXPAND_ACTIONS: AllowedActions = {
  ...SOCIAL_ACTIONS,
  automatic_expand: ["[data-testid='tweet-text-show-more-link']", "[data-testid='post-text-show-more-link']"],
};

/**
 * Provisional evidence selectors, not a request to crawl a timeline. They
 * have fixture coverage for the fail-closed relation algorithm but no browser
 * validation yet. A related X post is eligible only when a candidate card
 * carries a matching explicit parent permalink; absence or DOM drift returns
 * no continuation rather than guessing from nearby cards.
 */
const X_RELATIONS: RelationPlan = {
  item_roots: ["article[data-testid='tweet']"],
  permalink_links: ["a[href*='/status/']"],
  continuation_parent_links: ["a[data-testid='reply-parent-link'][href*='/status/']"],
  quote_roots: ["[data-testid='quoted-tweet']"],
  repost_roots: ["[data-testid='repost-tweet']"],
};

/**
 * X mounts engagement controls inside the target article. These observed,
 * stable data-testid nodes are product UI rather than source-authored text.
 */
const X_BODY_CONTROLS = [
  "article[data-testid='tweet'] [data-testid='reply']",
  "article[data-testid='tweet'] [data-testid='retweet']",
  "article[data-testid='tweet'] [data-testid='like']",
  "article[data-testid='tweet'] [data-testid='bookmark']",
  "article[data-testid='tweet'] a[role='link'][href*='/status/'][href$='/analytics']:not([data-testid='tweetText'] *)",
  "article[data-testid='tweet'] a[role='link'][href*='/status/'][href$='/quotes']:not([data-testid='tweetText'] *)",
  // The observed ALT control has no stable ID or label. Its button boundary is
  // safe only inside tweetPhoto, and a media-bearing button is never excluded.
  "article[data-testid='tweet'] [data-testid='tweetPhoto'] button:not(:has(img,video,audio))",
] as const;

const VIDEO_ACTIONS: AllowedActions = {
  expand: ["#expand", "[data-testid='expand-button']", ".more-button"],
  play: ["video", ".html5-video-player video"],
  max_scroll_delta: 650,
};

const META_ACCESS: AccessSignals = {
  login_gates: ["[data-testid='login-gate']", "form[action*='login']", "[data-visualcompletion='login_form']"],
  paid_gates: ["[data-testid='paywall']", "[data-visualcompletion='paywall']", "[aria-label*='Subscribe']"],
  private_gates: ["[data-testid='private-content']", "[data-visualcompletion='private-content']"],
  login_text: ["Log in to continue", "Log in to see this", "登录后查看"],
  paid_text: ["Subscribers only", "Subscribe to continue"],
  private_text: ["This Account is Private", "This content isn't available right now"],
};

// These plans are diagnostic-only. They are not extraction or completion
// rules, and their selectors cannot arrive from an MCP caller or page.
const YOUTUBE_WATCH_DOM_DIAGNOSTIC = {
  id: "youtube.watch.static-root.v1",
  applies: (url: URL) => url.pathname === "/watch" && /^[A-Za-z0-9_-]{6,}$/.test(url.searchParams.get("v") ?? ""),
  roots: [
    { id: "watch_metadata", selector: "ytd-watch-metadata" },
    { id: "above_watch_metadata", selector: "#above-the-fold ytd-watch-metadata" },
  ],
} as const;

const MEDIUM_ARTICLE_DOM_DIAGNOSTIC = {
  id: "medium.article.static-root.v1",
  applies: (url: URL) => /^\/[^/]+\/[^/]+-[a-f0-9]{8,}\/?$/i.test(url.pathname),
  roots: [
    { id: "article", selector: "article" },
    { id: "main_article", selector: "main article" },
  ],
  include_outline: true,
  // These two source-observed shapes make a dynamically inserted newsletter
  // inspectable without a broad root DFS or any supplied page selector.
  probes: [
    { id: "input", selector: "input", max_nodes: 4 },
    { id: "figure", selector: "figure", max_nodes: 2 },
  ],
} as const;

export const INTERNATIONAL_SPECS: readonly PlatformSpec[] = [
  {
    rule: rule({
      id: "youtube",
      hosts: ["www.youtube.com", "youtube.com", "m.youtube.com"],
      patterns: ["/watch?v=:videoId", "/shorts/:videoId", "/post/:postId"],
      contentTypes: ["video", "post", "mixed"],
      defaultType: "video",
      contentId: firstId(
        (url: URL) => url.pathname === "/watch" ? url.searchParams.get("v") : null,
        pathId(/^\/shorts\/([A-Za-z0-9_-]{6,})/),
        pathId(/^\/post\/([A-Za-z0-9_-]+)/),
      ),
      canonicalize: preserveQuery("v"),
      selectors: plan({
        roots: ["ytd-watch-metadata", "#above-the-fold ytd-watch-metadata", "ytd-backstage-post-thread-renderer"],
        title: ["h1.ytd-watch-metadata", "#title h1", "#post-text"],
        authors: ["#owner #channel-name a", "ytd-video-owner-renderer #channel-name", "#author-text"],
        published: ["#info-strings yt-formatted-string", "#publish-info", "time"],
        images: ["ytd-backstage-post-thread-renderer #content img", "#description-inline-expander img"],
        videos: [".html5-video-player video", "video.html5-main-video"],
        subtitles: ["video track[kind='captions']", "video track[kind='subtitles']"],
        cover: ["meta[property='og:image']", "link[itemprop='thumbnailUrl']"],
        asset_scope: "document",
      }),
      domDiagnostic: YOUTUBE_WATCH_DOM_DIAGNOSTIC,
      actions: VIDEO_ACTIONS,
    }),
    asset_hosts: ["www.youtube.com", "m.youtube.com", "youtubei.googleapis.com", "i.ytimg.com", "*.googlevideo.com", "*.youtube.com"],
    engine: "yt-dlp",
    status: "experimental",
    coverage: baselineCoverage("fixture_verified", "Watch, Shorts, and community-post routes are separate; fixture verifies title, description, cover, and native track relation. Browser/media validation is pending."),
  },
  {
    rule: rule({
      id: "x",
      hosts: ["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"],
      patterns: ["/:handle/status/:statusId"],
      contentTypes: ["post", "thread", "image_note", "video", "mixed"],
      defaultType: "post",
      contentId: pathId(/^\/[^/]+\/status\/(\d+)/),
      selectors: plan({
        roots: ["article[data-testid='tweet']"],
        // A single X post has source body text, not a separate article title.
        // Keeping this empty preserves the complete tweetText as a paragraph
        // and avoids importing a document-level X shell title.
        title: [],
        authors: ["article[data-testid='tweet'] [data-testid='User-Name']"],
        published: [
          "article[data-testid='tweet'] time",
          "article[data-testid='tweet'] a[href*='/status/']:has(time)",
        ],
        images: ["article[data-testid='tweet'] [data-testid='tweetPhoto'] img", "article[data-testid='tweet'] img[src*='twimg.com/media']"],
        videos: ["article[data-testid='tweet'] [data-testid='videoPlayer'] video", "article[data-testid='tweet'] video"],
        subtitles: ["article[data-testid='tweet'] video track[kind='captions']", "article[data-testid='tweet'] video track[kind='subtitles']"],
        excluded: X_BODY_CONTROLS,
      }),
      targetLinkSelectors: ["a[href*='/status/']"],
      relations: X_RELATIONS,
      actions: MICROBLOG_AUTO_EXPAND_ACTIONS,
    }),
    asset_hosts: ["x.com", "twitter.com", "pbs.twimg.com", "video.twimg.com", "abs.twimg.com"],
    engine: "browser",
    status: "experimental",
    coverage: baselineCoverage("fixture_verified", "Target-post selection requires its status link, so replies/timeline cards are not merged. Single-post fixture verifies quoted text, ordered media, and author/time separation. Bounded relation selectors are provisional and await browser evidence."),
  },
  {
    rule: rule({
      id: "reddit",
      hosts: ["www.reddit.com", "reddit.com", "old.reddit.com"],
      patterns: ["/r/:subreddit/comments/:postId/:slug"],
      contentTypes: ["post", "image_note", "video", "mixed"],
      defaultType: "post",
      contentId: pathId(/^\/r\/[^/]+\/comments\/([A-Za-z0-9]+)/),
      selectors: plan({
        roots: ["shreddit-post", "[data-testid='post-container']", "#siteTable .thing.link"],
        title: ["shreddit-post h1", "[data-testid='post-title']", "a.title"],
        authors: ["shreddit-post a[href*='/user/']", "[data-testid='post_author_link']", ".author"],
        published: ["shreddit-post time", "[data-testid='post_timestamp']", "time"],
        images: ["shreddit-post img[slot='media']", "[data-testid='post-container'] img", ".expando img"],
        videos: ["shreddit-post video", "[data-testid='post-container'] video"],
        subtitles: ["video track[kind='captions']", "video track[kind='subtitles']"],
      }),
      actions: { expand: ["[data-testid='expand-post']", "shreddit-post button"], play: ["shreddit-post video"], max_scroll_delta: 600 },
    }),
    asset_hosts: ["www.reddit.com", "reddit.com", "preview.redd.it", "i.redd.it", "v.redd.it", "external-preview.redd.it", "*.redditmedia.com"],
    engine: "browser",
    status: "experimental",
    coverage: baselineCoverage("fixture_verified", "The post root is distinct from comments; fixture verifies body/media but intentionally contains no comment extraction."),
  },
  {
    rule: rule({
      id: "medium",
      hosts: ["medium.com", "*.medium.com"],
      patterns: ["/:publication/:slug-:postId", "/@:author/:slug-:postId"],
      contentTypes: ["article", "mixed"],
      defaultType: "article",
      contentId: (url: URL) => /-([a-f0-9]{8,})$/i.exec(url.pathname.replace(/\/$/, ""))?.[1] ?? null,
      selectors: plan({
        roots: ["article", "main article"],
        title: ["article h1", "h1[data-testid='storyTitle']", "meta[property='og:title']"],
        authors: ["article a[rel='author']", "[data-testid='authorName']"],
        published: ["article time", "[data-testid='storyPublishDate']"],
        // Medium mounts lazy rendition URLs on picture/source siblings of
        // the img. Select the picture once, not its placeholder img as well.
        images: ["article figure picture", "article figure img:not(picture img)"],
        videos: ["article video", "article iframe[src*='youtube.com']"],
        subtitles: ["article video track[kind='captions']", "article video track[kind='subtitles']"],
        excluded: ["article img[data-testid='authorPhoto']"],
      }),
      domDiagnostic: MEDIUM_ARTICLE_DOM_DIAGNOSTIC,
      actions: { expand: ["[data-testid='paywall'] button"], play: ["article video"], max_scroll_delta: 600 },
    }),
    asset_hosts: ["medium.com", "*.medium.com", "miro.medium.com"],
    engine: "browser",
    status: "experimental",
    coverage: baselineCoverage("fixture_verified", "Article mapping uses the story root and ordered figures; fixture verifies that navigation is excluded. Browser/paywall validation is pending."),
  },
  {
    rule: rule({
      id: "substack",
      hosts: ["substack.com", "*.substack.com"],
      patterns: ["/:publication/p/:slug", "/@:author/post/:postId"],
      contentTypes: ["article", "post", "mixed"],
      defaultType: "article",
      contentId: firstId(
        pathId(/^\/p\/([A-Za-z0-9_-]+)/),
        pathId(/^\/@[^/]+\/post\/(\d+)/),
      ),
      selectors: plan({
        // A real public `/p/` page places subscription/profile/reaction UI in
        // the article shell. Its one article body is the nested markup node;
        // select it first so the readable source excludes that surrounding UI.
        // Broader fallbacks remain partial-only compatibility paths: the
        // completion plan below binds only this exact body selector.
        roots: [
          "article.typography.newsletter-post.post .dt-post-body .available-content > .body.markup",
          "article.typography.newsletter-post.post",
          "article.post",
          ".post-content",
          "[data-testid='post-content']",
        ],
        metadata_roots: ["article.typography.newsletter-post.post"],
        title: ["article.typography.newsletter-post.post .post-header h1.post-title", "article h1", ".post-title", "meta[property='og:title']"],
        // The publication's source-authored subtitle is a unique h3 in the
        // same article header. It precedes the narrow body but is not the
        // subscription or interaction UI elsewhere in the article shell.
        leading_text: ["article.typography.newsletter-post.post .post-header h3.subtitle"],
        authors: ["article.typography.newsletter-post.post .post-header a[href*='substack.com/@']", ".byline a", ".post-meta a[rel='author']"],
        published: ["article.typography.newsletter-post.post .post-header time", "article time", ".post-meta time"],
        images: ["article.typography.newsletter-post.post .body.markup figure img"],
        videos: ["article video", ".post-content video"],
        subtitles: ["article video track[kind='captions']", "article video track[kind='subtitles']"],
      }),
      access: {
        ...META_ACCESS,
        paid_gates: [".paywall", ".subscribe-widget", "[data-testid='paywall']"],
        paid_text: ["This post is for paid subscribers", "Subscribe to read", "付费订阅"],
      },
      // Bounded DOM evidence is limited to a publication subdomain's `/p/`
      // article body. Notes and other post routes remain unproven.
      completion: [{
        id: "substack.public-post.body-root.v1",
        content_types: ["article"],
        applies: url => url.hostname.endsWith(".substack.com") && /^\/p\/[A-Za-z0-9_-]+$/.test(url.pathname),
        content_root: "article.typography.newsletter-post.post .dt-post-body .available-content > .body.markup",
        boundary: { type: "root_exhausted" },
        pending_or_truncation: [],
        stability: { sample_count: 2, minimum_window_ms: 700 },
      }],
      actions: SOCIAL_ACTIONS,
    }),
    // The read-only DOM evidence ties this one host to the first article
    // figure's real responsive source. It is not a wildcard for external
    // images or a general relaxation of the adapter's egress policy.
    asset_hosts: ["substack.com", "*.substack.com", "*.substackcdn.com", "substackcdn.com", "images.unsplash.com"],
    engine: "browser",
    status: "experimental",
    coverage: baselineCoverage("unverified", "Public post and Note routes are targeted; subscriber-only pages are explicitly blocked by access signals."),
  },
];
