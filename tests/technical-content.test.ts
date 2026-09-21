import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAdapterRegistry, DEVELOPMENT_FIXTURE_ORIGIN } from '../adapters/registry.js';
import { DomPageReader } from '../adapters/shared-extractors/dom-reader.js';
import { FixturePageReader, node } from './platforms/fixture-reader.js';
import { contentSnapshotSchema } from '../runtime/bridge/validation.js';
import { renderDocument } from '../runtime/collection/document.js';
import { requestedComponents } from '../runtime/collection/selection.js';
import { createCollectionExecutor } from '../runtime/collection/collector.js';
import { newClient, type RuntimeConfig } from '../runtime/policy/config.js';
import { sanitizeSnapshot } from '../runtime/storage/job-store.js';
import type { CollectRequest, ContentSnapshot, JobRecord } from '../shared/contracts.js';

const registry = createAdapterRegistry({ fixture_origins: [DEVELOPMENT_FIXTURE_ORIGIN] });
const adapter = registry.get('development_fixture')!;
const url = `${DEVELOPMENT_FIXTURE_ORIGIN}/fixture/content/technical`;

function technicalSnapshot(): ContentSnapshot {
  const code = node('code', 'code', '    if value < 2:\n        print("``` <script> literal")\n\n', { class: 'language-python' });
  const pre = node('pre', 'pre', '', {}, [code, node('copy', 'button', 'Copy')]);
  const annotation = node('tex', 'annotation', 'x_{i} = \\frac{a}{b}', { encoding: 'application/x-tex' });
  const math = node('math', 'span', 'duplicated formula presentation', { class: 'katex' }, [annotation]);
  const table = node('table', 'table', '', {}, [node('caption', 'caption', 'Results'), node('body', 'tbody', '', {}, [
    node('tr1', 'tr', '', {}, [node('th', 'th', 'Model', { rowspan: '2' }), node('td', 'td', '<script>literal</script> | A', { colspan: '2' })]),
    node('tr2', 'tr', '', {}, [node('td2', 'td', '0.82')]),
  ])]);
  const root = node('root', 'article', 'technical source', {}, [pre, math, table]);
  return adapter.extract(new FixturePageReader(url, 'Technical source').add("[data-babel-fixture='content']", [root]));
}

