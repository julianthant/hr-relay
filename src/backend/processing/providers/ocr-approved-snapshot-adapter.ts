import { z } from "zod";
import { OcrApprovalReadRequestSchema, OcrApprovalReadResultSchema, ReadApprovedOcrRecord, ReadApprovedOcrSnapshot } from "../../../models/processing/ocr/read-approved-snapshot.js";
import { ApprovedOcrRecordInputSchema } from "../../../models/workflows/ocr/approved-record.js";
import { OcrWorkflowResultSchema } from "../../../models/workflows/ocr/result.js";
import { childRunOutcomeSchema } from "../../../models/workflow/graph.js";
import { runClaim, type RunRecord } from "../../../models/run/record.js";
import { delegationEvidenceOutput } from "../../../models/run/result.js";
import { deriveSchemaHash, schemaBoundValueSchema } from "../../../models/validation/schema-bound-value.js";
import { IsoInstantSchema } from "../../../rules/identity/ids.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import type { Clock } from "../../../rules/time/clock.js";
import type { ProviderAdapter } from "../../../workflow-kit/providers.js";
import { descriptorRuntimeNodes, type AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { authenticateOcrOperator, requireCurrentOcrSnapshot, OcrReviewRefusedError } from "../../runs/lifecycle/ocr-review-authority.js";
import type { RunRecordService } from "../../runs/lifecycle/run-record-service.js";
import { readDelegationEvidence } from "../../storage/sqlite/delegation-authority.js";
import type { AuthorityDatabase } from "../../storage/sqlite/authority-database.js";

class OcrApprovalRefusedError extends Error {}

const same = (left: unknown, right: unknown) => canonicalJsonStringify(left) === canonicalJsonStringify(right);

export function createOcrApprovedSnapshotAdapter(input: Readonly<{
  database: AuthorityDatabase; run: RunRecord; clock: Clock; assertCurrent(): void;
  reader?: Pick<RunRecordService, "read">;
  resolveDescriptor(workflowId: string): AnyWorkflowDescriptor | undefined;
}>): ProviderAdapter<"ocr.approved-snapshot"> {
  return Object.freeze<ProviderAdapter<"ocr.approved-snapshot">>({
    capability: "ocr.approved-snapshot",
    async invoke(request, options) {
      options.signal.throwIfAborted();
      if (request.capability !== "ocr.approved-snapshot") throw new OcrApprovalRefusedError("ocr-approval-capability-mismatch");
      const query = schemaBoundValueSchema(OcrApprovalReadRequestSchema, deriveSchemaHash(OcrApprovalReadRequestSchema, "output")).parse(request.payload).value;
      const result = (() => {
        const reader = input.reader;
        if (reader === undefined) return OcrApprovalReadResultSchema.parse({ state: "unavailable", code: "OCR_APPROVAL_UNAVAILABLE" });
        try {
          input.assertCurrent();
          const value = input.database.withAuthorityReadSnapshot(() => {
            const found = reader.read(input.run.envelope.runId);
            const capturedClaim = runClaim(input.run);
            if (found.state !== "present" || found.disposition !== "live" || capturedClaim === undefined) throw new OcrApprovalRefusedError("ocr-approval-custody-unavailable");
            const current = found.run, currentClaim = runClaim(current);
            const descriptor = input.resolveDescriptor(current.envelope.workflow);
            if (current.lifecycle.state !== "running" || current.cancelRequested === true || currentClaim === undefined
              || currentClaim.workerId !== capturedClaim.workerId || currentClaim.claimGeneration !== capturedClaim.claimGeneration
              || !same(current.envelope, input.run.envelope) || !same(current.input, input.run.input)
              || descriptor === undefined || descriptor.version !== current.envelope.descriptorVersion
              || descriptor.contractFingerprint !== current.envelope.contractFingerprint) throw new OcrApprovalRefusedError("ocr-approval-custody-unavailable");
            const executing = descriptorRuntimeNodes(descriptor).find(node => node.id === (current.lifecycle.state === "running" ? current.lifecycle.currentNodeId : undefined));
            const task = query.kind === "snapshot" ? ReadApprovedOcrSnapshot : ReadApprovedOcrRecord;
            if (executing?.kind !== "task" || executing.uses.id !== task.id) throw new OcrApprovalRefusedError("ocr-approval-task-unavailable");
            authenticateOcrOperator(input.database.authority, reader, current);
            let owner = current, ownerDescriptor = descriptor;
            if (query.kind === "record") {
              const parent = current.envelope.parent === undefined ? undefined : reader.read(current.envelope.parent.runId);
              if (parent?.state !== "present" || parent.disposition !== "live") throw new OcrApprovalRefusedError("ocr-approval-parent-unavailable");
              const producer = input.resolveDescriptor(parent.run.envelope.workflow);
              if (producer === undefined || producer.version !== parent.run.envelope.descriptorVersion
                || producer.contractFingerprint !== parent.run.envelope.contractFingerprint
                || descriptorRuntimeNodes(producer).filter(node => node.kind === "child-run" && node.edgeId === current.envelope.parent?.edgeId
                  && node.target.id === current.envelope.workflow && node.cardinality === "many" && node.await === "terminal").length !== 1) {
                throw new OcrApprovalRefusedError("ocr-approval-member-unavailable");
              }
              owner = parent.run; ownerDescriptor = producer;
            }
            const edges = descriptorRuntimeNodes(ownerDescriptor).filter(node => node.kind === "child-run" && node.target.id === "ocr"
              && node.cardinality === "one" && node.await === "terminal" && node.join === "one");
            if (edges.length !== 1 || edges[0] === undefined) throw new OcrApprovalRefusedError("ocr-approval-edge-unavailable");
            const evidence = readDelegationEvidence(input.database.authority, owner.envelope.runId, String(edges[0].id));
            const child = childRunOutcomeSchema(OcrWorkflowResultSchema).parse(delegationEvidenceOutput(evidence, OcrWorkflowResultSchema));
            if (child.state !== "done" || child.runId !== query.approval.sourceRunId || !same(child.output.approvedSnapshot, query.approval)) {
              throw new OcrApprovalRefusedError("ocr-approval-child-unavailable");
            }
            const snapshot = requireCurrentOcrSnapshot(input.database.authority, reader, query.approval);
            if (query.kind === "snapshot") return OcrApprovalReadResultSchema.parse({ state: "snapshot", snapshot });
            const canonical: unknown = descriptor.canonicalInput.parse(current.input.parsed.value);
            if (typeof canonical !== "object" || canonical === null) throw new OcrApprovalRefusedError("ocr-approval-member-input-unavailable");
            const approval: unknown = Reflect.get(canonical, "approval"), approvedRecord: unknown = Reflect.get(canonical, "record");
            const member = ApprovedOcrRecordInputSchema.parse({ approval, record: approvedRecord });
            const record = snapshot.records.find(record => record.recordId === query.recordId);
            if (record === undefined || query.recordId !== member.record.recordId || !same(member.approval, query.approval) || !same(member.record, record)) {
              throw new OcrApprovalRefusedError("ocr-approval-record-unavailable");
            }
            return OcrApprovalReadResultSchema.parse({ state: "record", record });
          });
          input.assertCurrent(); options.signal.throwIfAborted();
          return value;
        } catch (cause) {
          if (!(cause instanceof OcrApprovalRefusedError) && !(cause instanceof OcrReviewRefusedError) && !(cause instanceof z.ZodError)) throw cause;
          return OcrApprovalReadResultSchema.parse({ state: "refused", code: "OCR_REVIEW_REFUSED" });
        }
      })();
      options.signal.throwIfAborted();
      return { response: { state: "produced", value: { schemaHash: deriveSchemaHash(OcrApprovalReadResultSchema, "output"), value: result } },
        evidence: { summary: "Local immutable OCR approval authority", capturedAt: IsoInstantSchema.parse(input.clock.now().toISOString()), providerRequestId: options.requestId } };
    },
  });
}
