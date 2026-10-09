
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
    // A settled lease owns no live browser; open span evidence does not prove a surviving process.
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
    // Revision 1 is the wire minimum when a lease has emitted no stream event.
    revision: fold?.revision ?? 1,
  });
}
