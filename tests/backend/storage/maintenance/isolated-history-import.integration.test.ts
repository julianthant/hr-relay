import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { composeDashboardRuntime } from "../../../../src/backend/app/composition/dashboard/compose.js";
import { composeProfileRuntime } from "../../../../src/backend/app/composition/storage-compose.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { runQueuedSpanEvent } from "../../../../src/backend/runs/commands/run-queued-span.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { readQueueRecordMembers } from "../../../../src/backend/runs/queries/ocr-record-members.js";
import { ConfigSnapshotIdSchema, LOCAL_OPERATOR_ACTOR_ID, WriteAttemptIdSchema } from "../../../../src/rules/identity/ids.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { initialSettingsFileRecord } from "../../../../src/models/config/settings.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { importIsolatedProfileData } from "../../../../src/backend/storage/maintenance/isolated-library-import.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { AuthorityBackupService } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { withReadonlyAuthoritySnapshot } from "../../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";
import { createTransactionHistory } from "../../../../src/backend/storage/sqlite/transaction-history.js";
import { createDashboardClient } from "../../../../src/dashboard/client/index.js";
import { searchPartitionDay } from "../../../../src/models/dashboard/search-calendar.js";
import { OcrPageReadingSchema } from "../../../../src/models/workflows/ocr/page-accounting.js";
import { manualClock, type Clock } from "../../../../src/rules/time/clock.js";
import { healthyRuntimePreflightRunners } from "../../../support/fixtures/preflight-seams.js";
import { CONFIG_SNAPSHOT, NOTIFICATION } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { boundProfileAdmission } from "../../../support/helpers/admission-fixture.js";
import { runRecordOf } from "../../../support/helpers/backend/dashboard-harness.js";
import { canonicalChildExecution } from "../../../support/helpers/backend/canonical-child-execution.js";
import { createOcrReviewWorld } from "../../../support/helpers/backend/ocr-review-world.js";
import { sessionFactoryHarness, healthyUcpathDriver } from "../../../support/helpers/phase1f-executor-harness.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { createBackupFixtures } from "../../../support/helpers/storage/backup-fixtures.js";
import { historyWorld } from "../../../support/helpers/storage/transaction-history-fixture.js";

const clock = manualClock(new Date("2026-11-23T12:00:00.000Z"));
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { try { for (const close of cleanups.splice(0).reverse()) await close(); } finally { vi.unstubAllGlobals(); } });
const { openCurrentWorld, takeBackup } = createBackupFixtures(cleanups, clock);

function initializeCopyConfig(copy: Awaited<ReturnType<typeof openCurrentWorld>>, at: Clock) {
  const resolved = resolveConfigWithProvenance(initialSettingsFileRecord().settings, hostConfigFacts({}), at,
    { stateRoot: copy.stateRoot, artifactRoot: join(copy.stateRoot, "artifacts") });
  const configSnapshotId = ConfigSnapshotIdSchema.parse(randomUUID());
  copy.database.authority.runtimeConfig.initialize({ ...CONFIG_SNAPSHOT, configSnapshotId,
    fingerprint: resolved.fingerprint, config: resolved.config, provenance: resolved.provenance });
  return { configSnapshotId, fingerprint: resolved.fingerprint };
}

async function openCopyDashboard(copy: Awaited<ReturnType<typeof openCurrentWorld>>, at: Clock) {
  for (const name of ["package.json", "package-lock.json"]) copyFileSync(name, join(copy.workspace, name));
  const runtime = composeProfileRuntime({ admission: copy.machine, clock: at, hostFacts: { primaryDisplay: null } });
  cleanups.push(() => runtime.close());
  const active = runtime.session.signIn({ email: "fixture@ucsd.edu", password: "disposable-fixture-password", at: at.now().toISOString() });
  assert.ok(active.state === "active");
  const lock = copy.admission.lifetime;
  assert.ok(lock instanceof RuntimeLifetimeLock);
  const realFetch = globalThis.fetch, outbound: string[] = [];
  vi.stubGlobal("fetch", ((url, options) => {
    const host = new URL(url instanceof Request ? url.url : url).hostname;
    if (host !== "127.0.0.1") { outbound.push(host); throw new Error("unexpected-external-request"); }
    return realFetch(url, options);
  }) satisfies typeof fetch);
  const spawn = vi.fn(() => { throw new Error("unexpected-worker-start"); });
  const dashboard = await composeDashboardRuntime({ lifetimeLock: lock, admission: copy.machine, profile: { runtime, token: active.token },
    repoRoot: copy.workspace, clock: at, isolation: rebuildRuntimeIsolation, backendPortOverride: 0, frontendPortOverride: 0, env: {},
    preflightRunnerFactory: healthyRuntimePreflightRunners, workerProcess: { spawn } });
  cleanups.push(() => dashboard.stop());
  return { client: createDashboardClient({ baseUrl: `http://127.0.0.1:${String(dashboard.port)}` }), outbound, spawn };
}

