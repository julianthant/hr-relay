/**
 * `defineIntakeProjection` — doc 06 §1's load-bearing invariant, enforced.
 *
 * A spreadsheet-capable workflow declares which of its input fields an operator
 * may bind a column to, and each declaration names the canonical field the
 * mapper coerces through. The factory then proves the thing the whole intake
 * pipeline rests on: **the schema at that target path IS the canonical field's
 * schema object**, not a parallel regex that agrees today.
 *
 * Why identity rather than equivalence: two structurally identical schemas can
 * drift apart in one commit, and the drift is invisible — the mapper keeps
 * coercing to the canonical shape while the workflow validates against the copy.
 * Doc 06 §7 vector #6 names this exactly ("an intake projection re-declares a
 * regex looser than its canonical field"), and the legacy tree already shipped
 * it: `work-study` and `separations` validate EIDs with `/^\d{5,}$/` while the
 * canonical identifier is `/^10\d{6}$/`.
 *
 * ## What the projection does NOT claim
 *
 * A coerced cell is valid for its TARGET FIELD by construction. It is not
 * thereby valid for the whole input: cross-field refinements, discriminants and
 * required non-intake fields can still reject the assembled row. Doc 06 §1 says
 * so in as many words, and §5's pipeline parses every assembled row through the
 * full workflow schema for exactly that reason.
 *
 * ## Two targets may share one canonical concept (D66)
 *
 * `employeeName` and `contactName` are both `fullName`. The projection keys on
 * the TARGET id and records the canonical id beside it, so a mapping binds them
 * independently and neither can overwrite the other.
 */
import { z } from "zod";
import { canonicalJsonStringify } from "../canonical-json.js";
import {
  FingerprintSchema,
  IntakeTargetFieldIdSchema,
  type Fingerprint,
  type IntakeTargetFieldId,
} from "../ids.js";
import { deriveSchemaHash } from "../schema-bound-value.js";
import { sha256Hex } from "../sha256.js";
import { isSchemaPathFailure, resolveSchemaPath, type SchemaPathFailure } from "../../validation/schema-path.js";
import { CanonicalFieldIdSchema, isFactoryDefinedCanonicalField } from "../fields/registry.js";
import type { CanonicalField, CanonicalFieldId } from "../fields/registry.js";

export const IntakeTargetSchema = z.strictObject({
  targetFieldId: IntakeTargetFieldIdSchema,
  canonicalFieldId: CanonicalFieldIdSchema,
  /** The operator-facing label the mapping grid shows for this target. */
  label: z.string().min(1),
  /** False when the input schema lets the path be omitted (optional/default). */
  required: z.boolean(),
  /** The resolved target schema's structural identity, folded into the fingerprint. */
  schemaHash: FingerprintSchema,
});
export type IntakeTarget = z.infer<typeof IntakeTargetSchema>;

export interface IntakeProjection {
  /** The workflow input schema every assembled row is finally parsed through. */
  readonly inputSchema: z.ZodType;
  readonly targets: readonly IntakeTarget[];
  /**
   * D66's `intakeProjectionFingerprint`: the exact target-field set AND their
   * schemas. A saved mapping built against a looser `eid` must not silently
   * reuse once the schema tightens, so the fold includes each target's schema
   * hash, not only its name.
   */
  readonly fingerprint: Fingerprint;
  readonly target: (id: IntakeTargetFieldId) => IntakeTarget | undefined;
}

const FACTORY_DEFINED_PROJECTIONS = new WeakSet<IntakeProjection>();

export function isFactoryDefinedIntakeProjection(candidate: IntakeProjection): boolean {
  return FACTORY_DEFINED_PROJECTIONS.has(candidate);
}

/**
 * Why a target path could not be resolved, in the input schema's own terms.
 *
 * The union arm is worth its own sentence (D172): "the two arms spell the same
 * constraint twice" is a fixable authoring mistake with a one-line fix (share
 * the schema object), and a generic "not a strict object" would send the author
 * looking for a structural problem that is not there.
 */
function intakeTargetPathRefusal(targetFieldId: IntakeTargetFieldId, failure: SchemaPathFailure): string {
  if (failure.kind === "no-such-field") {
    return `intake projection target ${targetFieldId} names no field in the input schema `
      + `(${failure.at} is not among ${failure.known.join(", ")})`;
  }
  if (failure.kind === "divergent-across-union") {
    return `intake projection target ${targetFieldId} resolves to ${String(failure.members)} DIFFERENT schema objects `
      + `across the input union at ${failure.at}; every arm that declares the path must share one schema object, `
      + "because coercing a cell through one arm's copy is the drift doc 06 §7 #6 bans";
  }
  return `intake projection target ${targetFieldId} walks through ${failure.at}, which is not a strict object`;
}

export function defineIntakeProjection(
  inputSchema: z.ZodType,
  bindings: Readonly<Record<string, CanonicalField>>,
): IntakeProjection {
  const entries = Object.entries(bindings);
  if (entries.length === 0) throw new Error("an intake projection must declare at least one target field");

  const targets: IntakeTarget[] = [];
  const seenTargets = new Set<string>();

  for (const [rawTargetId, field] of entries) {
    const targetFieldId = IntakeTargetFieldIdSchema.parse(rawTargetId);
    if (seenTargets.has(targetFieldId)) throw new Error(`intake projection binds ${targetFieldId} twice`);
    seenTargets.add(targetFieldId);

    if (!isFactoryDefinedCanonicalField(field)) {
      throw new Error(
        `intake projection target ${targetFieldId} must use a registry canonical field, not a hand-built one`,
      );
    }

    const resolved = resolveSchemaPath(inputSchema, targetFieldId.split("."));
    if (isSchemaPathFailure(resolved)) {
      throw new Error(intakeTargetPathRefusal(targetFieldId, resolved));
    }
    if (resolved.schema !== field.schema) {
      throw new Error(
        `intake projection target ${targetFieldId} must reuse the canonical ${field.id} schema object; `
          + "a structurally similar copy is exactly the drift doc 06 §7 #6 bans",
      );
    }

    targets.push(IntakeTargetSchema.parse({
      targetFieldId,
      canonicalFieldId: field.id,
      label: field.label,
      required: !resolved.omissible,
      schemaHash: deriveSchemaHash(field.schema, "input"),
    }));
  }

  targets.sort((left, right) => left.targetFieldId.localeCompare(right.targetFieldId));

  const fingerprint = FingerprintSchema.parse(sha256Hex(
    `hrauto:intake-projection:v1\0${canonicalJsonStringify(targets.map((entry) => ({
      targetFieldId: entry.targetFieldId,
      canonicalFieldId: entry.canonicalFieldId,
      required: entry.required,
      schemaHash: entry.schemaHash,
    })))}`,
  ));

  const byId = new Map(targets.map((entry) => [entry.targetFieldId, entry]));
  const projection: IntakeProjection = {
    inputSchema,
    targets: Object.freeze(targets),
    fingerprint,
    target: (id) => byId.get(id),
  };
  Object.freeze(projection);
  FACTORY_DEFINED_PROJECTIONS.add(projection);
  return projection;
}

/** Target ids the operator must bind before §2.2's Run may enable. */
export function requiredTargetIds(projection: IntakeProjection): readonly IntakeTargetFieldId[] {
  return projection.targets.filter((entry) => entry.required).map((entry) => entry.targetFieldId);
}

export function canonicalIdFor(
  projection: IntakeProjection,
  targetFieldId: IntakeTargetFieldId,
): CanonicalFieldId | undefined {
  return projection.target(targetFieldId)?.canonicalFieldId;
}
