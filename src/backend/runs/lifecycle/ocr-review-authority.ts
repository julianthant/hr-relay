import { timelineCheckpointReference } from "../../../models/events/timeline.js";
import { OcrReviewRevisionSchema,initialOcrReviewRecords,ocrReviewDigest,ocrSnapshotDigest,type OcrReviewRevision } from "../../../models/ocr/review.js";
import type { RunRecord } from "../../../models/run/record.js";
import { delegationEvidenceOutput } from "../../../models/run/result.js";
import { I9SignerOutputSchema } from "../../../models/systems/i9/read-section2-signer.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";
import { checkpointLookupKey,checkpointRecordKey,type RunCheckpointRecord } from "../../../models/workflow/checkpoint.js";
import type { OperatorGateResultRecord } from "../../../models/workflow/gates.js";
import { childRunOutcomeSchema } from "../../../models/workflow/graph.js";
import { OcrPageReadingSchema } from "../../../models/workflows/ocr/page-accounting.js";
import { OcrApprovalReferenceSchema,OcrResultSchema } from "../../../models/workflows/ocr/result.js";
import { PersonLookupResultSchema } from "../../../models/workflows/person-lookup/result.js";
import type { CommandRequest } from "../../../rules/commands/commands.js";
import { deriveStableUuid,lifecycleCommandId } from "../../../rules/identity/identifiers.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { BUILD_MANIFEST,resolveWorkflowFingerprint } from "../../../workflow-kit/validation/build-manifest.js";
import { OcrReviewRefusedError } from "../../processing/ocr/review-authority.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";
import { authenticateDescendantHome,childTerminalSettlement,readDelegationEvidence } from "../../storage/sqlite/delegation-authority.js";
import { authenticateRootRun } from "../../storage/sqlite/delegation-root-authority.js";
import { RunContinuationRefusedError,readContinuationGate,validateRunContinuation } from "../../storage/sqlite/run-continuation.js";
import { CanonicalTransitionRequestSchema } from "../../storage/sqlite/run-store-contracts.js";
import type { RunRecordService } from "./run-record-service.js";

function same(left: unknown, right: unknown): boolean { return canonicalJsonStringify(left) === canonicalJsonStringify(right); }
export function authenticateOcrOperator(repositories: AuthorityRepositories, reader: Pick<RunRecordService, "read">, run: RunRecord): "local-operator" {
  let root = run;
  const visited = new Set<string>();
  while (root.envelope.parent !== undefined) {
    if (visited.size >= 16 || visited.has(root.envelope.runId)) throw new OcrReviewRefusedError();
    visited.add(root.envelope.runId);
    const parent = reader.read(root.envelope.parent.runId);
    if (parent.state !== "present" || parent.disposition !== "live") throw new OcrReviewRefusedError();
    root = parent.run;
  }
  if (!authenticateDescendantHome(repositories, run, root.envelope.workflow)
    || authenticateRootRun(repositories, root).command.requestedBy !== "local-operator") throw new OcrReviewRefusedError();
  return "local-operator";
}

export function assertOcrChildRetryCurrent(repositories: AuthorityRepositories, reader: Pick<RunRecordService, "read">, child: RunRecord): void {
  const parent = child.envelope.parent === undefined ? undefined : repositories.runs.get(child.envelope.parent.runId);
  if (parent?.envelope.workflow !== "ocr") return;
  authenticateOcrOperator(repositories, reader, parent);
  if (child.lifecycle.state !== "terminal" || child.lifecycle.outcome !== "failed"
    || repositories.ocrReviews.snapshots(parent.envelope.runId).length > 0
    || repositories.gateResults.get(`${parent.envelope.runId}:approve-records`) !== undefined) {
    throw new RunContinuationRefusedError("ocr-child-retry-review-frozen-or-child-ineligible");
  }
  readOcrReviewAuthority(repositories, reader, parent.envelope.runId);
  const members = repositories.dependencies.groups(parent.envelope.runId).flatMap(({ group }) => group.children)
    .filter(member => member.child.envelope.runId === child.envelope.runId);
  if (members.length !== 1) throw new RunContinuationRefusedError("ocr-child-retry-member-replaced");
}

