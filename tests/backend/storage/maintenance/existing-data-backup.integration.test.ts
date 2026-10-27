import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import nativeFs, { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { it, vi } from "vitest";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { composeProfileRuntime } from "../../../../src/backend/app/composition/storage-compose.js";
import { consumeAuthenticatedProfileOwnerClaim } from "../../../../src/backend/profiles/profile-session.js";
import { captureExistingDataOwner, verifyExistingDataOwner } from "../../../../src/backend/storage/configuration/credential-store.js";
import { assertNoRetainedOwnerClaimBackup, backupExistingData, verifyExistingDataBackup } from "../../../../src/backend/storage/maintenance/existing-data-backup.js";
import { readyProfileOnboarding, syntheticOnboardingDuo } from "../../../support/helpers/admission-fixture.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { capturedInstantClock } from "../../../../src/rules/time/clock.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { initialSettingsFileRecord } from "../../../../src/models/config/settings.js";
import { ConfigSnapshotRecordSchema } from "../../../../src/models/config/snapshot.js";
import { SettingsInitializationAuditSchema, SettingsInitializationCommandSchema } from "../../../../src/models/config/settings-initialization.js";
import { writeAppSettings } from "../../../../src/backend/storage/sqlite/settings-storage.js";
import { insertNativeCommand, settleNativeCommand } from "../../../../src/backend/storage/sqlite/command-record-row.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { runRecordColumns } from "../../../../src/backend/storage/sqlite/run-record-row.js";
import { inspectNativeAuthority } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { QUEUED_RUN } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { ledgerCommitFixture } from "../../../support/fixtures/ledger-projection-fixtures.js";
import { separationsDescriptor } from "../../../support/helpers/registered-workflows.js";
import { WriteAttemptRecordSchema, WriteIntentRecordSchema, deriveWriteAuthorityReason } from "../../../../src/rules/write-safety/write-safety.js";
import { createHistoricalIncompleteProfileFixture, historicalIncompleteProfileFields } from "../../../support/fixtures/storage/historical-incomplete-profile-fixture.js";

function retainedHistoricalData(f: Awaited<ReturnType<typeof createHistoricalIncompleteProfileFixture>>, unknownWrite = false) {
  const raw = new DatabaseSync(f.databasePath), at = "2026-10-01T12:00:00.000Z";
  try {
    raw.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
    const resolved = resolveConfigWithProvenance(initialSettingsFileRecord().settings, { primaryDisplay: null }, capturedInstantClock(at),
      { stateRoot: f.profileRoot, artifactRoot: join(f.profileRoot, "artifacts") });
    const snapshot = ConfigSnapshotRecordSchema.parse({ configSnapshotId: randomUUID(), revision: 1, fingerprint: resolved.fingerprint,
      capturedAt: at, capturedBy: "local-operator", config: resolved.config, provenance: resolved.provenance });
    raw.prepare("INSERT INTO settings_snapshots (id,revision,fingerprint,payload_json,captured_at) VALUES (?,?,?,?,?)")
      .run(snapshot.configSnapshotId, snapshot.revision, snapshot.fingerprint, canonicalJsonStringify(snapshot), snapshot.capturedAt);
    const command = SettingsInitializationCommandSchema.parse({ kind: "settings-initialization", commandId: randomUUID(), revision: 1,
      settings: initialSettingsFileRecord(), configSnapshotId: snapshot.configSnapshotId, configFingerprint: snapshot.fingerprint, initializedAt: at });
    const audit = SettingsInitializationAuditSchema.parse({ kind: "settings-initialization", auditId: randomUUID(), request: command,
      result: { state: "initialized", revision: 1, snapshotId: snapshot.configSnapshotId, fingerprint: snapshot.fingerprint }, completedAt: at });
    insertNativeCommand(raw, command); settleNativeCommand(raw, audit);
    raw.prepare("INSERT INTO command_audits(id,command_id,code,payload_json,created_at) VALUES (?,?,NULL,?,?)")
      .run(audit.auditId, command.commandId, canonicalJsonStringify(audit), at);
    writeAppSettings(raw, { format: 1, saved: null, active: null, initialization: { commandId: command.commandId, auditId: audit.auditId,
      configSnapshotId: snapshot.configSnapshotId, configFingerprint: snapshot.fingerprint, initializedAt: command.initializedAt, settings: command.settings } });
    const runId = randomUUID();
    const ledger = ledgerCommitFixture(81, { runId, itemId: QUEUED_RUN.envelope.itemId, traceId: QUEUED_RUN.envelope.traceId,
      workflowId: separationsDescriptor.id, configFingerprint: snapshot.fingerprint, instance: "prod" });
    const reason = deriveWriteAuthorityReason("post-click-verifier-unknown", "probe", "synthetic historical unknown observation");
    const intent = WriteIntentRecordSchema.parse({ ...ledger.intent, version: 2, status: "parked", parkedCode: "unknown", message: "Historical outcome remains unknown", authorityReason: reason });
    const run = RunRecordSchema.parse({ ...QUEUED_RUN, envelope: { ...QUEUED_RUN.envelope, runId,
      ...(unknownWrite ? { workflow: separationsDescriptor.id, descriptorVersion: separationsDescriptor.version, contractFingerprint: separationsDescriptor.contractFingerprint } : {}),
      configSnapshotId: snapshot.configSnapshotId, configFingerprint: snapshot.fingerprint },
      lifecycle: unknownWrite ? { state: "parked-write", writeIntentId: intent.writeIntentId, intentGeneration: intent.generation, parkedAt: at, code: "unknown", message: "Historical outcome remains unknown" }
        : { state: "terminal", outcome: "interrupted", endedAt: at }, version: 5, updatedAt: at });
    const columns = runRecordColumns(run), keys = Object.keys(columns);
    raw.prepare(`INSERT INTO runs (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...Object.values(columns));
    if (unknownWrite) {
      const attempt = WriteAttemptRecordSchema.parse({ ...ledger.attempt, outcome: { state: "parked", code: "unknown", message: "Historical outcome remains unknown", authorityReason: reason } });
      raw.prepare("INSERT INTO write_intents(id,system,idempotency_key,idempotency_key_digest,status,generation,run_id,payload_json,publication_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,NULL,?,?)")
        .run(intent.writeIntentId, intent.system, intent.idempotencyKey, intent.idempotencyKeyDigest, intent.status, intent.generation, runId, canonicalJsonStringify(intent), intent.createdAt, intent.updatedAt);
      raw.prepare("INSERT INTO write_attempts(id,intent_id,generation,run_id,payload_json,created_at) VALUES(?,?,?,?,?,?)")
        .run(attempt.writeAttemptId, attempt.writeIntentId, attempt.generation, runId, canonicalJsonStringify(attempt), attempt.recordedAt);
    }
    raw.prepare("UPDATE database_states SET authority_generation=authority_generation+1,search_generation=NULL,search_state='invalid',updated_at=? WHERE id=1").run(at);
    raw.exec("COMMIT"); inspectNativeAuthority(raw); raw.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally { raw.close(); }
  const reports = join(f.profileRoot, "files", "reports"); mkdirSync(reports, { recursive: true, mode: 0o700 });
  const artifact = join(reports, "retained-evidence.txt"); writeFileSync(artifact, "Historical recovery evidence", { mode: 0o600 });
  return artifact;
}

it("requires genuine existing credential ownership and rejects structural witnesses without changing source data", async () => {
  const f = await createHistoricalIncompleteProfileFixture();
  retainedHistoricalData(f);
  const machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace);
  const paths = [f.protectedPath, f.databasePath, f.registryPath, f.verifierPath, f.keyPath], before = paths.map(path => readFileSync(path));
  try {
    assert.throws(() => captureExistingDataOwner(machine, { ...historicalIncompleteProfileFields, password: "wrong-owner" }, f.profileId), /existing-data-owner-refused/u);
    assert.throws(() => captureExistingDataOwner(machine, { ...historicalIncompleteProfileFields, email: "another-owner@ucsd.edu" }, f.profileId), /existing-data-owner-refused/u);
    assert.throws(() => verifyExistingDataOwner({ profileId: f.profileId }, machine), /existing-data-owner-unissued/u);
    const owner = captureExistingDataOwner(machine, historicalIncompleteProfileFields, f.profileId);
    assert.equal(verifyExistingDataOwner(owner, machine).profileId, f.profileId);
    for (const [index, path] of paths.entries()) assert.deepEqual(readFileSync(path), before[index]);
  } finally { machine.release(); await f.close(); }
});

it("refuses valid UNKNOWN historical custody without submitting, retrying or altering its evidence", async () => {
  const f = await createHistoricalIncompleteProfileFixture(); retainedHistoricalData(f, true);
  const machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace);
  const paths = [f.databasePath, f.protectedPath, f.keyPath, f.registryPath, f.verifierPath], before = paths.map(path => readFileSync(path));
  try {
    const owner = captureExistingDataOwner(machine, historicalIncompleteProfileFields, f.profileId);
    await assert.rejects(machine.claimExistingProfileData(owner, randomUUID(), systemClock), /credential-maintenance-custody-unproved/u);
    for (const [index, path] of paths.entries()) assert.deepEqual(readFileSync(path), before[index]);
    assert.equal(existsSync(f.operationPath), false); assert.equal(existsSync(join(f.profileRoot, "backups")), false);
  } finally { machine.release(); await f.close(); }
});

it("backs up the exact database, profile and independent machine authority, reusing completed backups", async () => {
  const f = await createHistoricalIncompleteProfileFixture();
  const machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace);
  const owner = captureExistingDataOwner(machine, historicalIncompleteProfileFields, f.profileId);
  const admission = await machine.forStoppedExistingDataBackup(owner), claimId = randomUUID();
  const paths = [f.protectedPath, f.databasePath, f.registryPath, f.verifierPath, f.keyPath], before = paths.map(path => readFileSync(path));
  try {
    const backup = await backupExistingData(machine, admission, owner, claimId, systemClock);
    const verified = verifyExistingDataBackup(backup, owner, machine);
    assert.throws(() => assertNoRetainedOwnerClaimBackup(machine, f.profileId), /Log out cannot verify/u);
    assert.equal(verified.profileId, f.profileId);
    for (const name of ["machine/profile-pepper", `machine/credential-keys/${f.profileId}.json`, "machine/profiles.json", "machine/profile-verifiers.json", "profile/credentials/protected.json", "control/installation.json", "control/profile-registry.json"]) {
      assert.ok(verified.files.some(entry => entry.path === name), name);
    }
    const backupNames = readdirSync(join(f.profileRoot, "backups", "authority"));
    const replay = await backupExistingData(machine, admission, owner, claimId, systemClock);
    assert.deepEqual(replay, backup);
    assert.deepEqual(readdirSync(join(f.profileRoot, "backups", "authority")), backupNames);
    for (const [index, path] of paths.entries()) assert.deepEqual(readFileSync(path), before[index]);
    writeFileSync(join(f.workspace, ".tracker", "control", "profile-owner-claims", claimId, "files", "profile", "credentials", "protected.json"), "substituted");
    assert.throws(() => verifyExistingDataBackup(backup, owner, machine), /existing-data-backup-changed/u);
  } finally { admission.release(); machine.release(); await f.close(); }
});

it("revokes an owner witness when the authenticated source changes", async () => {
  const f = await createHistoricalIncompleteProfileFixture(), machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace);
  const owner = captureExistingDataOwner(machine, historicalIncompleteProfileFields, f.profileId);
  try {
    writeFileSync(f.protectedPath, "substituted");
    assert.throws(() => verifyExistingDataOwner(owner, machine), /existing-data-owner-source-changed/u);
  } finally { machine.release(); await f.close(); }
});

it("resumes interrupted backup copying while retaining completed copy identities and the verified SQLite backup", async () => {
  const f = await createHistoricalIncompleteProfileFixture(), machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace);
  const owner = captureExistingDataOwner(machine, historicalIncompleteProfileFields, f.profileId), admission = await machine.forStoppedExistingDataBackup(owner), claimId = randomUUID();
  const target = join(f.workspace, ".tracker", "control", "profile-owner-claims", claimId, "files", "profile", "credentials", "protected.json");
  const write = nativeFs.writeFileSync.bind(nativeFs); let fired = false;
  const spy = vi.spyOn(nativeFs, "writeFileSync").mockImplementation((path, data, options) => {
    write(path, data, options);
    if (!fired && path === target) { fired = true; throw new Error("fixture backup interruption"); }
  });
  syncBuiltinESMExports();
  try {
    try { await assert.rejects(backupExistingData(machine, admission, owner, claimId, systemClock), /fixture backup interruption/u); }
    finally { spy.mockRestore(); syncBuiltinESMExports(); }
    assert.equal(fired, true); const inode = nativeFs.statSync(target).ino;
    const before = readdirSync(join(f.profileRoot, "backups", "authority"));
    const backup = await backupExistingData(machine, admission, owner, claimId, systemClock);
    verifyExistingDataBackup(backup, owner, machine);
    assert.equal(nativeFs.statSync(target).ino, inode);
    assert.deepEqual(readdirSync(join(f.profileRoot, "backups", "authority")), before);
    assert.equal(existsSync(f.operationPath), false);
  } finally { admission.release(); machine.release(); await f.close(); }
});

it("claims only explicitly authenticated historical data, preserving source identity and resuming the same private operation", async () => {
  const f = await createHistoricalIncompleteProfileFixture();
  const artifact = retainedHistoricalData(f);
  const claimId = randomUUID(), request = { ...historicalIncompleteProfileFields, claimId, claimExistingData: true as const, createdAt: new Date().toISOString() };
  const shared = acquireEntrypointAdmission(f.workspace, "shared"), profile = composeProfileRuntime({ admission: shared,
    processLockRoot: f.processLockRoot, hostFacts: { primaryDisplay: null }, clock: systemClock });
  const paths = [f.protectedPath, f.databasePath, f.keyPath, artifact], before = paths.map(path => readFileSync(path));
  assert.deepEqual(profile.session.signIn({ ...historicalIncompleteProfileFields, at: request.createdAt }).state, "refused");
  assert.equal(profile.session.signUp(request).state, "refused");
  assert.equal(profile.session.claimExistingData({ ...request, password: "wrong-owner" }).state, "refused");
  const accepted = profile.session.claimExistingData(request);
  assert.equal(accepted.state, "refused"); assert.ok("upgrade" in accepted);
  await profile.close(); shared.release();
  const machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace);
  const authorization = consumeAuthenticatedProfileOwnerClaim(accepted.upgrade, machine);
  const operation = await machine.claimExistingProfileData(authorization.owner, authorization.claimId, systemClock);
  assert.equal(operation.profileId, f.profileId); assert.equal(operation.operationId, f.operation.operationId);
  assert.equal(operation.ownerClaim?.claimId, claimId);
  assert.equal(operation.onboarding?.finish, undefined);
  assert.equal(machine.readProfileRegistry().profiles.length, 0);
  for (const [index, path] of paths.entries()) assert.deepEqual(readFileSync(path), before[index]);
  assert.throws(() => consumeAuthenticatedProfileOwnerClaim(accepted.upgrade, machine), /PROFILE_OWNER_CLAIM_UNAVAILABLE|Ownership/u);
  machine.release();
  const resumed = acquireEntrypointAdmission(f.workspace, "shared"), resumedProfile = composeProfileRuntime({ admission: resumed,
    processLockRoot: f.processLockRoot, hostFacts: { primaryDisplay: null }, clock: systemClock,
    onboardingDuo: syntheticOnboardingDuo(() => historicalIncompleteProfileFields.email) });
  try {
    assert.equal(resumedProfile.session.signUp(request).state, "refused");
    const draft = resumedProfile.session.claimExistingData({ ...request, claimId: randomUUID() });
    assert.equal(draft.state, "onboarding");
    if (draft.state !== "onboarding") throw new Error("same private claim required");
    assert.equal(draft.operationId, operation.operationId); assert.equal(draft.profileId, f.profileId);
    await assert.rejects(resumedProfile.session.cancelOnboarding(draft.token, draft.operationId));
    assert.equal(resumed.readProfileRegistry().profiles.length, 0);
    await readyProfileOnboarding(resumedProfile.session, draft);
    const active = await resumedProfile.session.completeOnboarding(draft.token, draft.operationId);
    assert.equal(active.state, "active"); assert.equal(active.profileId, f.profileId);
    assert.ok(resumed.readProfileRegistry().profiles[0]?.registration.onboardingCompletion);
    for (const [index, path] of paths.entries()) assert.deepEqual(readFileSync(path), before[index]);
  } finally { await resumedProfile.close(); resumed.release(); await f.close(); }
});

for (const boundary of ["intent", "operation", "verifier", "registry", "continuity", "unlink"] as const) {
  it(`recovers an authenticated backed-up claim after ${boundary} without repeating completed effects`, async () => {
    const f = await createHistoricalIncompleteProfileFixture(), artifact = retainedHistoricalData(f);
    const machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace);
    const owner = captureExistingDataOwner(machine, historicalIncompleteProfileFields, f.profileId), claimId = randomUUID();
    const paths = [f.protectedPath, f.databasePath, f.keyPath, artifact], before = paths.map(path => readFileSync(path));
    const intentPath = join(f.workspace, ".tracker", "control", "profile-publication.json"), rename = nativeFs.renameSync.bind(nativeFs), unlink = nativeFs.unlinkSync.bind(nativeFs);
    let fired = false;
    const renameSpy = vi.spyOn(nativeFs, "renameSync").mockImplementation((source, destination) => {
      rename(source, destination);
      const target = String(destination), intent = existsSync(intentPath) ? JSON.parse(readFileSync(intentPath, "utf8")) as { kind: string } : undefined;
      const expected = boundary === "intent" ? intentPath : boundary === "operation" ? f.operationPath : boundary === "verifier" ? f.verifierPath : boundary === "registry" ? f.registryPath : f.controlPath;
      if (!fired && boundary !== "unlink" && target === expected && intent?.kind === "incomplete-profile-draft") { fired = true; throw new Error("fixture claim interruption"); }
    });
    const unlinkSpy = vi.spyOn(nativeFs, "unlinkSync").mockImplementation(path => {
      if (!fired && boundary === "unlink" && String(path) === intentPath) { fired = true; throw new Error("fixture claim interruption"); }
      unlink(path);
    });
    syncBuiltinESMExports();
    try { await assert.rejects(machine.claimExistingProfileData(owner, claimId, systemClock), /fixture claim interruption/u); }
    finally { renameSpy.mockRestore(); unlinkSpy.mockRestore(); syncBuiltinESMExports(); }
    assert.equal(fired, true); machine.release();
    const recovered = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace);
    try {
      assert.equal(recovered.readProfileRegistry().profiles.length, 0);
      const operation = JSON.parse(readFileSync(f.operationPath, "utf8")) as { ownerClaim: { claimId: string }; operationId: string };
      assert.equal(operation.ownerClaim.claimId, claimId); assert.equal(operation.operationId, f.operation.operationId);
      assert.equal(existsSync(intentPath), false);
      const settled = readFileSync(f.operationPath);
      recovered.readProfileRegistry(); assert.deepEqual(readFileSync(f.operationPath), settled);
      for (const [index, path] of paths.entries()) assert.deepEqual(readFileSync(path), before[index]);
      assert.equal(readdirSync(join(f.profileRoot, "backups", "authority")).filter(name => name.endsWith(".manifest.json")).length, 1);
    } finally { recovered.release(); await f.close(); }
  });
}
