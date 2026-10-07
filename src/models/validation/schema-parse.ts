import type { z } from "zod";

/**
 * Parse `value` and give the result its schema's declared output type.
 *
 * When a caller holds a schema only as an INDEXED generic — `Target["input"]`
 * where `Target extends AnyWorkflowRef` — TypeScript resolves `.parse` against
 * the constraint and hands back `unknown`. Naming the schema type directly, as
 * this signature does, keeps `z.output<Schema>`, so callers get a typed value
 * without writing an assertion (which `src/domain/**` may not do).
 *
 * This is not an escape hatch: the value HAS been parsed by the very schema
 * whose output type it carries. A caller cannot use this to skip validation.
 */
export function parseAsSchemaOutput<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
): z.output<Schema> {
  return schema.parse(value);
}
