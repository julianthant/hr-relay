import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { insertNativeCommand } from "../../../../src/backend/storage/sqlite/command-record-row.js";
import { SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import { createWorkerControlRepository } from "../../../../src/backend/storage/sqlite/worker-control.js";
import { createWorkerSlotRepository } from "../../../../src/backend/storage/sqlite/worker-slots.js";
import { WorkerPoolRecordSchema } from "../../../../src/models/run/worker-pool.js";
import { workerPoolMember } from "../../../../src/models/run/worker-slot.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { createWorkerLeaseFixtures } from "../../../support/helpers/backend/worker-lease-fixtures.js";
import { LATER, NOW, UUID_1, UUID_2, UUID_3 } from "../../../support/fixtures/phase1c-contract-fixtures.js";

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

describe("authenticated ordinary control identity", () => {
  function ordinary(missingMember = false) {
    const f = fixture();
    const request = { ...f.request, type: "pause-worker", target: { workerId: f.slot.workerId, expectedVersion: 1, controlBasis: { leaseGeneration: 1, controlRevision: 1 } } };
    const { payload: _payload, ...command } = request;
    const record = { ...f.record, request: missingMember ? { ...command, target: { ...command.target, workerId: "person-lookup-worker-2" } } : command };
    insertNativeCommand(f.db, record.request);
    const lease = reservedLease(f);
    const control = { member: missingMember ? { ...workerPoolMember(f.slot), workerId: "person-lookup-worker-2", ordinal: 2, poolIndex: 2 } : workerPoolMember(f.slot), lifetime: { leaseGeneration: lease.leaseGeneration, processId: lease.processId, startedAt: lease.lifecycle.startedAt } };
    return { ...f, record, control };
  }
  it("captures exact identity once, retains it through later lifetime changes, and never annotates unbound history", () => {
    const f = ordinary();
    const captured = f.controls.admit(f.record);
    expect(captured.control).toEqual(f.control);
    reservedLease(f, { processId: 999, lifecycle: { state: "idle", startedAt: LATER, heartbeatAt: LATER } });
    expect(f.controls.admit(f.record)).toEqual(captured);
    expect(() => f.controls.admit({ ...f.record, control: { ...f.control, lifetime: { ...f.control.lifetime, processId: 999 } } })).toThrow(/divergent/);
    const { control: _control, ...historical } = captured;
    f.db.prepare("UPDATE worker_controls SET payload_json=? WHERE command_id=?").run(canonicalJsonStringify(historical), UUID_1);
    expect(f.controls.get(UUID_1)).toEqual(historical);
    expect(f.controls.admit(f.record)).toEqual(historical);
    expect(f.controls.get(UUID_1)?.control).toBeUndefined();
  });
  it.each(["missing-member", "retired-member", "unreserved-command", "revision", "generation", "process", "started", "member"])("refuses %s binding without storing a control", scenario => {
    const f = ordinary(scenario === "missing-member");
    let control: unknown = f.control;
    if (scenario === "retired-member") {
      const slot = { ...f.slot, retiredAt: LATER, retirementCommandId: UUID_1 };
      f.db.prepare("UPDATE worker_slots SET retired_at=?,retirement_command_id=?,payload_json=? WHERE id=?").run(LATER, UUID_1, canonicalJsonStringify(slot), f.slot.workerId);
    }
    if (scenario === "unreserved-command") reservedLease(f, { controlCommandId: UUID_3 });
    if (scenario === "revision") reservedLease(f, { controlRevision: 3 });
    if (scenario === "generation") reservedLease(f, { leaseGeneration: 2 });
    if (scenario === "process") control = { ...f.control, lifetime: { ...f.control.lifetime, processId: 999 } };
    if (scenario === "started") control = { ...f.control, lifetime: { ...f.control.lifetime, startedAt: LATER } };
    if (scenario === "member") control = { ...f.control, member: { ...f.control.member, membershipRevision: 2 } };
    expect(() => f.controls.admit({ ...f.record, control })).toThrow(/worker-control/);
    expect(f.controls.list()).toEqual([]);
  });
});
