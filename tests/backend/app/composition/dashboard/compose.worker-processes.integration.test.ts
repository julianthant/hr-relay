import { WorkerStopDirectiveContextSchema } from "../../../../../src/backend/runtime/workers/worker-loop.js";
import { instrumentPool, kernelOver, type PoolEffectEvent } from "../../../../support/helpers/backend/dashboard-pool-world.js";
import { createDashboardChildTestWorld, type RealChildRecord } from "../../../../support/helpers/backend/dashboard-child-world.js";

import { createBoundProfileFixture, boundProfileCredentials, releaseAdmissionFixture, releaseAdmissionFixtures } from '../../../../support/helpers/admission-fixture.js';
import { readSettings } from '../../../../../src/backend/runtime/settings/settings-runtime.js';
import { resolveConfigWithProvenance } from '../../../../../src/backend/app/config/resolve.js';
import { hostConfigFacts } from '../../../../../src/models/config/host-display.js';
import { rebuildRuntimeIsolation } from '../../../../../src/backend/app/config/runtime-isolation.js';
import { workerPoolMember } from '../../../../../src/models/run/worker-slot.js';
import { AuthoritySourceClosureUnprovedError } from '../../../../../src/backend/storage/source-closure.js';
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { composeWorkerProcessControl } from "../../../../../src/backend/app/composition/dashboard/compose.js";

import { type CommandKernel } from "../../../../../src/backend/runs/commands/command-kernel.js";
import { createTimeoutDeadlineScheduler } from "../../../../../src/backend/runtime/scheduling/timeout-deadline-scheduler.js";
import { systemClock } from "../../../../../src/rules/time/clock.js";


import { AuthorityDatabase } from '../../../../../src/backend/storage/sqlite/authority-database.js';

const { stubLaunch, PL, STUB_CLI_PATH, required, nextCommandId, envelope, realStubSpawner, pidAlive, waitFor, workerLockRecords, reportW5Phase } = createDashboardChildTestWorld(() => releaseAdmissionFixtures(), root => releaseAdmissionFixture(root));


/** One pool-effect boundary crossing, in door order. */


function eventOf(events: readonly PoolEffectEvent[], commandId: string, phase: "enter" | "exit"): PoolEffectEvent {
  return required(
    events.find((event) => event.commandId === commandId && event.phase === phase),
    `a pool-effect ${phase} event for command ${commandId}`,
  );
}





/** Journal truth: an applied command has its row and its applied audit; a refusal has neither. */
function assertJournaled(database: AuthorityDatabase, commandId: string): void {
  assert.notEqual(database.authority.commands.get(commandId), undefined, `command ${commandId} journal row`);
  assert.equal(
    database.authority.commandAudits.findByCommand(commandId)?.result.state,
    "applied",
    `command ${commandId} audit`,
  );
}
function assertUnacknowledged(database: AuthorityDatabase, commandId: string): void {
  assert.notEqual(database.authority.commands.get(commandId), undefined, `command ${commandId} retains admission`);
  assert.equal(database.authority.workerControls.get(commandId)?.phase.state, "uncertain");
  assert.equal(
    database.authority.commandAudits.findByCommand(commandId),
    undefined,
    `command ${commandId} must not audit`,
  );
}

