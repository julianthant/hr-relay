import {
  RunReceiptComparisonWireSchema,
  type RunReceiptComparisonWire,
} from "../../../domain/dashboard/run-comparison.js";
import { RunIdSchema } from "../../../domain/ids.js";
import type { RunRecord } from "../../../domain/run/record.js";
import type { RunEvidenceReceipt } from "../../../domain/trust/evidence.js";
import {
  compareReceiptFacts,
  ReceiptComparisonAuthorityRefusalError,
  type ReceiptComparisonRegistry,
} from "../../../domain/trust/receipt-comparison.js";
import {
  ComparisonIdentityRefusedError,
  SectionUnavailableError,
  TargetNotFoundError,
} from "../../failures.js";

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
  role: "current" | "prior",
): RunEvidenceReceipt {
  const { envelope } = authorityRun;
  const runId = envelope.runId;
  if (receipts.length !== 1) {
    throw new ComparisonIdentityRefusedError(
      `${role} receipt cardinality`,
      { cause: new Error(`authority run ${runId} returned ${String(receipts.length)} receipts`) },
    );
  }
  const receipt = receipts[0];
  if (receipt === undefined) {
    throw new Error(`run ${runId} lost its exact receipt after cardinality validation`);
  }
  if (receipt.runId !== runId) {
    throw new ComparisonIdentityRefusedError(`${role} receipt identity: runId`);
  }
  if (receipt.workflowId !== envelope.workflow) {
    throw new ComparisonIdentityRefusedError(`${role} receipt identity: workflow`);
  }
  if (receipt.attempt !== envelope.attempt) {
    throw new ComparisonIdentityRefusedError(`${role} receipt identity: attempt`);
  }
  const expectedRetryOf = envelope.retryOf;
  const retryMatches = expectedRetryOf === undefined
    ? receipt.retryOf.state === "absent"
    : receipt.retryOf.state === "present" && receipt.retryOf.value === expectedRetryOf;
  if (!retryMatches) {
    throw new ComparisonIdentityRefusedError(`${role} receipt identity: retryOf`);
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
    throw new ComparisonIdentityRefusedError("retry authority: prior run");
  }
  if (current.envelope.workflow !== prior.envelope.workflow) {
    throw new ComparisonIdentityRefusedError("retry authority: workflow");
  }
  if (current.envelope.itemId !== prior.envelope.itemId) {
    throw new ComparisonIdentityRefusedError("retry authority: itemId");
  }
  const currentReceipt = exactReceipt(deps.authority.listReceiptsByRun(runId), current, "current");
  const priorReceipt = exactReceipt(deps.authority.listReceiptsByRun(retryOf), prior, "prior");
  let facts: ReturnType<typeof compareReceiptFacts>;
  try {
    facts = compareReceiptFacts(deps.registry, priorReceipt, currentReceipt);
  } catch (error) {
    if (error instanceof ReceiptComparisonAuthorityRefusalError) {
      throw new ComparisonIdentityRefusedError("closed registry coordinate", { cause: error });
    }
    throw error;
  }
  return RunReceiptComparisonWireSchema.parse({
    wireVersion: 1,
    runId,
    retryOf,
    workflowId: current.envelope.workflow,
    currentReceiptId: currentReceipt.receiptId,
    priorReceiptId: priorReceipt.receiptId,
    facts,
  });
}
