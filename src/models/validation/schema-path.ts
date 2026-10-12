/** Resolve a dotted target path inside a strict object schema; the schema found at that path must be the SAME OBJECT as the canonical field's, by reference comparison. */
import type { z } from "zod";

function schemaDefinition(schema: z.core.$ZodType): { readonly [key: string]: unknown } {
  return schema._zod.def as z.core.$ZodTypeDef & { readonly [key: string]: unknown };
}

const WRAPPERS = new Set(["optional", "nullable", "default", "readonly", "nonoptional", "catch"]);
/** Wrappers that make the KEY omissible, as opposed to widening its value. */
const OMISSIBLE = new Set(["optional", "default", "catch"]);

export interface ResolvedSchemaPath {
    /* The innermost schema object at the path, typed `unknown`: the only correct use is a REFERENCE comparison, and handing back a `z.ZodType` would invite a caller to parse by string path. */
  readonly schema: unknown;
    /* Whether the path may be omitted from a valid input; `nullable` alone does NOT make a path omissible. */
  readonly omissible: boolean;
}

export type SchemaPathFailure =
  | { readonly kind: "not-an-object"; readonly at: string }
  | { readonly kind: "no-such-field"; readonly at: string; readonly known: readonly string[] }
    /* Refuse different schemas for one union path; selecting one would coerce undeclared inputs. */
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

  // A leaf union remains the value schema, preserving object identity.
  const leaf = unwrap(current);
  return { schema: leaf.inner, omissible: omissible || leaf.omissible };
}

  /* The whole remaining path, resolved in every union member; `omissible` is true as soon as ONE member cannot supply the key. */
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
