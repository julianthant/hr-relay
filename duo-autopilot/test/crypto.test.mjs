// Offline self-test for the WebAuthn assertion path and native registration boundary.
// Uses a freshly generated throwaway P-256 key — NEVER the real Duo secret — and
// proves that:
//   1. base64 / base64url round-trip correctly,
//   2. rawEcdsaSigToDer handles leading-zero trimming and high-bit padding,
//   3. authenticatorData is the right 37 bytes (rpIdHash | 0x05 | signCount BE),
//   4. clientDataJSON is exact (order, base64url challenge, origin, crossOrigin),
//   5. the DER signature created by createAssertion verifies against the public
//      key over `authenticatorData || SHA-256(clientDataJSON)` — i.e. exactly what
//      Duo's server checks,
//   6. the inpage shim leaves `navigator.credentials.create()` to the browser.
//
// Run: node test/crypto.test.mjs   (or: npm test)

import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import {
  base64ToBytes,
  bytesToBase64,
  bytesToBase64url,
  buildAuthenticatorData,
  buildClientDataJSON,
  concatBytes,
  createAssertion,
  rawEcdsaSigToDer,
  sha256,
} from "../src/crypto.js";

let passed = 0;
let failed = 0;
function ok(name, cond) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}
function eqBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Parse DER ECDSA SEQUENCE{INTEGER r, INTEGER s} back into raw r||s (64 bytes). */
function derToRawEcdsaSig(der) {
  let i = 0;
  if (der[i++] !== 0x30) throw new Error("bad SEQUENCE");
  i++; // total length
  const readInt = () => {
    if (der[i++] !== 0x02) throw new Error("bad INTEGER");
    let len = der[i++];
    let val = der.slice(i, i + len);
    i += len;
    // strip a leading 0x00 padding byte
    if (val.length > 32 && val[0] === 0x00) val = val.slice(1);
    // left-pad to 32 bytes
    const out = new Uint8Array(32);
    out.set(val, 32 - val.length);
    return out;
  };
  const r = readInt();
  const s = readInt();
  return concatBytes(r, s);
}

