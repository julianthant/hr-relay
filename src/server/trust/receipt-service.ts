import type { RunRecordService } from "../../core/run-record-service.js";
/**
 * The ONE authority-backed receipt path (D141).
 *
 * Both consumers — the dashboard's run-detail `receipt` section and the CLI's
 * `explain run` — go through this adapter, so a receipt an operator reads on
 * screen and a receipt they export from a terminal are the same derivation
 * over the same rows. A second assembly would be a second answer.
 *
 * It lives in `src/server/` for the same reason `compose.ts` does: it resolves
 * the run's descriptor from the composition root's registry, which sits ABOVE
 * `core` in the layer matrix.
 */
import {
  ensureRunEvidenceReceipt,
  type EnsureReceiptOutcome,
  type EvidenceReceiptStore,
  type ReceiptWriteEvidence,
} from "../../core/evidence-receipt.js";
import type { AnyWorkflowDescriptor } from "../../base/workflow.js";
import type { RunEvidenceReceipt } from "../../domain/trust/evidence.js";
import type { FailureRecord } from "../../domain/trust/failure.js";
import type { AuthorityDatabase } from "../../infra/sqlite/index.js";
import { TargetNotFoundError } from "../failures.js";

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
}

export function createReceiptService(deps: ReceiptServiceDeps): ReceiptService {
  const byId = new Map(deps.descriptors.map((descriptor) => [String(descriptor.id), descriptor]));
  const { authority } = deps.database;

  const store: EvidenceReceiptStore = Object.freeze({
    getRun: (runId: string) => {
      const run = authority.runs.get(runId);
      if (run === undefined) throw new TargetNotFoundError(`run ${runId} does not exist in authority`);
      return run;
    },
    getResult: (runId: string) => {
      const result = authority.runResults.get(runId);
      if (result === undefined) {
        // A `done` run's result is written in the same transaction as its
        // terminal transition (D110/D114). Its absence is a storage fault.
        throw new Error(`run ${runId} is terminal done but authority holds no run result`);
      }
      return result;
    },
    getFailure: (failureId: string) => {
      const failure = authority.failures.get(failureId);
      if (failure === undefined) {
        throw new Error(`failure ${failureId} is named by a terminal run but authority does not hold it`);
      }
      return failure;
    },
    listCheckpointsByRun: (runId: string) => {
      const run = authority.runs.get(runId);
      if (run === undefined) throw new TargetNotFoundError(`run ${runId} does not exist in authority`);
      return authority.runCheckpoints.listByItem(run.envelope.workflow, run.envelope.itemId);
    },
    listWritesByRun: (runId: string): readonly ReceiptWriteEvidence[] => authority.writeIntents
      .listByRun(runId)
      .map((intent) => Object.freeze({
        intent,
        attempts: authority.writeAttempts.listByIntent(intent.writeIntentId),
      })),
    // D204: the gate's own durable row. A run with no gate node reads an empty
    // list, which is the same answer as "this workflow asks no human anything".
    listGateResultsByRun: (runId: string) => authority.gateResults.listByRun(runId),
    findReceiptByRun: (runId: string) => authority.evidenceReceipts.findByRun(runId),
    insertReceipt: (receipt: unknown) => authority.evidenceReceipts.insert(receipt),
  });

  const descriptorFor = (runId: string): AnyWorkflowDescriptor => {
    const run = authority.runs.get(runId);
    if (run === undefined) throw new TargetNotFoundError(`run ${runId} does not exist in authority`);
    const descriptor = byId.get(String(run.envelope.workflow));
    if (descriptor === undefined) {
      throw new Error(
        `run ${runId} is workflow ${run.envelope.workflow}, which this composition does not register; `
        + "refusing to explain a run with another workflow's graph",
      );
    }
    return descriptor;
  };

  return Object.freeze({
    ensure: (runId: string) => ensureRunEvidenceReceipt(store, descriptorFor(runId), runId),
    ensureReceipt: (runId: string) => ensureRunEvidenceReceipt(store, descriptorFor(runId), runId).receipt,
    getFailure: (failureId: string) => authority.failures.get(failureId),
    countFailuresByFingerprint: (fingerprint: string) => authority.failures.countByFingerprint(fingerprint),
  });
}
