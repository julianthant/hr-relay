/**
 * Operator column mapping — ref data-intake-and-edit-data §2.
 *
 * Three separate ideas live here, and keeping them separate is what makes the
 * design fail closed:
 *
 * 1. **`SourceColumnId`** identifies a detected column by its normalized header
 *    AND its occurrence, never by position. Two `Name` columns stay distinct,
 *    and a column inserted to the left of a bound one does not silently rebind.
 * 2. **The header fingerprint** identifies a whole LAYOUT, order-insensitively,
 *    so last week's mapping can be offered for this week's identical export.
 * 3. **Resolution** decides, per binding, whether that offer still holds. A
 *    fingerprint hit is not a licence to reuse: every binding is re-resolved
 *    against the columns actually present, and anything that cannot be proved
 *    reverts to unbound and loud.
 *
 * ## Why the stored index can never bind
 *
 * A saved mapping records `currentIndex` purely so the UI can say "the column
 * moved". It is never a fallback. If `eid` was bound to a column that is now
 * absent, falling back to "whatever is at index 3" would bind a DIFFERENT
 * column and launch real HR transactions against the wrong people — ref data-intake-and-edit-data §2.3
 * calls this out, and ref data-intake-and-edit-data §7 vector #3 is the guarded form of it.
 *
 * ## Why duplicate headers demand confirmation
 *
 * If a layout has two columns both spelled `Name`, and the export reorders
 * them, occurrence 1 and occurrence 2 have swapped meaning and NOTHING in the
 * file says so. Reuse of a binding that involves a duplicated header is
 * therefore marked `confirmation-required`: the operator looks at the sample
 * values before Run enables.
 */
import { z } from "zod";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import {
  FingerprintSchema,
  IntakeTargetFieldIdSchema,
  IsoInstantSchema,
  SourceColumnIdSchema,
  WorkflowIdSchema,
  type Fingerprint,
  type IntakeTargetFieldId,
  type SourceColumnId,
} from "../../rules/identity/ids.js";
import { sha256Hex } from "../../rules/validation/sha256.js";
import { CanonicalFieldIdSchema, normalizeHeader } from "../fields/registry.js";
import type { IntakeProjection } from "./projection.js";

/** A column the extraction task detected, before any operator decision. */
export const DetectedColumnSchema = z.strictObject({
  sourceColumnId: SourceColumnIdSchema,
  /** The header exactly as the file spells it — shown to the operator verbatim. */
  header: z.string(),
  normalizedHeader: z.string(),
  /** 1-based, among columns sharing this normalized header. */
  occurrence: z.number().int().positive(),
  /** Diagnostic only. Never used to resolve a binding (§2.3). */
  currentIndex: z.number().int().nonnegative(),
  /** A few real values, so the operator can confirm what a column holds. */
  samples: z.array(z.string()),
});
export type DetectedColumn = z.infer<typeof DetectedColumnSchema>;

export const ColumnBindingSchema = z.strictObject({
  targetFieldId: IntakeTargetFieldIdSchema,
  canonicalFieldId: CanonicalFieldIdSchema,
  sourceColumnId: SourceColumnIdSchema,
  confirmedAt: IsoInstantSchema,
});
export type ColumnBinding = z.infer<typeof ColumnBindingSchema>;

export const ColumnMappingSchema = z.strictObject({
  workflow: WorkflowIdSchema,
  /** D66: the exact target-field set AND schemas this map was built against. */
  intakeProjectionFingerprint: FingerprintSchema,
  /** The layout this map was built for (§2.3). */
  fingerprint: FingerprintSchema,
  savedAt: IsoInstantSchema,
  headerRowIndex: z.number().int().nonnegative(),
  columns: z.array(DetectedColumnSchema.omit({ samples: true })),
  bindings: z.array(ColumnBindingSchema),
});
export type ColumnMapping = z.infer<typeof ColumnMappingSchema>;

/**
 * `base64url(canonicalJson({ normalizedHeader, occurrence }))` — ref data-intake-and-edit-data §2.1.
 *
 * Canonical JSON rather than delimiter concatenation because a delimiter can
 * be inside a header: `["a b","c"]` and `["a","b c"]` would collide under
 * `join("|")` on a header containing `|`, and two different columns sharing one
 * id is the same failure as binding by position.
 */
