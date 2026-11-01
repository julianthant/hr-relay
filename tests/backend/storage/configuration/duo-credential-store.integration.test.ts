import { testProcessImport } from "../../../support/compiled-process.js";
import { writeStoppedProfileControlPredecessor } from "../../../support/fixtures/storage/stopped-profile-control-predecessor.js";
import { type OfflineMaintenanceOperation } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { runtimeLifetimeLock } from "../../../support/helpers/backend/runtime-lifetime.js";
import { createHistoricalIncompleteProfileFixture } from '../../../support/fixtures/storage/historical-incomplete-profile-fixture.js';
import { finishProfileOnboarding, syntheticOnboardingDuo, createSyntheticProfileSession as createProfileSession, createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import nativeFs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { composeProfileCredentialInitializationInventory, composeProfileCredentialRepairInventory, composeStoppedControlCredentialInventory } from "../../../../src/backend/app/composition/profile-credential-inventory.js";
import { verifyStoppedControlCredentialAttestation, issueDuoCredentialPurpose, openDuoCredentialDocument } from "../../../../src/backend/storage/configuration/credential-store.js";
import { execFileSync, fork, spawnSync, type ChildProcess } from "node:child_process";
import { on, once } from "node:events";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { acquireStoppedProfileControlUpgrade } from "../../../../src/backend/storage/admission/installation.js";
import { releaseStoppedMachineControlUpgrade, upgradeStoppedMachineControl } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { acquireRuntimeProcessLock } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { AuthoritySourceClosureUnprovedError, retainAuthoritySourceClosure, hasUnprovedSourceClosure } from "../../../../src/backend/storage/source-closure.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import assert from "node:assert/strict";
import { randomBytes, createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { lstatSync, chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, readdirSync, readFileSync, renameSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, vi } from "vitest";
import { createDuoCredentialStore, createDraftDuoCredentialStore, DuoCredentialCommitUncertainError, DuoPublicationCaptureSchema, duoStagePath } from "../../../../src/backend/storage/configuration/duo-credential-store.js";
import { DuoCredentialDocumentSchema } from "../../../../src/models/config/duo-credential-store.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { ERROR_CATALOG } from "../../../../src/models/failures/error-catalog.js";
import { removeExactPath } from "../../../../src/backend/storage/configuration/credential-safe-file.js";
import { scaledMs } from "../../../support/time-scale.js";

function oldArtifactSnapshot(root: string) {
  const paths = [root], entries = [];
  for (const path of paths) {
    const info = lstatSync(path);
    if (info.isDirectory()) paths.push(...readdirSync(path).sort().map(name => join(path, name)));
    entries.push({ path, device: info.dev, inode: info.ino, mode: info.mode, owner: info.uid, links: info.nlink,
      size: info.size, modified: info.mtimeMs, changed: info.ctimeMs,
      digest: info.isFile() ? createHash("sha256").update(readFileSync(path)).digest("hex") : undefined });
  }
  return entries;
}

async function setup(options: { sharedMachine?: true } = {}) {
  const fixture = await createBoundProfileFixture(options), clock = manualClock(new Date("2026-10-22T12:00:00.000Z"));
  const store = createDuoCredentialStore(fixture.admission, fixture.machine, clock);
  const baseline = store.read();
  assert.equal(baseline.state, 'registered');
  assert.equal(baseline.revision, 2);
  assert.deepEqual(baseline.credentials.map(({ state, highWater }) => ({ state, highWater })), [{ state: 'ready', highWater: 0 }]);
  const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const input = { credentialId: Buffer.from(randomUUID()).toString("base64url"),
    scope: { armId: randomUUID(), contextId: randomBytes(16).toString("hex"), tabId: 1, accountId: randomUUID(), origin: "https://login.duosecurity.com", rpId: "duosecurity.com",
      armedAt: clock.now().toISOString(), expiresAt: new Date(clock.nowMs() + 600_000).toISOString() },
    privateKeyPkcs8: key.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
    publicKeySpki: key.publicKey.export({ type: "spki", format: "der" }).toString("base64") };
  const path = join(fixture.machine.stateRoot, "machine", "duo-credentials", `${fixture.admission.profileBinding.profileId}.json`);
  return { ...fixture, clock, store, baseline, input, documentPath: path };
}

it("durably stages pending enrollment before acknowledgement and holds signing until exact confirmation", async () => {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "duo-pending-enrollment-")));
  const lifetime = await runtimeLifetimeLock();
  const machine = acquireEntrypointAdmission(workspace, "exclusive", lifetime);
  const clock = manualClock(new Date());
  const fields = { firstName: "Fixture", lastName: "Example", email: "fixture@ucsd.edu",
      password: "disposable-fixture-password", createdAt: "2026-10-01T12:00:00.000Z" };
  const provider = syntheticOnboardingDuo(() => fields.email);
  let observedNeverInitialized = false;
  const session = createProfileSession({ onboardingDuo: { ...provider,
      async start(attempt, bind, reportFailure) {
        if (attempt.method === 'key') {
          const child = machine.admitProfile(attempt.profileId);
          try {
            const store = createDraftDuoCredentialStore(child, machine, attempt.operationId, attempt.generation, clock);
            assert.deepEqual(store.read(), { state: 'never-initialized', revision: 0, credentials: [] });
          } finally { child.release(); }
          observedNeverInitialized = true;
        }
        await provider.start(attempt, bind, reportFailure);
      } }, admission: machine, machineRoot: machine.stateRoot,
    initializationInventory: (child, operation, writer, copies) => composeProfileCredentialInitializationInventory({ machine, admission: child,
      clock, hostFacts: { primaryDisplay: null } })(operation, writer, copies),
    repairInventory: (child, request, writer, copies) => composeProfileCredentialRepairInventory({ machine, admission: child,
      clock, hostFacts: { primaryDisplay: null } })(request, writer, copies) });
  try {
    const draft = session.signUp(fields);
    assert.equal(draft.state, 'onboarding');
    if (draft.state !== 'onboarding') throw new Error('draft-not-issued');
    await session.startOnboardingDuo(draft.token, draft.operationId, 'key');
    assert.equal(observedNeverInitialized, true);
  } finally { await session.close(); machine.release(); rmSync(workspace, { recursive: true }); }
  const f = await setup();
  try {
    const registry = readFileSync(join(f.machine.stateRoot, "machine", "profiles.json"));
    const protectedBytes = readFileSync(join(f.stateRoot, "credentials", "protected.json"));
    assert.deepEqual(f.store.read(), f.baseline);
    assert.equal(f.store.enroll(f.input).revision, f.baseline.revision + 1);
    const bytes = readFileSync(f.documentPath);
    assert.equal(bytes.includes(f.input.privateKeyPkcs8), false);
    assert.deepEqual(f.store.read().credentials, [...f.baseline.credentials, { credentialId: f.input.credentialId, state: 'pending', highWater: 0 }]);
    assert.throws(() => f.store.reserve(f.input.credentialId), /duo-ready-credential-required/u);
    assert.throws(() => f.store.confirm("foreign", f.input.scope), /duo-pending-credential-mismatch/u);
    assert.throws(() => f.store.confirm(f.input.credentialId, { ...f.input.scope, tabId: 2 }), /duo-pending-credential-mismatch/u);
    assert.equal(f.store.confirm(f.input.credentialId, f.input.scope).revision, f.baseline.revision + 2);
    assert.deepEqual(f.store.read().credentials, [...f.baseline.credentials, { credentialId: f.input.credentialId, state: 'ready', highWater: 0 }]);
    const first = f.store.reserve(f.input.credentialId), second = f.store.reserve(f.input.credentialId);
    assert.equal(first.count, Math.floor(f.clock.nowMs() / 1000));
    assert.equal(second.count, first.count + 1); assert.notEqual(first.attemptId, second.attemptId);
    assert.deepEqual(f.store.read().credentials, [...f.baseline.credentials, { credentialId: f.input.credentialId, state: 'ready', highWater: second.count }]);
    assert.equal(readFileSync(join(f.machine.stateRoot, "machine", "profiles.json")).equals(registry), true);
    assert.equal(readFileSync(join(f.stateRoot, "credentials", "protected.json")).equals(protectedBytes), true);
    assert.throws(() => f.store.confirm(f.input.credentialId, f.input.scope), /duo-pending-credential-mismatch/u);
  } finally { await f.close(); }
});

it("burns committed attempts across new store instances and refuses document rollback or substitution", async () => {
  const f = await setup();
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
  } finally { await f.close(); }
});

it("rejects unsafe files and a missing established document without treating either as initial state", async () => {
  const f = await setup();
  try {
    f.store.enroll(f.input);
    chmodSync(f.documentPath, 0o644);
    assert.throws(() => f.store.read(), /permissions|unsafe|private/u);
    chmodSync(f.documentPath, 0o600);
    unlinkSync(f.documentPath);
    assert.throws(() => f.store.read(), /duo-document-membership-mismatch|duo-document-required/u);
  } finally { await f.close(); }
});

