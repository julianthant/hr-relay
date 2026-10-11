import { workerPoolMember } from "../../../../../src/models/run/worker-slot.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";
import { installationAdmission,releaseAdmissionFixture,releaseAdmissionFixtures } from "../../../../support/helpers/admission-fixture.js";

import assert from "node:assert/strict";
import { spawn as spawnChildProcess,type ChildProcess } from "node:child_process";
import { copyFileSync,existsSync,mkdtempSync,readdirSync,readFileSync,realpathSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,describe,it } from "vitest";
import {
composeDashboardRuntime,
type DashboardRuntime
} from "../../../../../src/backend/app/composition/dashboard/compose.js";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { type WorkerPoolMember } from "../../../../../src/backend/runtime/workers/worker-loop.js";
import type {
WorkerProcessSpawner
} from "../../../../../src/backend/runtime/workers/worker-supervisor.js";
import { readRuntimeProcessLock,WorkerProcessLockFileSchema } from "../../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { PositiveIntSchema,WorkerIdSchema,WorkflowIdSchema } from "../../../../../src/rules/identity/ids.js";
import { systemClock,type Clock } from "../../../../../src/rules/time/clock.js";
import { AuthorityDatabase } from "../../../../support/helpers/admission-fixture.js";

function servedControlBasis(database: AuthorityDatabase, workerId: string) {
  const lease = database.authority.workerLeases.get(workerId);
  assert.ok(lease?.controlRevision, "the fixture must serve a real control basis");
  return { leaseGeneration: lease.leaseGeneration, controlRevision: lease.controlRevision };
}
const PL = WorkflowIdSchema.parse("person-lookup");
const SEP = WorkflowIdSchema.parse("separations");
const plMember = (index: number): WorkerPoolMember => {
  const poolIndex = PositiveIntSchema.parse(index);
  return { workflowId: PL, poolIndex, ordinal: poolIndex, membershipRevision: PositiveIntSchema.parse(1), workerId: WorkerIdSchema.parse(`person-lookup-worker-${String(index)}`) };
};
const _PL_1 = plMember(1);

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

