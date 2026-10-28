import { FingerprintSchema } from "../../../src/rules/identity/ids.js";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withSmokeWorker, SmokeSessionClosureError } from "../../../scripts/verify/browser-login.js";
import { runtimeLifetimeLock } from "../../support/helpers/backend/runtime-lifetime.js";
import { boundProfileAdmission } from "../../support/helpers/synthetic-database-admission.js";
import { RuntimeCustodyUncertainError } from "../../../src/backend/app/composition/storage-compose.js";
import { CommandRequestSchema } from "../../../src/rules/commands/commands.js";
import { retireWorkerVerification } from "../../../src/backend/storage/sqlite/worker-slots.js";
import { sha256Hex } from "../../../src/rules/validation/sha256.js";
import { canonicalJsonStringify } from "../../../src/rules/validation/canonical-json.js";
import { RunRecordService } from "../../../src/backend/runs/lifecycle/run-record-service.js";
import { sequentialIdFactory } from "../../support/fixtures/phase1f-run-fixtures.js";
import { createDashboardPoolTestWorld } from "../../support/helpers/backend/dashboard-pool-world.js";

function pendingSpawn(world: Awaited<ReturnType<typeof createDashboardPoolTestWorld>>, harness: Awaited<ReturnType<ReturnType<typeof createDashboardPoolTestWorld>["openControlHarness"]>>, workerId: string) {
  const pool = harness.database.authority.workerPools.get("person-lookup");
  const commandId = world.nextCommandId();
  const request = CommandRequestSchema.parse({ ...world.envelope(harness, commandId), type: "spawn-worker",
    target: { workflowId: "person-lookup", expectedVersion: pool?.version ?? 0 }, payload: { workerId } });
  return { commandId, request, scope: "worker-pool:person-lookup", executorId: randomUUID(), admittedAt: world.NOW,
    expiresAt: "2026-08-26T09:03:00.000Z", basisVersion: pool?.version ?? 0, phase: { state: "admitted" as const } };
}

