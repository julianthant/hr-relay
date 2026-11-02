import { Entry } from "@napi-rs/keyring";
import { runCredentialSourceRetentionCase } from "../../../support/helpers/credential-source-retention.js";
import assert from "node:assert/strict";
import nativeCrypto, { createHmac, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import fs, { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it, vi } from "vitest";
import { CanonicalCredentialHeadSchema, createCanonicalCredentials, eraseCanonicalDraftCredentials, initializeCanonicalCredentials } from "../../../../src/backend/storage/configuration/canonical-credential-store.js";
import { createDuoCredentialStore } from "../../../../src/backend/storage/configuration/duo-credential-store.js";
import { StoppedDuoCredentialDocumentSchema, stoppedDuoConversionRecord } from "../../../../src/backend/storage/configuration/credential-conversion.js";
import { withPrivateFileLock } from "../../../../src/backend/storage/configuration/credential-safe-file.js";
import { initialDocument } from "../../../../src/backend/storage/configuration/credential-store.js";
import { credentialKeyCustody } from "../../../../src/backend/storage/configuration/credential-key-custody.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { DuoCredentialRecordSchema } from "../../../../src/models/config/duo-credential-store.js";
import { SignUpOperationSchema } from "../../../../src/models/profiles/profile.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { createBoundProfileFixture, signInBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { FakeKeyringEntry, credentialKeychainTestEnvironment } from "../../../support/helpers/credential-keychain-fake.js";
import { runInheritedRuntimeChild } from "../../../support/helpers/backend/runtime-lifetime.js";
import { scaledMs } from "../../../support/time-scale.js";

function material() {
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return { credentialId: randomBytes(32).toString("base64url"),
    scope: { armId: randomUUID(), contextId: "a".repeat(32), tabId: 1, accountId: randomUUID(), origin: "https://recovery-fixture.duosecurity.com", rpId: "duosecurity.com",
      armedAt: "2026-11-01T12:00:00.000Z", expiresAt: "2026-11-01T12:10:00.000Z" },
    privateKeyPkcs8: pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    publicKeySpki: pair.publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    authenticator: { transport: "usb" as const, isResidentCredential: true } };
}
async function fixture(pending = false, shared = false) {
  const f = await createBoundProfileFixture(pending ? { pending: "onboarding" } : shared ? { sharedMachine: true } : {});
  const clock = manualClock(new Date("2026-11-01T12:00:01.000Z"));
  const view = createDuoCredentialStore(f.admission, clock), input = material();
  view.enroll(input); view.confirm(input.credentialId, input.scope);
  const owner = createCanonicalCredentials(f.admission), profileId = f.admission.profileBinding.profileId;
  return { f, clock, input, view, owner, profileId,
    duoPath: join(f.machine.stateRoot, "machine", "duo-credentials", `${profileId}.json`),
    headPath: join(f.machine.stateRoot, "machine", "credential-keys", `${profileId}.json`) };
}
function signRequest(credential: ReturnType<typeof material>) {
  return { credentialId: credential.credentialId, requestId: randomUUID(), rpId: "duosecurity.com" as const, origin: credential.scope.origin, challenge: "AQID" };
}
function currentOperation(f: Awaited<ReturnType<typeof createBoundProfileFixture>>) {
  const directory = join(f.machine.stateRoot, "machine", "operations"), names = readdirSync(directory).filter(name => name.endsWith(".json"));
  assert.equal(names.length, 1); const name = names[0]; assert.ok(name);
  return SignUpOperationSchema.parse(JSON.parse(readFileSync(join(directory, name), "utf8")));
}
function beginAbort(f: Awaited<ReturnType<typeof createBoundProfileFixture>>) {
  const original = currentOperation(f); assert.ok(original.onboarding);
  const operation = SignUpOperationSchema.parse({ ...original, onboarding: { ...original.onboarding,
    generation: original.onboarding.generation + 1, abort: { operationId: randomUUID(), generation: original.credentials.generation + 1 } } });
  f.machine.publishProfileOperation(operation); return operation;
}

it("publishes pending material durably and reserves only its exact confirmed scope", async () => {
  const f = await createBoundProfileFixture({ pending: "onboarding" }), clock = manualClock(new Date("2026-11-01T12:00:01.000Z"));
  try {
    const view = createDuoCredentialStore(f.admission, clock), input = material();
    view.enroll(input);
    const path = join(f.machine.stateRoot, "machine", "duo-credentials", `${f.admission.profileBinding.profileId}.json`), pending = readFileSync(path);
    assert.equal(pending.includes(input.privateKeyPkcs8), false);
    assert.equal(view.readForScope(input.scope).find(row => row.credentialId === input.credentialId)?.state, "pending");
    assert.throws(() => view.reserveForAttempt(input.credentialId, randomUUID(), input.scope), /duo-ready-credential-required/u);
    assert.throws(() => view.confirm(input.credentialId, { ...input.scope, tabId: 2 }), /duo-pending-credential-mismatch/u);
    assert.deepEqual(readFileSync(path), pending);
    view.confirm(input.credentialId, input.scope);
    assert.throws(() => view.reserveForAttempt(input.credentialId, randomUUID(), { ...input.scope, armId: randomUUID() }), /duo-credential-scope-mismatch/u);
    assert.equal(view.reserveForAttempt(input.credentialId, randomUUID(), input.scope).count, 1);
    clock.advanceWall(600_000);
    assert.throws(() => view.provision(input.credentialId, input.scope), /duo-arm-expired/u);
  } finally { await f.close(); }
});

it("refuses confirmation after an actual pending enrollment expires without changing its ciphertext or external head", async () => {
  const f = await createBoundProfileFixture({ pending: "onboarding" }), clock = manualClock(new Date("2026-11-01T12:00:01.000Z"));
  try {
    const view = createDuoCredentialStore(f.admission, clock), input = material();
    view.enroll(input);
    const profileId = f.admission.profileBinding.profileId, path = join(f.machine.stateRoot, "machine", "duo-credentials", `${profileId}.json`),
      headPath = join(f.machine.stateRoot, "machine", "credential-keys", `${profileId}.json`), pending = readFileSync(path), head = readFileSync(headPath);
    assert.equal(view.readForScope(input.scope).find(row => row.credentialId === input.credentialId)?.state, "pending");
    clock.advanceWall(600_000);
    assert.throws(() => view.confirm(input.credentialId, input.scope), /duo-arm-expired/u);
    assert.deepEqual(readFileSync(path), pending); assert.deepEqual(readFileSync(headPath), head);
    assert.equal(view.readForScope(input.scope).find(row => row.credentialId === input.credentialId)?.state, "pending");
  } finally { await f.close(); }
});

it("burns failed and unknown signatures without replaying a count through a new view", async () => {
  const w = await fixture();
  try {
    const recordBefore = readFileSync(w.duoPath);
    const first = signRequest(w.input), signed = await w.view.sign(first);
    await assert.rejects(w.view.sign({ ...first, challenge: "BAUG" }), { code: "DUO_CREDENTIAL_CONFLICT" });
    await assert.rejects(w.view.sign({ ...signRequest(w.input), challenge: Buffer.alloc(4097).toString("base64") }), /duo-challenge-invalid/u);
    const afterLostResponse = w.owner.reserveDuoCounter(w.input.credentialId, "lost assertion response");
    assert.equal(afterLostResponse.count, signed.signCount + 2);
    assert.throws(() => createCanonicalCredentials(w.f.admission).reserveDuoCounter(w.input.credentialId, "lost assertion response"), { code: "CREDENTIAL_CONFLICT" });
    assert.equal((await createDuoCredentialStore(w.f.admission, w.clock).sign(signRequest(w.input))).signCount, signed.signCount + 3);
    assert.deepEqual(readFileSync(w.duoPath), recordBefore);
  } finally { await w.f.close(); }
});

for (const boundary of ["before-head-rename", "after-head-rename", "after-head-fsync"] as const) {
  it(`keeps a reservation exact at ${boundary} without replaying a durable allocation`, async () => {
    const w = await fixture(true), rename = fs.renameSync, fsync = fs.fsyncSync;
    const before = readFileSync(w.headPath), failure = new Error("synthetic reservation publication interruption"), request = randomUUID();
    let fired = false, published = false;
    vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
      if (String(target) === w.headPath && boundary === "before-head-rename" && !fired) { fired = true; throw failure; }
      rename(source, target);
      if (String(target) === w.headPath) {
        published = true;
        if (boundary === "after-head-rename" && !fired) { fired = true; throw failure; }
      }
    });
    vi.spyOn(fs, "fsyncSync").mockImplementation(descriptor => {
      fsync(descriptor);
      const opened = fs.fstatSync(descriptor), directory = lstatSync(join(w.f.machine.stateRoot, "machine", "credential-keys"));
      if (boundary === "after-head-fsync" && published && !fired && opened.dev === directory.dev && opened.ino === directory.ino) { fired = true; throw failure; }
    });
    syncBuiltinESMExports();
    try { assert.throws(() => w.owner.reserveDuoCounter(w.input.credentialId, request), { code: "CREDENTIAL_UNCERTAIN" }); }
    finally { vi.restoreAllMocks(); syncBuiltinESMExports(); }
    try {
      assert.equal(fired, true);
      assert.deepEqual(w.f.machine.readProfileRegistry().profiles, []);
      const fresh = createCanonicalCredentials(w.f.admission);
      if (boundary === "before-head-rename") {
        assert.deepEqual(readFileSync(w.headPath), before);
        const directory = join(w.f.machine.stateRoot, "machine", "credential-keys");
        const stages = readdirSync(directory).filter(name => name.startsWith(`.${w.profileId}.`) && name.endsWith(".canonical.tmp"));
        assert.equal(stages.length, 1); const name = stages[0]; assert.ok(name);
        const stagePath = join(directory, name), stageBytes = readFileSync(stagePath), stageIdentity = lstatSync(stagePath);
        const pending = CanonicalCredentialHeadSchema.parse(JSON.parse(stageBytes.toString("utf8")));
        assert.equal(pending.counters.find(counter => counter.credentialId === w.input.credentialId)?.count, 1);
        const current = CanonicalCredentialHeadSchema.parse(JSON.parse(before.toString("utf8")));
        assert.equal(current.counters.some(counter => counter.credentialId === w.input.credentialId), false);
        assert.throws(() => fresh.reserveDuoCounter(w.input.credentialId, request), error => error instanceof Error
          && "code" in error && error.code === "CREDENTIAL_UNAVAILABLE" && error.cause instanceof Error
          && "code" in error.cause && error.cause.code === "CREDENTIAL_OPERATION_PENDING");
        assert.deepEqual(readFileSync(stagePath), stageBytes); assert.equal(lstatSync(stagePath).ino, stageIdentity.ino);
        assert.deepEqual(readFileSync(w.headPath), before);
      } else {
        assert.notDeepEqual(readFileSync(w.headPath), before);
        assert.throws(() => fresh.reserveDuoCounter(w.input.credentialId, request), { code: "CREDENTIAL_CONFLICT" });
        assert.equal(fresh.reserveDuoCounter(w.input.credentialId, randomUUID()).count, 2);
      }
    } finally { await w.f.close(); }
  });
}