export function sourceColumnId(header: string, occurrence: number): SourceColumnId {
  if (!Number.isInteger(occurrence) || occurrence < 1) {
    throw new Error(`source column occurrence must be a positive integer, got ${String(occurrence)}`);
  }
  const canonical = canonicalJsonStringify({ normalizedHeader: normalizeHeader(header), occurrence });
  const base64 = btoa(String.fromCharCode(...new TextEncoder().encode(canonical)));
  return SourceColumnIdSchema.parse(base64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""));
}

/** Assign occurrences and stable ids to a raw header row, left to right. */
export function detectColumns(
  headers: readonly string[],
  samplesByIndex: readonly (readonly string[])[] = [],
): DetectedColumn[] {
  const occurrences = new Map<string, number>();
  return headers.map((header, index) => {
    const normalized = normalizeHeader(header);
    const occurrence = (occurrences.get(normalized) ?? 0) + 1;
    occurrences.set(normalized, occurrence);
    return DetectedColumnSchema.parse({
      sourceColumnId: sourceColumnId(header, occurrence),
      header,
      normalizedHeader: normalized,
      occurrence,
      currentIndex: index,
      samples: [...(samplesByIndex[index] ?? [])],
    });
  });
}

/**
 * Ref data-intake-and-edit-data §2.3's layout fingerprint: order-insensitive over
 * `{ normalized header, occurrence }` pairs.
 */
export function headerFingerprint(columns: readonly DetectedColumn[]): Fingerprint {
  const pairs = columns
    .map(({ normalizedHeader, occurrence }) => ({ header: normalizedHeader, occurrence }))
    .sort((left, right) =>
      left.header === right.header
        ? left.occurrence - right.occurrence
        : left.header.localeCompare(right.header));
  return FingerprintSchema.parse(sha256Hex(`hrauto:intake-header:v1\0${canonicalJsonStringify(pairs)}`));
}

/**
 * The manifest's `mappingSnapshotHash` (ref data-intake-and-edit-data §5, D171): the identity of the
 * DECISIONS a plan was built from, as opposed to `mappingFingerprint`, which is
 * the identity of the LAYOUT they were made against.
 *
 * It folds the sheet, the settled header row, the layout fingerprint, the
 * confirmed bindings and the run constants — and deliberately nothing else:
 *
 * - `confirmedAt` is excluded, because a mapping is WHAT it maps, not when the
 *   operator clicked. Folding the instant would make `rerunDiff` report a
 *   mapping change for a re-confirmed identical binding, and a diff that cries
 *   wolf is a diff nobody reads.
 * - corrections and exclusions are excluded, because they are row-level
 *   decisions the manifest records in full in their own arrays; §7 vector #11's
 *   question is "was this run planned the same WAY", not "were the same cells
 *   touched".
 *
 * Bindings and constants are sorted by target field id so two sessions that
 * reached the same mapping in a different ORDER hash the same.
 */
export function deriveMappingSnapshotHash(snapshot: Readonly<{
  workflow: string;
  sheet: string;
  headerRowIndex: number;
  headerFingerprint: string;
  bindings: readonly ColumnBinding[];
  constants: readonly { targetFieldId: IntakeTargetFieldId; value: unknown }[];
}>): Fingerprint {
  const byTarget = (left: { targetFieldId: string }, right: { targetFieldId: string }): number =>
    left.targetFieldId.localeCompare(right.targetFieldId);
  return FingerprintSchema.parse(sha256Hex(`hrauto:intake-mapping-snapshot:v1\0${canonicalJsonStringify({
    workflow: WorkflowIdSchema.parse(snapshot.workflow),
    sheet: snapshot.sheet,
    headerRowIndex: snapshot.headerRowIndex,
    headerFingerprint: FingerprintSchema.parse(snapshot.headerFingerprint),
    bindings: [...snapshot.bindings].sort(byTarget).map((binding) => ({
      targetFieldId: binding.targetFieldId,
      canonicalFieldId: binding.canonicalFieldId,
      sourceColumnId: binding.sourceColumnId,
    })),
    constants: [...snapshot.constants].sort(byTarget).map((constant) => ({
      targetFieldId: constant.targetFieldId,
      value: constant.value,
    })),
  })}`));
}

/**
 * What happened to one saved binding when it met the current layout.
 *
 * `held` is the only state that survives into a reusable binding without an
 * operator touch, and even it still shows in the grid before Run.
 */
