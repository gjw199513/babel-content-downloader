import { describe, expect, it } from 'vitest';
import { createAdapterRegistry } from '../adapters/registry.js';
import { contentSnapshotSchema } from '../runtime/bridge/validation.js';
import { FixtureNode, FixturePageReader, node } from './platforms/fixture-reader.js';

const medium = createAdapterRegistry().get('medium')!;
function page(sourceValue = 'https://miro.medium.com/small.webp 640w, https://miro.medium.com/large.webp 1280w', fallbackSource = 'data:image/gif;base64,AAAA') {
  const title = node('title', 'h1', 'Neural network lesson');
  const avatar = node('avatar', 'img', '', { src: 'https://miro.medium.com/avatar.png', 'data-testid': 'authorPhoto' });
  const source = new FixtureNode('source', 'source', '', { srcset: sourceValue }, [], false);
  const image = node('image', 'img', '', { src: fallbackSource, alt: 'A neural network diagram' });
  const picture = node('picture', 'picture', '', {}, [source, image]);
  const figure = node('figure', 'figure', '', {}, [picture]);
  const prose = node('prose', 'p', 'Source explanation remains readable.');
  const direct = node('direct', 'img', '', { src: 'https://miro.medium.com/direct.png' });
  const second = node('second', 'figure', '', {}, [direct]);
  const root = node('root', 'article', '', {}, [title, avatar, prose, figure, second]);
  const reader = new FixturePageReader('https://medium.com/codex/neural-networks-in-a-nutshell-2f0300b4fb00', 'Neural network lesson')
    .add('article', [root])
    .add('article h1', [title], root)
    .add("article img[data-testid='authorPhoto']", [avatar], root)
    .add('article figure picture', [picture], root)
    .add('article figure img:not(picture img)', [direct], root)
    .add('source', [source], picture)
    .add('img', [image], picture);
  return medium.extract(reader);
}

function pageWithAmbiguousPictureImages() {
  const title = node('ambiguous-title', 'h1', 'Picture ambiguity must stay incomplete');
  const source = new FixtureNode('ambiguous-source', 'source', '', {
    srcset: 'https://miro.medium.com/article-rendition.webp 1280w',
  }, [], false);
  const renderedImage = node('ambiguous-rendered-image', 'img', '', {
    src: 'data:image/gif;base64,AAAA',
    alt: 'Intended article image placeholder',
  });
  const nestedAvatar = node('ambiguous-nested-avatar', 'img', '', {
    src: 'https://miro.medium.com/avatar-inside-picture.png',
    alt: 'Author avatar that is not article media',
  });
  const picture = node('ambiguous-picture', 'picture', '', {}, [source, renderedImage, nestedAvatar]);
  const figure = node('ambiguous-figure', 'figure', '', {}, [picture]);
  const prose = node('ambiguous-prose', 'p', 'The readable article must survive an ambiguous image wrapper.');
  const root = node('ambiguous-root', 'article', '', {}, [title, prose, figure]);
  const reader = new FixturePageReader('https://medium.com/codex/picture-ambiguity-2f0300b4fb01', 'Picture ambiguity')
    .add('article', [root])
    .add('article h1', [title], root)
    .add('article figure picture', [picture], root)
    .add('article figure img:not(picture img)', [], root)
    .add('source', [source], picture)
    .add('img', [renderedImage, nestedAvatar], picture);
  return medium.extract(reader);
}

describe('Medium lazy picture assets', () => {
  it('uses explicit responsive candidates once in body order and excludes author avatars', () => {
    const result = page();
    expect(result.assets.map(a => a.url)).toEqual(['https://miro.medium.com/large.webp', 'https://miro.medium.com/direct.png']);
    expect(result.assets[0]?.title).toBe('A neural network diagram');
    expect(result.blocks.flatMap(b => b.type === 'image' ? [b.asset_id] : [])).toEqual(result.assets.map(a => a.id));
    expect(result.warnings).not.toContain('asset:image:non_http_or_missing_source');
    expect(result.completeness).toBe('unknown');
    expect(contentSnapshotSchema.safeParse(result).success).toBe(true);
  });

  it('retains the single img fallback when picture has no responsive candidate', () => {
    expect(page('', 'https://miro.medium.com/fallback.png').assets[0]?.url).toBe('https://miro.medium.com/fallback.png');
  });

  it('falls back to the sole img when responsive source values are placeholders', () => {
    expect(page('data:image/gif;base64,AAAA 1x', 'https://miro.medium.com/fallback-after-placeholder.png').assets[0]?.url)
      .toBe('https://miro.medium.com/fallback-after-placeholder.png');
  });

  it('keeps literal commas inside responsive URLs while selecting the largest descriptor', () => {
    const result = page(
      'https://miro.medium.com/v2/resize:fit:640/1*diagram,source.webp 640w, https://miro.medium.com/v2/resize:fit:1280/1*diagram,source.webp 1280w',
    );
    expect(result.assets[0]?.url).toBe('https://miro.medium.com/v2/resize:fit:1280/1*diagram,source.webp');
  });

  it('rejects an ambiguous picture instead of assigning its source rendition to an unrelated nested img', () => {
    const result = pageWithAmbiguousPictureImages();

    expect(result.assets).toEqual([]);
    expect(result.blocks.some(block => block.type === 'image')).toBe(false);
    expect(result.warnings).toContain('asset:image:non_http_or_missing_source');
  });

  it('keeps missing image sources incomplete instead of treating placeholders as files', () => {
    const result = page('data:image/gif;base64,AAAA');
    expect(result.assets).toHaveLength(1);
    expect(result.warnings).toContain('asset:image:non_http_or_missing_source');
    expect(result.completeness).toBe('unknown');
  });

  it('still blocks a responsive image hosted outside the declared source hosts', () => {
    const result = page('https://untrusted.example/diagram.png 1280w');
    expect(result.assets[0]).toMatchObject({ availability: 'blocked' });
    expect(result.completeness).not.toBe('complete');
  });
});