it("reads the committed record after a lost replacement acknowledgment without rerunning the mutation", async () => {
  const w = await fixture();
  try {
    const current = w.owner.readRecord("duo"); assert.ok(current);
    const owner = createCanonicalCredentials(w.f.admission, { afterReplace(kind) { if (kind === "duo") throw new Error("synthetic lost replacement acknowledgment"); } });
    assert.throws(() => owner.replaceRecord("duo", current.revision, current.value), { code: "CREDENTIAL_UNCERTAIN" });
    const reopened = createCanonicalCredentials(w.f.admission).readRecord("duo"); assert.ok(reopened);
    assert.equal(reopened.revision, current.revision + 1); assert.deepEqual(reopened.value, current.value);
    assert.throws(() => w.owner.replaceRecord("duo", current.revision, current.value), { code: "CREDENTIAL_CONFLICT" });
  } finally { await w.f.close(); }
});

it("keeps the external reservation high water across a real controller restart on the same installation", async () => {
  const w = await fixture();
  const binding = w.f.admission.profileBinding, workspace = w.f.workspace;
  const first = w.owner.reserveDuoCounter(w.input.credentialId, "before controller close");
  await w.f.closeController();
  const lifetime = await RuntimeLifetimeLock.acquire(0);
  const machine = acquireEntrypointAdmission(workspace, "exclusive", lifetime);
  let admission: ReturnType<typeof machine.admitProfile> | undefined;
  try {
    signInBoundProfileFixture(machine); admission = machine.admitProfile(binding.profileId);
    assert.deepEqual(admission.profileBinding, binding);
    const reopened = createCanonicalCredentials(admission);
    assert.throws(() => reopened.reserveDuoCounter(w.input.credentialId, "before controller close"), { code: "CREDENTIAL_CONFLICT" });
    assert.equal(reopened.reserveDuoCounter(w.input.credentialId, "after controller restart").count, first.count + 1);
  } finally { admission?.release(); machine.release(); await lifetime.close(); await w.f.close(); }
});

