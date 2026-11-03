import type { z } from "zod";
import { OcrApprovalReadRequestSchema } from "../../../models/processing/ocr/approved-snapshot.js";
import { ReadApprovedOcrRecord } from "../../../models/processing/ocr/read-approved-record.js";
import { ReadApprovedOcrRecords } from "../../../models/processing/ocr/read-approved-records.js";
import { ReadApprovedOcrSnapshot } from "../../../models/processing/ocr/read-approved-snapshot.js";
import { runClaim,type RunRecord } from "../../../models/run/record.js";
import { delegationEvidenceOutput } from "../../../models/run/result.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";
import { childRunOutcomeSchema } from "../../../models/workflow/graph.js";
import { ApprovedOcrRecordInputSchema } from "../../../models/workflows/ocr/approved-record.js";
import { OcrWorkflowResultSchema } from "../../../models/workflows/ocr/result.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { descriptorRuntimeNodes,type AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { OcrReviewRefusedError,type ApprovedOcrRecordReader } from "../../processing/ocr/review-authority.js";
import type { AuthorityDatabase } from "../../storage/sqlite/authority-database.js";
import { readDelegationEvidence } from "../../storage/sqlite/delegation-authority.js";
import { authenticateOcrOperator,requireCurrentOcrSnapshot } from "./ocr-review-authority.js";
import type { RunRecordService } from "./run-record-service.js";

const same = (left: unknown, right: unknown) => canonicalJsonStringify(left) === canonicalJsonStringify(right);

