/** Describe a commit contract's COMPLETION PROOF schema as a flat list of typed fields, so a confirmed-present resolution can be composed by an operator instead of only by the kernel. */
import type { z } from "zod";

/** One leaf of a proof, addressed by its dot path; `fixed` is not an operator input — it is a literal the schema pins. */
export type ProofShapeField =
  | { readonly kind: "fixed"; readonly path: string; readonly value: string | number | boolean }
  | {
    readonly kind: "text";
    readonly path: string;
    readonly minLength?: number;
    readonly maxLength?: number;
    /** The regex SOURCE, so a client can check it without a zod schema. */
    readonly pattern?: string;
    /** A named syntax the surface can label; today only ISO-8601 instants. */
    readonly format?: "iso-datetime";
    /** True when the leaf carries a `.refine()` no wire can transport. */
    readonly serverOnlyRules: boolean;
  }
  | { readonly kind: "choice"; readonly path: string; readonly options: readonly string[] }
  | {
    readonly kind: "integer";
    readonly path: string;
    readonly minimum?: number;
    readonly maximum?: number;
  }
  | { readonly kind: "boolean"; readonly path: string };

export type ProofShape =
  | { readonly state: "described"; readonly fields: readonly ProofShapeField[] }
  /** Named, with the path and the zod type — never a silent empty field list. */
  | { readonly state: "undescribable"; readonly reason: string };

function definitionOf(schema: z.core.$ZodType): { readonly [key: string]: unknown } {
  return schema._zod.def as z.core.$ZodTypeDef & { readonly [key: string]: unknown };
}

interface CheckDefinition {
  readonly [key: string]: unknown;
}

function checksOf(definition: { readonly [key: string]: unknown }): readonly CheckDefinition[] {
  const raw = definition.checks;
  if (!Array.isArray(raw)) return [];
  return raw.map((check) => definitionOf(check as z.core.$ZodType));
}

function numericCheck(check: CheckDefinition, key: string): number | undefined {
  const value = check[key];
  return typeof value === "number" ? value : undefined;
}

class UndescribableProof extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "UndescribableProof";
  }
}

function refuse(path: string, why: string): never {
  throw new UndescribableProof(`${path === "" ? "the proof root" : `proof field "${path}"`} ${why}`);
}

function describeString(path: string, definition: { readonly [key: string]: unknown }): ProofShapeField {
  // `z.iso.datetime()` is a string whose constraint lives on the definition
  // rather than in a check, and it is the one named syntax a proof leaf uses.
  const isInstant = definition.format === "datetime";
  let minLength: number | undefined;
  let maxLength: number | undefined;
  let pattern: string | undefined;
  let serverOnlyRules = false;
  for (const check of checksOf(definition)) {
    switch (check.check) {
      case "min_length":
        minLength = numericCheck(check, "minimum");
        break;
      case "max_length":
        maxLength = numericCheck(check, "maximum");
        break;
      case "length_equals":
        minLength = numericCheck(check, "length");
        maxLength = numericCheck(check, "length");
        break;
      case "string_format": {
        if (check.format !== "regex") {
          refuse(path, `carries the string format "${String(check.format)}", which this describer does not model`);
        }
        const source = check.pattern;
        if (!(source instanceof RegExp)) refuse(path, "carries a regex check with no readable pattern");
        pattern = source.source;
        break;
      }
      case "custom":
        // Describe refinements; the kernel enforces rules that cannot cross the wire.
        serverOnlyRules = true;
        break;
      default:
        refuse(path, `carries the string check "${String(check.check)}", which this describer does not model`);
    }
  }
  if (isInstant && pattern === undefined) {
    const declared = definition.pattern;
    if (declared instanceof RegExp) pattern = declared.source;
  }
  return {
    kind: "text",
    path,
    ...(minLength === undefined ? {} : { minLength }),
    ...(maxLength === undefined ? {} : { maxLength }),
    ...(pattern === undefined ? {} : { pattern }),
    ...(isInstant ? { format: "iso-datetime" as const } : {}),
    serverOnlyRules,
  };
}

