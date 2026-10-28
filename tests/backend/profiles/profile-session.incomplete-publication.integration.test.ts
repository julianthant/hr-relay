import { ProfileVerifierDocumentSchema } from "../../../src/models/profiles/profile.js";
import { DatabaseSync } from "node:sqlite";
import { ConfigSnapshotRecordSchema } from "../../../src/models/config/snapshot.js";
import { initialSettingsFileRecord } from "../../../src/models/config/settings.js";
import { RunRecordSchema } from "../../../src/models/run/record.js";
import { DeletedRunRecordSchema } from "../../../src/models/run/deleted-run.js";
import { resolveConfigWithProvenance } from "../../../src/backend/app/config/resolve.js";
import { runRecordColumns } from "../../../src/backend/storage/sqlite/run-record-row.js";
import { commandFromRow, insertNativeCommand, settleNativeCommand } from "../../../src/backend/storage/sqlite/command-record-row.js";
import { createSettingsActivationRepositories } from "../../../src/backend/storage/sqlite/settings-activation.js";
import { nativeOrdinaryRecordFromRow } from "../../../src/backend/storage/sqlite/native-record-row.js";
import { inspectNativeAuthority } from "../../../src/backend/storage/sqlite/authority-database.js";
import { CanonicalDeleteRequestSchema } from "../../../src/backend/storage/sqlite/run-store-contracts.js";
import { RunLifecycleCommandRecordSchema, RunLifecycleCommandAuditRecordSchema } from "../../../src/rules/commands/commands.js";
import { sha256Hex } from "../../../src/rules/validation/sha256.js";
import { WriteIntentRecordSchema, WriteAttemptRecordSchema, deriveWriteAuthorityReason } from "../../../src/rules/write-safety/write-safety.js";
import { NOW as HISTORICAL_AT } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { capturedInstantClock } from "../../../src/rules/time/clock.js";
import { ledgerCommitFixture } from "../../support/fixtures/ledger-projection-fixtures.js";
import { separationsDescriptor } from "../../support/helpers/registered-workflows.js";
import assert from "node:assert/strict";
import nativeFs, { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { it, vi } from "vitest";
import { acquireEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { RuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import { AuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import { composeProfileRuntime } from "../../../src/backend/app/composition/storage-compose.js";
import { SignUpOperationSchema } from "../../../src/models/profiles/profile.js";
import { canonicalJsonStringify } from "../../../src/rules/validation/canonical-json.js";
import { systemClock } from "../../../src/rules/time/clock.js";
import { createHistoricalIncompleteProfileFixture, historicalIncompleteProfileFields } from "../../support/fixtures/storage/historical-incomplete-profile-fixture.js";

async function historicalPrematureFixture() {
  const fixture = await createHistoricalIncompleteProfileFixture();
  return { ...fixture, root: fixture.workspace, fields: historicalIncompleteProfileFields,
    keyBytes: readFileSync(fixture.keyPath), protectedBytes: readFileSync(fixture.protectedPath), databaseBytes: readFileSync(fixture.databasePath) };
}

it("withdraws only the historical incomplete publication into a same-key private draft and removes it at startup", async () => {
  const f = await historicalPrematureFixture(), machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.root);
  const readonly = machine.forStoppedIncompleteProfileInventory(f.profileId);
  const inventory = AuthorityDatabase.readIncompleteOnboardingInventory(readonly);
  assert.equal(inventory.empty, true);
  for (const name of ["deleted_runs", "write_attempts", "write_intents", "commands", "run_receipts", "run_checkpoints", "artifacts"] as const) assert.equal(inventory.counts.find(row => row.table === name)?.count, 0);
  assert.equal(inventory.artifactReferenceCount, 0);
  assert.throws(() => readonly.assertWritable()); assert.throws(() => readonly.assertProfileRuntime()); assert.throws(() => readonly.assertCredentialRead()); readonly.release();
  await machine.reclassifyIncompleteProfileAsDraft(f.profileId);
  assert.equal(machine.readProfileRegistry().profiles.length, 0); assert.equal(machine.readProfileRegistry().activeProfileId, null);
  assert.equal(ProfileVerifierDocumentSchema.parse(JSON.parse(readFileSync(f.verifierPath, "utf8"))).profiles.length, 0);
  assert.equal(readFileSync(f.keyPath).equals(f.keyBytes), true); assert.equal(readFileSync(f.databasePath).equals(f.databaseBytes), true); assert.equal(readFileSync(f.protectedPath).equals(f.protectedBytes), true);
  const operation = SignUpOperationSchema.parse(JSON.parse(readFileSync(f.operationPath, "utf8")));
  assert.equal(operation.operationId, f.operation.operationId); assert.equal(operation.commandId, f.operation.commandId); assert.equal(operation.writeId, f.operation.writeId);
  assert.equal(operation.onboarding?.duo.state, "never-initialized"); assert.equal(operation.onboarding?.finish, undefined);
  machine.release();
  const resumedMachine = acquireEntrypointAdmission(f.root, "exclusive"), profile = composeProfileRuntime({ admission: resumedMachine,
     hostFacts: { primaryDisplay: null }, clock: systemClock });
  await profile.session.recoverOnboarding();
  assert.equal(existsSync(f.profileRoot), false);
  assert.equal(existsSync(f.operationPath), false);
  const fresh = profile.session.signUp({ ...f.fields, createdAt: new Date().toISOString() });
  assert.equal(fresh.state, "onboarding"); if (fresh.state !== "onboarding") throw new Error("fixture fresh draft required");
  assert.notEqual(fresh.operationId, operation.operationId); assert.notEqual(fresh.profileId, f.profileId);
  assert.equal(resumedMachine.readProfileRegistry().profiles.length, 0);
  await profile.close(); resumedMachine.release(); await f.close();
});

for (const boundary of ["intent", "operation", "verifier", "registry", "continuity", "unlink"] as const) {
  it(`recovers exact historical withdrawal across ${boundary} without replacing the database or key`, async () => {
    const f = await historicalPrematureFixture(), machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.root);
    const intentPath = join(f.root, ".tracker", "control", "profile-publication.json"), rename = nativeFs.renameSync, unlink = nativeFs.unlinkSync;
    let fired = false;
    const renameSpy = vi.spyOn(nativeFs, "renameSync").mockImplementation((source, destination) => {
      rename(source, destination);
      const target = String(destination), intent = existsSync(intentPath) ? JSON.parse(readFileSync(intentPath, "utf8")) as { kind: string } : undefined;
      const expected = boundary === "intent" ? intentPath : boundary === "operation" ? f.operationPath : boundary === "verifier" ? f.verifierPath : boundary === "registry" ? f.registryPath : f.controlPath;
      if (!fired && boundary !== "unlink" && target === expected && intent?.kind === "incomplete-profile-draft") { fired = true; throw new Error("fixture withdrawal boundary"); }
    });
    const unlinkSpy = vi.spyOn(nativeFs, "unlinkSync").mockImplementation(path => {
      if (!fired && boundary === "unlink" && String(path) === intentPath) { fired = true; throw new Error("fixture withdrawal unlink"); }
      unlink(path);
    });
    syncBuiltinESMExports();
    try { await assert.rejects(machine.reclassifyIncompleteProfileAsDraft(f.profileId)); }
    finally { renameSpy.mockRestore(); unlinkSpy.mockRestore(); syncBuiltinESMExports(); }
    assert.equal(fired, true); machine.release();
    const recovered = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.root);
    assert.equal(recovered.readProfileRegistry().profiles.length, 0); assert.equal(ProfileVerifierDocumentSchema.parse(JSON.parse(readFileSync(f.verifierPath, "utf8"))).profiles.length, 0);
    assert.equal(SignUpOperationSchema.parse(JSON.parse(readFileSync(f.operationPath, "utf8"))).profileId, f.profileId);
    assert.equal(readFileSync(f.keyPath).equals(f.keyBytes), true); assert.equal(readFileSync(f.databasePath).equals(f.databaseBytes), true); assert.equal(readFileSync(f.protectedPath).equals(f.protectedBytes), true);
    assert.equal(existsSync(intentPath), false); recovered.release(); await f.close();
  });
}

it("refuses an unowned credential copy before historical publication changes", async () => {
  const f = await historicalPrematureFixture(), scratch = join(f.profileRoot, "scratch"); mkdirSync(scratch, { mode: 0o700 });
  copyFileSync(f.protectedPath, join(scratch, "foreign-protected-copy.json"));
  const registry = readFileSync(f.registryPath), verifiers = readFileSync(f.verifierPath), machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.root);
  await assert.rejects(machine.reclassifyIncompleteProfileAsDraft(f.profileId), /profile-incomplete-copy-membership-unproved/u);
  assert.equal(readFileSync(f.registryPath).equals(registry), true); assert.equal(readFileSync(f.verifierPath).equals(verifiers), true);
  assert.equal(readFileSync(f.keyPath).equals(f.keyBytes), true); assert.equal(existsSync(f.operationPath), false);
  machine.release(); await f.close();
});

