import { ReadApprovedOcrRecords } from "../../../models/processing/ocr/read-approved-records.js";
import { deriveSchemaHash, schemaBoundValueSchema } from "../../../models/validation/schema-bound-value.js";
import { IsoInstantSchema } from "../../../rules/identity/ids.js";
import type { Clock } from "../../../rules/time/clock.js";
import type { ProviderAdapter } from "../../../workflow-kit/providers.js";
import type { ApprovedOcrRecordReader } from "../../runs/lifecycle/approved-ocr-records.js";
import { OcrReviewRefusedError } from "../../runs/lifecycle/ocr-review-authority.js";

export function createOcrReviewAdapter(deps: Readonly<{
  reader: Pick<ApprovedOcrRecordReader, "readSources">; clock: Clock;
}>): ProviderAdapter<"ocr.review"> {
  const adapter: ProviderAdapter<"ocr.review"> = { capability: "ocr.review", async invoke(request, options) {
    if (request.capability !== "ocr.review") throw new Error("ocr-review-provider-capability-mismatch");
    options.signal.throwIfAborted();
    const input = schemaBoundValueSchema(ReadApprovedOcrRecords.input, deriveSchemaHash(ReadApprovedOcrRecords.input, "output")).parse(request.payload).value;
    const value = (() => {
      try { return ReadApprovedOcrRecords.output.parse(deps.reader.readSources(input)); }
      catch (cause) {
        if (!(cause instanceof OcrReviewRefusedError)) throw cause;
        return ReadApprovedOcrRecords.output.parse({ state: "refused", code: "OCR_REVIEW_REFUSED" });
      }
    })();
    options.signal.throwIfAborted();
    return { response: { state: "produced", value: { schemaHash: deriveSchemaHash(ReadApprovedOcrRecords.output, "output"), value } },
      evidence: { summary: "Authenticated OCR selections", capturedAt: IsoInstantSchema.parse(deps.clock.now().toISOString()), providerRequestId: options.requestId } };
  } };
  return Object.freeze(adapter);
}
