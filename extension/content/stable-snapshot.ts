import type { AdapterDefinition, CompletionRuleDefinition, ContentCompletenessProof, ContentSnapshot } from "../../shared/contracts.js";

const MAIN_ASSET_ROLES = new Set(["image", "video", "audio", "file"]);

export interface StableSnapshotResult {
  snapshot: ContentSnapshot;
  stability?: NonNullable<ContentCompletenessProof["stability"]>;
}

interface StableSnapshotDependencies {
  pause?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  hash?: (material: string) => Promise<string>;
}

function completionRule(adapter: AdapterDefinition, pageUrl: URL, snapshot: ContentSnapshot): CompletionRuleDefinition | undefined {
  const contentId = snapshot.platform_content_id;
  if (!contentId || snapshot.platform !== adapter.id || snapshot.adapter_version !== adapter.version) return undefined;
  return adapter.completion_rules?.find(rule => {
    if (!rule.stability || !rule.content_types.includes(snapshot.content_type)) return false;
    try {
      return adapter.match(pageUrl) && rule.matches(pageUrl, contentId)
        && [snapshot.source_url, snapshot.canonical_url].every(value => {
          const url = new URL(value);
          return adapter.match(url) && rule.matches(url, contentId);
        });
    } catch {
      return false;
    }
  });
}

/** Volatile material used only inside the content script; source URLs never cross except as a digest. */
export function stableSnapshotMaterial(snapshot: ContentSnapshot): string {
  const orderedAssets = snapshot.assets
    .map((asset, index) => ({ asset, index }))
    .filter(({ asset }) => MAIN_ASSET_ROLES.has(asset.role))
    .sort((left, right) => left.asset.order - right.asset.order || left.index - right.index)
    .map(({ asset }) => ({
      id: asset.id,
      role: asset.role,
      order: asset.order,
      url: asset.url,
      source_url: asset.source_url ?? null,
    }));
  return JSON.stringify({
    platform: snapshot.platform,
    adapter_version: snapshot.adapter_version,
    source_url: snapshot.source_url,
    canonical_url: snapshot.canonical_url,
    platform_content_id: snapshot.platform_content_id ?? null,
    content_type: snapshot.content_type,
    blocks: snapshot.blocks,
    assets: orderedAssets,
  });
}

async function sha256(material: string): Promise<string> {
  const bytes = new TextEncoder().encode(material);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}

/**
 * Re-reads a matching adapter route without interacting with the page. A
 * stable result is only returned when every bounded sample has identical
 * content identity and the adapter-owned observation window was met.
 */
export async function sampleStableSnapshot(
  adapter: AdapterDefinition,
  pageUrl: URL,
  extract: () => ContentSnapshot,
  dependencies: StableSnapshotDependencies = {},
): Promise<StableSnapshotResult> {
  const first = extract();
  const rule = completionRule(adapter, pageUrl, first);
  if (!rule?.stability) return { snapshot: first };

  const sampleCount = rule.stability.sample_count;
  const minimumWindow = rule.stability.minimum_window_ms;
  if (!Number.isInteger(sampleCount) || sampleCount < 2 || sampleCount > 8
    || !Number.isInteger(minimumWindow) || minimumWindow < 1 || minimumWindow > 60_000) return { snapshot: first };

  const pause = dependencies.pause ?? (milliseconds => new Promise<void>(resolve => globalThis.setTimeout(resolve, milliseconds)));
  const now = dependencies.now ?? (() => performance.now());
  const hash = dependencies.hash ?? sha256;
  const started = now();
  const expected = stableSnapshotMaterial(first);
  let latest = first;
  const interval = Math.ceil(minimumWindow / (sampleCount - 1));
  for (let index = 1; index < sampleCount; index++) {
    await pause(interval);
    latest = extract();
    const latestRule = completionRule(adapter, pageUrl, latest);
    if (latestRule?.id !== rule.id || stableSnapshotMaterial(latest) !== expected) return { snapshot: latest };
  }
  const windowMs = Math.floor(now() - started);
  if (windowMs < minimumWindow || windowMs > 60_000) return { snapshot: latest };
  const fingerprint = await hash(expected);
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) return { snapshot: latest };
  return { snapshot: latest, stability: { sample_count: sampleCount, window_ms: windowMs, fingerprint } };
}
