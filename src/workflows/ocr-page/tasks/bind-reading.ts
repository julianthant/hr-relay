import { defineTask } from "../../../workflow-kit/task.js";
import { BindOcrReading } from "../../../models/workflows/ocr-page/bind-reading.js";
import { bindOcrPageReading } from "../../../models/workflows/ocr/page-accounting.js";

export const bindOcrReadingTask = defineTask(BindOcrReading, {
  sessions: [],
  async run({ input: { request, extraction }, ctx }) {
    let output;
    try {
      if (request.reading.kind !== "subscription" || extraction === null) {
        throw new Error("Subscription OCR requires a provider reading.");
      }
      output = bindOcrPageReading(request.page, extraction);
    } catch (error) {
      return ctx.fail("INCONSISTENT_INPUTS", "OCR reading does not match its exact source request.", { cause: error });
    }
    ctx.recordData(Object.entries(output).map(([field, value]) => ({ direction: "read" as const, field, value })));
    return output;
  },
});
