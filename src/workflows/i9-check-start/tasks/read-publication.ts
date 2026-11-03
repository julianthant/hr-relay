import { defineTask } from "../../../workflow-kit/task.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { ReadI9CheckPublication } from "../../../models/workflows/i9-check-start/read-publication.js";

export const readI9CheckPublicationTask = defineTask(ReadI9CheckPublication, {
  sessions: [], async run({ input, ctx }) {
    if (input.workbook.state !== "saved") return ctx.fail("WORKBOOK_INVALID", ERROR_CATALOG.WORKBOOK_INVALID.text);
    const output = ReadI9CheckPublication.output.parse({ ...input.rows, workbook: input.workbook });
    ctx.recordData(Object.entries(output).map(([field, value]) => ({ direction: "read" as const, field, value })));
    return output;
  },
});
