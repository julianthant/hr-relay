import {
  RunReceiptComparisonWireSchema,
  type RunReceiptComparisonWire,
} from "../../../domain/dashboard/run-comparison.js";
import { RunIdSchema } from "../../../domain/ids.js";
import type { RunRecord } from "../../../domain/run/record.js";
import type { RunEvidenceReceipt } from "../../../domain/trust/evidence.js";
import {
  compareReceiptFacts,
  type ReceiptComparisonRegistry,
} from "../../../domain/trust/receipt-comparison.js";
import { SectionUnavailableError, TargetNotFoundError } from "../../failures.js";

export interface RunReceiptComparisonQueryDeps {
  readonly registry: ReceiptComparisonRegistry;
  readonly authority: Readonly<{
    getRun(runId: string): RunRecord | undefined;
    listReceiptsByRun(runId: string): readonly RunEvidenceReceipt[];
  }>;
}

function exactReceipt(
  receipts: readonly RunEvidenceReceipt[],
  runId: string,
): RunEvidenceReceipt {
  if (receipts.length !== 1) {
    throw new Error(
      `run ${runId} requires one exact immutable receipt for comparison; authority returned ${String(receipts.length)}`,
    );
  }
  const receipt = receipts[0];
  if (receipt === undefined) {
    throw new Error(`run ${runId} lost its exact receipt after cardinality validation`);
  }
  return receipt;
}

/** One strict read of a run and the exact run named by its durable retryOf. */
export function buildRunReceiptComparison(
  deps: RunReceiptComparisonQueryDeps,
  runIdInput: string,
): RunReceiptComparisonWire {
  const runId = RunIdSchema.parse(runIdInput);
  const current = deps.authority.getRun(runId);
  if (current === undefined) throw new TargetNotFoundError(`run ${runId} does not exist`);
  const retryOf = current.envelope.retryOf;
  if (retryOf === undefined) {
    throw new SectionUnavailableError(`run ${runId} names no retryOf run, so no prior receipt can be compared`);
  }
  const prior = deps.authority.getRun(retryOf);
  if (prior === undefined) {
    throw new TargetNotFoundError(`run ${runId} retries ${retryOf}, which authority does not hold`);
  }
  if (current.envelope.workflow !== prior.envelope.workflow) {
    throw new Error(
      `run ${runId} is ${current.envelope.workflow}, but retryOf ${retryOf} is ${prior.envelope.workflow}`,
    );
  }
  if (current.envelope.itemId !== prior.envelope.itemId) {
    throw new Error(
      `run ${runId} retries ${retryOf}, but item ${current.envelope.itemId} `
      + `does not equal prior item ${prior.envelope.itemId}`,
    );
  }
  const currentReceipt = exactReceipt(deps.authority.listReceiptsByRun(runId), runId);
  const priorReceipt = exactReceipt(deps.authority.listReceiptsByRun(retryOf), retryOf);
  return RunReceiptComparisonWireSchema.parse({
    wireVersion: 1,
    runId,
    retryOf,
    workflowId: current.envelope.workflow,
    currentReceiptId: currentReceipt.receiptId,
    priorReceiptId: priorReceipt.receiptId,
    facts: compareReceiptFacts(deps.registry, priorReceipt, currentReceipt),
  });
}
