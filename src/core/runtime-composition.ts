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
  /** Explicit seam override for tests; production registers via `registerExplainComposer`. */
  readonly explain?: ExplainComposer;
  /** Explicit seam override for tests; production registers via `registerOcrComposer`. */
  readonly ocr?: OcrComposer;
}

type DashboardComposer = (isolation: RuntimeIsolation) => Promise<RunningDashboard>;
/**
 * Doc 12 §2.5's `explain` is SYNCHRONOUS on purpose: it opens authority, reads,
 * derives, closes, and returns the text. A promise here would let the process
 * exit before the database closed.
 */
type ExplainComposer = (isolation: RuntimeIsolation, args: readonly string[]) => string;
/**
 * The `ocr` seam (D151). It takes no isolation because admission is PURE: the
 * gate reads a submission and applies the form registry, touching no authority
 * and no runtime state. Its exit code distinguishes refusal from success so a
 * terminal agent's tooling need not parse prose.
 */
type OcrComposer = (args: readonly string[]) => { readonly output: string; readonly exitCode: number };
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

let registeredOcrComposer: OcrComposer | undefined;

export function registerOcrComposer(composer: OcrComposer): void {
  if (registeredOcrComposer !== undefined) {
    throw new Error("an ocr composer is already registered; two compositions cannot own one runtime");
  }
  registeredOcrComposer = composer;
}

let registeredWorkerComposer: WorkerComposer | undefined;

export function registerWorkerComposer(composer: WorkerComposer): void {
  if (registeredWorkerComposer !== undefined) {
    throw new Error("a worker composer is already registered; two compositions cannot own one runtime");
  }
  registeredWorkerComposer = composer;
}

let registeredExplainComposer: ExplainComposer | undefined;

export function registerExplainComposer(composer: ExplainComposer): void {
  if (registeredExplainComposer !== undefined) {
    throw new Error("an explain composer is already registered; two compositions cannot own one runtime");
  }
  registeredExplainComposer = composer;
}

/**
 * The runtime's own phase status, in doc 07's identifiers.
 *
 * `completedThrough` is the LAST completed work item of doc 07's ordered
 * sequence, not the phase letter. Phase 1 closed with `1i-spine` (D74, live
 * person-lookup, 2026-08-04); Phase 2's controlled transaction proof was met
 * live the same day (D135, doc 4489); tail `2g` completed 2026-08-04
 * (D134–D145), and tail `2h` — the data-service/intake foundation, the
 * largest tail — completed 2026-08-08 (D146–D167). `active` is tail `2i`,
 * the operator surface (doc 07 §Phase 2's deferred-base-tails table).
 */
const COMPLETED_THROUGH = "2h";
const ACTIVE_ITEM = "2i";

export function runtimeHelp(isolation: RuntimeIsolation): string {
  return [
    `HR Automation rebuild foundation (complete through ${COMPLETED_THROUGH}; active ${ACTIVE_ITEM})`,
    "Commands:",
    "  help       show this contract surface",
    "  phase      print the active isolated runtime resources",
    `  dashboard  start the in-process typed dashboard BFF (1g-spine, port ${String(isolation.backendPort)})`,
    // Doc 05 names no CLI subcommand for its worker (§3 names only the
    // `runWorker` loop), so `worker` is the recorded choice here.
    "  worker <workflow-id> [--drain]  run one workflow-scoped browser worker (doc 05 §3)",
    "  explain run <traceId|runId> [--json]  explain one run from authority (doc 12 §2.5)",
    "  ocr forms | instruction <form> | admit <file.json> | stack <classified.json> <form>  the one extraction gate, whoever read the page (D151/D158)",
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
  if (command === "explain") {
    const compose = input.explain ?? registeredExplainComposer;
    if (compose === undefined) {
      throw new Error(
        "the explain command needs its composition seam; start it through src/cli.ts, which registers composeExplainRuntime",
      );
    }
    write(compose(input.isolation, args.slice(1)));
    return;
  }
  if (command === "ocr") {
    const compose = input.ocr ?? registeredOcrComposer;
    if (compose === undefined) {
      throw new Error(
        "the ocr command needs its composition seam; start it through src/cli.ts, which registers composeOcrCommand",
      );
    }
    const outcome = compose(args.slice(1));
    write(outcome.output);
    // A refused submission must not look accepted to a caller that only checks
    // the exit status — which is exactly how another agent's tooling checks.
    if (outcome.exitCode !== 0) process.exitCode = outcome.exitCode;
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
