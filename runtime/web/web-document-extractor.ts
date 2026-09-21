import { Readability } from "@mozilla/readability";
import type { ContentBlock, SourceAsset } from "../../shared/contracts.js";

export type WebHtmlExtraction = {
  title: string;
  authors: string[];
  published_at: string | null;
  blocks: ContentBlock[];
  assets: SourceAsset[];
  warnings: string[];
  extraction: "readability" | "full_page";
};

export type WebHtmlExtractionErrorCode = "ACCESS_NOT_PUBLIC" | "CONTENT_NOT_FOUND";

/** A bounded classification for HTTP pages that must not become source prose. */
export class WebHtmlExtractionError extends Error {
  constructor(readonly code: WebHtmlExtractionErrorCode, message: string) {
    super(message);
    this.name = "WebHtmlExtractionError";
  }
}

type ConvertedPage = Pick<WebHtmlExtraction, "blocks" | "assets" | "warnings">;
type StructureCounts = { code: number; table: number; image: number; math: number };

const MAX_BLOCKS = 20_000;
const MAX_ASSETS = 2_000;
const MAX_TEXT = 100_000;
const MAX_TITLE = 2_000;
const MAX_AUTHORS = 100;
const MAX_AUTHOR = 400;
const MAX_PUBLISHED = 80;
const MAX_TABLE_ROWS = 1_000;
const MAX_TABLE_CELLS = 100;

const SKIP_TAGS = new Set([
  "script", "style", "noscript", "template", "canvas", "form", "button", "input", "select", "textarea", "dialog",
]);
const BLOCK_TAGS = new Set([
  "article", "aside", "div", "dl", "dt", "dd", "figure", "figcaption", "footer", "header", "main", "nav", "section", "summary",
  "p", "blockquote", "pre", "table", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "picture", "img", "hr",
]);
const SENSITIVE_QUERY_KEY = /(?:token|signature|sig|sign|auth|session|cookie|xsec|credential|key|nonce|expires?|timestamp)/i;
const TRACKING_QUERY_KEY = /^(?:utm_[^=]*|fbclid|gclid|igshid|mkt_tok|ref|source|spm|share_source|share_token)$/i;

function normalize(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
}

function boundedText(value: string, max = MAX_TEXT): string {
  return normalize(value).slice(0, max);
}

function addWarning(warnings: Set<string>, warning: string): void {
  if (warnings.size < 1_000) warnings.add(warning.slice(0, 2_000));
}

function safeHttpUrl(value: string | null | undefined, base: URL): URL | undefined {
  if (!value?.trim()) return undefined;
  try {
    const resolved = new URL(value.trim(), base);
    if ((resolved.protocol !== "http:" && resolved.protocol !== "https:") || resolved.username || resolved.password) return undefined;
    return resolved;
  } catch {
    return undefined;
  }
}

/** Keep reference links useful while excluding obvious credential-bearing query values. */
function publicReferenceUrl(url: URL): string {
  const clean = new URL(url.href);
  clean.username = "";
  clean.password = "";
  for (const key of [...clean.searchParams.keys()]) {
    if (SENSITIVE_QUERY_KEY.test(key) || TRACKING_QUERY_KEY.test(key)) clean.searchParams.delete(key);
  }
  return clean.href;
}

function isHidden(element: Element): boolean {
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (current.hasAttribute("hidden") || current.getAttribute("aria-hidden") === "true") return true;
    const style = current.getAttribute("style") ?? "";
    if (/(?:^|;)\s*display\s*:\s*none\b/i.test(style) || /(?:^|;)\s*visibility\s*:\s*hidden\b/i.test(style)) return true;
    const computed = current.ownerDocument.defaultView?.getComputedStyle(current);
    if (computed?.display === "none" || computed?.visibility === "hidden") return true;
  }
  return false;
}

function visibleElements(root: ParentNode, selector: string): Element[] {
  return [...root.querySelectorAll(selector)].filter(element => !isHidden(element));
}

