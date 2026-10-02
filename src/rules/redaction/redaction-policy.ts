import { z } from "zod";

export const DataClassificationSchema = z.enum([
  "secret",
  "credential-file",
  "direct-identifier",
  "sensitive-hr",
  "safe-diagnostic",
]);
export const EvidenceTransformSchema = z.enum(["drop", "digest", "last4", "basename", "count", "allow"]);

export type DataClassification = z.infer<typeof DataClassificationSchema>;
export type EvidenceTransform = z.infer<typeof EvidenceTransformSchema>;

const ALLOWED_TRANSFORMS = {
  secret: new Set<EvidenceTransform>(["drop", "digest"]),
  "credential-file": new Set<EvidenceTransform>(["drop", "digest"]),
  "direct-identifier": new Set<EvidenceTransform>(["drop", "digest", "last4"]),
  "sensitive-hr": new Set<EvidenceTransform>(["drop", "digest", "count"]),
  "safe-diagnostic": new Set<EvidenceTransform>(["allow", "count", "basename"]),
} satisfies Record<DataClassification, ReadonlySet<EvidenceTransform>>;

/** The one closed classification/transform policy used at every redaction boundary. */
export function evidenceTransformAllowed(
  classification: DataClassification,
  transform: EvidenceTransform,
): boolean {
  return ALLOWED_TRANSFORMS[classification].has(transform);
}

/** Apply the canonical closed policy to a schema carrying a classification/transform pair. */
export function refineEvidenceTransformPair(
  field: Readonly<{ classification: DataClassification; transform: EvidenceTransform }>,
  context: z.RefinementCtx,
): void {
  if (!evidenceTransformAllowed(field.classification, field.transform)) {
    context.addIssue({
      code: "custom",
      path: ["transform"],
      message: `${field.transform} is forbidden for ${field.classification}`,
    });
  }
}
