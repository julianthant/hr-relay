import { z } from "zod";
import { WorkerControlBasisSchema } from "./worker.js";
import { WorkerPoolMemberSchema, WorkerPoolRosterAdmissionSchema, WorkerRetirementProofSchema } from "./worker-slot.js";
import { CommandAuditRecordSchema, WorkerBrowserCommandRequestSchema, ParkedWriteCheckResultSchema } from "../../rules/commands/commands.js";
import { SchemaBoundCanonicalValueSchema } from "../validation/schema-bound-value.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { BrowserSessionIdSchema, BrowserSystemIdSchema, CommandIdSchema, FingerprintSchema, IsoInstantSchema, PositiveIntSchema, RunIdSchema, ConfigSnapshotIdSchema, WorkerIdSchema } from "../../rules/identity/ids.js";

/** A pool and all its canonical members share one durable exclusion scope. */
export function workerControlScope(request: z.infer<typeof WorkerBrowserCommandRequestSchema>): string {
  if ("workflowId" in request.target) return `worker-pool:${request.target.workflowId}`;
  const workflow = /^(?<workflowId>.+)-worker-[1-9]\d*$/.exec(request.target.workerId)?.groups?.["workflowId"];
  return workflow === undefined ? `worker-browser:${request.target.workerId}` : `worker-pool:${workflow}`;
}

