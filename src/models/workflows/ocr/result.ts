import { z } from "zod";
import { childRunOutcomeSchema } from "../../workflow/graph.js";
import { PersonLookupResultSchema } from "../person-lookup/result.js";
import { OcrReviewSeedSchema } from "./review-seed.js";
import { OcrLookupRequestSchema } from "./lookup.js";

export const OcrLookupOutcomeSchema = childRunOutcomeSchema(PersonLookupResultSchema);
export const OcrResultSchema = z.strictObject({ review: OcrReviewSeedSchema,
  identities: z.array(OcrLookupRequestSchema.extend({ outcome: OcrLookupOutcomeSchema })) });
