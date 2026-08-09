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
 * - Arrays, tuples, records and pipes are NOT traversed. A target field id names
 *   one field; letting a path index into an array would make the binding
 *   positional, which is the thing `SourceColumnId` exists to avoid.
 *
 * ## Unions ARE traversed, on the one rule that keeps identity meaningful (D172)
 *
 * A union is how a workflow says "either of these shapes", and a real one does:
 * `PersonLookupInput` is `{name, …} | {emplId, name?, …}`. Refusing to traverse
 * it would have made the whole union-input class of workflows unmappable, and
 * the tempting workarounds are both wrong — resolving against "the first arm
 * that has the key" silently picks one shape's schema for a value the other
 * shape will parse, and flattening the union into one object invents a schema
 * the workflow never declared.
 *
 * So the path is resolved in EVERY member, and:
 *
 * - it must resolve to the SAME schema object everywhere it resolves — two arms
 *   spelling `z.string().min(1)` twice are two objects, and that is exactly the
 *   drift doc 06 §7 #6 bans, so it is refused by name rather than by luck;
 * - a member that does not have the path at all makes the path **omissible**,
 *   because an input satisfying that member carries no such key. `required`
 *   therefore means "every valid input must supply this", which is the only
 *   reading under which validation's `unmapped-required` rejection is true;
 * - if no member resolves it, the failure is reported against the member that
 *   got furthest, so the message names a real shape rather than "a union".
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
  | { readonly kind: "no-such-field"; readonly at: string; readonly known: readonly string[] }
  /**
   * The path exists in more than one union member, but they are not the same
   * schema object. Reported rather than resolved: picking either one would
   * coerce a cell through a schema half the accepted inputs never declared.
   */
  | { readonly kind: "divergent-across-union"; readonly at: string; readonly members: number };

/** Strips every wrapper, recording whether any of them made the key omissible. */
function unwrap(schema: z.core.$ZodType): { readonly inner: z.core.$ZodType; readonly omissible: boolean } {
  let inner = schema;
  let omissible = false;
  let definition = schemaDefinition(inner);
  while (WRAPPERS.has(String(definition.type))) {
    if (OMISSIBLE.has(String(definition.type))) omissible = true;
    inner = definition.innerType as z.core.$ZodType;
    definition = schemaDefinition(inner);
  }
  return { inner, omissible };
}

export function resolveSchemaPath(
  root: z.core.$ZodType,
  path: readonly string[],
): ResolvedSchemaPath | SchemaPathFailure {
  return resolveFrom(root, path, []);
}

function resolveFrom(
  root: z.core.$ZodType,
  path: readonly string[],
  prefix: readonly string[],
): ResolvedSchemaPath | SchemaPathFailure {
  let current = root;
  let omissible = false;
  const walked = [...prefix];

  for (const [index, segment] of path.entries()) {
    const unwrapped = unwrap(current);
    if (unwrapped.omissible) omissible = true;
    const definition = schemaDefinition(unwrapped.inner);

    if (String(definition.type) === "union") {
      const resolved = resolveAcrossUnion(definition, path.slice(index), walked);
      if (isSchemaPathFailure(resolved)) return resolved;
      return { schema: resolved.schema, omissible: omissible || resolved.omissible };
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

  // A union AT the leaf is a value shape, not a path fork — there is nothing
  // left to walk — so it resolves as itself, and a canonical field declared as
  // a union still matches by object identity.
  const leaf = unwrap(current);
  return { schema: leaf.inner, omissible: omissible || leaf.omissible };
}

/**
 * The whole remaining path, resolved in every union member.
 *
 * `omissible` is true as soon as ONE member cannot supply the key: an input
 * parsed by that member is valid without it, so demanding a column for it would
 * reject rows the workflow itself accepts.
 */
function resolveAcrossUnion(
  definition: { readonly [key: string]: unknown },
  path: readonly string[],
  prefix: readonly string[],
): ResolvedSchemaPath | SchemaPathFailure {
  const members = definition.options as readonly z.core.$ZodType[];
  const at = [...prefix, ...path].join(".");

  let found: ResolvedSchemaPath | undefined;
  let omissible = false;
  let matches = 0;
  let deepestFailure: SchemaPathFailure | undefined;

  for (const member of members) {
    const resolved = resolveFrom(member, path, prefix);
    if (isSchemaPathFailure(resolved)) {
      // A member that lacks the path makes it omissible; the failure is only
      // reported if NO member has it, so keep the one that walked furthest.
      omissible = true;
      if (deepestFailure === undefined || failureDepth(resolved) > failureDepth(deepestFailure)) {
        deepestFailure = resolved;
      }
      continue;
    }
    matches += 1;
    if (resolved.omissible) omissible = true;
    if (found === undefined) {
      found = resolved;
      continue;
    }
    if (found.schema !== resolved.schema) return { kind: "divergent-across-union", at, members: matches };
  }

  if (found === undefined) {
    if (deepestFailure === undefined) return { kind: "not-an-object", at: at.length === 0 ? "<root>" : at };
    return deepestFailure;
  }
  return { schema: found.schema, omissible };
}

function failureDepth(failure: SchemaPathFailure): number {
  return failure.at === "<root>" ? 0 : failure.at.split(".").length;
}

export function isSchemaPathFailure(
  resolved: ResolvedSchemaPath | SchemaPathFailure,
): resolved is SchemaPathFailure {
  return "kind" in resolved;
}
