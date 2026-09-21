import { z } from "zod";
import { BrowserSystemIdSchema, IsoInstantSchema, RunIdSchema } from "./ids.js";

/** Selection metadata only; authoritative confirmation evidence remains at its owner. */
export const TransactionSelectionRecordSchema = z.strictObject({
  eventId: z.uuid(), runId: RunIdSchema, confirmedAt: IsoInstantSchema, system: BrowserSystemIdSchema,
  operationId: z.uuid(), generation: z.number().int().positive(),
});
export const TransactionHistorySelectionSchema = z.strictObject({
  from: z.iso.date(), to: z.iso.date(), system: BrowserSystemIdSchema.optional(), runId: RunIdSchema.optional(),
}).superRefine((range, context) => {
  if (range.from > range.to) context.addIssue({ code: "custom", message: "transaction range ends before it starts" });
});
export type TransactionHistorySelection = z.infer<typeof TransactionHistorySelectionSchema>;
