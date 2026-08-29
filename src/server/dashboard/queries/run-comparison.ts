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
  authorityRun: RunRecord,
): RunEvidenceReceipt {
  const { envelope } = authorityRun;
  const runId = envelope.runId;
  if (receipts.length !== 1) {
    throw new Error(
      `run ${runId} requires one exact immutable receipt for comparison; authority returned ${String(receipts.length)}`,
    );
  }
  const receipt = receipts[0];
  if (receipt === undefined) {
    throw new Error(`run ${runId} lost its exact receipt after cardinality validation`);
  }
  if (receipt.runId !== runId) {
    throw new Error(`receipt identity mismatch for authority run ${runId}: runId`);
  }
  if (receipt.workflowId !== envelope.workflow) {
    throw new Error(`receipt identity mismatch for authority run ${runId}: workflow`);
  }
  if (receipt.attempt !== envelope.attempt) {
    throw new Error(`receipt identity mismatch for authority run ${runId}: attempt`);
  }
  const expectedRetryOf = envelope.retryOf;
  const retryMatches = expectedRetryOf === undefined
    ? receipt.retryOf.state === "absent"
    : receipt.retryOf.state === "present" && receipt.retryOf.value === expectedRetryOf;
  if (!retryMatches) {
    throw new Error(`receipt identity mismatch for authority run ${runId}: retryOf`);
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
    throw new Error(`run ${runId} retry identity does not match prior authority: itemId`);
  }
  const currentReceipt = exactReceipt(deps.authority.listReceiptsByRun(runId), current);
  const priorReceipt = exactReceipt(deps.authority.listReceiptsByRun(retryOf), prior);
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