function imageSourceFromAttributes(element: Element, base: URL): URL | undefined {
  for (const attribute of ["data-original", "data-actualsrc", "data-src", "data-lazy-src"]) {
    const url = safeHttpUrl(element.getAttribute(attribute), base);
    if (url) return url;
  }
  for (const attribute of ["data-srcset", "srcset"]) {
    const srcset = element.getAttribute(attribute);
    if (!srcset) continue;
    const selected = bestSrcsetUrl(srcset, base);
    if (selected) return selected;
  }
  return safeHttpUrl(element.getAttribute("src"), base);
}

type SrcsetCandidate = { value: string; descriptor?: string; index: number };

/** Parse descriptor-delimited srcset values without splitting literal URL commas. */
function srcsetCandidates(srcset: string): SrcsetCandidate[] {
  const candidates: SrcsetCandidate[] = [];
  let cursor = 0;
  const whitespace = (value: string | undefined): boolean => !!value && /\s/.test(value);
  const looksLikeUrl = (offset: number): boolean => /^(?:https?:\/\/|\/\/|\/|\.\/|\.\.\/)/.test(srcset.slice(offset));
  while (cursor < srcset.length) {
    while (whitespace(srcset[cursor]) || srcset[cursor] === ",") cursor++;
    if (cursor >= srcset.length) break;
    const start = cursor;
    let noDescriptorBoundary: number | undefined;
    while (cursor < srcset.length && !whitespace(srcset[cursor])) {
      if (srcset[cursor] === ",") {
        let next = cursor + 1;
        while (whitespace(srcset[next])) next++;
        if (next > cursor + 1 && looksLikeUrl(next)) {
          noDescriptorBoundary = next;
          break;
        }
      }
      cursor++;
    }
    if (noDescriptorBoundary !== undefined) {
      const value = srcset.slice(start, cursor).trim();
      if (value) candidates.push({ value, index: candidates.length });
      cursor = noDescriptorBoundary;
      continue;
    }
    const value = srcset.slice(start, cursor).trim();
    while (whitespace(srcset[cursor])) cursor++;
    const descriptorStart = cursor;
    while (cursor < srcset.length && srcset[cursor] !== ",") cursor++;
    const descriptor = srcset.slice(descriptorStart, cursor).trim();
    if (value) candidates.push({ value, ...(descriptor ? { descriptor } : {}), index: candidates.length });
    if (srcset[cursor] === ",") cursor++;
  }
  return candidates;
}

function bestSrcsetUrl(srcset: string, base: URL): URL | undefined {
  const candidates = srcsetCandidates(srcset)
    .map(candidate => {
      const size = candidate.descriptor?.split(/\s+/).find(token => /^\d+(?:\.\d+)?[wx]$/.test(token));
      return { candidate, score: size ? Number.parseFloat(size) : candidate.index };
    })
    .sort((left, right) => right.score - left.score);
  for (const { candidate } of candidates) {
    const url = safeHttpUrl(candidate.value, base);
    if (url) return url;
  }
  return undefined;
}

function imageSource(image: HTMLImageElement, base: URL): URL | undefined {
  const picture = image.parentElement?.tagName.toLowerCase() === "picture" ? image.parentElement : undefined;
  if (picture) {
    const fallbackImages = [...picture.children].filter(child => child.tagName.toLowerCase() === "img");
    // A `<source>` rendition belongs to a picture only when its single fallback
    // image makes that association unambiguous. Otherwise use each img's own URL.
    if (fallbackImages.length === 1) {
      for (const child of picture.children) {
        if (child.tagName.toLowerCase() !== "source") continue;
        const source = imageSourceFromAttributes(child, base);
        if (source) return source;
      }
    }
  }
  return imageSourceFromAttributes(image, base);
}

