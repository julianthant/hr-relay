/** The intake session wire — the durable session joined with the re-derived parse view and suggestion hints, with `expectedVersion` served as the CAS token and rows never served. */
import { z } from "zod";
import { ArtifactRefSchema } from "../artifacts/artifacts.js";
import {
  FingerprintSchema,
  IntakeManifestIdSchema,
  IntakeSessionIdSchema,
  IsoInstantSchema,
  PositiveIntSchema,
  WorkflowIdSchema,
} from "../../rules/identity/ids.js";
import { ServedHeaderCandidateSchema, HeaderDiscoverySchema } from "../../rules/intake/header-discovery.js";
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
  WorkbookIntakeSourceSchema,
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

/** "This exact file has run before": the prior manifest is found by the session's own source digest, so the `source-artifact` axis is equal by construction and `diff` reports only the other axes. */
export const IntakeRerunWireSchema = z.strictObject({
  intakeManifestId: IntakeManifestIdSchema,
  createdAt: IsoInstantSchema,
  totals: IntakeManifestTotalsSchema,
  diff: RerunDiffSchema,
});
export type IntakeRerunWire = z.infer<typeof IntakeRerunWireSchema>;

/** The immutable terminal manifest an operator may inspect; before enqueue only the reservation exists, so the surface cannot claim a manifest has been written. */
export const IntakeManifestWireSchema = IntakeManifestTerminalProjectionSchema;
export type IntakeManifestWire = z.infer<typeof IntakeManifestWireSchema>;

export const IntakeSessionWireSchema = z.strictObject({
  wireVersion: z.literal(1),
  intakeSessionId: IntakeSessionIdSchema,
  workflow: WorkflowIdSchema,
  artifact: ArtifactRefSchema,
    /** The name the file was uploaded under; absent on a session predating the leaf. */
  sourceName: z.string().min(1).optional(),
  workbookSource: WorkbookIntakeSourceSchema.optional(),
  state: IntakeSessionStateSchema,
  /** The CAS token every intake command target carries. */
  expectedVersion: PositiveIntSchema,
  /** Exact served review; only open, validated, ready sessions can confirm enqueue. */
  reviewBinding: FingerprintSchema.optional(),
  comparisonManifestId: IntakeManifestIdSchema.optional(),
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
