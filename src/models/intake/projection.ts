/** `defineIntakeProjection` — the schema at a target path IS the canonical field's schema object, proved by identity rather than by equivalence. */
import { z } from "zod";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import {
  FingerprintSchema,
  IntakeTargetFieldIdSchema,
  type Fingerprint,
  type IntakeTargetFieldId,
} from "../../rules/identity/ids.js";
import { deriveSchemaHash } from "../validation/schema-bound-value.js";
import { sha256Hex } from "../../rules/validation/sha256.js";
import { isSchemaPathFailure, resolveSchemaPath, type SchemaPathFailure } from "../validation/schema-path.js";
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
    /* The exact target-field set AND their schemas, so a saved mapping built against a looser `eid` must not silently reuse once the schema tightens. */
  readonly fingerprint: Fingerprint;
  readonly target: (id: IntakeTargetFieldId) => IntakeTarget | undefined;
}

const FACTORY_DEFINED_PROJECTIONS = new WeakSet<IntakeProjection>();

export function isFactoryDefinedIntakeProjection(candidate: IntakeProjection): boolean {
  return FACTORY_DEFINED_PROJECTIONS.has(candidate);
}

/** Why a target path could not be resolved, in the input schema's own terms, so an authoring mistake reads as one and a structural problem is not invented. */
function intakeTargetPathRefusal(targetFieldId: IntakeTargetFieldId, failure: SchemaPathFailure): string {
  if (failure.kind === "no-such-field") {
    return `intake projection target ${targetFieldId} names no field in the input schema `
      + `(${failure.at} is not among ${failure.known.join(", ")})`;
  }
  if (failure.kind === "divergent-across-union") {
    return `intake projection target ${targetFieldId} resolves to ${String(failure.members)} DIFFERENT schema objects `
      + `across the input union at ${failure.at}; every arm that declares the path must share one schema object, `
      + "because coercing a cell through one arm's copy is the drift ref data-intake-and-edit-data §7 #6 bans";
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
          + "a structurally similar copy is exactly the drift ref data-intake-and-edit-data §7 #6 bans",
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
