import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { AdapterDefinition, AdapterRegistry, ContentBlock, ContentSnapshot, JobRecord, SourceAsset } from '../shared/contracts.js';
import { createCollectionExecutor } from '../runtime/collection/collector.js';
import { runProcess } from '../runtime/engines/process.js';

let directory: string;
let origin: string;
let video: Buffer;
let server: http.Server;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'babel-bundle-entry-'));
  const media = join(directory, 'fixture.mp4');
  await runProcess('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=12:d=1.2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', media]);
  video = await readFile(media);
  server = http.createServer((request, response) => {
    if (request.url === '/media.mp4') { response.setHeader('content-type', 'video/mp4'); response.end(video); return; }
    if (request.url === '/file-a.txt') { response.setHeader('content-type', 'text/plain'); response.end('first verified attachment\n'); return; }
    if (request.url === '/file-b.txt') { response.setHeader('content-type', 'text/plain'); response.end('second verified attachment\n'); return; }
    response.writeHead(404); response.end();
  });
  await new Promise<void>((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture listener unavailable');
  origin = `http://127.0.0.1:${address.port}`;
}, 30_000);

afterAll(async () => {
  if (server) await new Promise<void>(resolveClose => server.close(() => resolveClose()));
  if (directory) await rm(directory, { recursive: true, force: true });
});

const ruleId = 'development-fixture-bundle-v1';

function snapshot(contentType: ContentSnapshot['content_type'], blocks: ContentBlock[], assets: SourceAsset[], title = 'Bundle fixture'): ContentSnapshot {
  const ordered = new Set(blocks.flatMap(block => 'asset_id' in block ? [block.asset_id] : []));
  return {
    schema_version: '1', platform: 'development_fixture', adapter_version: '1',
    source_url: `${origin}/item`, canonical_url: `${origin}/item`, platform_content_id: 'item',
    content_type: contentType, title, authors: [], published_at: null, blocks, assets,
    access_class: 'public_free', completeness: 'complete', warnings: [],
    completeness_proof: {
      version: 1, scope: 'single_item', method: 'adapter_bounded_dom', rule_id: ruleId,
      platform_content_id: 'item', boundary: 'root_exhausted', pending_marker_count: 0,
      ordered_asset_count: ordered.size, unplaced_asset_count: 0,
    },
  };
}

function job(output: string, saveAs: NonNullable<JobRecord['request']['save_as']> = 'bundle'): JobRecord {
  return {
    id: `job_${randomUUID()}`, client_id: 'test',
    request: { target: { type: 'url', url: `${origin}/item` }, save_as: saveAs, output: { directory: output } },
    status: 'queued', stage: 'queued', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    artifacts: [], completeness: { requested_components_complete: false, scope: 'single_item' }, warnings: [], attempts: 1,
  };
}

function executor(output: string, source: ContentSnapshot) {
  const adapter: AdapterDefinition = {
    id: 'development_fixture', version: '1', hosts: ['127.0.0.1'], asset_hosts: [], engine: 'direct',
    content_types: ['article', 'video', 'audio'], status: 'experimental',
    match: url => url.origin === origin && url.pathname === '/item',
    completion_rules: [{ id: ruleId, content_types: ['article', 'video', 'audio'], boundary: 'root_exhausted', matches: (url, contentId) => url.origin === origin && url.pathname === '/item' && contentId === 'item' }],
  };
  const registry: AdapterRegistry = { list: () => [adapter], match: url => adapter.match(url) ? adapter : undefined };
  return createCollectionExecutor({
    bridge: { capture: async () => source }, registry,
    config: { schema_version: 1, port: 4318, state_dir: join(directory, 'state'), fixture_origins: [origin], allowed_extension_ids: [], clients: [{ id: 'test', token: 'fixture', output_roots: [output] }] },
  });
}

async function localLinks(documentPath: string): Promise<string[]> {
  const content = await readFile(documentPath, 'utf8');
  const links = [...content.matchAll(/!?\[[^\]]+\]\(([^)]+)\)/g)].map(match => match[1]!);
  for (const link of links) await expect(stat(resolve(join(documentPath, '..'), decodeURIComponent(link)))).resolves.toMatchObject({ size: expect.any(Number) });
  return links;
}

