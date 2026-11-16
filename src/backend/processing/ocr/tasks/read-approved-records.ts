import { defineTask } from "../../../../workflow-kit/task.js";
import { ReadApprovedOcrRecords } from "../../../../models/processing/ocr/read-approved-records.js";
import { deriveSchemaHash, schemaBoundValueSchema } from "../../../../models/validation/schema-bound-value.js";
import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";

export const readApprovedOcrRecordsTask = defineTask(ReadApprovedOcrRecords, {
  sessions: [], async run({ input, ctx }) {
    const response = await ctx.providers["ocr.review"].call({ schemaHash: deriveSchemaHash(ReadApprovedOcrRecords.input, "output"), value: input });
    if (response.state !== "produced") return ctx.fail("OCR_REVIEW_REFUSED", ERROR_CATALOG.OCR_REVIEW_REFUSED.text);
    const output = schemaBoundValueSchema(ReadApprovedOcrRecords.output, deriveSchemaHash(ReadApprovedOcrRecords.output, "output")).parse(response.value).value;
    if (output.state === "refused") return ctx.fail(output.code, ERROR_CATALOG[output.code].text);
    ctx.recordData(Object.entries(output).map(([field, value]) => ({ direction: "read" as const, field, value })));
    return output;
  },
});
