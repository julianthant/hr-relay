import { createService } from './service.js';
import { isDuoOrigin } from './accounts.js';
import { preparePrivateStorage } from './private-storage.js';

let service;
const stateEvents = new BroadcastChannel('duo-autopilot-state');
const ready = (async () => {
  const storage = await preparePrivateStorage(chrome);
  service = createService(storage);
  const response = await fetch(chrome.runtime.getURL('bootstrap.json'));
  if (!response.ok) throw new Error('Missing bootstrap configuration. Reinstall the extension package.');
  const bootstrap = await response.json();
  // Only the personal folder specifies a credential file. The shareable build does not.
  if (bootstrap.credentialFile) {
    const existing = await storage.get('autopilotV1');
    if (!existing.autopilotV1) {
      if (bootstrap.credentialFile !== 'credentials/duo-webauthn.json') throw new Error('Unexpected credential file.');
      const credentials = await fetch(chrome.runtime.getURL(bootstrap.credentialFile));
      if (!credentials.ok) throw new Error('The personal credential file is missing.');
      const parsed = await credentials.json();
      bootstrap.credentials = Array.isArray(parsed) ? parsed : parsed.credentials;
    }
  }
  await service.initialize(bootstrap);
})();
// Keep a rejected startup observable through the UI without an unhandled rejection.
ready.catch(() => {});

const pages = ['src/options.html', 'src/popup.html'].map(path => chrome.runtime.getURL(path));
const uiTypes = new Set(['STATE', 'SAVE_ACCOUNT', 'SAVE_ALIASES', 'TOGGLE_ACCOUNT', 'REMOVE_ACCOUNT', 'SAVE_SETTINGS', 'IMPORT', 'LINK_LEGACY', 'ARM', 'CANCEL', 'CONFIRM', 'DISCARD_PENDING']);
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const fromUI = sender.id === chrome.runtime.id && pages.includes(sender.url);
  const fromDuo = sender.id === chrome.runtime.id && isDuoOrigin(sender.url);
  const type = message?.type;
  if (!(fromUI && (uiTypes.has(type) || type === 'DUO_TABS')) && !(fromDuo && ['DUO_AUTOPILOT_SIGN', 'DUO_AUTOPILOT_ENROLL', 'DUO_SETTINGS'].includes(type))) return false;
  (async () => {
    await ready;
    // Safari refuses a URL-filtered query until the site is granted, and never asks. An unfiltered query asks for the Duo site, then includes its URL.
    if (type === 'DUO_TABS') return (await chrome.tabs.query({})).filter(tab => isDuoOrigin(tab.url)).map(tab => ({ id: tab.id, title: tab.title || 'Duo', url: tab.url }));
    const data = message.data || message.request || {};
    if (type === 'ARM') {
      const tab = await chrome.tabs.get(data.tabId);
      data.tabUrl = tab.url; // Bind to browser-observed state, not a UI-supplied URL.
    }
    const mapped = { DUO_AUTOPILOT_SIGN: 'SIGN', DUO_AUTOPILOT_ENROLL: 'ENROLL', DUO_SETTINGS: 'SETTINGS' }[type] || type;
    const result = await service.run(mapped, data, sender);
    if (!['STATE', 'SETTINGS'].includes(mapped)) stateEvents.postMessage({ type: 'STATE_CHANGED' });
    return result;
  })().then(result => sendResponse({ success: true, result })).catch(error => sendResponse({ success: false, error: error.name === 'Error' ? error.message : 'The request could not complete. Check the account details or reload the extension.' }));
  return true;
});
chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === 'install') void chrome.runtime.openOptionsPage();
});
