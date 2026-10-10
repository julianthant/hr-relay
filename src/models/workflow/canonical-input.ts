/** The canonical-input snapshot contract: a raw submission is stored immutable for audit, then validated ONCE with defaults and transforms applied. */
import type { z } from "zod";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { auditContractBoundarySchema } from "../validation/contract-boundary.js";
import { auditCanonicalInputSchema } from "../validation/canonical-input-schema.js";

// Pin output types; branded schemas accept unbranded ingress values.
export type CanonicalInputSchema<InputSchema extends z.ZodType> = z.ZodType<z.output<InputSchema>>;

// Reuse audited samples so descriptor validation cannot drift.
const AUDITED_CANONICAL_INPUTS = new WeakMap<object, readonly unknown[]>();

/** Bind a workflow's ingress schema to its canonical-input validator; every sample must come back canonically identical, or the round-trip claim would be unprovable. */
export function defineCanonicalInput<InputSchema extends z.ZodType>(
  input: InputSchema,
  canonical: CanonicalInputSchema<InputSchema>,
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
  const parsedSamples: unknown[] = [];
  for (const [index, sample] of samples.entries()) {
    const parsed: unknown = input.parse(sample);
    const revalidated: unknown = canonical.parse(parsed);
    if (canonicalJsonStringify(parsed) !== canonicalJsonStringify(revalidated)) {
      throw new Error(
        `canonical input sample ${String(index)} does not round-trip: `
        + `${canonicalJsonStringify(parsed)} became ${canonicalJsonStringify(revalidated)}`,
      );
    }
    parsedSamples.push(parsed);
  }
  AUDITED_CANONICAL_INPUTS.set(canonical, Object.freeze(parsedSamples));
  return canonical;
}

/** A descriptor may only carry a canonical schema that went through the audit. */
export function assertAuditedCanonicalInput(schema: object): void {
  if (!AUDITED_CANONICAL_INPUTS.has(schema)) {
    throw new Error("descriptor requires the exact schema returned by defineCanonicalInput");
  }
}

/** The audited round-trip samples, as parsed `z.output` values. Fails loud when unaudited. */
export function canonicalInputSamples(schema: object): readonly unknown[] {
  const samples = AUDITED_CANONICAL_INPUTS.get(schema);
  if (samples === undefined) {
    throw new Error("canonical input samples require the exact schema returned by defineCanonicalInput");
  }
  return samples;
}

// Invalid stored snapshots are corrupted authority; never rerun ingress to repair them.
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
