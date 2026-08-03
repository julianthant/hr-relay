/**
 * The start plan — what a `start-run` command consumes (doc 13 §5.1).
 *
 * Planning and starting are two steps on purpose. The plan is where input is
 * parsed, instances are resolved, identity and enqueue policy are evaluated,
 * and refusals are named; the command that follows carries only the plan id and
 * the fingerprints it was bound to. So the operator confirms exactly what they
 * were shown, and a descriptor, config, or input that changed between the two
 * makes the command fail rather than start a different run than the one on
 * screen.
 *
 * Refusals ride the plan as data. A submission that cannot start is not dropped
 * and not turned into a run that fails later — it is a named `refused` entry the
 * surface renders beside the ones that will go.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJsonStringify, JsonValueSchema } from "../canonical-json.js";
import {
  ActorIdSchema,
  ConfigSnapshotIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  ItemIdSchema,
  PositiveIntSchema,
  RunIdSchema,
  StartPlanIdSchema,
  TraceIdSchema,
  WorkflowIdSchema,
} from "../ids.js";
import { SchemaBoundCanonicalValueSchema } from "../schema-bound-value.js";
import { InstanceSelectionSchema, RunPrioritySchema, RunShapeSchema } from "./envelope.js";

/** Why a submission cannot become a run. Every arm is a state the operator can act on. */
export const StartRefusalCodeSchema = z.enum([
  "input-invalid",
  "active-run-exists",
  "dry-run-unsupported",
  "preflight-failed",
  "capability-unavailable",
]);
export type StartRefusalCode = z.infer<typeof StartRefusalCodeSchema>;

export const PlannedRunSchema = z.strictObject({
  runId: RunIdSchema,
  itemId: ItemIdSchema,
  traceId: TraceIdSchema,
  /** The exact title/subtitle the confirmation surface showed. */
  title: z.string().min(1),
  subtitle: z.string().min(1).optional(),
  /**
   * The exact strict-JSON ingress the operator submitted, before defaults or
   * transforms. It is retained beside — never replaced with — canonical input.
   */
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
  const runIds = plan.planned.map(({ runId }) => runId);
  if (new Set(runIds).size !== runIds.length) {
    context.addIssue({ code: "custom", path: ["planned"], message: "a start plan cannot propose one run id twice" });
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
    if (planned.canonicalInputDigest !== deriveCanonicalInputDigest(planned.input.value)) {
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
  )) {
    context.addIssue({
      code: "custom",
      path: ["inputFingerprint"],
      message: "a start plan confirmation fingerprint must match its ordered accepted ingress identities",
    });
  }
});
export type StartPlanRecord = z.infer<typeof StartPlanRecordSchema>;

/** The digest of one schema-validated canonical snapshot, never of raw ingress. */
export function deriveCanonicalInputDigest(value: unknown): string {
  return FingerprintSchema.parse(createHash("sha256")
    .update("hrauto:start-plan-canonical-input:v1\0")
    .update(canonicalJsonStringify(value))
    .digest("hex"));
}

/**
 * The one confirmation token over the ordered accepted submissions. Raw ingress
 * stays part of the identity so a default/transform cannot erase an operator
 * change that happened to produce the same canonical value.
 */
export function derivePlannedInputFingerprint(
  planned: readonly PlannedRun[],
  ingressSchemaHash: string,
  canonicalInputSchemaHash: string,
): string {
  return FingerprintSchema.parse(createHash("sha256")
    .update("hrauto:start-plan-input:v2\0")
    .update(canonicalJsonStringify({
      ingressSchemaHash,
      canonicalInputSchemaHash,
      accepted: planned.map((run) => ({
        runId: run.runId,
        itemId: run.itemId,
        traceId: run.traceId,
        matchKey: run.matchKey,
        rawInput: run.rawInput,
        canonicalInput: run.input,
        canonicalInputDigest: run.canonicalInputDigest,
      })),
    }))
    .digest("hex"));
}

export function isStartPlanExpired(plan: StartPlanRecord, nowMs: number): boolean {
  return Date.parse(plan.expiresAt) <= nowMs;
}