async function run() {
  console.log("Duo Autopilot offline self-test");

  // ── 1. base64 round-trips ──
  {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 255, 128, 127]);
    ok("base64 round-trip", eqBytes(base64ToBytes(bytesToBase64(bytes)), bytes));
    ok("base64url has no padding / url-safe chars", !/[+/=]/.test(bytesToBase64url(bytes)));
    // url-safe decoding accepts both alphabets
    ok("base64url decodes back", eqBytes(base64ToBytes(bytesToBase64url(bytes)), bytes));
    // known vector: 0xfb 0xff 0xbf -> standard "+/+", url-safe "-_-"
    ok("base64url maps +/ to -_", bytesToBase64url(new Uint8Array([0xfb, 0xff, 0xbf])) === "-_-_");
  }

  // ── 2. rawEcdsaSigToDer edge cases ──
  {
    // r high-bit set -> 0x00 prepended; s small with leading zeros -> trimmed.
    const raw = new Uint8Array(64);
    raw[0] = 0x80; // r starts with high bit
    for (let i = 1; i < 32; i++) raw[i] = 0x11;
    // s = 0x00...0x01 (all leading zeros but one)
    raw[63] = 0x01;
    const der = rawEcdsaSigToDer(raw);
    ok("DER starts with SEQUENCE tag", der[0] === 0x30);
    ok("DER total length matches", der[1] === der.length - 2);
    // first INTEGER: 0x02, len 33 (32 + prepended 0x00), value starts 0x00 0x80
    ok("r INTEGER padded for high bit", der[2] === 0x02 && der[3] === 33 && der[4] === 0x00 && der[5] === 0x80);
    // round-trips back to the same raw
    ok("DER round-trips to raw", eqBytes(derToRawEcdsaSig(der), raw));

    // small canonical sig with no padding needed
    const raw2 = new Uint8Array(64);
    raw2[31] = 0x07; // r = 7
    raw2[63] = 0x09; // s = 9
    const der2 = rawEcdsaSigToDer(raw2);
    ok("tiny r/s encode as single-byte INTEGERs", der2[2] === 0x02 && der2[3] === 1 && der2[4] === 0x07);
    ok("tiny sig round-trips", eqBytes(derToRawEcdsaSig(der2), raw2));
  }

  // ── 3 & 4 & 5. full assertion with a throwaway key ──
  {
    const rpId = "duosecurity.com";
    const origin = "https://api-duo1.duosecurity.com";
    const signCount = 100221;
    const challenge = crypto.getRandomValues(new Uint8Array(32));

    const keyPair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    );
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keyPair.privateKey));

    // authenticatorData shape
    const authData = await buildAuthenticatorData(rpId, 0x05, signCount);
    ok("authData is 37 bytes", authData.length === 37);
    const rpIdHash = await sha256(new TextEncoder().encode(rpId));
    ok("authData[0..32] = SHA-256(rpId)", eqBytes(authData.slice(0, 32), rpIdHash));
    ok("authData flags = 0x05 (UP|UV)", authData[32] === 0x05);
    ok(
      "authData signCount = big-endian counter",
      authData[33] === ((signCount >>> 24) & 0xff) &&
        authData[34] === ((signCount >>> 16) & 0xff) &&
        authData[35] === ((signCount >>> 8) & 0xff) &&
        authData[36] === (signCount & 0xff),
    );

    // clientDataJSON exactness
    const { json, bytes: cdjBytes } = buildClientDataJSON(challenge, origin);
    const parsed = JSON.parse(json);
    ok("clientData type", parsed.type === "webauthn.get");
    ok("clientData challenge is base64url(challenge)", parsed.challenge === bytesToBase64url(challenge));
    ok("clientData origin", parsed.origin === origin);
    ok("clientData crossOrigin false", parsed.crossOrigin === false);
    ok(
      "clientDataJSON key order is type,challenge,origin,crossOrigin",
      json.startsWith('{"type":"webauthn.get","challenge":"') &&
        json.includes('","origin":"') &&
        json.endsWith('","crossOrigin":false}'),
    );

    // createAssertion -> signature verifies (what Duo's server does)
    const assertion = await createAssertion({
      privateKeyPkcs8: pkcs8,
      rpId,
      challenge,
      origin,
      signCount,
    });
    ok("createAssertion authData matches buildAuthenticatorData", eqBytes(assertion.authenticatorData, authData));
    ok("createAssertion clientDataJSON matches", eqBytes(assertion.clientDataJSON, cdjBytes));

    const clientDataHash = await sha256(assertion.clientDataJSON);
    const signedData = concatBytes(assertion.authenticatorData, clientDataHash);
    const rawSig = derToRawEcdsaSig(assertion.signature);
    const verified = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      keyPair.publicKey,
      rawSig,
      signedData,
    );
    ok("assertion signature verifies against the public key", verified === true);

    // negative: tampering authData breaks verification
    const tampered = signedData.slice();
    tampered[32] ^= 0xff;
    const verifiedTampered = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      keyPair.publicKey,
      rawSig,
      tampered,
    );
    ok("tampered data fails verification", verifiedTampered === false);
  }

  // Native registration remains available to the browser.
  {
    const nativeCreate = async (options) => options;
    const credentials = { get: async () => undefined, create: nativeCreate };
    runInNewContext(await readFile(new URL("../src/inpage.js", import.meta.url), "utf8"), {
      navigator: { credentials },
      window: { addEventListener() {} },
      location: { origin: "https://api-duo1.duosecurity.com", hostname: "api-duo1.duosecurity.com" },
      console: { debug() {} },
    });
    const options = { publicKey: { rp: { id: "duosecurity.com" }, challenge: new Uint8Array([1]) } };
    ok(
      "Duo registration keeps the browser's native create method",
      credentials.create === nativeCreate && await credentials.create(options) === options,
    );
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