function mathValue(element: Element, truncated?: () => void): { text: string; format: "latex" | "text" } | undefined {
  const limit = (value: string): string => {
    const normalized = normalize(value);
    if (normalized.length > MAX_TEXT) truncated?.();
    return normalized.slice(0, MAX_TEXT);
  };
  const direct = element.getAttribute("data-tex") ?? element.getAttribute("alttext");
  if (direct?.trim()) return { text: limit(direct), format: "latex" };
  const annotation = element.querySelector("annotation[encoding*='tex' i], annotation[encoding='application/x-tex' i]");
  if (annotation?.textContent?.trim()) return { text: limit(annotation.textContent), format: "latex" };
  const className = typeof (element as HTMLElement).className === "string" ? (element as HTMLElement).className : "";
  if (element.tagName.toLowerCase() === "math" || /(?:^|\s)(?:katex|mathjax|math)(?:\s|$)/i.test(className)) {
    const text = limit(element.textContent ?? "");
    if (text) return { text, format: "text" };
  }
  return undefined;
}

function isMathElement(element: Element): boolean {
  return !!mathValue(element);
}

function languageForCode(element: Element): string | undefined {
  const candidate = [element, element.querySelector("code")]
    .flatMap(node => node ? [...node.classList] : [])
    .map(token => /^(?:language-|lang-)([A-Za-z0-9_+.-]{1,40})$/.exec(token)?.[1])
    .find(Boolean);
  return candidate;
}

function tableFromElement(table: HTMLTableElement, truncated: () => void): Extract<ContentBlock, { type: "table" }> | undefined {
  if (table.rows.length > MAX_TABLE_ROWS) truncated();
  const rows = [...table.rows].slice(0, MAX_TABLE_ROWS).map(row => {
    if (row.cells.length > MAX_TABLE_CELLS) truncated();
    return [...row.cells].slice(0, MAX_TABLE_CELLS).map(cell => {
      const raw = normalize(cell.textContent ?? "");
      if (raw.length > MAX_TEXT) truncated();
      return {
        text: raw.slice(0, MAX_TEXT),
        header: cell.tagName.toLowerCase() === "th",
        ...(cell.colSpan > 1 ? { colspan: cell.colSpan } : {}),
        ...(cell.rowSpan > 1 ? { rowspan: cell.rowSpan } : {}),
      };
    });
  }).filter(row => row.length > 0);
  if (!rows.length) return undefined;
  const rawCaption = normalize(table.querySelector(":scope > caption")?.textContent ?? "");
  if (rawCaption.length > MAX_TEXT) truncated();
  const caption = rawCaption.slice(0, MAX_TEXT);
  return { type: "table", ...(caption ? { caption } : {}), rows };
}

function directFigureCaption(image: HTMLImageElement, root: Element, truncated?: () => void): string | undefined {
  let current: Element | null = image.parentElement;
  while (current && current !== root.parentElement) {
    if (current.tagName.toLowerCase() === "figure") {
      const caption = [...current.children].find(child => child.tagName.toLowerCase() === "figcaption");
      const raw = normalize(caption?.textContent ?? "");
      if (raw.length > 2_000) truncated?.();
      const value = raw.slice(0, 2_000);
      return value || undefined;
    }
    current = current.parentElement;
  }
  return undefined;
}

function appendReference(text: string, anchor: HTMLAnchorElement, base: URL): string {
  const target = safeHttpUrl(anchor.getAttribute("href"), base);
  if (!target) return text;
  const reference = publicReferenceUrl(target);
  return text.trim() ? `${text} (${reference})` : reference;
}

function inlineText(node: Node, base: URL): string {
  if (node.nodeType === node.TEXT_NODE) return node.textContent ?? "";
  if (node.nodeType !== node.ELEMENT_NODE) return "";
  const element = node as Element;
  if (isHidden(element) || SKIP_TAGS.has(element.tagName.toLowerCase())) return "";
  const tag = element.tagName.toLowerCase();
  if (tag === "br") return "\n";
  if (tag === "img" || tag === "picture" || tag === "source") return "";
  const math = mathValue(element);
  if (math) return ` \\(${math.text}\\) `;
  let value = "";
  for (const child of element.childNodes) value += inlineText(child, base);
  if (tag === "a") return appendReference(value, element as HTMLAnchorElement, base);
  return value;
}

