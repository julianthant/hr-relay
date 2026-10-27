import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRelayWorker } from '../src/relay-background.js';

const ORIGIN = 'https://test.duosecurity.com';
const ACCOUNT = '00000000-0000-4000-8000-000000000001';
const CHALLENGE = Buffer.from('synthetic-enrollment-challenge').toString('base64');
const DOCUMENT = '00000000-0000-4000-8000-000000000007';
const SENDER = { id: 'owned-extension', frameId: 0, origin: ORIGIN, documentId: DOCUMENT, documentLifecycle: 'active', url: `${ORIGIN}/setup`, tab: { id: 7 } };
function world() {
  let saved = {};
  let localReads = 0;
  let cleared = false;
  const scope = { documentId: DOCUMENT, url: `${ORIGIN}/setup`, accountNames: ['alex@example.edu'], accountRevision: 0 };
  const api = {
    runtime: { id: 'owned-extension' },
    tabs: { get: async id => ({ id, url: scope.url }), sendMessage: async (_id, _request, target) => {
      if (target.documentId !== scope.documentId) throw new Error('document replaced');
      return { url: scope.url, origin: new URL(scope.url).origin, documentActive: true, accountNames: [...scope.accountNames], accountRevision: scope.accountRevision };
    } },
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
  return { api, scope, worker: createRelayWorker(api), state: () => saved, localReads: () => localReads, cleared: () => cleared };
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
  const invalidated = await w.worker.next();
  assert.equal(invalidated.kind, 'scope-lost');
  w.worker.reply(invalidated.id, { ok: false });
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
  ['missing document', { ...SENDER, documentId: undefined }, enrollment()],
  ['inactive document', { ...SENDER, documentLifecycle: 'cached' }, enrollment()],
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
  const invalidated = await w.worker.next();
  assert.equal(invalidated.kind, 'scope-lost');
  w.worker.reply(invalidated.id, { ok: false });
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
  const invalidated = await w.worker.next();
  assert.equal(invalidated.kind, 'scope-lost');
  w.worker.reply(invalidated.id, { ok: false });
  await rejected;
  await w.worker.stop();
});

