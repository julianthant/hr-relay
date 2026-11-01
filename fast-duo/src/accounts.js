export { isDuoOrigin } from './duo-origin.js';
import { base64ToBytes, bytesEqual } from './crypto.js';

export const normalizeUsername = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';
export const accountUsernames = account => [account.username, ...(account.aliases || [])];
export function validateAccount(input, accounts = []) {
  const username = normalizeUsername(input.username);
  if (!/^[a-z0-9][a-z0-9._@+-]{0,127}$/.test(username)) throw new Error('Enter a valid username or email address.');
  if (input.aliases !== undefined && !Array.isArray(input.aliases)) throw new Error('Alternate usernames must be a list.');
  const aliases = [...new Set((input.aliases || []).map(normalizeUsername))].filter(name => name !== username);
  if (aliases.length > 20 || aliases.some(name => !/^[a-z0-9][a-z0-9._@+-]{0,127}$/.test(name))) throw new Error('Enter up to 20 valid alternate usernames or email addresses.');
  const names = [username, ...aliases];
  if (accounts.some(a => a.id !== input.id && accountUsernames(a).some(name => names.includes(name)))) throw new Error('A username is already linked to another account. Remove it there before linking it here.');
  const label = String(input.label || username).trim().slice(0, 80);
  const loginUrl = String(input.loginUrl || '').trim();
  if (loginUrl) {
    const url = new URL(loginUrl);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Use an HTTPS login URL without embedded credentials.');
  }
  return { id: input.id || crypto.randomUUID(), username, aliases, label, loginUrl, enabled: input.enabled !== false };
}



/** Credential IDs are authoritative. A username can narrow them, never override them. */
export function selectCredential(state, request) {
  const usernames = [...new Set((request.usernames || []).map(normalizeUsername).filter(Boolean))];
  const matches = usernames.map(name => state.accounts.filter(a => accountUsernames(a).includes(name)));
  if (matches.some(accounts => accounts.length === 0)) return { reason: 'This username has no linked account.' };
  if (matches.some(accounts => accounts.length !== 1) || new Set(matches.map(accounts => accounts[0].id)).size > 1) return { reason: 'Visible usernames identify different accounts. Use your usual Duo method.' };
  const identified = matches[0]?.[0] || null;
  if (identified && !identified.enabled) return { reason: 'This account is paused.' };
  const enabled = new Set(state.accounts.filter(a => a.enabled).map(a => a.id));
  let candidates = state.credentials.filter(c => c.rpId === request.rpId && enabled.has(c.accountId));
  if (identified) candidates = candidates.filter(c => c.accountId === identified.id);
  const allowed = request.allowCredentials || [];
  if (allowed.length) {
    candidates = candidates.filter(c => allowed.some(id => bytesEqual(base64ToBytes(id), base64ToBytes(c.credentialId))));
  } else {
    // Discoverable requests have no server-provided account key. Never choose the first account.
    if (!identified) return { reason: 'Duo did not identify an account. Use your usual Duo method.' };
    candidates = candidates.filter(c => c.status === 'ready' && c.isResidentCredential && c.userHandle);
  }
  if (!candidates.length) return { reason: 'No linked key matches this Duo request.' };
  if (new Set(candidates.map(c => c.accountId)).size !== 1) return { reason: 'The matching keys belong to different accounts.' };
  const credential = candidates.find(c => c.transport === (allowed.length ? 'internal' : 'usb')) || candidates[0];
  return { credential };
}

export function validateCredentials(parsed) {
  const credentials = Array.isArray(parsed) ? parsed : parsed?.credentials;
  if (!Array.isArray(credentials) || !credentials.length) throw new Error('The file contains no Duo credentials.');
  const ids = new Set();
  return credentials.map(c => {
    if (c.rpId !== 'duosecurity.com' || !['internal', 'usb'].includes(c.transport) ||
        !Number.isInteger(c.signCount) || c.signCount < 0 || c.signCount >= 0xffffffff ||
        typeof c.privateKey !== 'string' || !c.privateKey || typeof c.credentialId !== 'string' || !c.credentialId) {
      throw new Error('The file contains an invalid Duo credential. Nothing was imported.');
    }
    const id = btoa(String.fromCharCode(...base64ToBytes(c.credentialId)));
    if (ids.has(id)) throw new Error('The file contains duplicate credentials.');
    ids.add(id);
    base64ToBytes(c.privateKey);
    if (c.userHandle != null) base64ToBytes(c.userHandle);
    return { ...c, credentialId: id };
  });
}
