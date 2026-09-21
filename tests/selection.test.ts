import { describe, expect, it } from 'vitest';
import { createBaselineAdapterRegistry } from '../adapters/registry.js';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AdapterDefinition, AdapterRegistry, CollectRequest, ContentBlock, ContentSnapshot, SourceAsset } from '../shared/contracts.js';
import { requestedComponents, requiredResultSelection } from '../runtime/collection/selection.js';
import { createCollectionExecutor } from '../runtime/collection/collector.js';
import { JobManager } from '../runtime/jobs/manager.js';
import { JobStore } from '../runtime/storage/job-store.js';
import { BrowserBridge } from '../runtime/bridge/server.js';
import { newClient, type RuntimeConfig } from '../runtime/policy/config.js';
import { createRuntimeHttpServer, listenRuntime } from '../runtime/mcp/http.js';

const sourceUrl = 'https://example.com/item/1';
const selectionRuleId = 'selection-fixture-complete-v1';
const request: CollectRequest = { target: { type: 'url', url: sourceUrl }, output: { directory: '/tmp/selection-fixture' } };
const media = (role: SourceAsset['role']): SourceAsset => ({ id: role, role, url: `https://example.com/${role}`, order: 0, availability: 'available' });
const snapshot = (assets: SourceAsset[], text = false): ContentSnapshot => {
  const assetBlocks: ContentBlock[] = assets.flatMap(asset =>
    asset.role === 'image' || asset.role === 'video' || asset.role === 'audio' || asset.role === 'file' ? [{ type: asset.role, asset_id: asset.id }] : [],
  );
  const complete = assets.every(asset => asset.role === 'cover' || asset.availability === 'available');
  return {
    schema_version: '1', platform: 'example', adapter_version: '1', source_url: sourceUrl, canonical_url: sourceUrl,
    platform_content_id: '1', content_type: 'mixed', title: 'Mixed source', authors: ['Source author'], published_at: null,
    access_class: 'public_free', completeness: complete ? 'complete' : 'unknown', assets,
    blocks: [...(text ? [{ type: 'paragraph' as const, text: 'Source paragraph' }] : []), ...assetBlocks], warnings: [],
    ...(complete ? { completeness_proof: { version: 1 as const, scope: 'single_item' as const, method: 'adapter_bounded_dom' as const,
      rule_id: selectionRuleId, platform_content_id: '1', boundary: 'root_exhausted' as const, pending_marker_count: 0 as const,
      ordered_asset_count: assetBlocks.length, unplaced_asset_count: 0 as const } } : {}),
  };
};

