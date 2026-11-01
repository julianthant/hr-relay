import { createService } from './service.js';
import { isDuoOrigin, normalizeUsername } from './accounts.js';

const canonicalJson = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

export function createWorkflowWorker(api) {
  let installation;
  let service;
  return Object.freeze({
    async install(input) {
      if (installation) throw new Error('DUO_SESSION_ALREADY_INSTALLED');
      installation = (async () => {
        const session = api.storage.session;
        if (typeof session?.setAccessLevel !== 'function') throw new Error('DUO_SESSION_UNAVAILABLE');
        const persistent = await api.storage.local.get(['duoCredentials', 'autopilotV1']);
        if (Object.keys(persistent).length) throw new Error('DUO_PERSISTENT_CREDENTIAL_REFUSED');
        await session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
        await session.clear();
        if (Object.keys(await session.get(null)).length) throw new Error('DUO_SESSION_UNVERIFIED');
        const storage = {
          get: keys => session.get(keys),
          async set(values) {
            await session.set(values);
            if (canonicalJson(await session.get(Object.keys(values))) !== canonicalJson(values)) throw new Error('DUO_SESSION_UNVERIFIED');
          },
          remove: keys => session.remove(keys),
        };
        const username = normalizeUsername(input.username);
        const short = username.replace(/@ucsd\.edu$/, '');
        const aliases = username.includes('@') && short === username ? [] : [short, `${short}@ucsd.edu`].filter(name => name !== username);
        const started = performance.now();
        const candidate = createService(storage, () => input.nowMs + (performance.now() - started));
        await candidate.initialize({ accounts: [{ username, aliases }], owner: username, credentials: input.credentials });
        await candidate.run('SAVE_SETTINGS', { trustClick: true });
        service = candidate;
      })();
      await installation;
    },
    async receive(message, sender) {
      if (!service || sender.id !== api.runtime.id || !isDuoOrigin(sender.url)
        || sender.origin !== new URL(sender.url).origin) throw new Error('DUO_SESSION_UNAVAILABLE');
      if (message.type === 'DUO_SETTINGS') return service.run('SETTINGS');
      if (message.type !== 'DUO_AUTOPILOT_SIGN' || message.request?.origin !== sender.origin) throw new Error('DUO_REQUEST_REFUSED');
      return service.run('SIGN', message.request, sender);
    },
  });
}

if (typeof chrome !== 'undefined') {
  const worker = createWorkflowWorker(chrome);
  globalThis.relayWorkflow = Object.freeze({ install: input => worker.install(input) });
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!['DUO_AUTOPILOT_SIGN', 'DUO_SETTINGS'].includes(message?.type)) return false;
    worker.receive(message, sender).then(result => sendResponse({ success: true, result }),
      () => sendResponse({ success: false, error: 'DUO_REQUEST_REFUSED' }));
    return true;
  });
}