it("retains confirmed write evidence for dashboard history without admitting it to the local write sequencer", async () => {
  const source = await historyWorld();
  cleanups.push(() => source.dispose());
  const fixture = source.commit(596);
  const ledger = fixture.commit.transaction;
  source.database.authority.notifications.create({ ...NOTIFICATION, links: [{ kind: "run", runId: ledger.runId }] });
  const active = source.database.authority.runs.get(ledger.runId);
  assert.ok(active?.lifecycle.state === "running");
  expect(source.database.authority.runs.transition({ runId: ledger.runId, expectedVersion: active.version,
    claim: { workerId: active.lifecycle.workerId, claimGeneration: active.claimGeneration }, now: ledger.confirmedAt,
    lifecycle: { state: "parked-gate", gateId: "approval", parkedAt: ledger.confirmedAt, resumeAt: "active-status" } }).state).toBe("applied");
  const admission = boundProfileAdmission(source.path);
  const directory = join(source.root, "backups", "authority");
  const backup = await new AuthorityBackupService(admission, source.database, { directory }, clock)
    .request({ trigger: "schema-migration", requiredGeneration: source.database.getMeta().authorityGeneration });
  const manifest = backup.manifests[0];
  assert.ok(manifest);
  const copy = await openCurrentWorld();
  const privateFiles = () => {
    const folder = join(copy.stateRoot, "credentials");
    const paths = readdirSync(folder, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name));
    paths.push(join(copy.machine.stateRoot, "machine", "profile-verifiers.json"), join(copy.machine.stateRoot, "machine", "profile-pepper"));
    return paths.sort().map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")]);
  };
  const before = privateFiles();
  expect(before.length).toBeGreaterThan(2);
  const report = await importIsolatedProfileData(copy.admission, copy.database, { source: { manifestPath: join(directory, manifest.backupFileName + ".manifest.json"),
    binding: admission.profileBinding }, destination: copy.admission.profileBinding }, clock);
  expect(privateFiles()).toEqual(before);
  const historyPath = join(copy.stateRoot, "files", "imported-history.sqlite");
  const counts = (path: string) => withReadonlyAuthoritySnapshot(path, db => Object.fromEntries([
    "runs", "run_batches", "deleted_runs", "run_delegations", "delegation_dependencies", "run_search",
    "diagnostic_snapshots", "diagnostic_files", "dryrun_results", "ocr_approved_snapshots", "ocr_review_revisions", "run_checkpoints", "gate_results", "write_intents", "write_attempts", "run_results", "run_failures", "run_receipts", "timeline_events", "notifications",
  ].map(name => [name, db.prepare(`SELECT count(*) AS count FROM ${name}`).get()?.count])));
  expect(counts(historyPath)).toEqual(counts(join(directory, manifest.backupFileName)));
  expect(report.history).toMatchObject({ write_intents: 1, write_attempts: 1, notifications: 1 });
  const history = copy.database.dashboardHistory();
  const range = { from: "0001-01-01", to: "9999-12-31" };
  expect(createTransactionHistory(history.authority).query(range).rows).toEqual(source.history.query(range).rows);
  expect(history.authority.notifications.listByActor("local-operator")).toEqual(source.database.authority.notifications.listByActor("local-operator"));
  expect(history.authority.runs.listNonTerminal()).toEqual([]);
  expect(history.authority.runs.listParkedAtGate()).toEqual([]);
  expect(copy.database.authority.writeIntents.listByBusinessKey(ledger.system, ledger.idempotencyKeyDigest)).toEqual([]);
  expect(copy.database.authority.writeAttempts.get(WriteAttemptIdSchema.parse(fixture.attempt.writeAttemptId))).toBeUndefined();
  expect(copy.database.authority.runCheckpoints.listByItem(ledger.workflowId, ledger.itemId)).toEqual([]);
  expect(() => history.withAuthorityTransaction(() => undefined)).toThrow("isolated-history-read-only");
});

