import { testProcessImport } from "../../compiled-process.js";
import type { ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { realWorkerProcessSpawner, type WorkerCliLaunchSpec, type WorkerProcessSpawner } from "../../../../src/backend/app/composition/dashboard/worker-process.js";
import { createNominatimGeocodeAdapter } from "../../../../src/backend/processing/providers/geocode-adapters.js";
import type { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { systemClock, type Clock } from "../../../../src/rules/time/clock.js";
import { scaledMs } from "../../time-scale.js";
import { credentialKeychainTestEnvironment } from "../credential-keychain-fake.js";

export interface RealChildRecord {
  readonly argv: readonly string[];
  readonly pid: number | undefined;
  readonly child: ChildProcess;
}

/** The production worker runtime over the pool's IPC with fixture browser sessions; a barrier directory holds its UCPath searches (see the process). */
export function fixtureWorkerLaunch(lifetime: RuntimeLifetimeLock, barrier = "-"): WorkerCliLaunchSpec {
  return { environment: credentialKeychainTestEnvironment(process.env), command: process.execPath, cwd: process.cwd(),
    prefixArgs: Object.freeze(["--import", testProcessImport(), join(process.cwd(), "tests", "support", "processes", "fixture-pool-worker.ts"), String(lifetime.port), barrier]) };
}

/** Real worker processes (the IPC stub) spawned through the production spawner and its lifetime transfer. */
export function createDashboardChildTestWorld(releaseAdmissionFixtures: () => void, releaseAdmissionFixture: (root: string) => void) {
  const PL = WorkflowIdSchema.parse("person-lookup");
  const STUB_CLI_PATH = join(process.cwd(), "tests", "support", "processes", "worker-stub-cli.ts");
  const REPO_ROOT = process.cwd();
  const roots: string[] = [];
  const cleanups: (() => Promise<void> | void)[] = [];
  const liveRealChildren: ChildProcess[] = [];

  function required<T>(value: T | undefined, what: string): T {
    if (value === undefined) throw new Error(`the proof expected ${what} to exist`);
    return value;
  }

  let commandSequence = 0;
  function nextCommandId(): string {
    commandSequence += 1;
    const tail = String(commandSequence).padStart(4, "0");
    return `eeeeeeee-${tail}-4000-8000-${tail}00000000`;
  }

  function envelope(clock: Clock, commandId = nextCommandId()) {
    return { commandId, requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard", family: "worker-browser" } as const;
  }

  function stubLaunch(lifetime: RuntimeLifetimeLock, mode: "obey" | "ignore-stop" = "obey"): WorkerCliLaunchSpec {
    return { environment: process.env, command: process.execPath,
      prefixArgs: Object.freeze(["--import", testProcessImport(), STUB_CLI_PATH, String(lifetime.port), mode]), cwd: REPO_ROOT };
  }

  function realStubSpawner(records: RealChildRecord[], lifetime: RuntimeLifetimeLock): WorkerProcessSpawner {
    const spawn = realWorkerProcessSpawner(lifetime, createNominatimGeocodeAdapter({ clock: systemClock }));
    return request => {
      const port = spawn(request);
      const child = port.nativeProcess;
      if (child === undefined) throw new Error("the production spawner returned no native process");
      liveRealChildren.push(child);
      records.push({ argv: request.args, pid: port.pid, child });
      return port;
    };
  }

  function pidAlive(pid: number): boolean {
    try { process.kill(pid, 0); return true; }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH") return false;
      throw error;
    }
  }

  async function waitFor(predicate: () => boolean, what: string, diagnostics: () => string, timeoutMs = 20_000): Promise<void> {
    const deadline = systemClock.monotonicMs() + scaledMs(timeoutMs);
    while (!predicate()) {
      if (systemClock.monotonicMs() > deadline) throw new Error(`timed out after ${String(scaledMs(timeoutMs))}ms waiting for ${what}\n${diagnostics()}`);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }

  const cleanup = async () => {
    // Every stage runs despite failures so children are killed and roots released.
    const errors: unknown[] = [];
    for (const step of cleanups.splice(0).reverse()) { try { await step(); } catch (error) { errors.push(error); } }
    for (const child of liveRealChildren.splice(0)) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    releaseAdmissionFixtures();
    for (const root of roots.splice(0)) { try { releaseAdmissionFixture(root); rmSync(root, { recursive: true, force: true }); } catch (error) { errors.push(error); } }
    if (errors.length > 0) throw new AggregateError(errors, `afterEach cleanup failed (${String(errors.length)} error(s))`);
  };
  return { stubLaunch, PL, STUB_CLI_PATH, REPO_ROOT, required, roots, cleanups, liveRealChildren, realStubSpawner, pidAlive, waitFor, nextCommandId, envelope, cleanup };
}
