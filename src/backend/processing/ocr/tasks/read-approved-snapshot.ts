import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
import { OcrApprovalReadRequestSchema,OcrApprovalReadResultSchema } from "../../../../models/processing/ocr/approved-snapshot.js";
import { ReadApprovedOcrSnapshot } from "../../../../models/processing/ocr/read-approved-snapshot.js";
import { deriveSchemaHash,schemaBoundValueSchema } from "../../../../models/validation/schema-bound-value.js";
import { defineTask } from "../../../../workflow-kit/task.js";

export const readApprovedOcrSnapshotTask = defineTask(ReadApprovedOcrSnapshot, {
  sessions: [], async run({ input, ctx }) {
    const response = await ctx.providers["ocr.approved-snapshot"].call({ schemaHash: deriveSchemaHash(OcrApprovalReadRequestSchema, "output"),
      value: { kind: "snapshot", approval: input } });
    if (response.state !== "produced") return ctx.fail("OCR_APPROVAL_UNAVAILABLE", ERROR_CATALOG.OCR_APPROVAL_UNAVAILABLE.text);
    const result = schemaBoundValueSchema(OcrApprovalReadResultSchema, deriveSchemaHash(OcrApprovalReadResultSchema, "output")).parse(response.value).value;
    if (result.state === "refused" || result.state === "unavailable") return ctx.fail(result.code, ERROR_CATALOG[result.code].text);
    if (result.state !== "snapshot") return ctx.fail("OCR_REVIEW_REFUSED", ERROR_CATALOG.OCR_REVIEW_REFUSED.text);
    ctx.recordData({ direction: "read", field: "snapshot", value: result.snapshot });
    return { snapshot: result.snapshot };
  },
});
