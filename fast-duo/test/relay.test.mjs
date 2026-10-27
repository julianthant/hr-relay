import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRelayWorker } from '../src/relay-background.js';

const ORIGIN = 'https://test.duosecurity.com';
const ACCOUNT = '00000000-0000-4000-8000-000000000001';
const CHALLENGE = Buffer.from('synthetic-enrollment-challenge').toString('base64');
const SENDER = { id: 'owned-extension', frameId: 0, url: `${ORIGIN}/setup`, tab: { id: 7 } };
function world() {
  let saved = {};
  let localReads = 0;
  let cleared = false;
  const api = {
    runtime: { id: 'owned-extension' },
    tabs: { get: async id => ({ id, url: `${ORIGIN}/setup` }) },
    storage: {
      local: { get: async () => { localReads++; throw new Error('persistent read'); }, set: () => { throw new Error('persistent write'); } },
      sync: { get: async () => { throw new Error('persistent read'); }, set: () => { throw new Error('persistent write'); } },
      session: {
        setAccessLevel: async value => assert.equal(value.accessLevel, 'TRUSTED_CONTEXTS'),
        get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in saved).map(key => [key, structuredClone(saved[key])])),
        set: async values => { saved = { ...saved, ...structuredClone(values) }; },
        remove: async keys => { for (const key of keys) delete saved[key]; },
        clear: async () => { saved = {}; cleared = true; },
      },
    },
  };
  return { api, worker: createRelayWorker(api), state: () => saved, localReads: () => localReads, cleared: () => cleared };
}
const enrollment = (attachment = 'cross-platform') => ({ type: 'DUO_AUTOPILOT_ENROLL', request: {
  origin: ORIGIN, rpId: 'duosecurity.com', requestId: crypto.randomUUID(), challenge: CHALLENGE,
  username: 'alex@example.edu', userHandle: Buffer.from('synthetic-user').toString('base64'),
  pubKeyCredParams: [{ type: 'public-key', alg: -7 }], authenticatorAttachment: attachment, residentKey: false,
} });
async function acknowledge(worker, kind, value) {
  const request = await worker.next();
  assert.equal(request.kind, kind);
  worker.reply(request.id, { ok: true, value });
  return request;
}

test('real software engine waits for native pending ACK and ceremony ACK; session stores the only extension copy', async () => {
  const w = world();
  await w.worker.install({ method: 'key', nowMs: 1000 });
  let settled = false;
  const result = w.worker.receive(enrollment(), SENDER).then(value => { settled = true; return value; });
  await acknowledge(w.worker, 'bind', { accountId: ACCOUNT });
  const persist = await w.worker.next();
  assert.equal(persist.kind, 'persist');
  assert.ok(persist.data.privateKeyPkcs8);
  assert.ok(persist.data.publicKeySpki);
  assert.equal(settled, false);
  w.worker.reply(persist.id, { ok: true, value: { revision: 1 } });
  const ceremony = await acknowledge(w.worker, 'software-created', { observed: true });
  const credential = await result;
  assert.equal(credential.ok, true);
  assert.equal(ceremony.data.credentialId, credential.credentialId);
  assert.ok(!('privateKeyPkcs8' in credential) && !('privateKey' in credential));
  assert.equal(w.state().autopilotV1.credentials[0].status, 'pending');
  assert.equal(w.state().autopilotV1.accounts[0].id, ACCOUNT);
  assert.equal(w.localReads(), 0);
  const sign = w.worker.receive({ type: 'DUO_AUTOPILOT_SIGN', request: {
    origin: ORIGIN, rpId: 'duosecurity.com', requestId: crypto.randomUUID(), challenge: CHALLENGE,
    allowCredentials: [credential.credentialId], usernames: ['alex@example.edu'],
  } }, SENDER);
  const reserved = await acknowledge(w.worker, 'reserve', { count: 100 });
  assert.equal(reserved.data.credentialId, credential.credentialId);
  await acknowledge(w.worker, 'exact-request', { observed: true });
  const assertion = await sign;
  assert.ok(assertion.signature);
  assert.equal(w.state().autopilotV1.credentials[0].signCount, 100);
  await w.worker.stop();
  assert.equal(w.cleared(), true);
});

