import { z } from "zod";
import { WorkerBrowserWireSchema, WorkerCardWireSchema } from "../../../models/dashboard/projection.js";
import type { RunRecord } from "../../../models/run/record.js";
import { workerPoolMember, type WorkerSlotRecord } from "../../../models/run/worker-slot.js";
import type { WorkerMemberView } from "../../runtime/workers/worker-pool.js";

export type WorkerCardWire = z.infer<typeof WorkerCardWireSchema>;

/** ONE open browser session as the span fold observed it. */
export interface WorkerBrowserFold {
  readonly sessionId: string;
  readonly system: string;
  readonly openedAt: string;
}

function workerCardState(view: WorkerMemberView): WorkerCardWire["state"] {
  if (view.state === "exited") return "failed";
  if (view.state === "starting") return "starting";
  switch (view.activity?.state) {
    case "busy": return "running";
    case "waiting": return "waiting";
    case "paused": return "paused";
    case "idle":
    case undefined: return "idle";
  }
}

/** A card is the pool's in-memory member joined with its durable slot; the fence it serves is the member's lifetime and version. */
export function workerCardOf(input: Readonly<{
  slot: WorkerSlotRecord;
  view: WorkerMemberView;
  /** Span events folded for this worker; a patch cursor, never a CAS token. */
  foldRevision: number;
  resolveRun: (runId: string) => RunRecord | undefined;
}>): WorkerCardWire {
  const { slot, view } = input;
  if (slot.retiredAt !== null || view.member.workerId !== slot.workerId || view.member.workflowId !== slot.workflow) throw new Error("worker-member-authority-unavailable");
  const runId = view.activity?.runId, run = runId === undefined ? undefined : input.resolveRun(runId);
  const exit = view.state === "exited" ? view.exit : undefined;
  return WorkerCardWireSchema.parse({
    member: workerPoolMember(slot),
    workerId: slot.workerId,
    workflowId: slot.workflow,
    state: workerCardState(view),
    directive: slot.paused ? "pause" : "run",
    controls: { basis: { state: "present", value: { lifetimeId: view.lifetimeId, version: view.version } } },
    startedAt: view.startedAt,
    ...(view.state === "exited"
      ? { endedAt: exit?.at ?? view.startedAt, stopReason: exit?.outcome === "stopped" ? "operator" : "crashed" }
      : {}),
    currentRun: run === undefined || !("workerId" in run.lifecycle) || run.lifecycle.workerId !== slot.workerId
      ? { state: "absent", reason: "no current claimed run" }
      : { state: "present", runId: run.envelope.runId, traceId: run.envelope.traceId },
    browsers: view.state === "exited" ? [] : view.browsers.filter(browser => browser.health !== "closed").map(browser => WorkerBrowserWireSchema.parse({
      sessionId: browser.sessionId, system: browser.system, openedAt: browser.openedAt,
      observation: { state: "present", health: browser.health, observedAt: browser.observedAt, instance: browser.instance,
        browserMode: browser.browserMode, configFingerprint: browser.configFingerprint } })),
    revision: input.foldRevision + view.version + 1,
  });
}