export const BindingResolutionSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("held"),
    targetFieldId: IntakeTargetFieldIdSchema,
    sourceColumnId: SourceColumnIdSchema,
    header: z.string(),
  }),
  z.strictObject({
    state: z.literal("confirmation-required"),
    targetFieldId: IntakeTargetFieldIdSchema,
    sourceColumnId: SourceColumnIdSchema,
    header: z.string(),
    reason: z.enum(["duplicate-header", "column-moved"]),
    /** Present for `column-moved`, so the grid can say where it went. */
    movedFrom: z.number().int().nonnegative().optional(),
    movedTo: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({
    state: z.literal("unbound"),
    targetFieldId: IntakeTargetFieldIdSchema,
    reason: z.enum(["column-absent", "target-absent", "canonical-changed"]),
    /** The header the saved mapping used, so the message can name it. */
    savedHeader: z.string(),
    message: z.string().min(1),
  }),
]);
export type BindingResolution = z.infer<typeof BindingResolutionSchema>;

export const MappingReuseSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    outcome: z.literal("refused"),
    reason: z.enum(["workflow-mismatch", "projection-changed", "layout-mismatch"]),
    message: z.string().min(1),
  }),
  z.strictObject({
    outcome: z.literal("offered"),
    resolutions: z.array(BindingResolutionSchema),
    /** Required targets left with no `held`/`confirmation-required` binding. */
    unboundRequired: z.array(IntakeTargetFieldIdSchema),
    /** True when nothing needs an operator touch beyond the standard glance. */
    readyToRun: z.boolean(),
  }),
]);
export type MappingReuse = z.infer<typeof MappingReuseSchema>;

/**
 * Re-resolve a saved mapping against the layout actually detected.
 *
 * A fingerprint hit gets a mapping OFFERED, not applied: ref data-intake-and-edit-data §2.3 is
 * explicit that reuse is "reuse-with-a-glance, not a silent auto-run". Every
 * binding is proved again from the header + occurrence, and every failure mode
 * lands as its own state with its own message rather than as a quiet drop.
 */