function hasRichDescendant(element: Element): boolean {
  return [...element.children].some(child => {
    const tag = child.tagName.toLowerCase();
    return tag === "img" || tag === "picture" || tag === "pre" || tag === "table" || tag === "blockquote" || tag === "ul" || tag === "ol" || isMathElement(child) || hasRichDescendant(child);
  });
}

function convertRoot(root: Element, base: URL): ConvertedPage {
  const blocks: ContentBlock[] = [];
  const assets: SourceAsset[] = [];
  const warningSet = new Set<string>();
  const emittedImages = new Set<HTMLImageElement>();
  let limited = false;
  const bodyText = (value: string): string => {
    const normalized = normalize(value);
    if (normalized.length > MAX_TEXT) limited = true;
    return normalized.slice(0, MAX_TEXT);
  };

  const canAddBlock = (): boolean => {
    if (blocks.length < MAX_BLOCKS) return true;
    limited = true;
    return false;
  };
  const emitBlock = (block: ContentBlock): void => { if (canAddBlock()) blocks.push(block); };
  const emitParagraph = (type: "paragraph" | "quote", value: string): void => {
    const text = bodyText(value);
    if (text) emitBlock({ type, text });
  };
  const emitImage = (image: HTMLImageElement): void => {
    if (emittedImages.has(image) || isHidden(image)) return;
    emittedImages.add(image);
    const source = imageSource(image, base);
    if (!source) {
      addWarning(warningSet, "asset:image:non_http_or_missing_source");
      return;
    }
    if (assets.length >= MAX_ASSETS) {
      limited = true;
      return;
    }
    const fallbackRaw = normalize(image.getAttribute("alt") ?? image.getAttribute("title") ?? "");
    if (fallbackRaw.length > 2_000) limited = true;
    const fallbackCaption = fallbackRaw.slice(0, 2_000) || undefined;
    const caption = directFigureCaption(image, root, () => { limited = true; }) ?? fallbackCaption;
    const asset: SourceAsset = {
      id: `web:image:${String(assets.length + 1).padStart(4, "0")}`,
      role: "image",
      url: source.href,
      source_url: publicReferenceUrl(base),
      order: assets.length + 1,
      ...(caption ? { title: caption } : {}),
      availability: "available",
    };
    assets.push(asset);
    emitBlock({ type: "image", asset_id: asset.id, ...(caption ? { caption } : {}) });
  };

  const walkInlineContainer = (element: Element, type: "paragraph" | "quote"): void => {
    let buffer = "";
    const flush = (): void => { emitParagraph(type, buffer); buffer = ""; };
    const walkInline = (node: Node): void => {
      if (node.nodeType === node.TEXT_NODE) {
        buffer += node.textContent ?? "";
        return;
      }
      if (node.nodeType !== node.ELEMENT_NODE) return;
      const child = node as Element;
      if (isHidden(child) || SKIP_TAGS.has(child.tagName.toLowerCase())) return;
      const tag = child.tagName.toLowerCase();
      if (tag === "img") { flush(); emitImage(child as HTMLImageElement); return; }
      if (tag === "picture") {
        const images = [...child.children].filter(candidate => candidate.tagName.toLowerCase() === "img") as HTMLImageElement[];
        if (images.length === 1) { flush(); emitImage(images[0]!); return; }
        for (const image of images) { flush(); emitImage(image); }
        return;
      }
      if (tag === "pre" || tag === "table" || tag === "blockquote" || tag === "ul" || tag === "ol" || isMathElement(child)) {
        flush();
        walkElement(child);
        return;
      }
      if (tag === "br") { buffer += "\n"; return; }
      buffer += inlineText(child, base);
    };
    for (const child of element.childNodes) walkInline(child);
    flush();
  };

  const walkContainer = (element: Element): void => {
    let loose = "";
    const flush = (): void => { emitParagraph("paragraph", loose); loose = ""; };
    for (const child of element.childNodes) {
      if (child.nodeType === child.TEXT_NODE) {
        loose += child.textContent ?? "";
        continue;
      }
      if (child.nodeType !== child.ELEMENT_NODE) continue;
      const nested = child as Element;
      if (isHidden(nested) || SKIP_TAGS.has(nested.tagName.toLowerCase())) continue;
      const tag = nested.tagName.toLowerCase();
      if (BLOCK_TAGS.has(tag) || isMathElement(nested) || hasRichDescendant(nested)) {
        flush();
        walkElement(nested);
      } else {
        loose += inlineText(nested, base);
      }
    }
    flush();
  };

  const walkElement = (element: Element): void => {
    if (isHidden(element)) return;
    const tag = element.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return;
    if (tag === "img") { emitImage(element as HTMLImageElement); return; }
    if (tag === "picture") {
      const images = [...element.children].filter(child => child.tagName.toLowerCase() === "img") as HTMLImageElement[];
      if (images.length === 1) emitImage(images[0]!);
      else for (const image of images) emitImage(image);
      return;
    }
    const math = mathValue(element, () => { limited = true; });
    if (math) { emitBlock({ type: "math", ...math }); return; }
    if (tag === "pre") {
      const source = element.textContent ?? "";
      if (source.length > MAX_TEXT) limited = true;
      const raw = source.slice(0, MAX_TEXT);
      if (raw.trim()) emitBlock({ type: "code", text: raw, ...(languageForCode(element) ? { language: languageForCode(element) } : {}) });
      return;
    }
    if (tag === "table") {
      const table = tableFromElement(element as HTMLTableElement, () => { limited = true; });
      if (table) emitBlock(table);
      return;
    }
    if (/^h[1-6]$/.test(tag)) {
      const text = bodyText(inlineText(element, base));
      if (text) emitBlock({ type: "heading", level: Number(tag[1]) as 1 | 2 | 3 | 4 | 5 | 6, text });
      return;
    }
    if (tag === "blockquote") { walkInlineContainer(element, "quote"); return; }
    if (tag === "ul" || tag === "ol") {
      const items = [...element.children].filter(child => child.tagName.toLowerCase() === "li");
      if (items.some(hasRichDescendant)) {
        for (const item of items) walkElement(item);
        return;
      }
      const values = items.map(item => bodyText(inlineText(item, base))).filter(Boolean);
      if (values.length) emitBlock({ type: "list", ordered: tag === "ol", items: values });
      return;
    }
    if (tag === "figcaption") {
      const figure = element.parentElement?.tagName.toLowerCase() === "figure" ? element.parentElement : undefined;
      if (figure?.querySelector("img")) return;
      walkInlineContainer(element, "paragraph");
      return;
    }
    if (tag === "p" || tag === "summary" || tag === "li") { walkInlineContainer(element, "paragraph"); return; }
    walkContainer(element);
  };

  walkElement(root);
  if (limited) addWarning(warningSet, "content_truncated:limits");
  return { blocks, assets, warnings: [...warningSet] };
}

