// Service worker — the ONLY place the Duo private key is used. The MAIN-world
// shim (inpage.js) never sees the key; it sends Duo's challenge here, this worker
// signs it, bumps the signCount, and returns only the (public, single-use)
// assertion components. See BUILD_PLAN.md §3 and §7.

import { base64ToBytes, bytesToBase64, bytesEqual, createAssertion } from "./crypto.js";
import { nextSignCount } from "./sign-count.js";

const STORAGE_KEY = "duoCredentials";
const RP_ID = "duosecurity.com";
/** The backend provisions this trusted session on every owned launch. */
async function loadCredentials() {
  const data = await chrome.storage.session.get(STORAGE_KEY);
  const creds = data[STORAGE_KEY];
  if (!Array.isArray(creds) || creds.length === 0) throw new Error("duo-session-not-provisioned");
  return creds;
}

/** Read autopilot settings, with everything defaulting ON. */
async function loadSettings() {
  const data = await chrome.storage.local.get("settings");
  const s = data.settings || {};
  return {
    enabled: s.enabled !== false, // master kill switch
    trustClick: s.trustClick !== false,
    toast: s.toast !== false,
  };
}

/**
 * Persist an advanced signCount monotonically. Re-reads storage so a concurrent
 * write isn't clobbered, and only ever raises the counter (never lowers it).
 */
async function persistSignCount(credentialId, newCount) {
  const creds = await loadCredentials();
  let changed = false;
  for (const c of creds) {
    if (c.credentialId === credentialId && newCount > (Number(c.signCount) || 0)) {
      c.signCount = newCount;
      changed = true;
    }
  }
  if (changed) await chrome.storage.session.set({ [STORAGE_KEY]: creds });
}

/**
 * Pick which credential answers this ceremony (BUILD_PLAN §3.4, §11.6):
 *  - scoped to the request's rpId;
 *  - if `allowCredentials` is non-empty, the credential whose id is listed
 *    (preferring the platform/`internal` one — a security key is rejected by
 *    UCPath's policy, Touch ID is accepted everywhere);
 *  - if `allowCredentials` is empty (ACT CRM's discoverable auto-fire), the
 *    resident `usb` credential CRM expects, falling back to any for the rpId.
 * Returns undefined when nothing matches, so the shim defers to the real `get()`.
 */
function pickCredential(creds, rpId, allowCredentials) {
  const forRp = creds.filter((c) => c.rpId === rpId);
  if (forRp.length === 0) return undefined;

  if (Array.isArray(allowCredentials) && allowCredentials.length > 0) {
    const allow = allowCredentials.map((id) => base64ToBytes(id));
    const matches = forRp.filter((c) =>
      allow.some((a) => bytesEqual(a, base64ToBytes(c.credentialId))),
    );
    if (matches.length === 0) return undefined;
    return matches.find((c) => c.transport === "internal") || matches[0];
  }

  return forRp.find((c) => c.transport === "usb") || forRp[0];
}

/** Core sign handler. Returns base64-encoded assertion components or {ok:false}. */
async function handleSign(req) {
  const settings = await loadSettings();
  if (!settings.enabled) {
    return { ok: false, reason: "disabled" };
  }

  const creds = await loadCredentials();
  if (creds.length === 0) return { ok: false, reason: "no-credentials-loaded" };

  const rpId = (req && req.rpId) || RP_ID;
  if (rpId !== RP_ID) return { ok: false, reason: "rpId-not-duosecurity" };

  const cred = pickCredential(creds, rpId, req.allowCredentials);
  if (!cred) {
    return { ok: false, reason: "no-matching-credential" };
  }
  // Counter is load-bearing: advance and PERSIST before returning. Duo may
  // observe the new counter even if the login later fails, so persisting eagerly
  // keeps the file at-or-ahead of Duo's view (BUILD_PLAN §6.5).
  //
  // D243: the advance is floored at WALL-CLOCK seconds, not `+ 1`. Duo's counter
  // is per-credential and shared by every browser profile that replays this key,
  // while our copy is per-profile — see sign-count.js for the whole argument and
  // for the wedge that `+ 1` caused.
  const oldCount = Number(cred.signCount) || 0;
  const newCount = nextSignCount(oldCount, Math.floor(Date.now() / 1000));
  await persistSignCount(cred.credentialId, newCount);

  const { authenticatorData, clientDataJSON, signature } = await createAssertion({
    privateKeyPkcs8: base64ToBytes(cred.privateKey),
    rpId,
    challenge: base64ToBytes(req.challenge),
    origin: req.origin,
    signCount: newCount,
  });

  return {
    ok: true,
    authenticatorData: bytesToBase64(authenticatorData),
    clientDataJSON: bytesToBase64(clientDataJSON),
    signature: bytesToBase64(signature),
    userHandle: cred.userHandle || null, // already base64, or null
    credentialId: cred.credentialId, // base64
    transport: cred.transport,
    signCount: newCount,
    toast: settings.toast, // let the shim show its on-page confirmation
  };
}

// Serialize signs so two concurrent ceremonies can't race the signCount
// read-modify-write. Each request waits for the previous to fully settle.
let signQueue = Promise.resolve();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || (msg.type !== "DUO_AUTOPILOT_SIGN" && msg.type !== "DUO_AUTOPILOT_ENROLL")) return undefined;

  // Only honor requests from our content script running on the Duo host.
  const url = (sender && sender.url) || "";
  if (!/^https:\/\/([^/]+\.)?duosecurity\.com\//.test(url)) {
    sendResponse({ ok: false, reason: "bad-origin" });
    return false;
  }

  if (msg.type === "DUO_AUTOPILOT_ENROLL") {
    sendResponse({ ok: false, reason: "canonical-credential-enrollment-required" });
    return false;
  }

  // DUO_AUTOPILOT_SIGN — serialize through the signCount queue.
  const result = signQueue
    .then(() => handleSign(msg.request))
    .catch(() => ({ ok: false, reason: "duo-signing-failed" }));
  // Next request waits for this one to settle (success or failure).
  signQueue = result.then(
    () => undefined,
    () => undefined,
  );
  result.then((res) => sendResponse(res));
  return true; // keep the message channel open for the async sendResponse
});