it("explicit erasure retires identities and counters without reviving a retired key", async () => {
  const f = await setup();
  try {
    f.store.enroll(f.input); f.store.confirm(f.input.credentialId, f.input.scope); f.store.reserve(f.input.credentialId);
    const beforeErase = f.store.read();
    assert.deepEqual(beforeErase.credentials.filter(row => row.credentialId !== f.input.credentialId), f.baseline.credentials);
    const revision = f.store.erase().revision;
    assert.equal(revision, beforeErase.revision + 1);
    assert.deepEqual(f.store.read(), { state: "erased", revision, credentials: [] });
    for (const credential of f.baseline.credentials) assert.throws(() => f.store.reserve(credential.credentialId), /duo-ready-credential-required/u);
    assert.throws(() => f.store.reserve(f.input.credentialId), /duo-ready-credential-required/u);
    assert.throws(() => f.store.enroll(f.input), /duo-credential-id-reused/u);
  } finally { await f.close(); }
});

it("refuses expired pending confirmation and released profile custody", async () => {
  const f = await setup();
  try {
    f.store.enroll(f.input); f.clock.advanceWall(600_000);
    assert.throws(() => f.store.confirm(f.input.credentialId, f.input.scope), /duo-arm-expired/u);
    f.admission.release();
    assert.throws(() => f.store.read(), /released|expired/u);
  } finally { await f.close(); }
});

it("rejects divergent duplicate reservation lineage in authenticated document models", () => {
  const profileId = randomUUID(), installationId = randomUUID(), credentialId = "cHVibGljLWZpeHR1cmU";
  const attempt = { attemptId: randomUUID(), credentialId, count: 1, reservedAt: "2026-10-22T12:00:00.000Z" };
  assert.equal(DuoCredentialDocumentSchema.safeParse({ schemaVersion: 1, installationId, profileId, revision: 1,
    credentials: [], retired: [{ credentialId, highWater: 1 }], reservations: [attempt, { ...attempt, attemptId: randomUUID() }] }).success, false);
});

it("authenticates encrypted payloads with the issued anchored key and distinct purpose", async () => {
  const f = await setup();
  try {
    f.store.enroll(f.input);
    const purpose = issueDuoCredentialPurpose(f.admission, f.machine);
    const bytes = readFileSync(f.documentPath), envelope = JSON.parse(bytes.toString("utf8")) as { tag: string };
    const tag = Buffer.from(envelope.tag, "base64"); tag[0] = (tag[0] ?? 0) ^ 1;
    const corrupted = Buffer.from(JSON.stringify({ ...envelope, tag: tag.toString("base64") }));
    assert.throws(() => openDuoCredentialDocument(purpose, corrupted, f.baseline.revision + 1), /duo-document-authentication-failed/u);
    assert.throws(() => openDuoCredentialDocument(purpose, bytes, f.baseline.revision + 2), /duo-envelope-binding-mismatch/u);
    assert.throws(() => openDuoCredentialDocument({ profileId: purpose.profileId }, bytes, f.baseline.revision + 1), /duo-purpose-unissued/u);
    assert.equal(f.store.read().revision, f.baseline.revision + 1);
  } finally { await f.close(); }
});

it("fails closed at uint32 exhaustion without changing the last committed count", async () => {
  const f = await setup();
  try {
    f.store.enroll(f.input); f.store.confirm(f.input.credentialId, f.input.scope);
    f.clock.setWall(new Date(0xffff_ffff * 1000));
    assert.equal(f.store.reserve(f.input.credentialId).count, 0xffff_ffff);
    const before = readFileSync(f.documentPath);
    assert.throws(() => f.store.reserve(f.input.credentialId), /duo-counter-exhausted/u);
    assert.equal(readFileSync(f.documentPath).equals(before), true);
    assert.equal(f.store.read().credentials.find(row => row.credentialId === f.input.credentialId)?.highWater, 0xffff_ffff);
    assert.deepEqual(f.store.read().credentials.filter(row => row.credentialId !== f.input.credentialId), f.baseline.credentials);
  } finally { await f.close(); }
});

const retainedStoppedControlSetupOwners = new Set<object>();
async function stoppedControlFixture(retainedCredential?: unknown) {
  const held: { fixture?: Awaited<ReturnType<typeof createHistoricalIncompleteProfileFixture>>; restore?: OfflineMaintenanceOperation;
    upgrade?: ReturnType<typeof acquireStoppedProfileControlUpgrade>; primary?: unknown } = {};
  retainedStoppedControlSetupOwners.add(held);
  try {
    const fixture = await createHistoricalIncompleteProfileFixture();
    held.fixture = fixture;
    const profileId = fixture.profileId;
    if (retainedCredential !== undefined) writeFileSync(join(fixture.profileRoot, "credentials", "duo-webauthn.json"), JSON.stringify(retainedCredential), { mode: 0o600 });
    const controlPath = fixture.controlPath;
    const current = JSON.parse(readFileSync(controlPath, "utf8")) as { schemaVersion: number; duo: Array<{ state: string }>; completedRestores: unknown[] };
    assert.equal(current.schemaVersion, 4);
    assert.deepEqual(current.completedRestores, []);
    assert.ok(current.duo.every(row => row.state === "never-initialized"));
    assert.deepEqual(current.duo, [{ profileId, state: 'never-initialized', revision: 0 }]);
    writeStoppedProfileControlPredecessor(fixture, 1);
    const restore = fixture.lifetime.beginOfflineMaintenance(fixture.workspace);
    held.restore = restore;
    const upgrade = acquireStoppedProfileControlUpgrade(fixture.workspace, restore, fixture.lifetime);
    held.upgrade = upgrade;
    retainedStoppedControlSetupOwners.delete(held);
    return { ...fixture, stateRoot: fixture.profileRoot, path: fixture.databasePath, profileId, controlPath, upgrade, restore,
      async close() {
        restore.assertHeld(); upgrade.release();
        assert.throws(() => restore.assertHeld(), /offline-maintenance-unissued/u);
        restore.release(); await fixture.close();
      } };

  } catch (error) { held.primary = error; throw retainAuthoritySourceClosure([error], { admission: held }); }
}

const retainedCredential = { rpId: "duosecurity.com", credentialId: "synthetic-retained-id", privateKey: "synthetic-retained-key", signCount: 42, transport: "internal" };
for (const shape of ["object", "array", "wrapper"] as const) it(`authenticates retained active-engine ${shape} bytes without changing them during control-only assessment`, async () => {
  const f = await stoppedControlFixture(shape === "object" ? retainedCredential : shape === "array" ? [retainedCredential] : { credentials: [retainedCredential] });
  let inventory: ReturnType<typeof composeStoppedControlCredentialInventory> | undefined;
  const capture = vi.spyOn(nativeFs, "mkdtempSync");
  let issued: string[];
  syncBuiltinESMExports();
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
    issued = capture.mock.results.map(result => {
      assert.equal(result.type, "return");
      assert.ok(typeof result.value === "string");
      return result.value;
    });
  } finally {
    try { inventory?.dispose(); await f.close(); }
    finally { capture.mockRestore(); syncBuiltinESMExports(); }
  }
  for (const directory of issued) assert.equal(existsSync(directory), false);
});

it("refuses malformed retained active-engine bytes rather than granting a control-only absence proof", async () => {
  const f = await stoppedControlFixture({ ...retainedCredential, signCount: -1 });
  try {
    const path = join(f.stateRoot, "credentials", "duo-webauthn.json"), bytes = readFileSync(path);
    assert.throws(() => composeStoppedControlCredentialInventory({ claim: f.upgrade.profileInventory(f.profileId), hostFacts: { primaryDisplay: null },
      clock: manualClock(new Date()) }), /credential-maintenance-copy-capture-incomplete/u);
    assert.equal(readFileSync(path).equals(bytes), true);
  } finally { await f.close(); }
});

it.each(["noncanonical", "symlink", "hardlink"] as const)("refuses %s active-engine membership during stopped control assessment", async problem => {
  const f = await stoppedControlFixture(retainedCredential);
  try {
    const path = join(f.stateRoot, "credentials", "duo-webauthn.json"), bytes = readFileSync(path);
    const other = problem === "noncanonical" ? join(f.stateRoot, "credentials", "duo-copy.json") : join(f.workspace, "retained-link-target.json");
    if (problem === "noncanonical") renameSync(path, other);
    else if (problem === "hardlink") linkSync(path, other);
    else { renameSync(path, other); symlinkSync(other, path); }
    assert.throws(() => composeStoppedControlCredentialInventory({ claim: f.upgrade.profileInventory(f.profileId), hostFacts: { primaryDisplay: null },
      clock: manualClock(new Date()) }), problem === "noncanonical" ? /profile-inventory-credential-unowned/u : /profile-inventory-path-unsafe/u);
    assert.equal(readFileSync(problem === "noncanonical" ? other : path).equals(bytes), true);
  } finally { await f.close(); }
});

