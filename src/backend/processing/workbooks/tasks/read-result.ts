import { defineTask } from "../../../../workflow-kit/task.js";
import { ReadWorkbookResult, WorkflowWorkbookCommandSchema, WorkflowWorkbookResultSchema } from "../../../../models/workbooks/workflow-workbook.js";
import { deriveSchemaHash, schemaBoundValueSchema } from "../../../../models/validation/schema-bound-value.js";
import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";

export const readWorkbookResultTask = defineTask(ReadWorkbookResult, {
  sessions: [], async run({ input, ctx }) {
    const response = await ctx.providers["workbooks.library"].call({ schemaHash: deriveSchemaHash(WorkflowWorkbookCommandSchema, "output"), value: input });
    if (response.state !== "produced") return ctx.fail("WORKBOOK_PROVIDER_UNAVAILABLE", ERROR_CATALOG.WORKBOOK_PROVIDER_UNAVAILABLE.text);
    const output = schemaBoundValueSchema(WorkflowWorkbookResultSchema, deriveSchemaHash(WorkflowWorkbookResultSchema, "output")).parse(response.value).value;
    if (output.state === "refused") return ctx.fail(output.code, ERROR_CATALOG[output.code].text);
    ctx.recordData(Object.entries(output).map(([field, value]) => ({ direction: "read" as const, field, value })));
    return output;
  },
});
