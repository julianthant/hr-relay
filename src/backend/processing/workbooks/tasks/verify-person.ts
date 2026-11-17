import { defineTask } from "../../../../workflow-kit/task.js";
import { VerifyWorkbookPerson, WorkbookPersonCheckRequestSchema, WorkbookPersonCheckResponseSchema } from "../../../../models/processing/workbooks/verify-person.js";
import { deriveSchemaHash, schemaBoundValueSchema } from "../../../../models/validation/schema-bound-value.js";
import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
import { evidenceLeaves } from "../../../../models/trust/evidence-classification.js";

export const verifyWorkbookPersonTask = defineTask(VerifyWorkbookPerson, {
  sessions: [], async run({ input, ctx }) {
    const response = await ctx.providers["workbooks.library"].call({ schemaHash: deriveSchemaHash(WorkbookPersonCheckRequestSchema, "output"), value: input });
    if (response.state !== "produced") return ctx.fail("WORKBOOK_PROVIDER_UNAVAILABLE", ERROR_CATALOG.WORKBOOK_PROVIDER_UNAVAILABLE.text);
    const output = schemaBoundValueSchema(WorkbookPersonCheckResponseSchema, deriveSchemaHash(WorkbookPersonCheckResponseSchema, "output")).parse(response.value).value;
    if (output.state === "refused") return ctx.fail(output.code, ERROR_CATALOG[output.code].text);
    ctx.recordData(evidenceLeaves(output).map(({ path, value }) => ({ direction: "read" as const, field: path, value })));
    return output;
  },
});