it("refuses an attestation from another genuinely issued stopped profile", async () => {
  const first = await stoppedControlFixture(retainedCredential), second = await stoppedControlFixture(retainedCredential);
  let inventory: ReturnType<typeof composeStoppedControlCredentialInventory> | undefined;
  try {
    const claim = first.upgrade.profileInventory(first.profileId);
    inventory = composeStoppedControlCredentialInventory({ claim, hostFacts: { primaryDisplay: null }, clock: manualClock(new Date()) });
    assert.notEqual(first.profileId, second.profileId);
    assert.throws(() => verifyStoppedControlCredentialAttestation(inventory!.proof, second.upgrade.profileInventory(second.profileId), false),
      /profile-control-upgrade-attestation-unissued-or-used/u);
  } finally { inventory?.dispose(); await second.close(); await first.close(); }
});

it("does not apply retained-engine disposition to ordinary credential initialization", async () => {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "duo-ordinary-initialization-")));
  const lifetime = await runtimeLifetimeLock();
  const machine = acquireEntrypointAdmission(workspace, "exclusive", lifetime), clock = manualClock(new Date("2026-10-01T12:00:00.000Z"));
  let path: string | undefined, bytes: Buffer | undefined;
  const session = createProfileSession({ admission: machine, machineRoot: machine.stateRoot,
    initializationInventory: (child, operation, writer, copies) => {
      path = join(child.stateRoot, "credentials", "duo-webauthn.json");
      writeFileSync(path, JSON.stringify(retainedCredential), { mode: 0o600 });
      bytes = readFileSync(path);
      return composeProfileCredentialInitializationInventory({ machine, admission: child,
        clock, hostFacts: { primaryDisplay: null } })(operation, writer, copies);
    },
    repairInventory: (child, request, writer, copies) => composeProfileCredentialRepairInventory({ machine, admission: child,
      clock, hostFacts: { primaryDisplay: null } })(request, writer, copies) });
  try {
    await assert.rejects(async () => await finishProfileOnboarding(session, session.signUp({ firstName: "Fixture", lastName: "Example", email: "fixture@ucsd.edu", password: "disposable-fixture-password",
      createdAt: clock.now().toISOString() })), /credential-maintenance-copy-capture-incomplete/u);
    assert.ok(path !== undefined && bytes !== undefined);
    assert.equal(readFileSync(path).equals(bytes), true);
  } finally { await session.close(); machine.release(); rmSync(workspace, { recursive: true }); }
});

it("issues only finite read-only stopped-control inventory and preserves database and control bytes", async () => {
  const f = await stoppedControlFixture();
  let admission: RuntimeAdmission | undefined;
  try {
    const before = createHash("sha256").update(readFileSync(f.path)).digest("hex");
    const control = readFileSync(f.controlPath);
    assert.throws(() => RuntimeAdmission.forStoppedControlInventory({ profileId: f.profileId }), /profile-control-upgrade-inventory-unissued/u);
    const issued = f.upgrade.profileInventory(f.profileId);
    admission = RuntimeAdmission.forStoppedControlInventory(issued);
    assert.throws(() => RuntimeAdmission.prototype.readStoppedControlCredentialInventorySource.call({}, issued), error => error instanceof Error && error.message === "runtime-admission: required");
    assert.throws(() => admission?.readStoppedControlCredentialInventorySource({ profileId: f.profileId }), error => error instanceof Error && error.message === "stopped-control-inventory-unissued");
    const otherClaim = f.upgrade.profileInventory(f.profileId);
    assert.throws(() => admission?.readStoppedControlCredentialInventorySource(otherClaim), error => error instanceof Error && error.message === "stopped-control-inventory-unissued");
    const source = admission.readStoppedControlCredentialInventorySource(issued);
    assert.equal(source.binding.profileId, f.profileId);
    source.assertHeld();
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
      assert.throws(() => copy.readStoppedControlCredentialInventorySource(issued), error => error instanceof Error && error.message === "stopped-control-inventory-unissued");
      assert.throws(() => copy.assertWritable(), /profile-control-upgrade-write-refused/u);
      assert.throws(() => copy.assertCredentialRead(), /profile-control-upgrade-credential-read-refused/u);
    } finally { copy.release(); }
    admission.release();
    assert.throws(() => admission?.readStoppedControlCredentialInventorySource(issued));
    assert.throws(() => admission?.assertLive(), /missing or released admission/u);
  } finally { admission?.release(); await f.close(); }
});

it.each(["control", "database"] as const)("revokes the genuine stopped inventory when its %s source is replaced", async target => {
  const f = await stoppedControlFixture();
  let admission: RuntimeAdmission | undefined;
  try {
    admission = RuntimeAdmission.forStoppedControlInventory(f.upgrade.profileInventory(f.profileId));
    assert.equal(AuthorityDatabase.readProfileMaintenanceInventory(admission).authorityGeneration, 0);
    const path = target === "control" ? f.controlPath : f.path, substitute = `${path}.substitute`;
    writeFileSync(substitute, readFileSync(path), { mode: 0o600 }); renameSync(substitute, path);
    assert.throws(() => admission?.assertLive(), target === "control"
      ? /profile-control-upgrade-inventory-expired/u : /authority-readonly-source-changed/u);
  } finally { admission?.release(); await f.close(); }
});

it("refuses a high-water head without its exact durable reservation lineage", () => {
  const credentialId = "cHVibGljLWZpeHR1cmU", base = { schemaVersion: 1, installationId: randomUUID(), profileId: randomUUID(), revision: 1,
    credentials: [], retired: [{ credentialId, highWater: 1 }], reservations: [] };
  assert.equal(DuoCredentialDocumentSchema.safeParse(base).success, false);
  const reservation = { attemptId: randomUUID(), credentialId, count: 1, reservedAt: "2026-10-22T12:00:00.000Z" };
  assert.equal(DuoCredentialDocumentSchema.safeParse({ ...base, reservations: [reservation] }).success, true);
  assert.equal(DuoCredentialDocumentSchema.safeParse({ ...base, retired: [{ credentialId, highWater: 2 }], reservations: [reservation] }).success, false);
});

const SchemaVersionReadbackSchema = z.object({ schemaVersion: z.number().int() });

const DuoChildEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("ready"), pid: z.number().int().positive() }),
  z.strictObject({ type: z.literal("reserved"), attemptId: z.uuid(), count: z.number().int().positive().max(0xffff_ffff), revision: z.number().int().positive() }),
  z.strictObject({ type: z.literal("failed"), code: z.literal("DUO_FIXTURE_RESERVATION_FAILED"),
    phase: z.enum(["reserve", "reserve-then-crash"]), causes: z.array(z.strictObject({
      name: z.enum(["Error", "TypeError", "RangeError", "AggregateError", "ZodError", "DuoCredentialCommitUncertainError",
        "CredentialKeyCustodyError", "PrivateFileLockUnavailableError", "RuntimeLifetimeLockReleasedError", "AuthoritySourceClosureUnprovedError", "unclassified"]),
      code: z.string().refine(value => value === "unclassified" || Object.hasOwn(ERROR_CATALOG, value)),
      reason: z.enum(["directory-integrity: credential lock is unavailable", "directory-integrity: credential lock permissions or identity are invalid",
        "directory-integrity: credential lock moved while it was read", "directory-integrity: private lock is malformed",
        "directory-integrity: private lock parent changed", "directory-integrity: private lock changed",
        "directory-integrity: credential lock differs after creation", "directory-integrity: credential lock identity changed after creation",
        "duo-publication-pending", "duo-transaction-unissued", "duo-transaction-not-committed", "duo-document-membership-mismatch",
        "duo-document-custody-changed", "duo-publication-file-changed", "duo-publication-prior-changed", "duo-profile-authority-changed",
        "duo-machine-authority-changed", "duo-document-required", "duo-ready-credential-required", "duo-counter-exhausted",
        "profile-registry-publication-busy", "profile-registry-observation-changed", "profile-registry-continuity-mismatch", "directory-integrity", "unclassified"]),
      frames: z.array(z.enum(["readPrivateFile", "withPrivateFileLock", "assertPrivateLockBytes", "profileObservation", "readProfileEvidence",
        "readMachineRegistry", "assertDuoMembership", "assertProfileRuntime", "publishIssuedDuo", "prepareIssuedDuoTransaction", "settleDuoPublication"])).max(11),
    })).min(1).max(6) }),
]);
async function duoChild(f: Awaited<ReturnType<typeof setup>>) {
  const child = fork(fileURLToPath(new URL("../../../support/processes/duo-credential-store-worker.ts", import.meta.url)),
    [f.workspace, f.admission.profileBinding.profileId, f.input.credentialId, f.clock.now().toISOString(), String(f.lifetime.port)],
    { execArgv: ["--import", testProcessImport()], stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const held: { fixture: typeof f; child: typeof child; events?: object; closure?: object; primary?: { error: unknown }; failures: unknown[] } = { fixture: f, child, failures: [] };
  retainedPublicationRecoveryOwners.add(held);
  let closing: Promise<void> | undefined;
  let stderrBytes = 0, exited = false, expectedCrash = false;
  child.stderr?.on("data", (bytes: Buffer) => { stderrBytes += bytes.length; });
  const exit = once(child, "exit").then(values => { exited = true; return z.tuple([z.number().int().nullable(), z.string().nullable()]).parse(values); });
  const events = on(child, "message");
  held.events = events;
  const closed = once(child, 'close').then(values => ({ outcome: z.tuple([z.number().int().nullable(), z.string().nullable()]).parse(values) }))
    .catch((error: unknown) => { held.primary ??= { error }; return { error }; });
  held.closure = closed;
  const event = async () => {
    const result = await Promise.race([events.next(), exit.then(() => { throw new Error("Duo fixture child exited before the required event"); })]);
    assert.equal(result.done, false);
    return DuoChildEventSchema.parse(result.value?.[0]);
  };
  try {
    await f.lifetime.share(child);
    const ready = await event(); assert.equal(ready.type, "ready");
    if (ready.type !== "ready") throw new Error("Duo fixture child readiness required");
    assert.equal(ready.pid, child.pid);
    return { pid: ready.pid,
      async reserve() {
        child.send("reserve"); const result = await event();
        assert.equal(result.type, "reserved", result.type === "failed" ? `Duo reservation diagnostic: ${JSON.stringify(result)}` : "Duo fixture child reservation required");
        if (result.type !== "reserved") throw new Error("Duo fixture child reservation required");
        return result;
      },
      async crashAfterReservation() { child.send("reserve-then-crash"); assert.deepEqual(await exit, [23, null]); expectedCrash = true; assert.equal(stderrBytes, 0); },
      close(): Promise<void> {
        if (closing !== undefined) return closing;
        closing = (async () => {
          let primary: { error: unknown } | undefined;
          const cleanup: unknown[] = [];
          try {
            if (!exited) { child.send("close"); assert.deepEqual(await exit, [0, null]); }
          else assert.equal(expectedCrash, true, "Duo fixture child exited before requested closure");
          assert.equal(stderrBytes, 0);
            const result = await closed;
            if ('error' in result) throw result.error;
            assert.deepEqual(result.outcome, [child.exitCode, child.signalCode]);
            assert.equal(child.connected, false);
          } catch (error) { primary = { error }; held.primary ??= primary; }
          try { await events.return?.(); } catch (error) { cleanup.push(error); }
          held.failures.push(...cleanup);
          if (primary !== undefined && cleanup.length > 0) throw new AggregateError([primary.error, ...cleanup], 'Duo child closure failed', { cause: primary.error });
          if (primary !== undefined) throw primary.error;
          if (cleanup.length > 0) throw new AggregateError(cleanup, 'Duo child event closure failed', { cause: cleanup[0] });
          retainedPublicationRecoveryOwners.delete(held);
        })();
        return closing;
      },
    };
  } catch (error) { held.primary ??= { error }; throw error; }
}

it("reserves increasing counts in independent processes and burns a committed attempt after process death", async () => {
  const f = await setup({ sharedMachine: true });
  const children: Awaited<ReturnType<typeof duoChild>>[] = [];
  const retained: { fixture: typeof f; children: typeof children; primary?: { error: unknown }; failures: unknown[] } = { fixture: f, children, failures: [] };
  retainedPublicationRecoveryOwners.add(retained);
  let primary: { error: unknown } | undefined;
  try {
    f.store.enroll(f.input); f.store.confirm(f.input.credentialId, f.input.scope);
    const first = await duoChild(f); children.push(first);
    const second = await duoChild(f); children.push(second);
    assert.notEqual(first.pid, second.pid); assert.notEqual(first.pid, process.pid); assert.notEqual(second.pid, process.pid);
    const [a, b] = await Promise.all([first.reserve(), second.reserve()]);
    assert.equal(Math.max(a.count, b.count), Math.min(a.count, b.count) + 1); assert.notEqual(b.attemptId, a.attemptId);
    await first.crashAfterReservation();
    const burned = f.store.read().credentials.find(row => row.credentialId === f.input.credentialId); assert.ok(burned);
    assert.equal(burned.highWater, Math.max(a.count, b.count) + 1);
    const restarted = await duoChild(f); children.push(restarted);
    const c = await restarted.reserve(); assert.equal(c.count, burned.highWater + 1);
    assert.equal(f.store.read().credentials.find(row => row.credentialId === f.input.credentialId)?.highWater, c.count);
    assert.deepEqual(f.store.read().credentials.filter(row => row.credentialId !== f.input.credentialId), f.baseline.credentials);
  } catch (error) { primary = { error }; retained.primary = primary; }
  const closed = await Promise.allSettled(children.map(child => child.close()));
  const failures: unknown[] = [];
  for (const result of closed) if (result.status === 'rejected') { const reason: unknown = result.reason; failures.push(reason); }
  retained.failures.push(...failures);
  if (primary === undefined && failures.length === 0) {
    try { await f.close(); retainedPublicationRecoveryOwners.delete(retained); }
    catch (error) { failures.push(error); retained.failures.push(error); }
  }
  if (primary !== undefined && failures.length > 0) throw new AggregateError([primary.error, ...failures], 'Duo process scenario failed', { cause: primary.error });
  if (primary !== undefined) throw primary.error;
  if (failures.length > 0) throw new AggregateError(failures, 'Duo process cleanup failed', { cause: failures[0] });
}, scaledMs(30_000));

it("recovers an interrupted Duo publication only for the issued claim and keeps the reserved count burned", async () => {
  const f = await setup();
  const retained: { fixture: typeof f; other?: ReturnType<typeof createDuoCredentialStore>; primary?: { error: unknown } } = { fixture: f };
  retainedPublicationRecoveryOwners.add(retained);
  try {
    f.store.enroll(f.input); f.store.confirm(f.input.credentialId, f.input.scope);
    const other = createDuoCredentialStore(f.admission, f.machine, f.clock);
    retained.other = other;
    assert.throws(() => f.store.interruptReserve(f.input.credentialId), (error) => error instanceof DuoCredentialCommitUncertainError);
    assert.throws(() => other.recoverInterruptedPublication(), /duo-transaction-unissued/u);
    assert.throws(() => other.read(), /duo-publication-pending/);
    f.store.recoverInterruptedPublication();
    const burned = f.store.read().credentials.find(row => row.credentialId === f.input.credentialId);
    assert.ok(burned);
    assert.equal(f.store.reserve(f.input.credentialId).count, burned.highWater + 1);
    assert.throws(() => f.store.recoverInterruptedPublication(), /duo-transaction-unissued/u);
    await f.close();
    retainedPublicationRecoveryOwners.delete(retained);
  } catch (error) { retained.primary = { error }; throw error; }
});

function privateJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
}

function assertChildProcessReleased(pid: number): void {
  let groupGone = false;
  try { process.kill(-pid, 0); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") groupGone = true;
    else if (process.platform === "darwin" && error instanceof Error && "code" in error && error.code === "EPERM") {
      const groups = execFileSync("/bin/ps", ["-axo", "pgid="], { encoding: "utf8" }).trim().split(/\s+/u);
      if (!groups.every((value) => /^[1-9][0-9]*$/u.test(value))) throw new Error("duo-child-process-group-unproved", { cause: error });
      groupGone = !groups.includes(String(pid));
    } else throw error;
  }
  if (!groupGone) throw new Error("duo-child-process-group-unproved");
  const listed = spawnSync("lsof", ["-nP", "-a", "-p", String(pid)], { encoding: "utf8" });
  if (listed.error !== undefined || listed.signal !== null || listed.status !== 1) throw new Error("duo-child-fd-unproved", { cause: listed.error });
}

function downgradeStoppedControl(fixture: Pick<Awaited<ReturnType<typeof createHistoricalIncompleteProfileFixture>>,
  "databasePath" | "registryPath" | "controlPath" | "markerPath" | "processLockRoot" | "profileId">, markerVersion: 1 | 2, dropCredentialKey = false) {
  const paths = { databasePath: fixture.databasePath, database: readFileSync(fixture.databasePath),
    controlPath: fixture.controlPath, markerPath: fixture.markerPath, processLockRoot: fixture.processLockRoot };
  const current = JSON.parse(readFileSync(paths.controlPath, "utf8")) as { schemaVersion: number; duo?: unknown; completedRestores: unknown[]; erasures?: Array<Record<string, unknown>> };
  assert.equal(current.schemaVersion, 4);
  assert.deepEqual(current.completedRestores, []);
  assert.deepEqual(current.duo, [{ profileId: fixture.profileId, state: 'never-initialized', revision: 0 }]);
  writeStoppedProfileControlPredecessor(fixture, 1);
  const { duo: _duo, completedRestores: _completed, erasures, ...prior } = JSON.parse(readFileSync(paths.controlPath, "utf8")) as typeof current;
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

const retainedPublicationRecoveryOwners = new Set<unknown>();

it("authorizes a Duo reservation after the peer control publication finishes", async () => {
  const f = await setup();
  const peers: { path: string; bytes: Buffer; identity: { device: number; inode: number } }[] = [];
  let primary: { error: unknown } | undefined;
  try {
    f.store.enroll(f.input); f.store.confirm(f.input.credentialId, f.input.scope);
    const first = f.store.reserve(f.input.credentialId), before = f.store.read();
    const profileId = f.admission.profileBinding.profileId;
    const controlPath = join(f.workspace, ".tracker", "control", ".installation-mutation.lock");
    const stagePath = join(f.machine.stateRoot, "machine", "duo-credentials", `.${profileId}.${randomUUID()}.stage`);
    for (const [path, bytes] of [[controlPath, Buffer.from(JSON.stringify({ nonce: randomUUID() }))],
      [stagePath, Buffer.from("synthetic peer stage")]] as const) {
      writeFileSync(path, bytes, { mode: 0o600, flag: "wx" });
      const info = statSync(path); peers.push({ path, bytes, identity: { device: info.dev, inode: info.ino } });
    }
    const opens = vi.spyOn(nativeFs, "openSync");
    const wait = vi.spyOn(Atomics, "wait").mockImplementation(() => {
      unlinkSync(stagePath); unlinkSync(controlPath);
      return "ok";
    });
    syncBuiltinESMExports();
    const reserved = f.store.reserve(f.input.credentialId);
    assert.equal(wait.mock.calls.length, 1); assert.equal(wait.mock.calls[0]?.[3], 25);
    assert.equal(opens.mock.calls.filter(([path, flags]) => path === controlPath
      && typeof flags === "number" && (flags & nativeFs.constants.O_EXCL) !== 0).length, 2);
    assert.equal(reserved.count, first.count + 1); assert.equal(reserved.revision, before.revision + 1);
    assert.notEqual(reserved.attemptId, first.attemptId);
    assert.equal(f.store.read().credentials.find(row => row.credentialId === f.input.credentialId)?.highWater, reserved.count);
    assert.equal(existsSync(stagePath), false); assert.equal(existsSync(controlPath), false);
  } catch (error) { primary = { error }; }
  vi.restoreAllMocks(); syncBuiltinESMExports();
  try {
    for (const peer of peers) if (existsSync(peer.path)) {
      assert.deepEqual(readFileSync(peer.path), peer.bytes);
      removeExactPath(peer.path, peer.identity, false, "synthetic-peer-file-changed");
    }
    await f.close();
  } catch (error) {
    if (primary !== undefined) throw new AggregateError([primary.error, error], "Duo control contention and owned cleanup failed", { cause: error });
    throw error;
  }
  if (primary !== undefined) throw primary.error;
});

it("finishes one interrupted Duo publication after the producing process exits and refuses a changed or released claim", async () => {
  const f = await setup({ sharedMachine: true });
  const retained: { fixture: typeof f; child?: ChildProcess; maintenance?: RuntimeAdmission; machine?: RuntimeAdmission; admission?: RuntimeAdmission; events?: unknown; failures: unknown[] } = { fixture: f, failures: [] };
  retainedPublicationRecoveryOwners.add(retained);
  let recoveryCompleted = false;
  let child: ChildProcess | undefined;
  let closed: Promise<unknown[]> | undefined;
  let closeObserved = false;
  let childReleased = false;
  let primary: { error: unknown } | undefined;
  const cleanup: unknown[] = [];
  try {
    f.store.enroll(f.input); f.store.confirm(f.input.credentialId, f.input.scope);
    const canonicalBefore = readFileSync(f.documentPath);
    const profileId = f.admission.profileBinding.profileId;
    child = fork(fileURLToPath(new URL("../../../support/processes/duo-credential-store-worker.ts", import.meta.url)),
      [f.workspace, profileId, f.input.credentialId, f.clock.now().toISOString(), String(f.lifetime.port)],
      { execArgv: ["--import", testProcessImport()], detached: true, stdio: ["ignore", "ignore", "pipe", "ipc"] });
    retained.child = child;
    const closeEvent = once(child, "close");
    closed = closeEvent;
    const events = on(child, "message");
    retained.events = events;
    let stderrBytes = 0;
    child.stderr?.on("data", (bytes: Buffer) => { stderrBytes += bytes.length; });
    const next = async () => {
      const result = await Promise.race([events.next(), closeEvent.then(() => { throw new Error("Duo interrupt child exited before the required event"); })]);
      assert.equal(result.done, false);
      return z.object({ type: z.string(), name: z.string().optional(), pid: z.number().int().positive().optional() }).parse(result.value?.[0]);
    };
    let eventFailure: { error: unknown } | undefined;
    try {
      await f.lifetime.share(child);
      const ready = await next();
      assert.deepEqual(ready, { type: "ready", pid: child.pid });
      const uncertain = once(child, "message");
      child.send("interrupt-publication");
      const [code, signal] = z.tuple([z.number().int().nullable(), z.string().nullable()]).parse(await closeEvent);
      closeObserved = true;
      if (child.connected || child.pid === undefined) throw new Error("duo-child-close-unproved");
      assertChildProcessReleased(child.pid);
      childReleased = true;
      const message = z.object({ type: z.string(), name: z.string().optional() }).parse((await uncertain)[0]);
      assert.deepEqual([code, signal], [97, null]);
      assert.equal(message.type, "uncertain");
      assert.equal(message.name, "DuoCredentialCommitUncertainError");
      assert.equal(stderrBytes, 0);
    } catch (error) { eventFailure = { error }; }
    let eventCloseFailure: { error: unknown } | undefined;
    try { await events.return?.(undefined); }
    catch (error) { eventCloseFailure = { error }; }
    if (eventFailure !== undefined) {
      if (eventCloseFailure !== undefined) cleanup.push(eventCloseFailure.error);
      throw eventFailure.error;
    }
    if (eventCloseFailure !== undefined) throw eventCloseFailure.error;
    const intentPath = join(f.workspace, ".tracker/control", "profile-publication.json");
    const directory = join(f.machine.stateRoot, "machine", "duo-credentials");
    const stageName = readdirSync(directory).find((name) => name.startsWith(`.${profileId}.`) && name.endsWith(".stage"));
    assert.equal(typeof stageName, "string");
    const stagePath = join(directory, stageName ?? "");
    const intentBefore = readFileSync(intentPath);
    const stageBefore = readFileSync(stagePath);
    assert.throws(() => f.store.read(), /duo-publication-pending|duo-transaction-unissued/u);
    assert.equal(readFileSync(intentPath).equals(intentBefore), true);
    assert.equal(readFileSync(stagePath).equals(stageBefore), true);
    assert.equal(readFileSync(f.documentPath).equals(canonicalBefore), true);
    f.admission.release(); f.machine.release();
    const maintenance = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime);
    retained.maintenance = maintenance;
    {
      const changedProfile = JSON.parse(intentBefore.toString("utf8")) as { capture: { profileId: string } };
      changedProfile.capture.profileId = randomUUID();
      privateJson(intentPath, changedProfile);
      const foreignCapture = DuoPublicationCaptureSchema.parse(changedProfile.capture);
      const foreignStagePath = duoStagePath(maintenance.stateRoot, foreignCapture);
      assert.equal(existsSync(foreignStagePath), false);
      renameSync(stagePath, foreignStagePath);
      assert.throws(() => maintenance.issueStoppedDuoPublicationRecovery(), /duo-publication-prior-changed|duo-publication-file-changed/u);
      renameSync(foreignStagePath, stagePath);
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
    }
    maintenance.release();
    const machine = RuntimeAdmission.acquireMachine(f.workspace, "shared", f.lifetime);
    retained.machine = machine;
    const admission = machine.admitProfile(profileId);
    retained.admission = admission;
    {
      const reopened = createDuoCredentialStore(admission, machine, f.clock);
      const burned = reopened.read().credentials.find(row => row.credentialId === f.input.credentialId);
      assert.ok(burned);
      assert.equal(burned.highWater >= Math.floor(f.clock.nowMs() / 1000), true);
      const next = reopened.reserve(f.input.credentialId);
      assert.equal(next.count, burned.highWater + 1);
      assert.throws(() => reopened.recoverInterruptedPublication(), /duo-transaction-unissued/u);
    }
    admission.release(); machine.release();
    recoveryCompleted = true;
  } catch (error) { primary = { error }; retained.failures.push(error); }
  if (!closeObserved && child !== undefined && closed !== undefined) {
    try {
      if (child.exitCode === null && child.signalCode === null) child.send("close");
      const outcome = await Promise.race([closed, new Promise<never>((_resolve, reject) => { setTimeout(() => reject(new Error("duo-child-close-unproved")), 10_000); })]);
      const [code, signal] = z.tuple([z.number().int().nullable(), z.string().nullable()]).parse(outcome);
      closeObserved = true;
      if ((code === null && signal === null) || child.connected || child.pid === undefined) throw new Error("duo-child-close-unproved");
      assertChildProcessReleased(child.pid);
      childReleased = true;
    } catch (error) { cleanup.push(error); }
  }
  if (primary === undefined && cleanup.length === 0 && recoveryCompleted && childReleased) {
    try { await f.close(); retainedPublicationRecoveryOwners.delete(retained); }
    catch (error) { cleanup.push(error); }
  }
  retained.failures.push(...cleanup);
  if (primary !== undefined && cleanup.length > 0) throw new AggregateError([primary.error, ...cleanup], "Duo interrupt child cleanup unproved", { cause: primary.error });
  if (cleanup.length > 1) throw new AggregateError(cleanup, "Duo interrupt child cleanup unproved", { cause: cleanup[0] });
  if (cleanup.length === 1) throw cleanup[0];
  if (primary !== undefined) throw primary.error;
  if (!recoveryCompleted || !childReleased) throw new Error('duo-recovery-closure-unproved');
}, scaledMs(30_000));

it("refuses unmanaged Duo copies, then backup erase and restore keep burned counters and do not revive erased key material", async () => {
  const f = await setup();
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
    assert.equal(f.store.read().credentials.find(row => row.credentialId === f.input.credentialId)?.highWater, second.count);
    assert.deepEqual(f.store.read().credentials.filter(row => row.credentialId !== f.input.credentialId), f.baseline.credentials);
    const purpose = issueDuoCredentialPurpose(f.admission, f.machine);
    const currentRevision = f.store.read().revision;
    const currentDocument = openDuoCredentialDocument(purpose, readFileSync(f.documentPath), currentRevision);
    const backedUpDocument = openDuoCredentialDocument(purpose, readFileSync(backupPath), backedUp.revision);
    assert.equal(currentDocument.credentials.length, f.baseline.credentials.length + 1);
    assert.deepEqual(currentDocument.credentials.filter(row => row.credentialId !== f.input.credentialId).map(({ credentialId, state, highWater }) => ({ credentialId, state, highWater })), f.baseline.credentials);
    assert.equal(backedUpDocument.credentials.length, f.baseline.credentials.length + 1);
    assert.deepEqual(backedUpDocument.credentials.filter(row => row.credentialId !== f.input.credentialId).map(({ credentialId, state, highWater }) => ({ credentialId, state, highWater })), f.baseline.credentials);
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
    assert.throws(() => f.store.erase(), error => error instanceof Error && error.message === "directory-integrity: Duo credential permissions or identity are invalid");
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
    const freshPurpose = issueDuoCredentialPurpose(f.admission, f.machine);
    assert.throws(() => openDuoCredentialDocument(freshPurpose, readFileSync(currentBackupPath), currentBackup.revision), /duo-erased-key-material-refused/u);
    assert.throws(() => openDuoCredentialDocument(purpose, readFileSync(backupPath), backedUp.revision), /duo-erased-key-material-refused/u);
    const erasedDocument = openDuoCredentialDocument(freshPurpose, readFileSync(f.documentPath), f.store.read().revision);
    assert.equal(erasedDocument.credentials.length, 0);
    assert.throws(() => f.store.restore(currentBackupPath), /duo-purpose-restore-revives-erased-key/u);
    assert.throws(() => f.store.restore(backupPath), /duo-purpose-restore-revives-erased-key/u);
    const reopened = createDuoCredentialStore(f.admission, f.machine, f.clock);
    assert.deepEqual(reopened.read().credentials, []);
    assert.throws(() => reopened.reserve(f.input.credentialId), /duo-ready-credential-required/u);
    for (const credential of f.baseline.credentials) assert.throws(() => reopened.reserve(credential.credentialId), /duo-ready-credential-required/u);
    assert.equal(readFileSync(enginePath).equals(engineBefore), true);
  } finally { await f.close(); }
});

