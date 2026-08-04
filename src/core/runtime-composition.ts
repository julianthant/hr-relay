/**
 * The rebuild CLI's command surface. The `dashboard` command is real as of
 * 1g-spine: it starts the in-process typed BFF (projection + SSE + command
 * route) through the injected `dashboard` seam. The `worker` command is real
 * as of 1f: it runs one workflow-scoped doc 05 §3 worker through the injected
 * `worker` seam (`src/server/worker/compose.ts`).
 *
 * The seams exist because of the layer matrix, not taste: the compositions
 * that import workflow modules and the server tree sit ABOVE `core`
 * (`src/server/dashboard/compose.ts` and `src/server/worker/compose.ts`, the
 * same move `workflow-registry.ts` documents), so `src/cli.ts` — outside the
 * layer map — hands them in. An invocation without its seam fails loud; it
 * never pretends a runtime started.
 */
import type { RuntimeIsolation } from "../config/define-runtime-isolation.js";
import type { WorkerLoopReport } from "./worker-loop.js";

export interface RunningDashboard {
  readonly port: number;
  stop(): Promise<void>;
}

export interface RebuildRuntimeStart {
  readonly isolation: RuntimeIsolation;
  readonly args?: readonly string[];
  readonly write?: (message: string) => void;
  /** Explicit seam override for tests; production registers via `registerDashboardComposer`. */
  readonly dashboard?: DashboardComposer;
  /** Explicit seam override for tests; production registers via `registerWorkerComposer`. */
  readonly worker?: WorkerComposer;
}

type DashboardComposer = (isolation: RuntimeIsolation) => Promise<RunningDashboard>;
/** The worker seam speaks the loop's exact schema-backed report (doc 05 §3). */
type WorkerComposer = (
  isolation: RuntimeIsolation,
  args: readonly string[],
) => Promise<WorkerLoopReport>;

/**
 * The production injection door. The operational-isolation audit pins
 * `src/cli.ts` to ONE exact `startRebuildRuntime({ isolation:
 * rebuildRuntimeIsolation })` call, so the dashboard composition registers
 * itself in a separate statement instead of riding that call.
 */
let registeredDashboardComposer: DashboardComposer | undefined;

export function registerDashboardComposer(composer: DashboardComposer): void {
  if (registeredDashboardComposer !== undefined) {
    throw new Error("a dashboard composer is already registered; two compositions cannot own one runtime");
  }
  registeredDashboardComposer = composer;
}

let registeredWorkerComposer: WorkerComposer | undefined;

export function registerWorkerComposer(composer: WorkerComposer): void {
  if (registeredWorkerComposer !== undefined) {
    throw new Error("a worker composer is already registered; two compositions cannot own one runtime");
  }
  registeredWorkerComposer = composer;
}

/**
 * The runtime's own phase status, in doc 07's identifiers.
 *
 * `completedThrough` is the LAST completed work item of §3's ordered table, not
 * the phase letter — `1i-spine` is the final Phase-1 item, and Phase 1's exit
 * test (D74, live person-lookup) passed on 2026-08-04. `active` names Phase 2's
 * first work item, the controlled transaction proof (§Phase 2, mermaid node
 * `TX`), which precedes the 2g/2h/2i/2j tails.
 */
const COMPLETED_THROUGH = "1i-spine";
const ACTIVE_ITEM = "2-transaction-proof";

export function runtimeHelp(isolation: RuntimeIsolation): string {
  return [
    `HR Automation rebuild foundation (Phase 1 COMPLETE through ${COMPLETED_THROUGH}; active ${ACTIVE_ITEM})`,
    "Commands:",
    "  help       show this contract surface",
    "  phase      print the active isolated runtime resources",
    `  dashboard  start the in-process typed dashboard BFF (1g-spine, port ${String(isolation.backendPort)})`,
    // Doc 05 names no CLI subcommand for its worker (§3 names only the
    // `runWorker` loop), so `worker` is the recorded choice here.
    "  worker <workflow-id> [--drain]  run one workflow-scoped browser worker (doc 05 §3)",
  ].join("\n");
}

export function startRebuildRuntime(input: RebuildRuntimeStart): void {
  const args = input.args ?? process.argv.slice(2);
  const write = input.write ?? ((message: string): void => {
    process.stdout.write(`${message}\n`);
  });
  const command = args[0] ?? "help";
  if (command === "help" || command === "--help" || command === "-h") {
    write(runtimeHelp(input.isolation));
    return;
  }
  if (command === "phase") {
    write(JSON.stringify({
      completedThrough: COMPLETED_THROUGH,
      active: ACTIVE_ITEM,
      stateRoot: input.isolation.stateRoot,
      artifactRoot: input.isolation.artifactRoot,
      backendPort: input.isolation.backendPort,
      frontendPort: input.isolation.frontendPort,
      browserSessionNamespace: input.isolation.browserSessionNamespace,
    }));
    return;
  }
  if (command === "dashboard") {
    const compose = input.dashboard ?? registeredDashboardComposer;
    if (compose === undefined) {
      throw new Error(
        "the dashboard command needs its composition seam; start it through src/cli.ts, which registers composeDashboardRuntime",
      );
    }
    compose(input.isolation)
      .then((running) => {
        write(`dashboard BFF listening on 127.0.0.1:${String(running.port)}`);
      })
      .catch((error: unknown) => {
        // Re-throwing out of the promise chain crashes the process loudly —
        // a dashboard that failed to bind must never look started.
        throw error instanceof Error ? error : new Error(String(error));
      });
    return;
  }
  if (command === "worker") {
    const compose = input.worker ?? registeredWorkerComposer;
    if (compose === undefined) {
      throw new Error(
        "the worker command needs its composition seam; start it through src/cli.ts, which registers composeWorkerRuntime",
      );
    }
    compose(input.isolation, args.slice(1))
      .then((finished) => {
        write(JSON.stringify({
          workerId: finished.workerId,
          workflowId: finished.workflowId,
          stopped: finished.stopped,
          outcomes: finished.outcomes.map(({ state }) => state),
        }));
      })
      .catch((error: unknown) => {
        // A worker that failed to run must never look finished.
        throw error instanceof Error ? error : new Error(String(error));
      });
    return;
  }
  throw new Error(`unknown rebuild command: ${command}`);
}
