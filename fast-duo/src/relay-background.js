import { createService } from './service.js';
import { isDuoOrigin, normalizeUsername } from './accounts.js';
import { base64ToBytes, bytesToBase64url } from './crypto.js';

const accountKey = name => normalizeUsername(name).replace(/^([^@]+)@ucsd\.edu$/, '$1');
const canonicalJson = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
function requireDuoSender(api, sender) {
  if (sender.id !== api.runtime.id || !isDuoOrigin(sender.url) || sender.origin !== new URL(sender.url).origin
    || !Number.isInteger(sender.tab?.id) || sender.frameId !== 0 || sender.documentLifecycle !== 'active'
    || typeof sender.documentId !== 'string' || sender.documentId.length !== 32 || !/^[\da-f]{32}$/i.test(sender.documentId)) throw new Error('ONBOARDING_DUO_SCOPE_SENDER');
}
export function createRelayWorker(api, reportEvent) {
  let installed;
  let service;
  let pending;
  let waiter;
  let stopped = false;
  let invalidated = false;
  let failureReport;
  let enrollment;
  const requests = [];
  const replies = new Map();
  const call = (kind, data) => new Promise((resolve, reject) => {
    if (stopped) { reject(new Error('ONBOARDING_DUO_REVOKED')); return; }
    const request = { id: crypto.randomUUID(), kind, data: data.credentialId === undefined ? data
      : { ...data, credentialId: bytesToBase64url(base64ToBytes(data.credentialId)) } };
    replies.set(request.id, { resolve, reject });
    if (waiter) { const receive = waiter; waiter = undefined; receive(request); }
    else requests.push(request);
  });
  const requireCurrent = () => {
    if (!installed || stopped || invalidated) throw new Error('ONBOARDING_DUO_REVOKED');
  };
  function requireSender(sender) {
    requireCurrent();
    requireDuoSender(api, sender);
  }
  async function documentObservation(tabId, documentId) {
    try { return await api.tabs.sendMessage(tabId, { type: 'RELAY_OBSERVE' }, { documentId }); }
    catch (cause) { throw new Error('ONBOARDING_DUO_SCOPE', { cause }); }
  }
  async function observe(sender) {
    requireSender(sender);
    const tab = await api.tabs.get(sender.tab.id);
    requireCurrent();
    if (tab.id !== sender.tab.id || tab.url !== sender.url) throw new Error('ONBOARDING_DUO_SCOPE_DOCUMENT');
    const observed = await documentObservation(tab.id, sender.documentId);
    requireCurrent();
    const after = await api.tabs.get(tab.id);
    if (after.url !== tab.url || observed?.url !== tab.url || observed.origin !== sender.origin
      || observed.documentActive !== true || !Number.isSafeInteger(observed.accountRevision) || observed.accountRevision < 0
      || !Array.isArray(observed.accountNames) || observed.accountNames.length !== 1
      || typeof observed.accountNames[0] !== 'string' || !/^[a-z0-9][a-z0-9._@+-]{0,127}$/i.test(observed.accountNames[0])) throw new Error('ONBOARDING_DUO_SCOPE_ACCOUNT');
    const confirmed = await documentObservation(tab.id, sender.documentId);
    requireCurrent();
    if (canonicalJson(confirmed) !== canonicalJson(observed)) throw new Error('ONBOARDING_DUO_SCOPE');
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
    if (!data || data.origin !== sender.origin || data.rpId !== 'duosecurity.com') throw new Error('ONBOARDING_DUO_SCOPE_REQUEST');
    if (message.type === 'RELAY_CAPABILITIES') return { softwareKey: installed.method === 'key' };
    if (message.type === 'DUO_AUTOPILOT_SIGN' && (installed.method === 'touch' || !pending)) return { passThrough: true };
    if (message.type === 'DUO_AUTOPILOT_ENROLL') {
      intercept({ requestId: data.requestId }, sender);
      await reportEvent({ stage: 'forwarded', requestId: data.requestId });
      if (pending) throw new Error('ONBOARDING_DUO_ALREADY_STARTED');
      const scope = await observe(sender);
      if (typeof data.username !== 'string' || accountKey(data.username) !== accountKey(scope.accountName)) throw new Error('ONBOARDING_DUO_SCOPE_USERNAME');
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
  function intercept(event, sender) {
    requireSender(sender);
    if (typeof event.requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(event.requestId)) throw new Error('ONBOARDING_DUO_REQUEST');
    if (enrollment && (enrollment.requestId !== event.requestId || enrollment.documentId !== sender.documentId || enrollment.tabId !== sender.tab.id)) throw new Error('ONBOARDING_DUO_ALREADY_STARTED');
    enrollment ||= { requestId: event.requestId, documentId: sender.documentId, tabId: sender.tab.id };
  }
  return Object.freeze({
    intercept,
    async platformAvailable() {
      await assertScope();
      const probe = await api.tabs.sendMessage(pending.sender.tab.id, { type: 'RELAY_PLATFORM_PROBE' }, { documentId: pending.sender.documentId });
      await assertScope();
      if (typeof probe?.available !== 'boolean') throw new Error('ONBOARDING_DUO_NATIVE_UNAVAILABLE');
      return probe.available;
    },
    async fail(data, sender) {
      requireSender(sender);
      if (!enrollment || data.origin !== sender.origin || data.rpId !== 'duosecurity.com' || data.requestId !== enrollment.requestId
        || sender.documentId !== enrollment.documentId || sender.tab.id !== enrollment.tabId
        || !['aborted', 'timed-out', 'request-refused'].includes(data.reason)) throw new Error('ONBOARDING_DUO_SCOPE');
      failureReport ||= call('enrollment-failed', { requestId: enrollment.requestId, reason: data.reason });
      try { await failureReport; } finally { invalidated = true; }
      return { observed: true };
    },
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
          if (canonicalJson(stored) !== canonicalJson(values)) throw new Error('ONBOARDING_DUO_SESSION_UNAVAILABLE');
        },
        remove: keys => session.remove(keys),
      };
      service = createService(verifiedSession, () => input.nowMs + (performance.now() - started), {
        signAssertion: (credentialId, request) => checked(() => call('sign', { credentialId, requestId: request.requestId, rpId: request.rpId, challenge: request.challenge, origin: request.origin })),
        persistPending: credential => checked(() => call('persist', credential)),
        recordCeremony: (credentialId, requestId) => checked(() => call('software-created', { credentialId, requestId })),
        exactCredentialRequested: (credentialId, requestId) => checked(() => call('exact-request', { credentialId, requestId })),
      });
      await service.initialize();
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
  let relay;
  let browserInstalled = false;
  let browserStopped = false;
  let waiter;
  const requests = [];
  const replies = new Map();
  const requireBrowser = () => { if (!browserInstalled || browserStopped) throw new Error('ONBOARDING_DUO_REVOKED'); };
  const browserCall = data => new Promise((resolve, reject) => {
    requireBrowser();
    const request = { id: crypto.randomUUID(), ...data };
    replies.set(request.id, { resolve, reject });
    if (waiter) { const receive = waiter; waiter = undefined; receive(request); }
    else requests.push(request);
  });
  async function observeDuo(sender) {
    requireBrowser(); requireDuoSender(chrome, sender);
    const tab = await chrome.tabs.get(sender.tab.id);
    const document = await chrome.tabs.sendMessage(sender.tab.id, { type: 'RELAY_OBSERVE' }, { documentId: sender.documentId });
    const after = await chrome.tabs.get(sender.tab.id);
    requireBrowser();
    if (tab.id !== sender.tab.id || after.id !== tab.id || after.url !== tab.url || tab.url !== sender.url
      || document?.url !== sender.url || document.origin !== sender.origin || document.documentActive !== true) throw new Error('ONBOARDING_DUO_SCOPE');
  }
  function browserReceive(message, sender) {
    requireBrowser();
    if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('src/options.html')
      || sender.tab !== undefined && (!Number.isInteger(sender.tab.id) || sender.tab.id < 0 || sender.tab.url !== sender.url)
      || sender.frameId !== undefined && sender.frameId !== 0
      || sender.documentLifecycle !== 'active' || typeof sender.documentId !== 'string' || sender.documentId.length !== 32 || !/^[0-9a-f]{32}$/i.test(sender.documentId)
      || sender.origin !== chrome.runtime.getURL('').slice(0, -1)) throw new Error('ONBOARDING_DUO_SCOPE');
    const kinds = { STATE: 'state', RELAY_OPEN_PORTAL: 'portal', RELAY_START: 'start', RELAY_CANCEL: 'cancel', RELAY_CONFIRM: 'confirm' };
    if (!Object.hasOwn(kinds, message.type) || Object.keys(message).some(key => !['type', 'method', 'attemptId'].includes(key))) throw new Error('ONBOARDING_DUO_REQUEST');
    const kind = kinds[message.type];
    if (['state', 'portal'].includes(kind) && (message.method !== undefined || message.attemptId !== undefined)
      || ['start', 'cancel', 'confirm'].includes(kind) && !['key', 'touch'].includes(message.method)
      || kind === 'start' && message.attemptId !== undefined
      || ['cancel', 'confirm'].includes(kind) && (typeof message.attemptId !== 'string' || !/^[0-9a-f-]{36}$/i.test(message.attemptId))) throw new Error('ONBOARDING_DUO_REQUEST');
    return browserCall({ kind,
        ...(message.method === undefined ? {} : { method: message.method }),
        ...(message.attemptId === undefined ? {} : { attemptId: message.attemptId }) }).then(value => ({ relaySetup: true, profile: value }));
  }
  globalThis.relayOnboarding = Object.freeze({
    async browserInstall() {
      if (browserInstalled || browserStopped) throw new Error('ONBOARDING_DUO_REVOKED');
      await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
      browserInstalled = true;
    },
    async browserFocus() {
      requireBrowser();
      const contexts = await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [chrome.runtime.getURL('src/options.html')], frameIds: [0] });
      requireBrowser();
      if (contexts.length !== 1) throw new Error('ONBOARDING_DUO_SCOPE');
      const window = await chrome.windows.get(contexts[0].windowId);
      requireBrowser();
      await chrome.windows.update(window.id, { focused: true, ...(window.state === 'minimized' ? { state: 'normal' } : {}) });
      requireBrowser();
    },
    browserNext() {
      requireBrowser();
      if (requests.length) return Promise.resolve(requests.shift());
      if (waiter) throw new Error('ONBOARDING_DUO_BROKER_BUSY');
      return new Promise(resolve => { waiter = resolve; });
    },
    browserReply(id, result) {
      requireBrowser(); const reply = replies.get(id);
      if (!reply) throw new Error('ONBOARDING_DUO_REQUEST');
      replies.delete(id);
      if (result.ok) reply.resolve(result.value);
      else reply.reject(new Error('ONBOARDING_DUO_REFUSED'));
    },
    async browserStop() {
      browserStopped = true;
      for (const reply of replies.values()) reply.reject(new Error('ONBOARDING_DUO_REVOKED'));
      replies.clear(); requests.length = 0;
      if (waiter) { waiter(null); waiter = undefined; }
      if (relay) { await relay.stop(); relay = undefined; }
      await chrome.storage.session.clear();
    },
    async install(input) { requireBrowser(); if (relay) throw new Error('ONBOARDING_DUO_BUSY'); relay = createRelayWorker(chrome, event => browserCall({ kind: 'event', event })); await relay.install(input); },
    next() { if (!relay) throw new Error('ONBOARDING_DUO_REVOKED'); return relay.next(); },
    reply(...args) { if (!relay) throw new Error('ONBOARDING_DUO_REVOKED'); return relay.reply(...args); },
    assertContext() { if (!relay) throw new Error('ONBOARDING_DUO_REVOKED'); return relay.assertContext(); },
    platformAvailable() { if (!relay) throw new Error('ONBOARDING_DUO_REVOKED'); return relay.platformAvailable(); },
    async stop() { if (!relay) throw new Error('ONBOARDING_DUO_REVOKED'); const arm = relay; await arm.stop(); relay = undefined; },
  });
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const work = async () => {
      if (sender.url?.startsWith(chrome.runtime.getURL(''))) return browserReceive(message, sender);
      if (message?.type === 'RELAY_DUO_EVENT') {
        requireBrowser(); requireDuoSender(chrome, sender);
        if (!message.event || !['intercepted', 'replied'].includes(message.event.stage)
          || Object.keys(message.event).some(key => !['stage', 'requestId'].includes(key))) throw new Error('ONBOARDING_DUO_REQUEST');
        if (message.event.stage === 'intercepted') relay?.intercept(message.event, sender);
        await browserCall({ kind: 'event', event: message.event });
        return { observed: true };
      }
      if (message?.type === 'RELAY_ENROLLMENT_FAILED') {
        if (!relay) throw new Error('ONBOARDING_DUO_REVOKED');
        return relay.fail(message.request, sender);
      }
      if (message?.type === 'RELAY_CAPABILITIES') {
        if (message.request?.origin !== sender.origin || message.request?.rpId !== 'duosecurity.com') throw new Error('ONBOARDING_DUO_SCOPE');
        await observeDuo(sender);
        const probe = await chrome.tabs.sendMessage(sender.tab.id, { type: 'RELAY_PLATFORM_PROBE' }, { documentId: sender.documentId });
        if (typeof probe?.available !== 'boolean') throw new Error('ONBOARDING_DUO_NATIVE_UNAVAILABLE');
        const platformAvailable = await browserCall({ kind: 'platform', url: sender.url, available: probe.available });
        await observeDuo(sender);
        const support = relay ? await relay.receive(message, sender) : { softwareKey: false };
        return { ...support, platformAvailable };
      }
      if (!relay) {
        requireBrowser(); requireDuoSender(chrome, sender);
        if (message?.type !== 'DUO_AUTOPILOT_SIGN'
          || message.request?.origin !== sender.origin || message.request?.rpId !== 'duosecurity.com') throw new Error('ONBOARDING_DUO_SCOPE');
        const tab = await chrome.tabs.get(sender.tab.id);
        const document = await chrome.tabs.sendMessage(sender.tab.id, { type: 'RELAY_OBSERVE' }, { documentId: sender.documentId });
        const after = await chrome.tabs.get(sender.tab.id);
        const confirmed = await chrome.tabs.sendMessage(sender.tab.id, { type: 'RELAY_OBSERVE' }, { documentId: sender.documentId });
        requireBrowser();
        if (relay || tab.id !== sender.tab.id || after.id !== tab.id || after.url !== tab.url || tab.url !== sender.url
          || document?.url !== sender.url || document.origin !== sender.origin || document.documentActive !== true
          || canonicalJson(confirmed) !== canonicalJson(document)) throw new Error('ONBOARDING_DUO_SCOPE');
        return { passThrough: true };
      }
      return relay.receive(message, sender);
    };
    work().then(result => sendResponse({ success: true, result }), async error => {
      const details = { ONBOARDING_DUO_SCOPE_SENDER: 'sender', ONBOARDING_DUO_SCOPE_REQUEST: 'request',
        ONBOARDING_DUO_SCOPE_DOCUMENT: 'document', ONBOARDING_DUO_SCOPE_ACCOUNT: 'account', ONBOARDING_DUO_SCOPE_USERNAME: 'username' };
      if (browserInstalled && !browserStopped && sender.id === chrome.runtime.id && isDuoOrigin(sender.url)
        && (message.request?.rpId === 'duosecurity.com' || message.type === 'RELAY_DUO_EVENT')) {
        try { await browserCall({ kind: 'event', event: { stage: 'refused', detail: Object.hasOwn(details, error.message) ? details[error.message] : 'backend' } }); }
        catch { sendResponse({ success: false, error: 'ONBOARDING_DUO_EVENT_UNRECORDED' }); return; }
      }
      sendResponse({ success: false, error: 'ONBOARDING_DUO_REFUSED' });
    });
    return true;
  });
}
