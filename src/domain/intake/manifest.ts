/**
 * The intake plan manifest — doc 06 §5.
 *
 * This is the record that makes "42 rows ran" checkable. It proves which file
 * and mapping were used, which rows became which stable items, which cells the
 * operator corrected without rewriting the source, which rows were rejected or
 * explicitly excluded, and the exact validated input hashes.
 *
 * ## Current disposition is stored; totals are derived from it
 *
 * `rejectedRows` is immutable validation HISTORY — a row rejected at 10:02 and
 * corrected at 10:04 keeps its rejection event forever. So the manifest cannot
 * infer "is this row valid" by adding event arrays; it stores exactly one
 * current disposition per source row and derives every total from that. The
 * schema refines all of it: every source row from `1..sourceRows` appears
 * exactly once, `valid` carries an `itemId`, `rejected` carries at least one
 * CURRENT reject id, `excluded` carries neither, and the six totals must equal
 * what the dispositions say.
 *
 * That refinement is the mechanical form of §7 vector #12: a partial intake can
 * never look like every source row completed, because the counts are checked
 * against the per-row truth rather than accumulated alongside it.
 *
 * ## Why a reject id is derived, not minted
 *
 * The same defect on the same cell of the same file is the same rejection. If
 * ids were minted, re-validating after a correction would produce a second id
 * for a rejection the operator already saw, and the history would grow a
 * duplicate every pass. The fold is over the source artifact digest, the row,
 * the kind and the field — so revalidation is idempotent.
 *
 * ## Redaction
 *
 * A reject stores its offending cell as a `RedactedValue`, per the canonical
 * field's own declared `(classification, transform)`. The operator sees the
 * real cell in the intake grid, which reads the content-addressed source
 * artifact; the durable manifest never becomes a second copy of a person's
 * identifiers.
 */
import { z } from "zod";
import { JsonValueSchema, canonicalJsonStringify } from "../canonical-json.js";
import { BoundaryIssueSchema } from "../boundary-failure.js";
import {
  ArtifactIdSchema,
  CaptureSessionIdSchema,
  FingerprintSchema,
  IntakeManifestIdSchema,
  IntakeTargetFieldIdSchema,
  IsoInstantSchema,
  ItemIdSchema,
  PositiveIntSchema,
  RowRejectIdSchema,
  SourceColumnIdSchema,
  WorkflowIdSchema,
  type RowRejectId,
} from "../ids.js";
import { RedactedValueSchema } from "../redaction.js";
import { sha256Hex } from "../sha256.js";

export const IntakeErrorCodeSchema = z.enum([
  "unmapped-required",
  "cell-coercion",
  "field-schema",
  "workflow-schema",
  "duplicate-identity",
  "cross-field",
]);
export type IntakeErrorCode = z.infer<typeof IntakeErrorCodeSchema>;

const SourceColumnRefSchema = z.strictObject({
  sourceColumnId: SourceColumnIdSchema,
  header: z.string(),
});

const RejectLocation = {
  rejectId: RowRejectIdSchema,
  sourceRow: z.number().int().positive(),
  code: IntakeErrorCodeSchema,
  reason: z.string().min(1),
} as const;

export const RowRejectSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...RejectLocation,
    kind: z.literal("unmapped-required"),
    field: IntakeTargetFieldIdSchema,
  }),
  z.strictObject({
    ...RejectLocation,
    kind: z.literal("cell-coercion"),
    field: IntakeTargetFieldIdSchema,
    column: SourceColumnRefSchema,
    raw: RedactedValueSchema,
  }),
  z.strictObject({
    ...RejectLocation,
    kind: z.literal("field-schema"),
    field: IntakeTargetFieldIdSchema,
    column: SourceColumnRefSchema,
    raw: RedactedValueSchema,
    issues: z.array(BoundaryIssueSchema).min(1),
  }),
  z.strictObject({
    ...RejectLocation,
    kind: z.literal("workflow-schema"),
    path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
    issues: z.array(BoundaryIssueSchema).min(1),
  }),
  z.strictObject({
    ...RejectLocation,
    kind: z.literal("duplicate-identity"),
    itemId: ItemIdSchema,
    collidingSourceRows: z.array(z.number().int().positive()).min(2),
  }),
  z.strictObject({
    ...RejectLocation,
    kind: z.literal("cross-field"),
    paths: z.array(IntakeTargetFieldIdSchema).min(2),
    issues: z.array(BoundaryIssueSchema).min(1),
  }),
]);
export type RowReject = z.infer<typeof RowRejectSchema>;

