import { FingerprintSchema } from "../../../rules/identity/ids.js";
import { RunContinuationSchema } from "../../../models/run/continuation.js";
import type { RunEnvelope } from "../../../models/run/envelope.js";
import type { RunRecord } from "../../../models/run/record.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import type { AuthorityRepositories } from "./authority-database.js";

export class RunContinuationRefusedError extends Error {
  readonly code = "RUN_CONTINUATION_REFUSED";
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RunContinuationRefusedError";
  }
}

type ContinuationRepositories = Pick<AuthorityRepositories, "runCheckpoints" | "gateResults">
  & { readonly runs: Pick<AuthorityRepositories["runs"], "get">;
    readonly dependencies?: Pick<AuthorityRepositories["dependencies"], "cancellationOutcome">;
    readonly lifecycleJournal?: Pick<AuthorityRepositories["lifecycleJournal"], "findContinuationIssue"> };

export function continuationEvidenceDigest(value: unknown) {
  return FingerprintSchema.parse(sha256Hex(canonicalJsonStringify(value)));
}

function sourceIdentityDigest(run: RunRecord) {
  const { continuation: _continuation, priority: _priority, startAt: _startAt, ...envelope } = run.envelope;
  return continuationEvidenceDigest({ envelope, input: run.input });
}

export function validateRunContinuation(repositories: ContinuationRepositories, envelope: RunEnvelope): readonly RunRecord[] {
  const continuation = envelope.continuation;
  if (continuation === undefined) return [];
  if (!RunContinuationSchema.safeParse(continuation).success) throw new RunContinuationRefusedError("run-continuation-schema-invalid");
  const owner = repositories.runs.get(envelope.runId);
  if (owner === undefined || canonicalJsonStringify(owner.envelope) !== canonicalJsonStringify(envelope)) throw new RunContinuationRefusedError("run-continuation-owner-mismatch");
  const issue = repositories.lifecycleJournal?.findContinuationIssue(envelope.runId);
  if (issue?.result.kind !== "run" || issue.result.runId !== envelope.runId || issue.result.appliedVersion > owner.version
    || canonicalJsonStringify(issue.result.continuation) !== canonicalJsonStringify(continuation)) throw new RunContinuationRefusedError("run-continuation-issuance-unavailable");
  return continuation.sources.map(source => {
    const run = repositories.runs.get(source.runId);
    const cancelledChild = run?.lifecycle.state === "terminal" && run.lifecycle.outcome === "cancelled"
      && envelope.parent !== undefined && run.envelope.parent !== undefined
      && canonicalJsonStringify(run.envelope.parent) === canonicalJsonStringify(envelope.parent);
    if (run === undefined || source.runId !== envelope.runId && run.version !== source.version
      || sourceIdentityDigest(run) !== source.identityDigest
      || run.envelope.attempt !== source.attempt || run.envelope.workflow !== envelope.workflow
      || run.envelope.itemId !== envelope.itemId || run.envelope.descriptorVersion !== envelope.descriptorVersion
      || run.envelope.contractFingerprint !== envelope.contractFingerprint
      || run.envelope.configFingerprint !== envelope.configFingerprint
      || run.envelope.dryRun !== envelope.dryRun
      || source.runId !== envelope.runId && !cancelledChild && (run.lifecycle.state !== "terminal" || !["failed", "interrupted"].includes(run.lifecycle.outcome))) {
      throw new RunContinuationRefusedError("run-continuation-source-unavailable");
    }
    if (cancelledChild && source.runId !== envelope.runId) {
      if (repositories.dependencies === undefined) throw new RunContinuationRefusedError("run-continuation-cancellation-authority-unavailable");
      repositories.dependencies.cancellationOutcome(source.runId);
    }
    return run;
  });
}

export function captureRunContinuation(repositories: ContinuationRepositories, run: RunRecord) {
  validateRunContinuation(repositories, run.envelope);
  const sources = new Map(run.envelope.continuation?.sources.map(source => [source.runId, source]));
  sources.set(run.envelope.runId, { runId: run.envelope.runId, version: run.version, attempt: run.envelope.attempt,
    identityDigest: sourceIdentityDigest(run) });
  const checkpoints = new Map(run.envelope.continuation?.checkpoints.map(row => [row.nodeId, row]));
  for (const row of repositories.runCheckpoints.listByItem(run.envelope.workflow, run.envelope.itemId)
    .filter(row => row.runId === run.envelope.runId && row.attempt === run.envelope.attempt)
    .sort((a, b) => a.claimGeneration - b.claimGeneration)) {
    checkpoints.set(row.nodeId, { nodeId: row.nodeId, runId: row.runId, attempt: row.attempt,
      claimGeneration: row.claimGeneration, digest: continuationEvidenceDigest(row) });
  }
  const gates = new Map(run.envelope.continuation?.gates.map(row => [row.nodeId, row]));
  for (const row of repositories.gateResults.listByRun(run.envelope.runId)) {
    gates.set(row.nodeId, { nodeId: row.nodeId, gateId: row.gateId, runId: row.runId, digest: continuationEvidenceDigest(row) });
  }
  return RunContinuationSchema.parse({ sources: [...sources.values()], checkpoints: [...checkpoints.values()], gates: [...gates.values()] });
}

