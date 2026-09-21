import type { ContentBlock } from '../../shared/contracts.js';
import type { PageNode, PageReader } from '../types.js';
import { publicReferenceUrl, safeHttpUrl } from './url.js';

const OMIT = new Set(['script', 'style', 'button', 'nav', 'aside', 'noscript']);

export function referenceSuffix(reader: PageReader, node: PageNode): string {
  if (reader.tagName(node) !== 'a' || !reader.text(node).trim()) return '';
  const href = reader.attribute(node, 'href');
  if (!href || href.startsWith('#')) return '';
  const source = safeHttpUrl(href, reader.location);
  if (!source) return '';
  const safe = publicReferenceUrl(source);
  safe.username = ''; safe.password = ''; safe.hash = source.hash;
  return reader.text(node).trim() === safe.href ? '' : ` (${safe.href})`;
}

export function inlineSourceText(reader: PageReader, node: PageNode, excluded: ReadonlySet<PageNode>): string {
  return sourceText(reader, node, excluded, true);
}

function sourceText(reader: PageReader, node: PageNode, excluded: ReadonlySet<PageNode>, references = false): string {
  if (excluded.has(node) || (!reader.isText(node) && (OMIT.has(reader.tagName(node)) || !reader.visible(node)))) return '';
  if (reader.tagName(node) === 'br') return '\n';
  if (isMathNode(reader, node)) return mathBlock(reader, node).text;
  const children = reader.children(node);
  const value = children.length ? children.map(child => sourceText(reader, child, excluded, references)).join('') : reader.rawText?.(node) ?? reader.text(node);
  return value + (references ? referenceSuffix(reader, node) : '');
}

export function codeBlock(reader: PageReader, node: PageNode, excluded: ReadonlySet<PageNode>): Extract<ContentBlock, { type: 'code' }> {
  const code = reader.children(node).find(child => reader.tagName(child) === 'code');
  const classes = `${reader.attribute(node, 'class') ?? ''} ${code ? reader.attribute(code, 'class') ?? '' : ''}`;
  const language = /(?:^|\s)(?:language-|lang-)([A-Za-z0-9_+.-]{1,40})(?=\s|$)/.exec(classes)?.[1];
  return { type: 'code', text: sourceText(reader, code ?? node, excluded).replace(/\r\n?/g, '\n'), ...(language ? { language } : {}) };
}

export function isMathNode(reader: PageReader, node: PageNode): boolean {
  const tag = reader.tagName(node);
  return tag === 'math' || tag === 'mjx-container' || /(?:^|\s)katex(?:-display)?(?:\s|$)/.test(reader.attribute(node, 'class') ?? '');
}

export function mathBlock(reader: PageReader, node: PageNode): Extract<ContentBlock, { type: 'math' }> {
  const source = (part: PageNode): string | undefined => {
    const alt = reader.attribute(part, 'alttext') ?? reader.attribute(part, 'data-tex');
    if (alt) return alt;
    if (reader.tagName(part) === 'annotation' && reader.attribute(part, 'encoding')?.toLowerCase() === 'application/x-tex') {
      return reader.rawText?.(part) ?? reader.text(part);
    }
    for (const child of reader.children(part)) {
      const value = source(child);
      if (value) return value;
    }
    return undefined;
  };
  const latex = source(node);
  // A formula's source annotation is preferable to reading both the visual
  // KaTeX glyphs and its duplicated accessibility MathML tree.
  return { type: 'math', text: latex ?? reader.text(node), format: latex ? 'latex' : 'text' };
}

export function tableBlock(reader: PageReader, node: PageNode, excluded: ReadonlySet<PageNode>): Extract<ContentBlock, { type: 'table' }> {
  const rows: Extract<ContentBlock, { type: 'table' }>['rows'] = [];
  const span = (cell: PageNode, name: string): number | undefined => {
    const value = Number(reader.attribute(cell, name));
    return Number.isInteger(value) && value > 1 && value <= 1000 ? value : undefined;
  };
  const visit = (part: PageNode): void => {
    if (excluded.has(part) || !reader.visible(part)) return;
    const tag = reader.tagName(part);
    if (tag === 'table' && part !== node) return;
    if (tag === 'tr') {
      const cells = reader.children(part).filter(cell => ['td', 'th'].includes(reader.tagName(cell)) && !excluded.has(cell) && reader.visible(cell));
      if (cells.length) rows.push(cells.map(cell => {
        const colspan = span(cell, 'colspan');
        const rowspan = span(cell, 'rowspan');
        const text = sourceText(reader, cell, excluded, true).replace(/\r\n?/g, '\n').trim();
        return { text, header: reader.tagName(cell) === 'th', ...(colspan ? { colspan } : {}), ...(rowspan ? { rowspan } : {}) };
      }));
      return;
    }
    for (const child of reader.children(part)) visit(child);
  };
  visit(node);
  const caption = reader.children(node).find(child => reader.tagName(child) === 'caption' && !excluded.has(child) && reader.visible(child));
  return { type: 'table', rows, ...(caption ? { caption: sourceText(reader, caption, excluded).trim() } : {}) };
}