const hostFacts = { primaryDisplay: null };
const upgradeClock = () => manualClock(new Date("2026-01-15T00:00:00.000Z"));

it("admits only the finite stopped machine-control pair through maintenance admission", async () => {
  const unsupported = await createHistoricalIncompleteProfileFixture();
  const unsupportedPaths = downgradeStoppedControl(unsupported, 1);
  try {
    assert.throws(() => RuntimeAdmission.acquireMachine(unsupported.workspace, "exclusive", unsupported.lifetime));
    assert.throws(() => RuntimeAdmission.acquireStoppedMachineControlMaintenance(unsupported.workspace, unsupported.lifetime), /profile-control-upgrade-pending-conversion-unsupported/u);
    assertUnchanged(unsupportedPaths);
  } finally { await unsupported.close(); }
  const missingKey = await createHistoricalIncompleteProfileFixture();
  const missingPaths = downgradeStoppedControl(missingKey, 2, true);
  try {
    const maintenance = RuntimeAdmission.acquireStoppedMachineControlMaintenance(missingKey.workspace, missingKey.lifetime);
    try {
      await assert.rejects(upgradeStoppedMachineControl(maintenance, { plan: false, hostFacts }, upgradeClock(), composeStoppedControlCredentialInventory), /profile-credential-key-unowned/);
      assertUnchanged(missingPaths);
    } finally { maintenance.release(); }
  } finally { await missingKey.close(); }
  const live = await createHistoricalIncompleteProfileFixture();
  const livePaths = downgradeStoppedControl(live, 2);
  const lock = acquireRuntimeProcessLock({ processLockRoot: livePaths.processLockRoot, name: "server", pid: process.pid });
  try {
    const before = oldArtifactSnapshot(livePaths.processLockRoot);
    assert.throws(() => RuntimeAdmission.acquireStoppedMachineControlMaintenance(live.workspace, live.lifetime), { code: "RUNTIME_OLD_BUILD_ARTIFACTS" });
    assert.deepEqual(oldArtifactSnapshot(livePaths.processLockRoot), before);
    lock.release();
    const released = oldArtifactSnapshot(livePaths.processLockRoot);
    assert.throws(() => RuntimeAdmission.acquireStoppedMachineControlMaintenance(live.workspace, live.lifetime), { code: "RUNTIME_OLD_BUILD_ARTIFACTS" });
    assert.deepEqual(oldArtifactSnapshot(livePaths.processLockRoot), released);
    assertUnchanged(livePaths);
  } finally { lock.release(); await live.close(); }
});

