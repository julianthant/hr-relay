import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { SQLITE_MIGRATIONS } from "../../../../../src/backend/storage/sqlite/migrations.js";
import { createWorkerControlRepository, workerControlFromRow, workerBrowserFromRow } from "../../../../../src/backend/storage/sqlite/worker-control.js";
import { insertNativeCommand } from "../../../../../src/backend/storage/sqlite/command-record-row.js";
import { createWorkerSlotRepository } from "../../../../../src/backend/storage/sqlite/worker-slots.js";
import { WorkerPoolRecordSchema } from "../../../../../src/models/run/worker-pool.js";
import { canonicalJsonStringify } from "../../../../../src/rules/validation/canonical-json.js";
import { HASH_A, NOW, LATER, UUID_1, UUID_2, UUID_3 } from "../../../../support/fixtures/phase1c-contract-fixtures.js";
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
