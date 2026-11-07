import { z } from "zod";

export const RunDisplayNameSchema = z.string().superRefine((value, context) => {
  if (value.trim() !== value) {
    context.addIssue({ code: "custom", message: "run display name must already be trimmed" });
  }
  if (value.normalize("NFC") !== value) {
    context.addIssue({ code: "custom", message: "run display name must be NFC-normalized" });
  }
  const codePoints = [...value].length;
  if (codePoints < 1 || codePoints > 120) {
    context.addIssue({ code: "custom", message: "run display name must contain 1 to 120 Unicode code points" });
  }
  if (/\p{Cc}/u.test(value)) {
    context.addIssue({ code: "custom", message: "run display name cannot contain control characters" });
  }
});
