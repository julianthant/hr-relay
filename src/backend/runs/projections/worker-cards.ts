/**
 * The Session Panel's cards — the durable worker lease, rendered (D248).
 *
 * Ref execution-and-sessions §3 says why the lease exists at all, and one of its three reasons is
 * this surface: *"the Session Panel needs worker phase without inferring it
 * from whatever rows happen to be claimed."* Until D248 the projector inferred
 * exactly that — a claimed row meant `working`, an ended worker span meant
 * `stopped`, and everything else meant `idle` — so a daemon that had started
 * and not yet reported was indistinguishable from an idle one, a worker the
 * operator had paused looked untouched, and a worker whose process DIED looked
 * exactly like one that had been asked to stop. Three of the six state arms the
 * surface drew could never arrive.
 *
 * So the card is composed here, from two sources with one direction each:
 *
 * - **the lease is authority** for identity (`workflow`), launch-time browser
 *   requirements, phase, the operator's standing directive, the started/stopped
 *   instants, the stop reason, and the version a `stop-worker` command cites;
 * - **the span fold is the observation** of what the worker is holding — the
 *   browser sessions it opened and has not closed — and of the run it claimed,
 *   which is where the queue row's trace id comes from.
 *
 * Nothing here invents the other's facts. A worker with a lease and no spans is
 * a real card (it has started and opened nothing yet); a worker with spans and
 * no lease is NOT a card, because authority is what says a worker exists.
 */
import { z } from "zod";
import type { WorkerBrowserObservation, WorkerControlRecord } from "../../../models/run/worker-control.js";
import {
  WorkerBrowserWireSchema,
  WorkerCardWireSchema,
} from "../../../models/dashboard/projection.js";
import { isLiveWorker, type WorkerLeaseRecord } from "../../../models/run/worker.js";

export type WorkerCardWire = z.infer<typeof WorkerCardWireSchema>;

/** ONE open browser session as the span fold observed it. */
export interface WorkerBrowserFold {
  readonly sessionId: string;
  readonly system: string;
  readonly openedAt: string;
}

/** What this worker's span fold knows; absent when the stream has never named it. */
interface WorkerSpanFold {
  /** Span events folded for this worker — a patch cursor, never a CAS token. */
  readonly revision: number;
  /** The run its `run.claimed` span named and no terminal span has cleared. */
  readonly currentRunId?: string;
  /** Sessions started and not yet ended, oldest first. */
  readonly browsers: readonly WorkerBrowserFold[];
}

/**
 * The state word, from the lifecycle ALONE.
 *
 * The operator's standing directive travels beside it on its own field rather
 * than being folded in, because `src/domain/run/worker.ts` says why in its own
 * header: a command records what was ASKED, the worker records what is TRUE,
 * and a card that read `Paused` while its worker was mid-transaction on a real
 * HR system would be the optimistic-authority pattern ref frontend-backend-integration §0 rejects.
 *
 * The terminal split is the one place this function adds anything: a lease that
 * settled `operator`/`shutdown` was asked to stop, and a lease that settled
 * `crashed`/`lease-expired` was not — one of those is a morning that needs
 * looking at, and drawing both as `Stopped` is what hid it.
 */
function workerCardState(lease: WorkerLeaseRecord): WorkerCardWire["state"] {
  if (lease.lifecycle.state === "stopped") {
    return lease.lifecycle.reason === "crashed" || lease.lifecycle.reason === "lease-expired"
      ? "failed"
      : "stopped";
  }
  if (lease.lifecycle.state === "busy") return "working";
  if (lease.lifecycle.state === "starting") return "starting";
  if (lease.lifecycle.state === "paused") return "paused";
  return "idle";
}

/**
 * The run this worker is on, and — when it is on none — WHY, in the server's
 * own words.
 *
 * The lease is asked first because it is authority: `busy` carries the run id
 * the worker is executing. The span fold supplies the trace id, which is the
 * thing the operator actually reads and the only id that joins this card to a
 * queue row. When the lease names a run the fold has never seen (its spans
 * pruned, or a stream this process has not tailed yet) the card says exactly
 * that instead of reporting "no claimed run" over a worker that has one.
 */
