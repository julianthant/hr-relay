import { selectRunRuntime } from "../../../../src/backend/runs/settings/run-settings.js";
import { createParkedWriteRoundTripTestWorld } from "../../../support/helpers/backend/parked-write-round-trip-world.js";
import { WRITE_FIXTURE_RUN_ID, WRITE_FIXTURE_NODE_ID, WRITE_FIXTURE_WORKER_ID, WRITE_FIXTURE_IMPL_FINGERPRINT, WriteFixtureProofSchema, writeFixtureDescriptor } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { createCommandKernel } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createWriteResolutionExecutor } from "../../../../src/backend/runtime/writes/write-recovery.js";
import { NO_INTAKE_PROJECTIONS, UNWIRED_INTAKE_PARSER } from "../../../support/fixtures/intake-kernel-seams.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { descriptorRuntimeNodes } from "../../../../src/workflow-kit/workflow.js";
import { JsonValueSchema } from "../../../../src/rules/validation/canonical-json.js";
import { testAdmittedWorker, testRunContinuation } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { DatabaseSync } from "node:sqlite";
import { fenceWriteFixture } from "../../../support/helpers/write-fence-fixture.js";
import { createSettingsAuthorityTestWorld } from "../../../support/helpers/backend/settings-authority-world.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as join_m0 } from "node:path";
import { afterEach, describe, it, vi } from "vitest";
import { composeStorageCommand as composeStorageCommand_m0 } from "../../../../src/backend/app/composition/storage-compose.js";
import { createChatGptCredentialRepository, type ChatGptCredentialRecord } from "../../../../src/backend/storage/configuration/credential-store.js";
import { observeProcessIdentity } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";

import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";


import { createCredentialSecretSource } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { type RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";

import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";

import { requireSecret } from "../../../../src/models/config/secrets.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint } from "../../../../src/models/config/settings.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { AuthorityDatabase as AuthorityDatabase_m0 } from "../../../support/helpers/synthetic-storage-admission.js";

import { runQueuedSpanEvent } from "../../../../src/backend/runs/commands/run-queued-span.js";
import { RunRecordService, workerRunLifecyclePort } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { buildCommittedSettlement, executeSequencedWriteCommit } from "../../../../src/backend/runtime/writes/write-sequencer.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { nativeOrdinaryRecordFromRow } from "../../../../src/backend/storage/sqlite/native-record-row.js";
import { withAuthorityDatabaseReadOnly } from "../../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";
import { runRecordFromRow } from "../../../../src/backend/storage/sqlite/run-record-row.js";
import { timelineEventFromRow } from "../../../../src/backend/storage/sqlite/timeline-repository.js";
import { SpanAuthorityReconciliationWireSchema } from "../../../../src/models/dashboard/storage.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { checkpointLookupKey } from "../../../../src/models/workflow/checkpoint.js";
import { ActorIdSchema, LOCAL_OPERATOR_ACTOR_ID, PositiveIntSchema, WorkerIdSchema } from "../../../../src/rules/identity/ids.js";
import { WriteAttemptRecordSchema, WriteIntentRecordSchema } from "../../../../src/rules/write-safety/write-safety.js";

import { ATOMIC_WRITE_COMMIT, CONFIG_SNAPSHOT, WRITE_ATTEMPT, WRITE_INTENT_ATTEMPTING } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { releaseSeededWriteOwners, seedAtomicWriteOwner } from "../../../support/helpers/timeline-write-fixture.js";

import { copyFileSync, existsSync, symlinkSync, truncateSync } from "node:fs";

import { z } from "zod";


import { composeStorageCommand as syntheticComposeStorageCommand_m1 } from "../../../support/helpers/synthetic-storage-admission.js";

import { AuthorityDatabaseOptionsSchema } from "../../../../src/backend/storage/sqlite/authority-database.js";

{

const { databases, fixture, protectedCommand, failAudit, cleanup } = createSettingsAuthorityTestWorld();


const _afterEachFixture0 = cleanup;

function ordinary(expectedRevision = 1) {
  const patch = { "concurrency.defaultWorkers": { set: 3 } };
  return { family: "settings", type: "apply-settings", commandId: randomUUID(), requestedAt: "2026-09-06T12:00:00.000Z", requestedBy: "local-operator", source: "settings-surface",
    target: { expectedRevision }, payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } };
}



describe("SQLite settings authority", () => {
afterEach(_afterEachFixture0);

  it("after uncertain audit, real CLI restore preserves credentials and exact retry repairs the missing audit", async () => {
    const f = await fixture(undefined, true); const revision = f.store.read().revision; const request = protectedCommand(revision); assert.ok(f.admission);
    const backup = await composeStorageCommand_m0(rebuildRuntimeIsolation, ["backup"], f.clock, f.repoRoot, f.admission, f.store);
    assert.equal(backup.exitCode, 0, backup.output);
    const directory = join_m0(f.root, "backups", "authority");
    const name = readdirSync(directory).find((entry) => entry.endsWith(".manifest.json")); assert.ok(name);
    const backupFiles = Object.fromEntries(readdirSync(directory).map((entry) => [entry, readFileSync(join_m0(directory, entry))]));
    assert.throws(() => f.execute(request, failAudit(f.database)), /credential-audit-uncertain/u);
    const credentialPath = join_m0(f.root, "credentials", "protected.json");
    const credentialBytes = readFileSync(credentialPath);
    assert.equal(f.store.read().revision, revision + 1);
    f.database.close();
    const restore = await composeStorageCommand_m0(rebuildRuntimeIsolation, ["restore", "--from", join_m0(directory, name), "--json"], f.clock, f.repoRoot, f.admission, f.store);
    assert.equal(restore.exitCode, 0, restore.output);
    const renewed = f.renewAfterRestore();
    assert.throws(() => f.admission!.assertLive(), /profile-restore-context-expired|released admission/u);
    assert.deepEqual(readFileSync(credentialPath), credentialBytes);
    const restored = AuthorityDatabase.open(renewed.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "uncertain-restore-retry" }, f.clock, undefined, undefined, undefined, renewed.store); databases.push(restored);
    assert.equal(restored.authority.commands.get(request.commandId), undefined);
    const generation = restored.getMeta().authorityGeneration;
    const foreign = renewed.execute({ ...ordinary(), commandId: request.commandId }, restored);
    assert.equal(foreign.state, "rejected");
    if (foreign.state === "rejected") assert.equal(foreign.code, "command-divergent");
    assert.equal(restored.authority.commands.get(request.commandId), undefined);
    assert.equal(restored.authority.commandAudits.findByCommand(request.commandId), undefined);
    assert.deepEqual(readFileSync(credentialPath), credentialBytes);
    const divergent = structuredClone(request); divergent.payload.entries.ucpathPassword.set = "divergent-after-restore";
    assert.equal(renewed.execute(divergent, restored).state, "rejected");
    assert.equal(restored.getMeta().authorityGeneration, generation);
    assert.equal(renewed.execute(request, restored).state, "applied");
    assert.equal(renewed.execute(request, restored).state, "already-applied");
    assert.deepEqual(readFileSync(credentialPath), credentialBytes);
    assert.equal(requireSecret("ucpathPassword", createCredentialSecretSource(renewed.store)), "synthetic-private-value");
    const doctor = await composeStorageCommand_m0(rebuildRuntimeIsolation, ["doctor", "--json"], f.clock, f.repoRoot, renewed.admission, renewed.store);
    assert.equal(doctor.exitCode, 0, doctor.output);
    for (const value of ["synthetic-private-value", "divergent-after-restore"]) {
      assert.equal(doctor.output.includes(value), false); assert.equal(restore.output.includes(value), false);
      assert.equal(readFileSync(f.path).includes(Buffer.from(value)), false);
      for (const bytes of Object.values(backupFiles)) assert.equal(bytes.includes(Buffer.from(value)), false);
    }
    for (const [entry, bytes] of Object.entries(backupFiles)) assert.deepEqual(readFileSync(join_m0(directory, entry)), bytes);
  });
});
}

