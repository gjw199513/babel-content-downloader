import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { JobRecord } from '../shared/contracts.js';
import { summarizeJob } from '../runtime/mcp/presentation.js';
import { createRuntimeHttpServer, listenRuntime } from '../runtime/mcp/http.js';
import { JobStore } from '../runtime/storage/job-store.js';
import { JobManager } from '../runtime/jobs/manager.js';
import { BrowserBridge } from '../runtime/bridge/server.js';
import { newClient, type RuntimeConfig } from '../runtime/policy/config.js';
import { createAdapterRegistry } from '../adapters/registry.js';

const FIXTURE_JOB_ID = 'job_11111111-1111-4111-8111-111111111111';

function largeJob(directory: string): JobRecord {
  const source = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  return {
    id: FIXTURE_JOB_ID, client_id: 'test', request: { target: { type: 'url', url: source }, save_as: 'bundle', output: { directory } },
    status: 'partial', stage: 'verifying', created_at: '2026-09-18T00:00:00.000Z', updated_at: '2026-09-18T00:00:01.000Z', attempts: 1,
    completeness: { requested_components_complete: false, scope: 'single_item' }, warnings: Array.from({ length: 30 }, () => '资源诊断。'.repeat(500)),
    snapshot: { schema_version: '1', platform: 'youtube', adapter_version: '1', source_url: source, canonical_url: source, content_type: 'article', title: 'Large source fixture', authors: ['Fixture author'], published_at: null,
      blocks: [{ type: 'paragraph', text: 'FULL_SOURCE_CONTENT_SENTINEL '.repeat(50_000) }], assets: [], access_class: 'public_free', completeness: 'unknown', warnings: [] },
    artifact_root: directory,
    artifacts: [
      ...Array.from({ length: 200 }, (_, index) => ({ role: 'image', path: join(directory, `image-${index}.png`), media_type: 'image/png', size: 1000, sha256: 'a'.repeat(64) })),
      { role: 'text', path: join(directory, 'content.md'), media_type: 'text/markdown', size: 1_400_000, sha256: 'b'.repeat(64) },
      { role: 'manifest', path: join(directory, 'assets.json'), media_type: 'application/json', size: 10_000, sha256: 'c'.repeat(64) },
      { role: 'metadata', path: join(directory, 'metadata.json'), media_type: 'application/json', size: 1000, sha256: 'd'.repeat(64) },
    ],
    checkpoint: { workspace: join(directory, 'temp'), completed_components: ['text'], failed_components: { images: 'Waiting for remaining images' }, requires_fresh_url: true },
  };
}

