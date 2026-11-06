import { z } from "zod";
import { WorkerBrowserObservationSchema } from "../../../models/run/worker-control.js";
import { ErrorCatalogCodeSchema } from "../../../models/failures/error-catalog.js";
import { BrowserSessionIdSchema, BrowserSystemIdSchema, IsoInstantSchema, RunIdSchema, WorkerIdSchema } from "../../../rules/identity/ids.js";
import { JsonValueSchema } from "../../../rules/validation/canonical-json.js";

/** The worker family of the parent/child IPC pipe; lifetime transfer and Nominatim own their own kinds. */
export const WORKER_MESSAGE_PREFIX = "worker-";

export const WorkerControlRequestSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.enum(["refresh-browser", "reopen-browser"]), browserSessionId: BrowserSessionIdSchema }),
  z.strictObject({ type: z.literal("check-parked-write"), command: JsonValueSchema }),
  z.strictObject({ type: z.literal("close-for-removal") }),
]);
export type WorkerControlRequest = z.infer<typeof WorkerControlRequestSchema>;

export const WorkerReplyOutcomeSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("done"), result: JsonValueSchema }),
  z.strictObject({ state: z.literal("refused"), code: ErrorCatalogCodeSchema, message: z.string().min(1) }),
]);
export type WorkerReplyOutcome = z.infer<typeof WorkerReplyOutcomeSchema>;

export const WorkerActivitySchema = z.strictObject({
  state: z.enum(["idle", "busy", "waiting", "paused"]), runId: RunIdSchema.optional(),
}).refine(activity => (activity.state === "busy") === (activity.runId !== undefined), "worker-activity-run-binding-invalid");
export type WorkerActivity = z.infer<typeof WorkerActivitySchema>;

export const WorkerChildBrowserObservationSchema = WorkerBrowserObservationSchema.omit({ leaseGeneration: true });
export type WorkerChildBrowserObservation = z.infer<typeof WorkerChildBrowserObservationSchema>;

export const WorkerChildMessageSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("worker-ready"), workerId: WorkerIdSchema, pid: z.number().int().positive(), profileId: z.uuid(),
    sessionGeneration: z.number().int().nonnegative(), browserSystems: z.array(BrowserSystemIdSchema), activity: WorkerActivitySchema }),
  z.strictObject({ kind: z.literal("worker-activity"), activity: WorkerActivitySchema }),
  z.strictObject({ kind: z.literal("worker-browser"), observation: WorkerChildBrowserObservationSchema }),
  z.strictObject({ kind: z.literal("worker-reply"), requestId: z.uuid(), outcome: WorkerReplyOutcomeSchema }),
]);
export type WorkerChildMessage = z.infer<typeof WorkerChildMessageSchema>;

export const WorkerDirectiveSchema = z.enum(["run", "pause"]);
export type WorkerDirective = z.infer<typeof WorkerDirectiveSchema>;

export const WorkerParentMessageSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("worker-stop"), reason: z.enum(["operator", "shutdown", "logout", "reset", "remove", "fault"]), mode: z.literal("after-run") }),
  z.strictObject({ kind: z.literal("worker-pause"), requestId: z.uuid() }),
  z.strictObject({ kind: z.literal("worker-resume"), requestId: z.uuid() }),
  z.strictObject({ kind: z.literal("worker-request"), requestId: z.uuid(), sentAt: IsoInstantSchema, deadlineMs: z.number().int().positive(), request: WorkerControlRequestSchema }),
]);
export type WorkerParentMessage = z.infer<typeof WorkerParentMessageSchema>;
export type WorkerStopReason = Extract<WorkerParentMessage, { kind: "worker-stop" }>["reason"];
