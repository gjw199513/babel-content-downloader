import type { SaveComponent, SavePreferences, SourceAsset } from '../../shared/contracts.js';
import { EngineError } from '../engines/process.js';

export function validateSavePreferences(preferences: SavePreferences | undefined, components: SaveComponent[]): void {
  if (!preferences) return;
  const incompatible = (condition: boolean, message: string): void => {
    if (condition) throw new EngineError('PREFERENCE_NOT_APPLICABLE', message);
  };
  incompatible(Boolean(preferences.audio_format) && !components.includes('audio'), '音频格式需要同时请求保存音频');
  incompatible((Boolean(preferences.video_format) || preferences.video_height !== undefined) && !components.includes('video'), '视频格式或画质需要同时请求保存视频');
  incompatible(Boolean(preferences.subtitle_languages?.length) && !components.includes('subtitles'), '字幕语言需要同时请求保存字幕');
  incompatible(Boolean(preferences.image_indices?.length) && !components.includes('images'), '图片序号需要同时请求保存图片');
  incompatible(Boolean(preferences.clip) && !components.some(component => component === 'audio' || component === 'video'), '片段范围仅适用于音频或视频');
  if (preferences.clip && components.includes('subtitles')) throw new EngineError('SUBTITLE_CLIP_UNSUPPORTED', '暂不支持裁切字幕时间轴；未用完整字幕替代片段字幕，可分别保存媒体片段与原字幕');
}

function normalizeSubtitleLanguage(value: string): string { return value.replace(/_/g, '-').toLowerCase(); }

/** A generic language may match a regional variant; a specific variant must match exactly. */
export function subtitleLanguageMatches(actual: string | undefined, requested: string): boolean {
  if (!actual) return false;
  const language = normalizeSubtitleLanguage(actual); const desired = normalizeSubtitleLanguage(requested);
  return language === desired || (!desired.includes('-') && language.startsWith(`${desired}-`));
}

export function selectSubtitleLanguages(assets: SourceAsset[], requested: string[] | undefined): { selected: SourceAsset[]; missing: string[] } {
  const subtitles = assets.filter(asset => asset.role === 'subtitle' && asset.availability !== 'not_present');
  if (!requested?.length) return { selected: subtitles, missing: [] };
  const selected = new Set<SourceAsset>();
  const missing: string[] = [];
  for (const requestedLanguage of requested) {
    const desired = normalizeSubtitleLanguage(requestedLanguage);
    const exact = subtitles.filter(asset => asset.language && normalizeSubtitleLanguage(asset.language) === desired);
    const matches = exact.length ? exact : subtitles.filter(asset => subtitleLanguageMatches(asset.language, requestedLanguage));
    if (!matches.length) missing.push(requestedLanguage);
    for (const asset of matches) selected.add(asset);
  }
  return {
    selected: subtitles.filter(asset => selected.has(asset)),
    missing,
  };
}
