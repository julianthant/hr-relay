import { z } from "zod";
import { childRunOutcomeSchema } from "../../workflow/graph.js";
import { PersonLookupResultSchema } from "../person-lookup/result.js";
import { OcrReviewSeedSchema } from "./review-seed.js";
import { OcrPersonLookupRequestSchema, OcrSignerLookupRequestSchema } from "./lookup.js";
import { I9SignerOutputSchema } from "../../systems/i9/read-section2-signer.js";
import { CommandIdSchema, RunIdSchema, PositiveIntSchema, FingerprintSchema } from "../../../rules/identity/ids.js";

export const OcrLookupOutcomeSchema = childRunOutcomeSchema(z.union([PersonLookupResultSchema, I9SignerOutputSchema]));
export const OcrResultSchema = z.strictObject({ review: OcrReviewSeedSchema,
  identities: z.array(z.union([
    OcrPersonLookupRequestSchema.extend({ outcome: childRunOutcomeSchema(PersonLookupResultSchema) }),
    OcrSignerLookupRequestSchema.extend({ outcome: childRunOutcomeSchema(I9SignerOutputSchema) }),
  ])) });
export const OcrApprovalReferenceSchema = z.strictObject({ snapshotId: CommandIdSchema, sourceRunId: RunIdSchema,
  revision: PositiveIntSchema, digest: FingerprintSchema });
export const OcrWorkflowResultSchema = OcrResultSchema.extend({ approvedSnapshot: OcrApprovalReferenceSchema.nullable() });
