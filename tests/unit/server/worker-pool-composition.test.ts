/**
 * W3 (ref execution-and-sessions §11, D271): the dashboard's REAL worker
 * process control, composed exactly as production composes it —
 * `composeWorkerProcessControl` over a real temp-file `AuthorityDatabase`,
 * wrapped by the real pool executor and adopted by the real command kernel's
 * async `executeWorkerPool` door. Only the process edges are fakes (the
 * spawner, the scheduler, the clock), so a pass here pins production wiring:
 *
 * - a spawn acknowledges ONLY after the child's own durable lease proves its
 *   pid (no journal row, no audit, no reply before process evidence);
 * - the graceful-stop channel writes the durable lease directive at EXACTLY
 *   the kernel command's `now` (the W1/W2 requestedAt==command-now pin);
 * - an externally started worker refuses end-to-end: no adoption, no
 *   directive written, no journal row;
 * - dashboard shutdown closes the supervisor after ingress and before the
 *   process lock releases, and still-live children reach the fault path.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { rebuildRuntimeIsolation } from "../../../src/config/runtime-isolation.js";
import { DESCRIPTORS } from "../../../src/control/workflow-registry.js";
import { createCommandKernel, type CommandKernel } from "../../../src/core/command-kernel.js";
import { poolWorkerId } from "../../../src/core/worker-loop.js";
import { manualClock, type TestClock } from "../../../src/domain/clock.js";
import { PositiveIntSchema, WorkflowIdSchema } from "../../../src/domain/ids.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/index.js";
import {
  composeDashboardRuntime,
  composeWorkerProcessControl,
  type DashboardRuntime,
} from "../../../src/server/dashboard/compose.js";
import type {
  SpawnedWorkerHandle,
  WorkerProcessSpawnRequest,
} from "../../../src/server/dashboard/worker-supervisor.js";
import { ManualScheduler } from "../fixtures/phase1f-executor-harness.js";
import { sequentialIdFactory } from "../fixtures/phase1f-run-fixtures.js";
import {
  NO_INTAKE_PROJECTIONS,
  UNSTORED_CONFIG_IDENTITY,
  UNWIRED_INTAKE_PARSER,
} from "../../fixtures/intake-kernel-seams.js";
import { UNWIRED_ARCHIVE_SNAPSHOTS } from "../fixtures/archive-fixtures.js";

const NOW = "2026-08-26T09:00:00.000Z";
const WORKFLOW = WorkflowIdSchema.parse("person-lookup");
const POOL_INDEX_1 = PositiveIntSchema.parse(1);
const WORKER_1 = poolWorkerId(WORKFLOW, POOL_INDEX_1);
const MEMBER_1 = { workflowId: WORKFLOW, poolIndex: POOL_INDEX_1, workerId: WORKER_1 } as const;

const roots: string[] = [];
const openDatabases: AuthorityDatabase[] = [];
const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  for (const database of openDatabases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/* ── fakes at the process boundary (the W2 pattern) ──────────────────────── */

class FakeWorkerChild implements SpawnedWorkerHandle {
  readonly pid: number | undefined;
  readonly signalsSent: string[] = [];
  #exitListeners: ((code: number | null, signal: string | null) => void)[] = [];

  constructor(pid: number | undefined) {
    this.pid = pid;
  }

  kill(signal: "SIGTERM" | "SIGKILL"): boolean {
    this.signalsSent.push(signal);
    return true;
  }

  onExit(listener: (code: number | null, signal: string | null) => void): void {
    this.#exitListeners.push(listener);
  }

  onError(): void {
    // No fake process errors in this suite.
  }