function currentRunOf(
  lease: WorkerLeaseRecord,
  fold: WorkerSpanFold | undefined,
  resolveTrace: (runId: string) => string | undefined,
): { state: "absent"; reason: string } | { state: "present"; runId: string; traceId: string } {
  const runId = lease.lifecycle.state === "busy" ? lease.lifecycle.runId : fold?.currentRunId;
  if (runId === undefined) {
    return {
      state: "absent",
      reason: isLiveWorker(lease) ? "no claimed run" : `worker ${lease.lifecycle.state}`,
    };
  }
  const traceId = resolveTrace(runId);
  if (traceId === undefined) {
    return { state: "absent", reason: `worker holds run ${runId}, whose spans this projection has not folded` };
  }
  return { state: "present", runId, traceId };
}

/**
 * ONE card. `WorkerCardWireSchema.parse` is what brands every id, so this
 * builder composes plain values throughout — the schema is the boundary, and a
 * builder holding branded ids would be claiming a parse it has not run.
 */
export function workerCardOf(input: Readonly<{
  lease: WorkerLeaseRecord;
  fold: WorkerSpanFold | undefined;
  resolveTrace: (runId: string) => string | undefined;
  observations?: readonly WorkerBrowserObservation[];
  operations?: readonly WorkerControlRecord[];
  owned?: boolean;
}>): WorkerCardWire {
  const { lease, fold } = input;
  const state = workerCardState(lease);
  const terminal = state === "stopped" || state === "failed";
  const observations = input.observations?.filter(value => value.leaseGeneration === lease.leaseGeneration);
  const operation = input.operations?.filter(value => "workerId" in value.request.target && value.request.target.workerId === lease.workerId).at(-1);
  const browsers = new Map((fold?.browsers ?? []).map(value => [value.sessionId, value]));
  for (const value of observations ?? []) {
    if (value.health === "closed") browsers.delete(value.sessionId);
    else if (value.openedAt !== undefined) browsers.set(value.sessionId, { sessionId: value.sessionId, system: value.system, openedAt: value.openedAt });
  }
  return WorkerCardWireSchema.parse({
    workerId: lease.workerId,
    workflowId: lease.workflow,
    state,
    directive: lease.control.directive,
    controls: {
      basis: lease.controlRevision === undefined ? { state: "unavailable", reason: "Worker predates control identity; start a new lifetime." } : { state: "present", value: { leaseGeneration: lease.leaseGeneration, controlRevision: lease.controlRevision } },
      ownership: input.owned === true && !terminal ? { state: "owned" } : { state: "unavailable", reason: terminal ? "Worker has stopped." : "This dashboard does not own the worker process." },
      ...(operation === undefined ? {} : { operation: { commandId: operation.commandId, type: operation.request.type, state: operation.phase.state,
        at: "completedAt" in operation.phase ? operation.phase.completedAt : "observedAt" in operation.phase ? operation.phase.observedAt : "startedAt" in operation.phase ? operation.phase.startedAt : operation.admittedAt,
        unresolved: operation.auditedAt === undefined,
        ...("browserSessionId" in operation.request.target ? { browserSessionId: operation.request.target.browserSessionId } : {}),
        ...("message" in operation.phase ? { message: operation.phase.message } : {}),
      } }),
    },
    startedAt: lease.lifecycle.startedAt,
    ...(lease.lifecycle.state === "stopped"
      ? { endedAt: lease.lifecycle.stoppedAt, stopReason: lease.lifecycle.reason }
      : {}),
    currentRun: currentRunOf(lease, fold, input.resolveTrace),
    browserRequirements: lease.browserSystems === undefined
      ? {
        state: "unavailable",
        reason: `worker ${lease.workerId} lease predates launch-time browser requirements`,
      }
      : { state: "present", systems: lease.browserSystems },
    /*
     * A settled lease holds nothing. Its process is gone and its Chromium
     * children went with it, so the sessions the fold still shows open are the
     * absence of a close event rather than a live resource — and a dead card
     * with tiles would be this panel claiming browsers nobody owns. The
     * schema refuses the pair, so this is not a presentation choice.
     */
    browsers: terminal
      ? []
      : [...browsers.values()].map((browser) => {
        const observed = observations?.find(value => value.sessionId === browser.sessionId);
        return WorkerBrowserWireSchema.parse({ ...browser, observation: observed === undefined || observed.health === "closed"
          ? { state: "unavailable", reason: "No current owner observation." }
          : { state: "present", health: observed.health, observedAt: observed.observedAt, instance: observed.instance,
            browserMode: observed.browserMode, configFingerprint: observed.configFingerprint } });
      }),
    leaseVersion: lease.version,
    // A worker whose lease exists and whose stream has never named it has
    // folded nothing; `1` is the wire's minimum revision, not a count of
    // events that happened.
    revision: fold?.revision ?? 1,
  });
}
