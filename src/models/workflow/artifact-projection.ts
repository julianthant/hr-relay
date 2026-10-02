/**
 * Ref data-intake-and-edit-data §4.1 / ref dashboard-surfaces §2.1 (D45): deriving the stable-keyed artifact rows a
 * producing node's checkpoint commits atomically with.
 *
 * Pure and browser-safe: the derivation is a function of the descriptor's
 * `DurableArtifactProjectionSpec`s and the node's exact output value, so the
 * executor (fresh execution) and a resumed replay derive THE SAME stable key
 * from the same checkpoint — which is what makes a duplicate outbox row a
 * verified no-op instead of a second workbook append.
 *
 * The stable key is deliberately NON-POSITIONAL: it folds the projection id
 * with the declared key-field VALUES (subject identity plus document/roster
 * version — whatever the spec named), never a row index or a write ordinal.
 * A record missing one of its declared key values is unprojectable and
 * throws by name — a keyless row upserted anywhere would be exactly the
 * silent duplicate this design exists to prevent.
 */
import { z } from "zod";
import { canonicalJsonStringify, JsonValueSchema, type JsonObject, type JsonValue } from "../../rules/validation/canonical-json.js";
import { ContractFieldPathSchema } from "../task/task-contract.js";
import { FingerprintSchema, NodeIdSchema } from "../../rules/identity/ids.js";
import { sha256Hex } from "../../rules/validation/sha256.js";
import {
  ArtifactSinkIdSchema,
  DurableArtifactProjectionSpecRuntimeSchema,
} from "./presentation.js";

/**
 * One declared key value. An ORDERED LIST of pairs, never an open
 * string-keyed map: the keys are the spec's own declared field paths, and an
 * open record at this boundary would accept a key the spec never heard of —
 * the same reasoning `IntakeValidationInput.constants` records.
 */
export const ArtifactProjectionKeyValueSchema = z.strictObject({
  field: ContractFieldPathSchema,
  value: JsonValueSchema,
});

export const DerivedArtifactProjectionRowSchema = z.strictObject({
  projectionId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  sinkId: ArtifactSinkIdSchema,
  stableKeyFingerprint: FingerprintSchema,
  /** The declared key values in `keyFields` order — the sink's row identity. */
  keyValues: z.array(ArtifactProjectionKeyValueSchema).min(1),
  /** The projected record: the node output at the spec's `source.fieldPath`. */
  value: JsonValueSchema,
});
export type DerivedArtifactProjectionRow = z.infer<typeof DerivedArtifactProjectionRowSchema>;

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Walk a dot-delimited contract field path; `undefined` when any hop is absent. */
function valueAtFieldPath(value: JsonValue, fieldPath: string): JsonValue | undefined {
  let current: JsonValue | undefined = value;
  for (const segment of fieldPath.split(".")) {
    if (!isJsonObject(current)) return undefined;
    current = current[segment];
  }
  return current;
}

/**
 * Derive every projection row the given node owes. Specs whose source names a
 * different node are skipped; a spec that matches but cannot resolve its
 * field or any key value throws with the projection id and path by name.
 */
export function deriveArtifactProjectionRows(input: Readonly<{
  specs: readonly unknown[];
  nodeId: string;
  outputValue: unknown;
}>): readonly DerivedArtifactProjectionRow[] {
  const nodeId = NodeIdSchema.parse(input.nodeId);
  const outputValue = JsonValueSchema.parse(input.outputValue);
  const rows: DerivedArtifactProjectionRow[] = [];
  for (const candidate of input.specs) {
    const spec = DurableArtifactProjectionSpecRuntimeSchema.parse(candidate);
    if (spec.source.nodeId !== nodeId) continue;

    const value = valueAtFieldPath(outputValue, spec.source.fieldPath);
    if (value === undefined) {
      throw new Error(
        `artifact projection "${spec.id}" found no value at ${spec.source.fieldPath} `
        + `in node ${nodeId}'s output; a projection cannot serialize what the checkpoint does not hold`,
      );
    }
    const keyValues = spec.keyFields.map((keyField) => {
      const keyValue = valueAtFieldPath(outputValue, keyField);
      if (keyValue === undefined || keyValue === null) {
        throw new Error(
          `artifact projection "${spec.id}" is missing its declared key value at ${keyField}; `
          + "a keyless row cannot be stable-keyed and would upsert as a silent duplicate",
        );
      }
      return { field: keyField, value: keyValue };
    });
    rows.push(DerivedArtifactProjectionRowSchema.parse({
      projectionId: spec.id,
      sinkId: spec.sink,
      stableKeyFingerprint: FingerprintSchema.parse(sha256Hex(
        `hrauto:artifact-projection:v1\0${canonicalJsonStringify({ projectionId: spec.id, keyValues })}`,
      )),
      keyValues,
      value,
    }));
  }
  return Object.freeze(rows);
}
