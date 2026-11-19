import type { RunRecordService } from "../lifecycle/run-record-service.js";
import { createFailureResolutionQuery } from "../queries/failure-resolution.js";
import { authenticateWorkbookReferenceExecution } from "../workbooks.js";

import { terminalDelegationDependencyRecord, type RunResultRecord } from "../../../models/run/result.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import type { RunEvidenceReceipt } from "../../../models/trust/evidence.js";
import type { FailureRecord } from "../../../models/trust/failure.js";
import { descriptorRuntimeNodes,type AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { OcrReviewRefusedError } from "../../processing/ocr/review-authority.js";
import { readDelegationEvidence, readDelegationInvocationEvidence, currentDelegationManifests } from "../../storage/sqlite/delegation-authority.js";
import { continuationDelegationGroups } from "../../storage/sqlite/run-continuation-delegation.js";
import { DelegationInvocationRequestSchema } from "../../storage/sqlite/delegation-contracts.js";
import type { AuthorityDatabase } from "../../storage/sqlite/index.js";
import { authenticateOcrSnapshotApproval } from "../lifecycle/ocr-review-authority.js";
import {
ensureRunEvidenceReceipt,
type EnsureReceiptOutcome,
type EvidenceReceiptStore,
type ReceiptWriteEvidence,
} from "../provenance/evidence-receipt.js";
import { assertTrustEvidenceIdentity,requireTrustRun } from "./run-reader.js";

export interface ReceiptServiceDeps {
  readonly runReader?: Pick<RunRecordService, "read">;
  readonly database: AuthorityDatabase;
  /** The composition root's registered descriptors, by workflow id. */
  readonly descriptors: readonly AnyWorkflowDescriptor[];
}

export interface ReceiptService {
  ensure(runId: string): EnsureReceiptOutcome;
  ensureReceipt(runId: string): RunEvidenceReceipt;
  getFailure(failureId: string): FailureRecord | undefined;
  countFailuresByFingerprint(fingerprint: string): number;
  failureResolution: ReturnType<typeof createFailureResolutionQuery>;
}

export function createReceiptService(deps: ReceiptServiceDeps): ReceiptService {
  const byId = new Map(deps.descriptors.map((descriptor) => [String(descriptor.id), descriptor]));
  const { authority } = deps.database;
  const failures = createFailureResolutionQuery(authority);

  const store: EvidenceReceiptStore = Object.freeze({
    schemaReader: deps.database.evidenceSchemaHash.bind(deps.database),
    refreshedSettlementVersion: (runId: string) => authority.runResults.refreshedSettlementVersion(runId),
    getRun: (runId: string) => {
      const run = requireTrustRun(deps.runReader, runId);
      return run;
    },
    getResult: (runId: string) => {
      const result = authority.runResults.get(runId);
      if (result === undefined) {

        throw new Error(`run ${runId} has no immutable terminal result or evidence owner`);
      }
      if (result.runId !== runId) throw new Error(`TRUST_EVIDENCE_IDENTITY_MISMATCH: result for ${runId}`);
      return result;
    },
    getFailure: (failureId: string) => {
      const failure = failures.getFailure(failureId);
      if (failure === undefined) {
        throw new Error(`failure ${failureId} is named by a terminal run but authority does not hold it`);
      }
      return failure;
    },
    listCheckpointsByRun: (runId: string) => {
      const run = requireTrustRun(deps.runReader, runId);
      return authority.runCheckpoints.listByItem(run.envelope.workflow, run.envelope.itemId);
    },
    listWritesByRun: (runId: string): readonly ReceiptWriteEvidence[] => authority.writeIntents
      .listByRun(runId)
      .map((intent) => Object.freeze({
        intent,
        attempts: authority.writeAttempts.listByIntent(intent.writeIntentId),
      })),
    // Gate decisions come from durable gate rows, not task checkpoints.
    listGateResultsByRun: (runId: string) => authority.gateResults.listByRun(runId),
    listDelegationsByRun: (runId: string, retained?: RunResultRecord) => {
      const run = requireTrustRun(deps.runReader, runId);
      if (run.lifecycle.state !== "terminal" || run.lifecycle.outcome !== "done") return [];
      const manifests = currentDelegationManifests(authority, runId, retained === undefined ? undefined : run.version);
      if (retained !== undefined) {
        const citations = retained.dependencies.filter(dep => dep.state === "child-resolved" || dep.state === "delegation-resolved");
        const own = citations.filter(citation => citation.parentRunId === runId);
        if (retained.runId !== runId || own.length !== manifests.length) throw new Error("receipt-delegation-citation-mismatch");
        const inherited = citations.length === own.length ? [] : continuationDelegationGroups(authority, run.envelope);
        return citations.map(cited => {
          const candidates = cited.parentRunId === runId ? manifests : inherited.map(group => group.manifest);
          const matches = candidates.filter(manifest => manifest.parentRunId === cited.parentRunId && manifest.edgeId === cited.edgeId);
          const manifest = matches[0];
          if (matches.length !== 1 || manifest === undefined) throw new Error("receipt-delegation-citation-mismatch");
          const command = authority.lifecycleJournal.findDelegationInvocation(manifest.manifestId);
          if (command === undefined) throw new Error("receipt-delegation-invocation-unavailable");
          const invocation = DelegationInvocationRequestSchema.parse(command.request);
          if (invocation.runId !== cited.parentRunId || invocation.manifestId !== manifest.manifestId
            || invocation.nodeId !== cited.nodeId) throw new Error("receipt-delegation-citation-mismatch");
          const evidence = readDelegationInvocationEvidence(authority, command.commandId, new Set(), cited);
          if (evidence.children.some(child => child.run.envelope.workflow !== invocation.target.workflowId)
            || canonicalJsonStringify(terminalDelegationDependencyRecord(evidence)) !== canonicalJsonStringify(cited)) {
            throw new Error("receipt-delegation-citation-mismatch");
          }
          return evidence;
        });
      }
      const descriptor = byId.get(run.envelope.workflow);
      if (descriptor === undefined) throw new Error("receipt-delegation-descriptor-unavailable");
      const nodes = descriptorRuntimeNodes(descriptor).filter(node => node.kind === "child-run");
      if (manifests.some(manifest => nodes.filter(node => node.edgeId === manifest.edgeId).length !== 1)) throw new Error("receipt-delegation-edge-unavailable");
      return nodes.filter(node => manifests.some(manifest => manifest.edgeId === node.edgeId))
        .map(node => {
          const evidence = readDelegationEvidence(authority, runId, node.id);
          const command = authority.lifecycleJournal.getCommand(evidence.invocationCommandId);
          if (command === undefined || !("kind" in command) || command.kind !== "run-lifecycle" || command.operation !== "delegation-invocation"
            || DelegationInvocationRequestSchema.parse(command.request).target.workflowId !== node.target.id) throw new Error("receipt-delegation-target-mismatch");
          return evidence;
        });
    },
    authenticateSnapshotApproval: (gate: Parameters<typeof authenticateOcrSnapshotApproval>[2]) => {
      if (deps.runReader === undefined) throw new OcrReviewRefusedError();
      return authenticateOcrSnapshotApproval(authority, deps.runReader, gate, workflowId => byId.get(workflowId));
    },
    findReceiptByRun: (runId: string) => authority.evidenceReceipts.findByRun(runId),
    insertReceipt: (receipt: unknown) => authority.evidenceReceipts.insert(receipt),
  });

  const descriptorFor = (runId: string): AnyWorkflowDescriptor => {
    const run = requireTrustRun(deps.runReader, runId);
    const descriptor = byId.get(String(run.envelope.workflow));
    if (descriptor === undefined) {
      throw new Error(
        `run ${runId} is workflow ${run.envelope.workflow}, which this composition does not register; `
        + "refusing to explain a run with another workflow's graph",
      );
    }
    return descriptor;
  };

  const ensure = (runId: string): EnsureReceiptOutcome => deps.database.withAuthorityTransaction(repositories => {
    const run = requireTrustRun(deps.runReader, runId);
    const choice = authenticateWorkbookReferenceExecution(repositories, run);
    const continued = choice === undefined || choice.gate.runId === runId ? [] : [choice.gate];
    if (run.lifecycle.state === "terminal" && run.lifecycle.failureId !== undefined) {
      const failure = store.getFailure(run.lifecycle.failureId) as FailureRecord;
      assertTrustEvidenceIdentity(run, failure, "failure");
    }
    const outcome = ensureRunEvidenceReceipt({ ...store,
      readConfirmedWrite: intentId => repositories.writeIntents.getPublication(intentId),
      listGateResultsByRun: id => {
        if (id !== runId) throw new Error("TRUST_RECEIPT_GATE_OWNER_MISMATCH");
        return repositories.gateResults.listByRun(id);
      },
      listContinuedGateResultsByRun: id => {
        if (id !== runId) throw new Error("TRUST_RECEIPT_GATE_OWNER_MISMATCH");
        return continued;
      },
    }, descriptorFor(runId), runId);
    assertTrustEvidenceIdentity(run, outcome.receipt, "receipt");
    return outcome;
  });
  return Object.freeze({
    ensure,
    failureResolution: failures,
    ensureReceipt: (runId: string) => ensure(runId).receipt,
    getFailure: (failureId: string) => failures.getFailure(failureId),
    countFailuresByFingerprint: (fingerprint: string) => authority.failures.countByFingerprint(fingerprint),
  });
}
