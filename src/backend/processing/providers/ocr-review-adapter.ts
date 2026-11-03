import { ReadApprovedOcrRecords } from "../../../models/processing/ocr/read-approved-records.js";
import { OcrWorkflowResultSchema } from "../../../models/workflows/ocr/result.js";
import { deriveSchemaHash, schemaBoundValueSchema } from "../../../models/validation/schema-bound-value.js";
import { delegationEvidenceOutput } from "../../../models/run/result.js";
import type { RunRecord } from "../../../models/run/record.js";
import type { Clock } from "../../../rules/time/clock.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { IsoInstantSchema } from "../../../rules/identity/ids.js";
import type { ProviderAdapter } from "../../../workflow-kit/providers.js";
import type { AuthorityDatabase } from "../../storage/sqlite/authority-database.js";
import { readDelegationEvidence } from "../../storage/sqlite/delegation-authority.js";
import type { RunRecordService } from "../../runs/lifecycle/run-record-service.js";
import { OcrReviewRefusedError, requireCurrentOcrSnapshot } from "../../runs/lifecycle/ocr-review-authority.js";

export function createOcrReviewAdapter(deps: Readonly<{
  database: AuthorityDatabase; reader: Pick<RunRecordService, "read">; run: RunRecord; clock: Clock;
}>): ProviderAdapter<"ocr.review"> {
  const adapter: ProviderAdapter<"ocr.review"> = { capability: "ocr.review", async invoke(request, options) {
    if (request.capability !== "ocr.review") throw new OcrReviewRefusedError();
    options.signal.throwIfAborted();
    const input = schemaBoundValueSchema(ReadApprovedOcrRecords.input, deriveSchemaHash(ReadApprovedOcrRecords.input, "output")).parse(request.payload).value;
    const value = deps.database.withAuthorityReadSnapshot(() => {
      const existence = deps.reader.read(deps.run.envelope.runId);
      if (existence.state !== "present" || existence.disposition !== "live"
        || existence.run.claimGeneration !== deps.run.claimGeneration || existence.run.cancelRequested === true
        || canonicalJsonStringify(existence.run.envelope) !== canonicalJsonStringify(deps.run.envelope)
        || canonicalJsonStringify(existence.run.input) !== canonicalJsonStringify(deps.run.input)) throw new OcrReviewRefusedError();
      const repositories = deps.database.authority;
      const evidence = readDelegationEvidence(repositories, deps.run.envelope.runId, input.delegationNodeId);
      if (evidence.children.some(child => child.run.envelope.workflow !== "ocr")
        || canonicalJsonStringify(delegationEvidenceOutput(evidence, OcrWorkflowResultSchema)) !== canonicalJsonStringify(input.outcomes)) throw new OcrReviewRefusedError();
      const sources = input.outcomes.map(outcome => {
        if (outcome.state !== "done" || outcome.output.approvedSnapshot === null
          || outcome.output.approvedSnapshot.sourceRunId !== outcome.runId) throw new OcrReviewRefusedError();
        const snapshot = requireCurrentOcrSnapshot(repositories, deps.reader, outcome.output.approvedSnapshot);
        return { snapshot, review: outcome.output.review };
      });
      return ReadApprovedOcrRecords.output.parse({ state: "ready", sources });
    });
    return { response: { state: "produced", value: { schemaHash: deriveSchemaHash(ReadApprovedOcrRecords.output, "output"), value } },
      evidence: { summary: "Authenticated OCR selections", capturedAt: IsoInstantSchema.parse(deps.clock.now().toISOString()), providerRequestId: options.requestId } };
  } };
  return Object.freeze(adapter);
}
