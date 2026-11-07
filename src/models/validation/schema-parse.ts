import type { z } from "zod";

/** Parse `value` and give the result its schema's declared output type, so callers get a typed value without an assertion the boundary bars; the value HAS been parsed by that schema. */
export function parseAsSchemaOutput<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
): z.output<Schema> {
  return schema.parse(value);
}