it("refreshes imported runs beside copy-created runs and starts the dashboard on a schema-39 archive with no imported work or outbound requests", async () => {
  const source = await openCurrentWorld(), copy = await openCurrentWorld();
  source.database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  const copyConfig = initializeCopyConfig(copy, clock);
  const sourceRun = runRecordOf({ seed: 596, enqueuedAt: clock.now().toISOString() });
  source.database.authority.runs.enqueue(sourceRun);
  const timeline = source.database.authority.timelineEvents;
  createTimelineEmitter({ repository: timeline, clock }).emit(runQueuedSpanEvent({ run: sourceRun, actorId: LOCAL_OPERATOR_ACTOR_ID, title: "Synthetic import" }));
  const { runId, traceId, attempt } = sourceRun.envelope;
  createNoteTimelineWriter({ repository: timeline, clock }).emitNote({ workflow: "person-lookup",
    address: { runId, attempt, traceId, spanPath: traceId }, level: "step", message: "Archived step from source" });
  const refresh = async () => {
    const backup = await takeBackup(source);
    return importIsolatedProfileData(copy.admission, copy.database, { source: { manifestPath: backup.manifestPath, binding: source.admission.profileBinding },
      destination: copy.admission.profileBinding }, clock);
  };
  await refresh();
  const local = runRecordOf({ seed: 598, enqueuedAt: clock.now().toISOString() });
  local.envelope.configFingerprint = copyConfig.fingerprint;
  local.envelope.configSnapshotId = copyConfig.configSnapshotId;
  copy.database.authority.runs.enqueue(local);
  source.database.authority.runs.enqueue(runRecordOf({ seed: 597, enqueuedAt: clock.now().toISOString() }));
  expect((await refresh()).history.runs).toBe(2);
  expect(copy.database.authority.runs.listNonTerminal()).toEqual([local]);
  expect(copy.database.dashboardHistory().authority.runs.listByWorkflow("person-lookup")).toHaveLength(3);
  source.database.authority.runs.enqueue(runRecordOf({ seed: 598, enqueuedAt: clock.now().toISOString() }));
  await expect(refresh()).rejects.toThrow("isolated-history-local-id-collision: runs");
  copy.closeDatabase();
  // Model the schema-39 archive the dashboard upgrades when it first opens history.
  const archivePath = join(copy.stateRoot, "files", "imported-history.sqlite");
  const archive = new DatabaseSync(archivePath);
  try {
    archive.exec(`ALTER TABLE run_search DROP COLUMN ocr_subject_terms; ALTER TABLE delegation_dependencies DROP COLUMN parent_run_id;
      DROP TABLE run_requests; DROP TABLE settings_snapshots; DROP TABLE artifacts; UPDATE history_header SET schema_version=39,format=1`);
  } finally { archive.close(); }
  const { client, outbound, spawn } = await openCopyDashboard(copy, clock);
  expect((await client.runDetail(sourceRun.envelope.runId)).runId).toBe(sourceRun.envelope.runId);
  const logs = await client.runSection(sourceRun.envelope.runId, "logs");
  assert.ok(logs.section === "logs");
  expect(logs.payload.notes.map(row => row.message)).toContain("Archived step from source");
  expect((await client.activityReport("2026-11-23", "2026-11-23")).totalRuns).toBe(3);
  expect((await client.runDetail(local.envelope.runId)).runId).toBe(local.envelope.runId);
  expect(outbound).toEqual([]);
  expect(spawn).not.toHaveBeenCalled();
  const upgraded = new DatabaseSync(archivePath, { readOnly: true });
  try {
    expect(upgraded.prepare("SELECT schema_version FROM history_header").get()?.schema_version).toBe(CURRENT_AUTHORITY_SCHEMA_VERSION);
    expect(upgraded.prepare("SELECT format FROM history_header").get()?.format).toBe(2);
    expect(upgraded.prepare("SELECT count(*) AS count FROM pragma_table_info('delegation_dependencies') WHERE name='parent_run_id'").get()?.count).toBe(1);
    expect(upgraded.prepare("SELECT count(*) AS count FROM pragma_table_info('run_search') WHERE name='ocr_subject_terms'").get()?.count).toBe(1);
  } finally { upgraded.close(); }
});

