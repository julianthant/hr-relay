import { DatabaseSync } from "node:sqlite";
import { workerPoolMember } from "../../../../../src/models/run/worker-slot.js";
import { admitDirectWorker, admitSupervisedWorker, admitWorkerPoolRoster } from "../../../../../src/backend/storage/sqlite/worker-slots.js";
import { workerControlScope } from "../../../../../src/models/run/worker-control.js";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuthorityDatabase } from "../../../../../src/backend/storage/sqlite/authority-database.js";
import { RuntimeAdmission } from "../../../../../src/backend/storage/admission/admission.js";
import { createCommandKernel, type WorkerRuntimeContext } from "../../../../../src/backend/runs/commands/command-kernel.js";
import { RunRecordService } from "../../../../../src/backend/runs/lifecycle/run-record-service.js";
import { CommandRequestSchema } from "../../../../../src/rules/commands/commands.js";
import { WorkerRetirementProofSchema } from "../../../../../src/models/run/worker-slot.js";
import { capturedInstantClock } from "../../../../../src/rules/time/clock.js";
import { canonicalJsonStringify } from "../../../../../src/rules/validation/canonical-json.js";
import { fixtureDescriptor } from "../../../../support/fixtures/descriptor-fixtures.js";
import { sequentialIdFactory } from "../../../../support/fixtures/phase1f-run-fixtures.js";
import { CONFIG_SNAPSHOT, NOW, UUID_5, UUID_6, UUID_7 } from "../../../../support/fixtures/phase1c-contract-fixtures.js";
import { UNWIRED_INTAKE_PARSER, NO_INTAKE_PROJECTIONS } from "../../../../support/fixtures/intake-kernel-seams.js";
const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "relay-native-roster-"))), path = join(root, "authority.sqlite");
  const admission = RuntimeAdmission.syntheticFixture(path);
  const open = () => AuthorityDatabase.open(admission, { path, busyTimeoutMs: 250, migrationOwner: "native-test" });
  let db = open(); db.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  cleanups.push(() => { db.close(); rmSync(root, { recursive: true, force: true }); });
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
  it("admits zero desired workers without inventing members and replays without effects", async () => {
    const f = fixture(), request = f.request(UUID_5, 0, 0);
    expect((await f.kernel().executeWorkerPool(request)).state).toBe("applied");
    expect(f.db.authority.workerSlots.list()).toEqual([]);
    expect(f.db.authority.workerPools.get(fixtureDescriptor.id)?.version).toBe(1);
    f.restart(); const generation = f.db.getMeta().authorityGeneration;
    expect((await f.kernel().executeWorkerPool(request)).state).toBe("already-applied");
    expect(f.effects()).toBe(1); expect(f.db.getMeta().authorityGeneration).toBe(generation);
  });
  it("persists genuine direct CLI admission and its original global slot without authorizing a process effect", () => {
    const f = fixture();
    const request = { commandId: UUID_5, workflow: fixtureDescriptor.id, poolIndex: 2,
      expectedPoolVersion: 0, processId: 4100, processAcquisitionId: UUID_6,
      authorityPath: "/offline/native/state.db", processLockRoot: "/offline/native/locks", now: NOW };
    const first = f.db.withAuthorityTransaction(repositories => admitDirectWorker(repositories, request, UUID_7));
    expect(first).toMatchObject({ ordinal: 1, poolIndex: 2, reservationCommandId: UUID_5 });
    expect(f.db.authority.workerLeases.get(first.workerId)).toBeUndefined();
    expect(f.db.authority.lifecycleJournal.findAuditByCommand(UUID_5)).toMatchObject({ kind: "run-lifecycle",
      request: { operation: "worker-admission", request }, result: { kind: "worker", slot: first, beforePoolVersion: 0, afterPoolVersion: 1 } });
    f.restart(); const generation = f.db.getMeta().authorityGeneration;
    expect(f.db.withAuthorityTransaction(repositories => admitDirectWorker(repositories, request, UUID_7))).toEqual(first);
    expect(f.db.getMeta().authorityGeneration).toBe(generation); expect(f.effects()).toBe(0);
    expect(() => f.db.withAuthorityTransaction(repositories => admitDirectWorker(repositories, { ...request, processAcquisitionId: UUID_7 }, UUID_7))).toThrow(/divergent/u);
  });
  it("admits supervised launch only for the exact executing original command and current membership", async () => {
    const f = fixture(); await f.kernel().executeWorkerPool(f.request(UUID_5, 0, 1));
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
    const f = fixture(), request = f.request(UUID_5, 0, 2);
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
    const f = fixture(), request = f.request(UUID_5, 0, 2);
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
    const f = fixture(); expect((await f.kernel().executeWorkerPool(f.request(UUID_5, 0, 3))).state).toBe("applied");
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
    const f = fixture(); await f.kernel().executeWorkerPool(f.request(UUID_5, 0, 3));
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
    const f = fixture(); await f.kernel().executeWorkerPool(f.request(UUID_5, 0, 3));
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
    const f = fixture(); await f.kernel().executeWorkerPool(f.request(UUID_5, 0, 3));
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
