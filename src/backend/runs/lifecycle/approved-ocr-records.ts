import { ReadApprovedOcrRecords } from "../../../models/processing/ocr/read-approved-records.js";
import { OcrWorkflowResultSchema } from "../../../models/workflows/ocr/result.js";
import { delegationEvidenceOutput } from "../../../models/run/result.js";
import type { RunRecord } from "../../../models/run/record.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import type { AuthorityDatabase } from "../../storage/sqlite/authority-database.js";
import { readDelegationEvidence } from "../../storage/sqlite/delegation-authority.js";
import type { RunRecordService } from "./run-record-service.js";
import { OcrReviewRefusedError, requireCurrentOcrSnapshot } from "./ocr-review-authority.js";
import type { z } from "zod";

export function createApprovedOcrRecordReader(deps: Readonly<{
  database: AuthorityDatabase; reader: Pick<RunRecordService, "read">; run: RunRecord;
}>) {
  return (input: z.output<typeof ReadApprovedOcrRecords.input>) => deps.database.withAuthorityReadSnapshot(() => {
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
}
