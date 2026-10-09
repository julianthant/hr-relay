/**
 * The canonical-input snapshot contract (ref workflow-model §2, D62).
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
 * anywhere in its graph. `src/domain/validation/canonical-input-schema.ts` proves that
 * mechanically; this module proves the round-trip
 * `input → canonicalInput → identical value` at descriptor construction, so a
 * canonical schema that drifts from its ingress schema fails loud at build
 * rather than at the first resume.
 */
import type { z } from "zod";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { auditContractBoundarySchema } from "../validation/contract-boundary.js";
import { auditCanonicalInputSchema } from "../validation/canonical-input-schema.js";

/**
 * A validation-only view of `z.output<InputSchema>`.
 *
 * Only the OUTPUT is pinned. A branded field makes zod's declared input type the
 * unbranded primitive, so requiring `ZodType<Out, Out>` would reject every
 * schema carrying an `Eid`. What keeps input and output structurally identical
 * is the transform-free audit, not the type parameter — and
 * `assertAuditedCanonicalInput` proves at runtime that the audit actually ran,
 * the same way `assertFactorySealedTaskContract` does for contracts.
 */
export type CanonicalInputSchema<InputSchema extends z.ZodType> = z.ZodType<z.output<InputSchema>>;

/**
 * The parsed round-trip samples, retained per audited schema. Descriptor
 * construction reuses them to prove identity, presentation, and subject
 * resolution against real inputs instead of re-declaring a second sample set
 * that could drift from this one.
 */
const AUDITED_CANONICAL_INPUTS = new WeakMap<object, readonly unknown[]>();

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