function primaryScopes(document: Document): Element[] {
  const candidates = visibleElements(document, "main, article, [role='main']");
  return candidates.filter(candidate => !candidates.some(other => other !== candidate && other.contains(candidate)));
}

/** Prefer one semantic current-page container over the entire body. */
function primaryContentRoot(document: Document): Element | undefined {
  const score = (scope: Element): number => {
    const text = Math.min(normalize(scope.textContent ?? "").length, MAX_TEXT);
    const structures = scope.querySelectorAll("p, pre, table, blockquote, img").length;
    return text + structures * 100;
  };
  return primaryScopes(document).sort((left, right) => score(right) - score(left))[0];
}

function structureCounts(root: ParentNode, base: URL): StructureCounts {
  const nodeType = (root as Node).nodeType;
  const rootElement = nodeType === 1 ? root as Element : undefined;
  const scopes = rootElement && (/^(?:main|article)$/i.test(rootElement.tagName) || rootElement.getAttribute("role") === "main")
    ? [rootElement]
    : nodeType === 9 ? (primaryContentRoot(root as Document) ? [primaryContentRoot(root as Document)!] : []) : [];
  const contained = (selector: string): Element[] => {
    const all = new Set<Element>();
    for (const scope of scopes) for (const node of visibleElements(scope, selector)) all.add(node);
    return [...all];
  };
  return {
    code: contained("pre").filter(node => !!node.textContent?.trim()).length,
    table: contained("table").filter(node => (node as HTMLTableElement).rows.length > 0).length,
    image: contained("img").filter(node => imageSource(node as HTMLImageElement, base) !== undefined).length,
    math: contained("math, [data-tex], [alttext], .katex, .MathJax").filter(node => isMathElement(node)).length,
  };
}