async function stoppedControlCommand(fixture: Awaited<ReturnType<typeof createHistoricalIncompleteProfileFixture>>, plan: boolean) {
  const maintenance = RuntimeAdmission.acquireStoppedMachineControlMaintenance(fixture.workspace, fixture.lifetime);
  let report: Awaited<ReturnType<typeof upgradeStoppedMachineControl>>;
  try { report = await upgradeStoppedMachineControl(maintenance, { plan, hostFacts }, upgradeClock(), composeStoppedControlCredentialInventory); }
  catch (error) {
    if (hasUnprovedSourceClosure(error)) throw error;
    try { maintenance.release(); }
    catch (cleanup) { throw retainAuthoritySourceClosure([error, cleanup], { admission: maintenance }); }
    throw error;
  }
  try { maintenance.release(); }
  catch (error) { throw retainAuthoritySourceClosure([error], { admission: maintenance }); }
  return report;
}

it("upgrades marker 2 through stopped maintenance, keeps exact backup bytes, and rolls back a mutated stage", async () => {
  const fixture = await createHistoricalIncompleteProfileFixture();
  const paths = downgradeStoppedControl(fixture, 2);
  assert.throws(() => RuntimeAdmission.acquireMachine(fixture.workspace, "exclusive", fixture.lifetime));
  try {
    const planned = await stoppedControlCommand(fixture, true);
    assert.equal(planned.state, "planned");
    assert.equal(planned.runtimeAccess, "onboarding-incomplete");
    assertUnchanged(paths);
    execFileSync("/usr/bin/chflags", ["uchg", paths.controlPath]);
    await assert.rejects(stoppedControlCommand(fixture, false), /EPERM|operation not permitted|profile-control-upgrade-publication-uncertain/u);
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
    await assert.rejects(stoppedControlCommand(fixture, true), /profile-control-upgrade-publication-uncertain/u);
    await assert.rejects(stoppedControlCommand(fixture, false), /profile-control-upgrade-publication-uncertain/u);
    assert.equal(readFileSync(paths.controlPath).equals(paths.controlBytes), true);
    writeFileSync(stagePath, stageBytes);
    const upgraded = await stoppedControlCommand(fixture, false);
    assert.equal(upgraded.state, "upgraded");
    assert.equal(upgraded.runtimeAccess, "onboarding-incomplete");
    const names = readdirSync(backupDirectory).sort();
    const operationNames = names.filter((name) => name.endsWith(".control.before.json"));
    assert.equal(operationNames.length, 1);
    const operationId = operationNames[0]?.slice(0, -".control.before.json".length);
    assert.deepEqual(names, [`${operationId}.registry.before.json`, `${operationId}.control.before.json`, `${operationId}.marker.before.json`, `${operationId}.receipt.json`].sort());
    const controlBackup = readFileSync(join(backupDirectory, `${operationId}.control.before.json`));
    const markerBackup = readFileSync(join(backupDirectory, `${operationId}.marker.before.json`));
    assert.equal(controlBackup.equals(paths.controlBytes), true);
    assert.equal(markerBackup.equals(paths.markerBytes), true);
    assert.equal(statSync(join(backupDirectory, `${operationId}.control.before.json`)).mode & 0o777, 0o600);
    assert.equal(statSync(join(backupDirectory, `${operationId}.marker.before.json`)).mode & 0o777, 0o600);
    assert.equal(createHash("sha256").update(controlBackup).digest("hex"), createHash("sha256").update(paths.controlBytes).digest("hex"));
    assert.equal(SchemaVersionReadbackSchema.parse(JSON.parse(readFileSync(paths.markerPath, "utf8"))).schemaVersion, 5);
    assert.equal(SchemaVersionReadbackSchema.parse(JSON.parse(readFileSync(paths.controlPath, "utf8"))).schemaVersion, 4);
    assert.equal(readFileSync(paths.databasePath).equals(paths.database), true);
    const current = await stoppedControlCommand(fixture, false);
    assert.equal(current.state, "current");
    assert.equal(current.runtimeAccess, "onboarding-incomplete");
    assert.equal(readFileSync(paths.databasePath).equals(paths.database), true);
  } finally {
    execFileSync("/usr/bin/chflags", ["nouchg", paths.controlPath]);
    await fixture.close();
  }
});

