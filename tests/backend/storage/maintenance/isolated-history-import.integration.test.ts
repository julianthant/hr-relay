import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { composeDashboardRuntime } from "../../../../src/backend/app/composition/dashboard/compose.js";
import { composeDashboardTimeline } from "../../../../src/backend/app/composition/dashboard/timeline.js";
import { createOperatorProjection } from "../../../../src/backend/app/composition/dashboard/queue.js";
import { composeProfileRuntime } from "../../../../src/backend/app/composition/storage-compose.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { createDebugEventWriter } from "../../../../src/backend/logs/debug-events.js";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { runQueuedSpanEvent } from "../../../../src/backend/runs/commands/run-queued-span.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { readQueueRecordMembers } from "../../../../src/backend/runs/queries/ocr-record-members.js";
import { ConfigSnapshotIdSchema, LOCAL_OPERATOR_ACTOR_ID, WriteAttemptIdSchema } from "../../../../src/rules/identity/ids.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { initialSettingsFileRecord } from "../../../../src/models/config/settings.js";
import { ConfigSnapshotRecordSchema } from "../../../../src/models/config/snapshot.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { importedLibraryId, importIsolatedProfileData } from "../../../../src/backend/storage/maintenance/isolated-library-import.js";
import { AuthoritySourceClosureUnprovedError } from "../../../../src/backend/storage/source-closure.js";
import { inspectNativeAuthority } from "../../../../src/backend/storage/sqlite/authority-inspection.js";
import { withUpgradedBackupCopy } from "../../../../src/backend/storage/sqlite/backup-inspection.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { AuthorityBackupService } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { readonlyAuthorityCopyPrefix, withReadonlyAuthoritySnapshot } from "../../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";
import { createTransactionHistory } from "../../../../src/backend/storage/sqlite/transaction-history.js";
import { createWorkbookLibraryService } from "../../../../src/backend/workbooks/workbook-library-service.js";
import { verifyShellCommandEffect } from "../../../../src/dashboard/app/commands/command-dispatch.js";
import { createDashboardClient, createRowStore } from "../../../../src/dashboard/client/index.js";
import { searchPartitionDay } from "../../../../src/models/dashboard/search-calendar.js";
import { DASHBOARD_REQUEST_REPORT_MESSAGE, debugFailureOutcome } from "../../../../src/models/events/debug-report.js";
import { OcrPageReadingSchema } from "../../../../src/models/workflows/ocr/page-accounting.js";
import { NotificationCommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { manualClock, type Clock } from "../../../../src/rules/time/clock.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { healthyRuntimePreflightRunners } from "../../../support/fixtures/preflight-seams.js";
import { CONFIG_SNAPSHOT, NOTIFICATION } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { dropRunSearchFts, restoreSchema36QueryIndexes } from "../../../support/fixtures/storage/historical-run-schema.js";
import { preAssistantFullAccessSnapshot, prePanelModeRetirementSnapshot } from "../../../support/fixtures/storage/person-preferences-predecessor.js";
import { boundProfileAdmission } from "../../../support/helpers/admission-fixture.js";
import { DESCRIPTOR_SET_HASH, runRecordOf } from "../../../support/helpers/backend/dashboard-harness.js";
import { canonicalChildExecution } from "../../../support/helpers/backend/canonical-child-execution.js";
import { createOcrReviewWorld } from "../../../support/helpers/backend/ocr-review-world.js";
import { unexpectedWorkbookSync } from "../../../support/helpers/backend/workbook-sync.js";
import { sessionFactoryHarness, healthyUcpathDriver } from "../../../support/helpers/phase1f-executor-harness.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { createBackupFixtures } from "../../../support/helpers/storage/backup-fixtures.js";
import { historyWorld } from "../../../support/helpers/storage/transaction-history-fixture.js";

const clock = manualClock(new Date("2026-11-23T12:00:00.000Z"));
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { try { for (const close of cleanups.splice(0).reverse()) await close(); } finally { vi.unstubAllGlobals(); } });
const { openCurrentWorld, takeBackup } = createBackupFixtures(cleanups, clock);
/** Named indexes on the tables the archive carries; the archive's own id and owner lookups are not native. */
const queryIndexes = (db: DatabaseSync) => db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL
  AND tbl_name IN (SELECT name FROM sqlite_master WHERE type='table') ORDER BY name`).all().map(row => String(row.name)).filter(name => !/_(lookup|owner)$/u.test(name));
const invocationPlan = (db: DatabaseSync) => db.prepare(`EXPLAIN QUERY PLAN SELECT * FROM commands WHERE family='run-lifecycle'
  AND json_extract(request_json,'$.operation')='delegation-invocation' AND json_extract(request_json,'$.request.manifestId')=? ORDER BY id`).all("x").map(row => String(row.detail)).join("\n");

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
  const baseUrl = `http://127.0.0.1:${String(dashboard.port)}`;
  return { client: createDashboardClient({ baseUrl }), baseUrl, outbound, spawn,
    debugRecords: () => runtime.selectedContext(active.token).database.authority.timelineEvents.debugPage({ limit: 1000 }) };
}

