import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createCommandKernel, type WorkerRuntimeContext } from "../../../../src/backend/runs/commands/command-kernel.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { insertNativeCommand } from "../../../../src/backend/storage/sqlite/command-record-row.js";
import { SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import { admitDirectWorker, admitSupervisedWorker, admitWorkerPoolRoster, createWorkerSlotRepository } from "../../../../src/backend/storage/sqlite/worker-slots.js";
import { workerControlScope } from "../../../../src/models/run/worker-control.js";
import { WorkerPoolRecordSchema } from "../../../../src/models/run/worker-pool.js";
import { workerPoolMember, WorkerRetirementProofSchema } from "../../../../src/models/run/worker-slot.js";
import { CommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { capturedInstantClock } from "../../../../src/rules/time/clock.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { fixtureDescriptor } from "../../../support/fixtures/descriptor-fixtures.js";
import { NO_INTAKE_PROJECTIONS, UNWIRED_INTAKE_PARSER } from "../../../support/fixtures/intake-kernel-seams.js";
import { CONFIG_SNAPSHOT, NOW, UUID_2, UUID_5, UUID_6, UUID_7 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

{

const cleanups: (() => Promise<void>)[] = [];
const _afterEachFixture0 = async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); };
async function rosterFixture() {
  const profile = await createBoundProfileFixture();
  const path = profile.path;
  const admission = profile.admission;
  const credentials = boundProfileCredentials(admission);
  const open = () => AuthorityDatabase.open(admission, { path, busyTimeoutMs: 250, migrationOwner: "native-test" }, undefined, undefined, undefined, undefined, credentials);
  let db = open(); db.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  cleanups.push(async () => { db.close(); await profile.close(); });
  let effects = 0;
  let effect: (context: WorkerRuntimeContext) => unknown = context => {
    const roster = context.roster; if (roster === undefined) throw new Error("missing roster");
    return { state: "accepted", workerIds: roster.selected.map(slot => slot.workerId),
      retirements: roster.excess.map(slot => WorkerRetirementProofSchema.parse({ workerId: slot.workerId,
        membershipRevision: slot.membershipRevision, checkedAt: NOW, processStopped: true, browsersClosed: true, exclusive: true })) };
  };
  const unused = (): never => { throw new Error("unused offline port"); };
  const ids = sequentialIdFactory();
  const kernel = () => createCommandKernel({ authority: db,
    lifecycle: new RunRecordService({ database: db, clock: capturedInstantClock(NOW), ids: sequentialIdFactory("b"), publishQueued: unused }),
    clock: capturedInstantClock(NOW), ids, appVersion: "1.0.0",
    descriptors: { resolve: workflow => workflow === fixtureDescriptor.id ? fixtureDescriptor : undefined },
    configIdentity: { configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId, configFingerprint: CONFIG_SNAPSHOT.fingerprint },
    intakeParser: UNWIRED_INTAKE_PARSER, intakeProjections: NO_INTAKE_PROJECTIONS,
    writeResolution: { recheck: unused, resolveAbsent: unused },
    workerRuntime: { pool: { planPoolWorkerCount: async context => { effects += 1; return effect(context); },
      spawnPoolWorker: unused, refreshPoolBrowser: unused, reopenPoolBrowser: unused,
      stopPoolWorker: unused, pausePoolWorker: unused, resumePoolWorker: unused } } });
  const request = (commandId: string, expectedVersion: number, desiredWorkers: number) => CommandRequestSchema.parse({
    commandId, family: "worker-browser", type: "plan-worker-count", source: "dashboard", requestedAt: NOW, requestedBy: "local-operator",
    target: { workflowId: fixtureDescriptor.id, expectedVersion }, payload: { desiredWorkers } });
  const auditFault = (enabled: boolean) => {
    const raw = new DatabaseSync(path);
    try { raw.exec(enabled ? `CREATE TRIGGER native_test_audit_fault BEFORE INSERT ON command_audits
      WHEN NEW.command_id='${UUID_6}' BEGIN SELECT RAISE(ABORT,'audit-publication-fault'); END;` : "DROP TRIGGER native_test_audit_fault"); }
    finally { raw.close(); }
  };
  return { auditFault, get db() { return db; }, kernel, request, effects: () => effects,
    setEffect: (next: typeof effect) => { effect = next; }, restart: () => { db.close(); db = open(); } };
}
describe("native command-bound worker roster", () => {
afterEach(_afterEachFixture0);

  it("admits zero desired workers without inventing members and replays without effects", async () => {
    const f = await rosterFixture(), request = f.request(UUID_5, 0, 0);
    expect((await f.kernel().executeWorkerPool(request)).state).toBe("applied");
    expect(f.db.authority.workerSlots.list()).toEqual([]);
    expect(f.db.authority.workerPools.get(fixtureDescriptor.id)?.version).toBe(1);
    f.restart(); const generation = f.db.getMeta().authorityGeneration;
    expect((await f.kernel().executeWorkerPool(request)).state).toBe("already-applied");
    expect(f.effects()).toBe(1); expect(f.db.getMeta().authorityGeneration).toBe(generation);
  });
  it("admits four members and retires all to zero without changing retained identities", async () => {
    const f = await rosterFixture();
    expect((await f.kernel().executeWorkerPool(f.request(UUID_5, 0, 4))).state).toBe("applied");
    const members = f.db.authority.workerSlots.list();
    expect(members.map(slot => slot.poolIndex)).toEqual([1, 2, 3, 4]);
    expect(f.db.authority.workerPools.get(fixtureDescriptor.id)?.desiredWorkers).toBe(4);
    expect((await f.kernel().executeWorkerPool(f.request(UUID_6, 1, 0))).state).toBe("applied");
    expect(f.db.authority.workerPools.get(fixtureDescriptor.id)?.desiredWorkers).toBe(0);
    expect(f.db.authority.workerSlots.list().map(slot => slot.workerId)).toEqual(members.map(slot => slot.workerId));
    expect(f.db.authority.workerSlots.list().every(slot => slot.retirementCommandId === UUID_6)).toBe(true);
    f.restart();
    expect(f.db.authority.workerSlots.list()).toHaveLength(4);
  });
  it("refuses inconsistent historical declarations before allocating or invoking effects", async () => {
    const f = await rosterFixture();
    f.db.authority.workerPools.plan({ workflow: fixtureDescriptor.id, expectedVersion: 0, desiredWorkers: 2,
      requestedBy: "local-operator", now: NOW });
    await expect(f.kernel().executeWorkerPool(f.request(UUID_5, 1, 4))).rejects.toThrow(/roster-authority-unavailable/u);
    expect(f.effects()).toBe(0);
    expect(f.db.authority.workerSlots.list()).toEqual([]);
    expect(f.db.authority.workerControls.get(UUID_5)).toBeUndefined();
    expect(() => f.db.authority.workerSlots.allocate({ workflow: fixtureDescriptor.id, poolIndex: 1, commandId: null, now: NOW })).toThrow(/roster-authority-unavailable/u);
    expect(f.db.authority.workerSlots.list()).toEqual([]);
    const slot = f.db.withAuthorityTransaction(repositories => {
      repositories.workerPools.plan({ workflow: fixtureDescriptor.id, expectedVersion: 1, desiredWorkers: 1,
        requestedBy: "local-operator", now: NOW });
      return repositories.workerSlots.allocate({ workflow: fixtureDescriptor.id, poolIndex: 1, commandId: null, now: NOW });
    });
    f.db.authority.workerPools.plan({ workflow: fixtureDescriptor.id, expectedVersion: 2, desiredWorkers: 2,
      requestedBy: "local-operator", now: NOW });
    await expect(f.kernel().executeWorkerPool({ ...f.request(UUID_6, 3, 4), type: "spawn-worker",
      payload: { workerId: slot.workerId } })).rejects.toThrow(/roster-authority-unavailable/u);
    expect(f.db.authority.workerControls.get(UUID_6)).toBeUndefined();
  });
  it("rolls back primitive retirement until the same transaction updates its declaration", async () => {
    const f = await rosterFixture();
    await f.kernel().executeWorkerPool(f.request(UUID_5, 0, 1));
    const slot = f.db.authority.workerSlots.list()[0];
    if (slot === undefined) throw new Error("missing admitted slot");
    f.db.authority.commands.insert(f.request(UUID_6, 1, 0));
    expect(() => f.db.authority.workerSlots.retire({ workerId: slot.workerId, commandId: UUID_6,
      expectedRevision: 1, now: NOW })).toThrow(/roster-authority-unavailable/u);
    expect(f.db.authority.workerSlots.get(slot.workerId)).toEqual(slot);
    f.db.withAuthorityTransaction(repositories => {
      repositories.workerSlots.retire({ workerId: slot.workerId, commandId: UUID_6, expectedRevision: 1, now: NOW });
      repositories.workerPools.plan({ workflow: fixtureDescriptor.id, expectedVersion: 1, desiredWorkers: 0,
        requestedBy: "local-operator", now: NOW });
    });
    expect(f.db.authority.workerSlots.get(slot.workerId)?.retirementCommandId).toBe(UUID_6);
    expect(f.db.authority.workerPools.get(fixtureDescriptor.id)?.desiredWorkers).toBe(0);
  });
  it("restores changed membership tracking when a nested allocation rolls back", async () => {
    const f = await rosterFixture();
    f.db.authority.workerPools.plan({ workflow: "fixture-child", expectedVersion: 0, desiredWorkers: 2,
      requestedBy: "local-operator", now: NOW });
    f.db.withAuthorityTransaction(repositories => {
      expect(() => f.db.withAuthorityTransaction(nested => {
        nested.workerSlots.allocate({ workflow: "fixture-child", poolIndex: 1, commandId: null, now: NOW });
        throw new Error("nested-allocation-abort");
      })).toThrow("nested-allocation-abort");
      repositories.workerPools.plan({ workflow: fixtureDescriptor.id, expectedVersion: 0, desiredWorkers: 1,
        requestedBy: "local-operator", now: NOW });
      repositories.workerSlots.allocate({ workflow: fixtureDescriptor.id, poolIndex: 1, commandId: null, now: NOW });
    });
    expect(f.db.authority.workerSlots.list("fixture-child")).toEqual([]);
    expect(f.db.authority.workerSlots.list(fixtureDescriptor.id)).toHaveLength(1);
  });
  it("persists genuine direct CLI admission and its original global slot without authorizing a process effect", async () => {
    const f = await rosterFixture();
    const request = { commandId: UUID_5, workflow: fixtureDescriptor.id, poolIndex: 2,
      expectedPoolVersion: 0, processId: 4100, now: NOW };
    const first = f.db.withAuthorityTransaction(repositories => admitDirectWorker(repositories, request, UUID_7));
    expect(first).toMatchObject({ ordinal: 1, poolIndex: 2, reservationCommandId: UUID_5 });
    expect(f.db.authority.workerLeases.get(first.workerId)).toBeUndefined();
    expect(f.db.authority.lifecycleJournal.findAuditByCommand(UUID_5)).toMatchObject({ kind: "run-lifecycle",
      request: { operation: "worker-admission", request }, result: { kind: "worker", slot: first, beforePoolVersion: 0, afterPoolVersion: 1 } });
    f.restart(); const generation = f.db.getMeta().authorityGeneration;
    expect(f.db.withAuthorityTransaction(repositories => admitDirectWorker(repositories, request, UUID_7))).toEqual(first);
    expect(f.db.getMeta().authorityGeneration).toBe(generation); expect(f.effects()).toBe(0);
    expect(() => f.db.withAuthorityTransaction(repositories => admitDirectWorker(repositories, { ...request, processId: 4101 }, UUID_7))).toThrow(/divergent/u);
  });
  it("admits supervised launch only for the exact executing original command and current membership", async () => {
    const f = await rosterFixture(); await f.kernel().executeWorkerPool(f.request(UUID_5, 0, 1));
    const slot = f.db.authority.workerSlots.list()[0]; if (slot === undefined) throw new Error("missing reserved slot");
    const member = workerPoolMember(slot);
    const request = CommandRequestSchema.parse({ commandId: UUID_6, family: "worker-browser", type: "spawn-worker",
      source: "dashboard", requestedAt: NOW, requestedBy: "local-operator",
      target: { workflowId: fixtureDescriptor.id, expectedVersion: 1 }, payload: { workerId: member.workerId } });
    if (request.family !== "worker-browser") throw new Error("wrong fixture request");
    f.db.withAuthorityTransaction(repositories => {
      repositories.commands.insert(request);
      repositories.workerControls.admit({ commandId: UUID_6, request, scope: workerControlScope(request), executorId: UUID_7,
        admittedAt: NOW, expiresAt: new Date(Date.parse(NOW) + 180_000).toISOString(), basisVersion: 1, phase: { state: "admitted" } });
    });
    expect(() => admitSupervisedWorker(f.db.authority, { member, commandId: UUID_6, now: NOW })).toThrow(/not-admitted/u);
    f.db.authority.workerControls.transition(UUID_6, "admitted", { state: "executing", startedAt: NOW });
    expect(admitSupervisedWorker(f.db.authority, { member, commandId: UUID_6, now: NOW })).toBe(member.workerId);
    expect(() => admitSupervisedWorker(f.db.authority, { member: { ...member, membershipRevision: 2 }, commandId: UUID_6, now: NOW })).toThrow(/not-admitted/u);
    expect(() => admitSupervisedWorker(f.db.authority, { member, commandId: UUID_7, now: NOW })).toThrow(/not-admitted/u);
    expect(() => admitSupervisedWorker(f.db.authority, { member, commandId: UUID_6, now: new Date(Date.parse(NOW) + 180_000).toISOString() })).toThrow(/not-admitted/u);
    expect(f.db.authority.workerLeases.get(member.workerId)).toBeUndefined();
  });
  it("retains an admitted pre-effect crash without promoting it to execution on restart", async () => {
    const f = await rosterFixture(), request = f.request(UUID_5, 0, 2);
    if (request.type !== "plan-worker-count") throw new Error("wrong fixture request");
    f.db.withAuthorityTransaction(repositories => {
      repositories.commands.insert(request);
      const roster = admitWorkerPoolRoster(repositories, request, NOW);
      repositories.workerControls.admit({ commandId: request.commandId, request, scope: workerControlScope(request),
        executorId: UUID_6, admittedAt: NOW, expiresAt: new Date(Date.parse(NOW) + 180_000).toISOString(), basisVersion: 0,
        roster, phase: { state: "admitted" } });
    });
    const original = canonicalJsonStringify(f.db.authority.workerSlots.list());
    f.restart(); expect((await f.kernel().executeWorkerPool(request)).state).toBe("rejected");
    expect(f.effects()).toBe(0);
    expect(f.db.authority.commandAudits.findByCommand(UUID_5)).toBeUndefined();
    expect(canonicalJsonStringify(f.db.authority.workerSlots.list())).toBe(original);
    expect(f.db.authority.workerControls.get(UUID_5)?.phase.state).toBe("admitted");
  });
  it("retains original reservation after the first effect fails and never executes it again after restart", async () => {
    const f = await rosterFixture(), request = f.request(UUID_5, 0, 2);
    f.setEffect(context => {
      expect(context.roster?.selected).toHaveLength(2);
      expect(f.db.authority.workerPools.get(fixtureDescriptor.id)?.version).toBe(1);
      expect(f.db.authority.commands.get(UUID_5)).toBeDefined();
      throw new Error("first-effect-fault");
    });
    await expect(f.kernel().executeWorkerPool(request)).rejects.toThrow("first-effect-fault");
    const original = canonicalJsonStringify(f.db.authority.workerSlots.list());
    expect(f.db.authority.workerControls.get(UUID_5)?.phase.state).toBe("uncertain");
    expect(f.db.authority.commandAudits.findByCommand(UUID_5)).toBeUndefined();
    f.restart(); expect((await f.kernel().executeWorkerPool(request)).state).toBe("rejected");
    expect(f.effects()).toBe(1); expect(canonicalJsonStringify(f.db.authority.workerSlots.list())).toBe(original);
  });
  it("retains count and every excess identity if shrink effects become uncertain", async () => {
    const f = await rosterFixture(); expect((await f.kernel().executeWorkerPool(f.request(UUID_5, 0, 3))).state).toBe("applied");
    const original = f.db.authority.workerSlots.list();
    f.setEffect(context => {
      expect(context.roster?.selected.map(slot => slot.workerId)).toEqual([original[0]?.workerId]);
      expect(context.roster?.excess.map(slot => slot.workerId)).toEqual(original.slice(1).map(slot => slot.workerId));
      expect(f.db.authority.workerPools.get(fixtureDescriptor.id)).toMatchObject({ desiredWorkers: 3, version: 1 });
      throw new Error("partial-shrink-fault");
    });
    const request = f.request(UUID_6, 1, 1);
    await expect(f.kernel().executeWorkerPool(request)).rejects.toThrow("partial-shrink-fault");
    expect(f.db.authority.workerSlots.list()).toEqual(original);
    f.restart(); expect((await f.kernel().executeWorkerPool(request)).state).toBe("rejected");
    expect(f.db.authority.workerPools.get(fixtureDescriptor.id)).toMatchObject({ desiredWorkers: 3, version: 1 });
    expect(f.effects()).toBe(2);
  });
  it("retires only proved excess slots atomically with the lower count, preserving survivors and ordinals", async () => {
    const f = await rosterFixture(); await f.kernel().executeWorkerPool(f.request(UUID_5, 0, 3));
    const original = f.db.authority.workerSlots.list(), shrink = f.request(UUID_6, 1, 1);
    expect((await f.kernel().executeWorkerPool(shrink)).state).toBe("applied");
    expect(f.db.authority.workerPools.get(fixtureDescriptor.id)).toMatchObject({ desiredWorkers: 1, version: 2 });
    expect(f.db.authority.workerSlots.get(original[0].workerId)).toEqual(original[0]);
    expect(f.db.authority.workerSlots.list().slice(1).map(slot => slot.retirementCommandId)).toEqual([UUID_6, UUID_6]);
    f.restart(); expect((await f.kernel().executeWorkerPool(shrink)).state).toBe("already-applied");
    expect(f.effects()).toBe(2);
    await f.kernel().executeWorkerPool(f.request(UUID_7, 2, 3));
    expect(f.db.authority.workerSlots.list().filter(slot => slot.retiredAt === null).map(slot => slot.ordinal)).toEqual([1, 4, 5]);
  });
  it("replays the original settled roster after an audit-publication crash without repeating effects or retirement", async () => {
    const f = await rosterFixture(); await f.kernel().executeWorkerPool(f.request(UUID_5, 0, 3));
    const shrink = f.request(UUID_6, 1, 1); f.auditFault(true);
    await expect(f.kernel().executeWorkerPool(shrink)).rejects.toThrow("audit-publication-fault");
    expect(f.db.authority.workerControls.get(UUID_6)?.phase.state).toBe("succeeded");
    expect(f.db.authority.commandAudits.findByCommand(UUID_6)).toBeUndefined();
    const original = canonicalJsonStringify(f.db.authority.workerSlots.list());
    expect(f.db.authority.workerPools.get(fixtureDescriptor.id)).toMatchObject({ desiredWorkers: 1, version: 2 });
    f.auditFault(false); f.restart();
    expect((await f.kernel().executeWorkerPool(shrink)).state).toBe("applied");
    expect(f.effects()).toBe(2); expect(canonicalJsonStringify(f.db.authority.workerSlots.list())).toBe(original);
    const generation = f.db.getMeta().authorityGeneration;
    expect((await f.kernel().executeWorkerPool(shrink)).state).toBe("already-applied");
    expect(f.db.getMeta().authorityGeneration).toBe(generation); expect(f.effects()).toBe(2);
  });
  it("rolls back all retirement and count changes on a missing or forged second closure proof", async () => {
    const f = await rosterFixture(); await f.kernel().executeWorkerPool(f.request(UUID_5, 0, 3));
    const original = f.db.authority.workerSlots.list();
    f.setEffect(context => ({ state: "accepted", workerIds: context.roster?.selected.map(slot => slot.workerId),
      retirements: context.roster?.excess.map((slot, index) => ({ workerId: slot.workerId,
        membershipRevision: slot.membershipRevision + index, checkedAt: NOW, processStopped: true, browsersClosed: true, exclusive: true })) }));
    await expect(f.kernel().executeWorkerPool(f.request(UUID_6, 1, 1))).rejects.toThrow("worker-retirement-not-proved");
    expect(f.db.authority.workerSlots.list()).toEqual(original);
    expect(f.db.authority.workerPools.get(fixtureDescriptor.id)).toMatchObject({ desiredWorkers: 3, version: 1 });
    expect(f.db.authority.commandAudits.findByCommand(UUID_6)).toBeUndefined();
  });
});
}

{

const databases: DatabaseSync[] = [];
const _afterEachFixture0 = () => { for (const db of databases.splice(0)) db.close(); };
function fixture() {
  const db = new DatabaseSync(":memory:"); databases.push(db);
  for (const migration of SQLITE_MIGRATIONS) for (const sql of migration.statements) db.exec(sql);
  const slots = createWorkerSlotRepository({ database: db, admission: RuntimeAdmission.syntheticFixture(":memory:"), mutate(work) {
    if (db.isTransaction) return work().result;
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
afterEach(_afterEachFixture0);

  it("allocates global ordinals, preserves survivors and never reuses retired identity", () => {
    const f = fixture(); f.db.exec("BEGIN"); f.pool("person-lookup",2); f.pool("separations",1);
    const first = f.allocate("person-lookup",1), survivor = f.allocate("person-lookup",2), other = f.allocate("separations",1);
    expect([first.ordinal,survivor.ordinal,other.ordinal]).toEqual([1,2,3]);
    insertNativeCommand(f.db,{ commandId:UUID_2,family:"worker-browser",type:"plan-worker-count",requestedAt:NOW,requestedBy:"local-operator",source:"dashboard",target:{workflowId:"person-lookup",expectedVersion:1},payload:{desiredWorkers:1} });
    f.slots.retire({ workerId:first.workerId,commandId:UUID_2,expectedRevision:1,now:NOW });
    const replacement = f.allocate("person-lookup",1);
    expect(replacement.ordinal).toBe(4);
    expect(replacement.workerId).not.toBe(first.workerId);
    expect(f.allocate("person-lookup",2)).toEqual(survivor);
    expect(f.slots.list()).toHaveLength(4);
    f.db.exec("COMMIT");
    expect(f.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
  it("validates zero and admits more than three active slots per workflow", () => {
    const f = fixture(); f.db.exec("BEGIN"); f.pool("person-lookup",4);
    expect(WorkerPoolRecordSchema.safeParse({ workflow:"person-lookup",desiredWorkers:0,plannedBy:"local-operator",plannedAt:NOW,version:1,createdAt:NOW,updatedAt:NOW }).success).toBe(true);
    for (const poolIndex of [1,2,3]) f.allocate("person-lookup",poolIndex);
    expect(f.slots.list().filter(slot=>slot.retiredAt===null)).toHaveLength(3);
    expect(f.allocate("person-lookup",4).poolIndex).toBe(4);
    expect(()=>f.allocate("person-lookup",0)).toThrow();
    expect(WorkerPoolRecordSchema.safeParse({ workflow:"person-lookup",desiredWorkers:4,plannedBy:"local-operator",plannedAt:NOW,version:1,createdAt:NOW,updatedAt:NOW }).success).toBe(true);
    f.db.exec("COMMIT");
  });
  it("requires pool admission and rolls back failed slot writes", () => {
    const f = fixture(); expect(()=>f.allocate("person-lookup",1)).toThrow(/not-admitted/u);
    expect(f.slots.list()).toEqual([]);
  });
});
}
