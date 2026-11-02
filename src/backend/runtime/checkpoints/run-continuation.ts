import { RunContinuationSchema } from "../../../models/run/continuation.js";
import type { RunEnvelope } from "../../../models/run/envelope.js";
import type { RunRecord } from "../../../models/run/record.js";
import type { GateResultRecord } from "../../../models/workflow/gates.js";
import type { TerminalDependencyEvidence } from "../../../models/run/result.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";

type ContinuationRepositories = Pick<AuthorityRepositories, "runCheckpoints" | "gateResults">
  & { readonly runs: Pick<AuthorityRepositories["runs"], "get"> };

export function continuationEvidenceDigest(value: unknown): string {
  return sha256Hex(canonicalJsonStringify(value));
}

export function validateRunContinuation(repositories: ContinuationRepositories, envelope: RunEnvelope): readonly RunRecord[] {
  const continuation = envelope.continuation;
  if (continuation === undefined) return [];
  RunContinuationSchema.parse(continuation);
  const owner = repositories.runs.get(envelope.runId);
  if (owner === undefined || canonicalJsonStringify(owner.envelope) !== canonicalJsonStringify(envelope)) throw new Error("run-continuation-owner-mismatch");
  return continuation.sources.map(source => {
    const run = repositories.runs.get(source.runId);
    if (run === undefined || source.runId !== envelope.runId && run.version !== source.version
      || run.envelope.attempt !== source.attempt || run.envelope.workflow !== envelope.workflow
      || run.envelope.itemId !== envelope.itemId || run.envelope.descriptorVersion !== envelope.descriptorVersion
      || run.envelope.contractFingerprint !== envelope.contractFingerprint
      || run.envelope.configFingerprint !== envelope.configFingerprint || run.envelope.configSnapshotId !== envelope.configSnapshotId
      || run.envelope.dryRun !== envelope.dryRun
      || source.runId !== envelope.runId && (run.lifecycle.state !== "terminal" || run.lifecycle.outcome !== "failed")) {
      throw new Error("run-continuation-source-unavailable");
    }
    return run;
  });
}

export function captureRunContinuation(repositories: ContinuationRepositories, run: RunRecord) {
  validateRunContinuation(repositories, run.envelope);
  const sources = new Map(run.envelope.continuation?.sources.map(source => [source.runId, source]));
  sources.set(run.envelope.runId, { runId: run.envelope.runId, version: run.version, attempt: run.envelope.attempt });
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
  if (ownRows.length > 1) throw new Error("run-continuation-gate-ambiguous");
  const own = ownRows[0];
  if (own !== undefined) return own;
  validateRunContinuation(repositories, envelope);
  const reference = envelope.continuation?.gates.find(row => row.nodeId === nodeId);
  if (reference === undefined) return undefined;
  const retained = repositories.gateResults.get(`${reference.runId}:${reference.gateId}`);
  if (retained === undefined || continuationEvidenceDigest(retained) !== reference.digest) throw new Error("run-continuation-gate-unavailable");
  return retained;
}

export class AuthenticatedRunContinuation {
  private constructor(private readonly repositories: AuthorityRepositories, private readonly envelope: RunEnvelope) {}

  static authenticate(repositories: AuthorityRepositories, envelope: RunEnvelope) {
    validateRunContinuation(repositories, envelope);
    return new AuthenticatedRunContinuation(repositories, envelope);
  }

  permitsGate(gate: GateResultRecord): boolean {
    const retained = readContinuationGate(this.repositories, this.envelope, String(gate.nodeId));
    return retained !== undefined && canonicalJsonStringify(retained) === canonicalJsonStringify(gate);
  }

  delegation(nodeId: string, edgeId: string) {
    const sources = validateRunContinuation(this.repositories, this.envelope);
    for (const source of [...sources].reverse()) {
      if (source.envelope.runId === this.envelope.runId) continue;
      const manifests = this.repositories.delegationManifests.listByParentRun(source.envelope.runId);
      if (!manifests.some(manifest => manifest.edgeId === edgeId)) continue;
      return this.repositories.dependencies.evidence(source.envelope.runId, nodeId);
    }
    return undefined;
  }

  permitsDelegation(evidence: Extract<TerminalDependencyEvidence, { state: "delegation-resolved" }>): boolean {
    const retained = this.delegation(String(evidence.nodeId), String(evidence.edgeId));
    return retained !== undefined && canonicalJsonStringify(retained) === canonicalJsonStringify(evidence);
  }
}
