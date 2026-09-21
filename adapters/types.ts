import type {
  AccessClass,
  AdapterDefinition,
  AdapterRegistry,
  ContentSnapshot,
  ContentType,
} from "../shared/contracts.js";
import type { BrowserAction, BrowserObservation } from "../shared/bridge-protocol.js";

/**
 * A DOM node is intentionally opaque to adapter logic. This lets the same
 * extraction rules run against a browser DOM and deterministic fixtures.
 */
export type PageNode = object;

export interface PageReader {
  readonly location: URL;
  readonly documentTitle: string;
  select(selectors: readonly string[], scope?: PageNode): PageNode[];
  text(node: PageNode): string;
  /** Source whitespace for code and formula text; no markup or script evaluation. */
  rawText?(node: PageNode): string;
  attribute(node: PageNode, name: string): string | null;
  tagName(node: PageNode): string;
  isText(node: PageNode): boolean;
  children(node: PageNode): PageNode[];
  /** Optional structural parent for a bounded adapter-owned diagnostic walk. */
  parent?(node: PageNode): PageNode | undefined;
  /**
   * The browser's resolved source of a standard video/audio element. This is
   * optional so deterministic non-browser readers remain valid; callers must
   * still apply safeHttpUrl and the adapter asset-host allowlist.
   */
  mediaSource?(node: PageNode): string | null;
  /** Structural containment only; never asks a page to evaluate arbitrary code. */
  contains(ancestor: PageNode, node: PageNode): boolean;
  visible(node: PageNode): boolean;
}

export type CoverageTier = "baseline" | "development_fixture";
export type ImplementationStatus = "implemented";
export type VerificationStatus = "unverified" | "fixture_verified" | "browser_verified" | "blocked";

/** Kept separate from AdapterDefinition.status so a selector file never becomes a support claim. */
export interface PlatformCoverage {
  tier: CoverageTier;
  implementation: ImplementationStatus;
  verification: VerificationStatus;
  access_review: "pending" | "review_required" | "reviewed";
  note: string;
}

export interface SelectorPlan {
  roots: readonly string[];
  /**
   * Optional, shipped containers for metadata that lives beside the selected
   * content root. A candidate is usable only when it uniquely contains that
   * root, so metadata can never fall through to a sidebar, comment, or a
   * neighbouring item.
   */
  metadata_roots?: readonly string[];
  /**
   * A small, source-authored introduction that lives in the uniquely bound
   * metadata container immediately before the narrow body root. It is never
   * read from the document at large, and is skipped when it is already in the
   * body so extraction cannot duplicate it.
   */
  leading_text?: readonly string[];
  title: readonly string[];
  authors: readonly string[];
  /**
   * Shipped descendants to omit only while reading an author field. This is
   * for source annotations such as a nested footnote marker; it never changes
   * body traversal and never interprets author text with a regex.
   */
  author_excluded?: readonly string[];
  published: readonly string[];
  canonical: readonly string[];
  images: readonly string[];
  videos: readonly string[];
  /**
   * Adapter-owned fallback sources for players whose DOM media element only
   * exposes a blob URL. The callback may inspect bounded page text through the
   * reader, but it never evaluates page code or performs network access.
   */
  video_source_urls?: (reader: PageReader, root: PageNode) => readonly string[];
  audio: readonly string[];
  subtitles: readonly string[];
  cover: readonly string[];
  files: readonly string[];
  /** Metadata/body stay rooted; a platform may name a precise top-level player separately. */
  asset_scope?: "root" | "document";
  excluded?: readonly string[];
}

export interface AccessSignals {
  login_gates: readonly string[];
  paid_gates: readonly string[];
  private_gates: readonly string[];
  /** Narrow, page-state phrases. They are never treated as instructions. */
  login_text?: readonly string[];
  paid_text?: readonly string[];
  private_text?: readonly string[];
  /** Positive public visibility evidence shipped for account-scoped sources. */
  public_marker?: { selectors: readonly string[]; text: string };
  /** Read-only, adapter-owned metadata check; no page script or network access. */
  public_check?: (reader: PageReader) => boolean;
}

/**
 * A route-specific, shipped target boundary for a page that also mounts
 * non-target cards or a non-blocking registration banner. It is evaluated
 * entirely from adapter code and never accepts page- or MCP-provided rules.
 */
export interface TargetRootPlan {
  applies(url: URL): boolean;
  /** These replace the generic roots only while this plan applies. */
  roots: readonly string[];
  /**
   * Optional, uniquely selected readable source node inside the verified
   * target card. It is useful when the surrounding card also mounts author,
   * reaction, and comment UI. The outer root remains the identity/access
   * boundary; extraction walks only this node.
   */
  content_roots?: readonly string[];
  /** Restrict metadata lookup to the narrow readable source node for this route. */
  metadata_from_content_root?: boolean;
  /** A shipped, user-visible scope limitation for a narrowly readable route. */
  source_scope_warning?: string;
  /**
   * An independently bounded media container when the readable text lives in
   * a sibling source node. Its candidates remain unproved for source order
   * unless the enclosing route has a completion plan.
   */
  asset_roots?: readonly string[];
  /** The candidate root's own link must resolve to the requested item. */
  target_link_selectors?: readonly string[];
  /**
   * A route-specific identity element such as a platform work-id attribute.
   * The selected node must be unique and exactly equal to the URL's parsed
   * content ID; page text and CSS classes are never used as identity.
   */
  target_id?: { selectors: readonly string[]; attribute: string };
  /** Optional platform identity constraint beyond the stable content ID. */
  matches_target_link?: (target: URL, candidate: URL) => boolean;
  /** A public marker must be present with this exact normalized text. */
  public_marker?: { selectors: readonly string[]; text: string };
  /**
   * A login form may be ignored only after this plan has already proven a
   * public target root, and only when the form lies below this ancestor.
   */
  non_blocking_login_gate?: { selector: string; ancestor_selector: string };
}