describe("native verification reservation exclusion", () => {
  it("refuses verification admission around an unresolved canonical Spawn without advancing pool CAS", async () => {
    const world = createDashboardPoolTestWorld();
    try {
      const harness = await world.openControlHarness();
      const member = await world.admitPoolSlot(harness);
      const pending = pendingSpawn(world, harness, member.workerId);
      harness.database.withAuthorityTransaction(repositories => {
        repositories.commands.insert(pending.request);
        repositories.workerControls.admit(pending);
        repositories.workerControls.transition(pending.commandId, "admitted", { state: "executing", startedAt: world.NOW });
      });
      const before = harness.database.authority.workerPools.get("person-lookup");
      const lock = await runtimeLifetimeLock();
      const verification = { lock, ...boundProfileAdmission(join(harness.root, "state.db")).profileBinding,
        profileRunId: randomUUID(), system: "ucpath" as const, credentialKey: FingerprintSchema.parse("ab".repeat(32)) };
      try {
        let effects = 0;
        await expect(withSmokeWorker(harness.database, async () => { effects += 1; }, harness.clock, verification)).rejects.toMatchObject({ code: "LIVE_SMOKE_VERIFICATION_REFUSED", errors: [{ message: "worker-control-unresolved-effect" }] });
        expect(effects).toBe(0);
        expect(harness.database.authority.workerPools.get("person-lookup")).toEqual(before);
        expect(harness.database.authority.workerSlots.list()).toHaveLength(1);
        expect(harness.database.authority.workerControls.get(pending.commandId)?.phase.state).toBe("executing");
      } finally { await lock.close(); }
    } finally { await world.cleanup(); }
  });

  it("holds membership through the callback against canonical controls, primitive mutations, claims and lease start", async () => {
    const world = createDashboardPoolTestWorld();
    try {
      const harness = await world.openControlHarness();
      const lock = await runtimeLifetimeLock();
      const verification = { lock, ...boundProfileAdmission(join(harness.root, "state.db")).profileBinding,
        profileRunId: randomUUID(), system: "ucpath" as const, credentialKey: FingerprintSchema.parse("ab".repeat(32)) };
      try {
        const admission = { commandId: world.nextCommandId(), workflow: "person-lookup", expectedPoolVersion: 0,
          ...boundProfileAdmission(join(harness.root, "state.db")).profileBinding, lockPort: lock.port,
          profileRunId: verification.profileRunId, system: verification.system, credentialKey: verification.credentialKey, leaseGeneration: 1, now: world.NOW };
        expect(() => harness.database.withAuthorityTransaction(repositories => {
          repositories.lifecycleJournal.insertCommand({ kind: "run-lifecycle", commandId: admission.commandId,
            operation: "worker-verification-admission", request: admission, fence: { kind: "none" }, recordedAt: world.NOW,
            requestFingerprint: sha256Hex(`hrauto:run-lifecycle-command:v1\0worker-verification-admission\0${canonicalJsonStringify(admission)}`) });
          repositories.workerPools.plan({ workflow: "person-lookup", expectedVersion: 0, desiredWorkers: 1,
            requestedBy: "local-operator", now: world.NOW });
          repositories.workerSlots.allocate({ workflow: "person-lookup", poolIndex: 1, commandId: admission.commandId, now: world.NOW });
        })).toThrow("worker-verification-authority-unavailable");
        expect(harness.database.authority.workerSlots.list()).toEqual([]);
        expect(harness.database.authority.workerPools.get("person-lookup")).toBeUndefined();
        await withSmokeWorker(harness.database, async slot => {
          const before = harness.database.authority.workerPools.get(slot.workflow);
          const plan = { ...world.envelope(harness), type: "plan-worker-count", target: { workflowId: slot.workflow,
            expectedVersion: before?.version ?? 0 }, payload: { desiredWorkers: 0 } };
          expect((await harness.kernel.executeWorkerPool(plan)).state).toBe("rejected");
          expect((await harness.kernel.executeWorkerPool({ ...world.envelope(harness), type: "spawn-worker",
            target: plan.target, payload: { workerId: slot.workerId } })).state).toBe("rejected");
          expect(() => harness.database.authority.workerPools.plan({ workflow: slot.workflow, expectedVersion: before?.version ?? 0,
            desiredWorkers: 0, requestedBy: "local-operator", now: world.NOW })).toThrow("worker-verification-reserved");
          expect(() => harness.database.authority.workerSlots.allocate({ workflow: slot.workflow, poolIndex: 2,
            commandId: null, now: world.NOW })).toThrow("worker-verification-reserved");
          expect(() => harness.database.authority.workerSlots.retire({ workerId: slot.workerId, commandId: world.nextCommandId(),
            expectedRevision: slot.membershipRevision, now: world.NOW })).toThrow("worker-verification-reserved");
          expect(() => harness.database.authority.workerLeases.start({ workerId: slot.workerId, workflow: slot.workflow,
            browserSystems: ["ucpath"], processId: process.pid, requestedBy: "local-operator", now: world.NOW })).toThrow("worker-verification-reserved");
          expect(() => harness.database.authority.runs.claimNext({ workerId: slot.workerId, workflow: slot.workflow, now: world.NOW })).toThrow("worker-verification-reserved");
          const runtime = harness.database.authority.runtimeConfig.get();
          if (runtime === undefined) throw new Error("fixture runtime unavailable");
          const lifecycle = new RunRecordService({ database: harness.database, clock: harness.clock,
            ids: sequentialIdFactory("e"), publishQueued: () => undefined });
          expect(lifecycle.claimNext({ commandId: world.nextCommandId(), workflow: slot.workflow, workerId: slot.workerId,
            runtimeConfig: { generation: runtime.generation, configFingerprint: runtime.configFingerprint, settingsRevision: runtime.settingsRevision, settingsFingerprint: runtime.settingsFingerprint } })).toMatchObject({ state: "refused", refusal: { reason: "none-eligible" } });
          const pending = pendingSpawn(world, harness, slot.workerId);
          expect(() => harness.database.withAuthorityTransaction(repositories => {
            repositories.commands.insert(pending.request); repositories.workerControls.admit(pending);
          })).toThrow("worker-verification-reserved");
          const hold = harness.database.authority.workerSlots.verification(slot.workerId);
          if (hold === undefined) throw new Error("fixture grant unavailable");
          const retirement = { ...boundProfileAdmission(join(harness.root, "state.db")).profileBinding, commandId: world.nextCommandId(), grantCommandId: hold.command.commandId,
            workerId: slot.workerId, expectedRevision: slot.membershipRevision, expectedPoolVersion: before?.version,
            now: world.NOW, cleanup: "closed" };
          expect(() => harness.database.withAuthorityTransaction(repositories => {
            repositories.lifecycleJournal.insertCommand({ kind: "run-lifecycle", commandId: retirement.commandId,
              operation: "worker-verification-retirement", request: retirement, fence: { kind: "none" }, recordedAt: world.NOW,
              requestFingerprint: sha256Hex(`hrauto:run-lifecycle-command:v1\0worker-verification-retirement\0${canonicalJsonStringify(retirement)}`) });
            repositories.workerSlots.retire({ workerId: slot.workerId, commandId: retirement.commandId,
              expectedRevision: slot.membershipRevision, now: world.NOW });
            repositories.workerPools.plan({ workflow: slot.workflow, expectedVersion: before?.version,
              desiredWorkers: 0, requestedBy: "local-operator", now: world.NOW });
          })).toThrow("worker-verification-retirement-unproved");
          expect(harness.database.authority.workerPools.get(slot.workflow)).toEqual(before);
          expect(harness.database.authority.workerSlots.get(slot.workerId)).toEqual(slot);
        }, harness.clock, verification);
        const retired = harness.database.authority.workerSlots.list()[0];
        expect(retired.retiredAt).toBe(world.NOW);
        expect(harness.database.authority.workerPools.get("person-lookup")).toMatchObject({ desiredWorkers: 0, version: 2 });
        expect(harness.database.authority.workerSlots.verifications("person-lookup")).toEqual([]);
        const original = harness.database.authority.lifecycleJournal.getCommand(String(retired.retirementCommandId));
        if (original === undefined || !("kind" in original) || original.kind !== "run-lifecycle") throw new Error("fixture retirement unavailable");
        const generation = harness.database.getMeta().authorityGeneration;
        expect(harness.database.withAuthorityTransaction(repositories => retireWorkerVerification(repositories,
          original.request, randomUUID()))).toEqual(retired);
        expect(harness.database.getMeta().authorityGeneration).toBe(generation);
      } finally { await lock.close(); }
    } finally { await world.cleanup(); }
  });

  it("preserves the reservation and pool CAS when cleanup is uncertain or a historical unresolved control crosses retirement", async () => {
    const world = createDashboardPoolTestWorld();
    try {
      const harness = await world.openControlHarness();
      const lock = await runtimeLifetimeLock();
      const verification = { lock, ...boundProfileAdmission(join(harness.root, "state.db")).profileBinding,
        profileRunId: randomUUID(), system: "ucpath" as const, credentialKey: FingerprintSchema.parse("ab".repeat(32)) };
      try {
        await expect(withSmokeWorker(harness.database, async () => { throw new SmokeSessionClosureError([new Error("controlled closure unknown")]); }, harness.clock,
          verification)).rejects.toBeInstanceOf(RuntimeCustodyUncertainError);
        harness.clock.advanceWall(600_000);
        expect(harness.database.authority.workerSlots.verifications("person-lookup")).toHaveLength(1);
      } finally { await lock.close(); }
      const other = await world.openControlHarness();
      const otherLock = await runtimeLifetimeLock();
      const otherVerification = { lock: otherLock, ...boundProfileAdmission(join(other.root, "state.db")).profileBinding,
        profileRunId: randomUUID(), system: "ucpath" as const, credentialKey: FingerprintSchema.parse("ab".repeat(32)) };
      try {
        await expect(withSmokeWorker(other.database, async slot => {
          const pending = pendingSpawn(world, other, slot.workerId);
          other.database.authority.commands.insert(pending.request);
          const raw = new DatabaseSync(join(other.root, "state.db"));
          try { raw.prepare("INSERT INTO worker_controls(command_id,scope,worker_id,phase,audited_at,payload_json,created_at) VALUES(?,?,?,'admitted',NULL,?,?)")
            .run(pending.commandId, pending.scope, slot.workerId, JSON.stringify(pending), world.NOW); }
          finally { raw.close(); }
        }, other.clock, otherVerification)).rejects.toMatchObject({ code: "LIVE_SMOKE_VERIFICATION_REFUSED", errors: [{ message: "worker-control-unresolved-effect" }] });
        expect(other.database.authority.workerPools.get("person-lookup")).toMatchObject({ desiredWorkers: 1, version: 1 });
        expect(other.database.authority.workerSlots.verifications("person-lookup")).toHaveLength(1);
      } finally { await otherLock.close(); }
    } finally { await world.cleanup(); }
  });
});