export function readContinuationGate(repositories: ContinuationRepositories, envelope: RunEnvelope, nodeId: string) {
  const ownRows = repositories.gateResults.listByRun(envelope.runId).filter(row => row.nodeId === nodeId);
  if (ownRows.length > 1) throw new RunContinuationRefusedError("run-continuation-gate-ambiguous");
  const own = ownRows[0];
  if (own !== undefined) return own;
  validateRunContinuation(repositories, envelope);
  const reference = envelope.continuation?.gates.find(row => row.nodeId === nodeId);
  if (reference === undefined) return undefined;
  const retained = repositories.gateResults.get(`${reference.runId}:${reference.gateId}`);
  if (retained === undefined || continuationEvidenceDigest(retained) !== reference.digest) throw new RunContinuationRefusedError("run-continuation-gate-unavailable");
  return retained;
}

/** A checkpoint a continuation retains, read back by its owner run and digest. */
export function retainedCheckpoint(repositories: Pick<AuthorityRepositories, "runCheckpoints">, envelope: RunEnvelope,
  reference: NonNullable<RunEnvelope["continuation"]>["checkpoints"][number]) {
  const row = repositories.runCheckpoints.get(envelope.workflow, envelope.itemId, reference.nodeId, reference.attempt, reference.claimGeneration);
  if (row === undefined || row.runId !== reference.runId || continuationEvidenceDigest(row) !== reference.digest) throw new RunContinuationRefusedError("run-continuation-checkpoint-unavailable");
  return row;
}

/** The row a run's consumer at `claimGeneration` was bound from: its newest row up to that claim, else the row it was created with. */
export function originalCheckpoint(repositories: Pick<AuthorityRepositories, "runCheckpoints"> & Pick<ContinuationRepositories, "lifecycleJournal">,
  source: RunRecord, nodeId: string, claimGeneration: number) {
  const own = repositories.runCheckpoints.listByAttempt(source.envelope.workflow, source.envelope.itemId, nodeId, source.envelope.attempt)
    .filter(row => row.runId === source.envelope.runId && row.claimGeneration <= claimGeneration).at(-1);
  if (own !== undefined) return own;
  if (source.envelope.continuation === undefined) return undefined;
  if (repositories.lifecycleJournal === undefined) throw new RunContinuationRefusedError("run-continuation-authority-unavailable");
  const created = repositories.lifecycleJournal.findContinuationIssue(source.envelope.runId, 1);
  const reference = created?.result.kind === "run" && ["create", "retry", "recover"].includes(created.request.operation)
    ? created.result.continuation?.checkpoints.find(row => row.nodeId === nodeId && row.runId !== source.envelope.runId) : undefined;
  return reference === undefined ? undefined : retainedCheckpoint(repositories, source.envelope, reference);
}

/** A fresh read by a non-Retry run takes the item's latest row unless a cancelled run wrote it; Retry and transaction reads always take the latest row. */
export function readRunCheckpoint(repositories: Pick<AuthorityRepositories, "runCheckpoints"> & { readonly runs?: Pick<AuthorityRepositories["runs"], "get">; readonly lifecycleJournal?: Pick<AuthorityRepositories["lifecycleJournal"], "findContinuationIssue">; readonly gateResults?: AuthorityRepositories["gateResults"] }, envelope: RunEnvelope, nodeId: string, freshTasks = false) {
  if (envelope.continuation !== undefined) {
    if (repositories.runs === undefined || repositories.gateResults === undefined) throw new RunContinuationRefusedError("run-continuation-authority-unavailable");
    validateRunContinuation({ ...repositories, runs: repositories.runs, gateResults: repositories.gateResults }, envelope);
    const own = repositories.runCheckpoints.listByAttempt(envelope.workflow, envelope.itemId, nodeId, envelope.attempt)
      .filter(row => row.runId === envelope.runId).at(-1);
    if (own !== undefined) return own;
    const reference = envelope.continuation.checkpoints.find(row => row.nodeId === nodeId);
    return reference === undefined ? undefined : retainedCheckpoint(repositories, envelope, reference);
  }
  const own = () => repositories.runCheckpoints.listByAttempt(envelope.workflow, envelope.itemId, nodeId, envelope.attempt)
    .filter((checkpoint) => checkpoint.runId === envelope.runId).at(-1);
  if (envelope.sourceBound !== undefined || freshTasks && envelope.recovery === "restart-from-start") return own();
  const latest = repositories.runCheckpoints.latest(envelope.workflow, envelope.itemId, nodeId);
  if (!freshTasks || envelope.retryOf !== undefined || latest === undefined || latest.runId === envelope.runId) return latest;
  return writtenUnderCancel(repositories.runs, latest.runId) ? own() : latest;
}

/** True when the row's run, or a run it was delegated from, was cancelled. */
function writtenUnderCancel(runs: Pick<AuthorityRepositories["runs"], "get"> | undefined, runId: string): boolean {
  for (let run = runs?.get(runId); run !== undefined; run = run.envelope.parent === undefined ? undefined : runs?.get(run.envelope.parent.runId)) {
    if (run.lifecycle.state === "terminal" && run.lifecycle.outcome === "cancelled") return true;
  }
  return false;
}