function readabilityDroppedStructuredContent(document: Document, readableRoot: Element, base: URL): boolean {
  const source = structureCounts(document, base);
  if (!source.code && !source.table && !source.image && !source.math) return false;
  const extracted = structureCounts(readableRoot, base);
  return source.code > extracted.code || source.table > extracted.table || source.image > extracted.image || source.math > extracted.math;
}

function visibleSemanticContent(document: Document, base: URL): boolean {
  const root = primaryContentRoot(document) ?? document.body;
  if (!root) return false;
  const blocks = visibleElements(root, "p, pre, table, blockquote, li, img");
  const readable = blocks.filter(node => {
    if (node.tagName.toLowerCase() === "img") return imageSource(node as HTMLImageElement, base) !== undefined;
    return (node.textContent ?? "").trim().length >= 20;
  });
  return readable.length > 0;
}

function hasExplicitAccessBarrier(document: Document, base: URL): boolean {
  const title = normalize(document.title).toLowerCase();
  const barrierTitle = /^(?:just a moment(?:\.\.\.)?|checking (?:your )?browser|attention required|access denied|verify you are human|please wait(?:\.\.\.)?|subscribe to continue)$/i.test(title)
    || /^(?:sign in|log in|login)(?:\s*[|·—–-].*)?$/i.test(title);
  const password = document.querySelector("input[type='password']");
  const captcha = document.querySelector("iframe[src*='captcha' i], [data-sitekey], input[name*='captcha' i]");
  // Gate pages often contain a logo or a full explanatory paragraph. Those
  // semantic elements must not make an explicit gate title look like an article.
  return barrierTitle || (!visibleSemanticContent(document, base) && (!!password || !!captcha));
}

function pageTitle(document: Document, readableTitle?: string | null): string {
  const meta = document.querySelector("meta[property='og:title'], meta[name='twitter:title']")?.getAttribute("content");
  const heading = document.querySelector("h1")?.textContent;
  return boundedText(readableTitle ?? meta ?? heading ?? document.title ?? "", MAX_TITLE);
}

function unique(values: readonly string[], max: number, itemMax: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = boundedText(value, itemMax);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= max) break;
  }
  return result;
}

function authors(document: Document, byline?: string | null): string[] {
  const meta = [...document.querySelectorAll("meta[name='author'], meta[property='article:author']")]
    .map(node => node.getAttribute("content") ?? "");
  const bylineValues = byline ? byline.split(/[,;、]+/) : [];
  return unique([...meta, ...bylineValues], MAX_AUTHORS, MAX_AUTHOR);
}

function publishedAt(document: Document, value?: string | null): string | null {
  const meta = document.querySelector("meta[property='article:published_time'], meta[name='date'], meta[name='publish-date']")?.getAttribute("content");
  // Unlabelled time elements often belong to related cards or update banners.
  // Only parser-proven publication metadata may populate this field.
  const result = boundedText(value ?? meta ?? "", MAX_PUBLISHED);
  return result || null;
}