it("fails closed at a monotonically prepared uint32 boundary without changing that authenticated head", async () => {
  const w = await fixture();
  try {
    const first = w.owner.reserveDuoCounter(w.input.credentialId, "known first reservation"); assert.equal(first.count, 1);
    const head = CanonicalCredentialHeadSchema.parse(JSON.parse(readFileSync(w.headPath, "utf8"))); assert.equal(head.state, "active");
    if (head.state !== "active") throw new Error("fresh active head required");
    const entry = new FakeKeyringEntry("Relay", `${head.installationId}:${head.profileId}`), fakeKey = entry.getPassword();
    assert.notEqual(fakeKey, null);
    const owned = credentialKeyCustody.read(head.key); assert.equal(owned.key, fakeKey);
    const { mac: _mac, ...body } = head;
    const next = { ...body, revision: body.revision + 1, counters: body.counters.map(counter => counter.credentialId === w.input.credentialId
      ? { ...counter, count: 0xffff_ffff, requests: [...counter.requests, { requestId: "explicit fresh boundary prestate", count: 0xffff_ffff }] } : counter) };
    const mac = createHmac("sha256", Buffer.from(owned.key, "base64")).update("relay:canonical-credential-head:v1\0").update(canonicalJsonStringify(next)).digest("hex");
    const saturated = Buffer.from(canonicalJsonStringify(CanonicalCredentialHeadSchema.parse({ ...next, mac })));
    writeFileSync(w.headPath, saturated);
    assert.throws(() => w.owner.reserveDuoCounter(w.input.credentialId, "overflow must not publish"), { code: "CREDENTIAL_UNAVAILABLE" });
    assert.deepEqual(readFileSync(w.headPath), saturated);
    const after = CanonicalCredentialHeadSchema.parse(JSON.parse(readFileSync(w.headPath, "utf8")));
    assert.equal(after.counters.find(row => row.credentialId === w.input.credentialId)?.count, 0xffff_ffff);
  } finally { await w.f.close(); }
});