export interface AllowedActions {
  expand: readonly string[];
  /**
   * Shipped, target-root-scoped text expanders that a snapshot may use once
   * in an extension-owned task tab. They are never supplied by an MCP caller.
   */
  automatic_expand?: readonly string[];
  play: readonly string[];
  max_scroll_delta: number;
}

/**
 * A completion plan is shipped adapter code, never a selector or assertion
 * accepted from a source page or MCP caller. It applies to one route family
 * and to the exact selector that selected the content root for this capture.
 */
export interface DomCompletionPlan {
  id: string;
  content_types: readonly ContentType[];
  applies(url: URL): boolean;
  content_root: string;
  boundary:
    | { type: "root_exhausted" }
    | {
      type: "terminal_observed";
      selectors: readonly string[];
      /** Defaults to the selected body root. Article metadata scopes are valid only when uniquely bound to it. */
      scope?: "content_root" | "metadata_root";
      /** A shipped outer body container that must uniquely contain the selected content root. */
      anchor_selector?: string;
      /** Require the terminal marker to be the next element child after that anchor. */
      immediately_after_anchor?: boolean;
    };
  pending_or_truncation: readonly string[];
  /**
   * This route has one adapter-selected file attachment outside the readable
   * body root. The extractor still requires one visible `selectors.files`
   * match, exact `file_matches`, and the normal asset-host policy.
   */
  external_file_attachment?: true;
  /** Repeated read-only samples required before a static bounded proof may become complete. */
  stability?: { sample_count: number; minimum_window_ms: number };
}

/**
 * A tiny read-only diagnostic plan compiled into an adapter. It is intentionally
 * separate from extraction and completion rules: no MCP caller or page can
 * provide selectors, and only a route-specific adapter may opt in.
 */
export interface DomDiagnosticPlan {
  id: string;
  applies(url: URL): boolean;
  roots: readonly { id: string; selector: string }[];
  /** Only plans with this flag can emit a bounded root-to-probe outline. */
  include_outline?: true;
  /** Source-observed semantic probes, capped before their ancestor chains are returned. */
  probes?: readonly { id: "input" | "figure"; selector: string; max_nodes: number }[];
}

/**
 * Platform-shipped evidence selectors for bounded post relationships. A
 * continuation is usable only when its candidate root carries a direct parent
 * permalink selected by `continuation_parent_links`.
 */
export interface RelationPlan {
  item_roots: readonly string[];
  permalink_links: readonly string[];
  continuation_parent_links: readonly string[];
  quote_roots: readonly string[];
  repost_roots: readonly string[];
}

/**
 * Explicit browser-read scope supplied by the trusted bridge. It is not page
 * data and defaults to one target item when omitted or zero.
 */
export interface ExtractionOptions {
  max_related_items?: number;
}

export interface PlatformRule {
  id: string;
  version: string;
  hosts: readonly string[];
  supported_url_patterns: readonly string[];
  content_types: readonly ContentType[];
  default_content_type: ContentType;
  selectors: SelectorPlan;
  /** Shipped attachment identity boundary, e.g. the selected paper's exact PDF. */
  file_matches?: (target: URL, asset: URL) => boolean;
  /** Used on feed-shaped pages to prove that a candidate root is the requested item. */
  target_link_selectors?: readonly string[];
  /** Narrow route plans can replace broad feed roots without changing other routes. */
  target_root_plans?: readonly TargetRootPlan[];
  relations?: RelationPlan;
  completion?: readonly DomCompletionPlan[];
  dom_diagnostic?: DomDiagnosticPlan;
  access: AccessSignals;
  actions: AllowedActions;
  /** Returns a stable source-specific id only for a supported single-content route. */
  contentId(url: URL): string | null;
  canonicalize(url: URL): URL;
}

export interface PlatformAdapter extends AdapterDefinition {
  readonly rule: PlatformRule;
  readonly coverage: PlatformCoverage;
  /** Only used by the opt-in local fixture adapter; production adapters use host allowlists. */
  readonly asset_origins?: readonly string[];
  extract(reader: PageReader, options?: ExtractionOptions): ContentSnapshot;
  observe(reader: PageReader, instanceId: string, tabId: number): BrowserObservation;
  allowsAction(action: BrowserAction): boolean;
}

export interface PlatformRegistry extends AdapterRegistry {
  match(url: URL): PlatformAdapter | undefined;
  get(id: string): PlatformAdapter | undefined;
  list(): PlatformAdapter[];
}

export class AdapterExtractionError extends Error {
  constructor(
    public readonly code:
      | "ADAPTER_CHANGED"
      | "LOGIN_REQUIRED"
      | "PAID_CONTENT_EXCLUDED"
      | "PRIVATE_CONTENT_EXCLUDED"
      | "ACCESS_UNCONFIRMED"
      | "TARGET_URL_MISMATCH"
      | "ASSET_HOST_NOT_ALLOWED",
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "AdapterExtractionError";
  }
}

export interface AccessClassification {
  accessClass: AccessClass;
  evidence: string[];
}
