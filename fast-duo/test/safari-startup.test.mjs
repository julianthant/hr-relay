import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';

test('Safari initializes without storage.local.setAccessLevel and returns public state', async () => {
  const original = { chrome: globalThis.chrome, fetch: globalThis.fetch, indexedDB: globalThis.indexedDB, BroadcastChannel: globalThis.BroadcastChannel };
  const listeners = [];
  let local = {};
  globalThis.indexedDB = new IDBFactory();
  globalThis.BroadcastChannel = class { postMessage() {} close() {} };
  globalThis.chrome = {
    storage: { local: {
      async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k, local[k]])); },
      async set(values) { local = { ...local, ...structuredClone(values) }; },
      async remove(keys) { for (const key of keys) delete local[key]; },
      // Safari intentionally has no setAccessLevel on storage.local.
    } },
    runtime: { id: 'safari-test', getURL: path => 'safari-web-extension://safari-test/' + path,
      onInstalled: { addListener() {} }, onMessage: { addListener(fn) { listeners.push(fn); } } },
  };
  globalThis.fetch = async () => ({ ok: true, async json() { return { accounts: [], credentialFile: null }; } });
  try {
    await import('../src/background.js?safari-startup');
    const response = await new Promise(resolve => listeners[0]({ type: 'STATE' }, { id: 'safari-test', url: 'safari-web-extension://safari-test/src/options.html' }, resolve));
    assert.equal(response.success, true, response.error);
    assert.equal(response.result.accounts.length, 0);
    assert.equal(local.autopilotV1, undefined, 'Safari must not store private state in content-script-readable storage.local');
  } finally { Object.assign(globalThis, original); }
});
