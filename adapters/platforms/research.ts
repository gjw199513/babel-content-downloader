import type { PageReader } from "../types.js";
import { DEFAULT_ACCESS, baselineCoverage, plan, rule, type PlatformSpec } from "./spec.js";

type Segments = readonly string[];

const GITHUB_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,99})$/;
const GITHUB_TAG = /^[A-Za-z0-9](?:[A-Za-z0-9_.+@-]{0,199})$/;
const MODERN_ARXIV_BASE_ID = /^\d{4}\.\d{4,5}$/;
const MODERN_ARXIV_VERSIONED_ID = /^(\d{4}\.\d{4,5})v[1-9]\d*$/;
const HF_REPOSITORY_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;
const GITHUB_README_ROOT = "article.markdown-body.entry-content.container-lg";
const HF_RESERVED_ROOTS = new Set([
  "api",
  "blog",
  "collections",
  "datasets",
  "docs",
  "join",
  "login",
  "models",
  "new",
  "organizations",
  "papers",
  "pricing",
  "spaces",
]);

// GitHub currently serves either the legacy repository header or the title
// component. Both selectors name the exact, visible repository visibility
// badge; the reader rejects markers inherited from a hidden template and
// classification still requires exactly one normalized `Public` value.
const GITHUB_PUBLIC_MARKERS = [
  "#repository-container-header span.Label.Label--secondary.v-align-middle.mr-1",
  "#repo-title-component span.mr-1.v-align-middle.prc-Label-Label-qG-Zu",
] as const;
// These source-state controls were checked inside the bounded live roots.
// They deliberately exclude generic collapsed controls: e.g. a DeepMind
// share toggle is not evidence that source prose is truncated.
const ROOT_PENDING_OR_TRUNCATION = [
  "[aria-busy='true']",
  "[data-loading='true']",
  ".loading",
  ".is-loading",
] as const;
const GITHUB_README_PENDING_OR_ERROR = [
  ...ROOT_PENDING_OR_TRUNCATION,
  "include-fragment.is-error",
  ".blankslate",
] as const;
const HF_MODEL_ROOT = "div.model-card-content.prose.hf-sanitized.copiable-code-container";
const HF_DATASET_ROOT = "div.prose.pl-6.-ml-6.hf-sanitized.copiable-code-container";
const HF_BLOG_SHELL = "div.blog-content";
const HF_BLOG_BODY = `${HF_BLOG_SHELL} > div.relative.overflow-clip`;
// A model-card page also has a `section.md:col-span-7`. The paper root is
// therefore bound to the observed PaperContent hydrator and its Abstract body,
// rather than relying on selector order or accepting that generic section.
const HF_PAPER_SECTION = "main > div.container > section.md\\:col-span-7:has(div.SVELTE_HYDRATER.contents > div.pb-8.pr-4.md\\:pr-16)";
const HF_PAPER_BODY = `${HF_PAPER_SECTION} > div.SVELTE_HYDRATER.contents > div.pb-8.pr-4.md\\:pr-16`;
const HF_PAPER_HEADER = `${HF_PAPER_SECTION} > div.SVELTE_HYDRATER.contents > div.pb-10.md\\:pt-3`;
// This is the observed generated-summary module inside the paper Abstract
// body. It is site-generated UI, not source-paper prose, so omit the whole
// module rather than merely suppressing its attribution label.
const HF_PAPER_GENERATED_SUMMARY = `${HF_PAPER_BODY} > div.flex.flex-col.gap-y-2\\.5 > div.bg-blue-500\\/6`;

function decodedSegments(url: URL): Segments | null {
  const raw = url.pathname.split("/").filter(Boolean);
  if (raw.some(segment => /%2f|%5c/i.test(segment))) return null;
  try {
    const decoded = raw.map(segment => decodeURIComponent(segment));
    return decoded.some(segment => !segment || segment === "." || segment === ".." || /[\\/]/.test(segment))
      ? null
      : decoded;
  } catch {
    return null;
  }
}

