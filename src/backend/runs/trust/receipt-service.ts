import { createFailureResolutionQuery } from "../queries/failure-resolution.js";
import type { RunRecordService } from "../lifecycle/run-record-service.js";

import {
  ensureRunEvidenceReceipt,
  type EnsureReceiptOutcome,
  type EvidenceReceiptStore,
  type ReceiptWriteEvidence,
} from "../provenance/evidence-receipt.js";
import { descriptorRuntimeNodes, type AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import type { RunEvidenceReceipt } from "../../../models/trust/evidence.js";
import type { FailureRecord } from "../../../models/trust/failure.js";
import type { AuthorityDatabase } from "../../storage/sqlite/index.js";
import { requireTrustRun, assertTrustEvidenceIdentity } from "./run-reader.js";
import { authenticateOcrSnapshotApproval, OcrReviewRefusedError } from "../lifecycle/ocr-review-authority.js";
import { readDelegationEvidence, retainedDelegationManifests } from "../../storage/sqlite/delegation-authority.js";
import { DelegationInvocationRequestSchema } from "../../storage/sqlite/delegation-contracts.js";

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
    listDelegationsByRun: (runId: string) => {
      const run = requireTrustRun(deps.runReader, runId);
      if (run.lifecycle.state !== "terminal" || run.lifecycle.outcome !== "done" || run.envelope.dryRun) return [];
      const descriptor = byId.get(run.envelope.workflow);
      if (descriptor === undefined) throw new Error("receipt-delegation-descriptor-unavailable");
      const nodes = descriptorRuntimeNodes(descriptor).filter(node => node.kind === "child-run");
      const manifests = retainedDelegationManifests(authority, runId);
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
      return authenticateOcrSnapshotApproval(authority, deps.runReader, gate);
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

  const ensure = (runId: string): EnsureReceiptOutcome => deps.database.withAuthorityTransaction(() => {
    const run = requireTrustRun(deps.runReader, runId);
    if (run.lifecycle.state === "terminal" && run.lifecycle.failureId !== undefined) {
      const failure = store.getFailure(run.lifecycle.failureId) as FailureRecord;
      assertTrustEvidenceIdentity(run, failure, "failure");
    }
    const outcome = ensureRunEvidenceReceipt(store, descriptorFor(runId), runId);
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
