/**
 * Resolve a dotted target path inside a strict object schema.
 *
 * Doc 06 §2.1 binds a column to a **stable target-field id** — a path into the
 * workflow's own input schema — and doc 06 §7 vector #6 requires that the
 * schema found at that path is the SAME OBJECT as the canonical field's. That
 * check is only meaningful if the path resolution refuses to be creative, so:
 *
 * - Wrappers (`optional`, `nullable`, `default`, `readonly`, `nonoptional`,
 *   `catch`) are unwrapped, because `fields.eid.schema.optional()` is still the
 *   canonical `eid` schema and a projection that could not say so would force
 *   every optional intake field to declare a parallel regex.
 * - Arrays, unions, tuples, records and pipes are NOT traversed. A target field
 *   id names one field; letting a path index into an array would make the
 *   binding positional, which is the thing `SourceColumnId` exists to avoid.
 *
 * Living in `src/validation/` beside `contract-boundary.ts` keeps every use of
 * zod's internal definition shape in one directory.
 */
import type { z } from "zod";

interface ZodInternals {
  readonly _zod: { readonly def: { readonly [key: string]: unknown } };
}

function schemaDefinition(schema: z.core.$ZodType): { readonly [key: string]: unknown } {
  return (schema as unknown as ZodInternals)._zod.def;
}

const WRAPPERS = new Set(["optional", "nullable", "default", "readonly", "nonoptional", "catch"]);
/** Wrappers that make the KEY omissible, as opposed to widening its value. */
const OMISSIBLE = new Set(["optional", "default", "catch"]);

export interface ResolvedSchemaPath {
  /**
   * The innermost schema object at the path, with every wrapper removed.
   *
   * Typed `unknown` deliberately: the only correct use is a REFERENCE
   * comparison against a canonical field's own schema, and handing back a
   * `z.ZodType` would invite a caller to parse through a schema it located by
   * string path rather than by declaration.
   */
  readonly schema: unknown;
  /**
   * Whether the path may be omitted from a valid input — true when the leaf or
   * any ancestor is optional/defaulted/caught. `nullable` alone does NOT make a
   * path omissible: the key is still required, it may just hold `null`.
   */
  readonly omissible: boolean;
}

export type SchemaPathFailure =
  | { readonly kind: "not-an-object"; readonly at: string }
  | { readonly kind: "no-such-field"; readonly at: string; readonly known: readonly string[] };

export function resolveSchemaPath(
  root: z.core.$ZodType,
  path: readonly string[],
): ResolvedSchemaPath | SchemaPathFailure {
  let current = root;
  let omissible = false;
  const walked: string[] = [];

  for (const segment of path) {
    let unwrapped = current;
    let definition = schemaDefinition(unwrapped);
    while (WRAPPERS.has(String(definition.type))) {
      if (OMISSIBLE.has(String(definition.type))) omissible = true;
      unwrapped = definition.innerType as z.core.$ZodType;
      definition = schemaDefinition(unwrapped);
    }
    if (String(definition.type) !== "object") {
      return { kind: "not-an-object", at: walked.length === 0 ? "<root>" : walked.join(".") };
    }
    const shape = definition.shape as { readonly [key: string]: z.core.$ZodType };
    const child = Object.hasOwn(shape, segment) ? shape[segment] : undefined;
    walked.push(segment);
    if (child === undefined) {
      return { kind: "no-such-field", at: walked.join("."), known: Object.keys(shape).sort() };
    }
    current = child;
  }

  let definition = schemaDefinition(current);
  while (WRAPPERS.has(String(definition.type))) {
    if (OMISSIBLE.has(String(definition.type))) omissible = true;
    current = definition.innerType as z.core.$ZodType;
    definition = schemaDefinition(current);
  }
  return { schema: current, omissible };
}

export function isSchemaPathFailure(
  resolved: ResolvedSchemaPath | SchemaPathFailure,
): resolved is SchemaPathFailure {
  return "kind" in resolved;
}
