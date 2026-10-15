
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { z } from "zod";
import type { WorkerBrowserObservation, WorkerControlRecord } from "../../../models/run/worker-control.js";
import {
  WorkerBrowserWireSchema,
  WorkerCardWireSchema,
} from "../../../models/dashboard/projection.js";
import type { RunRecord } from "../../../models/run/record.js";
import { workerPoolMember, type WorkerSlotRecord } from "../../../models/run/worker-slot.js";
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
  switch (lease.lifecycle.state) {
    case "stopped": return "failed";
    case "busy": return "running";
    case "waiting": return "waiting";
    case "starting": return "starting";
    case "paused": return "paused";
    case "idle": return "idle";
    case "stopping": throw new Error("worker-current-phase-unavailable");
  }
}

function currentRunOf(lease: WorkerLeaseRecord, member: WorkerSlotRecord,
  resolveRun: (runId: string) => RunRecord | undefined): WorkerCardWire["currentRun"] {
  const runId = "runId" in lease.lifecycle ? lease.lifecycle.runId : undefined;
  if (runId === undefined) return { state: "absent", reason: "no current claimed run" };
  const run = resolveRun(runId);
  if (run === undefined || run.envelope.runId !== runId || !("workerId" in run.lifecycle) || run.lifecycle.workerId !== lease.workerId
    || run.envelope.workflow !== lease.workflow || run.lifecycle.workerLifetime?.leaseGeneration !== lease.leaseGeneration
    || run.lifecycle.workerLifetime.membershipRevision !== member.membershipRevision) throw new Error("worker-current-run-authority-unavailable");
  return { state: "present", runId, traceId: run.envelope.traceId };
}

export function workerCardOf(input: Readonly<{
  lease: WorkerLeaseRecord;
  member: WorkerSlotRecord;
  ownerAlive: boolean;
  fold: WorkerSpanFold | undefined;
  resolveRun: (runId: string) => RunRecord | undefined;
  observations?: readonly WorkerBrowserObservation[];
  operations?: readonly WorkerControlRecord[];
  owned?: boolean;
}>): WorkerCardWire {
  const { lease, fold, member } = input;
  if (member.retiredAt !== null || member.workerId !== lease.workerId || member.workflow !== lease.workflow) throw new Error("worker-member-authority-unavailable");
  if (isLiveWorker(lease) && !input.ownerAlive) throw new Error("worker-current-owner-unavailable");
  const state = workerCardState(lease);
  const terminal = state === "failed";
  const observations = input.observations?.filter(value => value.leaseGeneration === lease.leaseGeneration);
  if (!terminal && observations?.some(value => value.health === "failed")) throw new Error("worker-browser-closure-or-health-unavailable");
  const operation = input.operations?.filter(value => {
    const binding = value.reset ?? value.lifecycle;
    if (binding !== undefined) {
      if (binding.member.workerId !== lease.workerId || binding.member.membershipRevision !== member.membershipRevision) return false;
      if (binding.lifetime.leaseGeneration === lease.leaseGeneration) return true;
      return value.phase.state === "succeeded" && (value.phase.acknowledgement.kind === "retry" || value.phase.acknowledgement.kind === "reset-replacement")
        && value.phase.acknowledgement.leaseGeneration === lease.leaseGeneration
        && (value.phase.acknowledgement.kind === "reset-replacement" || value.phase.acknowledgement.processId === lease.processId
          && value.phase.acknowledgement.startedAt === lease.lifecycle.startedAt);
    }
    return value.control !== undefined && canonicalJsonStringify(value.control.member) === canonicalJsonStringify(workerPoolMember(member))
      && value.control.lifetime.leaseGeneration === lease.leaseGeneration && value.control.lifetime.processId === lease.processId
      && value.control.lifetime.startedAt === lease.lifecycle.startedAt;
  }).at(-1);
  const browsers = new Map<string, WorkerBrowserFold>();
  for (const value of observations ?? []) {
    if (value.health === "closed") browsers.delete(value.sessionId);
    else if (value.openedAt !== undefined) browsers.set(value.sessionId, { sessionId: value.sessionId, system: value.system, openedAt: value.openedAt });
  }
  return WorkerCardWireSchema.parse({
    member: workerPoolMember(member),
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
    currentRun: currentRunOf(lease, member, input.resolveRun),
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
