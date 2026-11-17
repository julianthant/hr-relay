import { z } from "zod";
import type { FailureRecord } from "../trust/failure.js";

export const FailureDisplaySchema = z.strictObject({
  title: z.string().min(1),
  observation: z.string().min(1),
  attemptedAction: z.string().min(1).optional(),
  lastCompleted: z.string().min(1).optional(),
  field: z.strictObject({
    label: z.string().min(1),
    value: z.string().min(1),
    outcome: z.enum(["Entered", "Selected", "Read", "Checked", "Verified", "Set", "Cleared", "Provided"]),
  }).optional(),
});

export const FailureRetryWireSchema = z.strictObject({
  key: z.literal("retry-failed-step"),
  label: z.literal("Retry step"),
  kind: z.literal("command"),
  command: z.literal("retry"),
  expectedVersion: z.number().int().positive(),
  intent: z.literal("neutral"),
  icon: z.literal("retry"),
  placement: z.tuple([z.literal("banner")]),
});

/** Display classification never changes the durable error, write state or available commands. */
export function projectFailureDisplay(failure: Pick<FailureRecord, "code">): z.infer<typeof FailureDisplaySchema> {
  switch (failure.code) {
    case "SUBJECT_MISMATCH":
      return { title: "Employee identity mismatch", observation: "The observed identity differs from the expected subject." };
    case "EMPLOYMENT_RECORD_MISMATCH":
      return { title: "Employment record mismatch", observation: "The observed employment record differs from the approved target." };
    case "PROTECTED_SUBJECT_DISPLAY_REFUSED":
      return { title: "Protected subject display refused", observation: "The protected subject display was not masked. The run was not queued." };
    case "DOCUMENT_READ_TIMEOUT":
      return { title: "Document read interrupted", observation: "The document fields could not be read before the timeout." };
    default:
      return { title: "Step could not be completed", observation: "The step stopped unexpectedly. Open Details to review the recorded error." };
  }
}
