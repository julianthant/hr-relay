/**
 * The rebuild CLI's command surface. The `dashboard` command is real as of
 * 1g-spine: it starts the in-process typed BFF (projection + SSE + command
 * route) through the injected `dashboard` seam. The `worker` command is real
 * as of 1f: it runs one workflow-scoped ref execution-and-sessions §3 worker through the injected
 * `worker` seam (`src/backend/app/worker-compose.ts`).
 *
 * The seams exist because of the layer matrix, not taste: the compositions
 * that import workflow modules and the server tree sit ABOVE `core`
 * (`src/backend/app/dashboard/compose.ts` and `src/backend/app/worker-compose.ts`, the
 * same move `workflow-registry.ts` documents), so `src/cli.ts` — outside the
 * layer map — hands them in. An invocation without its seam fails loud; it
 * never pretends a runtime started.
 */
import { z } from "zod";
import type { RuntimeIsolation } from "../../config/define-runtime-isolation.js";
import { DRY_RUN_SCENARIO_USAGE } from "../../core/dry-run-scenario-runner.js";
import { TEST_DATA_USAGE } from "../../core/test-data-usage.js";
import type { WorkerLoopReport } from "../../core/worker-loop.js";

export interface RunningDashboard {
  readonly port: number;
  stop(): Promise<void>;
}

/**
 * The shutdown seam. The `dashboard` command owns a process that lives until
 * the operator stops it, so "when does it stop" is an injectable dependency
 * rather than a `process.once` buried in the branch — a test drives the exact
 * signal ordering, and production registers the real handlers.
 */
export interface RuntimeShutdownSignals {
  /** Register a handler for the shutdown signals; the returned disposer removes it. */
  subscribe(handler: (signal: "SIGINT" | "SIGTERM") => void): () => void;
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
  /** Explicit seam override for tests; production registers via `registerTestDataComposer`. */
  readonly testData?: TestDataComposer;
  /** Explicit seam override for tests; production registers the reviewed D288 command. */
  readonly activityPersonPseudonyms?: ActivityPersonPseudonymComposer;
  /** Explicit seam override for tests; production subscribes to the real process signals. */
  readonly signals?: RuntimeShutdownSignals;
  /** Publish readiness only after the dashboard owns shutdown. */
  readonly dashboardReady?: () => void;
}

export const DashboardFrontendSchema = z.enum(["vite-dev", "built-bundle"]);
export type DashboardFrontend = z.infer<typeof DashboardFrontendSchema>;
export const DashboardCommandOptionsSchema = z.strictObject({ frontend: DashboardFrontendSchema });
export type DashboardCommandOptions = z.infer<typeof DashboardCommandOptionsSchema>;
type DashboardComposer = (isolation: RuntimeIsolation, options: DashboardCommandOptions) => Promise<RunningDashboard>;

/**
 * `dashboard` takes exactly one optional flag. Anything else is refused by
 * name: `npm run dashboard:prod` passed `--prod` for weeks while `args[1]` was
 * never read, and a flag that is silently ignored is a mode that silently
 * does not exist (ref frontend-backend-integration §6.9).
 */
export function parseDashboardCommandOptions(rest: readonly string[]): DashboardCommandOptions {
  if (rest.length === 0) return Object.freeze(DashboardCommandOptionsSchema.parse({ frontend: "vite-dev" }));
  if (rest.length === 1 && rest[0] === "--prod") return Object.freeze(DashboardCommandOptionsSchema.parse({ frontend: "built-bundle" }));
  throw new Error(`dashboard accepts only \`--prod\`; unexpected argument(s): ${rest.join(" ")}`);
}
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
/** D341: `test-data check|migrate` — names, states and reasons only; never `.env`, never a value. */
type TestDataComposer = (
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

let registeredTestDataComposer: TestDataComposer | undefined;

export function registerTestDataComposer(composer: TestDataComposer): void {
  if (registeredTestDataComposer !== undefined) {
    throw new Error("a test-data composer is already registered; two compositions cannot own one runtime");
  }
  registeredTestDataComposer = composer;
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
 * `active` is now **Phase 3**, whose decimal parts finish the shared platform and
 * acceptance before Phase 4 admits later workflows (`ref workflow-model` §1.6.2).
 * It is deliberately the phase rather than a workflow id: no candidate receives
 * a Phase 4 letter until the operator approves its verified admission packet.
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
    `  dashboard [--prod]  start the in-process typed dashboard BFF (1g-spine, port ${String(isolation.backendPort)}); --prod serves the built dist/dashboard from it`,
    // Ref execution-and-sessions names no CLI subcommand for its worker (§3 names only the
    // `runWorker` loop), so `worker` is the recorded choice here.
    "  worker <workflow-id> --pool-index <positive-int> [--drain]  run one indexed browser worker (ref execution-and-sessions §3/§11)",
    `  ${DRY_RUN_SCENARIO_USAGE}  execute one manifest case through the real dry-run runtime`,
    "  explain run <traceId|runId> [--json]  explain one run from authority (ref operator-trust §2.5)",
    "  ocr forms | instruction <form> | admit <file.json> | stack <classified.json> <form>  the one extraction gate, whoever read the page (D151/D158)",
    "  storage doctor [--json]  read-only authority + span reconciliation + backup report (ref dashboard-surfaces §2.5; exit 0 = authority healthy + reconciliation healthy + protected authority readable; backup reported, not gated)",
    "  storage backup [--json]  write ONE verified authority backup + manifest — the only backup writer (D322)",
    "  storage restore --from <manifest.json> [--json]  quarantine the suspect authority and swap in ONE named verified backup (D181)",
    "  storage recover-admission --pid <owner-pid>  offline quarantine of a verified abandoned installation mutex; preserves its owner evidence",
    ...TEST_DATA_USAGE.map((line) => `  ${line}`),
  ].join("\n");
}