it("preserves the migration error when closing the private import copy fails", async () => {
  const world = await openCurrentWorld();
  const { manifest } = await takeBackup(world);
  const backupPath = join(world.backupDirectory, manifest.backupFileName);
  const predecessor = new DatabaseSync(backupPath);
  try {
    restoreSchema36QueryIndexes(predecessor);
    predecessor.exec("DROP INDEX checkpoints_replay_idx");
  } finally { predecessor.close(); }
  const before = readFileSync(backupPath);
  const closeError = new Error("private-import-copy-close-refused");
  const actualClose: unknown = Reflect.get(DatabaseSync.prototype, "close");
  assert.ok(typeof actualClose === "function");
  let retained: { database: DatabaseSync; directory: string } | undefined;
  const close = vi.spyOn(DatabaseSync.prototype, "close").mockImplementation(function (this: DatabaseSync) {
    const path = this.location();
    if (path !== null && basename(dirname(path)).startsWith(`${readonlyAuthorityCopyPrefix}${process.pid}-import-`)) {
      retained = { database: this, directory: dirname(path) };
      throw closeError;
    }
    Reflect.apply(actualClose, this, []);
  });
  try {
    assert.throws(() => withReadonlyAuthoritySnapshot(backupPath, source =>
      withUpgradedBackupCopy(world.admission, source, 36, world.admission.profileBinding, clock.now().toISOString(),
        () => assert.fail("the migration must finish before reading"))), (error: unknown) => {
      assert.ok(error instanceof AuthoritySourceClosureUnprovedError);
      assert.ok(error.cause instanceof Error);
      assert.match(error.cause.message, /no such index: checkpoints_replay_idx/u);
      assert.deepEqual(error.errors, [error.cause, closeError]);
      return true;
    });
    assert.ok(retained);
    assert.equal(existsSync(retained.directory), true);
    assert.deepEqual(readFileSync(backupPath), before);
  } finally {
    close.mockRestore();
    if (retained !== undefined) {
      retained.database.close();
      rmSync(retained.directory, { recursive: true, force: true });
    }
  }
});