describe('purpose selection', () => {
  it('requires the full paper for a publication document without requiring files for ordinary research blogs', () => {
    const url = 'https://deepmind.google/research/publications/265605/';
    const adapter = createBaselineAdapterRegistry().match(new URL(url))!;
    const source: ContentSnapshot = { ...snapshot([], true), platform: 'deepmind_blog', content_type: 'article', source_url: url, canonical_url: url };
    expect(requestedComponents({ ...request, save_as: 'document' }, source, adapter)).toEqual(['text', 'files']);
    expect(requestedComponents(request, source, adapter)).toEqual(['text', 'files']);
    expect(requestedComponents({ ...request, save_as: 'bundle' }, source, adapter)).toEqual(['text', 'files']);
    expect(requestedComponents({ ...request, save_as: 'audio' }, source, adapter)).toEqual(['audio']);
    expect(requestedComponents({ ...request, include: ['images'] }, source, adapter)).toEqual(['images']);
    const blogUrl = 'https://deepmind.google/blog/alpha/';
    expect(requestedComponents({ ...request, save_as: 'document' }, { ...source, source_url: blogUrl, canonical_url: blogUrl }, adapter)).toEqual(['text']);
    expect(adapter.document_components_for_url?.(new URL('https://example.com/research/publications/265605/'))).toEqual([]);
  });

  it('automatically keeps the only media purpose and its same-item text or files', () => {
    expect(requestedComponents(request, snapshot([media('video')]))).toEqual(['video']);
    expect(requestedComponents(request, snapshot([media('audio')]))).toEqual(['audio']);
    expect(requestedComponents(request, snapshot([media('video'), media('file')], true))).toEqual(['text', 'video', 'files']);
    expect(requestedComponents(request, snapshot([media('file')]))).toEqual(['files']);
    expect(requiredResultSelection(request, snapshot([media('video')]))).toBeUndefined();
    expect(requestedComponents(request, { ...snapshot([media('video')]), content_type: 'video' })).toEqual(['video']);
  });

  it('asks only about ambiguous independent purposes and preserves explicit choices and preferences', () => {
    const source = snapshot([media('video'), media('audio')], true);
    expect(requestedComponents(request, source)).toEqual([]);
    expect(requiredResultSelection(request, source)?.options.map(option => option.save_as)).toEqual(['video', 'audio', 'document', 'bundle']);
    expect(requestedComponents({ ...request, include: ['text', 'audio'] }, source)).toEqual(['text', 'audio']);
    expect(requiredResultSelection({ ...request, include: ['text', 'audio'] }, source)).toBeUndefined();
    expect(requestedComponents({ ...request, preferences: { audio_format: 'mp3' } }, source)).toEqual(['audio']);
    expect(requiredResultSelection({ ...request, preferences: { audio_format: 'mp3' } }, source)).toBeUndefined();
    expect(requestedComponents({ ...request, save_as: 'bundle' }, source)).toEqual(['text', 'video', 'audio']);
    expect(requestedComponents({ ...request, save_as: 'bundle' }, snapshot([media('video')]))).toEqual(['video']);
    expect(requiredResultSelection(request, snapshot([media('video'), { ...media('audio'), availability: 'not_present' }]))).toBeUndefined();
  });

  it('returns executable choices before downloading and resumes the same job through authenticated MCP', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'babel-selection-'));
    const client = newClient('test', [directory]);
    const config: RuntimeConfig = { schema_version: 1, port: 0, state_dir: directory, allowed_extension_ids: [], clients: [client], fixture_origins: [] };
    const definition: AdapterDefinition = { id: 'example', version: '1', hosts: ['example.com'], content_types: ['mixed'], status: 'experimental', match: (url: URL) => url.hostname === 'example.com' && url.pathname === '/item/1',
      completion_rules: [{ id: selectionRuleId, content_types: ['mixed'], boundary: 'root_exhausted', matches: (url, contentId) => url.pathname === `/item/${contentId}` }],
    };
    const registry: AdapterRegistry = { match: url => definition.match(url) ? definition : undefined, list: () => [definition] };
    let captures = 0;
    const executor = createCollectionExecutor({ bridge: { capture: async () => { captures++; return snapshot([media('video'), media('audio')], true); } }, registry, config });
    const store = new JobStore(join(directory, 'jobs'));
    const jobs = new JobManager(store, executor, [client]); await jobs.init();
    const bridge = new BrowserBridge(config, registry);
    const server = createRuntimeHttpServer(config, bridge, { jobs, bridge, registry });
    await listenRuntime(server, 0);
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test listener');
    config.port = address.port;
    const call = async (name: string, args: Record<string, unknown>) => {
      const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${client.token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
      expect(response.ok).toBe(true);
      const body = await response.text();
      return (response.headers.get('content-type')?.includes('text/event-stream') ? JSON.parse(body.split(/\r?\n/).find(line => line.startsWith('data: '))!.slice(6)) : JSON.parse(body)).result;
    };
    try {
      const parameters = { ...request, output: { directory }, idempotency_key: 'mixed-once' };
      const submitted = await call('babel_content_collect', parameters); const id = submitted.structuredContent.job_id;
      await expect.poll(async () => (await store.get(id))?.status).toBe('blocked');
      const blocked = (await call('babel_content_job_get', { job_id: id })).structuredContent;
      expect(blocked.selection_required.options.map((option: { save_as: string }) => option.save_as)).toEqual(['video', 'audio', 'document', 'bundle']);
      expect(blocked.artifact_count).toBe(0); expect(blocked.artifact_root).toBeUndefined();
      expect((await readdir(directory)).sort()).toEqual(['.babel-content', 'jobs']);
      expect((await call('babel_content_job_resume', { job_id: id })).structuredContent.code).toBe('SELECTION_REQUIRED');
      expect((await call('babel_content_job_resume', { job_id: id, save_as: 'subtitles' })).structuredContent.code).toBe('INVALID_SAVE_SELECTION');
      expect((await call('babel_content_job_resume', { job_id: id, save_as: 'document' })).isError).not.toBe(true);
      await expect.poll(async () => (await store.get(id))?.status).toBe('succeeded');
      const finished = await store.get(id);
      expect(finished?.request.save_as).toBe('document'); expect(finished?.selection_required).toBeUndefined();
      expect(await readFile(finished!.artifacts.find(artifact => artifact.role === 'text')!.path, 'utf8')).toContain('Source paragraph');
      expect(captures).toBe(2);
      expect((await call('babel_content_collect', parameters)).structuredContent.job_id).toBe(id);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
  });

  it('does not mistake an empty selection for an offline checkpoint after restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'babel-selection-restart-'));
    const client = newClient('test', [directory]);
    const store = new JobStore(join(directory, 'jobs')); await store.init();
    const now = new Date().toISOString(); const source = snapshot([media('video'), media('audio')]);
    const id = 'job_11111111-1111-4111-8111-111111111111';
    await store.put({ id, client_id: client.id, request: { ...request, target: { type: 'url', url: `${sourceUrl}?token=private-source-token` }, output: { directory } }, status: 'blocked', stage: 'resolving', created_at: now, updated_at: now, attempts: 1, artifacts: [], warnings: [], snapshot: source, selection_required: requiredResultSelection(request, source), completeness: { requested_components_complete: false, scope: 'single_item' } });
    let runs = 0;
    const manager = new JobManager(store, { execute: async () => { runs++; return { status: 'succeeded', completeness: { requested_components_complete: true, scope: 'single_item' } }; } }, [client]);
    try {
      await manager.init();
      expect((await store.get(id))?.error?.code).toBe('FRESH_URL_REQUIRED');
      await expect(manager.resume(client.id, id, undefined, 'video')).rejects.toMatchObject({ code: 'FRESH_URL_REQUIRED' });
      expect(runs).toBe(0);
      expect((await store.get(id))?.selection_required?.options).toHaveLength(3);
      await manager.resume(client.id, id, `${sourceUrl}?token=refreshed-source-token`, 'video');
      await expect.poll(async () => (await store.get(id))?.status).toBe('succeeded');
      expect(runs).toBe(1);
      expect(JSON.stringify(await store.get(id))).not.toContain('source-token');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