it("burns a real inherited process allocation when that process exits before releasing its runtime", async () => {
  const w = await fixture(false, true);
  let restarted: RuntimeLifetimeLock | undefined, machine: ReturnType<typeof acquireEntrypointAdmission> | undefined, admission: ReturnType<typeof w.f.machine.admitProfile> | undefined;
  try {
    const run = (request: string, mode: string) => runInheritedRuntimeChild(restarted ?? w.f.lifetime, new URL("../../../support/processes/duo-credential-worker.ts", import.meta.url),
      [w.f.workspace, w.profileId, w.input.credentialId, request, mode], { env: credentialKeychainTestEnvironment(process.env) });
    const [first, peer] = await Promise.all([run("first independent process", "close"), run("concurrent independent process", "close")]);
    assert.equal(peer.status, 0); assert.equal(peer.signal, null); assert.equal(peer.stderr, "");
    const concurrent = JSON.parse(peer.stdout) as { pid: number; count: number };
    const crashed = await run("dead process reservation", "crash"), next = await run("fresh process after death", "close");
    assert.equal(first.status, 0); assert.equal(crashed.status, 23); assert.equal(next.status, 0);
    assert.equal(first.signal, null); assert.equal(crashed.signal, null); assert.equal(next.signal, null);
    assert.equal(first.stderr, ""); assert.equal(crashed.stderr, ""); assert.equal(next.stderr, "");
    const a = JSON.parse(first.stdout) as { pid: number; count: number }, b = JSON.parse(crashed.stdout) as { pid: number; count: number }, c = JSON.parse(next.stdout) as { pid: number; count: number };
    assert.notEqual(a.pid, process.pid); assert.notEqual(b.pid, a.pid); assert.notEqual(c.pid, b.pid);
    assert.notEqual(concurrent.pid, a.pid); assert.notEqual(concurrent.pid, process.pid);
    assert.equal(Math.max(concurrent.count, a.count), Math.min(concurrent.count, a.count) + 1);
    assert.equal(b.count, Math.max(concurrent.count, a.count) + 1); assert.equal(c.count, b.count + 1);
    assert.throws(() => w.owner.reserveDuoCounter(w.input.credentialId, "dead process reservation"), { code: "CREDENTIAL_CONFLICT" });
    const interrupted = await run("head rename process death", "crash-head");
    assert.equal(interrupted.status, 97); assert.equal(interrupted.signal, null); assert.equal(interrupted.stdout, ""); assert.equal(interrupted.stderr, "");
    const durable = CanonicalCredentialHeadSchema.parse(JSON.parse(readFileSync(w.headPath, "utf8")));
    assert.equal(durable.counters.find(row => row.credentialId === w.input.credentialId)?.count, c.count + 1);
    await w.f.closeController();
    restarted = await RuntimeLifetimeLock.acquire(0);
    machine = acquireEntrypointAdmission(w.f.workspace, "exclusive", restarted);
    signInBoundProfileFixture(machine); machine.release();
    machine = acquireEntrypointAdmission(w.f.workspace, "shared", restarted);
    admission = machine.admitProfile(w.profileId);
    const reopened = createCanonicalCredentials(admission);
    assert.throws(() => reopened.reserveDuoCounter(w.input.credentialId, "head rename process death"), { code: "CREDENTIAL_CONFLICT" });
    const recovered = await run("after head rename process death", "close"); assert.equal(recovered.status, 0); assert.equal(recovered.signal, null); assert.equal(recovered.stderr, "");
    assert.equal((JSON.parse(recovered.stdout) as { count: number }).count, c.count + 2);
  } finally { admission?.release(); machine?.release(); await restarted?.close(); await w.f.close(); }
}, scaledMs(30_000));

for (const field of ["tag", "kind", "installationId", "profileId", "keyId", "revision"] as const) {
  it(`refuses changed encrypted Duo ${field} without modifying its external head`, async () => {
    const w = await fixture();
    const original = readFileSync(w.duoPath), head = readFileSync(w.headPath), envelope = JSON.parse(original.toString("utf8")) as Record<string, unknown>;
    const changed = field === "tag" ? { ...envelope, tag: Buffer.alloc(16, 3).toString("base64") }
      : field === "kind" ? { ...envelope, kind: "protected" }
      : field === "revision" ? { ...envelope, revision: Number(envelope.revision) + 1 } : { ...envelope, [field]: randomUUID() };
    try {
      writeFileSync(w.duoPath, JSON.stringify(changed));
      assert.throws(() => w.owner.readRecord("duo"), { code: "CREDENTIAL_UNAVAILABLE" });
      assert.deepEqual(readFileSync(w.headPath), head);
      assert.deepEqual(JSON.parse(readFileSync(w.duoPath, "utf8")), changed);
    } finally { writeFileSync(w.duoPath, original); await w.f.close(); }
  });
}

it("refuses another genuinely created person's record and a fabricated admission", async () => {
  const first = await fixture(), second = await fixture();
  const original = readFileSync(first.duoPath), foreign = readFileSync(second.duoPath);
  try {
    assert.notEqual(first.profileId, second.profileId);
    assert.notEqual(first.f.admission.profileBinding.installationId, second.f.admission.profileBinding.installationId);
    writeFileSync(first.duoPath, foreign);
    assert.throws(() => first.owner.readRecord("duo"), { code: "CREDENTIAL_UNAVAILABLE" });
    assert.deepEqual(readFileSync(first.duoPath), foreign);
    assert.throws(() => Reflect.apply(createCanonicalCredentials, undefined, [{ ...first.f.admission }]));
  } finally { writeFileSync(first.duoPath, original); await second.f.close(); await first.f.close(); }
});

