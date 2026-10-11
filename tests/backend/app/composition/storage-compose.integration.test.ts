import assert_m0 from "node:assert/strict";
import { randomUUID as randomUUID_m0 } from "node:crypto";
import { mkdirSync as mkdirSync_m0,mkdtempSync as mkdtempSync_m0,readFileSync as readFileSync_m0,readdirSync as readdirSync_m0,realpathSync as realpathSync_m0,rmSync as rmSync_m0,writeFileSync as writeFileSync_m0 } from "node:fs";
import { tmpdir as tmpdir_m0 } from "node:os";
import { join as join_m0 } from "node:path";
import { afterEach as afterEach_m0,describe as describe_m0,it as it_m0,vi } from "vitest";
import { composeStorageCommand as composeStorageCommand_m0 } from "../../../../src/backend/app/composition/storage-compose.js";
import { resolveConfigWithProvenance as resolveConfigWithProvenance_m0 } from "../../../../src/backend/app/config/resolve.js";
import { rebuildRuntimeIsolation as rebuildRuntimeIsolation_m0 } from "../../../../src/backend/app/config/runtime-isolation.js";
import { executeSettingsCommand as executeSettingsCommand_m0,type CommandAuthority as CommandAuthority_m0 } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createSettingsApplicationExecutor as createSettingsApplicationExecutor_m0 } from "../../../../src/backend/runs/commands/settings-service.js";
import { createCredentialSecretSource as createCredentialSecretSource_m0 } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import type { RuntimeAdmission as RuntimeAdmission_m0 } from "../../../../src/backend/storage/admission/admission.js";
import { acquireEntrypointAdmission as acquireEntrypointAdmission_m0 } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { createCredentialStore as nativeCredentialStore_m0 } from "../../../../src/backend/storage/configuration/credential-store.js";
import { AuthorityDatabase as NativeAuthorityDatabase_m0 } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH as PROTECTED_SETTINGS_SCHEMA_HASH_m0 } from "../../../../src/models/config/protected-settings.js";
import { requireSecret as requireSecret_m0 } from "../../../../src/models/config/secrets.js";
import { SETTINGS_SCHEMA_HASH as SETTINGS_SCHEMA_HASH_m0,deriveSettingsPatchFingerprint as deriveSettingsPatchFingerprint_m0 } from "../../../../src/models/config/settings.js";
import { manualClock as manualClock_m0 } from "../../../../src/rules/time/clock.js";
import { AuthorityDatabase as AuthorityDatabase_m0,createCredentialStore as createCredentialStore_m0,type CredentialStoreHooks as CredentialStoreHooks_m0 } from "../../../support/helpers/synthetic-storage-admission.js";

import { randomUUID as randomUUID_m1 } from "node:crypto";
import { runQueuedSpanEvent as runQueuedSpanEvent_m1 } from "../../../../src/backend/runs/commands/run-queued-span.js";
import { RunRecordService as RunRecordService_m1,sweepWorkerClaims as sweepWorkerClaims_m1,workerRunLifecyclePort as workerRunLifecyclePort_m1 } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { executeSequencedWriteCommit as executeSequencedWriteCommit_m1 } from "../../../../src/backend/runtime/writes/write-sequencer.js";
import { createTimelineEmitter as createTimelineEmitter_m1 } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION as CURRENT_AUTHORITY_SCHEMA_VERSION_m1 } from "../../../../src/backend/storage/sqlite/migrations.js";
import { nativeOrdinaryRecordFromRow as nativeOrdinaryRecordFromRow_m1 } from "../../../../src/backend/storage/sqlite/native-record-row.js";
import { withAuthorityDatabaseReadOnly as withAuthorityDatabaseReadOnly_m1 } from "../../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";
import { runRecordFromRow as runRecordFromRow_m1 } from "../../../../src/backend/storage/sqlite/run-record-row.js";
import { timelineEventFromRow as timelineEventFromRow_m1 } from "../../../../src/backend/storage/sqlite/timeline-repository.js";
import { SpanAuthorityReconciliationWireSchema as SpanAuthorityReconciliationWireSchema_m1 } from "../../../../src/models/dashboard/storage.js";
import { RunRecordSchema as RunRecordSchema_m1 } from "../../../../src/models/run/record.js";
import { checkpointLookupKey as checkpointLookupKey_m1 } from "../../../../src/models/workflow/checkpoint.js";
import { LOCAL_OPERATOR_ACTOR_ID as LOCAL_OPERATOR_ACTOR_ID_m1,PositiveIntSchema as PositiveIntSchema_m1,WorkerIdSchema as WorkerIdSchema_m1 } from "../../../../src/rules/identity/ids.js";
import { WriteAttemptRecordSchema as WriteAttemptRecordSchema_m1,WriteIntentRecordSchema as WriteIntentRecordSchema_m1 } from "../../../../src/rules/write-safety/write-safety.js";
import { seedSyntheticRuntimeConfig as seedSyntheticRuntimeConfig_m0 } from "../../../support/fixtures/operator-command-fixtures.js";
import { ATOMIC_WRITE_COMMIT as ATOMIC_WRITE_COMMIT_m1,CONFIG_SNAPSHOT as CONFIG_SNAPSHOT_m1,WRITE_ATTEMPT as WRITE_ATTEMPT_m1,WRITE_INTENT_ATTEMPTING as WRITE_INTENT_ATTEMPTING_m1 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN as QUEUED_RUN_m1 } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { atomicWriteCheckpoint as atomicWriteCheckpoint_m1,currentAtomicWriteFixture as currentAtomicWriteFixture_m1,seedAtomicWriteOwner as seedAtomicWriteOwner_m1 } from "../../../support/helpers/timeline-write-fixture.js";

import assert_m1 from "node:assert/strict";
import { copyFileSync as copyFileSync_m1,existsSync as existsSync_m1,mkdirSync as mkdirSync_m1,mkdtempSync as mkdtempSync_m1,readFileSync as readFileSync_m1,readdirSync as readdirSync_m1,realpathSync as realpathSync_m1,rmSync as rmSync_m1,symlinkSync as symlinkSync_m1,truncateSync as truncateSync_m1,writeFileSync as writeFileSync_m1 } from "node:fs";
import { tmpdir as tmpdir_m1 } from "node:os";
import { join as join_m1 } from "node:path";
import { afterEach as afterEach_m1,describe as describe_m1,it as it_m1 } from "vitest";
import { z as z_m1 } from "zod";
import { rebuildRuntimeIsolation as rebuildRuntimeIsolation_m1 } from "../../../../src/backend/app/config/runtime-isolation.js";
import { readSettings as readSettings_m1 } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { manualClock as manualClock_m1 } from "../../../../src/rules/time/clock.js";
import { AuthorityDatabase as AuthorityDatabase_m1,createCredentialStore as createCredentialStore_m1,composeStorageCommand as syntheticComposeStorageCommand_m1 } from "../../../support/helpers/synthetic-storage-admission.js";

