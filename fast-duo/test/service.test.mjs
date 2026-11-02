import test from 'node:test';
import assert from 'node:assert/strict';
import { createService } from '../src/service.js';
import { createAssertion, bytesToBase64 } from '../src/crypto.js';
import { nextSignCount } from '../src/sign-count.js';

function memory(initial = {}) {
  let store = structuredClone(initial);
  return {
    async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k, structuredClone(store[k])])); },
    async set(data) { store = { ...store, ...structuredClone(data) }; },
    raw: () => structuredClone(store),
  };
}
const origin = 'https://test.duosecurity.com';
const sender = { url: origin + '/frame', tab: { id: 7 } };
const request = { rpId: 'duosecurity.com', origin, challenge: btoa('fresh-challenge'), requestId: 'synthetic-request' };
const enrollment = { ...request, username: 'demouser', userHandle: btoa('user-b'), pubKeyCredParams: [{ type: 'public-key', alg: -7 }], authenticatorAttachment: 'cross-platform', residentKey: true };
const arm = { accountId: 'b', tabId: 7, tabUrl: sender.url, transport: 'usb' };
async function setup() {
  let time = 1800000000000;
  let counter = 0;
  const storage = memory();
  const privateKeys = new Map();
  const service = createService(storage, () => time, {
    async persistPending(credential) { privateKeys.set(credential.credentialId, credential); },
    async recordCeremony() {},
    async exactCredentialRequested() {},
    async signAssertion(id, data) {
      const credential = privateKeys.get(Buffer.from(id, 'base64url').toString('base64'));
      counter = nextSignCount(counter, Math.floor(time / 1000));
      const assertion = await createAssertion({ privateKeyPkcs8: Buffer.from(credential.privateKeyPkcs8, 'base64'),
        rpId: data.rpId, challenge: Buffer.from(data.challenge, 'base64'), origin: data.origin, signCount: counter });
      return { ...Object.fromEntries(Object.entries(assertion).map(([key, value]) => [key, bytesToBase64(value)])), credentialId: id };
    },
  });
  await service.initialize();
  await service.run('SAVE_ACCOUNT', { id: 'a', username: 'demo-user' });
  await service.run('SAVE_ACCOUNT', { id: 'b', username: 'demouser' });
  return { service, storage, privateKeys, counter: () => counter, advance: ms => time += ms, state: () => storage.raw().autopilotV1 };
}
async function enroll(w) {
  await w.service.run('ARM', arm);
  const result = await w.service.run('ENROLL', enrollment, sender);
  assert.equal(result.ok, true);
  return { ...request, allowCredentials: [result.credentialId], usernames: ['demouser'] };
}

test('fresh Relay session starts empty without importing persistent credentials', async () => {
  const storage = memory({ duoCredentials: ['not-a-current-session'], settings: { enabled: false } });
  const service = createService(storage, () => 1000, {});
  await service.initialize();
  assert.deepEqual(storage.raw().autopilotV1, { version: 1, accounts: [], credentials: [], enrollment: null });
});

test('wrong origin and mismatched claimed origin never sign', async () => {
  const w = await setup(), sign = await enroll(w);
  for (const [r, s] of [[sign, { url: 'https://evil.test', tab: { id: 7 } }], [{ ...sign, origin: 'https://other.duosecurity.com' }, sender], [{ ...sign, rpId: 'evil.test' }, sender]]) {
    assert.equal((await w.service.run('SIGN', r, s)).ok, false);
  }
  assert.equal(w.counter(), 0);
});

test('concurrent assertions serialize backend counter reservations before returning', async () => {
  const w = await setup(), sign = await enroll(w);
  const results = await Promise.all([w.service.run('SIGN', sign, sender), w.service.run('SIGN', sign, sender)]);
  assert.ok(results.every(r => r.ok));
  const counters = results.map(r => Buffer.from(r.authenticatorData, 'base64').readUInt32BE(33));
  assert.equal(counters[1], counters[0] + 1);
  assert.equal(w.counter(), counters[1]);
  assert.equal(Object.hasOwn(w.state().credentials[0], 'signCount'), false);
  assert.equal(Object.hasOwn(w.state().credentials[0], 'privateKey'), false);
});

test('wrong-account matching refuses without reserving a signature', async () => {
  const w = await setup(), sign = await enroll(w);
  const result = await w.service.run('SIGN', { ...sign, usernames: ['demo-user'] }, sender);
  assert.equal(result.ok, false); assert.match(result.reason, /No linked key/);
  assert.equal(w.counter(), 0);
});

test('capture requires explicit arming and the correct tab, origin, username and timeout', async () => {
  const { service, advance } = await setup();
  assert.equal((await service.run('ENROLL', enrollment, sender)).ok, false);
  await service.run('ARM', arm);
  assert.equal((await service.run('ENROLL', enrollment, { ...sender, tab: { id: 8 } })).ok, false);
  assert.equal((await service.run('ENROLL', { ...enrollment, origin: 'https://other.duosecurity.com' }, sender)).ok, false);
  assert.equal((await service.run('ENROLL', { ...enrollment, username: 'demo-user' }, sender)).ok, false);
  assert.equal((await service.run('ENROLL', { ...enrollment, pubKeyCredParams: [{ alg: -257 }] }, sender)).ok, false);
  advance(600001); assert.equal((await service.run('ENROLL', enrollment, sender)).ok, false);
});

