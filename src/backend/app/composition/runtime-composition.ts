
import { z } from "zod";
import { DashboardStopSchema } from "../../../models/runtime/dashboard-control.js";
import type { RuntimeIsolation } from "../../../models/config/define-runtime-isolation.js";
import { TEST_DATA_USAGE } from "../../runs/provenance/test-data-usage.js";
import type { WorkerLoopReport } from "../../runtime/workers/worker-loop.js";

/** Raised only after the store, admission and backup have completed shutdown. */
export class DashboardShutdownCompletedWithErrors extends AggregateError {}

export interface RunningDashboard {
  readonly shutdownRequested?: Promise<void>;
  readonly port: number;
  readonly failure?: Promise<never>;
  stop(): Promise<void>;
}


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
  /** Explicit seam override for tests; production registers via `registerTestDataComposer`. */
  readonly testData?: TestDataComposer;
  /** Explicit seam override for tests; production registers via `registerDashboardStopSignal`. */
  readonly stopSignal?: AbortSignal;

  /** Explicit seam override for tests; production subscribes to the real process signals. */
  readonly signals?: RuntimeShutdownSignals;
  /** Publish readiness only after the dashboard owns shutdown. */
  readonly dashboardReady?: () => void | Promise<void>;
}

export const DashboardFrontendSchema = z.enum(["vite-dev", "built-bundle"]);
export const DashboardCommandOptionsSchema = z.strictObject({ frontend: DashboardFrontendSchema });
export type DashboardCommandOptions = z.infer<typeof DashboardCommandOptionsSchema>;
type DashboardComposer = (isolation: RuntimeIsolation, options: DashboardCommandOptions) => Promise<RunningDashboard>;


export function parseDashboardCommandOptions(rest: readonly string[]): DashboardCommandOptions {
  if (rest.length === 0) return Object.freeze(DashboardCommandOptionsSchema.parse({ frontend: "vite-dev" }));
  if (rest.length === 1 && rest[0] === "--prod") return Object.freeze(DashboardCommandOptionsSchema.parse({ frontend: "built-bundle" }));
  throw new Error(`dashboard accepts only \`--prod\`; unexpected argument(s): ${rest.join(" ")}`);
}
// Synchronous explain owns open, read and close; returning early would abandon the authority handle.
type ExplainComposer = (isolation: RuntimeIsolation, args: readonly string[]) => string;

type OcrComposer = (args: readonly string[]) => { readonly output: string; readonly exitCode: number };
/** The worker seam speaks the loop's exact schema-backed report (ref execution-and-sessions ). */
type WorkerComposer = (
  isolation: RuntimeIsolation,
  args: readonly string[],
) => Promise<WorkerLoopReport>;

type StorageComposer = (
  isolation: RuntimeIsolation,
  args: readonly string[],
) => Promise<{ readonly output: string; readonly exitCode: number }>;
type TestDataComposer = (
  isolation: RuntimeIsolation,
  args: readonly string[],
) => Promise<{ readonly output: string; readonly exitCode: 0 | 1 | 2 }>;
// Register separately to preserve the operational-isolation audit's exact runtime-start call.
let registeredDashboardComposer: DashboardComposer | undefined;

export function registerDashboardComposer(composer: DashboardComposer): void {
  if (registeredDashboardComposer !== undefined) {
    throw new Error("a dashboard composer is already registered; two compositions cannot own one runtime");
  }
  registeredDashboardComposer = composer;
}

// A stop the secure bootstrap latched while the dashboard booted; the default shutdown signals honour it.
let registeredDashboardStopSignal: AbortSignal | undefined;