for (const problem of ["missing-record", "unsafe-mode", "unknown-copy", "symlink", "hardlink"] as const) {
  it(`refuses ${problem} instead of treating an established person as uninitialized`, async () => {
    const w = await fixture(), original = readFileSync(w.duoPath), extra = join(w.f.stateRoot, "credentials", "unowned-credential.json"), retained = join(w.f.workspace, "test-retained-duo-source");
    try {
      if (problem === "missing-record") unlinkSync(w.duoPath);
      else if (problem === "unsafe-mode") chmodSync(w.duoPath, 0o644);
      else if (problem === "unknown-copy") writeFileSync(extra, original, { mode: 0o600 });
      else if (problem === "symlink") { renameSync(w.duoPath, retained); symlinkSync(retained, w.duoPath); }
      else linkSync(w.duoPath, retained);
      assert.throws(() => w.owner.readRecord("duo"), { code: "CREDENTIAL_UNAVAILABLE" });
      if (problem === "unknown-copy") assert.deepEqual(readFileSync(extra), original);
    } finally {
      if (problem === "missing-record") writeFileSync(w.duoPath, original, { mode: 0o600 });
      if (problem === "unsafe-mode") chmodSync(w.duoPath, 0o600);
      if (existsSync(extra)) unlinkSync(extra);
      if (problem === "symlink") { unlinkSync(w.duoPath); renameSync(retained, w.duoPath); }
      if (problem === "hardlink") unlinkSync(retained);
      await w.f.close();
    }
  });
}

for (const change of ["missing", "mismatched"] as const) it(`never substitutes a ${change} native key and preserves canonical source bytes`, async () => {
  const w = await fixture();
  const binding = w.f.admission.profileBinding, entry = new FakeKeyringEntry("Relay", `${binding.installationId}:${binding.profileId}`);
  assert.notEqual(entry.getPassword(), null);
  const source = readFileSync(w.duoPath), head = readFileSync(w.headPath);
  try {
    if (change === "missing") entry.deletePassword(); else entry.setPassword(randomBytes(32).toString("base64"));
    assert.throws(() => w.owner.readRecord("duo"), { code: "CREDENTIAL_UNAVAILABLE" });
    assert.deepEqual(readFileSync(w.duoPath), source); assert.deepEqual(readFileSync(w.headPath), head);
  } finally { await w.f.close(); }
});

for (const when of ["between-reads", "during-decrypt"] as const) {
  it(`rechecks genuine admission ${when} and refuses plaintext after release`, async () => {
    const w = await fixture(), decipher = nativeCrypto.createDecipheriv;
    try {
      const current = w.owner.readRecord("duo"); assert.ok(current);
      assert.deepEqual(w.owner.readRecord("duo"), current);
      let fired = false;
      if (when === "between-reads") { fired = true; w.f.admission.release(); }
      else {
        vi.spyOn(nativeCrypto, "createDecipheriv").mockImplementation((...args: Parameters<typeof decipher>) => {
          const result = decipher(...args); if (!fired) { fired = true; w.f.admission.release(); } return result;
        }); syncBuiltinESMExports();
      }
      assert.throws(() => w.owner.readRecord("duo"), { code: "CREDENTIAL_UNAVAILABLE" }); assert.equal(fired, true);
      assert.throws(() => w.owner.readRecord("duo"), { code: "CREDENTIAL_UNAVAILABLE" });
    } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); await w.f.close(); }
  });
}

for (const readNumber of [1, 2]) it(`retains actual Duo read descriptor ${readNumber} and its genuine owner on native close failure`, async () => {
  await runCredentialSourceRetentionCase(readNumber === 1 ? "duo-read-first" : "duo-read-second");
});

it("keeps exact canonical credential bytes and the current counter when the person database is replaced", async () => {
  const w = await fixture();
  try {
    const database = new DatabaseSync(w.f.path); database.exec("CREATE TABLE recovery_counter_probe(value INTEGER); INSERT INTO recovery_counter_probe VALUES(1)");
    database.close();
    const backup = readFileSync(w.f.path), first = w.owner.reserveDuoCounter(w.input.credentialId, "before person DB replacement");
    const after = new DatabaseSync(w.f.path); after.exec("UPDATE recovery_counter_probe SET value=2"); after.close();
    const head = readFileSync(w.headPath), record = readFileSync(w.duoPath);
    writeFileSync(w.f.path, backup);
    assert.deepEqual(readFileSync(w.headPath), head); assert.deepEqual(readFileSync(w.duoPath), record);
    const refreshed = createCanonicalCredentials(w.f.admission);
    assert.equal(refreshed.reserveDuoCounter(w.input.credentialId, "after person DB replacement").count, first.count + 1);
    assert.throws(() => refreshed.reserveDuoCounter(w.input.credentialId, "before person DB replacement"), { code: "CREDENTIAL_CONFLICT" });
  } finally { await w.f.close(); }
});

