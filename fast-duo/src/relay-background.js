import { createService } from './service.js';
import { isDuoOrigin, normalizeUsername } from './accounts.js';

const accountKey = name => normalizeUsername(name).replace(/^([^@]+)@ucsd\.edu$/, '$1');
export function createRelayWorker(api) {
  let installed;
  let service;
  let pending;
  let waiter;
  let stopped = false;
  let invalidated = false;
  let failureReport;
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
    if (!installed || stopped || invalidated) throw new Error('ONBOARDING_DUO_REVOKED');
  };
  function requireSender(sender) {
    requireCurrent();
    if (sender.id !== api.runtime.id || !isDuoOrigin(sender.url) || sender.origin !== new URL(sender.url).origin
      || !Number.isInteger(sender.tab?.id) || sender.frameId !== 0 || sender.documentLifecycle !== 'active'
      || typeof sender.documentId !== 'string' || !/^[\da-f]{32}$/i.test(sender.documentId)) throw new Error('ONBOARDING_DUO_SCOPE');
  }
  async function documentObservation(tabId, documentId) {
    try { return await api.tabs.sendMessage(tabId, { type: 'RELAY_OBSERVE' }, { documentId }); }
    catch (cause) { throw new Error('ONBOARDING_DUO_SCOPE', { cause }); }
  }
  async function observe(sender) {
    requireSender(sender);
    const tab = await api.tabs.get(sender.tab.id);
    requireCurrent();
    if (tab.id !== sender.tab.id || tab.url !== sender.url) throw new Error('ONBOARDING_DUO_SCOPE');
    const observed = await documentObservation(tab.id, sender.documentId);
    requireCurrent();
    const after = await api.tabs.get(tab.id);
    if (after.url !== tab.url || observed?.url !== tab.url || observed.origin !== sender.origin
      || observed.documentActive !== true || !Number.isSafeInteger(observed.accountRevision) || observed.accountRevision < 0
      || !Array.isArray(observed.accountNames) || observed.accountNames.length !== 1
      || typeof observed.accountNames[0] !== 'string' || !/^[a-z0-9][a-z0-9._@+-]{0,127}$/i.test(observed.accountNames[0])) throw new Error('ONBOARDING_DUO_SCOPE');
    const confirmed = await documentObservation(tab.id, sender.documentId);
    requireCurrent();
    if (JSON.stringify(confirmed) !== JSON.stringify(observed)) throw new Error('ONBOARDING_DUO_SCOPE');
    return { documentId: sender.documentId, tabId: tab.id, url: tab.url, origin: observed.origin,
      accountName: normalizeUsername(observed.accountNames[0]), accountRevision: observed.accountRevision };
  }
  async function assertScope() {
    if (!pending) throw new Error('ONBOARDING_DUO_SCOPE');
    const actual = await observe(pending.sender);
    for (const key of ['documentId', 'tabId', 'url', 'origin', 'accountName', 'accountRevision']) {
      if (actual[key] !== pending.scope[key]) throw new Error('ONBOARDING_DUO_SCOPE');
    }
    requireCurrent();
  }
  async function checked(operation) {
    try {
      await assertScope();
      const result = await operation();
      await assertScope();
      return result;
    } catch (error) {
      if (!stopped && pending) {
        failureReport ||= call('scope-lost', { requestId: pending.requestId });
        try { await failureReport; } catch { /* A refused failure ACK remains unknown. */ }
        invalidated = true;
      }
      throw error;
    }
  }
  async function receive(message, sender) {
    requireSender(sender);
    const data = message.request;
    if (!data || data.origin !== sender.origin || data.rpId !== 'duosecurity.com') throw new Error('ONBOARDING_DUO_SCOPE');
    if (message.type === 'RELAY_CAPABILITIES') return { softwareKey: installed.method === 'key' };
    if (message.type === 'DUO_AUTOPILOT_SIGN' && (installed.method === 'touch' || !pending)) return { passThrough: true };
    if (message.type === 'DUO_AUTOPILOT_ENROLL') {
      if (pending) throw new Error('ONBOARDING_DUO_ALREADY_STARTED');
      const scope = await observe(sender);
      if (typeof data.username !== 'string' || accountKey(data.username) !== accountKey(scope.accountName)) throw new Error('ONBOARDING_DUO_SCOPE');
      pending = { scope, sender, requestId: data.requestId };
      const binding = await checked(() => call('bind', { documentId: scope.documentId, tabId: scope.tabId,
        origin: scope.origin, rpId: data.rpId, username: scope.accountName }));
      if (installed.method === 'touch') {
        if (data.authenticatorAttachment !== 'platform') throw new Error('ONBOARDING_DUO_NATIVE_REQUIRED');
        await assertScope();
        return { native: true, requestId: data.requestId };
      }
      if (data.authenticatorAttachment === 'platform') throw new Error('ONBOARDING_DUO_KEY_REQUIRED');
      const aliases = data.username === scope.accountName ? [] : [data.username];
      await checked(() => service.run('SAVE_ACCOUNT', { id: binding.accountId, username: scope.accountName, aliases, enabled: true }));
      await checked(() => service.run('ARM', { accountId: binding.accountId, tabId: scope.tabId, tabUrl: scope.url, transport: 'usb' }));
      const result = await checked(() => service.run('ENROLL', data, sender));
      if (!result.ok) throw new Error('ONBOARDING_DUO_ENROLL_REFUSED');
      pending.credentialId = result.credentialId;
      await assertScope();
      return result;
    }
    if (!pending || sender.tab.id !== pending.scope.tabId || sender.documentId !== pending.scope.documentId) throw new Error('ONBOARDING_DUO_SCOPE');
    if (message.type === 'DUO_AUTOPILOT_SIGN') return checked(() => service.run('SIGN', { ...data, usernames: [pending.scope.accountName] }, sender));
    if (message.type === 'RELAY_SCOPE_LOST') {
      failureReport ||= call('scope-lost', { requestId: pending.requestId });
      try { await failureReport; } finally { invalidated = true; }
      throw new Error('ONBOARDING_DUO_SCOPE');
    }
    if (data.requestId !== pending.requestId) throw new Error('ONBOARDING_DUO_SCOPE');
    if (message.type === 'RELAY_NATIVE_FAILED') {
      if (installed.method !== 'touch') throw new Error('ONBOARDING_DUO_SCOPE');
      await checked(() => call('native-failed', { requestId: data.requestId }));
      throw new Error('ONBOARDING_DUO_NATIVE_FAILED');
    }
    if (message.type === 'RELAY_NATIVE_CREATED') {
      if (installed.method !== 'touch' || data.attachment !== 'platform' || pending.credentialId) throw new Error('ONBOARDING_DUO_NATIVE_REQUIRED');
      await checked(() => call('native-created', { credentialId: data.credentialId, requestId: data.requestId }));
      pending.credentialId = data.credentialId;
      return { observed: true };
    }
    if (message.type === 'RELAY_PORTAL_ACCEPTED') {
      if (!pending.credentialId) throw new Error('ONBOARDING_DUO_SCOPE');
      if (!pending.accepted) await checked(() => call('portal-accepted', { credentialId: pending.credentialId, requestId: pending.requestId }));
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
        reserveSignCount: (credentialId, requestId) => checked(() => call('reserve', { credentialId, requestId })).then(result => result.count),
        persistPending: credential => checked(() => call('persist', credential)),
        recordCeremony: (credentialId, requestId) => checked(() => call('software-created', { credentialId, requestId })),
        exactCredentialRequested: (credentialId, requestId) => checked(() => call('exact-request', { credentialId, requestId })),
      });
      await service.initialize({});
    },
    assertContext: assertScope,
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
