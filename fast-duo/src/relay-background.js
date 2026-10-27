import { createService } from './service.js';
import { isDuoOrigin } from './accounts.js';

export function createRelayWorker(api) {
  let installed;
  let service;
  let pending;
  let waiter;
  let stopped = false;
  const requests = [];
  const replies = new Map();
  const call = (kind, data) => new Promise((resolve, reject) => {
    if (stopped) { reject(new Error('ONBOARDING_DUO_REVOKED')); return; }
    const request = { id: crypto.randomUUID(), kind, data };
    replies.set(request.id, { resolve, reject });
    if (waiter) { const receive = waiter; waiter = undefined; receive(request); }
    else requests.push(request);
  });
  const requireCurrent = () => {
    if (!installed || stopped) throw new Error('ONBOARDING_DUO_REVOKED');
  };
  async function receive(message, sender) {
    requireCurrent();
    if (sender.id !== api.runtime.id || !isDuoOrigin(sender.url) || !Number.isInteger(sender.tab?.id) || sender.frameId !== 0) throw new Error('ONBOARDING_DUO_SCOPE');
    const tab = await api.tabs.get(sender.tab.id);
    if (tab.id !== sender.tab.id || new URL(tab.url).origin !== new URL(sender.url).origin) throw new Error('ONBOARDING_DUO_SCOPE');
    const data = message.request;
    if (!data || data.origin !== new URL(sender.url).origin || data.rpId !== 'duosecurity.com') throw new Error('ONBOARDING_DUO_SCOPE');
    if (message.type === 'RELAY_CAPABILITIES') return { softwareKey: installed.method === 'key' };
    if (message.type === 'DUO_SETTINGS') return { enabled: false, trustClick: false, toast: false };
    if (message.type === 'DUO_AUTOPILOT_SIGN') {
      if (installed.method === 'touch' || !pending) return { passThrough: true };
      if (tab.id !== pending.tabId || data.origin !== pending.origin) throw new Error('ONBOARDING_DUO_SCOPE');
      return service.run('SIGN', data, sender);
    }
    if (message.type === 'DUO_AUTOPILOT_ENROLL') {
      if (pending) throw new Error('ONBOARDING_DUO_ALREADY_STARTED');
      const binding = await call('bind', { tabId: tab.id, origin: data.origin, rpId: data.rpId, username: data.username });
      requireCurrent();
      pending = { tabId: tab.id, origin: data.origin, requestId: data.requestId };
      if (installed.method === 'touch') {
        if (data.authenticatorAttachment !== 'platform') throw new Error('ONBOARDING_DUO_NATIVE_REQUIRED');
        return { native: true, requestId: data.requestId };
      }
      if (data.authenticatorAttachment === 'platform') throw new Error('ONBOARDING_DUO_KEY_REQUIRED');
      await service.run('SAVE_ACCOUNT', { id: binding.accountId, username: data.username, enabled: true });
      await service.run('ARM', { accountId: binding.accountId, tabId: tab.id, tabUrl: tab.url, transport: 'usb' });
      const result = await service.run('ENROLL', data, sender);
      if (!result.ok) throw new Error('ONBOARDING_DUO_ENROLL_REFUSED');
      pending.credentialId = result.credentialId;
      return result;
    }
    if (!pending || pending.tabId !== tab.id || pending.origin !== data.origin || pending.requestId !== data.requestId) throw new Error('ONBOARDING_DUO_SCOPE');
    if (message.type === 'RELAY_NATIVE_CREATED') {
      if (installed.method !== 'touch' || data.attachment !== 'platform' || pending.credentialId) throw new Error('ONBOARDING_DUO_NATIVE_REQUIRED');
      await call('native-created', { credentialId: data.credentialId, requestId: data.requestId });
      pending.credentialId = data.credentialId;
      return { observed: true };
    }
    if (message.type === 'RELAY_PORTAL_ACCEPTED') {
      if (pending.accepted) return { observed: true };
      if (!pending.credentialId) throw new Error('ONBOARDING_DUO_SCOPE');
      await call('portal-accepted', { credentialId: pending.credentialId, requestId: pending.requestId });
      pending.accepted = true;
      return { observed: true };
    }
    throw new Error('ONBOARDING_DUO_REQUEST');
  }
  return Object.freeze({
    async install(input) {
      if (installed || stopped || !['key', 'touch'].includes(input.method)) throw new Error('ONBOARDING_DUO_REVOKED');
      const session = api.storage.session;
      if (typeof session?.setAccessLevel !== 'function') throw new Error('ONBOARDING_DUO_SESSION_UNAVAILABLE');
      await session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
      installed = Object.freeze({ method: input.method });
      const started = performance.now();
      const verifiedSession = {
        get: keys => session.get(keys),
        async set(values) {
          await session.set(values);
          const stored = await session.get(Object.keys(values));
          if (JSON.stringify(stored) !== JSON.stringify(values)) throw new Error('ONBOARDING_DUO_SESSION_UNAVAILABLE');
        },
        remove: keys => session.remove(keys),
      };
      service = createService(verifiedSession, () => input.nowMs + (performance.now() - started), {
        reserveSignCount: (credentialId, requestId) => call('reserve', { credentialId, requestId }).then(result => result.count),
        persistPending: credential => call('persist', credential),
        recordCeremony: (credentialId, requestId) => call('software-created', { credentialId, requestId }),
        exactCredentialRequested: (credentialId, requestId) => call('exact-request', { credentialId, requestId }),
      });
      await service.initialize({});
    },
    next() {
      requireCurrent();
      if (requests.length) return Promise.resolve(requests.shift());
      if (waiter) throw new Error('ONBOARDING_DUO_BROKER_BUSY');
      return new Promise(resolve => { waiter = resolve; });
    },
    reply(id, result) {
      requireCurrent();
      const reply = replies.get(id);
      if (!reply) throw new Error('ONBOARDING_DUO_REQUEST');
      replies.delete(id);
      if (result.ok) reply.resolve(result.value);
      else reply.reject(new Error('ONBOARDING_DUO_REFUSED'));
    },
    async stop() {
      stopped = true;
      for (const reply of replies.values()) reply.reject(new Error('ONBOARDING_DUO_REVOKED'));
      replies.clear(); requests.length = 0;
      if (waiter) { waiter(null); waiter = undefined; }
      await api.storage.session.clear();
    },
    receive,
  });
}

if (typeof chrome !== 'undefined') {
  const relay = createRelayWorker(chrome);
  globalThis.relayOnboarding = relay;
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    relay.receive(message, sender).then(result => sendResponse({ success: true, result }),
      () => sendResponse({ success: false, error: 'ONBOARDING_DUO_REFUSED' }));
    return true;
  });
}
