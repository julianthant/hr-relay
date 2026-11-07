import { isDuoOrigin } from './duo-origin.js';

const canonicalJson = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

export function createWorkflowWorker(api) {
  let installed = false;
  let stopped = false;
  let waiter;
  const requests = [];
  const pending = new Map();
  const current = () => { if (!installed || stopped) throw new Error('DUO_SESSION_UNAVAILABLE'); };
  function requireSender(sender) {
    current();
    if (sender.id !== api.runtime.id || !isDuoOrigin(sender.url) || sender.origin !== new URL(sender.url).origin
      || !Number.isInteger(sender.tab?.id) || sender.tab.id < 0 || !Number.isInteger(sender.frameId) || sender.frameId < 0
      || sender.documentLifecycle !== 'active' || typeof sender.documentId !== 'string' || !/^[a-f0-9]{32}$/i.test(sender.documentId)) throw new Error('DUO_REQUEST_REFUSED');
  }
  async function observe(sender) {
    requireSender(sender);
    const tab = await api.tabs.get(sender.tab.id);
    current();
    const frame = await api.webNavigation.getFrame({ tabId: sender.tab.id, frameId: sender.frameId, documentId: sender.documentId });
    current();
    if (tab.id !== sender.tab.id || typeof tab.url !== 'string' || frame?.url !== sender.url
      || frame.documentId !== sender.documentId || frame.documentLifecycle !== 'active') throw new Error('DUO_REQUEST_REFUSED');
    const observed = await api.tabs.sendMessage(tab.id, { type: 'RELAY_OBSERVE' }, { documentId: sender.documentId });
    current();
    if (observed?.url !== sender.url || observed.origin !== sender.origin || observed.documentActive !== true
      || !Number.isSafeInteger(observed.accountRevision) || observed.accountRevision < 0
      || !Array.isArray(observed.accountNames) || observed.accountNames.length > 20
      || observed.accountNames.some(name => typeof name !== 'string' || !/^[a-z0-9][a-z0-9._@+-]{0,127}$/i.test(name))) throw new Error('DUO_REQUEST_REFUSED');
    return { topUrl: tab.url, documentId: sender.documentId, frameId: sender.frameId, tabId: tab.id,
      url: observed.url, origin: observed.origin, accountNames: [...observed.accountNames], accountRevision: observed.accountRevision };
  }
  async function assertContext(id) {
    const entry = pending.get(id);
    if (!entry) throw new Error('DUO_REQUEST_REVOKED');
    const actual = await observe(entry.sender);
    current();
    if (pending.get(id) !== entry || canonicalJson(actual) !== canonicalJson(entry.scope)) throw new Error('DUO_REQUEST_REVOKED');
  }
  function reject(id) {
    const entry = pending.get(id);
    if (entry) { pending.delete(id); entry.reject(new Error('DUO_REQUEST_REVOKED')); }
  }
  return Object.freeze({
    install() { if (installed || stopped) throw new Error('DUO_SESSION_ALREADY_INSTALLED'); installed = true; },
    async receive(message, sender) {
      requireSender(sender);
      if (message.type === 'DUO_WORKFLOW_ABORT') {
        for (const [id, entry] of pending) if (entry.requestId === message.requestId && entry.sender.documentId === sender.documentId
          && entry.sender.tab.id === sender.tab.id && entry.sender.frameId === sender.frameId) reject(id);
        return { aborted: true };
      }
      if (!['DUO_AUTOPILOT_SIGN', 'DUO_SETTINGS'].includes(message.type)) throw new Error('DUO_REQUEST_REFUSED');
      const scope = await observe(sender);
      if (canonicalJson(await observe(sender)) !== canonicalJson(scope)) throw new Error('DUO_REQUEST_REFUSED');
      if (message.type === 'DUO_SETTINGS') return { enabled: true, trustClick: true, toast: true };
      const data = message.request;
      if (!data || data.origin !== sender.origin || data.rpId !== 'duosecurity.com' || typeof data.requestId !== 'string'
        || !/^[a-f0-9-]{36}$/i.test(data.requestId) || typeof data.challenge !== 'string' || !Array.isArray(data.allowCredentials)
        || pending.size >= 100 || [...pending.values()].some(entry => entry.requestId === data.requestId)) throw new Error('DUO_REQUEST_REFUSED');
      return new Promise((resolve, rejectReply) => {
        const id = crypto.randomUUID();
        pending.set(id, { sender: { ...sender, tab: { id: sender.tab.id } }, scope, requestId: data.requestId, resolve, reject: rejectReply });
        const request = { id, request: { requestId: data.requestId, rpId: data.rpId, origin: data.origin,
          challenge: data.challenge, allowCredentials: data.allowCredentials, accountNames: scope.accountNames } };
        if (waiter) { const receive = waiter; waiter = undefined; receive(request); } else requests.push(request);
      });
    },
    next() {
      current();
      while (requests.length) { const request = requests.shift(); if (pending.has(request.id)) return Promise.resolve(request); }
      if (waiter) throw new Error('DUO_BROKER_BUSY');
      return new Promise(resolve => { waiter = resolve; });
    },
    assertContext,
    async reply(id, result) {
      try {
        await assertContext(id);
        const entry = pending.get(id);
        current();
        if (!entry) throw new Error('DUO_REQUEST_REVOKED');
        pending.delete(id);
        if (result.ok) entry.resolve(result.value); else entry.reject(new Error('DUO_REQUEST_REFUSED'));
      } catch (error) { reject(id); throw error; }
    },
    stop() {
      stopped = true;
      for (const id of pending.keys()) reject(id);
      requests.length = 0;
      if (waiter) { waiter(null); waiter = undefined; }
    },
  });
}

if (typeof chrome !== 'undefined') {
  const worker = createWorkflowWorker(chrome);
  globalThis.relayWorkflow = worker;
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!['DUO_AUTOPILOT_SIGN', 'DUO_SETTINGS', 'DUO_WORKFLOW_ABORT'].includes(message?.type)) return false;
    worker.receive(message, sender).then(result => sendResponse({ success: true, result }),
      () => sendResponse({ success: false, error: 'DUO_REQUEST_REFUSED' }));
    return true;
  });
}