describe('bundle navigation entry', () => {
  it.each([
    ['video', 'video', 'video'] as const,
    ['audio', 'audio', 'audio'] as const,
  ])('creates an independent entry for a %s-only bundle without completing source text', async (_name, contentType, role) => {
    const output = join(directory, `${role}-bundle-${randomUUID()}`); await mkdir(output);
    const source = snapshot(contentType, [{ type: role, asset_id: 'media-1' }], [{ id: 'media-1', role, url: `${origin}/media.mp4`, order: 0, media_type: 'video/mp4', duration_seconds: 1.2, availability: 'available' }]);
    const task = job(output);
    const result = await executor(output, source).execute(task, new AbortController().signal, async patch => { Object.assign(task, patch); });

    expect(result.status).toBe('succeeded');
    expect(result.checkpoint?.completed_components).toEqual([role]);
    expect(result.artifacts?.some(artifact => artifact.role === 'text')).toBe(false);
    const entry = result.artifacts?.find(artifact => artifact.role === 'entry');
    expect(entry).toBeDefined();
    const content = await readFile(entry!.path, 'utf8');
    expect(content).toContain('本页是已验证资料的本地导航，不代表来源正文。');
    expect(content).toContain(`来源：<${origin}/item>`);
    expect(content).not.toContain('SOURCE_BODY_SENTINEL');
    expect(await localLinks(entry!.path)).toHaveLength(1);
    expect(result.artifacts?.find(artifact => artifact.role === role)?.path).toBeTruthy();
  }, 30_000);

  it('creates a files-only entry whose links resolve, while a text bundle keeps the source document role', async () => {
    const filesOutput = join(directory, `files-bundle-${randomUUID()}`); await mkdir(filesOutput);
    const file = { id: 'file-a', role: 'file' as const, url: `${origin}/file-a.txt`, order: 0, media_type: 'text/plain', availability: 'available' as const };
    const filesSource = snapshot('article', [{ type: 'file', asset_id: file.id, caption: '课程附件' }], [file]);
    const filesTask = job(filesOutput);
    const filesResult = await executor(filesOutput, filesSource).execute(filesTask, new AbortController().signal, async patch => { Object.assign(filesTask, patch); });
    expect(filesResult.status).toBe('succeeded');
    expect(filesResult.checkpoint?.completed_components).toEqual(['files']);
    expect(filesResult.artifacts?.some(artifact => artifact.role === 'text')).toBe(false);
    const entry = filesResult.artifacts?.find(artifact => artifact.role === 'entry')!;
    expect(await localLinks(entry.path)).toHaveLength(1);

    const textOutput = join(directory, `text-bundle-${randomUUID()}`); await mkdir(textOutput);
    const textSource = snapshot('article', [{ type: 'paragraph', text: 'SOURCE BODY SENTINEL' }, { type: 'file', asset_id: file.id, caption: '课程附件' }], [file]);
    const textTask = job(textOutput);
    const textResult = await executor(textOutput, textSource).execute(textTask, new AbortController().signal, async patch => { Object.assign(textTask, patch); });
    expect(textResult.status).toBe('succeeded');
    expect(textResult.artifacts?.some(artifact => artifact.role === 'entry')).toBe(false);
    const document = textResult.artifacts?.find(artifact => artifact.role === 'text')!;
    expect(await readFile(document.path, 'utf8')).toContain('SOURCE BODY SENTINEL');
    expect(await localLinks(document.path)).toHaveLength(1);
  });

  it('does not let an entry turn a bundle with zero verified deliverables into partial or success', async () => {
    const output = join(directory, `empty-bundle-${randomUUID()}`); await mkdir(output);
    const unavailable = { id: 'file-a', role: 'file' as const, url: `${origin}/file-a.txt`, order: 0, media_type: 'text/plain', availability: 'blocked' as const };
    const source = snapshot('article', [{ type: 'file', asset_id: unavailable.id }], [unavailable]);
    source.completeness = 'unknown'; delete source.completeness_proof;
    const task = job(output);
    const result = await executor(output, source).execute(task, new AbortController().signal, async patch => { Object.assign(task, patch); });
    expect(result.status).toBe('blocked');
    expect(result.completeness?.requested_components_complete).toBe(false);
    expect(result.artifacts?.some(artifact => ['entry', 'text', 'file'].includes(artifact.role))).toBe(false);
    expect(result.checkpoint?.completed_components).toEqual([]);
  });

  it('rewrites an existing entry from current verified artifacts and replaces it with source text when text later appears', async () => {
    const output = join(directory, `resume-bundle-${randomUUID()}`); await mkdir(output);
    const firstAsset = { id: 'file-a', role: 'file' as const, url: `${origin}/file-a.txt`, order: 0, media_type: 'text/plain', availability: 'available' as const };
    const secondBlocked = { id: 'file-b', role: 'file' as const, url: `${origin}/file-b.txt`, order: 1, media_type: 'text/plain', availability: 'blocked' as const };
    const firstSource = snapshot('article', [{ type: 'file', asset_id: firstAsset.id }, { type: 'file', asset_id: secondBlocked.id }], [firstAsset, secondBlocked]);
    firstSource.completeness = 'unknown'; delete firstSource.completeness_proof;
    const task = job(output);
    const first = await executor(output, firstSource).execute(task, new AbortController().signal, async patch => { Object.assign(task, patch); });
    expect(first.status).toBe('partial'); Object.assign(task, first);
    const firstEntry = first.artifacts?.find(artifact => artifact.role === 'entry')!;
    expect(await localLinks(firstEntry.path)).toHaveLength(1);

    const refreshed = snapshot('article', [{ type: 'paragraph', text: 'SOURCE BODY AFTER RESUME' }, { type: 'file', asset_id: firstAsset.id }, { type: 'file', asset_id: secondBlocked.id }], [firstAsset, { ...secondBlocked, availability: 'available' }]);
    const second = await executor(output, refreshed).execute(task, new AbortController().signal, async patch => { Object.assign(task, patch); });
    expect(second.status).toBe('succeeded');
    expect(second.artifacts?.some(artifact => artifact.role === 'entry')).toBe(false);
    const document = second.artifacts?.find(artifact => artifact.role === 'text')!;
    expect(second.artifacts?.filter(artifact => artifact.path === document.path)).toHaveLength(1);
    expect(await readFile(document.path, 'utf8')).toContain('SOURCE BODY AFTER RESUME');
    expect(await localLinks(document.path)).toHaveLength(2);
  });

  it('rewrites the same entry from the current verified attachments when a partial bundle resumes without source text', async () => {
    const output = join(directory, `resume-entry-${randomUUID()}`); await mkdir(output);
    const firstAsset = { id: 'file-a', role: 'file' as const, url: `${origin}/file-a.txt`, order: 0, media_type: 'text/plain', availability: 'available' as const };
    const secondBlocked = { id: 'file-b', role: 'file' as const, url: `${origin}/file-b.txt`, order: 1, media_type: 'text/plain', availability: 'blocked' as const };
    const blocks: ContentBlock[] = [{ type: 'file', asset_id: firstAsset.id }, { type: 'file', asset_id: secondBlocked.id }];
    const firstSource = snapshot('article', blocks, [firstAsset, secondBlocked]);
    firstSource.completeness = 'unknown'; delete firstSource.completeness_proof;
    const task = job(output);
    const first = await executor(output, firstSource).execute(task, new AbortController().signal, async patch => { Object.assign(task, patch); });
    expect(first.status).toBe('partial'); Object.assign(task, first);
    const firstEntry = first.artifacts?.find(artifact => artifact.role === 'entry')!;
    expect(await localLinks(firstEntry.path)).toHaveLength(1);

    const refreshed = snapshot('article', blocks, [firstAsset, { ...secondBlocked, availability: 'available' }]);
    const second = await executor(output, refreshed).execute(task, new AbortController().signal, async patch => { Object.assign(task, patch); });
    expect(second.status).toBe('succeeded');
    expect(second.checkpoint?.completed_components).toEqual(['files']);
    expect(second.artifacts?.some(artifact => artifact.role === 'text')).toBe(false);
    const entries = second.artifacts?.filter(artifact => artifact.role === 'entry') ?? [];
    expect(entries).toHaveLength(1);
    expect(entries[0]!.path).toBe(firstEntry.path);
    expect(entries[0]!.sha256).not.toBe(firstEntry.sha256);
    expect(second.artifacts?.filter(artifact => artifact.path === firstEntry.path)).toHaveLength(1);
    expect(await localLinks(entries[0]!.path)).toHaveLength(2);
  });
});