export function ocrChildRetryAvailable(repositories: AuthorityRepositories, reader: Pick<RunRecordService, "read">, child: RunRecord): boolean {
  if (child.envelope.parent === undefined || child.lifecycle.state !== "terminal" || child.lifecycle.outcome !== "failed") return false;
  const parent = repositories.runs.get(child.envelope.parent.runId);
  if (parent?.envelope.workflow !== "ocr" || parent.lifecycle.state !== "queued" || parent.cancelRequested === true
    || parent.pause !== undefined || repositories.ocrReviews.snapshots(parent.envelope.runId).length > 0
    || repositories.gateResults.get(`${parent.envelope.runId}:approve-records`) !== undefined
    || repositories.workerControls.resetForRun(parent.envelope.runId) !== undefined
    || repositories.workerControls.resetForRun(child.envelope.runId) !== undefined
    || repositories.runtimeConfig.get()?.configSnapshotId !== child.envelope.configSnapshotId
    || [parent, child].some(run => repositories.writeIntents.listByRun(run.envelope.runId).some(intent => intent.status === "attempting" || intent.status === "parked"))) return false;
  const member = repositories.dependencies.groups(parent.envelope.runId).flatMap(({ group }) => group.children)
    .find(member => member.child.envelope.runId === child.envelope.runId);
  if (member === undefined) return false;
  assertOcrChildRetryCurrent(repositories, reader, child);
  return member.dependency.state === "failed" && childTerminalSettlement(child, repositories)?.state === "failed"
    && child.envelope.contractFingerprint === resolveWorkflowFingerprint(BUILD_MANIFEST, child.envelope.workflow);
}

export function assertOcrReviewChildrenCurrent(repositories: AuthorityRepositories, runId: string, seed: OcrReviewRevision["seed"],
  lookupNodes: readonly ("lookup-identities" | "lookup-signers")[]): void {
  if (seed.review.sourceRunId !== undefined && seed.review.sourceRunId !== runId
    || repositories.runs.listChildren(runId).some(child => child.lifecycle.state !== "terminal")) throw new OcrReviewRefusedError();
  const pages = readDelegationEvidence(repositories, runId, "read-pages");
  const identities = lookupNodes.flatMap<OcrReviewRevision["seed"]["identities"][number]["outcome"]>(nodeId => {
    const evidence = readDelegationEvidence(repositories, runId, nodeId);
    return nodeId === "lookup-identities"
      ? childRunOutcomeSchema(PersonLookupResultSchema).array().parse(delegationEvidenceOutput(evidence, PersonLookupResultSchema))
      : childRunOutcomeSchema(I9SignerOutputSchema).array().parse(delegationEvidenceOutput(evidence, I9SignerOutputSchema));
  });
  if (!same(delegationEvidenceOutput(pages, OcrPageReadingSchema), seed.review.accounting.outcomes)
    || !same(identities, seed.identities.map(entry => entry.outcome))) {
    throw new OcrReviewRefusedError();
  }
  for (const outcome of seed.review.accounting.outcomes) {
    if (outcome.state !== "done") continue;
    const stored = repositories.ocrExtractions.get(outcome.output.extractionId);
    if (stored === undefined || stored.binding !== "source-bound"
      || !same({ ...outcome.output, binding: "source-bound" }, stored)) throw new OcrReviewRefusedError();
  }
}

export function publishOcrReview(repositories: AuthorityRepositories, reader: Pick<RunRecordService, "read">,
  run: RunRecord, checkpoint: RunCheckpointRecord): void {
  const actorId = authenticateOcrOperator(repositories, reader, run);
  const seed = OcrResultSchema.parse(checkpoint.output.value);
  assertOcrReviewChildrenCurrent(repositories, run.envelope.runId, seed, ["lookup-identities", "lookup-signers"]);
  const current = readOcrReviewAuthority(repositories, reader, run.envelope.runId);
  if (current !== undefined && same(current.revision.seed, seed)) return;
  if (repositories.ocrReviews.snapshots(run.envelope.runId).length > 0) throw new OcrReviewRefusedError();
  const expectedRevision = current?.revision.revision ?? 0;
  const record = OcrReviewRevisionSchema.parse({ id: `${run.envelope.runId}#${expectedRevision + 1}`, sourceRunId: run.envelope.runId,
    revision: expectedRevision + 1, seed, records: initialOcrReviewRecords(seed),
    origin: { kind: "checkpoint", key: checkpointRecordKey(checkpoint), digest: sha256Hex(canonicalJsonStringify(checkpoint)), checkpoint: timelineCheckpointReference(checkpoint) },
    actorId, createdAt: checkpoint.writtenAt });
  if (current !== undefined) {
    for (let revision = expectedRevision; revision > 0; revision--) {
      const retained = repositories.ocrReviews.revision(run.envelope.runId, revision);
      if (retained?.origin.kind !== "checkpoint") continue;
      if (retained.origin.checkpoint.claimGeneration >= checkpoint.claimGeneration) throw new OcrReviewRefusedError();
      break;
    }
  }
  repositories.ocrReviews.append(record, expectedRevision);
}