describe("real runtime: dashboard shutdown releases the locks, reports close evidence, and leaves no orphans", () => {
  it(
    "two real children over the real ingress; graceful stop, shutdown with one live child, then PID-proved teardown",
    async () => {
      reportW5Phase("runtime-shutdown", "startup", "begin");
      const repoRoot = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-w5-runtime-"));
      roots.push(repoRoot);
      copyFileSync(join(process.cwd(), "package.json"), join(repoRoot, "package.json"));
      copyFileSync(join(process.cwd(), "package-lock.json"), join(repoRoot, "package-lock.json"));
      const stateRoot = join(repoRoot, rebuildRuntimeIsolation.stateRoot);
      const dbPath = join(stateRoot, "state.db");
      const lockRoot = join(repoRoot, rebuildRuntimeIsolation.processLockRoot);
      const serverLockRecord = () => required(readRuntimeProcessLock(lockRoot, "server"), "server process custody");
      const records: RealChildRecord[] = [];
      const faultLines: string[] = [];
      const childOutput = (): string => records.map((record) =>
        `${record.member.workerId}: ${record.output.join("")}`).join("\n");

      const runtime: DashboardRuntime = await composeDashboardRuntime({ admission: installationAdmission(repoRoot), preflightRunnerFactory: healthyRuntimePreflightRunners,
        isolation: rebuildRuntimeIsolation,
        backendPortOverride: 0,
        frontendPortOverride: 0,
        env: {},
        repoRoot,
        workerProcess: {
          launch: {
      environment: {},
            command: process.execPath,
            prefixArgs: Object.freeze(["--import", "tsx", STUB_CLI_PATH, dbPath, lockRoot, "installed"]),
            cwd: REPO_ROOT,
          },
          spawn: realStubSpawner(records),
          birth: { pollMs: 50, timeoutMs: 30_000 },
          faultSink: (line) => {
            faultLines.push(line);
          },
        },
      });
      const stops: (() => Promise<void>)[] = [() => runtime.stop()];
      cleanups.push(async () => {
        for (const stop of stops.splice(0)) await stop();
      });
      reportW5Phase("runtime-shutdown", "startup", "complete");

      const post = async (body: Record<string, unknown>): Promise<{ status: number; state: string }> => {
        const origin = `http://127.0.0.1:${String(runtime.port)}`;
        const response = await fetch(`${origin}/api/v1/commands`, {
          method: "POST",
          headers: { "content-type": "application/json", origin },
          body: JSON.stringify(body),
        });
        return { status: response.status, state: ((await response.json()) as { state: string }).state };
      };

      // Two REAL children, two workflows, spawned concurrently over the real
      // ingress; each proves its own birth by writing its durable lease.
      reportW5Phase("runtime-shutdown", "spawn-and-birth", "begin");
      for (const workflowId of [PL, SEP]) {
        assert.deepEqual(await post({ ...envelope(systemClock), type: "plan-worker-count",
          target: { workflowId, expectedVersion: 0 }, payload: { desiredWorkers: 1 } }), { status: 200, state: "applied" });
      }
      const roster = AuthorityDatabase.open({ path: dbPath, busyTimeoutMs: 5_000, migrationOwner: "unit-test" }, systemClock);
      let PL_1: WorkerPoolMember; let SEP_1: WorkerPoolMember;
      try {
        PL_1 = workerPoolMember(required(roster.authority.workerSlots.list(PL).find(slot => slot.retiredAt === null), "PL slot"));
        SEP_1 = workerPoolMember(required(roster.authority.workerSlots.list(SEP).find(slot => slot.retiredAt === null), "SEP slot"));
      } finally { roster.close(); }
      const [spawnPl, spawnSep] = await Promise.all([
        post({
          ...envelope(systemClock),
          type: "spawn-worker",
          target: { workflowId: PL, expectedVersion: 1 },
          payload: { workerId: PL_1.workerId },
        }),
        post({
          ...envelope(systemClock),
          type: "spawn-worker",
          target: { workflowId: SEP, expectedVersion: 1 },
          payload: { workerId: SEP_1.workerId },
        }),
      ]);
      assert.deepEqual([spawnPl, spawnSep], [
        { status: 200, state: "applied" },
        { status: 200, state: "applied" },
      ], childOutput());
      const plRecord = required(records.find((record) => record.member.workerId === PL_1.workerId), "PL child");
      const sepRecord = required(records.find((record) => record.member.workerId === SEP_1.workerId), "SEP child");
      const plPid = required(plRecord.pid, "PL pid");
      const sepPid = required(sepRecord.pid, "SEP pid");
      assert.equal(pidAlive(plPid) && pidAlive(sepPid), true, childOutput());
      reportW5Phase("runtime-shutdown", "spawn-and-birth", "complete");

      // Graceful stop of PL-1 through the same ingress: the real child
      // observes the durable directive, releases its lock, and dies.
      reportW5Phase("runtime-shutdown", "graceful-stop", "begin");
      const sideDoor = AuthorityDatabase.open(
        { path: dbPath, busyTimeoutMs: 5_000, migrationOwner: "unit-test" },
        systemClock,
      );
      let plLeaseVersion: number;
      let plControlBasis: ReturnType<typeof servedControlBasis>;
      try {
        plLeaseVersion = required(sideDoor.authority.workerLeases.get(PL_1.workerId), "PL lease").version;
        plControlBasis = servedControlBasis(sideDoor, PL_1.workerId);
      } finally {
        sideDoor.close();
      }
      assert.deepEqual(
        await post({
          ...envelope(systemClock),
          type: "stop-worker",
          target: { workerId: PL_1.workerId, expectedVersion: plLeaseVersion, controlBasis: plControlBasis },
          reason: "w5 runtime stop",
        }),
        { status: 200, state: "applied" },
      );
      await waitFor(() => !pidAlive(plPid), "the stopped child's pid to die", childOutput);
      assert.notEqual(
        required(workerLockRecords(lockRoot).get(PL_1.workerId), "PL-1 worker lock").releasedAt,
        null,
      );
      reportW5Phase("runtime-shutdown", "graceful-stop", "complete");

      // Shutdown while SEP-1 is STILL LIVE: the supervisor's close() evidence
      // completes child shutdown before releasing the server process record.
      reportW5Phase("runtime-shutdown", "shutdown", "begin");
      assert.equal(
        serverLockRecord().releasedAt,
        null,
      );
      for (const stop of stops.splice(0)) await stop();
      assert.notEqual(
        serverLockRecord().releasedAt,
        null,
      );
      assert.deepEqual(faultLines, [], "owned children drain without shutdown faults");
      assert.equal(pidAlive(sepPid), false, "dashboard shutdown must drain its owned child");
      reportW5Phase("runtime-shutdown", "shutdown", "complete");
      reportW5Phase("runtime-shutdown", "teardown", "begin");
      assert.notEqual(
        required(workerLockRecords(lockRoot).get(SEP_1.workerId), "SEP-1 worker lock").releasedAt,
        null,
      );
      assert.deepEqual(
        records.map((record) => ({ workerId: record.member.workerId, alive: pidAlive(required(record.pid, "pid")) })),
        [
          { workerId: PL_1.workerId, alive: false },
          { workerId: SEP_1.workerId, alive: false },
        ],
      );
      reportW5Phase("runtime-shutdown", "teardown", "complete");
    },
    120_000,
  );
});
