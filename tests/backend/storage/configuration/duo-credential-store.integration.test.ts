import { createProfileSession } from "../../../../src/backend/profiles/profile-session.js";
import { composeProfileCredentialInitializationInventory, composeProfileCredentialRepairInventory, composeStoppedControlCredentialInventory } from "../../../../src/backend/app/composition/profile-credential-inventory.js";
import { verifyStoppedControlCredentialAttestation } from "../../../../src/backend/storage/configuration/credential-store.js";
import { execFileSync, fork, type ChildProcess } from "node:child_process";
import { on, once } from "node:events";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { acquireStoppedProfileControlUpgrade } from "../../../../src/backend/storage/admission/installation.js";
import { releaseStoppedMachineControlUpgrade, upgradeStoppedMachineControl } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { acquireRuntimeProcessLock, acquireRuntimeRestoreAdmission } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { AuthoritySourceClosureUnprovedError } from "../../../../src/backend/storage/source-closure.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

function privateJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
}

function snapshotNames(): Set<string> {
  return new Set(readdirSync(tmpdir()).filter((name) => name.startsWith("relay-readonly-authority-")));
}

function controlPaths(fixture: ReturnType<typeof createBoundProfileFixture>) {
  const stateRoot = fixture.machine.stateRoot;
  return { stateRoot, workspace: fixture.workspace, databasePath: fixture.path, database: readFileSync(fixture.path),
    controlPath: join(fixture.workspace, ".tracker/control", "profile-registry.json"),
    markerPath: join(stateRoot, "machine", "profile-registry-version.json"),
    processLockRoot: join(fixture.workspace, rebuildRuntimeIsolation.processLockRoot) };
}

function downgradeStoppedControl(fixture: ReturnType<typeof createBoundProfileFixture>, markerVersion: 1 | 2, dropCredentialKey = false) {
  const paths = controlPaths(fixture);
  const current = JSON.parse(readFileSync(paths.controlPath, "utf8")) as { schemaVersion: number; duo?: unknown; erasures?: Array<Record<string, unknown>> };
  fixture.admission.release();
  fixture.machine.release();
  const { duo: _duo, erasures, ...prior } = current;
  const nextErasures = dropCredentialKey === true ? (erasures ?? []).map((row) => { const { credentialKey: _key, ...rest } = row; return rest; }) : erasures;
  privateJson(paths.controlPath, { ...prior, ...(nextErasures === undefined ? {} : { erasures: nextErasures }), schemaVersion: 1 });
  privateJson(paths.markerPath, { schemaVersion: markerVersion });
  return { ...paths, controlBytes: readFileSync(paths.controlPath), markerBytes: readFileSync(paths.markerPath) };
}

function assertUnchanged(paths: { controlPath: string; markerPath: string; databasePath: string; database: Buffer; controlBytes: Buffer; markerBytes: Buffer }): void {
  assert.equal(readFileSync(paths.controlPath).equals(paths.controlBytes), true);
  assert.equal(readFileSync(paths.markerPath).equals(paths.markerBytes), true);
  assert.equal(readFileSync(paths.databasePath).equals(paths.database), true);
}

