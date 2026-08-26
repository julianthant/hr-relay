/**
 * Session → manifest → readiness, as one pure derivation (ref data-intake-and-edit-data §5, D171).
 *
 * The enqueue arm is the irreversible half of intake: it turns an operator's
 * mapping into N real HR runs. Everything it decides with is therefore derived
 * HERE, from the durable session's retained decisions plus the layout
 * re-derived from the immutable artifact — not assembled inline where a caller
 * could pass a value that agrees with nothing.
 *
 * Three properties are the reason this is one function rather than three:
 *
 * 1. **Readiness is judged on the manifest that would be written.** Ref data-intake-and-edit-data §5's
 *    `enqueueReadiness` reads a manifest's own dispositions, so building the
 *    manifest and gating on it cannot disagree — there is no second count of
 *    "how many rows are still rejected".
 * 2. **The validation pass runs against the RETAINED `readAt`.** A two-digit
 *    year resolves against the instant the operator validated with, so the
 *    manifest enqueue writes is the plan they reviewed, not a plan the clock
 *    quietly moved between review and Run.
 * 3. **A correction's `original` is read from the source, never carried.** The
 *    manifest records what the file said BEFORE the operator fixed it, redacted
 *    through the canonical field's own declared classification/transform. The
 *    session retains only the corrected value, so the original is looked up in
 *    the bound column of the re-derived row — and a correction whose field is
 *    not bound throws rather than recording a redaction of nothing.
 */
import type { z } from "zod";
import type { JsonValue } from "../canonical-json.js";
import { CANONICAL_FIELDS } from "../fields/registry.js";
import type { ArtifactRef } from "../artifacts.js";
import type { IntakeTargetFieldId, ItemId } from "../ids.js";
import { redactValue } from "../redaction.js";
import {
  buildIntakeManifest,
  enqueueReadiness,
  type EnqueueReadiness,
  type IntakePlanManifest,
} from "./manifest.js";
import { deriveMappingSnapshotHash, type ColumnBinding } from "./mapping.js";
import type { IntakeLayout } from "./parse.js";
import type { IntakeProjection } from "./projection.js";
import type {
  IntakeConstantSchema,
  IntakeRowCorrectionSchema,
  IntakeRowExclusionSchema,
} from "./session.js";
import { validateIntakeRows } from "./validate.js";

/** Exactly the session state an enqueue reads — decisions plus source identity. */
export interface IntakeEnqueueSessionView {
  readonly workflow: string;
  readonly artifact: ArtifactRef;
  /** The name the operator's file had; the manifest claims it forever. */
  readonly sourceName: string;
  readonly sheet: string;
  readonly bindings: readonly ColumnBinding[];
  readonly constants: readonly z.infer<typeof IntakeConstantSchema>[];
  readonly corrections: readonly z.infer<typeof IntakeRowCorrectionSchema>[];
  readonly exclusions: readonly z.infer<typeof IntakeRowExclusionSchema>[];
  /** The instant validation read these rows with, retained by the session. */
  readonly readAt: string;
}

export interface IntakeEnqueuePlan {
  readonly manifest: IntakePlanManifest;
  readonly readiness: EnqueueReadiness;
}

export interface IntakeEnqueuePlanInput {
  readonly session: IntakeEnqueueSessionView;
  readonly projection: IntakeProjection;
  /** Re-derived from `(artifact bytes, sheet, headerRowIndex)` — never stored. */
  readonly layout: IntakeLayout;
  readonly manifestId: string;
  readonly createdAt: string;
  readonly workflowContractFingerprint: string;
  /** The schema every `parsedInput` must be re-read with (D62/D110). */
  readonly canonicalInputSchemaHash: string;
  readonly deriveItemId: (parsedInput: JsonValue) => ItemId;
}

/**
 * The redacted source value a correction replaced.
 *
 * Every failure here is a throw, not a rejection: each one means the session
 * and the layout it was built against have become mutually inconsistent, which
 * no command sequence can produce — a layout move discards corrections, and a
 * correction requires a bound column. Recording a plausible blank instead would
 * put a lie in an immutable manifest.
 */
function originalCell(
  input: IntakeEnqueuePlanInput,
  correction: z.infer<typeof IntakeRowCorrectionSchema>,
  bindingByTarget: ReadonlyMap<IntakeTargetFieldId, ColumnBinding>,
) {
  const target = input.projection.target(correction.field);
  if (target === undefined) {
    throw new Error(
      `intake manifest cannot record a correction for ${correction.field}: `
      + `${input.session.workflow} declares no such intake target`,
    );
  }
  const binding = bindingByTarget.get(correction.field);
  if (binding === undefined) {
    throw new Error(
      `intake manifest cannot record a correction for ${correction.field}: no column is bound to it, `
      + "so there is no source value it replaced",
    );
  }
  const column = input.layout.columns.find((entry) => entry.sourceColumnId === binding.sourceColumnId);
  if (column === undefined) {
    throw new Error(
      `intake manifest cannot record a correction for ${correction.field}: its bound column is not in this file`,
    );
  }
  const cells = input.layout.rows[correction.sourceRow - 1];
  if (cells === undefined) {
    throw new Error(
      `intake manifest cannot record a correction for source row ${String(correction.sourceRow)}: `
      + `this file holds ${String(input.layout.rows.length)} data rows`,
    );
  }
  const field = CANONICAL_FIELDS[target.canonicalFieldId];
  const raw = cells[column.currentIndex] ?? "";
  return redactValue(field.classification, field.redactTransform, raw);
}