export function resolveSavedMapping(args: {
  mapping: ColumnMapping;
  detected: readonly DetectedColumn[];
  projection: IntakeProjection;
  workflow: string;
}): MappingReuse {
  const { mapping, detected, projection } = args;

  if (mapping.workflow !== args.workflow) {
    return MappingReuseSchema.parse({
      outcome: "refused",
      reason: "workflow-mismatch",
      message: `saved mapping targets ${mapping.workflow}, not ${args.workflow}`,
    });
  }
  if (mapping.intakeProjectionFingerprint !== projection.fingerprint) {
    return MappingReuseSchema.parse({
      outcome: "refused",
      reason: "projection-changed",
      message:
        `saved mapping was built against intake projection ${mapping.intakeProjectionFingerprint.slice(0, 12)}, `
        + `which has since changed to ${projection.fingerprint.slice(0, 12)} — re-map`,
    });
  }
  if (headerFingerprint(detected) !== mapping.fingerprint) {
    return MappingReuseSchema.parse({
      outcome: "refused",
      reason: "layout-mismatch",
      message: "this file's columns are not the layout the saved mapping was built for — re-map",
    });
  }

  const byId = new Map(detected.map((column) => [column.sourceColumnId, column]));
  const duplicated = new Set(
    detected
      .filter((column) => detected.some((other) =>
        other !== column && other.normalizedHeader === column.normalizedHeader))
      .map((column) => column.normalizedHeader),
  );
  const savedById = new Map(mapping.columns.map((column) => [column.sourceColumnId, column]));

  const resolutions: BindingResolution[] = [];
  for (const binding of mapping.bindings) {
    const saved = savedById.get(binding.sourceColumnId);
    const savedHeader = saved?.header ?? "(unknown column)";
    const target = projection.target(binding.targetFieldId);
    if (target === undefined) {
      resolutions.push(BindingResolutionSchema.parse({
        state: "unbound",
        targetFieldId: binding.targetFieldId,
        reason: "target-absent",
        savedHeader,
        message: `saved mapping binds ${binding.targetFieldId}, which this workflow no longer accepts — re-map`,
      }));
      continue;
    }
    if (target.canonicalFieldId !== binding.canonicalFieldId) {
      resolutions.push(BindingResolutionSchema.parse({
        state: "unbound",
        targetFieldId: binding.targetFieldId,
        reason: "canonical-changed",
        savedHeader,
        message:
          `saved mapping bound ${binding.targetFieldId} as ${binding.canonicalFieldId}, `
          + `but it is now ${target.canonicalFieldId} — re-map`,
      }));
      continue;
    }

    const column = byId.get(binding.sourceColumnId);
    if (column === undefined) {
      // The load-bearing refusal. The stored index is NOT consulted.
      resolutions.push(BindingResolutionSchema.parse({
        state: "unbound",
        targetFieldId: binding.targetFieldId,
        reason: "column-absent",
        savedHeader,
        message:
          `saved mapping bound ${binding.targetFieldId} to column "${savedHeader}", `
          + "which is no longer present — re-map",
      }));
      continue;
    }
    if (duplicated.has(column.normalizedHeader)) {
      resolutions.push(BindingResolutionSchema.parse({
        state: "confirmation-required",
        targetFieldId: binding.targetFieldId,
        sourceColumnId: column.sourceColumnId,
        header: column.header,
        reason: "duplicate-header",
      }));
      continue;
    }
    if (saved !== undefined && saved.currentIndex !== column.currentIndex) {
      resolutions.push(BindingResolutionSchema.parse({
        state: "confirmation-required",
        targetFieldId: binding.targetFieldId,
        sourceColumnId: column.sourceColumnId,
        header: column.header,
        reason: "column-moved",
        movedFrom: saved.currentIndex,
        movedTo: column.currentIndex,
      }));
      continue;
    }
    resolutions.push(BindingResolutionSchema.parse({
      state: "held",
      targetFieldId: binding.targetFieldId,
      sourceColumnId: column.sourceColumnId,
      header: column.header,
    }));
  }

  const resolvedTargets = new Set(
    resolutions.filter((entry) => entry.state !== "unbound").map((entry) => entry.targetFieldId),
  );
  const unboundRequired = projection.targets
    .filter((target) => target.required && !resolvedTargets.has(target.targetFieldId))
    .map((target) => target.targetFieldId);

  return MappingReuseSchema.parse({
    outcome: "offered",
    resolutions,
    unboundRequired,
    readyToRun: unboundRequired.length === 0
      && resolutions.every((entry) => entry.state === "held"),
  });
}

/**
 * THE one way a `ColumnBinding` comes into existence — ref data-intake-and-edit-data §2.5's
 * "the mapping is only `bindings`-populated by an operator action".
 *
 * `confirmedAt` is the operator's act, and it is a required field. A
 * `Suggestion` has no such field and no way to acquire one, so the scorer
 * cannot reach a populated `bindings` array however it is called. The check
 * below is the second half: a binding must name a target the projection
 * actually declares, and a column that is actually present, so an offer built
 * against a stale layout cannot be confirmed into authority.
 */
export function confirmBinding(args: {
  projection: IntakeProjection;
  detected: readonly DetectedColumn[];
  targetFieldId: IntakeTargetFieldId;
  sourceColumnId: SourceColumnId;
  confirmedAt: string;
}): ColumnBinding {
  const target = args.projection.target(args.targetFieldId);
  if (target === undefined) {
    throw new Error(`cannot bind ${args.targetFieldId}: this workflow's intake projection does not declare it`);
  }
  const column = args.detected.find((entry) => entry.sourceColumnId === args.sourceColumnId);
  if (column === undefined) {
    throw new Error(`cannot bind ${args.targetFieldId}: the chosen column is not present in this file`);
  }
  return ColumnBindingSchema.parse({
    targetFieldId: target.targetFieldId,
    canonicalFieldId: target.canonicalFieldId,
    sourceColumnId: column.sourceColumnId,
    confirmedAt: IsoInstantSchema.parse(args.confirmedAt),
  });
}

/** The bindings a reuse offer may carry forward, in target-id order. */
export function heldBindings(reuse: MappingReuse): readonly IntakeTargetFieldId[] {
  if (reuse.outcome === "refused") return [];
  return reuse.resolutions
    .filter((entry) => entry.state === "held")
    .map((entry) => entry.targetFieldId)
    .sort((left, right) => left.localeCompare(right));
}
