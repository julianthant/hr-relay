/**
 * The intake session wire (ref data-intake-and-edit-data §2.2, D170) — what the upload route returns
 * and what `GET /api/v1/intake/:sessionId` serves.
 *
 * It is the durable session JOINED with the re-derived parse view and the
 * suggestion hints, because a mapping grid cannot be drawn from either half
 * alone. Three properties are load-bearing:
 *
 * 1. **`expectedVersion` is the CAS token** every intake command target
 *    carries, served in its own right so a surface never has to invent one.
 * 2. **Suggestions are HINTS** (ref data-intake-and-edit-data §2.5). They ride beside `bindings` and
 *    are never folded into it: only `confirmBinding`, reached from an operator
 *    action, mints a binding, and the wire preserves that separation so a
 *    client cannot accidentally render a proposal as a decision.
 * 3. **Rows are not served.** Ref data-intake-and-edit-data §2.2 step 1 is explicit — sample values
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
  IntakeManifestTerminalProjectionSchema,
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
    /** Current unresolved rows, separate from retained rejection history. */
    unresolvedRows: z.array(PositiveIntSchema),
    rejected: z.array(RowRejectSchema),
    excluded: z.array(PositiveIntSchema),
  }),
]);
export type IntakeValidationWire = z.infer<typeof IntakeValidationWireSchema>;

/**
 * "This exact file has run before" — ref data-intake-and-edit-data §7 vector #11, served (D171).
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

/**
 * The immutable terminal manifest an operator may inspect. This is never a
 * preflight prediction: before enqueue only the separately served reservation
 * exists, so the surface cannot claim a manifest has already been written.
 * Its field schemas and row refinements are owned beside the durable manifest,
 * so this reviewed projection cannot drift into a second totals contract.
 */
export const IntakeManifestWireSchema = IntakeManifestTerminalProjectionSchema;
export type IntakeManifestWire = z.infer<typeof IntakeManifestWireSchema>;

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
  /** Exact served review; only open, validated, ready sessions can confirm enqueue. */
  reviewBinding: FingerprintSchema.optional(),
  /** Absent only on a durable session created before manifest identities were reserved at upload. */
  reservedManifestId: IntakeManifestIdSchema.optional(),
  /** Set exactly when the session enqueued; the manifest is the rerun authority. */
  intakeManifestId: IntakeManifestIdSchema.optional(),
  /** Present only after authority committed the immutable manifest. */
  manifest: IntakeManifestWireSchema.optional(),
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
  if (session.state === "enqueued" && session.manifest === undefined) {
    context.addIssue({
      code: "custom",
      path: ["manifest"],
      message: "an enqueued session serves the immutable manifest it committed",
    });
  }
  if (session.state !== "enqueued" && session.manifest !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["manifest"],
      message: "a manifest exists only after the session enqueues",
    });
  }
  if (
    session.manifest !== undefined
    && session.intakeManifestId !== undefined
    && session.manifest.manifestId !== session.intakeManifestId
  ) {
    context.addIssue({
      code: "custom",
      path: ["manifest", "manifestId"],
      message: "the terminal manifest matches the session's committed manifest id",
    });
  }
  if (
    session.rerun !== undefined
    && session.intakeManifestId !== undefined
    && session.rerun.intakeManifestId !== session.intakeManifestId
  ) {
    context.addIssue({
      code: "custom",
      path: ["rerun", "intakeManifestId"],
      message: "the terminal rerun matches the session's committed manifest id",
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
});
export type IntakeSessionWire = z.infer<typeof IntakeSessionWireSchema>;
