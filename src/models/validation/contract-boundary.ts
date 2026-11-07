import { z } from "zod";

function schemaDefinition(schema: z.core.$ZodType): { readonly [key: string]: unknown } {
  return schema._zod.def as z.core.$ZodTypeDef & { readonly [key: string]: unknown };
}

/** Audits the complete schema graph because nested open/unknown values cross the same boundary. */
export function auditContractBoundarySchema(
  schema: z.core.$ZodType,
  label: string,
): readonly string[] {
  const issues: string[] = [];
  const seen = new Set<z.core.$ZodType>();
  const rootType = String(schemaDefinition(schema).type);
  if (rootType !== "object" && rootType !== "union") {
    issues.push(`${label} must be a strict object or strict-object union`);
  }
  function visit(current: z.core.$ZodType, path: string): void {
    if (seen.has(current)) return;
    seen.add(current);
    const definition = schemaDefinition(current);
    const type = String(definition.type);
    if (type === "any" || type === "unknown") {
      issues.push(`${path} cannot contain z.${type}`);
      return;
    }
    if (type === "record" || type === "map" || type === "set") {
      issues.push(`${path} cannot contain decision-bearing ${type} values`);
      return;
    }
    if (type === "object") {
      const catchall = definition.catchall as z.core.$ZodType | undefined;
      if (catchall?._zod.def.type !== "never") issues.push(`${path} must use z.strictObject`);
      const shape = definition.shape as { readonly [key: string]: z.core.$ZodType };
      for (const [key, child] of Object.entries(shape)) visit(child, `${path}.${key}`);
      return;
    }
    if (type === "union") {
      for (const [index, option] of (definition.options as z.core.$ZodType[]).entries()) {
        visit(option, `${path}|${String(index)}`);
      }
      return;
    }
    if (type === "array") {
      visit(definition.element as z.core.$ZodType, `${path}[]`);
      return;
    }
    if (type === "lazy") {
      visit((definition.getter as () => z.core.$ZodType)(), `${path}<lazy>`);
      return;
    }
    if (["optional", "nullable", "default", "readonly", "nonoptional", "catch"].includes(type)) {
      visit(definition.innerType as z.core.$ZodType, `${path}?`);
      return;
    }
    if (type === "pipe") {
      visit(definition.in as z.core.$ZodType, `${path}<in>`);
      visit(definition.out as z.core.$ZodType, `${path}<out>`);
      return;
    }
    if (type === "intersection") {
      visit(definition.left as z.core.$ZodType, `${path}&left`);
      visit(definition.right as z.core.$ZodType, `${path}&right`);
      return;
    }
    if (type === "tuple") {
      for (const [index, item] of (definition.items as z.core.$ZodType[]).entries()) {
        visit(item, `${path}[${String(index)}]`);
      }
      if (definition.rest !== null && definition.rest !== undefined) {
        visit(definition.rest as z.core.$ZodType, `${path}[...]`);
      }
    }
  }
  visit(schema, label);
  return issues;
}

export function assertContractBoundarySchema(schema: z.core.$ZodType, label: string): void {
  const issues = auditContractBoundarySchema(schema, label);
  if (issues.length > 0) throw new Error(issues.join("; "));
}

// Unconditional reads require every union arm; conditional input paths need only one.
function schemaOwnsPath(
  schema: z.core.$ZodType,
  parts: readonly string[],
  unionRule: "every" | "some" = "every",
  collections = false,
): boolean {
  const ancestry = new WeakMap<object, Set<string>>();
  function visit(current: z.core.$ZodType, remaining: readonly string[]): boolean {
    if (remaining.length === 0) return true;
    const signature = remaining.join(".");
    const currentObject = current;
    const signatures = ancestry.get(currentObject) ?? new Set<string>();
    if (signatures.has(signature)) return false;
    signatures.add(signature);
    ancestry.set(currentObject, signatures);
    try {
      const definition = schemaDefinition(current);
      const type = String(definition.type);
      if (type === "object") {
        const [head, ...tail] = remaining;
        if (head === undefined) return true;
        const shape = definition.shape as { readonly [key: string]: z.core.$ZodType };
        return Object.hasOwn(shape, head) && visit(shape[head], tail);
      }
      if (type === "array" && collections) return visit(definition.element as z.core.$ZodType, remaining);
      if (type === "union") {
        const options = definition.options as z.core.$ZodType[];
        return unionRule === "every"
          ? options.every((option) => visit(option, remaining))
          : options.some((option) => visit(option, remaining));
      }
      if (type === "lazy") return visit((definition.getter as () => z.core.$ZodType)(), remaining);
      if (["optional", "nullable", "default", "readonly", "nonoptional", "catch"].includes(type)) {
        return visit(definition.innerType as z.core.$ZodType, remaining);
      }
      if (type === "pipe") return visit(definition.out as z.core.$ZodType, remaining);
      if (type === "intersection") {
        return visit(definition.left as z.core.$ZodType, remaining)
          || visit(definition.right as z.core.$ZodType, remaining);
      }
      return false;
    } finally {
      signatures.delete(signature);
    }
  }
  return visit(schema, parts);
}