  emitExit(code: number | null, signal: string | null): void {
    for (const listener of this.#exitListeners) listener(code, signal);
  }
}

interface ControlHarness {
  readonly database: AuthorityDatabase;
  readonly clock: TestClock;
  readonly scheduler: ManualScheduler;
  readonly kernel: CommandKernel;
  readonly control: ReturnType<typeof composeWorkerProcessControl>;
  readonly children: FakeWorkerChild[];
  readonly spawnRequests: WorkerProcessSpawnRequest[];
  readonly faults: Error[];
}

function openControlHarness(): ControlHarness {
  const root = mkdtempSync(join(tmpdir(), "hrauto-worker-pool-"));
  roots.push(root);
  const clock = manualClock(new Date(NOW));
  const database = AuthorityDatabase.open(
    { path: join(root, "state.db"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
    clock,
  );
  openDatabases.push(database);
  const scheduler = new ManualScheduler(clock, 0);
  const children: FakeWorkerChild[] = [];
  const spawnRequests: WorkerProcessSpawnRequest[] = [];
  const faults: Error[] = [];
  let nextPid = 6000;
  const control = composeWorkerProcessControl({
    database,
    clock,
    scheduler,
    launch: {
      command: "/usr/bin/fake-worker-node",
      prefixArgs: Object.freeze(["--import", "tsx", "src/cli.ts"]),
      cwd: root,
    },
    spawn: (request) => {
      spawnRequests.push(request);
      const child = new FakeWorkerChild(nextPid += 1);
      children.push(child);
      return child;
    },
    birth: { pollMs: 250, timeoutMs: 10_000 },
    onFault: (error) => {
      faults.push(error);
    },
  });
  const kernel = createCommandKernel({
    appVersion: "0.1.0",
    archiveSnapshots: UNWIRED_ARCHIVE_SNAPSHOTS,
    configIdentity: UNSTORED_CONFIG_IDENTITY,
    intakeParser: UNWIRED_INTAKE_PARSER,
    intakeProjections: NO_INTAKE_PROJECTIONS,
    authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
    clock,
    ids: sequentialIdFactory("d"),
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
    // EXACTLY what src/server/dashboard/compose.ts adopts: the pool executor
    // over the composed supervisor, behind the explicit adoption wrapper.
    workerRuntime: control.workerRuntime,
  });
  return { database, clock, scheduler, kernel, control, children, spawnRequests, faults };
}

let commandSequence = 0;
function nextCommandId(): string {
  commandSequence += 1;
  const tail = String(commandSequence).padStart(4, "0");
  return `dddddddd-${tail}-4000-8000-${tail}00000000`;
}

function envelope(harness: ControlHarness, commandId = nextCommandId()) {
  return {
    commandId,
    requestedAt: harness.clock.now().toISOString(),
    requestedBy: "local-operator",
    source: "dashboard",
    family: "worker-browser",
  } as const;
}

const settleMicrotasks = async (): Promise<void> => {
  // Two macrotask turns: the birth promise's first poll and the scheduler's
  // queueMicrotask auto-fire both run before assertions look at the world.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

/** Fire every due-or-pending scheduler entry once (the birth re-probe tick). */
function fireBirthPoll(harness: ControlHarness): void {
  for (const entry of harness.scheduler.pending()) entry.fire();
}

/**
 * The composed spawn happy path: submit through the kernel's pool door, let
 * the child "boot", prove its birth by writing the SAME durable lease the real
 * worker CLI writes, and tick the poll.
 */
async function spawnWorkerOne(harness: ControlHarness): Promise<{ commandId: string; result: unknown }> {
  const commandId = nextCommandId();
  const pending = harness.kernel.executeWorkerPool({
    ...envelope(harness, commandId),
    type: "spawn-worker",
    target: { workflowId: WORKFLOW, expectedVersion: 0 },
    payload: { workerId: WORKER_1 },
  });
  await settleMicrotasks();
  const child = harness.children.at(-1);
  if (child?.pid === undefined) throw new Error("the fake spawner produced no child");
  assert.equal(harness.database.authority.workerLeases.start({
    workerId: WORKER_1,
    workflow: WORKFLOW,
    processId: child.pid,
    requestedBy: "local-operator",
    now: harness.clock.now().toISOString(),
  }).state, "started");
  fireBirthPoll(harness);
  return { commandId, result: await pending };
}

/* ── the composed seam, end to end ───────────────────────────────────────── */

describe("the composed worker process control through the kernel pool door", () => {
  it("spawns the exact worker CLI argv and acknowledges only after the durable lease proves birth", async () => {
    const harness = openControlHarness();
    const commandId = nextCommandId();
    const pending = harness.kernel.executeWorkerPool({
      ...envelope(harness, commandId),
      type: "spawn-worker",
      target: { workflowId: WORKFLOW, expectedVersion: 0 },
      payload: { workerId: WORKER_1 },
    });
    await settleMicrotasks();

    // The process was launched with the exact argv — but with NO birth
    // evidence yet, nothing is journaled and nothing has been acknowledged.
    assert.equal(harness.spawnRequests.length, 1);
    assert.deepEqual([...harness.spawnRequests[0]?.args ?? []], [
      "--import", "tsx", "src/cli.ts",
      "worker", "person-lookup", "--pool-index", "1",
    ]);
    assert.equal(harness.database.authority.commands.get(commandId), undefined);

    // Birth: the child's own durable lease, under the child's real pid.
    const child = harness.children[0];
    if (child?.pid === undefined) throw new Error("the fake spawner produced no child");
    assert.equal(harness.database.authority.workerLeases.start({
      workerId: WORKER_1, workflow: WORKFLOW, processId: child.pid, requestedBy: "local-operator", now: NOW,
    }).state, "started");
    fireBirthPoll(harness);

    const result = await pending;
    assert.deepEqual(result, {
      state: "applied",
      commandId,
      affectedTargets: [{ family: "worker-browser", workerId: WORKER_1 }],
    });
    // The settled reply is journaled and audited in the same transaction.
    assert.notEqual(harness.database.authority.commands.get(commandId), undefined);
    assert.equal(harness.database.authority.commandAudits.findByCommand(commandId)?.result.state, "applied");
    assert.deepEqual(harness.control.supervisor.memberEvidence(MEMBER_1)?.state, "running");
  });

  it("rejects a spawn whose child never proves birth: SIGKILL, no journal row, no acknowledgement", async () => {
    const harness = openControlHarness();
    const commandId = nextCommandId();
    const pending = harness.kernel.executeWorkerPool({
      ...envelope(harness, commandId),
      type: "spawn-worker",
      target: { workflowId: WORKFLOW, expectedVersion: 0 },
      payload: { workerId: WORKER_1 },
    });
    await settleMicrotasks();
    harness.clock.advanceMonotonic(10_000);
    fireBirthPoll(harness);

    await assert.rejects(() => pending, /proved no lease birth within 10000ms; the unproved child was killed/);
    assert.deepEqual(harness.children[0]?.signalsSent, ["SIGKILL"]);
    assert.equal(harness.database.authority.commands.get(commandId), undefined);
    assert.equal(harness.database.authority.commandAudits.findByCommand(commandId), undefined);
  });

  it("refuses an externally started worker end-to-end: no adoption, no directive, no journal row", async () => {
    const harness = openControlHarness();
    // An operator started this worker by hand: the lease is live under a pid
    // this supervisor never spawned.
    assert.equal(harness.database.authority.workerLeases.start({
      workerId: WORKER_1, workflow: WORKFLOW, processId: 999, requestedBy: "local-operator", now: NOW,
    }).state, "started");

    const spawnId = nextCommandId();
    // The kernel's own authority validation refuses BEFORE the supervisor is
    // consulted — a typed rejection, and no process was launched.
    const rejected = await harness.kernel.executeWorkerPool({
      ...envelope(harness, spawnId),
      type: "spawn-worker",
      target: { workflowId: WORKFLOW, expectedVersion: 0 },
      payload: { workerId: WORKER_1 },
    });
    assert.equal(rejected.state, "rejected");
    if (rejected.state !== "rejected") throw new Error("unreachable");
    assert.match(rejected.message, /already holds a live lease in state starting/);
    assert.equal(harness.spawnRequests.length, 0);
    assert.equal(harness.database.authority.commands.get(spawnId), undefined);

    const stopId = nextCommandId();
    await assert.rejects(
      () => harness.kernel.executeWorkerPool({
        ...envelope(harness, stopId),
        type: "stop-worker",
        target: { workerId: WORKER_1, expectedVersion: 1 },
      }),
      /never spawned person-lookup-worker-1; an externally started worker is never adopted or controlled/,
    );
    // The refusal wrote NOTHING durable: the external worker keeps running
    // and its lease still carries the run directive.
    assert.equal(harness.database.authority.workerLeases.get(WORKER_1)?.control.directive, "run");
    assert.equal(harness.database.authority.commands.get(stopId), undefined);
  });

  it("writes the durable stop directive at exactly the command's now (the requestedAt==command-now pin)", async () => {
    const harness = openControlHarness();
    await spawnWorkerOne(harness);
    harness.clock.advanceWall(5_000);
    const stopAt = harness.clock.now().toISOString();

    const commandId = nextCommandId();
    const result = await harness.kernel.executeWorkerPool({
      ...envelope(harness, commandId),
      type: "stop-worker",
      target: { workerId: WORKER_1, expectedVersion: 1 },
      reason: "shift over",
    });
    assert.deepEqual(result, {
      state: "applied",
      commandId,
      affectedTargets: [{ family: "worker-browser", workerId: WORKER_1 }],
    });

    // The durable directive IS the command: its instant is the command's own
    // `now` (never the channel's clock), its actor and reason the command's.
    assert.deepEqual(harness.database.authority.workerLeases.get(WORKER_1)?.control, {
      directive: "stop",
      requestedAt: stopAt,
      requestedBy: "local-operator",
      reason: "shift over",
    });
    // And the supervisor's observed graceful stage carries the SAME instant —
    // the kernel's requireObservedNotAfterNow bound holds by construction.
    assert.deepEqual(harness.control.supervisor.memberEvidence(MEMBER_1), {
      state: "stopping",
      pid: harness.children[0]?.pid,
      bornAt: NOW,
      observedStop: [{ stage: "graceful-stop-requested", at: stopAt }],
    });
  });

  it("plans only after validation, and writes the desired count from the command — never from the ack path", async () => {
    const harness = openControlHarness();
    // A stale CAS basis refuses BEFORE the supervisor is consulted: no pool
    // row, no journal row, no process effect.
    const staleId = nextCommandId();
    const conflicted = await harness.kernel.executeWorkerPool({
      ...envelope(harness, staleId),
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW, expectedVersion: 3 },
      payload: { desiredWorkers: 1 },
    });
    assert.equal(conflicted.state, "conflict");
    assert.equal(harness.database.authority.workerPools.get(WORKFLOW), undefined);
    assert.equal(harness.database.authority.commands.get(staleId), undefined);
    assert.equal(harness.spawnRequests.length, 0);

    const planId = nextCommandId();
    const planned = await harness.kernel.executeWorkerPool({
      ...envelope(harness, planId),
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW, expectedVersion: 0 },
      payload: { desiredWorkers: 1 },
    });
    assert.deepEqual(planned, {
      state: "applied",
      commandId: planId,
      affectedTargets: [
        { family: "worker-pool", workflowId: WORKFLOW },
        { family: "worker-browser", workerId: WORKER_1 },
      ],
    });
    assert.equal(harness.database.authority.workerPools.get(WORKFLOW)?.desiredWorkers, 1);
    assert.equal(harness.database.authority.workerPools.get(WORKFLOW)?.version, 1);
  });

  it("replays an already-applied spawn without re-running the process effect", async () => {
    const harness = openControlHarness();
    const { commandId } = await spawnWorkerOne(harness);
    assert.equal(harness.children.length, 1);

    const replayed = await harness.kernel.executeWorkerPool({
      ...envelope(harness, commandId),
      type: "spawn-worker",
      target: { workflowId: WORKFLOW, expectedVersion: 0 },
      payload: { workerId: WORKER_1 },
    });
    assert.equal(replayed.state, "already-applied");
    // Replay is a READ: the supervisor spawned nothing new.
    assert.equal(harness.children.length, 1);
  });

  it("refuses the synchronous execute path for worker-browser, and other families at the pool door", async () => {
    const harness = openControlHarness();
    assert.throws(
      () => harness.kernel.execute({
        ...envelope(harness),
        type: "plan-worker-count",
        target: { workflowId: WORKFLOW, expectedVersion: 0 },
        payload: { desiredWorkers: 1 },
      }),
      /adopted the async worker pool seam; worker-browser commands settle only through executeWorkerPool/,
    );
    await assert.rejects(
      () => harness.kernel.executeWorkerPool({
        commandId: nextCommandId(),
        requestedAt: NOW,
        requestedBy: "local-operator",
        source: "dashboard",
        family: "run",
        type: "cancel",
        target: { runId: "11111111-1111-4111-8111-111111111111", expectedVersion: 1 },
      }),
      /executeWorkerPool settles only worker-browser commands; received run\/cancel/,
    );
  });
});

/* ── dashboard shutdown ordering (the composed runtime) ──────────────────── */

describe("dashboard shutdown closes the worker supervisor between ingress and the process lock", () => {
  it("reports still-live children to the fault path and releases the server lock afterwards", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-shutdown-"));
    writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ name: "probe", version: "0.1.0" }));
    cleanups.push(() => rmSync(repoRoot, { recursive: true, force: true }));

    const clock = manualClock(new Date(NOW));
    const scheduler = new ManualScheduler(clock, 0);
    const children: FakeWorkerChild[] = [];
    const faultLines: string[] = [];
    let runtime: DashboardRuntime;
    try {
      runtime = await composeDashboardRuntime({
        isolation: rebuildRuntimeIsolation,
        env: {},
        clock,
        repoRoot,
        workerProcess: {
          scheduler,
          spawn: () => {
            const child = new FakeWorkerChild(7001);
            children.push(child);
            return child;
          },
          birth: { pollMs: 250, timeoutMs: 10_000 },
          faultSink: (line) => {
            faultLines.push(line);
          },
        },
      });
    } catch (error) {
      // The port is a machine-wide singleton; a concurrently running rebuild
      // dashboard legitimately owns it. That is contention, not a regression.
      if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EADDRINUSE") return;
      throw error;
    }
    const stops: (() => Promise<void>)[] = [() => runtime.stop()];
    cleanups.push(async () => {
      for (const stop of stops.splice(0)) await stop();
    });

    // Spawn one worker over the REAL ingress (the same route the operator's
    // dashboard uses), prove its birth against the same authority store, and
    // let the command settle.
    const commandId = nextCommandId();
    const posted = fetch(`http://127.0.0.1:${String(runtime.port)}/api/v1/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        commandId,
        requestedAt: clock.now().toISOString(),
        requestedBy: "local-operator",
        source: "dashboard",
        family: "worker-browser",
        type: "spawn-worker",
        target: { workflowId: WORKFLOW, expectedVersion: 0 },
        payload: { workerId: WORKER_1 },
      }),
    });
    // Wait for the composed supervisor to actually launch the child.
    for (let waited = 0; children.length === 0 && waited < 200; waited += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(children.length, 1);
    const sideDoor = AuthorityDatabase.open(
      { path: join(repoRoot, rebuildRuntimeIsolation.stateRoot, "state.db"), busyTimeoutMs: 5_000, migrationOwner: "unit-test" },
      clock,
    );
    try {
      assert.equal(sideDoor.authority.workerLeases.start({
        workerId: WORKER_1, workflow: WORKFLOW, processId: 7001, requestedBy: "local-operator", now: NOW,
      }).state, "started");
    } finally {
      sideDoor.close();
    }
    for (const entry of scheduler.pending()) entry.fire();
    const response = await posted;
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as { state: string }).state, "applied");

    // Shutdown: ingress stops, the supervisor closes, THEN the lock releases.
    const lockFile = join(repoRoot, rebuildRuntimeIsolation.processLockRoot, "server.lock.json");
    const lockRecord = (): { releasedAt: string | null } =>
      JSON.parse(readFileSync(lockFile, "utf8")) as { releasedAt: string | null };
    assert.equal(existsSync(lockFile), true);
    assert.equal(lockRecord().releasedAt, null);
    for (const stop of stops.splice(0)) await stop();

    // The still-live child reached the structured fault path — one JSON line
    // naming its running state — and was NOT pretended stopped.
    const shutdownLines = faultLines.filter((line) => line.includes("dashboard shutdown leaves a worker child"));
    assert.equal(shutdownLines.length, 1);
    const parsed = JSON.parse(shutdownLines[0] ?? "") as { level: string; source: string; message: string };
    assert.equal(parsed.level, "error");
    assert.equal(parsed.source, "worker-supervisor");
    assert.match(parsed.message, /"state":"running"/);
    assert.match(parsed.message, /"pid":7001/);
    // The process lock under .tracker-rebuild/locks records its release only
    // after the supervisor closed (the closed-supervisor refusal itself is
    // pinned in the W2 suite). The file stays as the durable record; the NEXT
    // acquirer archives it.
    assert.notEqual(lockRecord().releasedAt, null);
  });
});
