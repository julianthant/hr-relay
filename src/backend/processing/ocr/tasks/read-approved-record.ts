import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
import { OcrApprovalReadRequestSchema,OcrApprovalReadResultSchema } from "../../../../models/processing/ocr/approved-snapshot.js";
import { ReadApprovedOcrRecord } from "../../../../models/processing/ocr/read-approved-record.js";
import { deriveSchemaHash,schemaBoundValueSchema } from "../../../../models/validation/schema-bound-value.js";
import { canonicalJsonStringify } from "../../../../rules/validation/canonical-json.js";
import { defineTask } from "../../../../workflow-kit/task.js";

export const readApprovedOcrRecordTask = defineTask(ReadApprovedOcrRecord, {
  sessions: [], async run({ input, ctx }) {
    const response = await ctx.providers["ocr.approved-snapshot"].call({ schemaHash: deriveSchemaHash(OcrApprovalReadRequestSchema, "output"),
      value: { kind: "record", approval: input.approval, recordId: input.record.recordId } });
    if (response.state !== "produced") return ctx.fail("OCR_APPROVAL_UNAVAILABLE", ERROR_CATALOG.OCR_APPROVAL_UNAVAILABLE.text);
    const result = schemaBoundValueSchema(OcrApprovalReadResultSchema, deriveSchemaHash(OcrApprovalReadResultSchema, "output")).parse(response.value).value;
    if (result.state === "refused" || result.state === "unavailable") return ctx.fail(result.code, ERROR_CATALOG[result.code].text);
    if (result.state !== "record") return ctx.fail("OCR_REVIEW_REFUSED", ERROR_CATALOG.OCR_REVIEW_REFUSED.text);
    if (canonicalJsonStringify(result.record) !== canonicalJsonStringify(input.record)) return ctx.fail("OCR_REVIEW_REFUSED", ERROR_CATALOG.OCR_REVIEW_REFUSED.text);
    await ctx.confirmed?.verify({ action: { id: "verify-approved-record", targetId: "verify-approved-record" }, purpose: "read-validation",
      observe: async () => result.record, matches: observed => canonicalJsonStringify(observed) === canonicalJsonStringify(input.record) });
    ctx.recordData({ direction: "read", field: "record", value: result.record });
    return { record: result.record };
  },
});