export function assertSchemaOwnsPath(schema: z.core.$ZodType, path: string, owner: string): void {
  if (!schemaOwnsPath(schema, path.split("."))) throw new Error(`${owner} references unknown schema field ${path}`);
}

/** Like `assertSchemaOwnsPath`, but one union arm carrying the field is enough. */
export function assertSchemaOffersPath(schema: z.core.$ZodType, path: string, owner: string): void {
  if (!schemaOwnsPath(schema, path.split("."), "some")) {
    throw new Error(`${owner} references unknown schema field ${path}`);
  }
}

/** Operator collection paths address every array member without selecting a candidate. */
export function assertSchemaOffersCollectionPath(schema: z.core.$ZodType, path: string, owner: string): void {
  if (!schemaOwnsPath(schema, path.split("."), "some", true)) throw new Error(`${owner} references unknown schema field ${path}`);
}

export function assertBooleanSelectionField(schema: z.core.$ZodType, field: string, owner: string): void {
  const seen = new Set<z.core.$ZodType>();
  function visit(current: z.core.$ZodType, atField: boolean): boolean | undefined {
    if (seen.has(current)) return false;
    seen.add(current);
    try {
      const definition = schemaDefinition(current);
      const type = String(definition.type);
      if (type === "union") {
        const offered = (definition.options as z.core.$ZodType[]).map(option => visit(option, atField))
          .filter(value => value !== undefined);
        return offered.length === 0 ? undefined : offered.every(Boolean);
      }
      if (type === "lazy") return visit((definition.getter as () => z.core.$ZodType)(), atField);
      if (["optional", "default", "readonly", "nonoptional", "catch"].includes(type)) {
        return visit(definition.innerType as z.core.$ZodType, atField);
      }
      if (!atField && type === "object") {
        const shape = definition.shape as Readonly<Record<string, z.core.$ZodType>>;
        return Object.hasOwn(shape, field) ? visit(shape[field], true) : undefined;
      }
      if (atField && type === "boolean") return true;
      if (atField && type === "literal") {
        const values = definition.values as unknown[];
        return values.length > 0 && values.every(value => typeof value === "boolean");
      }
      return false;
    } finally { seen.delete(current); }
  }
  if (visit(schema, false) !== true) throw new Error(`${owner} selection field must be boolean`);
}

/** Copies/freezes declarations while preserving the mutable runtime identity of schemas/functions. */
export function sealDeclarativeMetadata<Value>(
  value: Value,
  seen = new WeakMap<object, unknown>(),
): Value {
  if (typeof value === "function" || value instanceof z.ZodType) return value;
  if (value === null || typeof value !== "object") return value;
  const cached = seen.get(value);
  if (cached !== undefined) return cached as Value;
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const item of value) copy.push(sealDeclarativeMetadata(item, seen));
    return Object.freeze(copy) as Value;
  }
  const prototype = Reflect.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("task contract declarative metadata must use plain canonical objects");
  }
  const copy: { [key: string]: unknown } = {};
  seen.set(value, copy);
  for (const [key, item] of Object.entries(value)) copy[key] = sealDeclarativeMetadata(item, seen);
  return Object.freeze(copy) as Value;
}

/* ── the field census a contract's schema owns ─────────────────────── */

