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