export function reviseOcrReview(current: OcrReviewRevision,
  request: Extract<CommandRequest, { family: "ocr-review" }>, createdAt: string): OcrReviewRevision {
  if (request.target.runId !== current.sourceRunId || request.target.expectedRevision !== current.revision
    || request.requestedBy !== "local-operator" || request.source !== "dashboard"
    || !current.records.some(record => record.recordId === request.payload.recordId)) throw new OcrReviewRefusedError();
  return OcrReviewRevisionSchema.parse({ ...current, id: `${current.sourceRunId}#${current.revision + 1}`,
    revision: current.revision + 1, origin: { kind: "command", commandId: request.commandId }, createdAt,
    records: current.records.map(record => record.recordId !== request.payload.recordId ? record
      : request.type === "correct-ocr-record" ? { ...record, ...request.payload }
        : { ...record, discarded: request.type === "discard-ocr-record" }) });
}

export function readOcrReviewAuthority(repositories: AuthorityRepositories, reader: Pick<RunRecordService, "read">, runId: string) {
  const existence = reader.read(runId);
  if (existence.state !== "present" || existence.disposition !== "live" || existence.run.envelope.workflow !== "ocr") throw new OcrReviewRefusedError();
  authenticateOcrOperator(repositories, reader, existence.run);
  const latest = repositories.ocrReviews.latest(runId);
  if (latest === undefined) return undefined;
  if (latest.sourceRunId !== runId) throw new OcrReviewRefusedError();
  let previous: OcrReviewRevision | undefined;
  let previousCheckpoint: OcrReviewRevision | undefined;
  for (let revision = 1; revision <= latest.revision; revision++) {
    const record = repositories.ocrReviews.revision(runId, revision);
    if (record === undefined || record.sourceRunId !== runId || record.revision !== revision) throw new OcrReviewRefusedError();
    if (record.origin.kind === "checkpoint") {
      const checkpoint = repositories.runCheckpoints.listByAttempt(existence.run.envelope.workflow,
        existence.run.envelope.itemId, "read-result", existence.run.envelope.attempt)
        .find(row => checkpointRecordKey(row) === (record.origin.kind === "checkpoint" ? record.origin.key : ""));
      const publication = checkpoint === undefined ? undefined : repositories.timelineEvents.get(deriveStableUuid("timeline-checkpoint-recorded",
        checkpointLookupKey(checkpoint.workflowId, checkpoint.itemId, checkpoint.nodeId, checkpoint.attempt, checkpoint.claimGeneration)));
      if (checkpoint === undefined || checkpoint.runId !== runId || !same(checkpoint.output.value, record.seed)
        || checkpoint.contractFingerprint !== existence.run.envelope.contractFingerprint
        || checkpoint.descriptorVersion !== existence.run.envelope.descriptorVersion
        || publication?.payload.kind !== "checkpoint-recorded" || publication.workflow !== checkpoint.workflowId
        || publication.scope.kind !== "run" || publication.scope.runId !== runId || publication.occurredAt !== checkpoint.writtenAt
        || publication.payload.runId !== runId || publication.payload.workflow !== checkpoint.workflowId
        || publication.payload.attempt !== checkpoint.attempt || publication.payload.claimGeneration !== checkpoint.claimGeneration
        || !same(publication.payload.checkpoint, timelineCheckpointReference(checkpoint))
        || previousCheckpoint?.origin.kind === "checkpoint" && previousCheckpoint.origin.checkpoint.claimGeneration >= checkpoint.claimGeneration
        || previous !== undefined && same(previous.seed, record.seed)
        || record.origin.digest !== sha256Hex(canonicalJsonStringify(checkpoint))
        || !same(record.origin.checkpoint, timelineCheckpointReference(checkpoint)) || record.createdAt !== checkpoint.writtenAt
        || !same(record.records, initialOcrReviewRecords(record.seed))) throw new OcrReviewRefusedError();
      previousCheckpoint = record;
    } else {
      const request = repositories.commands.get(record.origin.commandId);
      const audit = repositories.commandAudits.findByCommand(record.origin.commandId);
      if (previous === undefined || request?.family !== "ocr-review" || request.commandId !== record.origin.commandId || request.requestedBy !== "local-operator"
        || request.source !== "dashboard" || audit?.result.state !== "applied" || audit.result.commandId !== request.commandId
        || !same(audit.request, request) || !same(reviseOcrReview(previous, request, record.createdAt), record)
        || !audit.versionChanges.some(change => change.target.family === "ocr-review" && change.target.runId === runId
          && change.before === revision - 1 && change.after === revision)) throw new OcrReviewRefusedError();
      const journalId = lifecycleCommandId("operator-ocr-review", request.commandId);
      const command = repositories.lifecycleJournal.getCommand(journalId), settled = repositories.lifecycleJournal.findAuditByCommand(journalId);
      const change = audit.versionChanges.find(change => change.target.family === "run" && change.target.runId === runId);
      if (command === undefined || !("kind" in command) || command.kind !== "run-lifecycle" || command.operation !== "transition"
        || settled === undefined || !("kind" in settled) || settled.kind !== "run-lifecycle" || !same(settled.request, command)
        || settled.result.kind !== "run" || settled.result.runId !== runId || change === undefined
        || change.after !== Number(change.before) + 1 || change.after !== settled.result.appliedVersion
        || existence.run.version < change.after || audit.completedAt !== record.createdAt) throw new OcrReviewRefusedError();
      const mutation = CanonicalTransitionRequestSchema.parse(command.request);
      if (!("ocrReviewRevision" in mutation) || mutation.sourceCommandId !== request.commandId || mutation.runId !== runId
        || mutation.ocrReviewRevision !== revision || Number(mutation.expectedVersion) !== Number(change.before)) throw new OcrReviewRefusedError();
    }
    previous = record;
  }
  return { run: existence.run, revision: latest, digest: ocrReviewDigest(latest) };
}