describe('bounded MCP job presentation', () => {
  it('returns file references and diagnostics without copying a long source into model context', () => {
    const job = largeJob('/tmp/babel-presentation');
    const fullSource = job.snapshot!.blocks[0];
    const result = summarizeJob(job);
    expect(JSON.stringify(result)).not.toContain('FULL_SOURCE_CONTENT_SENTINEL');
    expect(JSON.stringify(result).length).toBeLessThan(15_000);
    expect(result.artifacts).toHaveLength(10);
    expect(result.artifact_page).toEqual({ offset: 0, limit: 10, total: 203, next_offset: 10 });
    expect(result.content_files).toEqual({ document: '/tmp/babel-presentation/content.md', manifest: '/tmp/babel-presentation/assets.json', metadata: '/tmp/babel-presentation/metadata.json' });
    expect(result.checkpoint).toMatchObject({ requires_fresh_url: true, completed_components: ['text'] });
    expect(job.snapshot!.blocks[0]).toBe(fullSource);
    expect(JSON.stringify(job.snapshot)).toContain('FULL_SOURCE_CONTENT_SENTINEL');
  });

  it('makes every artifact reachable in pages while keeping list entries compact', () => {
    const job = largeJob('/tmp/babel-presentation');
    const result = summarizeJob(job, { artifactOffset: 200, artifactLimit: 50 });
    expect(result.artifacts).toHaveLength(3);
    expect(result.artifact_page).toEqual({ offset: 200, limit: 50, total: 203, next_offset: null });
    const compact = summarizeJob(job, { compact: true });
    expect(compact.artifact_count).toBe(203);
    expect(compact).not.toHaveProperty('snapshot');
    expect(compact).not.toHaveProperty('artifacts');
    expect(JSON.stringify(compact).length).toBeLessThan(1500);
  });

  it('exposes a bundle navigation entry as the document without presenting it as source text', () => {
    const job = largeJob('/tmp/babel-presentation');
    job.artifacts = job.artifacts.filter(artifact => artifact.role !== 'text');
    job.artifacts.push({ role: 'entry', path: '/tmp/babel-presentation/content.md', media_type: 'text/markdown', size: 200, sha256: 'e'.repeat(64) });
    job.checkpoint = { completed_components: ['video'] };

    const result = summarizeJob(job, { artifactOffset: 200, artifactLimit: 10 });
    expect(result).toMatchObject({
      content_files: { document: '/tmp/babel-presentation/content.md' },
      checkpoint: { completed_components: ['video'] },
    });
    expect(result.artifacts).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'entry' })]));
    expect(result.artifacts).not.toEqual(expect.arrayContaining([expect.objectContaining({ role: 'text' })]));
  });

  it('applies those limits on the actual authenticated MCP HTTP tools', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'babel-mcp-presentation-'));
    const client = newClient('test', [directory]);
    const config: RuntimeConfig = { schema_version: 1, port: 0, state_dir: directory, allowed_extension_ids: [], clients: [client], fixture_origins: [] };
    const registry = createAdapterRegistry(); const bridge = new BrowserBridge(config, registry);
    const store = new JobStore(join(directory, 'jobs'));
    const jobs = new JobManager(store, { execute: async () => { throw new Error('Collection is outside this response-size test'); } }, [client]);
    await jobs.init(); await store.put(largeJob(directory));
    const server = createRuntimeHttpServer(config, bridge, { jobs, bridge, registry });
    await listenRuntime(server, 0);
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test listener');
    config.port = address.port;
    const call = async (name: string, args: Record<string, unknown>) => {
      const response = await fetch(`http://127.0.0.1:${config.port}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${client.token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
      expect(response.ok).toBe(true);
      const text = await response.text();
      expect(text).not.toContain('FULL_SOURCE_CONTENT_SENTINEL');
      expect(text.length).toBeLessThan(20_000);
      const parsed = response.headers.get('content-type')?.includes('text/event-stream') ? JSON.parse(text.split(/\r?\n/).find(line => line.startsWith('data: '))!.slice(6)) : JSON.parse(text);
      return parsed.result;
    };
    try {
      const detail = (await call('babel_content_job_get', { job_id: FIXTURE_JOB_ID, artifact_offset: 200, artifact_limit: 3 })).structuredContent;
      expect(detail.artifacts).toHaveLength(3); expect(detail.artifact_count).toBe(203);
      const listing = (await call('babel_content_jobs_list', {})).structuredContent;
      expect(listing.jobs).toHaveLength(1); expect(listing.jobs[0]).not.toHaveProperty('snapshot');
      const unsupported = await call('babel_content_collect', { target: { type: 'url', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }, save_as: 'audio', output: { directory }, preferences: { audio_format: 'unsupported-format' } });
      expect(unsupported.isError).toBe(true);
      const unknown = await call('babel_content_collect', { target: { type: 'url', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }, save_as: 'audio', output: { directory }, preferences: { hidden_command: 'do not silently accept' } });
      expect(unknown.isError).toBe(true);
      const selected = await call('babel_content_collect', { target: { type: 'url', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }, save_as: 'audio', output: { directory }, preferences: { audio_format: 'mp3', clip: { start_seconds: 10, end_seconds: 20 } } });
      expect(selected.isError).not.toBe(true);
      const saved = await store.get(selected.structuredContent.job_id);
      expect(saved?.request.preferences).toEqual({ audio_format: 'mp3', clip: { start_seconds: 10, end_seconds: 20 } });
      await expect.poll(async () => (await store.get(selected.structuredContent.job_id))?.status).toBe('failed');
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
  });
});