import { composeStorageCommand as nativeComposeStorageCommand_m1 } from "../../../../src/backend/app/composition/storage-compose.js";
import type { RuntimeAdmission as RuntimeAdmission_m1 } from "../../../../src/backend/storage/admission/admission.js";
import { acquireEntrypointAdmission as acquireEntrypointAdmission_m1 } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { AuthorityDatabaseOptionsSchema as AuthorityDatabaseOptionsSchema_m1,AuthorityDatabase as NativeAuthorityDatabase_m1 } from "../../../../src/backend/storage/sqlite/authority-database.js";


{


const roots: string[] = [];
const databases: AuthorityDatabase_m0[] = [];
const admissions: RuntimeAdmission_m0[] = [];
const _afterEachFixture0 = () => { for (const database of databases.splice(0)) database.close(); for (const admission of admissions.splice(0)) admission.release(); for (const root of roots.splice(0)) rmSync_m0(root, { recursive: true, force: true }); };
function fixture(hooks?: CredentialStoreHooks_m0, exclusive = false) {
  const repoRoot = mkdtempSync_m0(join_m0(realpathSync_m0(tmpdir_m0()), "sqlite-settings-")); roots.push(repoRoot);
  const admission = exclusive ? acquireEntrypointAdmission_m0(repoRoot, "exclusive") : undefined;
  if (admission !== undefined) admissions.push(admission);
  const root = join_m0(repoRoot, rebuildRuntimeIsolation_m0.stateRoot); mkdirSync_m0(root, { recursive: true, mode: 0o700 });
  writeFileSync_m0(join_m0(repoRoot, "package.json"), JSON.stringify({ name: "credential-restore-proof", version: "0.1.0" }));
  const clock = manualClock_m0(new Date("2026-09-06T12:00:00Z"));
  const path = join_m0(root, "state.db");
  const options = { path, busyTimeoutMs: 250, migrationOwner: "settings-test" };
  const database = admission === undefined ? AuthorityDatabase_m0.open(options, clock) : NativeAuthorityDatabase_m0.open(admission, options, clock); databases.push(database);
  seedSyntheticRuntimeConfig_m0(database);
  const credentialOptions = { stateRoot: root, ...(hooks === undefined ? {} : { hooks }) };
  const store = admission === undefined ? createCredentialStore_m0(credentialOptions) : nativeCredentialStore_m0({ ...credentialOptions, admission });
  const settings = createSettingsApplicationExecutor_m0((value) => resolveConfigWithProvenance_m0(value, { primaryDisplay: null }, clock), store);
  const execute = (request: unknown, authority: CommandAuthority_m0 = database) => executeSettingsCommand_m0({ authority, clock, ids: { uuid: randomUUID_m0 }, settings }, request);
  return { repoRoot, root, path, database, store, execute, clock, admission };
}
function ordinary(expectedRevision = 1) {
  const patch = { "concurrency.defaultWorkers": { set: 3 } };
  return { family: "settings", type: "apply-settings", commandId: randomUUID_m0(), requestedAt: "2026-09-06T12:00:00.000Z", requestedBy: "local-operator", source: "settings-surface",
    target: { expectedRevision }, payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH_m0, patchFingerprint: deriveSettingsPatchFingerprint_m0(patch), patch } };
}
function protectedCommand() {
  return { family: "settings", type: "apply-protected-settings", commandId: randomUUID_m0(), requestedAt: "2026-09-06T12:00:00.000Z", requestedBy: "local-operator", source: "settings-surface",
    target: { expectedRevision: 1 }, payload: { protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH_m0, writeId: randomUUID_m0(), entries: { ucpathPassword: { set: "synthetic-private-value" } } } };
}
function failAudit(database: AuthorityDatabase_m0): CommandAuthority_m0 {
  return { withAuthorityTransaction: (work) => database.withAuthorityTransaction((repositories) => work({ ...repositories,
    commandAudits: { ...repositories.commandAudits, insert: () => { throw new Error("injected audit failure"); } },
  })) };
}

describe_m0("SQLite settings authority", () => {
afterEach_m0(_afterEachFixture0);

  it_m0("after uncertain audit, real CLI restore preserves credentials and exact retry repairs the missing audit", async () => {
    const f = fixture(undefined, true); const request = protectedCommand(); assert_m0.ok(f.admission);
    const backup = await composeStorageCommand_m0(rebuildRuntimeIsolation_m0, ["backup"], f.clock, f.repoRoot, f.admission);
    assert_m0.equal(backup.exitCode, 0, backup.output);
    const directory = join_m0(f.root, "backups", "authority");
    const name = readdirSync_m0(directory).find((entry) => entry.endsWith(".manifest.json")); assert_m0.ok(name);
    const backupFiles = Object.fromEntries(readdirSync_m0(directory).map((entry) => [entry, readFileSync_m0(join_m0(directory, entry))]));
    assert_m0.throws(() => f.execute(request, failAudit(f.database)), /credential-audit-uncertain/u);
    const credentialPath = join_m0(f.root, "credentials", "protected.json");
    const credentialBytes = readFileSync_m0(credentialPath);
    assert_m0.equal(f.store.read().revision, 2);
    f.database.close();
    const restore = await composeStorageCommand_m0(rebuildRuntimeIsolation_m0, ["restore", "--from", join_m0(directory, name), "--json"], f.clock, f.repoRoot, f.admission);
    assert_m0.equal(restore.exitCode, 0, restore.output);
    assert_m0.deepEqual(readFileSync_m0(credentialPath), credentialBytes);
    const restored = NativeAuthorityDatabase_m0.open(f.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "uncertain-restore-retry" }, f.clock); databases.push(restored);
    assert_m0.equal(restored.authority.commands.get(request.commandId), undefined);
    const generation = restored.getMeta().authorityGeneration;
    const foreign = f.execute({ ...ordinary(), commandId: request.commandId }, restored);
    assert_m0.equal(foreign.state, "rejected");
    if (foreign.state === "rejected") assert_m0.equal(foreign.code, "command-divergent");
    assert_m0.equal(restored.authority.commands.get(request.commandId), undefined);
    assert_m0.equal(restored.authority.commandAudits.findByCommand(request.commandId), undefined);
    assert_m0.deepEqual(readFileSync_m0(credentialPath), credentialBytes);
    const divergent = structuredClone(request); divergent.payload.entries.ucpathPassword.set = "divergent-after-restore";
    assert_m0.equal(f.execute(divergent, restored).state, "rejected");
    assert_m0.equal(restored.getMeta().authorityGeneration, generation);
    assert_m0.equal(f.execute(request, restored).state, "applied");
    assert_m0.equal(f.execute(request, restored).state, "already-applied");
    assert_m0.deepEqual(readFileSync_m0(credentialPath), credentialBytes);
    assert_m0.equal(requireSecret_m0("ucpathPassword", createCredentialSecretSource_m0(f.store)), "synthetic-private-value");
    const doctor = await composeStorageCommand_m0(rebuildRuntimeIsolation_m0, ["doctor", "--json"], f.clock, f.repoRoot, f.admission);
    assert_m0.equal(doctor.exitCode, 0, doctor.output);
    for (const value of ["synthetic-private-value", "divergent-after-restore"]) {
      assert_m0.equal(doctor.output.includes(value), false); assert_m0.equal(restore.output.includes(value), false);
      assert_m0.equal(readFileSync_m0(f.path).includes(Buffer.from(value)), false);
      for (const bytes of Object.values(backupFiles)) assert_m0.equal(bytes.includes(Buffer.from(value)), false);
    }
    for (const [entry, bytes] of Object.entries(backupFiles)) assert_m0.deepEqual(readFileSync_m0(join_m0(directory, entry)), bytes);
  });
});
}