test('failed native persistence produces no registration output or session key', async () => {
  const w = world(); await w.worker.install({ method: 'key', nowMs: 1000 });
  const result = w.worker.receive(enrollment(), SENDER);
  const rejected = assert.rejects(result, /ONBOARDING_DUO_REFUSED/);
  await acknowledge(w.worker, 'bind', { accountId: ACCOUNT });
  const request = await w.worker.next();
  assert.equal(request.kind, 'persist');
  w.worker.reply(request.id, { ok: false });
  await rejected;
  assert.equal(w.state().autopilotV1.credentials.length, 0);
  await w.worker.stop();
});

test('Touch ID never calls software enrollment/signing; native observation and portal acceptance are separate', async () => {
  const w = world(); await w.worker.install({ method: 'touch', nowMs: 1000 });
  const message = enrollment('platform');
  const operation = w.worker.receive(message, SENDER);
  await acknowledge(w.worker, 'bind', { accountId: ACCOUNT });
  assert.deepEqual(await operation, { native: true, requestId: message.request.requestId });
  assert.equal(w.state().autopilotV1.credentials.length, 0);
  assert.deepEqual(await w.worker.receive({ type: 'DUO_AUTOPILOT_SIGN', request: { origin: ORIGIN, rpId: 'duosecurity.com' } }, SENDER), { passThrough: true });
  const receipt = { origin: ORIGIN, rpId: 'duosecurity.com', requestId: message.request.requestId, credentialId: 'native-public-id', attachment: 'platform' };
  const native = w.worker.receive({ type: 'RELAY_NATIVE_CREATED', request: receipt }, SENDER);
  const request = await acknowledge(w.worker, 'native-created', { observed: true });
  assert.deepEqual(Object.keys(request.data).sort(), ['credentialId', 'requestId']);
  await native;
  const portal = w.worker.receive({ type: 'RELAY_PORTAL_ACCEPTED', request: { origin: ORIGIN, rpId: 'duosecurity.com', requestId: receipt.requestId } }, SENDER);
  await acknowledge(w.worker, 'portal-accepted', { observed: true });
  await portal;
  await w.worker.stop();
});

for (const [label, sender, request] of [
  ['foreign extension', { ...SENDER, id: 'other-extension' }, enrollment()],
  ['foreign origin', { ...SENDER, url: 'https://example.org/setup' }, enrollment()],
  ['subframe', { ...SENDER, frameId: 1 }, enrollment()],
  ['forged tab', { ...SENDER, tab: { id: '7' } }, enrollment()],
  ['wrong RP', SENDER, { ...enrollment(), request: { ...enrollment().request, rpId: 'example.org' } }],
]) test(`refuses ${label} before any broker operation`, async () => {
  const w = world(); await w.worker.install({ method: 'key', nowMs: 1000 });
  await assert.rejects(w.worker.receive(request, sender), /ONBOARDING_DUO_SCOPE/);
  assert.equal(w.state().autopilotV1.credentials.length, 0);
  await w.worker.stop();
});

test('stop rejects in-flight bind and clears only session copies; late replies cannot revive it', async () => {
  const w = world(); await w.worker.install({ method: 'key', nowMs: 1000 });
  const operation = w.worker.receive(enrollment(), SENDER);
  const rejected = assert.rejects(operation, /ONBOARDING_DUO_REVOKED/);
  const request = await w.worker.next();
  await w.worker.stop(); await rejected;
  assert.throws(() => w.worker.reply(request.id, { ok: true, value: { accountId: ACCOUNT } }), /ONBOARDING_DUO_REVOKED/);
  assert.deepEqual(w.state(), {});
});