function githubContentId(url: URL): string | null {
  const segments = decodedSegments(url);
  if (!segments || segments.length < 2) return null;
  const [owner, repository, route, ...rest] = segments;
  if (!owner || !repository || !GITHUB_NAME.test(owner) || !GITHUB_NAME.test(repository)) return null;
  const source = `${owner.toLowerCase()}/${repository.toLowerCase()}`;
  if (segments.length === 2) return `readme:${source}`;
  if (route === "blob" && rest.length >= 2 && /\.(?:md|markdown)$/i.test(rest.at(-1) ?? "")) {
    return `markdown:${source}:${rest.join("/")}`;
  }
  if (route === "releases" && rest.length === 2 && rest[0] === "tag" && GITHUB_TAG.test(rest[1] ?? "")) {
    return `release:${source}:${rest[1]}`;
  }
  return null;
}

function huggingFaceContentId(url: URL): string | null {
  const segments = decodedSegments(url);
  if (!segments) return null;
  const safe = (value: string | undefined): value is string => !!value && HF_REPOSITORY_SEGMENT.test(value);
  if (segments.length === 2 && segments[0] === "blog" && safe(segments[1])) return `blog:${segments[1]}`;
  if (segments.length === 2 && segments[0] === "papers" && /^\d{4}\.\d{4,5}$/.test(segments[1] ?? "")) {
    return `paper:${segments[1]}`;
  }
  if (segments.length === 3 && segments[0] === "datasets" && safe(segments[1]) && safe(segments[2])) {
    return `dataset:${segments[1].toLowerCase()}/${segments[2].toLowerCase()}`;
  }
  if (segments.length === 2 && safe(segments[0]) && safe(segments[1]) && !HF_RESERVED_ROOTS.has(segments[0].toLowerCase())) {
    return `model:${segments[0].toLowerCase()}/${segments[1].toLowerCase()}`;
  }
  return null;
}

type HuggingFaceRepository = { kind: "model" | "dataset"; id: string };