{


const admissions = new Map<string, RuntimeAdmission_m1>();
function openAuthority(input: z_m1.input<typeof AuthorityDatabaseOptionsSchema_m1>, clock = CLOCK) {
  const admission = [...admissions.values()].find(owner => input.path.startsWith(owner.stateRoot + "/"));
  return admission === undefined ? AuthorityDatabase_m1.open(input, clock) : NativeAuthorityDatabase_m1.open(admission, input, clock);
}
function composeStorageCommand(isolation: Parameters<typeof nativeComposeStorageCommand_m1>[0], args: readonly string[], clock = CLOCK, repoRoot: string) {
  const admission = admissions.get(repoRoot);
  return admission === undefined ? syntheticComposeStorageCommand_m1(isolation, args, clock, repoRoot) : nativeComposeStorageCommand_m1(isolation, args, clock, repoRoot, admission);
}

const CLOCK = manualClock_m1(new Date("2026-09-03T12:00:00.000Z"));
const ManifestGenerationSchema = z_m1.object({ authorityGeneration: z_m1.number().int().nonnegative() });
const roots: string[] = [];

const _afterEachFixture0 = () => {
  for (const root of roots.splice(0)) { admissions.get(root)?.release(); admissions.delete(root); rmSync_m1(root, { recursive: true, force: true }); }
};

interface Paths {
  readonly repoRoot: string;
  readonly stateRoot: string;
  readonly authorityPath: string;
  readonly backupDirectory: string;
}

function paths(): Paths {
  const repoRoot = mkdtempSync_m1(join_m1(realpathSync_m1(tmpdir_m1()), "hrauto-storage-backup-"));
  roots.push(repoRoot);
  const stateRoot = join_m1(repoRoot, rebuildRuntimeIsolation_m1.stateRoot);
  writeFileSync_m1(join_m1(repoRoot, "package.json"), JSON.stringify({ name: "backup-command", version: "0.1.0" }));
  return {
    repoRoot,
    stateRoot,
    authorityPath: join_m1(stateRoot, "state.db"),
    backupDirectory: join_m1(stateRoot, "backups", "authority"),
  };
}

function createAuthority(p: Paths): number {
  const admission = acquireEntrypointAdmission_m1(p.repoRoot, "exclusive");
  admissions.set(p.repoRoot, admission);
  const database = openAuthority(
    { path: p.authorityPath, busyTimeoutMs: 250, migrationOwner: "backup-command-test" },
    CLOCK,
  );
  try {
    database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT_m1);
    return database.getMeta().authorityGeneration;
  } finally {
    database.close();
  }
}

