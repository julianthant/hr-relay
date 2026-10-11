import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { SQLITE_MIGRATIONS } from "../../../../../src/backend/storage/sqlite/migrations.js";
import { createWorkerSlotRepository } from "../../../../../src/backend/storage/sqlite/worker-slots.js";
import { insertNativeCommand } from "../../../../../src/backend/storage/sqlite/command-record-row.js";
import { WorkerPoolRecordSchema } from "../../../../../src/models/run/worker-pool.js";
import { canonicalJsonStringify } from "../../../../../src/rules/validation/canonical-json.js";
import { NOW, UUID_2 } from "../../../../support/fixtures/phase1c-contract-fixtures.js";
const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function fixture() {
  const db = new DatabaseSync(":memory:"); databases.push(db);
  for (const migration of SQLITE_MIGRATIONS) for (const sql of migration.statements) db.exec(sql);
  const slots = createWorkerSlotRepository({ database: db, mutate(work) {
    db.exec("BEGIN IMMEDIATE"); try { const result = work(); db.exec("COMMIT"); return result.result; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  } });
  const pool = (workflow: string, desiredWorkers = 0) => {
    const record = WorkerPoolRecordSchema.parse({ workflow, desiredWorkers, plannedBy: "local-operator", plannedAt: NOW, version: 1, createdAt: NOW, updatedAt: NOW });
    db.prepare("INSERT INTO worker_pools VALUES(?,?,?,?,?,?)").run(workflow,desiredWorkers,1,canonicalJsonStringify(record),NOW,NOW);
  };
  const allocate = (workflow: string, poolIndex: number) => slots.allocate({ workflow,poolIndex,commandId:null,now:NOW });
  return { db, slots, pool, allocate };
}
describe("native stable worker slots", () => {
  it("allocates global ordinals, preserves survivors and never reuses retired identity", () => {
    const f = fixture(); f.pool("person-lookup"); f.pool("separations");
    const first = f.allocate("person-lookup",1), survivor = f.allocate("person-lookup",2), other = f.allocate("separations",1);
    expect([first.ordinal,survivor.ordinal,other.ordinal]).toEqual([1,2,3]);
    insertNativeCommand(f.db,{ commandId:UUID_2,family:"worker-browser",type:"plan-worker-count",requestedAt:NOW,requestedBy:"local-operator",source:"dashboard",target:{workflowId:"person-lookup",expectedVersion:1},payload:{desiredWorkers:1} });
    f.slots.retire({ workerId:first.workerId,commandId:UUID_2,expectedRevision:1,now:NOW });
    const replacement = f.allocate("person-lookup",1);
    expect(replacement.ordinal).toBe(4);
    expect(replacement.workerId).not.toBe(first.workerId);
    expect(f.allocate("person-lookup",2)).toEqual(survivor);
    expect(f.slots.list()).toHaveLength(4);
    expect(f.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
  it("admits zero desired workers and refuses more than three active slots per workflow", () => {
    const f = fixture(); f.pool("person-lookup",0);
    for (const poolIndex of [1,2,3]) f.allocate("person-lookup",poolIndex);
    expect(f.slots.list().filter(slot=>slot.retiredAt===null)).toHaveLength(3);
    expect(()=>f.allocate("person-lookup",4)).toThrow();
    expect(WorkerPoolRecordSchema.safeParse({ workflow:"person-lookup",desiredWorkers:4,plannedBy:"local-operator",plannedAt:NOW,version:1,createdAt:NOW,updatedAt:NOW }).success).toBe(false);
  });
  it("requires pool admission and rolls back failed slot writes", () => {
    const f = fixture(); expect(()=>f.allocate("person-lookup",1)).toThrow(/not-admitted/u);
    expect(f.slots.list()).toEqual([]);
  });
});
