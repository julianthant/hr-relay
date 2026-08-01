/**
 * The canonical-input snapshot contract (doc 02 §2, D62).
 *
 * A workflow's raw submission is stored immutable for audit, then validated
 * ONCE by `descriptor.input` — defaults and transforms applied. The resulting
 * `z.output` value is the run's canonical input snapshot.
 *
 * Those stored bytes are **not trusted**. Every authority read re-parses them
 * through a SEPARATE strict `canonicalInput` schema that validates the already
 * transformed shape *without* re-applying ingress coercion. That is the whole
 * point: if resume re-ran `descriptor.input`, a deploy that changed a default
 * would silently rewrite an in-flight run's input.
 *
 * So a canonical-input schema must be **transform-free**: no `.default()`,
 * `.catch()`, `.transform()`, `.preprocess()`, `.pipe()`, or `z.coerce.*`
 * anywhere in its graph. This module proves that mechanically, and proves the
 * round-trip `input → canonicalInput → identical value` at descriptor
 * construction, so a canonical schema that drifts from its ingress schema fails
 * loud at build rather than at the first resume.
 */
import { z } from "zod";
import { canonicalJsonStringify } from "../canonical-json.js";
import { auditContractBoundarySchema } from "../../validation/contract-boundary.js";

declare const canonicalInputBrand: unique symbol;

/**
 * A validation-only view of `z.output<InputSchema>`. Produced solely by
 * `defineCanonicalInput`, so an unaudited schema cannot reach a descriptor.
 *
 * Only the OUTPUT is pinned. A branded field makes zod's declared input type
 * the unbranded primitive, so requiring `ZodType<Out, Out>` would reject every
 * schema carrying an `Eid`. What keeps input and output structurally identical
 * here is the transform-free audit, not the type parameter.
 */
export type CanonicalInputSchema<InputSchema extends z.ZodType> =
  z.ZodType<z.output<InputSchema>> & { readonly [canonicalInputBrand]: true };

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

/**
 * Walk the whole schema graph — a transform buried under an array element or a
 * union arm re-applies on exactly the same read as a top-level one.
 */
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

/**
 * Bind a workflow's ingress schema to its canonical-input validator.
 *
 * `samples` are raw submissions covering every arm of the ingress schema — each
 * one is parsed through `input`, re-parsed through `canonical`, and required to
 * come back canonically identical. Without samples the round-trip claim would be
 * unproven, so at least one is mandatory.
 */
export function defineCanonicalInput<InputSchema extends z.ZodType>(
  input: InputSchema,
  canonical: z.ZodType<z.output<InputSchema>>,
  samples: readonly [z.input<InputSchema>, ...z.input<InputSchema>[]],
): CanonicalInputSchema<InputSchema> {
  const ingressIssues = auditContractBoundarySchema(input, "workflow input");
  if (ingressIssues.length > 0) {
    throw new Error(`workflow input schema is not boundary-safe: ${ingressIssues.join("; ")}`);
  }
  const issues = auditCanonicalInputSchema(canonical, "canonicalInput");
  if (issues.length > 0) {
    throw new Error(`canonical input schema must be transform-free: ${issues.join("; ")}`);
  }
  // The non-empty tuple type already says this; the runtime backstop stops a
  // cast from turning the round-trip proof into a vacuous claim.
  if (samples.length === 0) {
    throw new Error("canonical input requires at least one ingress sample to prove the round-trip");
  }
  for (const [index, sample] of samples.entries()) {
    const parsed: unknown = input.parse(sample);
    const revalidated: unknown = canonical.parse(parsed);
    if (canonicalJsonStringify(parsed) !== canonicalJsonStringify(revalidated)) {
      throw new Error(
        `canonical input sample ${String(index)} does not round-trip: `
        + `${canonicalJsonStringify(parsed)} became ${canonicalJsonStringify(revalidated)}`,
      );
    }
  }
  return canonical as CanonicalInputSchema<InputSchema>;
}

/**
 * Re-validate a stored canonical snapshot on every authority read. Fails loud —
 * a snapshot that no longer parses is corrupted authority, never something to
 * repair by re-running ingress.
 */
export function parseCanonicalInputSnapshot<InputSchema extends z.ZodType>(
  canonical: CanonicalInputSchema<InputSchema>,
  stored: unknown,
): z.output<InputSchema> {
  const result = canonical.safeParse(stored);
  if (!result.success) {
    throw new Error(
      `stored canonical input snapshot is invalid and will not be re-derived from ingress: `
      + `${result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
    );
  }
  return result.data;
}
