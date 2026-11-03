import { defineTask } from "../../../../workflow-kit/task.js";
import { ReadWorkbookReference, WorkbookReferenceReadRequestSchema, WorkbookReferenceReadResponseSchema } from "../../../../models/processing/workbooks/read-reference.js";
import { deriveSchemaHash, schemaBoundValueSchema } from "../../../../models/validation/schema-bound-value.js";
import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
import { evidenceLeaves } from "../../../../models/trust/evidence-classification.js";

export const readWorkbookReferenceTask = defineTask(ReadWorkbookReference, {
  sessions: [], async run({ input, ctx }) {
    const response = await ctx.providers["workbooks.library"].call({ schemaHash: deriveSchemaHash(WorkbookReferenceReadRequestSchema, "output"), value: input });
    if (response.state !== "produced") return ctx.fail("WORKBOOK_PROVIDER_UNAVAILABLE", ERROR_CATALOG.WORKBOOK_PROVIDER_UNAVAILABLE.text);
    const output = schemaBoundValueSchema(WorkbookReferenceReadResponseSchema, deriveSchemaHash(WorkbookReferenceReadResponseSchema, "output")).parse(response.value).value;
    if (output.state === "refused") return ctx.fail(output.code, ERROR_CATALOG[output.code].text);
    ctx.recordData(evidenceLeaves(output).map(({ path, value }) => ({ direction: "read" as const, field: path, value })));
    return output;
  },
});
