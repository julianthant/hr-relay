import assert from "node:assert/strict";
import crypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { it, vi } from "vitest";
import { withOperationProof } from "../../../../src/backend/storage/configuration/credential-safe-file.js";
import { createSyntheticVerifier, passwordMatches } from "../../../../src/backend/storage/configuration/synthetic-verifier.js";

it("reuses password derivation within one operation and still checks each verifier", () => {
  const scrypt = vi.spyOn(crypto, "scryptSync");
  const hash = vi.spyOn(crypto, "createHash");
  const compare = vi.spyOn(crypto, "timingSafeEqual");
  syncBuiltinESMExports();
  try {
    const verifier = withOperationProof(() => {
      const created = createSyntheticVerifier(Buffer.alloc(32, 1), "fixture@ucsd.edu", "fixture-password");
      assert.equal(passwordMatches("fixture-password", created), true);
      assert.equal(scrypt.mock.calls.length, 1);
      assert.equal(passwordMatches("fixture-password", { ...created, passwordVerifier: "00".repeat(32) }), false);
      assert.equal(passwordMatches("fixture-password", { ...created, passwordVerifier: "00" }), false);
      assert.equal(passwordMatches("fixture-passw0rd", created), false);
      assert.equal(scrypt.mock.calls.length, 2);
      assert.equal(passwordMatches("fixture-password", { ...created, salt: "00".repeat(16) }), false);
      assert.equal(scrypt.mock.calls.length, 3);
      assert.equal(passwordMatches("fixture-password", created), true);
      assert.equal(scrypt.mock.calls.length, 3);
      return created;
    });
    withOperationProof(() => assert.equal(passwordMatches("fixture-password", verifier), true));
    assert.equal(scrypt.mock.calls.length, 4);
    assert.equal(passwordMatches("fixture-password", verifier), true);
    assert.equal(passwordMatches("fixture-password", verifier), true);
    assert.equal(scrypt.mock.calls.length, 6);
    for (const result of scrypt.mock.results.slice(0, 4)) {
      assert.equal(result.type, "return");
      assert.ok(Buffer.isBuffer(result.value));
      assert.deepEqual(result.value, Buffer.alloc(32));
    }
    for (const call of scrypt.mock.calls) assert.deepEqual(call.slice(2), [32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }]);
    assert.equal(hash.mock.calls.length, 0, "password cache must not create a fast password fingerprint");
    const passwordComparisons = compare.mock.calls.filter(([left]) => left.byteLength === Buffer.byteLength("fixture-password"));
    assert.notEqual(passwordComparisons.length, 0);
    for (const [left, right] of passwordComparisons) {
      assert.deepEqual(left, Buffer.alloc(left.byteLength));
      assert.deepEqual(right, Buffer.alloc(right.byteLength));
    }
  } finally { scrypt.mockRestore(); hash.mockRestore(); compare.mockRestore(); syncBuiltinESMExports(); }
});

it("discards derivations after failed asynchronous operations", async () => {
  const verifier = createSyntheticVerifier(Buffer.alloc(32, 2), "fixture@ucsd.edu", "fixture-password");
  const scrypt = vi.spyOn(crypto, "scryptSync");
  syncBuiltinESMExports();
  try {
    await assert.rejects(withOperationProof(async () => {
      assert.equal(passwordMatches("fixture-password", verifier), true);
      await Promise.resolve();
      withOperationProof(() => assert.equal(passwordMatches("fixture-password", verifier), true));
      assert.equal(scrypt.mock.calls.length, 1);
      throw new Error("fixture-operation-failed");
    }), /fixture-operation-failed/u);
    await withOperationProof(async () => {
      assert.equal(passwordMatches("fixture-password", verifier), true);
      await Promise.resolve();
      assert.equal(passwordMatches("fixture-password", verifier), true);
    });
    assert.equal(scrypt.mock.calls.length, 2);
    for (const result of scrypt.mock.results) {
      assert.equal(result.type, "return");
      assert.ok(Buffer.isBuffer(result.value));
      assert.deepEqual(result.value, Buffer.alloc(32));
    }
  } finally { scrypt.mockRestore(); syncBuiltinESMExports(); }
});

it("keeps concurrent operations and settled async descendants independent", async () => {
  const verifier = createSyntheticVerifier(Buffer.alloc(32, 3), "fixture@ucsd.edu", "fixture-password");
  const scrypt = vi.spyOn(crypto, "scryptSync");
  syncBuiltinESMExports();
  try {
    await Promise.all([1, 2].map(async () => withOperationProof(async () => {
      assert.equal(passwordMatches("fixture-password", verifier), true);
      await Promise.resolve();
      assert.equal(passwordMatches("fixture-password", verifier), true);
    })));
    assert.equal(scrypt.mock.calls.length, 2);
    let release: (() => void) | undefined;
    const settled = new Promise<void>(resolve => { release = resolve; });
    let child: Promise<void> | undefined;
    withOperationProof(() => {
      assert.equal(passwordMatches("fixture-password", verifier), true);
      child = settled.then(() => {
        assert.equal(passwordMatches("fixture-password", verifier), true);
        assert.equal(passwordMatches("fixture-password", verifier), true);
      });
    });
    assert.ok(release);
    release();
    assert.ok(child);
    await child;
    assert.equal(scrypt.mock.calls.length, 5);
  } finally { scrypt.mockRestore(); syncBuiltinESMExports(); }
});
