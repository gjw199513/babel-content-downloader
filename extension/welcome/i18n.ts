import en from '../_locales/en/messages.json' with { type: 'json' };
import zhCN from '../_locales/zh_CN/messages.json' with { type: 'json' };
import zhTW from '../_locales/zh_TW/messages.json' with { type: 'json' };
import ja from '../_locales/ja/messages.json' with { type: 'json' };
import ko from '../_locales/ko/messages.json' with { type: 'json' };

export const catalogs = { en, 'zh-CN': zhCN, 'zh-TW': zhTW, ja, ko };
export type Language = keyof typeof catalogs;
export type LanguagePreference = Language | 'auto';
export type MessageKey = keyof typeof en;
export const LANGUAGE_KEY = 'babel_content_downloader.ui_language.v1';
export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(catalogs, value);
}
export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === 'auto' || isLanguage(value);
}
export function detectLanguage(languages: readonly string[]): Language {
  for (const language of languages) {
    const tag = language.toLowerCase().replaceAll('_', '-');
    if (tag === 'zh' || tag.startsWith('zh-')) {
      if (tag.includes('hant')) return 'zh-TW';
      if (tag.includes('hans')) return 'zh-CN';
      return /(?:^|-)(tw|hk|mo)(?:-|$)/.test(tag) ? 'zh-TW' : 'zh-CN';
    }
    const base = tag.split('-')[0];
    if (base === 'en' || base === 'ja' || base === 'ko') return base;
  }
  return 'en';
}
export function translate(language: Language, key: MessageKey, parameters: Record<string, string> = {}): string {
  const message = catalogs[language][key]?.message ?? en[key].message;
  return message.replace(/\{(\w+)\}/g, (token, name: string) => parameters[name] ?? token);
}
export function errorMessageKey(code: string | undefined): MessageKey {
  if (code === 'BRIDGE_UNREACHABLE') return 'unreachable';
  if (['PAIRING_NEEDED', 'BRIDGE_UNPAIRED', 'UNAUTHORIZED', 'SESSION_UNAUTHORIZED', 'SESSION_EXPIRED'].includes(code ?? '')) return 'unauthorized';
  if (code === 'BRIDGE_PROTOCOL_INVALID') return 'protocol';
  return 'errorGeneric';
}
export function setupInstructions(language: Language, state: { extension_id: string; extension_version: string; bridge_url: string }, client: 'codex' | 'claude', platform: string): string {
  const t = (key: MessageKey, parameters?: Record<string, string>) => translate(language, key, parameters);
  const identity = [t('pageTitle'), `${t('extensionId')}: ${state.extension_id}`, `${t('version')}: ${state.extension_version}`, `${t('bridge')}: ${state.bridge_url}`, `${t('client')}: ${client === 'claude' ? 'Claude Code' : 'Codex'}`, '', t('prerequisite'), ''];
  if (!platform.toLowerCase().includes('mac')) return [...identity, t('unsupported', { platform: platform || t('unknownPlatform') }), t('unsupportedAdvice'), t('secretInstruction')].join('\n');
  return [...identity, t('installSteps'), 'node dist/bootstrap/cli.js init', `node dist/bootstrap/cli.js allow-extension ${state.extension_id}`, `node dist/bootstrap/cli.js add-client ${client} "${t('outputPlaceholder')}"`, 'node dist/bootstrap/cli.js runtime-install', 'node dist/bootstrap/cli.js runtime-status', '', t('readyInstruction'), `node dist/bootstrap/cli.js install-client-config ${client}`, '', t('reloadInstruction', { client: client === 'claude' ? 'Claude Code' : 'Codex' }), t('conflictInstruction'), t('secretInstruction')].join('\n');
}
