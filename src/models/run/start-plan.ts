import { valueFreeProtectedData, valueFreeProtectedInput, type ProtectedInputBinding } from "../write-safety/protected-input.js";
import { StartSupersedeTargetsSchema } from "./start-supersede.js";
/** The start plan — what a `start-run` command consumes: planning and starting are two steps, and refusals ride the plan as data. */
import { RerunPlanSchema, type RerunPlan } from "./rerun.js";
import { createHash } from "node:crypto";
import { z } from "zod";
import { StartRefusalCodeSchema } from "./start-refusal.js";
import { canonicalJsonStringify, JsonValueSchema } from "../../rules/validation/canonical-json.js";
import {
  ActorIdSchema,
  ConfigSnapshotIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  ItemIdSchema,
  PositiveIntSchema,
  StartPlanIdSchema,
  WorkflowIdSchema,
} from "../../rules/identity/ids.js";
import { SchemaBoundCanonicalValueSchema } from "../validation/schema-bound-value.js";
import { StepOmissionsSchema, type StepOmissions } from "../workflow/step-omission.js";
import {
  BrowserPresentationModeSchema,
  InstanceSelectionSchema,
  RunPrioritySchema,
  RunWorkersSchema,
  RunShapeSchema,
  RunRecoveryModeSchema,
} from "./envelope.js";

/** Why a submission cannot become a run. Every arm is a state the operator can act on. */
export { StartRefusalCodeSchema, type StartRefusalCode } from "./start-refusal.js";

export const PlannedRunSchema = z.strictObject({
  supersedeTargets: StartSupersedeTargetsSchema.optional(),
  itemId: ItemIdSchema,
  /** The exact title/subtitle the confirmation surface showed. */
  title: z.string().min(1),
  subtitle: z.string().min(1).optional(),
    /* The exact strict-JSON ingress the operator submitted, before defaults or transforms, retained beside — never replaced with — canonical input. */
  rawInput: JsonValueSchema,
  /** Parsed through the workflow's canonical-input schema, bound to its hash. */
  input: SchemaBoundCanonicalValueSchema,
  /** SHA-256 identity of this exact schema-parsed canonical JSON value. */
  canonicalInputDigest: FingerprintSchema,
  matchKey: z.string().min(1),
});
export type PlannedRun = z.infer<typeof PlannedRunSchema>;

export const StartRefusalSchema = z.strictObject({
  /** The submission's position in the operator's list, for display only. */
  entry: PositiveIntSchema,
  /** Exact strict-JSON ingress, retained even when this entry cannot start. */
  rawInput: JsonValueSchema,
  code: StartRefusalCodeSchema,
  message: z.string().min(1),
});
export type StartRefusal = z.infer<typeof StartRefusalSchema>;

