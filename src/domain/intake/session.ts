/**
 * The durable intake session (doc 06 §2.2, 2i-E1): the in-progress
 * upload → map → validate state that D159's terminal manifest deliberately
 * does not cover. The ROUTE creates a session (capture's exact precedent —
 * no open arm exists in the command family); the intake commands only
 * mutate it under a version CAS.
 *
 * What the row retains is exactly the operator's DECISIONS plus the
 * immutable source identity: the artifact ref, the sheet/header selection,
 * confirmed bindings, constants, corrections and exclusions. Rows and
 * detected columns are NEVER stored — they are a pure function of the
 * content-addressed artifact and the header selection, so every read
 * re-derives them and a stored copy could only drift from its own source.
 *
 * `validation` retains `readAt` because `validateIntakeRows` resolves
 * two-digit years against it: a replayed validation must resolve exactly as
 * the original did, and re-reading the clock would quietly move answers.
 */
import { z } from "zod";
import { ArtifactRefSchema } from "../artifacts.js";
import { JsonValueSchema } from "../canonical-json.js";
import {
  ActorIdSchema,
  IntakeManifestIdSchema,
  IntakeSessionIdSchema,
  IntakeTargetFieldIdSchema,
  IsoInstantSchema,
  PositiveIntSchema,
  WorkflowIdSchema,
} from "../ids.js";
import { ColumnBindingSchema } from "./mapping.js";

export const IntakeSessionStateSchema = z.enum([
  "mapping",
  "validated",
  "enqueued",
  "discarded",
]);
export type IntakeSessionState = z.infer<typeof IntakeSessionStateSchema>;

/** A value the operator typed once for the whole run (doc 06 §8 step 2). */
export const IntakeConstantSchema = z.strictObject({
  targetFieldId: IntakeTargetFieldIdSchema,
  value: JsonValueSchema,
});

/** One operator cell correction, applied over the source without rewriting it. */
export const IntakeRowCorrectionSchema = z.strictObject({
  sourceRow: PositiveIntSchema,
  field: IntakeTargetFieldIdSchema,
  correctedValue: z.string(),
  correctedAt: IsoInstantSchema,
});

/** One explicit exclusion — doc 06 §5: never a silently dropped row. */
export const IntakeRowExclusionSchema = z.strictObject({
  sourceRow: PositiveIntSchema,
  reason: z.string().min(1),
  excludedAt: IsoInstantSchema,
});

export const IntakeSessionValidationSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("none") }),
  z.strictObject({
    state: z.literal("validated"),
    validatedAt: IsoInstantSchema,
    /** The instant validation READ the rows with — replay resolves years against it. */
    readAt: IsoInstantSchema,
  }),
]);

export const IntakeSessionSchema = z.strictObject({
  intakeSessionId: IntakeSessionIdSchema,
  actorId: ActorIdSchema,
  workflow: WorkflowIdSchema,
  /** The whole content-addressed identity (D161/D167's rule), never a bare id. */
  artifact: ArtifactRefSchema,
  sheet: z.string().min(1),
  /** Null while discovery could not preselect and the operator has not chosen. */
  headerRowIndex: z.number().int().nonnegative().nullable(),
  bindings: z.array(ColumnBindingSchema),
  constants: z.array(IntakeConstantSchema),
  corrections: z.array(IntakeRowCorrectionSchema),
  exclusions: z.array(IntakeRowExclusionSchema),
  state: IntakeSessionStateSchema,
  validation: IntakeSessionValidationSchema,
  /** Set exactly when the session enqueued (E2); the manifest is the rerun authority. */
  intakeManifestId: IntakeManifestIdSchema.optional(),
  version: PositiveIntSchema,
  createdAt: IsoInstantSchema,
  updatedAt: IsoInstantSchema,
}).superRefine((session, context) => {
  if (session.state === "enqueued" && session.intakeManifestId === undefined) {
    context.addIssue({
      code: "custom",
      path: ["intakeManifestId"],
      message: "an enqueued session names the manifest it fanned out as",
    });
  }
  if (session.state !== "enqueued" && session.intakeManifestId !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["intakeManifestId"],
      message: "only an enqueued session carries a manifest id",
    });
  }
  if (session.state === "validated" && session.validation.state !== "validated") {
    context.addIssue({
      code: "custom",
      path: ["validation"],
      message: "a validated session retains its validation instant and readAt",
    });
  }
  if (session.headerRowIndex === null && session.bindings.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["bindings"],
      message: "a binding names a column, and columns exist only under a settled header row",
    });
  }
  const boundTargets = session.bindings.map(({ targetFieldId }) => targetFieldId);
  if (new Set(boundTargets).size !== boundTargets.length) {
    context.addIssue({
      code: "custom",
      path: ["bindings"],
      message: "one target field binds at most one column",
    });
  }
});
export type IntakeSession = z.infer<typeof IntakeSessionSchema>;
