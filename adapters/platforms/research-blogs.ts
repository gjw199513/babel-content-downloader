import { cleanCanonicalUrl } from "../shared-extractors/url.js";
import { baselineCoverage, plan, rule, type PlatformSpec } from "./spec.js";

const ANTHROPIC_ROUTE = /^\/(research|engineering)\/([A-Za-z0-9][A-Za-z0-9-]*)\/?$/;
const DEEPMIND_BLOG_ROUTE = /^\/blog\/([A-Za-z0-9][A-Za-z0-9-]*)\/?$/;
const DEEPMIND_PUBLICATION_ROUTE = /^\/research\/publications\/(\d+)\/?$/;
const OPENAI_SLUG = /^[A-Za-z0-9][A-Za-z0-9-]{0,159}$/;
const OPENAI_LOCALE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){1,2}$/;
const ANTHROPIC_ENGINEERING_ROOT = "main#main-content:has(> section[aria-label='Engineering Article Hero'])";
const ROOT_PENDING_OR_TRUNCATION = [
  "[aria-busy='true']",
  "[data-loading='true']",
  ".loading",
  ".is-loading",
] as const;

function anthropicContentId(url: URL): string | null {
  const match = ANTHROPIC_ROUTE.exec(url.pathname);
  return match ? `${match[1]}:${match[2]}` : null;
}

function deepmindCanonicalUrl(input: URL): URL {
  const canonical = cleanCanonicalUrl(input);
  canonical.protocol = "https:";
  canonical.hostname = "deepmind.google";
  canonical.port = "";
  canonical.pathname = `${canonical.pathname.replace(/\/+$/, "")}/`;
  return canonical;
}

/**
 * DeepMind's shipped page identity is its own canonical copy-link URL. The
 * extractor compares this value with a `data-copy-url` inside the selected
 * main element, so a category label or a similarly shaped page cannot bind a
 * different requested item.
 */
function deepmindContentId(url: URL): string | null {
  if (!DEEPMIND_BLOG_ROUTE.test(url.pathname) && !DEEPMIND_PUBLICATION_ROUTE.test(url.pathname)) return null;
  return deepmindCanonicalUrl(url).href;
}

/**
 * OpenAI's actual document path is the navigation identity only. The browser
 * path deliberately uses the generic current-page extractor, not unverified
 * OpenAI-specific body selectors. A localized route is a distinct target;
 * callers cannot drift between a locale and its default-language article.
 */
function openAiContentId(url: URL): string | null {
  const raw = url.pathname.split("/").filter(Boolean);
  if (raw.some(segment => /%2f|%5c/i.test(segment))) return null;
  let segments: string[];
  try {
    segments = raw.map(segment => decodeURIComponent(segment));
  } catch {
    return null;
  }
  if (segments.some(segment => !segment || segment === "." || segment === ".." || /[\\/]/.test(segment))) return null;
  const [first, second, third] = segments;
  if (segments.length === 2 && first === "index" && second && OPENAI_SLUG.test(second)) {
    return `index:default:${second.toLowerCase()}`;
  }
  if (segments.length === 3 && first && second === "index" && third && OPENAI_LOCALE.test(first) && OPENAI_SLUG.test(third)) {
    return `index:${first.toLowerCase()}:${third.toLowerCase()}`;
  }
  return null;
}

function directAnthropicPdf(_target: URL, asset: URL): boolean {
  return (asset.hostname === "www.anthropic.com" || asset.hostname === "www-cdn.anthropic.com")
    && /\.pdf$/i.test(asset.pathname);
}

function directDeepmindPdf(_target: URL, asset: URL): boolean {
  return asset.protocol === "https:"
    && asset.hostname === "arxiv.org"
    && /^\/pdf\/\d{4}\.\d{4,5}(?:v\d+)?(?:\.pdf)?$/i.test(asset.pathname);
}

const anthropicRule = {
  ...rule({
    id: "anthropic_blog",
    hosts: ["www.anthropic.com", "anthropic.com"],
    patterns: ["/research/:slug", "/engineering/:slug"],
    contentTypes: ["article", "mixed"],
    defaultType: "article",
    contentId: anthropicContentId,
    selectors: plan({
      // The two roots are mutually exclusive in the observed official HTML:
      // research pages own a direct article, while engineering pages own an
      // explicitly labelled hero followed by the article body.
      roots: [
        "main#main-content > article",
        ANTHROPIC_ENGINEERING_ROOT,
      ],
      title: [
        "main#main-content > article h1",
        "section[aria-label='Engineering Article Hero'] h1",
      ],
      published: [
        "main#main-content > article > .page-wrapper:first-child .body-3.agate",
        "section[aria-label='Engineering Article Hero'] p[class*='__date']",
      ],
      images: ["img"],
      videos: ["video"],
      audio: ["audio"],
      subtitles: ["video track[kind='captions']", "video track[kind='subtitles']"],
      files: ["a[href$='.pdf']"],
      excluded: [
        "main#main-content > article > section",
        "main#main-content > article [class*='__socialShare']",
        "main#main-content > article [class*='__subjects']",
        "section[aria-label='Engineering Article Hero'] > a[href='/engineering']",
        // The engineering layout mounts its newsletter beside the article
        // inside the same page-wrapper. It is page UI, not source prose.
        "main#main-content > div.page-wrapper > div[class*='NewsletterSubscribe']",
      ],
    }),
    // Engineering evidence proves the whole main contains hero source text
    // and media as well as the article, while the newsletter is an excluded
    // sibling. Research pages have a different root and remain unproven.
    completion: [{
      id: "anthropic.engineering.main-root.v1",
      content_types: ["article"],
      applies: url => anthropicContentId(url)?.startsWith("engineering:") === true,
      content_root: ANTHROPIC_ENGINEERING_ROOT,
      boundary: { type: "root_exhausted" },
      pending_or_truncation: ROOT_PENDING_OR_TRUNCATION,
      stability: { sample_count: 2, minimum_window_ms: 700 },
    }],
  }),
  file_matches: directAnthropicPdf,
};