/**
 * A rejection's identity is a function of what it is about, so revalidating a
 * corrected file does not mint a second id for a defect already recorded.
 */
export function deriveRowRejectId(args: {
  sourceSha256: string;
  sourceRow: number;
  kind: RowReject["kind"];
  /** The target field, input path, or item id the rejection is about. */
  subject: string;
}): RowRejectId {
  const digest = sha256Hex(
    `hrauto:intake-reject:v1\0${args.sourceSha256}\0${String(args.sourceRow)}\0${args.kind}\0${args.subject}`,
  );
  const variant = "89ab"[Number.parseInt(digest[16], 16) % 4];
  return RowRejectIdSchema.parse([
    digest.slice(0, 8),
    digest.slice(8, 12),
    `5${digest.slice(13, 16)}`,
    `${variant}${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-"));
}

export const SourceRowDispositionSchema = z.strictObject({
  sourceRow: z.number().int().positive(),
  disposition: z.enum(["valid", "rejected", "excluded"]),
  itemId: ItemIdSchema.optional(),
  currentRejectIds: z.array(RowRejectIdSchema),
});

export const ValidRowSchema = z.strictObject({
  sourceRow: z.number().int().positive(),
  itemId: ItemIdSchema,
  inputHash: FingerprintSchema,
  /**
   * The parsed workflow input, under the generic canonical-JSON envelope only
   * because one manifest schema covers many workflows. **No caller reads this
   * as a workflow input.** Manifest load, rerun and enqueue resolve the named
   * descriptor and parse each value through its exact current transform-free
   * canonical schema, whose identity is pinned once per manifest as
   * `canonicalInputSchemaHash` (D62/D110). A parse failure quarantines the
   * manifest; it never reaches a task bind.
   */
  parsedInput: JsonValueSchema,
});

export const IntakeCorrectionSchema = z.strictObject({
  sourceRow: z.number().int().positive(),
  field: IntakeTargetFieldIdSchema,
  /** Redacted: corrections never rewrite the immutable source artifact. */
  original: RedactedValueSchema,
  correctedValue: JsonValueSchema,
  correctedAt: IsoInstantSchema,
});

export const IntakeExclusionSchema = z.strictObject({
  sourceRow: z.number().int().positive(),
  reason: z.string().min(1),
  operatorConfirmedAt: IsoInstantSchema,
});

/** Derived from the dispositions, never accumulated beside them (§7 #12). */
export const IntakeManifestTotalsSchema = z.strictObject({
  sourceRows: z.number().int().nonnegative(),
  valid: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  rejectionEvents: z.number().int().nonnegative(),
  excluded: z.number().int().nonnegative(),
  corrected: z.number().int().nonnegative(),
});
export type IntakeManifestTotals = z.infer<typeof IntakeManifestTotalsSchema>;

export const IntakePlanManifestSchema = z.strictObject({
  version: z.literal(1),
  manifestId: IntakeManifestIdSchema,
  workflow: WorkflowIdSchema,
  source: z.strictObject({
    artifactId: ArtifactIdSchema,
    sha256: FingerprintSchema,
    originalName: z.string().min(1),
  }),
  mappingFingerprint: FingerprintSchema,
  mappingSnapshotHash: FingerprintSchema,
  intakeProjectionFingerprint: FingerprintSchema,
  workflowContractFingerprint: FingerprintSchema,
  /** The schema every `parsedInput` was produced by, and must be re-read with. */
  canonicalInputSchemaHash: FingerprintSchema,
  createdAt: IsoInstantSchema,
  /**
   * Present exactly when this manifest's source is a finalized phone-capture
   * bundle rather than an uploaded spreadsheet (D174, doc 06 §5.1).
   *
   * §5.1 requires the bundle's manifest to name "a FileRef, source digest,
   * capture-session id, ordered photo digests, and form/workflow binding". The
   * first two and the last are already `source` and `workflow`; the two that
   * are capture's alone live here. It is OPTIONAL rather than a discriminated
   * `source` union so every manifest written before D174 still parses (D133:
   * a durable schema is read forward, never back-filled), and its ABSENCE is
   * the honest statement "this manifest came from a spreadsheet".
   */
  capture: z.strictObject({
    captureSessionId: CaptureSessionIdSchema,
    finalizationGeneration: PositiveIntSchema,
    /** In page order — the bundle IS the order (doc 06 §5.1). */
    orderedPhotoSha256: z.array(FingerprintSchema).min(1),
  }).optional(),
  totals: IntakeManifestTotalsSchema,
  sourceRowDispositions: z.array(SourceRowDispositionSchema),
  validRows: z.array(ValidRowSchema),
  rejectedRows: z.array(RowRejectSchema),
  corrections: z.array(IntakeCorrectionSchema),
  exclusions: z.array(IntakeExclusionSchema),
}).superRefine((manifest, context) => {
  const issue = (message: string, path: (string | number)[] = []): void => {
    context.addIssue({ code: "custom", message, path });
  };

  const rows = manifest.sourceRowDispositions;
  const seen = new Set<number>();
  for (const row of rows) {
    if (seen.has(row.sourceRow)) issue(`source row ${String(row.sourceRow)} has more than one disposition`);
    seen.add(row.sourceRow);
    if (row.sourceRow > manifest.totals.sourceRows) {
      issue(`source row ${String(row.sourceRow)} is beyond the file's ${String(manifest.totals.sourceRows)} rows`);
    }
    if (row.disposition === "valid") {
      if (row.itemId === undefined) issue(`source row ${String(row.sourceRow)} is valid but names no item`);
      if (row.currentRejectIds.length > 0) {
        issue(`source row ${String(row.sourceRow)} is valid but still carries a current rejection`);
      }
    }
    if (row.disposition === "rejected") {
      if (row.currentRejectIds.length === 0) {
        issue(`source row ${String(row.sourceRow)} is rejected but names no current rejection`);
      }
      if (row.itemId !== undefined) issue(`source row ${String(row.sourceRow)} is rejected but names an item`);
    }
    if (row.disposition === "excluded") {
      if (row.itemId !== undefined) issue(`source row ${String(row.sourceRow)} is excluded but names an item`);
      if (row.currentRejectIds.length > 0) {
        issue(`source row ${String(row.sourceRow)} is excluded but still carries a current rejection`);
      }
    }
  }
  if (rows.length !== manifest.totals.sourceRows) {
    issue(`${String(rows.length)} dispositions cover a file of ${String(manifest.totals.sourceRows)} rows`);
  }
  for (let row = 1; row <= manifest.totals.sourceRows; row += 1) {
    if (!seen.has(row)) issue(`source row ${String(row)} has no disposition`);
  }

  // Totals are DERIVED. A manifest whose counts disagree with its own
  // dispositions is the "done implies every row ran" failure (§7 #12).
  const derived = {
    valid: rows.filter((row) => row.disposition === "valid").length,
    rejected: rows.filter((row) => row.disposition === "rejected").length,
    excluded: rows.filter((row) => row.disposition === "excluded").length,
  };
  if (manifest.totals.valid !== derived.valid) {
    issue(`totals.valid ${String(manifest.totals.valid)} disagrees with ${String(derived.valid)} valid dispositions`, ["totals", "valid"]);
  }
  if (manifest.totals.rejected !== derived.rejected) {
    issue(`totals.rejected ${String(manifest.totals.rejected)} disagrees with ${String(derived.rejected)} rejected dispositions`, ["totals", "rejected"]);
  }
  if (manifest.totals.excluded !== derived.excluded) {
    issue(`totals.excluded ${String(manifest.totals.excluded)} disagrees with ${String(derived.excluded)} excluded dispositions`, ["totals", "excluded"]);
  }
  if (manifest.totals.rejectionEvents !== manifest.rejectedRows.length) {
    issue("totals.rejectionEvents disagrees with the recorded rejection history", ["totals", "rejectionEvents"]);
  }
  if (manifest.totals.corrected !== manifest.corrections.length) {
    issue("totals.corrected disagrees with the recorded corrections", ["totals", "corrected"]);
  }

  const validRowNumbers = new Set(manifest.validRows.map((row) => row.sourceRow));
  if (validRowNumbers.size !== manifest.validRows.length) issue("validRows repeats a source row");
  for (const row of rows) {
    if (row.disposition === "valid" && !validRowNumbers.has(row.sourceRow)) {
      issue(`source row ${String(row.sourceRow)} is valid but has no parsed input`);
    }
  }
  for (const valid of manifest.validRows) {
    const disposition = rows.find((row) => row.sourceRow === valid.sourceRow);
    if (disposition?.disposition !== "valid") {
      issue(`validRows carries source row ${String(valid.sourceRow)}, which is not currently valid`);
    } else if (disposition.itemId !== valid.itemId) {
      issue(`source row ${String(valid.sourceRow)} names a different item than its parsed input does`);
    }
  }

  const rejectIds = new Set(manifest.rejectedRows.map((reject) => reject.rejectId));
  if (rejectIds.size !== manifest.rejectedRows.length) issue("rejectedRows repeats a rejection id");
  for (const row of rows) {
    for (const rejectId of row.currentRejectIds) {
      if (!rejectIds.has(rejectId)) {
        issue(`source row ${String(row.sourceRow)} cites rejection ${rejectId}, which is not in the history`);
      }
    }
  }

  const excludedRows = new Set(manifest.exclusions.map((exclusion) => exclusion.sourceRow));
  if (excludedRows.size !== manifest.exclusions.length) issue("exclusions repeats a source row");
  for (const row of rows) {
    if (row.disposition === "excluded" && !excludedRows.has(row.sourceRow)) {
      issue(`source row ${String(row.sourceRow)} is excluded with no recorded operator confirmation`);
    }
  }
  for (const exclusion of manifest.exclusions) {
    if (rows.find((row) => row.sourceRow === exclusion.sourceRow)?.disposition !== "excluded") {
      issue(`exclusions carries source row ${String(exclusion.sourceRow)}, which is not currently excluded`);
    }
  }
  for (const correction of manifest.corrections) {
    if (!seen.has(correction.sourceRow)) {
      issue(`correction names source row ${String(correction.sourceRow)}, which the file does not have`);
    }
  }

  // A capture bundle is ONE document. There is no grid to correct a cell in
  // and no row to exclude, so a capture manifest carrying either would be
  // describing a mapping session that never happened.
  if (manifest.capture !== undefined) {
    if (manifest.totals.sourceRows !== 1) {
      issue(
        `a capture bundle is one document, but this manifest claims ${String(manifest.totals.sourceRows)} source rows`,
        ["capture"],
      );
    }
    if (manifest.corrections.length > 0) issue("a capture bundle has no cells to correct", ["capture"]);
    if (manifest.exclusions.length > 0) issue("a capture bundle has no rows to exclude", ["capture"]);
  }
});
export type IntakePlanManifest = z.infer<typeof IntakePlanManifestSchema>;

