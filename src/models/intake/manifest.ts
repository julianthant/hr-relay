/** The intake plan manifest: which file and mapping were used, which rows became which items, which cells were corrected, and the exact validated input hashes. */
import { z } from "zod";
import { JsonValueSchema, canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { BoundaryIssueSchema } from "../failures/boundary-failure.js";
import {
  ArtifactIdSchema,
  FingerprintSchema,
  IntakeManifestIdSchema,
  IntakeTargetFieldIdSchema,
  IsoInstantSchema,
  ItemIdSchema,
  RowRejectIdSchema,
  SourceColumnIdSchema,
  WorkflowIdSchema,
  type RowRejectId,
} from "../../rules/identity/ids.js";
import { RedactedValueSchema } from "../../rules/redaction/redaction.js";
import { sha256Hex } from "../../rules/validation/sha256.js";

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

/** A rejection's identity is a function of what it is about, so revalidating a corrected file does not mint a second id. */
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
    /* The parsed workflow input under the generic canonical-JSON envelope: readers resolve the named descriptor and parse it through the manifest's pinned canonical schema. */
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

interface IntakeManifestRowFacts {
  readonly totals: z.infer<typeof IntakeManifestTotalsSchema>;
  readonly sourceRowDispositions: readonly z.infer<typeof SourceRowDispositionSchema>[];
  readonly validRows: readonly z.infer<typeof ValidRowSchema>[];
}

interface IntakeManifestRowIssue {
  readonly message: string;
  readonly path: readonly (string | number)[];
}

/** The row/totals invariant shared by durable storage and terminal wire. */
function intakeManifestRowIssues(manifest: IntakeManifestRowFacts): readonly IntakeManifestRowIssue[] {
  const issues: IntakeManifestRowIssue[] = [];
  const issue = (message: string, path: readonly (string | number)[] = []): void => {
    issues.push({ message, path });
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

  const validRowNumbers = new Set(manifest.validRows.map((row) => row.sourceRow));
  if (validRowNumbers.size !== manifest.validRows.length) issue("validRows repeats a source row");
  const validItemIds = new Set(manifest.validRows.map((row) => row.itemId));
  if (validItemIds.size !== manifest.validRows.length) issue("validRows repeats a stable item identity");
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

  return issues;
}

const IntakeManifestTerminalFields = {
  manifestId: IntakeManifestIdSchema,
  mappingFingerprint: FingerprintSchema,
  mappingSnapshotHash: FingerprintSchema,
  intakeProjectionFingerprint: FingerprintSchema,
  workflowContractFingerprint: FingerprintSchema,
  canonicalInputSchemaHash: FingerprintSchema,
  createdAt: IsoInstantSchema,
  totals: IntakeManifestTotalsSchema,
  sourceRowDispositions: z.array(SourceRowDispositionSchema),
  validRows: z.array(ValidRowSchema),
} as const;

export const IntakeManifestTerminalProjectionSchema = z.strictObject(IntakeManifestTerminalFields)
  .superRefine((manifest, context) => {
    for (const rowIssue of intakeManifestRowIssues(manifest)) {
      context.addIssue({ code: "custom", message: rowIssue.message, path: [...rowIssue.path] });
    }
  });

export const IntakePlanManifestSchema = z.strictObject({
  version: z.literal(1),
  workflow: WorkflowIdSchema,
  source: z.strictObject({
    artifactId: ArtifactIdSchema,
    sha256: FingerprintSchema,
    originalName: z.string().min(1),
  }),
  ...IntakeManifestTerminalFields,
  rejectedRows: z.array(RowRejectSchema),
  corrections: z.array(IntakeCorrectionSchema),
  exclusions: z.array(IntakeExclusionSchema),
}).superRefine((manifest, context) => {
  const issue = (message: string, path: (string | number)[] = []): void => {
    context.addIssue({ code: "custom", message, path });
  };

  const rows = manifest.sourceRowDispositions;
  for (const rowIssue of intakeManifestRowIssues(manifest)) {
    issue(rowIssue.message, [...rowIssue.path]);
  }
  if (manifest.totals.rejectionEvents !== manifest.rejectedRows.length) {
    issue("totals.rejectionEvents disagrees with the recorded rejection history", ["totals", "rejectionEvents"]);
  }
  if (manifest.totals.corrected !== manifest.corrections.length) {
    issue("totals.corrected disagrees with the recorded corrections", ["totals", "corrected"]);
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
    if (!rows.some((row) => row.sourceRow === correction.sourceRow)) {
      issue(`correction names source row ${String(correction.sourceRow)}, which the file does not have`);
    }
  }

});
export type IntakePlanManifest = z.infer<typeof IntakePlanManifestSchema>;

/** Assemble one immutable manifest from a validation pass; the dispositions and totals are computed here, so the refinement checks a derivation. */
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

/** The visible diff a "rerun with existing data" must show before it creates a new run: any moved fact is a NEW plan, never a silent reparse. */
export const RerunDiffSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("same-plan") }),
  z.strictObject({
    kind: z.literal("changed"),
    changes: z.array(z.strictObject({
      what: z.enum(["source-artifact", "mapping", "intake-projection", "workflow-contract", "canonical-input-schema"]),
      was: z.string().min(1),
      now: z.string().min(1),
    })),
    /** Rows valid in the current plan whose stable item identity was absent before. */
    added: z.array(ValidRowSchema),
    /** Rows valid in the prior manifest whose stable item identity is absent now. */
    removed: z.array(ValidRowSchema),
    /** Same stable item, different canonical input; hashes are safe to serve. */
    changedInputs: z.array(z.strictObject({
      itemId: ItemIdSchema,
      beforeInputHash: FingerprintSchema,
      afterInputHash: FingerprintSchema,
    }).refine(
      (change) => change.beforeInputHash !== change.afterInputHash,
      { message: "a changed input names different before and after hashes" },
    )),
  }).superRefine((diff, context) => {
    if (
      diff.changes.length === 0
      && diff.added.length === 0
      && diff.removed.length === 0
      && diff.changedInputs.length === 0
    ) {
      context.addIssue({
        code: "custom",
        message: "a changed rerun diff names an axis change, an added item, a removed item, or changed input",
      });
    }
    const addedItemIds = new Set(diff.added.map((row) => row.itemId));
    if (addedItemIds.size !== diff.added.length) {
      context.addIssue({ code: "custom", path: ["added"], message: "added repeats a stable item identity" });
    }
    const removedItemIds = new Set(diff.removed.map((row) => row.itemId));
    if (removedItemIds.size !== diff.removed.length) {
      context.addIssue({ code: "custom", path: ["removed"], message: "removed repeats a stable item identity" });
    }
    const changedItemIds = new Set(diff.changedInputs.map((change) => change.itemId));
    if (changedItemIds.size !== diff.changedInputs.length) {
      context.addIssue({
        code: "custom",
        path: ["changedInputs"],
        message: "changedInputs repeats a stable item identity",
      });
    }
    for (const itemId of addedItemIds) {
      if (removedItemIds.has(itemId)) {
        context.addIssue({
          code: "custom",
          path: ["added"],
          message: `stable item ${itemId} cannot be both added and removed`,
        });
      }
    }
    for (const itemId of changedItemIds) {
      if (addedItemIds.has(itemId) || removedItemIds.has(itemId)) {
        context.addIssue({
          code: "custom",
          path: ["changedInputs"],
          message: `stable item ${itemId} cannot be changed input and added or removed`,
        });
      }
    }
  }),
]);
export type RerunDiff = z.infer<typeof RerunDiffSchema>;