export function readOcrSnapshotsAuthority(repositories: AuthorityRepositories, review: NonNullable<ReturnType<typeof readOcrReviewAuthority>>) {
  return repositories.ocrReviews.snapshots(review.run.envelope.runId).map(snapshot => {
    const revision = repositories.ocrReviews.revision(snapshot.sourceRunId, snapshot.revision);
    const command = repositories.commands.get(snapshot.snapshotId);
    const audit = repositories.commandAudits.findByCommand(snapshot.snapshotId);
    const gate = repositories.gateResults.listByRun(snapshot.sourceRunId).find(result => "commandId" in result && result.commandId === snapshot.snapshotId);
    const reference = { snapshotId: snapshot.snapshotId, sourceRunId: snapshot.sourceRunId,
      revision: snapshot.revision, digest: ocrSnapshotDigest(snapshot) };
    if (snapshot.sourceRunId !== review.run.envelope.runId || revision === undefined || snapshot.reviewDigest !== ocrReviewDigest(revision)
      || !snapshot.selectedRecordIds.every(id => revision.records.some(record => record.recordId === id))
      || !same(snapshot.records, snapshot.selectedRecordIds.map(id => revision.records.find(record => record.recordId === id)))
      || command?.family !== "gate" || command.commandId !== snapshot.snapshotId || command.target.runId !== snapshot.sourceRunId || String(command.target.gateId) !== "approve-records"
      || command.requestedBy !== "local-operator" || command.source !== "dashboard"
      || audit?.result.state !== "applied" || audit.result.commandId !== command.commandId || !same(audit.request, command)
      || command.payload.ocrApproval?.expectedRevision !== snapshot.revision
      || command.payload.ocrApproval.reviewDigest !== snapshot.reviewDigest
      || !same(command.payload.ocrApproval.selectedRecordIds, snapshot.selectedRecordIds)
      || gate === undefined || !("commandId" in gate) || gate.runId !== snapshot.sourceRunId
      || String(gate.nodeId) !== "approve-records" || String(gate.gateId) !== "approve-records"
      || gate.expectedVersion !== command.target.expectedVersion || gate.resolvedBy !== snapshot.approvedBy || gate.resolvedAt !== snapshot.approvedAt
      || audit.completedAt !== snapshot.approvedAt || !same(command.payload.result, gate.result)
      || !same(gate.result.value, reference)) throw new OcrReviewRefusedError();
    const journalId = lifecycleCommandId("operator-gate", snapshot.snapshotId);
    const mutation = repositories.lifecycleJournal.getCommand(journalId), settled = repositories.lifecycleJournal.findAuditByCommand(journalId);
    if (mutation === undefined || !("kind" in mutation) || mutation.kind !== "run-lifecycle" || mutation.operation !== "transition"
      || settled === undefined || !("kind" in settled) || settled.kind !== "run-lifecycle" || !same(settled.request, mutation)
      || settled.result.kind !== "run" || settled.result.runId !== snapshot.sourceRunId
      || settled.result.appliedVersion !== command.target.expectedVersion + 1) throw new OcrReviewRefusedError();
    const queued = CanonicalTransitionRequestSchema.parse(mutation.request);
    if (!("lifecycle" in queued) || queued.lifecycle.state !== "queued" || queued.runId !== snapshot.sourceRunId
      || queued.expectedVersion !== command.target.expectedVersion) throw new OcrReviewRefusedError();
    return snapshot;
  });
}

