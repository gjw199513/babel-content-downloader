import type { ContentType, SaveComponent } from "../../shared/contracts.js";
import { cleanCanonicalUrl } from "../shared-extractors/url.js";
import type {
  AccessSignals,
  AllowedActions,
  DomCompletionPlan,
  DomDiagnosticPlan,
  PlatformCoverage,
  RelationPlan,
  PlatformRule,
  SelectorPlan,
  TargetRootPlan,
} from "../types.js";

export interface PlatformSpec {
  rule: PlatformRule;
  asset_hosts: readonly string[];
  /**
   * Source-owned components that must accompany a document request. This is
   * compiled adapter policy, not a page- or MCP-provided instruction.
   */
  required_document_components?: readonly SaveComponent[];
  /** Trusted route-specific requirements, e.g. a publication full text beside its abstract. */
  document_components_for_url?: (url: URL) => readonly SaveComponent[];
  /**
   * Narrow HTTPS exceptions for CDN origins actually observed for this
   * platform. These declarations are consumed by the runtime network policy;
   * they are not inferred from page content or caller input.
   */
  asset_https_ports?: readonly { readonly host: string; readonly ports: readonly number[] }[];
  asset_origins?: readonly string[];
  engine: "yt-dlp" | "direct" | "browser";
  status: "implemented" | "experimental";
  coverage: PlatformCoverage;
}

const EMPTY: readonly string[] = [];

export const DEFAULT_ACCESS: AccessSignals = {
  login_gates: ["[data-testid='login-gate']", "[data-e2e='login-container']"],
  paid_gates: ["[data-testid='paywall']", "[data-testid='subscription-gate']", "[data-e2e='paywall']"],
  private_gates: ["[data-testid='private-content']", "[data-e2e='private-content']"],
  login_text: ["登录后查看", "登录后可查看", "Log in to continue"],
  paid_text: ["会员专享", "付费内容", "订阅后查看", "Subscribe to read", "Members only"],
  private_text: ["仅自己可见", "内容不可见", "This account is private"],
};

export const DEFAULT_ACTIONS: AllowedActions = {
  expand: EMPTY,
  play: EMPTY,
  max_scroll_delta: 800,
};

export function plan(overrides: Partial<SelectorPlan> & Pick<SelectorPlan, "roots">): SelectorPlan {
  return {
    roots: overrides.roots,
    ...(overrides.metadata_roots ? { metadata_roots: overrides.metadata_roots } : {}),
    ...(overrides.leading_text ? { leading_text: overrides.leading_text } : {}),
    title: overrides.title ?? EMPTY,
    authors: overrides.authors ?? EMPTY,
    ...(overrides.author_excluded ? { author_excluded: overrides.author_excluded } : {}),
    published: overrides.published ?? EMPTY,
    canonical: overrides.canonical ?? ["link[rel='canonical']"],
    images: overrides.images ?? EMPTY,
    videos: overrides.videos ?? EMPTY,
    audio: overrides.audio ?? EMPTY,
    subtitles: overrides.subtitles ?? EMPTY,
    cover: overrides.cover ?? ["meta[property='og:image']"],
    files: overrides.files ?? EMPTY,
    ...(overrides.asset_scope ? { asset_scope: overrides.asset_scope } : {}),
    ...(overrides.excluded ? { excluded: overrides.excluded } : {}),
  };
}

export interface RuleInput {
  id: string;
  hosts: readonly string[];
  patterns: readonly string[];
  contentTypes: readonly ContentType[];
  defaultType: ContentType;
  selectors: SelectorPlan;
  contentId: (url: URL) => string | null;
  /** Restricts a selected attachment to the requested source item. */
  file_matches?: (target: URL, asset: URL) => boolean;
  canonicalize?: (url: URL) => URL;
  access?: AccessSignals;
  actions?: AllowedActions;
  completion?: readonly DomCompletionPlan[];
  domDiagnostic?: DomDiagnosticPlan;
  targetLinkSelectors?: readonly string[];
  targetRootPlans?: readonly TargetRootPlan[];
  relations?: RelationPlan;
}

export function rule(input: RuleInput): PlatformRule {
  return {
    id: input.id,
    version: "2026.09.20.7",
    hosts: input.hosts,
    supported_url_patterns: input.patterns,
    content_types: input.contentTypes,
    default_content_type: input.defaultType,
    selectors: input.selectors,
    ...(input.file_matches ? { file_matches: input.file_matches } : {}),
    ...(input.targetLinkSelectors ? { target_link_selectors: input.targetLinkSelectors } : {}),
    ...(input.targetRootPlans ? { target_root_plans: input.targetRootPlans } : {}),
    ...(input.relations ? { relations: input.relations } : {}),
    ...(input.completion ? { completion: input.completion } : {}),
    ...(input.domDiagnostic ? { dom_diagnostic: input.domDiagnostic } : {}),
    access: input.access ?? DEFAULT_ACCESS,
    actions: input.actions ?? DEFAULT_ACTIONS,
    contentId: input.contentId,
    canonicalize: input.canonicalize ?? cleanCanonicalUrl,
  };
}

export function pathId(expression: RegExp): (url: URL) => string | null {
  return (url: URL) => expression.exec(url.pathname)?.[1] ?? null;
}


export function firstId(...readers: readonly ((url: URL) => string | null)[]): (url: URL) => string | null {
  return (url: URL) => readers.map(read => read(url)).find((value): value is string => !!value) ?? null;
}

export function preserveQuery(...keys: readonly string[]): (url: URL) => URL {
  return (url: URL) => cleanCanonicalUrl(url, keys);
}

export function baselineCoverage(verification: PlatformCoverage["verification"], note: string): PlatformCoverage {
  return { tier: "baseline", implementation: "implemented", verification, access_review: "review_required", note };
}