for (const boundary of ["head", "key", "protected", "duo", "chatgpt", "consume"] as const) {
  it(`resumes only the exact recorded genuine draft erase after ${boundary}`, async () => {
    const w = await fixture(true), operation = beginAbort(w.f), rename = fs.renameSync, unlink = fs.unlinkSync;
    const planPath = join(w.f.machine.stateRoot, "machine", "credential-operations", `${w.profileId}.json`);
    const protectedPath = join(w.f.stateRoot, "credentials", "protected.json"), chatgptPath = join(w.f.stateRoot, "credentials", "chatgpt-account.json");
    const entry = new FakeKeyringEntry("Relay", `${w.f.admission.profileBinding.installationId}:${w.profileId}`), remove = entry.deletePassword.bind(entry);
    const targets = { protected: protectedPath, duo: w.duoPath, chatgpt: chatgptPath, consume: planPath };
    let fired = false;
    if (boundary === "head") vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
      rename(source, target); if (String(target) === w.headPath && !fired) { fired = true; throw new Error("synthetic erase head interruption"); }
    });
    else if (boundary === "key") vi.spyOn(FakeKeyringEntry.prototype, "deletePassword").mockImplementationOnce(() => { remove(); fired = true; throw new Error("synthetic erase native key interruption"); });
    else vi.spyOn(fs, "unlinkSync").mockImplementation(path => {
      unlink(path); if (String(path) === targets[boundary] && !fired) { fired = true; throw new Error("synthetic erase source interruption"); }
    });
    syncBuiltinESMExports();
    try { assert.throws(() => eraseCanonicalDraftCredentials(w.f.machine, w.f.admission, operation)); }
    finally { vi.restoreAllMocks(); syncBuiltinESMExports(); }
    try {
      assert.equal(fired, true);
      const retained = readFileSync(w.headPath), head = CanonicalCredentialHeadSchema.parse(JSON.parse(retained.toString("utf8")));
      assert.equal(head.state, "erased"); assert.ok(head.retired.includes(w.input.credentialId));
      assert.throws(() => eraseCanonicalDraftCredentials(w.f.machine, w.f.admission, SignUpOperationSchema.parse({ ...operation,
        onboarding: { ...operation.onboarding, abort: { operationId: randomUUID(), generation: operation.onboarding?.abort?.generation } } })), /profile-credential-erasure-changed/u);
      assert.deepEqual(readFileSync(w.headPath), retained);
      eraseCanonicalDraftCredentials(w.f.machine, w.f.admission, operation);
      assert.deepEqual(readFileSync(w.headPath), retained);
      assert.equal(entry.getPassword(), null);
      for (const path of [w.duoPath, protectedPath, chatgptPath, planPath]) assert.equal(existsSync(path), false);
      assert.throws(() => w.owner.readRecord("duo"), { code: "CREDENTIAL_UNAVAILABLE" });
    } finally { await w.f.close(); }
  });
}

it("refuses a changed draft source before erase and never drops its key, record or operation", async () => {
  const w = await fixture(true), operation = beginAbort(w.f), original = readFileSync(w.duoPath), head = readFileSync(w.headPath);
  const entry = new FakeKeyringEntry("Relay", `${w.f.admission.profileBinding.installationId}:${w.profileId}`), key = entry.getPassword();
  assert.notEqual(key, null);
  try {
    writeFileSync(w.duoPath, "corrupt canonical draft credential");
    assert.throws(() => eraseCanonicalDraftCredentials(w.f.machine, w.f.admission, operation));
    assert.equal(entry.getPassword(), key); assert.deepEqual(readFileSync(w.headPath), head);
    assert.equal(existsSync(join(w.f.machine.stateRoot, "machine", "operations", `${operation.operationId}.json`)), true);
    writeFileSync(w.duoPath, original);
    eraseCanonicalDraftCredentials(w.f.machine, w.f.admission, operation);
    assert.equal(entry.getPassword(), null); assert.equal(existsSync(w.duoPath), false);
  } finally { if (existsSync(w.duoPath)) writeFileSync(w.duoPath, original); await w.f.close(); }
});

it("rejects divergent or duplicate stopped predecessor reservation lineage rather than adopting an unproved floor", () => {
  const binding = { installationId: randomUUID(), profileId: randomUUID() }, credentialId = "cmV0aXJlZA";
  const row = { state: "erased" as const, profileId: binding.profileId, revision: 3 as const, document: { device: 1, inode: 2, digest: "a".repeat(64) } };
  const reservation = { attemptId: randomUUID(), credentialId, count: 1, reservedAt: "2026-11-01T12:00:00.000Z" };
  const source = { schemaVersion: 1, ...binding, revision: 3, credentials: [], retired: [{ credentialId, highWater: 1 }], reservations: [reservation] };
  assert.equal(StoppedDuoCredentialDocumentSchema.safeParse(source).success, true);
  for (const changed of [{ ...source, reservations: [reservation, { ...reservation, attemptId: randomUUID() }] },
    { ...source, retired: [{ credentialId, highWater: 2 }] }, { ...source, reservations: [] }]) {
    assert.equal(StoppedDuoCredentialDocumentSchema.safeParse(changed).success, false);
    assert.throws(() => stoppedDuoConversionRecord(binding, row, changed));
  }
});