it("recovers a machine-control publication stopped between the control and marker renames", async () => {
  const fixture = await createHistoricalIncompleteProfileFixture();
  const paths = downgradeStoppedControl(fixture, 2);
  try {
    execFileSync("/usr/bin/chflags", ["uchg", paths.markerPath]);
    await assert.rejects(stoppedControlCommand(fixture, false), /EPERM|operation not permitted|profile-control-upgrade-publication-uncertain/u);
    execFileSync("/usr/bin/chflags", ["nouchg", paths.markerPath]);
    assert.equal(SchemaVersionReadbackSchema.parse(JSON.parse(readFileSync(paths.controlPath, "utf8"))).schemaVersion, 4);
    assert.equal(readFileSync(paths.markerPath).equals(paths.markerBytes), true);
    const upgraded = await stoppedControlCommand(fixture, false);
    assert.equal(upgraded.state, "upgraded");
    assert.equal(upgraded.runtimeAccess, "onboarding-incomplete");
    assert.equal(SchemaVersionReadbackSchema.parse(JSON.parse(readFileSync(paths.markerPath, "utf8"))).schemaVersion, 5);
    const backupDirectory = join(fixture.workspace, ".tracker/control", "profile-control-upgrades");
    const controlName = readdirSync(backupDirectory).find((name) => name.endsWith(".control.before.json"));
    assert.equal(typeof controlName, "string");
    assert.equal(readFileSync(join(backupDirectory, controlName ?? "")).equals(paths.controlBytes), true);
    assert.equal(readFileSync(join(backupDirectory, (controlName ?? "").replace(".control.before.json", ".marker.before.json"))).equals(paths.markerBytes), true);
    assert.equal(readFileSync(paths.databasePath).equals(paths.database), true);
  } finally {
    execFileSync("/usr/bin/chflags", ["nouchg", paths.markerPath]);
    await fixture.close();
  }
});

it("keeps the restore admission when stopped-control snapshot disposal is unproved", async () => {
  const fixture = await createHistoricalIncompleteProfileFixture();
  const held: { fixture: typeof fixture; maintenance?: RuntimeAdmission; restore?: ReturnType<RuntimeAdmission['maintenanceOperation']>; control?: ReturnType<RuntimeAdmission['beginStoppedMachineControlUpgrade']>; processLockRoot?: string; snapshot?: { path: string; device: number; inode: number; uid: number; originalFlags: number; injected: boolean }; primary?: { error: unknown }; cleanup?: { error: unknown } } = { fixture };
  retainedPublicationRecoveryOwners.add(held);
  const readSnapshotFlags = (path: string) => z.number().int().nonnegative().parse(Number(z.string().regex(/^\d+$/).parse(execFileSync('/usr/bin/stat', ['-f', '%f', path], { encoding: 'utf8' }).trim())));
  let primary: { error: unknown } | undefined;
  try {
    const paths = downgradeStoppedControl(fixture, 2);
    held.processLockRoot = paths.processLockRoot;
    const maintenance = RuntimeAdmission.acquireStoppedMachineControlMaintenance(fixture.workspace, fixture.lifetime);
    held.maintenance = maintenance;
    const restore = maintenance.maintenanceOperation();
    held.restore = restore;
    assert.ok(restore);
    const control = maintenance.beginStoppedMachineControlUpgrade(restore);
    held.control = control;
    const profileId = control.registeredProfileIds()[0];
    assert.equal(typeof profileId, "string");
    const capture = vi.spyOn(nativeFs, "mkdtempSync");
    const issued: string[] = [];
    syncBuiltinESMExports();
    try {
      control.profileInventory(profileId ?? "");
      for (const result of capture.mock.results) {
        assert.equal(result.type, "return");
        assert.ok(typeof result.value === "string");
        issued.push(result.value);
      }
    } finally { capture.mockRestore(); syncBuiltinESMExports(); }
    const created = issued.filter(path => existsSync(path));
    assert.equal(created.length, 1);
    const snapshotFile = join(created[0] ?? "", "authority.sqlite");
    const identity = nativeFs.lstatSync(snapshotFile);
    assert.ok(identity.isFile() && !identity.isSymbolicLink());
    assert.equal(identity.nlink, 1);
    assert.equal(identity.uid, process.getuid?.());
    const originalFlags = readSnapshotFlags(snapshotFile);
    assert.equal(originalFlags, 0);
    held.snapshot = { path: snapshotFile, device: identity.dev, inode: identity.ino, uid: identity.uid, originalFlags, injected: false };
    execFileSync("/usr/bin/chflags", ["uchg", snapshotFile]);
    held.snapshot.injected = true;
    assert.throws(() => releaseStoppedMachineControlUpgrade(control, restore, true), (error: unknown) => error instanceof AuthoritySourceClosureUnprovedError);
    restore.assertHeld();
    assert.equal(existsSync(join(paths.processLockRoot, "restore-admission.lock.json")), false);
    assert.throws(() => maintenance.beginOfflineMaintenance(), /offline-maintenance-busy/u);
    assert.throws(() => RuntimeAdmission.acquireMachine(fixture.workspace, "shared", fixture.lifetime), /offline-maintenance-unissued/u);
    assert.throws(() => releaseStoppedMachineControlUpgrade(control, restore, true), (error: unknown) => error instanceof AuthoritySourceClosureUnprovedError);
    assert.equal(existsSync(snapshotFile), true);
    for (const directory of issued) if (directory !== created[0]) assert.equal(existsSync(directory), false);
    assert.equal(readFileSync(paths.controlPath).equals(paths.controlBytes), true);
    assert.equal(readFileSync(paths.databasePath).equals(paths.database), true);
  } catch (error) { primary = { error }; held.primary = primary; }
  let cleanup: { error: unknown } | undefined;
  try {
    const target = held.snapshot;
    if (target?.injected === true) {
      const identity = nativeFs.lstatSync(target.path);
      assert.ok(identity.isFile() && !identity.isSymbolicLink());
      assert.deepEqual({ device: identity.dev, inode: identity.ino, uid: identity.uid, links: identity.nlink }, { device: target.device, inode: target.inode, uid: target.uid, links: 1 });
      assert.equal(readSnapshotFlags(target.path), target.originalFlags | 2);
      execFileSync("/usr/bin/chflags", ['nouchg', target.path]);
      const restored = nativeFs.lstatSync(target.path);
      assert.deepEqual({ device: restored.dev, inode: restored.ino, uid: restored.uid, links: restored.nlink }, { device: target.device, inode: target.inode, uid: target.uid, links: 1 });
      assert.equal(readSnapshotFlags(target.path), target.originalFlags);
      assert.ok(held.restore && held.processLockRoot);
      held.restore.assertHeld();
    }
  } catch (error) { cleanup = { error }; held.cleanup = cleanup; }
  if (primary !== undefined && cleanup !== undefined) throw new AggregateError([primary.error, cleanup.error], 'Duo snapshot flag restoration failed after primary', { cause: primary.error });
  if (primary !== undefined) throw primary.error;
  if (cleanup !== undefined) throw cleanup.error;
});


