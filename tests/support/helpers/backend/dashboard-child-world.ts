import { testProcessImport } from "../../compiled-process.js";
import type { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { AuthorityDatabase } from "../admission-fixture.js";
import assert from "node:assert/strict";
import { spawn as spawnChildProcess, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { type WorkerPoolMember } from "../../../../src/backend/runtime/workers/worker-loop.js";
import { type WorkerProcessSpawner } from "../../../../src/backend/runtime/workers/worker-supervisor.js";
import { WorkerProcessLockFileSchema } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { PositiveIntSchema, WorkerIdSchema, WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { systemClock, type Clock } from "../../../../src/rules/time/clock.js";
import { scaledMs } from "../../time-scale.js";

export interface RealChildRecord {
  readonly member: WorkerPoolMember;
  readonly command: string;
  readonly argv: readonly string[];
  readonly pid: number | undefined;
  readonly child: ChildProcess;
  readonly output: string[];
  exited: boolean;
}



export function createDashboardChildTestWorld(releaseAdmissionFixtures: () => void, releaseAdmissionFixture: (root: string) => void) {
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

  const STUB_CLI_PATH = join(process.cwd(), "tests", "support", "processes", "worker-stub-cli.ts");

  const REPO_ROOT = process.cwd();

  function required<T>(value: T | undefined, what: string): T {
    if (value === undefined) throw new Error(`the proof expected ${what} to exist`);
    return value;
  }

  const roots: string[] = [];

  const openDatabases: AuthorityDatabase[] = [];

  const cleanups: (() => Promise<void> | void)[] = [];

  const liveRealChildren: ChildProcess[] = [];

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

  function realStubSpawner(records: RealChildRecord[], lifetime: RuntimeLifetimeLock): WorkerProcessSpawner {
    return (request) => {
      const child = spawnChildProcess(request.command, ["--import", testProcessImport(), ...request.args.slice(2)], {
        cwd: request.cwd,
        stdio: ["ignore", "pipe", "pipe", "ipc"],
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
      let transfer: Promise<void>;
      try { transfer = lifetime.share(child); }
      catch (error) { transfer = Promise.reject(error instanceof Error ? error : new Error("worker lifetime transfer failed", { cause: error })); }
      void transfer.catch(error => { child.kill("SIGKILL"); child.emit("error", error); });
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
    const deadline = systemClock.monotonicMs() + scaledMs(timeoutMs);
    while (!predicate()) {
      if (systemClock.monotonicMs() > deadline) {
        throw new Error(`timed out after ${String(scaledMs(timeoutMs))}ms waiting for ${what}\n${diagnostics()}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

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
  function stubLaunch(dbPath: string, lockRoot: string, mode: "installed" | "synthetic", command: string, lifetime: RuntimeLifetimeLock) {
    return {
      environment: {},
      command,
      prefixArgs: Object.freeze(["--import", "tsx", STUB_CLI_PATH, String(lifetime.port), dbPath, lockRoot, mode]),
      cwd: REPO_ROOT,
    };
  }

  const cleanup = async () => {
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
  };
  return { stubLaunch, servedControlBasis, PL, plMember, STUB_CLI_PATH, REPO_ROOT, required, roots, openDatabases, cleanups, liveRealChildren, envelope, realStubSpawner, pidAlive, waitFor, workerLockRecords, reportW5Phase, nextCommandId, cleanup };
}