/** What one census leaf holds, as a closed vocabulary; declared as a zod enum because the explorer's wire re-serves it verbatim and imports THIS one instead of a second copy. */
export const ContractSchemaLeafKindSchema = z.enum([
  "string", "number", "boolean", "bigint", "date", "enum", "literal",
  "null", "list", "value",
]);
export type ContractSchemaLeafKind = z.infer<typeof ContractSchemaLeafKindSchema>;

/** One field of a contract boundary, named by the dotted path a consumer reads it at; `presence` is `sometimes` when the leaf is optional, nullable, defaulted, or carried by only SOME union arms. */
export interface ContractSchemaLeaf {
  readonly path: string;
  readonly kind: ContractSchemaLeafKind;
  readonly presence: "always" | "sometimes";
  /** The closed vocabulary an `enum`/`literal` leaf admits, sorted. */
  readonly options?: readonly string[];
}

/** Scalar-ish zod tags whose value is ONE field; a tag in neither list throws, because an unrecognised tag may be a CONTAINER. */
const LEAF_KIND_BY_ZOD_TYPE: { readonly [tag: string]: ContractSchemaLeafKind } = {
  string: "string",
  number: "number",
  boolean: "boolean",
  bigint: "bigint",
  date: "date",
  enum: "enum",
  literal: "literal",
  null: "null",
  undefined: "value",
  void: "value",
  nan: "number",
  symbol: "value",
  file: "value",
  template_literal: "string",
  custom: "value",
  never: "value",
  any: "value",
  unknown: "value",
};

/** Container tags that count as ONE leaf; the census has to agree with the evidence and prefix rules or the "Recorded" column would resolve a rule against a path no policy can name. */
const ONE_LEAF_CONTAINER_ZOD_TYPES = new Set(["array", "tuple", "set", "map", "record"]);

const ALWAYS = "always" as const;
const SOMETIMES = "sometimes" as const;

function weaker(
  left: "always" | "sometimes",
  right: "always" | "sometimes",
): "always" | "sometimes" {
  return left === ALWAYS && right === ALWAYS ? ALWAYS : SOMETIMES;
}

/** Merge two descriptions of ONE path — the weaker presence, the wider vocabulary. */
function mergeLeaf(left: ContractSchemaLeaf, right: ContractSchemaLeaf): ContractSchemaLeaf {
  const options = left.options === undefined && right.options === undefined
    ? undefined
    : [...new Set([...(left.options ?? []), ...(right.options ?? [])])].sort();
  return Object.freeze({
    path: left.path,
    kind: left.kind === right.kind ? left.kind : "value",
    presence: weaker(left.presence, right.presence),
    ...(options === undefined ? {} : { options }),
  });
}

function indexLeaves(leaves: readonly ContractSchemaLeaf[]): ReadonlyMap<string, ContractSchemaLeaf> {
  const index = new Map<string, ContractSchemaLeaf>();
  for (const leaf of leaves) {
    const existing = index.get(leaf.path);
    index.set(leaf.path, existing === undefined ? leaf : mergeLeaf(existing, leaf));
  }
  return index;
}

