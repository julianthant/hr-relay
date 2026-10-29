import { mkdtempSync, realpathSync, appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, truncateSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { OldBuildRuntimeArtifactsError } from "../../../src/backend/storage/admission/installation.js";
import { RuntimeLifetimeLock, RuntimeAlreadyRunningError, isOfflineMaintenanceOperationActive } from "../../../src/backend/storage/admission/lifetime-lock.js";
import { profileBrowserClosure } from "../../../src/backend/runtime/browser/native-profile-probe.js";
import * as readonlySnapshots from "../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";
import { createBoundProfileFixture, boundProfileCredentials } from "../../support/helpers/admission-fixture.js";
import { AuthorityDatabase as FixtureAuthorityDatabase } from "../../support/helpers/synthetic-database-admission.js";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { testWorkerPorts } from "../../support/fixtures/run-lifecycle-fixtures.js";
import { PERSON_LOOKUP_ACTIVE, personLookupTerminalIdentityEvidence } from "../../support/helpers/run-integration-world.js";
import { fenceWriteFixture } from "../../support/helpers/write-fence-fixture.js";
import { RuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import { resolveConfigWithProvenance } from "../../../src/backend/app/config/resolve.js";
import { initialSettingsFileRecord } from "../../../src/models/config/settings.js";
import { ConfigSnapshotRecordSchema } from "../../../src/models/config/snapshot.js";
import { CONFIG_SNAPSHOT, ATOMIC_WRITE_COMMIT as HISTORICAL_ATOMIC_WRITE_COMMIT, COMMAND_FIXTURES, HASH_A, HASH_B, NOTIFICATION, NOW, UUID_1, UUID_2, UUID_3, UUID_7, UUID_8, WRITE_ATTEMPT, WRITE_INTENT_ATTEMPTING } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { completionFromAuthorization } from "../../../src/models/run/completion.js";
import { currentAtomicWriteFixture, atomicWriteCheckpoint, releaseSeededWriteOwners, seedAtomicWriteOwner } from "../../support/helpers/timeline-write-fixture.js";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it, vi } from "vitest";
import { buildRunResult } from "../../../src/backend/runs/lifecycle/run-result.js";
import type { MonotonicDeadlineScheduler } from "../../../src/backend/runtime/scheduling/deadline-scheduler.js";
import { executePreflightRunner } from "../../../src/models/preflight/preflight.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { ReadActiveStatus } from "../../../src/models/workflows/person-lookup/read-active-status.js";
import {
  deriveRunResultDigest,
  deriveTerminalDependencyDigest,
} from "../../../src/models/run/result.js";
import { RunRecordSchema, type RunRecord } from "../../../src/models/run/record.js";
import { deriveSchemaHash } from "../../../src/models/validation/schema-bound-value.js";
import { TerminalAuthorizationRecordSchema } from "../../../src/models/run/terminal-authorization.js";
import { RunCheckpointRecordSchema } from "../../../src/models/workflow/checkpoint.js";
import { SpanEventWireSchema } from "../../../src/models/events/types.js";
import { TimelineEventRecordSchema } from "../../../src/models/events/timeline.js";
import { RUN_RECORD_JSON_SQL } from "../../../src/backend/storage/sqlite/run-record-row.js";
import { AuthorityDatabase as RealAuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityBackupService, AuthorityBootStore, AuthorityDatabase, AuthorityHealthPreflightRunner, AuthorityMutationUnavailableError, OfflineAuthorityRestoreService, OfflineRestoreFailure, SpanAuthorityRunRootSchema, doctorAuthorityStorage, verifyBackupManifestAtPath } from "../../../src/backend/storage/sqlite/index.js";
import { acquireRuntimeProcessLock } from "../../../src/backend/storage/sqlite/runtime-process-locks.js";
import {
  QUEUED_RUN,
} from "../../support/fixtures/phase1f-run-fixtures.js";
import {
  CURRENT_AUTHORITY_SCHEMA_VERSION,
} from "../../../src/backend/storage/sqlite/migrations.js";
import { PersonLookupCanonicalInput } from "../../../src/workflows/person-lookup/workflow.js";
import { gitVisibleFiles, REPO_ROOT } from "../support/helpers/guard-files.js";
import { personLookupDescriptor } from "../../support/helpers/registered-workflows.js";

const ATOMIC_WRITE_COMMIT = currentAtomicWriteFixture(HISTORICAL_ATOMIC_WRITE_COMMIT);

const roots: string[] = [];
const profiles = new Map<string, Awaited<ReturnType<typeof createBoundProfileFixture>>>();
const initialGenerations = new Map<string, number>();
const databases: AuthorityDatabase[] = [];
const bootStores: AuthorityBootStore[] = [];
const CLOCK = manualClock(new Date(NOW));
const PASSIVE_DEADLINE_SCHEDULER: MonotonicDeadlineScheduler = Object.freeze({
  schedule: () => Object.freeze({ cancel: () => undefined }),
});
const AFTER_NOW = "2026-07-31T17:01:00.000Z";
const SCHEMA_BOUND_VALUE = { schemaHash: HASH_A, value: { verified: true } };
const ARTIFACT_OUTBOX = {
  outboxId: UUID_7,
  artifactId: UUID_8,
  projectionId: "retention-record",
  stableKeyFingerprint: HASH_B,
  keyValues: [{ field: "subject", value: "10456712" }],
  sinkId: "xlsx-retention",
  sourceRunId: UUID_7,
  sourceNodeId: "extract",
  state: "pending",
  payload: SCHEMA_BOUND_VALUE,
  createdAt: NOW,
};
const ACTIVE_STATUS = PERSON_LOOKUP_ACTIVE;

function runningTerminalFixture(
  database: AuthorityDatabase,
  runId: string,
  itemId: string,
  traceId: string,
  nodeId: "active-status" | "crm-dates",
) {
  const path = [...timelineFixtureOwners].find(([, owner]) => owner === database)?.[0];
  assert.ok(path, "terminal fixture requires its owned authority path");
  const authorityPath = timelineFixturePaths.get(path);
  assert.ok(authorityPath);
  const poolIndex = database.authority.workerSlots.list().length + 1;
  testWorkerPorts(database, CLOCK, { path: authorityPath, descriptor: personLookupDescriptor, poolIndex });
  const member = database.authority.workerSlots.list().find((slot) => slot.poolIndex === poolIndex);
  assert.ok(member);
  const workerId = member.workerId;
  const lease = database.authority.workerLeases.get(workerId);
  assert.ok(lease);
  const activeConfig = database.authority.runtimeConfig.get();
  assert.ok(activeConfig);
  database.authority.runs.enqueue({
    ...QUEUED_RUN,
    envelope: {
      ...QUEUED_RUN.envelope,
      configSnapshotId: activeConfig.configSnapshotId,
      configFingerprint: activeConfig.configFingerprint,
      runId,
      itemId,
      traceId,
      workflow: personLookupDescriptor.id,
      descriptorVersion: personLookupDescriptor.version,
      contractFingerprint: personLookupDescriptor.contractFingerprint,
    },
    input: {
      ...QUEUED_RUN.input,
      parsed: {
        schemaHash: deriveSchemaHash(PersonLookupCanonicalInput, "output"),
        protectedBindings: [],
        value: { mode: "search", crmCheck: true, emplId: "10873698", keepNonHdh: false, includeCrmDates: false },
      },
    },
  });
  const claimed = database.authority.runs.claimNext({
    workflow: personLookupDescriptor.id,
    workerId,
    workerLifetime: { membershipRevision: member.membershipRevision, leaseGeneration: lease.leaseGeneration },
    now: NOW,
  });
  if (claimed.state !== "claimed" || claimed.run.envelope.runId !== runId) {
    throw new Error(`terminal recovery fixture did not claim ${runId}`);
  }
  const claim = { workerId, claimGeneration: claimed.run.claimGeneration };
  assert.ok("workerLifetime" in claimed.run.lifecycle && claimed.run.lifecycle.workerLifetime !== undefined);
  const workerLifetime = claimed.run.lifecycle.workerLifetime;
  const validating = database.authority.runs.transition({
    runId,
    expectedVersion: claimed.run.version,
    claim,
    lifecycle: { state: "validating", workerId, workerLifetime, claimedAt: NOW, heartbeatAt: NOW },
    now: NOW,
  });
  if (validating.state !== "applied") throw new Error(`terminal recovery fixture did not validate ${runId}`);
  const running = database.authority.runs.transition({
    runId,
    expectedVersion: validating.run.version,
    claim,
    lifecycle: {
      state: "running",
      workerId,
      workerLifetime,
      claimedAt: NOW,
      heartbeatAt: NOW,
      currentNodeId: nodeId,
    },
    now: NOW,
  });
  if (running.state !== "applied") throw new Error(`terminal recovery fixture did not run ${runId}`);
  return { run: running.run, claim };
}

function seedTerminalAuthority(database: AuthorityDatabase) {
  const failed = runningTerminalFixture(
    database,
    UUID_1,
    UUID_3,
    "pl-170000-aaaa",
    "crm-dates",
  );
  const failure = {
    failureId: UUID_8,
    fingerprint: HASH_B,
    runId: failed.run.envelope.runId,
    traceId: failed.run.envelope.traceId,
    attempt: failed.run.envelope.attempt,
    workflowId: failed.run.envelope.workflow,
    nodeId: "crm-dates",
    taskId: "crm/read-onboarding-dates",
    code: "CRM_UNAVAILABLE",
    summary: "CRM onboarding dates were unavailable",
    transient: true,
    writeState: "not-attempted",
    causeChain: [{
      code: "CRM_UNAVAILABLE",
      summary: "CRM returned an unavailable response",
      role: "primary",
      transient: true,
    }],
    remediation: [{ kind: "retry-when-served", message: "Retry after CRM is available" }],
    occurredAt: NOW,
  } as const;
  const failureAuthorization = {
    kind: "failed" as const,
    runId: failed.run.envelope.runId,
    workflowId: failed.run.envelope.workflow,
    attempt: failed.run.envelope.attempt,
    descriptorVersion: failed.run.envelope.descriptorVersion,
    contractFingerprint: failed.run.envelope.contractFingerprint,
    expectedVersion: failed.run.version,
    claim: failed.claim,
    authorizedAt: NOW,
    failureId: failure.failureId,
  };
  database.terminalizeFailure(personLookupDescriptor, {
    failure,
    authorization: failureAuthorization,
  });

  const done = runningTerminalFixture(
    database,
    UUID_2,
    UUID_7,
    "pl-170001-bbbb",
    "active-status",
  );
  const checkpoint = RunCheckpointRecordSchema.parse({
    workflowId: done.run.envelope.workflow,
    itemId: done.run.envelope.itemId,
    nodeId: "active-status",
    attempt: done.run.envelope.attempt,
    claimGeneration: 1,
    runId: done.run.envelope.runId,
    output: {
      schemaHash: deriveSchemaHash(ReadActiveStatus.output, "output"),
      value: ACTIVE_STATUS,
    },
    descriptorVersion: done.run.envelope.descriptorVersion,
    contractFingerprint: done.run.envelope.contractFingerprint,
    implFingerprint: HASH_A,
    provenance: [{ path: "state", source: "derived", observedAt: NOW, originalObservedAt: NOW }],
    writtenAt: NOW,
  });
  database.authority.runCheckpoints.insert(checkpoint);
  const identityEvidence = personLookupTerminalIdentityEvidence(done.run);
  for (const entry of identityEvidence) {
    if (entry.state === "resolved") database.authority.runCheckpoints.insert(entry.checkpoint);
  }
  const built = buildRunResult(personLookupDescriptor, done.run, [
    ...identityEvidence,
    { state: "resolved", nodeId: "active-status", checkpoint },
    { state: "not-run", nodeId: "crm-dates", reason: "condition-false" },
  ], CLOCK);
  const successAuthorization = {
    kind: "done" as const,
    runId: built.record.runId,
    workflowId: built.record.workflowId,
    attempt: built.record.attempt,
    descriptorVersion: built.record.descriptorVersion,
    contractFingerprint: built.record.contractFingerprint,
    expectedVersion: done.run.version,
    claim: done.claim,
    authorizedAt: NOW,
    resultDigest: built.record.resultDigest,
  };
  database.terminalizeSuccess({
    result: built.record,
    authorization: successAuthorization,
  }, built.authorization);
  return { failure, failureAuthorization, result: built.record, successAuthorization };
}

async function testRoot(configScope: "global" | "profile" = "global"): Promise<string> {
  const profile = await createBoundProfileFixture();
  profiles.set(profile.stateRoot, profile);
  roots.push(profile.workspace);
  admissions.set(profile.stateRoot, profile.admission);
  const database = FixtureAuthorityDatabase.open(databaseOptions(profile.path), CLOCK);
  try {
    const resolved = configScope === "profile" ? resolveConfigWithProvenance(initialSettingsFileRecord().settings,
      { primaryDisplay: null }, CLOCK, { stateRoot: profile.stateRoot, artifactRoot: profile.admission.artifactRoot }) : undefined;
    const snapshot = resolved === undefined ? CONFIG_SNAPSHOT : ConfigSnapshotRecordSchema.parse({
      ...CONFIG_SNAPSHOT, config: resolved.config, fingerprint: resolved.fingerprint, provenance: resolved.provenance,
    });
    if (database.authority.runtimeConfig.get() === undefined) database.authority.runtimeConfig.initialize(snapshot);
    initialGenerations.set(profile.stateRoot, database.getMeta().authorityGeneration);
  } finally { database.close(); }
  return profile.stateRoot;
}
function fixtureFor(path: string) {
  const entry = [...profiles.entries()].find(([root]) => path === root || path.startsWith(root + "/"));
  if (entry === undefined) throw new Error("recovery fixture profile owner missing");
  return entry[1];
}
function processLockRoot(root: string): string { return join(fixtureFor(root).workspace, rebuildRuntimeIsolation.processLockRoot); }
function baselineGeneration(path: string): number {
  const generation = initialGenerations.get(fixtureFor(path).stateRoot);
  assert.ok(generation !== undefined);
  return generation;
}
function renewAfterRestore(path: string): void {
  const profile = fixtureFor(path), old = profile.admission;
  const fresh = profile.renewAfterRestore();
  assert.throws(() => old.assertLive(), /profile-restore-context-expired|released admission/u);
  admissions.set(profile.stateRoot, fresh.admission);
}

function inspectReplacedAuthority(path: string) {
  assert.throws(() => admissionFor(path).assertProfileRuntime(), /profile-restore-context-expired/u);
  const copy = fixtureFor(path).machine.verifiedReadOnlyCopy(path, createHash("sha256").update(readFileSync(path)).digest("hex"));
  try {
    const inspection = AuthorityDatabase.inspectExistingReadOnly(copy, path);
    assert.equal(inspection.schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    return inspection;
  } finally { copy.release(); }
}

function databaseOptions(path: string) {
  return { path, busyTimeoutMs: 100, migrationOwner: "storage-recovery-test" };
}

const admissions = new Map<string, RuntimeAdmission>();
function admissionFor(path: string): RuntimeAdmission {
  const held = [...admissions.entries()].find(([root]) => path === root || path.startsWith(root + "/"))?.[1];
  if (held === undefined) throw new Error("fixture authority has no held native installation owner");
  return held;
}

const timelineFixturePaths = new Map<string, string>();
const timelineFixtureOwners = new Map<string, AuthorityDatabase>();

function openDatabase(path: string): AuthorityDatabase {
  timelineFixturePaths.set(resolve(dirname(path)), path);
  const database = FixtureAuthorityDatabase.open(databaseOptions(path), CLOCK);
  databases.push(database);
  timelineFixtureOwners.set(resolve(dirname(path)),database);
  if (database.authority.runtimeConfig.get() === undefined) database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  return database;
}

function corruptTerminalRun(
  path: string,
  runId: string,
  mutate: ((run: RunRecord) => unknown) | RunRecord,
): void {
  const raw = new DatabaseSync(path);
  const triggers = raw.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger'").all();
  try {
    // Model offline corruption after write-time guards have run while keeping
    // each strict record mismatch independent of an artificial version bump.
    raw.exec("DROP TRIGGER runs_completion_update; DROP TRIGGER runs_completion_immutable");
    const row = raw.prepare(`SELECT ${RUN_RECORD_JSON_SQL} AS record_json FROM runs WHERE id = ?`)
      .get(runId) as { record_json: string } | undefined;
    if (row === undefined) throw new Error(`run ${runId} is absent from corruption fixture`);
    const corrupted = typeof mutate === "function"
      ? mutate(RunRecordSchema.parse(JSON.parse(row.record_json))) as RunRecord
      : RunRecordSchema.parse(mutate);
    const ownerWorkerId = "workerId" in corrupted.lifecycle ? corrupted.lifecycle.workerId : null;
    const heartbeatAt = "heartbeatAt" in corrupted.lifecycle ? corrupted.lifecycle.heartbeatAt : null;
    const { envelope, ...lifecycle } = corrupted;
    raw.prepare(`UPDATE runs SET envelope_json=?, lifecycle_json=?,version=?,claim_generation=?,state=?,outcome=?,
      owner_worker_id=?,heartbeat_at=?,updated_at=? WHERE id=?`).run(JSON.stringify(envelope),JSON.stringify(lifecycle),
      corrupted.version,corrupted.claimGeneration,corrupted.lifecycle.state,
      corrupted.lifecycle.state === "terminal" ? corrupted.lifecycle.outcome : null,ownerWorkerId,heartbeatAt,corrupted.updatedAt,runId);
  } finally {
    restoreMissingTriggers(raw,triggers);
    raw.close();
  }
}

function restoreMissingTriggers(raw: DatabaseSync, triggers: ReturnType<ReturnType<DatabaseSync["prepare"]>["all"]>): void {
  for (const trigger of triggers) {
    assert.equal(typeof trigger.name,"string"); assert.equal(typeof trigger.sql,"string");
    if(raw.prepare("SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name=?").get(String(trigger.name)) === undefined) {
      raw.exec(String(trigger.sql));
    }
  }
}

function openBootStore(path: string): AuthorityBootStore {
  const store = AuthorityBootStore.open(admissionFor(path), databaseOptions(path), CLOCK);
  bootStores.push(store);
  return store;
}

function backupDirectory(root: string): string {
  return join(root, "backups", "authority");
}

/** Offline native evidence corruption; never bypass a production repository owner. */
function createImportedTimelineFixtureWriter(input: { stateRoot: string; clock: typeof CLOCK; pid: number }) {
  return { emit(value: unknown): void {
    const event = SpanEventWireSchema.parse({ ...(value as Record<string, unknown>), pid: input.pid });
    const path = timelineFixturePaths.get(resolve(input.stateRoot));
    if (path === undefined) throw new Error("timeline fixture authority path was not registered");
    const raw = new DatabaseSync(path, { enableForeignKeyConstraints: false });
    try {
      const cursor = Number(raw.prepare("SELECT COALESCE(MAX(cursor),0)+1 AS cursor FROM timeline_events").get()?.cursor);
      const record = TimelineEventRecordSchema.parse({ cursor, schemaVersion: 1, eventId: randomUUID(), workflow: event.workflow,
        scope: "runId" in event ? { kind: "run", runId: event.runId } : { kind: "worker", workerId: event.workerId },
        occurredAt: event.ts, recordedAt: input.clock.now().toISOString(), retentionDate: "2026-07-31",
        source: { kind: "native" }, payload: { kind: "span", event } });
      raw.prepare(`INSERT INTO timeline_events(cursor,id,workflow,run_id,worker_id,kind,occurred_at,recorded_at,
        retention_date,retention_class,payload_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(cursor,record.eventId,
        record.workflow ?? null,"runId" in event ? event.runId : null,"workerId" in event ? event.workerId ?? null : null,
        event.t,event.ts,record.recordedAt,record.retentionDate,
        event.t === "span.ended" && ["failed","interrupted"].includes(event.outcome) ? "protected" : "ordinary",
        JSON.stringify(record));
    } finally { raw.close(); }
  } };
}

function emitQueuedSpan(stateRoot: string, runInput: unknown = QUEUED_RUN, corrupt = false): void {
  const run = RunRecordSchema.parse(runInput);
  const event = SpanEventWireSchema.parse({
    pid: 4242,
    t: "run.queued",
    kind: "run",
    ts: run.envelope.enqueuedAt,
    workflow: run.envelope.workflow,
    runId: run.envelope.runId,
    attempt: run.envelope.attempt,
    traceId: run.envelope.traceId,
    spanPath: run.envelope.traceId,
    itemId: run.envelope.itemId,
    shape: run.envelope.shape,
    priority: run.envelope.priority,
    dryRun: run.envelope.dryRun,
    actorId: "local-operator",
    title: "storage reconciliation fixture",
    descriptorVersion: run.envelope.descriptorVersion,
    contractFingerprint: run.envelope.contractFingerprint,
    resolvedInstance: run.envelope.resolvedInstance,
    configFingerprint: run.envelope.configFingerprint,
    configSnapshotId: run.envelope.configSnapshotId,
  });
  const owner = timelineFixtureOwners.get(resolve(stateRoot));
  if (!corrupt && owner?.authority.runs.get(run.envelope.runId) !== undefined) {
    owner.authority.timelineEvents.append({schemaVersion:1,eventId:randomUUID(),workflow:event.workflow,
      scope:{kind:"run",runId:run.envelope.runId},occurredAt:event.ts,recordedAt:NOW,
      retentionDate:"2026-07-31",source:{kind:"native"},payload:{kind:"span",event}});
  } else {
    createImportedTimelineFixtureWriter({stateRoot,clock:CLOCK,pid:4242}).emit(event);
  }
}

function spanAuthorityRoot(runInput: unknown = QUEUED_RUN) {
  const run = RunRecordSchema.parse(runInput);
  return SpanAuthorityRunRootSchema.parse({
    runId: run.envelope.runId,
    workflow: run.envelope.workflow,
    itemId: run.envelope.itemId,
    traceId: run.envelope.traceId,
    spanPath: run.envelope.traceId,
    parentRunId: run.envelope.parent?.runId,
    shape: run.envelope.shape,
    priority: run.envelope.priority,
    dryRun: run.envelope.dryRun,
    retryOf: run.envelope.retryOf,
    descriptorVersion: run.envelope.descriptorVersion,
    contractFingerprint: run.envelope.contractFingerprint,
    resolvedInstance: run.envelope.resolvedInstance,
    configFingerprint: run.envelope.configFingerprint,
    configSnapshotId: run.envelope.configSnapshotId,
    queuedAt: run.envelope.enqueuedAt,
    reconstructed: false,
    initialAttempt: run.envelope.attempt,
    finalAttempt: run.envelope.attempt,
    streamIssues: [],
  });
}

function manifestPaths(directory: string): string[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".manifest.json"))
    .sort()
    .map((name) => join(directory, name));
}

function restoreOptions(root: string, authorityPath: string, suspects = join(root, "backups", "suspects")) {
  return {
    authorityPath,
    suspectDirectory: suspects,
    busyTimeoutMs: 100,
    processLockRoot: processLockRoot(root),
    };
}

function maintenanceOperation(root: string) {
  return admissionFor(root).acquireOfflineMaintenance();
}

async function createBackup(database: AuthorityDatabase, directory: string) {
  const service = new AuthorityBackupService(admissionFor(directory), database, { directory }, CLOCK);
  const report = await service.request({
    trigger: "operator",
    requiredGeneration: database.getMeta().authorityGeneration,
  });
  const paths = manifestPaths(directory);
  assert.equal(paths.length, report.manifests.length);
  return { report, manifestPath: paths.at(-1) ?? "" };
}

afterEach(async () => {
  timelineFixturePaths.clear();
  timelineFixtureOwners.clear();
  for (const store of bootStores.splice(0)) store.close();
  for (const database of databases.splice(0)) {
    try { releaseSeededWriteOwners(database, CLOCK.now().toISOString()); }
    catch (error) { if (!(error instanceof Error) || error.message !== "database is not open") throw error; }
    database.close();
  }
  admissions.clear();
  for (const profile of profiles.values()) await profile.close();
  profiles.clear(); initialGenerations.clear(); roots.splice(0);
});

describe("verified native online backups", () => {

  it("backs up through the private native handle and self-observes the completed copy", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);

    const { report, manifestPath } = await createBackup(database, directory);
    assert.equal(report.followUpPerformed, false);
    assert.equal(report.finalGeneration, baselineGeneration(root) + 1);
    assert.equal(report.manifests[0].verification.observedFrom, "backup-copy");
    assert.equal(report.manifests[0].verification.authorityGeneration, baselineGeneration(root) + 1);
    const verified = await verifyBackupManifestAtPath(
      admissionFor(manifestPath), manifestPath,
      database.getSourceDatabaseIdentity(),
    );
    assert.equal(verified.manifest.sha256.length, 64);
    assert.equal(verified.manifest.byteSize > 0, true);
    assert.equal(AuthorityDatabase.inspectExistingReadOnly(admissionFor(verified.backupPath), verified.backupPath).authorityGeneration, baselineGeneration(root) + 1);

    database.authority.notifications.create(NOTIFICATION);
    assert.equal(database.getMeta().authorityGeneration, baselineGeneration(root) + 2);
    assert.equal((await verifyBackupManifestAtPath(admissionFor(manifestPath), manifestPath)).manifest.authorityGeneration, baselineGeneration(root) + 1);
  });

  it("coalesces concurrent requests and performs one generation follow-up", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    let copies = 0;
    const source = {
      getMeta: () => database.getMeta(),
      getSourceDatabaseIdentity: () => database.getSourceDatabaseIdentity(),
      onlineBackupTo: async (destinationPath: string) => {
        copies += 1;
        const pages = await database.onlineBackupTo(destinationPath);
        if (copies === 1) database.authority.notifications.create(NOTIFICATION);
        return pages;
      },
    };
    const service = new AuthorityBackupService(admissionFor(directory), source, { directory }, CLOCK);
    const first = service.request({ trigger: "interval", requiredGeneration: 1 });
    const second = service.request({ trigger: "external-write", requiredGeneration: 1 });
    assert.equal(first, second);
    const report = await first;
    assert.equal(report.coalescedRequests, 2);
    assert.equal(report.followUpPerformed, true);
    assert.equal(report.manifests.length, 2);
    assert.equal(report.manifests[0].authorityGeneration, baselineGeneration(root) + 1);
    assert.equal(report.manifests[1].authorityGeneration, baselineGeneration(root) + 2);
    assert.equal(copies, 2);
  });

  it("fails loud and removes its unique temporary target when native backup fails", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    const failingSource = {
      getMeta: () => database.getMeta(),
      getSourceDatabaseIdentity: () => database.getSourceDatabaseIdentity(),
      onlineBackupTo: (destinationPath: string) => {
        mkdirSync(directory, { recursive: true });
        writeFileSync(destinationPath, "partial backup");
        return Promise.reject(new Error("injected native backup failure"));
      },
    };
    const service = new AuthorityBackupService(admissionFor(directory), failingSource, { directory }, CLOCK);
    await assert.rejects(
      service.request({ trigger: "operator", requiredGeneration: 0 }),
      /injected native backup failure/,
    );
    assert.deepEqual(readdirSync(directory), []);
  });

  it("rejects tampered backup bytes and a tampered manifest", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    const { manifestPath } = await createBackup(database, directory);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { backupFileName: string; sha256: string };
    const backupPath = join(directory, manifest.backupFileName);
    appendFileSync(backupPath, "tamper");
    await assert.rejects(verifyBackupManifestAtPath(admissionFor(manifestPath), manifestPath), /byte size does not match/);

    const secondRoot = await testRoot();
    const secondPath = join(secondRoot, "state.db");
    const secondDirectory = backupDirectory(secondRoot);
    const secondDatabase = openDatabase(secondPath);
    const second = await createBackup(secondDatabase, secondDirectory);
    const parsed = JSON.parse(readFileSync(second.manifestPath, "utf8")) as Record<string, unknown>;
    writeFileSync(second.manifestPath, JSON.stringify({
      ...parsed,
      sha256: HASH_B,
    }));
    await assert.rejects(verifyBackupManifestAtPath(admissionFor(second.manifestPath), second.manifestPath), /checksum does not match/);
  });

  it("rejects a native backup whose JSON-valid command record fails its strict schema", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    const corruption = new DatabaseSync(authorityPath);
    corruption.prepare("UPDATE commands SET request_json = ? WHERE id = ?")
      .run(JSON.stringify({ family: "start" }), UUID_1);
    corruption.close();

    await assert.rejects(createBackup(database, directory), /authority table commands failed native record validation/);
    assert.deepEqual(readdirSync(directory), []);
  });
});

describe("fail-closed degraded boot and read-only doctor", () => {
  it("returns span resolutions with the authority identity from their read snapshot", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const database = openDatabase(authorityPath);
    database.authority.runs.enqueue(QUEUED_RUN);
    const authority = AuthorityDatabase.inspectExistingReadOnly(admissionFor(authorityPath), authorityPath);

    const snapshot = AuthorityDatabase.inspectSpanRunAuthorityReadOnly(
      admissionFor(authorityPath), authorityPath,
      [spanAuthorityRoot()],
    );

    assert.deepEqual(snapshot, {
      tombstoneOrdinalFindings: [],
      authorityGeneration: authority.authorityGeneration,
      authorityContentFingerprint: authority.authorityContentFingerprint,
      liveRunCount: 1,
      archivedRunCount: 0,
      missingSpanRunIds: [],
      malformedRecords: [],
      resolutions: [{ state: "live", runId: QUEUED_RUN.envelope.runId }],
    });
  });

  it("uses native run and tombstone queries without retired archive SQL", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const database = openDatabase(authorityPath);
    const secondRun = RunRecordSchema.parse({
      ...QUEUED_RUN,
      envelope: {
        ...QUEUED_RUN.envelope,
        runId: UUID_7,
        itemId: UUID_8,
        traceId: "pl-170000-7777",
      },
    });
    database.authority.runs.enqueue(QUEUED_RUN);
    database.authority.runs.enqueue(secondRun);
    // Captured before the prototype probe and invoked below with its original connection.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const nativePrepare = DatabaseSync.prototype.prepare;
    let rootLookupPrepares = 0;
    const probe = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function countRootLookups(
      this: DatabaseSync,
      sql: string,
    ) {
      if (sql.includes("SELECT * FROM runs ORDER BY id")
        || sql.includes("SELECT * FROM deleted_runs WHERE run_id=?")) {
        rootLookupPrepares += 1;
      }
      return nativePrepare.call(this, sql);
    });
    let snapshot: ReturnType<typeof AuthorityDatabase.inspectSpanRunAuthorityReadOnly>;
    try {
      snapshot = AuthorityDatabase.inspectSpanRunAuthorityReadOnly(
        admissionFor(authorityPath), authorityPath,
        [spanAuthorityRoot(QUEUED_RUN), spanAuthorityRoot(secondRun)],
      );
    } finally {
      probe.mockRestore();
    }

    assert.equal(rootLookupPrepares, 4);
    assert.deepEqual(snapshot.resolutions.map(({ state }) => state), ["live", "live"]);
  });

  it("resolves a span root whose run carries a tombstone as deleted", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const database = openDatabase(authorityPath);
    database.authority.runs.enqueue(QUEUED_RUN);
    const terminal = database.authority.runs.transition({
      runId: QUEUED_RUN.envelope.runId,
      expectedVersion: QUEUED_RUN.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW },
      now: NOW,
    });
    if (terminal.state !== "applied") throw new Error("delete fixture could not terminalize its run");
    database.authority.commands.insert({commandId:UUID_7,requestedAt:NOW,requestedBy:"local-operator",source:"queue",
      family:"run",type:"delete",target:{runId:QUEUED_RUN.envelope.runId,expectedVersion:terminal.run.version}});
    database.authority.runs.delete({
      runId: QUEUED_RUN.envelope.runId, origin: "queue", commandId: UUID_7, cascadeRunIds: [QUEUED_RUN.envelope.runId], now: NOW,
    });

    const snapshot = AuthorityDatabase.inspectSpanRunAuthorityReadOnly(admissionFor(authorityPath), authorityPath, [spanAuthorityRoot()]);

    assert.equal(snapshot.liveRunCount, 0);
    assert.equal(snapshot.archivedRunCount, 0);
    assert.deepEqual(snapshot.missingSpanRunIds, []);
    assert.deepEqual(snapshot.malformedRecords, []);
    assert.deepEqual(snapshot.resolutions, [{
      state: "deleted",
      runId: QUEUED_RUN.envelope.runId,
      workflow: QUEUED_RUN.envelope.workflow,
      traceId: QUEUED_RUN.envelope.traceId,
      origin: "queue",
      commandId: UUID_7,
      deletedAt: NOW,
    }]);
  });

  it("refuses a tombstone whose stored record fails its strict schema", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const database = openDatabase(authorityPath);
    database.authority.runs.enqueue(QUEUED_RUN);
    const terminal = database.authority.runs.transition({
      runId: QUEUED_RUN.envelope.runId,
      expectedVersion: QUEUED_RUN.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW },
      now: NOW,
    });
    if (terminal.state !== "applied") throw new Error("delete fixture could not terminalize its run");
    database.authority.commands.insert({commandId:UUID_7,requestedAt:NOW,requestedBy:"local-operator",source:"queue",
      family:"run",type:"delete",target:{runId:QUEUED_RUN.envelope.runId,expectedVersion:terminal.run.version}});
    database.authority.runs.delete({
      runId: QUEUED_RUN.envelope.runId, origin: "queue", commandId: UUID_7, cascadeRunIds: [QUEUED_RUN.envelope.runId], now: NOW,
    });
    const raw = new DatabaseSync(authorityPath);
    // The tombstone is immutable in authority; only corruption below it can
    // produce this row, so the trigger is dropped to simulate exactly that.
    const deletedTrigger = raw.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND name='deleted_runs_identity'").all();
    raw.exec("DROP TRIGGER deleted_runs_identity");
    raw.prepare("UPDATE deleted_runs SET receipt_json = ? WHERE run_id = ?")
      .run(JSON.stringify({ family: "deleted" }), QUEUED_RUN.envelope.runId);
    restoreMissingTriggers(raw,deletedTrigger);
    raw.close();

    const snapshot = AuthorityDatabase.inspectSpanRunAuthorityReadOnly(admissionFor(authorityPath), authorityPath, [spanAuthorityRoot()]);

    assert.deepEqual(snapshot.resolutions, [{
      state: "malformed",
      runId: QUEUED_RUN.envelope.runId,
      table: "deleted_runs",
      summary: "deletion receipt failed native row or span identity validation",
    }]);
  });

  it("refuses a source commit during read-only snapshot inspection", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const database = openDatabase(authorityPath);
    const baseline = AuthorityDatabase.inspectExistingReadOnly(admissionFor(authorityPath), authorityPath);
    // Capture the unbound method before the probe; invoke it with its actual database receiver.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const nativePrepare = DatabaseSync.prototype.prepare;
    const observation = fixtureFor(root).machine.verifiedReadOnlyCopy(authorityPath, createHash("sha256").update(readFileSync(authorityPath)).digest("hex"));
    const createSnapshot = readonlySnapshots.createReadonlyAuthoritySnapshot;
    let targetSnapshotPath: string | undefined;
    const snapshotProbe = vi.spyOn(readonlySnapshots, "createReadonlyAuthoritySnapshot").mockImplementation(path => {
      const snapshot = createSnapshot(path);
      if (path === authorityPath && targetSnapshotPath === undefined) targetSnapshotPath = snapshot.path;
      return snapshot;
    });
    let injected = false;
    const probe = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function prepareWithCommit(
      this: DatabaseSync,
      sql: string,
    ) {
      if (!injected && targetSnapshotPath !== undefined && sql.startsWith("SELECT schema_version,authority_generation,updated_at")) {
        const source = nativePrepare.call(this, "PRAGMA database_list").all().find(row => row.name === "main");
        if (source?.file !== targetSnapshotPath) return nativePrepare.call(this, sql);
        injected = true;
        database.authority.notifications.create(NOTIFICATION);
      }
      return nativePrepare.call(this, sql);
    });
    try {
      assert.throws(() => AuthorityDatabase.inspectExistingReadOnly(observation, authorityPath), /authority-readonly-source-changed/);
      assert.equal(injected, true);
      assert.equal(database.getMeta().authorityGeneration, baseline.authorityGeneration + 1);
    } finally {
      probe.mockRestore(); snapshotProbe.mockRestore(); observation.release();
    }
  });

  it("refuses a missing span corpus when exact authority proves runs already exist", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const database = openDatabase(authorityPath);
    database.authority.runs.enqueue(QUEUED_RUN);

    const report = await doctorAuthorityStorage(admissionFor(root), {
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: backupDirectory(root),
      maxBackupAgeMs: 60_000,
      busyTimeoutMs: 100,
    }, CLOCK);

    assert.deepEqual(report.spanAuthority, {
      state: "degraded", streamRunCount: 0, liveRunCount: 0, archived: [], deleted: [],
      problems: [{ state: "missing-span", runId: QUEUED_RUN.envelope.runId }],
    });
  });

  it("accepts a missing span corpus only for the exact never-produced authority baseline", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    openDatabase(authorityPath);

    const report = await doctorAuthorityStorage(admissionFor(root), {
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: backupDirectory(root),
      maxBackupAgeMs: 60_000,
      busyTimeoutMs: 100,
    }, CLOCK);

    assert.deepEqual(report.spanAuthority, {
      state: "reconciled",
      streamRunCount: 0,
      liveRunCount: 0,
      archived: [],
      deleted: [],
    });
  });

  it("refuses a symlinked state-root parent before native evidence inspection", async () => {
    const root = await testRoot(); const admission = admissionFor(root);
    const authorityPath = join(root, "state.db"); openDatabase(authorityPath).close();
    const parent = dirname(root); const retained = parent + "-retained";
    renameSync(parent, retained); symlinkSync(retained, parent);
    const evidence = vi.spyOn(AuthorityDatabase, "inspectExistingReadOnly");
    const bytes = readFileSync(join(retained, root.slice(parent.length + 1), "state.db"));
    try {
      await assert.rejects(doctorAuthorityStorage(admission, {
        stateRootTrustAnchor: dirname(parent), stateRoot: root, authorityPath,
        backupDirectory: backupDirectory(root), busyTimeoutMs: 100,
      }, CLOCK), /directory-integrity: credential path ancestry contains a symbolic link/u);
      assert.equal(evidence.mock.calls.length, 0);
      assert.equal(readFileSync(authorityPath).equals(bytes), true);
    } finally { evidence.mockRestore(); rmSync(parent); renameSync(retained,parent); }
  });

  it("refuses an intermediate state-root component replaced by a symlink while the doctor awaits", async () => {
    const root = await testRoot(); const admission = admissionFor(root);
    const authorityPath = join(root, "state.db"); const database = openDatabase(authorityPath);
    database.authority.runs.enqueue(QUEUED_RUN); emitQueuedSpan(root);
    await createBackup(database, backupDirectory(root)); database.close();
    const parent = dirname(root); const retained = parent + "-retained";
    const pending = doctorAuthorityStorage(admission, {
      stateRootTrustAnchor: dirname(parent), stateRoot: root, authorityPath,
      backupDirectory: backupDirectory(root), busyTimeoutMs: 100,
    }, CLOCK);
    renameSync(parent,retained); symlinkSync(retained,parent);
    try { await assert.rejects(pending,/authority changed while the storage doctor awaited external evidence/); }
    finally { rmSync(parent); renameSync(retained,parent); }
  });

  it("refuses a doctor report assembled across different authority snapshots", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    await createBackup(database, directory);

    const pendingDoctor = doctorAuthorityStorage(admissionFor(root), {
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: directory,
      maxBackupAgeMs: 60_000,
      busyTimeoutMs: 100,
    }, CLOCK);
    database.authority.notifications.create(NOTIFICATION);

    await assert.rejects(
      pendingDoctor,
      /authority changed while the storage doctor awaited external evidence/,
    );
  });

  it("performs one broad authority inspection and one span snapshot per doctor run", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    openDatabase(authorityPath);
    const broadProbe = vi.spyOn(AuthorityDatabase, "inspectExistingReadOnly");
    const spanProbe = vi.spyOn(AuthorityDatabase, "inspectSpanRunAuthorityReadOnly");
    const identityProbe = vi.spyOn(AuthorityDatabase, "inspectAuthorityReadIdentityReadOnly");
    let broadCalls: number;
    let spanCalls: number;
    let identityCalls: number;
    try {
      const report = await doctorAuthorityStorage(admissionFor(root), {
        stateRootTrustAnchor: root,
        stateRoot: root,
        authorityPath,
        backupDirectory: backupDirectory(root),
        maxBackupAgeMs: 60_000,
        busyTimeoutMs: 100,
      }, CLOCK);
      assert.equal(report.authority.state, "healthy");
    } finally {
      broadCalls = broadProbe.mock.calls.length;
      spanCalls = spanProbe.mock.calls.length;
      identityCalls = identityProbe.mock.calls.length;
      broadProbe.mockRestore();
      spanProbe.mockRestore();
      identityProbe.mockRestore();
    }

    assert.equal(broadCalls, 1);
    assert.equal(spanCalls, 1);
    assert.equal(identityCalls, 1);
  });

  it("refuses a transient A-to-B-to-A authority swap during span resolution", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const originalPath = join(root, "backups", "authority-a.sqlite");
    const replacementPath = join(root, "replacement-authority.sqlite");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    database.authority.runs.enqueue(QUEUED_RUN);
    emitQueuedSpan(root);
    await createBackup(database, directory);
    database.close();
    copyFileSync(authorityPath, originalPath);
    copyFileSync(authorityPath, replacementPath);
    const replacement = new DatabaseSync(replacementPath);
    try {
      replacement.exec("BEGIN");
      replacement.prepare("INSERT INTO notifications(id,actor_id,dedupe_fingerprint,status,seen_count,version,run_id,payload_json,publications_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,'[]',?,?)")
        .run(NOTIFICATION.notificationId, NOTIFICATION.actorId, NOTIFICATION.dedupeFingerprint, NOTIFICATION.status,
          NOTIFICATION.count, NOTIFICATION.version, null, JSON.stringify(NOTIFICATION), NOTIFICATION.createdAt, NOTIFICATION.updatedAt);
      replacement.prepare("UPDATE database_states SET authority_generation=authority_generation+1,updated_at=?,search_state='invalid',search_generation=NULL WHERE id=1").run(NOW);
      replacement.exec("COMMIT");
    } finally { replacement.close(); }
    const inspectSpanAuthority = RealAuthorityDatabase.inspectSpanRunAuthorityReadOnly.bind(RealAuthorityDatabase);
    let restoredOriginal = false;
    const probe = vi.spyOn(RealAuthorityDatabase, "inspectSpanRunAuthorityReadOnly").mockImplementation(
      (admission, path, runIds, busyTimeoutMs) => {
        const snapshot = inspectSpanAuthority(admission, path, runIds, busyTimeoutMs);
        if (runIds.length > 0) {
          copyFileSync(originalPath, authorityPath);
          restoredOriginal = true;
        }
        return snapshot;
      },
    );
    try {
      const pendingDoctor = doctorAuthorityStorage(admissionFor(root), {
        stateRootTrustAnchor: root,
        stateRoot: root,
        authorityPath,
        backupDirectory: directory,
        maxBackupAgeMs: 60_000,
        busyTimeoutMs: 100,
      }, CLOCK);
      copyFileSync(replacementPath, authorityPath);

      await assert.rejects(
        pendingDoctor,
        /span authority snapshot does not match the storage doctor's initial authority identity/,
      );
      assert.equal(restoredOriginal, true);
    } finally {
      probe.mockRestore();
    }
  });

  it("refuses when an initially degraded authority changes during external verification", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const healthyPath = join(root, "healthy-authority.sqlite");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    await createBackup(database, directory);
    database.close();
    copyFileSync(authorityPath, healthyPath);
    writeFileSync(authorityPath, "corrupt authority before doctor");

    const pendingDoctor = doctorAuthorityStorage(admissionFor(root), {
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: directory,
      maxBackupAgeMs: 60_000,
      busyTimeoutMs: 100,
    }, CLOCK);
    copyFileSync(healthyPath, authorityPath);

    await assert.rejects(
      pendingDoctor,
      /authority changed while the storage doctor awaited external evidence/,
    );
  });

  it("preserves a failed final identity read as named transition evidence", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    openDatabase(authorityPath);
    const identityProbe = vi.spyOn(AuthorityDatabase, "inspectAuthorityReadIdentityReadOnly")
      .mockImplementation(() => {
        throw new Error("injected final authority identity read failure");
      });
    try {
      await assert.rejects(
        doctorAuthorityStorage(admissionFor(root), {
          stateRootTrustAnchor: root,
          stateRoot: root,
          authorityPath,
          backupDirectory: backupDirectory(root),
          maxBackupAgeMs: 60_000,
          busyTimeoutMs: 100,
        }, CLOCK),
        (error: unknown) => {
          if (!(error instanceof Error)) return false;
          assert.match(error.message, /initial=available; final=authority-unavailable/u);
          assert.ok(typeof error.cause === "object" && error.cause !== null);
          const final: unknown = Reflect.get(error.cause, "final");
          assert.ok(typeof final === "object" && final !== null);
          assert.equal(Reflect.get(final, "state"), "unavailable");
          const finalCause: unknown = Reflect.get(final, "cause");
          assert.ok(typeof finalCause === "object" && finalCause !== null);
          assert.equal(Reflect.get(finalCause, "summary"), "injected final authority identity read failure");
          return true;
        },
      );
    } finally {
      identityProbe.mockRestore();
    }
  });

  it("preserves both failed identity reads when degraded evidence changes", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    openDatabase(authorityPath);
    const broadProbe = vi.spyOn(AuthorityDatabase, "inspectExistingReadOnly")
      .mockImplementation(() => { throw new Error("injected broad authority read failure"); });
    const spanProbe = vi.spyOn(AuthorityDatabase, "inspectSpanRunAuthorityReadOnly")
      .mockImplementation(() => { throw new Error("injected span authority read failure"); });
    let identityRead = 0;
    const identityProbe = vi.spyOn(AuthorityDatabase, "inspectAuthorityReadIdentityReadOnly")
      .mockImplementation(() => {
        identityRead += 1;
        throw new Error(identityRead === 1
          ? "injected initial authority identity read failure"
          : "injected final authority identity read failure");
      });
    try {
      await assert.rejects(
        doctorAuthorityStorage(admissionFor(root), {
          stateRootTrustAnchor: root,
          stateRoot: root,
          authorityPath,
          backupDirectory: backupDirectory(root),
          maxBackupAgeMs: 60_000,
          busyTimeoutMs: 100,
        }, CLOCK),
        (error: unknown) => {
          if (!(error instanceof Error)) return false;
          assert.match(error.message, /initial=authority-unavailable; final=authority-unavailable/u);
          assert.ok(typeof error.cause === "object" && error.cause !== null);
          for (const [phase, expected] of [
            ["initial", "injected initial authority identity read failure"],
            ["final", "injected final authority identity read failure"],
          ] as const) {
            const read: unknown = Reflect.get(error.cause, phase);
            assert.ok(typeof read === "object" && read !== null);
            const readCause: unknown = Reflect.get(read, "cause");
            assert.ok(typeof readCause === "object" && readCause !== null);
            assert.equal(Reflect.get(readCause, "summary"), expected);
          }
          return true;
        },
      );
    } finally {
      broadProbe.mockRestore();
      spanProbe.mockRestore();
      identityProbe.mockRestore();
    }
  });

  it("names a span-known run missing from exact live and archived authority", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    openDatabase(authorityPath);
    emitQueuedSpan(root);

    const report = await doctorAuthorityStorage(admissionFor(root), {
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: backupDirectory(root),
      maxBackupAgeMs: 60_000,
      busyTimeoutMs: 100,
    }, CLOCK);

    assert.deepEqual(report.spanAuthority, {
      state: "degraded",
      streamRunCount: 1,
      liveRunCount: 0,
      archived: [],
      deleted: [],
      problems: [{ state: "missing", runId: QUEUED_RUN.envelope.runId }],
    });
  });

  it("classifies priority drift in the exact live task tuple", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const database = openDatabase(authorityPath);
    database.authority.runs.enqueue(QUEUED_RUN);
    emitQueuedSpan(root, {
      ...QUEUED_RUN,
      envelope: { ...QUEUED_RUN.envelope, priority: "interactive" },
    });

    const report = await doctorAuthorityStorage(admissionFor(root), {
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: backupDirectory(root),
      maxBackupAgeMs: 60_000,
      busyTimeoutMs: 100,
    }, CLOCK);

    assert.equal(report.spanAuthority.state, "degraded");
    if (report.spanAuthority.state !== "degraded") throw new Error("live priority drift must degrade reconciliation");
    const problem = report.spanAuthority.problems[0];
    assert.equal(problem?.state, "malformed");
    if (problem?.state !== "malformed") throw new Error("expected live priority mismatch diagnosis");
    assert.equal(problem.table, "runs");
    assert.match(problem.summary, /priority "interactive" does not match runs authority "bulk"/);
  });

  it("classifies a full queued-root tuple that disagrees with its exact live authority", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const database = openDatabase(authorityPath);
    database.authority.runs.enqueue(QUEUED_RUN);
    emitQueuedSpan(root, {
      ...QUEUED_RUN,
      envelope: {
        ...QUEUED_RUN.envelope,
        workflow: "foreign-workflow",
        traceId: "fw-170001-1111",
        attempt: 2,
      },
    }, true);

    const report = await doctorAuthorityStorage(admissionFor(root), {
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: backupDirectory(root),
      maxBackupAgeMs: 60_000,
      busyTimeoutMs: 100,
    }, CLOCK);

    assert.equal(report.spanAuthority.state, "degraded");
    if (report.spanAuthority.state !== "degraded") throw new Error("foreign queued root must degrade reconciliation");
    assert.equal(report.spanAuthority.liveRunCount, 0);
    assert.equal(report.spanAuthority.problems.length, 1);
    const problem = report.spanAuthority.problems[0];
    assert.equal(problem?.state, "malformed");
    if (problem?.state !== "malformed") throw new Error("expected malformed full-tuple diagnosis");
    assert.equal(problem.table, "runs");
    assert.match(problem.summary, /workflow.*foreign-workflow.*person-lookup/);
    assert.match(problem.summary, /traceId.*fw-170001-1111.*pl-170000-2222/);
    assert.match(problem.summary, /finalAttempt 2.*runs authority 1/);
  });

  it("classifies a queued root whose span path is not its frozen trace root", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const database = openDatabase(authorityPath);
    database.authority.runs.enqueue(QUEUED_RUN);
    createImportedTimelineFixtureWriter({ stateRoot: root, clock: CLOCK, pid: 4242 }).emit({
      t: "run.queued",
      kind: "run",
      ts: QUEUED_RUN.envelope.enqueuedAt,
      workflow: QUEUED_RUN.envelope.workflow,
      runId: QUEUED_RUN.envelope.runId,
      attempt: QUEUED_RUN.envelope.attempt,
      traceId: QUEUED_RUN.envelope.traceId,
      spanPath: `${QUEUED_RUN.envelope.traceId}/foreign-root`,
      itemId: QUEUED_RUN.envelope.itemId,
      shape: QUEUED_RUN.envelope.shape,
      priority: QUEUED_RUN.envelope.priority,
      dryRun: QUEUED_RUN.envelope.dryRun,
      actorId: "local-operator",
      title: "malformed root path fixture",
      descriptorVersion: QUEUED_RUN.envelope.descriptorVersion,
      contractFingerprint: QUEUED_RUN.envelope.contractFingerprint,
      resolvedInstance: QUEUED_RUN.envelope.resolvedInstance,
      configFingerprint: QUEUED_RUN.envelope.configFingerprint,
      configSnapshotId: QUEUED_RUN.envelope.configSnapshotId,
    });

    const report = await doctorAuthorityStorage(admissionFor(root), {
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: backupDirectory(root),
      maxBackupAgeMs: 60_000,
      busyTimeoutMs: 100,
    }, CLOCK);

    assert.equal(report.spanAuthority.state, "degraded");
    if (report.spanAuthority.state !== "degraded") throw new Error("foreign root path must degrade reconciliation");
    const problem = report.spanAuthority.problems[0];
    assert.equal(problem?.state, "malformed");
    if (problem?.state !== "malformed") throw new Error("expected malformed root-path diagnosis");
    assert.equal(problem.table, "span_stream");
    assert.match(problem.summary, /root spanPath does not equal traceId/);
  });

  it("classifies task identity that does not remain beneath its exact queued root", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const database = openDatabase(authorityPath);
    database.authority.runs.enqueue(QUEUED_RUN);
    emitQueuedSpan(root);
    createImportedTimelineFixtureWriter({ stateRoot: root, clock: CLOCK, pid: 4242 }).emit({
      t: "span.started",
      kind: "task",
      ts: QUEUED_RUN.envelope.enqueuedAt,
      workflow: QUEUED_RUN.envelope.workflow,
      runId: QUEUED_RUN.envelope.runId,
      attempt: QUEUED_RUN.envelope.attempt,
      traceId: "pl-170003-9999",
      spanPath: "pl-170003-9999/foreign-task#1.1",
      parentSpanPath: "pl-170003-9999",
      name: "foreign-task",
    });

    const report = await doctorAuthorityStorage(admissionFor(root), {
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: backupDirectory(root),
      maxBackupAgeMs: 60_000,
      busyTimeoutMs: 100,
    }, CLOCK);

    assert.equal(report.spanAuthority.state, "degraded");
    if (report.spanAuthority.state !== "degraded") throw new Error("foreign task identity must degrade reconciliation");
    const problem = report.spanAuthority.problems[0];
    assert.equal(problem?.state, "malformed");
    if (problem?.state !== "malformed") throw new Error("expected malformed task-root diagnosis");
    assert.equal(problem.table, "span_stream");
    assert.match(problem.summary, /span\.started.*traceId.*does not match root/);
    assert.match(problem.summary, /spanPath is not beneath the run root spanPath/);
    assert.match(problem.summary, /parentSpanPath is outside the run root spanPath/);
  });

  it("classifies duplicate run.queued roots instead of collapsing them to one live run id", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const database = openDatabase(authorityPath);
    database.authority.runs.enqueue(QUEUED_RUN);
    emitQueuedSpan(root);
    emitQueuedSpan(root);

    const report = await doctorAuthorityStorage(admissionFor(root), {
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: backupDirectory(root),
      maxBackupAgeMs: 60_000,
      busyTimeoutMs: 100,
    }, CLOCK);

    assert.equal(report.spanAuthority.state, "degraded");
    if (report.spanAuthority.state !== "degraded") throw new Error("duplicate queued roots must degrade reconciliation");
    assert.equal(report.spanAuthority.streamRunCount, 2);
    assert.equal(report.spanAuthority.liveRunCount, 0);
    assert.equal(report.spanAuthority.problems.length, 2);
    for (const problem of report.spanAuthority.problems) {
      assert.equal(problem.state, "malformed");
      if (problem.state !== "malformed") throw new Error("expected duplicate-root malformed diagnosis");
      assert.equal(problem.table, "span_stream");
      assert.match(problem.summary, /duplicate run\.queued root/);
    }
  });

  it("classifies queued roots whose item attempts appear out of authority order", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const database = openDatabase(authorityPath);
    const laterRunId = "99999999-0009-4000-8000-999900000099";
    const laterRun = RunRecordSchema.parse({
      ...QUEUED_RUN,
      envelope: {
        ...QUEUED_RUN.envelope,
        runId: laterRunId,
        traceId: "pl-170002-9999",
        attempt: 2,
        enqueuedAt: AFTER_NOW,
      },
      version: 1,
      createdAt: AFTER_NOW,
      updatedAt: AFTER_NOW,
    });
    database.authority.runs.enqueue(QUEUED_RUN);
    database.authority.runs.enqueue(laterRun);
    emitQueuedSpan(root, laterRun);
    emitQueuedSpan(root, QUEUED_RUN);

    const report = await doctorAuthorityStorage(admissionFor(root), {
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: backupDirectory(root),
      maxBackupAgeMs: 60_000,
      busyTimeoutMs: 100,
    }, CLOCK);

    assert.equal(report.spanAuthority.state, "degraded");
    if (report.spanAuthority.state !== "degraded") throw new Error("out-of-order queued roots must degrade reconciliation");
    assert.equal(report.spanAuthority.streamRunCount, 2);
    const problem = report.spanAuthority.problems.find((problem) => "runId" in problem && problem.runId === QUEUED_RUN.envelope.runId);
    assert.equal(problem?.state, "malformed");
    if (problem?.state !== "malformed") throw new Error("expected out-of-order malformed diagnosis");
    assert.equal(problem.table, "span_stream");
    assert.match(problem.summary, /item attempt 1 did not strictly increase after 2/);
  });

  it("accepts a native requeue retaining the immutable run attempt", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const database = openDatabase(authorityPath);
    database.authority.runs.enqueue(QUEUED_RUN);
    emitQueuedSpan(root);
    createImportedTimelineFixtureWriter({ stateRoot: root, clock: CLOCK, pid: 4242 }).emit({
      t: "run.requeued",
      ts: QUEUED_RUN.envelope.enqueuedAt,
      workflow: QUEUED_RUN.envelope.workflow,
      runId: QUEUED_RUN.envelope.runId,
      attempt: QUEUED_RUN.envelope.attempt,
      traceId: QUEUED_RUN.envelope.traceId,
      spanPath: QUEUED_RUN.envelope.traceId,
      cause: "reassign",
      nextAttempt: QUEUED_RUN.envelope.attempt,
    });

    const report = await doctorAuthorityStorage(admissionFor(root), {
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: backupDirectory(root),
      maxBackupAgeMs: 60_000,
      busyTimeoutMs: 100,
    }, CLOCK);

    assert.deepEqual(report.spanAuthority,{state:"reconciled",streamRunCount:1,liveRunCount:1,archived:[],deleted:[]});
  });

  it("names malformed exact task authority instead of selecting another row", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const database = openDatabase(authorityPath);
    database.authority.runs.enqueue(QUEUED_RUN);
    emitQueuedSpan(root);
    const raw = new DatabaseSync(authorityPath);
    raw.prepare("UPDATE runs SET lifecycle_json = ? WHERE id = ?")
      .run(JSON.stringify({ malformed: true }), QUEUED_RUN.envelope.runId);
    raw.close();

    const report = await doctorAuthorityStorage(admissionFor(root), {
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: backupDirectory(root),
      maxBackupAgeMs: 60_000,
      busyTimeoutMs: 100,
    }, CLOCK);

    assert.equal(report.spanAuthority.state, "degraded");
    if (report.spanAuthority.state !== "degraded") throw new Error("malformed task authority must degrade reconciliation");
    assert.equal(report.spanAuthority.streamRunCount, 1);
    assert.equal(report.spanAuthority.liveRunCount, 0);
    assert.deepEqual(report.spanAuthority.archived, []);
    assert.equal(report.spanAuthority.problems.length, 1);
    const problem = report.spanAuthority.problems[0];
    assert.equal(problem?.state, "malformed");
    if (problem?.state !== "malformed") throw new Error("expected exact malformed task diagnosis");
    assert.equal(problem.runId, QUEUED_RUN.envelope.runId);
    assert.equal(problem.table, "runs");
    assert.equal(problem.summary, "runs authority failed its strict native row validation");
  });

  it("rejects NULL/nonterminal partial completion, failure and result settlements read-only", async () => {
    const terminalValue = { schemaHash: HASH_A, value: { complete: true } };
    const partialResult = {
      runId: QUEUED_RUN.envelope.runId,
      attempt: QUEUED_RUN.envelope.attempt,
      workflowId: QUEUED_RUN.envelope.workflow,
      descriptorVersion: QUEUED_RUN.envelope.descriptorVersion,
      contractFingerprint: QUEUED_RUN.envelope.contractFingerprint,
      configFingerprint: QUEUED_RUN.envelope.configFingerprint,
      configSnapshotId: QUEUED_RUN.envelope.configSnapshotId,
      resultSchemaHash: HASH_A,
      result: terminalValue,
      resultDigest: deriveRunResultDigest(terminalValue),
      dependencies: [],
      dependencyDigest: deriveTerminalDependencyDigest([]),
      createdAt: NOW,
    };
    const partialFailure = {
      failureId: UUID_8,
      fingerprint: HASH_B,
      runId: QUEUED_RUN.envelope.runId,
      traceId: QUEUED_RUN.envelope.traceId,
      attempt: QUEUED_RUN.envelope.attempt,
      workflowId: QUEUED_RUN.envelope.workflow,
      code: "UNEXPECTED_PAGE_STATE",
      summary: "The terminal failure transition is missing",
      transient: false,
      writeState: "not-attempted",
      causeChain: [{
        code: "UNEXPECTED_PAGE_STATE",
        summary: "The terminal failure transition is missing",
        role: "primary",
        transient: false,
      }],
      remediation: [{ kind: "code-change", message: "Repair the partial settlement" }],
      occurredAt: NOW,
    };
    const partialAuthorization = {
      kind: "failed",
      runId: QUEUED_RUN.envelope.runId,
      workflowId: QUEUED_RUN.envelope.workflow,
      attempt: QUEUED_RUN.envelope.attempt,
      descriptorVersion: QUEUED_RUN.envelope.descriptorVersion,
      contractFingerprint: QUEUED_RUN.envelope.contractFingerprint,
      expectedVersion: QUEUED_RUN.version,
      claim: { workerId: "worker-1", claimGeneration: 1 },
      authorizedAt: NOW,
      failureId: partialFailure.failureId,
    };
    const cases = [
      {
        name: "completion",
        insert: (raw: DatabaseSync) => {
          raw.exec("DROP TRIGGER runs_completion_update; DROP TRIGGER runs_completion_immutable");
          return raw.prepare("UPDATE runs SET lifecycle_json=json_set(lifecycle_json,'$.completion',json(?))")
            .run(JSON.stringify(completionFromAuthorization(TerminalAuthorizationRecordSchema.parse(partialAuthorization))));
        },
        violation: /authority table runs failed native record validation.*|completion/,
      },
      {
        name: "failure",
        insert: (raw: DatabaseSync) => raw.prepare(`
          INSERT INTO run_failures (id, run_id, fingerprint, code, payload_json, resolution_json, resolution_version, created_at)
          VALUES (?, ?, ?, 'UNEXPECTED_PAGE_STATE', ?, '{"status":"unresolved","version":1}', 1, ?)
        `).run(
          partialFailure.failureId,
          partialFailure.runId,
          partialFailure.fingerprint,
          JSON.stringify(partialFailure),
          NOW,
        ),
        violation: /failures-bind-failed-run/,
      },
      {
        name: "result",
        insert: (raw: DatabaseSync) => raw.prepare(`
          INSERT INTO run_results
            (run_id, workflow, attempt, result_digest, payload_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          partialResult.runId,
          partialResult.workflowId,
          partialResult.attempt,
          partialResult.resultDigest,
          JSON.stringify(partialResult),
          NOW,
        ),
        violation: /terminal-evidence-payload-required/,
      },
    ] as const;

    for (const fixture of cases) {
      const path = join(await testRoot(), "state.db");
      const database = openDatabase(path);
      database.authority.runs.enqueue(QUEUED_RUN);
      database.close();
      const raw = new DatabaseSync(path);
      const triggers = raw.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger'").all();
      fixture.insert(raw);
      restoreMissingTriggers(raw,triggers);
      raw.close();
      assert.throws(
        () => AuthorityDatabase.inspectExistingReadOnly(admissionFor(path), path),
        fixture.violation,
        fixture.name,
      );
    }
  });

  it("degrades read-only for every schema-valid authorization/consequence mismatch in both arms", async () => {
    const commonCases: ReadonlyArray<readonly [string, (run: RunRecord) => unknown]> = [
      ["version", (run) => ({ ...run, version: run.version + 1 })],
      ["claim-generation", (run) => ({ ...run, claimGeneration: run.claimGeneration + 1 })],
      ["lifecycle-state", (run) => ({ ...run, lifecycle: { state: "queued" } })],
      ["outcome", (run) => ({
        ...run,
        lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW },
      })],
      ["ended-at", (run) => ({
        ...run,
        lifecycle: run.lifecycle.state === "terminal"
          ? { ...run.lifecycle, endedAt: AFTER_NOW }
          : run.lifecycle,
      })],
      ["updated-at", (run) => ({ ...run, updatedAt: AFTER_NOW })],
    ];
    const arms = [
      {
        name: "failed",
        runId: UUID_1,
        cases: [
          ...commonCases,
          ["failure-id", (run: RunRecord): unknown => ({
            ...run,
            lifecycle: run.lifecycle.state === "terminal"
              ? { ...run.lifecycle, failureId: UUID_7 }
              : run.lifecycle,
          })] as const,
        ],
      },
      { name: "done", runId: UUID_2, cases: commonCases },
    ] as const;

    for (const arm of arms) {
      const path = join(await testRoot(), "state.db");
      const database = openDatabase(path);
      seedTerminalAuthority(database);
      const originalRun = database.authority.runs.get(arm.runId);
      assert.ok(originalRun);
      database.close();
      corruptTerminalRun(path, arm.runId, originalRun);
      const baseline = AuthorityDatabase.inspectExistingReadOnly(admissionFor(path), path);
      const assertBaseline = (): void => {
        const current = AuthorityDatabase.inspectExistingReadOnly(admissionFor(path), path);
        assert.equal(current.authorityGeneration, baseline.authorityGeneration);
        assert.equal(current.authorityContentFingerprint, baseline.authorityContentFingerprint);
        assert.deepEqual(current.counts, baseline.counts);
        assert.deepEqual(current.tables, baseline.tables);
      };
      for (const [name, mutate] of arm.cases) {
        assertBaseline();
        corruptTerminalRun(path, arm.runId, mutate);
        assert.throws(
          () => AuthorityDatabase.inspectExistingReadOnly(admissionFor(path), path),
          /completion|strict|schema|native record validation/,
          `${arm.name}/${name}`,
        );
        const store = openBootStore(path);
        const report = store.report();
        assert.equal(report.state, "degraded-read-only", `${arm.name}/${name}`);
        if (report.state !== "degraded-read-only") throw new Error("expected degraded terminal authority");
        assert.ok(["authority-invariant", "authority-record-invalid"].includes(report.cause.code), `${arm.name}/${name}: ${report.cause.code}`);
        assert.match(report.cause.summary, /completion|strict|schema|native record validation/);
        store.close();
        bootStores.splice(bootStores.indexOf(store), 1);
        corruptTerminalRun(path, arm.runId, originalRun);
        assertBaseline();
      }
    }
  });

  it("protects every completion field and detects offline consequence corruption", async () => {
    for (const arm of [{ runId: UUID_1, kind: "failed" }, { runId: UUID_2, kind: "done" }]) {
      const path = join(await testRoot(), "state.db");
      const database = openDatabase(path); const seeded = seedTerminalAuthority(database); database.close();
      const raw = new DatabaseSync(path);
      const triggers = raw.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger'").all();
      try {
        for (const [field, value] of [
          ["claim.workerId", "worker-corrupt"], ["expectedVersion", 99], ["authorizedAt", AFTER_NOW],
          [arm.kind === "done" ? "resultDigest" : "failureId", arm.kind === "done" ? HASH_B : UUID_7],
        ] as const) {
          const before = raw.prepare("SELECT lifecycle_json FROM runs WHERE id=?").get(arm.runId);
          assert.throws(() => raw.prepare("UPDATE runs SET lifecycle_json=json_set(lifecycle_json,?,?) WHERE id=?")
            .run(`$.completion.${field}`, value, arm.runId), /completion/);
          assert.deepEqual(raw.prepare("SELECT lifecycle_json FROM runs WHERE id=?").get(arm.runId), before);
        }
        raw.exec("DROP TRIGGER runs_completion_update; DROP TRIGGER runs_completion_immutable");
        if (arm.kind === "done") {
          raw.prepare("UPDATE runs SET lifecycle_json=json_set(lifecycle_json,'$.completion.resultDigest',?) WHERE id=?").run(HASH_B, arm.runId);
        } else {
          raw.exec("DROP TRIGGER run_failures_evidence");
          raw.prepare("UPDATE run_failures SET payload_json=json_set(payload_json,'$.summary','Changed summary') WHERE id=?").run(seeded.failure.failureId);
        }
      } finally { restoreMissingTriggers(raw,triggers); raw.close(); }
      assert.throws(() => AuthorityDatabase.inspectExistingReadOnly(admissionFor(path), path), /run-completion|native record validation|strict|schema/);
      const report = openBootStore(path).report();
      assert.equal(report.state, "degraded-read-only");
    }
    const path = join(await testRoot(), "state.db"); const database = openDatabase(path); database.close();
    const raw = new DatabaseSync(path);
    try { for (const table of ["run_terminal_authorizations", "run_terminal_outbox"]) assert.throws(() => raw.prepare(`SELECT * FROM ${table}`), /no such table/); }
    finally { raw.close(); }
  });

  it("opens corrupt, truncated, newer, foreign-key-invalid, invariant-invalid, and record-invalid files degraded", async () => {
    const root = await testRoot(), path = join(root, "state.db");
    openDatabase(path).close();
    const baseline = readFileSync(path);
    const assertClosedCompanions = () => {
      for (const suffix of ["-wal", "-shm", "-journal"]) assert.equal(existsSync(path + suffix), false);
    };
    assertClosedCompanions();
    const corruptions: ReadonlyArray<readonly [string, () => void]> = [
      ["authority-not-sqlite", () => { writeFileSync(path, "not a sqlite database"); }],
      ["authority-corrupt", () => { truncateSync(path, 128); }],
      ["authority-schema-mismatch", () => {
        const newer = new DatabaseSync(path);
        try { newer.exec(`PRAGMA user_version = ${String(CURRENT_AUTHORITY_SCHEMA_VERSION + 1)}`); }
        finally { newer.close(); }
      }],
      ["authority-foreign-key", () => {
        const badForeignKey = new DatabaseSync(path, { enableForeignKeyConstraints: false });
        try {
          badForeignKey.prepare(`
            INSERT INTO command_audits (id, command_id, payload_json, created_at)
            VALUES (?, ?, ?, ?)
          `).run(UUID_2, UUID_8, JSON.stringify({ invalid: "but valid JSON" }), NOW);
        } finally { badForeignKey.close(); }
      }],
      ["authority-record-invalid", () => {
        const invariantDatabase = openDatabase(path);
        try { invariantDatabase.authority.commands.insert(COMMAND_FIXTURES[0]); }
        finally { invariantDatabase.close(); }
        const badInvariant = new DatabaseSync(path);
        try { badInvariant.prepare("UPDATE commands SET family = ? WHERE id = ?").run("run", UUID_1); }
        finally { badInvariant.close(); }
      }],
      ["authority-record-invalid", () => {
        const recordSchemaDatabase = openDatabase(path);
        try {
          fenceWriteFixture(recordSchemaDatabase, { intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT }, path);
          releaseSeededWriteOwners(recordSchemaDatabase, CLOCK.now().toISOString());
        } finally { recordSchemaDatabase.close(); }
        const badRecordSchema = new DatabaseSync(path);
        try {
          badRecordSchema.prepare("UPDATE write_intents SET payload_json = ? WHERE id = ?")
            .run(JSON.stringify({ status: "attempting" }), WRITE_INTENT_ATTEMPTING.writeIntentId);
        } finally { badRecordSchema.close(); }
      }],
    ];
    for (const [expectedCode, corrupt] of corruptions) {
      assertClosedCompanions();
      writeFileSync(path, baseline);
      assert.deepEqual(readFileSync(path), baseline);
      corrupt();
      assertClosedCompanions();
      const before = readFileSync(path), store = openBootStore(path);
      try {
        const report = store.report();
        assert.equal(report.state, "degraded-read-only", path);
        if (report.state !== "degraded-read-only") throw new Error("expected degraded report");
        assert.equal(report.cause.code, expectedCode, path);
        for (const operation of ["enqueue", "claim", "commit", "control"] as const) {
          assert.throws(
            () => store.requireWritable(operation),
            (error: unknown) => error instanceof AuthorityMutationUnavailableError
              && error.operation === operation
              && error.health.code === expectedCode,
          );
        }
        assert.deepEqual(readFileSync(path), before, `${path} was modified during degraded boot`);
      } finally { store.close(); }
      assertClosedCompanions();
    }
    const doctorPath = path;
    const beforeDoctor = readFileSync(doctorPath);
    const doctor = await doctorAuthorityStorage(admissionFor(root), {
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath: doctorPath,
      backupDirectory: backupDirectory(root),
      maxBackupAgeMs: 60_000,
      busyTimeoutMs: 100,
    }, CLOCK);
    assert.equal(doctor.authority.state, "degraded");
    if (doctor.authority.state !== "degraded") throw new Error("record-invalid authority must degrade doctor");
    assert.equal(doctor.authority.cause.code, "authority-record-invalid");
    assert.deepEqual(readFileSync(doctorPath), beforeDoctor);
  });

  it("reports counts, backup freshness/gap, candidates, and a newer bad manifest without mutation", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    fenceWriteFixture(database, { intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT }, authorityPath);
    seedAtomicWriteOwner(database, ATOMIC_WRITE_COMMIT, authorityPath);
    database.commitWriteAttempt(ATOMIC_WRITE_COMMIT, atomicWriteCheckpoint(ATOMIC_WRITE_COMMIT));
    database.authority.artifactOutbox.insert({...ARTIFACT_OUTBOX,sourceRunId:ATOMIC_WRITE_COMMIT.transaction.runId});
    await createBackup(database, directory);
    const generationBeforeDoctor = database.getMeta().authorityGeneration;
    const report = await doctorAuthorityStorage(admissionFor(root), {
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: directory,
      maxBackupAgeMs: 60_000,
      busyTimeoutMs: 100,
    }, CLOCK);
    assert.equal(report.mode, "read-only");
    assert.equal(report.authority.state, "healthy");
    assert.equal(report.backup.state, "current");
    assert.equal(report.counts.state, "available");
    if (report.counts.state !== "available") throw new Error("doctor counts should be available");
    assert.deepEqual(report.counts.values, {
      pendingCommands: 1,
      unresolvedWriteIntents: 0,
      leases: 1,
      providerReservations: 0,
      artifactOutbox: 1,
    });
    assert.equal(report.restoreCandidates.length, 1);
    assert.equal(database.getMeta().authorityGeneration, generationBeforeDoctor);

    const newestBadPath = join(directory, "newest-bad.manifest.json");
    writeFileSync(newestBadPath, "{ definitely-not-json");
    const future = new Date("2030-08-01T00:00:00.000Z");
    utimesSync(newestBadPath, future, future);
    const badReport = await doctorAuthorityStorage(admissionFor(root), {
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: directory,
      maxBackupAgeMs: 60_000,
      busyTimeoutMs: 100,
    }, CLOCK);
    assert.equal(badReport.backup.state, "invalid");
    assert.equal(badReport.restoreCandidates[0].state, "invalid");
  });

  it("reports a verified restore candidate even when the live authority becomes corrupt", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    await createBackup(database, directory);
    database.close();
    writeFileSync(authorityPath, "corrupted after verified backup");
    const report = await doctorAuthorityStorage(admissionFor(root), {
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: directory,
      maxBackupAgeMs: 60_000,
      busyTimeoutMs: 100,
    }, CLOCK);
    assert.equal(report.authority.state, "degraded");
    assert.equal(report.counts.state, "unavailable");
    assert.equal(report.restoreCandidates.some(({ state }) => state === "verified-compatible"), true);
  });
});

