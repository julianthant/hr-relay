/** Transform-free audit for a workflow's canonical-input schema, living beside `contract-boundary.ts` because both walk zod's internal definitions. */
import { z } from "zod";
import { auditContractBoundarySchema } from "./contract-boundary.js";

interface ZodInternals {
  readonly _zod: { readonly def: { readonly [key: string]: unknown } };
}

function schemaDefinition(schema: z.core.$ZodType): { readonly [key: string]: unknown } {
  return (schema as unknown as ZodInternals)._zod.def;
}

/** Node kinds that re-apply ingress semantics on a read; every one is banned. */
const INGRESS_NODE_REASONS: Readonly<Record<string, string>> = {
  default: "re-applies a default, so a deploy could rewrite an in-flight run's input",
  prefault: "re-applies a fallback, so a deploy could rewrite an in-flight run's input",
  catch: "swallows invalid stored bytes instead of failing loud",
  transform: "re-transforms an already-transformed snapshot",
  pipe: "chains ingress parsing into a validation-only schema",
  success: "converts a parse failure into a boolean instead of failing loud",
};

/** Walk the whole schema graph — a transform buried under an array element or a union arm re-applies on exactly the same read as a top-level one. */
export function auditCanonicalInputSchema(
  schema: z.core.$ZodType,
  label: string,
): readonly string[] {
  const issues: string[] = [...auditContractBoundarySchema(schema, label)];
  const seen = new Set<z.core.$ZodType>();
  function visit(current: z.core.$ZodType, path: string): void {
    if (seen.has(current)) return;
    seen.add(current);
    const definition = schemaDefinition(current);
    const type = String(definition.type);
    const banned = INGRESS_NODE_REASONS[type];
    if (banned !== undefined) {
      issues.push(`${path} uses ${type}, which ${banned}`);
      return;
    }
    if (definition.coerce === true) {
      issues.push(`${path} coerces, so a stored value of the wrong type would be silently accepted`);
      return;
    }
    if (type === "object") {
      for (const [key, child] of Object.entries(definition.shape as Readonly<Record<string, z.core.$ZodType>>)) {
        visit(child, `${path}.${key}`);
      }
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
      return;
    }
    if (["optional", "nullable", "readonly", "nonoptional"].includes(type)) {
      visit(definition.innerType as z.core.$ZodType, `${path}?`);
    }
  }
  visit(schema, label);
  return issues;
}

