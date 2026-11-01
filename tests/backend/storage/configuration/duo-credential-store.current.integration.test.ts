import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { it } from "vitest";
import { createDuoCredentialStore } from "../../../../src/backend/storage/configuration/duo-credential-store.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

it("keeps enrollment scoped and burns distinct canonical counts across independent signing views", async () => {
  const fixture = await createBoundProfileFixture();
  const clock = manualClock(new Date("2026-11-01T12:00:00.000Z"));
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const scope = { armId: randomUUID(), contextId: "a".repeat(32), tabId: 1, accountId: randomUUID(),
    origin: "https://test.duosecurity.com", rpId: "duosecurity.com", armedAt: clock.now().toISOString(), expiresAt: "2026-11-01T12:10:00.000Z" };
  const credentialId = Buffer.from(randomUUID()).toString("base64url");
  const input = { credentialId, scope, privateKeyPkcs8: keys.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    publicKeySpki: keys.publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    authenticator: { transport: "usb" as const, isResidentCredential: true } };
  try {
    const store = createDuoCredentialStore(fixture.admission, clock);
    const prior = store.read();
    assert.throws(() => store.enroll({ ...input, publicKeySpki: generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ format: "der", type: "spki" }).toString("base64") }), /duo-key-pair-invalid/u);
    assert.deepEqual(store.read(), prior);
    store.enroll(input);
    assert.throws(() => store.confirm(credentialId, { ...scope, tabId: 2 }), /duo-pending-credential-mismatch/u);
    assert.throws(() => store.reserveForAttempt(credentialId, randomUUID(), scope), /duo-ready-credential-required/u);
    store.confirm(credentialId, scope);
    const identity = store.identity();
    const first = { requestId: randomUUID(), credentialId, rpId: "duosecurity.com" as const, origin: scope.origin, challenge: "AQID" };
    const signed = await store.sign(first);
    const fresh = createDuoCredentialStore(fixture.admission, clock);
    const next = await fresh.sign({ ...first, requestId: randomUUID() });
    assert.equal(next.signCount, signed.signCount + 1);
    assert.equal(fresh.identity(), identity);
    await assert.rejects(fresh.sign({ ...first, challenge: "BAUG" }));
    await assert.rejects(fresh.sign({ ...first, requestId: randomUUID(), challenge: Buffer.alloc(4097).toString("base64") }), /duo-challenge-invalid/u);
    assert.equal((await store.sign({ ...first, requestId: randomUUID() })).signCount, next.signCount + 2);
    assert.equal(Object.hasOwn(fresh.credentials().find(row => row.credentialId === credentialId) ?? {}, "privateKeyPkcs8"), false);
    assert.equal(Object.hasOwn(fresh, "erase"), false);
    assert.equal(Object.hasOwn(fresh, "restore"), false);
  } finally { await fixture.close(); }
});
