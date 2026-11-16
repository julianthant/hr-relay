import { base64ToBytes, bytesToBase64, bytesToBase64url, createRegistration } from './crypto.js';
import { normalizeUsername, accountUsernames, validateAccount, selectCredential, isDuoOrigin } from './accounts.js';

const STORE = 'autopilotV1';
export function createService(storage, now, relay) {
  let queue = Promise.resolve();
  const serial = operation => {
    const result = queue.then(operation);
    queue = result.catch(() => {}); // A rejected request must not block later independent requests.
    return result;
  };
  async function load() {
    const saved = (await storage.get(STORE))[STORE];
    if (!saved || saved.version !== 1 || !Array.isArray(saved.accounts) || !Array.isArray(saved.credentials)) {
      throw new Error('Extension storage needs attention. Return to Relay.');
    }
    return saved;
  }
  const save = state => storage.set({ [STORE]: state });
  const accountFor = (state, id) => {
    const account = state.accounts.find(a => a.id === id);
    if (!account) throw new Error('Choose an account first.');
    return account;
  };
  return {
    initialize: () => serial(async () => {
      if ((await storage.get(STORE))[STORE] !== undefined) { await load(); return; }
      await save({ version: 1, accounts: [], credentials: [], enrollment: null });
    }),
    run: (type, data = {}, sender = {}) => serial(async () => {
      const state = await load();
      if (type === 'SAVE_ACCOUNT') {
        const existing = data.id ? state.accounts.find(account => account.id === data.id) : undefined;
        const account = validateAccount({ ...existing, ...data }, state.accounts);
        state.accounts = [...state.accounts.filter(a => a.id !== account.id), account];
      } else if (type === 'ARM') {
        const account = accountFor(state, data.accountId);
        if (!account.enabled) throw new Error('This account is paused.');
        if (!Number.isInteger(data.tabId) || !isDuoOrigin(data.tabUrl)) throw new Error('Choose an open Duo tab.');
        if (!['internal', 'usb'].includes(data.transport)) throw new Error('Choose a supported key type.');
        state.enrollment = { accountId: account.id, tabId: data.tabId, origin: new URL(data.tabUrl).origin,
          transport: data.transport, expiresAt: now() + 10 * 60 * 1000 };
      } else if (type === 'SIGN' || type === 'ENROLL') {
        if (!isDuoOrigin(sender.url) || data.origin !== new URL(sender.url).origin || data.rpId !== 'duosecurity.com') return { ok: false, reason: 'Invalid Duo origin.' };
        if (typeof data.challenge !== 'string' || !data.challenge || base64ToBytes(data.challenge).length > 4096) return { ok: false, reason: 'Invalid challenge.' };
        if (type === 'SIGN') {
          const { credential, reason } = selectCredential(state, data);
          if (!credential) return { ok: false, reason };
          if (data.allowCredentials?.length) {
            await relay.exactCredentialRequested(credential.credentialId, data.requestId);
            credential.status = 'ready';
            await save(state);
          }
          const assertion = await relay.signAssertion(bytesToBase64url(base64ToBytes(credential.credentialId)), data);
          credential.lastUsedAt = now();
          await save(state);
          return { ok: true, ...assertion, credentialId: bytesToBase64(base64ToBytes(assertion.credentialId)), toast: true };
        }
        const arm = state.enrollment;
        if (!arm || arm.expiresAt <= now() || arm.tabId !== sender.tab?.id || arm.origin !== data.origin) return { ok: false, reason: 'Enrollment is not armed for this tab.' };
        const account = accountFor(state, arm.accountId);
        if (!account.enabled) return { ok: false, reason: 'This account is paused.' };
        if (!accountUsernames(account).includes(normalizeUsername(data.username))) {
          const observed = typeof data.username === 'string' ? data.username.trim().slice(0,128) : '';
          const reason = observed ? `Duo is enrolling as ${observed}. Return to Relay to check your account.` : 'Duo did not provide an enrollment username. Use your usual device setup.';
          state.enrollment.error = reason;
          await save(state);
          return { ok: false, reason };
        }
        if (!data.userHandle || !Array.isArray(data.pubKeyCredParams) || !data.pubKeyCredParams.some(p => p.alg === -7)) return { ok: false, reason: 'Unsupported enrollment request.' };
        const transport = data.authenticatorAttachment === 'platform' ? 'internal' : data.authenticatorAttachment === 'cross-platform' ? 'usb' : arm.transport;
        const reg = await createRegistration({ rpId: data.rpId, challenge: base64ToBytes(data.challenge), origin: data.origin, signCount: 0 });
        const credentialId = bytesToBase64(reg.credentialId);
        await relay.persistPending({ credentialId, privateKeyPkcs8: bytesToBase64(reg.privateKeyPkcs8),
          publicKeySpki: bytesToBase64(reg.publicKeySpki), userHandle: data.userHandle, transport,
          isResidentCredential: !!data.residentKey, createdAt: new Date(now()).toISOString() });
        state.credentials.push({ rpId: data.rpId, credentialId, userHandle: data.userHandle, isResidentCredential: !!data.residentKey, transport,
          accountId: account.id, status: 'pending', createdAt: now() });
        state.enrollment = null;
        await relay.recordCeremony(credentialId, data.requestId);
        await save(state);
        return { ok: true, credentialId, transport, toast: true,
          ...Object.fromEntries(['attestationObject', 'clientDataJSON', 'authData', 'publicKeySpki'].map(k => [k, bytesToBase64(reg[k])])) };
      } else throw new Error('Unknown extension request.');
      await save(state);
    }),
  };
}