describe("offline exact-backup restore", () => {
  it("consumes the exact issued proof when the wall clock advances before exclusive verification", async () => {
    const root = await testRoot("profile");
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    const { manifestPath } = await createBackup(database, directory);
    database.close();
    const advancingClock = manualClock(new Date(NOW));
    const proof = maintenanceOperation(root);
    advancingClock.advanceWall(1);
    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admissionFor(root), restoreOptions(root, authorityPath), async () => undefined, advancingClock, undefined, boundProfileCredentials(admissionFor(root)));
    await assert.doesNotReject(restore.restore({ manifestPath }, proof));
    renewAfterRestore(root);
  });

  it("preserves nonempty failure, result and immutable same-row completion authority", async () => {
    const root = await testRoot("profile");
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    const seeded = seedTerminalAuthority(database);
    const generation = database.getMeta().authorityGeneration;
    const { manifestPath } = await createBackup(database, directory);
    database.close();

    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admissionFor(root), restoreOptions(root, authorityPath), async () => undefined, CLOCK, undefined, boundProfileCredentials(admissionFor(root)));
    const report = await restore.restore({ manifestPath }, maintenanceOperation(root));
    renewAfterRestore(root);
    assert.equal(report.authorityGeneration, generation);
    const restored = openDatabase(authorityPath);
    assert.deepEqual(restored.authority.failures.get(seeded.failure.failureId), seeded.failure);
    assert.deepEqual(restored.authority.runResults.get(seeded.result.runId), seeded.result);
    assert.deepEqual(
      restored.authority.runs.get(seeded.failure.runId)?.completion,
      completionFromAuthorization(TerminalAuthorizationRecordSchema.parse(seeded.failureAuthorization)),
    );
    assert.deepEqual(
      restored.authority.runs.get(seeded.result.runId)?.completion,
      completionFromAuthorization(TerminalAuthorizationRecordSchema.parse(seeded.successAuthorization)),
    );
  });

  it("preserves the suspect DB and restores authority without resurrecting retired projections", async () => {
    const root = await testRoot("profile");
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const suspects = join(root, "backups", "suspects");
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    const { manifestPath } = await createBackup(database, directory);
    database.authority.notifications.create(NOTIFICATION);
    database.close();
    writeFileSync(`${authorityPath}-wal`, "suspect wal bytes");
    writeFileSync(`${authorityPath}-shm`, "suspect shm bytes");

    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admissionFor(root), restoreOptions(root, authorityPath, suspects), async (stagedPath, restoreAdmission) => {
      const stagedAdmission = admissionFor(stagedPath).stoppedRestoreProjection(stagedPath, restoreAdmission);
      const staged = AuthorityDatabase.openStoppedRestoreProjection(stagedAdmission, databaseOptions(stagedPath), CLOCK);
      assert.equal("projections" in staged,false);
      assert.deepEqual(staged.authority.commands.get(UUID_1),COMMAND_FIXTURES[0]);
      staged.close();
      stagedAdmission.release();
    }, CLOCK, undefined, boundProfileCredentials(admissionFor(root)));
    const report = await restore.restore({ manifestPath }, maintenanceOperation(root));
    assert.equal(report.state, "restored");
    assert.equal(report.authorityGeneration, baselineGeneration(root) + 1);
    assert.equal(existsSync(join(suspects, report.suspectFileName)), true);
    assert.equal(readFileSync(join(suspects, `${report.suspectFileName}-wal`), "utf8"), "suspect wal bytes");
    assert.equal(readFileSync(join(suspects, `${report.suspectFileName}-shm`), "utf8"), "suspect shm bytes");
    assert.equal(existsSync(`${authorityPath}-wal`), false);
    assert.equal(existsSync(`${authorityPath}-shm`), false);
    renewAfterRestore(root);
    const restored = openDatabase(authorityPath);
    assert.deepEqual(restored.authority.commands.get(UUID_1), COMMAND_FIXTURES[0]);
    assert.equal(restored.authority.notifications.get(UUID_3), undefined);
    assert.equal("projections" in restored,false);
  });

  it("refuses a copied unissued operation before preserving or swapping", async () => {
    const root = await testRoot("profile");
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const suspects = join(root, "backups", "suspects");
    const database = openDatabase(authorityPath);
    const { manifestPath } = await createBackup(database, directory);
    database.close();
    const before = readFileSync(authorityPath);
    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admissionFor(root), restoreOptions(root, authorityPath, suspects), async () => undefined, CLOCK, undefined, boundProfileCredentials(admissionFor(root)));
    const proof = maintenanceOperation(root);
    try { await assert.rejects(restore.restore({ manifestPath }, { ...proof }), /offline-maintenance-unissued/u); }
    finally { proof.release(); }
    assert.deepEqual(readFileSync(authorityPath), before);
    assert.equal(existsSync(suspects), false);
  });

  it("refuses old-build worker evidence during a held operation", async () => {
    const root = await testRoot("profile");
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const suspects = join(root, "backups", "suspects");
    const database = openDatabase(authorityPath);
    const { manifestPath } = await createBackup(database, directory);
    database.close();
    const proof = maintenanceOperation(root);
    const worker = acquireRuntimeProcessLock({
      processLockRoot: processLockRoot(root),
      name: "workers",
      workerId: "person-lookup-worker-2",
      pid: process.pid,
    }, CLOCK);
    try {
      const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admissionFor(root), restoreOptions(root, authorityPath, suspects), async () => undefined, CLOCK, undefined, boundProfileCredentials(admissionFor(root)));
      await assert.rejects(
        restore.restore({ manifestPath }, proof),
        OldBuildRuntimeArtifactsError,
      );
      assert.equal(existsSync(suspects), false);
      assert.equal(AuthorityDatabase.inspectExistingReadOnly(admissionFor(authorityPath), authorityPath).authorityGeneration, baselineGeneration(root) + 0);
    } finally {
      worker.release();
    }
  });

  it("refuses released old-build singleton evidence without interpreting its generations", async () => {
    const root = await testRoot("profile");
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const suspects = join(root, "backups", "suspects");
    const database = openDatabase(authorityPath);
    const { manifestPath } = await createBackup(database, directory);
    database.close();
    const authorityBytes = readFileSync(authorityPath);
    const proof = maintenanceOperation(root);
    const server = acquireRuntimeProcessLock({
      processLockRoot: processLockRoot(root),
      name: "server",
      pid: process.pid,
    }, CLOCK);
    assert.equal(server.generation, 2);
    server.release();

    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admissionFor(root), restoreOptions(root, authorityPath, suspects), async () => undefined, CLOCK, undefined, boundProfileCredentials(admissionFor(root)));
    await assert.rejects(
      restore.restore({ manifestPath }, proof),
      OldBuildRuntimeArtifactsError,
    );
    assert.deepEqual(readFileSync(authorityPath), authorityBytes);
    assert.equal(existsSync(suspects), false);
  });

  it("holds exclusive admission through verification and authority replacement", async () => {
    const root = await testRoot("profile");
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const suspects = join(root, "backups", "suspects");
    const database = openDatabase(authorityPath);
    const { manifestPath } = await createBackup(database, directory);
    database.close();
    const proof = maintenanceOperation(root);
    const lifetime = admissionFor(root).lifetime;
    assert.ok(lifetime instanceof RuntimeLifetimeLock);
    let exclusions = 0;
    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admissionFor(root), restoreOptions(root, authorityPath, suspects), async () => {
      proof.assertHeld();
      assert.throws(() => admissionFor(root).beginOfflineMaintenance(), /offline-maintenance-busy/u);
      await assert.rejects(RuntimeLifetimeLock.acquire(lifetime.port), RuntimeAlreadyRunningError);
      exclusions++;
      throw new Error("synthetic-root-exclusion-confirmed");
    }, CLOCK, undefined, boundProfileCredentials(admissionFor(root)));
    await assert.rejects(restore.restore({ manifestPath }, proof), /synthetic-root-exclusion-confirmed/u);
    assert.equal(exclusions, 1);
    assert.equal(AuthorityDatabase.inspectExistingReadOnly(admissionFor(authorityPath), authorityPath).authorityGeneration, baselineGeneration(root) + 0);
  });

  it("does not fall back when the exact newest manifest is bad", async () => {
    const root = await testRoot("profile");
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const suspects = join(root, "backups", "suspects");
    const database = openDatabase(authorityPath);
    await createBackup(database, directory);
    database.close();
    const badManifestPath = join(directory, "newest-bad.manifest.json");
    writeFileSync(badManifestPath, "{ invalid");
    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admissionFor(root), restoreOptions(root, authorityPath, suspects), async () => undefined, CLOCK, undefined, boundProfileCredentials(admissionFor(root)));
    await assert.rejects(
      restore.restore({ manifestPath: badManifestPath }, maintenanceOperation(root)),
    );
    assert.equal(manifestPaths(directory).length, 2);
    assert.equal(existsSync(suspects), false);
    assert.equal(AuthorityDatabase.inspectExistingReadOnly(admissionFor(authorityPath), authorityPath).authorityGeneration, baselineGeneration(root) + 0);
  });

  it("keeps live and suspect recoverable when projection rebuild fails", async () => {
    const root = await testRoot("profile");
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const suspects = join(root, "backups", "suspects");
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    const { manifestPath } = await createBackup(database, directory);
    database.authority.notifications.create(NOTIFICATION);
    database.close();
    const liveGeneration = AuthorityDatabase.inspectExistingReadOnly(admissionFor(authorityPath), authorityPath).authorityGeneration;
    writeFileSync(`${authorityPath}-wal`, "live wal bytes");
    writeFileSync(`${authorityPath}-shm`, "live shm bytes");
    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admissionFor(root), restoreOptions(root, authorityPath, suspects), () => Promise.reject(new Error("injected projection rebuild failure")), CLOCK, undefined, boundProfileCredentials(admissionFor(root)));
    await assert.rejects(
      restore.restore({ manifestPath }, maintenanceOperation(root)),
      /injected projection rebuild failure/,
    );
    assert.equal(AuthorityDatabase.inspectExistingReadOnly(admissionFor(authorityPath), authorityPath).authorityGeneration, liveGeneration);
    assert.equal(readdirSync(suspects).length > 0, true);
    assert.equal(readdirSync(root).some((name) => name.startsWith(".restore-")), false);
  });

  it("leaves live authority untouched on an injected atomic-swap failure", async () => {
    const root = await testRoot("profile");
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const suspects = join(root, "backups", "suspects");
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    const { manifestPath } = await createBackup(database, directory);
    database.authority.notifications.create(NOTIFICATION);
    database.close();
    const liveGeneration = AuthorityDatabase.inspectExistingReadOnly(admissionFor(authorityPath), authorityPath).authorityGeneration;
    writeFileSync(`${authorityPath}-wal`, "live wal bytes");
    writeFileSync(`${authorityPath}-shm`, "live shm bytes");
    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admissionFor(root), restoreOptions(root, authorityPath, suspects), async () => undefined, CLOCK, {
        copyFile: copyFileSync,
        atomicReplace: () => { throw new Error("injected atomic swap failure"); },
      }, boundProfileCredentials(admissionFor(root)));
    await assert.rejects(
      restore.restore({ manifestPath }, maintenanceOperation(root)),
      /injected atomic swap failure/,
    );
    assert.equal(readFileSync(`${authorityPath}-wal`, "utf8"), "live wal bytes");
    assert.equal(readFileSync(`${authorityPath}-shm`, "utf8"), "live shm bytes");
    assert.equal(inspectReplacedAuthority(authorityPath).authorityGeneration, liveGeneration);
    assert.equal(readdirSync(suspects).length > 0, true);
  });

  it("restores a companion when its displacement rename throws after moving it", async () => {
    const root = await testRoot("profile");
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    const { manifestPath } = await createBackup(database, directory);
    database.close();
    writeFileSync(`${authorityPath}-wal`, "live wal bytes");
    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admissionFor(root), restoreOptions(root, authorityPath), async () => undefined, CLOCK, {
        copyFile: copyFileSync,
        atomicReplace: renameSync,
        renamePath: (source, destination) => {
          renameSync(source, destination);
          if (source === `${authorityPath}-wal` && destination.endsWith(".live-companion")) {
            throw new Error("injected displacement error after rename");
          }
        },
      }, boundProfileCredentials(admissionFor(root)));

    let failure: unknown;
    try {
      await restore.restore({ manifestPath }, maintenanceOperation(root));
    } catch (error) {
      failure = error;
    }

    assert.ok(failure instanceof OfflineRestoreFailure);
    assert.equal(failure.authorityState, "unchanged");
    assert.match(failure.message, /injected displacement error after rename/u);
    assert.ok(failure.cause instanceof Error);
    assert.equal(failure.cause.message, "injected displacement error after rename");
    assert.equal(readFileSync(`${authorityPath}-wal`, "utf8"), "live wal bytes");
    assert.equal(readdirSync(root).some((name) => name.endsWith(".live-companion")), false);
  });

  it("reports authority replaced when atomic swap throws after replacing it", async () => {
    const root = await testRoot("profile");
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    const backupGeneration = database.getMeta().authorityGeneration;
    const { manifestPath } = await createBackup(database, directory);
    database.authority.notifications.create(NOTIFICATION);
    database.close();
    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admissionFor(root), restoreOptions(root, authorityPath), async () => undefined, CLOCK, {
        copyFile: copyFileSync,
        atomicReplace: (source, destination) => {
          renameSync(source, destination);
          throw new Error("injected atomic swap error after rename");
        },
      }, boundProfileCredentials(admissionFor(root)));

    let failure: unknown;
    try {
      await restore.restore({ manifestPath }, maintenanceOperation(root));
    } catch (error) {
      failure = error;
    }

    assert.ok(failure instanceof OfflineRestoreFailure);
    assert.equal(failure.authorityState, "replaced");
    assert.match(failure.message, /injected atomic swap error after rename/u);
    assert.ok(failure.cause instanceof Error);
    assert.equal(failure.cause.message, "injected atomic swap error after rename");
    assert.equal(
      inspectReplacedAuthority(authorityPath).authorityGeneration,
      backupGeneration,
    );
  });

  it("reports cleanup-only failure after authority replacement and names the staged path", async () => {
    const root = await testRoot("profile");
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    const { manifestPath } = await createBackup(database, directory);
    database.close();
    let cleanupPath = "";
    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admissionFor(root), restoreOptions(root, authorityPath), async () => undefined, CLOCK, {
        copyFile: copyFileSync,
        atomicReplace: (source, destination) => {
          renameSync(source, destination);
          cleanupPath = `${source}-wal`;
          writeFileSync(cleanupPath, "staged cleanup bytes");
        },
        removePath: (path) => {
          if (path === cleanupPath) throw new Error("injected staged cleanup failure");
          rmSync(path);
        },
      }, boundProfileCredentials(admissionFor(root)));

    let failure: unknown;
    try {
      await restore.restore({ manifestPath }, maintenanceOperation(root));
    } catch (error) {
      failure = error;
    }

    assert.ok(failure instanceof OfflineRestoreFailure);
    assert.equal(failure.authorityState, "replaced");
    assert.match(failure.message, /injected staged cleanup failure/u);
    assert.match(failure.message, new RegExp(cleanupPath, "u"));
    assert.equal(existsSync(cleanupPath), true);
  });

  it("preserves primary failure before staged cleanup failure", async () => {
    const root = await testRoot("profile");
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    const { manifestPath } = await createBackup(database, directory);
    database.close();
    let stagedPath = "";
    const primaryError = new Error("injected primary projection failure");
    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admissionFor(root), restoreOptions(root, authorityPath), async (path) => {
        stagedPath = path;
        throw primaryError;
      }, CLOCK, {
        copyFile: copyFileSync,
        atomicReplace: renameSync,
        removePath: (path) => {
          if (path === stagedPath) throw new Error("injected cleanup after primary failure");
          rmSync(path);
        },
      }, boundProfileCredentials(admissionFor(root)));

    let failure: unknown;
    try {
      await restore.restore({ manifestPath }, maintenanceOperation(root));
    } catch (error) {
      failure = error;
    }

    assert.ok(failure instanceof OfflineRestoreFailure);
    assert.equal(failure.authorityState, "unchanged");
    assert.match(failure.message, /injected primary projection failure/u);
    assert.match(failure.message, /injected cleanup after primary failure/u);
    assert.match(failure.message, new RegExp(stagedPath, "u"));
    assert.ok(failure.cause instanceof AggregateError);
    assert.equal(failure.cause.cause, primaryError);
    assert.equal(failure.cause.errors[0], primaryError);
    assert.equal(existsSync(stagedPath), true);
  });

  it.each([
    { operation: "rename", expectedLiveCompanion: false },
    { operation: "fsync", expectedLiveCompanion: true },
  ] as const)("reports uncertain companion state when rollback $operation fails", async ({
    operation,
    expectedLiveCompanion,
  }) => {
    const root = await testRoot("profile");
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const suspects = join(root, "backups", "suspects");
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    const { manifestPath } = await createBackup(database, directory);
    database.authority.notifications.create(NOTIFICATION);
    database.close();
    const liveAuthorityBytes = readFileSync(authorityPath);
    writeFileSync(`${authorityPath}-wal`, "live wal bytes");
    let swapAttempted = false;
    const rollbackMessage = `injected rollback ${operation} failure`;
    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admissionFor(root), restoreOptions(root, authorityPath, suspects), async () => undefined, CLOCK, {
        copyFile: copyFileSync,
        atomicReplace: () => {
          swapAttempted = true;
          throw new Error("injected atomic swap failure");
        },
        renamePath: (source, destination) => {
          if (operation === "rename" && swapAttempted && source.endsWith(".live-companion")) {
            throw new Error(rollbackMessage);
          }
          renameSync(source, destination);
        },
        removePath: (path) => {
          rmSync(path);
        },
        syncPath: (path) => {
          if (operation === "fsync" && swapAttempted && path === root) {
            throw new Error(rollbackMessage);
          }
        },
      }, boundProfileCredentials(admissionFor(root)));

    let failure: unknown;
    try {
      await restore.restore({ manifestPath }, maintenanceOperation(root));
    } catch (error) {
      failure = error;
    }

    assert.ok(failure instanceof OfflineRestoreFailure);
    assert.equal(String(failure.authorityState), "companion-state-uncertain");
    assert.match(failure.message, /injected atomic swap failure/u);
    assert.match(failure.message, new RegExp(rollbackMessage, "u"));
    assert.ok(failure.cause instanceof AggregateError);
    assert.equal(
      failure.cause.errors.some((error) => error instanceof Error && error.message === rollbackMessage),
      true,
    );
    assert.deepEqual(readFileSync(authorityPath), liveAuthorityBytes);
    assert.equal(existsSync(`${authorityPath}-wal`), expectedLiveCompanion);
    if (expectedLiveCompanion) {
      assert.equal(readFileSync(`${authorityPath}-wal`, "utf8"), "live wal bytes");
    }
    assert.equal(
      readdirSync(root).some((name) => name.endsWith(".live-companion")),
      operation === "rename",
    );
  });

  it("refuses when verified backup bytes mutate during the staged copy", async () => {
    const root = await testRoot("profile");
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    const { manifestPath } = await createBackup(database, directory);
    database.authority.notifications.create(NOTIFICATION);
    database.close();
    const liveBytes = readFileSync(authorityPath);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { backupFileName: string };
    const backupPath = join(directory, manifest.backupFileName);
    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admissionFor(root), restoreOptions(root, authorityPath), async () => undefined, CLOCK, {
        copyFile: (source, destination) => {
          if (source === backupPath) {
            const bytes = readFileSync(source);
            bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff;
            writeFileSync(source, bytes);
          }
          copyFileSync(source, destination);
        },
        atomicReplace: renameSync,
      }, boundProfileCredentials(admissionFor(root)));
    await assert.rejects(
      restore.restore({ manifestPath }, maintenanceOperation(root)),
      /staged restore .* checksum does not match verified manifest/u,
    );
    assert.deepEqual(readFileSync(authorityPath), liveBytes);
  });

  it("classifies post-swap directory fsync failure as authority replaced", async () => {
    const root = await testRoot("profile");
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    const generation = database.getMeta().authorityGeneration;
    const { manifestPath } = await createBackup(database, directory);
    database.close();
    let swapped = false;
    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admissionFor(root), restoreOptions(root, authorityPath), async () => undefined, CLOCK, {
        copyFile: copyFileSync,
        atomicReplace: (source, destination) => {
          renameSync(source, destination);
          swapped = true;
        },
        syncPath: () => {
          if (swapped) throw new Error("injected post-swap directory fsync failure");
        },
      }, boundProfileCredentials(admissionFor(root)));
    await assert.rejects(
      restore.restore({ manifestPath }, maintenanceOperation(root)),
      replacedFailure(/post-swap directory fsync failure/u),
    );
    assert.equal(inspectReplacedAuthority(authorityPath).authorityGeneration, generation);
  });

  it("classifies post-swap report validation failure as authority replaced", async () => {
    const root = await testRoot("profile");
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    const { manifestPath } = await createBackup(database, directory);
    database.close();
    let swapped = false;
    const reportClock = {
      ...CLOCK,
      now: (): Date => swapped ? new Date(Number.NaN) : CLOCK.now(),
    };
    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admissionFor(root), restoreOptions(root, authorityPath), async () => undefined, reportClock, {
        copyFile: copyFileSync,
        atomicReplace: (source, destination) => {
          renameSync(source, destination);
          swapped = true;
        },
      }, boundProfileCredentials(admissionFor(root)));
    await assert.rejects(
      restore.restore({ manifestPath }, maintenanceOperation(root)),
      replacedFailure(/Invalid time value/u),
    );
  });

  it("classifies exact operation release failure after swap as authority replaced", async () => {
    const root = await testRoot("profile"), authorityPath = join(root, "state.db"), directory = backupDirectory(root);
    const owner = admissionFor(root), lifetime = owner.lifetime;
    assert.ok(lifetime instanceof RuntimeLifetimeLock);
    const context = owner.readInstallationContext(); assert.ok(context);
    const journal = join(context.workspace, ".tracker", "control", "journal.json");
    const database = openDatabase(authorityPath), { manifestPath } = await createBackup(database, directory); database.close();
    const operation = maintenanceOperation(root), assertHeld = lifetime.assertOfflineMaintenance.bind(lifetime);
    let replaced = false;
    const failedRelease = vi.spyOn(lifetime, "assertOfflineMaintenance").mockImplementation((owned, workspace) => {
      assertHeld(owned, workspace);
      if (replaced && !existsSync(journal)) throw new Error("synthetic-exact-operation-release-failure");
    });
    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, owner, restoreOptions(root, authorityPath), async () => undefined,
      CLOCK, { copyFile: copyFileSync, atomicReplace(source, target) { renameSync(source, target); replaced = true; } }, boundProfileCredentials(owner));
    try {
      await assert.rejects(restore.restore({ manifestPath }, operation), replacedFailure(/release failed/u));
      assert.equal(isOfflineMaintenanceOperationActive(operation), true);
      await assert.rejects(RuntimeLifetimeLock.acquire(lifetime.port), RuntimeAlreadyRunningError);
      assert.throws(() => lifetime.beginOfflineMaintenance(context.workspace), /offline-maintenance-busy/u);
      assert.throws(() => owner.beginOfflineMaintenance(), /profile-restore-context-expired/u);
      assert.throws(() => owner.assertProfileRuntime());
    } finally { failedRelease.mockRestore(); operation.release(); }
  });

  it("rejects expired, copied, foreign and replayed operations before restore effects", async () => {
    const root = await testRoot("profile"), authorityPath = join(root, "state.db"), directory = backupDirectory(root);
    const suspects = join(root, "backups", "suspects"), owner = admissionFor(root), lifetime = owner.lifetime;
    assert.ok(lifetime instanceof RuntimeLifetimeLock);
    const context = owner.readInstallationContext(); assert.ok(context);
    const database = openDatabase(authorityPath), { manifestPath } = await createBackup(database, directory); database.close();
    const before = readFileSync(authorityPath);
    const service = () => new OfflineAuthorityRestoreService(profileBrowserClosure, admissionFor(root), restoreOptions(root, authorityPath, suspects),
      async () => undefined, CLOCK, undefined, boundProfileCredentials(admissionFor(root)));
    const expired = maintenanceOperation(root); expired.release();
    await assert.rejects(service().restore({ manifestPath }, expired), /offline-maintenance-unissued/u);
    assert.equal(existsSync(suspects), false); assert.deepEqual(readFileSync(authorityPath), before);

    const current = maintenanceOperation(root);
    await assert.rejects(service().restore({ manifestPath }, { ...current }), /offline-maintenance-unissued/u);
    assert.throws(() => RuntimeAdmission.acquireMachine(context.workspace, "shared", lifetime), /offline-maintenance-unissued/u);
    await assert.rejects(RuntimeLifetimeLock.acquire(lifetime.port), RuntimeAlreadyRunningError);
    assert.equal(existsSync(suspects), false); assert.deepEqual(readFileSync(authorityPath), before);
    current.release();

    const foreignWorkspace = realpathSync(mkdtempSync(join(tmpdir(), "relay-foreign-operation-")));
    const foreignRoot = await RuntimeLifetimeLock.acquire(0), foreign = foreignRoot.beginOfflineMaintenance(foreignWorkspace);
    try {
      await assert.rejects(service().restore({ manifestPath }, foreign), /offline-maintenance-unissued/u);
      assert.equal(existsSync(suspects), false); assert.deepEqual(readFileSync(authorityPath), before);
    } finally { foreign.release(); await foreignRoot.close(); rmSync(foreignWorkspace, { recursive: true }); }

    const once = maintenanceOperation(root), firstService = service(), old = admissionFor(root);
    await firstService.restore({ manifestPath }, once);
    renewAfterRestore(root);
    assert.throws(() => old.assertProfileRuntime(), /released admission/u);
    await assert.rejects(firstService.restore({ manifestPath }, once), /released admission/u);
    const after = readdirSync(suspects).length;
    await assert.rejects(service().restore({ manifestPath }, once), /offline-maintenance-unissued/u);
    assert.equal(readdirSync(suspects).length, after);
  });

  it("rejects a checksum-valid restore copy whose authority record is schema-invalid", async () => {
    const root = await testRoot("profile");
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const suspects = join(root, "backups", "suspects");
    const database = openDatabase(authorityPath);
    const { manifestPath } = await createBackup(database, directory);
    database.close();
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown> & { backupFileName: string };
    const backupPath = join(directory, manifest.backupFileName);
    const corruptBackup = new DatabaseSync(backupPath);

    const snapshotTriggers = corruptBackup.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name='settings_snapshots'").all();
    for (const trigger of snapshotTriggers) corruptBackup.exec("DROP TRIGGER " + String(trigger.name));
    corruptBackup.prepare("UPDATE settings_snapshots SET payload_json=? WHERE id=?")
      .run(JSON.stringify({invalid:"schema"}),CONFIG_SNAPSHOT.configSnapshotId);
    restoreMissingTriggers(corruptBackup,snapshotTriggers);
    corruptBackup.close();
    const bytes = readFileSync(backupPath);
    const byteSize = statSync(backupPath).size;
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    writeFileSync(manifestPath, JSON.stringify({
      ...manifest,
      byteSize,
      sha256,
    }));

    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admissionFor(root), restoreOptions(root, authorityPath, suspects), async () => undefined, CLOCK, undefined, boundProfileCredentials(admissionFor(root)));
    await assert.rejects(
      restore.restore({ manifestPath }, maintenanceOperation(root)),
      /settings_snapshots.*native record validation|strict|schema/,
    );
    assert.equal(existsSync(suspects), false);
  });
});

