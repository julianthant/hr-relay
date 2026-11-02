import { defineTask } from "../../../workflow-kit/task.js";
import { ReadManualOcrReading } from "../../../models/workflows/ocr-page/bind-reading.js";
import { bindCanonicalManualOcrReading } from "../../../models/workflows/ocr/page-accounting.js";

export const readManualOcrReadingTask = defineTask(ReadManualOcrReading, {
  sessions: [],
  async run({ input, ctx }) {
    let output;
    try {
      if (input.reading.kind !== "manual") throw new Error("Manual OCR requires an operator assertion.");
      output = bindCanonicalManualOcrReading(input.page, input.reading.actorId, input.reading.extraction);
    } catch (error) {
      return ctx.fail("INCONSISTENT_INPUTS", "Manual OCR assertion does not match its operator and original page.", { cause: error });
    }
    ctx.recordData(Object.entries(output).map(([field, value]) => ({ direction: "read" as const, field, value })));
    return output;
  },
});