describe('technical source fidelity', () => {
  it('reads exact DOM code whitespace independently of normalized prose', () => {
    const raw = '    indented\n\tsecond\n\n';
    const code = { nodeType: 1, textContent: raw, innerText: raw };
    const reader = new DomPageReader({} as Document);
    expect(reader.rawText(code)).toBe(raw);
    expect(reader.text(code)).not.toBe(raw);
  });

  it('extracts code, source TeX and merged table cells without duplicate fallback prose', () => {
    const snapshot = technicalSnapshot();
    expect(snapshot.blocks.map(block => block.type)).toEqual(['code', 'math', 'table']);
    expect(snapshot.blocks[0]).toEqual({ type: 'code', text: '    if value < 2:\n        print("``` <script> literal")\n\n', language: 'python' });
    expect(snapshot.blocks[1]).toEqual({ type: 'math', text: 'x_{i} = \\frac{a}{b}', format: 'latex' });
    expect(snapshot.blocks[2]).toMatchObject({ type: 'table', caption: 'Results', rows: [[{ text: 'Model', header: true, rowspan: 2 }, { text: '<script>literal</script> | A', colspan: 2 }], [{ text: '0.82' }]] });
    expect(contentSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(JSON.stringify(snapshot.blocks)).not.toContain('Copy');
    expect(JSON.stringify(snapshot.blocks)).not.toContain('duplicated formula presentation');
  });

  it('renders exact code using an unclosable fence and escapes table markup', () => {
    const rendered = renderDocument(technicalSnapshot(), [], '/tmp/technical-result');
    expect(rendered).toContain('````python\n    if value < 2:\n        print("``` <script> literal")\n\n````');
    expect(rendered).toContain('```latex\nx_{i} = \\frac{a}{b}\n```');
    expect(rendered).toContain('<th rowspan="2">Model</th><td colspan="2">&lt;script&gt;literal&lt;/script&gt; | A</td>');
    expect(rendered).not.toContain('<td colspan="2"><script>');
  });

  it('keeps source references useful without following links or retaining credentials', () => {
    const link = node('link', 'a', 'Usage guide', { href: '/docs/start?token=private#setup' });
    const formula = node('formula', 'math', 'duplicated', { alttext: 'E = mc^2' });
    const paragraph = node('p', 'p', '', {}, [node('intro', '#text', 'See '), link, formula]);
    const root = node('root', 'article', '', {}, [paragraph]);
    const snapshot = adapter.extract(new FixturePageReader(url, '').add("[data-babel-fixture='content']", [root]));
    expect(snapshot.blocks).toEqual([{ type: 'paragraph', text: `See Usage guide (${DEVELOPMENT_FIXTURE_ORIGIN}/docs/start#setup) \\(E = mc^2\\)` }]);
    expect(snapshot.assets).toEqual([]);
    expect(JSON.stringify(snapshot)).not.toContain('private');
  });

  it('rejects malformed structural fields crossing the bridge', () => {
    const snapshot = technicalSnapshot();
    expect(contentSnapshotSchema.safeParse({ ...snapshot, blocks: [{ type: 'code', text: 'literal', language: 'js\n```' }] }).success).toBe(false);
    expect(contentSnapshotSchema.safeParse({ ...snapshot, blocks: [{ type: 'table', rows: [[{ text: 'literal', header: false, colspan: -1 }]] }] }).success).toBe(false);
  });

  it('keeps table cells inside the same credential redaction boundary as prose and code', () => {
    const snapshot = technicalSnapshot();
    const clean = sanitizeSnapshot({ ...snapshot, blocks: [{ type: 'table', caption: 'token=caption-secret', rows: [[{ header: false, text: 'https://example.org/paper?token=cell-secret' }]] }, { type: 'code', text: 'api_key=code-secret' }] });
    expect(JSON.stringify(clean.blocks)).not.toContain('caption-secret');
    expect(JSON.stringify(clean.blocks)).not.toContain('cell-secret');
    expect(JSON.stringify(clean.blocks)).not.toContain('code-secret');
  });

  it('selects a table-only document and enforces trusted fulltext requirements', () => {
    const source = { ...technicalSnapshot(), blocks: technicalSnapshot().blocks.filter(block => block.type === 'table') };
    const request: CollectRequest = { target: { type: 'url', url }, output: { directory: '/tmp/technical-result' } };
    const policy = { required_document_components: ['files' as const] };
    expect(requestedComponents(request, source)).toEqual(['text']);
    for (const save_as of ['auto', 'document', 'bundle'] as const) expect(requestedComponents({ ...request, save_as }, source, policy)).toEqual(['text', 'files']);
    expect(requestedComponents({ ...request, include: ['text'] }, source, policy)).toEqual(['text', 'files']);
    expect(requestedComponents({ ...request, save_as: 'images' }, source, policy)).toEqual(['images']);
    expect(requestedComponents({ ...request, save_as: 'bundle', include: ['images'] }, source, policy)).toEqual(['images']);
    expect(requestedComponents(request, { ...source, required_document_components: ['files'] } as ContentSnapshot)).toEqual(['text']);
  });

  it('cannot mark a saved abstract complete when the required fulltext PDF is absent', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'babel-paper-fulltext-'));
    const client = newClient('paper-fixture', [directory]);
    const source = technicalSnapshot();
    const definition = { ...adapter, required_document_components: ['files' as const] };
    const config: RuntimeConfig = { schema_version: 1, port: 0, state_dir: directory, allowed_extension_ids: [], clients: [client], fixture_origins: [DEVELOPMENT_FIXTURE_ORIGIN] };
    const executor = createCollectionExecutor({ config, registry: { match: () => definition, list: () => [definition] }, bridge: { capture: async () => source } });
    const now = new Date().toISOString();
    const job: JobRecord = { id: 'job_12345678-1234-4123-8123-123456789012', client_id: client.id, request: { target: { type: 'url', url }, save_as: 'document', output: { directory } }, status: 'collecting', stage: 'collecting', created_at: now, updated_at: now, attempts: 1, artifacts: [], warnings: [], completeness: { requested_components_complete: false, scope: 'single_item' } };
    try {
      const result = await executor.execute(job, new AbortController().signal, async () => {});
      expect(result.status).toBe('partial');
      expect(result.completeness?.requested_components_complete).toBe(false);
      expect(result.checkpoint?.failed_components?.files).toBeTruthy();
      const manifest = JSON.parse(await readFile(result.artifacts!.find(artifact => artifact.role === 'manifest')!.path, 'utf8'));
      expect(manifest.requested).toContain('files');
      expect(manifest.complete).toBe(false);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
