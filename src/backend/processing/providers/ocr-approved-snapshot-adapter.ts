import { OcrApprovalReadRequestSchema, OcrApprovalReadResultSchema } from "../../../models/processing/ocr/read-approved-snapshot.js";
import { deriveSchemaHash, schemaBoundValueSchema } from "../../../models/validation/schema-bound-value.js";
import { IsoInstantSchema } from "../../../rules/identity/ids.js";
import type { Clock } from "../../../rules/time/clock.js";
import type { ProviderAdapter } from "../../../workflow-kit/providers.js";
import type { ApprovedOcrRecordReader } from "../../runs/lifecycle/approved-ocr-records.js";
import { OcrReviewRefusedError } from "../../runs/lifecycle/ocr-review-authority.js";

export function createOcrApprovedSnapshotAdapter(input: Readonly<{
  clock: Clock; reader?: Pick<ApprovedOcrRecordReader, "readSnapshot" | "readRecord">;
}>): ProviderAdapter<"ocr.approved-snapshot"> {
  return Object.freeze<ProviderAdapter<"ocr.approved-snapshot">>({
    capability: "ocr.approved-snapshot",
    async invoke(request, options) {
      options.signal.throwIfAborted();
      if (request.capability !== "ocr.approved-snapshot") throw new Error("ocr-approval-capability-mismatch");
      const query = schemaBoundValueSchema(OcrApprovalReadRequestSchema, deriveSchemaHash(OcrApprovalReadRequestSchema, "output")).parse(request.payload).value;
      const result = (() => {
        if (input.reader === undefined) return OcrApprovalReadResultSchema.parse({ state: "unavailable", code: "OCR_APPROVAL_UNAVAILABLE" });
        try {
          return OcrApprovalReadResultSchema.parse(query.kind === "snapshot"
            ? { state: "snapshot", snapshot: input.reader.readSnapshot(query.approval) }
            : { state: "record", record: input.reader.readRecord(query) });
        } catch (cause) {
          if (!(cause instanceof OcrReviewRefusedError)) throw cause;
          return OcrApprovalReadResultSchema.parse({ state: "refused", code: "OCR_REVIEW_REFUSED" });
        }
      })();
      options.signal.throwIfAborted();
      return { response: { state: "produced", value: { schemaHash: deriveSchemaHash(OcrApprovalReadResultSchema, "output"), value: result } },
        evidence: { summary: "Local immutable OCR approval authority", capturedAt: IsoInstantSchema.parse(input.clock.now().toISOString()), providerRequestId: options.requestId } };
    },
  });
}
