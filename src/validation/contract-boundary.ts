import { z } from "zod";

interface ZodInternals {
  readonly _zod: { readonly def: { readonly [key: string]: unknown } };
}

function schemaDefinition(schema: z.core.$ZodType): { readonly [key: string]: unknown } {
  return (schema as unknown as ZodInternals)._zod.def;
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
      const catchall = definition.catchall as ZodInternals | undefined;
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

/**
 * `every` — the path must resolve in EVERY union arm, which is what a consumer
 * reading the value unconditionally requires.
 * `some` — the path need only resolve in ONE arm. That is the right rule for an
 * ingress surface: a `by-eid`/`by-name` input union has `emplId` in exactly one
 * arm, and requiring it everywhere would make a discriminated submission
 * unspellable.
 */
function schemaOwnsPath(
  schema: z.core.$ZodType,
  parts: readonly string[],
  unionRule: "every" | "some" = "every",
): boolean {
  const seen = new WeakMap<object, Set<string>>();
  function visit(current: z.core.$ZodType, remaining: readonly string[]): boolean {
    if (remaining.length === 0) return true;
    const signature = remaining.join(".");
    const currentObject = current as unknown as object;
    const signatures = seen.get(currentObject) ?? new Set<string>();
    if (signatures.has(signature)) return false;
    signatures.add(signature);
    seen.set(currentObject, signatures);
    const definition = schemaDefinition(current);
    const type = String(definition.type);
    if (type === "object") {
      const [head, ...tail] = remaining;
      if (head === undefined) return true;
      const shape = definition.shape as { readonly [key: string]: z.core.$ZodType };
      return Object.hasOwn(shape, head) && visit(shape[head], tail);
    }
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

/* ── the field census a contract's schema owns (D227) ─────────────────────── */

/**
 * What one census leaf holds, as a closed vocabulary.
 *
 * Declared as a zod enum because the explorer's wire re-serves it verbatim: a
 * second hand-written copy of this list on the wire is the classic pair that
 * eventually disagrees, and the wire schema imports THIS one instead.
 */
export const ContractSchemaLeafKindSchema = z.enum([
  "string", "number", "boolean", "bigint", "date", "enum", "literal",
  "null", "list", "value",
]);
export type ContractSchemaLeafKind = z.infer<typeof ContractSchemaLeafKindSchema>;

/**
 * One field of a contract boundary, named by the dotted path a consumer reads
 * it at.
 *
 * `presence` is `sometimes` when the leaf is optional, nullable, defaulted, or
 * carried by only SOME arms of a union. Which of the three is irrelevant to the
 * one question the census answers — *is this field always in the answer?* — and
 * a reader who needs the distinction has the contract's source link beside it.
 */
export interface ContractSchemaLeaf {
  readonly path: string;
  readonly kind: ContractSchemaLeafKind;
  readonly presence: "always" | "sometimes";
  /** The closed vocabulary an `enum`/`literal` leaf admits, sorted. */
  readonly options?: readonly string[];
}

/**
 * Scalar-ish zod tags whose value is ONE field. Everything structural is walked
 * below; a tag in neither list throws, because an unrecognised tag may be a
 * CONTAINER, and emitting one leaf for a container would report a whole subtree
 * of fields as a single field — a census that looks complete and is not.
 */
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

/**
 * Container tags that count as ONE leaf.
 *
 * `evidenceLeaves` and the freshness / provenance `byField` prefix rule already
 * treat an array as one leaf, and the census has to agree with them or the
 * "Recorded" column would resolve a rule against a path no policy can name. The
 * boundary audit refuses `record`/`map`/`set` outright, so those three are
 * listed for completeness rather than because a contract can reach them.
 */
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

/**
 * The leaves a schema owns, RELATIVE to itself — a scalar answers with the one
 * unnamed leaf `""`, which its caller then names.
 */
function relativeLeaves(
  schema: z.core.$ZodType,
  presence: "always" | "sometimes",
  ancestors: readonly object[],
): readonly ContractSchemaLeaf[] {
  const currentObject = schema as unknown as object;
  if (ancestors.includes(currentObject)) {
    // A recursive schema is a shape whose depth is decided per value, so it is
    // reported as the one leaf it sits at rather than unrolled to some
    // arbitrary depth the contract never promised.
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
    // An arm that contributes only the UNNAMED leaf — `z.null()` beside an
    // object arm is the common one — says "this field may hold no record". That
    // is exactly what `sometimes` already says about the object's own fields,
    // and naming the container's path beside its children would list a
    // container as a field. So such arms weaken presence and name nothing.
    const named = allArms.filter((arm) => [...arm.keys()].some((path) => path.length > 0));
    const arms = named.length === 0 ? allArms : named;
    const everyArmNames = named.length === allArms.length;
    const merged = new Map<string, ContractSchemaLeaf>();
    for (const arm of arms) {
      for (const [path, leaf] of arm) {
        // A path missing from ANY arm is not guaranteed to be in the answer,
        // which is the same distinction `schemaOwnsPath`'s every/some split
        // makes from the checking side.
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
      + "declare it in src/validation/contract-boundary.ts rather than letting a whole "
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

/**
 * Every field a contract boundary schema owns, as dotted paths, sorted.
 *
 * This is the field census the explorer's contract table renders (ref operator-trust §5.9).
 * It is derived from the SAME schema object `deriveSchemaHash` fingerprints, so
 * the census and the hash on the row above it describe one shape — a
 * hand-maintained field list beside a schema hash is two descriptions that
 * eventually disagree.
 */
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
  // A field that is `z.null()` in one union arm and an OBJECT in another lands
  // twice: once as its own path, once as its children. The bare `null` row says
  // "this may hold no record", which is precisely what its children already say
  // by being `sometimes` — and listing a container beside its own fields would
  // make the count wrong. So the container wins and the null row is dropped.
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