it("refuses a competing actual writer lock and reserves only after its observed release", async () => {
  const w = await fixture(), before = readFileSync(w.headPath);
  try {
    withPrivateFileLock(join(w.f.machine.stateRoot, "machine", "credential-keys"), `.${w.profileId}.writer.lock`, () => {
      assert.throws(() => w.owner.reserveDuoCounter(w.input.credentialId, "while peer writer owns lock"), { code: "CREDENTIAL_BUSY" });
      assert.deepEqual(readFileSync(w.headPath), before);
    });
    assert.equal(w.owner.reserveDuoCounter(w.input.credentialId, "after writer release").count, 1);
  } finally { await w.f.close(); }
});

it("retains genuine stopped maintenance and the actual canonical head descriptor when its native close fails", async () => {
  await runCredentialSourceRetentionCase("stopped-head-close");
});

it("refuses new profile admission after database schema drift during an independent Duo read", async () => {
  const w = await fixture(), database = new DatabaseSync(w.f.path), close = fs.closeSync, target = lstatSync(w.duoPath);
  const record = w.owner.readRecord("duo"), before = readFileSync(w.duoPath), head = readFileSync(w.headPath);
  const version = database.prepare("PRAGMA user_version").get()?.user_version; assert.equal(typeof version, "number");
  let fired = false;
  vi.spyOn(fs, "closeSync").mockImplementation(descriptor => {
    const opened = fs.fstatSync(descriptor); close(descriptor);
    if (!fired && opened.dev === target.dev && opened.ino === target.ino) { fired = true; database.exec("PRAGMA user_version=0"); }
  }); syncBuiltinESMExports();
  try {
    assert.deepEqual(w.owner.readRecord("duo"), record); assert.equal(fired, true);
    assert.throws(() => w.f.machine.admitProfile(w.profileId), /profile-database-schema-mismatch/u);
    assert.deepEqual(readFileSync(w.duoPath), before); assert.deepEqual(readFileSync(w.headPath), head);
  }
  finally { vi.restoreAllMocks(); syncBuiltinESMExports(); database.exec(`PRAGMA user_version=${String(version)}`); database.close(); await w.f.close(); }
});

for (const boundary of ["key-read", "current-document-read", "final-document-read", "decrypt"] as const) it(`refuses genuine draft operation drift during ${boundary}`, async () => {
  const w = await fixture(true), operation = currentOperation(w.f), operationPath = join(w.f.machine.stateRoot, "machine", "operations", `${operation.operationId}.json`),
    original = readFileSync(operationPath), target = lstatSync(boundary === "key-read" ? w.headPath : w.duoPath), read = fs.readFileSync, close = fs.closeSync, decipher = nativeCrypto.createDecipheriv;
  let fired = false, reads = 0;
  const mutate = () => { if (!fired) { fired = true; writeFileSync(operationPath, JSON.stringify({ ...operation, commandFingerprint: "b".repeat(64) })); } };
  vi.spyOn(fs, "readFileSync").mockImplementation((...args: Parameters<typeof read>) => {
    const result = read(...args);
    if (typeof args[0] === "number" && boundary !== "decrypt" && boundary !== "final-document-read") {
      const opened = fs.fstatSync(args[0]);
      if (opened.dev === target.dev && opened.ino === target.ino && ++reads === 1) mutate();
    }
    return result;
  });
  vi.spyOn(fs, "closeSync").mockImplementation(descriptor => {
    const opened = fs.fstatSync(descriptor); close(descriptor);
    if (boundary === "final-document-read" && opened.dev === target.dev && opened.ino === target.ino) mutate();
  });
  vi.spyOn(nativeCrypto, "createDecipheriv").mockImplementation((...args: Parameters<typeof decipher>) => { const result = decipher(...args); if (boundary === "decrypt") mutate(); return result; });
  syncBuiltinESMExports();
  try { assert.throws(() => w.owner.readRecord("duo"), { code: "CREDENTIAL_UNAVAILABLE" }); assert.equal(fired, true); }
  finally { vi.restoreAllMocks(); syncBuiltinESMExports(); writeFileSync(operationPath, original); await w.f.close(); }
});

for (const shape of ["object", "array", "wrapper", "malformed"] as const) it(`holds unexplained retained ${shape} signer bytes before fresh key creation`, async () => {
  const f = await createBoundProfileFixture({ pending: "storage" }), operation = currentOperation(f), initial = initialDocument();
  const path = join(f.stateRoot, "credentials", "duo-webauthn.json");
  const legacy = { rpId: "duosecurity.com", credentialId: "synthetic-retained-id", privateKey: "synthetic-retained-key", signCount: 42, transport: "internal" };
  const bytes = Buffer.from(shape === "malformed" ? "invalid legacy signer bytes" : JSON.stringify(shape === "array" ? [legacy] : shape === "wrapper" ? { credentials: [legacy] } : legacy));
  mkdirSync(join(f.stateRoot, "credentials"), { recursive: true, mode: 0o700 });
  writeFileSync(path, bytes, { mode: 0o600 });
  const entry = new FakeKeyringEntry("Relay", `${f.admission.profileBinding.installationId}:${f.admission.profileBinding.profileId}`);
  assert.equal(entry.getPassword(), null);
  try {
    assert.throws(() => initializeCanonicalCredentials(f.machine, f.admission, operation, { revision: initial.record.revision, value: initial }), { code: "CREDENTIAL_OPERATION_PENDING" });
    assert.equal(entry.getPassword(), null); assert.deepEqual(readFileSync(path), bytes);
  } finally { unlinkSync(path); await f.close(); }
});

