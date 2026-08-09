/**
 * The intake session wire (doc 06 §2.2, D170) — what the upload route returns
 * and what `GET /api/v1/intake/:sessionId` serves.
 *
 * It is the durable session JOINED with the re-derived parse view and the
 * suggestion hints, because a mapping grid cannot be drawn from either half
 * alone. Three properties are load-bearing:
 *
 * 1. **`expectedVersion` is the CAS token** every intake command target
 *    carries, served in its own right so a surface never has to invent one.
 * 2. **Suggestions are HINTS** (doc 06 §2.5). They ride beside `bindings` and
 *    are never folded into it: only `confirmBinding`, reached from an operator
 *    action, mints a binding, and the wire preserves that separation so a
 *    client cannot accidentally render a proposal as a decision.
 * 3. **Rows are not served.** Doc 06 §2.2 step 1 is explicit — sample values
 *    per column, never the whole file. A rejection carries its own redacted
 *    raw value, which is the one place a cell reaches the client verbatim.
 *
 * `validation` mirrors the session's own arm and ADDS the re-derived
 * dispositions: `validateIntakeRows` is a pure function of the retained inputs
 * plus the retained `readAt`, so serving them costs nothing durable and cannot
 * disagree with what the operator validated.
 */
import { z } from "zod";
import { ArtifactRefSchema } from "../artifacts.js";
import {
  FingerprintSchema,
  IntakeManifestIdSchema,
  IntakeSessionIdSchema,
  IsoInstantSchema,
  PositiveIntSchema,
  WorkflowIdSchema,
} from "../ids.js";
import { ServedHeaderCandidateSchema, HeaderDiscoverySchema } from "./header-discovery.js";
import {
  IntakeManifestTotalsSchema,
  RerunDiffSchema,
  RowRejectSchema,
} from "./manifest.js";
import { ColumnBindingSchema, DetectedColumnSchema } from "./mapping.js";
import { IntakeTargetSchema } from "./projection.js";
import {
  IntakeConstantSchema,
  IntakeRowCorrectionSchema,
  IntakeRowExclusionSchema,
  IntakeSessionStateSchema,
} from "./session.js";
import { SuggestionSchema } from "./suggestions.js";

export const IntakeValidationWireSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("none") }),
  z.strictObject({
    state: z.literal("validated"),
    validatedAt: IsoInstantSchema,
    /** The retained observation instant; two-digit years resolve against it. */
    readAt: IsoInstantSchema,
    validRows: z.number().int().nonnegative(),
    rejected: z.array(RowRejectSchema),
    excluded: z.array(PositiveIntSchema),
  }),
]);
export type IntakeValidationWire = z.infer<typeof IntakeValidationWireSchema>;

/**
 * "This exact file has run before" — doc 06 §7 vector #11, served (D171).
 *
 * A rerun references an immutable manifest and an immutable artifact, so the
 * operator must SEE what moved before enqueueing the same bytes a second time.
 * The prior manifest is found by the session's own source digest, so the
 * `source-artifact` axis is equal by construction and `diff` reports only the
 * mapping, projection, contract and canonical-schema axes.
 *
 * It is present on an ENQUEUED session too, where it names that session's own
 * manifest and reads `same-plan` — which is exactly the manifest view the run
 * surface links to.
 */
export const IntakeRerunWireSchema = z.strictObject({
  intakeManifestId: IntakeManifestIdSchema,
  createdAt: IsoInstantSchema,
  totals: IntakeManifestTotalsSchema,
  diff: RerunDiffSchema,
});
export type IntakeRerunWire = z.infer<typeof IntakeRerunWireSchema>;

export const IntakeSessionWireSchema = z.strictObject({
  wireVersion: z.literal(1),
  intakeSessionId: IntakeSessionIdSchema,
  workflow: WorkflowIdSchema,
  artifact: ArtifactRefSchema,
  /** The name the file was uploaded under; absent on a pre-D171 session. */
  sourceName: z.string().min(1).optional(),
  state: IntakeSessionStateSchema,
  /** The CAS token every intake command target carries. */
  expectedVersion: PositiveIntSchema,
  /** Set exactly when the session enqueued; the manifest is the rerun authority. */
  intakeManifestId: IntakeManifestIdSchema.optional(),
  createdAt: IsoInstantSchema,
  updatedAt: IsoInstantSchema,

  /* ── re-derived from the immutable artifact on every read ─────────────── */
  sheets: z.array(z.string().min(1)).min(1),
  sheet: z.string().min(1),
  headerCandidates: z.array(ServedHeaderCandidateSchema),
  headerDiscoveryReason: HeaderDiscoverySchema.shape.reason,
  /** Null while no header row is settled — and then there are no columns. */
  headerRowIndex: z.number().int().nonnegative().nullable(),
  headerFingerprint: FingerprintSchema.nullable(),
  columns: z.array(DetectedColumnSchema),
  rowCount: z.number().int().nonnegative(),

  /* ── the workflow's declared targets, and the operator's decisions ────── */
  targets: z.array(IntakeTargetSchema),
  bindings: z.array(ColumnBindingSchema),
  constants: z.array(IntakeConstantSchema),
  corrections: z.array(IntakeRowCorrectionSchema),
  exclusions: z.array(IntakeRowExclusionSchema),
  /** Proposals only. Never pre-applied, never folded into `bindings`. */
  suggestions: z.array(SuggestionSchema),
  validation: IntakeValidationWireSchema,
  /** Absent when these bytes have never been enqueued for this workflow. */
  rerun: IntakeRerunWireSchema.optional(),
});
export type IntakeSessionWire = z.infer<typeof IntakeSessionWireSchema>;