test('Relay manifest import closure cannot load standalone bootstrap or persistent-storage modules', async () => {
  const { readFile } = await import('node:fs/promises');
  const manifest = JSON.parse(await readFile(new URL('../relay-manifest.json', import.meta.url), 'utf8'));
  const allowed = new Set(['src/relay-background.js', 'src/relay-content.js', 'src/relay-inpage.js',
    'src/relay-native.js', 'src/service.js', 'src/crypto.js', 'src/accounts.js', 'src/sign-count.js', 'src/username.js']);
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

test('native cancellation is reported without software enrollment or a fabricated success receipt', async () => {
  const w = world(); await w.worker.install({ method: 'touch', nowMs: 1000 });
  const message = enrollment('platform');
  const operation = w.worker.receive(message, SENDER);
  await acknowledge(w.worker, 'bind', { accountId: ACCOUNT });
  await operation;
  const failure = w.worker.receive({ type: 'RELAY_NATIVE_FAILED', request: { origin: ORIGIN, rpId: 'duosecurity.com', requestId: message.request.requestId } }, SENDER);
  const rejected = assert.rejects(failure, /ONBOARDING_DUO_REFUSED/);
  const report = await w.worker.next();
  assert.equal(report.kind, 'native-failed');
  w.worker.reply(report.id, { ok: false });
  const invalidated = await w.worker.next();
  assert.equal(invalidated.kind, 'scope-lost');
  w.worker.reply(invalidated.id, { ok: false });
  await rejected;
  assert.equal(w.state().autopilotV1.credentials.length, 0);
  await w.worker.stop();
});

async function enrolled(w) {
  await w.worker.install({ method: 'key', nowMs: 1000 });
  const message = enrollment();
  const result = w.worker.receive(message, SENDER);
  await acknowledge(w.worker, 'bind', { accountId: ACCOUNT });
  const pending = await acknowledge(w.worker, 'persist', { revision: 1 });
  await acknowledge(w.worker, 'software-created', { observed: true });
  return { credential: await result, pending: pending.data, requestId: message.request.requestId };
}

test('two genuine engine SIGN requests consume distinct native counts; a request nonce replay cannot sign another challenge', async () => {
  const w = world();
  const { credential, pending } = await enrolled(w);
  const used = new Set();
  const publicKey = await crypto.subtle.importKey('spki', Buffer.from(pending.publicKeySpki, 'base64'), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  for (const count of [100, 101]) {
    const requestId = crypto.randomUUID();
    const challenge = Buffer.from(`distinct challenge ${count}`).toString('base64');
    const operation = w.worker.receive({ type: 'DUO_AUTOPILOT_SIGN', request: { origin: ORIGIN, rpId: 'duosecurity.com', requestId, challenge, allowCredentials: [credential.credentialId] } }, SENDER);
    const request = await w.worker.next();
    assert.equal(request.kind, 'reserve');
    assert.equal(request.data.requestId, requestId);
    assert.equal(used.has(requestId), false); used.add(requestId);
    w.worker.reply(request.id, { ok: true, value: { count } });
    await acknowledge(w.worker, 'exact-request', { observed: true });
    const result = await operation;
    const authData = Buffer.from(result.authenticatorData, 'base64');
    assert.equal(authData.readUInt32BE(33), count);
    const clientData = Buffer.from(result.clientDataJSON, 'base64');
    assert.equal(JSON.parse(clientData).challenge, challenge.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
    const payload = Buffer.concat([authData, Buffer.from(await crypto.subtle.digest('SHA-256', clientData))]);
    // WebAuthn uses DER ECDSA; convert the two integers to the WebCrypto raw form.
    const der = Buffer.from(result.signature, 'base64');
    let offset = 2;
    const raw = Buffer.alloc(64);
    for (const index of [0, 1]) {
      assert.equal(der[offset++], 2);
      const length = der[offset++];
      const value = der.subarray(offset, offset + length); offset += length;
      value.subarray(Math.max(0, value.length - 32)).copy(raw, index * 32 + Math.max(0, 32 - value.length));
    }
    assert.equal(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, raw, payload), true);
  }
  const replayId = [...used][0];
  const replay = w.worker.receive({ type: 'DUO_AUTOPILOT_SIGN', request: { origin: ORIGIN, rpId: 'duosecurity.com', requestId: replayId,
    challenge: Buffer.from('different replay challenge').toString('base64'), allowCredentials: [credential.credentialId] } }, SENDER);
  const rejected = assert.rejects(replay, /ONBOARDING_DUO_REFUSED/);
  const reservation = await w.worker.next();
  assert.equal(reservation.kind, 'reserve'); assert.equal(used.has(reservation.data.requestId), true);
  w.worker.reply(reservation.id, { ok: false });
  const unknown = await w.worker.next(); assert.equal(unknown.kind, 'scope-lost'); w.worker.reply(unknown.id, { ok: false });
  await rejected;
  assert.equal(w.state().autopilotV1.credentials[0].signCount, 101);
  await w.worker.stop();
});

for (const kind of ['bind', 'persist', 'software-created', 'reserve', 'exact-request', 'native-created', 'portal-accepted']) {
  for (const drift of ['document', 'navigation', 'account', 'account-returned']) test(`rejects ${drift} drift during ${kind} ACK without output`, async () => {
    const w = world();
    const touch = kind === 'native-created';
    let operation;
    if (['reserve', 'exact-request', 'portal-accepted'].includes(kind)) {
      const { credential, requestId } = await enrolled(w);
      operation = kind === 'portal-accepted'
        ? w.worker.receive({ type: 'RELAY_PORTAL_ACCEPTED', request: { origin: ORIGIN, rpId: 'duosecurity.com', requestId } }, SENDER)
        : w.worker.receive({ type: 'DUO_AUTOPILOT_SIGN', request: { origin: ORIGIN, rpId: 'duosecurity.com', requestId: crypto.randomUUID(), challenge: CHALLENGE, allowCredentials: [credential.credentialId] } }, SENDER);
    } else {
      await w.worker.install({ method: touch ? 'touch' : 'key', nowMs: 1000 });
      const message = enrollment(touch ? 'platform' : 'cross-platform');
      operation = w.worker.receive(message, SENDER);
      if (touch) {
        await acknowledge(w.worker, 'bind', { accountId: ACCOUNT }); await operation;
        operation = w.worker.receive({ type: 'RELAY_NATIVE_CREATED', request: { origin: ORIGIN, rpId: 'duosecurity.com', requestId: message.request.requestId, credentialId: 'native-public-id', attachment: 'platform' } }, SENDER);
      }
    }
    const rejected = assert.rejects(operation, /ONBOARDING_DUO_SCOPE/);
    let request;
    do {
      request = await w.worker.next();
      if (request.kind !== kind) w.worker.reply(request.id, { ok: true, value: request.kind === 'bind' ? { accountId: ACCOUNT } : request.kind === 'reserve' ? { count: 12 } : { revision: 1 } });
    } while (request.kind !== kind);
    if (drift === 'document') w.scope.documentId = crypto.randomUUID();
    if (drift === 'navigation') w.scope.url = `${ORIGIN}/other`;
    if (drift === 'account') { w.scope.accountNames = ['other@example.edu']; w.scope.accountRevision++; }
    if (drift === 'account-returned') w.scope.accountRevision += 2;
    w.worker.reply(request.id, { ok: true, value: kind === 'bind' ? { accountId: ACCOUNT } : kind === 'reserve' ? { count: 12 } : { revision: 1 } });
    const unknown = await w.worker.next(); assert.equal(unknown.kind, 'scope-lost'); w.worker.reply(unknown.id, { ok: false });
    await rejected;
    await w.worker.stop();
  });
}

for (const names of [[], ['alex@example.edu', 'other@example.edu']]) test(`missing or ambiguous isolated account observations cannot bind: ${names.length}`,  async () => {
  const w = world(); w.scope.accountNames = names;
  await w.worker.install({ method: 'key', nowMs: 1000 });
  await assert.rejects(w.worker.receive(enrollment(), SENDER), /ONBOARDING_DUO_SCOPE/);
  await w.worker.stop();
});

async function isolatedWorld(nativeBehavior) {
  const { readFile } = await import('node:fs/promises');
  const { runInNewContext } = await import('node:vm');
  const listeners = new Map();
  const sent = []; const output = [];
  let nativeCalls = 0;
  class Attestation {}
  class Credential {}
  const window = { addEventListener: (type, listener) => listeners.set(type, listener), postMessage: value => output.push(value) };
  const context = { window, location: { origin: ORIGIN, href: `${ORIGIN}/setup` },
    document: { documentElement: {}, querySelectorAll: () => [] }, DuoUsername: { findUsernames: () => ['alex@example.edu'] },
    MutationObserver: class { observe() {} }, AbortController, PublicKeyCredential: Credential, AuthenticatorAttestationResponse: Attestation,
    TextEncoder, TextDecoder, Uint8Array, JSON, crypto, btoa, atob,
    navigator: { credentials: { create: async options => { nativeCalls++; return nativeBehavior(options, Credential, Attestation); } } },
    chrome: { runtime: { id: 'owned-extension', onMessage: { addListener() {} }, sendMessage: async message => {
      sent.push(message);
      return message.type === 'DUO_AUTOPILOT_ENROLL' ? { success: true, result: { native: true } } : { success: true };
    } } },
  };
  for (const file of ['relay-native.js', 'relay-content.js']) runInNewContext(await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8'), context);
  return { sent, output, nativeCalls: () => nativeCalls,
    message: data => listeners.get('message')({ source: window, origin: ORIGIN, data }) };
}

test('native isolated completion calls captured browser create; page-created and page-failed messages cannot attest', async () => {
  let complete;
  const gate = new Promise(resolve => { complete = resolve; });
  const w = await isolatedWorld(async (_options, Credential, Attestation) => {
    await gate;
    const authData = new Uint8Array(37); authData.set(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('duosecurity.com'))));
    return Object.assign(new Credential(), { rawId: new Uint8Array([1, 2, 3]).buffer, authenticatorAttachment: 'platform', response: Object.assign(new Attestation(), {
      clientDataJSON: new TextEncoder().encode(JSON.stringify({ type: 'webauthn.create', origin: ORIGIN, challenge: CHALLENGE.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_') })).buffer,
      attestationObject: new Uint8Array([1]).buffer, getAuthenticatorData: () => authData.buffer,
      getPublicKey: () => null, getPublicKeyAlgorithm: () => -7, getTransports: () => ['internal'],
    }) });
  });
  const request = enrollment('platform').request;
  const operation = w.message({ type: 'RELAY_DUO_REQUEST', id: 'actual-request', operation: 'DUO_AUTOPILOT_ENROLL', request,
    nativeOptions: { rp: { id: request.rpId }, challenge: Buffer.from(request.challenge, 'base64'), user: { name: request.username, id: Buffer.from(request.userHandle, 'base64') }, authenticatorSelection: { authenticatorAttachment: 'platform' } } });
  await w.message({ type: 'RELAY_DUO_REQUEST', id: 'forged', operation: 'RELAY_NATIVE_CREATED', request: { ...request, credentialId: 'forged', attachment: 'platform' } });
  await w.message({ type: 'RELAY_NATIVE_CREATED', request });
  await w.message({ type: 'RELAY_DUO_REQUEST', id: 'failed', operation: 'RELAY_NATIVE_FAILED', request });
  assert.equal(w.sent.filter(message => message.type === 'RELAY_NATIVE_CREATED' || message.type === 'RELAY_NATIVE_FAILED').length, 0);
  complete(); await operation;
  assert.equal(w.nativeCalls(), 1);
  assert.equal(w.sent.filter(message => message.type === 'RELAY_NATIVE_CREATED').length, 1);
  assert.equal(w.output.at(-1).success, true);
  assert.ok(!JSON.stringify(w.sent).includes('privateKey'));
});

test('native browser refusal has no software fallback or successful ceremony', async () => {
  const w = await isolatedWorld(async () => { throw new Error('native refused'); });
  const request = enrollment('platform').request;
  await w.message({ type: 'RELAY_DUO_REQUEST', id: 'refused', operation: 'DUO_AUTOPILOT_ENROLL', request,
    nativeOptions: { rp: { id: request.rpId }, challenge: Buffer.from(request.challenge, 'base64'), user: { name: request.username, id: Buffer.from(request.userHandle, 'base64') }, authenticatorSelection: { authenticatorAttachment: 'platform' } } });
  assert.equal(w.nativeCalls(), 1);
  assert.equal(w.sent.filter(message => message.type === 'RELAY_NATIVE_CREATED').length, 0);
  assert.equal(w.sent.filter(message => message.type === 'RELAY_NATIVE_FAILED').length, 1);
  assert.equal(w.output.at(-1).success, false);
});

for (const invalid of ['origin', 'challenge', 'type', 'attachment', 'rpHash']) test(`native ${invalid} mismatch cannot produce a ceremony`, async () => {
  const w = await isolatedWorld(async (_options, Credential, Attestation) => {
    const authData = new Uint8Array(37);
    if (invalid !== 'rpHash') authData.set(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('duosecurity.com'))));
    return Object.assign(new Credential(), { rawId: new Uint8Array([1]).buffer, authenticatorAttachment: invalid === 'attachment' ? 'cross-platform' : 'platform', response: Object.assign(new Attestation(), {
      clientDataJSON: new TextEncoder().encode(JSON.stringify({ type: invalid === 'type' ? 'webauthn.get' : 'webauthn.create',
        origin: invalid === 'origin' ? 'chrome-extension://owned-extension' : ORIGIN,
        challenge: invalid === 'challenge' ? 'wrong' : CHALLENGE.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_') })).buffer,
      attestationObject: new Uint8Array([1]).buffer, getAuthenticatorData: () => authData.buffer,
      getPublicKey: () => null, getPublicKeyAlgorithm: () => -7, getTransports: () => ['internal'],
    }) });
  });
  const request = enrollment('platform').request;
  await w.message({ type: 'RELAY_DUO_REQUEST', id: 'invalid-native', operation: 'DUO_AUTOPILOT_ENROLL', request,
    nativeOptions: { rp: { id: request.rpId }, challenge: Buffer.from(request.challenge, 'base64'), user: { name: request.username, id: Buffer.from(request.userHandle, 'base64') }, authenticatorSelection: { authenticatorAttachment: 'platform' } } });
  assert.equal(w.sent.filter(message => message.type === 'RELAY_NATIVE_CREATED').length, 0);
  assert.equal(w.sent.filter(message => message.type === 'RELAY_NATIVE_FAILED').length, 1);
  assert.equal(w.output.at(-1).success, false);
});