function hasReadableOutput(converted: ConvertedPage): boolean {
  return converted.blocks.length > 0 || converted.assets.length > 0;
}

function readabilityRoot(document: Document, content: string, base: URL): Element | undefined {
  const detached = document.implementation.createHTMLDocument("Babel extracted page");
  const baseElement = detached.createElement("base");
  baseElement.href = base.href;
  detached.head.append(baseElement);
  const root = detached.createElement("article");
  // Assigning fetched source markup never executes scripts. All source scripts
  // are skipped during the later structural walk as defense in depth.
  root.innerHTML = content;
  detached.body.append(root);
  return root;
}

/**
 * Convert one already-fetched public HTML document without executing page code,
 * loading subresources, following links, or asserting whole-document completeness.
 * `extractWebHtml` supplies the Node/JSDOM wrapper for this browser-reusable core.
 */
export function extractWebDocument(document: Document, inputUrl: string | URL): WebHtmlExtraction {
  let pageUrl: URL;
  try {
    pageUrl = new URL(inputUrl.toString());
  } catch {
    throw new WebHtmlExtractionError("CONTENT_NOT_FOUND", "The fetched page has no valid public URL.");
  }
  if (pageUrl.protocol !== "http:" && pageUrl.protocol !== "https:") {
    throw new WebHtmlExtractionError("CONTENT_NOT_FOUND", "The fetched page has no valid public URL.");
  }
  if (hasExplicitAccessBarrier(document, pageUrl)) {
    throw new WebHtmlExtractionError("ACCESS_NOT_PUBLIC", "The fetched page is an access gate, not readable public content.");
  }
  if (!visibleSemanticContent(document, pageUrl)) {
    throw new WebHtmlExtractionError("CONTENT_NOT_FOUND", "The fetched page contains no readable current-page content.");
  }
  const fallbackRoot = primaryContentRoot(document) ?? document.body;
  const fullPage = fallbackRoot ? convertRoot(fallbackRoot, pageUrl) : { blocks: [], assets: [], warnings: [] };
  if (!hasReadableOutput(fullPage)) {
    throw new WebHtmlExtractionError("CONTENT_NOT_FOUND", "The fetched page contains no readable current-page content.");
  }

  let parsed: ReturnType<Readability["parse"]>;
  try {
    parsed = new Readability(document.cloneNode(true) as Document, { maxElemsToParse: 50_000, keepClasses: true }).parse();
  } catch {
    parsed = null;
  }
  const readable = parsed?.content ? readabilityRoot(document, parsed.content, pageUrl) : undefined;
  const readablePage = readable ? convertRoot(readable, pageUrl) : undefined;
  const fallbackReason = !readablePage || !hasReadableOutput(readablePage)
    ? "readability_unavailable"
    : readabilityDroppedStructuredContent(document, readable!, pageUrl)
      ? "readability_omitted_structured_content"
      : undefined;
  const selected = fallbackReason ? fullPage : readablePage!;
  const warnings = new Set(selected.warnings);
  // Detect embedded content before Readability can discard it. Discovery does
  // not authorize fetching or executing an embed; media-capable routes decide.
  if (fallbackRoot && visibleElements(fallbackRoot, "audio, video, iframe, object, embed").length > 0) {
    addWarning(warnings, "media:embedded_content");
  }
  if (fallbackRoot && (fallbackRoot.matches("[aria-busy='true'], [data-loading='true']")
    || visibleElements(fallbackRoot, "[aria-busy='true'], [data-loading='true']").length > 0)) {
    addWarning(warnings, "content_pending:dom");
  }
  if (fallbackReason) addWarning(warnings, fallbackReason);
  return {
    title: pageTitle(document, parsed?.title),
    authors: authors(document, parsed?.byline),
    published_at: publishedAt(document, parsed?.publishedTime),
    blocks: selected.blocks,
    assets: selected.assets,
    warnings: [...warnings],
    extraction: fallbackReason ? "full_page" : "readability",
  };
}
