/**
 * The durable worker lease — ref execution-and-sessions §3's claim protocol, made addressable.
 *
 * A worker is a long-lived process assigned to ONE workflow that owns at most
 * one active run. The lease exists for three reasons a run row cannot serve:
 * `stop-worker` / `pause-worker` need a durable target with a version; dead
 * worker recovery needs a heartbeat that survives the process; and the Session
 * Panel needs worker phase without inferring it from whatever rows happen to be
 * claimed.
 *
 * **`control` and `lifecycle` are deliberately separate.** A command writes the
 * operator's directive; the worker writes what is actually true. Pausing a busy
 * worker means "finish the active run, then stop claiming" — collapsing both
 * into one field would let a command record a state the worker has not reached,
 * which is precisely the optimistic-authority pattern ref frontend-backend-integration §0 rejects.
 *
 * There is no lane, capacity, or budget field here, and the guard in ref execution-and-sessions §7
 * rejects one: parallelism is worker count and nothing else.
 */
import { z } from "zod";
import {
  ActorIdSchema,
  IsoInstantSchema,
  PositiveIntSchema,
  RunIdSchema,
  WorkerIdSchema,
  WorkflowIdSchema,
} from "../ids.js";

/** What the operator has asked this worker to do; only commands write it. */
export const WorkerDirectiveSchema = z.enum(["run", "pause", "stop"]);
export type WorkerDirective = z.infer<typeof WorkerDirectiveSchema>;

export const WorkerControlSchema = z.strictObject({
  directive: WorkerDirectiveSchema,
  requestedAt: IsoInstantSchema,
  requestedBy: ActorIdSchema,
  reason: z.string().min(1).optional(),
});
export type WorkerControl = z.infer<typeof WorkerControlSchema>;

/** Why a worker lease ended. `crashed` and `lease-expired` are written by the recovery sweep. */
export const WorkerStopReasonSchema = z.enum(["operator", "shutdown", "lease-expired", "crashed"]);
export type WorkerStopReason = z.infer<typeof WorkerStopReasonSchema>;

const LiveFields = {
  startedAt: IsoInstantSchema,
  heartbeatAt: IsoInstantSchema,
} as const;

export const WorkerLifecycleSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("starting"), startedAt: IsoInstantSchema }),
  z.strictObject({ state: z.literal("idle"), ...LiveFields }),
  z.strictObject({ state: z.literal("busy"), ...LiveFields, runId: RunIdSchema }),
  z.strictObject({ state: z.literal("paused"), ...LiveFields, pausedAt: IsoInstantSchema }),
  z.strictObject({ state: z.literal("stopping"), ...LiveFields }),
  z.strictObject({
    state: z.literal("stopped"),
    startedAt: IsoInstantSchema,
    stoppedAt: IsoInstantSchema,
    reason: WorkerStopReasonSchema,
  }),
]);
export type WorkerLifecycle = z.infer<typeof WorkerLifecycleSchema>;

export const LIVE_WORKER_STATES = Object.freeze(["starting", "idle", "busy", "paused", "stopping"] as const);

export const WorkerLeaseRecordSchema = z.strictObject({
  workerId: WorkerIdSchema,
  /** A worker claims only its own workflow's rows (ref execution-and-sessions §3.1). */
  workflow: WorkflowIdSchema,
  processId: PositiveIntSchema,
  /** Bumped every time this worker id is (re)started; fences a zombie process. */
  leaseGeneration: PositiveIntSchema,
  lifecycle: WorkerLifecycleSchema,
  control: WorkerControlSchema,
  version: PositiveIntSchema,
  createdAt: IsoInstantSchema,
  updatedAt: IsoInstantSchema,
}).superRefine((lease, context) => {
  if (Date.parse(lease.updatedAt) < Date.parse(lease.createdAt)) {
    context.addIssue({ code: "custom", path: ["updatedAt"], message: "worker lease updatedAt precedes createdAt" });
  }
  if (lease.lifecycle.state === "stopped" && lease.control.directive === "run") {
    context.addIssue({
      code: "custom",
      path: ["control", "directive"],
      message: "a stopped worker lease cannot carry a run directive; start a new lease generation instead",
    });
  }
});
export type WorkerLeaseRecord = z.infer<typeof WorkerLeaseRecordSchema>;

/** The run a worker is actively executing, or `undefined` when it holds none. */
export function workerActiveRunId(lease: WorkerLeaseRecord): string | undefined {
  return lease.lifecycle.state === "busy" ? lease.lifecycle.runId : undefined;
}

export function isLiveWorker(lease: WorkerLeaseRecord): boolean {
  return LIVE_WORKER_STATES.some((state) => state === lease.lifecycle.state);
}