/** The leaves a schema owns, RELATIVE to itself — a scalar answers with the one unnamed leaf `""`, which its caller then names. */
function relativeLeaves(
  schema: z.core.$ZodType,
  presence: "always" | "sometimes",
  ancestors: readonly object[],
): readonly ContractSchemaLeaf[] {
  const currentObject = schema;
  if (ancestors.includes(currentObject)) {
// Recursive depth belongs to values; report one leaf rather than inventing a depth limit.
    return [Object.freeze({ path: "", kind: "value" as const, presence })];
  }
  const definition = schemaDefinition(schema);
  const type = String(definition.type);

  if (type === "object") {
    const nested = [...ancestors, currentObject];
    const shape = definition.shape as { readonly [key: string]: z.core.$ZodType };
    return Object.entries(shape).flatMap(([key, child]) =>
      relativeLeaves(child, presence, nested).map((leaf) => Object.freeze({
        ...leaf,
        path: leaf.path.length === 0 ? key : `${key}.${leaf.path}`,
      })));
  }
  if (type === "union") {
    const nested = [...ancestors, currentObject];
    const allArms = (definition.options as z.core.$ZodType[])
      .map((option) => indexLeaves(relativeLeaves(option, presence, nested)));
    // Null-only arms weaken child presence without naming the container as a field.
    const named = allArms.filter((arm) => [...arm.keys()].some((path) => path.length > 0));
    const arms = named.length === 0 ? allArms : named;
    const everyArmNames = named.length === allArms.length;
    const merged = new Map<string, ContractSchemaLeaf>();
    for (const arm of arms) {
      for (const [path, leaf] of arm) {
        // A field missing from any union arm is not guaranteed present.
        const inEveryArm = everyArmNames && arms.every((other) => other.has(path));
        const scoped: ContractSchemaLeaf = Object.freeze({
          ...leaf,
          presence: inEveryArm ? leaf.presence : SOMETIMES,
        });
        const existing = merged.get(path);
        merged.set(path, existing === undefined ? scoped : mergeLeaf(existing, scoped));
      }
    }
    return [...merged.values()];
  }
  if (type === "intersection") {
    const nested = [...ancestors, currentObject];
    return [...indexLeaves([
      ...relativeLeaves(definition.left as z.core.$ZodType, presence, nested),
      ...relativeLeaves(definition.right as z.core.$ZodType, presence, nested),
    ]).values()];
  }
  if (type === "lazy") {
    const nested = [...ancestors, currentObject];
    return relativeLeaves((definition.getter as () => z.core.$ZodType)(), presence, nested);
  }
  if (type === "pipe") {
    return relativeLeaves(definition.out as z.core.$ZodType, presence, ancestors);
  }
  if (type === "nonoptional" || type === "readonly") {
    return relativeLeaves(definition.innerType as z.core.$ZodType, presence, ancestors);
  }
  if (["optional", "nullable", "default", "prefault", "catch"].includes(type)) {
    return relativeLeaves(definition.innerType as z.core.$ZodType, SOMETIMES, ancestors);
  }
  if (ONE_LEAF_CONTAINER_ZOD_TYPES.has(type)) {
    return [Object.freeze({ path: "", kind: "list" as const, presence })];
  }
  const kind = LEAF_KIND_BY_ZOD_TYPE[type];
  if (kind === undefined) {
    throw new Error(
      `a contract field is z.${type}, which the field census does not recognise; `
      + "declare it in src/domain/validation/contract-boundary.ts rather than letting a whole "
      + "subtree count as one field",
    );
  }
  const options = vocabularyOf(definition, type);
  return [Object.freeze({
    path: "",
    kind,
    presence,
    ...(options === undefined ? {} : { options }),
  })];
}

// Derive field descriptions and fingerprints from the same schema to prevent drift.
export function contractSchemaLeaves(schema: z.core.$ZodType): readonly ContractSchemaLeaf[] {
  const leaves = relativeLeaves(schema, ALWAYS, []);
  const unnamed = leaves.find((leaf) => leaf.path.length === 0);
  if (unnamed !== undefined) {
    throw new Error(
      "a contract boundary schema must be an object or a union of objects; this one has a "
      + "value at its root, so its fields have no names",
    );
  }
  const merged = [...indexLeaves(leaves).values()];
// Nullable containers already weaken child presence; omit their duplicate null leaf.
  const containers = new Set(merged.flatMap(({ path }) => {
    const segments = path.split(".");
    return segments.slice(0, -1).map((_part, index) => segments.slice(0, index + 1).join("."));
  }));
  return merged
    .filter((leaf) => !(leaf.kind === "null" && containers.has(leaf.path)))
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
}

/** The closed vocabulary an enum or literal admits, as strings, or nothing. */
function vocabularyOf(
  definition: { readonly [key: string]: unknown },
  type: string,
): readonly string[] | undefined {
  if (type === "enum") {
    const entries = definition.entries as Readonly<Record<string, string | number>> | undefined;
    if (entries === undefined) return undefined;
    return [...new Set(Object.values(entries).map((value) => String(value)))].sort();
  }
  if (type === "literal") {
    const values = definition.values as readonly unknown[] | undefined;
    if (values === undefined) return undefined;
    return [...new Set(values.map((value) => String(value)))].sort();
  }
  return undefined;
}
