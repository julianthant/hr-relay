// Pure WebAuthn assertion helpers — the byte-exact core of the software FIDO2
// authenticator. Runs in the MV3 service worker AND under Node (the offline
// test in test/crypto.test.mjs imports this module). Both environments provide
// `crypto.subtle`, `atob`/`btoa`, and `TextEncoder` as globals.
//
// SECURITY: this module touches the private key only inside `createAssertion`,
// where it is imported as a non-extractable WebCrypto key and used to sign. The
// raw key bytes are never logged, stored elsewhere, or returned.

/** BufferSource (ArrayBuffer | TypedArray | DataView) -> Uint8Array view of its bytes. */
export function toU8(buf) {
  if (buf instanceof Uint8Array) return buf;
  if (buf instanceof ArrayBuffer) return new Uint8Array(buf);
  if (ArrayBuffer.isView(buf)) return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  return new Uint8Array(buf);
}

/** Decode standard- or URL-safe base64 (padding optional) into bytes. */
export function base64ToBytes(b64) {
  const norm = String(b64).replace(/-/g, "+").replace(/_/g, "/");
  const padded = norm + "=".repeat((4 - (norm.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Encode bytes as standard base64 (with padding). */
export function bytesToBase64(bytes) {
  const u = toU8(bytes);
  let bin = "";
  for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
  return btoa(bin);
}

/** Encode bytes as URL-safe base64 with no padding (WebAuthn `challenge`/`id` form). */
export function bytesToBase64url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Concatenate Uint8Arrays into one. */
export function concatBytes(...arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

/** Constant-time-ish byte equality (lengths must match). */
export function bytesEqual(a, b) {
  const x = toU8(a);
  const y = toU8(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/** SHA-256 of bytes -> Uint8Array(32). */
export async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", toU8(bytes));
  return new Uint8Array(digest);
}

/**
 * Convert a raw ECDSA P-256 signature (r||s, 64 bytes) into the DER/ASN.1
 * `SEQUENCE { INTEGER r, INTEGER s }` form WebAuthn assertions require. WebCrypto
 * `sign()` returns raw; Duo's server parses DER — so this conversion is mandatory.
 */
export function rawEcdsaSigToDer(raw) {
  const r = raw.slice(0, 32);
  const s = raw.slice(32, 64);
  const enc = (b) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++; // trim leading zeros
    let v = b.slice(i);
    if (v[0] & 0x80) v = Uint8Array.from([0, ...v]); // prepend 0x00 if high bit set
    return Uint8Array.from([0x02, v.length, ...v]); // INTEGER
  };
  const re = enc(r);
  const se = enc(s);
  return Uint8Array.from([0x30, re.length + se.length, ...re, ...se]); // SEQUENCE
}

/**
 * Build the exact `clientDataJSON` bytes for a WebAuthn ceremony. Key order is
 * fixed and load-bearing (some RPs hash the literal string). `challenge` is
 * base64url with no padding; `origin` is the page's real `location.origin`.
 */
export function buildClientDataJSON(challengeBytes, origin) {
  const json = JSON.stringify({
    type: "webauthn.get",
    challenge: bytesToBase64url(challengeBytes),
    origin,
    crossOrigin: false,
  });
  return { json, bytes: new TextEncoder().encode(json) };
}

/**
 * Build authenticatorData for an assertion (37 bytes):
 *   rpIdHash(32) || flags(1) || signCount(4, big-endian).
 * `rpId` is the rpId STRING (e.g. "duosecurity.com"), not the origin. Default
 * flags 0x05 = UP (user present) | UV (user verified).
 */
export async function buildAuthenticatorData(rpId, flags, signCount) {
  const rpIdHash = await sha256(new TextEncoder().encode(rpId));
  const sc = new Uint8Array(4);
  new DataView(sc.buffer).setUint32(0, signCount >>> 0, false); // big-endian
  return concatBytes(rpIdHash, Uint8Array.from([flags & 0xff]), sc);
}

/** Import a PKCS#8 EC P-256 private key for signing (non-extractable). */
export async function importEcdsaPrivateKey(pkcs8Bytes) {
  return crypto.subtle.importKey(
    "pkcs8",
    toU8(pkcs8Bytes),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

/**
 * Produce the three response components of a WebAuthn assertion, byte-exact:
 *   - authenticatorData (37 bytes)
 *   - clientDataJSON     (the signed-over bytes)
 *   - signature          (DER-encoded ECDSA P-256)
 *
 * The signature is over `authenticatorData || SHA-256(clientDataJSON)`. Returns
 * the SAME clientDataJSON bytes that were hashed, so the caller's assembled
 * credential and the signature can never disagree.
 */
export async function createAssertion({ privateKeyPkcs8, rpId, challenge, origin, signCount, flags = 0x05 }) {
  const authenticatorData = await buildAuthenticatorData(rpId, flags, signCount);
  const { bytes: clientDataJSON } = buildClientDataJSON(challenge, origin);
  const clientDataHash = await sha256(clientDataJSON);
  const dataToSign = concatBytes(authenticatorData, clientDataHash);
  const key = await importEcdsaPrivateKey(privateKeyPkcs8);
  const rawSig = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, dataToSign),
  );
  return { authenticatorData, clientDataJSON, signature: rawEcdsaSigToDer(rawSig) };
}
