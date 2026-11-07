import { z } from "zod";
import { RunIdSchema, NodeIdSchema, TaskIdSchema, PositiveIntSchema } from "../../rules/identity/ids.js";
import { ContractFieldPathSchema } from "../task/task-contract.js";
import type { JsonValue } from "../../rules/validation/canonical-json.js";

export const ObservationPathSchema = z.array(z.union([z.string().min(1), z.number().int().nonnegative()]));
export const DataObservationOriginSchema = z.strictObject({
  runId: RunIdSchema, attempt: PositiveIntSchema, spanPath: z.string().min(1), nodeId: NodeIdSchema, taskId: TaskIdSchema,
  field: ContractFieldPathSchema, path: ObservationPathSchema,
});
export const DataObservationOriginsSchema = z.array(z.strictObject({ path: ObservationPathSchema, origin: DataObservationOriginSchema })).superRefine((origins, context) => {
  if (new Set(origins.map(entry => JSON.stringify(entry.path))).size !== origins.length) context.addIssue({ code: "custom", message: "duplicate observation origin address" });
});
export const DataObservationAliasSchema = z.strictObject({
  path: ObservationPathSchema,
  source: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("local"), field: ContractFieldPathSchema, path: ObservationPathSchema }),
    z.strictObject({ kind: z.literal("dependency"), nodeId: NodeIdSchema, path: ObservationPathSchema.min(1) }),
  ]),
});
export type DataObservationOrigin = z.infer<typeof DataObservationOriginSchema>;
export type DataObservationOrigins = z.infer<typeof DataObservationOriginsSchema>;

function isArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

export function readObservationPath(value: JsonValue, path: readonly (string | number)[]): JsonValue {
  let current = value;
  for (const segment of path) {
    let next: JsonValue | undefined;
    if (isArray(current)) {
      if (typeof segment !== "number" || !Number.isInteger(segment) || segment < 0) throw new Error("observation alias address type mismatch");
      next = current[segment];
    } else {
      if (current === null || typeof current !== "object" || typeof segment !== "string") throw new Error("observation alias address type mismatch");
      if (Object.hasOwn(current, segment)) next = current[segment];
    }
    if (next === undefined) throw new Error("observation alias path unavailable");
    current = next;
  }
  return current;
}

export function observationLeafPaths(value: JsonValue, path: readonly (string | number)[] = []): readonly (readonly (string | number)[])[] {
  if (value === null || typeof value !== "object" || Object.keys(value).length === 0) return [path];
  return Object.entries(value).flatMap(([key, child]) => observationLeafPaths(child, [...path, Array.isArray(value) ? Number(key) : key]));
}
