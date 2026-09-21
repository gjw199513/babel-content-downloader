import type { BrowserObservation, CaptureRequest } from "../../shared/bridge-protocol.js";
import type { ContentBlock, ContentSnapshot, SourceAsset } from "../../shared/contracts.js";
import { publicReferenceUrl } from "../../adapters/shared-extractors/url.js";
import { extractWebDocument } from "../../runtime/web/web-document-extractor.js";

export const WEB_DOCUMENT_ADAPTER_VERSION = "1";
export const WEB_DOCUMENT_RULE_ID = "web_page.browser-document.v1";

type UrlWebDocumentCaptureRequest = CaptureRequest & {
  capture_mode: "snapshot";
  target: Extract<CaptureRequest["target"], { type: "url" }>;
  web_document: { content_id: string; url?: string };
};

type TabWebDocumentCaptureRequest = CaptureRequest & {
  capture_mode: "snapshot";
  target: Extract<CaptureRequest["target"], { type: "tab" }>;
  web_document: { content_id: string; url: string };
};

export type WebDocumentCaptureRequest = UrlWebDocumentCaptureRequest | TabWebDocumentCaptureRequest;

function validContentId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200;
}

function httpUrl(value: unknown): URL | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const parsed = new URL(value);
    if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.username || parsed.password) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function sameUrlIgnoringHash(left: URL, right: URL): boolean {
  const expected = new URL(left.href);
  const actual = new URL(right.href);
  expected.hash = "";
  actual.hash = "";
  return expected.href === actual.href;
}

/**
 * URL targets bind to their own request URL. Explicit user tabs must provide
 * the exact URL returned by their preceding route-only observation; a tab id
 * is not itself page identity. A supplied duplicate URL on a URL target is
 * accepted only when it names the same document.
 */
function webDocumentRequestUrl(request: WebDocumentCaptureRequest): URL | undefined {
  const targetUrl = request.target.type === "url" ? httpUrl(request.target.url) : undefined;
  const documentUrl = httpUrl(request.web_document.url);
  if (request.target.type === "tab") return documentUrl;
  if (!targetUrl) return undefined;
  return documentUrl === undefined || sameUrlIgnoringHash(targetUrl, documentUrl) ? targetUrl : undefined;
}

/**
 * A generic browser document capture is an authenticated runtime strategy,
 * never a caller-supplied selector or a substitute for observe/act.
 */
export function isWebDocumentCaptureRequest(request: CaptureRequest): request is WebDocumentCaptureRequest {
  if (request.capture_mode !== "snapshot"
    || request.action !== undefined
    || (request.max_related_items ?? 0) !== 0
    || !request.web_document
    || !validContentId(request.web_document.content_id)) return false;
  if (request.target.type === "tab") return httpUrl(request.web_document.url) !== undefined;
  if (request.target.type !== "url") return false;
  const targetUrl = httpUrl(request.target.url);
  const documentUrl = request.web_document.url === undefined ? undefined : httpUrl(request.web_document.url);
  return targetUrl !== undefined
    && (request.web_document.url === undefined || (documentUrl !== undefined && sameUrlIgnoringHash(targetUrl, documentUrl)));
}

/**
 * Bind browser DOM reads to the exact requested page. Fragment changes are
 * client-side navigation only; every other URL difference is a target drift.
 */
export function sameWebDocumentTarget(request: WebDocumentCaptureRequest, current: URL): boolean {
  const requested = webDocumentRequestUrl(request);
  return requested !== undefined && sameUrlIgnoringHash(requested, current);
}

function exactOrSubdomain(hostname: string, root: string): boolean {
  return hostname === root || hostname.endsWith(`.${root}`);
}

function safePathSegments(current: URL): string[] | undefined {
  const raw = current.pathname.split("/").filter(Boolean);
  try {
    const segments = raw.map(segment => decodeURIComponent(segment));
    return segments.some(segment => !segment || segment === "." || segment === ".." || /[\\/]/.test(segment))
      ? undefined
      : segments;
  } catch {
    return undefined;
  }
}

/**
 * Discovery for an explicit user tab needs only a route-bound identity. These
 * routes deliberately avoid adapter.observe(), whose specialised roots,
 * public markers, and canonicalisation are not prerequisites for generic DOM
 * reading. The two multi-route adapters stay narrowed to ordinary blog paths.
 */
export function isRouteOnlyExplicitTabBlog(adapterId: string, current: URL): boolean {
  const segments = safePathSegments(current);
  if (!segments) return false;
  if (adapterId === "medium") {
    return exactOrSubdomain(current.hostname, "medium.com")
      && segments.length === 2
      && /-[a-f0-9]{8,}$/i.test(segments[1] ?? "");
  }
  if (adapterId === "substack") {
    return exactOrSubdomain(current.hostname, "substack.com")
      && ((segments.length === 2 && segments[0] === "p" && /^[A-Za-z0-9_-]+$/.test(segments[1] ?? ""))
        || (segments.length === 3 && (segments[0] ?? "").startsWith("@") && segments[1] === "post" && /^\d+$/.test(segments[2] ?? "")));
  }
  if (adapterId === "anthropic_blog") {
    return (current.hostname === "www.anthropic.com" || current.hostname === "anthropic.com")
      && segments.length === 2
      && (segments[0] === "research" || segments[0] === "engineering")
      && /^[A-Za-z0-9][A-Za-z0-9-]*$/.test(segments[1] ?? "");
  }
  if (adapterId === "openai_blog") {
    return (current.hostname === "openai.com" || current.hostname === "www.openai.com")
      && ((segments.length === 2 && segments[0] === "index" && /^[A-Za-z0-9][A-Za-z0-9-]{0,159}$/.test(segments[1] ?? ""))
        || (segments.length === 3
          && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){1,2}$/.test(segments[0] ?? "")
          && segments[1] === "index"
          && /^[A-Za-z0-9][A-Za-z0-9-]{0,159}$/.test(segments[2] ?? "")));
  }
  if (adapterId === "deepmind_blog") {
    return current.hostname === "deepmind.google"
      && segments.length === 2
      && segments[0] === "blog"
      && /^[A-Za-z0-9][A-Za-z0-9-]*$/.test(segments[1] ?? "");
  }
  return adapterId === "huggingface"
    && current.hostname === "huggingface.co"
    && segments.length === 2
    && segments[0] === "blog"
    && /^[A-Za-z0-9][A-Za-z0-9-]*$/.test(segments[1] ?? "");
}

