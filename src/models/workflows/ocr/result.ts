import { z } from "zod";
import { childRunOutcomeSchema } from "../../workflow/graph.js";
import { PersonLookupResultSchema } from "../person-lookup/result.js";
import { OcrReviewSeedSchema, OcrReviewCheckpointSchema, compactOcrReviewSeed } from "./review-seed.js";
import { OcrPersonLookupRequestSchema, OcrSignerLookupRequestSchema } from "./lookup.js";
import { I9SignerOutputSchema } from "../../systems/i9/read-section2-signer.js";
import { CommandIdSchema, RunIdSchema, PositiveIntSchema, FingerprintSchema } from "../../../rules/identity/ids.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";

export const OcrLookupOutcomeSchema = childRunOutcomeSchema(z.union([PersonLookupResultSchema, I9SignerOutputSchema]));
export const OcrResultSchema = z.strictObject({ review: OcrReviewSeedSchema,
  identities: z.array(z.union([
    OcrPersonLookupRequestSchema.extend({ outcome: childRunOutcomeSchema(PersonLookupResultSchema) }),
    OcrSignerLookupRequestSchema.extend({ outcome: childRunOutcomeSchema(I9SignerOutputSchema) }),
  ])) });
export const OcrApprovalReferenceSchema = z.strictObject({ snapshotId: CommandIdSchema, sourceRunId: RunIdSchema,
  revision: PositiveIntSchema, digest: FingerprintSchema });
export const OcrWorkflowResultSchema = z.strictObject({ review: OcrReviewCheckpointSchema, identities: OcrResultSchema.shape.identities,
  approvedSnapshot: OcrApprovalReferenceSchema.nullable() });

export const OcrResultCheckpointSchema = z.strictObject({ review: z.strictObject({ digest: FingerprintSchema }), identities: OcrResultSchema.shape.identities });
export function compactOcrResult(result: z.output<typeof OcrResultSchema>) {
  return OcrResultCheckpointSchema.parse({ review: { digest: sha256Hex(canonicalJsonStringify(compactOcrReviewSeed(result.review))) },
    identities: result.identities });
}
