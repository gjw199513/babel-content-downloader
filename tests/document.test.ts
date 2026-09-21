import { describe, expect, it } from 'vitest';
import type { Artifact, ContentSnapshot } from '../shared/contracts.js';
import { renderDocument } from '../runtime/collection/document.js';

function snapshot(overrides: Partial<ContentSnapshot> = {}): ContentSnapshot {
  return {
    schema_version: '1', platform: 'development_fixture', adapter_version: '1', source_url: 'https://example.test/post', canonical_url: 'https://example.test/post',
    content_type: 'post', authors: [], published_at: null, blocks: [], assets: [], access_class: 'public_free', completeness: 'complete', warnings: [],
    ...overrides,
  };
}

function artifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    role: 'audio', path: '/tmp/babel-document/assets/audio.m4a', media_type: 'audio/mp4', size: 1, sha256: 'a'.repeat(64), source_asset_id: 'video-1',
    ...overrides,
  };
}

describe('local content document rendering', () => {
  it('labels a saved audio artifact as audio while retaining its source-video explanation', () => {
    const document = renderDocument(snapshot({
      content_type: 'video',
      blocks: [{ type: 'video', asset_id: 'video-1', caption: '原视频' }],
      assets: [{ id: 'video-1', role: 'video', url: 'https://cdn.example.test/video.mp4', order: 0, availability: 'available' }],
    }), [artifact()], '/tmp/babel-document');

    expect(document).toContain('[已保存音频（源视频：原视频）](assets/audio.m4a)');
    expect(document).not.toContain('[原视频](assets/audio.m4a)');
  });

  it('keeps Markdown-looking source paragraphs literal while typed blocks retain their structure', () => {
    const document = renderDocument(snapshot({
      blocks: [
        { type: 'paragraph', text: '# 不是标题\n> 不是引用\n- 不是列表\n1. 不是有序列表\n~~~ 不是围栏\n---\n===' },
        { type: 'heading', level: 2, text: '显式标题' },
        { type: 'quote', text: '显式引用' },
        { type: 'list', ordered: false, items: ['显式列表'] },
        { type: 'list', ordered: true, items: ['显式有序列表'] },
      ],
    }), [], '/tmp/babel-document');

    expect(document).toContain('\\# 不是标题');
    expect(document).toContain('&gt; 不是引用');
    expect(document).toContain('\\- 不是列表');
    expect(document).toContain('1\\. 不是有序列表');
    expect(document).toContain('\\~~~ 不是围栏');
    expect(document).toContain('\\---');
    expect(document).toContain('\\===');
    expect(document).toContain('## 显式标题');
    expect(document).toContain('> 显式引用');
    expect(document).toContain('- 显式列表');
    expect(document).toContain('1. 显式有序列表');
  });
});
