import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedStorage, migrateSafariStorage, preparePrivateStorage } from '../src/private-storage.js';

function memory(initial = {}) {
  const values = structuredClone(initial);
  return {
    values,
    async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(k => values[k] !== undefined).map(k => [k, structuredClone(values[k])])); },
    async set(next) { Object.assign(values, structuredClone(next)); },
    async remove(keys) { for (const key of keys) delete values[key]; },
  };
}

test('Safari committed state survives a new adapter; removal persists', async () => {
  const factory = new IDBFactory();
  const first = createIndexedStorage(factory);
  await first.set({ autopilotV1: { accounts: ['fixture'], counter: 4 }, settings: { enabled: true } });
  const restarted = createIndexedStorage(factory);
  assert.deepEqual(await restarted.get('autopilotV1'), { autopilotV1: { accounts: ['fixture'], counter: 4 } });
  await restarted.remove(['settings']);
  assert.deepEqual(await first.get(['settings']), {});
});

test('Safari transaction failure rolls back earlier writes in the batch', async () => {
  const storage = createIndexedStorage(new IDBFactory());
  await storage.set({ counter: 4 });
  await assert.rejects(storage.set({ counter: 5, invalid: () => {} }));
  assert.deepEqual(await storage.get(['counter', 'invalid']), { counter: 4 });
});

test('migration verifies private copy before removing shared storage', async () => {
  const local = memory({ autopilotV1: { accounts: ['fixture'] }, unrelated: 42 });
  const privateStorage = createIndexedStorage(new IDBFactory());
  await migrateSafariStorage(local, privateStorage);
  assert.deepEqual(local.values, { unrelated: 42 });
  assert.deepEqual(await privateStorage.get('autopilotV1'), { autopilotV1: { accounts: ['fixture'] } });
  await migrateSafariStorage(local, privateStorage);
});

test('conflicting migration preserves both copies', async () => {
  const local = memory({ autopilotV1: { counter: 1 } });
  const privateStorage = memory({ autopilotV1: { counter: 2 } });
  await assert.rejects(migrateSafariStorage(local, privateStorage), /conflicting/);
  assert.equal(local.values.autopilotV1.counter, 1);
  assert.equal(privateStorage.values.autopilotV1.counter, 2);
});

test('failed write or readback never deletes original data', async () => {
  for (const badStorage of [
    { async get() { return {}; }, async set() { throw new Error('disk full'); } },
    { async get() { return {}; }, async set() {} },
  ]) {
    const local = memory({ autopilotV1: { counter: 1 } });
    await assert.rejects(migrateSafariStorage(local, badStorage));
    assert.equal(local.values.autopilotV1.counter, 1);
  }
});

test('failed cleanup blocks startup, then matching copies can migrate on retry', async () => {
  const local = memory({ autopilotV1: { counter: 1 } });
  const privateStorage = memory();
  const remove = local.remove;
  local.remove = async () => {};
  await assert.rejects(migrateSafariStorage(local, privateStorage), /old copy/);
  local.remove = remove;
  await migrateSafariStorage(local, privateStorage);
  assert.equal(local.values.autopilotV1, undefined);
  assert.equal(privateStorage.values.autopilotV1.counter, 1);
});

test('Chrome requires successful trusted-context protection and never falls back', async () => {
  const local = memory();
  const api = { runtime: { getURL: () => 'chrome-extension://fixture/' }, storage: { local } };
  await assert.rejects(preparePrivateStorage(api), /protected local storage/);
  local.setAccessLevel = async () => { throw new Error('protection refused'); };
  await assert.rejects(preparePrivateStorage(api), /protection refused/);
  local.setAccessLevel = async options => assert.deepEqual(options, { accessLevel: 'TRUSTED_CONTEXTS' });
  assert.equal(await preparePrivateStorage(api), local);
});

test('Safari missing IndexedDB fails instead of using shared local storage', async () => {
  const local = memory();
  await assert.rejects(preparePrivateStorage({ runtime: { getURL: () => 'safari-web-extension://fixture/' }, storage: { local } }, null), /IndexedDB is unavailable/);
});
