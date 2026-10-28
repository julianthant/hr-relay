import { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { AuthorityDatabase, inspectNativeAuthority } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { withAuthorityDatabaseReadOnly } from "../../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";
import { AUTHORITY_APPLICATION_ID, SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH, ProtectedSettingsApplyInputSchema, ProtectedStoreRecordSchema } from "../../../../src/models/config/protected-settings.js";
import { WorkerSlotRecordSchema } from "../../../../src/models/run/worker-slot.js";
import { WorkerPoolRecordSchema } from "../../../../src/models/run/worker-pool.js";
import { WorkerLeaseRecordSchema } from "../../../../src/models/run/worker.js";
import { WorkerBrowserObservationSchema, WorkerControlRecordSchema } from "../../../../src/models/run/worker-control.js";
import { createWorkerControlRepository } from "../../../../src/backend/storage/sqlite/worker-control.js";
import { insertNativeCommand, settleNativeCommand } from "../../../../src/backend/storage/sqlite/command-record-row.js";
import { CommandAuditRecordSchema, WorkerBrowserCommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { deriveProfileNames } from "../../../../src/models/profiles/profile.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { retainedHistoricalData } from "./retained-historical-data.js";

export const historicalFlatFields = Object.freeze({ firstName: "Flat", lastName: "Fixture", email: "flat-fixture@ucsd.edu", password: "disposable-flat-owner-password" });

export async function createHistoricalFlatProfileFixture(options: { unknownWrite?: boolean; laterProtectedChange?: boolean; closedBrowser?: boolean; unretiredWorker?: boolean } = {}) {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "flat-profile-claim-")));
  const lifetime = await RuntimeLifetimeLock.acquire(0);
  for (const name of ["package.json", "package-lock.json"]) copyFileSync(name, join(workspace, name));
  const stateRoot = join(workspace, ".tracker", "data"), artifactRoot = join(stateRoot, "artifacts"), processLockRoot = join(stateRoot, "locks");
  mkdirSync(artifactRoot, { recursive: true, mode: 0o700 }); mkdirSync(processLockRoot, { mode: 0o700 });
  const databasePath = join(stateRoot, "state.db"), at = "2026-10-01T12:00:00.000Z", raw = new DatabaseSync(databasePath);
  try {
    for (const migration of SQLITE_MIGRATIONS.filter(row => row.version <= 6)) for (const statement of migration.statements) raw.exec(statement);
    raw.exec(`PRAGMA application_id=${AUTHORITY_APPLICATION_ID}; PRAGMA user_version=6`);
    raw.prepare("INSERT INTO database_states VALUES(1,6,0,?,0,'ready')").run(at);
    const baseline = { recordKey: randomUUID(), upgradeId: "fresh", phase: "baseline", fromSchemaVersion: 0, toSchemaVersion: 6, by: "local-operator", recordedAt: at };
    raw.prepare("INSERT INTO database_upgrades VALUES(?,'fresh','baseline',NULL,?,?)").run(baseline.recordKey, canonicalJsonStringify(baseline), at);
    inspectNativeAuthority(raw, 6);
  } finally { raw.close(); }
  const artifact = retainedHistoricalData({ databasePath, profileRoot: stateRoot }, options.unknownWrite, 6);
  let browser: ReturnType<typeof WorkerBrowserObservationSchema.parse> | undefined;
  if (options.closedBrowser) {
    const native = new DatabaseSync(databasePath);
    try {
      const config = native.prepare("SELECT fingerprint FROM settings_snapshots LIMIT 1").get();
      const pool = WorkerPoolRecordSchema.parse({ workflow: "person-lookup", desiredWorkers: options.unretiredWorker ? 1 : 0,
        version: options.unretiredWorker ? 1 : 2, plannedBy: "local-operator", plannedAt: at, createdAt: at, updatedAt: at });
      native.prepare("INSERT INTO worker_pools VALUES(?,?,?,?,?,?)").run(pool.workflow, pool.desiredWorkers, pool.version, canonicalJsonStringify(pool), at, at);
      const origin = WorkerSlotRecordSchema.parse({ workerId: "person-lookup-worker-1", workflow: "person-lookup", ordinal: 1, poolIndex: 1,
        membershipRevision: 1, phase: "failed", retiredAt: null, retirementCommandId: null, reservationCommandId: null, createdAt: at, updatedAt: at });
      const retirement = options.unretiredWorker ? undefined : WorkerBrowserCommandRequestSchema.parse({ commandId: randomUUID(),
        requestedAt: at, requestedBy: "local-operator", source: "dashboard", family: "worker-browser", type: "plan-worker-count",
        target: { workflowId: "person-lookup", expectedVersion: 1 }, payload: { desiredWorkers: 0 } });
      if (retirement !== undefined) insertNativeCommand(native, retirement);
      const slot = retirement === undefined ? origin : WorkerSlotRecordSchema.parse({ ...origin,
        membershipRevision: 2, retiredAt: at, retirementCommandId: retirement.commandId });
      native.prepare("INSERT INTO worker_slots VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(slot.workerId, slot.workflow, slot.ordinal, slot.membershipRevision,
        slot.phase, slot.retiredAt, slot.retirementCommandId, slot.reservationCommandId, canonicalJsonStringify(slot), at, at);
      const lease = WorkerLeaseRecordSchema.parse({ workerId: slot.workerId, workflow: slot.workflow, browserSystems: ["ucpath"], processId: 2147483647,
        leaseGeneration: 1, controlRevision: 1, control: { directive: "stop", requestedAt: at, requestedBy: "local-operator" },
        lifecycle: { state: "stopped", startedAt: at, stoppedAt: at, reason: "shutdown" }, version: 1, createdAt: at, updatedAt: at });
      native.prepare("INSERT INTO worker_leases VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(lease.workerId, lease.workerId, lease.workflow, 1, 1, "stopped", "stop", null, 1, canonicalJsonStringify(lease), at, at);
      browser = WorkerBrowserObservationSchema.parse({ workerId: slot.workerId, leaseGeneration: 1, sessionId: randomUUID(), system: "ucpath",
        configFingerprint: config?.fingerprint, signInFingerprint: "a".repeat(64), browserMode: "headless", profileDirectory: join(stateRoot, "browsers", "w1", "ucpath"),
        acceptDownloads: true, exclusive: true, health: "closed", observedAt: at, openedAt: at, profileRevision: 1 });
      const controls = createWorkerControlRepository({ database: native, mutate: (_table, work) => work().result });
      controls.observe(browser);
      if (retirement !== undefined) {
        const application = { result: { state: "applied", commandId: retirement.commandId, affectedTargets: [{ family: "worker-pool", workflowId: "person-lookup" }] },
          versionChanges: [], affectedDependencyIds: [] };
        const audit = CommandAuditRecordSchema.parse({ auditId: randomUUID(), request: retirement, completedAt: at, ...application });
        settleNativeCommand(native, audit);
        native.prepare("INSERT INTO command_audits(id,command_id,code,payload_json,created_at) VALUES(?,?,NULL,?,?)")
          .run(audit.auditId, retirement.commandId, canonicalJsonStringify(audit), at);
        const retired = WorkerControlRecordSchema.parse({ commandId: retirement.commandId, request: retirement, scope: "worker-pool:person-lookup", executorId: randomUUID(),
          admittedAt: at, expiresAt: at, basisVersion: 1, auditedAt: at,
          roster: { selected: [], excess: [origin], beforeVersion: 1, admittedVersion: 1, afterVersion: 2 },
          phase: { state: "succeeded", startedAt: at, completedAt: at, application, acknowledgement: { kind: "plan", workerIds: [],
            retirements: [{ workerId: slot.workerId, membershipRevision: 1, checkedAt: at, processStopped: true, browsersClosed: true, exclusive: true }] } } });
        native.prepare("INSERT INTO worker_controls(command_id,scope,worker_id,phase,audited_at,payload_json,created_at) VALUES (?,?,NULL,'succeeded',?,?,?)")
          .run(retirement.commandId, retired.scope, at, canonicalJsonStringify(retired), at);
      }
      inspectNativeAuthority(native, 6);
    } finally { native.close(); }
    const directory = join(stateRoot, "browsers", "w1", "ucpath", "Default"); mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(join(directory, "Preferences"), '{"profile":{"name":"Historical fixture"}}', { mode: 0o600 });
  }
  const reports = join(workspace, "data", "reports"); mkdirSync(reports, { recursive: true, mode: 0o700 });
  const reportPath = join(reports, "historical-report.csv"); writeFileSync(reportPath, "status\nretained\n", { mode: 0o600 });
  const credentials = join(stateRoot, "credentials"); mkdirSync(credentials, { mode: 0o700 });
  const values = { ucpathUserId: historicalFlatFields.email, ucpathPassword: historicalFlatFields.password,
    timekeeperName: deriveProfileNames(historicalFlatFields.firstName, historicalFlatFields.lastName).timekeeperName,
    activityPersonPseudonym: { keyHex: "f".repeat(64), keyGeneration: "activity-person-flat-fixture" } };
  const entries = Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { valueId: randomUUID(), value, updatedAt: at }]));
  let request = ProtectedSettingsApplyInputSchema.parse({ commandId: randomUUID(), commandFingerprint: "d".repeat(64), expectedRevision: 1,
    protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: randomUUID(), updatedAt: at,
    entries: Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { set: value }])) });
  const { entries: _patch, updatedAt: _at, ...lastApplied } = request;
  let record = ProtectedStoreRecordSchema.parse({ schemaVersion: 1, revision: 2, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, entries, lastApplied });
  const history = [{ request, setValueIds: Object.fromEntries(Object.entries(record.entries).map(([name, value]) => [name, value.valueId])) }];
  if (options.laterProtectedChange) {
    request = ProtectedSettingsApplyInputSchema.parse({ ...request, commandId: randomUUID(), writeId: randomUUID(), commandFingerprint: "e".repeat(64),
      expectedRevision: record.revision, updatedAt: "2026-10-02T12:00:00.000Z", entries: {
        activityPersonPseudonym: { set: { keyHex: "a".repeat(64), keyGeneration: "activity-person-flat-current" } } } });
    const choice = request.entries.activityPersonPseudonym;
    if (choice === undefined || !("set" in choice)) throw new Error("genuine historical protected update required");
    const changed = { valueId: randomUUID(), value: choice.set, updatedAt: request.updatedAt };
    const { entries: _changes, updatedAt: _changedAt, ...receipt } = request;
    record = ProtectedStoreRecordSchema.parse({ ...record, revision: record.revision + 1, entries: { ...record.entries, activityPersonPseudonym: changed }, lastApplied: receipt });
    history.push({ request, setValueIds: { activityPersonPseudonym: changed.valueId } });
  }
  const protectedPath = join(credentials, "protected.json");
  writeFileSync(protectedPath, JSON.stringify({ schemaVersion: 2, record, history }), { mode: 0o600 });
  const machine = RuntimeAdmission.acquireInitial(workspace, lifetime, (pair, inspection) => {
    const facts = withAuthorityDatabaseReadOnly(inspection, databasePath, database => inspectNativeAuthority(database, 6));
    return { kind: "verified-existing", pair, authorityGeneration: facts.authorityGeneration, databaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(databasePath) };
  }, () => { throw new Error("existing flat fixture must never initialize fresh data"); });
  assert.equal(machine.locator.stateRoot, stateRoot); machine.release();
  return { workspace, lifetime, stateRoot, artifactRoot, processLockRoot, databasePath, protectedPath, artifact, reportPath, record, request, browser,
    async close() {
      const closed = spawnSync("/usr/sbin/lsof", ["-nP", "+D", workspace, "-Fn"], { encoding: "utf8" });
      assert.equal(closed.error, undefined); assert.equal(closed.status, 1, "historical flat fixture closure unproved");
      assert.equal(closed.stdout, ""); assert.equal(closed.stderr, "");
      await lifetime.close();
      rmSync(workspace, { recursive: true });
    } };
}