export function registerDashboardStopSignal(signal: AbortSignal): void {
  registeredDashboardStopSignal = signal;
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

let registeredTestDataComposer: TestDataComposer | undefined;

export function registerTestDataComposer(composer: TestDataComposer): void {
  if (registeredTestDataComposer !== undefined) {
    throw new Error("a test-data composer is already registered; two compositions cannot own one runtime");
  }
  registeredTestDataComposer = composer;
}

// completedThrough names the last completed ordered work item; active names the current admission stage.
const COMPLETED_THROUGH = "2j";
const ACTIVE_ITEM = "3-workflow-migration";

function runtimeHelp(isolation: RuntimeIsolation): string {
  return [
    `Relay foundation (complete through ${COMPLETED_THROUGH}; active ${ACTIVE_ITEM})`,
    "Commands:",
    "  help       show this contract surface",
    "  phase      print the active isolated runtime resources",
    `  dashboard [--prod]  start the in-process typed dashboard BFF (1g-spine, port ${String(isolation.backendPort)}); --prod serves the built dist/dashboard from it`,
    // Ref execution-and-sessions names no CLI subcommand for its worker (§3 names only the
    // `runWorker` loop), so `worker` is the recorded choice here.
    "  worker <workflow-id> --pool-index <positive-int> [--drain]  run one indexed browser worker (ref execution-and-sessions §3/§11)",
    "  explain run <traceId|runId> [--json]  explain one run from authority (ref operator-trust §2.5)",
    "  explain diagnostics [--after <cursor>] [--through <cursor>] [--limit <1..1000>] [--run <runId>] [--json]  read one persisted debug page",
    "  explain diagnostics --boot [--json]  inspect the stopped boot fault spool without opening the database",
    "  ocr forms | instruction <form> | admit <file.json> | stack <classified.json> <form>  the one extraction gate, whoever read the page",
    "  storage doctor [--json]  read-only authority + span reconciliation + backup report (ref dashboard-surfaces; exit 0 = authority healthy + reconciliation healthy + protected authority readable; backup reported, not gated)",
    ...TEST_DATA_USAGE.map((line) => `  ${line}`),
  ].join("\n");
}


function processShutdownSignals(stopSignal: AbortSignal | undefined): RuntimeShutdownSignals {
  return {
    subscribe(handler): () => void {
      const onInterrupt = (): void => {
        handler("SIGINT");
      };
      const onTerminate = (): void => {
        handler("SIGTERM");
      };
      const onMessage = (message: unknown): void => {
        if (DashboardStopSchema.safeParse(message).success) onTerminate();
      };
      process.on("SIGINT", onInterrupt);
      process.on("SIGTERM", onTerminate);
      process.on("message", onMessage);
      process.on("disconnect", onTerminate);
      stopSignal?.addEventListener("abort", onTerminate);
      if (process.send !== undefined && !process.connected || stopSignal?.aborted === true) onTerminate();
      return (): void => {
        stopSignal?.removeEventListener("abort", onTerminate);
        process.removeListener("SIGINT", onInterrupt);
        process.removeListener("SIGTERM", onTerminate);
        process.removeListener("message", onMessage);
        process.removeListener("disconnect", onTerminate);
      };
    },
  };
}


async function ownDashboardUntilShutdown(
  compose: () => Promise<RunningDashboard>,
  signals: RuntimeShutdownSignals,
  started: (running: RunningDashboard) => () => void | Promise<void>,
): Promise<void> {
  let stopRequested = false;
  let resolveShutdown!: () => void;
  const shutdownRequested = new Promise<void>((resolve) => { resolveShutdown = resolve; });
  // Owned before composition so a stop during startup is latched instead of killing open owners.
  const dispose = signals.subscribe(() => { stopRequested = true; resolveShutdown(); });
  const failures: unknown[] = [];
  let running: RunningDashboard | undefined;
  try {
    if (!stopRequested) {
      running = await compose();
      const ready = started(running);
      const stopped = Promise.race([shutdownRequested, ...(running.shutdownRequested === undefined ? [] : [running.shutdownRequested]), ...(running.failure === undefined ? [] : [running.failure])]);
      // A stop never waits for readiness publication; a readiness failure after the stop has nothing left to report to.
      if (!stopRequested) await Promise.race([Promise.resolve().then(ready), stopped]);
      await stopped;
    }
  } catch (error) { failures.push(error); }
  if (running !== undefined) {
    try { await running.stop(); }
    catch (error) {
      if (error instanceof DashboardShutdownCompletedWithErrors) process.exitCode = 1;
      else if (!failures.includes(error)) failures.push(error);
    }
  }
  try { dispose(); } catch (error) { if (!failures.includes(error)) failures.push(error); }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "dashboard lifetime and closure failed", { cause: failures[0] });
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

    const options = parseDashboardCommandOptions(args.slice(1));
    await ownDashboardUntilShutdown(
      () => compose(input.isolation, options),
      input.signals ?? processShutdownSignals(input.stopSignal ?? registeredDashboardStopSignal),
      (running) => {
        write(`dashboard BFF listening on 127.0.0.1:${String(running.port)}${options.frontend === "built-bundle" ? " serving dist/dashboard" : ""}`);
        return input.dashboardReady ?? (() => new Promise<void>((resolve, reject) => {
          const send = process.send?.bind(process);
          if (send === undefined || !process.connected) { resolve(); return; }
          send({ type: "hrauto-dashboard-ready" }, (error: Error | null) => { if (error) reject(error); else resolve(); });
        }));
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
    let output: string;
    try {
      output = compose(input.isolation, args.slice(1));
    } catch (error) {
      if (args[1] !== "run" || !(error instanceof z.ZodError)) throw error;
      const issues = error.issues.map(issue => `${JSON.stringify(issue.path.map(String))} (${issue.code})`);
      process.stderr.write(`explain run: invalid data at ${issues.join(", ")}\n`);
      process.exitCode = 1;
      return;
    }
    write(output);
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
      closure: finished.closure,
      outcomes: finished.outcomes.map(({ state }) => state),
    }));
    return;
  }
  throw new Error(`unknown rebuild command: ${command}`);
}
