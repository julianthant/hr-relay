import { z } from "zod";
import { AdmittedRecordSchema } from "./extraction.js";
import { EidSchema, StableRecordIdSchema } from "../../rules/identity/ids.js";

export const OcrReviewRecordSchema = z.strictObject({
  recordId: StableRecordIdSchema,
  fields: AdmittedRecordSchema,
  assertedEid: EidSchema.nullable(),
  discarded: z.boolean(),
});
