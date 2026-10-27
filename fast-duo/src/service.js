import { base64ToBytes, bytesToBase64, createAssertion, createRegistration, importEcdsaPrivateKey } from './crypto.js';
import { nextSignCount } from './sign-count.js';
import { normalizeUsername, accountUsernames, validateAccount, validateCredentials, selectCredential, isDuoOrigin } from './accounts.js';

const STORE = 'autopilotV1';
const defaultSettings = { enabled: true, trustClick: false, toast: true };
export function createService(storage, now = () => Date.now()) {
  let queue = Promise.resolve();
  const serial = operation => {
    const result = queue.then(operation);
    queue = result.catch(() => {}); // A rejected request must not block later independent requests.
    return result;
  };
  async function load() {
    const saved = (await storage.get(STORE))[STORE];
    if (!saved || saved.version !== 1 || !Array.isArray(saved.accounts) || !Array.isArray(saved.credentials)) {
      throw new Error('Extension storage needs attention. Reload the extension.');
    }
    return saved;
  }
  const save = state => storage.set({ [STORE]: state });
  function event(state, message, accountId = null) {
    state.events = [{ at: now(), message, accountId }, ...state.events].slice(0, 12);
  }
  const publicState = state => ({ ...state, credentials: state.credentials.map(c => ({
    credentialId: c.credentialId, accountId: c.accountId, transport: c.transport,
    status: c.status, createdAt: c.createdAt, lastUsedAt: c.lastUsedAt,
  })), enrollment: state.enrollment && state.enrollment.expiresAt > now() ? state.enrollment : null });
  const accountFor = (state, id) => {
    const account = state.accounts.find(a => a.id === id);
    if (!account) throw new Error('Choose an account first.');
    return account;
  };
  async function checkedCredentials(parsed) {
    const creds = validateCredentials(parsed);
    for (const c of creds) await importEcdsaPrivateKey(base64ToBytes(c.privateKey));
    return creds;
  }
  async function applyAliasMigrations(state, bootstrap) {
    const applied = new Set(state.appliedAliasMigrations || []);
    let changed = false;
    for (const migration of bootstrap.aliasMigrations || []) {
      if (typeof migration.id !== 'string' || !migration.id) throw new Error('Invalid account alias migration.');
      if (applied.has(migration.id)) continue;
      const owner = state.accounts.find(a => a.username === normalizeUsername(migration.ownerUsername));
      // A removed owner stays removed. Never recreate accounts or keys from bootstrap.
      if (owner) {
        const username = validateAccount({ username: migration.username }).username;
        const source = state.accounts.find(a => a.id !== owner.id && a.username === username);
        const remaining = state.accounts.filter(a => a.id !== source?.id);
        const updated = validateAccount({ ...owner, aliases: [...(owner.aliases || []), username, ...(source?.aliases || [])] }, remaining);
        state.accounts = remaining.map(a => a.id === owner.id ? updated : a);
        if (source) {
          for (const credential of state.credentials) if (credential.accountId === source.id) credential.accountId = owner.id;
          if (state.enrollment?.accountId === source.id) state.enrollment = null;
          for (const entry of state.events) if (entry.accountId === source.id) entry.accountId = owner.id;
        }
        event(state, 'Alternate username linked to this account’s keys.', owner.id);
      }
      applied.add(migration.id);
      changed = true;
    }
    if (changed) { state.appliedAliasMigrations = [...applied]; await save(state); }
  }
  return {
    initialize: bootstrap => serial(async () => {
      const old = await storage.get([STORE, 'duoCredentials', 'settings']);
      if (old[STORE]) { await applyAliasMigrations(await load(), bootstrap); return; }
      const accounts = [];
      for (const input of bootstrap.accounts || []) accounts.push(validateAccount(input, accounts));
      const supplied = old.duoCredentials?.length ? old.duoCredentials : bootstrap.credentials;
      const owner = accounts.find(a => a.username === normalizeUsername(bootstrap.owner));
      const credentials = supplied?.length ? (await checkedCredentials(supplied)).map(c => ({
        ...c, accountId: owner?.id || null, status: 'ready', signCount: nextSignCount(c.signCount, Math.floor(now() / 1000)),
      })) : [];
      await save({ version: 1, accounts, credentials, settings: { ...defaultSettings, ...old.settings }, enrollment: null, events: [] });
      await storage.remove(['duoCredentials', 'settings', 'enroll']);
      await applyAliasMigrations(await load(), bootstrap);
    }),
    run: (type, data = {}, sender = {}) => serial(async () => {
      const state = await load();
      if (type === 'STATE') return publicState(state);
      if (type === 'SETTINGS') return { enabled: state.settings.enabled, trustClick: state.settings.trustClick, toast: state.settings.toast };
      if (type === 'SAVE_ACCOUNT') {
        const existing = data.id ? accountFor(state, data.id) : {};
        const account = validateAccount({ ...existing, ...data }, state.accounts);
        state.accounts = [...state.accounts.filter(a => a.id !== account.id), account];
        event(state, 'Account saved.', account.id);
      } else if (type === 'SAVE_ALIASES') {
        if (!Array.isArray(data.aliases)) throw new Error('Alternate usernames must be a list.');
        const account = accountFor(state, data.accountId);
        const updated = validateAccount({ ...account, aliases: data.aliases }, state.accounts);
        state.accounts = state.accounts.map(a => a.id === account.id ? updated : a);
        event(state, 'Alternate usernames saved.', account.id);
      } else if (type === 'TOGGLE_ACCOUNT') {
        const account = accountFor(state, data.accountId);
        account.enabled = !account.enabled;
        if (!account.enabled && state.enrollment?.accountId === account.id) state.enrollment = null;
      } else if (type === 'SAVE_SETTINGS') {
        for (const key of Object.keys(defaultSettings)) if (typeof data[key] === 'boolean') state.settings[key] = data[key];
        if (!state.settings.enabled) state.enrollment = null;
      } else if (type === 'IMPORT') {
        accountFor(state, data.accountId);
        const imported = await checkedCredentials(data.parsed);
        for (const c of imported) {
          const existing = state.credentials.find(x => x.credentialId === c.credentialId);
          if (existing?.accountId && existing.accountId !== data.accountId) throw new Error('A key is already linked to another account. Nothing was imported.');
        }
        state.credentials = state.credentials.filter(c => !imported.some(i => i.credentialId === c.credentialId)).concat(imported.map(c => ({
          ...c, accountId: data.accountId, status: 'ready',
          signCount: nextSignCount(Math.max(c.signCount, state.credentials.find(x => x.credentialId === c.credentialId)?.signCount || 0), Math.floor(now() / 1000)),
        })));
        event(state, 'Existing keys imported.', data.accountId);
      } else if (type === 'LINK_LEGACY') {
        accountFor(state, data.accountId);
        for (const c of state.credentials) if (!c.accountId) c.accountId = data.accountId;
      } else if (type === 'REMOVE_ACCOUNT') {
        accountFor(state, data.accountId);
        state.accounts = state.accounts.filter(a => a.id !== data.accountId);
        state.credentials = state.credentials.filter(c => c.accountId !== data.accountId);
        if (state.enrollment?.accountId === data.accountId) state.enrollment = null;
        event(state, 'Account and local keys removed.');
      } else if (type === 'ARM') {
        const account = accountFor(state, data.accountId);
        if (!state.settings.enabled || !account.enabled) throw new Error('Resume Autopilot and this account before setup.');
        if (!Number.isInteger(data.tabId) || !isDuoOrigin(data.tabUrl)) throw new Error('Choose an open Duo tab.');
        if (!['internal', 'usb'].includes(data.transport)) throw new Error('Choose a supported key type.');
        state.enrollment = { accountId: account.id, tabId: data.tabId, origin: new URL(data.tabUrl).origin,
          transport: data.transport, expiresAt: now() + 10 * 60 * 1000 };
        event(state, 'Waiting for device enrollment in the selected Duo tab.', account.id);
      } else if (type === 'CANCEL') {
        state.enrollment = null;
      } else if (type === 'DISCARD_PENDING') {
        const pending = state.credentials.find(c => c.credentialId === data.credentialId && c.status === 'pending');
        if (!pending) throw new Error('Only an unconfirmed key can be discarded here.');
        state.credentials = state.credentials.filter(c => c !== pending);
        event(state, 'Unconfirmed local key discarded.', pending.accountId);
      } else if (type === 'CONFIRM') {
        const pending = state.credentials.find(c => c.credentialId === data.credentialId && c.status === 'pending');
        if (!pending) throw new Error('This key is no longer waiting for confirmation.');
        pending.status = 'ready';
        event(state, 'Device enrollment confirmed by you.', pending.accountId);
      } else if (type === 'SIGN' || type === 'ENROLL') {
        if (!isDuoOrigin(sender.url) || data.origin !== new URL(sender.url).origin || data.rpId !== 'duosecurity.com') return { ok: false, reason: 'Invalid Duo origin.' };
        if (!state.settings.enabled) return { ok: false, reason: 'Autopilot is paused.' };
        if (typeof data.challenge !== 'string' || !data.challenge || base64ToBytes(data.challenge).length > 4096) return { ok: false, reason: 'Invalid challenge.' };
        if (type === 'SIGN') {
          const { credential, reason } = selectCredential(state, data);
          if (!credential) { event(state, reason); await save(state); return { ok: false, reason }; }
          credential.signCount = nextSignCount(credential.signCount, Math.floor(now() / 1000));
          if (credential.signCount >= 0xffffffff) throw new Error('Key counter exhausted. Enroll a new key.');
          credential.lastUsedAt = now();
          // Duo requesting this exact ID proves it knows the newly registered key.
          if (data.allowCredentials?.length) credential.status = 'ready';
          await save(state); // Persist the counter before releasing the assertion.
          const assertion = await createAssertion({ privateKeyPkcs8: base64ToBytes(credential.privateKey),
            rpId: data.rpId, challenge: base64ToBytes(data.challenge), origin: data.origin, signCount: credential.signCount });
          event(state, 'Answered a Duo key request.', credential.accountId);
          await save(state);
          return { ok: true, ...Object.fromEntries(Object.entries(assertion).map(([k,v]) => [k, bytesToBase64(v)])),
            credentialId: credential.credentialId, userHandle: credential.userHandle || null, transport: credential.transport, toast: state.settings.toast };
        }
        const arm = state.enrollment;
        if (!arm || arm.expiresAt <= now() || arm.tabId !== sender.tab?.id || arm.origin !== data.origin) return { ok: false, reason: 'Enrollment is not armed for this tab.' };
        const account = accountFor(state, arm.accountId);
        if (!account.enabled) return { ok: false, reason: 'This account is paused.' };
        if (!accountUsernames(account).includes(normalizeUsername(data.username))) {
          const observed = typeof data.username === 'string' ? data.username.trim().slice(0,128) : '';
          const reason = observed ? `Duo is enrolling as ${observed}. Add that alternate username to this account, or switch Duo accounts.` : 'Duo did not provide an enrollment username. Use your usual device setup.';
          state.enrollment.error = reason;
          await save(state);
          return { ok: false, reason };
        }
        if (!data.userHandle || !Array.isArray(data.pubKeyCredParams) || !data.pubKeyCredParams.some(p => p.alg === -7)) return { ok: false, reason: 'Unsupported enrollment request.' };
        const transport = data.authenticatorAttachment === 'platform' ? 'internal' : data.authenticatorAttachment === 'cross-platform' ? 'usb' : arm.transport;
        const reg = await createRegistration({ rpId: data.rpId, challenge: base64ToBytes(data.challenge), origin: data.origin, signCount: 0 });
        const credentialId = bytesToBase64(reg.credentialId);
        state.credentials.push({ rpId: data.rpId, credentialId, privateKey: bytesToBase64(reg.privateKeyPkcs8),
          userHandle: data.userHandle, signCount: 0, isResidentCredential: !!data.residentKey, transport,
          accountId: account.id, status: 'pending', createdAt: now() });
        state.enrollment = null;
        event(state, 'Key captured. Finish adding the device in Duo.', account.id);
        await save(state);
        return { ok: true, credentialId, transport, toast: state.settings.toast,
          ...Object.fromEntries(['attestationObject', 'clientDataJSON', 'authData', 'publicKeySpki'].map(k => [k, bytesToBase64(reg[k])])) };
      } else throw new Error('Unknown extension request.');
      await save(state);
      return publicState(state);
    }),
  };
}
