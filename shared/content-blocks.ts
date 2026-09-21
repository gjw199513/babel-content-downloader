import type { ContentBlock } from './contracts.js';

/** Text may live in a structured technical block without any prose paragraph. */
export function contentBlockHasText(block: ContentBlock): boolean {
  if ('text' in block) return !!block.text.trim();
  if (block.type === 'list') return block.items.some(item => !!item.trim());
  if (block.type === 'table') return block.rows.some(row => row.some(cell => !!cell.text.trim()));
  return false;
}
