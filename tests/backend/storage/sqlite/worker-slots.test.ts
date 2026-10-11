import { mkdtempSync as mkdtempSync_m0,realpathSync as realpathSync_m0,rmSync as rmSync_m0 } from "node:fs";
import { tmpdir as tmpdir_m0 } from "node:os";
import { join as join_m0 } from "node:path";
import { DatabaseSync as DatabaseSync_m0,DatabaseSync as DatabaseSync_m1 } from "node:sqlite";
import { afterEach as afterEach_m0,afterEach as afterEach_m1,describe as describe_m0,describe as describe_m1,expect as expect_m0,expect as expect_m1,it as it_m0,it as it_m1 } from "vitest";
import { createCommandKernel as createCommandKernel_m0,type WorkerRuntimeContext as WorkerRuntimeContext_m0 } from "../../../../src/backend/runs/commands/command-kernel.js";
import { RunRecordService as RunRecordService_m0 } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { RuntimeAdmission as RuntimeAdmission_m0 } from "../../../../src/backend/storage/admission/admission.js";
import { AuthorityDatabase as AuthorityDatabase_m0 } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { insertNativeCommand as insertNativeCommand_m1 } from "../../../../src/backend/storage/sqlite/command-record-row.js";
import { SQLITE_MIGRATIONS as SQLITE_MIGRATIONS_m1 } from "../../../../src/backend/storage/sqlite/migrations.js";
import { admitDirectWorker as admitDirectWorker_m0,admitSupervisedWorker as admitSupervisedWorker_m0,admitWorkerPoolRoster as admitWorkerPoolRoster_m0,createWorkerSlotRepository as createWorkerSlotRepository_m1 } from "../../../../src/backend/storage/sqlite/worker-slots.js";
import { workerControlScope as workerControlScope_m0 } from "../../../../src/models/run/worker-control.js";
import { WorkerPoolRecordSchema as WorkerPoolRecordSchema_m1 } from "../../../../src/models/run/worker-pool.js";
import { workerPoolMember as workerPoolMember_m0,WorkerRetirementProofSchema as WorkerRetirementProofSchema_m0 } from "../../../../src/models/run/worker-slot.js";
import { CommandRequestSchema as CommandRequestSchema_m0 } from "../../../../src/rules/commands/commands.js";
import { capturedInstantClock as capturedInstantClock_m0 } from "../../../../src/rules/time/clock.js";
import { canonicalJsonStringify as canonicalJsonStringify_m0,canonicalJsonStringify as canonicalJsonStringify_m1 } from "../../../../src/rules/validation/canonical-json.js";
import { fixtureDescriptor as fixtureDescriptor_m0 } from "../../../support/fixtures/descriptor-fixtures.js";
import { NO_INTAKE_PROJECTIONS as NO_INTAKE_PROJECTIONS_m0,UNWIRED_INTAKE_PARSER as UNWIRED_INTAKE_PARSER_m0 } from "../../../support/fixtures/intake-kernel-seams.js";
import { CONFIG_SNAPSHOT as CONFIG_SNAPSHOT_m0,NOW as NOW_m0,NOW as NOW_m1,UUID_2 as UUID_2_m1,UUID_5 as UUID_5_m0,UUID_6 as UUID_6_m0,UUID_7 as UUID_7_m0 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory as sequentialIdFactory_m0 } from "../../../support/fixtures/phase1f-run-fixtures.js";