export const StartPlanRecordSchema = z.strictObject({
  startPlanId: StartPlanIdSchema,
  workflowId: WorkflowIdSchema,
  descriptorVersion: PositiveIntSchema,
  descriptorFingerprint: FingerprintSchema,
  configFingerprint: FingerprintSchema,
  configSnapshotId: ConfigSnapshotIdSchema,
  /** Derived from the descriptor's exact ingress schema; never caller supplied. */
  ingressSchemaHash: FingerprintSchema,
  /** Derived from the descriptor's exact canonical-input schema; never caller supplied. */
  canonicalInputSchemaHash: FingerprintSchema,
  /** Over ordered raw + canonical + schema/digest run identities — the confirmation's identity. */
  inputFingerprint: FingerprintSchema,
  requestedInstance: InstanceSelectionSchema.optional(),
  resolvedInstance: InstanceSelectionSchema,
  shape: RunShapeSchema,
  priority: RunPrioritySchema,
  dryRun: z.boolean(),
  recovery: RunRecoveryModeSchema.optional(),
  workers: RunWorkersSchema,
  browserMode: BrowserPresentationModeSchema.optional(),
  captureBrowserScreenshots: z.boolean().optional(),
    /** Omitted steps with their typed facts; copied unchanged onto every run this plan starts. */
  stepOmissions: StepOmissionsSchema.optional(),
  rerun: RerunPlanSchema.optional(),
  planned: z.array(PlannedRunSchema),
  refused: z.array(StartRefusalSchema),
  plannedBy: ActorIdSchema,
  plannedAt: IsoInstantSchema,
  /** Short-lived by design: a stale confirmation re-plans rather than starts. */
  expiresAt: IsoInstantSchema,
  /** Set when a `start-run` command consumed this plan; a plan starts once. */
  consumedBy: z.strictObject({
    commandId: z.string().min(1),
    consumedAt: IsoInstantSchema,
  }).optional(),
  version: PositiveIntSchema,
  createdAt: IsoInstantSchema,
  updatedAt: IsoInstantSchema,
}).superRefine((plan, context) => {
  if (plan.planned.length === 0 && plan.refused.length === 0) {
    context.addIssue({ code: "custom", message: "a start plan must propose or refuse at least one submission" });
  }
  if (Date.parse(plan.expiresAt) <= Date.parse(plan.plannedAt)) {
    context.addIssue({ code: "custom", path: ["expiresAt"], message: "a start plan must expire after it was planned" });
  }
  const entries = plan.refused.map(({ entry }) => entry);
  if (new Set(entries).size !== entries.length) {
    context.addIssue({ code: "custom", path: ["refused"], message: "a start plan cannot refuse one entry twice" });
  }
  for (const [index, planned] of plan.planned.entries()) {
    if (planned.input.schemaHash !== plan.canonicalInputSchemaHash) {
      context.addIssue({
        code: "custom",
        path: ["planned", index, "input", "schemaHash"],
        message: "a planned canonical input must use the start plan canonical-input schema hash",
      });
    }
    if (planned.canonicalInputDigest !== deriveCanonicalInputDigest(planned.input.value, planned.input.protectedBindings)) {
      context.addIssue({
        code: "custom",
        path: ["planned", index, "canonicalInputDigest"],
        message: "a planned canonical-input digest must match its canonical JSON value",
      });
    }
  }
  if (plan.inputFingerprint !== derivePlannedInputFingerprint(
    plan.planned,
    plan.ingressSchemaHash,
    plan.canonicalInputSchemaHash,
    plan.rerun,
    plan.stepOmissions,
  )) {
    context.addIssue({
      code: "custom",
      path: ["inputFingerprint"],
      message: "a start plan confirmation fingerprint must match its ordered accepted ingress identities",
    });
  }
  if (plan.consumedBy !== undefined && plan.version < 2) {
    context.addIssue({
      code: "custom",
      path: ["version"],
      message: "a consumed start plan must retain its pre-consume revision",
    });
  }
});
export type StartPlanRecord = z.infer<typeof StartPlanRecordSchema>;

export function deriveCanonicalInputDigest(value: unknown, bindings?: readonly ProtectedInputBinding[]): string {
  return FingerprintSchema.parse(createHash("sha256")
    .update("hrauto:start-plan-canonical-input:v1\0")
    .update(canonicalJsonStringify(valueFreeProtectedInput(value, bindings)))
    .digest("hex"));
}

/** The one confirmation token over the ordered accepted submissions; raw ingress stays part of the identity. */
export function derivePlannedInputFingerprint(
  planned: readonly PlannedRun[],
  ingressSchemaHash: string,
  canonicalInputSchemaHash: string,
  rerun?: RerunPlan,
  stepOmissions?: StepOmissions,
): string {
  return FingerprintSchema.parse(createHash("sha256")
    .update("hrauto:start-plan-input:v3\0")
    .update(canonicalJsonStringify({
      ingressSchemaHash,
      canonicalInputSchemaHash,
      ...(rerun === undefined ? {} : { rerun: valueFreeProtectedData(rerun) }),
      ...(stepOmissions === undefined ? {} : { stepOmissions }),
      accepted: planned.map((run) => ({
        ...(run.supersedeTargets === undefined ? {} : { supersedeTargets: run.supersedeTargets }),
        itemId: run.itemId,
        matchKey: run.matchKey,
        rawInput: valueFreeProtectedData(run.rawInput, run.input.protectedBindings),
        canonicalInput: { ...run.input, value: valueFreeProtectedInput(run.input.value, run.input.protectedBindings) },
        canonicalInputDigest: run.canonicalInputDigest,
      })),
    }))
    .digest("hex"));
}

export function isStartPlanExpired(plan: StartPlanRecord, nowMs: number): boolean {
  return Date.parse(plan.expiresAt) <= nowMs;
}