export function createApprovedOcrRecordReader(deps: Readonly<{
  database: Pick<AuthorityDatabase, "authority" | "withAuthorityReadSnapshot">; reader: Pick<RunRecordService, "read">; run: RunRecord;
  assertCurrent(): void; resolveDescriptor(workflowId: string): AnyWorkflowDescriptor | undefined;
}>): ApprovedOcrRecordReader {
  const reader = deps.reader;
  function consumer(task: typeof ReadApprovedOcrSnapshot | typeof ReadApprovedOcrRecord | typeof ReadApprovedOcrRecords) {
    const found = reader.read(deps.run.envelope.runId), capturedClaim = runClaim(deps.run);
    if (found.state !== "present" || found.disposition !== "live" || capturedClaim === undefined) throw new OcrReviewRefusedError();
    const current = found.run, claim = runClaim(current), descriptor = deps.resolveDescriptor(current.envelope.workflow);
    if (current.lifecycle.state !== "running" || current.cancelRequested === true || claim === undefined
      || claim.workerId !== capturedClaim.workerId || claim.claimGeneration !== capturedClaim.claimGeneration
      || !same(current.envelope, deps.run.envelope) || !same(current.input, deps.run.input)
      || descriptor === undefined || descriptor.version !== current.envelope.descriptorVersion
      || descriptor.contractFingerprint !== current.envelope.contractFingerprint) throw new OcrReviewRefusedError();
    const executing = descriptorRuntimeNodes(descriptor).find(node => node.id === (current.lifecycle.state === "running" ? current.lifecycle.currentNodeId : undefined));
    if (executing?.kind !== "task" || executing.uses.id !== task.id || executing.uses.effect !== task.effect
      || executing.uses.providers === undefined || !same(executing.uses.providers, task.providers)
      || deriveSchemaHash(executing.uses.input, "input") !== deriveSchemaHash(task.input, "input")
      || deriveSchemaHash(executing.uses.output, "output") !== deriveSchemaHash(task.output, "output")) throw new OcrReviewRefusedError();
    authenticateOcrOperator(deps.database.authority, reader, current);
    return { current, descriptor, executing };
  }
  function read<T>(operation: () => T): T {
    deps.assertCurrent();
    const result = deps.database.withAuthorityReadSnapshot(operation);
    deps.assertCurrent();
    return result;
  }
  function selected(query: z.output<typeof OcrApprovalReadRequestSchema>) {
    const { current, descriptor } = consumer(query.kind === "snapshot" ? ReadApprovedOcrSnapshot : ReadApprovedOcrRecord);
    let owner = current, ownerDescriptor = descriptor;
    if (query.kind === "record") {
      const parent = current.envelope.parent === undefined ? undefined : reader.read(current.envelope.parent.runId);
      if (parent?.state !== "present" || parent.disposition !== "live") throw new OcrReviewRefusedError();
      const producer = deps.resolveDescriptor(parent.run.envelope.workflow);
      if (producer === undefined || producer.version !== parent.run.envelope.descriptorVersion
        || producer.contractFingerprint !== parent.run.envelope.contractFingerprint
        || descriptorRuntimeNodes(producer).filter(node => node.kind === "child-run" && node.edgeId === current.envelope.parent?.edgeId
          && node.target.id === current.envelope.workflow && node.cardinality === "many" && node.await === "terminal").length !== 1) {
        throw new OcrReviewRefusedError();
      }
      owner = parent.run; ownerDescriptor = producer;
    }
    const edges = descriptorRuntimeNodes(ownerDescriptor).filter(node => node.kind === "child-run" && node.target.id === "ocr"
      && node.cardinality === "one" && node.await === "terminal" && node.join === "one");
    if (edges.length !== 1 || edges[0] === undefined) throw new OcrReviewRefusedError();
    const evidence = readDelegationEvidence(deps.database.authority, owner.envelope.runId, String(edges[0].id));
    const output = delegationEvidenceOutput(evidence, OcrWorkflowResultSchema);
    const parsedChild = childRunOutcomeSchema(OcrWorkflowResultSchema).safeParse(output);
    if (!parsedChild.success) throw new OcrReviewRefusedError();
    const child = parsedChild.data;
    if (child.state !== "done" || child.runId !== query.approval.sourceRunId || !same(child.output.approvedSnapshot, query.approval)) {
      throw new OcrReviewRefusedError();
    }
    const snapshot = requireCurrentOcrSnapshot(deps.database.authority, reader, query.approval);
    if (query.kind === "snapshot") return snapshot;
    const parsedInput = descriptor.canonicalInput.safeParse(current.input.parsed.value);
    if (!parsedInput.success) throw new OcrReviewRefusedError();
    const canonical: unknown = parsedInput.data;
    if (typeof canonical !== "object" || canonical === null) throw new OcrReviewRefusedError();
    const approval: unknown = Reflect.get(canonical, "approval"), approvedRecord: unknown = Reflect.get(canonical, "record");
    const parsedMember = ApprovedOcrRecordInputSchema.safeParse({ approval, record: approvedRecord });
    if (!parsedMember.success) throw new OcrReviewRefusedError();
    const member = parsedMember.data;
    const record = snapshot.records.find(record => record.recordId === query.recordId);
    if (record === undefined || query.recordId !== member.record.recordId || !same(member.approval, query.approval) || !same(member.record, record)) {
      throw new OcrReviewRefusedError();
    }
    return record;
  }
  return Object.freeze({
    readSnapshot: (approval: z.output<typeof ReadApprovedOcrSnapshot.input>) => read(() => {
      const value = selected({ kind: "snapshot", approval });
      return ReadApprovedOcrSnapshot.output.parse({ snapshot: value }).snapshot;
    }),
    readRecord: (query: z.output<typeof OcrApprovalReadRequestSchema> & { kind: "record" }) => read(() => {
      const value = selected(query);
      return ReadApprovedOcrRecord.output.parse({ record: value }).record;
    }),
    readSources: (input: z.output<typeof ReadApprovedOcrRecords.input>) => read(() => {
      const { current, descriptor, executing } = consumer(ReadApprovedOcrRecords);
      const edges = descriptorRuntimeNodes(descriptor).filter(node => node.kind === "child-run" && node.target.id === "ocr"
        && node.cardinality === "many" && node.await === "terminal" && node.join === "all-settled"
        && executing.dependsOn.includes(node.id));
      if (edges.length !== 1 || edges[0]?.id !== input.delegationNodeId) throw new OcrReviewRefusedError();
      const repositories = deps.database.authority;
      const evidence = readDelegationEvidence(repositories, current.envelope.runId, input.delegationNodeId);
      if (evidence.children.some(child => child.run.envelope.workflow !== "ocr")
        || !same(delegationEvidenceOutput(evidence, OcrWorkflowResultSchema), input.outcomes)) throw new OcrReviewRefusedError();
      const sources = input.outcomes.map(outcome => {
        if (outcome.state !== "done" || outcome.output.approvedSnapshot === null
          || outcome.output.approvedSnapshot.sourceRunId !== outcome.runId) throw new OcrReviewRefusedError();
        const snapshot = requireCurrentOcrSnapshot(repositories, reader, outcome.output.approvedSnapshot);
        return { snapshot, review: outcome.output.review };
      });
      return ReadApprovedOcrRecords.output.parse({ state: "ready", sources });
    }),
  });
}