/**
 * The production shutdown seam: `SIGINT` (Ctrl+C) and `SIGTERM` (a supervisor
 * stopping the process).
 *
 * `on`, never `once`: a `once` listener removes itself the moment it fires, and
 * a signal with ZERO listeners falls back to Node's default disposition — so a
 * second Ctrl+C during the drain would terminate the process mid-`stop()`,
 * abandoning the authority handle and leaving the process lock at
 * `releasedAt: null`. Both listeners therefore stay subscribed until the stop
 * settles, and the disposer removes BOTH, so a returning `startRebuildRuntime`
 * leaves no listener behind for the next command or the next test in the same
 * process.
 */
function processShutdownSignals(): RuntimeShutdownSignals {
  return {
    subscribe(handler): () => void {
      const onInterrupt = (): void => {
        handler("SIGINT");
      };
      const onTerminate = (): void => {
        handler("SIGTERM");
      };
      process.on("SIGINT", onInterrupt);
      process.on("SIGTERM", onTerminate);
      return (): void => {
        process.removeListener("SIGINT", onInterrupt);
        process.removeListener("SIGTERM", onTerminate);
      };
    },
  };
}

/**
 * Own the running dashboard until the first shutdown signal, then stop it ONCE
 * and wait for that stop to finish.
 *
 * `composeDashboardRuntime`'s `stop()` is the whole shutdown ordering (ingress
 * → hub/timers → worker supervisor → database → process
 * lock), so this awaits it rather than duplicating any part of it. Two things
 * are deliberate:
 *
 *  - the listeners stay subscribed ACROSS the stop, so a second Ctrl+C during a
 *    long drain is absorbed here instead of falling through to Node's default
 *    terminate, which would abandon the database handle and the process lock;
 *  - a rejecting `stop()` propagates. A dashboard that failed to drain must
 *    never look like it exited cleanly, and this library never calls
 *    `process.exit` — the entrypoint decides what a rejection costs.
 */
async function ownDashboardUntilShutdown(
  running: RunningDashboard,
  signals: RuntimeShutdownSignals,
  ready?: () => void,
): Promise<void> {
  let requestShutdown: (() => void) | undefined;
  const shutdownRequested = new Promise<void>((resolve) => {
    requestShutdown = resolve;
  });
  const dispose = signals.subscribe(() => {
    if (requestShutdown === undefined) {
      throw new Error("a shutdown signal arrived before the dashboard registered its handler");
    }
    // Resolving twice is a no-op, so the second signal cannot start a second stop.
    requestShutdown();
  });
  try {
    ready?.();
    await shutdownRequested;
  } finally {
    try { await running.stop(); } finally { dispose(); }
  }
}

export async function startRebuildRuntime(input: RebuildRuntimeStart): Promise<void> {
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
    // Awaited, not detached: a dashboard that failed to bind must never look
    // started, and the returned promise IS this command's lifetime, so the
    // entrypoint can await a real shutdown instead of the process being torn
    // down mid-drain by the default signal disposition.
    const options = parseDashboardCommandOptions(args.slice(1));
    const running = await compose(input.isolation, options);
    write(`dashboard BFF listening on 127.0.0.1:${String(running.port)}${options.frontend === "built-bundle" ? " serving dist/dashboard" : ""}`);
    await ownDashboardUntilShutdown(running, input.signals ?? processShutdownSignals(), input.dashboardReady
      ?? (() => { process.send?.({ type: "hrauto-dashboard-ready" }); }));
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
    const outcome = await compose(input.isolation, args.slice(1));
    write(outcome.output);
    if (outcome.exitCode !== 0) process.exitCode = outcome.exitCode;
    return;
  }
  if (command === "test-data") {
    const compose = input.testData ?? registeredTestDataComposer;
    if (compose === undefined) {
      throw new Error(
        "the test-data command needs its composition seam; start it through src/cli.ts, which registers composeTestDataCommand",
      );
    }
    const outcome = await compose(input.isolation, args.slice(1));
    write(outcome.output);
    if (outcome.exitCode !== 0) process.exitCode = outcome.exitCode;
    return;
  }
  if (command === "activity-person-pseudonyms") {
    throw new Error("activity-person-pseudonyms-retired");
  }
  if (command === "worker") {
    const compose = input.worker ?? registeredWorkerComposer;
    if (compose === undefined) {
      throw new Error(
        "the worker command needs its composition seam; start it through src/cli.ts, which registers composeWorkerRuntime",
      );
    }
    const finished = await compose(input.isolation, args.slice(1));
    write(JSON.stringify({
      workerId: finished.workerId,
      workflowId: finished.workflowId,
      stopped: finished.stopped,
      outcomes: finished.outcomes.map(({ state }) => state),
    }));
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
    const outcome = await compose(input.isolation, commandArgs);
    write(outcome.output);
    if (outcome.exitCode !== 0) process.exitCode = outcome.exitCode;
    return;
  }
  throw new Error(`unknown rebuild command: ${command}`);
}
