/**
 * The rebuild CLI's command surface. The `dashboard` command is real as of
 * 1g-spine: it starts the in-process typed BFF (projection + SSE + command
 * route) through the injected `dashboard` seam. The `worker` command is real
 * as of 1f: it runs one workflow-scoped ref execution-and-sessions §3 worker through the injected
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
import { DRY_RUN_SCENARIO_USAGE } from "./dry-run-scenario-runner.js";
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
  /** Explicit seam override for tests; production registers via `registerStorageComposer`. */
  readonly storage?: StorageComposer;
  /** Explicit seam override for tests; production registers via `registerDryRunScenarioComposer`. */
  readonly dryRunScenario?: DryRunScenarioComposer;
  /** Explicit seam override for tests; production registers the reviewed D288 command. */
  readonly activityPersonPseudonyms?: ActivityPersonPseudonymComposer;
}

type DashboardComposer = (isolation: RuntimeIsolation) => Promise<RunningDashboard>;
/**
 * Ref operator-trust §2.5's `explain` is SYNCHRONOUS on purpose: it opens authority, reads,
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
/** The worker seam speaks the loop's exact schema-backed report (ref execution-and-sessions §3). */
type WorkerComposer = (
  isolation: RuntimeIsolation,
  args: readonly string[],
) => Promise<WorkerLoopReport>;
/**
 * The `storage` seam (ref dashboard-surfaces §2.5, 2i-D). Read-only by contract — the doctor
 * reconciles strict span roots against the exact authority copy and re-verifies backups without opening
 * anything read-write — and its exit code is scriptable: 0 only when
 * authority and span/authority reconciliation are healthy AND a verified
 * current backup exists.
 */
type StorageComposer = (
  isolation: RuntimeIsolation,
  args: readonly string[],
) => Promise<{ readonly output: string; readonly exitCode: number }>;
type DryRunScenarioComposer = (
  isolation: RuntimeIsolation,
  args: readonly string[],
) => Promise<{ readonly output: string; readonly exitCode: 0 | 1 | 2 }>;
type ActivityPersonPseudonymComposer = (
  isolation: RuntimeIsolation,
  args: readonly string[],
) => { readonly output: string; readonly exitCode: 0 | 1 | 2 };

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

let registeredStorageComposer: StorageComposer | undefined;

export function registerStorageComposer(composer: StorageComposer): void {
  if (registeredStorageComposer !== undefined) {
    throw new Error("a storage composer is already registered; two compositions cannot own one runtime");
  }
  registeredStorageComposer = composer;
}

let registeredDryRunScenarioComposer: DryRunScenarioComposer | undefined;

export function registerDryRunScenarioComposer(composer: DryRunScenarioComposer): void {
  if (registeredDryRunScenarioComposer !== undefined) {
    throw new Error("a dry-run scenario composer is already registered; two compositions cannot own one runtime");
  }
  registeredDryRunScenarioComposer = composer;
}

let registeredActivityPersonPseudonymComposer: ActivityPersonPseudonymComposer | undefined;

export function registerActivityPersonPseudonymComposer(
  composer: ActivityPersonPseudonymComposer,
): void {
  if (registeredActivityPersonPseudonymComposer !== undefined) {
    throw new Error(
      "an activity person pseudonym composer is already registered; two compositions cannot own one runtime",
    );
  }
  registeredActivityPersonPseudonymComposer = composer;
}

/**
 * The runtime's own phase status, in the phase docs' identifiers.
 *
 * `completedThrough` is the LAST completed work item of the phase docs' ordered
 * sequence, not the phase letter. Phase 1 closed with `1i-spine` (D74, live
 * person-lookup, 2026-08-04); Phase 2's controlled transaction proof was met
 * live the same day (D135, doc 4489); tail `2g` completed 2026-08-04
 * (D134–D145), tail `2h` — the data-service/intake foundation, the largest
 * tail — completed 2026-08-08 (D146–D167), tail `2i` — the operator surface —
 * completed 2026-08-09 (D168–D180), and tail `2j` — the integration/restore/
 * soak/documentation gate — closed Phase 2 the same day (D181–D189).
 *
 * `active` is now **Phase 3**, the per-workflow migration loop (doc 03c §Phase summary),
 * and it is deliberately the phase rather than a workflow id: doc 03c §Recommended migration order
 * orders the migrations but the operator picks which one starts, so naming one
 * here would be this file asserting a decision it does not own.
 *
 * Two criteria left Phase 2 with an explicit disposition rather than a build,
 * and both are recorded where a reader will find them: the explorer's EDIT
 * half (D186, ref operator-trust §5.3 — reassigned with a named trigger) and the BFF's
 * missing static handler (D189, ref frontend-backend-integration §6.9 — a named gap with an owner).
 */