it.each([CURRENT_AUTHORITY_SCHEMA_VERSION, 36])("imports schema %i runs, history and workbooks without admitting their writes", async schemaVersion => {
  const source = await historyWorld();
  cleanups.push(() => source.dispose());
  const fixture = source.commit(596);
  const ledger = fixture.commit.transaction;
  const workbook = createWorkbookLibraryService({ repository: source.database.authority.workbooks, sync: unexpectedWorkbookSync, clock })
    .create({ name: "Source workbook", themes: [], hasFormulas: false, sheets: [{ id: "sheet", name: "Sheet", width: 1,
      hidden: [], rows: [{ id: "row", cells: [{ value: "Source cell" }] }] }] });
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
  const backupPath = join(directory, manifest.backupFileName);
  const manifestPath = backupPath + ".manifest.json";
  if (schemaVersion === 36) {
    const predecessor = new DatabaseSync(backupPath);
    try { restoreSchema36QueryIndexes(predecessor); } finally { predecessor.close(); }
    const verification = withReadonlyAuthoritySnapshot(backupPath, database => inspectNativeAuthority(database, schemaVersion));
    const bytes = readFileSync(backupPath);
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, schemaVersion, pageCount: verification.pageCount,
      authorityContentFingerprint: verification.authorityContentFingerprint, byteSize: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      verification: { ...manifest.verification, schemaVersion, pageCount: verification.pageCount,
        authorityContentFingerprint: verification.authorityContentFingerprint } }));
  }
  const backupFiles = () => readdirSync(directory).sort().map(name => [name, readFileSync(join(directory, name))] as const);
  const beforeImport = backupFiles();
  const copy = await openCurrentWorld();
  const privateFiles = () => {
    const folder = join(copy.stateRoot, "credentials");
    const paths = readdirSync(folder, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name));
    paths.push(join(copy.machine.stateRoot, "machine", "profile-verifiers.json"), join(copy.machine.stateRoot, "machine", "profile-pepper"));
    return paths.sort().map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")]);
  };
  const before = privateFiles();
  expect(before.length).toBeGreaterThan(2);
  const refresh = () => importIsolatedProfileData(copy.admission, copy.database, { source: { manifestPath,
    binding: admission.profileBinding }, destination: copy.admission.profileBinding }, clock);
  const upgradeScratch = () => readdirSync(tmpdir()).filter(name => name.startsWith(`${readonlyAuthorityCopyPrefix}${process.pid}-import-`));
  const scratchBefore = upgradeScratch();
  const report = await refresh();
  expect(backupFiles()).toEqual(beforeImport);
  expect(upgradeScratch()).toEqual(scratchBefore);
  expect(privateFiles()).toEqual(before);
  expect(report.created).toBe(1);
  const libraryId = importedLibraryId(admission.profileBinding, copy.admission.profileBinding, workbook.libraryId);
  expect(copy.database.authority.workbooks.read(libraryId)?.workbook).toEqual({ ...workbook.workbook, libraryId });
  const historyPath = join(copy.stateRoot, "files", "imported-history.sqlite");
  const counts = (path: string) => withReadonlyAuthoritySnapshot(path, db => Object.fromEntries([
    "runs", "run_batches", "deleted_runs", "run_delegations", "delegation_dependencies", "run_search",
    "diagnostic_snapshots", "diagnostic_files", "dryrun_results", "ocr_approved_snapshots", "ocr_review_revisions", "run_checkpoints", "gate_results", "write_intents", "write_attempts", "run_results", "run_failures", "run_receipts", "timeline_events", "notifications",
  ].map(name => [name, db.prepare(`SELECT count(*) AS count FROM ${name}`).get()?.count])));
  expect(counts(historyPath)).toEqual(counts(backupPath));
  expect(withReadonlyAuthoritySnapshot(historyPath, database => database.prepare("SELECT schema_version FROM history_header").get()?.schema_version))
    .toBe(CURRENT_AUTHORITY_SCHEMA_VERSION);
  expect(report.history).toMatchObject({ write_intents: 1, write_attempts: 1, notifications: 1 });
  // The archive answers the native statements, so it seeks where the native store seeks.
  const archived = new DatabaseSync(historyPath, { readOnly: true }), native = new DatabaseSync(join(copy.stateRoot, "state.db"), { readOnly: true });
  try {
    const carried = new Set(archived.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => String(row.name)));
    const expected = native.prepare("SELECT name,tbl_name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name").all()
      .filter(row => carried.has(String(row.tbl_name))).map(row => String(row.name));
    expect(expected).toContain("commands_manifest_idx");
    expect(queryIndexes(archived)).toEqual(expected);
    expect(invocationPlan(archived)).toMatch(/SEARCH commands USING INDEX commands_manifest_idx/u);
  } finally { archived.close(); native.close(); }
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
  if (schemaVersion === 36) {
    copy.database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    const run = runRecordOf({ seed: 598, enqueuedAt: clock.now().toISOString() });
    copy.database.authority.runs.enqueue({ ...run, envelope: { ...run.envelope, runId: ledger.runId } });
    await expect(refresh()).rejects.toThrow("isolated-history-local-id-collision: runs");
    expect(upgradeScratch()).toEqual(scratchBefore);
    expect(backupFiles()).toEqual(beforeImport);
  }
});

