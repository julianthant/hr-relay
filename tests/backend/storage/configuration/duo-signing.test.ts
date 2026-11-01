import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, verify } from "node:crypto";
import { describe, it } from "vitest";
import { createDuoAssertion, validateDuoKeyPair, type DuoAssertionRequest } from "../../../../src/backend/storage/configuration/duo-signing.js";

const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const material = { credentialId: "AQID", privateKeyPkcs8: keys.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"), transport: "usb" as const };
const request: DuoAssertionRequest = { requestId: "10000000-0000-4000-8000-000000000001", credentialId: "AQID", rpId: "duosecurity.com", origin: "https://example.duosecurity.com", challenge: "AQID" };

describe("backend Duo assertions", () => {
  it("returns exact WebAuthn client bytes, flags and big-endian count with a verifiable DER signature", () => {
    const result = createDuoAssertion(material, request, 0x01020304);
    const auth = Buffer.from(result.authenticatorData, "base64");
    const client = Buffer.from(result.clientDataJSON, "base64");
    assert.equal(client.toString(), '{"type":"webauthn.get","challenge":"AQID","origin":"https://example.duosecurity.com","crossOrigin":false}');
    assert.equal(auth.length, 37);
    assert.deepEqual(auth.subarray(0, 32), createHash("sha256").update("duosecurity.com").digest());
    assert.deepEqual([...auth.subarray(32)], [5, 1, 2, 3, 4]);
    assert.equal(result.signCount, 0x01020304);
    assert.equal(result.userHandle, null);
    assert.equal(verify("sha256", Buffer.concat([auth, createHash("sha256").update(client).digest()]), keys.publicKey, Buffer.from(result.signature, "base64")), true);
    assert.equal(verify("sha256", Buffer.concat([auth, Buffer.alloc(32)]), keys.publicKey, Buffer.from(result.signature, "base64")), false);
  });
  it("refuses foreign origins, credential mismatch, empty challenges and exhausted counts", () => {
    for (const origin of ["https://duosecurity.com.evil.example", "http://example.duosecurity.com", "https://example.duosecurity.com/path"]) {
      assert.throws(() => createDuoAssertion(material, { ...request, origin }, 1));
    }
    assert.throws(() => createDuoAssertion(material, { ...request, credentialId: "BAUG" }, 1), /duo-signature-input-invalid/u);
    assert.throws(() => createDuoAssertion(material, { ...request, challenge: "" }, 1));
    for (const count of [0, -1, 0x1_0000_0000, 1.5]) assert.throws(() => createDuoAssertion(material, request, count), /duo-signature-input-invalid/u);
    assert.deepEqual([...Buffer.from(createDuoAssertion(material, request, 0xffff_ffff).authenticatorData, "base64").subarray(33)], [255, 255, 255, 255]);
  });
});

describe("canonical Duo key pairs", () => {
  const publicKeySpki = keys.publicKey.export({ format: "der", type: "spki" }).toString("base64");
  it("accepts matching canonical-base64 P-256 material", () => {
    assert.doesNotThrow(() => validateDuoKeyPair(material.privateKeyPkcs8, publicKeySpki));
  });
  it("rejects noncanonical private or public key encodings", () => {
    assert.throws(() => validateDuoKeyPair(`${material.privateKeyPkcs8} `, publicKeySpki), /duo-key-encoding-invalid/u);
    assert.throws(() => validateDuoKeyPair(material.privateKeyPkcs8, `${publicKeySpki}\n`), /duo-key-encoding-invalid/u);
  });
  it("rejects mismatched public keys, other curves and malformed DER", () => {
    const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    assert.throws(() => validateDuoKeyPair(material.privateKeyPkcs8, other.publicKey.export({ format: "der", type: "spki" }).toString("base64")), /duo-key-pair-invalid/u);
    const wrongCurve = generateKeyPairSync("ec", { namedCurve: "secp384r1" });
    assert.throws(() => validateDuoKeyPair(wrongCurve.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"), wrongCurve.publicKey.export({ format: "der", type: "spki" }).toString("base64")), /duo-key-pair-invalid/u);
    assert.throws(() => validateDuoKeyPair(Buffer.from("not DER").toString("base64"), publicKeySpki));
  });
});
