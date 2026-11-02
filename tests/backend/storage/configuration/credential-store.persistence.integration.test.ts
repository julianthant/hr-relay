import { randomUUID } from "node:crypto";
import { z } from "zod";
import { rewriteAuthenticatedCredentialFixture } from "../../../support/helpers/admission-fixture.js";
import assert from "node:assert/strict";
import { chmodSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, it } from "vitest";
import { credentialKeyCustody } from "../../../../src/backend/storage/configuration/credential-key-custody.js";
import { initialProtectedStoreRecord } from "../../../../src/models/config/protected-settings.js";
import { createCanonicalCredentials, CanonicalCredentialHeadSchema } from "../../../../src/backend/storage/configuration/canonical-credential-store.js";
import { createCredentialStore, authenticateDocument, CredentialDocumentSchema } from "../../../../src/backend/storage/configuration/credential-store.js";
import { createCredentialPersistenceFixtures } from "../../../support/helpers/credential-persistence-fixtures.js";

const COMMAND_1 = "11111111-1111-4111-8111-111111111111", COMMAND_2 = "22222222-2222-4222-8222-222222222222";
const WRITE_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", WRITE_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SECRET = "credential-persistence-private-password", NOW = "2026-09-06T12:00:00.000Z";
const roots: string[] = [];
const { fixture, releaseFixtures, request } = createCredentialPersistenceFixtures(roots, COMMAND_1, NOW);
afterEach(async () => { await releaseFixtures(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("does not retain a cleared password in authenticated current payload or encrypted source", async () => {
  const f = await fixture(), revision = f.store.read().revision;
  assert.equal(f.store.apply(request({ commandId: COMMAND_1, writeId: WRITE_1, expectedRevision: revision, entries: { ucpathPassword: { set: SECRET } } })).state, "applied");
  assert.equal(f.store.apply(request({ commandId: COMMAND_2, writeId: WRITE_2, expectedRevision: revision + 1, entries: { ucpathPassword: { clear: true } } })).state, "applied");
  assert.equal(f.store.read().entries.ucpathPassword, undefined);
  const frame = createCanonicalCredentials(f.admission).readRecord("protected"); assert.ok(frame);
  const document = authenticateDocument(frame.value);
  assert.equal(document.record.entries.ucpathPassword, undefined);
  assert.equal(JSON.stringify(document).includes(SECRET), false);
  assert.equal(readFileSync(f.path).includes(Buffer.from(SECRET)), false);
  assert.equal(f.store.ownsCommandId(COMMAND_1), true);
  assert.equal(f.store.acceptedAt(COMMAND_1), undefined); assert.equal(f.store.acceptedAt(COMMAND_2), NOW);
});

it("keeps private profile reads and writes beneath a sticky workspace while released authority refuses", async () => {
  const f = await fixture(), revision = f.store.read().revision;
  try {
    assert.equal(f.store.apply(request({ commandId: COMMAND_1, writeId: WRITE_1, expectedRevision: revision, entries: { ucpathPassword: { set: SECRET } } })).state, "applied");
    chmodSync(f.workspace, 0o1777);
    assert.equal(f.store.read().entries.ucpathPassword?.value, SECRET);
    assert.equal(f.store.apply(request({ commandId: COMMAND_2, writeId: WRITE_2, expectedRevision: revision + 1, entries: { ucpathPassword: { clear: true } } })).state, "applied");
    assert.equal(f.store.read().entries.ucpathPassword, undefined);
    const bytes = readFileSync(f.path);
    f.admission.release();
    assert.throws(() => f.store.read(), error => error instanceof Error && "code" in error && error.code === "CREDENTIAL_UNAVAILABLE"
      && error.cause instanceof Error && error.cause.message === "runtime-admission: missing or released admission");
    assert.deepEqual(readFileSync(f.path), bytes);
  } finally { chmodSync(f.workspace, 0o700); }
});

it.each(["credential key", "credential membership"] as const)("revalidates the cached current credential owner after %s changes", async change => {
  const f = await fixture(), before = f.store.read(), bytes = readFileSync(f.path);
  const head = join(f.machine.stateRoot, "machine", "credential-keys", `${f.admission.profileBinding.profileId}.json`), headBytes = readFileSync(head);
  const companion = join(f.directory, "unexpected-profile.json");
  try {
    if (change === "credential key") chmodSync(head, 0o644);
    else writeFileSync(companion, "{}", { mode: 0o600, flag: "wx" });
    for (const observe of [() => f.store.read(), () => f.store.ownsCommandId(COMMAND_1), () => f.store.acceptedAt(COMMAND_1),
      () => f.store.verifyReplay(request({ commandId: COMMAND_1, writeId: WRITE_1, expectedRevision: before.revision, entries: {} }))]) {
      assert.throws(observe, { code: "CREDENTIAL_UNAVAILABLE" });
      assert.deepEqual(readFileSync(f.path), bytes); assert.deepEqual(readFileSync(head), headBytes);
    }
    if (change === "credential membership") assert.equal(readFileSync(companion, "utf8"), "{}");
  } finally {
    if (change === "credential key") chmodSync(head, 0o600); else unlinkSync(companion);
  }
  assert.deepEqual(f.store.read(), before);
});

it("holds a same-profile unknown machine Duo entry without cleaning source or stage bytes", async () => {
  const f = await fixture(), owner = createCanonicalCredentials(f.admission), profileId = f.admission.profileBinding.profileId;
  const head = join(f.machine.stateRoot, "machine", "credential-keys", `${profileId}.json`);
  const duo = join(f.machine.stateRoot, "machine", "duo-credentials", `${profileId}.json`);
  const unknown = join(f.machine.stateRoot, "machine", "duo-credentials", `.${profileId}.${randomUUID()}.unknown`);
  const source = [f.path, head, duo].map(path => ({ path, bytes: readFileSync(path) }));
  const unknownBytes = Buffer.from("unowned same-profile Duo stage");
  writeFileSync(unknown, unknownBytes, { mode: 0o600, flag: "wx" });
  for (const observe of [() => owner.readRecord("duo"), () => f.store.read(), () => f.store.ownsCommandId(COMMAND_1)]) {
    assert.throws(observe, { code: "CREDENTIAL_UNAVAILABLE" });
    assert.deepEqual(readFileSync(unknown), unknownBytes);
    for (const original of source) assert.deepEqual(readFileSync(original.path), original.bytes);
  }
});

for (const version of [2, 3] as const) it(`refuses a valid empty plaintext historical version-${version} document without adopting or rewriting it`, async () => {
  const f = await fixture();
  const headPath = join(f.machine.stateRoot, "machine", "credential-keys", `${f.admission.profileBinding.profileId}.json`), headBytes = readFileSync(headPath);
  const head = CanonicalCredentialHeadSchema.parse(JSON.parse(headBytes.toString("utf8")));
  const key = credentialKeyCustody.read(head.key);
  const record = initialProtectedStoreRecord();
  assert.equal(record.revision, 1); assert.deepEqual(record.entries, {}); assert.equal(record.lastApplied, undefined);
  const historical = { schemaVersion: version, record, history: [] };
  assert.deepEqual(Object.keys(historical).sort(), ["history", "record", "schemaVersion"]);
  const bytes = Buffer.from(`${JSON.stringify(historical)}\n`);
  writeFileSync(f.path, bytes, { mode: 0o600 });
  assert.throws(() => f.store.read(), { code: "CREDENTIAL_UNAVAILABLE" });
  assert.deepEqual(readFileSync(f.path), bytes); assert.deepEqual(readFileSync(headPath), headBytes);
  assert.equal(credentialKeyCustody.read(head.key).key === key.key, true);
  const input = request({ commandId: COMMAND_1, writeId: WRITE_1, expectedRevision: record.revision, entries: {} });
  for (const observe of [() => f.store.verifyReplay(input), () => f.store.apply(input), () => f.store.ownsCommandId(COMMAND_1), () => f.store.acceptedAt(COMMAND_1)]) {
    assert.throws(observe, { code: "CREDENTIAL_UNAVAILABLE" });
    assert.deepEqual(readFileSync(f.path), bytes); assert.deepEqual(readFileSync(headPath), headBytes);
    assert.equal(credentialKeyCustody.read(head.key).key === key.key, true);
  }
});

async function domainVersionFixture() {
  const f = await fixture(), revision = f.store.read().revision;
  const original = request({ commandId: COMMAND_1, writeId: WRITE_1, expectedRevision: revision, entries: { ucpathPassword: { set: SECRET } } });
  assert.equal(f.store.apply(original).state, "applied");
  const record = f.store.read(), password = record.entries.ucpathPassword;
  assert.ok(password !== undefined && record.lastApplied !== undefined);
  return { f, original, record, password, lastApplied: record.lastApplied };
}

for (const version of [2, 3] as const) it.each(["unchanged", "value", "timestamp", "commandFingerprint", "expectedRevision", "protectedSchemaHash"] as const)(
  `requires literal version4 for authenticated current-shaped payload version-${version} %s`, async corruption => {
    const { f, original, record, password, lastApplied } = await domainVersionFixture();
    const corrupted = corruption === "value" || corruption === "timestamp"
      ? { ...record, entries: { ...record.entries, ucpathPassword: { ...password, ...(corruption === "value" ? { value: "different-private-password" } : { updatedAt: "2026-09-06T12:01:00.000Z" }) } } }
      : { ...record, lastApplied: { ...lastApplied, ...(corruption === "commandFingerprint" ? { commandFingerprint: "9".repeat(64) }
        : corruption === "expectedRevision" ? { expectedRevision: record.revision } : corruption === "protectedSchemaHash" ? { protectedSchemaHash: "9".repeat(64) } : {}) } };
    const frame = createCanonicalCredentials(f.admission).readRecord("protected"); assert.ok(frame);
    const current = authenticateDocument(frame.value);
    const control = { ...current, record: corrupted };
    if (corruption === "unchanged") assert.deepEqual(authenticateDocument(control), current);
    else assert.throws(() => authenticateDocument(control), { message: corruption === "value" || corruption === "timestamp"
      ? "credential-latest-request-invalid" : corruption === "commandFingerprint" ? "credential store protected.json disagrees with its identity history"
        : "credential store protected.json is malformed" });
    const candidate = { ...control, schemaVersion: version };
    const validation = CredentialDocumentSchema.safeParse(candidate);
    assert.equal(validation.success, false);
    if (validation.success) throw new Error("noncurrent credential schema unexpectedly accepted");
    assert.deepEqual(validation.error.issues.map(issue => ({ code: issue.code, path: issue.path, values: "values" in issue ? issue.values : undefined })),
      [{ code: "invalid_value", values: [4], path: ["schemaVersion"] },
        ...(corruption === "expectedRevision" || corruption === "protectedSchemaHash" ? [{ code: "custom", path: ["record", "lastApplied"], values: undefined }] : [])]);
    rewriteAuthenticatedCredentialFixture(f.machine.stateRoot, f.admission.profileBinding.profileId, () => candidate);
    const actual = createCanonicalCredentials(f.admission).readRecord("protected"); assert.ok(actual);
    assert.equal(actual.revision, record.revision);
    assert.equal(z.object({ record: z.object({ revision: z.number().int() }) }).parse(actual.value).record.revision, actual.revision);
    const bytes = readFileSync(f.path);
    for (const observe of [() => f.store.read(), () => f.store.verifyReplay(original), () => f.store.apply(original), () => f.store.ownsCommandId(COMMAND_1)]) {
      assert.throws(observe, { message: "credential store protected.json is malformed" }); assert.deepEqual(readFileSync(f.path), bytes);
    }
  });

  it("refuses insecure permissions, malformed identity history and foreign entries without rewriting", async () => {
    const f = await fixture(), revision = f.store.read().revision;
    const input = request({ commandId: COMMAND_1, writeId: WRITE_1, expectedRevision: revision, entries: { ucpathPassword: { set: SECRET } } });
    const applied = f.store.apply(input); assert.equal(applied.state, "applied");
    if (applied.state !== "applied") throw new Error("credential test expected an applied outcome");
    const settled = readFileSync(f.path), valueId = applied.record.entries.ucpathPassword?.valueId; assert.ok(valueId);
    assert.equal(settled.includes(Buffer.from(valueId)), false); assert.equal(settled.includes(Buffer.from(SECRET)), false);
    try {
      chmodSync(f.path, 0o640);
      assert.throws(() => f.store.read(), { code: "CREDENTIAL_UNAVAILABLE" });
      assert.deepEqual(readFileSync(f.path), settled);
    } finally { chmodSync(f.path, 0o600); }
    const envelope = z.record(z.string(), z.unknown()).parse(JSON.parse(settled.toString("utf8"))), ciphertext = z.string().parse(envelope.ciphertext);
    writeFileSync(f.path, JSON.stringify({ ...envelope, ciphertext: `${ciphertext.startsWith("A") ? "B" : "A"}${ciphertext.slice(1)}` }), { mode: 0o600 });
    const damaged = readFileSync(f.path);
    assert.throws(() => f.store.read(), { code: "CREDENTIAL_UNAVAILABLE" }); assert.deepEqual(readFileSync(f.path), damaged);
    writeFileSync(f.path, settled, { mode: 0o600 });
    rewriteAuthenticatedCredentialFixture(f.machine.stateRoot, f.admission.profileBinding.profileId, input => {
      const payload = z.object({ record: z.object({ entries: z.record(z.string(), z.unknown()) }).passthrough() }).passthrough().parse(input);
      const entry = z.object({ valueId: z.string() }).passthrough().parse(payload.record.entries.ucpathPassword);
      return { ...payload, record: { ...payload.record, entries: { ...payload.record.entries, ucpathPassword: { ...entry, valueId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" } } } };
    });
    const inconsistent = readFileSync(f.path);
    assert.throws(() => f.store.read(), /identity history/u); assert.deepEqual(readFileSync(f.path), inconsistent);
    writeFileSync(f.path, settled, { mode: 0o600 });
    const foreign = join(f.directory, "foreign.json");
    try {
      writeFileSync(foreign, "{}", { mode: 0o600, flag: "wx" });
      assert.throws(() => f.store.read(), { code: "CREDENTIAL_UNAVAILABLE" });
      assert.deepEqual(readFileSync(f.path), settled); assert.equal(readFileSync(foreign, "utf8"), "{}");
    } finally { unlinkSync(foreign); }
    assert.deepEqual(f.store.read(), applied.record);
  });

  it("keeps a real writer's current value readable while refusing a competing publication", async () => {
    const f = await fixture(), current = f.store.read(), revision = current.revision;
    let blocked: ReturnType<typeof f.store.apply> | undefined, winnerBytes: Buffer | undefined;
    const writer = createCredentialStore({ admission: f.admission, stateRoot: f.stateRoot, hooks: { afterRename() {
      winnerBytes = readFileSync(f.path);
      blocked = f.store.apply(request({ commandId: COMMAND_2, writeId: WRITE_2, expectedRevision: revision + 1, entries: { timekeeperName: { set: "lock-contention" } } }));
      assert.equal(f.store.read().entries.ucpathPassword?.value, SECRET);
      assert.equal(f.store.read().revision, revision + 1);
      assert.deepEqual(readFileSync(f.path), winnerBytes);
      assert.deepEqual(f.store.read().entries.timekeeperName, current.entries.timekeeperName);
    } } });
    assert.equal(writer.apply(request({ commandId: COMMAND_1, writeId: WRITE_1, expectedRevision: revision, entries: { ucpathPassword: { set: SECRET } } })).state, "applied");
    assert.deepEqual(blocked, { state: "rejected", code: "lock-unavailable", message: "credential store lock is unavailable" });
    assert.ok(winnerBytes);
    const bytes = readFileSync(f.path); assert.deepEqual(bytes, winnerBytes);
    assert.equal(f.store.ownsCommandId(COMMAND_2), false); assert.equal(f.store.acceptedAt(COMMAND_1), NOW);
    assert.equal(f.store.read().entries.ucpathPassword?.value, SECRET);
    assert.deepEqual(readFileSync(f.path), bytes);
  });