it("serves archived notices as read alongside actionable copy notices", async () => {
  const source = await openCurrentWorld(), copy = await openCurrentWorld();
  const now = clock.now().toISOString();
  source.database.authority.notifications.create({ ...NOTIFICATION,
    snooze: { state: "snoozed", until: "2026-11-24T12:00:00.000Z" } });
  const backup = await takeBackup(source);
  initializeCopyConfig(copy, clock);
  await importIsolatedProfileData(copy.admission, copy.database, {
    source: { manifestPath: backup.manifestPath, binding: source.admission.profileBinding },
    destination: copy.admission.profileBinding,
  }, clock);
  const archivedId = NOTIFICATION.notificationId, localId = randomUUID();
  copy.database.authority.notifications.create({ ...NOTIFICATION, notificationId: localId });
  copy.closeDatabase();
  const archivePath = join(copy.stateRoot, "files", "imported-history.sqlite");
  const archive = readFileSync(archivePath);
  const { client } = await openCopyDashboard(copy, clock);
  const day = searchPartitionDay(clock.now());
  const archived = { notificationId: archivedId, readState: "read", state: "read", readOnlyHistory: true };
  const streamRows = createRowStore();
  const live = Promise.withResolvers<void>();
  const stream = client.subscribeDay({ day, rows: streamRows, onDay: () => undefined, onState: state => {
    if (state.state === "live") live.resolve();
    if (state.state === "stopped") live.reject(state.error ?? new Error("inbox stream stopped"));
  } });
  try { await live.promise; } finally { stream.close(); }
  const streamed = streamRows.notificationList(LOCAL_OPERATOR_ACTOR_ID)?.rows;
  assert.ok(streamed);
  for (const rows of [await client.notificationSnapshot(), streamed]) {
    expect(rows.find(row => row.notificationId === archivedId)).toMatchObject(archived);
    const local = rows.find(row => row.notificationId === localId);
    expect(local).toMatchObject({ readState: "unread", state: "unread", revision: 1 });
    expect(local).not.toHaveProperty("readOnlyHistory");
  }
  const command = { requestedAt: now, requestedBy: LOCAL_OPERATOR_ACTOR_ID, source: "dashboard", family: "notification" };
  const target = await client.notificationCollection?.("read");
  expect(target).toEqual({ actorId: LOCAL_OPERATOR_ACTOR_ID, members: [{ notificationId: localId, expectedVersion: 1 }], matchingCount: 1 });
  const readAll = NotificationCommandRequestSchema.parse({ ...command, commandId: randomUUID(), type: "notification-read-all", target });
  const applied = await client.executeCommand(readAll);
  const receipt = { actorId: LOCAL_OPERATOR_ACTOR_ID, changes: [{ notificationId: localId, revision: 2 }] };
  expect(applied).toMatchObject({ state: "applied", affectedTargets: [{ family: "notification", notificationId: localId }], notificationReceipt: receipt });
  expect(await verifyShellCommandEffect(client, day, readAll, applied)).toMatchObject({ state: "matched" });

  const unread = NotificationCommandRequestSchema.parse({ ...command, commandId: randomUUID(), type: "notification-unread",
    target: { actorId: LOCAL_OPERATOR_ACTOR_ID, notificationId: localId, expectedVersion: 2 } });
  const toggled = await client.executeCommand(unread);
  expect(toggled.state).toBe("applied");
  expect(await verifyShellCommandEffect(client, day, unread, toggled)).toMatchObject({ state: "matched" });
  const replay = await client.executeCommand(readAll);
  expect(replay).toMatchObject({ state: "already-applied", notificationReceipt: receipt });
  expect(await verifyShellCommandEffect(client, day, readAll, replay)).toMatchObject({ state: "matched" });
  expect((await client.notificationSnapshot()).find(row => row.notificationId === archivedId)).toMatchObject(archived);
  expect(readFileSync(archivePath)).toEqual(archive);
});

