import type { BrowserAction } from "../shared/bridge-protocol.js";
import { allowsAdapterAction, extract, observe } from "./shared-extractors/extractor.js";
import { matchesAnyHost } from "./shared-extractors/url.js";
import { DOMESTIC_SPECS } from "./platforms/domestic.js";
import { INTERNATIONAL_SPECS } from "./platforms/international.js";
import { RESEARCH_BLOG_SPECS } from "./platforms/research-blogs.js";
import { RESEARCH_SPECS } from "./platforms/research.js";
import { plan, rule, type PlatformSpec } from "./platforms/spec.js";
import type { PlatformAdapter, PlatformCoverage, PlatformRegistry } from "./types.js";

declare const __BABEL_DEV_FIXTURES__: boolean;

/**
 * Node runtime builds keep the operator-configured fixture route available.
 * Extension bundles receive a literal from esbuild, so release builds can
 * remove the fixture adapter and its loopback origin completely.
 */
const DEVELOPMENT_FIXTURES_COMPILED_IN = typeof __BABEL_DEV_FIXTURES__ === "undefined" || __BABEL_DEV_FIXTURES__;

export const DEVELOPMENT_FIXTURE_ORIGIN = "http://127.0.0.1:4319";

function developmentFixtureSpec(): PlatformSpec {
  return {
    rule: rule({
      id: "development_fixture",
      hosts: ["127.0.0.1"],
      patterns: ["http://127.0.0.1:4319/fixture/content/:id"],
      contentTypes: ["article", "image_note", "video", "audio", "mixed"],
      defaultType: "article",
      contentId: url => /^\/fixture\/content\/([A-Za-z0-9_-]+)$/.exec(url.pathname)?.[1] ?? null,
      selectors: plan({
        roots: ["[data-babel-fixture='content']"],
        title: ["[data-babel-fixture='title']"],
        authors: ["[data-babel-fixture='author']"],
        published: ["time[data-babel-fixture='published']"],
      images: ["img[data-babel-fixture='image']"],
      videos: ["video[data-babel-fixture='video']"],
      audio: ["audio[data-babel-fixture='audio']"],
      subtitles: ["track[data-babel-fixture='subtitle']"],
      files: ["a[data-babel-fixture='file']"],
        cover: ["meta[data-babel-fixture='cover']"],
      }),
      completion: [{
        id: "development_fixture.bounded_root.v1",
        content_types: ["article", "image_note", "video", "audio", "mixed"],
        applies: url => url.origin === DEVELOPMENT_FIXTURE_ORIGIN && /^\/fixture\/content\/[A-Za-z0-9_-]+$/.test(url.pathname),
        content_root: "[data-babel-fixture='content']",
        boundary: { type: "root_exhausted" },
        pending_or_truncation: [],
      }],
    }),
    asset_hosts: ["127.0.0.1"],
    asset_origins: [DEVELOPMENT_FIXTURE_ORIGIN],
    engine: "direct",
    status: "implemented",
    coverage: {
      tier: "development_fixture",
      implementation: "implemented",
      verification: "fixture_verified",
      access_review: "reviewed",
      note: "Only included when trusted local development explicitly enables the fixed 127.0.0.1:4319 fixture origin.",
    },
  };
}

const BASELINE_SPECS: readonly PlatformSpec[] = [
  ...DOMESTIC_SPECS,
  ...INTERNATIONAL_SPECS,
  ...RESEARCH_SPECS,
  ...RESEARCH_BLOG_SPECS,
];

