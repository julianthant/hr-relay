import test from 'node:test';
import assert from 'node:assert/strict';

test('an open Duo tab is listed when Safari hides URL-filtered queries', async () => {
  const original = { chrome: globalThis.chrome, fetch: globalThis.fetch, BroadcastChannel: globalThis.BroadcastChannel };
  const listeners = [];
  const queries = [];
  let local = {};
  const duo = { id: 7, title: 'Device management', url: 'https://uw2.devicemanagement.duosecurity.com/frame/device-management/portal' };
  globalThis.BroadcastChannel = class { postMessage() {} close() {} };
  globalThis.chrome = {
    storage: { local: {
      async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => local[key] !== undefined).map(key => [key, local[key]])); },
      async set(values) { local = { ...local, ...structuredClone(values) }; },
      async remove(keys) { for (const key of [].concat(keys)) delete local[key]; },
      async setAccessLevel() {},
    } },
    runtime: { id: 'duo-tabs', getURL: path => 'chrome-extension://duo-tabs/' + path,
      onInstalled: { addListener() {} }, onMessage: { addListener(fn) { listeners.push(fn); } } },
    tabs: { async query(info) {
      queries.push(info);
      // Safari drops URL-filtered queries before it can ask for an ungranted Duo site.
      if (info.url) return [];
      return [duo, { id: 8, title: 'Other', url: 'https://example.com/' }, { id: 9, title: 'Unread', url: undefined }, { id: 10, title: 'Lookalike', url: 'https://evilduosecurity.com/' }];
    } },
  };
  globalThis.fetch = async () => ({ ok: true, async json() { return { accounts: [], credentialFile: null }; } });
  try {
    await import('../src/background.js?duo-tabs');
    const response = await new Promise(resolve => listeners[0]({ type: 'DUO_TABS' }, { id: 'duo-tabs', url: 'chrome-extension://duo-tabs/src/options.html' }, resolve));
    assert.equal(response.success, true, response.error);
    assert.deepEqual(queries, [{}]);
    assert.deepEqual(response.result, [duo]);
  } finally { Object.assign(globalThis, original); }
});