{

const admissions = new Map<string, RuntimeAdmission>();
const openedAuthorities: AuthorityDatabase[] = [];
function openAuthority(input: z.input<typeof AuthorityDatabaseOptionsSchema>, clock = CLOCK) {
  const database = AuthorityDatabase_m0.open(input, clock);
  openedAuthorities.push(database);
  return database;
}
function composeStorageCommand(isolation: Parameters<typeof composeStorageCommand_m0>[0], args: readonly string[], clock = CLOCK, repoRoot: string) {
  const admission = admissions.get(repoRoot);
  return admission === undefined ? syntheticComposeStorageCommand_m1(isolation, args, clock, repoRoot) : composeStorageCommand_m0(isolation, args, clock, repoRoot, admission, boundProfileCredentials(admission));
}

const CLOCK = manualClock(new Date("2026-09-03T12:00:00.000Z"));
const ManifestGenerationSchema = z.object({ authorityGeneration: z.number().int().nonnegative() });
const roots: string[] = [];
const profiles: Awaited<ReturnType<typeof createBoundProfileFixture>>[] = [];

const _afterEachFixture0 = async () => {
  for (const database of openedAuthorities.splice(0)) database.close();
  admissions.clear();
  for (const profile of profiles.splice(0)) await profile.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
};

interface Paths {
  readonly repoRoot: string;
  readonly stateRoot: string;
  readonly authorityPath: string;
  readonly backupDirectory: string;
  readonly renewAfterRestore: () => void;
}

async function paths(mode: "ready" | "pending" | "uninitialized" = "uninitialized"): Promise<Paths> {
  const profile = mode === "uninitialized" ? undefined : await createBoundProfileFixture(mode === "pending" ? { pending: true } : {});
  if (profile !== undefined) profiles.push(profile);
  const repoRoot = profile?.workspace ?? mkdtempSync(join_m0(realpathSync(tmpdir()), "hrauto-storage-backup-"));
  if (profile === undefined) roots.push(repoRoot);
  else admissions.set(repoRoot, profile.admission);
  const stateRoot = profile?.stateRoot ?? join_m0(repoRoot, rebuildRuntimeIsolation.stateRoot);
  writeFileSync(join_m0(repoRoot, "package.json"), JSON.stringify({ name: "backup-command", version: "0.1.0" }));
  return {
    repoRoot,
    stateRoot,
    authorityPath: join_m0(stateRoot, "state.db"),
    backupDirectory: join_m0(stateRoot, "backups", "authority"),
    renewAfterRestore() {
      assert.ok(profile);
      const old = profile.admission;
      const renewed = profile.renewAfterRestore();
      admissions.set(repoRoot, renewed.admission);
      assert.throws(() => old.assertLive(), /profile-restore-context-expired|released admission/u);
    },
  };
}

function createAuthority(p: Paths): number {
  assert.ok(admissions.has(p.repoRoot), "authority fixture requires an issued profile");
  const database = openAuthority(
    { path: p.authorityPath, busyTimeoutMs: 250, migrationOwner: "backup-command-test" },
    CLOCK,
  );
  try {
    database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    return database.getMeta().authorityGeneration;
  } finally {
    database.close();
  }
}

describe("cli storage backup", () => {
afterEach(_afterEachFixture0);

  it("real restore warns about displaced fenced evidence without resurrecting the run", async () => {
    const p = await paths("ready"); createAuthority(p);
    const backup = await composeStorageCommand(rebuildRuntimeIsolation, ["backup"], CLOCK, p.repoRoot);
    assert.equal(backup.exitCode, 0, backup.output);
    const manifest = readdirSync(p.backupDirectory).find((name) => name.endsWith(".manifest.json")); assert.ok(manifest);
    const database = openAuthority({ path: p.authorityPath, busyTimeoutMs: 500, migrationOwner: "fenced-restore-proof" }, CLOCK);
    const e = QUEUED_RUN.envelope;
    database.authority.runs.enqueue(QUEUED_RUN);
    const emitter = createTimelineEmitter({ repository: database.authority.timelineEvents, clock: CLOCK, pid: 4242 });
    emitter.emit({ t: "run.queued", kind: "run", ts: CLOCK.now().toISOString(), workflow: e.workflow, runId: e.runId, attempt: e.attempt,
      traceId: e.traceId, spanPath: e.traceId, itemId: e.itemId, shape: e.shape, priority: e.priority, dryRun: false,
      actorId: "local-operator", title: "Synthetic missing-authority fixture", descriptorVersion: e.descriptorVersion, contractFingerprint: e.contractFingerprint,
      resolvedInstance: e.resolvedInstance, configFingerprint: e.configFingerprint, configSnapshotId: e.configSnapshotId });
    emitter.emit({ t: "transaction.fenced", ts: CLOCK.now().toISOString(), workflow: e.workflow, runId: e.runId, attempt: e.attempt,
      traceId: e.traceId, spanPath: `${e.traceId}/synthetic-write`, parentSpanPath: e.traceId, node: "synthetic-write", taskId: "ucpath/synthetic-write" });
    assert.equal(database.authority.timelineEvents.page({}).length, 2);
    database.close();
    const restore = await composeStorageCommand(rebuildRuntimeIsolation, ["restore", "--from", join_m0(p.backupDirectory, manifest), "--json"], CLOCK, p.repoRoot);
    assert.equal(restore.exitCode, 0, restore.output);
    p.renewAfterRestore();
    const restoreReport = z.object({ suspectFileName: z.string() }).parse(JSON.parse(restore.output));
    const doctor = await composeStorageCommand(rebuildRuntimeIsolation, ["doctor", "--json"], CLOCK, p.repoRoot);
    assert.equal(doctor.exitCode, 1, doctor.output);
    const observed = z.object({ spanAuthority: z.unknown() }).parse(JSON.parse(doctor.output));
    assert.equal(z.object({ state: z.string() }).parse(observed.spanAuthority).state, "degraded", JSON.stringify(observed.spanAuthority));
    const report = z.object({ spanAuthority: z.object({ state: z.literal("degraded"),
      problems: z.array(z.object({ state: z.string(), runId: z.string(), possibleExternalWrite: z.boolean().optional() })) }) }).parse(JSON.parse(doctor.output));
    assert.ok(report.spanAuthority.problems.some((problem) => problem.state === "missing"
      && problem.runId === e.runId && problem.possibleExternalWrite === true));
    const preserved = AuthorityDatabase.inspectTimelineReadOnly(admissions.get(p.repoRoot)!, join_m0(p.stateRoot, "backups", "suspects", restoreReport.suspectFileName), 500, true);
    assert.ok(preserved.recoveryEvidence?.runs.some(run => run.runId === e.runId));
    assert.deepEqual(preserved.records.map(record => record.payload.kind === "span" ? record.payload.event.t : record.payload.kind), ["run.queued", "transaction.fenced"]);
    for (let count = 0; count < 2; count++) {
      const reopened = openAuthority({ path: p.authorityPath, busyTimeoutMs: 500, migrationOwner: "missing-stays-absent" }, CLOCK);
      try { assert.deepEqual(new RunRecordService({ database: reopened, clock: CLOCK, ids: { uuid: randomUUID }, publishQueued: () => { throw new Error("read must never publish"); } }).read(e.runId), { state: "absent", runId: e.runId });
        assert.equal(reopened.authority.runs.get(e.runId), undefined); assert.equal(reopened.authority.deletedRuns.get(e.runId), undefined); }
      finally { reopened.close(); }
    }
    const next = openAuthority({ path: p.authorityPath, busyTimeoutMs: 500, migrationOwner: "new-identity-after-restore" }, CLOCK);
    try {
      const nextId = randomUUID(); next.authority.runs.enqueue({ ...QUEUED_RUN, envelope: { ...e, runId: nextId } });
      assert.equal(next.authority.runs.get(e.runId), undefined); assert.ok(next.authority.runs.get(nextId));
    } finally { next.close(); }
  });
  it("reports a lost write attempt even when the restored run still exists at the same version", async () => {
    const p = await paths("ready"); createAuthority(p);
    const initial = openAuthority({ path: p.authorityPath, busyTimeoutMs: 500, migrationOwner: "retained-restore-owner" }, CLOCK);
    try {
      seedAtomicWriteOwner(initial, ATOMIC_WRITE_COMMIT, p.authorityPath);
      const run = initial.authority.runs.get(WRITE_INTENT_ATTEMPTING.runId);
      if (run === undefined) throw new Error("missing owner");
      createTimelineEmitter({ repository: initial.authority.timelineEvents, clock: CLOCK }).emit(
        runQueuedSpanEvent({ run, actorId: LOCAL_OPERATOR_ACTOR_ID, title: "Retained restore owner" }));
    } finally { releaseSeededWriteOwners(initial, CLOCK.now().toISOString()); initial.close(); }
    assert.equal((await composeStorageCommand(rebuildRuntimeIsolation, ["backup"], CLOCK, p.repoRoot)).exitCode, 0);
    const manifest = readdirSync(p.backupDirectory).find((name) => name.endsWith(".manifest.json")); assert.ok(manifest);
    const newer = openAuthority({ path: p.authorityPath, busyTimeoutMs: 500, migrationOwner: "newer-write" }, CLOCK);
    try {
      const worker = testAdmittedWorker(newer, CLOCK, { path: p.authorityPath, workflow: ATOMIC_WRITE_COMMIT.transaction.workflowId,
        poolIndex: 2, browserSystems: [ATOMIC_WRITE_COMMIT.transaction.system] });
      const claimed = newer.authority.runs.claimNext({ workflow: worker.member.workflow, workerId: worker.workerId,
        workerLifetime: worker.workerLifetime, now: CLOCK.now().toISOString() });
      assert.equal(claimed.state, "claimed");
      if (claimed.state !== "claimed") throw new Error("restored-write fixture owner could not claim");
      assert.equal(claimed.run.envelope.runId, WRITE_INTENT_ATTEMPTING.runId);
      fenceWriteFixture(newer, { intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT });
    }
    finally { releaseSeededWriteOwners(newer, CLOCK.now().toISOString()); newer.close(); }
    const restore = await composeStorageCommand(rebuildRuntimeIsolation, ["restore", "--from", join_m0(p.backupDirectory, manifest), "--json"], CLOCK, p.repoRoot);
    assert.equal(restore.exitCode, 0, restore.output);
    p.renewAfterRestore();
    const restoreReport = z.object({ suspectFileName: z.string() }).parse(JSON.parse(restore.output));
    const preserved = AuthorityDatabase.inspectTimelineReadOnly(admissions.get(p.repoRoot)!,
      join_m0(p.stateRoot, "backups", "suspects", restoreReport.suspectFileName), 500, true)
      .recoveryEvidence?.runs.find(run => run.runId === WRITE_INTENT_ATTEMPTING.runId);
    assert.ok(preserved);
    assert.deepEqual(preserved.attemptIds, [WRITE_ATTEMPT.writeAttemptId]);
    const current = openAuthority({ path: p.authorityPath, busyTimeoutMs: 500, migrationOwner: "same-version-restore-control" }, CLOCK);
    try {
      const worker = testAdmittedWorker(current, CLOCK, { path: p.authorityPath, workflow: ATOMIC_WRITE_COMMIT.transaction.workflowId,
        poolIndex: 2, browserSystems: [ATOMIC_WRITE_COMMIT.transaction.system] });
      const claimed = current.authority.runs.claimNext({ workflow: worker.member.workflow, workerId: worker.workerId,
        workerLifetime: worker.workerLifetime, now: CLOCK.now().toISOString() });
      assert.equal(claimed.state, "claimed");
      if (claimed.state !== "claimed") throw new Error("same-version fixture owner could not claim");
      assert.equal(claimed.run.envelope.runId, WRITE_INTENT_ATTEMPTING.runId);
      const service = new RunRecordService({ database: current, clock: CLOCK, ids: { uuid: randomUUID },
        publishQueued: () => { throw new Error("same-version control must not enqueue"); } });
      const claim = { workerId: worker.workerId, claimGeneration: claimed.run.claimGeneration };
      for (const state of ["validating", "running"] as const) {
        const transition = service.workerTransition({ commandId: randomUUID(), runId: claimed.run.envelope.runId, claim,
          lifecycle: { state, workerId: worker.workerId, workerLifetime: worker.workerLifetime,
            claimedAt: CLOCK.now().toISOString(), heartbeatAt: CLOCK.now().toISOString() } });
        assert.equal(transition.state, "applied");
      }
    } finally { releaseSeededWriteOwners(current, CLOCK.now().toISOString()); current.close(); }
    const restored = AuthorityDatabase.inspectTimelineReadOnly(admissions.get(p.repoRoot)!, p.authorityPath, 500, true)
      .recoveryEvidence?.runs.find(run => run.runId === WRITE_INTENT_ATTEMPTING.runId);
    assert.ok(restored);
    assert.equal(restored.version, preserved.version);
    assert.deepEqual(restored.attemptIds, []);
    const doctor = await composeStorageCommand(rebuildRuntimeIsolation, ["doctor", "--json"], CLOCK, p.repoRoot);
    assert.equal(doctor.exitCode, 1, doctor.output);
    const report = z.object({ spanAuthority: z.object({ state: z.literal("degraded"), problems: z.array(z.object({
      state: z.string(), runId: z.string(), possibleExternalWrite: z.boolean().optional() })) }) }).parse(JSON.parse(doctor.output));
    assert.ok(report.spanAuthority.problems.some((problem) => problem.state === "restore-loss"
      && problem.runId === WRITE_INTENT_ATTEMPTING.runId && problem.possibleExternalWrite === true));
    const wire = z.object({ spanAuthority: z.unknown() }).parse(JSON.parse(doctor.output));
    assert.equal(SpanAuthorityReconciliationWireSchema.safeParse(wire.spanAuthority).success, true);
    const text = await composeStorageCommand(rebuildRuntimeIsolation, ["doctor"], CLOCK, p.repoRoot);
    assert.ok(text.output.includes("newer preserved authority evidence; possibleExternalWrite=true"));
  });

  it.each(["corrupt", "file-symlink", "directory-symlink", "changed-during-read"] as const)(
    "refuses %s preserved authority evidence without leaking supplied content", async (damage) => {
      const p = await paths("ready"); createAuthority(p);
      const directory = join_m0(p.stateRoot, "backups", "suspects");
      const name = "suspect-20260903120000000-87000000-0000-4000-8000-000000000008.sqlite";
      const source = join_m0(directory, name);
      const privateText = "synthetic-preserved-private-value";
      if (damage === "directory-symlink") { mkdirSync(join_m0(p.stateRoot, "backups"), { recursive: true }); symlinkSync(p.backupDirectory, directory); }
      else {
        mkdirSync(directory, { recursive: true });
        if (damage === "file-symlink") symlinkSync(p.authorityPath, source);
        else if (damage === "corrupt") writeFileSync(source, privateText);
        else copyFileSync(p.authorityPath, source);
      }
      const original = AuthorityDatabase.inspectTimelineReadOnly.bind(AuthorityDatabase);
      const spy = vi.spyOn(AuthorityDatabase, "inspectTimelineReadOnly").mockImplementation((admission, path, timeout, recovery) => {
        const result = original(admission, path, timeout, recovery);
        if (damage === "changed-during-read" && path === name) writeFileSync(path, privateText);
        return result;
      });
      try {
        const doctor = await composeStorageCommand(rebuildRuntimeIsolation, ["doctor", "--json"], CLOCK, p.repoRoot);
        assert.equal(doctor.exitCode, 1, doctor.output);
        assert.equal(z.object({ spanAuthority: z.object({ state: z.literal("unavailable") }) }).parse(
          JSON.parse(doctor.output)).spanAuthority.state, "unavailable");
        assert.equal(doctor.output.includes(privateText), false);
      } finally { spy.mockRestore(); }
    });

  it.each(["database count", "file count", "bytes"] as const)("bounds preserved authority %s", async (limit) => {
    const p = await paths("ready"); createAuthority(p);
    const directory = join_m0(p.stateRoot, "backups", "suspects"); mkdirSync(directory, { recursive: true });
    const count = limit === "file count" ? 385 : limit === "database count" ? 129 : 1;
    for (let index = 0; index < count; index++) {
      const name = `suspect-20260903120000000-87000000-0000-4000-8000-${String(index).padStart(12, "0")}.sqlite`;
      const path = join_m0(directory, name);
      writeFileSync(path, "");
      if (limit === "bytes") truncateSync(path, 256 * 1024 * 1024 + 1);
    }
    const doctor = await composeStorageCommand(rebuildRuntimeIsolation, ["doctor", "--json"], CLOCK, p.repoRoot);
    assert.equal(doctor.exitCode, 1, doctor.output);
    const report = z.object({ spanAuthority: z.object({ state: z.literal("unavailable"), cause: z.object({ summary: z.string() }) }) }).parse(JSON.parse(doctor.output));
    assert.equal(report.spanAuthority.cause.summary, `preserved authority ${limit} ${limit === "bytes" ? "exceed" : "exceeds"} the inspection limit`);
  });

  it("accounts a preserved run after explicit deletion without reviving it", async () => {
    const p = await paths("ready"); createAuthority(p);
    const initial = openAuthority({ path: p.authorityPath, busyTimeoutMs: 500, migrationOwner: "deleted-preserved-owner" }, CLOCK);
    try {
      initial.authority.runs.enqueue(QUEUED_RUN);
      createTimelineEmitter({ repository: initial.authority.timelineEvents, clock: CLOCK }).emit(
        runQueuedSpanEvent({ run: RunRecordSchema.parse(QUEUED_RUN), actorId: LOCAL_OPERATOR_ACTOR_ID, title: "Deleted restore owner" }));
      new RunRecordService({ database: initial, clock: CLOCK, ids: { uuid: randomUUID }, publishQueued: () => { throw new Error("fixture must not enqueue"); } }).transition({ commandId: randomUUID(), runId: QUEUED_RUN.envelope.runId, expectedVersion: QUEUED_RUN.version,
        lifecycle: { state: "terminal", outcome: "cancelled", endedAt: CLOCK.now().toISOString() } });
    } finally { initial.close(); }
    const directory = join_m0(p.stateRoot, "backups", "suspects"); mkdirSync(directory, { recursive: true });
    copyFileSync(p.authorityPath, join_m0(directory, "suspect-20260903120000000-87000000-0000-4000-8000-000000000009.sqlite"));
    const current = openAuthority({ path: p.authorityPath, busyTimeoutMs: 500, migrationOwner: "delete-preserved-owner" }, CLOCK);
    try {
      const service = new RunRecordService({ database: current, clock: CLOCK, ids: { uuid: randomUUID }, publishQueued: () => { throw new Error("fixture must not enqueue"); } });
      const run = current.authority.runs.get(QUEUED_RUN.envelope.runId); assert.ok(run);
      assert.equal(service.delete({ runId: run.envelope.runId, expectedVersion: run.version, commandId: randomUUID() }).state, "deleted");
    }
    finally { current.close(); }
    const doctor = await composeStorageCommand(rebuildRuntimeIsolation, ["doctor", "--json"], CLOCK, p.repoRoot);
    assert.equal(doctor.exitCode, 0, doctor.output);
    assert.equal(z.object({ spanAuthority: z.object({ state: z.literal("reconciled") }) }).parse(
      JSON.parse(doctor.output)).spanAuthority.state, "reconciled");
  });

  it("ignores all four retired cleanup-only names through plan/apply without importing or removing values", async () => {
    const p = await paths("pending");
    const retired = ["I9_USER_ID", "I9_PASSWORD", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"];
    const values = retired.map((_, index) => `synthetic-retired-private-${String(index)}`);
    const source = retired.map((name, index) => `${name}=${values[index]}`).join("\n") + "\n";
    const environmentFile = join_m0(p.repoRoot, ".env");
    writeFileSync(environmentFile, source, { mode: 0o600 });
    const before = readdirSync(p.repoRoot);
    const plan = await composeStorageCommand(rebuildRuntimeIsolation, ["upgrade", "--plan", "--json"], CLOCK, p.repoRoot);
    assert.equal(plan.exitCode, 0, plan.output);
    const planned = z.object({ credentials: z.literal("unchanged") }).parse(JSON.parse(plan.output));
    assert.equal(planned.credentials, "unchanged");
    assert.deepEqual(readdirSync(p.repoRoot), before);
    const applied = await composeStorageCommand(rebuildRuntimeIsolation, ["upgrade", "--json"], CLOCK, p.repoRoot);
    assert.equal(applied.exitCode, 0, applied.output);
    assert.deepEqual(JSON.parse(applied.output), { ...JSON.parse(plan.output), state: "initialized" });
    const admission = admissions.get(p.repoRoot); assert.ok(admission);
    AuthorityDatabase.inspectStoppedUpgrade(admission, p.authorityPath, join_m0(p.repoRoot, rebuildRuntimeIsolation.processLockRoot), CLOCK);
    const database = new DatabaseSync(p.authorityPath, { readOnly: true });
    try { assert.deepEqual(database.prepare("SELECT * FROM settings").all(), []); }
    finally { database.close(); }
    assert.equal(existsSync(join_m0(p.stateRoot, "credentials")), false);
    const profile = profiles.find(value => value.workspace === p.repoRoot); assert.ok(profile);
    await profile.finish();
    admissions.set(p.repoRoot, profile.admission);
    assert.equal(boundProfileCredentials(profile.admission).read().revision, 2);
    const backup = await composeStorageCommand(rebuildRuntimeIsolation, ["backup", "--json"], CLOCK, p.repoRoot);
    assert.equal(backup.exitCode, 0, backup.output);
    for (const value of values) {
      assert.equal([plan.output, applied.output, backup.output].some((output) => output.includes(value)), false);
      assert.equal(readFileSync(p.authorityPath).includes(Buffer.from(value)), false);
      for (const name of readdirSync(p.backupDirectory)) assert.equal(readFileSync(join_m0(p.backupDirectory, name)).includes(Buffer.from(value)), false);
    }
    const settled = readFileSync(p.authorityPath);
    const repeat = await composeStorageCommand(rebuildRuntimeIsolation, ["upgrade", "--json"], CLOCK, p.repoRoot);
    assert.equal(repeat.exitCode, 0, repeat.output);
    assert.equal(z.object({ state: z.literal("already-upgraded") }).parse(JSON.parse(repeat.output)).state, "already-upgraded");
    assert.deepEqual(readFileSync(p.authorityPath), settled);
    assert.equal(readFileSync(environmentFile, "utf8"), source);
    writeFileSync(environmentFile, source, { mode: 0o600 });
    assert.equal(readFileSync(environmentFile, "utf8"), source);
  });
  it("ignores invalid retired migration values without reading or echoing them", async () => {
    const p = await paths(); const source = "HRAUTO_DEFAULT_WORKERS=synthetic-invalid-private-input\n";
    writeFileSync(join_m0(p.repoRoot, ".env"), source, { mode: 0o600 });
    const result = await composeStorageCommand(rebuildRuntimeIsolation, ["upgrade", "--plan", "--json"], CLOCK, p.repoRoot);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(z.object({state:z.literal("planned"),credentials:z.literal("unchanged")}).parse(JSON.parse(result.output)),{state:"planned",credentials:"unchanged"});
    assert.equal(result.output.includes("synthetic-invalid-private-input"), false); assert.equal(existsSync(p.stateRoot), false);
    assert.equal(readFileSync(join_m0(p.repoRoot, ".env"), "utf8"), source);
  });
  it.each(["--force", "--skip-backup", "--allow-mixed"])("refuses unsupported upgrade flag %s before touching the root", async (flag) => {
    const p = await paths(); const before = readdirSync(p.repoRoot);
    const result = await composeStorageCommand(rebuildRuntimeIsolation, ["upgrade", flag], CLOCK, p.repoRoot);
    assert.equal(result.exitCode, 2); assert.ok(result.output.includes(flag)); assert.deepEqual(readdirSync(p.repoRoot), before);
  });
  it("writes exactly one verified backup and manifest at the live generation", async () => {
    const p = await paths("ready");
    const generation = createAuthority(p);
    assert.equal(existsSync(p.backupDirectory), false, "no backup exists before the operator asks");

    const outcome = await composeStorageCommand(rebuildRuntimeIsolation, ["backup"], CLOCK, p.repoRoot);
    assert.equal(outcome.exitCode, 0, outcome.output);
    assert.match(outcome.output, /^backup: verified — authority-g\d+-/u);

    const entries = readdirSync(p.backupDirectory).sort();
    assert.equal(entries.length, 2, entries.join(", "));
    const manifestName = entries.find((name) => name.endsWith(".manifest.json"));
    const backupName = entries.find((name) => name.endsWith(".sqlite"));
    assert.ok(manifestName !== undefined && backupName !== undefined, entries.join(", "));
    assert.equal(manifestName, `${backupName}.manifest.json`);
    assert.ok(outcome.output.includes(backupName));
    const manifest = ManifestGenerationSchema.parse(
      JSON.parse(readFileSync(join_m0(p.backupDirectory, manifestName), "utf8")),
    );
    assert.equal(manifest.authorityGeneration, generation);
    // No temporary file survives a completed run.
    assert.deepEqual(entries.filter((name) => name.endsWith(".tmp")), []);
  });

  it("refuses when no authority database exists and creates nothing", async () => {
    const p = await paths();
    const outcome = await composeStorageCommand(rebuildRuntimeIsolation, ["backup"], CLOCK, p.repoRoot);
    assert.equal(outcome.exitCode, 1);
    assert.match(outcome.output, /storage backup REFUSED — no authority database exists/u);
    assert.equal(existsSync(p.authorityPath), false, "a refused backup must not mint an authority");
    assert.equal(existsSync(p.backupDirectory), false);
  });

  it("lets the doctor exit 0 on a healthy reconciled authority with no backup, reporting it missing", async () => {
    const p = await paths("ready");
    createAuthority(p);
    const doctor = await composeStorageCommand(rebuildRuntimeIsolation, ["doctor"], CLOCK, p.repoRoot);
    assert.equal(doctor.exitCode, 0, doctor.output);
    assert.match(doctor.output, /^authority: healthy/mu);
    assert.match(doctor.output, /^backup: MISSING/mu);

    await composeStorageCommand(rebuildRuntimeIsolation, ["backup"], CLOCK, p.repoRoot);
    const after = await composeStorageCommand(rebuildRuntimeIsolation, ["doctor"], CLOCK, p.repoRoot);
    assert.equal(after.exitCode, 0, after.output);
    assert.match(after.output, /^backup: current/mu);
  });
  it.each(["missing", "malformed"])("refuses %s established credentials without restore writes", async (credentialState) => {
    const p = await paths("ready"); createAuthority(p);
    const backup = await composeStorageCommand(rebuildRuntimeIsolation, ["backup"], CLOCK, p.repoRoot);
    assert.equal(backup.exitCode, 0, backup.output);
    const manifest = readdirSync(p.backupDirectory).find((name) => name.endsWith(".manifest.json"));
    assert.ok(manifest);
    const credentialPath = join_m0(p.stateRoot, "credentials", "protected.json");
    const admission = admissions.get(p.repoRoot); assert.ok(admission);
    assert.equal(boundProfileCredentials(admission).read().revision, 2);
    assert.ok(existsSync(credentialPath));
    const profile = profiles.find(value => value.workspace === p.repoRoot); assert.ok(profile);
    const keyPath = join_m0(profile.machine.stateRoot, "machine", "credential-keys", `${admission.profileBinding.profileId}.json`);
    const keyBytes = readFileSync(keyPath);
    rmSync(credentialPath);
    if (credentialState === "malformed") {
      writeFileSync(credentialPath, "synthetic-malformed-credential-canary", { mode: 0o600 });
    }
    const fileBytes = (path: string) => existsSync(path) ? readFileSync(path) : undefined;
    const before = [p.authorityPath, `${p.authorityPath}-wal`, `${p.authorityPath}-shm`,
        join_m0(p.repoRoot, ".tracker/control/profile-registry.json"), credentialPath].map(fileBytes);
    const entries = readdirSync(p.stateRoot).sort();
    const backupBytes = Object.fromEntries(readdirSync(p.backupDirectory).map(name => [name, readFileSync(join_m0(p.backupDirectory, name))]));
    if (credentialState === "missing") {
      const restored = await composeStorageCommand(rebuildRuntimeIsolation,
        ["restore", "--from", join_m0(p.backupDirectory, manifest), "--json"], CLOCK, p.repoRoot);
      assert.equal(restored.exitCode, 1);
      assert.match(restored.output, /authority restore REFUSED — credential-established-document-required/u);
      const after = [p.authorityPath, `${p.authorityPath}-wal`, `${p.authorityPath}-shm`,
      join_m0(p.repoRoot, ".tracker/control/profile-registry.json"), credentialPath].map(fileBytes);
      assert.equal(after.every((bytes, index) => bytes === undefined ? before[index] === undefined : before[index] !== undefined && bytes.equals(before[index])), true);
      assert.deepEqual(readdirSync(p.stateRoot).sort(), entries);
      assert.equal(existsSync(credentialPath), false);
      assert.equal(existsSync(join_m0(p.stateRoot, "credentials")), true);
      assert.doesNotThrow(() => admission.assertLive());
      assert.equal(existsSync(join_m0(p.repoRoot, ".tracker/control/journal.json")), false);
      const raw = new DatabaseSync(p.authorityPath, { readOnly: true });
      try { assert.equal(raw.prepare("PRAGMA user_version").get()?.user_version, CURRENT_AUTHORITY_SCHEMA_VERSION); } finally { raw.close(); }
    } else {
      const restored = await composeStorageCommand(rebuildRuntimeIsolation,
        ["restore", "--from", join_m0(p.backupDirectory, manifest), "--json"], CLOCK, p.repoRoot);
      assert.equal(restored.output.includes("synthetic-malformed-credential-canary"), false);
      assert.equal(restored.exitCode, 1);
      assert.match(restored.output, /authority restore REFUSED — credential store protected.json is malformed/u);
      const after = [p.authorityPath, `${p.authorityPath}-wal`, `${p.authorityPath}-shm`,
        join_m0(p.repoRoot, ".tracker/control/profile-registry.json"), credentialPath].map(fileBytes);
      assert.equal(after.every((bytes, index) => bytes === undefined ? before[index] === undefined : before[index] !== undefined && bytes.equals(before[index])), true);
      assert.deepEqual(readdirSync(p.stateRoot).sort(), entries);
      assert.equal(existsSync(join_m0(p.repoRoot, ".tracker/control/journal.json")), false);
      assert.equal(readFileSync(credentialPath, "utf8"), "synthetic-malformed-credential-canary");
    }
    assert.deepEqual(readFileSync(keyPath), keyBytes);
    for (const [name, bytes] of Object.entries(backupBytes)) assert.deepEqual(readFileSync(join_m0(p.backupDirectory, name)), bytes);
    assert.deepEqual(readdirSync(p.backupDirectory).sort(), Object.keys(backupBytes).sort());
  });

});

it.each([false, true])("restore confirmation evidence survives recovery accounting (backup after commit: %s)", async (backupAfterCommit) => {
const rehearsal = createParkedWriteRoundTripTestWorld();
try {
  const harness = await rehearsal.roundTrip();
  const { profile, clock } = harness;
  const p: Paths = { repoRoot: profile.workspace, stateRoot: profile.stateRoot, authorityPath: profile.path,
    backupDirectory: join_m0(profile.stateRoot, "backups", "authority"), renewAfterRestore() {
      const previous = profile.admission;
      const renewed = profile.renewAfterRestore();
      admissions.set(profile.workspace, renewed.admission);
      assert.throws(() => previous.assertLive(), /profile-restore-context-expired|released admission/u);
    } };
  admissions.set(p.repoRoot, profile.admission);
  writeFileSync(join_m0(p.repoRoot, "package.json"), JSON.stringify({ name: "restored-write-resolution", version: "0.1.0" }));
  await harness.park();
  const parked = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
  const intent = rehearsal.parkedIntent(harness.database);
  assert.ok(parked && parked.lifecycle.state === "parked-write");
  assert.ok(intent.status === "parked");
  if (intent.status !== "parked") throw new Error("rehearsal must retain parked write intent");
  const parkedAttempt = WriteAttemptRecordSchema.parse(harness.database.authority.writeAttempts.get(intent.currentAttemptId));
  assert.equal(parkedAttempt.writeAttemptId, intent.currentAttemptId);
  assert.equal(parkedAttempt.runId, parked.envelope.runId);
  assert.equal(parkedAttempt.outcome.state, "parked");
  if (parkedAttempt.outcome.state !== "parked") throw new Error("parked-write-fixture-attempt-required");
  assert.equal(parkedAttempt.outcome.code, "unknown");
  assert.equal(intent.parkedCode, "unknown");
  const proofValue = WriteFixtureProofSchema.parse({ transactionId: "T654321" });
  const node = descriptorRuntimeNodes(writeFixtureDescriptor).find(node => node.id === WRITE_FIXTURE_NODE_ID);
  if (node?.kind !== "transaction") throw new Error("resolution transaction fixture required");
  const settlement = buildCommittedSettlement({ descriptor: writeFixtureDescriptor, nodeId: String(node.id), run: parked, intent,
    commitContract: node.commit.uses, operator: ActorIdSchema.parse("local-operator"), implFingerprint: WRITE_FIXTURE_IMPL_FINGERPRINT,
    proofSource: "operator-attestation", proofValue, outputValue: JsonValueSchema.parse(node.commit.uses.output.parse(Reflect.apply(node.commit.uses.writeSafety.completion.outputFromProof, undefined, [proofValue]))),
    confirmedAt: clock.now().toISOString(), ids: { uuid: randomUUID } });
  const command = rehearsal.resolutionCommand("resolve-write-present", { runId: parked.envelope.runId, expectedVersion: parked.version,
    writeIntentId: intent.writeIntentId, intentGeneration: intent.generation }, {
    proof: { schemaHash: deriveSchemaHash(WriteFixtureProofSchema, "output"), value: proofValue }, evidenceNote: "Synthetic exact occurrence receipt" });
  releaseSeededWriteOwners(harness.database, clock.now().toISOString()); harness.database.close();
  const inspect = (path: string) => withAuthorityDatabaseReadOnly(admissions.get(p.repoRoot)!, path, db => {
    const run = runRecordFromRow(db.prepare("SELECT * FROM runs WHERE id=?").get(WRITE_FIXTURE_RUN_ID));
    const attempt = WriteAttemptRecordSchema.parse(nativeOrdinaryRecordFromRow("write_attempts", db.prepare("SELECT * FROM write_attempts WHERE id=?").get(intent.currentAttemptId)));
    const operation = WriteIntentRecordSchema.parse(nativeOrdinaryRecordFromRow("write_intents", db.prepare("SELECT * FROM write_intents WHERE id=?").get(intent.writeIntentId)));
    return { runId: run.envelope.runId, version: run.version, lifecycle: run.lifecycle.state, claimGeneration: run.claimGeneration,
      attempt, attemptId: attempt.writeAttemptId, outcome: attempt.outcome.state, outcomeCode: attempt.outcome.state === "parked" ? attempt.outcome.code : undefined, operationStatus: operation.status,
      checkpoint: db.prepare("SELECT 1 FROM run_checkpoints WHERE id=?").get(checkpointLookupKey(settlement.checkpoint.workflowId, settlement.checkpoint.itemId, settlement.checkpoint.nodeId, settlement.checkpoint.attempt, settlement.checkpoint.claimGeneration)) !== undefined,
      events: db.prepare("SELECT * FROM timeline_events ORDER BY cursor").all().map(timelineEventFromRow).map(record => record.payload.kind === "span" ? record.payload.event.t : record.payload.kind) };
  }, 500);
  const before = inspect(p.authorityPath);
  assert.equal(before.lifecycle, "parked-write"); assert.equal(before.outcome, "parked"); assert.equal(before.outcomeCode, "unknown");
  let backup = await composeStorageCommand(rebuildRuntimeIsolation, ["backup"], clock, p.repoRoot);
  assert.equal(backup.exitCode, 0, backup.output);
  let manifest = readdirSync(p.backupDirectory).find(name => name.endsWith(".manifest.json")); assert.ok(manifest);
  function resolutionKernel(database: AuthorityDatabase) {
    const active = database.authority.runtimeConfig.get(); assert.ok(active);
    const lifecycle = new RunRecordService({ database, clock, ids: { uuid: randomUUID }, publishQueued: () => { throw new Error("resolution must not enqueue a new run"); } });
    const unused = (): never => { throw new Error("unrelated resolution rehearsal operation"); };
    return createCommandKernel({ authority: database, lifecycle, clock, ids: { uuid: randomUUID }, appVersion: "0.1.0",
      configIdentity: { configFingerprint: active.configFingerprint, configSnapshotId: active.configSnapshotId },
      intakeParser: UNWIRED_INTAKE_PARSER, intakeProjections: NO_INTAKE_PROJECTIONS,
      descriptors: { resolve: id => id === writeFixtureDescriptor.id ? writeFixtureDescriptor : undefined },
      writeResolution: createWriteResolutionExecutor({ authority: database, continuation: testRunContinuation(database, clock),
        descriptors: { resolve: id => id === writeFixtureDescriptor.id ? writeFixtureDescriptor : undefined },
        ids: { uuid: randomUUID }, resolveImplFingerprint: () => WRITE_FIXTURE_IMPL_FINGERPRINT }),
      workerRuntime: { pool: { planPoolWorkerCount: unused, spawnPoolWorker: unused, refreshPoolBrowser: unused, reopenPoolBrowser: unused,
        stopPoolWorker: unused, pausePoolWorker: unused, resumePoolWorker: unused } } });
  }
  const newer = openAuthority({ path: p.authorityPath, busyTimeoutMs: 500, migrationOwner: "known-present-resolution" }, clock);
  try {
    const service = new RunRecordService({ database: newer, clock, ids: { uuid: randomUUID }, publishQueued: () => { throw new Error("test must not enqueue"); } });
    const claim = { workerId: WorkerIdSchema.parse(WRITE_FIXTURE_WORKER_ID), claimGeneration: PositiveIntSchema.parse(before.claimGeneration) };
    const generation = newer.getMeta().authorityGeneration;
    assert.deepEqual(service.retry({ commandId: randomUUID(), runId: before.runId, expectedVersion: before.version,
      runtimeConfig: selectRunRuntime(newer.authority) }, writeFixtureDescriptor), { state: "refused", refusal: { reason: "invalid-state" } });
    assert.equal(newer.getMeta().authorityGeneration, generation);
    assert.throws(() => executeSequencedWriteCommit(newer, { run: { runId: before.runId, expectedVersion: before.version, claim },
      commit: settlement.commit, checkpoint: settlement.checkpoint }, { kind: "advance-running", claim, claimedAt: parked.createdAt,
      port: workerRunLifecyclePort(service) }));
    assert.deepEqual(inspect(p.authorityPath), before);
    assert.equal(newer.getMeta().authorityGeneration, generation);
    const worker = testAdmittedWorker(newer, clock, { path: p.authorityPath, workflow: writeFixtureDescriptor.id, poolIndex: 2, browserSystems: [] });
    assert.equal(newer.authority.runs.claimNext({ workflow: writeFixtureDescriptor.id, workerId: worker.workerId,
      workerLifetime: worker.workerLifetime, now: clock.now().toISOString() }).state, "idle");
    assert.deepEqual(inspect(p.authorityPath), before);
    assert.equal(resolutionKernel(newer).execute(command).state, "applied");
  } finally { releaseSeededWriteOwners(newer, clock.now().toISOString()); newer.close(); }
  const committed = inspect(p.authorityPath);
  assert.equal(committed.version, before.version + 1); assert.equal(committed.attemptId, before.attemptId);
  assert.equal(committed.operationStatus, "committed");
  assert.deepEqual(committed.attempt, parkedAttempt);
  assert.equal(committed.outcome, before.outcome); assert.equal(committed.outcomeCode, "unknown");
  assert.equal(committed.checkpoint, true);
  if (backupAfterCommit) {
    backup = await composeStorageCommand(rebuildRuntimeIsolation, ["backup"], clock, p.repoRoot);
    assert.equal(backup.exitCode, 0, backup.output);
    manifest = readdirSync(p.backupDirectory).filter(name => name.endsWith(".manifest.json")).sort().at(-1); assert.ok(manifest);
  }
  const restore = await composeStorageCommand(rebuildRuntimeIsolation, ["restore", "--from", join_m0(p.backupDirectory, manifest), "--json"], clock, p.repoRoot);
  assert.equal(restore.exitCode, 0, restore.output); p.renewAfterRestore();
  const restoredReport = z.object({ suspectFileName: z.string() }).parse(JSON.parse(restore.output));
  const doctor = await composeStorageCommand(rebuildRuntimeIsolation, ["doctor", "--json"], clock, p.repoRoot);
  const current = inspect(p.authorityPath), preserved = inspect(join_m0(p.stateRoot, "backups", "suspects", restoredReport.suspectFileName));
  assert.deepEqual(current, backupAfterCommit ? committed : before); assert.deepEqual(preserved, committed);
  assert.equal(doctor.exitCode, backupAfterCommit ? 0 : 1, doctor.output);
  if (backupAfterCommit) {
    const healthy = openAuthority({ path: p.authorityPath, busyTimeoutMs: 500, migrationOwner: "restored-resolution-replay" }, clock);
    try {
      const generation = healthy.getMeta().authorityGeneration;
      assert.equal(resolutionKernel(healthy).execute(command).state, "already-applied");
      assert.equal(healthy.getMeta().authorityGeneration, generation);
    } finally { healthy.close(); }
    const accounted = await composeStorageCommand(rebuildRuntimeIsolation, ["doctor", "--json"], clock, p.repoRoot);
    assert.equal(accounted.exitCode, 0, accounted.output);
    assert.deepEqual(inspect(p.authorityPath), committed);
    return;
  }
  const retainedUnknown = inspect(p.authorityPath);
  assert.equal(retainedUnknown.version, before.version);
  assert.equal(retainedUnknown.lifecycle, "parked-write");
  assert.equal(retainedUnknown.outcome, "parked"); assert.equal(retainedUnknown.outcomeCode, "unknown"); assert.equal(retainedUnknown.checkpoint, false);
  const doctorAfter = await composeStorageCommand(rebuildRuntimeIsolation, ["doctor", "--json"], clock, p.repoRoot);
  assert.equal(doctorAfter.exitCode, 1, doctorAfter.output);
  const afterReport = z.object({ spanAuthority: SpanAuthorityReconciliationWireSchema }).parse(JSON.parse(doctorAfter.output));
  assert.equal(afterReport.spanAuthority.state, "degraded");
  if (afterReport.spanAuthority.state !== "degraded") throw new Error("expected restore-loss warning");
  assert.ok(afterReport.spanAuthority.problems.some(problem => problem.state === "restore-loss" && problem.runId === current.runId && problem.possibleExternalWrite === true));
} finally {
  await _afterEachFixture0();
  await rehearsal.cleanup();
}
});

}

describe("storage recover-chatgpt-lock", () => {
  it("clears a dead owner's ChatGPT lock and stage, keeps the record, and refuses a live owner", async () => {
    const root = realpathSync(mkdtempSync(join_m0(tmpdir(), "storage-chatgpt-lock-")));
    try {
      mkdirSync(join_m0(root, rebuildRuntimeIsolation.artifactRoot), { recursive: true, mode: 0o700 });
      const admission = acquireEntrypointAdmission(root, "exclusive");
      try {
        const stateRoot = admission.stateRoot, repository = createChatGptCredentialRepository({ admission, stateRoot });
        const run = () => composeStorageCommand_m0(rebuildRuntimeIsolation, ["recover-chatgpt-lock"], manualClock(new Date("2026-10-15T12:00:00.000Z")), root, admission);
        assert.deepEqual(await run(), { output: "storage recover-chatgpt-lock: no ChatGPT credential lock", exitCode: 0 });
        const record: ChatGptCredentialRecord = { schemaVersion: 1, revision: 1, hostId: `urn:uuid:${randomUUID()}`, clientId: null, registration: null, session: null };
        await repository.withLock(async tx => { tx.replace(record, null); });
        const directory = join_m0(stateRoot, "credentials"), id = randomUUID();
        const lockPath = join_m0(directory, ".chatgpt-account.lock"), stagePath = join_m0(directory, `.chatgpt-account.${id}.tmp`);
        writeFileSync(lockPath, JSON.stringify({ id, pid: 2_147_483_647, identity: { platform: "linux", startToken: "stale" } }), { mode: 0o600 });
        writeFileSync(stagePath, "interrupted account stage", { mode: 0o600 });
        assert.deepEqual(await run(), { output: "storage recover-chatgpt-lock: cleared an abandoned ChatGPT credential lock", exitCode: 0 });
        assert.equal(existsSync(lockPath), false);
        assert.equal(existsSync(stagePath), false);
        assert.deepEqual(repository.read(), record);
        const live = observeProcessIdentity(process.pid);
        if (live.state !== "alive") throw new Error("synthetic test process identity is unavailable");
        writeFileSync(lockPath, JSON.stringify({ id: randomUUID(), pid: process.pid, identity: live.identity }), { mode: 0o600 });
        const refused = await run();
        assert.equal(refused.exitCode, 1);
        assert.match(refused.output, /CHATGPT_CREDENTIAL_BUSY/u);
        assert.equal(existsSync(lockPath), true);
      } finally { admission.release(); }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
