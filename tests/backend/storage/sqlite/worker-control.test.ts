import { createWorkerLeaseFixtures } from "../../../support/helpers/backend/worker-lease-fixtures.js";
import { DatabaseSync } from "node:sqlite";
import { afterEach,describe,expect,it } from "vitest";
import { insertNativeCommand } from "../../../../src/backend/storage/sqlite/command-record-row.js";
import { SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import { createWorkerControlRepository,workerBrowserFromRow,workerControlFromRow } from "../../../../src/backend/storage/sqlite/worker-control.js";
import { createWorkerSlotRepository } from "../../../../src/backend/storage/sqlite/worker-slots.js";
import { WorkerPoolRecordSchema } from "../../../../src/models/run/worker-pool.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { HASH_A,LATER,NOW,UUID_1,UUID_2,UUID_3 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function fixture() {
  const db = new DatabaseSync(":memory:"); databases.push(db);
  for (const migration of SQLITE_MIGRATIONS) for (const sql of migration.statements) db.exec(sql);
  const mutate = <T>(work: () => { result: T; changes: number }) => {
    db.exec("BEGIN IMMEDIATE"); try { const outcome = work(); db.exec("COMMIT"); return outcome.result; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  };
  const controls = createWorkerControlRepository({ database: db, mutate: (_table, work) => mutate(work) });
  const pool = WorkerPoolRecordSchema.parse({ workflow: "person-lookup", desiredWorkers: 1, version: 1,
    plannedBy: "local-operator", plannedAt: NOW, createdAt: NOW, updatedAt: NOW });
  db.prepare("INSERT INTO worker_pools VALUES(?,?,?,?,?,?)").run(pool.workflow,1,1,canonicalJsonStringify(pool),NOW,NOW);
  const slot = createWorkerSlotRepository({ database: db, mutate }).allocate({ workflow: pool.workflow, poolIndex: 1, commandId: null, now: NOW });
  const request = { commandId: UUID_1, family: "worker-browser", type: "spawn-worker", requestedAt: NOW,
    requestedBy: "local-operator", source: "dashboard", target: { workflowId: pool.workflow, expectedVersion: 1 }, payload: { workerId: slot.workerId } };
  const record = { commandId: UUID_1, request, scope: "worker-pool:person-lookup", executorId: UUID_2,
    admittedAt: NOW, expiresAt: LATER, basisVersion: 1, phase: { state: "admitted" } };
  return { db, controls, slot, request, record };
}
function reservedLease(f: Pick<ReturnType<typeof fixture>, "db" | "slot">, overrides: Record<string, unknown> = {}) {
  const lease = createWorkerLeaseFixtures(NOW).leaseOf({ workerId: f.slot.workerId, version: 2, controlRevision: 2, controlCommandId: UUID_1,
    lifecycle: { state: "idle", startedAt: NOW, heartbeatAt: NOW }, ...overrides });
  f.db.prepare("INSERT OR REPLACE INTO worker_leases(id,worker_id,workflow,lease_generation,control_revision,state,directive,heartbeat_at,version,payload_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(lease.workerId, lease.workerId, lease.workflow, lease.leaseGeneration, lease.controlRevision, lease.lifecycle.state, lease.control.directive, NOW, lease.version, canonicalJsonStringify(lease), NOW, NOW);
  return lease;
}
describe("native worker control custody", () => {
  it("requires a genuine command before durable effect admission and keeps scalar phase/audit consistent", () => {
    const f = fixture(); expect(() => f.controls.admit(f.record)).toThrow(/worker-control-command-binding-mismatch/u);
    expect(f.controls.list()).toEqual([]);
    insertNativeCommand(f.db,f.request);
    const admitted = f.controls.admit(f.record); expect(f.controls.admit(f.record)).toEqual(admitted);
    f.controls.transition(UUID_1,"admitted",{ state: "executing", startedAt: NOW });
    expect(f.controls.pending(f.record.scope)).toHaveLength(1);
    f.controls.transition(UUID_1,"executing",{ state: "refused", completedAt: LATER, message: "birth refused" });
    f.controls.audit(UUID_1,LATER); expect(f.controls.pending(f.record.scope)).toEqual([]);
    expect(() => f.controls.transition(UUID_1,"refused",{ state: "executing", startedAt: LATER })).toThrow(/phase-conflict/u);
    const row = f.db.prepare("SELECT * FROM worker_controls").get();
    expect(() => workerControlFromRow({ ...row, phase: "executing" })).toThrow(/identity-mismatch/u);
    expect(f.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
  it("requires exact positive profile custody and preserves a closed browser observation", () => {
    const f = fixture();
    const observation = { workerId: f.slot.workerId,leaseGeneration:1,sessionId:UUID_3,system:"ucpath",configFingerprint:HASH_A,signInFingerprint:HASH_A,
      browserMode:"headed",profileRevision:7,acceptDownloads:false,exclusive:false,health:"authenticated",openedAt:NOW,observedAt:NOW };
    f.controls.observe(observation);
    expect(() => f.controls.observe({ ...observation,profileRevision:8 })).toThrow(/identity-conflict/u);
    f.controls.observe({ ...observation,health:"closed",observedAt:LATER });
    expect(() => f.controls.observe({ ...observation,observedAt:LATER })).toThrow(/cannot-reopen/u);
    const row = f.db.prepare("SELECT * FROM browser_sessions").get();
    expect(() => workerBrowserFromRow({ ...row,profile_revision:1 })).toThrow(/identity-mismatch/u);
    expect(() => f.controls.observe({ ...observation,sessionId:UUID_2,profileRevision:undefined })).toThrow();
    expect(f.controls.browsers(f.slot.workerId)[0]?.profileRevision).toBe(7);
  });
});

describe("browser application readback authority", () => {
  function browserFixture() {
    const f = fixture();
    const request = { ...f.request, type: "refresh-browser", target: { workerId: f.slot.workerId, expectedVersion: 1, controlBasis: { leaseGeneration: 1, controlRevision: 1 }, browserSessionId: UUID_3 }, payload: undefined };
    delete request.payload;
    insertNativeCommand(f.db, request);
    reservedLease(f);
    f.controls.admit({ ...f.record, request });
    f.controls.transition(UUID_1, "admitted", { state: "ready" });
    f.controls.transition(UUID_1, "ready", { state: "executing", startedAt: NOW });
    f.controls.transition(UUID_1, "executing", { state: "succeeded", startedAt: NOW, completedAt: LATER, acknowledgement: { kind: "control", browserSessionId: UUID_3 } });
    const result = { state: "applied", commandId: UUID_1, affectedTargets: [{ family: "worker-browser", workerId: f.slot.workerId }] };
    const audit = { auditId: UUID_2, request, result, completedAt: LATER, versionChanges: [], affectedDependencyIds: [] };
    const insertAudit = (input: typeof audit) => f.db.prepare("INSERT INTO command_audits(id,command_id,code,payload_json,created_at) VALUES(?,?,NULL,?,?)").run(UUID_2, UUID_1, canonicalJsonStringify(input), LATER);
    return { ...f, audit, insertAudit };
  }
  it("requires actual exact audit before attaching application and rolls back unavailable evidence", () => {
    const f = browserFixture(); const before = f.controls.get(UUID_1);
    expect(() => f.controls.audit(UUID_1, LATER)).toThrow(/application-audit-unavailable/);
    expect(f.controls.get(UUID_1)).toEqual(before);
    f.insertAudit(f.audit);
    const record = f.controls.audit(UUID_1, LATER);
    expect(record.phase.state).toBe("succeeded");
    if (record.phase.state !== "succeeded") throw new Error("expected success");
    expect(record.phase.application).toEqual({ result: f.audit.result, versionChanges: [], affectedDependencyIds: [] });
    expect(record.auditedAt).toBe(LATER);
  });
  it("does not backfill missing application into already audited historical browser evidence", () => {
    const f = browserFixture(); f.insertAudit(f.audit);
    const current = f.controls.get(UUID_1)!;
    const historical = { ...current, auditedAt: LATER };
    f.db.prepare("UPDATE worker_controls SET audited_at=?,payload_json=? WHERE command_id=?").run(LATER, canonicalJsonStringify(historical), UUID_1);
    expect(f.controls.audit(UUID_1, NOW)).toEqual(historical);
    expect(f.controls.get(UUID_1)).toEqual(historical);
    if (historical.phase.state !== "succeeded") throw new Error("expected browser outcome");
    expect(historical.phase.application).toBeUndefined();
  });
  it("does not attach wrong original request or refused result as successful browser evidence", () => {
    const f = browserFixture();
    f.insertAudit({ ...f.audit, request: { ...f.audit.request, source: "foreign" } });
    expect(() => f.controls.audit(UUID_1, LATER)).toThrow(/application-audit-mismatch/);
    expect(f.controls.get(UUID_1)?.auditedAt).toBeUndefined();
    const other = browserFixture();
    other.db.prepare("INSERT INTO command_audits(id,command_id,code,payload_json,created_at) VALUES(?,?,?,?,?)").run(UUID_2, UUID_1, "invalid-state", canonicalJsonStringify({ ...other.audit, result: { state: "rejected", commandId: UUID_1, code: "invalid-state", message: "refused" } }), LATER);
    expect(() => other.controls.audit(UUID_1, LATER)).toThrow(/worker-control-success-result-required/);
    expect(other.controls.get(UUID_1)?.auditedAt).toBeUndefined();
  });
});
