import { RunRecordService } from "../../../../../src/backend/runs/lifecycle/run-record-service.js";

import { seedSyntheticRuntimeConfig } from "../../../../support/fixtures/operator-command-fixtures.js";
import { releaseAdmissionFixture, releaseAdmissionFixtures } from "../../../../support/helpers/admission-fixture.js";

import assert from "node:assert/strict";
import { spawn as spawnChildProcess, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { composeWorkerProcessControl } from "../../../../../src/backend/app/composition/dashboard/compose.js";
import { DESCRIPTORS } from "../../../../../src/backend/app/registries/workflow-registry.js";
import { createCommandKernel, type CommandKernel, type CommandKernelDependencies, type WorkerPoolRuntimeSeam } from "../../../../../src/backend/runs/commands/command-kernel.js";
import { createTimeoutDeadlineScheduler } from "../../../../../src/backend/runtime/scheduling/timeout-deadline-scheduler.js";
import { type WorkerPoolMember } from "../../../../../src/backend/runtime/workers/worker-loop.js";
import type { WorkerProcessSpawner } from "../../../../../src/backend/runtime/workers/worker-supervisor.js";
import { WorkerProcessLockFileSchema } from "../../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { PositiveIntSchema, WorkerIdSchema, WorkflowIdSchema } from "../../../../../src/rules/identity/ids.js";
import { systemClock, type Clock } from "../../../../../src/rules/time/clock.js";
import { NO_INTAKE_PROJECTIONS, UNWIRED_INTAKE_PARSER } from "../../../../support/fixtures/intake-kernel-seams.js";
import { sequentialIdFactory } from "../../../../support/fixtures/phase1f-run-fixtures.js";
import { AuthorityDatabase } from "../../../../support/helpers/admission-fixture.js";

function servedControlBasis(database: AuthorityDatabase, workerId: string) {
  const lease = database.authority.workerLeases.get(workerId);
  assert.ok(lease?.controlRevision, "the fixture must serve a real control basis");
  return { leaseGeneration: lease.leaseGeneration, controlRevision: lease.controlRevision };
}
const PL = WorkflowIdSchema.parse("person-lookup");
const plMember = (index: number): WorkerPoolMember => {
  const poolIndex = PositiveIntSchema.parse(index);
  return { workflowId: PL, poolIndex, ordinal: poolIndex, membershipRevision: PositiveIntSchema.parse(1), workerId: WorkerIdSchema.parse(`person-lookup-worker-${String(index)}`) };
};
const PL_1 = plMember(1);
const PL_2 = plMember(2);

const STUB_CLI_PATH = join(process.cwd(), "tests", "support", "processes", "worker-stub-cli.ts");
const REPO_ROOT = process.cwd();

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`the proof expected ${what} to exist`);
  return value;
}

/* ── shared cleanup: kill every child even on failure, then sweep roots ──── */

const roots: string[] = [];
const openDatabases: AuthorityDatabase[] = [];
const cleanups: (() => Promise<void> | void)[] = [];
const liveRealChildren: ChildProcess[] = [];