/** The observed result survives the BFF's acknowledgement/audit crash window. */
export const WorkerEffectAcknowledgementSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("parked-write-check"), result: ParkedWriteCheckResultSchema, evidence: SchemaBoundCanonicalValueSchema.optional() }),
  z.strictObject({ kind: z.literal("plan"), workerIds: z.array(WorkerIdSchema), retirements: z.array(WorkerRetirementProofSchema) }),
  z.strictObject({ kind: z.literal("reset-replacement"), commandId: CommandIdSchema, oldLeaseGeneration: PositiveIntSchema,
    leaseGeneration: PositiveIntSchema, oldControlRevision: PositiveIntSchema, controlRevision: PositiveIntSchema,
    membershipRevision: PositiveIntSchema, idleAt: IsoInstantSchema, closedSessionIds: z.array(BrowserSessionIdSchema),
    browsersClosed: z.literal(true), duoReleased: z.literal(true) }),
  z.strictObject({ kind: z.literal("reset"), commandId: CommandIdSchema, leaseGeneration: PositiveIntSchema, controlRevision: PositiveIntSchema, membershipRevision: PositiveIntSchema, idleAt: IsoInstantSchema, closedSessionIds: z.array(BrowserSessionIdSchema), browsersClosed: z.literal(true), duoReleased: z.literal(true) }),
  z.strictObject({ kind: z.literal("remove"), retirement: WorkerRetirementProofSchema, beforePoolVersion: PositiveIntSchema, afterPoolVersion: PositiveIntSchema, beforeCount: PositiveIntSchema, afterCount: z.number().int().nonnegative() }),
  z.strictObject({ kind: z.literal("retry"), oldLeaseGeneration: PositiveIntSchema, leaseGeneration: PositiveIntSchema, processId: PositiveIntSchema, startedAt: IsoInstantSchema }),
  z.strictObject({ kind: z.literal("stop"), directiveLeaseVersions: z.strictObject({ before: PositiveIntSchema, after: PositiveIntSchema }) }),
  z.strictObject({ kind: z.literal("control"), browserSessionId: BrowserSessionIdSchema.optional() }),
]);
export type WorkerEffectAcknowledgement = z.infer<typeof WorkerEffectAcknowledgementSchema>;
export const WorkerSupervisorEffectObservationSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("remove"), retirement: WorkerRetirementProofSchema }),
  z.strictObject({ kind: z.literal("retry"), leaseGeneration: PositiveIntSchema, processId: PositiveIntSchema, startedAt: IsoInstantSchema }),
]);
export type WorkerSupervisorEffectObservation = z.infer<typeof WorkerSupervisorEffectObservationSchema>;
export const WorkerControlPhaseSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("admitted") }),
  z.strictObject({ state: z.literal("ready") }),
  z.strictObject({ state: z.literal("executing"), startedAt: IsoInstantSchema }),
  z.strictObject({ state: z.literal("succeeded"), startedAt: IsoInstantSchema, completedAt: IsoInstantSchema, acknowledgement: WorkerEffectAcknowledgementSchema, application: z.strictObject({ result: CommandAuditRecordSchema.shape.result, versionChanges: CommandAuditRecordSchema.shape.versionChanges, affectedDependencyIds: CommandAuditRecordSchema.shape.affectedDependencyIds }).optional() }),
  z.strictObject({ state: z.literal("refused"), completedAt: IsoInstantSchema, message: z.string().min(1) }),
  z.strictObject({ state: z.literal("uncertain"), startedAt: IsoInstantSchema, observedAt: IsoInstantSchema, message: z.string().min(1) }),
]);
export const WorkerResetRunSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("claimed"), runId: RunIdSchema, version: PositiveIntSchema,
    attempt: PositiveIntSchema, workerId: WorkerIdSchema, claimGeneration: PositiveIntSchema }),
  z.strictObject({ state: z.literal("queued"), runId: RunIdSchema, version: PositiveIntSchema,
    attempt: PositiveIntSchema, dependencyFingerprint: FingerprintSchema }),
]);
export const WorkerResetBindingSchema = z.strictObject({
  commandId: CommandIdSchema, member: WorkerPoolMemberSchema,
  lifetime: z.strictObject({ leaseGeneration: PositiveIntSchema, processId: PositiveIntSchema, startedAt: IsoInstantSchema }),
  basis: WorkerControlBasisSchema, reservedControlRevision: PositiveIntSchema,
  work: z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("absent") }),
    z.strictObject({ kind: z.literal("current"), current: WorkerResetRunSchema.options[0], cascade: z.array(WorkerResetRunSchema.options[1]) })]),
}).superRefine((binding, context) => {
  const runs = binding.work.kind === "absent" ? [] : [binding.work.current, ...binding.work.cascade];
  if (binding.reservedControlRevision !== binding.basis.controlRevision + 1
    || binding.lifetime.leaseGeneration !== binding.basis.leaseGeneration
    || new Set(runs.map(run => run.runId)).size !== runs.length
    || runs.some(run => run.state === "claimed" && run.workerId !== binding.member.workerId)) {
    context.addIssue({ code: "custom", message: "worker-reset-binding-invalid" });
  }
});
export type WorkerResetBinding = z.infer<typeof WorkerResetBindingSchema>;

export const WorkerLifecycleBindingSchema = z.strictObject({
  commandId: CommandIdSchema, member: WorkerPoolMemberSchema,
  lifetime: WorkerResetBindingSchema.shape.lifetime,
  basis: WorkerControlBasisSchema, reservedControlRevision: PositiveIntSchema,
  poolVersion: PositiveIntSchema, desiredWorkers: PositiveIntSchema,
  operation: z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("remove") }),
    z.strictObject({ kind: z.literal("retry"), mode: z.enum(["initialize", "browserless"]),
      systems: z.array(BrowserSystemIdSchema), configSnapshotId: ConfigSnapshotIdSchema, configFingerprint: FingerprintSchema,
      descriptorVersion: PositiveIntSchema, contractFingerprint: FingerprintSchema })]),
}).superRefine((binding, context) => {
  if (binding.lifetime.leaseGeneration !== binding.basis.leaseGeneration || binding.reservedControlRevision !== binding.basis.controlRevision + 1
    || binding.operation.kind === "retry" && new Set(binding.operation.systems).size !== binding.operation.systems.length) context.addIssue({ code: "custom", message: "worker-lifecycle-binding-invalid" });
});
export type WorkerLifecycleBinding = z.infer<typeof WorkerLifecycleBindingSchema>;

