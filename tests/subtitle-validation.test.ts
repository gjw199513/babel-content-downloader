import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import type { AdapterDefinition, AdapterRegistry, ContentSnapshot, JobRecord, SourceAsset } from '../shared/contracts.js';
import { createCollectionExecutor } from '../runtime/collection/collector.js';
import { selectSubtitleLanguages } from '../runtime/collection/preferences.js';
import { validateSubtitleAsset } from '../runtime/collection/subtitle-validation.js';

let directory: string;
let origin: string;
let server: http.Server;
let requests = 0;

const validVtt = `WEBVTT

STYLE
::cue { color: lime; }

NOTE source metadata

speaker-a
00:00.000 --> 00:02.000 align:start
<v Alice>Hello

speaker-b
00:01.000 --> 00:03.000
<v Bob>Overlapping reply
`;
let validPng: Buffer;
const truncatedPng = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000006449444154789c6360', 'hex');

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'babel-subtitle-validation-'));
  validPng = await sharp({ create: { width: 1, height: 1, channels: 4, background: '#25657eff' } }).png().toBuffer();
  server = http.createServer((request, response) => {
    requests++;
    if (request.url === '/valid.txt') {
      response.setHeader('content-type', 'text/plain; charset=utf-8');
      response.end('valid local attachment\n');
      return;
    }
    if (request.url === '/valid.png') {
      response.setHeader('content-type', 'image/png');
      response.end(validPng);
      return;
    }
    response.setHeader('content-type', 'text/vtt');
    response.end(request.url === '/valid.vtt' ? validVtt : 'WEBVTT\n\nnot-a-time --> still-not-a-time\ncaption\n');
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('fixture server unavailable');
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (directory) await rm(directory, { recursive: true, force: true });
});

let fileIndex = 0;
async function validate(value: string | Buffer, mediaType = 'text/plain') {
  const path = join(directory, `subtitle-${fileIndex++}.bin`);
  await writeFile(path, value);
  return validateSubtitleAsset(path, { media_type: mediaType }, mediaType);
}

async function rejected(value: string | Buffer, mediaType: string): Promise<{ code?: string; message?: string }> {
  try { await validate(value, mediaType); }
  catch (error) { return error as { code?: string; message?: string }; }
  throw new Error('subtitle unexpectedly passed validation');
}

