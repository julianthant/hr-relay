import { z } from "zod";
import { RunIdSchema, StableRecordIdSchema } from "../../rules/identity/ids.js";

export const DelegatedRecordRefSchema = z.strictObject({ runId: RunIdSchema, recordId: StableRecordIdSchema });
export type DelegatedRecordRef = z.infer<typeof DelegatedRecordRefSchema>;

export const DelegatedRecordBindingSchema = z.strictObject({
  record: DelegatedRecordRefSchema,
  childRunIds: z.array(RunIdSchema).min(1),
  currentChildRunId: RunIdSchema,
}).superRefine((binding, context) => {
  if (new Set(binding.childRunIds).size !== binding.childRunIds.length || !binding.childRunIds.includes(binding.currentChildRunId)) {
    context.addIssue({ code: "custom", message: "record binding requires distinct child history including its current run" });
  }
});
export type DelegatedRecordBinding = z.infer<typeof DelegatedRecordBindingSchema>;