describe('successful audio temporary cleanup', () => {
  it('removes every registered input, cache and processed result immediately while preserving an unknown user file', async () => {
    const output = join(directory, `audio-cleanup-${randomUUID()}`); await mkdir(output);
    const source = snapshot('video', [{ type: 'video', asset_id: 'video-1' }], [{ id: 'video-1', role: 'video', url: `${origin}/media.mp4`, order: 0, media_type: 'video/mp4', duration_seconds: 1.2, availability: 'available' }]);
    const task = job(output, 'audio');
    const workspace = join(await realpath(output), '.babel-content', task.id);
    await mkdir(workspace, { recursive: true });
    const userFile = join(workspace, 'user-note.txt'); await writeFile(userFile, 'keep this user file');
    const registered = new Set<string>();
    const result = await executor(output, source).execute(task, new AbortController().signal, async patch => {
      for (const artifact of patch.checkpoint?.temporary_artifacts ?? []) registered.add(artifact.path);
      Object.assign(task, patch);
    });

    expect(result.status).toBe('succeeded');
    expect(result.artifacts?.some(artifact => artifact.role === 'audio')).toBe(true);
    expect(result.artifacts?.some(artifact => artifact.role === 'video')).toBe(false);
    expect([...registered].some(path => /input-[^/]+\.bin$/.test(path))).toBe(true);
    expect([...registered].some(path => path.endsWith('/inputs.json'))).toBe(true);
    expect([...registered].some(path => /result-[^/]+\.m4a$/.test(path))).toBe(true);
    for (const path of registered) await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(userFile, 'utf8')).toBe('keep this user file');
    expect(result.checkpoint?.workspace).toBeUndefined();
    expect(result.checkpoint?.temporary_artifacts).toEqual([]);
    expect(result.checkpoint?.media_files).toEqual({});
    expect(result.warnings?.join(' ')).toContain('未登记或已修改');
  }, 30_000);
});