afterEach(async () => {
  // Run every cleanup stage despite failures so signal escalation, database close and root cleanup still execute.
  const errors: unknown[] = [];
  for (const cleanup of cleanups.splice(0).reverse()) {
    try {
      await cleanup();
    } catch (error) {
      errors.push(error);
    }
  }
  for (const child of liveRealChildren.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
  for (const database of openDatabases.splice(0)) {
    try {
      database.close();
    } catch (error) {
      errors.push(error);
    }
  }
  releaseAdmissionFixtures();
  for (const root of roots.splice(0)) {
    try {
      releaseAdmissionFixture(root);
      rmSync(root, { recursive: true, force: true });
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, `afterEach cleanup failed (${String(errors.length)} error(s))`);
  }
}, 30_000);

/* ── shared command plumbing ─────────────────────────────────────────────── */

let commandSequence = 0;
function nextCommandId(): string {
  commandSequence += 1;
  const tail = String(commandSequence).padStart(4, "0");
  return `eeeeeeee-${tail}-4000-8000-${tail}00000000`;
}

function envelope(clock: Clock, commandId = nextCommandId()) {
  return {
    commandId,
    requestedAt: clock.now().toISOString(),
    requestedBy: "local-operator",
    source: "dashboard",
    family: "worker-browser",
  } as const;
}

/** One pool-effect boundary crossing, in door order. */
interface PoolEffectEvent {
  readonly commandId: string;
  readonly type: string;
  readonly phase: "enter" | "exit";
  readonly seq: number;
  readonly atMonotonicMs: number;
}

function eventOf(events: readonly PoolEffectEvent[], commandId: string, phase: "enter" | "exit"): PoolEffectEvent {
  return required(
    events.find((event) => event.commandId === commandId && event.phase === phase),
    `a pool-effect ${phase} event for command ${commandId}`,
  );
}

function instrumentPool(
  pool: WorkerPoolRuntimeSeam,
  clock: Clock,
  events: PoolEffectEvent[],
): WorkerPoolRuntimeSeam {
  let seq = 0;
  const record = (commandId: string, type: string, phase: "enter" | "exit"): void => {
    seq += 1;
    events.push({ commandId, type, phase, seq, atMonotonicMs: clock.monotonicMs() });
  };
  const wrap = <Method extends keyof WorkerPoolRuntimeSeam>(method: Method): WorkerPoolRuntimeSeam[Method] =>
    async (context: Parameters<WorkerPoolRuntimeSeam[Method]>[0]) => {
      record(context.command.commandId, context.command.type, "enter");
      try {
        return await pool[method](context);
      } finally {
        record(context.command.commandId, context.command.type, "exit");
      }
    };
  return {
    planPoolWorkerCount: wrap("planPoolWorkerCount"),
    spawnPoolWorker: wrap("spawnPoolWorker"),
    stopPoolWorker: wrap("stopPoolWorker"),
    pausePoolWorker: wrap("pausePoolWorker"),
    resumePoolWorker: wrap("resumePoolWorker"),
    refreshPoolBrowser: wrap("refreshPoolBrowser"),
    reopenPoolBrowser: wrap("reopenPoolBrowser"),
  };
}

function kernelOver(
  database: AuthorityDatabase,
  clock: Clock,
  pool: WorkerPoolRuntimeSeam,
): CommandKernel {
  const dependencies: CommandKernelDependencies = {
    lifecycle: new RunRecordService({ database, clock, ids: sequentialIdFactory("e"), publishQueued: () => {} }),
    appVersion: "0.1.0",
    configIdentity: (() => { const active = database.authority.runtimeConfig.get(); assert.ok(active); return {configFingerprint: active.configFingerprint, configSnapshotId: active.configSnapshotId}; })(),
    intakeParser: UNWIRED_INTAKE_PARSER,
    intakeProjections: NO_INTAKE_PROJECTIONS,
    authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
    clock,
    ids: sequentialIdFactory("f"),
    descriptors: {
      resolve: (workflowId) => DESCRIPTORS.find((descriptor) => String(descriptor.id) === workflowId),
    },
    writeResolution: {
      resolvePresent: () => {
        throw new Error("unused in this suite");
      },
      resolveAbsent: () => {
        throw new Error("unused in this suite");
      },
    },
    workerRuntime: { pool },
  };
  return createCommandKernel(dependencies);
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

interface RealChildRecord {
  readonly member: WorkerPoolMember;
  readonly command: string;
  readonly argv: readonly string[];
  readonly pid: number | undefined;
  readonly child: ChildProcess;
  readonly output: string[];
  exited: boolean;
}

/** The production spawn adapter shape, over a REAL child, with observation. */
function realStubSpawner(records: RealChildRecord[]): WorkerProcessSpawner {
  return (request) => {
    const child = spawnChildProcess(request.command, [...request.args], {
      cwd: request.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    liveRealChildren.push(child);
    const output: string[] = [];
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => output.push(chunk));
    child.stderr?.on("data", (chunk: string) => output.push(`STDERR ${chunk}`));
    const record: RealChildRecord = {
      member: request.member,
      command: request.command,
      argv: request.args,
      pid: child.pid,
      child,
      output,
      exited: false,
    };
    records.push(record);
    return Object.freeze({
      pid: child.pid,
      kill: (signal: "SIGTERM" | "SIGKILL"): boolean => child.kill(signal),
      onExit: (listener: (code: number | null, signal: string | null) => void): void => {
        child.on("exit", (code, signal) => {
          record.exited = true;
          listener(code, signal);
        });
      },
      onError: (listener: (error: Error) => void): void => {
        child.on("error", (error) => {
          listener(error);
        });
      },
    });
  };
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

async function waitFor(
  predicate: () => boolean,
  what: string,
  diagnostics: () => string,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = systemClock.monotonicMs() + timeoutMs;
  while (!predicate()) {
    if (systemClock.monotonicMs() > deadline) {
      throw new Error(`timed out after ${String(timeoutMs)}ms waiting for ${what}\n${diagnostics()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Every worker process-lock record under `<lockRoot>/workers`, by worker id. */
function workerLockRecords(lockRoot: string): Map<string, { releasedAt: string | null }> {
  const directory = join(lockRoot, "workers");
  const records = new Map<string, { releasedAt: string | null }>();
  if (!existsSync(directory)) return records;
  for (const name of readdirSync(directory)) {
    if (!name.endsWith(".lock.json") || name.startsWith(".")) continue;
    const parsed = WorkerProcessLockFileSchema.parse(
      JSON.parse(readFileSync(join(directory, name), "utf8")),
    );
    assert.equal(parsed.name, "workers");
    if (!("workerId" in parsed)) throw new Error("unbound-worker-process-lock");
    records.set(parsed.workerId, { releasedAt: parsed.releasedAt });
  }
  return records;
}

function reportW5Phase(
  proof: "two-child-door" | "runtime-shutdown",
  phase: "startup" | "spawn-and-birth" | "graceful-stop" | "shutdown" | "teardown",
  state: "begin" | "complete",
): void {
  process.stdout.write(`[r3b:w5:${proof}] ${phase}:${state}\n`);
}

describe("real processes: two children supervised concurrently through the composed kernel door", () => {
  interface RealHarness {
    readonly database: AuthorityDatabase;
    readonly kernel: CommandKernel;
    readonly control: ReturnType<typeof composeWorkerProcessControl>;
    readonly records: RealChildRecord[];
    readonly faults: Error[];
    readonly events: PoolEffectEvent[];
    readonly lockRoot: string;
    readonly dbPath: string;
  }

  function openRealHarness(launchCommandOverride?: string): RealHarness {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-w5-real-"));
    roots.push(root);
    const stateRoot = join(root, ".tracker");
    const dbPath = join(stateRoot, "state.db");
    const lockRoot = join(stateRoot, "locks");
    mkdirSync(stateRoot, { recursive: true });
    const database = AuthorityDatabase.open(
      { path: dbPath, busyTimeoutMs: 5_000, migrationOwner: "unit-test" },
      systemClock,
    );
    seedSyntheticRuntimeConfig(database);
  openDatabases.push(database);
    const records: RealChildRecord[] = [];
    const faults: Error[] = [];
    const events: PoolEffectEvent[] = [];
    const control = composeWorkerProcessControl({
      profileRoot: join(stateRoot, "browsers"), processLockRoot: lockRoot,
      database,
      clock: systemClock,
      scheduler: createTimeoutDeadlineScheduler(systemClock),
      launch: {
      environment: {},
        command: launchCommandOverride ?? process.execPath,
        prefixArgs: Object.freeze(["--import", "tsx", STUB_CLI_PATH, dbPath, lockRoot, "synthetic"]),
        cwd: REPO_ROOT,
      },
      spawn: realStubSpawner(records),
      birth: { pollMs: 50, timeoutMs: 30_000 },
      onFault: (error) => {
        faults.push(error);
      },
    });
    cleanups.push(() => {
      control.supervisor.close();
    });
    const kernel = kernelOver(database, systemClock, instrumentPool(control.workerRuntime.pool, systemClock, events));
    return { database, kernel, control, records, faults, events, lockRoot, dbPath };
  }

  it(
    "spawns worker 1 and worker 2 as real children, proves both births via durable leases, and stops both — exact identities, no cross-talk",
    async () => {
      reportW5Phase("two-child-door", "startup", "begin");
      const harness = openRealHarness();
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
      assert.equal(PL_1.workerId, "person-lookup-worker-1");
      assert.equal(PL_2.workerId, "person-lookup-worker-2");
      assert.equal(harness.records.length, 2);
      const record1 = required(harness.records.find((record) => record.member.workerId === PL_1.workerId), "child 1");
      const record2 = required(harness.records.find((record) => record.member.workerId === PL_2.workerId), "child 2");
      for (const [record, index] of [[record1, 1], [record2, 2]] as const) {
        assert.equal(record.command, process.execPath);
        assert.deepEqual([...record.argv], [
          "--import", "tsx", STUB_CLI_PATH, harness.dbPath, harness.lockRoot, "synthetic",
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

      // Concurrent stops: both settle applied; the durable directive instant
      // IS the observed graceful stage instant for each member.
      reportW5Phase("two-child-door", "graceful-stop", "begin");
      const stop1Id = nextCommandId();
      const stop2Id = nextCommandId();
      const stopSubmitMs = systemClock.monotonicMs();
      const [stop1Result, stop2Result] = await Promise.all([
        harness.kernel.executeWorkerPool({
          ...envelope(systemClock, stop1Id),
          type: "stop-worker",
          target: { workerId: PL_1.workerId, expectedVersion: lease1.version, controlBasis: servedControlBasis(harness.database, PL_1.workerId) },
          reason: "w5 stop",
        }),
        harness.kernel.executeWorkerPool({
          ...envelope(systemClock, stop2Id),
          type: "stop-worker",
          target: { workerId: PL_2.workerId, expectedVersion: lease2.version, controlBasis: servedControlBasis(harness.database, PL_2.workerId) },
          reason: "w5 stop",
        }),
      ]);
      const stopsAckMs = systemClock.monotonicMs() - stopSubmitMs;
      assert.equal(stop1Result.state, "applied");
      assert.equal(stop2Result.state, "applied");
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
      assert.deepEqual(harness.control.supervisor.close(), []);
      assert.deepEqual(harness.faults, []);
      for (const commandId of [planId, spawn1Id, spawn2Id, stop1Id, stop2Id]) {
        assertJournaled(harness.database, commandId);
      }
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
    },
    120_000,
  );

  it(
    "a REAL spawn ENOENT rejects typed with retained admission and no fabricated pid",
    async () => {
      const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-w5-enoent-"));
      roots.push(root);
      const harness = openRealHarness(join(root, "no-such-node-binary"));
      assert.equal((await harness.kernel.executeWorkerPool({ ...envelope(systemClock), type: "plan-worker-count",
        target: { workflowId: PL, expectedVersion: 0 }, payload: { desiredWorkers: 1 } })).state, "applied");
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
    },
    60_000,
  );
});