it("finishes one interrupted Duo publication after the producing process exits and refuses a changed or released claim", async () => {
  const f = setup({ sharedMachine: true });
  f.store.enroll(f.input); f.store.confirm(f.input.credentialId, f.input.scope);
  const canonicalBefore = readFileSync(f.documentPath);
  let child: ChildProcess | undefined;
  let proved = false;
  let primary: unknown;
  let cleanup: unknown;
  let releaseWorkspace = false;
  try {
    child = fork(fileURLToPath(new URL("../../../support/processes/duo-credential-store-worker.ts", import.meta.url)),
      [f.workspace, f.admission.profileBinding.profileId, f.input.credentialId, f.clock.now().toISOString()],
      { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"] });
    const exit = once(child, "exit");
    const events = on(child, "message");
    let stderrBytes = 0;
    child.stderr?.on("data", (bytes: Buffer) => { stderrBytes += bytes.length; });
    const next = async () => {
      const result = await Promise.race([events.next(), exit.then(() => { throw new Error("Duo interrupt child exited before the required event"); })]);
      assert.equal(result.done, false);
      return z.object({ type: z.string(), name: z.string().optional(), pid: z.number().int().positive().optional() }).parse(result.value?.[0]);
    };
    try {
      const ready = await next();
      assert.deepEqual(ready, { type: "ready", pid: child.pid });
      const uncertain = once(child, "message");
      child.send("interrupt-publication");
      const [code, signal] = z.tuple([z.number().int().nullable(), z.string().nullable()]).parse(await exit);
      const message = z.object({ type: z.string(), name: z.string().optional() }).parse((await uncertain)[0]);
      assert.deepEqual([code, signal], [97, null]);
      assert.equal(message.type, "uncertain");
      assert.equal(message.name, "DuoCredentialCommitUncertainError");
      assert.equal(stderrBytes, 0);
      proved = true;
    } finally { await events.return?.(undefined); }
    const intentPath = join(f.workspace, ".tracker/control", "profile-publication.json");
    const directory = join(f.machine.stateRoot, "machine", "duo-credentials");
    const stageName = readdirSync(directory).find((name) => name.startsWith(`.${f.admission.profileBinding.profileId}.`) && name.endsWith(".stage"));
    assert.equal(typeof stageName, "string");
    const stagePath = join(directory, stageName ?? "");
    const intentBefore = readFileSync(intentPath);
    const stageBefore = readFileSync(stagePath);
    assert.throws(() => f.store.read(), /duo-publication-pending|duo-transaction-unissued/u);
    assert.equal(readFileSync(intentPath).equals(intentBefore), true);
    assert.equal(readFileSync(stagePath).equals(stageBefore), true);
    assert.equal(readFileSync(f.documentPath).equals(canonicalBefore), true);
    const profileId = f.admission.profileBinding.profileId;
    f.admission.release(); f.machine.release();
    const maintenance = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace);
    try {
      const changedProfile = JSON.parse(intentBefore.toString("utf8")) as { capture: { profileId: string } };
      changedProfile.capture.profileId = randomUUID();
      privateJson(intentPath, changedProfile);
      assert.throws(() => maintenance.issueStoppedDuoPublicationRecovery(), /duo-publication-prior-changed|duo-publication-file-changed/u);
      assert.equal(readFileSync(stagePath).equals(stageBefore), true);
      assert.equal(readFileSync(f.documentPath).equals(canonicalBefore), true);
      writeFileSync(intentPath, intentBefore);
      const envelope = JSON.parse(stageBefore.toString("utf8")) as { purpose: string; revision: number };
      envelope.revision += 1;
      const rewritten = Buffer.from(JSON.stringify(envelope));
      writeFileSync(stagePath, rewritten, { mode: 0o600 });
      const info = statSync(stagePath);
      const intent = JSON.parse(intentBefore.toString("utf8")) as { capture: { next: { document: { digest: string; device: number; inode: number } } } };
      intent.capture.next.document = { digest: createHash("sha256").update(rewritten).digest("hex"), device: info.dev, inode: info.ino };
      privateJson(intentPath, intent);
      assert.throws(() => maintenance.issueStoppedDuoPublicationRecovery(), /duo-publication-prior-changed/u);
      writeFileSync(stagePath, stageBefore);
      writeFileSync(intentPath, intentBefore);
      const purposeEnvelope = JSON.parse(stageBefore.toString("utf8")) as { purpose: string };
      purposeEnvelope.purpose = "relay:duo-credential:v2";
      const purposeBytes = Buffer.from(JSON.stringify(purposeEnvelope));
      writeFileSync(stagePath, purposeBytes, { mode: 0o600 });
      const purposeInfo = statSync(stagePath);
      const purposeIntent = JSON.parse(intentBefore.toString("utf8")) as { capture: { next: { document: { digest: string; device: number; inode: number } } } };
      purposeIntent.capture.next.document = { digest: createHash("sha256").update(purposeBytes).digest("hex"), device: purposeInfo.dev, inode: purposeInfo.ino };
      privateJson(intentPath, purposeIntent);
      assert.throws(() => maintenance.issueStoppedDuoPublicationRecovery());
      writeFileSync(intentPath, intentBefore);
      writeFileSync(stagePath, stageBefore);
      const continuityPath = join(f.workspace, ".tracker/control", "profile-registry.json");
      const continuityBefore = readFileSync(continuityPath);
      const flipped = Buffer.from(continuityBefore);
      flipped[flipped.length - 1] = flipped[flipped.length - 1] === 0x7d ? 0x7c : 0x7d;
      writeFileSync(continuityPath, flipped);
      assert.throws(() => maintenance.issueStoppedDuoPublicationRecovery());
      writeFileSync(continuityPath, continuityBefore);
      assert.equal(readFileSync(stagePath).equals(stageBefore), true);
      assert.equal(readFileSync(f.documentPath).equals(canonicalBefore), true);
      const claim = maintenance.issueStoppedDuoPublicationRecovery();
      const recovered = maintenance.completeStoppedDuoPublicationRecovery(claim);
      assert.throws(() => maintenance.completeStoppedDuoPublicationRecovery(claim), /duo-publication-recovery-unissued/u);
      assert.throws(() => maintenance.recoverInterruptedDuoPublication(), /duo-publication-recovery-absent/u);
      assert.equal(existsSync(intentPath), false);
      assert.equal(existsSync(stagePath), false);
      assert.equal(recovered.revision > 0, true);
    } finally { maintenance.release(); }
    const machine = RuntimeAdmission.acquireMachine(f.workspace, "shared");
    const admission = machine.admitProfile(machine.issueRegisteredProfileClaim(profileId));
    try {
      const reopened = createDuoCredentialStore(admission, machine, f.clock);
      const burned = reopened.read().credentials[0];
      assert.ok(burned);
      assert.equal(burned.highWater >= Math.floor(f.clock.nowMs() / 1000), true);
      const next = reopened.reserve(f.input.credentialId);
      assert.equal(next.count, burned.highWater + 1);
      assert.throws(() => reopened.recoverInterruptedPublication(), /duo-transaction-unissued/u);
    } finally { admission.release(); machine.release(); }
    releaseWorkspace = true;
  } catch (error) { primary = error; }
  if (!proved && child !== undefined && child.exitCode === null && child.signalCode === null) {
    try {
      child.send("close");
      const closed = await Promise.race([once(child, "exit"), new Promise<never>((_resolve, reject) => { setTimeout(() => reject(new Error("duo-child-close-unproved")), 10_000); })]);
      const [code] = z.tuple([z.number().int().nullable(), z.string().nullable()]).parse(closed);
      if (code === null) throw new Error("duo-child-close-unproved");
    } catch (error) { cleanup = error; }
  }
  if (releaseWorkspace && cleanup === undefined) f.close();
  if (primary !== undefined && cleanup !== undefined) throw new AggregateError([primary, cleanup], "Duo interrupt child cleanup unproved");
  if (cleanup !== undefined) throw cleanup;
  if (primary !== undefined) throw primary;
}, 30_000);

it("refuses unmanaged Duo copies, then backup erase and restore keep burned counters and do not revive erased key material", () => {
  const f = setup();
  try {
    f.store.enroll(f.input); f.store.confirm(f.input.credentialId, f.input.scope);
    const first = f.store.reserve(f.input.credentialId);
    const backedUp = f.store.backup();
    const backupDirectory = join(f.machine.stateRoot, "machine", "duo-purpose-backups", f.admission.profileBinding.profileId);
    const backupPath = join(backupDirectory, `${backedUp.revision}.json`);
    assert.equal(readFileSync(backupPath).equals(readFileSync(f.documentPath)), true);
    assert.equal(statSync(backupPath).mode & 0o777, 0o600);
    const second = f.store.reserve(f.input.credentialId);
    assert.equal(second.count, first.count + 1);
    assert.throws(() => f.store.restore(backupPath), /duo-purpose-restore-lowers-burned-count/u);
    assert.equal(f.store.read().credentials[0]?.highWater, second.count);
    assert.throws(() => f.store.restore(f.path), /duo-purpose-restore-unmanaged/u);
    const enginePath = join(f.stateRoot, "credentials", "duo-webauthn.json");
    const engineBefore = existsSync(enginePath) ? readFileSync(enginePath) : Buffer.from("{\"activeEngine\":true}\n");
    if (!existsSync(enginePath)) writeFileSync(enginePath, engineBefore, { mode: 0o600 });
    const before = readFileSync(f.documentPath);
    const copies = [join(f.stateRoot, "credentials", "duo-purpose-copy.json"), join(f.stateRoot, "artifacts", "nested", "duo-purpose-copy.json"), join(f.stateRoot, "backups", "authority", "duo-purpose-copy.bin")];
    for (const copy of copies) { mkdirSync(join(copy, ".."), { recursive: true, mode: 0o700 }); writeFileSync(copy, before, { mode: 0o600 }); }
    assert.throws(() => f.store.erase(), /duo-purpose-copy-present/u);
    assert.equal(readFileSync(f.documentPath).equals(before), true);
    for (const copy of copies) unlinkSync(copy);
    const link = join(f.stateRoot, "credentials", "duo-purpose-link.json");
    symlinkSync(f.documentPath, link);
    assert.throws(() => f.store.erase(), /duo-document-membership-mismatch/u);
    unlinkSync(link);
    const hard = join(f.stateRoot, "artifacts", "duo-purpose-hard.json");
    linkSync(f.documentPath, hard);
    assert.throws(() => f.store.erase(), /duo-document-membership-mismatch/u);
    unlinkSync(hard);
    assert.equal(readFileSync(enginePath).equals(engineBefore), true);
    const currentBackup = f.store.backup();
    const currentBackupPath = join(backupDirectory, `${currentBackup.revision}.json`);
    const erased = f.store.erase();
    assert.equal(erased.revision > currentBackup.revision, true);
    assert.deepEqual(f.store.read().credentials, []);
    assert.equal(readFileSync(enginePath).equals(engineBefore), true);
    assert.equal(readFileSync(currentBackupPath).equals(before), true);
    assert.equal(readFileSync(f.documentPath).equals(before), false);
    assert.throws(() => f.store.restore(currentBackupPath), /duo-purpose-restore-revives-erased-key/u);
    assert.throws(() => f.store.restore(backupPath), /duo-purpose-restore-revives-erased-key/u);
    const reopened = createDuoCredentialStore(f.admission, f.machine, f.clock);
    assert.deepEqual(reopened.read().credentials, []);
    assert.throws(() => reopened.reserve(f.input.credentialId), /duo-ready-credential-required/u);
    assert.equal(readFileSync(enginePath).equals(engineBefore), true);
  } finally { f.close(); }
});

const hostFacts = { primaryDisplay: null };
const upgradeClock = () => manualClock(new Date("2026-01-15T00:00:00.000Z"));

it("admits only the finite stopped machine-control pair through maintenance admission", async () => {
  const unsupported = createBoundProfileFixture();
  const unsupportedPaths = downgradeStoppedControl(unsupported, 1);
  try {
    assert.throws(() => RuntimeAdmission.acquireMachine(unsupported.workspace, "exclusive"));
    const maintenance = RuntimeAdmission.acquireStoppedMachineControlMaintenance(unsupported.workspace);
    try {
      await assert.rejects(upgradeStoppedMachineControl(maintenance, { plan: true, hostFacts }, upgradeClock()), /profile-control-upgrade-pending-conversion-unsupported/u);
      assertUnchanged(unsupportedPaths);
    } finally { maintenance.release(); }
  } finally { unsupported.close(); }
  const missingKey = createBoundProfileFixture();
  const missingPaths = downgradeStoppedControl(missingKey, 2, true);
  try {
    const maintenance = RuntimeAdmission.acquireStoppedMachineControlMaintenance(missingKey.workspace);
    try {
      await assert.rejects(upgradeStoppedMachineControl(maintenance, { plan: false, hostFacts }, upgradeClock()), /profile-control-upgrade-credential-conversion-required/u);
      assertUnchanged(missingPaths);
    } finally { maintenance.release(); }
  } finally { missingKey.close(); }
  const live = createBoundProfileFixture();
  const livePaths = downgradeStoppedControl(live, 2);
  const lock = acquireRuntimeProcessLock({ processLockRoot: livePaths.processLockRoot, name: "server", pid: process.pid });
  try {
    assert.throws(() => RuntimeAdmission.acquireStoppedMachineControlMaintenance(live.workspace), /profile-control-upgrade-runtime-active/u);
    assertUnchanged(livePaths);
  } finally { lock.release(); live.close(); }
});

it("upgrades marker 2 through stopped maintenance, keeps exact backup bytes, and rolls back a mutated stage", async () => {
  const fixture = createBoundProfileFixture();
  const paths = downgradeStoppedControl(fixture, 2);
  assert.throws(() => RuntimeAdmission.acquireMachine(fixture.workspace, "exclusive"));
  const maintenance = RuntimeAdmission.acquireStoppedMachineControlMaintenance(fixture.workspace);
  try {
    const planned = await upgradeStoppedMachineControl(maintenance, { plan: true, hostFacts }, upgradeClock());
    assert.equal(planned.state, "planned");
    assertUnchanged(paths);
    execFileSync("/usr/bin/chflags", ["uchg", paths.controlPath]);
    await assert.rejects(upgradeStoppedMachineControl(maintenance, { plan: false, hostFacts }, upgradeClock()), /EPERM|operation not permitted|profile-control-upgrade-publication-uncertain/u);
    execFileSync("/usr/bin/chflags", ["nouchg", paths.controlPath]);
    assert.equal(readFileSync(paths.controlPath).equals(paths.controlBytes), true);
    assert.equal(readFileSync(paths.markerPath).equals(paths.markerBytes), true);
    const backupDirectory = join(fixture.workspace, ".tracker/control", "profile-control-upgrades");
    const stageName = readdirSync(backupDirectory).find((name) => name.endsWith(".control.stage"));
    assert.equal(typeof stageName, "string");
    const stagePath = join(backupDirectory, stageName ?? "");
    const stageBytes = readFileSync(stagePath);
    const mutated = Buffer.from(stageBytes);
    mutated[0] = mutated[0] === 0x7b ? 0x5b : 0x7b;
    writeFileSync(stagePath, mutated);
    await assert.rejects(upgradeStoppedMachineControl(maintenance, { plan: true, hostFacts }, upgradeClock()), /profile-control-upgrade-recovery-required/u);
    await assert.rejects(upgradeStoppedMachineControl(maintenance, { plan: false, hostFacts }, upgradeClock()), /profile-control-upgrade-publication-uncertain/u);
    assert.equal(readFileSync(paths.controlPath).equals(paths.controlBytes), true);
    writeFileSync(stagePath, stageBytes);
    const upgraded = await upgradeStoppedMachineControl(maintenance, { plan: false, hostFacts }, upgradeClock());
    assert.equal(upgraded.state, "upgraded");
    const names = readdirSync(backupDirectory).sort();
    const operationNames = names.filter((name) => name.endsWith(".control.before.json"));
    assert.equal(operationNames.length, 1);
    const operationId = operationNames[0]?.slice(0, -".control.before.json".length);
    assert.deepEqual(names, [`${operationId}.control.before.json`, `${operationId}.marker.before.json`, `${operationId}.receipt.json`].sort());
    const controlBackup = readFileSync(join(backupDirectory, `${operationId}.control.before.json`));
    const markerBackup = readFileSync(join(backupDirectory, `${operationId}.marker.before.json`));
    assert.equal(controlBackup.equals(paths.controlBytes), true);
    assert.equal(markerBackup.equals(paths.markerBytes), true);
    assert.equal(statSync(join(backupDirectory, `${operationId}.control.before.json`)).mode & 0o777, 0o600);
    assert.equal(statSync(join(backupDirectory, `${operationId}.marker.before.json`)).mode & 0o777, 0o600);
    assert.equal(createHash("sha256").update(controlBackup).digest("hex"), createHash("sha256").update(paths.controlBytes).digest("hex"));
    assert.equal(JSON.parse(readFileSync(paths.markerPath, "utf8")).schemaVersion, 3);
    assert.equal(JSON.parse(readFileSync(paths.controlPath, "utf8")).schemaVersion, 2);
    assert.equal(readFileSync(paths.databasePath).equals(paths.database), true);
    const current = await upgradeStoppedMachineControl(maintenance, { plan: false, hostFacts }, upgradeClock());
    assert.equal(current.state, "current");
    assert.equal(readFileSync(paths.databasePath).equals(paths.database), true);
  } finally { maintenance.release(); fixture.close(); }
});

it("recovers a machine-control publication stopped between the control and marker renames", async () => {
  const fixture = createBoundProfileFixture();
  const paths = downgradeStoppedControl(fixture, 2);
  const maintenance = RuntimeAdmission.acquireStoppedMachineControlMaintenance(fixture.workspace);
  try {
    execFileSync("/usr/bin/chflags", ["uchg", paths.markerPath]);
    await assert.rejects(upgradeStoppedMachineControl(maintenance, { plan: false, hostFacts }, upgradeClock()), /EPERM|operation not permitted|profile-control-upgrade-publication-uncertain/u);
    execFileSync("/usr/bin/chflags", ["nouchg", paths.markerPath]);
    assert.equal(JSON.parse(readFileSync(paths.controlPath, "utf8")).schemaVersion, 2);
    assert.equal(readFileSync(paths.markerPath).equals(paths.markerBytes), true);
    const upgraded = await upgradeStoppedMachineControl(maintenance, { plan: false, hostFacts }, upgradeClock());
    assert.equal(upgraded.state, "upgraded");
    assert.equal(JSON.parse(readFileSync(paths.markerPath, "utf8")).schemaVersion, 3);
    const backupDirectory = join(fixture.workspace, ".tracker/control", "profile-control-upgrades");
    const controlName = readdirSync(backupDirectory).find((name) => name.endsWith(".control.before.json"));
    assert.equal(typeof controlName, "string");
    assert.equal(readFileSync(join(backupDirectory, controlName ?? "")).equals(paths.controlBytes), true);
    assert.equal(readFileSync(join(backupDirectory, (controlName ?? "").replace(".control.before.json", ".marker.before.json"))).equals(paths.markerBytes), true);
    assert.equal(readFileSync(paths.databasePath).equals(paths.database), true);
  } finally { maintenance.release(); fixture.close(); }
});

it("keeps the restore admission when stopped-control snapshot disposal is unproved", async () => {
  const fixture = createBoundProfileFixture();
  const paths = downgradeStoppedControl(fixture, 2);
  const before = snapshotNames();
  const maintenance = RuntimeAdmission.acquireStoppedMachineControlMaintenance(fixture.workspace);
  const restore = maintenance.maintenanceRestore();
  assert.ok(restore);
  const control = maintenance.beginStoppedMachineControlUpgrade(restore);
  const profileId = control.registeredProfileIds()[0];
  assert.equal(typeof profileId, "string");
  control.profileInventory(profileId ?? "");
  const created = [...snapshotNames()].filter((name) => !before.has(name));
  assert.equal(created.length, 1);
  const snapshotFile = join(tmpdir(), created[0] ?? "", "authority.sqlite");
  execFileSync("/usr/bin/chflags", ["uchg", snapshotFile]);
  assert.throws(() => releaseStoppedMachineControlUpgrade(control, restore, true), (error: unknown) => error instanceof AuthoritySourceClosureUnprovedError);
  assert.equal(existsSync(join(paths.processLockRoot, "restore-admission.lock.json")), true);
  assert.throws(() => acquireRuntimeRestoreAdmission({ processLockRoot: paths.processLockRoot, pid: process.pid }), /held by live pid/u);
  assert.throws(() => RuntimeAdmission.acquireMachine(fixture.workspace, "shared"), /installation lease busy/u);
  assert.throws(() => releaseStoppedMachineControlUpgrade(control, restore, true), (error: unknown) => error instanceof AuthoritySourceClosureUnprovedError);
  assert.equal(existsSync(snapshotFile), true);
  assert.equal(readFileSync(paths.controlPath).equals(paths.controlBytes), true);
  assert.equal(readFileSync(paths.databasePath).equals(paths.database), true);
});
