import type { AdapterDefinition, CollectRequest, ContentSnapshot, ResultSelection, SaveComponent, SourceAsset } from '../../shared/contracts.js';
import { contentBlockHasText } from '../../shared/content-blocks.js';

const ROLE_COMPONENT: Record<SourceAsset['role'], SaveComponent> = { image: 'images', video: 'video', audio: 'audio', subtitle: 'subtitles', cover: 'cover', file: 'files' };

function availableContent(snapshot: ContentSnapshot) {
  const assets = [...snapshot.assets, ...(snapshot.relations ?? []).flatMap(relation => relation.assets)].filter(asset => asset.availability !== 'not_present');
  const blocks = [...snapshot.blocks, ...(snapshot.relations ?? []).flatMap(relation => relation.blocks)];
  const text = blocks.some(contentBlockHasText);
  return { assets, text };
}

/** Explicit purpose, then confirmed preferences, then the source's main content. */
function preferredComponents(request: CollectRequest): SaveComponent[] {
  const preferences = request.preferences;
  const result: SaveComponent[] = [];
  if (preferences?.audio_format) result.push('audio');
  if (preferences?.video_format || preferences?.video_height) result.push('video');
  if (preferences?.subtitle_languages?.length) result.push('subtitles');
  if (preferences?.image_indices?.length) result.push('images');
  return result;
}

export function requiredResultSelection(request: CollectRequest, snapshot: ContentSnapshot): ResultSelection | undefined {
  if (request.include || (request.save_as && request.save_as !== 'auto') || preferredComponents(request).length || snapshot.content_type !== 'mixed') return;
  const { assets, text } = availableContent(snapshot);
  if (!assets.some(asset => asset.role === 'video') || !assets.some(asset => asset.role === 'audio')) return;
  return {
    reason: 'mixed_content',
    prompt: '这条内容同时包含视频和独立音频，想保存哪种结果？',
    options: [
      { save_as: 'video', label: '保存视频' },
      { save_as: 'audio', label: '保存音频' },
      ...(text ? [{ save_as: 'document' as const, label: '保存图文' }] : []),
      { save_as: 'bundle', label: '完整收集' },
    ],
  };
}

function baseRequestedComponents(request: CollectRequest, snapshot: ContentSnapshot): SaveComponent[] {
  if (request.include) return [...request.include];
  const selected = request.save_as ?? 'auto';
  if (['video', 'audio', 'images', 'subtitles', 'files'].includes(selected)) return [selected as SaveComponent];
  const { assets, text } = availableContent(snapshot);
  if (selected === 'bundle') {
    const result = new Set<SaveComponent>(text ? ['text'] : []);
    for (const asset of assets) result.add(ROLE_COMPONENT[asset.role]);
    if (snapshot.content_type === 'video') result.add('video');
    if (snapshot.content_type === 'audio') result.add('audio');
    if (!result.size) result.add('text');
    return [...result];
  }
  if (selected === 'auto') {
    const preferred = preferredComponents(request);
    if (preferred.length) return preferred;
    if (snapshot.content_type === 'video') return ['video'];
    if (snapshot.content_type === 'audio') return ['audio'];
    if (requiredResultSelection(request, snapshot)) return [];
  }
  const result: SaveComponent[] = [...(text || selected === 'document' ? ['text' as const] : []), ...(assets.some(asset => asset.role === 'image') ? ['images' as const] : [])];
  if (selected === 'auto' && snapshot.content_type === 'mixed') {
    for (const component of ['video', 'audio', 'files'] as const) {
      if (assets.some(asset => ROLE_COMPONENT[asset.role] === component)) result.push(component);
    }
    if (!result.length && assets.some(asset => asset.role === 'subtitle')) result.push('subtitles');
  }
  return result;
}

export function requestedComponents(request: CollectRequest, snapshot: ContentSnapshot, adapter?: Pick<AdapterDefinition, 'required_document_components' | 'document_components_for_url'>): SaveComponent[] {
  const components = baseRequestedComponents(request, snapshot);
  const documentRequested = components.includes('text') || (!request.include && (
    ['document', 'bundle'].includes(request.save_as ?? '')
    || ((!request.save_as || request.save_as === 'auto') && snapshot.content_type === 'article' && !preferredComponents(request).length)
  ));
  const routeComponents = documentRequested && adapter?.document_components_for_url
    ? adapter.document_components_for_url(new URL(snapshot.canonical_url)) : [];
  return documentRequested ? [...new Set([...components, ...(adapter?.required_document_components ?? []), ...routeComponents])] : components;
}