{

const cleanups: (() => void)[] = [];
const _afterEachFixture0 = () => { for (const cleanup of cleanups.splice(0)) cleanup(); };
function fixture() {
  const root = realpathSync_m0(mkdtempSync_m0(join_m0(tmpdir_m0(), "relay-native-roster-"))), path = join_m0(root, "authority.sqlite");
  const admission = RuntimeAdmission_m0.syntheticFixture(path);
  const open = () => AuthorityDatabase_m0.open(admission, { path, busyTimeoutMs: 250, migrationOwner: "native-test" });
  let db = open(); db.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT_m0);
  cleanups.push(() => { db.close(); rmSync_m0(root, { recursive: true, force: true }); });
  let effects = 0;
  let effect: (context: WorkerRuntimeContext_m0) => unknown = context => {
    const roster = context.roster; if (roster === undefined) throw new Error("missing roster");
    return { state: "accepted", workerIds: roster.selected.map(slot => slot.workerId),
      retirements: roster.excess.map(slot => WorkerRetirementProofSchema_m0.parse({ workerId: slot.workerId,
        membershipRevision: slot.membershipRevision, checkedAt: NOW_m0, processStopped: true, browsersClosed: true, exclusive: true })) };
  };
  const unused = (): never => { throw new Error("unused offline port"); };
  const ids = sequentialIdFactory_m0();
  const kernel = () => createCommandKernel_m0({ authority: db,
    lifecycle: new RunRecordService_m0({ database: db, clock: capturedInstantClock_m0(NOW_m0), ids: sequentialIdFactory_m0("b"), publishQueued: unused }),
    clock: capturedInstantClock_m0(NOW_m0), ids, appVersion: "1.0.0",
    descriptors: { resolve: workflow => workflow === fixtureDescriptor_m0.id ? fixtureDescriptor_m0 : undefined },
    configIdentity: { configSnapshotId: CONFIG_SNAPSHOT_m0.configSnapshotId, configFingerprint: CONFIG_SNAPSHOT_m0.fingerprint },
    intakeParser: UNWIRED_INTAKE_PARSER_m0, intakeProjections: NO_INTAKE_PROJECTIONS_m0,
    writeResolution: { resolvePresent: unused, resolveAbsent: unused },
    workerRuntime: { pool: { planPoolWorkerCount: async context => { effects += 1; return effect(context); },
      spawnPoolWorker: unused, refreshPoolBrowser: unused, reopenPoolBrowser: unused,
      stopPoolWorker: unused, pausePoolWorker: unused, resumePoolWorker: unused } } });
  const request = (commandId: string, expectedVersion: number, desiredWorkers: number) => CommandRequestSchema_m0.parse({
    commandId, family: "worker-browser", type: "plan-worker-count", source: "dashboard", requestedAt: NOW_m0, requestedBy: "local-operator",
    target: { workflowId: fixtureDescriptor_m0.id, expectedVersion }, payload: { desiredWorkers } });
  const auditFault = (enabled: boolean) => {
    const raw = new DatabaseSync_m0(path);
    try { raw.exec(enabled ? `CREATE TRIGGER native_test_audit_fault BEFORE INSERT ON command_audits
      WHEN NEW.command_id='${UUID_6_m0}' BEGIN SELECT RAISE(ABORT,'audit-publication-fault'); END;` : "DROP TRIGGER native_test_audit_fault"); }
    finally { raw.close(); }
  };
  return { auditFault, get db() { return db; }, kernel, request, effects: () => effects,
    setEffect: (next: typeof effect) => { effect = next; }, restart: () => { db.close(); db = open(); } };
}
describe_m0("native command-bound worker roster", () => {
afterEach_m0(_afterEachFixture0);

  it_m0("admits zero desired workers without inventing members and replays without effects", async () => {
    const f = fixture(), request = f.request(UUID_5_m0, 0, 0);
    expect_m0((await f.kernel().executeWorkerPool(request)).state).toBe("applied");
    expect_m0(f.db.authority.workerSlots.list()).toEqual([]);
    expect_m0(f.db.authority.workerPools.get(fixtureDescriptor_m0.id)?.version).toBe(1);
    f.restart(); const generation = f.db.getMeta().authorityGeneration;
    expect_m0((await f.kernel().executeWorkerPool(request)).state).toBe("already-applied");
    expect_m0(f.effects()).toBe(1); expect_m0(f.db.getMeta().authorityGeneration).toBe(generation);
  });
  it_m0("persists genuine direct CLI admission and its original global slot without authorizing a process effect", () => {
    const f = fixture();
    const request = { commandId: UUID_5_m0, workflow: fixtureDescriptor_m0.id, poolIndex: 2,
      expectedPoolVersion: 0, processId: 4100, processAcquisitionId: UUID_6_m0,
      authorityPath: "/offline/native/state.db", processLockRoot: "/offline/native/locks", now: NOW_m0 };
    const first = f.db.withAuthorityTransaction(repositories => admitDirectWorker_m0(repositories, request, UUID_7_m0));
    expect_m0(first).toMatchObject({ ordinal: 1, poolIndex: 2, reservationCommandId: UUID_5_m0 });
    expect_m0(f.db.authority.workerLeases.get(first.workerId)).toBeUndefined();
    expect_m0(f.db.authority.lifecycleJournal.findAuditByCommand(UUID_5_m0)).toMatchObject({ kind: "run-lifecycle",
      request: { operation: "worker-admission", request }, result: { kind: "worker", slot: first, beforePoolVersion: 0, afterPoolVersion: 1 } });
    f.restart(); const generation = f.db.getMeta().authorityGeneration;
    expect_m0(f.db.withAuthorityTransaction(repositories => admitDirectWorker_m0(repositories, request, UUID_7_m0))).toEqual(first);
    expect_m0(f.db.getMeta().authorityGeneration).toBe(generation); expect_m0(f.effects()).toBe(0);
    expect_m0(() => f.db.withAuthorityTransaction(repositories => admitDirectWorker_m0(repositories, { ...request, processAcquisitionId: UUID_7_m0 }, UUID_7_m0))).toThrow(/divergent/u);
  });
  it_m0("admits supervised launch only for the exact executing original command and current membership", async () => {
    const f = fixture(); await f.kernel().executeWorkerPool(f.request(UUID_5_m0, 0, 1));
    const slot = f.db.authority.workerSlots.list()[0]; if (slot === undefined) throw new Error("missing reserved slot");
    const member = workerPoolMember_m0(slot);
    const request = CommandRequestSchema_m0.parse({ commandId: UUID_6_m0, family: "worker-browser", type: "spawn-worker",
      source: "dashboard", requestedAt: NOW_m0, requestedBy: "local-operator",
      target: { workflowId: fixtureDescriptor_m0.id, expectedVersion: 1 }, payload: { workerId: member.workerId } });
    if (request.family !== "worker-browser") throw new Error("wrong fixture request");
    f.db.withAuthorityTransaction(repositories => {
      repositories.commands.insert(request);
      repositories.workerControls.admit({ commandId: UUID_6_m0, request, scope: workerControlScope_m0(request), executorId: UUID_7_m0,
        admittedAt: NOW_m0, expiresAt: new Date(Date.parse(NOW_m0) + 180_000).toISOString(), basisVersion: 1, phase: { state: "admitted" } });
    });
    expect_m0(() => admitSupervisedWorker_m0(f.db.authority, { member, commandId: UUID_6_m0, now: NOW_m0 })).toThrow(/not-admitted/u);
    f.db.authority.workerControls.transition(UUID_6_m0, "admitted", { state: "executing", startedAt: NOW_m0 });
    expect_m0(admitSupervisedWorker_m0(f.db.authority, { member, commandId: UUID_6_m0, now: NOW_m0 })).toBe(member.workerId);
    expect_m0(() => admitSupervisedWorker_m0(f.db.authority, { member: { ...member, membershipRevision: 2 }, commandId: UUID_6_m0, now: NOW_m0 })).toThrow(/not-admitted/u);
    expect_m0(() => admitSupervisedWorker_m0(f.db.authority, { member, commandId: UUID_7_m0, now: NOW_m0 })).toThrow(/not-admitted/u);
    expect_m0(() => admitSupervisedWorker_m0(f.db.authority, { member, commandId: UUID_6_m0, now: new Date(Date.parse(NOW_m0) + 180_000).toISOString() })).toThrow(/not-admitted/u);
    expect_m0(f.db.authority.workerLeases.get(member.workerId)).toBeUndefined();
  });
  it_m0("retains an admitted pre-effect crash without promoting it to execution on restart", async () => {
    const f = fixture(), request = f.request(UUID_5_m0, 0, 2);
    if (request.type !== "plan-worker-count") throw new Error("wrong fixture request");
    f.db.withAuthorityTransaction(repositories => {
      repositories.commands.insert(request);
      const roster = admitWorkerPoolRoster_m0(repositories, request, NOW_m0);
      repositories.workerControls.admit({ commandId: request.commandId, request, scope: workerControlScope_m0(request),
        executorId: UUID_6_m0, admittedAt: NOW_m0, expiresAt: new Date(Date.parse(NOW_m0) + 180_000).toISOString(), basisVersion: 0,
        roster, phase: { state: "admitted" } });
    });
    const original = canonicalJsonStringify_m0(f.db.authority.workerSlots.list());
    f.restart(); expect_m0((await f.kernel().executeWorkerPool(request)).state).toBe("rejected");
    expect_m0(f.effects()).toBe(0);
    expect_m0(f.db.authority.commandAudits.findByCommand(UUID_5_m0)).toBeUndefined();
    expect_m0(canonicalJsonStringify_m0(f.db.authority.workerSlots.list())).toBe(original);
    expect_m0(f.db.authority.workerControls.get(UUID_5_m0)?.phase.state).toBe("admitted");
  });
  it_m0("retains original reservation after the first effect fails and never executes it again after restart", async () => {
    const f = fixture(), request = f.request(UUID_5_m0, 0, 2);
    f.setEffect(context => {
      expect_m0(context.roster?.selected).toHaveLength(2);
      expect_m0(f.db.authority.workerPools.get(fixtureDescriptor_m0.id)?.version).toBe(1);
      expect_m0(f.db.authority.commands.get(UUID_5_m0)).toBeDefined();
      throw new Error("first-effect-fault");
    });
    await expect_m0(f.kernel().executeWorkerPool(request)).rejects.toThrow("first-effect-fault");
    const original = canonicalJsonStringify_m0(f.db.authority.workerSlots.list());
    expect_m0(f.db.authority.workerControls.get(UUID_5_m0)?.phase.state).toBe("uncertain");
    expect_m0(f.db.authority.commandAudits.findByCommand(UUID_5_m0)).toBeUndefined();
    f.restart(); expect_m0((await f.kernel().executeWorkerPool(request)).state).toBe("rejected");
    expect_m0(f.effects()).toBe(1); expect_m0(canonicalJsonStringify_m0(f.db.authority.workerSlots.list())).toBe(original);
  });
  it_m0("retains count and every excess identity if shrink effects become uncertain", async () => {
    const f = fixture(); expect_m0((await f.kernel().executeWorkerPool(f.request(UUID_5_m0, 0, 3))).state).toBe("applied");
    const original = f.db.authority.workerSlots.list();
    f.setEffect(context => {
      expect_m0(context.roster?.selected.map(slot => slot.workerId)).toEqual([original[0]?.workerId]);
      expect_m0(context.roster?.excess.map(slot => slot.workerId)).toEqual(original.slice(1).map(slot => slot.workerId));
      expect_m0(f.db.authority.workerPools.get(fixtureDescriptor_m0.id)).toMatchObject({ desiredWorkers: 3, version: 1 });
      throw new Error("partial-shrink-fault");
    });
    const request = f.request(UUID_6_m0, 1, 1);
    await expect_m0(f.kernel().executeWorkerPool(request)).rejects.toThrow("partial-shrink-fault");
    expect_m0(f.db.authority.workerSlots.list()).toEqual(original);
    f.restart(); expect_m0((await f.kernel().executeWorkerPool(request)).state).toBe("rejected");
    expect_m0(f.db.authority.workerPools.get(fixtureDescriptor_m0.id)).toMatchObject({ desiredWorkers: 3, version: 1 });
    expect_m0(f.effects()).toBe(2);
  });
  it_m0("retires only proved excess slots atomically with the lower count, preserving survivors and ordinals", async () => {
    const f = fixture(); await f.kernel().executeWorkerPool(f.request(UUID_5_m0, 0, 3));
    const original = f.db.authority.workerSlots.list(), shrink = f.request(UUID_6_m0, 1, 1);
    expect_m0((await f.kernel().executeWorkerPool(shrink)).state).toBe("applied");
    expect_m0(f.db.authority.workerPools.get(fixtureDescriptor_m0.id)).toMatchObject({ desiredWorkers: 1, version: 2 });
    expect_m0(f.db.authority.workerSlots.get(original[0].workerId)).toEqual(original[0]);
    expect_m0(f.db.authority.workerSlots.list().slice(1).map(slot => slot.retirementCommandId)).toEqual([UUID_6_m0, UUID_6_m0]);
    f.restart(); expect_m0((await f.kernel().executeWorkerPool(shrink)).state).toBe("already-applied");
    expect_m0(f.effects()).toBe(2);
    await f.kernel().executeWorkerPool(f.request(UUID_7_m0, 2, 3));
    expect_m0(f.db.authority.workerSlots.list().filter(slot => slot.retiredAt === null).map(slot => slot.ordinal)).toEqual([1, 4, 5]);
  });
  it_m0("replays the original settled roster after an audit-publication crash without repeating effects or retirement", async () => {
    const f = fixture(); await f.kernel().executeWorkerPool(f.request(UUID_5_m0, 0, 3));
    const shrink = f.request(UUID_6_m0, 1, 1); f.auditFault(true);
    await expect_m0(f.kernel().executeWorkerPool(shrink)).rejects.toThrow("audit-publication-fault");
    expect_m0(f.db.authority.workerControls.get(UUID_6_m0)?.phase.state).toBe("succeeded");
    expect_m0(f.db.authority.commandAudits.findByCommand(UUID_6_m0)).toBeUndefined();
    const original = canonicalJsonStringify_m0(f.db.authority.workerSlots.list());
    expect_m0(f.db.authority.workerPools.get(fixtureDescriptor_m0.id)).toMatchObject({ desiredWorkers: 1, version: 2 });
    f.auditFault(false); f.restart();
    expect_m0((await f.kernel().executeWorkerPool(shrink)).state).toBe("applied");
    expect_m0(f.effects()).toBe(2); expect_m0(canonicalJsonStringify_m0(f.db.authority.workerSlots.list())).toBe(original);
    const generation = f.db.getMeta().authorityGeneration;
    expect_m0((await f.kernel().executeWorkerPool(shrink)).state).toBe("already-applied");
    expect_m0(f.db.getMeta().authorityGeneration).toBe(generation); expect_m0(f.effects()).toBe(2);
  });
  it_m0("rolls back all retirement and count changes on a missing or forged second closure proof", async () => {
    const f = fixture(); await f.kernel().executeWorkerPool(f.request(UUID_5_m0, 0, 3));
    const original = f.db.authority.workerSlots.list();
    f.setEffect(context => ({ state: "accepted", workerIds: context.roster?.selected.map(slot => slot.workerId),
      retirements: context.roster?.excess.map((slot, index) => ({ workerId: slot.workerId,
        membershipRevision: slot.membershipRevision + index, checkedAt: NOW_m0, processStopped: true, browsersClosed: true, exclusive: true })) }));
    await expect_m0(f.kernel().executeWorkerPool(f.request(UUID_6_m0, 1, 1))).rejects.toThrow("worker-retirement-not-proved");
    expect_m0(f.db.authority.workerSlots.list()).toEqual(original);
    expect_m0(f.db.authority.workerPools.get(fixtureDescriptor_m0.id)).toMatchObject({ desiredWorkers: 3, version: 1 });
    expect_m0(f.db.authority.commandAudits.findByCommand(UUID_6_m0)).toBeUndefined();
  });
});
}