test('capture is one-shot, saves a pending key, then activates on an exact Duo key request', async () => {
  const w = await setup(), sign = await enroll(w);
  assert.equal(w.state().enrollment, null);
  assert.equal(w.state().credentials[0].status, 'pending'); assert.equal(w.state().credentials[0].accountId, 'b');
  assert.equal((await w.service.run('ENROLL', enrollment, sender)).ok, false);
  assert.equal((await w.service.run('SIGN', { ...sign, allowCredentials: [] }, sender)).ok, false);
  assert.equal((await w.service.run('SIGN', sign, sender)).ok, true);
  assert.equal(w.state().credentials[0].status, 'ready');
  const json = JSON.stringify(w.state());
  for (const c of w.privateKeys.values()) assert.ok(!json.includes(c.privateKeyPkcs8));
  await w.service.initialize(); assert.equal(w.state().credentials.length, 1);
});

test('concurrent enrollment calls mint only one key', async () => {
  const w = await setup(); await w.service.run('ARM', arm);
  const results = await Promise.all([w.service.run('ENROLL', enrollment, sender), w.service.run('ENROLL', enrollment, sender)]);
  assert.equal(results.filter(x => x.ok).length, 1); assert.equal(w.state().credentials.length, 1);
});

test('invalid stored state fails explicitly; request queue recovers after validation failure', async () => {
  for (const invalid of [{ version: 99 }, null, false]) {
    const broken = createService(memory({ autopilotV1: invalid }), () => 1000, {});
    await assert.rejects(broken.initialize(), /storage/);
  }
  const w = await setup(); await assert.rejects(w.service.run('SAVE_ACCOUNT', { username: 'bad user' }));
  assert.equal(w.state().accounts.length, 2);
});

test('storage write failure cannot release a signature', async () => {
  const w = await setup(), sign = await enroll(w);
  w.storage.set = async () => { throw new Error('disk failure'); };
  await assert.rejects(w.service.run('SIGN', sign, sender), /disk failure/);
});

test('failed registration reports the observed username', async () => {
  const w = await setup(); await w.service.run('ARM', arm);
  await w.service.run('ENROLL', { ...enrollment, username: 'demouser@example.edu' }, sender);
  assert.match(w.state().enrollment.error, /demouser@example.edu/);
});

test('primary and alternate logins use the same backend key counter', async () => {
  const w = await setup();
  await w.service.run('SAVE_ACCOUNT', { id: 'b', username: 'demouser', aliases: ['other-login'] });
  const sign = await enroll(w);
  const results = await Promise.all(['demouser', 'other-login'].map(username => w.service.run('SIGN', { ...sign, usernames: [username] }, sender)));
  assert.ok(results.every(r => r.ok && r.credentialId === sign.allowCredentials[0]));
  const counters = results.map(r => Buffer.from(r.authenticatorData, 'base64').readUInt32BE(33));
  assert.equal(counters[1], counters[0] + 1); assert.equal(w.state().credentials.length, 1);
  assert.equal(w.counter(), counters[1]);
  await w.service.run('SAVE_ACCOUNT', { id: 'b', username: 'demouser', enabled: false });
  assert.equal((await w.service.run('SIGN', { ...sign, usernames: ['other-login'] }, sender)).ok, false);
});

test('account edits preserve aliases and keys; conflicting aliases refuse', async () => {
  const w = await setup(); await enroll(w);
  await assert.rejects(w.service.run('SAVE_ACCOUNT', { id: 'b', username: 'demouser', aliases: ['demo-user'] }), /another account/);
  await w.service.run('SAVE_ACCOUNT', { id: 'b', username: 'demouser', aliases: ['other-login'] });
  await w.service.run('SAVE_ACCOUNT', { id: 'b', username: 'demouser' });
  assert.deepEqual(w.state().accounts.find(a => a.id === 'b').aliases, ['other-login']);
  const before = w.state().credentials;
  await w.service.run('SAVE_ACCOUNT', { id: 'b', username: 'demouser', aliases: [] });
  assert.deepEqual(w.state().credentials, before);
});

test('guided enrollment accepts a linked alias, but rejects unlinked usernames', async () => {
  const w = await setup();
  await w.service.run('SAVE_ACCOUNT', { id: 'b', username: 'demouser', aliases: ['other-login'] });
  await w.service.run('ARM', arm);
  assert.equal((await w.service.run('ENROLL', { ...enrollment, username: 'unknown' }, sender)).ok, false);
  assert.equal((await w.service.run('ENROLL', { ...enrollment, username: 'other-login' }, sender)).ok, true);
  assert.ok(w.state().credentials.every(c => c.accountId === 'b'));
});
