import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import type { AdapterDefinition, AdapterRegistry, Artifact, ContentSnapshot, JobRecord } from '../shared/contracts.js';
import { createCollectionExecutor } from '../runtime/collection/collector.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

const fixtureUrl = 'https://fixture.example/article?xsec_token=source-secret';
const ruleId = 'metadata-delivery-fixture-v1';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWNQTa37DwADwwIIrav01wAAAABJRU5ErkJggg==', 'base64');

function hash(bytes: Buffer): Pick<Artifact, 'size' | 'sha256'> {
  return { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

describe('metadata deliverable evidence', () => {
  it('records only relative, verified artifact facts and available media validation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'babel-metadata-delivery-')); roots.push(directory);
    const output = join(directory, 'operator-secret-output');
    const artifactRoot = join(output, 'Existing result');
    const assets = join(artifactRoot, 'assets');
    await mkdir(assets, { recursive: true });

    const imagePath = join(assets, 'image-001.png');
    const audioPath = join(assets, 'audio-001.m4a');
    const audio = Buffer.from('previously verified media bytes');
    await writeFile(imagePath, png);
    await writeFile(audioPath, audio);

    const snapshot: ContentSnapshot = {
      schema_version: '1', platform: 'development_fixture', adapter_version: '1',
      source_url: fixtureUrl, canonical_url: fixtureUrl, platform_content_id: 'article',
      content_type: 'mixed', title: 'Metadata evidence', authors: ['Fixture author'], published_at: null,
      blocks: [{ type: 'image', asset_id: 'image-1' }, { type: 'audio', asset_id: 'audio-1' }],
      assets: [
        { id: 'image-1', role: 'image', url: 'https://cdn.fixture.example/image.png?signature=asset-secret', order: 0, availability: 'available' },
        { id: 'audio-1', role: 'audio', url: 'https://cdn.fixture.example/audio.m4a?signature=asset-secret', order: 1, duration_seconds: 12.5, availability: 'available' },
      ],
      access_class: 'public_free', completeness: 'complete', warnings: [],
      completeness_proof: {
        version: 1, scope: 'single_item', method: 'adapter_bounded_dom', rule_id: ruleId,
        platform_content_id: 'article', boundary: 'root_exhausted', pending_marker_count: 0,
        ordered_asset_count: 2, unplaced_asset_count: 0,
      },
    };
    const adapter: AdapterDefinition = {
      id: 'development_fixture', version: '1', hosts: ['fixture.example'], asset_hosts: ['cdn.fixture.example'], engine: 'direct',
      content_types: ['mixed'], status: 'experimental', match: url => url.hostname === 'fixture.example' && url.pathname === '/article',
      completion_rules: [{ id: ruleId, content_types: ['mixed'], boundary: 'root_exhausted', matches: (url, id) => url.hostname === 'fixture.example' && url.pathname === '/article' && id === 'article' }],
    };
    const registry: AdapterRegistry = { list: () => [adapter], match: url => adapter.match(url) ? adapter : undefined };
    const imageArtifact: Artifact = { role: 'image', path: imagePath, media_type: 'image/png', ...hash(png), source_asset_id: 'image-1', width: 1, height: 1 };
    const audioArtifact: Artifact = {
      role: 'audio', path: audioPath, media_type: 'audio/mp4', ...hash(audio), source_asset_id: 'audio-1', duration_seconds: 12.5, language: 'en-US',
      media_processing: { output_container: 'm4a', input_count: 1, audio: 'copy', extracted_audio: true, merged_tracks: false },
      media_validation: { full_decode: true, expected_duration_seconds: 12.5, source_duration_verified: true, bounded_engine_item: true },
    };
    const now = new Date().toISOString();
    const job: JobRecord = {
      id: `job_${randomUUID()}`, client_id: 'test', request: { target: { type: 'url', url: fixtureUrl }, save_as: 'bundle', output: { directory: output } },
      status: 'partial', stage: 'verifying', created_at: now, updated_at: now, snapshot, artifact_root: artifactRoot,
      artifacts: [imageArtifact, audioArtifact], checkpoint: { completed_components: ['images', 'audio'] },
      completeness: { requested_components_complete: false, scope: 'single_item' }, warnings: [], attempts: 1,
    };
    const executor = createCollectionExecutor({
      bridge: { capture: async () => { throw new Error('verified local artifacts must not recapture'); } }, registry,
      config: { schema_version: 1, port: 4318, state_dir: join(directory, 'state'), fixture_origins: [], allowed_extension_ids: [], clients: [{ id: 'test', token: 'client-secret', output_roots: [output] }] },
    });

    const result = await executor.execute(job, new AbortController().signal, async patch => { Object.assign(job, patch); });
    expect(result.status).toBe('succeeded');
    const metadataPath = result.artifacts?.find(artifact => artifact.role === 'metadata')?.path;
    expect(metadataPath).toBeTruthy();
    const raw = await readFile(metadataPath!, 'utf8');
    const metadata = JSON.parse(raw) as { deliverables: Array<Record<string, unknown>> };

    expect(metadata.deliverables).toHaveLength(3);
    expect(metadata.deliverables).toContainEqual({ role: 'image', path: 'assets/image-001.png', media_type: 'image/png', ...hash(png), width: 1, height: 1 });
    expect(metadata.deliverables).toContainEqual({
      role: 'audio', path: 'assets/audio-001.m4a', media_type: 'audio/mp4', ...hash(audio), duration_seconds: 12.5, language: 'en-US',
      media_processing: { output_container: 'm4a', input_count: 1, audio: 'copy', extracted_audio: true, merged_tracks: false },
      media_validation: { full_decode: true, expected_duration_seconds: 12.5, source_duration_verified: true, bounded_engine_item: true },
    });
    expect(metadata.deliverables).toContainEqual(expect.objectContaining({ role: 'entry', path: 'content.md', size: expect.any(Number), sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    expect(metadata.deliverables.every(item => typeof item.path === 'string' && !isAbsolute(item.path) && !item.path.startsWith('..'))).toBe(true);
    expect(raw).not.toContain(directory);
    expect(raw).not.toContain('source-secret');
    expect(raw).not.toContain('asset-secret');
    expect(raw).not.toContain('client-secret');
    expect(raw).not.toContain('source_asset_id');
    expect(raw).not.toContain('source_fingerprint');
  });
});