describe('complete subtitle parsing', () => {
  it('accepts real VTT, SRT, ASS and strict TTML cues while preserving legal overlap and speaker text', async () => {
    await expect(validate(validVtt, 'text/vtt')).resolves.toEqual({ extension: 'vtt', mediaType: 'text/vtt', cueCount: 2 });
    await expect(validate(`1
00:00:05,000 --> 00:00:07,000
Later speaker

2
00:00:01,000 --> 00:00:06,000
Earlier overlapping speaker
`, 'application/x-subrip')).resolves.toEqual({ extension: 'srt', mediaType: 'application/x-subrip', cueCount: 2 });
    await expect(validate(`[Script Info]
ScriptType: v4.00+

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:05.00,0:00:07.00,Default,Alice,0,0,0,,Later speaker
Dialogue: 0,0:00:01.00,0:00:06.00,Default,Bob,0,0,0,,Earlier, overlapping reply
`, 'text/x-ssa')).resolves.toEqual({ extension: 'ass', mediaType: 'text/x-ssa', cueCount: 2 });
    await expect(validate(`<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:frameRate="30">
  <body><div>
    <p begin="00:00:05.000" end="00:00:07.000"><span>Alice &amp; team</span></p>
    <p begin="1s" dur="5s">Bob<br/>overlaps</p>
  </div></body>
</tt>`, 'application/ttml+xml')).resolves.toEqual({ extension: 'ttml', mediaType: 'application/ttml+xml', cueCount: 2 });
  });

  it('accepts the bounded Kind and Language header emitted by real platform WebVTT', async () => {
    await expect(validate(`WEBVTT
Kind: captions
Language: en

00:00.000 --> 00:01.000
Hello

00:01.000 --> 00:02.000
World
`, 'text/vtt')).resolves.toEqual({ extension: 'vtt', mediaType: 'text/vtt', cueCount: 2 });
  });

  it('rejects unknown, duplicate, malformed or unterminated platform header metadata', async () => {
    const cases = [
      `WEBVTT\nSource: page\n\n00:00.000 --> 00:01.000\ntext\n`,
      `WEBVTT\nKind: captions\nKind: captions\n\n00:00.000 --> 00:01.000\ntext\n`,
      `WEBVTT\nKind: metadata\n\n00:00.000 --> 00:01.000\ntext\n`,
      `WEBVTT\nLanguage: ../en\n\n00:00.000 --> 00:01.000\ntext\n`,
      `WEBVTT\nKind: captions\nLanguage: en\n00:00.000 --> 00:01.000\ntext\n`,
      `WEBVTT\n\n00:00.000 --> 00:01.000\n`,
    ];
    for (const value of cases) await expect(rejected(value, 'text/vtt')).resolves.toMatchObject({ code: 'INVALID_SUBTITLE' });
  });

  it('prefers an exact requested language while preserving generic regional fallback and missing reports', () => {
    const asset = (id: string, language: string, order: number): SourceAsset => ({
      id, role: 'subtitle', url: `https://example.com/${id}.vtt`, language, order, availability: 'available',
    });
    const assets = [asset('en', 'en', 0), asset('provider-original', 'en-orig', 1), asset('en-us', 'en-US', 2), asset('fr-ca', 'fr-CA', 3)];
    expect(selectSubtitleLanguages(assets, ['en'])).toEqual({ selected: [assets[0]], missing: [] });
    expect(selectSubtitleLanguages(assets, ['en', 'fr'])).toEqual({ selected: [assets[0], assets[3]], missing: [] });
    expect(selectSubtitleLanguages(assets, ['en-US', 'de'])).toEqual({ selected: [assets[2]], missing: ['de'] });
    expect(selectSubtitleLanguages([assets[1]!, assets[2]!], ['en'])).toEqual({ selected: [assets[1], assets[2]], missing: [] });
  });

  it('rejects marker-only, reversed, empty and truncated VTT/SRT timelines', async () => {
    const cases: Array<[string, string, RegExp]> = [
      ['WEBVTT\n\nthis is not a timestamp --> still not a timestamp\ncaption\n', 'text/vtt', /非法时间戳/],
      ['WEBVTT\n\n00:01.000 --> 00:01.000\ncaption\n', 'text/vtt', /结束时间不晚于开始时间/],
      ['WEBVTT\n\n00:00.000 --> 00:01.000\nvalid\n\norphan tail\n', 'text/vtt', /缺少时间轴/],
      ['1\n00:00:05,000 --> 00:00:01,000\nbackwards\n', 'application/x-subrip', /结束时间不晚于开始时间/],
      ['1\n00:00:00,000 --> 00:00:01,000\nvalid\n\n2\n00:00:02,000 -->\n', 'application/x-subrip', /非法时间戳/],
      ['WEBVTT\n\n', 'text/vtt', /没有可播放/],
    ];
    for (const [value, mediaType, message] of cases) {
      const error = await rejected(value, mediaType);
      expect(error.code).toBe('INVALID_SUBTITLE');
      expect(error.message).toMatch(message);
    }
  });

  it('rejects incomplete ASS events and invalid event intervals', async () => {
    const prefix = `[Script Info]\nScriptType: v4.00+\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
    const truncated = await rejected(`${prefix}Dialogue: 0,0:00:00.00,0:00:01.00\n`, 'text/x-ssa');
    expect(truncated).toMatchObject({ code: 'INVALID_SUBTITLE' }); expect(truncated.message).toContain('字段被截断');
    const reversed = await rejected(`${prefix}Dialogue: 0,0:00:02.00,0:00:01.00,Default,A,0,0,0,,text\n`, 'text/x-ssa');
    expect(reversed).toMatchObject({ code: 'INVALID_SUBTITLE' }); expect(reversed.message).toContain('结束时间不晚于开始时间');
  });

  it('rejects non-finite timestamps instead of accepting overflowed hours', async () => {
    const hours = '9'.repeat(400);
    const assPrefix = `[Script Info]\nScriptType: v4.00+\n[Events]\nFormat: Start, End, Text\n`;
    const cases: Array<[string, string]> = [
      [`WEBVTT\n\n00:00.000 --> ${hours}:00:00.000\noverflow\n`, 'text/vtt'],
      [`1\n00:00:00,000 --> ${hours}:00:00,000\noverflow\n`, 'application/x-subrip'],
      [`${assPrefix}Dialogue: 0:00:00.00,${hours}:00:00.00,overflow\n`, 'text/x-ssa'],
      [`<tt xmlns="http://www.w3.org/ns/ttml"><body><p begin="0s" end="${hours}:00:00.000">overflow</p></body></tt>`, 'application/ttml+xml'],
    ];
    for (const [value, mediaType] of cases) {
      await expect(rejected(value, mediaType)).resolves.toMatchObject({ code: 'INVALID_SUBTITLE' });
    }
  });

  it('rejects malformed XML, DOCTYPE, unknown entities and unbounded TTML paragraphs', async () => {
    const cases: Array<[string, RegExp]> = [
      ['<tt xmlns="http://www.w3.org/ns/ttml"><body><p begin="0s" end="1s">broken</body></tt>', /完整、合法/],
      ['<!DOCTYPE tt [<!ENTITY x "caption">]><tt xmlns="http://www.w3.org/ns/ttml"><body><p begin="0s" end="1s">&x;</p></body></tt>', /不允许 DOCTYPE/],
      ['<tt xmlns="http://www.w3.org/ns/ttml"><body><p begin="0s" end="1s">&unknown;</p></body></tt>', /完整、合法/],
      ['<tt xmlns="http://www.w3.org/ns/ttml"><body><p begin="0s">no finite end</p></body></tt>', /缺少可确定的结束时间/],
      ['<tt xmlns="http://www.w3.org/ns/ttml"><body><p begin="2s" end="1s">backwards</p></body></tt>', /结束时间不晚于开始时间/],
      ['<tt xmlns="http://www.w3.org/ns/ttml"><p begin="0s" end="1s">outside body</p></tt>', /不在 body/],
      ['<tt><body><p begin="0s" end="1s">missing namespace</p></body></tt>', /根元素或命名空间无效/],
    ];
    for (const [value, message] of cases) {
      const error = await rejected(value, 'application/ttml+xml');
      expect(error.code).toBe('INVALID_SUBTITLE'); expect(error.message).toMatch(message);
    }
  });

  it('honors cancellation before reading a subtitle', async () => {
    const path = join(directory, 'cancelled.vtt'); await writeFile(path, validVtt);
    const controller = new AbortController(); controller.abort();
    await expect(validateSubtitleAsset(path, { media_type: 'text/vtt' }, 'text/vtt', controller.signal)).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});

const ruleId = 'subtitle-validation-fixture-v1';
function snapshot(assetPath: string): ContentSnapshot {
  return {
    schema_version: '1', platform: 'development_fixture', adapter_version: '1',
    source_url: `${origin}/article`, canonical_url: `${origin}/article`, platform_content_id: 'article',
    content_type: 'article', title: 'subtitle validation', authors: [], published_at: null,
    blocks: [{ type: 'paragraph', text: 'saved source text' }],
    assets: [{ id: 'subtitle-1', role: 'subtitle', url: `${origin}${assetPath}`, order: 0, media_type: 'text/vtt', language: 'en', availability: 'available' }],
    access_class: 'public_free', completeness: 'complete', warnings: [],
    completeness_proof: { version: 1, scope: 'single_item', method: 'adapter_bounded_dom', rule_id: ruleId, platform_content_id: 'article', boundary: 'root_exhausted', pending_marker_count: 0, ordered_asset_count: 0, unplaced_asset_count: 0 },
  };
}

function runtime(output: string, source: ContentSnapshot) {
  const adapter: AdapterDefinition = {
    id: 'development_fixture', version: '1', hosts: ['127.0.0.1'], asset_hosts: [], engine: 'direct', content_types: ['article'], status: 'experimental',
    match: url => url.origin === origin && url.pathname === '/article',
    completion_rules: [{ id: ruleId, content_types: ['article'], boundary: 'root_exhausted', matches: (url, contentId) => url.origin === origin && url.pathname === '/article' && contentId === 'article' }],
  };
  const registry: AdapterRegistry = { list: () => [adapter], match: url => adapter.match(url) ? adapter : undefined };
  return createCollectionExecutor({
    bridge: { capture: async () => source }, registry,
    config: { schema_version: 1, port: 4318, state_dir: join(directory, 'state'), allowed_extension_ids: [], fixture_origins: [origin], clients: [{ id: 'test', token: 'fixture', output_roots: [output] }] },
  });
}

function job(output: string, source?: ContentSnapshot): JobRecord {
  return {
    id: `job_${randomUUID()}`, client_id: 'test',
    request: { target: { type: 'url', url: `${origin}/article` }, include: ['text', 'subtitles'], output: { directory: output } },
    status: 'queued', stage: 'queued', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    ...(source ? { snapshot: source } : {}), artifacts: [], completeness: { requested_components_complete: false, scope: 'single_item' }, warnings: [], attempts: 1,
  };
}

describe('collector subtitle delivery gate', () => {
  it('keeps valid text but never saves or completes a malformed subtitle', async () => {
    const output = join(directory, `invalid-output-${randomUUID()}`); await mkdir(output);
    const source = snapshot('/invalid.vtt'); const task = job(output);
    const result = await runtime(output, source).execute(task, new AbortController().signal, async patch => { Object.assign(task, patch); });
    expect(result.status).toBe('partial'); expect(result.error).toMatchObject({ code: 'INVALID_SUBTITLE', retryable: false });
    expect(result.artifacts?.some(artifact => artifact.role === 'subtitle')).toBe(false);
    expect(result.artifacts?.some(artifact => artifact.role === 'text')).toBe(true);
    expect(result.checkpoint?.completed_components).toEqual(['text']);
    expect(result.checkpoint?.failed_components?.subtitles).toContain('非法时间戳');
    const manifest = JSON.parse(await readFile(result.artifacts!.find(artifact => artifact.role === 'manifest')!.path, 'utf8'));
    expect(manifest).toMatchObject({ complete: false, components_saved: ['text'] });
  });

  it('revalidates a completed legacy subtitle, preserves bad bytes, and refetches instead of reporting success', async () => {
    const output = join(directory, `legacy-invalid-${randomUUID()}`); await mkdir(output);
    const root = join(output, 'legacy-result'); const assets = join(root, 'assets'); await mkdir(assets, { recursive: true });
    const legacyPath = join(assets, 'subtitles-001-old.vtt'); const legacyBytes = Buffer.from('WEBVTT\n\nnot-a-time --> still-not-a-time\nlegacy\n'); await writeFile(legacyPath, legacyBytes);
    const source = snapshot('/invalid.vtt'); const task = job(output, source);
    task.request = { target: { type: 'url', url: `${origin}/article` }, save_as: 'subtitles', output: { directory: output } };
    task.artifact_root = root;
    task.artifacts = [{ role: 'subtitle', path: legacyPath, media_type: 'text/vtt', size: legacyBytes.length, sha256: createHash('sha256').update(legacyBytes).digest('hex'), source_asset_id: 'subtitle-1' }];
    task.checkpoint = { completed_components: ['subtitles'] };
    const before = requests;
    const result = await runtime(output, source).execute(task, new AbortController().signal, async patch => { Object.assign(task, patch); });
    expect(requests).toBe(before + 1);
    expect(result.status).toBe('failed'); expect(result.completeness?.requested_components_complete).toBe(false);
    expect(result.artifacts?.some(artifact => artifact.path === legacyPath)).toBe(false);
    expect(result.artifacts?.some(artifact => artifact.role === 'subtitle')).toBe(false);
    expect(result.checkpoint?.completed_components).toEqual([]);
    expect(result.warnings?.join(' ')).toContain('本地复核未通过');
    expect(await readFile(legacyPath)).toEqual(legacyBytes);
  });

  it('revalidates and reuses a valid completed subtitle without downloading it again', async () => {
    const output = join(directory, `legacy-valid-${randomUUID()}`); await mkdir(output);
    const root = join(output, 'legacy-result'); const assets = join(root, 'assets'); await mkdir(assets, { recursive: true });
    const legacyPath = join(assets, 'subtitles-001-old.vtt'); const bytes = Buffer.from(validVtt); await writeFile(legacyPath, bytes);
    const source = snapshot('/valid.vtt'); const task = job(output, source);
    task.request = { target: { type: 'url', url: `${origin}/article` }, save_as: 'subtitles', output: { directory: output } };
    task.artifact_root = root;
    task.artifacts = [{ role: 'subtitle', path: legacyPath, media_type: 'text/vtt', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), source_asset_id: 'subtitle-1' }];
    task.checkpoint = { completed_components: ['subtitles'] };
    const before = requests;
    const result = await runtime(output, source).execute(task, new AbortController().signal, async patch => { Object.assign(task, patch); });
    expect(requests).toBe(before);
    expect(result.status).toBe('succeeded'); expect(result.completeness?.requested_components_complete).toBe(true);
    expect(result.artifacts?.find(artifact => artifact.source_asset_id === 'subtitle-1')?.path).toBe(legacyPath);
  });

  it('revalidates and reuses a valid completed text attachment without downloading it again', async () => {
    const output = join(directory, `legacy-valid-file-${randomUUID()}`); await mkdir(output);
    const root = join(output, 'legacy-result'); const assets = join(root, 'assets'); await mkdir(assets, { recursive: true });
    const legacyPath = join(assets, 'files-001-old.txt'); const bytes = Buffer.from('valid local attachment\n'); await writeFile(legacyPath, bytes);
    const source = snapshot('/valid.txt');
    source.blocks = [{ type: 'file', asset_id: 'file-1', caption: 'valid attachment' }];
    source.assets = [{ id: 'file-1', role: 'file', url: `${origin}/valid.txt`, order: 0, media_type: 'text/plain', availability: 'available' }];
    source.completeness_proof = { ...source.completeness_proof!, ordered_asset_count: 1 };
    const task = job(output, source);
    task.request = { target: { type: 'url', url: `${origin}/article` }, save_as: 'files', output: { directory: output } };
    task.artifact_root = root;
    task.artifacts = [{ role: 'file', path: legacyPath, media_type: 'text/plain', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), source_asset_id: 'file-1' }];
    task.checkpoint = { completed_components: ['files'] };
    const before = requests;
    const result = await runtime(output, source).execute(task, new AbortController().signal, async patch => { Object.assign(task, patch); });
    expect(requests).toBe(before);
    expect(result.status).toBe('succeeded'); expect(result.completeness?.requested_components_complete).toBe(true);
    expect(result.artifacts?.find(artifact => artifact.source_asset_id === 'file-1')?.path).toBe(legacyPath);
  });

  it('preserves an invalid completed image, removes it from the delivery relation, and refetches valid pixels', async () => {
    const output = join(directory, `legacy-invalid-image-${randomUUID()}`); await mkdir(output);
    const root = join(output, 'legacy-result'); const assets = join(root, 'assets'); await mkdir(assets, { recursive: true });
    const legacyPath = join(assets, 'images-001-old.png'); await writeFile(legacyPath, truncatedPng);
    const source = snapshot('/valid.png');
    source.blocks = [{ type: 'image', asset_id: 'image-1', caption: 'valid image' }];
    source.assets = [{ id: 'image-1', role: 'image', url: `${origin}/valid.png`, order: 0, media_type: 'image/png', availability: 'available' }];
    source.completeness_proof = { ...source.completeness_proof!, ordered_asset_count: 1 };
    const task = job(output, source);
    task.request = { target: { type: 'url', url: `${origin}/article` }, save_as: 'images', output: { directory: output } };
    task.artifact_root = root;
    task.artifacts = [{ role: 'image', path: legacyPath, media_type: 'image/png', size: truncatedPng.length, sha256: createHash('sha256').update(truncatedPng).digest('hex'), source_asset_id: 'image-1' }];
    task.checkpoint = { completed_components: ['images'] };
    const before = requests;
    const result = await runtime(output, source).execute(task, new AbortController().signal, async patch => { Object.assign(task, patch); });
    expect(requests).toBe(before + 1);
    expect(result.status).toBe('succeeded'); expect(result.completeness?.requested_components_complete).toBe(true);
    expect(result.warnings?.join(' ')).toContain('本地复核未通过');
    expect(await readFile(legacyPath)).toEqual(truncatedPng);
    const current = result.artifacts?.find(artifact => artifact.source_asset_id === 'image-1');
    expect(current?.path).not.toBe(legacyPath); expect(await readFile(current!.path)).toEqual(validPng);
  });

  it('revalidates and reuses a valid completed image without downloading it again', async () => {
    const output = join(directory, `legacy-valid-image-${randomUUID()}`); await mkdir(output);
    const root = join(output, 'legacy-result'); const assets = join(root, 'assets'); await mkdir(assets, { recursive: true });
    const legacyPath = join(assets, 'images-001-old.png'); await writeFile(legacyPath, validPng);
    const source = snapshot('/valid.png');
    source.blocks = [{ type: 'image', asset_id: 'image-1', caption: 'valid image' }];
    source.assets = [{ id: 'image-1', role: 'image', url: `${origin}/valid.png`, order: 0, media_type: 'image/png', availability: 'available' }];
    source.completeness_proof = { ...source.completeness_proof!, ordered_asset_count: 1 };
    const task = job(output, source);
    task.request = { target: { type: 'url', url: `${origin}/article` }, save_as: 'images', output: { directory: output } };
    task.artifact_root = root;
    task.artifacts = [{ role: 'image', path: legacyPath, media_type: 'image/png', size: validPng.length, sha256: createHash('sha256').update(validPng).digest('hex'), source_asset_id: 'image-1' }];
    task.checkpoint = { completed_components: ['images'] };
    const before = requests;
    const result = await runtime(output, source).execute(task, new AbortController().signal, async patch => { Object.assign(task, patch); });
    expect(requests).toBe(before);
    expect(result.status).toBe('succeeded'); expect(result.completeness?.requested_components_complete).toBe(true);
    expect(result.artifacts?.find(artifact => artifact.source_asset_id === 'image-1')?.path).toBe(legacyPath);
  });
});
