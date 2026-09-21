import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { catalogs, detectLanguage, LANGUAGE_KEY, setupInstructions, translate, type Language, type LanguagePreference } from '../../extension/welcome/i18n.js';

const state = { extension_id: 'a'.repeat(32), extension_version: '0.1.26', instance_id: 'browser-test', bridge_url: 'http://127.0.0.1:4318', paired: true, paused: false };
const doms: JSDOM[] = [];
let welcomeBundle: string;
let settingsBundle: string;
let welcomeHtml: string;
let settingsHtml: string;
beforeAll(async () => {
  [welcomeHtml, settingsHtml] = await Promise.all([
    readFile('extension/welcome/index.html', 'utf8'),
    readFile('extension/settings/index.html', 'utf8'),
  ]);
  const [welcomeResult, settingsResult] = await Promise.all([
    build({ entryPoints: ['extension/welcome/index.ts'], bundle: true, write: false, format: 'iife', platform: 'browser' }),
    build({ entryPoints: ['extension/settings/index.ts'], bundle: true, write: false, format: 'iife', platform: 'browser' }),
  ]);
  welcomeBundle = welcomeResult.outputFiles[0]!.text;
  settingsBundle = settingsResult.outputFiles[0]!.text;
});
afterEach(() => { for (const dom of doms.splice(0)) dom.window.close(); });
const settle = () => new Promise(resolve => setTimeout(resolve, 15));
async function page(options: { saved?: unknown; error?: { code: string; message: string }; storageFails?: boolean; clipboardFails?: boolean } = {}, route: 'welcome' | 'settings' = 'welcome') {
  const dom = new JSDOM(route === 'welcome' ? welcomeHtml : settingsHtml, { url: `https://extension.test/${route}/index.html`, runScripts: 'outside-only' });
  doms.push(dom);
  const values: Record<string, unknown> = { [LANGUAGE_KEY]: options.saved, unrelated: 'keep' };
  let copied = '';
  let requests = 0;
  Object.defineProperty(dom.window.navigator, 'languages', { value: ['ja-JP'] });
  Object.defineProperty(dom.window.navigator, 'platform', { value: 'MacIntel' });
  Object.defineProperty(dom.window.navigator, 'clipboard', { value: { writeText: async (text: string) => { if (options.clipboardFails) throw new Error('denied'); copied = text; } } });
  Object.assign(dom.window, { chrome: {
    storage: { local: {
      get: async () => values,
      set: async (update: Record<string, unknown>) => { if (options.storageFails) throw new Error('storage'); Object.assign(values, update); },
    } },
    runtime: { sendMessage: (_request: unknown, callback: (response: unknown) => void) => { requests++; callback({ ok: true, state: { ...state, ...(options.error ? { error: options.error } : {}) } }); } },
  } });
  dom.window.eval(route === 'welcome' ? welcomeBundle : settingsBundle);
  await settle();
  return { dom, values, copied: () => copied, requests: () => requests };
}
function select(dom: JSDOM, language: LanguagePreference) {
  const element = dom.window.document.querySelector<HTMLSelectElement>('#language')!;
  element.value = language;
  element.dispatchEvent(new dom.window.Event('change'));
}