function replacedFailure(message: RegExp): (error: unknown) => boolean {
  return (error: unknown): boolean => error instanceof OfflineRestoreFailure
    && error.authorityState === "replaced"
    && message.test(error.message);
}

describe("authority.health preflight and static recovery boundary", () => {
  it("fails authority.health when a span-known run has no exact authority", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    await createBackup(database, directory);
    emitQueuedSpan(root);
    const runner = new AuthorityHealthPreflightRunner(admissionFor(authorityPath), {
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: directory,
      maxBackupAgeMs: 60_000,
      busyTimeoutMs: 100,
    }, CLOCK);

    const observation = await executePreflightRunner(runner, new AbortController().signal, CLOCK, PASSIVE_DEADLINE_SCHEDULER);

    assert.equal(observation.state, "unhealthy");
    assert.match(observation.summary, /span authority is degraded/);
  });

  it("projects doctor health through the registered authority.health runner", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    await createBackup(database, directory);
    const runner = new AuthorityHealthPreflightRunner(admissionFor(authorityPath), {
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: directory,
      maxBackupAgeMs: 60_000,
      busyTimeoutMs: 100,
    }, CLOCK, boundProfileCredentials(admissionFor(authorityPath)));
    const healthy = await executePreflightRunner(runner, new AbortController().signal, CLOCK, PASSIVE_DEADLINE_SCHEDULER);
    assert.equal(healthy.state, "healthy");

    rmSync(directory, { recursive: true });
    const withoutBackup = await executePreflightRunner(runner, new AbortController().signal, CLOCK, PASSIVE_DEADLINE_SCHEDULER);

    assert.equal(withoutBackup.state, "healthy");
    assert.match(withoutBackup.summary, /backup missing/);
  });

  it("keeps native SQLite use in the reviewed recovery boundaries and bans copy or VACUUM fallbacks", () => {
    const adapterPath = "src/backend/storage/sqlite/authority-database.ts";
    const sqliteBoundaryPaths = [
      "src/backend/storage/sqlite/assistant-authorization.ts",
      "src/backend/storage/sqlite/assistant-model-preference.ts",
      "src/backend/storage/sqlite/authority-database.ts",
      "src/backend/storage/sqlite/backup-inspection.ts",
      "src/backend/storage/sqlite/command-record-row.ts",
      "src/backend/storage/sqlite/explorer-overrides.ts",
      "src/backend/storage/sqlite/failure-resolution.ts",
      "src/backend/storage/sqlite/generated-artifacts.ts",
      "src/backend/storage/sqlite/imported-artifacts.ts",
      "src/backend/storage/sqlite/native-run-deletion.ts",
      "src/backend/storage/sqlite/notification-publications.ts",
      "src/backend/storage/sqlite/profile-local-databases.ts",
      "src/backend/storage/sqlite/readonly-authority-snapshot.ts",
      "src/backend/storage/sqlite/run-record-row.ts",
      "src/backend/storage/sqlite/run-search-index.ts",
      "src/backend/storage/sqlite/run-summaries.ts",
      "src/backend/storage/sqlite/settings-activation.ts",
      "src/backend/storage/sqlite/settings-storage.ts",
      "src/backend/storage/sqlite/timeline-repository.ts",
      "src/backend/storage/sqlite/transaction-selection.ts",
      "src/backend/storage/sqlite/workbook-library-repository.ts",
      "src/backend/storage/sqlite/worker-control.ts",
      "src/backend/storage/sqlite/worker-slots.ts",
    ].sort();
    const sourceFiles = gitVisibleFiles(["src"]).filter(
      (path) => (path.endsWith(".ts") || path.endsWith(".tsx"))
        && existsSync(join(REPO_ROOT, path)),
    );
    const sqliteImports: string[] = [];
    const nativeHandleMentions: string[] = [];
    for (const path of sourceFiles) {
      const source = readFileSync(join(REPO_ROOT, path), "utf8");
      if (/from\s+["']node:sqlite["']/.test(source)) sqliteImports.push(path);
      if (/\bDatabaseSync\b/.test(source)) nativeHandleMentions.push(path);
      assert.doesNotMatch(source, /VACUUM\s+INTO/i, path);
    }
    assert.deepEqual(sqliteImports, sqliteBoundaryPaths);
    assert.deepEqual(nativeHandleMentions, sqliteBoundaryPaths);
    const adapter = readFileSync(join(REPO_ROOT, adapterPath), "utf8");
    const boundarySources = sqliteBoundaryPaths
      .map((path) => readFileSync(join(REPO_ROOT, path), "utf8"))
      .join("\n");
    assert.match(adapter, /backup as sqliteBackup/);
    assert.doesNotMatch(boundarySources, /\bcopyFile(?:Sync)?\b/);
    assert.doesNotMatch(readFileSync(join(REPO_ROOT, "src/backend/storage/sqlite/index.ts"), "utf8"), /DatabaseSync|node:sqlite/);
  });
});
