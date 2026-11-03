import { ReadApprovedOcrRecords } from "../../../models/processing/ocr/read-approved-records.js";
import { deriveSchemaHash, schemaBoundValueSchema } from "../../../models/validation/schema-bound-value.js";
import { IsoInstantSchema } from "../../../rules/identity/ids.js";
import type { Clock } from "../../../rules/time/clock.js";
import type { ProviderAdapter } from "../../../workflow-kit/providers.js";
import type { z } from "zod";

export function createOcrReviewAdapter(deps: Readonly<{
  read(input: z.output<typeof ReadApprovedOcrRecords.input>): z.output<typeof ReadApprovedOcrRecords.output>; clock: Clock;
}>): ProviderAdapter<"ocr.review"> {
  const adapter: ProviderAdapter<"ocr.review"> = { capability: "ocr.review", async invoke(request, options) {
    if (request.capability !== "ocr.review") throw new Error("ocr-review-provider-capability-mismatch");
    options.signal.throwIfAborted();
    const input = schemaBoundValueSchema(ReadApprovedOcrRecords.input, deriveSchemaHash(ReadApprovedOcrRecords.input, "output")).parse(request.payload).value;
    const value = deps.read(input);
    return { response: { state: "produced", value: { schemaHash: deriveSchemaHash(ReadApprovedOcrRecords.output, "output"), value } },
      evidence: { summary: "Authenticated OCR selections", capturedAt: IsoInstantSchema.parse(deps.clock.now().toISOString()), providerRequestId: options.requestId } };
  } };
  return Object.freeze(adapter);
}
