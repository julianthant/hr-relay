import { RunContinuationRefusedError } from "../../storage/sqlite/run-continuation.js";
import type { RunClaimToken } from "../../../models/run/worker.js";
import type { DryRunBinding } from "../../../models/workflow/dry-run.js";
import type { TaskLogger } from "../../../workflow-kit/task.js";
import type { AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import type { RunRecord } from "../../../models/run/record.js";
import type { RuntimeFlowNode, RuntimeScope } from "../../../models/workflow/graph.js";
import { authenticateStoredParkedWriteRecheck } from "../../storage/sqlite/authority-run-evidence.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-repositories.js";
import type { WriteIntentParkCode } from "../../storage/sqlite/write-commit-contracts.js";

type TransactionRuntimeNode = Extract<RuntimeFlowNode, { kind: "transaction" }>;

export function requestedParkedWriteRecheck(
  repositories: Pick<AuthorityRepositories, "writeIntents"> & Parameters<typeof authenticateStoredParkedWriteRecheck>[0],
  run: RunRecord,
  node: TransactionRuntimeNode,
) {
  if (run.envelope.dryRun || run.envelope.startAt !== node.id) return undefined;
  const matches = repositories.writeIntents.listByRun(run.envelope.runId).filter(intent => intent.status === "parked"
    && intent.taskId === node.commit.uses.id && intent.runAttempt === run.envelope.attempt && intent.recheck?.nodeId === node.id);
  if (matches.length > 1) throw new RunContinuationRefusedError("parked-write-recheck-intent-ambiguous");
  const [intent] = matches;
  if (intent?.status !== "parked" || intent.recheck === undefined) return undefined;
  return authenticateStoredParkedWriteRecheck(repositories, intent, intent.recheck);
}

export interface WriteSequencerContext {
  readonly descriptor: AnyWorkflowDescriptor;
  readonly node: TransactionRuntimeNode;
  readonly run: RunRecord;
  readonly claim: RunClaimToken;
  readonly scope: RuntimeScope;
  readonly dryRun: boolean;
  readonly captureLog?: Pick<TaskLogger, "warn">;
  readonly previewBinding?: DryRunBinding;
  readonly signal: AbortSignal;
  /** Synchronous in-memory handoff after beat ⑦; consumers publish after the sequencer returns. */
  readonly onDurableCommit?: (proof: Readonly<{ writeIntentId: string; confirmedAt: string; proofDigest: string }>) => void;
  readonly onSavedEffectVerified?: (proof: Readonly<{ proofDigest: string }>) => void;
  readonly onDiagnosticDeliveryFailure?: () => void;
}

export interface WriteSequencer {
  executeTransaction(context: WriteSequencerContext): Promise<unknown>;
  // The sequencer owns probe, preparation, subject proof, fence and commit as one capability boundary.
  executeDryRun(context: WriteSequencerContext): Promise<unknown>;
}


export class WriteParkedError extends Error {
  readonly writeIntentId: string;
  readonly intentGeneration: number;
  readonly parkCode: WriteIntentParkCode;

  constructor(input: Readonly<{
    writeIntentId: string;
    intentGeneration: number;
    parkCode: WriteIntentParkCode;
    message: string;
    cause?: unknown;
  }>) {
    super(input.message, input.cause === undefined ? undefined : { cause: input.cause });
    this.name = "WriteParkedError";
    this.writeIntentId = input.writeIntentId;
    this.intentGeneration = input.intentGeneration;
    this.parkCode = input.parkCode;
  }
}