it("cannot erase, restore or drop an established Duo identity through the ordinary record view", async () => {
  const w = await fixture();
  try {
    const frame = w.owner.readRecord("duo"); assert.ok(frame);
    const record = DuoCredentialRecordSchema.parse(frame.value), source = readFileSync(w.duoPath), head = readFileSync(w.headPath);
    assert.equal(Object.hasOwn(w.view, "erase"), false); assert.equal(Object.hasOwn(w.view, "backup"), false); assert.equal(Object.hasOwn(w.view, "restore"), false);
    assert.throws(() => w.owner.replaceRecord("duo", frame.revision, { credentials: record.credentials.filter(row => row.credentialId !== w.input.credentialId) }), { code: "CREDENTIAL_CONFLICT" });
    assert.deepEqual(readFileSync(w.duoPath), source); assert.deepEqual(readFileSync(w.headPath), head);
  } finally { await w.f.close(); }
});

it("reopens an actual unpublished draft after controller closure without replaying its durable counter", async () => {
  const w = await fixture(true), binding = w.f.admission.profileBinding, operation = currentOperation(w.f);
  const requestId = "draft reservation with lost response", first = w.owner.reserveDuoCounter(w.input.credentialId, requestId);
  const workspace = w.f.workspace;
  await w.f.closeController();
  const lifetime = await RuntimeLifetimeLock.acquire(0), machine = acquireEntrypointAdmission(workspace, "exclusive", lifetime);
  let admission: ReturnType<typeof machine.admitProfile> | undefined;
  try {
    assert.deepEqual(machine.readProfileRegistry().profiles, []);
    admission = machine.admitProfile(binding.profileId); assert.deepEqual(admission.profileBinding, binding);
    const owner = createCanonicalCredentials(admission);
    assert.throws(() => owner.reserveDuoCounter(w.input.credentialId, requestId), { code: "CREDENTIAL_CONFLICT" });
    assert.equal(owner.reserveDuoCounter(w.input.credentialId, "fresh unpublished-draft reservation").count, first.count + 1);
    const continued = SignUpOperationSchema.parse(JSON.parse(readFileSync(join(machine.stateRoot, "machine", "operations", `${operation.operationId}.json`), "utf8")));
    assert.equal(continued.operationId, operation.operationId); assert.equal(continued.profileId, binding.profileId);
    assert.deepEqual(machine.readProfileRegistry().profiles, []);
  } finally { admission?.release(); machine.release(); await lifetime.close(); await w.f.close(); }
});

for (const phase of ["active", "erased"] as const) it(`refuses a foreign nested native-key binding in actual ${phase} authority before touching that account`, async () => {
  const actualEntry: unknown = Entry; assert.equal(actualEntry, FakeKeyringEntry);
  const w = await fixture(phase === "erased"), foreign = await fixture();
  try {
    if (phase === "erased") eraseCanonicalDraftCredentials(w.f.machine, w.f.admission, beginAbort(w.f));
    const head = CanonicalCredentialHeadSchema.parse(JSON.parse(readFileSync(w.headPath, "utf8")));
    const other = CanonicalCredentialHeadSchema.parse(JSON.parse(readFileSync(foreign.headPath, "utf8")));
    const currentEntry = new FakeKeyringEntry("Relay", `${head.installationId}:${head.profileId}`), foreignEntry = new FakeKeyringEntry("Relay", `${other.installationId}:${other.profileId}`);
    const currentKey = currentEntry.getPassword(), foreignKey = foreignEntry.getPassword(); assert.notEqual(foreignKey, null);
    const sourcePaths = [w.headPath, w.duoPath, foreign.headPath, foreign.duoPath].filter(path => existsSync(path));
    const changed = { ...head, key: { ...head.key, installationId: other.installationId, profileId: other.profileId, keyDigest: other.key.keyDigest } };
    writeFileSync(w.headPath, JSON.stringify(changed));
    const before = sourcePaths.map(path => ({ path, bytes: readFileSync(path) }));
    const get = vi.spyOn(FakeKeyringEntry.prototype, "getPassword"), remove = vi.spyOn(FakeKeyringEntry.prototype, "deletePassword");
    try {
      if (phase === "active") assert.throws(() => w.owner.readRecord("duo"), { code: "CREDENTIAL_UNAVAILABLE" });
      else eraseRefusal();
      assert.equal(get.mock.calls.length, 0); assert.equal(remove.mock.calls.length, 0);
    } finally { get.mockRestore(); remove.mockRestore(); }
    function eraseRefusal() {
      const operation = currentOperation(w.f);
      assert.throws(() => eraseCanonicalDraftCredentials(w.f.machine, w.f.admission, operation), { code: "CREDENTIAL_UNAVAILABLE" });
    }
    assert.equal(currentEntry.getPassword(), currentKey); assert.equal(foreignEntry.getPassword(), foreignKey);
    for (const source of before) assert.deepEqual(readFileSync(source.path), source.bytes);
  } finally { await foreign.f.close(); await w.f.close(); }
});
