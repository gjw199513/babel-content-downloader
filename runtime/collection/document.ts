import { relative, sep } from 'node:path';
import type { Artifact, ContentBlock, ContentSnapshot, SourceAsset } from '../../shared/contracts.js';

function text(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/([\\`*_\[\]])/g, '\\$1');
}

/**
 * A paragraph is source data, not source-authored Markdown. Preserve line
 * breaks while preventing source text from creating an untyped heading, list,
 * quote, rule, or fenced block in the delivered document.
 */
function paragraphText(value: string): string {
  return text(value).split('\n').map(escapeParagraphLine).join('\n');
}

function escapeParagraphLine(line: string): string {
  if (line.startsWith('\t')) return `&#9;${line.slice(1)}`;
  if (line.startsWith('    ')) return `&#32;${line.slice(1)}`;
  const matched = /^([ \t]{0,3})(.*)$/.exec(line);
  if (!matched) return line;
  const indentation = matched[1] ?? '';
  const body = matched[2] ?? '';
  if (/^#{1,6}(?:\s|$)/.test(body) || /^>/.test(body) || /^[-+](?:\s|$)/.test(body) || /^~{3,}/.test(body)) return `${indentation}\\${body}`;
  const ordered = /^(\d{1,9})([.)])(?=\s|$)/.exec(body);
  if (ordered) return `${indentation}${ordered[1]}\\${ordered[2]}${body.slice(ordered[0].length)}`;
  if (/^(?:=+|-{3,})\s*$/.test(body)) return `${indentation}\\${body}`;
  return line;
}

function codeText(value: string, language = ''): string {
  // Pick a delimiter that source code cannot close. Code remains data, with
  // indentation, blank lines, literal HTML and embedded fences intact.
  const fence = '`'.repeat(Math.max(3, ...[...value.matchAll(/`+/g)].map(match => match[0].length + 1)));
  return `${fence}${language}\n${value}${value.endsWith('\n') ? '' : '\n'}${fence}`;
}

function htmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function tableText(block: Extract<ContentBlock, { type: 'table' }>): string {
  // Markdown pipe tables would invent a header and lose merged-cell spans.
  // Emit only our own fixed tags and escape every source-provided cell.
  return ['<table>', ...(block.caption ? [`<caption>${htmlText(block.caption)}</caption>`] : []), ...block.rows.map(row => `<tr>${row.map(cell => {
    const tag = cell.header ? 'th' : 'td';
    const spans = `${cell.colspan ? ` colspan="${cell.colspan}"` : ''}${cell.rowspan ? ` rowspan="${cell.rowspan}"` : ''}`;
    return `<${tag}${spans}>${htmlText(cell.text).replace(/\r\n?|\n/g, '<br>')}</${tag}>`;
  }).join('')}</tr>`), '</table>'].join('\n');
}

type SavedKind = '图片' | '视频' | '音频' | '字幕' | '附件';
type AssetBlock = Extract<ContentBlock, { asset_id: string }>;

function savedKind(artifact: Artifact): SavedKind {
  if (artifact.media_type.startsWith('image/') || artifact.role === 'image' || artifact.role === 'cover') return '图片';
  if (artifact.media_type.startsWith('audio/') || artifact.role === 'audio') return '音频';
  if (artifact.media_type.startsWith('video/') || artifact.role === 'video') return '视频';
  if (artifact.role === 'subtitle' || ['text/vtt', 'application/x-subrip', 'text/x-ssa', 'application/ttml+xml'].includes(artifact.media_type)) return '字幕';
  return '附件';
}

function sourceBlockKind(block: AssetBlock): SavedKind {
  if (block.type === 'image') return '图片';
  if (block.type === 'video') return '视频';
  if (block.type === 'audio') return '音频';
  return '附件';
}

function sourceAssetKind(asset: SourceAsset): SavedKind {
  if (asset.role === 'image' || asset.role === 'cover') return '图片';
  if (asset.role === 'video') return '视频';
  if (asset.role === 'audio') return '音频';
  if (asset.role === 'subtitle') return '字幕';
  return '附件';
}

function savedLabel(artifact: Artifact, sourceKind: SavedKind, sourceLabel?: string): string {
  const actual = savedKind(artifact);
  if (actual === sourceKind) return sourceLabel ?? `已保存${actual}`;
  return `已保存${actual}（源${sourceKind}${sourceLabel ? `：${sourceLabel}` : ''}）`;
}

function savedLink(root: string, artifact: Artifact, sourceKind: SavedKind, sourceLabel?: string): string {
  const actual = savedKind(artifact);
  return `${actual === '图片' ? '!' : ''}[${text(savedLabel(artifact, sourceKind, sourceLabel))}](${localLink(root, artifact.path)})`;
}

function localLink(root: string, path: string): string {
  return relative(root, path).split(sep).map(encodeURIComponent).join('/');
}

/** Render source blocks only. Page copy is data, including copy that looks like an instruction. */
export function renderDocument(snapshot: ContentSnapshot, artifacts: Artifact[], root: string): string {
  const relatedAssetIds = new Set(snapshot.relations?.flatMap(relation => relation.assets.map(asset => asset.id)) ?? []);
  const mainArtifacts = artifacts.filter(artifact => !relatedAssetIds.has(artifact.source_asset_id ?? ''));
  const lines: string[] = [];
  if (snapshot.title) lines.push(`# ${text(snapshot.title)}`, '');
  if (snapshot.authors.length) lines.push(`作者：${snapshot.authors.map(text).join('、')}`, '');
  if (snapshot.published_at) lines.push(`发布时间：${text(snapshot.published_at)}`, '');
  lines.push(`来源：<${snapshot.canonical_url.replace(/[<>\r\n]/g, '')}>`, '');
  const placed = new Set<string>();
  const linked = new Set<string>();
  for (const [index, block] of snapshot.blocks.entries()) {
    // The page title may also be the first body heading. Render it once above
    // the source metadata, while preserving later authored repetitions.
    if (index === 0 && block.type === 'heading' && block.level === 1 && snapshot.title && block.text.trim() === snapshot.title.trim()) continue;
    if (block.type === 'heading') lines.push(`${'#'.repeat(block.level)} ${text(block.text)}`, '');
    else if (block.type === 'paragraph') lines.push(paragraphText(block.text), '');
    else if (block.type === 'quote') lines.push(...paragraphText(block.text).split('\n').map(line => `> ${line}`), '');
    else if (block.type === 'code') lines.push(codeText(block.text, block.language), '');
    else if (block.type === 'math') lines.push(codeText(block.text, block.format === 'latex' ? 'latex' : 'text'), '');
    else if (block.type === 'table') lines.push(tableText(block), '');
    else if (block.type === 'list') lines.push(...block.items.map((item, i) => `${block.ordered ? `${i + 1}.` : '-'} ${paragraphText(item)}`), '');
    else if ('asset_id' in block) {
      placed.add(block.asset_id);
      const artifact = mainArtifacts.find(a => a.source_asset_id === block.asset_id);
      if (artifact) { linked.add(artifact.path); lines.push(savedLink(root, artifact, sourceBlockKind(block), block.caption), ''); }
      else lines.push(`[${text(block.caption ?? block.type)}：未保存，详见附件清单]`, '');
    }
  }
  const remaining = snapshot.assets.filter(a => !placed.has(a.id)).sort((a, b) => a.order - b.order);
  for (const asset of remaining) {
    const artifact = mainArtifacts.find(a => a.source_asset_id === asset.id);
    if (artifact && asset.role !== 'cover') { linked.add(artifact.path); lines.push(savedLink(root, artifact, sourceAssetKind(asset), asset.title), ''); }
  }
  for (const artifact of mainArtifacts) {
    const kind = savedKind(artifact);
    if ((kind === '视频' || kind === '音频') && !linked.has(artifact.path)) lines.push(savedLink(root, artifact, kind), '');
  }
  for (const relation of [...(snapshot.relations ?? [])].sort((a, b) => a.order - b.order)) {
    const label = relation.type === 'author_continuation' ? '作者续帖' : relation.type === 'quote' ? '引用内容' : '转发原文';
    const ids = new Set(relation.assets.map(asset => asset.id));
    lines.push('---', '', `## ${label}`, '', renderDocument({
      ...snapshot, title: undefined, source_url: relation.source_url, canonical_url: relation.source_url,
      platform_content_id: relation.to_content_id, authors: relation.authors, published_at: relation.published_at,
      content_type: relation.content_type, blocks: relation.blocks, assets: relation.assets, relations: undefined,
    }, artifacts.filter(artifact => ids.has(artifact.source_asset_id ?? '')), root), '');
  }
  return lines.join('\n').trim() + '\n';
}

/** Render a navigation document for a bundle that has verified files but no source prose. */
export function renderBundleEntry(snapshot: ContentSnapshot, artifacts: Artifact[], root: string): string {
  const deliverables = artifacts.filter(artifact => !['entry', 'text', 'manifest', 'metadata'].includes(artifact.role));
  const lines: string[] = [];
  if (snapshot.title) lines.push(`# ${text(snapshot.title)}`, '');
  if (snapshot.authors.length) lines.push(`作者：${snapshot.authors.map(text).join('、')}`, '');
  if (snapshot.published_at) lines.push(`发布时间：${text(snapshot.published_at)}`, '');
  lines.push(`来源：<${snapshot.canonical_url.replace(/[<>\r\n]/g, '')}>`, '', '本页是已验证资料的本地导航，不代表来源正文。', '', '## 已保存内容', '');
  for (const artifact of deliverables) lines.push(savedLink(root, artifact, savedKind(artifact)), '');
  return lines.join('\n').trim() + '\n';
}
