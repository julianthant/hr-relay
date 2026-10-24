import { createProfileSession } from "../../../../src/backend/profiles/profile-session.js";
import { composeProfileCredentialInitializationInventory, composeProfileCredentialRepairInventory, composeStoppedControlCredentialInventory } from "../../../../src/backend/app/composition/profile-credential-inventory.js";
import { verifyStoppedControlCredentialAttestation } from "../../../../src/backend/storage/configuration/credential-store.js";
import { fork } from "node:child_process";
import { on, once } from "node:events";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { acquireStoppedProfileControlUpgrade } from "../../../../src/backend/storage/admission/installation.js";
import { upgradeStoppedMachineControl } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { acquireRuntimeRestoreAdmission } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { chmodSync, copyFileSync, linkSync, mkdirSync, readdirSync, readFileSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { createDuoCredentialStore, DuoCredentialCommitUncertainError } from "../../../../src/backend/storage/configuration/duo-credential-store.js";
import { issueDuoCredentialPurpose, openDuoCredentialDocument } from "../../../../src/backend/storage/configuration/credential-store.js";
import { DuoCredentialDocumentSchema } from "../../../../src/models/config/duo-credential-store.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

function setup(options: { sharedMachine?: true } = {}) {
  const fixture = createBoundProfileFixture(options), clock = manualClock(new Date("2026-10-22T12:00:00.000Z"));
  const store = createDuoCredentialStore(fixture.admission, fixture.machine, clock);
  const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const input = { credentialId: Buffer.from(randomUUID()).toString("base64url"),
    scope: { armId: randomUUID(), contextId: randomUUID(), tabId: 1, accountId: randomUUID(), origin: "https://login.duosecurity.com", rpId: "duosecurity.com",
      armedAt: clock.now().toISOString(), expiresAt: new Date(clock.nowMs() + 600_000).toISOString() },
    privateKeyPkcs8: key.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
    publicKeySpki: key.publicKey.export({ type: "spki", format: "der" }).toString("base64") };
  const path = join(fixture.machine.stateRoot, "machine", "duo-credentials", `${fixture.admission.profileBinding.profileId}.json`);
  return { ...fixture, clock, store, input, documentPath: path };
}

it("durably stages pending enrollment before acknowledgement and holds signing until exact confirmation", () => {
  const f = setup();
  try {
    const registry = readFileSync(join(f.machine.stateRoot, "machine", "profiles.json"));
    const protectedBytes = readFileSync(join(f.stateRoot, "credentials", "protected.json"));
    assert.deepEqual(f.store.read(), { state: "never-initialized", revision: 0, credentials: [] });
    assert.equal(f.store.enroll(f.input).revision, 1);
    const bytes = readFileSync(f.documentPath);
    assert.equal(bytes.includes(f.input.privateKeyPkcs8), false);
    assert.deepEqual(f.store.read().credentials.map(row => row.state), ["pending"]);
    assert.throws(() => f.store.reserve(f.input.credentialId), /duo-ready-credential-required/u);
    assert.throws(() => f.store.confirm("foreign", f.input.scope), /duo-pending-credential-mismatch/u);
    assert.throws(() => f.store.confirm(f.input.credentialId, { ...f.input.scope, tabId: 2 }), /duo-pending-credential-mismatch/u);
    assert.equal(f.store.confirm(f.input.credentialId, f.input.scope).revision, 2);
    const first = f.store.reserve(f.input.credentialId), second = f.store.reserve(f.input.credentialId);
    assert.equal(first.count, Math.floor(f.clock.nowMs() / 1000));
    assert.equal(second.count, first.count + 1); assert.notEqual(first.attemptId, second.attemptId);
    assert.equal(readFileSync(join(f.machine.stateRoot, "machine", "profiles.json")).equals(registry), true);
    assert.equal(readFileSync(join(f.stateRoot, "credentials", "protected.json")).equals(protectedBytes), true);
    assert.throws(() => f.store.confirm(f.input.credentialId, f.input.scope), /duo-pending-credential-mismatch/u);
  } finally { f.close(); }
});

it("burns committed attempts across new store instances and refuses document rollback or substitution", () => {
  const f = setup();
  try {
    f.store.enroll(f.input); f.store.confirm(f.input.credentialId, f.input.scope);
    const prior = readFileSync(f.documentPath), first = f.store.reserve(f.input.credentialId);
    const fresh = createDuoCredentialStore(f.admission, f.machine, f.clock), second = fresh.reserve(f.input.credentialId);
    assert.equal(second.count, first.count + 1);
    const current = readFileSync(f.documentPath);
    writeFileSync(f.documentPath, prior);
    assert.throws(() => fresh.read(), /duo-document-custody-changed/u);
    writeFileSync(f.documentPath, current);
    const substituted = `${f.documentPath}.substitute`;
    copyFileSync(f.documentPath, substituted); chmodSync(substituted, 0o600); renameSync(substituted, f.documentPath);
    assert.throws(() => fresh.read(), /duo-document-custody-changed/u);
  } finally { f.close(); }
});

it("rejects unsafe files and a missing established document without treating either as initial state", () => {
  const f = setup();
  try {
    f.store.enroll(f.input);
    chmodSync(f.documentPath, 0o644);
    assert.throws(() => f.store.read(), /permissions|unsafe|private/u);
    chmodSync(f.documentPath, 0o600);
    unlinkSync(f.documentPath);
    assert.throws(() => f.store.read(), /duo-document-membership-mismatch|duo-document-required/u);
  } finally { f.close(); }
});

it("explicit erasure retires identities and counters without reviving a retired key", () => {
  const f = setup();
  try {
    f.store.enroll(f.input); f.store.confirm(f.input.credentialId, f.input.scope); f.store.reserve(f.input.credentialId);
    const revision = f.store.erase().revision;
    assert.deepEqual(f.store.read(), { state: "erased", revision, credentials: [] });
    assert.throws(() => f.store.reserve(f.input.credentialId), /duo-ready-credential-required/u);
    assert.throws(() => f.store.enroll(f.input), /duo-credential-id-reused/u);
  } finally { f.close(); }
});

it("refuses expired pending confirmation and released profile custody", () => {
  const f = setup();
  try {
    f.store.enroll(f.input); f.clock.advanceWall(600_000);
    assert.throws(() => f.store.confirm(f.input.credentialId, f.input.scope), /duo-arm-expired/u);
    f.admission.release();
    assert.throws(() => f.store.read(), /released|expired/u);
  } finally { f.close(); }
});

it("rejects divergent duplicate reservation lineage in authenticated document models", () => {
  const profileId = randomUUID(), installationId = randomUUID(), credentialId = "cHVibGljLWZpeHR1cmU";
  const attempt = { attemptId: randomUUID(), credentialId, count: 1, reservedAt: "2026-10-22T12:00:00.000Z" };
  assert.equal(DuoCredentialDocumentSchema.safeParse({ schemaVersion: 1, installationId, profileId, revision: 1,
    credentials: [], retired: [{ credentialId, highWater: 1 }], reservations: [attempt, { ...attempt, attemptId: randomUUID() }] }).success, false);
});

it("authenticates encrypted payloads with the issued anchored key and distinct purpose", () => {
  const f = setup();
  try {
    f.store.enroll(f.input);
    const purpose = issueDuoCredentialPurpose(f.admission, f.machine);
    const bytes = readFileSync(f.documentPath), envelope = JSON.parse(bytes.toString("utf8")) as { tag: string };
    const tag = Buffer.from(envelope.tag, "base64"); tag[0] = (tag[0] ?? 0) ^ 1;
    const corrupted = Buffer.from(JSON.stringify({ ...envelope, tag: tag.toString("base64") }));
    assert.throws(() => openDuoCredentialDocument(purpose, corrupted, 1), /duo-document-authentication-failed/u);
    assert.throws(() => openDuoCredentialDocument(purpose, bytes, 2), /duo-envelope-binding-mismatch/u);
    assert.throws(() => openDuoCredentialDocument({ profileId: purpose.profileId }, bytes, 1), /duo-purpose-unissued/u);
    assert.equal(f.store.read().revision, 1);
  } finally { f.close(); }
});

it("fails closed at uint32 exhaustion without changing the last committed count", () => {
  const f = setup();
  try {
    f.store.enroll(f.input); f.store.confirm(f.input.credentialId, f.input.scope);
    f.clock.setWall(new Date(0xffff_ffff * 1000));
    assert.equal(f.store.reserve(f.input.credentialId).count, 0xffff_ffff);
    const before = readFileSync(f.documentPath);
    assert.throws(() => f.store.reserve(f.input.credentialId), /duo-counter-exhausted/u);
    assert.equal(readFileSync(f.documentPath).equals(before), true);
    assert.equal(f.store.read().credentials[0]?.highWater, 0xffff_ffff);
  } finally { f.close(); }
});

function stoppedControlFixture(retainedCredential?: unknown) {
  const fixture = createBoundProfileFixture();
  const profileId = fixture.admission.profileBinding.profileId;
  if (retainedCredential !== undefined) writeFileSync(join(fixture.stateRoot, "credentials", "duo-webauthn.json"), JSON.stringify(retainedCredential), { mode: 0o600 });
  const controlPath = join(fixture.workspace, ".tracker", "control", "profile-registry.json");
  const markerPath = join(fixture.machine.stateRoot, "machine", "profile-registry-version.json");
  const current = JSON.parse(readFileSync(controlPath, "utf8")) as { schemaVersion: number; duo: Array<{ state: string }> };
  assert.equal(current.schemaVersion, 2);
  assert.ok(current.duo.every(row => row.state === "never-initialized"));
  const { duo: _duo, ...prior } = current;
  fixture.admission.release(); fixture.machine.release();
  writeFileSync(controlPath, JSON.stringify({ ...prior, schemaVersion: 1 }));
  writeFileSync(markerPath, JSON.stringify({ schemaVersion: 2 }));
  const processLockRoot = join(fixture.workspace, rebuildRuntimeIsolation.processLockRoot);
  const restore = acquireRuntimeRestoreAdmission({ processLockRoot, pid: process.pid });
  try {
    const upgrade = acquireStoppedProfileControlUpgrade(fixture.workspace, restore);
    return { ...fixture, profileId, controlPath, upgrade, restore,
      close() { upgrade.release(); restore.release(); fixture.close(); } };
  } catch (error) { restore.release(); fixture.close(); throw error; }
}

const retainedCredential = { rpId: "duosecurity.com", credentialId: "synthetic-retained-id", privateKey: "synthetic-retained-key", signCount: 42, transport: "internal" };
for (const shape of ["object", "array", "wrapper"] as const) it(`authenticates retained active-engine ${shape} bytes without changing them during control-only assessment`, () => {
  const f = stoppedControlFixture(shape === "object" ? retainedCredential : shape === "array" ? [retainedCredential] : { credentials: [retainedCredential] });
  let inventory: ReturnType<typeof composeStoppedControlCredentialInventory> | undefined;
  try {
    const path = join(f.stateRoot, "credentials", "duo-webauthn.json"), bytes = readFileSync(path);
    const claim = f.upgrade.profileInventory(f.profileId);
    inventory = composeStoppedControlCredentialInventory({ claim, hostFacts: { primaryDisplay: null }, clock: manualClock(new Date()) });
    const afterPublication = verifyStoppedControlCredentialAttestation(inventory.proof, claim, false);
    afterPublication();
    assert.equal(readFileSync(path).equals(bytes), true);
    const other = f.upgrade.profileInventory(f.profileId);
    assert.throws(() => verifyStoppedControlCredentialAttestation(inventory!.proof, other, false), /profile-control-upgrade-attestation-unissued-or-used/u);
    const substitute = `${path}.substitute`;
    writeFileSync(substitute, bytes, { mode: 0o600 }); renameSync(substitute, path);
    assert.throws(() => verifyStoppedControlCredentialAttestation(inventory!.proof, claim, false), /credential-maintenance-inventory-changed/u);
  } finally { inventory?.dispose(); f.close(); }
});

it("refuses malformed retained active-engine bytes rather than granting a control-only absence proof", () => {
  const f = stoppedControlFixture({ ...retainedCredential, signCount: -1 });
  try {
    const path = join(f.stateRoot, "credentials", "duo-webauthn.json"), bytes = readFileSync(path);
    assert.throws(() => composeStoppedControlCredentialInventory({ claim: f.upgrade.profileInventory(f.profileId), hostFacts: { primaryDisplay: null },
      clock: manualClock(new Date()) }), /credential-maintenance-copy-capture-incomplete/u);
    assert.equal(readFileSync(path).equals(bytes), true);
  } finally { f.close(); }
});

it.each(["noncanonical", "symlink", "hardlink"] as const)("refuses %s active-engine membership during stopped control assessment", problem => {
  const f = stoppedControlFixture(retainedCredential);
  try {
    const path = join(f.stateRoot, "credentials", "duo-webauthn.json"), bytes = readFileSync(path);
    const other = problem === "noncanonical" ? join(f.stateRoot, "credentials", "duo-copy.json") : join(f.workspace, "retained-link-target.json");
    if (problem === "noncanonical") renameSync(path, other);
    else if (problem === "hardlink") linkSync(path, other);
    else { renameSync(path, other); symlinkSync(other, path); }
    assert.throws(() => composeStoppedControlCredentialInventory({ claim: f.upgrade.profileInventory(f.profileId), hostFacts: { primaryDisplay: null },
      clock: manualClock(new Date()) }), problem === "noncanonical" ? /profile-inventory-credential-unowned/u : /profile-inventory-path-unsafe/u);
    assert.equal(readFileSync(problem === "noncanonical" ? other : path).equals(bytes), true);
  } finally { f.close(); }
});

it("refuses an attestation from another genuinely issued stopped profile", () => {
  const first = stoppedControlFixture(retainedCredential), second = stoppedControlFixture(retainedCredential);
  let inventory: ReturnType<typeof composeStoppedControlCredentialInventory> | undefined;
  try {
    const claim = first.upgrade.profileInventory(first.profileId);
    inventory = composeStoppedControlCredentialInventory({ claim, hostFacts: { primaryDisplay: null }, clock: manualClock(new Date()) });
    assert.notEqual(first.profileId, second.profileId);
    assert.throws(() => verifyStoppedControlCredentialAttestation(inventory!.proof, second.upgrade.profileInventory(second.profileId), false),
      /profile-control-upgrade-attestation-unissued-or-used/u);
  } finally { inventory?.dispose(); second.close(); first.close(); }
});

it("does not apply retained-engine disposition to ordinary credential initialization", () => {
  const f = createBoundProfileFixture({ pending: true }), clock = manualClock(new Date("2026-10-01T12:00:00.000Z"));
  const session = createProfileSession({ admission: f.machine, machineRoot: f.machine.stateRoot,
    initializationInventory: (child, operation, writer, copies) => composeProfileCredentialInitializationInventory({ machine: f.machine, admission: child,
      clock, hostFacts: { primaryDisplay: null } })(operation, writer, copies),
    repairInventory: (child, request, writer, copies) => composeProfileCredentialRepairInventory({ machine: f.machine, admission: child,
      clock, hostFacts: { primaryDisplay: null } })(request, writer, copies) });
  try {
    const path = join(f.stateRoot, "credentials", "duo-webauthn.json");
    mkdirSync(join(f.stateRoot, "credentials"), { recursive: true, mode: 0o700 });
    writeFileSync(path, JSON.stringify(retainedCredential), { mode: 0o600 });
    const bytes = readFileSync(path);
    assert.throws(() => session.signUp({ firstName: "Fixture", lastName: "Example", email: "fixture@example.edu", password: "disposable-fixture-password",
      createdAt: clock.now().toISOString() }), /credential-maintenance-copy-capture-incomplete/u);
    assert.equal(readFileSync(path).equals(bytes), true);
  } finally { session.close(); f.close(); }
});

it("issues only finite read-only stopped-control inventory and preserves database and control bytes", () => {
  const f = stoppedControlFixture();
  let admission: RuntimeAdmission | undefined;
  try {
    const before = createHash("sha256").update(readFileSync(f.path)).digest("hex");
    const control = readFileSync(f.controlPath);
    assert.throws(() => RuntimeAdmission.forStoppedControlInventory({ profileId: f.profileId }), /profile-control-upgrade-inventory-unissued/u);
    const issued = f.upgrade.profileInventory(f.profileId);
    admission = RuntimeAdmission.forStoppedControlInventory(issued);
    const facts = AuthorityDatabase.readProfileMaintenanceInventory(admission);
    assert.equal(facts.authorityGeneration, 0);
    assert.deepEqual(facts.runs, []);
    assert.deepEqual(facts.writeIntents, []);
    assert.equal(createHash("sha256").update(readFileSync(f.path)).digest("hex"), before);
    assert.equal(readFileSync(f.controlPath).equals(control), true);
    const owned = admission;
    for (const [operation, reason] of [
      [() => owned.assertProfileRuntime(), "profile-bound-authority-required"],
      [() => owned.assertProfileInitialization(), "profile-initialization-authority-required"],
      [() => owned.assertWritable(), "profile-control-upgrade-write-refused"],
      [() => owned.assertCredentialRead(), "profile-control-upgrade-credential-read-refused"],
      [() => owned.assertArtifactRoot(join(f.stateRoot, "artifacts")), "profile-control-upgrade-artifact-refused"],
      [() => owned.assertAuthorityDatabase(f.path), "profile-control-upgrade-write-refused"],
      [() => owned.readProfileRegistry(), "profile-machine-authority-required"],
      [() => AuthorityDatabase.open(owned, { path: f.path, busyTimeoutMs: 100, migrationOwner: "forbidden-upgrade-runtime" }), "profile-bound-authority-required"],
    ] as const) assert.throws(operation, error => error instanceof Error && error.message === reason);
    const copy = admission.verifiedReadOnlyCopy(f.path, before);
    try {
      assert.throws(() => copy.assertWritable(), /profile-control-upgrade-write-refused/u);
      assert.throws(() => copy.assertCredentialRead(), /profile-control-upgrade-credential-read-refused/u);
    } finally { copy.release(); }
    admission.release();
    assert.throws(() => admission?.assertLive(), /missing or released admission/u);
  } finally { admission?.release(); f.close(); }
});

it.each(["control", "database"] as const)("revokes the genuine stopped inventory when its %s source is replaced", target => {
  const f = stoppedControlFixture();
  let admission: RuntimeAdmission | undefined;
  try {
    admission = RuntimeAdmission.forStoppedControlInventory(f.upgrade.profileInventory(f.profileId));
    assert.equal(AuthorityDatabase.readProfileMaintenanceInventory(admission).authorityGeneration, 0);
    const path = target === "control" ? f.controlPath : f.path, substitute = `${path}.substitute`;
    writeFileSync(substitute, readFileSync(path), { mode: 0o600 }); renameSync(substitute, path);
    assert.throws(() => admission?.assertLive(), target === "control"
      ? /profile-control-upgrade-inventory-expired/u : /authority-readonly-source-changed/u);
  } finally { admission?.release(); f.close(); }
});

it("refuses a high-water head without its exact durable reservation lineage", () => {
  const credentialId = "cHVibGljLWZpeHR1cmU", base = { schemaVersion: 1, installationId: randomUUID(), profileId: randomUUID(), revision: 1,
    credentials: [], retired: [{ credentialId, highWater: 1 }], reservations: [] };
  assert.equal(DuoCredentialDocumentSchema.safeParse(base).success, false);
  const reservation = { attemptId: randomUUID(), credentialId, count: 1, reservedAt: "2026-10-22T12:00:00.000Z" };
  assert.equal(DuoCredentialDocumentSchema.safeParse({ ...base, reservations: [reservation] }).success, true);
  assert.equal(DuoCredentialDocumentSchema.safeParse({ ...base, retired: [{ credentialId, highWater: 2 }], reservations: [reservation] }).success, false);
});

const DuoChildEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("ready"), pid: z.number().int().positive() }),
  z.strictObject({ type: z.literal("reserved"), attemptId: z.uuid(), count: z.number().int().positive().max(0xffff_ffff), revision: z.number().int().positive() }),
  z.strictObject({ type: z.literal("failed"), code: z.literal("DUO_FIXTURE_RESERVATION_FAILED") }),
]);
async function duoChild(f: ReturnType<typeof setup>) {
  const child = fork(fileURLToPath(new URL("../../../support/processes/duo-credential-store-worker.ts", import.meta.url)),
    [f.workspace, f.admission.profileBinding.profileId, f.input.credentialId, f.clock.now().toISOString()],
    { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let stderrBytes = 0, exited = false, expectedCrash = false;
  child.stderr?.on("data", (bytes: Buffer) => { stderrBytes += bytes.length; });
  const exit = once(child, "exit").then(values => { exited = true; return z.tuple([z.number().int().nullable(), z.string().nullable()]).parse(values); });
  const events = on(child, "message");
  const event = async () => {
    const result = await Promise.race([events.next(), exit.then(() => { throw new Error("Duo fixture child exited before the required event"); })]);
    assert.equal(result.done, false);
    return DuoChildEventSchema.parse(result.value?.[0]);
  };
  try {
    const ready = await event(); assert.equal(ready.type, "ready");
    if (ready.type !== "ready") throw new Error("Duo fixture child readiness required");
    assert.equal(ready.pid, child.pid);
    return { pid: ready.pid,
      async reserve() {
        child.send("reserve"); const result = await event();
        assert.equal(result.type, "reserved");
        if (result.type !== "reserved") throw new Error("Duo fixture child reservation required");
        return result;
      },
      async crashAfterReservation() { child.send("reserve-then-crash"); assert.deepEqual(await exit, [23, null]); expectedCrash = true; assert.equal(stderrBytes, 0); },
      async close() {
        try {
          if (!exited) { child.send("close"); assert.deepEqual(await exit, [0, null]); }
          else assert.equal(expectedCrash, true, "Duo fixture child exited before requested closure");
          assert.equal(stderrBytes, 0);
        } catch (error) {
          if (!exited) { child.kill("SIGKILL"); await exit; }
          throw error;
        } finally { await events.return?.(); }
      },
    };
  } catch (error) {
    if (!exited) { child.kill("SIGKILL"); await exit; }
    await events.return?.(); throw error;
  }
}

it("reserves increasing counts in independent processes and burns a committed attempt after process death", async () => {
  const f = setup({ sharedMachine: true });
  const children: Awaited<ReturnType<typeof duoChild>>[] = [];
  try {
    f.store.enroll(f.input); f.store.confirm(f.input.credentialId, f.input.scope);
    const first = await duoChild(f); children.push(first);
    const second = await duoChild(f); children.push(second);
    assert.notEqual(first.pid, second.pid); assert.notEqual(first.pid, process.pid); assert.notEqual(second.pid, process.pid);
    const [a, b] = await Promise.all([first.reserve(), second.reserve()]);
    assert.equal(Math.max(a.count, b.count), Math.min(a.count, b.count) + 1); assert.notEqual(b.attemptId, a.attemptId);
    await first.crashAfterReservation();
    const burned = f.store.read().credentials[0]; assert.ok(burned);
    assert.equal(burned.highWater, Math.max(a.count, b.count) + 1);
    const restarted = await duoChild(f); children.push(restarted);
    const c = await restarted.reserve(); assert.equal(c.count, burned.highWater + 1);
    assert.equal(f.store.read().credentials[0]?.highWater, c.count);
  } finally {
    const closed = await Promise.allSettled(children.map(child => child.close()));
    const failures = closed.flatMap(result => result.status === "rejected" ? [result.reason] : []);
    if (failures.length > 0) throw new AggregateError(failures, "Duo child closure unproved");
    f.close();
  }
}, 30_000);

it("recovers an interrupted Duo publication only for the issued claim and keeps the reserved count burned", () => {
  const f = setup();
  try {
    f.store.enroll(f.input); f.store.confirm(f.input.credentialId, f.input.scope);
    assert.throws(() => f.store.interruptReserve(f.input.credentialId), (error) => error instanceof DuoCredentialCommitUncertainError);
    const other = createDuoCredentialStore(f.admission, f.machine, f.clock);
    assert.throws(() => other.recoverInterruptedPublication(), /duo-transaction-unissued/u);
    assert.throws(() => other.read(), /duo-transaction-unissued/u);
    f.store.recoverInterruptedPublication();
    const burned = f.store.read().credentials[0];
    assert.ok(burned);
    assert.equal(f.store.reserve(f.input.credentialId).count, burned.highWater + 1);
    assert.throws(() => f.store.recoverInterruptedPublication(), /duo-transaction-unissued/u);
  } finally { f.close(); }
});

it("does not let a replacement process finish another process's interrupted Duo publication", async () => {
  const f = setup({ sharedMachine: true });
  const child = fork(fileURLToPath(new URL("../../../support/processes/duo-credential-store-worker.ts", import.meta.url)),
    [f.workspace, f.admission.profileBinding.profileId, f.input.credentialId, f.clock.now().toISOString()],
    { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let stderrBytes = 0;
  child.stderr?.on("data", (bytes: Buffer) => { stderrBytes += bytes.length; });
  const exit = once(child, "exit");
  const ready = await new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Duo interrupt child did not become ready")), 10_000);
    child.once("message", (message) => { clearTimeout(timer); resolve(message); });
    child.once("exit", () => { clearTimeout(timer); reject(new Error("Duo interrupt child exited before ready")); });
  });
  try {
    f.store.enroll(f.input); f.store.confirm(f.input.credentialId, f.input.scope);
    assert.deepEqual(ready, { type: "ready", pid: child.pid });
    child.send("interrupt-publication");
    assert.deepEqual(await exit, [97, null]);
    assert.equal(stderrBytes, 0);
    assert.throws(() => f.store.read(), /duo-transaction-unissued/u);
  } finally {
    if (child.exitCode === null) { child.kill("SIGKILL"); await exit; }
    f.close();
  }
}, 30_000);

it("refuses Duo erasure while a same-digest copy exists and then erases through the purpose document", () => {
  const f = setup();
  try {
    f.store.enroll(f.input); f.store.confirm(f.input.credentialId, f.input.scope);
    const before = readFileSync(f.documentPath);
    const copy = join(f.stateRoot, "credentials", "duo-purpose-copy.json");
    writeFileSync(copy, before, { mode: 0o600 });
    assert.throws(() => f.store.erase(), /duo-purpose-copy-present/u);
    assert.equal(readFileSync(f.documentPath).equals(before), true);
    unlinkSync(copy);
    const revision = f.store.erase().revision;
    assert.deepEqual(f.store.read().credentials, []);
    assert.equal(revision > 1, true);
  } finally { f.close(); }
});

const hostFacts = { primaryDisplay: null };
const upgradeClock = () => manualClock(new Date("2026-01-15T00:00:00.000Z"));

it("holds machine-control marker versions outside the finite conversion", async () => {
  const fixture = createBoundProfileFixture();
  const markerPath = join(fixture.machine.stateRoot, "machine", "profile-registry-version.json");
  const before = readFileSync(fixture.path);
  writeFileSync(markerPath, JSON.stringify({ schemaVersion: 1 }));
  try {
    await assert.rejects(upgradeStoppedMachineControl(fixture.machine, { plan: true, hostFacts }, upgradeClock()), /profile-control-upgrade-pending-conversion-unsupported/u);
    assert.equal(JSON.parse(readFileSync(markerPath, "utf8")).schemaVersion, 1);
    assert.equal(readFileSync(fixture.path).equals(before), true);
  } finally { fixture.close(); }
});

it("upgrades stopped machine control from the held exclusive admission with a control backup and exact readback", async () => {
  const fixture = createBoundProfileFixture();
  const controlPath = join(fixture.workspace, ".tracker/control", "profile-registry.json");
  const markerPath = join(fixture.machine.stateRoot, "machine", "profile-registry-version.json");
  const databaseBefore = readFileSync(fixture.path);
  const current = JSON.parse(readFileSync(controlPath, "utf8")) as { schemaVersion: number; duo?: unknown };
  assert.equal(current.schemaVersion, 2);
  const { duo: _duo, ...prior } = current;
  writeFileSync(controlPath, JSON.stringify({ ...prior, schemaVersion: 1 }));
  writeFileSync(markerPath, JSON.stringify({ schemaVersion: 2 }));
  const processLockRoot = join(fixture.workspace, rebuildRuntimeIsolation.processLockRoot);
  const restore = acquireRuntimeRestoreAdmission({ processLockRoot, pid: process.pid });
  const opened = fixture.machine.beginStoppedMachineControlUpgrade(restore);
  try {
    assert.throws(() => opened.profileInventory(randomUUID()), /profile-control-upgrade-profile-unavailable/u);
  } finally { opened.release(); restore.release(); }
  try {
    const planned = await upgradeStoppedMachineControl(fixture.machine, { plan: true, hostFacts }, upgradeClock());
    assert.equal(planned.state, "planned");
    assert.equal(JSON.parse(readFileSync(markerPath, "utf8")).schemaVersion, 2);
    const upgraded = await upgradeStoppedMachineControl(fixture.machine, { plan: false, hostFacts }, upgradeClock());
    assert.equal(upgraded.state, "upgraded");
    assert.equal(JSON.parse(readFileSync(markerPath, "utf8")).schemaVersion, 3);
    assert.equal(JSON.parse(readFileSync(controlPath, "utf8")).schemaVersion, 2);
    assert.equal(readFileSync(fixture.path).equals(databaseBefore), true);
    const backupDirectory = join(fixture.workspace, ".tracker/control", "profile-control-upgrades");
    const names = readdirSync(backupDirectory);
    assert.ok(names.length > 0);
    const databaseDigest = createHash("sha256").update(databaseBefore).digest("hex");
    for (const name of names) assert.notEqual(createHash("sha256").update(readFileSync(join(backupDirectory, name))).digest("hex"), databaseDigest);
    const currentAgain = await upgradeStoppedMachineControl(fixture.machine, { plan: false, hostFacts }, upgradeClock());
    assert.equal(currentAgain.state, "current");
  } finally { fixture.close(); }
});