it("loads every imported dashboard day with delegated runs and failed Lookup start evidence", async () => {
  const sourceWorld = createOcrReviewWorld();
  cleanups.push(() => sourceWorld.cleanup());
  const source = await sourceWorld.fixture({ coordinator: true, sessions: sessionFactoryHarness({
    ucpath: () => ({ ...healthyUcpathDriver(), async searchPersonOrg() { throw new Error("synthetic-lookup-failure"); } }),
  }) });
  const { database, admission, parentRun, clock: sourceClock } = source;
  expect(database.authority.runs.listChildren(parentRun.envelope.runId).length).toBeGreaterThan(0);
  sourceClock.advanceWall(86_400_000);
  const lookup = canonicalChildExecution(source.harness.deps, database, source.path, source.resolve);
  const failed = lookup.start(personLookupDescriptor, { emplId: "10800000" }, { dryRun: false });
  source.harness.manager.bindRunConfigFingerprint(failed.envelope.configFingerprint);
  expect((await lookup.step(failed, new AbortController().signal)).outcome.state).toBe("failed");
  const plans = [...source.canonical.plans, ...lookup.plans].map(plan => plan.startPlanId);
  expect(plans).toHaveLength(2);
  const days = new Set(database.authority.runs.listWorkflows().flatMap(workflow => database.authority.runs.listByWorkflow(workflow)
    .map(run => searchPartitionDay(new Date(run.envelope.enqueuedAt)))));
  expect(days.size).toBe(2);
  const directory = join(admission.stateRoot, "backups", "authority");
  const backup = await new AuthorityBackupService(admission, database, { directory }, sourceClock)
    .request({ trigger: "schema-migration", requiredGeneration: database.getMeta().authorityGeneration });
  const manifest = backup.manifests[0];
  assert.ok(manifest);
  const copy = await openCurrentWorld();
  initializeCopyConfig(copy, sourceClock);
  await importIsolatedProfileData(copy.admission, copy.database, { source: {
    manifestPath: join(directory, `${manifest.backupFileName}.manifest.json`), binding: admission.profileBinding,
  }, destination: copy.admission.profileBinding }, sourceClock);
  const history = copy.database.dashboardHistory();
  for (const planId of plans) {
    expect(history.authority.startPlans.get(planId)).toEqual(database.authority.startPlans.get(planId));
    expect(copy.database.authority.startPlans.get(planId)).toBeUndefined();
  }
  const snapshotId = failed.envelope.configSnapshotId;
  expect(history.authority.configSnapshots.get(snapshotId)).toEqual(database.authority.configSnapshots.get(snapshotId));
  expect(copy.database.authority.configSnapshots.get(snapshotId)).toBeUndefined();
  const pages = database.authority.runs.listByWorkflow("ocr-page");
  expect(pages.length).toBeGreaterThan(0);
  for (const page of pages) {
    const result = database.authority.runResults.get(page.envelope.runId);
    const { extractionId } = OcrPageReadingSchema.parse(result?.result.value);
    const extraction = database.authority.ocrExtractions.get(extractionId);
    expect(extraction).toBeDefined();
    expect(history.authority.ocrExtractions.get(extractionId)).toEqual(extraction);
    expect(copy.database.authority.ocrExtractions.get(extractionId)).toBeUndefined();
  }
  const reader = new RunRecordService({ database: history, clock: sourceClock, ids: { uuid: randomUUID },
    publishQueued() { throw new Error("unexpected-archive-queue-publication"); } });
  const importedRoot = history.authority.runs.get(parentRun.envelope.runId);
  assert.ok(importedRoot);
  expect(history.withAuthorityReadSnapshot(() => readQueueRecordMembers(history.authority, reader, importedRoot,
    history.authority.runs.listChildren(importedRoot.envelope.runId), source.resolve))).toBeDefined();
  expect(copy.database.authority.runs.listNonTerminal()).toEqual([]);
  copy.closeDatabase();

  const { client, outbound, spawn } = await openCopyDashboard(copy, sourceClock);
  const visible = new Set<string>();
  for (const day of days) for (const row of (await client.dashboardDay(day)).queueSurfaces) visible.add(row.runId);
  expect(visible).toContain(parentRun.envelope.runId);
  expect(visible).toContain(failed.envelope.runId);
  expect((await client.runDetail(failed.envelope.runId)).runId).toBe(failed.envelope.runId);
  expect(outbound).toEqual([]);
  expect(spawn).not.toHaveBeenCalled();
});