it.each([false, true])("records a refused command with an open run (imported archive: %s)", async imported => {
  const copy = await openCurrentWorld();
  const config = initializeCopyConfig(copy, clock);
  const now = clock.now().toISOString();
  const run = runRecordOf({ seed: 596, enqueuedAt: now });
  const { runId } = run.envelope;
  if (imported) {
    const source = await openCurrentWorld();
    source.database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    source.database.authority.runs.enqueue(run);
    source.database.authority.notifications.create(NOTIFICATION);
    const backup = await takeBackup(source);
    await importIsolatedProfileData(copy.admission, copy.database, {
      source: { manifestPath: backup.manifestPath, binding: source.admission.profileBinding },
      destination: copy.admission.profileBinding,
    }, clock);
    expect(copy.database.authority.runs.get(runId)).toBeUndefined();
  } else {
    copy.database.authority.runs.enqueue({ ...run, envelope: { ...run.envelope,
      configSnapshotId: config.configSnapshotId, configFingerprint: config.fingerprint } });
  }
  copy.closeDatabase();
  const { client, baseUrl, debugRecords } = await openCopyDashboard(copy, clock);
  expect((await client.runDetail(runId)).runId).toBe(runId);
  const post = (path: string, body: unknown) => fetch(`${baseUrl}${path}`, {
    method: "POST", headers: { origin: baseUrl, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const response = await post("/api/v1/commands", NotificationCommandRequestSchema.parse({
    commandId: randomUUID(), requestedAt: now, requestedBy: LOCAL_OPERATOR_ACTOR_ID, source: "dashboard",
    family: "notification", type: "notification-read",
    target: { actorId: LOCAL_OPERATOR_ACTOR_ID, notificationId: NOTIFICATION.notificationId, expectedVersion: 1 },
  }));
  expect(response.status).toBe(422);
  const refusal: unknown = await response.json();
  expect(refusal).toMatchObject({ state: "rejected", code: "target-not-found" });

  const report = { reportId: randomUUID(), clientId: randomUUID(), release: "dashboard", route: "/api/v1/commands",
    surface: "queue", message: DASHBOARD_REQUEST_REPORT_MESSAGE, runId, ...debugFailureOutcome(refusal, response.status) };
  const reportResponse = await post("/api/v1/debug/errors", report);
  expect(reportResponse.status).toBe(201);
  expect(await reportResponse.json()).toEqual({ state: "recorded", reportId: report.reportId });
  const recorded = debugRecords().find(row => row.payload.kind === "debug" && row.payload.event.correlationId === report.reportId);
  expect(recorded).toMatchObject({
    scope: imported ? { kind: "client", clientId: report.clientId } : { kind: "run", runId },
    payload: { kind: "debug", event: { category: "client", code: "target-not-found", reason: "operation-refused" } },
  });

  const conflict = await post("/api/v1/debug/errors", { ...report, surface: "settings" });
  expect(conflict.status).toBe(500);
  const cause = debugRecords().find(row => row.payload.kind === "debug" && row.payload.event.reason === "debug-report-identity-conflict");
  expect(cause).toMatchObject({ payload: { kind: "debug", event: {
    category: "http", status: 500, method: "POST", route: "/api/v1/debug/errors", reason: "debug-report-identity-conflict",
  } } });
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
  // Restore the schema-39, format-1 layout and let dashboard startup upgrade it.
  const archivePath = join(copy.stateRoot, "files", "imported-history.sqlite");
  const archive = new DatabaseSync(archivePath);
  let indexes: string[];
  try {
    indexes = queryIndexes(archive);
    dropRunSearchFts(archive);
    for (const name of indexes) archive.exec(`DROP INDEX ${name}`);
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
  const search = await client.searchRuns({ q: sourceRun.envelope.runId.slice(-10), scope: "run", limit: 20 });
  expect(search.results.map(row => row.runId)).toContain(sourceRun.envelope.runId);
  expect(outbound).toEqual([]);
  expect(spawn).not.toHaveBeenCalled();
  const upgraded = new DatabaseSync(archivePath, { readOnly: true });
  try {
    expect(upgraded.prepare("SELECT schema_version FROM history_header").get()?.schema_version).toBe(CURRENT_AUTHORITY_SCHEMA_VERSION);
    expect(upgraded.prepare("SELECT format FROM history_header").get()?.format).toBe(2);
    expect(upgraded.prepare("SELECT count(*) AS count FROM pragma_table_info('delegation_dependencies') WHERE name='parent_run_id'").get()?.count).toBe(1);
    expect(upgraded.prepare("SELECT count(*) AS count FROM pragma_table_info('run_search') WHERE name='ocr_subject_terms'").get()?.count).toBe(1);
    expect(indexes.length).toBeGreaterThan(0);
    expect(queryIndexes(upgraded)).toEqual(indexes);
  } finally { upgraded.close(); }
});

it("keeps imported timeline folds through background polling and recovery", async () => {
  const source = await openCurrentWorld(), copy = await openCurrentWorld();
  const config = initializeCopyConfig(copy, clock);
  source.database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  const seed = (database: typeof source.database, run: ReturnType<typeof runRecordOf>) => {
    database.authority.runs.enqueue(run);
    const writer = createTimelineEmitter({ repository: database.authority.timelineEvents, clock });
    writer.emit(runQueuedSpanEvent({ run, actorId: LOCAL_OPERATOR_ACTOR_ID, title: "Queued fixture" }));
    const { runId, workflow, attempt, traceId } = run.envelope, ts = clock.now().toISOString();
    writer.emit({ t: "data.observed", ts, observedAt: ts, runId, workflow, attempt, traceId,
      spanPath: `${traceId}/searching#1.1`, nodeId: "searching", taskId: "ucpath/search-person-org",
      points: [{ direction: "read", field: "selection", values: [
        { key: "selection.status", state: "allowed", classification: "safe-diagnostic", transform: "allow", value: "resolved" },
      ] }] });
  };
  const archived = runRecordOf({ seed: 596, enqueuedAt: clock.now().toISOString() });
  seed(source.database, archived);
  const backup = await takeBackup(source);
  await importIsolatedProfileData(copy.admission, copy.database, { source: { manifestPath: backup.manifestPath,
    binding: source.admission.profileBinding }, destination: copy.admission.profileBinding }, clock);

  const database = copy.database, history = database.dashboardHistory();
  const reader = new RunRecordService({ database: history, clock, ids: { uuid: randomUUID }, publishQueued: () => {} });
  const projection = createOperatorProjection({ database: history, reader, clock, stateRoot: copy.stateRoot,
    appVersion: "0.1.0", descriptorSetHash: DESCRIPTOR_SET_HASH, descriptors: { resolve: () => personLookupDescriptor },
    ledger: createTransactionHistory(history.authority) });
  const loggingRepository = database.authority.timelineEvents;
  const startupCleanups: (() => void | Promise<void>)[] = [];
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    const runtime = composeDashboardTimeline({ database, clock, projection, startupCleanups, admission: copy.admission,
      lifecycle: reader, loggingRepository, debugEvents: createDebugEventWriter({ repository: loggingRepository, clock, build: "test" }) });
    const runId = archived.envelope.runId, generation = projection.generation();
    const fold = projection.runFold(runId), logs = projection.runLogSnapshot(runId);
    expect(fold?.queued.runId).toBe(runId);
    expect(logs.entries).toHaveLength(1);
    await runtime.settled();
    expect(projection.health().state).toBe("live");
    expect(projection.generation()).toBe(generation);
    expect(projection.runFold(runId)).toEqual(fold);
    expect(projection.runLogSnapshot(runId)).toEqual(logs);

    const local = runRecordOf({ seed: 598, enqueuedAt: clock.now().toISOString() });
    local.envelope.configFingerprint = config.fingerprint;
    local.envelope.configSnapshotId = config.configSnapshotId;
    seed(database, local);
    vi.advanceTimersByTime(250);
    await runtime.settled();
    const localId = local.envelope.runId;
    expect(projection.runFold(localId)?.eventCount).toBe(1);
    expect(projection.runLogSnapshot(localId).entries).toHaveLength(1);
    expect(projection.generation()).toBe(generation);

    const poll = projection.pollBackground.bind(projection);
    vi.spyOn(projection, "pollBackground").mockImplementationOnce((read, now) => poll(request => read({ ...request, limit: 1 }), now));
    projection.backgroundReadFailed(new Error("fixture snapshot refusal"));
    vi.advanceTimersByTime(250);
    await runtime.settled();
    expect(projection.health().state).toBe("live");
    expect(projection.generation()).toBeGreaterThan(generation);
    expect(projection.runFold(runId)).toEqual(fold);
    expect(projection.runLogSnapshot(runId).entries).toEqual(logs.entries);
    expect(projection.runFold(localId)?.eventCount).toBe(1);
    expect(projection.runLogSnapshot(localId).entries).toHaveLength(1);
  } finally {
    for (const close of startupCleanups.reverse()) await close();
    vi.useRealTimers();
    vi.restoreAllMocks();
  }
});

it.each([41, 44])("loads every imported dashboard day with delegated runs and failed Lookup start evidence from a schema-%s archive", async version => {
  const sourceWorld = createOcrReviewWorld();
  cleanups.push(() => sourceWorld.cleanup());
  const source = await sourceWorld.fixture({ coordinator: true, record: true, sessions: sessionFactoryHarness({
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
  const archivePath = join(copy.stateRoot, "files", "imported-history.sqlite");
  const archive = new DatabaseSync(archivePath);
  try {
    dropRunSearchFts(archive);
    const update = archive.prepare("UPDATE settings_snapshots SET payload_json=? WHERE id=?");
    const rows = archive.prepare("SELECT payload_json FROM settings_snapshots").all();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const snapshot = ConfigSnapshotRecordSchema.parse(JSON.parse(String(row.payload_json)));
      update.run(canonicalJsonStringify(version === 41 ? prePanelModeRetirementSnapshot(snapshot, "sidebar") : preAssistantFullAccessSnapshot(snapshot)), snapshot.configSnapshotId);
    }
    archive.prepare("UPDATE history_header SET schema_version=?").run(version);
  } finally { archive.close(); }
  const history = copy.database.dashboardHistory();
  expect(withReadonlyAuthoritySnapshot(archivePath, db => db.prepare("SELECT schema_version FROM history_header").get()?.schema_version))
    .toBe(CURRENT_AUTHORITY_SCHEMA_VERSION);
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