it('keeps erased managed material revoked after a distinct valid enrollment', async () => {
  const f = await setup();
  const retained: { fixture: typeof f; error?: unknown } = { fixture: f };
  retainedPublicationRecoveryOwners.add(retained);
  try {
    f.store.enroll(f.input); f.store.confirm(f.input.credentialId, f.input.scope);
    const anchoredKeyPath = join(f.machine.stateRoot, "machine", "credential-keys", `${f.admission.profileBinding.profileId}.json`);
    const anchoredKeyBefore = readFileSync(anchoredKeyPath);
    const earlierPurpose = issueDuoCredentialPurpose(f.admission, f.machine);
    const backedUp = f.store.backup();
    const backupDirectory = join(f.machine.stateRoot, "machine", "duo-purpose-backups", f.admission.profileBinding.profileId);
    const backupPath = join(backupDirectory, `${backedUp.revision}.json`);
    const erased = f.store.erase();
    const replacementKey = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const replacement = { ...f.input, credentialId: Buffer.from(randomUUID()).toString("base64url"),
      privateKeyPkcs8: replacementKey.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
      publicKeySpki: replacementKey.publicKey.export({ type: "spki", format: "der" }).toString("base64") };
    assert.notEqual(replacement.credentialId, f.input.credentialId);
    assert.equal(f.store.enroll(replacement).revision > erased.revision, true);
    f.store.confirm(replacement.credentialId, replacement.scope);
    assert.equal(readFileSync(anchoredKeyPath).equals(anchoredKeyBefore), true);
    const reserved = f.store.reserve(replacement.credentialId);
    const freshPurpose = issueDuoCredentialPurpose(f.admission, f.machine);
    const current = f.store.read();
    assert.equal(current.state, 'registered');
    const opened = openDuoCredentialDocument(freshPurpose, readFileSync(f.documentPath), current.revision);
    assert.equal(opened.credentials.length, 1);
    assert.equal(opened.credentials.some(row => row.credentialId === replacement.credentialId && row.privateKeyPkcs8 === replacement.privateKeyPkcs8), true);
    assert.throws(() => openDuoCredentialDocument(freshPurpose, readFileSync(backupPath), backedUp.revision), /duo-erased-key-material-refused/u);
    assert.throws(() => openDuoCredentialDocument(earlierPurpose, readFileSync(backupPath), backedUp.revision), /duo-erased-key-material-refused/u);
    assert.throws(() => f.store.restore(backupPath), /duo-purpose-restore-revives-erased-key/u);
    const newBackup = f.store.backup();
    const newBackupPath = join(backupDirectory, `${newBackup.revision}.json`);
    const sameEnrollment = openDuoCredentialDocument(freshPurpose, readFileSync(newBackupPath), newBackup.revision);
    assert.equal(sameEnrollment.credentials.some(row => row.credentialId === replacement.credentialId), true);
    assert.equal(f.store.restore(newBackupPath).revision > newBackup.revision, true);
    assert.equal(f.store.reserve(replacement.credentialId).count, reserved.count + 1);
    const currentBytes = readFileSync(f.documentPath), changedBytes = Buffer.from(currentBytes);
    changedBytes[changedBytes.length - 1] = changedBytes[changedBytes.length - 1] === 0 ? 1 : 0;
    writeFileSync(f.documentPath, changedBytes);
    assert.throws(() => openDuoCredentialDocument(freshPurpose, readFileSync(newBackupPath), newBackup.revision), (error: unknown) => {
      if (error instanceof AuthoritySourceClosureUnprovedError) throw error;
      return error instanceof Error && error.message === "duo-document-custody-changed";
    });
    writeFileSync(f.documentPath, currentBytes);
    assert.equal(openDuoCredentialDocument(freshPurpose, readFileSync(newBackupPath), newBackup.revision).credentials.some(row => row.credentialId === replacement.credentialId), true);
    assert.throws(() => openDuoCredentialDocument(issueDuoCredentialPurpose(f.admission, f.machine), readFileSync(backupPath), backedUp.revision), /duo-erased-key-material-refused/u);
  } catch (error) { retained.error = error; throw error; }
  try { await f.close(); }
  catch (error) { retained.error = error; throw error; }
  retainedPublicationRecoveryOwners.delete(retained);
});

const retainedInventoryCloseFailures = new Set<object>();
for (const readOwner of ['scan', 'parse'] as const) it(`retains the actual stopped inventory ${readOwner} descriptor and purpose on failed native close`, async () => {
  const f = await stoppedControlFixture(retainedCredential);
  const held: { fixture: typeof f; descriptor?: number; path?: string; identity?: object; closeFailure?: Error; primary?: unknown; competing?: RuntimeAdmission;
    inventory?: ReturnType<typeof composeStoppedControlCredentialInventory>; claim?: ReturnType<typeof f.upgrade.profileInventory>; hooks?: Array<{ mockRestore(): void }> } = { fixture: f };
  retainedInventoryCloseFailures.add(held);
  const path = join(f.stateRoot, 'credentials', 'duo-webauthn.json');
  held.path = path;
  let bytes: Buffer | undefined;
  const realClose = nativeFs.closeSync, realStat = nativeFs.fstatSync, realRemove = nativeFs.rmSync;
  const closeFailure = new Error('inventory-native-close-refused');
  held.closeFailure = closeFailure;
  let matchingCloses = 0, refusedCloses = 0, destructiveCleanup = 0, observed: unknown, primary: { error: unknown } | undefined;
  const restoreFailures: unknown[] = [];
  const hooks: Array<{ mockRestore(): void }> = [];
  held.hooks = hooks;
  try {
    const identity = nativeFs.statSync(path);
    held.identity = identity;
    bytes = readFileSync(path);
    const claim = f.upgrade.profileInventory(f.profileId);
    held.claim = claim;
    const removeSpy = vi.spyOn(nativeFs, 'rmSync').mockImplementation((target, options) => {
      if (target === path || target === f.workspace) destructiveCleanup += 1;
      realRemove(target, options);
    });
    hooks.push(removeSpy);
    const closeSpy = vi.spyOn(nativeFs, 'closeSync').mockImplementation(descriptor => {
      const opened = realStat(descriptor);
      if (opened.dev === identity.dev && opened.ino === identity.ino) {
        matchingCloses += 1;
        if (matchingCloses === (readOwner === 'scan' ? 1 : 2)) {
          held.descriptor = descriptor; refusedCloses += 1;
          throw closeFailure;
        }
      }
      realClose(descriptor);
    });
    hooks.push(closeSpy);
    syncBuiltinESMExports();
    try { held.inventory = composeStoppedControlCredentialInventory({ claim, hostFacts: { primaryDisplay: null }, clock: manualClock(new Date()) }); }
    catch (error) { observed = error; held.primary = error; }
    assert.ok(observed instanceof AuthoritySourceClosureUnprovedError);
    assert.equal(observed.cause, observed.errors[0]);
    const descriptorFailure: unknown = observed.errors[0];
    assert.ok(descriptorFailure instanceof AuthoritySourceClosureUnprovedError);
    assert.deepEqual(descriptorFailure.errors, [closeFailure]);
    assert.equal(descriptorFailure.cause, closeFailure);
    assert.equal(refusedCloses, 1);
    assert.equal(matchingCloses, readOwner === 'scan' ? 1 : 2);
    assert.notEqual(held.descriptor, undefined);
    if (held.descriptor === undefined) throw new Error('inventory-descriptor-unobserved');
    assert.equal(realStat(held.descriptor).dev, identity.dev);
    assert.equal(realStat(held.descriptor).ino, identity.ino);
    f.restore.assertHeld();
    assert.equal(f.upgrade.registeredProfileIds().includes(f.profileId), true);
    assert.throws(() => { held.competing = RuntimeAdmission.acquireMachine(f.workspace, 'exclusive', f.lifetime); });
    assert.equal(held.competing, undefined);
    assert.equal(nativeFs.existsSync(f.workspace), true);
    assert.equal(destructiveCleanup, 0);
  } catch (error) { primary = { error }; held.primary ??= error; }
  for (const hook of hooks) {
    try { hook.mockRestore(); } catch (error) { restoreFailures.push(error); }
  }
  try { syncBuiltinESMExports(); } catch (error) { restoreFailures.push(error); }
  if (primary !== undefined && observed !== undefined && primary.error !== observed) {
    primary = { error: new AggregateError([observed, primary.error], 'inventory-close-assertion-failed', { cause: observed }) };
  }
  if (restoreFailures.length > 0) {
    const cause = primary?.error ?? observed;
    throw new AggregateError(cause === undefined ? restoreFailures : [cause, ...restoreFailures], 'inventory-hook-restoration-failed', { cause: cause ?? restoreFailures[0] });
  }
  if (primary !== undefined) throw primary.error;
  if (bytes === undefined) throw new Error('inventory-source-bytes-unobserved');
  assert.equal(readFileSync(path).equals(bytes), true);
});
