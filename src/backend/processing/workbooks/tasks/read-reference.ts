import { defineTask } from "../../../../workflow-kit/task.js";
import { ReadWorkbookReference } from "../../../../models/processing/workbooks/read-reference.js";
import { deriveSchemaHash, schemaBoundValueSchema } from "../../../../models/validation/schema-bound-value.js";
import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";

export const readWorkbookReferenceTask = defineTask(ReadWorkbookReference, {
  sessions: [], async run({ input, ctx }) {
    const response = await ctx.providers["workbooks.library"].call({ schemaHash: deriveSchemaHash(ReadWorkbookReference.input, "output"), value: input });
    if (response.state !== "produced") return ctx.fail("WORKBOOK_PROVIDER_UNAVAILABLE", ERROR_CATALOG.WORKBOOK_PROVIDER_UNAVAILABLE.text);
    const output = schemaBoundValueSchema(ReadWorkbookReference.output, deriveSchemaHash(ReadWorkbookReference.output, "output")).parse(response.value).value;
    if (output.state === "refused") return ctx.fail(output.code, ERROR_CATALOG[output.code].text);
    ctx.recordData(Object.entries(output).map(([field, value]) => ({ direction: "read" as const, field, value })));
    return output;
  },
});
