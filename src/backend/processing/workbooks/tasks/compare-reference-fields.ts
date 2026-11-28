import { defineTask } from "../../../../workflow-kit/task.js";
import { compareReferenceFields } from "../../../../workflow-kit/reference-check.js";
import { CompareReferenceFields, ReadReferenceFieldsRequestSchema, ReadReferenceFieldsResponseSchema } from "../../../../models/processing/workbooks/reference-fields.js";
import { deriveSchemaHash, schemaBoundValueSchema } from "../../../../models/validation/schema-bound-value.js";
import { spreadsheetField } from "../../../../models/fields/workbook-fields.js";
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
      for (const sheet of captured) {
        if (sheet.rows.length === 0) ctx.log.info(`Not in ${sheet.sheet}`);
      }
    }
    const sheets = captured ?? input.sheets;
    if (sheets === null && input.last) ctx.log.info("Reference not checked: no Employee ID");
    const compared = compareReferenceFields(sheets ?? [], input.fields, input.approved);
    for (const match of compared.matches) ctx.log.info(`${match.sheet}, row ${match.row}: ${spreadsheetField(match.field).label} matches`);
    for (const mismatch of compared.mismatches) ctx.log.info(`${mismatch.sheet}, row ${mismatch.row}: ${spreadsheetField(mismatch.field).label} differs`);
    const output = { captured, ...compared, review: compared.mismatches.length > 0 ? true as const : null };
    ctx.recordData(evidenceLeaves(output).map(({ path, value }) => ({ direction: "read" as const, field: path, value })));
    return output;
  },
});