/**
 * Assemble one immutable manifest from a validation pass.
 *
 * The dispositions are computed here from the pass rather than supplied, and
 * the totals are computed from the dispositions, so the schema's refinement is
 * checking a derivation rather than restating an assumption. `rejectionHistory`
 * is the union of everything ever recorded for this file — a corrected row
 * keeps its earlier rejection event and loses only its CURRENT reject ids.
 */
export function buildIntakeManifest(args: {
  manifestId: string;
  workflow: string;
  source: { artifactId: string; sha256: string; originalName: string };
  mappingFingerprint: string;
  mappingSnapshotHash: string;
  intakeProjectionFingerprint: string;
  workflowContractFingerprint: string;
  canonicalInputSchemaHash: string;
  createdAt: string;
  /** Present only for a phone-capture bundle (D174). */
  capture?: {
    captureSessionId: string;
    finalizationGeneration: number;
    orderedPhotoSha256: readonly string[];
  };
  sourceRows: number;
  valid: readonly { sourceRow: number; itemId: string; inputHash: string; parsedInput: unknown }[];
  currentRejects: ReadonlyMap<number, readonly string[]>;
  rejectionHistory: readonly RowReject[];
  corrections: readonly z.input<typeof IntakeCorrectionSchema>[];
  exclusions: readonly z.input<typeof IntakeExclusionSchema>[];
}): IntakePlanManifest {
  const excluded = new Set(args.exclusions.map((exclusion) => exclusion.sourceRow));
  const validByRow = new Map(args.valid.map((row) => [row.sourceRow, row]));

  const dispositions: z.input<typeof SourceRowDispositionSchema>[] = [];
  for (let sourceRow = 1; sourceRow <= args.sourceRows; sourceRow += 1) {
    if (excluded.has(sourceRow)) {
      dispositions.push({ sourceRow, disposition: "excluded", currentRejectIds: [] });
      continue;
    }
    const current = args.currentRejects.get(sourceRow) ?? [];
    if (current.length > 0) {
      dispositions.push({ sourceRow, disposition: "rejected", currentRejectIds: [...current] });
      continue;
    }
    const validRow = validByRow.get(sourceRow);
    if (validRow === undefined) {
      throw new Error(
        `intake manifest cannot be built: source row ${String(sourceRow)} is neither valid, rejected, nor excluded`,
      );
    }
    dispositions.push({ sourceRow, disposition: "valid", itemId: validRow.itemId, currentRejectIds: [] });
  }

  return IntakePlanManifestSchema.parse({
    version: 1,
    manifestId: args.manifestId,
    workflow: args.workflow,
    source: args.source,
    mappingFingerprint: args.mappingFingerprint,
    mappingSnapshotHash: args.mappingSnapshotHash,
    intakeProjectionFingerprint: args.intakeProjectionFingerprint,
    workflowContractFingerprint: args.workflowContractFingerprint,
    canonicalInputSchemaHash: args.canonicalInputSchemaHash,
    createdAt: args.createdAt,
    ...(args.capture === undefined ? {} : { capture: args.capture }),
    totals: {
      sourceRows: args.sourceRows,
      valid: dispositions.filter((row) => row.disposition === "valid").length,
      rejected: dispositions.filter((row) => row.disposition === "rejected").length,
      rejectionEvents: args.rejectionHistory.length,
      excluded: dispositions.filter((row) => row.disposition === "excluded").length,
      corrected: args.corrections.length,
    },
    sourceRowDispositions: dispositions,
    validRows: args.valid
      .filter((row) => !excluded.has(row.sourceRow) && (args.currentRejects.get(row.sourceRow) ?? []).length === 0)
      .map((row) => ({
        sourceRow: row.sourceRow,
        itemId: row.itemId,
        inputHash: row.inputHash,
        parsedInput: row.parsedInput,
      })),
    rejectedRows: args.rejectionHistory,
    corrections: args.corrections,
    exclusions: args.exclusions,
  });
}