export function deriveIntakeEnqueuePlan(input: IntakeEnqueuePlanInput): IntakeEnqueuePlan {
  const { session, layout } = input;
  const validation = validateIntakeRows({
    workflow: session.workflow,
    sourceSha256: session.artifact.sha256,
    projection: input.projection,
    detected: layout.columns,
    bindings: session.bindings,
    rows: layout.rows,
    constants: session.constants,
    corrections: session.corrections,
    excludedRows: session.exclusions.map((entry) => entry.sourceRow),
    readAt: session.readAt,
    deriveItemId: input.deriveItemId,
  });

  const bindingByTarget = new Map(session.bindings.map((binding) => [binding.targetFieldId, binding]));
  const manifest = buildIntakeManifest({
    manifestId: input.manifestId,
    workflow: session.workflow,
    source: {
      artifactId: session.artifact.id,
      sha256: session.artifact.sha256,
      originalName: session.sourceName,
    },
    mappingFingerprint: layout.headerFingerprint,
    mappingSnapshotHash: deriveMappingSnapshotHash({
      workflow: session.workflow,
      sheet: session.sheet,
      headerRowIndex: layout.headerRowIndex,
      headerFingerprint: layout.headerFingerprint,
      bindings: session.bindings,
      constants: session.constants,
    }),
    intakeProjectionFingerprint: input.projection.fingerprint,
    workflowContractFingerprint: input.workflowContractFingerprint,
    canonicalInputSchemaHash: input.canonicalInputSchemaHash,
    createdAt: input.createdAt,
    sourceRows: layout.rows.length,
    valid: validation.valid,
    currentRejects: validation.currentRejects,
    rejectionHistory: validation.rejected,
    corrections: session.corrections.map((correction) => ({
      sourceRow: correction.sourceRow,
      field: correction.field,
      original: originalCell(input, correction, bindingByTarget),
      correctedValue: correction.correctedValue,
      correctedAt: correction.correctedAt,
    })),
    exclusions: session.exclusions.map((exclusion) => ({
      sourceRow: exclusion.sourceRow,
      reason: exclusion.reason,
      operatorConfirmedAt: exclusion.excludedAt,
    })),
  });

  return Object.freeze({ manifest, readiness: enqueueReadiness(manifest) });
}

/**
 * What the CURRENT session presents to `rerunDiff` (ref data-intake-and-edit-data §7 vector #11).
 *
 * The source digest is not a parameter: a prior manifest is FOUND by these
 * exact bytes, so that axis is equal by construction and the four remaining
 * ones are the whole question — has the mapping, the projection, the workflow
 * contract or the canonical-input schema moved since this file last ran.
 */
export function currentRerunState(input: Readonly<{
  session: Readonly<{
    workflow: string;
    artifact: ArtifactRef;
    sheet: string;
    bindings: readonly ColumnBinding[];
    constants: readonly z.infer<typeof IntakeConstantSchema>[];
    corrections: readonly z.infer<typeof IntakeRowCorrectionSchema>[];
    exclusions: readonly z.infer<typeof IntakeRowExclusionSchema>[];
  }>;
  layout: IntakeLayout;
  projection: IntakeProjection;
  /** Durable instant this exact decision snapshot is read against. */
  readAt: string;
  workflowContractFingerprint: string;
  canonicalInputSchemaHash: string;
  deriveItemId: (parsedInput: JsonValue) => ItemId;
}>) {
  const validation = validateIntakeRows({
    workflow: input.session.workflow,
    sourceSha256: input.session.artifact.sha256,
    projection: input.projection,
    detected: input.layout.columns,
    bindings: input.session.bindings,
    rows: input.layout.rows,
    constants: input.session.constants,
    corrections: input.session.corrections,
    excludedRows: input.session.exclusions.map((entry) => entry.sourceRow),
    readAt: input.readAt,
    deriveItemId: input.deriveItemId,
  });
  return Object.freeze({
    sourceSha256: input.session.artifact.sha256,
    mappingSnapshotHash: deriveMappingSnapshotHash({
      workflow: input.session.workflow,
      sheet: input.session.sheet,
      headerRowIndex: input.layout.headerRowIndex,
      headerFingerprint: input.layout.headerFingerprint,
      bindings: input.session.bindings,
      constants: input.session.constants,
    }),
    intakeProjectionFingerprint: input.projection.fingerprint,
    workflowContractFingerprint: input.workflowContractFingerprint,
    canonicalInputSchemaHash: input.canonicalInputSchemaHash,
    validRows: validation.valid,
  });
}
