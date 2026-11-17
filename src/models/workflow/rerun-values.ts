import { z } from "zod";
import { NodeIdSchema } from "../../rules/identity/ids.js";
import { ContractFieldPathSchema } from "../task/task-contract.js";
import { canonicalJsonStringify, type JsonValue } from "../../rules/validation/canonical-json.js";

/** A dot path into a produced value; a numeric segment addresses an array element. */
export const ValueFieldPathSchema = z.string().regex(
  /^[a-z][A-Za-z0-9]*(?:\.(?:[a-z][A-Za-z0-9]*|0|[1-9][0-9]*))*$/u,
  "value field path must be a dot-delimited object path, with numeric segments for array elements",
);

/** Optional source attribution for a new assertion; never a checkpoint patch. */
export const RerunValueMappingSchema = z.strictObject({
  nodeId: NodeIdSchema,
  fieldPath: ValueFieldPathSchema,
  label: z.string().min(1),
  targetFieldPath: ContractFieldPathSchema,
  targetStepKey: z.string().min(1).optional(),
});
export type RerunValueMappingSpec = z.input<typeof RerunValueMappingSchema>;
export type RerunValueMapping = z.infer<typeof RerunValueMappingSchema>;

export const RerunValueMappingsSchema = z.array(RerunValueMappingSchema).superRefine((mappings, ctx) => {
  const keys = mappings.map(({ nodeId, fieldPath, targetFieldPath, targetStepKey }) =>
    JSON.stringify([nodeId, fieldPath, targetFieldPath, targetStepKey]));
  if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", message: "duplicate Rerun value mapping" });
});

/** The schemas a value path can land on, wrappers of the leaf itself kept; numeric segments enter arrays. */
export function valueLeafSchemas(schema: z.core.$ZodType, path: readonly string[]): readonly z.core.$ZodType[] {
  if (path.length === 0) return [schema];
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable || schema instanceof z.ZodReadonly
    || schema instanceof z.ZodDefault || schema instanceof z.ZodCatch || schema instanceof z.ZodNonOptional) {
    return valueLeafSchemas(schema.unwrap(), path);
  }
  if (schema instanceof z.ZodUnion) return schema.options.flatMap((option) => valueLeafSchemas(option, path));
  const [key, ...rest] = path;
  if (key === undefined) return [];
  if (schema instanceof z.ZodArray) return /^(?:0|[1-9][0-9]*)$/u.test(key) ? valueLeafSchemas(schema.element, rest) : [];
  if (!(schema instanceof z.ZodObject) || !Object.hasOwn(schema.shape, key)) return [];
  const child: unknown = schema.shape[key];
  if (!(child instanceof z.ZodType)) throw new Error("VALUE_PATH_SCHEMA_INVALID");
  return valueLeafSchemas(child, rest);
}

/**
 * The one schema a value path lands on when nothing above it can refuse or rewrite that value: objects, arrays
 * and check-free optional, nullable, readonly, nonoptional and default wrappers, and a check-free discriminated
 * union whose every option lands on the same leaf schema. Any other union, a check, catch or transform on the way
 * gives undefined.
 */
export function valueLeafSchemaExact(schema: z.core.$ZodType, path: readonly string[]): z.core.$ZodType | undefined {
  return resolveValueLeaf(schema, path, false);
}

/** A manual field can be absent with its parent or union arm; present values still have to fit the leaf unchanged. */
export function valueLeafSchemaForManual(schema: z.core.$ZodType, path: readonly string[]): z.core.$ZodType | undefined {
  return resolveValueLeaf(schema, path, true);
}

function resolveValueLeaf(schema: z.core.$ZodType, path: readonly string[], manual: boolean): z.core.$ZodType | undefined {
  if (path.length === 0) return schema;
  if ((schema._zod.def.checks ?? []).length > 0) return undefined;
  if (schema instanceof z.core.$ZodOptional || schema instanceof z.core.$ZodNullable || schema instanceof z.core.$ZodReadonly
    || schema instanceof z.core.$ZodNonOptional || schema instanceof z.core.$ZodDefault) {
    const leaf = resolveValueLeaf(schema._zod.def.innerType, path, manual);
    return manual && leaf !== undefined && (schema instanceof z.core.$ZodOptional || schema instanceof z.core.$ZodNullable) ? z.optional(leaf) : leaf;
  }
  // Exact paths need a shared leaf; manual fields also admit literal alternatives and absent arms.
  if (schema instanceof z.core.$ZodDiscriminatedUnion) {
    const leaves = schema._zod.def.options.map((option) => resolveValueLeaf(option, path, manual));
    const [first] = leaves;
    if (first !== undefined && leaves.every((leaf) => leaf === first)) return first;
    if (!manual || leaves.some(leaf => leaf === undefined)) return undefined;
    const present = leaves.filter((leaf): leaf is z.core.$ZodType => leaf !== undefined && !(leaf instanceof z.core.$ZodUndefined));
    const [head, ...rest] = present;
    if (head === undefined) return z.undefined();
    const leaf = rest.every(other => other === head) ? head
      : present.every(other => other instanceof z.core.$ZodLiteral) ? z.union([head, ...rest]) : undefined;
    return leaf !== undefined && present.length < leaves.length ? z.optional(leaf) : leaf;
  }
  const [key, ...rest] = path;
  if (key === undefined) return undefined;
  if (schema instanceof z.core.$ZodArray) {
    const leaf = /^(?:0|[1-9][0-9]*)$/u.test(key) ? resolveValueLeaf(schema._zod.def.element, rest, manual) : undefined;
    return manual && leaf !== undefined ? z.optional(leaf) : leaf;
  }
  if (!(schema instanceof z.core.$ZodObject)) return undefined;
  const shape: Readonly<Record<string, z.core.$ZodType>> = schema._zod.def.shape;
  return Object.hasOwn(shape, key) ? resolveValueLeaf(shape[key] as z.core.$ZodType, rest, manual) : manual ? z.undefined() : undefined;
}

/** True when the schema itself accepts the value and parses it to the same canonical JSON. */
export function schemaAcceptsUnchanged(schema: z.core.$ZodType, value: JsonValue): boolean {
  const parsed = z.core.safeParse(schema, value);
  return parsed.success && canonicalJsonStringify(parsed.data) === canonicalJsonStringify(value);
}