function describeNumber(path: string, definition: { readonly [key: string]: unknown }): ProofShapeField {
  let integer = false;
  let minimum: number | undefined;
  let maximum: number | undefined;
  for (const check of checksOf(definition)) {
    switch (check.check) {
      case "number_format":
        // `int()`/`safeint` is the only numeric format a proof leaf uses; a
        // float leaf would need a form control this describer does not model.
        if (check.format !== "safeint" && check.format !== "int32" && check.format !== "uint32") {
          refuse(path, `carries the number format "${String(check.format)}", which this describer does not model`);
        }
        integer = true;
        break;
      case "greater_than": {
        const value = numericCheck(check, "value");
        if (value === undefined) refuse(path, "carries a lower bound with no readable value");
        minimum = check.inclusive === true ? value : value + 1;
        break;
      }
      case "less_than": {
        const value = numericCheck(check, "value");
        if (value === undefined) refuse(path, "carries an upper bound with no readable value");
        maximum = check.inclusive === true ? value : value - 1;
        break;
      }
      default:
        refuse(path, `carries the number check "${String(check.check)}", which this describer does not model`);
    }
  }
  if (!integer) {
    refuse(path, "is a non-integer number; a proof leaf a person types must have an exact spelling");
  }
  return {
    kind: "integer",
    path,
    ...(minimum === undefined ? {} : { minimum }),
    ...(maximum === undefined ? {} : { maximum }),
  };
}

function describeLeaf(path: string, schema: z.core.$ZodType): ProofShapeField {
  const definition = definitionOf(schema);
  const type = String(definition.type);
  switch (type) {
    case "string":
      return describeString(path, definition);
    case "number":
      return describeNumber(path, definition);
    case "boolean":
      return { kind: "boolean", path };
    case "enum": {
      const entries = definition.entries;
      if (entries === null || typeof entries !== "object") refuse(path, "is an enum with no readable options");
      const values: readonly unknown[] = Object.values(entries as Record<string, unknown>);
      const options = values.filter((option): option is string => typeof option === "string");
      if (options.length === 0 || options.length !== values.length) {
        refuse(path, "is an enum whose options are not all strings");
      }
      return { kind: "choice", path, options };
    }
    case "literal": {
      const values = definition.values;
      if (!Array.isArray(values) || values.length !== 1) {
        refuse(path, "is a multi-valued literal; the schema pins no single value for it");
      }
      const [value] = values as readonly unknown[];
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
        refuse(path, `pins the literal ${String(value)}, which is not a value a wire can carry`);
      }
      return { kind: "fixed", path, value };
    }
    default:
      refuse(path, `is a zod "${type}", which this describer does not model`);
  }
}

function describeObject(path: string, schema: z.core.$ZodType, depth: number): ProofShapeField[] {
  const definition = definitionOf(schema);
  const type = String(definition.type);
  if (type !== "object") {
    refuse(path, `is a zod "${type}"; a proof this surface can compose is an object of named fields`);
  }
  const shape = definition.shape;
  if (shape === null || typeof shape !== "object") refuse(path, "is an object with no readable shape");
  const catchall = definition.catchall;
  if (catchall !== undefined && String(definitionOf(catchall as z.core.$ZodType).type) !== "never") {
    refuse(path, "admits unknown keys, so no field list can claim to be the whole proof");
  }
  const fields: ProofShapeField[] = [];
  for (const [key, member] of Object.entries(shape as Record<string, z.core.$ZodType>)) {
    const childPath = path === "" ? key : `${path}.${key}`;
    if (String(definitionOf(member).type) === "object") {
      if (depth === 0) {
        refuse(childPath, "nests deeper than this describer walks; a proof form addresses one dotted level");
      }
      fields.push(...describeObject(childPath, member, depth - 1));
      continue;
    }
    fields.push(describeLeaf(childPath, member));
  }
  return fields;
}

/** The ordered field list of a proof schema, or a named reason it has none; order is the schema's own declaration order. */
export function describeProofShape(schema: z.core.$ZodType): ProofShape {
  try {
    const fields = describeObject("", schema, 1);
    if (fields.length === 0) {
      return { state: "undescribable", reason: "the proof schema declares no fields at all" };
    }
    return { state: "described", fields };
  } catch (error) {
    if (error instanceof UndescribableProof) return { state: "undescribable", reason: error.message };
    throw error;
  }
}
