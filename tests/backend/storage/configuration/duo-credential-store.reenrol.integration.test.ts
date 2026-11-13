import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { CanonicalCredentialHeadSchema, createCanonicalCredentials } from "../../../../src/backend/storage/configuration/canonical-credential-store.js";
import { createDuoCredentialStore } from "../../../../src/backend/storage/configuration/duo-credential-store.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { DuoCredentialRecordSchema, DuoReenrolCommitIntentSchema, type DuoReenrolCommitIntent } from "../../../../src/models/config/duo-credential-store.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { createBoundProfileFixture, signInBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { storageTree } from "../../../support/helpers/integration/storage-recovery-fixture.js";

type Transport = "usb" | "internal";
type Fixture = Awaited<ReturnType<typeof createBoundProfileFixture>>;
const ARMED_AT = "2026-11-01T12:00:00.000Z", EXPIRES_AT = "2026-11-01T12:10:00.000Z";

function material(accountId: string, transport: Transport, tabId = 1) {
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return { credentialId: randomBytes(32).toString("base64url"),
    scope: { armId: randomUUID(), contextId: "c".repeat(32), tabId, accountId, origin: "https://reenrol-fixture.duosecurity.com",
      rpId: "duosecurity.com", armedAt: ARMED_AT, expiresAt: EXPIRES_AT },
    privateKeyPkcs8: pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    publicKeySpki: pair.publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    authenticator: { transport, isResidentCredential: true } };
}
type Material = ReturnType<typeof material>;
function enrollInput(row: Material) { return { ...row, ...(row.authenticator.transport === "internal" ? { initialSignCount: 1 } : {}) }; }
function signRequest(row: Material) {
  return { credentialId: row.credentialId, requestId: randomUUID(), rpId: "duosecurity.com" as const, origin: row.scope.origin, challenge: "AQID" };
}

async function activeProfile(f?: Fixture) {
  const fixture = f ?? await createBoundProfileFixture();
  const clock = manualClock(new Date("2026-11-01T12:00:01.000Z"));
  const store = createDuoCredentialStore(fixture.admission, clock), profileId = fixture.admission.profileBinding.profileId;
  const signUpAccount = randomUUID(), reenrolAccount = randomUUID();
  const old = [material(signUpAccount, "usb"), material(signUpAccount, "internal")] as const;
  for (const row of old) { store.enroll(enrollInput(row)); store.confirm(row.credentialId, row.scope); }
  const active = store.read().credentials.filter(row => row.state === "ready").map(row => row.credentialId);
  assert.deepEqual(active.slice(-2), old.map(row => row.credentialId));
  const fresh = [material(reenrolAccount, "usb", 2), material(reenrolAccount, "internal", 2)] as const;
  for (const row of fresh) store.enroll({ ...enrollInput(row), reenrol: true });
  const machineRoot = join(fixture.machine.stateRoot, "machine");
  return { f: fixture, clock, store, profileId, signUpAccount, reenrolAccount, old, active, fresh,
    headPath: join(machineRoot, "credential-keys", `${profileId}.json`), keyDirectory: join(machineRoot, "credential-keys"),
    duoDirectory: join(machineRoot, "duo-credentials") };
}
type Active = Awaited<ReturnType<typeof activeProfile>>;
async function stagedProfile(f?: Fixture) {
  const w = await activeProfile(f);
  w.clock.advanceWall(1000);
  for (const row of w.fresh) w.store.stage(row.credentialId, row.scope);
  return w;
}
function head(w: Active) {
  const parsed = CanonicalCredentialHeadSchema.parse(JSON.parse(readFileSync(w.headPath, "utf8")));
  assert.equal(parsed.state, "active"); return parsed;
}
function states(w: Active) { return Object.fromEntries(w.store.read().credentials.map(row => [row.credentialId, row.state])); }
function reenrolStages(w: Active) {
  return [w.keyDirectory, w.duoDirectory].flatMap(directory => readdirSync(directory).filter(name => name.includes(".reenrol-")));
}
function writeStage(directory: string, w: Active, owner: string, target: "head" | "duo") {
  writeFileSync(join(directory, `.${w.profileId}.${owner}.reenrol-${target}.canonical.tmp`), randomBytes(48), { mode: 0o600 });
}
function assertCommitted(w: Active, intent: DuoReenrolCommitIntent) {
  assert.deepEqual(states(w), Object.fromEntries(w.fresh.map(row => [row.credentialId, "ready"])));
  const current = head(w);
  assert.deepEqual(intent.retireIds.slice(0, w.active.length), w.active);
  for (const id of intent.retireIds) {
    assert.ok(current.retired.includes(id));
    assert.equal(current.counters.some(counter => counter.credentialId === id), false);
  }
  assert.deepEqual(reenrolStages(w), []);
}

it("keeps staged rows out of credentials, identity, platform material, signing and counter reservation", async () => {
  const w = await activeProfile();
  try {
    const identity = w.store.identity(), credentials = w.store.credentials(), platform = w.store.platformCredentials().map(row => row.credentialId);
    w.clock.advanceWall(1000);
    for (const row of w.fresh) w.store.stage(row.credentialId, row.scope);
    assert.deepEqual(w.fresh.map(row => states(w)[row.credentialId]), ["staged", "staged"]);
    assert.deepEqual(w.store.readForScope(w.fresh[0].scope), [{ credentialId: w.fresh[0].credentialId, state: "staged" }]);
    assert.equal(w.store.identity(), identity);
    assert.deepEqual(w.store.credentials(), credentials);
    assert.deepEqual(w.store.platformCredentials().map(row => row.credentialId), platform);
    const owner = createCanonicalCredentials(w.f.admission);
    for (const row of w.fresh) {
      await assert.rejects(w.store.sign(signRequest(row)), /duo-ready-credential-required/u);
      await assert.rejects(w.store.signForScope(signRequest(row), row.scope), /duo-ready-credential-required/u);
      assert.throws(() => w.store.reserveForAttempt(row.credentialId, randomUUID(), row.scope), /duo-ready-credential-required/u);
      assert.throws(() => owner.reserveDuoCounter(row.credentialId, randomUUID()), { code: "CREDENTIAL_UNAVAILABLE" });
    }
  } finally { await w.f.close(); }
});

it("stages only a fresh account's own pending row on its exact scope inside the arm window", async () => {
  const w = await activeProfile();
  try {
    const [key, touch] = w.fresh;
    w.clock.advanceWall(1000);
    assert.throws(() => w.store.stage(key.credentialId, { ...key.scope, tabId: 3 }), { code: "DUO_CREDENTIAL_CONFLICT" });
    assert.throws(() => w.store.stage(w.old[0].credentialId, w.old[0].scope), { code: "DUO_CREDENTIAL_CONFLICT" });
    const signUpPending = material(w.signUpAccount, "usb", 4);
    w.store.enroll(signUpPending);
    assert.throws(() => w.store.stage(signUpPending.credentialId, signUpPending.scope), { code: "DUO_CREDENTIAL_CONFLICT" });
    const unmarked = material(w.reenrolAccount, "usb", 7);
    w.store.enroll(unmarked);
    assert.throws(() => w.store.stage(unmarked.credentialId, unmarked.scope), { code: "DUO_CREDENTIAL_CONFLICT" });
    w.store.stage(key.credentialId, key.scope);
    assert.throws(() => w.store.stage(key.credentialId, key.scope), { code: "DUO_CREDENTIAL_CONFLICT" });
    w.clock.advanceWall(600_000);
    assert.throws(() => w.store.stage(touch.credentialId, touch.scope), /duo-arm-expired/u);
    assert.equal(states(w)[touch.credentialId], "pending");
  } finally { await w.f.close(); }
});

it("refuses staging, staged counters and discard for a sign-up draft that holds no ready row", async () => {
  const f = await createBoundProfileFixture({ pending: "onboarding" });
  try {
    const clock = manualClock(new Date("2026-11-01T12:00:01.000Z")), store = createDuoCredentialStore(f.admission, clock);
    const account = randomUUID(), row = material(account, "usb");
    store.enroll(row);
    const before = storageTree(f.workspace);
    assert.throws(() => store.stage(row.credentialId, row.scope), { code: "DUO_CREDENTIAL_CONFLICT" });
    assert.throws(() => store.discardDraft(account), { code: "DUO_CREDENTIAL_CONFLICT" });
    assert.throws(() => store.prepareReenrolCommit(account), { code: "DUO_CREDENTIAL_CONFLICT" });
    assert.deepEqual(storageTree(f.workspace), before);
  } finally { await f.close(); }
});

it("refuses the ordinary confirm for a re-enrolment row so it can become ready only through commit", async () => {
  const w = await activeProfile();
  try {
    const identity = w.store.identity(), before = storageTree(w.f.workspace), owner = createCanonicalCredentials(w.f.admission);
    for (const row of w.fresh) assert.throws(() => w.store.confirm(row.credentialId, row.scope), /duo-pending-credential-mismatch/u);
    const frame = owner.readRecord("duo"); assert.ok(frame);
    const credentials = DuoCredentialRecordSchema.parse(frame.value).credentials.map(row => row.credentialId === w.fresh[0].credentialId && row.state === "pending"
      ? (({ reenrol: _reenrol, ...fields }) => fields)(row) : row);
    assert.throws(() => owner.replaceRecord("duo", frame.revision, { credentials }), { code: "CREDENTIAL_CONFLICT" });
    assert.deepEqual(storageTree(w.f.workspace), before);
    assert.equal(w.store.identity(), identity);
  } finally { await w.f.close(); }
});

it("reserves a staged counter only for its exact staged scope and never for a ready or pending row", async () => {
  const w = await activeProfile();
  try {
    const [key, touch] = w.fresh, owner = createCanonicalCredentials(w.f.admission);
    w.clock.advanceWall(1000);
    assert.throws(() => owner.reserveStagedDuoCounter(key.credentialId, randomUUID(), key.scope), { code: "CREDENTIAL_UNAVAILABLE" });
    w.store.stage(key.credentialId, key.scope); w.store.stage(touch.credentialId, touch.scope);
    const first = await w.store.signStagedForScope(signRequest(key), key.scope);
    assert.equal((await w.store.signStagedForScope(signRequest(key), key.scope)).signCount, first.signCount + 1);
    assert.equal((await w.store.signStagedForScope(signRequest(touch), touch.scope)).signCount, 2);
    assert.throws(() => owner.reserveStagedDuoCounter(key.credentialId, randomUUID(), { ...key.scope, tabId: 9 }), { code: "CREDENTIAL_UNAVAILABLE" });
    assert.throws(() => owner.reserveStagedDuoCounter(key.credentialId, randomUUID(), touch.scope), { code: "CREDENTIAL_UNAVAILABLE" });
    assert.throws(() => owner.reserveStagedDuoCounter(w.old[0].credentialId, randomUUID(), w.old[0].scope), { code: "CREDENTIAL_UNAVAILABLE" });
    const request = randomUUID();
    owner.reserveStagedDuoCounter(key.credentialId, request, key.scope);
    assert.throws(() => owner.reserveStagedDuoCounter(key.credentialId, request, key.scope), { code: "CREDENTIAL_CONFLICT" });
    await assert.rejects(w.store.signStagedForScope(signRequest(w.old[0]), w.old[0].scope), /duo-staged-credential-required/u);
  } finally { await w.f.close(); }
});

it("keeps the generic replace refusing removal and leaves staged rows unchangeable through it", async () => {
  const w = await stagedProfile();
  try {
    const owner = createCanonicalCredentials(w.f.admission), frame = owner.readRecord("duo"); assert.ok(frame);
    const record = DuoCredentialRecordSchema.parse(frame.value), before = storageTree(w.f.workspace);
    const stagedRow = record.credentials.find(row => row.credentialId === w.fresh[0].credentialId);
    assert.ok(stagedRow?.state === "staged");
    const { provedAt, reenrol: _reenrol, ...fields } = stagedRow;
    const added = { ...material(w.reenrolAccount, "usb", 5), state: "staged" as const, reenrol: true as const, createdAt: provedAt, provedAt };
    const { authenticator: _authenticator, ...addedRow } = added;
    for (const credentials of [
      record.credentials.filter(row => row.credentialId !== w.old[0].credentialId),
      record.credentials.filter(row => row.credentialId !== stagedRow.credentialId),
      record.credentials.map(row => row === stagedRow ? { ...fields, state: "ready" as const, confirmedAt: provedAt } : row),
      record.credentials.map(row => row === stagedRow ? { ...fields, state: "pending" as const, reenrol: true as const } : row),
      [...record.credentials, addedRow],
    ]) assert.throws(() => owner.replaceRecord("duo", frame.revision, { credentials }), { code: "CREDENTIAL_CONFLICT" });
    assert.deepEqual(storageTree(w.f.workspace), before);
  } finally { await w.f.close(); }
});

it("discards only the re-enrolment account's draft rows and retires their ids and counters", async () => {
  const w = await activeProfile();
  try {
    const [key, touch] = w.fresh, identity = w.store.identity();
    w.clock.advanceWall(1000); w.store.stage(key.credentialId, key.scope);
    assert.throws(() => w.store.discardDraft(w.signUpAccount), { code: "DUO_CREDENTIAL_CONFLICT" });
    const unrelated = w.store.read();
    w.store.discardDraft(randomUUID());
    assert.deepEqual(w.store.read().credentials, unrelated.credentials);
    w.store.discardDraft(w.reenrolAccount);
    assert.deepEqual(Object.keys(states(w)), w.active);
    const current = head(w);
    for (const row of w.fresh) {
      assert.ok(current.retired.includes(row.credentialId));
      assert.equal(current.counters.some(counter => counter.credentialId === row.credentialId), false);
    }
    assert.ok(current.counters.some(counter => counter.credentialId === w.old[1].credentialId));
    assert.equal(w.store.identity(), identity);
    assert.throws(() => w.store.enroll(enrollInput({ ...touch, scope: { ...touch.scope, armId: randomUUID() } })), { code: "DUO_CREDENTIAL_CONFLICT" });
    const revision = w.store.read().revision;
    w.store.discardDraft(w.reenrolAccount);
    assert.equal(w.store.read().revision, revision);
    assert.equal((await w.store.sign(signRequest(w.old[0]))).signCount, 1);
  } finally { await w.f.close(); }
});

it("refuses to commit a draft whose ids an interrupted discard retired, before the active set is retired", async () => {
  const w = await stagedProfile();
  try {
    const intent = w.store.prepareReenrolCommit(w.reenrolAccount), identity = w.store.identity();
    const owner = createCanonicalCredentials(w.f.admission, { afterReplace(kind) { if (kind === "head") throw new Error("synthetic crash after discard head"); } });
    assert.throws(() => owner.discardDuoDraft(w.reenrolAccount), { code: "CREDENTIAL_UNCERTAIN" });
    const interrupted = storageTree(w.f.workspace);
    assert.throws(() => w.store.prepareReenrolCommit(w.reenrolAccount), { code: "DUO_CREDENTIAL_CONFLICT" });
    assert.deepEqual(w.store.inspectReenrolCommit(intent), { head: "not-applied", record: "unprovable" });
    assert.throws(() => w.store.commitReenrol(intent), { code: "DUO_CREDENTIAL_UNCERTAIN" });
    assert.deepEqual(storageTree(w.f.workspace), interrupted);
    assert.equal(w.store.identity(), identity);
    assert.ok(w.active.every(id => !head(w).retired.includes(id)));
    assert.equal((await w.store.sign(signRequest(w.old[0]))).signCount, 1);
    w.store.discardDraft(w.reenrolAccount);
    assert.deepEqual(Object.keys(states(w)), w.active);
  } finally { await w.f.close(); }
});

it("converges a discard interrupted between its head and record publications", async () => {
  const w = await stagedProfile();
  try {
    const owner = createCanonicalCredentials(w.f.admission, { afterReplace(kind) { if (kind === "head") throw new Error("synthetic lost head acknowledgment"); } });
    assert.throws(() => owner.discardDuoDraft(w.reenrolAccount), { code: "CREDENTIAL_UNCERTAIN" });
    assert.ok(w.fresh.every(row => head(w).retired.includes(row.credentialId)));
    writeStage(w.duoDirectory, w, randomUUID(), "duo");
    assert.throws(() => w.store.read(), { code: "DUO_CREDENTIAL_UNAVAILABLE" });
    createDuoCredentialStore(w.f.admission, w.clock).discardDraft(w.reenrolAccount);
    assert.deepEqual(Object.keys(states(w)), w.active);
    assert.deepEqual(reenrolStages(w), []);
  } finally { await w.f.close(); }
});

it("commits staged rows as ready after their arm window has passed and retires the active set", async () => {
  const w = await stagedProfile();
  try {
    const stray = material(randomUUID(), "internal", 8);
    w.store.enroll(enrollInput(stray));
    const before = w.store.identity(), provedAt = w.clock.now().toISOString();
    w.clock.advanceWall(3_600_000);
    const intent = w.store.prepareReenrolCommit(w.reenrolAccount);
    assert.deepEqual(DuoReenrolCommitIntentSchema.parse(intent), intent);
    assert.deepEqual(intent.stagedIds, w.fresh.map(row => row.credentialId));
    assert.deepEqual(intent.retireIds, [...w.active, stray.credentialId]);
    assert.deepEqual(w.store.inspectReenrolCommit(intent), { head: "not-applied", record: "not-applied" });
    w.store.commitReenrol(intent);
    assert.deepEqual(w.store.inspectReenrolCommit(intent), { head: "applied", record: "applied" });
    assertCommitted(w, intent);
    const frame = createCanonicalCredentials(w.f.admission).readRecord("duo"); assert.ok(frame);
    const rows = DuoCredentialRecordSchema.parse(frame.value).credentials;
    assert.ok(rows.every(row => row.state === "ready" && row.confirmedAt === provedAt));
    assert.notEqual(w.store.identity(), before);
    assert.deepEqual(w.store.credentials().map(row => row.credentialId), w.fresh.map(row => row.credentialId));
    assert.deepEqual(w.store.platformCredentials().map(row => row.credentialId), [w.fresh[1].credentialId]);
    assert.equal((await w.store.sign(signRequest(w.fresh[0]))).signCount, 1);
    for (const row of w.old) await assert.rejects(w.store.sign(signRequest(row)), /duo-credential-scope-mismatch/u);
    assert.throws(() => w.store.discardDraft(w.reenrolAccount), { code: "DUO_CREDENTIAL_CONFLICT" });
    const settled = storageTree(w.f.workspace);
    w.store.commitReenrol(intent);
    assert.deepEqual(storageTree(w.f.workspace), settled);
  } finally { await w.f.close(); }
});

it("refuses to prepare a commit while the account holds a pending row, nothing staged or a ready row", async () => {
  const w = await activeProfile();
  try {
    assert.throws(() => w.store.prepareReenrolCommit(w.reenrolAccount), { code: "DUO_CREDENTIAL_CONFLICT" });
    assert.throws(() => w.store.prepareReenrolCommit(randomUUID()), { code: "DUO_CREDENTIAL_CONFLICT" });
    assert.throws(() => w.store.prepareReenrolCommit(w.signUpAccount), { code: "DUO_CREDENTIAL_CONFLICT" });
    w.clock.advanceWall(1000); w.store.stage(w.fresh[0].credentialId, w.fresh[0].scope);
    assert.throws(() => w.store.prepareReenrolCommit(w.reenrolAccount), { code: "DUO_CREDENTIAL_CONFLICT" });
    assert.equal(states(w)[w.fresh[1].credentialId], "pending");
  } finally { await w.f.close(); }
});

const crashPoints: readonly Readonly<{ name: string; expected: { head: string; record: string };
  crash(w: Active, intent: DuoReenrolCommitIntent): void }>[] = [
  { name: "after the intent is recorded and before any credential write", expected: { head: "not-applied", record: "not-applied" }, crash() {} },
  { name: "after the head stage is written and before it replaces the head", expected: { head: "not-applied", record: "not-applied" },
    crash(w, intent) { writeStage(w.keyDirectory, w, intent.commitId, "head"); } },
  { name: "after the head replacement and before its acknowledgment", expected: { head: "applied", record: "not-applied" },
    crash(w, intent) {
      const owner = createCanonicalCredentials(w.f.admission, { afterReplace(kind) { if (kind === "head") throw new Error("synthetic lost head acknowledgment"); } });
      assert.throws(() => owner.commitDuoReenrol(intent), { code: "CREDENTIAL_UNCERTAIN" });
    } },
  { name: "after the record stage is written and before it replaces the record", expected: { head: "applied", record: "not-applied" },
    crash(w, intent) {
      const owner = createCanonicalCredentials(w.f.admission, { afterReplace(kind) { if (kind === "head") throw new Error("synthetic crash after head"); } });
      assert.throws(() => owner.commitDuoReenrol(intent), { code: "CREDENTIAL_UNCERTAIN" });
      writeStage(w.duoDirectory, w, intent.commitId, "duo");
    } },
  { name: "after the record replacement and before its acknowledgment", expected: { head: "applied", record: "applied" },
    crash(w, intent) {
      const owner = createCanonicalCredentials(w.f.admission, { afterReplace(kind) { if (kind === "duo") throw new Error("synthetic lost record acknowledgment"); } });
      assert.throws(() => owner.commitDuoReenrol(intent), { code: "CREDENTIAL_UNCERTAIN" });
    } },
  { name: "after the record is published and before the operation is deleted", expected: { head: "applied", record: "applied" },
    crash(w, intent) { createCanonicalCredentials(w.f.admission).commitDuoReenrol(intent); } },
];
for (const point of crashPoints) {
  it(`converges a commit interrupted ${point.name}`, async () => {
    const w = await stagedProfile();
    try {
      const intent = w.store.prepareReenrolCommit(w.reenrolAccount);
      point.crash(w, intent);
      const reopened = createDuoCredentialStore(w.f.admission, w.clock);
      assert.deepEqual(reopened.inspectReenrolCommit(intent), point.expected);
      reopened.commitReenrol(intent);
      assertCommitted(w, intent);
      assert.deepEqual(createDuoCredentialStore(w.f.admission, w.clock).inspectReenrolCommit(intent), { head: "applied", record: "applied" });
    } finally { await w.f.close(); }
  });
}

it("removes re-enrolment stages at boot and rolls a commit forward across a real controller restart", async () => {
  const w = await stagedProfile();
  const binding = w.f.admission.profileBinding, intent = w.store.prepareReenrolCommit(w.reenrolAccount);
  writeStage(w.keyDirectory, w, intent.commitId, "head"); writeStage(w.duoDirectory, w, w.reenrolAccount, "duo");
  assert.equal(reenrolStages(w).length, 2);
  await w.f.closeController();
  const lifetime = await RuntimeLifetimeLock.acquire(0);
  const machine = acquireEntrypointAdmission(w.f.workspace, "exclusive", lifetime);
  let admission: ReturnType<typeof machine.admitProfile> | undefined;
  try {
    assert.deepEqual(reenrolStages(w), []);
    signInBoundProfileFixture(machine);
    admission = machine.admitProfile(binding.profileId);
    const reopened = createDuoCredentialStore(admission, w.clock);
    assert.deepEqual(reopened.inspectReenrolCommit(intent), { head: "not-applied", record: "not-applied" });
    reopened.commitReenrol(intent);
    assert.deepEqual(Object.fromEntries(reopened.read().credentials.map(row => [row.credentialId, row.state])),
      Object.fromEntries(w.fresh.map(row => [row.credentialId, "ready"])));
  } finally { admission?.release(); machine.release(); await lifetime.close(); await w.f.close(); }
});

it("classifies a foreign record, a tampered intent and an unreadable record as unprovable and writes nothing", async () => {
  const w = await stagedProfile();
  try {
    const intent = w.store.prepareReenrolCommit(w.reenrolAccount);
    const tampered: DuoReenrolCommitIntent[] = [
      { ...intent, retireIds: [w.old[0].credentialId] },
      { ...intent, duoRevision: intent.duoRevision + 1 },
      { ...intent, mac: "0".repeat(64) },
      { ...intent, accountId: w.signUpAccount },
    ];
    for (const candidate of tampered) {
      const before = storageTree(w.f.workspace);
      assert.equal(w.store.inspectReenrolCommit(candidate).record, "unprovable");
      assert.throws(() => w.store.commitReenrol(candidate), { code: "DUO_CREDENTIAL_UNCERTAIN" });
      assert.deepEqual(storageTree(w.f.workspace), before);
    }
    w.store.enroll(material(w.reenrolAccount, "usb", 6));
    const foreign = storageTree(w.f.workspace);
    assert.deepEqual(w.store.inspectReenrolCommit(intent), { head: "not-applied", record: "unprovable" });
    assert.throws(() => w.store.commitReenrol(intent), { code: "DUO_CREDENTIAL_UNCERTAIN" });
    assert.deepEqual(storageTree(w.f.workspace), foreign);
  } finally { await w.f.close(); }
});

it("holds an unreadable record or head unprovable and keeps a discard refused once the commit head retired the active set", async () => {
  const w = await stagedProfile();
  try {
    const intent = w.store.prepareReenrolCommit(w.reenrolAccount);
    const owner = createCanonicalCredentials(w.f.admission, { afterReplace(kind) { if (kind === "head") throw new Error("synthetic crash after head"); } });
    assert.throws(() => owner.commitDuoReenrol(intent), { code: "CREDENTIAL_UNCERTAIN" });
    assert.throws(() => w.store.discardDraft(w.reenrolAccount), { code: "DUO_CREDENTIAL_CONFLICT" });
    const recordPath = join(w.duoDirectory, `${w.profileId}.json`), bytes = readFileSync(recordPath);
    writeFileSync(recordPath, Buffer.concat([bytes.subarray(0, bytes.length - 8), Buffer.from("AAAAAA==")]));
    const corrupt = storageTree(w.f.workspace);
    assert.deepEqual(w.store.inspectReenrolCommit(intent), { head: "applied", record: "unprovable" });
    assert.throws(() => w.store.commitReenrol(intent), { code: "DUO_CREDENTIAL_UNCERTAIN" });
    assert.deepEqual(storageTree(w.f.workspace), corrupt);
    writeFileSync(recordPath, bytes);
    const headBytes = readFileSync(w.headPath);
    writeFileSync(w.headPath, headBytes.subarray(0, headBytes.length - 16));
    const unreadableHead = storageTree(w.f.workspace);
    assert.deepEqual(w.store.inspectReenrolCommit(intent), { head: "unprovable", record: "unprovable" });
    assert.throws(() => w.store.commitReenrol(intent), { code: "DUO_CREDENTIAL_UNCERTAIN" });
    assert.deepEqual(storageTree(w.f.workspace), unreadableHead);
    writeFileSync(w.headPath, headBytes);
    w.store.commitReenrol(intent);
    assertCommitted(w, intent);
  } finally { await w.f.close(); }
});