/**
 * The visible diff a "rerun with existing data" must show before it creates a
 * new run — doc 06 §7 vector #11.
 *
 * A rerun references an immutable manifest and an immutable artifact. If the
 * file, the mapping, the projection or the workflow contract has moved, that is
 * a NEW plan the operator confirms, never a silent reparse.
 */
export const RerunDiffSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("same-plan") }),
  z.strictObject({
    kind: z.literal("changed"),
    changes: z.array(z.strictObject({
      what: z.enum(["source-artifact", "mapping", "intake-projection", "workflow-contract", "canonical-input-schema"]),
      was: z.string().min(1),
      now: z.string().min(1),
    })).min(1),
  }),
]);
export type RerunDiff = z.infer<typeof RerunDiffSchema>;

type RerunChange = z.infer<typeof RerunDiffSchema> extends infer Diff
  ? Diff extends { kind: "changed"; changes: readonly (infer Change)[] } ? Change : never
  : never;

export function rerunDiff(
  manifest: IntakePlanManifest,
  current: {
    sourceSha256: string;
    mappingSnapshotHash: string;
    intakeProjectionFingerprint: string;
    workflowContractFingerprint: string;
    canonicalInputSchemaHash: string;
  },
): RerunDiff {
  const changes: RerunChange[] = [];
  const compare = (
    what: "source-artifact" | "mapping" | "intake-projection" | "workflow-contract" | "canonical-input-schema",
    was: string,
    now: string,
  ): void => {
    if (was !== now) changes.push({ what, was, now });
  };
  compare("source-artifact", manifest.source.sha256, current.sourceSha256);
  compare("mapping", manifest.mappingSnapshotHash, current.mappingSnapshotHash);
  compare("intake-projection", manifest.intakeProjectionFingerprint, current.intakeProjectionFingerprint);
  compare("workflow-contract", manifest.workflowContractFingerprint, current.workflowContractFingerprint);
  compare("canonical-input-schema", manifest.canonicalInputSchemaHash, current.canonicalInputSchemaHash);
  return changes.length === 0
    ? RerunDiffSchema.parse({ kind: "same-plan" })
    : RerunDiffSchema.parse({ kind: "changed", changes });
}

