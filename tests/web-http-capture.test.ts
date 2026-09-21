import { gzipSync } from 'node:zlib';
import { sanitizeSnapshot } from '../runtime/storage/job-store.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fetchHtml, resolveRemote } from '../runtime/engines/network.js';
import { captureWebPage, shouldCaptureWebDocument, shouldCaptureWebPage, webPageAdapter, webPageIdentity } from '../runtime/web/http-capture.js';
import { createCollectionExecutor } from '../runtime/collection/collector.js';
import { evaluateContentCompleteness } from '../shared/completeness.js';
import type { CollectRequest, JobRecord } from '../shared/contracts.js';

let server: http.Server; let origin: string; let dir: string;
const html = '<!doctype html><html><head><title>Technical article</title></head><body><main><h1>Technical article</h1><p>' + 'Readable technical article about model evaluation and useful public research. '.repeat(15) + '</p><pre><code>  const value = 42;\n  print(value);</code></pre><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table></main></body></html>';
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'babel-web-http-'));
  server = http.createServer((req, res) => {
    if (req.url === '/forbidden') { res.writeHead(403); res.end('Forbidden'); }
    else if (req.url === '/media') { res.setHeader('content-type', 'text/html'); res.end(html.replace('</main>', '<video src="https://example.org/media.mp4" controls></video></main>')); }
    else if (req.url === '/gzip') { res.setHeader('content-type', 'text/html'); res.setHeader('content-encoding', 'gzip'); res.end(gzipSync(html)); }
    else if (req.url === '/gbk') { res.setHeader('content-type', 'text/html'); res.end(Buffer.concat([Buffer.from('<meta charset=gbk><p>'), Buffer.from([0xd6, 0xd0, 0xce, 0xc4]), Buffer.from('</p>')])); }
    else if (req.url === '/json') { res.setHeader('content-type', 'application/json'); res.end('{}'); }
    else if (req.url === '/redirect') { res.writeHead(302, { location: 'http://127.0.0.1:1/internal' }); res.end(); }
    else { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(html); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address(); if (!addr || typeof addr === 'string') throw new Error('No listener');
  origin = `http://127.0.0.1:${addr.port}`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await rm(dir, { recursive: true, force: true }); });
const request = (url: string): CollectRequest => ({ target: { type: 'url', url }, save_as: 'document', output: { directory: dir } });

describe('unified current-page HTTP capture', () => {
  it('routes blogs through one pipeline while retaining specialized and excluded sources', () => {
    for (const url of ['https://huggingface.co/blog/llama2', 'https://www.anthropic.com/engineering/context', 'https://openai.com/index/gpt-4-research/', 'https://example.org/articles/one']) expect(shouldCaptureWebPage(request(url)), url).toBe(true);
    for (const url of ['https://youtube.com/watch?v=a', 'https://huggingface.co/org/model', 'https://arxiv.org/abs/1706.03762', 'https://sohu.com/a/123', 'https://kuaishou.com/short-video/123', 'https://github.com/owner/repo', 'https://example.org/login', 'https://example.org/']) expect(shouldCaptureWebPage(request(url)), url).toBe(false);
    expect(shouldCaptureWebPage({ ...request('https://example.org/post'), save_as: 'audio' })).toBe(false);
    expect(shouldCaptureWebPage({ ...request('https://example.org/post'), save_as: 'auto', preferences: { audio_format: 'mp3' } })).toBe(false);
    expect(shouldCaptureWebPage({ ...request('https://example.org/post'), browser: { tab_strategy: 'existing' } })).toBe(false);
    expect(shouldCaptureWebDocument({ ...request('https://example.org/post'), browser: { tab_strategy: 'existing' } })).toBe(true);
    expect(shouldCaptureWebDocument({ ...request('https://example.org/post'), browser: { tab_strategy: 'existing' }, save_as: 'audio' })).toBe(false);
    expect(shouldCaptureWebDocument({ ...request('https://example.org/post'), limits: { max_related_items: 2 } })).toBe(false);
    expect(shouldCaptureWebPage({ ...request('https://example.org/post'), target: { type: 'tab', instance_ref: 'one', tab_id: 2 } })).toBe(false);
  });
  it('fetches HTML with limits and rejects non-HTML, forbidden responses and private redirects', async () => {
    const policy = { allowedHosts: [], publicWeb: true, allowTestOrigins: [origin] };
    expect((await fetchHtml(`${origin}/article`, policy)).html).toBe(html);
    expect((await fetchHtml(`${origin}/gzip`, policy)).html).toBe(html);
    expect((await fetchHtml(`${origin}/gbk`, policy)).html).toContain('中文');
    await expect(fetchHtml(`${origin}/gzip`, { ...policy, maxBytes: 600 })).rejects.toMatchObject({ code: 'SIZE_LIMIT' });
    await expect(fetchHtml(`${origin}/json`, policy)).rejects.toMatchObject({ code: 'HTML_REQUIRED' });
    await expect(fetchHtml(`${origin}/forbidden`, policy)).rejects.toMatchObject({ code: 'ACCESS_NOT_PUBLIC' });
    await expect(fetchHtml(`${origin}/article`, { ...policy, maxBytes: 30 })).rejects.toMatchObject({ code: 'SIZE_LIMIT' });
    await expect(fetchHtml(`${origin}/redirect`, policy)).rejects.toMatchObject({ code: 'URL_NOT_ALLOWED' });
    await expect(resolveRemote('http://127.0.0.1/page', { allowedHosts: [], publicWeb: true })).rejects.toMatchObject({ code: 'PRIVATE_ADDRESS_BLOCKED' });
  });
  it('produces a runtime-only current-page receipt without a browser or site-specific selectors', async () => {
    const snap = await captureWebPage(request(`${origin}/article`), { allowTestOrigins: [origin] }, new AbortController().signal);
    expect(snap.platform).toBe('web_page');
    const signed = await captureWebPage(request(`${origin}/article?token=example`), { allowTestOrigins: [origin] }, new AbortController().signal);
    const saved = sanitizeSnapshot(signed);
    expect(evaluateContentCompleteness(saved, { adapter: webPageAdapter(saved)!, urls: [new URL(saved.source_url)] })).toEqual({ valid: true, complete: true });
    expect(snap.blocks.some(block => block.type === 'code')).toBe(true);
    expect(snap.blocks.some(block => block.type === 'table')).toBe(true);
    expect(evaluateContentCompleteness(snap, { adapter: webPageAdapter(snap)!, urls: [new URL(`${origin}/article`)] })).toEqual({ valid: true, complete: true });
  });
  it('does not report embedded media as collected for auto or bundle, while explicit document remains readable', async () => {
    for (const save_as of ['auto', 'bundle', 'document'] as const) {
      const snap = await captureWebPage({...request(`${origin}/media`),save_as}, {allowTestOrigins:[origin]}, new AbortController().signal);
      expect(snap.warnings).toContain('media:embedded_content');
      expect(snap.completeness).toBe(save_as==='document'?'complete':'partial');
      expect(snap.assets.some(asset=>asset.role==='video')).toBe(false);
      if(save_as!=='document')expect(snap.completeness_proof).toBeUndefined();
    }
  });
  it('saves and resumes a document with a disconnected browser without touching user files', async () => {
    let browserCalls = 0;
    const executor = createCollectionExecutor({
      bridge: { capture: async () => { browserCalls++; throw new Error('Browser disconnected'); } },
      registry: { match: () => undefined, list: () => [] },
      config: { schema_version: 1, port: 4318, state_dir: join(dir, 'state'), fixture_origins: [origin], allowed_extension_ids: [], clients: [{ id: 'web-test', token: 'test', output_roots: [dir] }] },
    });
    const job: JobRecord = { id: `job_${randomUUID()}`, client_id: 'web-test', request: request(`${origin}/article`), status: 'queued', stage: 'queued', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), artifacts: [], completeness: { requested_components_complete: false, scope: 'single_item' }, warnings: [], attempts: 0 };
    const result = await executor.execute(job, new AbortController().signal, async () => {});
    expect(result.status).toBe('succeeded'); expect(browserCalls).toBe(0);
    const text = result.artifacts?.find(a => a.role === 'text'); expect(text).toBeDefined();
    expect(await readFile(text!.path, 'utf8')).toContain('const value = 42;');
    const resumed = await executor.execute({ ...job, ...result }, new AbortController().signal, async () => {});
    expect(resumed.status).toBe('succeeded'); expect(browserCalls).toBe(0);
    expect(resumed.artifacts?.find(a => a.role === 'text')?.sha256).toBe(text!.sha256);
  });
  it('uses the existing collector after an HTTP refusal and keeps both failure paths explicit', async () => {
    const url = `${origin}/forbidden`;
    const snap = await captureWebPage(request(`${origin}/article`), { allowTestOrigins: [origin] }, new AbortController().signal);
    snap.source_url = url; snap.canonical_url = url; snap.platform_content_id = webPageIdentity(url);
    snap.completeness_proof = { ...snap.completeness_proof!, platform_content_id: snap.platform_content_id,
      method: 'browser_page_capture', boundary: 'dom_read', rule_id: 'web_page.browser-document.v1' };
    let calls = 0;
    const config = { schema_version: 1 as const, port: 4318, state_dir: join(dir, 'fallback-state'), fixture_origins: [origin], allowed_extension_ids: [], clients: [{ id: 'web-test', token: 'test', output_roots: [dir] }] };
    const registry = { match: () => ({ id: 'medium', version: '1', hosts: ['127.0.0.1'], content_types: ['article' as const], status: 'experimental' as const, match: () => true }), list: () => [] };
    const executor = createCollectionExecutor({ config, registry, bridge: { capture: async (_target, _request, _signal, _job, options) => { calls++; expect(options).toEqual({ web_document: true }); return snap; } } });
    const job: JobRecord = { id: `job_${randomUUID()}`, client_id: 'web-test', request: { target: { type: 'url', url }, include: ['text'], output: { directory: dir } }, status: 'queued', stage: 'queued', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), artifacts: [], completeness: { requested_components_complete: false, scope: 'single_item' }, warnings: [], attempts: 0 };
    const result = await executor.execute(job, new AbortController().signal, async () => {});
    expect(result.status).toBe('succeeded'); expect(calls).toBe(1);
    expect(result.warnings).toContain('HTTP_FALLBACK:ACCESS_NOT_PUBLIC');
    const failing = createCollectionExecutor({ config, registry, bridge: { capture: async () => { throw Object.assign(new Error('Extension needs update'), { code: 'EXTENSION_UPDATE_REQUIRED', retryable: false }); } } });
    await expect(failing.execute({ ...job, id: `job_${randomUUID()}` }, new AbortController().signal, async () => {}))
      .rejects.toMatchObject({ code: 'EXTENSION_UPDATE_REQUIRED', message: expect.stringContaining('ACCESS_NOT_PUBLIC'), retryable: false });
  });

  it('routes an HTTP-discovered embed to the registered media adapter instead of finalizing only prose', async () => {
    const url = `${origin}/media`;
    const output = await mkdtemp(join(dir, 'embedded-'));
    const config = { schema_version: 1 as const, port: 4318, state_dir: join(output, 'state'), fixture_origins: [origin], allowed_extension_ids: [], clients: [{ id: 'web-test', token: 'test', output_roots: [output] }] };
    const registry = { match: () => ({ id: 'medium', version: '1', hosts: ['127.0.0.1'], content_types: ['article' as const], status: 'experimental' as const, match: () => true }), list: () => [] };
    const captured = await captureWebPage({...request(url),save_as:'auto'}, {allowTestOrigins:[origin]}, new AbortController().signal);
    let calls=0;
    const executor=createCollectionExecutor({config,registry,bridge:{capture:async(_target,_request,_signal,_job,options)=>{
      calls++;expect(options).toEqual({platform_media:true});
      return {...captured,platform:'medium',adapter_version:'1',title:'Embedded source',completeness:'partial',completeness_proof:undefined};
    }}});
    const job:JobRecord={id:`job_${randomUUID()}`,client_id:'web-test',request:{target:{type:'url',url},save_as:'auto',output:{directory:output}},status:'queued',stage:'queued',created_at:new Date().toISOString(),updated_at:new Date().toISOString(),artifacts:[],completeness:{requested_components_complete:false,scope:'single_item'},warnings:[],attempts:0};
    const result=await executor.execute(job,new AbortController().signal,async()=>{});
    expect(calls).toBe(1);expect(result.status).toBe('partial');
    expect(result.completeness?.requested_components_complete).toBe(false);
  });

});