describe_m1("cli storage backup", () => {
afterEach_m1(_afterEachFixture0);

  it_m1("real restore warns about displaced fenced evidence without resurrecting the run", async () => {
    const p = paths(); createAuthority(p);
    const backup = await composeStorageCommand(rebuildRuntimeIsolation_m1, ["backup"], CLOCK, p.repoRoot);
    assert_m1.equal(backup.exitCode, 0, backup.output);
    const manifest = readdirSync_m1(p.backupDirectory).find((name) => name.endsWith(".manifest.json")); assert_m1.ok(manifest);
    const database = openAuthority({ path: p.authorityPath, busyTimeoutMs: 500, migrationOwner: "fenced-restore-proof" }, CLOCK);
    const e = QUEUED_RUN_m1.envelope;
    database.authority.runs.enqueue(QUEUED_RUN_m1);
    const emitter = createTimelineEmitter_m1({ repository: database.authority.timelineEvents, clock: CLOCK, pid: 4242 });
    emitter.emit({ t: "run.queued", kind: "run", ts: CLOCK.now().toISOString(), workflow: e.workflow, runId: e.runId, attempt: e.attempt,
      traceId: e.traceId, spanPath: e.traceId, itemId: e.itemId, shape: e.shape, priority: e.priority, dryRun: false,
      actorId: "local-operator", title: "Synthetic missing-authority fixture", descriptorVersion: e.descriptorVersion, contractFingerprint: e.contractFingerprint,
      resolvedInstance: e.resolvedInstance, configFingerprint: e.configFingerprint, configSnapshotId: e.configSnapshotId });
    emitter.emit({ t: "transaction.fenced", ts: CLOCK.now().toISOString(), workflow: e.workflow, runId: e.runId, attempt: e.attempt,
      traceId: e.traceId, spanPath: `${e.traceId}/synthetic-write`, parentSpanPath: e.traceId, node: "synthetic-write", taskId: "ucpath/synthetic-write" });
    assert_m1.equal(database.authority.timelineEvents.page({}).length, 2);
    database.close();
    const restore = await composeStorageCommand(rebuildRuntimeIsolation_m1, ["restore", "--from", join_m1(p.backupDirectory, manifest), "--json"], CLOCK, p.repoRoot);
    assert_m1.equal(restore.exitCode, 0, restore.output);
    const restoreReport = z_m1.object({ suspectFileName: z_m1.string() }).parse(JSON.parse(restore.output));
    const doctor = await composeStorageCommand(rebuildRuntimeIsolation_m1, ["doctor", "--json"], CLOCK, p.repoRoot);
    assert_m1.equal(doctor.exitCode, 1, doctor.output);
    const observed = z_m1.object({ spanAuthority: z_m1.unknown() }).parse(JSON.parse(doctor.output));
    assert_m1.equal(z_m1.object({ state: z_m1.string() }).parse(observed.spanAuthority).state, "degraded", JSON.stringify(observed.spanAuthority));
    const report = z_m1.object({ spanAuthority: z_m1.object({ state: z_m1.literal("degraded"),
      problems: z_m1.array(z_m1.object({ state: z_m1.string(), runId: z_m1.string(), possibleExternalWrite: z_m1.boolean().optional() })) }) }).parse(JSON.parse(doctor.output));
    assert_m1.ok(report.spanAuthority.problems.some((problem) => problem.state === "missing"
      && problem.runId === e.runId && problem.possibleExternalWrite === true));
    const preserved = NativeAuthorityDatabase_m1.inspectTimelineReadOnly(admissions.get(p.repoRoot)!, join_m1(p.stateRoot, "backups", "suspects", restoreReport.suspectFileName), 500, true);
    assert_m1.ok(preserved.recoveryEvidence?.runs.some(run => run.runId === e.runId));
    assert_m1.deepEqual(preserved.records.map(record => record.payload.kind === "span" ? record.payload.event.t : record.payload.kind), ["run.queued", "transaction.fenced"]);
    for (let count = 0; count < 2; count++) {
      const reopened = openAuthority({ path: p.authorityPath, busyTimeoutMs: 500, migrationOwner: "missing-stays-absent" }, CLOCK);
      try { assert_m1.deepEqual(new RunRecordService_m1({ database: reopened, clock: CLOCK, ids: { uuid: randomUUID_m1 }, publishQueued: () => { throw new Error("read must never publish"); } }).read(e.runId), { state: "absent", runId: e.runId });
        assert_m1.equal(reopened.authority.runs.get(e.runId), undefined); assert_m1.equal(reopened.authority.deletedRuns.get(e.runId), undefined); }
      finally { reopened.close(); }
    }
    const next = openAuthority({ path: p.authorityPath, busyTimeoutMs: 500, migrationOwner: "new-identity-after-restore" }, CLOCK);
    try {
      const nextId = randomUUID_m1(); next.authority.runs.enqueue({ ...QUEUED_RUN_m1, envelope: { ...e, runId: nextId } });
      assert_m1.equal(next.authority.runs.get(e.runId), undefined); assert_m1.ok(next.authority.runs.get(nextId));
    } finally { next.close(); }
  });
  it_m1("reports a lost write attempt even when the restored run still exists at the same version", async () => {
    const p = paths(); createAuthority(p);
    const initial = openAuthority({ path: p.authorityPath, busyTimeoutMs: 500, migrationOwner: "retained-restore-owner" }, CLOCK);
    try {
      seedAtomicWriteOwner_m1(initial, ATOMIC_WRITE_COMMIT_m1, p.authorityPath);
      const run = initial.authority.runs.get(WRITE_INTENT_ATTEMPTING_m1.runId);
      if (run === undefined) throw new Error("missing owner");
      createTimelineEmitter_m1({ repository: initial.authority.timelineEvents, clock: CLOCK }).emit(
        runQueuedSpanEvent_m1({ run, actorId: LOCAL_OPERATOR_ACTOR_ID_m1, title: "Retained restore owner" }));
    } finally { initial.close(); }
    assert_m1.equal((await composeStorageCommand(rebuildRuntimeIsolation_m1, ["backup"], CLOCK, p.repoRoot)).exitCode, 0);
    const manifest = readdirSync_m1(p.backupDirectory).find((name) => name.endsWith(".manifest.json")); assert_m1.ok(manifest);
    const newer = openAuthority({ path: p.authorityPath, busyTimeoutMs: 500, migrationOwner: "newer-write" }, CLOCK);
    try { newer.authority.writeIntents.fenceAttempt({ intent: WRITE_INTENT_ATTEMPTING_m1, attempt: WRITE_ATTEMPT_m1 }); }
    finally { newer.close(); }
    const restore = await composeStorageCommand(rebuildRuntimeIsolation_m1, ["restore", "--from", join_m1(p.backupDirectory, manifest), "--json"], CLOCK, p.repoRoot);
    assert_m1.equal(restore.exitCode, 0, restore.output);
    const doctor = await composeStorageCommand(rebuildRuntimeIsolation_m1, ["doctor", "--json"], CLOCK, p.repoRoot);
    assert_m1.equal(doctor.exitCode, 1, doctor.output);
    const report = z_m1.object({ spanAuthority: z_m1.object({ state: z_m1.literal("degraded"), problems: z_m1.array(z_m1.object({
      state: z_m1.string(), runId: z_m1.string(), possibleExternalWrite: z_m1.boolean().optional() })) }) }).parse(JSON.parse(doctor.output));
    assert_m1.ok(report.spanAuthority.problems.some((problem) => problem.state === "restore-loss"
      && problem.runId === WRITE_INTENT_ATTEMPTING_m1.runId && problem.possibleExternalWrite === true));
    const wire = z_m1.object({ spanAuthority: z_m1.unknown() }).parse(JSON.parse(doctor.output));
    assert_m1.equal(SpanAuthorityReconciliationWireSchema_m1.safeParse(wire.spanAuthority).success, true);
    const text = await composeStorageCommand(rebuildRuntimeIsolation_m1, ["doctor"], CLOCK, p.repoRoot);
    assert_m1.ok(text.output.includes("newer preserved authority evidence; possibleExternalWrite=true"));
  });

  it_m1.each(["corrupt", "file-symlink", "directory-symlink", "changed-during-read"] as const)(
    "refuses %s preserved authority evidence without leaking supplied content", async (damage) => {
      const p = paths(); createAuthority(p);
      const directory = join_m1(p.stateRoot, "backups", "suspects");
      const name = "suspect-20260903120000000-87000000-0000-4000-8000-000000000008.sqlite";
      const source = join_m1(directory, name);
      const privateText = "synthetic-preserved-private-value";
      if (damage === "directory-symlink") { mkdirSync_m1(join_m1(p.stateRoot, "backups"), { recursive: true }); symlinkSync_m1(p.backupDirectory, directory); }
      else {
        mkdirSync_m1(directory, { recursive: true });
        if (damage === "file-symlink") symlinkSync_m1(p.authorityPath, source);
        else if (damage === "corrupt") writeFileSync_m1(source, privateText);
        else copyFileSync_m1(p.authorityPath, source);
      }
      const original = NativeAuthorityDatabase_m1.inspectTimelineReadOnly.bind(NativeAuthorityDatabase_m1);
      const spy = vi.spyOn(NativeAuthorityDatabase_m1, "inspectTimelineReadOnly").mockImplementation((admission, path, timeout, recovery) => {
        const result = original(admission, path, timeout, recovery);
        if (damage === "changed-during-read" && path === name) writeFileSync_m1(path, privateText);
        return result;
      });
      try {
        const doctor = await composeStorageCommand(rebuildRuntimeIsolation_m1, ["doctor", "--json"], CLOCK, p.repoRoot);
        assert_m1.equal(doctor.exitCode, 1, doctor.output);
        assert_m1.equal(z_m1.object({ spanAuthority: z_m1.object({ state: z_m1.literal("unavailable") }) }).parse(
          JSON.parse(doctor.output)).spanAuthority.state, "unavailable");
        assert_m1.equal(doctor.output.includes(privateText), false);
      } finally { spy.mockRestore(); }
    });

  it_m1.each(["database count", "file count", "bytes"] as const)("bounds preserved authority %s", async (limit) => {
    const p = paths(); createAuthority(p);
    const directory = join_m1(p.stateRoot, "backups", "suspects"); mkdirSync_m1(directory, { recursive: true });
    const count = limit === "file count" ? 385 : limit === "database count" ? 129 : 1;
    for (let index = 0; index < count; index++) {
      const name = `suspect-20260903120000000-87000000-0000-4000-8000-${String(index).padStart(12, "0")}.sqlite`;
      const path = join_m1(directory, name);
      writeFileSync_m1(path, "");
      if (limit === "bytes") truncateSync_m1(path, 256 * 1024 * 1024 + 1);
    }
    const doctor = await composeStorageCommand(rebuildRuntimeIsolation_m1, ["doctor", "--json"], CLOCK, p.repoRoot);
    assert_m1.equal(doctor.exitCode, 1, doctor.output);
    const report = z_m1.object({ spanAuthority: z_m1.object({ state: z_m1.literal("unavailable"), cause: z_m1.object({ summary: z_m1.string() }) }) }).parse(JSON.parse(doctor.output));
    assert_m1.equal(report.spanAuthority.cause.summary, `preserved authority ${limit} ${limit === "bytes" ? "exceed" : "exceeds"} the inspection limit`);
  });

  it_m1("accounts a preserved run after explicit deletion without reviving it", async () => {
    const p = paths(); createAuthority(p);
    const initial = openAuthority({ path: p.authorityPath, busyTimeoutMs: 500, migrationOwner: "deleted-preserved-owner" }, CLOCK);
    try {
      initial.authority.runs.enqueue(QUEUED_RUN_m1);
      createTimelineEmitter_m1({ repository: initial.authority.timelineEvents, clock: CLOCK }).emit(
        runQueuedSpanEvent_m1({ run: RunRecordSchema_m1.parse(QUEUED_RUN_m1), actorId: LOCAL_OPERATOR_ACTOR_ID_m1, title: "Deleted restore owner" }));
      new RunRecordService_m1({ database: initial, clock: CLOCK, ids: { uuid: randomUUID_m1 }, publishQueued: () => { throw new Error("fixture must not enqueue"); } }).transition({ commandId: randomUUID_m1(), runId: QUEUED_RUN_m1.envelope.runId, expectedVersion: QUEUED_RUN_m1.version,
        lifecycle: { state: "terminal", outcome: "cancelled", endedAt: CLOCK.now().toISOString() } });
    } finally { initial.close(); }
    const directory = join_m1(p.stateRoot, "backups", "suspects"); mkdirSync_m1(directory, { recursive: true });
    copyFileSync_m1(p.authorityPath, join_m1(directory, "suspect-20260903120000000-87000000-0000-4000-8000-000000000009.sqlite"));
    const current = openAuthority({ path: p.authorityPath, busyTimeoutMs: 500, migrationOwner: "delete-preserved-owner" }, CLOCK);
    try {
      const service = new RunRecordService_m1({ database: current, clock: CLOCK, ids: { uuid: randomUUID_m1 }, publishQueued: () => { throw new Error("fixture must not enqueue"); } });
      const run = current.authority.runs.get(QUEUED_RUN_m1.envelope.runId); assert_m1.ok(run);
      assert_m1.equal(service.delete({ runId: run.envelope.runId, expectedVersion: run.version, commandId: randomUUID_m1() }).state, "deleted");
    }
    finally { current.close(); }
    const doctor = await composeStorageCommand(rebuildRuntimeIsolation_m1, ["doctor", "--json"], CLOCK, p.repoRoot);
    assert_m1.equal(doctor.exitCode, 0, doctor.output);
    assert_m1.equal(z_m1.object({ spanAuthority: z_m1.object({ state: z_m1.literal("reconciled") }) }).parse(
      JSON.parse(doctor.output)).spanAuthority.state, "reconciled");
  });

  it_m1("ignores all four retired cleanup-only names through plan/apply without importing or removing values", async () => {
    const p = paths();
    const retired = ["I9_USER_ID", "I9_PASSWORD", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"];
    const values = retired.map((_, index) => `synthetic-retired-private-${String(index)}`);
    const source = retired.map((name, index) => `${name}=${values[index]}`).join("\n") + "\n";
    const environmentFile = join_m1(p.repoRoot, ".env");
    writeFileSync_m1(environmentFile, source, { mode: 0o600 });
    const before = readdirSync_m1(p.repoRoot);
    const plan = await composeStorageCommand(rebuildRuntimeIsolation_m1, ["upgrade", "--plan", "--json"], CLOCK, p.repoRoot);
    assert_m1.equal(plan.exitCode, 0, plan.output);
    const planned = z_m1.object({ credentials: z_m1.literal("unchanged") }).parse(JSON.parse(plan.output));
    assert_m1.equal(planned.credentials, "unchanged");
    assert_m1.deepEqual(readdirSync_m1(p.repoRoot), before);
    const applied = await composeStorageCommand(rebuildRuntimeIsolation_m1, ["upgrade", "--json"], CLOCK, p.repoRoot);
    assert_m1.equal(applied.exitCode, 0, applied.output);
    assert_m1.deepEqual(JSON.parse(applied.output), { ...JSON.parse(plan.output), state: "initialized" });
    const database = openAuthority({ path: p.authorityPath, busyTimeoutMs: 500, migrationOwner: "cleanup-only-proof" }, CLOCK);
    try { assert_m1.deepEqual(readSettings_m1(database.authority).settings, {}); }
    finally { database.close(); }
    assert_m1.equal(createCredentialStore_m1({ stateRoot: p.stateRoot }).read().revision, 1);
    assert_m1.equal(existsSync_m1(join_m1(p.stateRoot, "credentials")), false);
    const backup = await composeStorageCommand(rebuildRuntimeIsolation_m1, ["backup", "--json"], CLOCK, p.repoRoot);
    assert_m1.equal(backup.exitCode, 0, backup.output);
    for (const value of values) {
      assert_m1.equal([plan.output, applied.output, backup.output].some((output) => output.includes(value)), false);
      assert_m1.equal(readFileSync_m1(p.authorityPath).includes(Buffer.from(value)), false);
      for (const name of readdirSync_m1(p.backupDirectory)) assert_m1.equal(readFileSync_m1(join_m1(p.backupDirectory, name)).includes(Buffer.from(value)), false);
    }
    const settled = readFileSync_m1(p.authorityPath);
    const repeat = await composeStorageCommand(rebuildRuntimeIsolation_m1, ["upgrade", "--json"], CLOCK, p.repoRoot);
    assert_m1.equal(repeat.exitCode, 0, repeat.output);
    assert_m1.equal(z_m1.object({ state: z_m1.literal("already-upgraded") }).parse(JSON.parse(repeat.output)).state, "already-upgraded");
    assert_m1.deepEqual(readFileSync_m1(p.authorityPath), settled);
    assert_m1.equal(readFileSync_m1(environmentFile, "utf8"), source);
    writeFileSync_m1(environmentFile, source, { mode: 0o600 });
    assert_m1.equal(readFileSync_m1(environmentFile, "utf8"), source);
  });
  it_m1("ignores invalid retired migration values without reading or echoing them", async () => {
    const p = paths(); const source = "HRAUTO_DEFAULT_WORKERS=synthetic-invalid-private-input\n";
    writeFileSync_m1(join_m1(p.repoRoot, ".env"), source, { mode: 0o600 });
    const result = await composeStorageCommand(rebuildRuntimeIsolation_m1, ["upgrade", "--plan", "--json"], CLOCK, p.repoRoot);
    assert_m1.equal(result.exitCode, 0);
    assert_m1.deepEqual(z_m1.object({state:z_m1.literal("planned"),credentials:z_m1.literal("unchanged")}).parse(JSON.parse(result.output)),{state:"planned",credentials:"unchanged"});
    assert_m1.equal(result.output.includes("synthetic-invalid-private-input"), false); assert_m1.equal(existsSync_m1(p.stateRoot), false);
    assert_m1.equal(readFileSync_m1(join_m1(p.repoRoot, ".env"), "utf8"), source);
  });
  it_m1.each(["--force", "--skip-backup", "--allow-mixed"])("refuses unsupported upgrade flag %s before touching the root", async (flag) => {
    const p = paths(); const before = readdirSync_m1(p.repoRoot);
    const result = await composeStorageCommand(rebuildRuntimeIsolation_m1, ["upgrade", flag], CLOCK, p.repoRoot);
    assert_m1.equal(result.exitCode, 2); assert_m1.ok(result.output.includes(flag)); assert_m1.deepEqual(readdirSync_m1(p.repoRoot), before);
  });
  it_m1("writes exactly one verified backup and manifest at the live generation", async () => {
    const p = paths();
    const generation = createAuthority(p);
    assert_m1.equal(existsSync_m1(p.backupDirectory), false, "no backup exists before the operator asks");

    const outcome = await composeStorageCommand(rebuildRuntimeIsolation_m1, ["backup"], CLOCK, p.repoRoot);
    assert_m1.equal(outcome.exitCode, 0, outcome.output);
    assert_m1.match(outcome.output, /^backup: verified — authority-g\d+-/u);

    const entries = readdirSync_m1(p.backupDirectory).sort();
    assert_m1.equal(entries.length, 2, entries.join(", "));
    const manifestName = entries.find((name) => name.endsWith(".manifest.json"));
    const backupName = entries.find((name) => name.endsWith(".sqlite"));
    assert_m1.ok(manifestName !== undefined && backupName !== undefined, entries.join(", "));
    assert_m1.equal(manifestName, `${backupName}.manifest.json`);
    assert_m1.ok(outcome.output.includes(backupName));
    const manifest = ManifestGenerationSchema.parse(
      JSON.parse(readFileSync_m1(join_m1(p.backupDirectory, manifestName), "utf8")),
    );
    assert_m1.equal(manifest.authorityGeneration, generation);
    // No temporary file survives a completed run.
    assert_m1.deepEqual(entries.filter((name) => name.endsWith(".tmp")), []);
  });

  it_m1("refuses when no authority database exists and creates nothing", async () => {
    const p = paths();
    const outcome = await composeStorageCommand(rebuildRuntimeIsolation_m1, ["backup"], CLOCK, p.repoRoot);
    assert_m1.equal(outcome.exitCode, 1);
    assert_m1.match(outcome.output, /storage backup REFUSED — no authority database exists/u);
    assert_m1.equal(existsSync_m1(p.authorityPath), false, "a refused backup must not mint an authority");
    assert_m1.equal(existsSync_m1(p.backupDirectory), false);
  });

  it_m1("lets the doctor exit 0 on a healthy reconciled authority with no backup, reporting it missing", async () => {
    const p = paths();
    createAuthority(p);
    const doctor = await composeStorageCommand(rebuildRuntimeIsolation_m1, ["doctor"], CLOCK, p.repoRoot);
    assert_m1.equal(doctor.exitCode, 0, doctor.output);
    assert_m1.match(doctor.output, /^authority: healthy/mu);
    assert_m1.match(doctor.output, /^backup: MISSING/mu);

    await composeStorageCommand(rebuildRuntimeIsolation_m1, ["backup"], CLOCK, p.repoRoot);
    const after = await composeStorageCommand(rebuildRuntimeIsolation_m1, ["doctor"], CLOCK, p.repoRoot);
    assert_m1.equal(after.exitCode, 0, after.output);
    assert_m1.match(after.output, /^backup: current/mu);
  });
  it_m1.each(["missing", "malformed"])("restores SQLite before reporting %s independent credentials", async (credentialState) => {
    const p = paths(); createAuthority(p);
    const backup = await composeStorageCommand(rebuildRuntimeIsolation_m1, ["backup"], CLOCK, p.repoRoot);
    assert_m1.equal(backup.exitCode, 0, backup.output);
    const manifest = readdirSync_m1(p.backupDirectory).find((name) => name.endsWith(".manifest.json"));
    assert_m1.ok(manifest);
    const credentialPath = join_m1(p.stateRoot, "credentials", "protected.json");
    if (credentialState === "malformed") {
      mkdirSync_m1(join_m1(p.stateRoot, "credentials"), { mode: 0o700 });
      writeFileSync_m1(credentialPath, "synthetic-malformed-credential-canary", { mode: 0o600 });
    }
    const restored = await composeStorageCommand(rebuildRuntimeIsolation_m1,
      ["restore", "--from", join_m1(p.backupDirectory, manifest), "--json"], CLOCK, p.repoRoot);
    assert_m1.equal(restored.exitCode, 0, restored.output);
    const report = z_m1.object({ state: z_m1.literal("restored"), credentials: z_m1.object({ state: z_m1.enum(["available", "unavailable"]) }) }).parse(JSON.parse(restored.output));
    assert_m1.equal(report.credentials.state, credentialState === "missing" ? "available" : "unavailable");
    assert_m1.equal(restored.output.includes("synthetic-malformed-credential-canary"), false);
    if (credentialState === "malformed") assert_m1.equal(readFileSync_m1(credentialPath, "utf8"), "synthetic-malformed-credential-canary");
    else assert_m1.equal(existsSync_m1(join_m1(p.stateRoot, "credentials")), false);
    assert_m1.equal(NativeAuthorityDatabase_m1.inspectExistingReadOnly(admissions.get(p.repoRoot)!, p.authorityPath).schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION_m1);
  });

});

it_m1.each([false, true])("restore confirmation evidence survives recovery accounting (backup after commit: %s)", async (backupAfterCommit) => {
try {


  CLOCK.setWall(new Date(WRITE_INTENT_ATTEMPTING_m1.fencedAt));
  const p = paths(); createAuthority(p);
  const checkpoint = atomicWriteCheckpoint_m1(ATOMIC_WRITE_COMMIT_m1);
  const inspect = (path: string) => {
    return withAuthorityDatabaseReadOnly_m1(admissions.get(p.repoRoot)!, path, db => {
      const run = runRecordFromRow_m1(db.prepare("SELECT * FROM runs WHERE id=?").get(WRITE_INTENT_ATTEMPTING_m1.runId));
      const attempt = WriteAttemptRecordSchema_m1.parse(nativeOrdinaryRecordFromRow_m1("write_attempts", db.prepare("SELECT * FROM write_attempts WHERE id=?").get(WRITE_ATTEMPT_m1.writeAttemptId)));
      const intent = WriteIntentRecordSchema_m1.parse(nativeOrdinaryRecordFromRow_m1("write_intents", db.prepare("SELECT * FROM write_intents WHERE id=?").get(WRITE_INTENT_ATTEMPTING_m1.writeIntentId)));
      return { runId: run.envelope.runId, version: run.version, lifecycle: run.lifecycle.state,
        claimedAt: "claimedAt" in run.lifecycle ? run.lifecycle.claimedAt : undefined, claimGeneration: run.claimGeneration,
        attemptId: attempt.writeAttemptId, outcome: attempt.outcome.state, operationStatus: intent.status,
        checkpoint: db.prepare("SELECT 1 FROM run_checkpoints WHERE id=?").get(checkpointLookupKey_m1(checkpoint.workflowId, checkpoint.itemId, checkpoint.nodeId, checkpoint.attempt, checkpoint.claimGeneration)) !== undefined,
        events: db.prepare("SELECT * FROM timeline_events ORDER BY cursor").all().map(timelineEventFromRow_m1).map(record => record.payload.kind === "span" ? record.payload.event.t : record.payload.kind) };
    }, 500);
  };
  let owningWorkerId: ReturnType<typeof WorkerIdSchema_m1.parse>;
  const initial = openAuthority({ path: p.authorityPath, busyTimeoutMs: 500, migrationOwner: "r1c-seed" }, CLOCK);
  try {
    seedAtomicWriteOwner_m1(initial, ATOMIC_WRITE_COMMIT_m1, p.authorityPath);
    const queued = initial.authority.runs.get(WRITE_INTENT_ATTEMPTING_m1.runId); assert_m1.ok(queued);
    createTimelineEmitter_m1({ repository: initial.authority.timelineEvents, clock: CLOCK }).emit(
      runQueuedSpanEvent_m1({ run: queued, actorId: LOCAL_OPERATOR_ACTOR_ID_m1, title: "Synthetic restored commit" }));
    assert_m1.equal(queued.lifecycle.state, "claimed");
    if (queued.lifecycle.state !== "claimed") throw new Error("native fixture must retain claimed owner");
    owningWorkerId = queued.lifecycle.workerId;
    const service = new RunRecordService_m1({ database: initial, clock: CLOCK, ids: { uuid: randomUUID_m1 },
      publishQueued: () => { throw new Error("test must not enqueue"); } });
    const validating = service.workerTransition({ commandId: randomUUID_m1(), runId: queued.envelope.runId,
      claim: { workerId: owningWorkerId, claimGeneration: 1 }, lifecycle: { state: "validating",
        workerId: owningWorkerId, claimedAt: CLOCK.now().toISOString(), heartbeatAt: CLOCK.now().toISOString() } });
    assert_m1.equal(validating.state, "applied", JSON.stringify(validating));
    const running = service.workerTransition({ commandId: randomUUID_m1(), runId: queued.envelope.runId,
      claim: { workerId: owningWorkerId, claimGeneration: 1 }, lifecycle: { state: "running",
        workerId: owningWorkerId, claimedAt: CLOCK.now().toISOString(), heartbeatAt: CLOCK.now().toISOString(),
        currentNodeId: checkpoint.nodeId } });
    assert_m1.equal(running.state, "applied");
    initial.authority.writeIntents.fenceAttempt({ intent: WRITE_INTENT_ATTEMPTING_m1, attempt: WRITE_ATTEMPT_m1 });
  } finally { initial.close(); }
  const before = inspect(p.authorityPath);
  assert_m1.equal(before.lifecycle, "running"); assert_m1.equal(before.outcome, "attempting");
  let backup = await composeStorageCommand(rebuildRuntimeIsolation_m1, ["backup"], CLOCK, p.repoRoot);
  assert_m1.equal(backup.exitCode, 0, backup.output);
  let manifest = readdirSync_m1(p.backupDirectory).find((name) => name.endsWith(".manifest.json")); assert_m1.ok(manifest);
  CLOCK.setWall(new Date(ATOMIC_WRITE_COMMIT_m1.confirmedAt));
  const newer = openAuthority({ path: p.authorityPath, busyTimeoutMs: 500, migrationOwner: "r1c-commit" }, CLOCK);
  try {
    const service = new RunRecordService_m1({ database: newer, clock: CLOCK, ids: { uuid: randomUUID_m1 },
      publishQueued: () => { throw new Error("test must not enqueue"); } });
    const claim = { workerId: owningWorkerId,
      claimGeneration: PositiveIntSchema_m1.parse(before.claimGeneration) };
    executeSequencedWriteCommit_m1(newer, { run: { runId: before.runId, expectedVersion: before.version, claim },
      commit: currentAtomicWriteFixture_m1(ATOMIC_WRITE_COMMIT_m1), checkpoint }, { kind: "advance-running", claim, claimedAt: before.claimedAt!,
      port: workerRunLifecyclePort_m1(service) });
  } finally { newer.close(); }
  const committed = inspect(p.authorityPath);
  assert_m1.equal(committed.version, before.version + 1); assert_m1.equal(committed.attemptId, before.attemptId);
  assert_m1.equal(committed.outcome, "committed"); assert_m1.equal(committed.checkpoint, true);
  if (backupAfterCommit) {
    // A preserved confirmation already present in the restored backup is accounted for.
    backup = await composeStorageCommand(rebuildRuntimeIsolation_m1, ["backup"], CLOCK, p.repoRoot);
    assert_m1.equal(backup.exitCode, 0, backup.output);
    manifest = readdirSync_m1(p.backupDirectory).filter((name) => name.endsWith(".manifest.json")).sort().at(-1);
    assert_m1.ok(manifest);
  }
  const restore = await composeStorageCommand(rebuildRuntimeIsolation_m1,
    ["restore", "--from", join_m1(p.backupDirectory, manifest), "--json"], CLOCK, p.repoRoot);
  assert_m1.equal(restore.exitCode, 0, restore.output);
  const restoredReport = z_m1.object({ suspectFileName: z_m1.string() }).parse(JSON.parse(restore.output));
  const doctor = await composeStorageCommand(rebuildRuntimeIsolation_m1, ["doctor", "--json"], CLOCK, p.repoRoot);
  const current = inspect(p.authorityPath);
  const preserved = inspect(join_m1(p.stateRoot, "backups", "suspects", restoredReport.suspectFileName));
  assert_m1.deepEqual(current, backupAfterCommit ? committed : before); assert_m1.deepEqual(preserved, committed);
  assert_m1.equal(doctor.exitCode, backupAfterCommit ? 0 : 1, doctor.output);
  if (backupAfterCommit) {
    const healthy = openAuthority({ path: p.authorityPath, busyTimeoutMs: 500, migrationOwner: "restore-control" }, CLOCK);
    try {
      const service = new RunRecordService_m1({ database: healthy, clock: CLOCK, ids: { uuid: randomUUID_m1 },
        publishQueued: () => { throw new Error("test must not enqueue"); } });
      assert_m1.equal(service.renewClaim({ commandId: randomUUID_m1(), runId: current.runId,
        claim: { workerId: owningWorkerId, claimGeneration: current.claimGeneration } }).state, "applied");
    } finally { healthy.close(); }
    const accounted = await composeStorageCommand(rebuildRuntimeIsolation_m1, ["doctor", "--json"], CLOCK, p.repoRoot);
    assert_m1.equal(accounted.exitCode, 0, accounted.output);
    assert_m1.ok(inspect(p.authorityPath).version > committed.version);
    return;
  }
  CLOCK.advanceWall(60 * 60 * 1000);
  const mutationDb = openAuthority({ path: p.authorityPath, busyTimeoutMs: 500, migrationOwner: "restore-sweep" }, CLOCK);
  try {
    const service = new RunRecordService_m1({ database: mutationDb, clock: CLOCK, ids: { uuid: randomUUID_m1 },
      publishQueued: () => { throw new Error("test must not enqueue"); } });
    const outcomes = sweepWorkerClaims_m1(mutationDb, workerRunLifecyclePort_m1(service), {
      staleBefore: CLOCK.now().toISOString(), now: CLOCK.now().toISOString() });
    assert_m1.equal(outcomes.length, 1);
    const outcome = outcomes[0]; assert_m1.ok(outcome);
    assert_m1.equal(outcome.state, "recovery-required");
    if (outcome.state !== "recovery-required") throw new Error("expected parked recovery");
    assert_m1.equal(outcome.parked, true);
  } finally { mutationDb.close(); }
  const afterSweep = inspect(p.authorityPath);
  assert_m1.equal(afterSweep.version, committed.version);
  assert_m1.equal(afterSweep.lifecycle, "parked-write");
  assert_m1.equal(afterSweep.outcome, "attempting"); assert_m1.equal(afterSweep.checkpoint, false);
  const doctorAfter = await composeStorageCommand(rebuildRuntimeIsolation_m1, ["doctor", "--json"], CLOCK, p.repoRoot);
  assert_m1.equal(doctorAfter.exitCode, 1, doctorAfter.output);
  const afterReport = z_m1.object({ spanAuthority: SpanAuthorityReconciliationWireSchema_m1 }).parse(JSON.parse(doctorAfter.output));
  assert_m1.equal(afterReport.spanAuthority.state, "degraded");
  if (afterReport.spanAuthority.state !== "degraded") throw new Error("expected restore-loss warning");
  assert_m1.ok(afterReport.spanAuthority.problems.some((problem) => problem.state === "restore-loss"
    && problem.runId === current.runId && problem.possibleExternalWrite === true));

} finally {
_afterEachFixture0();
}
});
}
