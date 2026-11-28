import { defineTask } from "../../../../workflow-kit/task.js";
import { compareReferenceCapture } from "../../../../workflow-kit/reference-check.js";
import { CompareReferenceFields, ReadReferenceFieldsRequestSchema, ReadReferenceFieldsResponseSchema } from "../../../../models/processing/workbooks/reference-fields.js";
import { deriveSchemaHash, schemaBoundValueSchema } from "../../../../models/validation/schema-bound-value.js";
import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
import { evidenceLeaves } from "../../../../models/trust/evidence-classification.js";

export const compareReferenceFieldsTask = defineTask(CompareReferenceFields, {
  sessions: [],
  async run({ input, ctx }) {
    let captured = null;
    if (input.read !== null) {
      const response = await ctx.providers["workbooks.library"].call({
        schemaHash: deriveSchemaHash(ReadReferenceFieldsRequestSchema, "output"), value: input.read,
      });
      if (response.state !== "produced") return ctx.fail("WORKBOOK_PROVIDER_UNAVAILABLE", ERROR_CATALOG.WORKBOOK_PROVIDER_UNAVAILABLE.text);
      const { value } = schemaBoundValueSchema(ReadReferenceFieldsResponseSchema, deriveSchemaHash(ReadReferenceFieldsResponseSchema, "output")).parse(response.value);
      if (value.state === "refused") return ctx.fail(value.code, ERROR_CATALOG[value.code].text);
      captured = value.sheets;
    }
    const { output, lines } = compareReferenceCapture(input, captured);
    for (const line of lines) ctx.log.info(line);
    ctx.recordData(evidenceLeaves(output).map(({ path, value }) => ({ direction: "read" as const, field: path, value })));
    return output;
  },
});