describe("real processes: two children supervised concurrently through the composed kernel door", () => {
  interface FixtureOwner {
    readonly profile: ReturnType<typeof createBoundProfileFixture>;
    database?: AuthorityDatabase;
    control?: ReturnType<typeof composeWorkerProcessControl>;
    readonly records: RealChildRecord[];
    readonly childClosures: Promise<void>[];
    readonly extraRoots: string[];
    supervisorClosed: boolean;
    primary?: unknown;
    unproved?: unknown;
  }

  interface RealHarness extends FixtureOwner {
    readonly database: AuthorityDatabase;
    readonly kernel: CommandKernel;
    readonly control: ReturnType<typeof composeWorkerProcessControl>;
    readonly faults: Error[];
    readonly events: PoolEffectEvent[];
    readonly lockRoot: string;
    readonly dbPath: string;
  }

  const harnesses: FixtureOwner[] = [];
  const retainedHarnesses = new Set<FixtureOwner>();

  afterEach(async () => {
    const failures: unknown[] = [];
    for (const harness of harnesses.splice(0).reverse()) {
      try {
        if (harness.unproved !== undefined) {
        const retained = harness.unproved;
        throw retained instanceof Error ? retained : new AggregateError([retained], 'Worker fixture custody unproved', { cause: retained });
      }
        const live = harness.records.some(record => record.pid !== undefined && pidAlive(record.pid));
        if (live && !harness.supervisorClosed) {
          assert.ok(harness.control);
          await harness.control.supervisor.drainOwnedChildren(WorkerStopDirectiveContextSchema.parse({
            requestedAt: systemClock.now().toISOString(), requestedBy: 'shutdown-proof', reason: 'shutdown',
          }));
        }
        await Promise.all(harness.childClosures);
        for (const record of harness.records) {
          if (record.pid === undefined) continue;
          assert.equal(pidAlive(record.pid), false);
          assert.ok(harness.control);
          assert.ok(harness.database);
          assert.equal(harness.control.supervisor.memberEvidence(record.member)?.state, 'exited');
          const lease = harness.database.authority.workerLeases.get(record.member.workerId);
          if (lease !== undefined) {
            assert.equal(lease.lifecycle.state, 'stopped');
            harness.database.assertWorkerLifecycleRelease(record.member.workerId);
          }
        }
        if (harness.control !== undefined && !harness.supervisorClosed) {
          harness.supervisorClosed = true;
          assert.deepEqual(harness.control.supervisor.close(), []);
        }
        harness.database?.close();
        harness.profile.close();
        for (const root of harness.extraRoots) rmSync(root, { recursive: true, force: true });
      } catch (error) {
        harness.unproved = error;
        retainedHarnesses.add(harness);
        failures.push(harness.primary === undefined || harness.primary === error ? error : new AggregateError([harness.primary, error],
          'worker-process-fixture-cleanup-unproved', { cause: harness.primary }));
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, 'worker-process-fixture-cleanup-failed', { cause: failures[0] });
  }, 30_000);

  function openRealHarness(launchCommandOverride?: string): RealHarness {
    const profile = createBoundProfileFixture({ sharedMachine: true });
    const owner: FixtureOwner = { profile, records: [], childClosures: [], extraRoots: [], supervisorClosed: false };
    harnesses.push(owner);
    try {
      const dbPath = profile.path;
      const lockRoot = join(profile.workspace, rebuildRuntimeIsolation.processLockRoot);
      const database = AuthorityDatabase.open(profile.admission, { path: dbPath, busyTimeoutMs: 5_000, migrationOwner: 'fixture' }, systemClock,
        undefined, undefined, undefined, boundProfileCredentials(profile.admission));
      owner.database = database;
      const saved = readSettings(database.authority);
      const resolved = resolveConfigWithProvenance(saved.settings, hostConfigFacts({}), systemClock,
        { stateRoot: profile.stateRoot, artifactRoot: profile.admission.artifactRoot });
      const active = database.authority.runtimeConfig.initialize({
        configSnapshotId: nextCommandId(), revision: saved.revision,
        fingerprint: resolved.fingerprint, config: resolved.config, provenance: resolved.provenance,
        capturedAt: systemClock.now().toISOString(), capturedBy: 'fixture'
      });
      assert.equal(active.configFingerprint, resolved.fingerprint);
      const faults: Error[] = [];
      const events: PoolEffectEvent[] = [];
      const spawn = realStubSpawner(owner.records);
      const control = composeWorkerProcessControl({
        profileRoot: resolved.config.paths.browserProfileRoot, processLockRoot: lockRoot,
        database, clock: systemClock, scheduler: createTimeoutDeadlineScheduler(systemClock),
        launch: stubLaunch(dbPath, lockRoot, 'installed', launchCommandOverride ?? process.execPath),
        spawn: request => {
          const child = spawn(request);
          const record = required(owner.records.at(-1), 'spawned-child');
          owner.childClosures.push(new Promise(resolve => { record.child.once('close', () => resolve()); }));
          return child;
        },
        birth: { pollMs: 50, timeoutMs: 30_000 },
        onFault: error => { faults.push(error); },
      });
      owner.control = control;
      const kernel = kernelOver(database, systemClock, instrumentPool(control.workerRuntime.pool, systemClock, events));
      return Object.assign(owner, { database, kernel, control, faults, events, lockRoot, dbPath });
    } catch (error) {
      owner.primary = error;
      if (error instanceof AuthoritySourceClosureUnprovedError) owner.unproved = error;
      throw error;
    }
  }

  function plannedMember(harness: RealHarness, poolIndex: number) {
    const slots = harness.database.authority.workerSlots.list(PL).filter(slot => slot.retiredAt === null && slot.poolIndex === poolIndex);
    assert.equal(slots.length, 1);
    const slot = required(slots[0], 'planned-worker-slot');
    assert.equal(slot.ordinal, poolIndex);
    return workerPoolMember(slot);
  }

  it(
    "spawns worker 1 and worker 2 as real children, proves both births via durable leases, and internally drains both — exact identities, no cross-talk",
    async () => {
      reportW5Phase("two-child-door", "startup", "begin");
      const harness = openRealHarness();
      try {
        const childOutput = (): string => harness.records.map((record) =>
          `${record.member.workerId}: ${record.output.join("")}`).join("\n");
        reportW5Phase("two-child-door", "startup", "complete");

        reportW5Phase("two-child-door", "spawn-and-birth", "begin");
        const planId = nextCommandId();
        assert.equal((await harness.kernel.executeWorkerPool({
          ...envelope(systemClock, planId),
          type: "plan-worker-count",
          target: { workflowId: PL, expectedVersion: 0 },
          payload: { desiredWorkers: 2 },
        })).state, "applied");

        // Both spawns in flight together through the one composed door.
        const PL_1 = plannedMember(harness, 1);
        const PL_2 = plannedMember(harness, 2);
        const spawn1Id = nextCommandId();
        const spawn2Id = nextCommandId();
        const submitAtMs = systemClock.monotonicMs();
        const spawn1 = harness.kernel.executeWorkerPool({
          ...envelope(systemClock, spawn1Id),
          type: "spawn-worker",
          target: { workflowId: PL, expectedVersion: 1 },
          payload: { workerId: PL_1.workerId },
        });
        const spawn2 = harness.kernel.executeWorkerPool({
          ...envelope(systemClock, spawn2Id),
          type: "spawn-worker",
          target: { workflowId: PL, expectedVersion: 1 },
          payload: { workerId: PL_2.workerId },
        });
        const [result1, result2] = await Promise.all([
          spawn1.then((result) => ({ result, ackMs: systemClock.monotonicMs() - submitAtMs })),
          spawn2.then((result) => ({ result, ackMs: systemClock.monotonicMs() - submitAtMs })),
        ]);
        assert.deepEqual(result1.result, {
          state: "applied",
          commandId: spawn1Id,
          affectedTargets: [{ family: "worker-browser", workerId: PL_1.workerId }],
        });
        assert.deepEqual(result2.result, {
          state: "applied",
          commandId: spawn2Id,
          affectedTargets: [{ family: "worker-browser", workerId: PL_2.workerId }],
        });

        // EXACT pool identities: derivation, argv, lease ownership — both ways.
        assert.equal(PL_1.workerId, plannedMember(harness, 1).workerId);
        assert.equal(PL_2.workerId, plannedMember(harness, 2).workerId);
        assert.equal(harness.records.length, 2);
        const record1 = required(harness.records.find((record) => record.member.workerId === PL_1.workerId), "child 1");
        const record2 = required(harness.records.find((record) => record.member.workerId === PL_2.workerId), "child 2");
        for (const [record, index] of [[record1, 1], [record2, 2]] as const) {
          assert.equal(record.command, process.execPath);
          assert.deepEqual([...record.argv], [
            "--import", "tsx", STUB_CLI_PATH, harness.dbPath, harness.lockRoot, "installed",
            "worker", "person-lookup", "--pool-index", String(index),
            "--worker-id", record.member.workerId, "--ordinal", String(record.member.ordinal),
            "--membership-revision", String(record.member.membershipRevision), "--launch-command-id", index === 1 ? spawn1Id : spawn2Id,
          ]);
        }
        const pid1 = required(record1.pid, "child 1 pid");
        const pid2 = required(record2.pid, "child 2 pid");
        assert.notEqual(pid1, pid2);

        const lease1 = required(harness.database.authority.workerLeases.get(PL_1.workerId), "lease 1");
        const lease2 = required(harness.database.authority.workerLeases.get(PL_2.workerId), "lease 2");
        assert.equal(lease1.workflow, PL);
        assert.equal(lease1.processId, pid1);
        assert.equal(lease2.workflow, PL);
        assert.equal(lease2.processId, pid2);
        // Both children are supervised CONCURRENTLY: alive at the same instant,
        // both owned as running by the one supervisor.
        assert.equal(pidAlive(pid1) && pidAlive(pid2), true, childOutput());
        assert.equal(harness.control.supervisor.memberEvidence(PL_1)?.state, "running");
        assert.equal(harness.control.supervisor.memberEvidence(PL_2)?.state, "running");

        // The W3b mutex under real time: same-workflow spawn effects are
        // disjoint and FIFO; the handoff gap is the serialization overhead.
        const spawn1Exit = eventOf(harness.events, spawn1Id, "exit");
        const spawn2Enter = eventOf(harness.events, spawn2Id, "enter");
        assert.ok(spawn2Enter.seq > spawn1Exit.seq, "spawn 2 must enter the door only after spawn 1 exits");
        const handoffGapMs = spawn2Enter.atMonotonicMs - spawn1Exit.atMonotonicMs;
        const birth1Ms = spawn1Exit.atMonotonicMs - eventOf(harness.events, spawn1Id, "enter").atMonotonicMs;
        const birth2Ms = eventOf(harness.events, spawn2Id, "exit").atMonotonicMs - spawn2Enter.atMonotonicMs;
        reportW5Phase("two-child-door", "spawn-and-birth", "complete");

        reportW5Phase("two-child-door", "graceful-stop", "begin");
        const stop1Id = nextCommandId(), stop2Id = nextCommandId();
        const stopSubmitMs = systemClock.monotonicMs();
        const requestedAt = systemClock.now().toISOString();
        const drained = harness.control.supervisor.drainOwnedChildren(WorkerStopDirectiveContextSchema.parse({ requestedAt, requestedBy: "local-operator", reason: "w5 stop" }));
        await drained;
        assert.equal(harness.database.authority.commands.get(stop1Id), undefined);
        assert.equal(harness.database.authority.commands.get(stop2Id), undefined);
        const stopsAckMs = systemClock.monotonicMs() - stopSubmitMs;
        assert.equal(harness.control.supervisor.memberEvidence(PL_1)?.state, "exited", "drain must await child 1 OS exit");
        assert.equal(harness.control.supervisor.memberEvidence(PL_2)?.state, "exited", "drain must await child 2 OS exit");
        await waitFor(
          () => harness.control.supervisor.memberEvidence(PL_1)?.state === "exited"
            && harness.control.supervisor.memberEvidence(PL_2)?.state === "exited",
          "both real children to observe their durable stop directives and exit",
          childOutput,
        );
        const exitObservedMs = systemClock.monotonicMs() - stopSubmitMs;
        for (const member of [PL_1, PL_2]) {
          const evidence = harness.control.supervisor.memberEvidence(member);
          assert.equal(evidence?.state, "exited");
          if (evidence?.state !== "exited") throw new Error("unreachable");
          assert.equal(evidence.outcome, "stopped");
          assert.equal(evidence.reportedBy, "os");
          assert.equal(evidence.exitCode, 0);
          const graceful = required(evidence.observedStop[0], `${member.workerId} graceful stage`);
          assert.equal(graceful.at, requestedAt);
          const lease = required(harness.database.authority.workerLeases.get(member.workerId), "stopped lease");
          assert.deepEqual(lease.control, {
            directive: "stop",
            requestedAt: graceful.at,
            requestedBy: "local-operator",
            reason: "w5 stop",
          });
          assert.equal(lease.lifecycle.state, "stopped");
        }
        // The real children released their process locks on the way out, and no
        // process outlives the proof: PID liveness says both are gone.
        await waitFor(() => !pidAlive(pid1) && !pidAlive(pid2), "both child pids to die", childOutput);
        const locks = workerLockRecords(harness.lockRoot);
        assert.notEqual(required(locks.get(PL_1.workerId), "PL-1 worker lock").releasedAt, null);
        assert.notEqual(required(locks.get(PL_2.workerId), "PL-2 worker lock").releasedAt, null);
        reportW5Phase("two-child-door", "graceful-stop", "complete");
        reportW5Phase("two-child-door", "teardown", "begin");
        harness.supervisorClosed = true;
        try {
          assert.deepEqual(harness.control.supervisor.close(), []);
        } catch (error) {
          harness.unproved = error;
          throw error;
        }
        assert.deepEqual(harness.faults, []);
        for (const commandId of [planId, spawn1Id, spawn2Id]) {
          assertJournaled(harness.database, commandId);
        }
        assert.equal(harness.database.authority.commandAudits.findByCommand(stop1Id), undefined);
        assert.equal(harness.database.authority.commandAudits.findByCommand(stop2Id), undefined);
        reportW5Phase("two-child-door", "teardown", "complete");

        process.stdout.write(`Measured two-child kernel door: ${JSON.stringify({
          spawn1AckMs: Math.round(result1.ackMs),
          spawn2AckMs: Math.round(result2.ackMs),
          birth1EffectMs: Math.round(birth1Ms),
          birth2EffectMs: Math.round(birth2Ms),
          sameWorkflowHandoffGapMs: Math.round(handoffGapMs * 100) / 100,
          concurrentStopsAckMs: Math.round(stopsAckMs),
          stopToObservedExitMs: Math.round(exitObservedMs),
        })}\n`);
      } catch (error) { harness.primary = error; throw error; }
    },
    120_000,
  );

  it(
    "a REAL spawn ENOENT rejects typed with retained admission and no fabricated pid",
    async () => {
      const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-w5-enoent-"));
      const harness = openRealHarness(join(root, "no-such-node-binary"));
      harness.extraRoots.push(root);
      try {
        assert.equal((await harness.kernel.executeWorkerPool({ ...envelope(systemClock), type: "plan-worker-count",
          target: { workflowId: PL, expectedVersion: 0 }, payload: { desiredWorkers: 1 } })).state, "applied");
        const PL_1 = plannedMember(harness, 1);
        const spawnId = nextCommandId();
        await assert.rejects(
          () => harness.kernel.executeWorkerPool({
            ...envelope(systemClock, spawnId),
            type: "spawn-worker",
            target: { workflowId: PL, expectedVersion: 1 },
            payload: { workerId: PL_1.workerId },
          }),
          /process errored before proving its lease birth: .*ENOENT.*; the child has no pid to kill/,
        );
        assertUnacknowledged(harness.database, spawnId);
        assert.equal(harness.database.authority.workerLeases.get(PL_1.workerId), undefined);
        const evidence = harness.control.supervisor.memberEvidence(PL_1);
        assert.equal(evidence?.state, "exited");
        if (evidence?.state !== "exited") throw new Error("unreachable");
        assert.equal(evidence.outcome, "crashed");
        assert.equal(evidence.reportedBy, "supervisor");
      } catch (error) { harness.primary = error; throw error; }
    },
    60_000,
  );
});