it("refuses a foreign physical database binding without withdrawing publication", async () => {
  const f = await historicalPrematureFixture(), foreign = await historicalPrematureFixture();
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    const source = foreign.databasePath + suffix, target = f.databasePath + suffix;
    if (existsSync(source)) copyFileSync(source, target);
    else if (existsSync(target)) unlinkSync(target);
  }
  const registry = readFileSync(f.registryPath), verifiers = readFileSync(f.verifierPath), database = readFileSync(f.databasePath);
  const machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.root);
  await assert.rejects(machine.reclassifyIncompleteProfileAsDraft(f.profileId), /profile-database-binding-mismatch/u);
  assert.equal(readFileSync(f.registryPath).equals(registry), true); assert.equal(readFileSync(f.verifierPath).equals(verifiers), true);
  assert.equal(readFileSync(f.databasePath).equals(database), true); assert.equal(readFileSync(f.keyPath).equals(f.keyBytes), true);
  assert.equal(existsSync(f.operationPath), false);
  machine.release(); await f.close(); await foreign.close();
});

it("holds a tampered withdrawal intent and recovers only its exact sealed original", async () => {
  const f = await historicalPrematureFixture(), machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.root);
  const intentPath = join(f.root, ".tracker", "control", "profile-publication.json"), registry = readFileSync(f.registryPath), verifiers = readFileSync(f.verifierPath);
  const rename = nativeFs.renameSync; let fired = false;
  const fault = vi.spyOn(nativeFs, "renameSync").mockImplementation((source, destination) => {
    rename(source, destination);
    if (!fired && String(destination) === intentPath && (JSON.parse(readFileSync(intentPath, "utf8")) as { kind: string }).kind === "incomplete-profile-draft") {
      fired = true; throw new Error("fixture sealed withdrawal intent");
    }
  });
  syncBuiltinESMExports();
  try { await assert.rejects(machine.reclassifyIncompleteProfileAsDraft(f.profileId)); }
  finally { fault.mockRestore(); syncBuiltinESMExports(); }
  assert.equal(fired, true);
  const original = readFileSync(intentPath), changed = JSON.parse(original.toString("utf8")) as { capture: { operation: { profileId: string } } };
  changed.capture.operation.profileId = randomUUID(); writeFileSync(intentPath, JSON.stringify(changed), { mode: 0o600 });
  assert.throws(() => machine.readProfileRegistry(), /profile-incomplete-reclassification-invalid/u);
  assert.equal(readFileSync(f.registryPath).equals(registry), true); assert.equal(readFileSync(f.verifierPath).equals(verifiers), true);
  assert.equal(readFileSync(f.databasePath).equals(f.databaseBytes), true); assert.equal(readFileSync(f.keyPath).equals(f.keyBytes), true);
  writeFileSync(intentPath, original, { mode: 0o600 });
  assert.equal(machine.readProfileRegistry().profiles.length, 0); assert.equal(existsSync(intentPath), false);
  machine.release(); await f.close();
});