describe('localized extension', () => {
  it('resolves browser language families and falls back to English', () => {
    for (const tag of ['zh-TW', 'zh-HK', 'zh-MO', 'zh-Hant', 'zh-Hant-CN', 'zh_HK']) expect(detectLanguage([tag])).toBe('zh-TW');
    for (const tag of ['zh', 'zh-CN', 'zh-SG', 'zh-Hans-TW']) expect(detectLanguage([tag])).toBe('zh-CN');
    expect(detectLanguage(['de-DE', 'ko-KR'])).toBe('ko');
    expect(detectLanguage(['ja-JP'])).toBe('ja');
    expect(detectLanguage(['en-GB'])).toBe('en');
    expect(detectLanguage(['fr-FR'])).toBe('en');
    expect(detectLanguage([])).toBe('en');
  });
  it('all catalogs preserve keys, substitutions, brand and runnable setup syntax', () => {
    for (const [language, catalog] of Object.entries(catalogs)) {
      expect(Object.keys(catalog).sort()).toEqual(Object.keys(catalogs.en).sort());
      for (const [key, entry] of Object.entries(catalog)) {
        expect(entry.message.trim().length).toBeGreaterThan(0);
        expect(entry.message.match(/\{\w+\}/g) ?? []).toEqual(catalogs.en[key as keyof typeof catalogs.en].message.match(/\{\w+\}/g) ?? []);
      }
      expect(catalog.pageTitle.message).toContain('Babel Content Downloader');
      expect(catalog.manifestDescription.message.length).toBeLessThanOrEqual(132);
      const instructions = setupInstructions(language as Language, state, 'claude', 'MacIntel');
      expect(instructions).toContain(`allow-extension ${state.extension_id}`);
      expect(instructions).toContain('add-client claude "/absolute/path/to/authorized/materials"');
      expect(instructions).not.toMatch(/\{client\}|\{platform\}/);
      expect(setupInstructions(language as Language, state, 'codex', 'Linux')).not.toContain('node dist/bootstrap/cli.js runtime-install');
    }
  });
  it('uses saved language, switches every visible section, and persists without pairing mutations', async () => {
    const p = await page({ saved: 'en' });
    expect(p.dom.window.document.documentElement.lang).toBe('en');
    for (const language of Object.keys(catalogs) as Language[]) {
      select(p.dom, language);
      await settle();
      expect(p.dom.window.document.documentElement.lang).toBe(language);
      expect(p.dom.window.document.title).toBe(translate(language, 'pageTitle'));
      expect(p.dom.window.document.querySelector('h1')!.textContent).toBe(translate(language, 'heading'));
      expect(p.dom.window.document.querySelector('#connection-status')!.textContent).toBe(translate(language, 'paired'));
      expect(p.dom.window.document.querySelector('[data-i18n="stepAskTitle"]')!.textContent).toBe(translate(language, 'stepAskTitle'));
      expect(p.dom.window.document.querySelector('[data-i18n="usageAudio"]')!.textContent).toBe(translate(language, 'usageAudio'));
      expect(p.values[LANGUAGE_KEY]).toBe(language);
    }
    expect(p.values.unrelated).toBe('keep');
    expect(p.requests()).toBe(1);
    const reopened = await page({ saved: p.values[LANGUAGE_KEY] });
    expect(reopened.dom.window.document.documentElement.lang).toBe('ko');
  });
  it('defaults to browser-following mode, persists it, and falls back to English when unsupported', async () => {
    const p = await page();
    expect(p.dom.window.document.documentElement.lang).toBe('ja');
    expect(p.dom.window.document.querySelector<HTMLSelectElement>('#language')!.value).toBe('auto');
    select(p.dom, 'en');
    await settle();
    select(p.dom, 'auto');
    await settle();
    expect(p.values[LANGUAGE_KEY]).toBe('auto');
    expect(p.dom.window.document.documentElement.lang).toBe('ja');
    expect(p.dom.window.document.querySelector<HTMLSelectElement>('#language')!.value).toBe('auto');
    expect(detectLanguage(['de-DE'])).toBe('en');
  });
  it('uses browser language for invalid preferences and copies the selected client instructions', async () => {
    const p = await page({ saved: 'invalid' }, 'settings');
    expect(p.dom.window.document.documentElement.lang).toBe('ja');
    expect(p.dom.window.document.querySelector<HTMLSelectElement>('#language')!.value).toBe('auto');
    expect(p.dom.window.document.title).toBe(translate('ja', 'settingsPageTitle'));
    const client = p.dom.window.document.querySelector<HTMLSelectElement>('#setup-client')!;
    client.value = 'claude'; client.dispatchEvent(new p.dom.window.Event('change'));
    p.dom.window.document.querySelector<HTMLButtonElement>('#copy-setup')!.click();
    await settle();
    expect(p.copied()).toContain('install-client-config claude');
    expect(p.copied()).toContain(translate('ja', 'installSteps'));
    expect(p.dom.window.document.querySelector('#copy-setup')!.textContent).toBe(translate('ja', 'copied'));
  });
  it('keeps localized error guidance and original diagnostics separate across language changes', async () => {
    const p = await page({ error: { code: 'BRIDGE_UNREACHABLE', message: 'Original technical diagnostic' } });
    expect(p.dom.window.document.querySelector('#connection-status')!.textContent).toBe(translate('ja', 'connectionError'));
    expect(p.dom.window.document.querySelector('#status-panel')!.getAttribute('data-state')).toBe('error');
    expect(p.dom.window.document.querySelector<HTMLButtonElement>('#connect')!.hidden).toBe(false);
    select(p.dom, 'ko');
    expect(p.dom.window.document.querySelector('#connection-detail')!.textContent).toContain(translate('ko', 'unreachable'));
    expect(p.dom.window.document.querySelector('#connection-detail')!.textContent).not.toContain('Original technical diagnostic');
    expect(p.dom.window.document.querySelector('#raw-error')!.textContent).toContain('Original technical diagnostic');
    const settings = await page({ error: { code: 'BRIDGE_UNREACHABLE', message: 'Original technical diagnostic' } }, 'settings');
    expect(settings.dom.window.document.querySelector('#connection-status')!.textContent).toBe(translate('ja', 'connectionError'));
    expect(settings.dom.window.document.querySelector('#status-panel')!.getAttribute('data-state')).toBe('error');
    expect(settings.dom.window.document.querySelector<HTMLButtonElement>('#connect')!.hidden).toBe(false);
    expect(settings.dom.window.document.querySelector<HTMLButtonElement>('#pause')!.hidden).toBe(true);
    expect(settings.dom.window.document.querySelector<HTMLButtonElement>('#revoke')!.hidden).toBe(false);
  });
  it('handles rapid choices, storage failure and denied clipboard without resetting the interface', async () => {
    const p = await page({ storageFails: true });
    select(p.dom, 'en'); select(p.dom, 'zh-TW');
    await settle();
    expect(p.dom.window.document.documentElement.lang).toBe('zh-TW');
    expect(p.dom.window.document.querySelector('#notice')!.textContent).toBe(translate('zh-TW', 'saveFailed'));
    const settings = await page({ clipboardFails: true }, 'settings');
    settings.dom.window.document.querySelector<HTMLButtonElement>('#copy-setup')!.click();
    await settle();
    expect(settings.dom.window.document.querySelector('#notice')!.textContent).toBe(translate('ja', 'copyFailed'));
  });
  it('keeps the overview focused and moves low-frequency controls to settings', async () => {
    const overview = await page({ saved: 'en' });
    expect(overview.dom.window.document.querySelector('#setup-copy')).toBeNull();
    expect(overview.dom.window.document.querySelector('#revoke')).toBeNull();
    expect(overview.dom.window.document.querySelector('a[href="../settings/index.html"]')).not.toBeNull();
    expect(overview.dom.window.document.querySelector<HTMLDetailsElement>('.technical-details')!.open).toBe(false);
    const settings = await page({ saved: 'en' }, 'settings');
    expect(settings.dom.window.document.querySelector('#setup-copy')!.textContent).toContain(translate('en', 'installSteps'));
    expect(settings.dom.window.document.querySelector('#revoke')).not.toBeNull();
    expect(settings.dom.window.document.querySelector('a[href="../welcome/index.html"]')).not.toBeNull();
    const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8')) as { options_page: string };
    expect(manifest.options_page).toBe('settings/index.html');
  });
});