export function requireCurrentOcrSnapshot(repositories: AuthorityRepositories, reader: Pick<RunRecordService, "read">, candidate: unknown) {
  const reference = OcrApprovalReferenceSchema.parse(candidate);
  const review = readOcrReviewAuthority(repositories, reader, reference.sourceRunId);
  if (review === undefined || review.revision.revision !== reference.revision
    || review.run.envelope.contractFingerprint !== resolveWorkflowFingerprint(BUILD_MANIFEST, review.run.envelope.workflow)) throw new OcrReviewRefusedError();
  const snapshot = readOcrSnapshotsAuthority(repositories, review).find(snapshot => snapshot.snapshotId === reference.snapshotId);
  if (snapshot === undefined || snapshot.reviewDigest !== review.digest || ocrSnapshotDigest(snapshot) !== reference.digest) throw new OcrReviewRefusedError();
  return snapshot;
}

export function authenticateOcrSnapshotApproval(repositories: AuthorityRepositories, reader: Pick<RunRecordService, "read">, gate: OperatorGateResultRecord) {
  const retained = repositories.gateResults.get(`${gate.runId}:${gate.gateId}`);
  if (retained === undefined || !same(retained, gate) || gate.nodeId !== "approve-records" || gate.gateId !== "approve-records"
    || gate.resolvedBy !== "local-operator" || gate.result.schemaHash !== deriveSchemaHash(OcrApprovalReferenceSchema, "output")) throw new OcrReviewRefusedError();
  const reference = OcrApprovalReferenceSchema.parse(gate.result.value);
  if (reference.sourceRunId !== gate.runId || reference.snapshotId !== gate.commandId) throw new OcrReviewRefusedError();
  const snapshot = requireCurrentOcrSnapshot(repositories, reader, reference);
  if (snapshot.approvedBy !== gate.resolvedBy || snapshot.approvedAt !== gate.resolvedAt) throw new OcrReviewRefusedError();
  return snapshot;
}

export function assertOcrRecoverySnapshotCurrent(repositories: AuthorityRepositories, reader: Pick<RunRecordService, "read">, run: RunRecord): void {
  if (run.envelope.workflow !== "ocr") return;
  try {
    const ancestry = validateRunContinuation(repositories, run.envelope);
    const gate = repositories.gateResults.get(`${run.envelope.runId}:approve-records`)
      ?? readContinuationGate(repositories, run.envelope, "approve-records");
    if (gate === undefined) return;
    const reference = OcrApprovalReferenceSchema.parse(gate.result.value);
    if (gate.result.schemaHash !== deriveSchemaHash(OcrApprovalReferenceSchema, "output")
      || ![run, ...ancestry].some(source => source.envelope.runId === reference.sourceRunId)) throw new OcrReviewRefusedError();
    requireCurrentOcrSnapshot(repositories, reader, reference);
  } catch (cause) { throw new RunContinuationRefusedError("ocr-approved-snapshot-recovery-refused", { cause }); }
}