test('native page hook invokes original browser create and exports metadata only; refusal never falls through to another enrollment', async () => {
  const { readFile } = await import('node:fs/promises');
  const { runInNewContext } = await import('node:vm');
  const source = await readFile(new URL('../src/relay-inpage.js', import.meta.url), 'utf8');
  const messages = [];
  let onMessage;
  let nativeCalls = 0;
  let refused = false;
  const native = { authenticatorAttachment: 'platform', rawId: new Uint8Array([1, 2, 3]).buffer };
  const credentials = { create: async () => { nativeCalls++; return native; }, get: async () => 'native-get' };
  const location = { origin: ORIGIN, hostname: 'test.duosecurity.com' };
  const window = {
    addEventListener(_type, callback) { onMessage = callback; },
    postMessage(message) {
      messages.push(message);
      const result = message.operation === 'DUO_AUTOPILOT_ENROLL' ? { native: true } : { observed: true };
      queueMicrotask(() => onMessage({ source: window, origin: ORIGIN, data: {
        type: 'RELAY_DUO_RESPONSE', id: message.id, success: !refused, result,
      } }));
    },
  };
  runInNewContext(source, { window, location, navigator: { credentials }, crypto, btoa, atob, DOMException });
  const options = { publicKey: { rp: { id: 'duosecurity.com' }, challenge: new Uint8Array([4, 5]),
    user: { id: new Uint8Array([6]), name: 'alex@example.edu' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    authenticatorSelection: { authenticatorAttachment: 'platform' } } };
  assert.equal(await credentials.create(options), native);
  assert.equal(nativeCalls, 1);
  assert.deepEqual(messages.map(message => message.operation), ['DUO_AUTOPILOT_ENROLL', 'RELAY_NATIVE_CREATED']);
  assert.ok(!Object.keys(messages[1].request).some(key => /private|signature/i.test(key)));
  refused = true;
  await assert.rejects(credentials.create(options), /Duo setup could not complete/);
  assert.equal(nativeCalls, 1);
});

test('counter reservation refusal releases no assertion and does not reuse a session counter', async () => {
  const w = world(); await w.worker.install({ method: 'key', nowMs: 1000 });
  const enrollmentResult = w.worker.receive(enrollment(), SENDER);
  await acknowledge(w.worker, 'bind', { accountId: ACCOUNT });
  await acknowledge(w.worker, 'persist', { revision: 1 });
  await acknowledge(w.worker, 'software-created', { observed: true });
  const credential = await enrollmentResult;
  const signature = w.worker.receive({ type: 'DUO_AUTOPILOT_SIGN', request: { origin: ORIGIN, rpId: 'duosecurity.com',
    requestId: crypto.randomUUID(), challenge: CHALLENGE, allowCredentials: [credential.credentialId] } }, SENDER);
  const rejected = assert.rejects(signature, /ONBOARDING_DUO_REFUSED/);
  const reservation = await w.worker.next();
  assert.equal(reservation.kind, 'reserve');
  w.worker.reply(reservation.id, { ok: false });
  await rejected;
  assert.equal(w.state().autopilotV1.credentials[0].signCount, 0);
  await w.worker.stop();
});

test('Relay startup and unknown failure never enter standalone bootstrap or persistent stores', async () => {
  const w = world();
  Object.defineProperty(w.api.storage, 'local', { get() { throw new Error('persistent local read'); } });
  Object.defineProperty(w.api.storage, 'sync', { get() { throw new Error('persistent sync read'); } });
  Object.defineProperty(w.api, 'indexedDB', { get() { throw new Error('persistent IndexedDB read'); } });
  await w.worker.install({ method: 'touch', nowMs: 1000 });
  const operation = w.worker.receive(enrollment('platform'), SENDER);
  const rejected = assert.rejects(operation, /ONBOARDING_DUO_REFUSED/);
  const binding = await w.worker.next();
  w.worker.reply(binding.id, { ok: false });
  await rejected;
  await w.worker.stop();
});

test('Relay manifest import closure cannot load standalone bootstrap or persistent-storage modules', async () => {
  const { readFile } = await import('node:fs/promises');
  const manifest = JSON.parse(await readFile(new URL('../relay-manifest.json', import.meta.url), 'utf8'));
  const allowed = new Set(['src/relay-background.js', 'src/relay-content.js', 'src/relay-inpage.js',
    'src/service.js', 'src/crypto.js', 'src/accounts.js', 'src/sign-count.js', 'src/username.js']);
  const discovered = new Set([manifest.background.service_worker, ...manifest.content_scripts.flatMap(script => script.js)]);
  for (const file of discovered) {
    assert.ok(allowed.has(file), `unexpected entrypoint ${file}`);
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.ok(!/\b(?:indexedDB|preparePrivateStorage|fetch)\s*(?:\(|\.)/.test(source), `persistent/bootstrap access in ${file}`);
    for (const match of source.matchAll(/\bfrom\s+['"]\.\/([^'"]+)['"]/g)) {
      const dependency = `src/${match[1]}`;
      assert.ok(allowed.has(dependency), `unexpected dependency ${dependency}`);
      discovered.add(dependency);
    }
    assert.ok(!/\bimport\s*\(/.test(source), `unbounded dynamic import in ${file}`);
  }
  assert.deepEqual([...discovered].sort(), [...allowed].sort());
});
