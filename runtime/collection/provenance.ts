import { createHash } from 'node:crypto';
import type { SourceAsset } from '../../shared/contracts.js';
import { redactUrl } from '../storage/job-store.js';

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** A source identity only: volatile authorization parameters never enter a persisted artifact. */
export function assetSourceFingerprint(asset: SourceAsset): string {
  return fingerprint({
    role: asset.role,
    url: redactUrl(asset.url),
    source_url: asset.source_url ? redactUrl(asset.source_url) : null,
    media_type: asset.media_type ?? null,
    language: asset.language ?? null,
    width: asset.width ?? null,
    height: asset.height ?? null,
    duration_seconds: asset.duration_seconds ?? null,
    quality: asset.quality ?? null,
    availability: asset.availability,
  });
}

/** Multiple formats for one media item must share one bounded source identity. */
export function mediaSourceFingerprint(kind: 'audio' | 'video', id: string, assets: SourceAsset[], pageUrl: string): string {
  const candidates = assets.filter(asset => asset.role === kind || (kind === 'audio' && asset.role === 'video'))
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  return fingerprint({ kind, id, page: redactUrl(pageUrl), assets: candidates.map(asset => ({ id: asset.id, source: assetSourceFingerprint(asset) })) });
}
