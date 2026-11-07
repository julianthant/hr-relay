/** The durable intake session: the operator's DECISIONS plus the immutable source identity, mutated only under a version CAS, with rows and columns never stored. */
import { z } from "zod";
import { ArtifactRefSchema } from "../artifacts/artifacts.js";
import { JsonValueSchema } from "../../rules/validation/canonical-json.js";
import {
  ActorIdSchema,
  IntakeManifestIdSchema,
  IntakeSessionIdSchema,
  IntakeTargetFieldIdSchema,
  IsoInstantSchema,
  PositiveIntSchema,
  WorkflowIdSchema,
} from "../../rules/identity/ids.js";
import { ColumnBindingSchema } from "./mapping.js";

export const WorkbookIntakeSourceSchema = z.strictObject({ libraryId: z.string().min(1), version: PositiveIntSchema });

export const IntakeSessionStateSchema = z.enum([
  "mapping",
  "validated",
  "enqueued",
  "discarded",
]);
export type IntakeSessionState = z.infer<typeof IntakeSessionStateSchema>;

/** A value the operator typed once for the whole run (ref data-intake-and-edit-data step 2). */
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

/** One explicit exclusion — ref data-intake-and-edit-data: never a silently dropped row. */
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
    /** The whole content-addressed identity, never a bare id. */
  artifact: ArtifactRefSchema,
    /* Enqueue requires the uploaded name; optional stored absence never invents one. */
  sourceName: z.string().min(1).optional(),
  workbookSource: WorkbookIntakeSourceSchema.optional(),
  sheet: z.string().min(1),
  /** Null while discovery could not preselect and the operator has not chosen. */
  headerRowIndex: z.number().int().nonnegative().nullable(),
  bindings: z.array(ColumnBindingSchema),
  constants: z.array(IntakeConstantSchema),
  corrections: z.array(IntakeRowCorrectionSchema),
  exclusions: z.array(IntakeRowExclusionSchema),
  state: IntakeSessionStateSchema,
  validation: IntakeSessionValidationSchema,
    /* Minted with every new session so the operator can inspect the exact plan identity BEFORE enqueue; optional only because pre-reservation rows must read forward. */
  reservedManifestId: IntakeManifestIdSchema.optional(),
  /** Optional read-forward preparation metadata; never backfilled into submitted imports. */
  comparisonManifestId: IntakeManifestIdSchema.optional(),
  /** Set exactly when the session enqueued; the manifest is the rerun authority. */
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
  if (
    session.reservedManifestId !== undefined
    && session.intakeManifestId !== undefined
    && session.reservedManifestId !== session.intakeManifestId
  ) {
    context.addIssue({
      code: "custom",
      path: ["intakeManifestId"],
      message: "an enqueued session consumes its reserved manifest id exactly",
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
