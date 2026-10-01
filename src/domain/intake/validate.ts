/**
 * The intake validation pipeline — ref data-intake-and-edit-data §5's "mapped dataset → N inputs".
 *
 * Format-agnostic on purpose: it takes an already-parsed cell matrix, the
 * detected columns, the operator's confirmed mapping and the workflow's intake
 * projection, and returns exactly one disposition per source row. The
 * extraction store owns turning a `.csv`/`.xlsx`/PDF into that matrix; nothing
 * here knows or cares which it was.
 *
 * ## Every row lands somewhere, and nothing half-launches
 *
 * The output covers `1..sourceRows` exactly once. A row is `valid` only if
 * every bound cell coerced, every field parsed, the WHOLE assembled input
 * parsed through the workflow schema, and its identity is unique in the file.
 * Anything else is a rejection carrying the row, the column, the field and a
 * legible reason — never a dropped row and never a substituted value.
 *
 * ## A `CellCoercionError` is converted; nothing else is
 *
 * `coerce` throws a typed, located failure for a cell it cannot turn into a
 * canonical value, and that is the measurement §2.4 designed. This module
 * catches exactly that class (and the `ZodError` from the field schema) and
 * records a durable, visible rejection. Any other throw propagates untouched —
 * a bug in a coercer must not become "row 12 was a bit odd".
 *
 * ## Validation is a pure function of its inputs
 *
 * Given the same file, mapping, projection and corrections, it produces the
 * same dispositions and the same reject ids. That is what makes "rerun with
 * existing data" checkable rather than hopeful: the diff between two manifests
 * is a real difference in the file, the mapping, or the contract — not noise
 * from a fresh id per pass.
 */
import { z } from "zod";
import { JsonValueSchema, canonicalJsonStringify, type JsonValue } from "../canonical-json.js";
import {
  ItemIdSchema,
  WorkflowIdSchema,
  type IntakeTargetFieldId,
  type ItemId,
  type RowRejectId,
} from "../ids.js";
import { retainLocalEvidenceValue } from "../redaction.js";
import { CANONICAL_FIELDS } from "../fields/registry.js";
import { isCellCoercionError, type CellLocation } from "../fields/cell-coercion.js";
import {
  deriveRowRejectId,
  intakeInputHash,
  RowRejectSchema,
  type RowReject,
} from "./manifest.js";
import type { ColumnBinding, DetectedColumn } from "./mapping.js";
import type { IntakeProjection } from "./projection.js";

export interface IntakeValidationInput {
  readonly workflow: string;
  /** Content identity of the immutable source artifact — folds into reject ids. */
  readonly sourceSha256: string;
  readonly projection: IntakeProjection;
  readonly detected: readonly DetectedColumn[];
  readonly bindings: readonly ColumnBinding[];
  /** Data rows, header-relative, in file order. Row N is `rows[N - 1]`. */
  readonly rows: readonly (readonly string[])[];
  /**
   * Values the operator typed once for the whole run (ref data-intake-and-edit-data §8 step 2's
   * `effectiveDate`). A required target satisfied here needs no column.
   *
   * A list rather than a keyed object, because the key is a declared target
   * field id and an open string-keyed map at this boundary would accept one
   * that the projection never heard of.
   */
  readonly constants?: readonly { targetFieldId: IntakeTargetFieldId; value: JsonValue }[];
  /** Operator cell corrections, applied over the source without rewriting it. */
  readonly corrections?: readonly { sourceRow: number; field: IntakeTargetFieldId; correctedValue: string }[];
  /** Source rows the operator has explicitly excluded. */
  readonly excludedRows?: readonly number[];
  /**
   * When these rows were read, as an ISO instant. Supplied by the caller from
   * the clock rather than read here, so a replayed validation resolves its
   * two-digit years exactly as the original did.
   */
  readonly readAt: string;
  /** The workflow's own identity function over a parsed input (ref workflow-model §5.7). */
  readonly deriveItemId: (parsedInput: JsonValue) => ItemId;
}

export interface ValidatedRow {
  readonly sourceRow: number;
  readonly itemId: ItemId;
  readonly inputHash: string;
  readonly parsedInput: JsonValue;
}

export interface IntakeValidationResult {
  readonly valid: readonly ValidatedRow[];
  readonly rejected: readonly RowReject[];
  /** `sourceRow -> current reject ids`, empty for a valid or excluded row. */
  readonly currentRejects: ReadonlyMap<number, readonly RowRejectId[]>;
  readonly excluded: readonly number[];
}

/** A JSON object under construction — mutable, and never exposed as one. */
interface MutableJsonObject {
  [key: string]: unknown;
}

function isMutableJsonObject(value: unknown): value is MutableJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function setAtPath(target: MutableJsonObject, path: readonly string[], value: unknown): void {
  const [head, ...rest] = path;
  if (rest.length === 0) {
    target[head] = value;
    return;
  }
  const existing = target[head];
  const child: MutableJsonObject = isMutableJsonObject(existing) ? existing : {};
  target[head] = child;
  setAtPath(child, rest, value);
}

