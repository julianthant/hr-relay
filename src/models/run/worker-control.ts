import { z } from "zod";
import { CommandAuditRecordSchema, WorkerBrowserCommandRequestSchema } from "../../rules/commands/commands.js";
import { BrowserSessionIdSchema, BrowserSystemIdSchema, CommandIdSchema, FingerprintSchema, IsoInstantSchema, PositiveIntSchema, WorkerIdSchema } from "../../rules/identity/ids.js";

/** A pool and all its canonical members share one durable exclusion scope. */
export function workerControlScope(request: z.infer<typeof WorkerBrowserCommandRequestSchema>): string {
  if ("workflowId" in request.target) return `worker-pool:${request.target.workflowId}`;
  const workflow = /^(?<workflowId>.+)-worker-[1-9]\d*$/.exec(request.target.workerId)?.groups?.["workflowId"];
  return workflow === undefined ? `worker-browser:${request.target.workerId}` : `worker-pool:${workflow}`;
}

/** The observed result survives the BFF's acknowledgement/audit crash window. */
export const WorkerEffectAcknowledgementSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("plan"), workerIds: z.array(WorkerIdSchema) }),
  z.strictObject({ kind: z.literal("stop"), directiveLeaseVersions: z.strictObject({ before: PositiveIntSchema, after: PositiveIntSchema }) }),
  z.strictObject({ kind: z.literal("control"), browserSessionId: BrowserSessionIdSchema.optional() }),
]);
export type WorkerEffectAcknowledgement = z.infer<typeof WorkerEffectAcknowledgementSchema>;
export const WorkerControlPhaseSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("admitted") }),
  z.strictObject({ state: z.literal("ready") }),
  z.strictObject({ state: z.literal("executing"), startedAt: IsoInstantSchema }),
  z.strictObject({ state: z.literal("succeeded"), startedAt: IsoInstantSchema, completedAt: IsoInstantSchema, acknowledgement: WorkerEffectAcknowledgementSchema, application: z.strictObject({ result: CommandAuditRecordSchema.shape.result, versionChanges: CommandAuditRecordSchema.shape.versionChanges, affectedDependencyIds: CommandAuditRecordSchema.shape.affectedDependencyIds }).optional() }),
  z.strictObject({ state: z.literal("refused"), completedAt: IsoInstantSchema, message: z.string().min(1) }),
  z.strictObject({ state: z.literal("uncertain"), startedAt: IsoInstantSchema, observedAt: IsoInstantSchema, message: z.string().min(1) }),
]);
export const WorkerControlRecordSchema = z.strictObject({
  commandId: CommandIdSchema,
  request: WorkerBrowserCommandRequestSchema,
  scope: z.string().min(1),
  executorId: z.uuid(),
  admittedAt: IsoInstantSchema,
  expiresAt: IsoInstantSchema,
  basisVersion: z.number().int().nonnegative(),
  phase: WorkerControlPhaseSchema,
  auditedAt: IsoInstantSchema.optional(),
}).superRefine((record, context) => {
  if (record.scope !== workerControlScope(record.request)) context.addIssue({ code: "custom", message: "worker-control-scope-mismatch" });
  if ("workerId" in record.request.target && record.request.target.controlBasis === undefined) context.addIssue({ code: "custom", message: "worker-control-basis-required" });
  if (Date.parse(record.expiresAt) < Date.parse(record.admittedAt)) context.addIssue({ code: "custom", message: "worker-control-expiry-before-admission" });
  if (record.phase.state === "succeeded") {
    const browser = record.request.type === "refresh-browser" || record.request.type === "reopen-browser";
    if (!browser && record.phase.application === undefined) context.addIssue({ code: "custom", message: "worker-control-application-required" });
    const expectedKind = record.request.type === "plan-worker-count" ? "plan" : record.request.type === "stop-worker" ? "stop" : "control";
    if (record.phase.acknowledgement.kind !== expectedKind || browser && (record.phase.acknowledgement.kind !== "control" || record.phase.acknowledgement.browserSessionId === undefined)) context.addIssue({ code: "custom", message: "worker-control-outcome-kind-mismatch" });
    if (record.phase.application !== undefined && record.phase.application.result.commandId !== record.commandId) context.addIssue({ code: "custom", message: "worker-control-application-identity-mismatch" });
  }
  if (record.commandId !== record.request.commandId) context.addIssue({ code: "custom", message: "worker-control-command-identity-mismatch" });
  if (record.auditedAt !== undefined && record.phase.state !== "succeeded" && record.phase.state !== "refused") context.addIssue({ code: "custom", message: "worker-control-unsettled-audit" });
});
export type WorkerControlRecord = z.infer<typeof WorkerControlRecordSchema>;
export type WorkerControlPhase = z.infer<typeof WorkerControlPhaseSchema>;

/** Current observations come from the resource owner, never inferred from an open span. */
export const WorkerBrowserObservationSchema = z.strictObject({
  workerId: WorkerIdSchema,
  leaseGeneration: PositiveIntSchema,
  sessionId: BrowserSessionIdSchema,
  system: BrowserSystemIdSchema,
  instance: z.string().min(1).optional(),
  configFingerprint: FingerprintSchema,
  browserMode: z.enum(["headed", "headless"]),
  profileDirectory: z.string().min(1).optional(),
  acceptDownloads: z.boolean(),
  exclusive: z.boolean(),
  health: z.enum(["authenticated", "unknown", "failed", "closed"]),
  observedAt: IsoInstantSchema,
  openedAt: IsoInstantSchema.optional(),
});
export type WorkerBrowserObservation = z.infer<typeof WorkerBrowserObservationSchema>;

export class WorkerControlRefusal extends Error {
  override readonly name = "WorkerControlRefusal";
}
