/** The durable worker lease: a long-lived process owning at most one active run, with `control` and `lifecycle` deliberately separate. */
import { z } from "zod";
import {
  ActorIdSchema,
  BrowserSystemIdSchema,
  CommandIdSchema,
  IsoInstantSchema,
  PositiveIntSchema,
  RunIdSchema,
  WorkerIdSchema,
  WorkflowIdSchema,
} from "../../rules/identity/ids.js";

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


export const WorkerStopReasonSchema = z.enum(["operator", "shutdown", "crashed"]);
export type WorkerStopReason = z.infer<typeof WorkerStopReasonSchema>;

/** The descriptor's ordered browser-system set, frozen when this worker lease starts. */
export const WorkerBrowserSystemsSchema = z.array(BrowserSystemIdSchema).superRefine((systems, context) => {
  if (new Set(systems).size !== systems.length) {
    context.addIssue({ code: "custom", message: "worker browser systems must be unique" });
  }
});

const LiveFields = {
  startedAt: IsoInstantSchema,
  heartbeatAt: IsoInstantSchema,
} as const;

export const WorkerLifecycleSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("starting"), startedAt: IsoInstantSchema }),
  z.strictObject({ state: z.literal("idle"), ...LiveFields }),
  z.strictObject({ state: z.literal("busy"), ...LiveFields, runId: RunIdSchema }),
  z.strictObject({ state: z.literal("waiting"), ...LiveFields, activity: z.enum(["acquiring", "authenticating", "closing"]), runId: RunIdSchema.optional() }),
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

export const LIVE_WORKER_STATES = Object.freeze(["starting", "idle", "busy", "waiting", "paused", "stopping"] as const);

export const WorkerClaimLifetimeSchema = z.strictObject({ membershipRevision: PositiveIntSchema, leaseGeneration: PositiveIntSchema });

export const WorkerControlBasisSchema = z.strictObject({
  leaseGeneration: PositiveIntSchema,
  controlRevision: PositiveIntSchema,
});
export type WorkerControlBasis = z.infer<typeof WorkerControlBasisSchema>;

export const WorkerLeaseRecordSchema = z.strictObject({
  workerId: WorkerIdSchema,
  /** Home workflow; authenticated descendants share the worker. */
  workflow: WorkflowIdSchema,
  browserSystems: WorkerBrowserSystemsSchema,
  processId: PositiveIntSchema,
  /** Bumped every time this worker id is (re)started; fences a zombie process. */
  leaseGeneration: PositiveIntSchema,
  controlRevision: PositiveIntSchema,
  controlCommandId: CommandIdSchema.optional(),
  startCommandId: CommandIdSchema.optional(),
  recoveryBasis: z.strictObject({ state: z.enum(["starting", "idle", "busy", "waiting", "paused"]),
    directive: z.enum(["run", "pause"]), observedAt: IsoInstantSchema }).optional(),
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

export function isLiveWorker(lease: WorkerLeaseRecord): boolean {
  return LIVE_WORKER_STATES.some((state) => state === lease.lifecycle.state);
}
