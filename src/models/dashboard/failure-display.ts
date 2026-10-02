import { z } from "zod";
import type { FailureRecord } from "../trust/failure.js";

export const FailureDisplaySchema = z.strictObject({
  title: z.string().min(1),
  observation: z.string().min(1),
});

/** Display classification never changes the durable error, write state or available commands. */
export function projectFailureDisplay(failure: Pick<FailureRecord, "code">): z.infer<typeof FailureDisplaySchema> {
  switch (failure.code) {
    case "SUBJECT_MISMATCH":
      return { title: "Employee identity mismatch", observation: "The observed identity differs from the expected subject." };
    case "DOCUMENT_READ_TIMEOUT":
      return { title: "Document read interrupted", observation: "The document fields could not be read before the timeout." };
    default:
      return { title: "Step could not be completed", observation: "The step stopped unexpectedly. Open Details to review the recorded error." };
  }
}