const CurrentRerunStateSchema = z.strictObject({
  sourceSha256: FingerprintSchema,
  mappingSnapshotHash: FingerprintSchema,
  intakeProjectionFingerprint: FingerprintSchema,
  workflowContractFingerprint: FingerprintSchema,
  canonicalInputSchemaHash: FingerprintSchema,
  validRows: z.array(ValidRowSchema),
});

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
    validRows: readonly z.input<typeof ValidRowSchema>[];
  },
): RerunDiff {
  const priorManifest = IntakePlanManifestSchema.parse(manifest);
  const currentState = CurrentRerunStateSchema.parse(current);
  const changes: RerunChange[] = [];
  const compare = (
    what: "source-artifact" | "mapping" | "intake-projection" | "workflow-contract" | "canonical-input-schema",
    was: string,
    now: string,
  ): void => {
    if (was !== now) changes.push({ what, was, now });
  };
  compare("source-artifact", priorManifest.source.sha256, currentState.sourceSha256);
  compare("mapping", priorManifest.mappingSnapshotHash, currentState.mappingSnapshotHash);
  compare("intake-projection", priorManifest.intakeProjectionFingerprint, currentState.intakeProjectionFingerprint);
  compare("workflow-contract", priorManifest.workflowContractFingerprint, currentState.workflowContractFingerprint);
  compare("canonical-input-schema", priorManifest.canonicalInputSchemaHash, currentState.canonicalInputSchemaHash);

  const priorItemIds = new Set(priorManifest.validRows.map((row) => row.itemId));
  const currentItemIds = new Set(currentState.validRows.map((row) => row.itemId));
  if (currentItemIds.size !== currentState.validRows.length) {
    throw new Error("rerun diff current plan repeats a valid item identity");
  }
  // Diff membership by stable item identity; changed input hashes do not create removals/additions.
  const added = currentState.validRows.filter((row) => !priorItemIds.has(row.itemId));
  const removed = priorManifest.validRows.filter((row) => !currentItemIds.has(row.itemId));
  const priorByItemId = new Map(priorManifest.validRows.map((row) => [row.itemId, row]));
  const changedInputs = currentState.validRows.flatMap((row) => {
    const prior = priorByItemId.get(row.itemId);
    return prior !== undefined && prior.inputHash !== row.inputHash
      ? [{ itemId: row.itemId, beforeInputHash: prior.inputHash, afterInputHash: row.inputHash }]
      : [];
  });

  return changes.length === 0 && added.length === 0 && removed.length === 0 && changedInputs.length === 0
    ? RerunDiffSchema.parse({ kind: "same-plan" })
    : RerunDiffSchema.parse({ kind: "changed", changes, added, removed, changedInputs });
}

export function intakeInputHash(parsedInput: unknown) {
  return FingerprintSchema.parse(sha256Hex(`hrauto:intake-input:v1\0${canonicalJsonStringify(parsedInput)}`));
}

/** Whether this manifest may fan out; a valid ZERO-row intake refuses with `no-valid-rows` rather than launching nothing. */
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