/**
 * One cell's coercion attempt, as a value.
 *
 * The `catch` classifies and returns; it sets no flag and supplies no default.
 * That keeps the `fail-loud-catch-default` ratchet honest AND keeps the shape
 * right: a refused cell is an OUTCOME the caller records durably, while any
 * other throw is a fault that must reach the top.
 */
type CellCoercion =
  | { readonly coerced: true; readonly value: unknown }
  | { readonly coerced: false; readonly reason: string };

function attemptCoercion(
  coerce: (raw: string, location: CellLocation) => unknown,
  raw: string,
  location: CellLocation,
): CellCoercion {
  try {
    return { coerced: true, value: coerce(raw, location) };
  } catch (error) {
    if (!isCellCoercionError(error)) throw error;
    return { coerced: false, reason: error.reason };
  }
}

function boundaryIssues(error: z.ZodError): { path: (string | number)[]; code: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.map((segment) => (typeof segment === "symbol" ? String(segment) : segment)),
    code: issue.code,
    message: issue.message,
  }));
}

export function validateIntakeRows(input: IntakeValidationInput): IntakeValidationResult {
  const workflow = WorkflowIdSchema.parse(input.workflow);
  const columnsById = new Map(input.detected.map((column) => [column.sourceColumnId, column]));
  const bindingByTarget = new Map(input.bindings.map((binding) => [binding.targetFieldId, binding]));
  const constants = input.constants ?? [];
  const excluded = [...new Set(input.excludedRows ?? [])].sort((left, right) => left - right);
  const excludedSet = new Set(excluded);

  const correctionsByRow = new Map<number, Map<IntakeTargetFieldId, string>>();
  for (const correction of input.corrections ?? []) {
    const forRow = correctionsByRow.get(correction.sourceRow) ?? new Map<IntakeTargetFieldId, string>();
    forRow.set(correction.field, correction.correctedValue);
    correctionsByRow.set(correction.sourceRow, forRow);
  }

  const rejected: RowReject[] = [];
  const currentRejects = new Map<number, RowRejectId[]>();
  const valid: ValidatedRow[] = [];

  const addReject = (sourceRow: number, reject: RowReject): void => {
    rejected.push(reject);
    currentRejects.set(sourceRow, [...(currentRejects.get(sourceRow) ?? []), reject.rejectId]);
  };

  // A required target satisfied by neither a binding nor a run constant blocks
  // every row. It is recorded per row so the manifest's coverage stays total.
  const unsatisfiedRequired = input.projection.targets.filter((target) =>
    target.required
    && !bindingByTarget.has(target.targetFieldId)
    && !constants.some((constant) => constant.targetFieldId === target.targetFieldId));

  for (const [index, cells] of input.rows.entries()) {
    const sourceRow = index + 1;
    if (excludedSet.has(sourceRow)) continue;

    if (unsatisfiedRequired.length > 0) {
      for (const target of unsatisfiedRequired) {
        addReject(sourceRow, RowRejectSchema.parse({
          rejectId: deriveRowRejectId({
            sourceSha256: input.sourceSha256,
            sourceRow,
            kind: "unmapped-required",
            subject: target.targetFieldId,
          }),
          sourceRow,
          code: "unmapped-required",
          kind: "unmapped-required",
          field: target.targetFieldId,
          reason: `required field ${target.label} has no column bound and no run value supplied`,
        }));
      }
      continue;
    }

    const assembled: MutableJsonObject = {};
    for (const constant of constants) {
      setAtPath(assembled, constant.targetFieldId.split("."), constant.value);
    }

    let rowFailed = false;
    for (const target of input.projection.targets) {
      const binding = bindingByTarget.get(target.targetFieldId);
      if (binding === undefined) continue;
      const column = columnsById.get(binding.sourceColumnId);
      if (column === undefined) {
        // A confirmed binding whose column vanished between confirmation and
        // validation. Refuse loudly rather than validating a shorter row.
        throw new Error(
          `intake validation cannot proceed: ${target.targetFieldId} is bound to a column that is not in this file`,
        );
      }

      const field = CANONICAL_FIELDS[target.canonicalFieldId];
      const corrected = correctionsByRow.get(sourceRow)?.get(target.targetFieldId);
      const raw = corrected ?? cells[column.currentIndex] ?? "";
      const location: CellLocation = {
        workflow,
        readAt: input.readAt,
        sourceRow,
        header: column.header,
        targetFieldId: target.targetFieldId,
      };
      const columnRef = { sourceColumnId: column.sourceColumnId, header: column.header };

      // An optional target with an empty cell is genuinely absent, not a
      // rejection: the workflow schema says the key may be omitted.
      if (!target.required && raw.trim().length === 0) continue;

      const attempt = attemptCoercion(field.coerce, raw, location);
      if (!attempt.coerced) {
        rowFailed = true;
        addReject(sourceRow, RowRejectSchema.parse({
          rejectId: deriveRowRejectId({
            sourceSha256: input.sourceSha256,
            sourceRow,
            kind: "cell-coercion",
            subject: target.targetFieldId,
          }),
          sourceRow,
          code: "cell-coercion",
          kind: "cell-coercion",
          field: target.targetFieldId,
          column: columnRef,
          raw: retainLocalEvidenceValue(field.classification, field.redactTransform, raw),
          reason: `${attempt.reason} (${field.label})`,
        }));
        continue;
      }

      const parsed = field.schema.safeParse(attempt.value);
      if (!parsed.success) {
        rowFailed = true;
        addReject(sourceRow, RowRejectSchema.parse({
          rejectId: deriveRowRejectId({
            sourceSha256: input.sourceSha256,
            sourceRow,
            kind: "field-schema",
            subject: target.targetFieldId,
          }),
          sourceRow,
          code: "field-schema",
          kind: "field-schema",
          field: target.targetFieldId,
          column: columnRef,
          raw: retainLocalEvidenceValue(field.classification, field.redactTransform, raw),
          issues: boundaryIssues(parsed.error),
          reason: `${field.label} did not satisfy its canonical schema`,
        }));
        continue;
      }
      setAtPath(assembled, target.targetFieldId.split("."), parsed.data);
    }
    if (rowFailed) continue;

    const wholeInput = input.projection.inputSchema.safeParse(assembled);
    if (!wholeInput.success) {
      const issues = boundaryIssues(wholeInput.error);
      // A root-level issue is a refinement OVER the combination — ref data-intake-and-edit-data §5's
      // `cross-field`. Naming every bound target is truthful ("one of these
      // together is wrong"); inventing a specific pair zod never reported
      // would be a guess dressed as a diagnosis.
      const rootIssues = issues.filter((issue) => issue.path.length === 0);
      const boundPaths = [...bindingByTarget.keys()].sort((left, right) => left.localeCompare(right));
      if (rootIssues.length > 0 && boundPaths.length >= 2) {
        addReject(sourceRow, RowRejectSchema.parse({
          rejectId: deriveRowRejectId({
            sourceSha256: input.sourceSha256,
            sourceRow,
            kind: "cross-field",
            subject: boundPaths.join(","),
          }),
          sourceRow,
          code: "cross-field",
          kind: "cross-field",
          paths: boundPaths,
          issues: rootIssues,
          reason: rootIssues.map((issue) => issue.message).join("; "),
        }));
      } else {
        const first = issues[0];
        addReject(sourceRow, RowRejectSchema.parse({
          rejectId: deriveRowRejectId({
            sourceSha256: input.sourceSha256,
            sourceRow,
            kind: "workflow-schema",
            subject: first.path.join(".") || "<root>",
          }),
          sourceRow,
          code: "workflow-schema",
          kind: "workflow-schema",
          path: first.path,
          issues,
          reason: issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`).join("; "),
        }));
      }
      continue;
    }

    // Parsed, not asserted: the round-trip through canonical JSON is what makes
    // the stored input byte-stable, and `JsonValueSchema` is what proves the
    // result is really JSON rather than something that merely stringified.
    const parsedInput = JsonValueSchema.parse(JSON.parse(canonicalJsonStringify(wholeInput.data)));
    valid.push({
      sourceRow,
      itemId: ItemIdSchema.parse(input.deriveItemId(parsedInput)),
      inputHash: intakeInputHash(parsedInput),
      parsedInput,
    });
  }

  // Identity collision is decided across the WHOLE file, so it runs after every
  // row has an input. Both colliding rows are rejected: choosing a winner would
  // silently drop a person the operator listed.
  const byItemId = new Map<string, ValidatedRow[]>();
  for (const row of valid) byItemId.set(row.itemId, [...(byItemId.get(row.itemId) ?? []), row]);
  const collided = new Set<number>();
  for (const [itemId, rows] of byItemId) {
    if (rows.length < 2) continue;
    const collidingSourceRows = rows.map((row) => row.sourceRow).sort((left, right) => left - right);
    for (const row of rows) {
      collided.add(row.sourceRow);
      addReject(row.sourceRow, RowRejectSchema.parse({
        rejectId: deriveRowRejectId({
          sourceSha256: input.sourceSha256,
          sourceRow: row.sourceRow,
          kind: "duplicate-identity",
          subject: itemId,
        }),
        sourceRow: row.sourceRow,
        code: "duplicate-identity",
        kind: "duplicate-identity",
        itemId: ItemIdSchema.parse(itemId),
        collidingSourceRows,
        reason: `source rows ${collidingSourceRows.join(", ")} describe the same item`,
      }));
    }
  }

  return {
    valid: valid.filter((row) => !collided.has(row.sourceRow)),
    rejected,
    currentRejects,
    excluded,
  };
}
