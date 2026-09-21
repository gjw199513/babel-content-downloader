import type { ContentBlock, ContentCompletenessProof, ContentRelation, ContentSnapshot, SourceAsset } from "../../shared/contracts.js";
import type { BrowserAction, BrowserObservation } from "../../shared/bridge-protocol.js";
import { accessError, classifyAccess, targetRootPlanFor } from "./access.js";
import { boundedDomDiagnostic } from "./dom-diagnostic.js";
import { isAllowedAssetUrl, publicReferenceUrl, safeHttpUrl } from "./url.js";
import { contentBlockHasText } from "../../shared/content-blocks.js";
import { codeBlock, inlineSourceText, isMathNode, mathBlock, referenceSuffix, tableBlock } from "./technical-text.js";
import {
  AdapterExtractionError,
  type ExtractionOptions,
  type DomCompletionPlan,
  type PageNode,
  type PageReader,
  type PlatformAdapter,
  type RelationPlan,
} from "../types.js";

type AssetCandidate = {
  node: PageNode;
  asset: SourceAsset;
};

type TextContentBlock = Extract<ContentBlock, { text: string }>;

type BlockBuild = {
  blocks: ContentBlock[];
  /** Assets emitted while walking the source root in DOM order. */
  orderedAssetIds: string[];
  /** Assets preserved only by the end-of-document fallback. */
  unplacedAssetIds: string[];
  /** Visible body media that no shipped adapter selector accounted for. */
  unmappedStandardMediaCount: number;
};

/** A non-serializable static proof candidate awaiting adapter-owned stable sampling. */
type CompletionCandidate = { proof: ContentCompletenessProof; plan: DomCompletionPlan };
type ExternalFileAttachment = { plan: DomCompletionPlan; candidate: AssetCandidate };

const stableCompletionCandidates = new WeakMap<ContentSnapshot, CompletionCandidate>();

export type SafeActionTarget = { id: string; type: "expand" | "play"; label: string };

const TEXT_TAGS = new Set(["p", "code", "figcaption"]);
const STRUCTURAL_TAGS = new Set(["article", "section", "div", "p", "pre", "table", "math", "blockquote", "ul", "ol", "li", "figure", "h1", "h2", "h3", "h4", "h5", "h6"]);
const SKIP_TAGS = new Set(["script", "style", "noscript", "svg", "button", "nav", "footer", "header", "aside"]);
const STANDARD_BODY_MEDIA_TAGS = new Set(["img", "video", "audio", "iframe"]);

