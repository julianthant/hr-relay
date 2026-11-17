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

/** True when some schema at the path accepts the value and parses it to the same canonical JSON. */
export function valuePathAccepts(schema: z.core.$ZodType, path: string, value: JsonValue): boolean {
  return valueLeafSchemas(schema, path.split(".")).some((leaf) => {
    const parsed = z.core.safeParse(leaf, value);
    return parsed.success && canonicalJsonStringify(parsed.data) === canonicalJsonStringify(value);
  });
}