{

const databases: DatabaseSync_m1[] = [];
const _afterEachFixture0 = () => { for (const db of databases.splice(0)) db.close(); };
function fixture() {
  const db = new DatabaseSync_m1(":memory:"); databases.push(db);
  for (const migration of SQLITE_MIGRATIONS_m1) for (const sql of migration.statements) db.exec(sql);
  const slots = createWorkerSlotRepository_m1({ database: db, mutate(work) {
    db.exec("BEGIN IMMEDIATE"); try { const result = work(); db.exec("COMMIT"); return result.result; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  } });
  const pool = (workflow: string, desiredWorkers = 0) => {
    const record = WorkerPoolRecordSchema_m1.parse({ workflow, desiredWorkers, plannedBy: "local-operator", plannedAt: NOW_m1, version: 1, createdAt: NOW_m1, updatedAt: NOW_m1 });
    db.prepare("INSERT INTO worker_pools VALUES(?,?,?,?,?,?)").run(workflow,desiredWorkers,1,canonicalJsonStringify_m1(record),NOW_m1,NOW_m1);
  };
  const allocate = (workflow: string, poolIndex: number) => slots.allocate({ workflow,poolIndex,commandId:null,now:NOW_m1 });
  return { db, slots, pool, allocate };
}
describe_m1("native stable worker slots", () => {
afterEach_m1(_afterEachFixture0);

  it_m1("allocates global ordinals, preserves survivors and never reuses retired identity", () => {
    const f = fixture(); f.pool("person-lookup"); f.pool("separations");
    const first = f.allocate("person-lookup",1), survivor = f.allocate("person-lookup",2), other = f.allocate("separations",1);
    expect_m1([first.ordinal,survivor.ordinal,other.ordinal]).toEqual([1,2,3]);
    insertNativeCommand_m1(f.db,{ commandId:UUID_2_m1,family:"worker-browser",type:"plan-worker-count",requestedAt:NOW_m1,requestedBy:"local-operator",source:"dashboard",target:{workflowId:"person-lookup",expectedVersion:1},payload:{desiredWorkers:1} });
    f.slots.retire({ workerId:first.workerId,commandId:UUID_2_m1,expectedRevision:1,now:NOW_m1 });
    const replacement = f.allocate("person-lookup",1);
    expect_m1(replacement.ordinal).toBe(4);
    expect_m1(replacement.workerId).not.toBe(first.workerId);
    expect_m1(f.allocate("person-lookup",2)).toEqual(survivor);
    expect_m1(f.slots.list()).toHaveLength(4);
    expect_m1(f.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
  it_m1("admits zero desired workers and refuses more than three active slots per workflow", () => {
    const f = fixture(); f.pool("person-lookup",0);
    for (const poolIndex of [1,2,3]) f.allocate("person-lookup",poolIndex);
    expect_m1(f.slots.list().filter(slot=>slot.retiredAt===null)).toHaveLength(3);
    expect_m1(()=>f.allocate("person-lookup",4)).toThrow();
    expect_m1(WorkerPoolRecordSchema_m1.safeParse({ workflow:"person-lookup",desiredWorkers:4,plannedBy:"local-operator",plannedAt:NOW_m1,version:1,createdAt:NOW_m1,updatedAt:NOW_m1 }).success).toBe(false);
  });
  it_m1("requires pool admission and rolls back failed slot writes", () => {
    const f = fixture(); expect_m1(()=>f.allocate("person-lookup",1)).toThrow(/not-admitted/u);
    expect_m1(f.slots.list()).toEqual([]);
  });
});
}