function normalize(text: string): string {
  return text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function selectorNodes(reader: PageReader, selectors: readonly string[], scope?: PageNode, includeHidden = false): PageNode[] {
  // Some shipped selectors intentionally retain a stable platform ancestor
  // (for example `article[data-testid='tweet'] …`). querySelectorAll on the
  // article itself cannot match that ancestor, so combine the scoped query
  // with a document query filtered structurally back to the selected root.
  // The containment check remains the authority: a neighbouring reply or
  // recommendation is never admitted merely because it matches globally.
  const selected = scope
    ? [...reader.select(selectors, scope), ...reader.select(selectors).filter(node => reader.contains(scope, node))]
    : reader.select(selectors);
  const seen = new Set<PageNode>();
  return selected.filter(node => {
    // A PageReader's scoped select contract is already rooted. The second
    // document-wide branch above needs an explicit containment check because
    // it is the compatibility path for selectors with an ancestor prefix.
    if (seen.has(node) || (!includeHidden && !reader.visible(node))) return false;
    seen.add(node);
    return true;
  });
}

function readableText(reader: PageReader, node: PageNode): string {
  // `<meta>` has no text content. Its `content` is a source-authored title
  // value only when a shipped selector explicitly targets that meta element.
  return normalize(reader.text(node)) || normalize(reader.attribute(node, "content") ?? "");
}

function firstText(reader: PageReader, selectors: readonly string[], scope?: PageNode): string | undefined {
  return selectorNodes(reader, selectors, scope).map(node => readableText(reader, node)).find(Boolean);
}

type SrcsetCandidate = { value: string; descriptor?: string; index: number };

/**
 * Parse descriptor-delimited candidates without treating a comma in an HTTPS
 * URL as a separator. Substack's documented `/image/fetch/` transform URLs
 * contain raw commas, while each responsive candidate still ends in a width
 * or density descriptor. The parser also accepts a normal no-descriptor
 * candidate when a comma is followed by whitespace and another URL.
 */
function srcsetCandidates(srcset: string): SrcsetCandidate[] {
  const candidates: SrcsetCandidate[] = [];
  let cursor = 0;
  const whitespace = (character: string | undefined): boolean => !!character && /\s/.test(character);
  const looksLikeUrl = (offset: number): boolean => /^(?:https?:\/\/|\/\/|\/|\.\/|\.\.\/)/.test(srcset.slice(offset));

  while (cursor < srcset.length) {
    while (whitespace(srcset[cursor]) || srcset[cursor] === ",") cursor++;
    if (cursor >= srcset.length) break;
    const urlStart = cursor;
    let noDescriptorBoundary: number | undefined;
    while (cursor < srcset.length && !whitespace(srcset[cursor])) {
      if (srcset[cursor] === ",") {
        let next = cursor + 1;
        while (whitespace(srcset[next])) next++;
        // A literal comma inside a URL cannot introduce whitespace; when a
        // whitespace-delimited URL follows, this is a descriptor-less entry.
        if (next > cursor + 1 && looksLikeUrl(next)) {
          noDescriptorBoundary = next;
          break;
        }
      }
      cursor++;
    }
    if (noDescriptorBoundary !== undefined) {
      const value = srcset.slice(urlStart, cursor).trim();
      if (value) candidates.push({ value, index: candidates.length });
      cursor = noDescriptorBoundary;
      continue;
    }

    const value = srcset.slice(urlStart, cursor).trim();
    while (whitespace(srcset[cursor])) cursor++;
    const descriptorStart = cursor;
    while (cursor < srcset.length && srcset[cursor] !== ",") cursor++;
    const descriptor = srcset.slice(descriptorStart, cursor).trim();
    if (value) candidates.push({ value, ...(descriptor ? { descriptor } : {}), index: candidates.length });
    if (srcset[cursor] === ",") cursor++;
  }
  return candidates;
}

function srcsetScore(descriptor: string | undefined, index: number): number {
  const value = descriptor?.split(/\s+/).find(token => /^\d+(?:\.\d+)?[wx]$/.test(token));
  return value ? Number.parseFloat(value) : index;
}

function bestSrcsetUrl(reader: PageReader, node: PageNode, base: URL): URL | null {
  const srcset = reader.attribute(node, "srcset");
  if (!srcset) return null;
  const candidates = srcsetCandidates(srcset).map(candidate => ({
    value: candidate.value,
    score: srcsetScore(candidate.descriptor, candidate.index),
  })).filter(candidate => !!candidate.value).sort((left, right) => right.score - left.score);
  for (const candidate of candidates) {
    const url = safeHttpUrl(candidate.value ?? null, base);
    if (url) return url;
  }
  return null;
}

function sourceUrlFromNode(reader: PageReader, node: PageNode, base: URL, allowPoster = false): URL | null {
  const tag = reader.tagName(node);
  // A `<video>` may intentionally have no src attribute while its standard
  // HTMLMediaElement.currentSrc points to the actual selected rendition. Read
  // only that already-mounted media element, then keep the usual HTTP(S) and
  // host-policy checks below. blob:, data:, malformed, and unsupported URLs
  // cannot become source assets because safeHttpUrl rejects them.
  if (tag === "video" || tag === "audio") {
    const resolved = safeHttpUrl(reader.mediaSource?.(node) ?? null, base);
    if (resolved) return resolved;
  }
  if (tag === "picture") {
    // A shipped adapter may select a picture wrapper only when that wrapper
    // has one unambiguous fallback image. Reading descendant <source> nodes
    // first would let a malformed or composite picture assign a rendition to
    // a sibling avatar/decoration that assetLabel deliberately refuses to
    // describe. Native picture source elements are direct children, so do
    // not traverse a nested source from unrelated embedded content either.
    const images = reader.select(["img"], node);
    if (images.length !== 1) return null;
    for (const source of reader.children(node)) {
      if (reader.tagName(source) !== "source") continue;
      const url = sourceUrlFromNode(reader, source, base, false);
      if (url) return url;
    }
    return sourceUrlFromNode(reader, images[0]!, base, false);
  }
  // Lazy/high-resolution attributes win over a rendered thumbnail or placeholder src.
  for (const attribute of ["data-original", "data-actualsrc", "data-src", "data-lazy-src"]) {
    const url = safeHttpUrl(reader.attribute(node, attribute), base);
    if (url) return url;
  }
  const srcset = bestSrcsetUrl(reader, node, base);
  if (srcset) return srcset;
  for (const attribute of ["src", "href", "content"]) {
    const url = safeHttpUrl(reader.attribute(node, attribute), base);
    if (url) return url;
  }
  for (const source of reader.select(["source"], node)) {
    const url = sourceUrlFromNode(reader, source, base, false);
    if (url) return url;
  }
  // A poster is a cover image. It must never be reported as the video stream.
  if (allowPoster) return safeHttpUrl(reader.attribute(node, "poster"), base);
  return null;
}

function numericAttribute(reader: PageReader, node: PageNode, name: string): number | undefined {
  const raw = reader.attribute(node, name)?.trim();
  // Number(null), Number(""), and Number(" ") all produce zero. A missing
  // image dimension must remain absent rather than becoming a schema-invalid
  // width/height: 0 in the bridge snapshot.
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function assetLabel(reader: PageReader, node: PageNode): string | undefined {
  if (reader.tagName(node) === "picture") {
    const images = reader.select(["img"], node);
    if (images.length === 1) return reader.attribute(images[0]!, "alt") ?? reader.attribute(images[0]!, "title") ?? undefined;
  }
  return reader.attribute(node, "alt") ?? reader.attribute(node, "title") ?? undefined;
}

function assetCandidates(
  reader: PageReader,
  adapter: PlatformAdapter,
  root: PageNode,
  config: {
    excludedRoots?: readonly PageNode[];
    /** Related posts must not accidentally inherit an unrelated document player. */
    forceRootScope?: boolean;
    includeCover?: boolean;
    /** A completion plan may name one file outside the readable body root. */
    documentFiles?: boolean;
    assetIdPrefix?: string;
    sourceUrl?: URL;
  } = {},
): { candidates: AssetCandidate[]; warnings: string[] } {
  const warnings: string[] = [];
  const candidates: AssetCandidate[] = [];
  const base = reader.location;
  const scope = config.forceRootScope || adapter.rule.selectors.asset_scope !== "document" ? root : undefined;
  const seenNodes = new Map<SourceAsset["role"], Set<PageNode>>();
  const seenSourceGroups = new Set<string>();
  let order = 1;

  const add = (role: SourceAsset["role"], nodes: PageNode[], roleOptions: { onlyFirst?: boolean; language?: boolean } = {}): void => {
    for (const node of nodes) {
      if (config.excludedRoots?.some(excluded => reader.contains(excluded, node))) continue;
      const roleNodes = seenNodes.get(role) ?? new Set<PageNode>();
      if (roleNodes.has(node)) continue;
      roleNodes.add(node);
      seenNodes.set(role, roleNodes);
      if ((role === "video" || role === "audio") && candidates.some(candidate => candidate.asset.role === role
        && (reader.contains(candidate.node, node) || reader.contains(node, candidate.node)))) {
        // A selected player and one of its <source> descendants are one media
        // occurrence even when their source URLs differ by rendition.
        continue;
      }
      const source = sourceUrlFromNode(reader, node, base, role === "cover");
      if (!source) {
        warnings.push(`asset:${role}:non_http_or_missing_source`);
        continue;
      }
      if (role === "file" && adapter.rule.file_matches && !adapter.rule.file_matches(base, source)) continue;
      // A body image can occur twice in source order using the same URL. Keep
      // distinct image IDs so both positions survive into content.md and a
      // proof counts both. A file is a downloadable component, not visual
      // body flow: responsive/mobile and desktop controls that name the same
      // file must produce one asset. Video/audio remain grouped by source URL:
      // a player and its source descendants describe one media group rather
      // than separate body media.
      const preservesOccurrence = role === "image";
      const sourceGroup = `${role}:${source.href}`;
      if (!preservesOccurrence && seenSourceGroups.has(sourceGroup)) continue;
      if (!preservesOccurrence) seenSourceGroups.add(sourceGroup);
      const allowed = isAllowedAssetUrl(source, adapter.asset_hosts ?? [])
        && (!adapter.asset_origins || adapter.asset_origins.includes(source.origin));
      const tag = reader.tagName(node);
      const width = tag === "img" ? numericAttribute(reader, node, "width") : undefined;
      const height = tag === "img" ? numericAttribute(reader, node, "height") : undefined;
      const asset: SourceAsset = {
        id: `${config.assetIdPrefix ?? adapter.id}:${role}:${String(order).padStart(3, "0")}`,
        role,
        url: source.href,
        source_url: publicReferenceUrl(config.sourceUrl ?? base).href,
        order: role === "cover" ? 0 : order,
        ...(assetLabel(reader, node) ? { title: assetLabel(reader, node) } : {}),
        ...(roleOptions.language ? { language: reader.attribute(node, "srclang") ?? reader.attribute(node, "lang") ?? undefined } : {}),
        ...(width === undefined ? {} : { width }),
        ...(height === undefined ? {} : { height }),
        ...(tag === "video" || tag === "audio" ? { media_type: reader.attribute(node, "type") ?? undefined } : {}),
        availability: allowed ? "available" : "blocked",
        ...(allowed ? {} : { note: "ASSET_HOST_NOT_ALLOWED" }),
      };
      candidates.push({ node, asset });
      if (role !== "cover") order++;
      if (!allowed) warnings.push(`asset:${asset.id}:host_not_allowed`);
      if (roleOptions.onlyFirst) return;
    }
  };

  if (config.includeCover !== false) add("cover", selectorNodes(reader, adapter.rule.selectors.cover));
  add("image", selectorNodes(reader, adapter.rule.selectors.images, scope));
  add("video", selectorNodes(reader, adapter.rule.selectors.videos, scope));
  add("audio", selectorNodes(reader, adapter.rule.selectors.audio, scope));
  add("subtitle", selectorNodes(reader, adapter.rule.selectors.subtitles, scope), { language: true });
  add("file", selectorNodes(reader, adapter.rule.selectors.files, config.documentFiles ? undefined : scope));
  return { candidates, warnings };
}

type RootSelection = {
  /** The identity/access card proven by its own permalink and public marker. */
  root: PageNode;
  selector: string;
  /** A narrower readable source node when the card carries non-source UI. */
  contentRoot?: PageNode;
  contentSelector?: string;
  /** A separately bounded player/media container beside the readable source. */
  assetRoot?: PageNode;
};

function selectedRoot(reader: PageReader, adapter: PlatformAdapter, contentId: string): RootSelection {
  const targetPlan = targetRootPlanFor(adapter.rule, reader.location);
  const rootSelectors = targetPlan?.roots ?? adapter.rule.selectors.roots;
  const targetLinkSelectors = targetPlan?.target_link_selectors ?? adapter.rule.target_link_selectors;
  const matched: RootSelection[] = [];
  for (const selector of rootSelectors) {
    const roots = selectorNodes(reader, [selector]);
    for (const root of roots) {
      // Target identity and visibility markers are meaningful only outside
      // embedded quote/repost cards and explicitly excluded comment trees.
      // In particular, a comment's public marker or self permalink cannot
      // establish that its enclosing post card is the requested target.
      const nestedRelations = nestedRelationRoots(reader, adapter.rule.relations, root).map(candidate => candidate.root);
      const marker = targetPlan?.public_marker;
      const markerNodes = marker ? selectorNodes(reader, marker.selectors, root) : [];
      // A marker can also be named as a body exclusion for broad legacy
      // routes. Do not exclude the marker itself while verifying this narrow
      // route, but retain surrounding excluded trees such as comments.
      const excludedRoots = structuralExclusionRoots(reader, adapter, root)
        .filter(node => !markerNodes.includes(node));
      const ignoredRoots = topLevelNodes(reader, [...nestedRelations, ...excludedRoots]);
      const usableMarkers = markerNodes.filter(node => !isInsideAny(reader, node, ignoredRoots));
      if (marker && (usableMarkers.length !== 1 || normalize(reader.text(usableMarkers[0]!)) !== normalize(marker.text))) continue;
      // A target ID must be the card's own parsed permalink. Substring
      // matching would accept `1234` for requested `123`, and a nested quote
      // must not make its enclosing card appear to be the requested item.
      const targetLinks = targetLinkSelectors?.length
        ? selectorNodes(reader, targetLinkSelectors, root)
        .filter(link => !isInsideAny(reader, link, ignoredRoots))
        .filter(link => {
          const url = safeHttpUrl(reader.attribute(link, "href"), reader.location);
          return !!url && adapter.match(url) && adapter.rule.contentId(url) === contentId
            && (!targetPlan?.matches_target_link || targetPlan.matches_target_link(reader.location, url));
        })
        : [];
      const targetIdPlan = targetPlan?.target_id;
      // A narrow route boundary must have an explicit identity proof. A
      // selector-shaped root without either its own permalink or an exact
      // platform ID is never enough to suppress a gate or capture content.
      if (targetPlan && !targetLinkSelectors?.length && !targetIdPlan) continue;
      // A route-specific plan deliberately requires one self permalink. The
      // older feed-card path only needs at least one exact parsed link: X
      // legitimately renders several links to the same post (time,
      // media, and accessibility variants) inside one target card.
      const linksMatch = !targetLinkSelectors?.length
        || (targetPlan ? targetLinks.length === 1 : targetLinks.length > 0);
      if (!linksMatch) continue;
      if (!targetPlan) return { root, selector };

      const targetIdNodes = targetIdPlan
        ? selectorNodes(reader, targetIdPlan.selectors, root)
          .filter(node => !isInsideAny(reader, node, ignoredRoots))
        : [];
      // A route plan may bind by its own permalink, an exact platform ID
      // attribute, or both. Selector/class resemblance alone never qualifies.
      if (targetIdPlan && (targetIdNodes.length !== 1 || reader.attribute(targetIdNodes[0]!, targetIdPlan.attribute) !== contentId)) continue;

      const scopedMatches = (selectors: readonly string[] | undefined) => (selectors ?? []).flatMap(scopedSelector =>
        selectorNodes(reader, [scopedSelector], root)
          .filter(node => !isInsideAny(reader, node, ignoredRoots))
          .map(node => ({ node, selector: scopedSelector })),
      ).filter((candidate, index, all) => all.findIndex(other => other.node === candidate.node) === index);
      const contentMatches = scopedMatches(targetPlan.content_roots);
      const assetMatches = scopedMatches(targetPlan.asset_roots);
      if (targetPlan.content_roots?.length && contentMatches.length !== 1) continue;
      if (targetPlan.asset_roots?.length && assetMatches.length !== 1) continue;
      const content = contentMatches[0];
      const asset = assetMatches[0];
      if (!matched.some(candidate => candidate.root === root)) {
        matched.push({
          root,
          selector,
          ...(content ? { contentRoot: content.node, contentSelector: content.selector } : {}),
          ...(asset ? { assetRoot: asset.node } : {}),
        });
      }
    }
  }
  if (targetPlan && matched.length === 1) return matched[0]!;
  throw new AdapterExtractionError("ADAPTER_CHANGED", "The expected single-content root was not found for this target route.", true);
}

function standardMediaRole(tag: string): SourceAsset["role"] | undefined {
  if (tag === "img") return "image";
  if (tag === "video" || tag === "iframe") return "video";
  if (tag === "audio") return "audio";
  return undefined;
}

/**
 * A completion proof must account for the actual standard media nodes in the
 * chosen body, not merely prove order among the subset named by adapter
 * selectors. This walk does not infer a URL or create an asset. It only keeps
 * an otherwise valid static proof at `unknown` when a visible occurrence was
 * omitted by the shipped selector plan.
 */
function countUnmappedStandardMedia(
  reader: PageReader,
  root: PageNode,
  candidates: readonly AssetCandidate[],
  excludedNodes: ReadonlySet<PageNode>,
): number {
  const occurrences: PageNode[] = [];
  const collect = (node: PageNode): void => {
    if (excludedNodes.has(node) || reader.isText(node) || !reader.visible(node)) return;
    const tag = reader.tagName(node);
    if (SKIP_TAGS.has(tag)) {
      // A visible button can wrap source media. Its UI text stays skipped, but
      // every standard media descendant still has to be accounted for before
      // the adapter may claim a complete capture.
      if (tag === "button") for (const child of reader.children(node)) collect(child);
      return;
    }
    if (STANDARD_BODY_MEDIA_TAGS.has(tag)) {
      occurrences.push(node);
      // A video/audio element and its source children are one media occurrence;
      // picture is intentionally not terminal, so its img child is still seen.
      return;
    }
    for (const child of reader.children(node)) collect(child);
  };
  collect(root);

  const usedCandidates = new Set<number>();
  let unmapped = 0;
  for (const occurrence of occurrences) {
    const expectedRole = standardMediaRole(reader.tagName(occurrence));
    const candidateIndex = candidates.findIndex((candidate, index) => (
      !usedCandidates.has(index)
      && candidate.asset.role === expectedRole
      && (candidate.node === occurrence
        || reader.contains(occurrence, candidate.node)
        || reader.contains(candidate.node, occurrence))
    ));
    if (candidateIndex < 0) unmapped++;
    else usedCandidates.add(candidateIndex);
  }
  return unmapped;
}

/**
 * Page operations may only resolve against the same target root that a
 * snapshot would use. Returning no target is safer than falling back to a
 * document-wide reply, recommendation, or feed control.
 */
function actionRoot(reader: PageReader, adapter: PlatformAdapter, type: "expand" | "play" = "expand"): PageNode | undefined {
  const contentId = adapter.rule.contentId(reader.location);
  if (!contentId) return undefined;
  try {
    const selection = selectedRoot(reader, adapter, contentId);
    // A source card can split readable prose and its player into siblings.
    // Text expansion never leaves the prose root; play may use only the
    // independently ID-bound asset root, never the broad outer card.
    if (type === "play" && selection.assetRoot) return selection.assetRoot;
    return selection.contentRoot ?? selection.root;
  } catch {
    return undefined;
  }
}

function actionScope(reader: PageReader, adapter: PlatformAdapter, type: "expand" | "play"): PageNode | undefined {
  const root = actionRoot(reader, adapter, type);
  if (!root) return undefined;
  // An explicit asset root is an adapter's proven media boundary. Do not let
  // a legacy document-wide player setting broaden it to comments or related
  // cards on a route that intentionally split content/player siblings.
  const targetPlan = targetRootPlanFor(adapter.rule, reader.location);
  return type === "play" && adapter.rule.selectors.asset_scope === "document" && !targetPlan?.asset_roots?.length
    ? undefined
    : root;
}

function buildBlocks(
  reader: PageReader,
  root: PageNode,
  candidates: readonly AssetCandidate[],
  excluded: readonly string[] | undefined,
  excludedRoots: readonly PageNode[] = [],
): BlockBuild {
  const blocks: ContentBlock[] = [];
  const assetsByNode = new Map<PageNode, SourceAsset>();
  for (const candidate of candidates) assetsByNode.set(candidate.node, candidate.asset);
  const excludedNodes = new Set<PageNode>([
    // These selectors are source boundaries. A hidden control/comment wrapper
    // still has to stop traversal because its descendants can expose text or
    // assets even when the wrapper itself is not rendered.
    ...(excluded ? selectorNodes(reader, excluded, root, true) : []),
    ...excludedRoots,
  ]);
  const emittedAssets = new Set<string>();
  const orderedAssetIds = new Set<string>();
  const unplacedAssetIds = new Set<string>();
  const unmappedStandardMediaCount = countUnmappedStandardMedia(reader, root, candidates, excludedNodes);
  let skippedButtonUi = false;

  const emitAsset = (asset: SourceAsset, placement: "ordered" | "unplaced" = "ordered"): void => {
    if (emittedAssets.has(asset.id) || asset.role === "cover") return;
    emittedAssets.add(asset.id);
    const type = asset.role === "image" || asset.role === "video" || asset.role === "audio" || asset.role === "file" ? asset.role : null;
    if (!type) return;
    blocks.push({ type, asset_id: asset.id, ...(asset.title ? { caption: asset.title } : {}) });
    (placement === "ordered" ? orderedAssetIds : unplacedAssetIds).add(asset.id);
  };

  const emitText = (kind: "paragraph" | "quote", text: string): void => {
    const normalized = normalize(text);
    if (normalized) blocks.push(kind === "paragraph" ? { type: "paragraph", text: normalized } : { type: "quote", text: normalized });
  };

  // A media control may wrap the source media element it operates. The button
  // itself is UI, but an asset already selected by the shipped adapter remains
  // source content and must keep its DOM position. This walk never discovers a
  // new candidate and never reads button text.
  const registeredAssetsWithin = (node: PageNode): SourceAsset[] => {
    if (excludedNodes.has(node)) return [];
    const asset = assetsByNode.get(node);
    if (asset) {
      return asset.role === "image" || asset.role === "video" || asset.role === "audio" || asset.role === "file"
        ? [asset]
        : [];
    }
    return reader.children(node).flatMap(registeredAssetsWithin);
  };

  const emitRegisteredAssetsOnly = (node: PageNode): void => {
    for (const asset of registeredAssetsWithin(node)) emitAsset(asset);
  };

  /**
   * A page can place semantic blocks or an image behind one or more inline
   * wrappers. Treating that wrapper as a text leaf loses paragraph boundaries
   * and leaves its media for the end-of-document fallback. Excluded nodes also
   * require a walk so their text cannot be reintroduced through innerText.
   */
  const needsOrderedWalk = (node: PageNode): boolean => {
    if (excludedNodes.has(node)) return true;
    if (reader.isText(node)) return false;
    if (assetsByNode.has(node) || STRUCTURAL_TAGS.has(reader.tagName(node)) || isMathNode(reader, node)) return true;
    // Force a structural walk through inline wrappers around buttons. Falling
    // back to reader.text(wrapper) would reintroduce the skipped button text.
    if (reader.tagName(node) === "button") return true;
    return reader.children(node).some(needsOrderedWalk);
  };

  const walk = (node: PageNode): void => {
    if (excludedNodes.has(node)) return;
    const asset = assetsByNode.get(node);
    if (asset) {
      emitAsset(asset);
      return;
    }
    if (reader.isText(node)) {
      emitText("paragraph", reader.text(node));
      return;
    }
    const tag = reader.tagName(node);
    if (tag === "button") {
      skippedButtonUi = true;
      emitRegisteredAssetsOnly(node);
      return;
    }
    if (SKIP_TAGS.has(tag)) return;
    if (tag === "pre") {
      const code = codeBlock(reader, node, excludedNodes);
      if (code.text.trim()) blocks.push(code);
      return;
    }
    if (tag === "table") {
      const table = tableBlock(reader, node, excludedNodes);
      if (table.rows.length) blocks.push(table);
      return;
    }
    if (isMathNode(reader, node)) {
      const math = mathBlock(reader, node);
      if (math.text.trim()) blocks.push(math);
      return;
    }
    if (/^h[1-6]$/.test(tag)) {
      const text = normalize(reader.text(node));
      if (text) blocks.push({ type: "heading", level: Number(tag[1]) as 1 | 2 | 3 | 4 | 5 | 6, text });
      return;
    }
    const emitInline = (container: PageNode, kind: "paragraph" | "quote"): void => {
      let buffer = "";
      const flush = (): void => { emitText(kind, buffer); buffer = ""; };
      const inline = (part: PageNode): void => {
        if (excludedNodes.has(part)) return;
        const partAsset = assetsByNode.get(part);
        if (partAsset) { flush(); emitAsset(partAsset); return; }
        if (reader.isText(part)) { buffer += ` ${reader.text(part)} `; return; }
        const partTag = reader.tagName(part);
        if (partTag === "button") {
          skippedButtonUi = true;
          const registered = registeredAssetsWithin(part);
          if (registered.length) {
            flush();
            for (const registeredAsset of registered) emitAsset(registeredAsset);
          }
          return;
        }
        if (SKIP_TAGS.has(partTag)) return;
        if (partTag === "pre" || partTag === "table") { flush(); walk(part); return; }
        if (isMathNode(reader, part)) { buffer += ` \\(${mathBlock(reader, part).text}\\) `; return; }
        if (partTag === "br") { buffer += "\n"; return; }
        const nested = reader.children(part);
        if (!nested.length) { buffer += ` ${reader.text(part)}${referenceSuffix(reader, part)} `; return; }
        for (const child of nested) inline(child);
        buffer += referenceSuffix(reader, part);
      };
      const containerChildren = reader.children(container);
      if (!containerChildren.length) buffer = reader.text(container);
      for (const child of containerChildren) inline(child);
      flush();
    };
    if (tag === "blockquote") { emitInline(node, "quote"); return; }
    if (tag === "ul" || tag === "ol") {
      // A list item can contain real code, tables, or media. Preserve those
      // blocks in order instead of flattening the entire item into innerText.
      const rich = (part: PageNode): boolean => assetsByNode.has(part) || ["pre", "table"].includes(reader.tagName(part)) || reader.children(part).some(rich);
      const listChildren = reader.children(node).filter(child => reader.tagName(child) === "li");
      if (listChildren.some(rich)) { for (const child of listChildren) walk(child); return; }
      const items = reader.children(node).filter(child => reader.tagName(child) === "li").map(child => normalize(inlineSourceText(reader, child, excludedNodes))).filter(Boolean);
      if (items.length) blocks.push({ type: "list", ordered: tag === "ol", items });
      return;
    }
    if (TEXT_TAGS.has(tag)) { emitInline(node, "paragraph"); return; }
    const children = reader.children(node);
    const hasOrderedChild = children.some(needsOrderedWalk);
    if (!hasOrderedChild) {
      emitInline(node, "paragraph");
      return;
    }
    let looseText = "";
    const flushLooseText = (): void => { emitText("paragraph", looseText); looseText = ""; };
    for (const child of children) {
      if (excludedNodes.has(child)) continue;
      if (reader.isText(child)) { looseText += ` ${reader.text(child)} `; continue; }
      const childAsset = assetsByNode.get(child);
      if (childAsset) { flushLooseText(); emitAsset(childAsset); continue; }
      if (reader.tagName(child) === "button") {
        skippedButtonUi = true;
        const registered = registeredAssetsWithin(child);
        if (registered.length) {
          flushLooseText();
          for (const registeredAsset of registered) emitAsset(registeredAsset);
        }
        continue;
      }
      if (needsOrderedWalk(child)) { flushLooseText(); walk(child); continue; }
      // Inline wrappers next to structural content retain their source order.
      const inlineText = normalize(inlineSourceText(reader, child, excludedNodes));
      if (inlineText) looseText += ` ${inlineText} `;
    }
    flushLooseText();
  };

  walk(root);
  // Preserve a discovered asset even if an unexpected DOM wrapper prevented
  // the structural walk from reaching it. The trace keeps that recovery from
  // being mistaken for source-order proof.
  for (const candidate of candidates) emitAsset(candidate.asset, "unplaced");
  if (!excludedNodes.size && !skippedButtonUi && !blocks.some(contentBlockHasText)) {
    const text = normalize(reader.text(root));
    if (text) blocks.unshift({ type: "paragraph", text });
  }
  return { blocks, orderedAssetIds: [...orderedAssetIds], unplacedAssetIds: [...unplacedAssetIds], unmappedStandardMediaCount };
}

function contentType(adapter: PlatformAdapter, candidates: readonly AssetCandidate[]): ContentSnapshot["content_type"] {
  const roles = new Set(candidates.filter(candidate => candidate.asset.role !== "cover").map(candidate => candidate.asset.role));
  if (roles.has("video") && (roles.has("image") || roles.has("audio"))) return "mixed";
  if (roles.has("video")) return "video";
  if (roles.has("audio")) return "audio";
  return adapter.rule.default_content_type;
}

const BLOCKABLE_ROLES = new Set<SourceAsset["role"]>(["image", "video", "audio", "file"]);

function sameAssetIds(left: readonly string[], right: readonly string[]): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === left.length && rightSet.size === right.length
    && leftSet.size === rightSet.size && [...leftSet].every(id => rightSet.has(id));
}

function matchingCompletionPlan(
  reader: PageReader,
  adapter: PlatformAdapter,
  selector: string,
  contentTypeValue: ContentSnapshot["content_type"],
): DomCompletionPlan | undefined {
  const matching = adapter.rule.completion?.filter(candidate =>
    candidate.applies(reader.location)
    && candidate.content_root === selector
    && candidate.content_types.includes(contentTypeValue),
  ) ?? [];
  return matching.length === 1 ? matching[0] : undefined;
}

/**
 * Bind one visible, exact adapter-selected file outside the readable body.
 * The link remains a source asset and is intentionally not assigned a body
 * position. Duplicate visible controls, even for the same URL, fail closed.
 */
function externalFileAttachment(
  reader: PageReader,
  adapter: PlatformAdapter,
  root: PageNode,
  selector: string,
  contentTypeValue: ContentSnapshot["content_type"],
  candidates: readonly AssetCandidate[],
  excludedRoots: readonly PageNode[],
): ExternalFileAttachment | undefined {
  const plan = matchingCompletionPlan(reader, adapter, selector, contentTypeValue);
  if (!plan?.external_file_attachment || !adapter.rule.file_matches || !adapter.rule.selectors.files.length) return undefined;
  const nodes = selectorNodes(reader, adapter.rule.selectors.files)
    .filter(node => !reader.contains(root, node))
    .filter(node => !excludedRoots.some(excluded => reader.contains(excluded, node)))
    .filter(node => {
      const source = sourceUrlFromNode(reader, node, reader.location);
      return !!source && adapter.rule.file_matches!(reader.location, source);
    });
  if (nodes.length !== 1) return undefined;
  const candidate = candidates.find(item => item.node === nodes[0] && item.asset.role === "file");
  return candidate ? { plan, candidate } : undefined;
}

/**
 * Produces a proof only for a shipped route/root plan that has exhausted its
 * bounded DOM. Absence of a plan is deliberately indistinguishable from an
 * unproven page: callers retain an unknown snapshot rather than guessing.
 */
function terminalBoundaryObserved(
  reader: PageReader,
  root: PageNode,
  metadata: PageNode | undefined,
  plan: DomCompletionPlan,
): boolean {
  if (plan.boundary.type !== "terminal_observed") return true;
  const boundary = plan.boundary;
  const scope = boundary.scope === "metadata_root" ? metadata : root;
  if (!scope) return false;
  const terminals = selectorNodes(reader, boundary.selectors, scope);
  if (!terminals.length) return false;
  if (!boundary.immediately_after_anchor) return true;

  const anchorSelector = boundary.anchor_selector ?? plan.content_root;
  const anchors = selectorNodes(reader, [anchorSelector], scope).filter(anchor => reader.contains(anchor, root));
  if (anchors.length !== 1) return false;
  // DOM whitespace is a text child. The observed contract is for the next
  // structural element in the bounded article, not an implementation's
  // formatting whitespace node.
  const structuralChildren = reader.children(scope).filter(node => !reader.isText(node));
  const anchorIndex = structuralChildren.indexOf(anchors[0]!);
  return anchorIndex >= 0 && terminals.some(terminal => structuralChildren[anchorIndex + 1] === terminal);
}

function completionProof(
  reader: PageReader,
  adapter: PlatformAdapter,
  root: PageNode,
  metadata: PageNode | undefined,
  selector: string,
  contentId: string,
  contentTypeValue: ContentSnapshot["content_type"],
  accessClass: ContentSnapshot["access_class"],
  candidates: readonly AssetCandidate[],
  externalAttachment: ExternalFileAttachment | undefined,
  assetWarnings: readonly string[],
  blockBuild: BlockBuild,
  expansionAvailable: boolean,
  relatedScopeRequested: boolean,
  relatedCount: number,
): CompletionCandidate | undefined {
  const plan = matchingCompletionPlan(reader, adapter, selector, contentTypeValue);
  if (!plan || accessClass !== "public_free" || expansionAvailable || relatedScopeRequested || relatedCount) return undefined;
  if (plan.external_file_attachment
    ? externalAttachment?.plan !== plan || externalAttachment.candidate.asset.role !== "file"
    : externalAttachment !== undefined) return undefined;
  // A bounded plan that names a metadata scope relies on that scope for its
  // title/header boundary. An ambiguous or missing container is readable but
  // cannot establish a complete single-item capture.
  if (adapter.rule.selectors.metadata_roots?.length && !metadata) return undefined;

  const roots = selectorNodes(reader, [plan.content_root]);
  if (roots.length !== 1 || roots[0] !== root) return undefined;

  const pendingMarkerCount = selectorNodes(reader, plan.pending_or_truncation, root).length;
  if (pendingMarkerCount) return undefined;

  const boundary = plan.boundary.type === "root_exhausted"
    ? "root_exhausted"
    : terminalBoundaryObserved(reader, root, metadata, plan) ? "terminal_observed" : undefined;
  if (!boundary) return undefined;

  const blockableAssetIds = candidates
    .filter(candidate => BLOCKABLE_ROLES.has(candidate.asset.role))
    .map(candidate => candidate.asset.id);
  const missingRequiredSource = assetWarnings.some(warning => !warning.startsWith("asset:cover:"));
  const unavailableRequiredSource = candidates.some(candidate => candidate.asset.role !== "cover" && candidate.asset.availability !== "available");
  const unavailableExternalFile = externalAttachment?.candidate.asset.availability !== undefined
    && externalAttachment.candidate.asset.availability !== "available";
  if (missingRequiredSource || unavailableRequiredSource || unavailableExternalFile || blockBuild.unplacedAssetIds.length || blockBuild.unmappedStandardMediaCount) return undefined;
  if (!sameAssetIds(blockBuild.orderedAssetIds, blockableAssetIds)) return undefined;

  return {
    plan,
    proof: {
      version: 1,
      scope: "single_item",
      method: "adapter_bounded_dom",
      rule_id: plan.id,
      platform_content_id: contentId,
      boundary,
      pending_marker_count: 0,
      ordered_asset_count: blockBuild.orderedAssetIds.length,
      unplaced_asset_count: 0,
      ...(externalAttachment ? { external_file_asset_id: externalAttachment.candidate.asset.id } : {}),
    },
  };
}

/**
 * Adds the proof for a stability-gated plan only after the content script's
 * trusted helper has compared two bounded, read-only snapshots. The static
 * candidate is held in a WeakMap, so neither its selectors nor an incomplete
 * proof can cross the extension bridge.
 */
export function finalizeStableCompletion(
  snapshot: ContentSnapshot,
  adapter: PlatformAdapter,
  stability: NonNullable<ContentCompletenessProof["stability"]>,
): ContentSnapshot {
  const candidate = stableCompletionCandidates.get(snapshot);
  const plan = candidate && adapter.rule.completion?.find(item => item.id === candidate.plan.id);
  const required = plan?.stability;
  if (!candidate || !plan || plan !== candidate.plan || !required || !plan.content_types.includes(snapshot.content_type) || snapshot.completeness !== "unknown"
    || snapshot.platform !== adapter.id || snapshot.adapter_version !== adapter.version
    || snapshot.platform_content_id !== candidate.proof.platform_content_id) return snapshot;
  if (!Number.isInteger(stability.sample_count) || stability.sample_count < required.sample_count || stability.sample_count > 8
    || !Number.isInteger(stability.window_ms) || stability.window_ms < required.minimum_window_ms || stability.window_ms > 60_000
    || !/^[a-f0-9]{64}$/.test(stability.fingerprint)) return snapshot;

  stableCompletionCandidates.delete(snapshot);
  return {
    ...snapshot,
    completeness: "complete",
    completeness_proof: { ...candidate.proof, stability: { ...stability } },
    warnings: snapshot.warnings.filter(warning => warning !== "COMPLETENESS_NOT_CONFIRMED_BY_BROWSER"),
    evidence: [
      ...new Set([
        ...(snapshot.evidence ?? []),
        `completion_rule:${candidate.proof.rule_id}`,
        `completion_boundary:${candidate.proof.boundary}`,
        `completion_stability:${stability.sample_count}x/${stability.window_ms}ms`,
      ]),
    ],
  };
}

type ContentLink = { id: string; url: URL };
type RelationRoot = { type: ContentRelation["type"]; root: PageNode; link?: ContentLink };
type ContinuationCandidate = { root: PageNode; link: ContentLink };

const MAX_RELATED_ITEMS = 100;

function boundedRelatedItems(options: ExtractionOptions | undefined): number {
  const requested = options?.max_related_items;
  if (!Number.isSafeInteger(requested) || !requested || requested < 0) return 0;
  return Math.min(requested, MAX_RELATED_ITEMS);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function isInsideAny(reader: PageReader, node: PageNode, roots: readonly PageNode[]): boolean {
  return roots.some(root => reader.contains(root, node));
}

function topLevelNodes(reader: PageReader, nodes: readonly PageNode[]): PageNode[] {
  const unique = [...new Set(nodes)];
  return unique.filter(node => !unique.some(other => other !== node && reader.contains(other, node)));
}

/** Adapter-declared exclusions are structural boundaries, including hidden wrappers. */
function structuralExclusionRoots(reader: PageReader, adapter: PlatformAdapter, root: PageNode): PageNode[] {
  return topLevelNodes(reader, selectorNodes(reader, adapter.rule.selectors.excluded ?? [], root, true));
}

function bodyExclusions(adapter: PlatformAdapter, excludeTitle = true): string[] {
  return [
    ...(adapter.rule.selectors.excluded ?? []),
    ...(excludeTitle ? adapter.rule.selectors.title : []),
    ...adapter.rule.selectors.authors,
    ...adapter.rule.selectors.published,
    ...(adapter.rule.relations?.quote_roots ?? []),
    ...(adapter.rule.relations?.repost_roots ?? []),
  ];
}

/**
 * Metadata sometimes sits in the target article header rather than in its
 * narrow body root. Only use a shipped metadata container when exactly one
 * visible candidate structurally contains the selected body. Falling back to
 * a document query would admit authors and dates from recommendations or
 * comments, so an ambiguous configured scope deliberately yields no metadata.
 */
function metadataRoot(reader: PageReader, adapter: PlatformAdapter, root: PageNode): PageNode | undefined {
  const selectors = adapter.rule.selectors.metadata_roots;
  if (!selectors?.length) return root;
  const candidates = selectorNodes(reader, selectors).filter(candidate => reader.contains(candidate, root));
  return candidates.length === 1 ? candidates[0] : undefined;
}

function authorText(reader: PageReader, node: PageNode, excluded: ReadonlySet<PageNode>): string {
  if (excluded.has(node) || (!reader.isText(node) && !reader.visible(node))) return "";
  if (reader.isText(node)) return reader.rawText?.(node) ?? reader.text(node);
  const children = reader.children(node);
  if (!children.length) return reader.rawText?.(node) ?? reader.text(node);
  return children.map(child => authorText(reader, child, excluded)).join(" ");
}

function rootAuthors(reader: PageReader, adapter: PlatformAdapter, root: PageNode, excludedRoots: readonly PageNode[] = []): string[] {
  const nestedExclusions = adapter.rule.selectors.author_excluded;
  return uniqueStrings(
    selectorNodes(reader, adapter.rule.selectors.authors, root)
      .filter(node => !isInsideAny(reader, node, excludedRoots))
      .map(node => nestedExclusions?.length
        ? normalize(authorText(reader, node, new Set(selectorNodes(reader, nestedExclusions, node, true))))
        : normalize(reader.text(node)))
      .filter(Boolean),
  );
}

function rootFirstText(reader: PageReader, selectors: readonly string[], root: PageNode, excludedRoots: readonly PageNode[] = []): string | undefined {
  return selectorNodes(reader, selectors, root)
    .filter(node => !isInsideAny(reader, node, excludedRoots))
    .map(node => readableText(reader, node))
    .find(Boolean);
}

function rootPublishedAt(reader: PageReader, adapter: PlatformAdapter, root: PageNode, excludedRoots: readonly PageNode[] = []): string | null {
  // Structured publication metadata is normally a hidden meta element. It is
  // allowed here only after metadataRoot proved that the enclosing article
  // uniquely contains the selected content root; body extraction remains
  // visible-node-only.
  for (const node of selectorNodes(reader, adapter.rule.selectors.published, root, true)) {
    if (isInsideAny(reader, node, excludedRoots)) continue;
    for (const attribute of ["datetime", "content", "data-time", "title"]) {
      const value = reader.attribute(node, attribute);
      if (value) return value;
    }
    const text = normalize(reader.text(node));
    if (text) return text;
  }
  return null;
}

/**
 * Keeps a narrowly evidenced source introduction that precedes the selected
 * body. Unlike title fallbacks, this path requires an explicit metadata root
 * that uniquely contains the body; it never looks across the whole document.
 */
function leadingTextBlock(
  reader: PageReader,
  adapter: PlatformAdapter,
  metadata: PageNode | undefined,
  root: PageNode,
  excludedRoots: readonly PageNode[] = [],
): TextContentBlock | undefined {
  const selectors = adapter.rule.selectors.leading_text;
  if (!metadata || !adapter.rule.selectors.metadata_roots?.length || !selectors?.length) return undefined;
  const candidates = selectorNodes(reader, selectors, metadata)
    .filter(node => !isInsideAny(reader, node, excludedRoots) && !reader.contains(root, node));
  // A platform plan names a small trusted source field, not a header pattern
  // to sweep. Ambiguous matches intentionally contribute nothing.
  if (candidates.length !== 1) return undefined;
  const node = candidates[0]!;
  const text = normalize(reader.text(node));
  if (!text) return undefined;
  const tag = reader.tagName(node);
  return /^h[1-6]$/.test(tag)
    ? { type: "heading", level: Number(tag[1]) as 1 | 2 | 3 | 4 | 5 | 6, text }
    : { type: "paragraph", text };
}

function authorIdentityFromPermalink(url: URL): string | undefined {
  const segments = url.pathname.split("/").filter(Boolean);
  const marker = segments.findIndex(segment => segment === "status" || segment === "post");
  const candidate = marker > 0 ? segments[marker - 1] : undefined;
  if (!candidate) return undefined;
  const normalized = candidate.replace(/^@/, "").toLocaleLowerCase();
  return /^[a-z0-9._-]{1,100}$/.test(normalized) ? normalized : undefined;
}

function sameAuthorByPermalink(targetUrl: URL, candidateUrl: URL): boolean {
  const target = authorIdentityFromPermalink(targetUrl);
  const candidate = authorIdentityFromPermalink(candidateUrl);
  // A display name is not an author identifier. X and Threads both expose a
  // handle in their supported permalink route, so absence of either handle is
  // insufficient evidence for an author-continuation relation.
  return !!target && target === candidate;
}

function contentLinks(
  reader: PageReader,
  adapter: PlatformAdapter,
  root: PageNode,
  selectors: readonly string[],
  excludedRoots: readonly PageNode[] = [],
): ContentLink[] {
  const links = new Map<string, ContentLink>();
  for (const node of selectorNodes(reader, selectors, root)) {
    if (isInsideAny(reader, node, excludedRoots)) continue;
    const url = safeHttpUrl(reader.attribute(node, "href"), reader.location);
    if (!url || !adapter.match(url)) continue;
    const id = adapter.rule.contentId(url);
    if (id && !links.has(id)) links.set(id, { id, url });
  }
  return [...links.values()];
}

function singleUnseenContentLink(
  reader: PageReader,
  adapter: PlatformAdapter,
  root: PageNode,
  selectors: readonly string[],
  excludedIds: ReadonlySet<string>,
  excludedRoots: readonly PageNode[] = [],
): ContentLink | undefined {
  const eligible = contentLinks(reader, adapter, root, selectors, excludedRoots).filter(link => !excludedIds.has(link.id));
  return eligible.length === 1 ? eligible[0] : undefined;
}

function nestedRelationRoots(reader: PageReader, plan: RelationPlan | undefined, root: PageNode): RelationRoot[] {
  if (!plan) return [];
  const used = new Set<PageNode>();
  const result: RelationRoot[] = [];
  for (const [type, selectors] of [
    ["quote", plan.quote_roots],
    ["repost", plan.repost_roots],
  ] as const) {
    for (const candidate of topLevelNodes(reader, selectorNodes(reader, selectors, root))) {
      // Relation containers must be descendants of the target or candidate
      // item. Treating the root itself as a quote would erase the requested
      // item whenever a platform reuses an item-root selector.
      if (candidate === root || used.has(candidate)) continue;
      used.add(candidate);
      result.push({ type, root: candidate });
    }
  }
  return result;
}

function withRelationLinks(
  reader: PageReader,
  adapter: PlatformAdapter,
  relationRoots: readonly RelationRoot[],
  knownIds: ReadonlySet<string>,
): RelationRoot[] {
  return relationRoots.map(candidate => {
    const excludedRoots = topLevelNodes(reader, [
      ...nestedRelationRoots(reader, adapter.rule.relations, candidate.root).map(nested => nested.root),
      ...structuralExclusionRoots(reader, adapter, candidate.root),
    ]);
    return {
      ...candidate,
      link: singleUnseenContentLink(
        reader,
        adapter,
        candidate.root,
        adapter.rule.relations?.permalink_links ?? [],
        knownIds,
        excludedRoots,
      ),
    };
  });
}

function relationAssetPrefix(adapter: PlatformAdapter, type: ContentRelation["type"], contentId: string): string {
  const readable = contentId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 42) || "item";
  let hash = 2_166_136_261;
  for (const character of contentId) hash = Math.imul(hash ^ character.charCodeAt(0), 16_777_619) >>> 0;
  return `${adapter.id}:relation:${type}:${readable}-${hash.toString(36)}`;
}

function relationFromRoot(
  reader: PageReader,
  adapter: PlatformAdapter,
  type: ContentRelation["type"],
  root: PageNode,
  link: ContentLink,
  fromContentId: string,
  order: number,
): { relation?: ContentRelation; warnings: string[] } {
  const nested = nestedRelationRoots(reader, adapter.rule.relations, root).map(candidate => candidate.root);
  const excludedRoots = topLevelNodes(reader, [
    ...nested,
    ...structuralExclusionRoots(reader, adapter, root),
  ]);
  const publicUrl = publicReferenceUrl(adapter.rule.canonicalize(link.url));
  const { candidates, warnings } = assetCandidates(reader, adapter, root, {
    excludedRoots,
    forceRootScope: true,
    includeCover: false,
    assetIdPrefix: relationAssetPrefix(adapter, type, link.id),
    sourceUrl: publicUrl,
  });
  // A relation has no separate title field in the snapshot contract. Its
  // post text must remain readable instead of being dropped as target-title
  // metadata, while bylines/timestamps still stay outside its body.
  const { blocks } = buildBlocks(reader, root, candidates, bodyExclusions(adapter, false), excludedRoots);
  const readable = blocks.some(block => block.type === "paragraph" || block.type === "quote" || block.type === "list")
    || candidates.some(candidate => candidate.asset.role !== "cover");
  if (!readable) return { warnings: [...warnings, "RELATED_ITEM_UNREADABLE"] };
  const blockedAssets = candidates.some(candidate => candidate.asset.availability === "blocked");
  return {
    relation: {
      type,
      from_content_id: fromContentId,
      to_content_id: link.id,
      order,
      source_url: publicUrl.href,
      authors: rootAuthors(reader, adapter, root, excludedRoots),
      published_at: rootPublishedAt(reader, adapter, root, excludedRoots),
      content_type: contentType(adapter, candidates),
      blocks,
      assets: candidates.map(candidate => candidate.asset),
      completeness: blockedAssets ? "partial" : "unknown",
      evidence: ["relation:explicit_item_link", `relation_type:${type}`, "relation_scope:mounted_dom_only"],
    },
    warnings,
  };
}

function scanContinuationCandidates(
  reader: PageReader,
  adapter: PlatformAdapter,
  targetRoot: PageNode,
  targetAuthors: readonly string[],
  parentId: string,
  knownIds: ReadonlySet<string>,
): { candidates: ContinuationCandidate[]; otherAuthorReplySeen: boolean; sameAuthorWithoutParentSeen: boolean } {
  const plan = adapter.rule.relations;
  if (!plan || !targetAuthors.length || !authorIdentityFromPermalink(reader.location)) return { candidates: [], otherAuthorReplySeen: false, sameAuthorWithoutParentSeen: false };
  const candidates: ContinuationCandidate[] = [];
  let otherAuthorReplySeen = false;
  let sameAuthorWithoutParentSeen = false;
  const targetIgnoredRoots = topLevelNodes(reader, [
    ...nestedRelationRoots(reader, plan, targetRoot).map(candidate => candidate.root),
    ...structuralExclusionRoots(reader, adapter, targetRoot),
  ]);
  for (const root of selectorNodes(reader, plan.item_roots)) {
    // A quoted/reposted item can itself be rendered as a post card. Its
    // nested permalink must never be mistaken for a next continuation.
    if (root === targetRoot || isInsideAny(reader, root, targetIgnoredRoots)) continue;
    const excludedRoots = topLevelNodes(reader, [
      ...nestedRelationRoots(reader, plan, root).map(candidate => candidate.root),
      ...structuralExclusionRoots(reader, adapter, root),
    ]);
    const link = singleUnseenContentLink(reader, adapter, root, plan.permalink_links, knownIds, excludedRoots);
    if (!link) continue;
    const sameAuthor = sameAuthorByPermalink(reader.location, link.url);
    const parentLinked = contentLinks(reader, adapter, root, plan.continuation_parent_links, excludedRoots).some(parent => parent.id === parentId);
    if (!parentLinked) {
      if (sameAuthor) sameAuthorWithoutParentSeen = true;
      continue;
    }
    if (!sameAuthor) {
      otherAuthorReplySeen = true;
      continue;
    }
    candidates.push({ root, link });
  }
  return { candidates, otherAuthorReplySeen, sameAuthorWithoutParentSeen };
}

function collectRelations(
  reader: PageReader,
  adapter: PlatformAdapter,
  targetRoot: PageNode,
  contentId: string,
  targetAuthors: readonly string[],
  limit: number,
): { relations: ContentRelation[]; warnings: string[]; evidence: string[]; relationRoots: PageNode[] } {
  const plan = adapter.rule.relations;
  const embeddedRoots = nestedRelationRoots(reader, plan, targetRoot);
  if (!limit || !plan) return { relations: [], warnings: [], evidence: [], relationRoots: embeddedRoots.map(candidate => candidate.root) };

  const warnings = new Set<string>(["RELATED_SCOPE_MOUNTED_ONLY"]);
  const evidence = ["related_scope:mounted_dom_only", `related_limit:${limit}`];
  const relations: ContentRelation[] = [];
  const knownIds = new Set<string>([contentId]);
  let parentId = contentId;

  while (relations.length < limit) {
    const scan = scanContinuationCandidates(reader, adapter, targetRoot, targetAuthors, parentId, knownIds);
    if (scan.otherAuthorReplySeen) warnings.add("RELATED_REPLY_AUTHOR_MISMATCH_EXCLUDED");
    if (scan.sameAuthorWithoutParentSeen) warnings.add("RELATED_SAME_AUTHOR_WITHOUT_PARENT_EXCLUDED");
    if (scan.candidates.length !== 1) {
      warnings.add(scan.candidates.length > 1 ? "RELATED_CONTINUATION_AMBIGUOUS" : "RELATED_CONTINUATION_NOT_PROVEN_IN_MOUNTED_DOM");
      break;
    }
    const candidate = scan.candidates[0];
    if (!candidate) break;
    const extracted = relationFromRoot(reader, adapter, "author_continuation", candidate.root, candidate.link, parentId, relations.length + 1);
    extracted.warnings.forEach(warning => warnings.add(warning));
    if (!extracted.relation) break;
    relations.push(extracted.relation);
    knownIds.add(candidate.link.id);
    parentId = candidate.link.id;
  }

  for (const candidate of withRelationLinks(reader, adapter, embeddedRoots, knownIds)) {
    if (relations.length >= limit) break;
    if (!candidate.link) {
      warnings.add(candidate.type === "quote" ? "RELATED_QUOTE_LINK_NOT_PROVEN" : "RELATED_REPOST_LINK_NOT_PROVEN");
      continue;
    }
    const extracted = relationFromRoot(reader, adapter, candidate.type, candidate.root, candidate.link, contentId, relations.length + 1);
    extracted.warnings.forEach(warning => warnings.add(warning));
    if (!extracted.relation) continue;
    relations.push(extracted.relation);
    knownIds.add(candidate.link.id);
  }

  if (relations.length >= limit) {
    const moreContinuation = scanContinuationCandidates(reader, adapter, targetRoot, targetAuthors, parentId, knownIds).candidates.length > 0;
    const moreEmbedded = withRelationLinks(reader, adapter, embeddedRoots, knownIds).some(candidate => !!candidate.link);
    if (moreContinuation || moreEmbedded) warnings.add("RELATED_ITEM_LIMIT_REACHED");
  }
  return { relations, warnings: [...warnings], evidence, relationRoots: embeddedRoots.map(candidate => candidate.root) };
}

function actionSelector(adapter: PlatformAdapter, type: "expand" | "play", targetId: string): string | null {
  const prefix = `${adapter.id}:${type}:`;
  if (!targetId.startsWith(prefix)) return null;
  const index = Number(targetId.slice(prefix.length));
  const selectors = type === "expand" ? adapter.rule.actions.expand : adapter.rule.actions.play;
  return Number.isInteger(index) && index >= 0 && index < selectors.length ? selectors[index] ?? null : null;
}

export function actionTargets(reader: PageReader, adapter: PlatformAdapter): SafeActionTarget[] {
  const targets: SafeActionTarget[] = [];
  for (const [type, selectors, label] of [
    ["expand", adapter.rule.actions.expand, "Expand approved content"],
    ["play", adapter.rule.actions.play, "Play target media in a muted task tab"],
  ] as const) {
    const scope = actionScope(reader, adapter, type);
    if (!scope) continue;
    selectors.forEach((selector, index) => {
      if (selectorNodes(reader, [selector], scope).length) targets.push({ id: `${adapter.id}:${type}:${index}`, type, label });
    });
  }
  return targets;
}

export function allowsAdapterAction(adapter: PlatformAdapter, action: BrowserAction): boolean {
  if (action.type === "scroll") return Number.isFinite(action.delta_y) && Math.abs(action.delta_y) <= adapter.rule.actions.max_scroll_delta;
  if (action.type === "navigate") return false;
  return actionSelector(adapter, action.type, action.target_id) !== null;
}

export function selectorForAdapterAction(adapter: PlatformAdapter, action: BrowserAction): string | null {
  return action.type === "expand" || action.type === "play" ? actionSelector(adapter, action.type, action.target_id) : null;
}

/** Resolves an opaque action id to a currently visible, target-scoped node. */
export function nodeForAdapterAction(reader: PageReader, adapter: PlatformAdapter, action: BrowserAction): PageNode | undefined {
  if (action.type !== "expand" && action.type !== "play") return undefined;
  const selector = actionSelector(adapter, action.type, action.target_id);
  const scope = actionScope(reader, adapter, action.type);
  if (!selector || !scope) return undefined;
  return selectorNodes(reader, [selector], scope)[0];
}

/**
 * A capture can perform at most one shipped text-expansion operation. This
 * helper exposes only a target-root-scoped node; selectors never cross the
 * bridge and page data cannot supply them.
 */
export function automaticExpandTarget(reader: PageReader, adapter: PlatformAdapter): PageNode | undefined {
  if (!adapter.rule.actions.automatic_expand?.length || accessError(classifyAccess(reader, adapter.rule))) return undefined;
  const root = actionRoot(reader, adapter, "expand");
  return root ? selectorNodes(reader, adapter.rule.actions.automatic_expand, root)[0] : undefined;
}

export function observe(reader: PageReader, adapter: PlatformAdapter, instanceId: string, tabId: number): BrowserObservation {
  const contentId = adapter.rule.contentId(reader.location);
  const targetPlan = targetRootPlanFor(adapter.rule, reader.location);
  let trustedRoot: PageNode | undefined;
  let observedContentRoot: PageNode | undefined;
  if (targetPlan && contentId) {
    try {
      const selection = selectedRoot(reader, adapter, contentId);
      trustedRoot = selection.contentRoot ?? selection.root;
      observedContentRoot = selection.contentRoot;
    } catch {
      // A route-plan candidate must remain unknown until its exact self-link
      // and public marker are both present. Access gates still take priority.
    }
  }
  const access = classifyAccess(reader, adapter.rule, trustedRoot);
  const publicVisibility = accessError(access);
  if (publicVisibility?.code === "ACCESS_UNCONFIRMED") throw new AdapterExtractionError(publicVisibility.code, publicVisibility.message);
  const publicUrl = publicReferenceUrl(adapter.rule.canonicalize(reader.location));
  const diagnostic = boundedDomDiagnostic(reader, adapter, access.accessClass);
  return {
    instance_id: instanceId,
    tab_id: tabId,
    url: publicUrl.href,
    title: observedContentRoot ? readableText(reader, observedContentRoot) || reader.documentTitle : firstText(reader, adapter.rule.selectors.title) ?? reader.documentTitle,
    origin: reader.location.origin,
    adapter_id: adapter.id,
    access_class: access.accessClass,
    action_targets: actionTargets(reader, adapter),
    ...(diagnostic ? { diagnostic } : {}),
    evidence: [`adapter:${adapter.id}@${adapter.version}`, `route:${contentId ?? "unknown"}`, ...access.evidence],
  };
}

export function extract(reader: PageReader, adapter: PlatformAdapter, options?: ExtractionOptions): ContentSnapshot {
  const contentId = adapter.rule.contentId(reader.location);
  if (!contentId) throw new AdapterExtractionError("TARGET_URL_MISMATCH", "The current page is not the adapter's supported single-content route.", false);
  const targetPlan = targetRootPlanFor(adapter.rule, reader.location);
  let rootSelection: RootSelection;
  let access: ReturnType<typeof classifyAccess>;
  if (targetPlan) {
    try {
      rootSelection = selectedRoot(reader, adapter, contentId);
    } catch (error) {
      // Without a proven public target root, a real login/private/paid marker
      // must still win over an adapter-shape error.
      const preliminaryAccess = classifyAccess(reader, adapter.rule);
      const preliminaryBlocked = accessError(preliminaryAccess);
      if (preliminaryBlocked) throw new AdapterExtractionError(preliminaryBlocked.code, preliminaryBlocked.message, false);
      throw error;
    }
    access = classifyAccess(reader, adapter.rule, rootSelection.contentRoot ?? rootSelection.root);
  } else {
    access = classifyAccess(reader, adapter.rule);
    const blocked = accessError(access);
    if (blocked) throw new AdapterExtractionError(blocked.code, blocked.message, false);
    rootSelection = selectedRoot(reader, adapter, contentId);
  }
  const blocked = accessError(access);
  if (blocked) throw new AdapterExtractionError(blocked.code, blocked.message, false);
  const { root, selector, contentRoot = root, contentSelector = selector, assetRoot = contentRoot } = rootSelection;
  // Nested quote/repost cards have their own author, body, and media. Keep
  // them outside the target even when the caller has not requested related
  // items, so a single-post snapshot can never silently absorb another post.
  const embeddedRelationRoots = nestedRelationRoots(reader, adapter.rule.relations, root).map(candidate => candidate.root);
  // `excluded` is a structural source-boundary, not merely a text filter.
  // Assets and metadata under an excluded comment/control subtree must never
  // survive as unplaced files or bylines after body traversal omits that tree.
  const configuredExcludedRoots = structuralExclusionRoots(reader, adapter, root);
  const initialExcludedRoots = topLevelNodes(reader, [...embeddedRelationRoots, ...configuredExcludedRoots]);
  const metadata = targetPlan?.metadata_from_content_root ? contentRoot : metadataRoot(reader, adapter, root);
  const authors = metadata ? rootAuthors(reader, adapter, metadata, initialExcludedRoots) : [];
  const related = collectRelations(reader, adapter, root, contentId, authors, boundedRelatedItems(options));
  const relationRoots = topLevelNodes(reader, [...initialExcludedRoots, ...related.relationRoots]);
  const externalFilePlans = adapter.rule.completion?.filter(plan =>
    plan.external_file_attachment && plan.applies(reader.location) && plan.content_root === contentSelector,
  ) ?? [];
  const { candidates, warnings: assetWarnings } = assetCandidates(reader, adapter, assetRoot, {
    excludedRoots: relationRoots,
    ...(externalFilePlans.length === 1 ? { documentFiles: true } : {}),
    ...(targetPlan?.asset_roots?.length ? { forceRootScope: true } : {}),
    // An identity card's document-wide og:image is not demonstrated post
    // media. A narrow text body must not inherit it as a cover asset.
    ...(targetPlan?.content_roots?.length ? { includeCover: false } : {}),
  });
  const snapshotContentType = contentType(adapter, candidates);
  const externalAttachment = externalFileAttachment(
    reader,
    adapter,
    contentRoot,
    contentSelector,
    snapshotContentType,
    candidates,
    relationRoots,
  );
  // A declared document attachment never acquires a fabricated source-body
  // position. Even when uniqueness fails (and therefore no proof is issued),
  // keep the observed file only in the asset/appendix path.
  const bodyCandidates = externalFilePlans.length === 1
    ? candidates.filter(candidate => candidate.asset.role !== "file" || reader.contains(contentRoot, candidate.node))
    : candidates;
  // Heading/author/time selectors are metadata fields. Preserve the title once
  // as a leading heading below, but do not turn bylines and timestamps into
  // source paragraphs merely because a platform places them inside the root.
  const blockBuild = buildBlocks(reader, contentRoot, bodyCandidates, bodyExclusions(adapter, !targetPlan?.content_roots?.length), relationRoots);
  const blocks = blockBuild.blocks;
  // A configured metadata root is the sole trusted scope for a title that
  // lives beside the narrow body. If that scope is ambiguous, do not fall
  // back to a document-wide title that could belong to a sidebar or comment.
  const title = targetPlan?.content_roots?.length
    ? undefined
    : (metadata
      ? rootFirstText(reader, adapter.rule.selectors.title, metadata, relationRoots)
      : rootFirstText(reader, adapter.rule.selectors.title, root, relationRoots))
      ?? (!adapter.rule.selectors.metadata_roots?.length && !relationRoots.length
        ? firstText(reader, adapter.rule.selectors.title)
        : undefined);
  const bodyHasProse = blocks.some(block => block.type !== "heading" && contentBlockHasText(block));
  const bodyHasApprovedAsset = bodyCandidates.some(candidate => candidate.asset.role !== "cover" && candidate.asset.availability === "available");
  const rootText = normalize(reader.text(contentRoot));
  const rootHasMoreThanTitle = !relationRoots.length && !!rootText && (!title || rootText !== title);
  if (!bodyHasProse && !bodyHasApprovedAsset && !rootHasMoreThanTitle) {
    throw new AdapterExtractionError("ADAPTER_CHANGED", "The target root contains only a title or empty shell, not readable source content.", true);
  }
  if (title && !blocks.some(block => block.type === "heading" && block.text === title)) {
    blocks.unshift({ type: "heading", level: 1, text: title });
  }
  const leadingText = leadingTextBlock(reader, adapter, metadata, root, relationRoots);
  // Node containment in leadingTextBlock is the duplicate guard: equal prose
  // at two distinct source positions remains two source occurrences.
  if (leadingText) {
    const titleIndex = title ? blocks.findIndex(block => block.type === "heading" && block.text === title) : -1;
    blocks.splice(titleIndex >= 0 ? titleIndex + 1 : 0, 0, leadingText);
  }
  if (!blocks.length) throw new AdapterExtractionError("ADAPTER_CHANGED", "The target root had no readable content or approved media.", true);
  const publishedAt = metadata ? rootPublishedAt(reader, adapter, metadata, relationRoots) : null;
  const canonical = publicReferenceUrl(adapter.rule.canonicalize(reader.location));
  const blockedAssets = candidates.filter(candidate => candidate.asset.availability === "blocked");
  const expansionAvailable = actionTargets(reader, adapter).some(target => target.type === "expand");
  const relatedScopeRequested = boundedRelatedItems(options) > 0 && !!adapter.rule.relations;
  const completionCandidate = completionProof(
    reader,
    adapter,
    contentRoot,
    metadata,
    contentSelector,
    contentId,
    snapshotContentType,
    access.accessClass,
    bodyCandidates,
    externalAttachment,
    assetWarnings,
    blockBuild,
    expansionAvailable,
    relatedScopeRequested,
    related.relations.length,
  );
  const proof = completionCandidate?.plan.stability ? undefined : completionCandidate?.proof;
  const completeness = blockedAssets.length || expansionAvailable ? "partial" : proof ? "complete" : "unknown";
  const warnings = [
    ...assetWarnings,
    ...related.warnings,
    ...(targetPlan?.source_scope_warning ? [targetPlan.source_scope_warning] : []),
    ...(adapter.coverage.verification === "browser_verified" ? [] : ["BROWSER_VALIDATION_PENDING"]),
    ...(blockedAssets.length ? ["ASSET_HOST_RESTRICTED"] : []),
    ...(expansionAvailable ? ["CONTENT_MAY_BE_COLLAPSED"] : []),
    ...(completeness === "complete" ? [] : ["COMPLETENESS_NOT_CONFIRMED_BY_BROWSER"]),
  ];
  const snapshot: ContentSnapshot = {
    schema_version: "1",
    platform: adapter.id,
    adapter_version: adapter.version,
    source_url: canonical.href,
    canonical_url: canonical.href,
    platform_content_id: contentId,
    content_type: snapshotContentType,
    ...(title ? { title } : {}),
    authors,
    published_at: publishedAt,
    blocks,
    assets: candidates.map(candidate => candidate.asset),
    ...(related.relations.length ? { relations: related.relations } : {}),
    access_class: access.accessClass,
    completeness,
    ...(proof ? { completeness_proof: proof } : {}),
    warnings,
    evidence: [
      `adapter:${adapter.id}@${adapter.version}`,
      `route:${contentId}`,
      `body_root:${contentSelector}`,
      ...(proof ? [`completion_rule:${proof.rule_id}`, `completion_boundary:${proof.boundary}`] : []),
      ...related.evidence,
      ...access.evidence,
    ],
  };
  if (completionCandidate?.plan.stability && completeness === "unknown") {
    stableCompletionCandidates.set(snapshot, completionCandidate);
  }
  return snapshot;
}
