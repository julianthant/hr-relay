import { createCanonicalCredentials } from "../../../../src/backend/storage/configuration/canonical-credential-store.js";
import { DuoCredentialRecordSchema } from "../../../../src/models/config/duo-credential-store.js";
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

it("rehydrates only ready internal material without exposing it publicly or reserving a signing counter", async () => {
  const fixture = await createBoundProfileFixture();
  const clock = manualClock(new Date("2026-11-01T12:00:00.000Z"));
  const store = createDuoCredentialStore(fixture.admission, clock);
  const credentials = (["usb", "internal"] as const).map(transport => {
    const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    return { credentialId: Buffer.from(randomUUID()).toString("base64url"),
      scope: { armId: randomUUID(), contextId: "b".repeat(32), tabId: 1, accountId: "00000000-0000-4000-8000-000000000010",
        origin: "https://test.duosecurity.com", rpId: "duosecurity.com", armedAt: clock.now().toISOString(), expiresAt: "2026-11-01T12:10:00.000Z" },
      privateKeyPkcs8: keys.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
      publicKeySpki: keys.publicKey.export({ format: "der", type: "spki" }).toString("base64"),
      authenticator: { transport,
        isResidentCredential: true, userHandle: Buffer.from("synthetic-platform-user").toString("base64") } };
  });
  try {
    for (const credential of credentials) store.enroll({ ...credential, ...(credential.authenticator.transport === "internal" ? { initialSignCount: 1 } : {}) });
    assert.equal(store.platformCredentials().length, 0);
    const [usb, internal] = credentials;
    store.confirm(usb.credentialId, usb.scope);
    assert.equal(store.platformCredentials().length, 0);
    store.confirm(internal.credentialId, internal.scope);
    const prior = store.read(), material = store.platformCredentials();
    assert.equal(material.length, 1); assert.equal(material[0].credentialId, internal.credentialId);
    assert.ok(material[0].privateKeyPkcs8 === internal.privateKeyPkcs8);
    assert.deepEqual(store.read(), prior);
    const fresh = createDuoCredentialStore(fixture.admission, clock);
    assert.equal(fresh.platformCredentials().length, 1);
    assert.ok(fresh.platformCredentials()[0].privateKeyPkcs8 === internal.privateKeyPkcs8);
    assert.equal(fresh.credentials().some(credential => Object.hasOwn(credential, "privateKeyPkcs8")), false);
    const request = { requestId: randomUUID(), credentialId: internal.credentialId, rpId: "duosecurity.com" as const,
      origin: internal.scope.origin, challenge: "AQID" };
    assert.equal(material[0].signCount, 1);
    assert.equal((await fresh.sign(request)).signCount, 2);
    assert.equal((await store.sign({ ...request, requestId: randomUUID() })).signCount, 3);
    const owner = createCanonicalCredentials(fixture.admission), frame = owner.readRecord("duo");
    assert.ok(frame);
    const document = DuoCredentialRecordSchema.parse(frame.value);
    const unknown = { ...internal, credentialId: Buffer.from(randomUUID()).toString("base64url"), state: "ready" as const,
      createdAt: clock.now().toISOString(), confirmedAt: clock.now().toISOString() };
    owner.replaceRecord("duo", frame.revision, DuoCredentialRecordSchema.parse({ credentials: [...document.credentials, unknown] }));
    assert.throws(() => fresh.platformCredentials(), { code: "DUO_CREDENTIAL_UNAVAILABLE" });
    await assert.rejects(fresh.sign({ ...request, requestId: randomUUID(), credentialId: unknown.credentialId }), { code: "DUO_CREDENTIAL_UNAVAILABLE" });
    assert.throws(() => owner.initializePendingDuoCounter(unknown.credentialId, 1), { code: "CREDENTIAL_UNAVAILABLE" });
  } finally { await fixture.close(); }
});