export function intakeInputHash(parsedInput: unknown) {
  return FingerprintSchema.parse(sha256Hex(`hrauto:intake-input:v1\0${canonicalJsonStringify(parsedInput)}`));
}

/**
 * Whether this manifest may fan out — doc 06 §2.2 step 4 and §5.
 *
 * A valid ZERO-row intake is NOT a no-op success. An operator who uploaded the
 * wrong sheet, or whose every row failed, must see `no-valid-rows` and an
 * inspectable manifest rather than a run that reports done having launched
 * nothing.
 */
export const EnqueueReadinessSchema = z.discriminatedUnion("ready", [
  z.strictObject({ ready: z.literal(true), enqueueCount: z.number().int().positive() }),
  z.strictObject({
    ready: z.literal(false),
    reason: z.enum(["no-valid-rows", "unresolved-rejections"]),
    message: z.string().min(1),
    unresolvedRows: z.array(z.number().int().positive()),
  }),
]);
export type EnqueueReadiness = z.infer<typeof EnqueueReadinessSchema>;

export function enqueueReadiness(manifest: IntakePlanManifest): EnqueueReadiness {
  const unresolved = manifest.sourceRowDispositions
    .filter((row) => row.disposition === "rejected")
    .map((row) => row.sourceRow)
    .sort((left, right) => left - right);
  if (unresolved.length > 0) {
    return EnqueueReadinessSchema.parse({
      ready: false,
      reason: "unresolved-rejections",
      message:
        `${String(unresolved.length)} of ${String(manifest.totals.sourceRows)} source rows are still rejected; `
        + "fix each cell or exclude the row before running",
      unresolvedRows: unresolved,
    });
  }
  if (manifest.totals.valid === 0) {
    return EnqueueReadinessSchema.parse({
      ready: false,
      reason: "no-valid-rows",
      message: "this file produced no valid rows; nothing would be enqueued",
      unresolvedRows: [],
    });
  }
  return EnqueueReadinessSchema.parse({ ready: true, enqueueCount: manifest.totals.valid });
}