function seedClosedHistoricalActivity(f: Awaited<ReturnType<typeof historicalPrematureFixture>>, kind: "deleted" | "unknown") {
  const raw = new DatabaseSync(f.databasePath), at = HISTORICAL_AT;
  try {
    raw.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
    const resolved = resolveConfigWithProvenance(initialSettingsFileRecord().settings, { primaryDisplay: null }, capturedInstantClock(at),
      { stateRoot: f.profileRoot, artifactRoot: join(f.profileRoot, "artifacts") });
    const snapshot = ConfigSnapshotRecordSchema.parse({ configSnapshotId: randomUUID(), revision: 1, fingerprint: resolved.fingerprint,
      capturedAt: at, capturedBy: "local-operator", config: resolved.config, provenance: resolved.provenance });
    createSettingsActivationRepositories({ database: raw,
      mutate: work => work().result,
      readRecord(table, key, schema) {
        const row = raw.prepare(`SELECT * FROM ${table} WHERE id=?`).get(key);
        return row === undefined ? undefined : schema.parse(table === "commands" ? commandFromRow(row) : nativeOrdinaryRecordFromRow(table, row));
      },
    }).runtimeConfig.initialize(snapshot);
    const runId = randomUUID(), itemId = randomUUID(), traceId = `se-120000-${String(1000 + (kind === "deleted" ? 1 : 2))}`;
    const fixture = ledgerCommitFixture(kind === "deleted" ? 71 : 72, { runId, itemId, traceId, workflowId: separationsDescriptor.id,
      configFingerprint: snapshot.fingerprint, instance: "test" });
    const reason = deriveWriteAuthorityReason("post-click-verifier-unknown", "probe", "synthetic historical unknown observation");
    const intent = WriteIntentRecordSchema.parse({ ...fixture.intent, version: 2, status: "parked", parkedCode: "unknown", message: "Historical outcome remains unknown", authorityReason: reason });
    const run = RunRecordSchema.parse({ envelope: { workflow: separationsDescriptor.id, runId, itemId, traceId,
      descriptorVersion: separationsDescriptor.version, contractFingerprint: separationsDescriptor.contractFingerprint,
      resolvedInstance: { ucpath: "test" }, configFingerprint: snapshot.fingerprint, configSnapshotId: snapshot.configSnapshotId,
      shape: "single", priority: "interactive", dryRun: false, attempt: 1, enqueuedAt: at },
      input: { raw: {}, parsed: { schemaHash: sha256Hex("historical fixture input"), value: {}, protectedBindings: [] }, ingressSchemaHash: sha256Hex("historical fixture input") },
      lifecycle: kind === "deleted" ? { state: "terminal", outcome: "interrupted", endedAt: at }
        : { state: "parked-write", writeIntentId: intent.writeIntentId, intentGeneration: intent.generation, parkedAt: at, code: "unknown", message: "Historical outcome remains unknown" },
      claimGeneration: 1, version: 5, createdAt: at, updatedAt: at });
    const columns = runRecordColumns(run), keys = Object.keys(columns);
    raw.prepare(`INSERT INTO runs (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...Object.values(columns));
    if (kind === "unknown") {
      const attempt = WriteAttemptRecordSchema.parse({ ...fixture.attempt, outcome: { state: "parked", code: "unknown", message: "Historical outcome remains unknown", authorityReason: reason } });
      raw.prepare("INSERT INTO write_intents (id,system,idempotency_key,idempotency_key_digest,status,generation,run_id,payload_json,publication_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,NULL,?,?)")
        .run(intent.writeIntentId, intent.system, intent.idempotencyKey, intent.idempotencyKeyDigest, intent.status, intent.generation, runId,
          canonicalJsonStringify(intent), intent.createdAt, intent.updatedAt);
      raw.prepare("INSERT INTO write_attempts (id,intent_id,generation,run_id,payload_json,created_at) VALUES (?,?,?,?,?,?)")
        .run(attempt.writeAttemptId, attempt.writeIntentId, attempt.generation, attempt.runId, canonicalJsonStringify(attempt), attempt.recordedAt);
    } else {
      const request = CanonicalDeleteRequestSchema.parse({ commandId: randomUUID(), runId, expectedVersion: run.version });
      const command = RunLifecycleCommandRecordSchema.parse({ kind: "run-lifecycle", commandId: request.commandId, operation: "delete",
        requestFingerprint: sha256Hex(`hrauto:run-lifecycle-command:v1\0delete\0${canonicalJsonStringify(request)}`), request,
        fence: { kind: "version", expectedVersion: run.version }, recordedAt: at });
      insertNativeCommand(raw, command);
      const receipt = DeletedRunRecordSchema.parse({ runId, workflow: run.envelope.workflow, traceId, itemId, attempt: 1, runNumber: null,
        ordinalSource: "tombstone", origin: "queue", commandId: command.commandId, deletedAt: at, tallyVersion: 3, removed: [{ table: "runs", rows: 1 }] });
      raw.prepare("INSERT INTO deleted_runs (run_id,workflow,item_id,attempt,run_number,trace_id,command_id,deleted_at,cleanup_state,receipt_json,files_json) VALUES (?,?,?,?,NULL,?,?,?,'complete',?,'[]')")
        .run(runId, receipt.workflow, itemId, 1, traceId, command.commandId, at, canonicalJsonStringify(receipt));
      raw.prepare("DELETE FROM runs WHERE id=?").run(runId);
      const audit = RunLifecycleCommandAuditRecordSchema.parse({ kind: "run-lifecycle", auditId: randomUUID(), request: command,
        result: { kind: "deletion", runIds: [runId] }, completedAt: at });
      settleNativeCommand(raw, audit);
      raw.prepare("INSERT INTO command_audits (id,command_id,code,payload_json,created_at) VALUES (?,?,NULL,?,?)")
        .run(audit.auditId, command.commandId, canonicalJsonStringify(audit), at);
    }
    raw.prepare("UPDATE database_states SET authority_generation=authority_generation+1,search_generation=NULL,search_state='invalid',updated_at=? WHERE id=1").run(at);
    raw.exec("COMMIT");
    inspectNativeAuthority(raw);
    raw.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally { raw.close(); }
}

for (const history of ["deleted", "unknown"] as const) {
  it(`refuses valid same-profile ${history} historical activity before withdrawal without retrying a write`, async () => {
    const f = await historicalPrematureFixture(); seedClosedHistoricalActivity(f, history);
    const registry = readFileSync(f.registryPath), verifiers = readFileSync(f.verifierPath), database = readFileSync(f.databasePath);
    const machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.root), readonly = machine.forStoppedIncompleteProfileInventory(f.profileId);
    const inventory = AuthorityDatabase.readIncompleteOnboardingInventory(readonly); assert.equal(inventory.empty, false);
    if (history === "deleted") { assert.equal(inventory.counts.find(row => row.table === "runs")?.count, 0); assert.equal(inventory.counts.find(row => row.table === "deleted_runs")?.count, 1); }
    else { assert.equal(inventory.counts.find(row => row.table === "write_attempts")?.count, 1); assert.equal(inventory.counts.find(row => row.table === "write_intents")?.count, 1); }
    readonly.release();
    await assert.rejects(machine.reclassifyIncompleteProfileAsDraft(f.profileId), /profile-incomplete-activity-present/u);
    assert.equal(readFileSync(f.registryPath).equals(registry), true); assert.equal(readFileSync(f.verifierPath).equals(verifiers), true);
    assert.equal(readFileSync(f.databasePath).equals(database), true); assert.equal(readFileSync(f.keyPath).equals(f.keyBytes), true);
    assert.equal(readFileSync(f.protectedPath).equals(f.protectedBytes), true); assert.equal(existsSync(f.operationPath), false);
    machine.release(); await f.close();
  });
}

for (const history of ["deleted", "unknown"] as const) {
  it(`refuses device recertification of valid ${history} historical activity without changing its witnesses`, async () => {
    const f = await historicalPrematureFixture();
    try {
      seedClosedHistoricalActivity(f, history);
      const prior = JSON.parse(readFileSync(f.controlPath, "utf8")) as { device: number; erasures: { credentialKey: { file: { device: number } } }[] };
      const key = prior.erasures[0]?.credentialKey; assert.ok(key); prior.device += 4; key.file.device += 4;
      writeFileSync(f.controlPath, JSON.stringify(prior));
      const control = readFileSync(f.controlPath), database = readFileSync(f.databasePath), credentials = readFileSync(f.protectedPath);
      await assert.rejects(RuntimeAdmission.prepareStoppedDeviceContinuityRecertification(f.root), /profile-incomplete-activity-present/);
      assert.equal(readFileSync(f.controlPath).equals(control), true); assert.equal(readFileSync(f.databasePath).equals(database), true);
      assert.equal(readFileSync(f.protectedPath).equals(credentials), true); assert.equal(existsSync(join(f.root, ".tracker/control/device-recertification.json")), false);
    } finally { await f.close(); }
  });
}