function huggingFaceRepositoryFor(url: URL): HuggingFaceRepository | null {
  const segments = decodedSegments(url);
  if (!segments) return null;
  const safe = (value: string | undefined): value is string => !!value && HF_REPOSITORY_SEGMENT.test(value);
  if (segments.length === 3 && segments[0] === "datasets" && safe(segments[1]) && safe(segments[2])) {
    return { kind: "dataset", id: `${segments[1]}/${segments[2]}` };
  }
  if (segments.length === 2 && safe(segments[0]) && safe(segments[1]) && !HF_RESERVED_ROOTS.has(segments[0].toLowerCase())) {
    return { kind: "model", id: `${segments[0]}/${segments[1]}` };
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Model and dataset pages can look readable while being private to a signed-in
 * visitor. Only the observed, route-bound Header hydration record is trusted:
 * it is parsed locally, capped at 1 MiB, and never retained in a snapshot.
 * Blog and paper routes have no equivalent source-backed header record.
 */
function huggingFacePublicCheck(reader: PageReader): boolean {
  const repository = huggingFaceRepositoryFor(reader.location);
  if (!repository) return true;
  const target = repository.kind === "model" ? "ModelHeader" : "DatasetHeader";
  const headers = [...new Set(reader.select([`div.SVELTE_HYDRATER.contents[data-target='${target}'][data-props]`]))]
    .filter(node => reader.visible(node));
  if (headers.length !== 1) return false;
  const raw = reader.attribute(headers[0]!, "data-props");
  if (!raw || raw.length > 1_000_000) return false;

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!isRecord(payload)) return false;
  const state = payload[repository.kind];
  return isRecord(state)
    && state.id === repository.id
    && state.repoType === repository.kind
    && state.private === false
    && state.gated === false;
}

function arxivContentId(url: URL): string | null {
  const segments = decodedSegments(url);
  if (!segments || segments.length !== 2 || (segments[0] !== "abs" && segments[0] !== "html")) return null;
  const paperId = segments[1] ?? "";
  return MODERN_ARXIV_BASE_ID.test(paperId) || MODERN_ARXIV_VERSIONED_ID.test(paperId) ? paperId : null;
}

function isArxivAbstractRoute(url: URL): boolean {
  const segments = decodedSegments(url);
  return !!segments && segments.length === 2 && segments[0] === "abs" && arxivContentId(url) !== null;
}

function arxivPdfMatches(target: URL, asset: URL): boolean {
  const targetId = arxivContentId(target);
  if (!targetId || asset.protocol !== "https:" || asset.hostname !== "arxiv.org" || asset.search || asset.hash) return false;
  const match = /^\/pdf\/(\d{4}\.\d{4,5})(v[1-9]\d*)?$/.exec(asset.pathname);
  if (!match) return false;
  const [, assetBase, assetVersion] = match;
  const explicit = MODERN_ARXIV_VERSIONED_ID.exec(targetId);
  // A versioned target is immutable: it can select only its same-version PDF.
  if (explicit) return assetBase === explicit[1] && assetVersion === targetId.slice(explicit[1]!.length);
  // An unversioned official entry describes arXiv's current paper. Its one
  // route-specific download button may expose either `/pdf/:id` or the
  // current explicit version; a cited PDF cannot pass the same-base check.
  return assetBase === targetId;
}

/**
 * First-party, single-content technical sources supported from reproducible
 * public HTML observations. Only the narrow routes with fresh browser DOM
 * boundaries below opt into a completion plan; all remaining route families
 * stay extraction-only until equivalent evidence exists.
 */
export const RESEARCH_SPECS: readonly PlatformSpec[] = [
  {
    rule: rule({
      id: "github",
      hosts: ["github.com"],
      patterns: ["/:owner/:repo", "/:owner/:repo/blob/:ref/:path.md", "/:owner/:repo/releases/tag/:tag"],
      contentTypes: ["article", "mixed"],
      defaultType: "article",
      contentId: githubContentId,
      selectors: plan({
        roots: [
          GITHUB_README_ROOT,
          "div[data-pjax='true'][data-test-selector='body-content'].markdown-body",
        ],
        title: [
          "article.markdown-body.entry-content.container-lg h1",
          "div[data-pjax='true'][data-test-selector='body-content'].markdown-body h1",
          "div[data-pjax='true'][data-test-selector='body-content'].markdown-body h2",
        ],
        authors: [],
        published: [],
        images: [
          "article.markdown-body.entry-content.container-lg img",
          "div[data-pjax='true'][data-test-selector='body-content'].markdown-body img",
        ],
        videos: [
          "article.markdown-body.entry-content.container-lg video",
          "div[data-pjax='true'][data-test-selector='body-content'].markdown-body video",
        ],
        audio: [],
        subtitles: ["article.markdown-body track[kind='captions']", "article.markdown-body track[kind='subtitles']"],
        // Release assets are outside the selected release-note body. No file
        // selector means a GitHub page cannot download an executable or a
        // repository archive merely because it is linked from prose.
        files: [],
        cover: [],
      }),
      // Only the live-observed repository README root has a bounded tail,
      // root-local error check, and media occurrence record. Markdown blobs
      // and release notes keep their existing extraction behavior but cannot
      // inherit this proof.
      completion: [{
        id: "github.public-readme.markdown-root.v1",
        content_types: ["article"],
        applies: url => githubContentId(url)?.startsWith("readme:") === true,
        content_root: GITHUB_README_ROOT,
        boundary: { type: "root_exhausted" },
        pending_or_truncation: GITHUB_README_PENDING_OR_ERROR,
        stability: { sample_count: 2, minimum_window_ms: 700 },
      }],
      access: {
        ...DEFAULT_ACCESS,
        public_marker: { selectors: GITHUB_PUBLIC_MARKERS, text: "Public" },
      },
    }),
    // GitHub-hosted relative README images resolve on github.com. External
    // badge proxies and arbitrary linked hosts remain intentionally blocked.
    asset_hosts: ["github.com", "camo.githubusercontent.com"],
    engine: "browser",
    status: "experimental",
    coverage: baselineCoverage(
      "unverified",
      "Public README, Markdown-document, and tagged-release HTML roots were observed over HTTP. The README has a route-specific proof candidate that still needs a fresh browser stable capture; Markdown documents and releases remain extraction-only, and release-asset collection is disabled.",
    ),
  },
  {
    rule: rule({
      id: "huggingface",
      hosts: ["huggingface.co"],
      patterns: ["/:namespace/:repository", "/datasets/:namespace/:repository", "/blog/:slug", "/papers/:arxivId"],
      contentTypes: ["article", "mixed"],
      defaultType: "article",
      contentId: huggingFaceContentId,
      selectors: plan({
        roots: [
          HF_MODEL_ROOT,
          HF_DATASET_ROOT,
          HF_BLOG_BODY,
          HF_PAPER_BODY,
        ],
        // The selected blog/paper body deliberately excludes header and UI,
        // while this uniquely containing source scope retains their title,
        // author line, and date without falling through to a sidebar.
        metadata_roots: [
          HF_MODEL_ROOT,
          HF_DATASET_ROOT,
          HF_BLOG_SHELL,
          HF_PAPER_SECTION,
        ],
        title: [
          `${HF_MODEL_ROOT} h1`,
          `${HF_DATASET_ROOT} h1`,
          `${HF_BLOG_SHELL} > h1`,
          `${HF_PAPER_HEADER} h1.mb-2`,
        ],
        authors: [
          `${HF_BLOG_SHELL} > div.not-prose:not(.mb-6) a[href^='/']`,
          `${HF_PAPER_HEADER} div.relative.flex.flex-wrap.items-center.gap-2.text-base.leading-tight > div.relative`,
        ],
        published: [
          `${HF_BLOG_SHELL} > h1 + div > div.mb-6`,
          `${HF_PAPER_HEADER} div.mb-6.flex.flex-wrap.gap-2.text-sm.text-gray-500 > div`,
        ],
        images: [
          `${HF_MODEL_ROOT} img`,
          `${HF_DATASET_ROOT} img`,
          `${HF_BLOG_BODY} img`,
        ],
        videos: [`${HF_BLOG_BODY} video`],
        audio: [],
        subtitles: [`${HF_BLOG_BODY} video track[kind='captions']`, `${HF_BLOG_BODY} video track[kind='subtitles']`],
        // Model/data-file and paper links are documentation references, not
        // requested content assets. The adapter never downloads weights,
        // datasets, files-tree entries, or arbitrary linked papers.
        files: [],
        cover: [],
        excluded: [
          `${HF_BLOG_SHELL} > div.mb-4`,
          `${HF_BLOG_SHELL} > div.not-prose.mb-6`,
          HF_PAPER_GENERATED_SUMMARY,
        ],
      }),
      // Each completion plan is bound to its own route, public header, and
      // observed documentation root. Dataset viewers, file trees, and data
      // downloads are siblings of the card root and cannot inherit its proof.
      // Blogs deliberately retain no completion boundary.
      completion: [
        {
          id: "huggingface.model.public-card-root.v1",
          content_types: ["article"],
          applies: url => huggingFaceRepositoryFor(url)?.kind === "model",
          content_root: HF_MODEL_ROOT,
          boundary: { type: "root_exhausted" },
          pending_or_truncation: ROOT_PENDING_OR_TRUNCATION,
          stability: { sample_count: 2, minimum_window_ms: 700 },
        },
        {
          id: "huggingface.dataset.public-card-root.v1",
          content_types: ["article"],
          applies: url => huggingFaceRepositoryFor(url)?.kind === "dataset",
          content_root: HF_DATASET_ROOT,
          boundary: { type: "root_exhausted" },
          pending_or_truncation: ROOT_PENDING_OR_TRUNCATION,
          stability: { sample_count: 2, minimum_window_ms: 700 },
        },
        {
          id: "huggingface.paper.abstract-root.v1",
          content_types: ["article"],
          applies: url => huggingFaceContentId(url)?.startsWith("paper:") === true,
          content_root: HF_PAPER_BODY,
          boundary: { type: "root_exhausted" },
          pending_or_truncation: ROOT_PENDING_OR_TRUNCATION,
          stability: { sample_count: 2, minimum_window_ms: 700 },
        },
      ],
      access: { ...DEFAULT_ACCESS, public_check: huggingFacePublicCheck },
    }),
    asset_hosts: ["huggingface.co", "cdn-media.huggingface.co"],
    engine: "browser",
    status: "experimental",
    coverage: baselineCoverage(
      "unverified",
      "Public model-card, dataset-card, official blog, and single-paper-detail HTML roots were observed over HTTP. Model cards, dataset cards, and the single-paper Abstract have separate route-specific proof candidates that each still need a fresh browser stable capture; blogs remain extraction-only, and file/data/weight downloads are disabled.",
    ),
  },
  {
    rule: rule({
      id: "arxiv",
      hosts: ["arxiv.org"],
      patterns: ["/abs/:paperId[ vN]", "/html/:paperId[ vN]"],
      contentTypes: ["article", "mixed"],
      defaultType: "article",
      contentId: arxivContentId,
      file_matches: arxivPdfMatches,
      selectors: plan({
        roots: ["#abs", "article.ltx_document"],
        title: ["#abs h1.title", "article.ltx_document h1.ltx_title_document"],
        // The HTML-paper container also includes affiliation, contribution,
        // and email notes. Its observed individual person nodes are bounded
        // names and fit the bridge author-field limit.
        authors: ["#abs div.authors", "article.ltx_document div.ltx_authors .ltx_personname"],
        // LaTeXML appends an observed footnote-marker descendant to some
        // otherwise clean person-name nodes. Omit that descendant only while
        // deriving authors; it must not change body text or numeric prose.
        author_excluded: ["article.ltx_document div.ltx_authors .ltx_personname > .ltx_note.ltx_role_footnotemark"],
        // Version is preserved in the explicit route/content ID. The visible
        // dateline is not a normalized publication timestamp, so it is not
        // misreported as published_at.
        published: [],
        images: ["article.ltx_document img"],
        videos: [],
        audio: [],
        subtitles: [],
        cover: [],
        // The abstract view's direct mobile PDF link and the HTML view's
        // header Download PDF link are route-exclusive. Current desktop abs
        // pages instead expose the same paper's visible action below their
        // exact Access Paper services branch. Do not use a broad PDF
        // selector: an abs page also mounts a duplicate sidebar button.
        files: [
          "#abs > a.mobile-submission-download[href^='/pdf/']",
          "#abs-outer > .extra-services > .full-text > ul > li > a.abs-button.download-pdf[href^='/pdf/']",
          "nav.html-header-nav > a.header-button[title='Download PDF'][href^='/pdf/']",
        ],
        // On HTML pages the full paper root and the separately mounted PDF
        // link are siblings; all selectors themselves retain their exact
        // source ancestor, and file_matches admits only the current version.
        asset_scope: "document",
        excluded: [
          // These controls describe the PDF action rather than paper prose.
          "#abs #download-button-info",
          // Preserve comments, subjects, citation and DOI; omit only the
          // observed focus tooltip/control inside the metadata table.
          "#abs .metatable .button-and-tooltip",
          "#abs .metatable [id^='more-info-desc-']",
        ],
      }),
      // The observed abstract root is bounded separately from its one visible
      // same-paper PDF action. The shared external-attachment proof keeps the
      // PDF out of body order while requiring it for this route's completion.
      completion: [{
        id: "arxiv.abs.source-root.external-pdf.v1",
        content_types: ["article"],
        applies: isArxivAbstractRoute,
        content_root: "#abs",
        boundary: { type: "root_exhausted" },
        pending_or_truncation: ROOT_PENDING_OR_TRUNCATION,
        external_file_attachment: true,
        stability: { sample_count: 2, minimum_window_ms: 700 },
      }],
    }),
    asset_hosts: ["arxiv.org"],
    required_document_components: ["files"],
    engine: "browser",
    status: "experimental",
    coverage: baselineCoverage(
      "unverified",
      "Versioned abstract and HTML-paper roots plus the same-version original PDF link were observed over HTTP. Abstract-page proof requires the exact external same-paper PDF and a fresh stable browser capture; HTML-paper pages remain extraction-only.",
    ),
  },
];
