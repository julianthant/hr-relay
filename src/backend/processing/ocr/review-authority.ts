import type { z } from "zod";
import type { OcrApprovalReadRequestSchema } from "../../../models/processing/ocr/approved-snapshot.js";
import type { ReadApprovedOcrRecord } from "../../../models/processing/ocr/read-approved-record.js";
import type { ReadApprovedOcrRecords } from "../../../models/processing/ocr/read-approved-records.js";
import type { ReadApprovedOcrSnapshot } from "../../../models/processing/ocr/read-approved-snapshot.js";

export interface ApprovedOcrRecordReader {
  readSnapshot(approval: z.output<typeof ReadApprovedOcrSnapshot.input>): z.output<typeof ReadApprovedOcrSnapshot.output>["snapshot"];
  readRecord(query: z.output<typeof OcrApprovalReadRequestSchema> & { kind: "record" }): z.output<typeof ReadApprovedOcrRecord.output>["record"];
  readSources(input: z.output<typeof ReadApprovedOcrRecords.input>): z.output<typeof ReadApprovedOcrRecords.output>;
}

export class OcrReviewRefusedError extends Error {
  readonly code = "OCR_REVIEW_REFUSED";
  constructor(options?: ErrorOptions) { super("OCR_REVIEW_REFUSED", options); this.name = "OcrReviewRefusedError"; }
}
