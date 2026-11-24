import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import fs, { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { basename, join } from "node:path";
import { z } from "zod";
import { it, vi } from "vitest";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { CanonicalCredentialHeadSchema } from "../../../../src/backend/storage/configuration/canonical-credential-store.js";
import { createDuoCredentialStore } from "../../../../src/backend/storage/configuration/duo-credential-store.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { createBoundProfileFixture, readAuthenticatedCredentialFixture, rewriteAuthenticatedCredentialFixture, signInBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

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

it("drops a stored Touch ID row at first open and keeps signing with the security key", async () => {
  const fixture = await createBoundProfileFixture();
  const clock = manualClock(new Date("2026-11-01T12:00:00.000Z"));
  const machineRoot = fixture.machine.stateRoot, profileId = fixture.admission.profileBinding.profileId;
  const material = () => {
    const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    return { credentialId: Buffer.from(randomUUID()).toString("base64url"),
      privateKeyPkcs8: keys.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
      publicKeySpki: keys.publicKey.export({ format: "der", type: "spki" }).toString("base64") };
  };
  const scope = { armId: randomUUID(), contextId: "b".repeat(32), tabId: 1, accountId: "00000000-0000-4000-8000-000000000010",
    origin: "https://test.duosecurity.com", rpId: "duosecurity.com", armedAt: clock.now().toISOString(), expiresAt: "2026-11-01T12:10:00.000Z" };
  const key = { ...material(), scope, authenticator: { transport: "usb" as const, isResidentCredential: false } };
  try {
    const store = createDuoCredentialStore(fixture.admission, clock);
    store.enroll(key); store.confirm(key.credentialId, scope);
    const identity = store.identity(), ready = store.credentials();
    const RecordSchema = z.looseObject({ credentials: z.array(z.looseObject({ credentialId: z.string(), authenticator: z.looseObject({ transport: z.string() }).optional() })) });
    const keyRows = () => RecordSchema.parse(readAuthenticatedCredentialFixture(machineRoot, profileId, "duo")).credentials.map(row => [row.credentialId, row.authenticator?.transport]);
    const before = keyRows();
    assert.ok(before.every(([, transport]) => transport === "usb") && before.some(([id]) => id === key.credentialId));
    const touch = { ...RecordSchema.parse(readAuthenticatedCredentialFixture(machineRoot, profileId, "duo")).credentials[0], ...material(),
      authenticator: { transport: "internal", isResidentCredential: true, userHandle: Buffer.from("synthetic-platform-user").toString("base64") } };
    rewriteAuthenticatedCredentialFixture(machineRoot, profileId, value => ({ credentials: [...RecordSchema.parse(value).credentials, touch] }), "duo");
    const reopened = createDuoCredentialStore(fixture.admission, clock);
    assert.deepEqual([reopened.identity(), reopened.credentials()], [identity, ready]);
    assert.deepEqual(keyRows(), before);
    const request = { requestId: randomUUID(), credentialId: key.credentialId, rpId: "duosecurity.com" as const, origin: scope.origin, challenge: "AQID" };
    assert.equal((await reopened.sign(request)).transport, "usb");
    await assert.rejects(reopened.sign({ ...request, requestId: randomUUID(), credentialId: touch.credentialId }));
    const revision = reopened.read().revision;
    assert.equal(createDuoCredentialStore(fixture.admission, clock).read().revision, revision);
    const headPath = join(machineRoot, "machine", "credential-keys", `${profileId}.json`);
    writeFileSync(headPath, JSON.stringify({ ...z.looseObject({}).parse(JSON.parse(readFileSync(headPath, "utf8"))), mac: "0".repeat(64) }));
    assert.throws(() => createDuoCredentialStore(fixture.admission, clock).credentials(), { code: "DUO_CREDENTIAL_UNAVAILABLE" });
  } finally { await fixture.close(); }
});

const RowsSchema = z.looseObject({ credentials: z.array(z.looseObject({ credentialId: z.string(), authenticator: z.looseObject({ transport: z.string() }).optional() })) });
/** A signed-up profile whose stored Duo record also holds a platform row, as written before security-key-only. */
async function storedPlatformRow(touchId?: (keyId: string) => string) {
  const fixture = await createBoundProfileFixture();
  const clock = manualClock(new Date("2026-11-01T12:00:00.000Z"));
  const machineRoot = fixture.machine.stateRoot, profileId = fixture.admission.profileBinding.profileId;
  const keys = () => { const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    return { privateKeyPkcs8: pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"), publicKeySpki: pair.publicKey.export({ format: "der", type: "spki" }).toString("base64") }; };
  const scope = { armId: randomUUID(), contextId: "d".repeat(32), tabId: 1, accountId: randomUUID(),
    origin: "https://test.duosecurity.com", rpId: "duosecurity.com", armedAt: clock.now().toISOString(), expiresAt: "2026-11-01T12:10:00.000Z" };
  const key = { credentialId: Buffer.from(randomUUID()).toString("base64url"), ...keys(), scope, authenticator: { transport: "usb" as const, isResidentCredential: false } };
  const store = createDuoCredentialStore(fixture.admission, clock);
  store.enroll(key); store.confirm(key.credentialId, scope);
  const ready = store.credentials().map(row => row.credentialId);
  const rows = () => RowsSchema.parse(readAuthenticatedCredentialFixture(machineRoot, profileId, "duo")).credentials.map(row => [row.credentialId, row.authenticator?.transport]);
  const before = rows();
  const usb = RowsSchema.parse(readAuthenticatedCredentialFixture(machineRoot, profileId, "duo")).credentials[0];
  const touch = { ...usb, ...keys(), credentialId: touchId?.(key.credentialId) ?? Buffer.from(randomUUID()).toString("base64url"),
    authenticator: { transport: "internal", isResidentCredential: true, userHandle: Buffer.from("synthetic-platform-user").toString("base64") } };
  rewriteAuthenticatedCredentialFixture(machineRoot, profileId, value => ({ credentials: [...RowsSchema.parse(value).credentials, touch] }), "duo");
  const keyDirectory = join(machineRoot, "machine", "credential-keys"), duoDirectory = join(machineRoot, "machine", "duo-credentials");
  return { fixture, clock, key, touch, profileId, ready, before, rows, keyDirectory, duoDirectory, headPath: join(keyDirectory, `${profileId}.json`), duoPath: join(duoDirectory, `${profileId}.json`),
    head: () => CanonicalCredentialHeadSchema.parse(JSON.parse(readFileSync(join(keyDirectory, `${profileId}.json`), "utf8"))),
    stages: () => [keyDirectory, duoDirectory].flatMap(directory => readdirSync(directory).filter(name => name.endsWith(".canonical.tmp"))) };
}

for (const target of ["head", "duo"] as const) {
  it(`recovers the platform-row migration after a stop just before its ${target} publication renames`, async () => {
    const w = await storedPlatformRow();
    const binding = w.fixture.admission.profileBinding, destination = target === "head" ? w.headPath : w.duoPath;
    const rename = fs.renameSync;
    let stage: string | undefined;
    vi.spyOn(fs, "renameSync").mockImplementation((source, to) => {
      if (stage === undefined && String(to) === destination) { stage = String(source); throw new Error("synthetic stop before rename"); }
      return rename(source, to);
    });
    syncBuiltinESMExports();
    try { assert.throws(() => createDuoCredentialStore(w.fixture.admission, w.clock).credentials()); } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); }
    assert.ok(stage);
    assert.deepEqual(w.stages(), [basename(stage)]);
    assert.match(basename(stage), new RegExp(`\\.reenrol-${target}\\.canonical\\.tmp$`, "u"));
    await w.fixture.closeController();
    const lifetime = await RuntimeLifetimeLock.acquire(0);
    const machine = acquireEntrypointAdmission(w.fixture.workspace, "exclusive", lifetime);
    let admission: ReturnType<typeof machine.admitProfile> | undefined;
    try {
      assert.deepEqual(w.stages(), []);
      signInBoundProfileFixture(machine);
      admission = machine.admitProfile(binding.profileId);
      const reopened = createDuoCredentialStore(admission, w.clock);
      assert.deepEqual(reopened.credentials().map(row => row.credentialId), w.ready);
      assert.deepEqual(reopened.read().credentials.map(row => row.credentialId), w.before.map(([id]) => id));
      const current = w.head();
      assert.equal(current.state, "active");
      assert.ok(current.retired.includes(w.touch.credentialId));
      assert.equal(current.counters.some(counter => counter.credentialId === w.touch.credentialId), false);
      const request = { requestId: randomUUID(), credentialId: w.key.credentialId, rpId: "duosecurity.com" as const, origin: w.key.scope.origin, challenge: "AQID" };
      assert.equal((await reopened.sign(request)).transport, "usb");
    } finally { admission?.release(); machine.release(); await lifetime.close(); await w.fixture.close(); }
  });
}

it("refuses a platform row that shares the security key's id before retiring anything", async () => {
  const w = await storedPlatformRow(keyId => keyId);
  try {
    const before = readFileSync(w.headPath);
    assert.throws(() => createDuoCredentialStore(w.fixture.admission, w.clock).credentials(), { code: "DUO_CREDENTIAL_UNAVAILABLE" });
    assert.ok(readFileSync(w.headPath).equals(before));
    assert.deepEqual(w.rows(), [...w.before, [w.key.credentialId, "internal"]]);
    assert.deepEqual(w.stages(), []);
  } finally { await w.fixture.close(); }
});
