import { EXTENSION_CHANNEL, type UiRequest, type UiResponse } from '../bridge-messages.js';
import { detectLanguage, errorMessageKey, isLanguagePreference, LANGUAGE_KEY, translate, type Language, type LanguagePreference, type MessageKey } from './i18n.js';

type UiState = NonNullable<UiResponse['state']>;

function element<T extends Element>(selector: string): T {
  const result = document.querySelector<T>(selector);
  if (!result) throw new Error(`Missing welcome element: ${selector}`);
  return result;
}

const statusPanel = element<HTMLElement>('#status-panel');
const status = element<HTMLElement>('#connection-status');
const detail = element<HTMLElement>('#connection-detail');
const connect = element<HTMLButtonElement>('#connect');
const languageSelect = element<HTMLSelectElement>('#language');
const notice = element<HTMLElement>('#notice');
const errorDetails = element<HTMLDetailsElement>('#error-details');
const rawError = element<HTMLElement>('#raw-error');
const browserLanguages = () => navigator.languages?.length ? navigator.languages : [navigator.language];

let preference: LanguagePreference = 'auto';
let language: Language = detectLanguage(browserLanguages());
let lastState: UiState | undefined;
let currentError: { code?: string; message: string } | undefined;
let noticeKey: MessageKey | undefined;
let failureKey: MessageKey | undefined;
const t = (key: MessageKey) => translate(language, key);

function render(): void {
  document.documentElement.lang = language;
  document.title = t('pageTitle');
  languageSelect.value = preference;
  for (const node of document.querySelectorAll<HTMLElement>('[data-i18n]')) node.textContent = t(node.dataset.i18n as MessageKey);
  notice.textContent = noticeKey ? t(noticeKey) : '';
  notice.hidden = !noticeKey;

  const error = currentError ?? lastState?.error;
  const hasConnectionError = !!error && error.code !== 'PAIRING_NEEDED';

  if (lastState) {
    element<HTMLElement>('#extension-id').textContent = lastState.extension_id;
    element<HTMLElement>('#extension-version').textContent = lastState.extension_version;
    element<HTMLElement>('#bridge-url').textContent = lastState.bridge_url;
    const stateKey: MessageKey = hasConnectionError ? 'connectionError' : lastState.paired ? lastState.paused ? 'paused' : 'paired' : 'waiting';
    status.textContent = t(stateKey);
    detail.textContent = t(hasConnectionError ? 'connectionErrorDetail' : stateKey === 'paused' ? 'pausedDetail' : stateKey === 'paired' ? 'pairedDetail' : lastState.error?.code === 'PAIRING_NEEDED' ? 'pairingNeeded' : 'waitingDetail');
    statusPanel.dataset.state = hasConnectionError ? 'error' : stateKey;
    connect.hidden = !!lastState.paired && !hasConnectionError;
  } else {
    status.textContent = t('loading');
    detail.textContent = '';
    statusPanel.dataset.state = 'loading';
    connect.hidden = false;
  }

  if (failureKey) {
    status.textContent = t(failureKey);
    statusPanel.dataset.state = 'error';
  }
  if (error && error.code !== 'PAIRING_NEEDED') detail.textContent = `${detail.textContent} ${t(errorMessageKey(error.code))}${error.code ? ` (${error.code})` : ''}`.trim();
  errorDetails.hidden = !error;
  rawError.textContent = error ? `${error.code ?? ''}${error.code ? ': ' : ''}${error.message}` : '';
}

function chromeMessage(type: UiRequest['type']): Promise<UiResponse> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ channel: EXTENSION_CHANNEL, type }, response => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else if (!response) reject(new Error(t('missingState')));
      else resolve(response as UiResponse);
    });
  });
}

async function refresh(): Promise<void> {
  const response = await chromeMessage('get_state');
  if (!response.state) throw new Error(response.error?.message ?? t('missingState'));
  lastState = response.state;
  render();
}

async function connectRuntime(): Promise<void> {
  connect.disabled = true;
  currentError = undefined;
  failureKey = undefined;
  try {
    const response = await chromeMessage('connect');
    if (response.state) lastState = response.state;
    if (!response.ok) {
      failureKey = 'controlFailed';
      currentError = response.error ?? response.state?.error ?? { message: t('errorGeneric') };
    }
  } catch (error) {
    failureKey = 'controlFailed';
    currentError = { message: error instanceof Error ? error.message : String(error) };
  } finally {
    connect.disabled = false;
    render();
  }
}

let saveLanguage = Promise.resolve();
languageSelect.addEventListener('change', () => {
  if (!isLanguagePreference(languageSelect.value)) return;
  preference = languageSelect.value;
  language = preference === 'auto' ? detectLanguage(browserLanguages()) : preference;
  noticeKey = undefined;
  render();
  const selected = preference;
  saveLanguage = saveLanguage.then(() => chrome.storage.local.set({ [LANGUAGE_KEY]: selected })).catch(() => {
    if (preference === selected) { noticeKey = 'saveFailed'; render(); }
  });
});

connect.addEventListener('click', () => { void connectRuntime(); });

async function initialize(): Promise<void> {
  languageSelect.disabled = true;
  render();
  try {
    const stored = await chrome.storage.local.get(LANGUAGE_KEY);
    if (isLanguagePreference(stored[LANGUAGE_KEY])) preference = stored[LANGUAGE_KEY];
    language = preference === 'auto' ? detectLanguage(browserLanguages()) : preference;
  } catch { /* Browser language remains usable if preference storage is unavailable. */ }
  languageSelect.disabled = false;
  render();
  try { await refresh(); }
  catch (error) {
    failureKey = 'readFailed';
    currentError = { message: error instanceof Error ? error.message : String(error) };
    render();
  }
}

void initialize();