const COMPLETED_THROUGH = "2j";
const ACTIVE_ITEM = "3-workflow-migration";

export function runtimeHelp(isolation: RuntimeIsolation): string {
  return [
    `HR Automation rebuild foundation (complete through ${COMPLETED_THROUGH}; active ${ACTIVE_ITEM})`,
    "Commands:",
    "  help       show this contract surface",
    "  phase      print the active isolated runtime resources",
    `  dashboard  start the in-process typed dashboard BFF (1g-spine, port ${String(isolation.backendPort)})`,
    // Ref execution-and-sessions names no CLI subcommand for its worker (§3 names only the
    // `runWorker` loop), so `worker` is the recorded choice here.
    "  worker <workflow-id> --pool-index <positive-int> [--drain]  run one indexed browser worker (ref execution-and-sessions §3/§11)",
    `  ${DRY_RUN_SCENARIO_USAGE}  execute one manifest case through the real dry-run runtime`,
    "  explain run <traceId|runId> [--json]  explain one run from authority (ref operator-trust §2.5)",
    "  activity-person-pseudonyms backfill [--run <run-id> ...] [--json]  derive D288 evidence from reviewed current Separations results",
    "  ocr forms | instruction <form> | admit <file.json> | stack <classified.json> <form>  the one extraction gate, whoever read the page (D151/D158)",
    "  storage doctor [--json]  read-only authority + span reconciliation + backup report (ref dashboard-surfaces §2.5; exit 0 = authority healthy + reconciliation healthy + current backup)",
    "  storage restore --from <manifest.json> [--json]  quarantine the suspect authority and swap in ONE named verified backup (D181)",
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
  if (command === "storage") {
    const compose = input.storage ?? registeredStorageComposer;
    if (compose === undefined) {
      throw new Error(
        "the storage command needs its composition seam; start it through src/cli.ts, which registers composeStorageCommand",
      );
    }
    compose(input.isolation, args.slice(1))
      .then((outcome) => {
        write(outcome.output);
        // A degraded store must not look healthy to a caller that only
        // checks the exit status.
        if (outcome.exitCode !== 0) process.exitCode = outcome.exitCode;
      })
      .catch((error: unknown) => {
        throw error instanceof Error ? error : new Error(String(error));
      });
    return;
  }
  if (command === "activity-person-pseudonyms") {
    const compose = input.activityPersonPseudonyms ?? registeredActivityPersonPseudonymComposer;
    if (compose === undefined) {
      throw new Error(
        "the activity-person-pseudonyms command needs its composition seam; start it through src/cli.ts",
      );
    }
    const outcome = compose(input.isolation, args.slice(1));
    write(outcome.output);
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
  if (command === "dry-run-scenario") {
    const commandArgs = args.slice(1);
    if (commandArgs.length === 1 && (commandArgs[0] === "help"
      || commandArgs[0] === "--help" || commandArgs[0] === "-h")) {
      write(`usage: ${DRY_RUN_SCENARIO_USAGE}`);
      return;
    }
    const compose = input.dryRunScenario ?? registeredDryRunScenarioComposer;
    if (compose === undefined) {
      throw new Error(
        "the dry-run-scenario command needs its composition seam; start it through src/cli.ts, which registers composeDryRunScenarioCommand",
      );
    }
    compose(input.isolation, commandArgs)
      .then((outcome) => {
        write(outcome.output);
        if (outcome.exitCode !== 0) process.exitCode = outcome.exitCode;
      })
      .catch((error: unknown) => {
        throw error instanceof Error ? error : new Error(String(error));
      });
    return;
  }
  throw new Error(`unknown rebuild command: ${command}`);
}