const deepmindRule = {
  ...rule({
    id: "deepmind_blog",
    hosts: ["deepmind.google"],
    patterns: ["/blog/:researchSlug", "/research/publications/:publicationId"],
    contentTypes: ["article", "mixed"],
    defaultType: "article",
    contentId: deepmindContentId,
    canonicalize: deepmindCanonicalUrl,
    selectors: plan({
      roots: ["main#page-content"],
      title: [".cover__text--title", ".section-title__title"],
      authors: [".cover__text--authors", ".publication-authors__content"],
      published: [".cover__text--date", ".section-title__date"],
      images: [".media-content-wrapper img.picture__image"],
      videos: [".media-content-wrapper video"],
      audio: [".media-content-wrapper audio.media-audio"],
      subtitles: [
        ".media-content-wrapper video track[kind='captions']",
        ".media-content-wrapper video track[kind='subtitles']",
      ],
      files: ["a[data-event-content-name='Download'][href*='arxiv.org/pdf/']"],
      excluded: [
        ".cover__text--category",
        ".share-toggle__button",
        ".caption__expand",
        ".caption__collapse",
        ".publication-actions a[data-event-content-name='View publication']",
        "section.section--has-background.section--grey",
      ],
    }),
    targetRootPlans: [
      {
        applies: url => DEEPMIND_BLOG_ROUTE.test(url.pathname),
        roots: ["main#page-content"],
        target_id: { selectors: [".share-list__item--copy[data-copy-url]"], attribute: "data-copy-url" },
        public_marker: { selectors: [".cover__text--category"], text: "Research" },
      },
      {
        applies: url => DEEPMIND_PUBLICATION_ROUTE.test(url.pathname),
        roots: ["main#page-content"],
        target_id: { selectors: [".share-list__item--copy[data-copy-url]"], attribute: "data-copy-url" },
      },
    ],
    // Only the observed numeric publication page has a complete root-level
    // source boundary and an identity-bound Download relation. A blog page
    // must not inherit its proof or its required paper attachment.
    completion: [{
      id: "deepmind.publication.main-root.v1",
      content_types: ["article"],
      applies: url => DEEPMIND_PUBLICATION_ROUTE.test(url.pathname),
      content_root: "main#page-content",
      boundary: { type: "root_exhausted" },
      pending_or_truncation: ROOT_PENDING_OR_TRUNCATION,
      stability: { sample_count: 2, minimum_window_ms: 700 },
    }],
  }),
  file_matches: directDeepmindPdf,
};

const openAiRule = {
  ...rule({
    id: "openai_blog",
    hosts: ["openai.com", "www.openai.com"],
    patterns: ["/index/:slug", "/:locale/index/:slug"],
    contentTypes: ["article"],
    defaultType: "article",
    contentId: openAiContentId,
    // This rule supplies only a route-bound navigation and public-root check
    // for the generic browser DOM pipeline. Do not turn it into an OpenAI
    // CSS extractor before a separate source-boundary evidence review.
    selectors: plan({
      roots: ["main", "article", "[role='main']"],
      title: ["main h1", "article h1", "[role='main'] h1", "h1"],
      authors: [],
      published: [],
      images: [],
      videos: [],
      audio: [],
      subtitles: [],
      files: [],
      cover: [],
    }),
  }),
};

/**
 * Executable official-blog navigation rules. OpenAI's rule intentionally has
 * no specialized extraction or completion CSS: it enables only the bounded
 * generic browser-document path for exact official article URLs.
 */
export const RESEARCH_BLOG_SPECS: readonly PlatformSpec[] = [
  {
    rule: openAiRule,
    asset_hosts: ["openai.com", "www.openai.com"],
    engine: "browser",
    status: "experimental",
    coverage: baselineCoverage(
      "unverified",
      "OpenAI official /index single-article routes are navigation-bound for generic current-page DOM extraction; no OpenAI-specific body selector, proof, or browser verification is claimed.",
    ),
  },
  {
    rule: anthropicRule,
    asset_hosts: ["anthropic.com", "www.anthropic.com", "www-cdn.anthropic.com"],
    engine: "browser",
    status: "experimental",
    coverage: baselineCoverage(
      "unverified",
      "Official public research and engineering samples supplied exact article boundaries over HTTP; browser validation and completeness proof remain pending.",
    ),
  },
  {
    rule: deepmindRule,
    asset_hosts: ["deepmind.google", "lh3.googleusercontent.com", "storage.googleapis.com", "arxiv.org"],
    document_components_for_url: url => DEEPMIND_PUBLICATION_ROUTE.test(url.pathname) ? ["files"] : [],
    engine: "browser",
    status: "experimental",
    coverage: baselineCoverage(
      "unverified",
      "Research-category blog and numeric publication-detail samples supplied identity-bound roots over HTTP; browser validation and completeness proof remain pending.",
    ),
  },
];
