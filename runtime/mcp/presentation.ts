import type { Artifact, JobRecord } from '../../shared/contracts.js';

const DEFAULT_ARTIFACT_LIMIT = 10;
const MAX_ARTIFACT_LIMIT = 50;

function short(value: string | undefined, length = 600): string | undefined {
  return value && value.length > length ? `${value.slice(0, length)}…` : value;
}

function artifactReference(artifact: Artifact): Record<string, unknown> {
  return {
    role: artifact.role, path: artifact.path, media_type: artifact.media_type,
    size: artifact.size, sha256: artifact.sha256,
    ...(artifact.duration_seconds === undefined ? {} : { duration_seconds: artifact.duration_seconds }),
    ...(artifact.width === undefined ? {} : { width: artifact.width }),
    ...(artifact.height === undefined ? {} : { height: artifact.height }),
    ...(artifact.language === undefined ? {} : { language: artifact.language }),
  };
}

/** Tool results are navigation/status, not a second copy of the collected document. */
export function summarizeJob(job: JobRecord, options: { artifactOffset?: number; artifactLimit?: number; compact?: boolean } = {}): Record<string, unknown> {
  const snapshot = job.snapshot;
  const status = {
    id: job.id, client_id: job.client_id, status: job.status, stage: job.stage,
    created_at: job.created_at, updated_at: job.updated_at, attempts: job.attempts,
    automatic_retries: job.automatic_retries, retry_at: job.retry_at, checkpoint_expired_at: job.checkpoint_expired_at,
    title: short(snapshot?.title, 240), platform: snapshot?.platform,
    completeness: job.completeness, artifact_count: job.artifacts.length,
    artifact_root: job.artifact_root,
    error: job.error ? { ...job.error, message: short(job.error.message, 1000) } : undefined,
    selection_required: job.selection_required,
  };
  if (options.compact) return status;

  const offset = Math.max(0, Math.floor(options.artifactOffset ?? 0));
  const limit = Math.min(MAX_ARTIFACT_LIMIT, Math.max(1, Math.floor(options.artifactLimit ?? DEFAULT_ARTIFACT_LIMIT)));
  const end = Math.min(job.artifacts.length, offset + limit);
  const document = job.artifacts.find(artifact => artifact.role === 'text')
    ?? job.artifacts.find(artifact => artifact.role === 'entry');
  const manifest = job.artifacts.find(artifact => artifact.role === 'manifest');
  const metadata = job.artifacts.find(artifact => artifact.role === 'metadata');
  const target = job.request.target.type === 'url'
    ? { ...job.request.target, url: short(job.request.target.url, 4096), url_truncated: job.request.target.url.length > 4096 }
    : job.request.target;
  const failed = Object.fromEntries(Object.entries(job.checkpoint?.failed_components ?? {}).slice(0, 7).map(([name, value]) => [name, short(value, 600)]));
  return {
    ...status,
    request: { target, save_as: job.request.save_as, include: job.request.include, preferences: job.request.preferences, output: job.request.output, browser: job.request.browser, limits: job.request.limits },
    snapshot: snapshot ? {
      schema_version: snapshot.schema_version, platform: snapshot.platform, adapter_version: snapshot.adapter_version,
      content_type: snapshot.content_type, title: short(snapshot.title, 240),
      canonical_url: short(snapshot.canonical_url, 4096), canonical_url_truncated: snapshot.canonical_url.length > 4096,
      authors: snapshot.authors.slice(0, 10).map(author => short(author, 200)), author_count: snapshot.authors.length,
      published_at: snapshot.published_at, language: snapshot.language,
      access_class: snapshot.access_class, completeness: snapshot.completeness,
      block_count: snapshot.blocks.length, source_asset_count: snapshot.assets.length,
      relation_count: snapshot.relations?.length ?? 0,
    } : undefined,
    artifacts: job.artifacts.slice(offset, end).map(artifactReference),
    artifact_page: { offset, limit, total: job.artifacts.length, next_offset: end < job.artifacts.length ? end : null },
    content_files: { document: document?.path, manifest: manifest?.path, metadata: metadata?.path },
    warnings: job.warnings.slice(0, 10).map(warning => short(warning)), warning_count: job.warnings.length,
    checkpoint: job.checkpoint ? {
      available: Boolean(job.checkpoint.workspace || job.checkpoint.completed_components?.length),
      completed_components: job.checkpoint.completed_components,
      failed_components: failed,
      requires_fresh_url: job.checkpoint.requires_fresh_url === true,
      cached_media_inputs: new Set(Object.values(job.checkpoint.media_files ?? {}).flat()).size,
    } : undefined,
    content_note: 'Full source content and asset relationships stay in the saved local files. Use artifact_offset and artifact_limit to page through file references.',
  };
}