function adapterFrom(spec: PlatformSpec, extraMatch?: (url: URL) => boolean): PlatformAdapter {
  const { rule: platformRule } = spec;
  const adapter: PlatformAdapter = {
    id: platformRule.id,
    version: platformRule.version,
    hosts: [...platformRule.hosts],
    supported_url_patterns: [...platformRule.supported_url_patterns],
    asset_hosts: [...spec.asset_hosts],
    ...(spec.asset_https_ports
      ? { asset_https_ports: spec.asset_https_ports.map(rule => ({ host: rule.host, ports: [...rule.ports] })) }
      : {}),
    ...(spec.asset_origins ? { asset_origins: [...spec.asset_origins] } : {}),
    engine: spec.engine,
    validation_status: platformValidationStatus(spec.coverage),
    content_types: [...platformRule.content_types],
    ...(spec.required_document_components
      ? { required_document_components: [...spec.required_document_components] }
      : {}),
    ...(spec.document_components_for_url
      ? { document_components_for_url: (url: URL) => adapter.match(url) ? spec.document_components_for_url!(url) : [] }
      : {}),
    status: spec.status,
    ...(platformRule.completion?.length
      ? {
          completion_rules: platformRule.completion.map(completion => ({
            id: completion.id,
            content_types: [...completion.content_types],
            boundary: completion.boundary.type,
            ...(completion.external_file_attachment ? { external_file_attachment: true as const } : {}),
            ...(completion.stability
              ? {
                  stability: {
                    sample_count: completion.stability.sample_count,
                    minimum_window_ms: completion.stability.minimum_window_ms,
                  },
                }
              : {}),
            matches: (url: URL, platformContentId: string) => completion.applies(url) && platformRule.contentId(url) === platformContentId,
          })),
        }
      : {}),
    rule: platformRule,
    coverage: spec.coverage,
    match: (url: URL) => matchesAnyHost(url, platformRule.hosts) && platformRule.contentId(url) !== null && (extraMatch?.(url) ?? true),
    extract: (reader, options) => extract(reader, adapter, options),
    observe: (reader, instanceId, tabId) => observe(reader, adapter, instanceId, tabId),
    allowsAction: (action: BrowserAction) => allowsAdapterAction(adapter, action),
  };
  return adapter;
}

function platformValidationStatus(coverage: PlatformCoverage): "unverified" | "fixture_verified" | "browser_verified" {
  return coverage.verification === "browser_verified" || coverage.verification === "fixture_verified"
    ? coverage.verification
    : "unverified";
}

export interface AdapterRegistryOptions {
  /** Trusted runtime config. Only the fixed development fixture origin is accepted. */
  fixture_origins?: readonly string[];
}

function registryFrom(adapters: PlatformAdapter[]): PlatformRegistry {
  return {
    match: (url: URL) => adapters.find(adapter => adapter.match(url)),
    get: (id: string) => adapters.find(adapter => adapter.id === id),
    list: () => [...adapters],
  };
}

export function createBaselineAdapterRegistry(): PlatformRegistry {
  return registryFrom(BASELINE_SPECS.map(spec => adapterFrom(spec)));
}

/**
 * Production matching contains only the explicitly retained baseline routes.
 * No fallback registry accepts unregistered domains.
 */
export function createAdapterRegistry(options: AdapterRegistryOptions = {}): PlatformRegistry {
  const adapters = BASELINE_SPECS.map(spec => adapterFrom(spec));
  if (DEVELOPMENT_FIXTURES_COMPILED_IN && options.fixture_origins?.includes(DEVELOPMENT_FIXTURE_ORIGIN)) {
    adapters.push(adapterFrom(developmentFixtureSpec(), url => url.origin === DEVELOPMENT_FIXTURE_ORIGIN));
  }
  return registryFrom(adapters);
}

export interface PlatformCoverageRecord extends PlatformCoverage {
  id: string;
  version: string;
  supported_url_patterns: readonly string[];
  content_types: readonly string[];
}

/** Reports only explicitly registered production routes. */
export function listPlatformCoverage(): PlatformCoverageRecord[] {
  return BASELINE_SPECS.map(spec => ({
    id: spec.rule.id,
    version: spec.rule.version,
    supported_url_patterns: [...spec.rule.supported_url_patterns],
    content_types: [...spec.rule.content_types],
    ...spec.coverage,
  }));
}

export function isTrustedDevelopmentFixtureUrl(url: URL): boolean {
  return DEVELOPMENT_FIXTURES_COMPILED_IN && url.origin === DEVELOPMENT_FIXTURE_ORIGIN && developmentFixtureSpec().rule.contentId(url) !== null;
}