/**
 * A page-specific identity observation for the narrow generic-blog path. It
 * exposes no selector result, action target, body text, or access inference.
 * `publicReferenceUrl` intentionally redacts sensitive/tracking query keys;
 * a later tab capture still compares its raw current URL exactly and rejects
 * any resulting identity mismatch rather than silently loosening the bind.
 */
export function routeOnlyExplicitTabObservation(
  adapter: { id: string; version: string },
  current: URL,
  title: string,
  instanceId: string,
  tabId: number,
): BrowserObservation | undefined {
  if (!isRouteOnlyExplicitTabBlog(adapter.id, current)) return undefined;
  const publicUrl = publicReferenceUrl(current);
  return {
    instance_id: instanceId,
    tab_id: tabId,
    url: publicUrl.href,
    title,
    origin: current.origin,
    adapter_id: adapter.id,
    access_class: "unknown",
    evidence: [
      `adapter:${adapter.id}@${adapter.version}`,
      "observe:explicit_tab:route_only",
    ],
  };
}

function blockAssetIds(blocks: readonly ContentBlock[]): Set<string> {
  return new Set(blocks.flatMap(block => "asset_id" in block ? [block.asset_id] : []));
}

function blockableAssets(assets: readonly SourceAsset[]): SourceAsset[] {
  return assets.filter(asset => asset.role === "image" || asset.role === "video" || asset.role === "audio" || asset.role === "file");
}

function needsPartialResult(warnings: readonly string[], blocks: readonly ContentBlock[], assets: readonly SourceAsset[]): boolean {
  if (warnings.some(warning => warning.startsWith("content_truncated:") || warning.startsWith("content_pending:") || warning.startsWith("asset:image:"))) return true;
  const blockable = blockableAssets(assets);
  const ordered = blockAssetIds(blocks);
  return new Set(blockable.map(asset => asset.id)).size !== blockable.length
    || blockable.some(asset => !ordered.has(asset.id))
    || ordered.size !== blockable.length;
}

/**
 * Maps the shared generic DOM conversion into the browser bridge's strictly
 * current-page receipt. It does not execute source scripts, perform network
 * access, or use platform selectors/actions.
 */
export function extractWebDocumentSnapshot(
  document: Document,
  request: WebDocumentCaptureRequest,
  current: URL,
  accessClass: "public_free" | "login_public_free" = "public_free",
): ContentSnapshot {
  if (!sameWebDocumentTarget(request, current)) throw new Error("WEB_DOCUMENT_TARGET_DRIFTED");
  const extracted = extractWebDocument(document, current);
  if (extracted.assets.some(asset => asset.role !== "image" && asset.role !== "cover")) {
    throw new Error("WEB_DOCUMENT_ASSET_OUT_OF_SCOPE");
  }

  const requested = webDocumentRequestUrl(request);
  if (!requested) throw new Error("WEB_DOCUMENT_TARGET_DRIFTED");
  const source = publicReferenceUrl(requested).href;
  const warnings = [...new Set([...extracted.warnings, "CURRENT_PAGE_BROWSER_DOM"])];
  const blockable = blockableAssets(extracted.assets);
  const ordered = blockAssetIds(extracted.blocks);
  const partial = needsPartialResult(warnings, extracted.blocks, extracted.assets);
  const snapshot: ContentSnapshot = {
    schema_version: "1",
    platform: "web_page",
    adapter_version: WEB_DOCUMENT_ADAPTER_VERSION,
    source_url: source,
    canonical_url: source,
    platform_content_id: request.web_document.content_id,
    content_type: "article",
    title: extracted.title,
    authors: extracted.authors,
    published_at: extracted.published_at,
    blocks: extracted.blocks,
    assets: extracted.assets,
    access_class: accessClass,
    completeness: partial ? "partial" : "complete",
    warnings,
    evidence: ["capture:browser_dom", `extractor:${extracted.extraction}`],
  };
  if (!partial) {
    snapshot.completeness_proof = {
      version: 1,
      scope: "single_item",
      method: "browser_page_capture",
      rule_id: WEB_DOCUMENT_RULE_ID,
      platform_content_id: request.web_document.content_id,
      boundary: "dom_read",
      pending_marker_count: 0 as const,
      ordered_asset_count: ordered.size,
      unplaced_asset_count: 0 as const,
    };
  }
  return snapshot;
}