export const WorkerControlRecordSchema = z.strictObject({
  commandId: CommandIdSchema,
  request: WorkerBrowserCommandRequestSchema,
  scope: z.string().min(1),
  executorId: z.uuid(),
  admittedAt: IsoInstantSchema,
  expiresAt: IsoInstantSchema,
  basisVersion: z.number().int().nonnegative(),
  phase: WorkerControlPhaseSchema,
  roster: WorkerPoolRosterAdmissionSchema.optional(),
  control: z.strictObject({ member: WorkerPoolMemberSchema, lifetime: WorkerResetBindingSchema.shape.lifetime }).optional(),
  reset: WorkerResetBindingSchema.optional(),
  lifecycle: WorkerLifecycleBindingSchema.optional(),
  effect: z.strictObject({ observedAt: IsoInstantSchema, observation: WorkerSupervisorEffectObservationSchema }).optional(),
  readiness: z.discriminatedUnion("state", [z.strictObject({ state: z.literal("initializing"), leaseGeneration: PositiveIntSchema }), z.strictObject({ state: z.enum(["ready", "cancelled"]), leaseGeneration: PositiveIntSchema, observedAt: IsoInstantSchema })]).optional(),
  closure: z.strictObject({ observedAt: IsoInstantSchema, closedSessionIds: z.array(BrowserSessionIdSchema) }).optional(),
  auditedAt: IsoInstantSchema.optional(),
}).superRefine((record, context) => {
  if (record.request.type === "check-parked-write" && record.phase.state === "succeeded") {
    const observation = record.phase.acknowledgement;
    if (observation.kind !== "parked-write-check" || observation.result.commandId !== record.commandId
      || observation.result.requestedBy !== record.request.requestedBy
      || canonicalJsonStringify(observation.result.target) !== canonicalJsonStringify(record.request.target)) {
      context.addIssue({ code: "custom", message: "parked-check-observation-identity-mismatch" });
    }
  } else if (record.phase.state === "succeeded" && record.phase.acknowledgement.kind === "parked-write-check") {
    context.addIssue({ code: "custom", message: "parked-check-observation-without-check" });
  }
  if (record.control !== undefined) {
    const request = record.request;
    if (!["pause-worker", "resume-worker", "refresh-browser", "reopen-browser", "check-parked-write"].includes(request.type)
      || !("workerId" in request.target) || record.control.member.workerId !== request.target.workerId
      || record.control.lifetime.leaseGeneration !== request.target.controlBasis?.leaseGeneration) context.addIssue({ code: "custom", message: "worker-control-binding-invalid" });
  }
  if (record.request.type === "remove-worker" || record.request.type === "retry-worker") {
    const binding = record.lifecycle;
    if (binding === undefined || binding.commandId !== record.commandId || binding.operation.kind !== (record.request.type === "remove-worker" ? "remove" : "retry")
      || binding.member.workerId !== record.request.target.workerId || binding.member.workflowId !== record.request.target.workflowId
      || binding.member.membershipRevision !== record.request.target.membershipRevision || binding.poolVersion !== Number(record.request.target.expectedVersion)
      || JSON.stringify(binding.basis) !== JSON.stringify(record.request.target.controlBasis)
      || binding.reservedControlRevision !== binding.basis.controlRevision + 1) context.addIssue({ code: "custom", message: "worker-lifecycle-binding-required" });
  } else if (record.request.type === "stop-worker" && record.lifecycle !== undefined) {
    const binding = record.lifecycle, reset = record.reset;
    if (reset === undefined || binding.operation.kind !== "retry" || binding.operation.mode !== "browserless"
      || binding.commandId !== record.commandId || JSON.stringify(binding.member) !== JSON.stringify(reset.member)
      || JSON.stringify(binding.lifetime) !== JSON.stringify(reset.lifetime) || JSON.stringify(binding.basis) !== JSON.stringify(reset.basis)
      || binding.reservedControlRevision !== reset.reservedControlRevision || record.closure !== undefined) context.addIssue({ code: "custom", message: "worker-reset-replacement-binding-invalid" });
  } else if (record.lifecycle !== undefined || record.closure !== undefined) context.addIssue({ code: "custom", message: "worker-lifecycle-binding-unexpected" });
  if (record.effect !== undefined && (record.lifecycle === undefined
    || record.effect.observation.kind !== record.lifecycle.operation.kind
    || !["executing", "uncertain", "succeeded"].includes(record.phase.state))) context.addIssue({ code: "custom", message: "worker-lifecycle-effect-binding-invalid" });
  if (record.readiness !== undefined && (record.lifecycle?.operation.kind !== "retry" || record.phase.state !== "succeeded"
    || record.readiness.leaseGeneration !== record.lifecycle.lifetime.leaseGeneration + 1)) context.addIssue({ code: "custom", message: "worker-initialization-binding-invalid" });
  if (record.closure !== undefined && (record.lifecycle?.operation.kind !== "remove"
    || new Set(record.closure.closedSessionIds).size !== record.closure.closedSessionIds.length)) context.addIssue({ code: "custom", message: "worker-retirement-closure-invalid" });
  if (record.request.type === "stop-worker") {
    if (record.reset !== undefined && (record.reset.commandId !== record.commandId
      || record.reset.member.workerId !== record.request.target.workerId
      || record.reset.member.membershipRevision !== record.request.target.membershipRevision
      || JSON.stringify(record.reset.basis) !== JSON.stringify(record.request.target.controlBasis))) context.addIssue({ code: "custom", message: "worker-reset-binding-required" });
  } else if (record.reset !== undefined) context.addIssue({ code: "custom", message: "worker-reset-binding-unexpected" });
  if (record.request.type === "plan-worker-count") {
    const roster = record.roster;
    const workflowId = record.request.target.workflowId;
    if (roster === undefined || roster.selected.length !== record.request.payload.desiredWorkers
      || roster.beforeVersion !== record.basisVersion
      || [...roster.selected, ...roster.excess].some(slot => slot.workflow !== workflowId)) {
      context.addIssue({ code: "custom", message: "worker-control-roster-required" });
    }
    if (roster !== undefined && record.phase.state === "succeeded"
      && (record.phase.acknowledgement.kind !== "plan"
        || JSON.stringify(record.phase.acknowledgement.workerIds) !== JSON.stringify(roster.selected.map(slot => slot.workerId)))) {
      context.addIssue({ code: "custom", message: "worker-control-roster-acknowledgement-mismatch" });
    }
  } else if (record.roster !== undefined) context.addIssue({ code: "custom", message: "worker-control-unexpected-roster" });
  if (record.scope !== workerControlScope(record.request)) context.addIssue({ code: "custom", message: "worker-control-scope-mismatch" });
  if ("workerId" in record.request.target && record.request.type !== "stop-worker" && record.request.target.controlBasis === undefined) context.addIssue({ code: "custom", message: "worker-control-basis-required" });
  if (Date.parse(record.expiresAt) < Date.parse(record.admittedAt)) context.addIssue({ code: "custom", message: "worker-control-expiry-before-admission" });
  if (record.phase.state === "succeeded") {
    const browser = record.request.type === "refresh-browser" || record.request.type === "reopen-browser";
    const parkedCheck = record.request.type === "check-parked-write";
    if (!browser && !parkedCheck && record.phase.application === undefined) context.addIssue({ code: "custom", message: "worker-control-application-required" });
    const expectedKind = parkedCheck ? "parked-write-check" : record.request.type === "remove-worker" ? "remove" : record.request.type === "retry-worker" ? "retry" : record.request.type === "plan-worker-count" ? "plan" : record.request.type === "stop-worker" ? record.reset === undefined ? "stop" : record.lifecycle === undefined ? "reset" : "reset-replacement" : "control";
    if (record.phase.acknowledgement.kind !== expectedKind || browser && (record.phase.acknowledgement.kind !== "control" || record.phase.acknowledgement.browserSessionId === undefined)) context.addIssue({ code: "custom", message: "worker-control-outcome-kind-mismatch" });
    const acknowledgement = record.phase.acknowledgement;
    if (record.lifecycle !== undefined && acknowledgement.kind === "remove" && (acknowledgement.retirement.workerId !== record.lifecycle.member.workerId
      || acknowledgement.retirement.membershipRevision !== record.lifecycle.member.membershipRevision || acknowledgement.beforePoolVersion !== record.lifecycle.poolVersion
      || acknowledgement.afterPoolVersion !== acknowledgement.beforePoolVersion + 1 || acknowledgement.beforeCount !== record.lifecycle.desiredWorkers
      || acknowledgement.afterCount !== acknowledgement.beforeCount - 1 || record.closure === undefined)) context.addIssue({ code: "custom", message: "worker-removal-acknowledgement-mismatch" });
    if (record.lifecycle !== undefined && acknowledgement.kind === "retry" && (acknowledgement.oldLeaseGeneration !== record.lifecycle.lifetime.leaseGeneration
      || acknowledgement.leaseGeneration !== acknowledgement.oldLeaseGeneration + 1 || record.readiness === undefined)) context.addIssue({ code: "custom", message: "worker-retry-acknowledgement-mismatch" });
    if (record.reset !== undefined && acknowledgement.kind === "reset-replacement" && (acknowledgement.commandId !== record.commandId
      || acknowledgement.oldLeaseGeneration !== record.reset.lifetime.leaseGeneration
      || acknowledgement.leaseGeneration !== acknowledgement.oldLeaseGeneration + 1
      || acknowledgement.oldControlRevision !== record.reset.reservedControlRevision || acknowledgement.controlRevision !== 1
      || acknowledgement.membershipRevision !== record.reset.member.membershipRevision || acknowledgement.idleAt !== record.phase.completedAt
      || new Set(acknowledgement.closedSessionIds).size !== acknowledgement.closedSessionIds.length)) context.addIssue({ code: "custom", message: "worker-reset-replacement-acknowledgement-invalid" });
    if (record.reset !== undefined && acknowledgement.kind === "reset" && (acknowledgement.commandId !== record.commandId
      || acknowledgement.leaseGeneration !== record.reset.lifetime.leaseGeneration
      || acknowledgement.controlRevision !== record.reset.reservedControlRevision
      || acknowledgement.membershipRevision !== record.reset.member.membershipRevision
      || acknowledgement.idleAt !== record.phase.completedAt
      || new Set(acknowledgement.closedSessionIds).size !== acknowledgement.closedSessionIds.length)) context.addIssue({ code: "custom", message: "worker-reset-acknowledgement-mismatch" });
    if (record.phase.application !== undefined && record.phase.application.result.state !== "applied" && record.phase.application.result.state !== "already-applied") context.addIssue({ code: "custom", message: "worker-control-success-result-required" });
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
  signInFingerprint: FingerprintSchema,
  browserMode: z.enum(["headed", "headless"]),
  profileDirectory: z.string().min(1).optional(),
  acceptDownloads: z.boolean(),
  exclusive: z.boolean(),
  health: z.enum(["authenticated", "unknown", "failed", "closed"]),
  observedAt: IsoInstantSchema,
  openedAt: IsoInstantSchema,
  profileRevision: PositiveIntSchema,
});
export type WorkerBrowserObservation = z.infer<typeof WorkerBrowserObservationSchema>;

export class WorkerControlRefusal extends Error {
  override readonly name = "WorkerControlRefusal";
}
