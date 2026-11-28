import { DelegatedRecordBindingSchema, type DelegatedRecordBinding } from "../../../models/workflow/delegated-record.js";
import { delegationChildInputFingerprint } from "../../../models/workflow/delegation.js";
import { valueFreeProtectedData } from "../../../models/write-safety/protected-input.js";
import { OcrApprovalReferenceSchema, OcrResultSchema } from "../../../models/workflows/ocr/result.js";
import { OcrCanonicalInputSchema } from "../../../models/workflows/ocr/input.js";
import { PreManualOcrReviewCheckpointSchema, RetainedOcrReviewSeedSchema, RetainedOcrArtifactRosterSeedSchema,
  type OcrReviewSeed } from "../../../models/workflows/ocr/review-seed.js";
import { OcrPageWorkflowInputSchema } from "../../../models/workflows/ocr-page/input.js";
import { ReadOcrReviewSeed } from "../../../models/workflows/ocr/read-review-seed.js";
import { DelegationRefreshRequestSchema } from "../../storage/sqlite/delegation-contracts.js";
import { authenticateDelegationRefresh } from "../../storage/sqlite/delegation-refresh.js";
import { ReadOcrSourcePages } from "../../../models/workflows/ocr/read-source-pages.js";
import { QueueRecordMembersSchema, type QueueMemberTarget, type QueueRecordMembers } from "../../../models/dashboard/projection.js";
import { initialOcrReviewRecords, ocrRecordName, ocrSnapshotDigest } from "../../../models/ocr/review.js";
import { ocrRecordSourcePages } from "../../../models/ocr/review-record.js";
import { PersonLookupResultSchema } from "../../../models/workflows/person-lookup/result.js";
import { delegationEvidenceOutput } from "../../../models/run/result.js";
import { RetainedOcrPageAccountingSchema, RetainedOcrPageReadingSchema } from "../../../models/workflows/ocr/page-accounting.js";
import type { RunRecord } from "../../../models/run/record.js";
import { titleCasePersonName } from "../../../models/fields/cell-coercion.js";
import { deriveRunStatus, panelKindOf } from "../../../rules/runs/run-status.js";
import { directIdentifierDisplay } from "../../../rules/redaction/redaction.js";
import { LocalDateSchema } from "../../../rules/identity/ids.js";
import { searchPartitionDay } from "../../../models/dashboard/search-calendar.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-repositories.js";
import { childTerminalSettlement, readDelegationInvocationEvidence, readDelegationScopeEvidence } from "../../storage/sqlite/delegation-authority.js";
import { authenticateOcrOperator, readOcrReviewAuthority, readOcrReviewCheckpointSeed, readOcrSnapshotsAuthority } from "../lifecycle/ocr-review-authority.js";
import { OcrReviewRefusedError } from "../../processing/ocr/review-authority.js";
import type { RunRecordService } from "../lifecycle/run-record-service.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";
import { timelineCheckpointReference } from "../../../models/events/timeline.js";
import { deriveStableUuid } from "../../../rules/identity/identifiers.js";
import { checkpointLookupKey, type RunCheckpointRecord } from "../../../models/workflow/checkpoint.js";
import { descriptorRuntimeNodes, workflowDryRunSupport, type AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";

type AuthenticatedGroup = ReturnType<AuthorityRepositories["dependencies"]["authenticateGroup"]>;

const compactReviewHash = deriveSchemaHash(ReadOcrReviewSeed.output, "output");
const preManualCompactReviewHash = deriveSchemaHash(PreManualOcrReviewCheckpointSchema, "output");
const preManualRetainedReview = RetainedOcrReviewSeedSchema.safeExtend({
  accounting: RetainedOcrPageAccountingSchema.options[0],
  pages: PreManualOcrReviewCheckpointSchema.shape.pages,
});
const artifactRosterReviewSchemas = [
  RetainedOcrArtifactRosterSeedSchema,
  preManualRetainedReview.safeExtend({ roster: RetainedOcrArtifactRosterSeedSchema.shape.roster }),
];
const fullReviewSchemas = new Map(
  [RetainedOcrReviewSeedSchema, preManualRetainedReview, ...artifactRosterReviewSchemas]
    .map(schema => [deriveSchemaHash(schema, "output"), schema] as const),
);
const artifactRosterResults = new Map(artifactRosterReviewSchemas.map(review => [
  deriveSchemaHash(review, "output"),
  OcrResultSchema.extend({ review, identities: OcrResultSchema.shape.identities.element.options[0].array() }),
] as const));

function retainedField(value: unknown, field: string): unknown {
  if (value === null || typeof value !== "object" || !Object.hasOwn(value, field)) throw new OcrReviewRefusedError();
  return Reflect.get(value, field);
}

function originalCheckpoint(repositories: AuthorityRepositories, group: AuthenticatedGroup, nodeId: string) {
  const scope = readDelegationScopeEvidence(repositories, group.parent, group.invocation.scopeEvidence);
  if (sha256Hex(canonicalJsonStringify(valueFreeProtectedData(scope))) !== group.invocation.approvalDigest) throw new OcrReviewRefusedError();
  const sources = scope.filter(source => source.nodeId === nodeId && "checkpoint" in source);
  const source = sources[0];
  if (sources.length !== 1 || source === undefined || !("checkpoint" in source) || source.checkpoint === undefined) throw new OcrReviewRefusedError();
  return { checkpoint: source.checkpoint, scope };
}

function readingMember(repositories: AuthorityRepositories, owner: RunRecord, pages: AuthenticatedGroup,
  childRunIds: readonly string[], status: QueueRecordMembers["members"][number]["status"], workflowLabel: (workflowId: string) => string, reviewAvailable: boolean) {
  const prepared = ReadOcrSourcePages.output.parse(originalCheckpoint(repositories,pages,"read-source-pages").checkpoint.output.value);
  return { kind: "reading" as const, ownerRunId: owner.envelope.runId,
    title: `${prepared.manifest.pageCount} ${prepared.manifest.pageCount === 1 ? "page" : "pages"}`,
    status, statusLabel: status === "failed" ? "Failed" : status === "blocked" ? "Blocked" : status === "cancelled" ? "Cancelled" : "Reading",
    childRunIds, target: { runId: owner.envelope.runId, workflowId: owner.envelope.workflow,
      partitionDay: LocalDateSchema.parse(searchPartitionDay(new Date(owner.envelope.enqueuedAt))), label: workflowLabel(owner.envelope.workflow),
      status: deriveRunStatus({ ...owner,delegationWait: repositories.dependencies.waitState(owner.envelope.runId) }),
      panelKind: panelKindOf(owner.envelope.shape, reviewAvailable), section: "logs" as const } };
}

function runStatus(repositories: AuthorityRepositories, run: RunRecord) {
  return deriveRunStatus({ ...run, delegationWait: repositories.dependencies.waitState(run.envelope.runId) });
}

function runLink(repositories: AuthorityRepositories, run: RunRecord, workflowLabel: (workflowId: string) => string, reviewAvailable: boolean) {
  return { runId: run.envelope.runId, workflowId: run.envelope.workflow,
    partitionDay: LocalDateSchema.parse(searchPartitionDay(new Date(run.envelope.enqueuedAt))), label: workflowLabel(run.envelope.workflow),
    status: runStatus(repositories, run), panelKind: panelKindOf(run.envelope.shape, reviewAvailable) };
}

function pageFailureMembers(repositories: AuthorityRepositories, owner: RunRecord, pages: AuthenticatedGroup | undefined,
  link: (run: RunRecord) => Omit<Extract<QueueMemberTarget, { section: "logs" }>, "section">) {
  return (pages?.children ?? []).filter(member => runStatus(repositories, member.child) === "failed").map(member => {
    const input = OcrPageWorkflowInputSchema.parse(member.child.input.parsed.value);
    return { kind: "page-failure" as const, ownerRunId: owner.envelope.runId, sourcePage: input.page.sourcePage,
      title: `Page ${input.page.sourcePage}`, status: "failed" as const, statusLabel: "Failed", childRunIds: member.history,
      target: { ...link(member.child), section: "logs" as const } };
  });
}

function lookupReviewSeed(repositories: AuthorityRepositories, owner: RunRecord, { checkpoint, scope }: ReturnType<typeof originalCheckpoint>) {
  const { schemaHash, value } = checkpoint.output;
  if (schemaHash === compactReviewHash || schemaHash === preManualCompactReviewHash) {
    if (schemaHash === preManualCompactReviewHash && !PreManualOcrReviewCheckpointSchema.safeParse(value).success) {
      throw new OcrReviewRefusedError();
    }
    const seed = readOcrReviewCheckpointSeed(repositories, owner, value);
    const pages = scope.filter(source => source.nodeId === "read-pages");
    const receipt = pages[0]?.delegation;
    if (pages.length !== 1 || receipt === undefined) throw new OcrReviewRefusedError();
    const evidence = readDelegationInvocationEvidence(repositories, receipt.invocationCommandId, new Set(), receipt);
    if (canonicalJsonStringify(delegationEvidenceOutput(evidence, RetainedOcrPageReadingSchema))
      !== canonicalJsonStringify(seed.accounting.outcomes)) throw new OcrReviewRefusedError();
    return seed;
  }
  const full = fullReviewSchemas.get(schemaHash)?.safeParse(value);
  if (!full?.success || canonicalJsonStringify(full.data.roster) !== canonicalJsonStringify(retainedField(owner.input.parsed.value, "roster"))) {
    throw new OcrReviewRefusedError();
  }
  return full.data;
}

function assertPublishedCheckpoint(repositories: AuthorityRepositories, owner: RunRecord, nodeId: string, checkpoint: RunCheckpointRecord) {
  const publication = repositories.timelineEvents.get(deriveStableUuid("timeline-checkpoint-recorded",
    checkpointLookupKey(checkpoint.workflowId, checkpoint.itemId, checkpoint.nodeId, checkpoint.attempt, checkpoint.claimGeneration)));
  if (checkpoint.runId !== owner.envelope.runId || checkpoint.workflowId !== owner.envelope.workflow
    || checkpoint.itemId !== owner.envelope.itemId || checkpoint.nodeId !== nodeId || checkpoint.attempt !== owner.envelope.attempt
    || checkpoint.descriptorVersion !== owner.envelope.descriptorVersion || checkpoint.contractFingerprint !== owner.envelope.contractFingerprint
    || publication?.payload.kind !== "checkpoint-recorded" || publication.workflow !== checkpoint.workflowId
    || publication.scope.kind !== "run" || publication.scope.runId !== owner.envelope.runId || publication.occurredAt !== checkpoint.writtenAt
    || publication.payload.runId !== owner.envelope.runId || publication.payload.workflow !== checkpoint.workflowId
    || publication.payload.attempt !== checkpoint.attempt || publication.payload.claimGeneration !== checkpoint.claimGeneration
    || canonicalJsonStringify(publication.payload.checkpoint) !== canonicalJsonStringify(timelineCheckpointReference(checkpoint))) throw new OcrReviewRefusedError();
}

function artifactRosterAssociations(repositories: AuthorityRepositories, owner: RunRecord, group: AuthenticatedGroup,
  build: RunCheckpointRecord, seed: OcrReviewSeed) {
  const artifactRosterResult = artifactRosterResults.get(build.output.schemaHash);
  if (group.invocation.nodeId !== "lookup-identities" || artifactRosterResult === undefined
    || group.invocation.children.some(child => child.sourceRecordIds !== undefined)) throw new OcrReviewRefusedError();
  const results = repositories.runCheckpoints.listByAttempt(owner.envelope.workflow, owner.envelope.itemId, "read-result", owner.envelope.attempt)
    .filter(row => row.runId === owner.envelope.runId && row.claimGeneration >= build.claimGeneration);
  const [result] = results;
  if (results.length !== 1 || !result || result.output.schemaHash !== deriveSchemaHash(artifactRosterResult, "output")) throw new OcrReviewRefusedError();
  assertPublishedCheckpoint(repositories, owner, "read-result", result);
  const parsed = artifactRosterResult.safeParse(result.output.value);
  if (!parsed.success || canonicalJsonStringify(parsed.data.review) !== canonicalJsonStringify(seed)) throw new OcrReviewRefusedError();
  const identities = parsed.data.identities;
  const native = readDelegationInvocationEvidence(repositories, group.invocation.commandId);
  if (canonicalJsonStringify(identities.map(identity => identity.outcome)) !== canonicalJsonStringify(delegationEvidenceOutput(native, PersonLookupResultSchema))
    || identities.length !== group.children.length || identities.some((identity, index) =>
      canonicalJsonStringify(identity.input) !== canonicalJsonStringify(group.children[index].child.input.parsed.value))) throw new OcrReviewRefusedError();
  return identities;
}

function readOcrRecordSource(repositories: AuthorityRepositories, runId: string) {
  const owner = repositories.runs.get(runId);
  if (owner?.envelope.workflow !== "ocr") throw new OcrReviewRefusedError();
  const groups = repositories.dependencies.groups(runId);
  const currentIds = new Set(groups.map(({ manifest }) => manifest.manifestId));
  const retained = repositories.dependencies.groups(runId,"retained");
  const lookups = retained.filter(({ group }) => ["lookup-identities", "lookup-signers"].includes(group.invocation.nodeId)).map(({ group, manifest }) => {
    const source = originalCheckpoint(repositories,group,"build-review");
    const { checkpoint } = source;
    const seed = lookupReviewSeed(repositories, owner, source);
    if (seed.sourceRunId !== undefined && seed.sourceRunId !== owner.envelope.runId) throw new OcrReviewRefusedError();
    const family = group.invocation.nodeId === "lookup-identities" ? "person-lookup" : "i9-lookup";
    if (group.invocation.target.workflowId !== family) throw new OcrReviewRefusedError();
    const recordIds = new Set(seed.records.map(record => record.recordId));
    const associations = group.invocation.children.some(child => child.sourceRecordIds === undefined)
      ? artifactRosterAssociations(repositories, owner, group, checkpoint, seed) : undefined;
    const requests = group.children.map((member, index) => {
      const ids = group.invocation.children[index]?.sourceRecordIds ?? associations?.[index]?.recordIds;
      const input = member.child.input.parsed.value;
      if (ids === undefined || ids.length === 0 || !ids.every(id => recordIds.delete(id))
        || delegationChildInputFingerprint(input) !== member.entry.canonicalInputFingerprint) throw new OcrReviewRefusedError();
      return { member, lookup: { recordIds: ids, input, outcome: { itemId: member.child.envelope.itemId, runId: member.child.envelope.runId } } };
    });
    return { group,manifest,checkpoint,seed,requests };
  });
  const current = lookups.filter(({ manifest }) => currentIds.has(manifest.manifestId));
  if (current.length === 0) return undefined;
  if (new Set(current.map(({ group }) => group.invocation.nodeId)).size !== current.length) throw new OcrReviewRefusedError();
  const epoch = current.reduce((latest,entry) => entry.checkpoint.claimGeneration > latest.checkpoint.claimGeneration ? entry : latest);
  const seed = epoch.seed;
  if (current.some(entry => entry.checkpoint.claimGeneration === epoch.checkpoint.claimGeneration
    && canonicalJsonStringify(entry.seed) !== canonicalJsonStringify(seed))) throw new OcrReviewRefusedError();
  const selected = current.flatMap(entry => entry.requests.filter(({ lookup }) =>
    entry.checkpoint.claimGeneration === epoch.checkpoint.claimGeneration || lookup.recordIds.every(id => {
      const currentRecord = seed.records.find(record => record.recordId === id);
      const source = entry.seed.records.find(record => record.recordId === id);
      return currentRecord !== undefined && source !== undefined && canonicalJsonStringify(currentRecord) === canonicalJsonStringify(source);
    })));
  const bindings = selected.flatMap(({ lookup,member }) => lookup.recordIds.map(recordId => ({
    record: { runId: owner.envelope.runId,recordId }, currentChildRunId: member.child.envelope.runId,
    childRunIds: [...new Set([...lookups.flatMap(entry => entry.requests.filter(previous => previous.lookup.recordIds.includes(recordId)
      && previous.member.history.includes(member.child.envelope.runId)).flatMap(previous => previous.member.history)),...member.history])],
  })));
  const recordOrder = new Map(seed.records.map((record,index) => [record.recordId,index]));
  bindings.sort((left,right) => {
    const a = recordOrder.get(left.record.recordId), b = recordOrder.get(right.record.recordId);
    if (a === undefined || b === undefined) throw new OcrReviewRefusedError();
    return a-b;
  });
  return { seed,checkpoint: epoch.checkpoint,bindings: DelegatedRecordBindingSchema.array().parse(bindings),selected,lookups,groups,retained };
}

export function readOcrRecordBindings(repositories: AuthorityRepositories, runId: string): Readonly<{ seed: OcrReviewSeed; bindings: readonly DelegatedRecordBinding[] }> | undefined {
  const source = readOcrRecordSource(repositories,runId);
  return source === undefined ? undefined : { seed: source.seed,bindings: source.bindings };
}

export function endedUnfinished(run: RunRecord): boolean {
  return run.lifecycle.state === "terminal" && ["cancelled", "discarded", "superseded"].includes(run.lifecycle.outcome);
}

/** The OCR review a queue or run summary read offers for this run. A run that ended without finishing offers none, so its retained
 * revision is re-verified only when its review is opened, and a refusal there never fails the queue. */
export function offeredOcrReview(repositories: AuthorityRepositories, reader: Pick<RunRecordService, "read">,
  ocr: RunRecord): ReturnType<typeof readOcrReviewAuthority> {
  return endedUnfinished(ocr) ? undefined : readOcrReviewAuthority(repositories, reader, ocr.envelope.runId);
}

function readOcrRecordPresentation(repositories: AuthorityRepositories, reader: Pick<RunRecordService, "read">,
  runId: string, workflowLabel: (workflowId: string) => string, applyLookupVisibility: boolean): QueueRecordMembers | undefined {
  const existence = reader.read(runId);
  if (existence.state !== "present" || existence.disposition !== "live") throw new OcrReviewRefusedError();
  const owner = existence.run;
  if (owner.envelope.workflow !== "ocr") return undefined;
  authenticateOcrOperator(repositories, reader, owner);
  const reviewAuthority = offeredOcrReview(repositories, reader, owner);
  const statusOf = (run: RunRecord) => runStatus(repositories, run);
  const link = (run: RunRecord) => runLink(repositories, run, workflowLabel, run.envelope.runId === owner.envelope.runId && reviewAuthority !== undefined);
  const source = readOcrRecordSource(repositories, runId);
  const groups = source?.groups ?? repositories.dependencies.groups(runId);
  const lookups = groups.filter(({ group }) => ["lookup-identities", "lookup-signers"].includes(group.invocation.nodeId));
  const lookupChildren = new Map(lookups.flatMap(({ group, manifest }) => group.children.map(member => [member.child.envelope.runId, {
    child: member.child, visibility: manifest.policy.visibility,
  }] as const)));
  const pageGroups = groups.filter(({ group }) => group.invocation.nodeId === "read-pages");
  const pages = pageGroups[0];
  if (pageGroups.length > 1) throw new OcrReviewRefusedError();
  const covered = (source?.retained ?? repositories.dependencies.groups(runId,"retained")).filter(({ group }) => ["read-pages", "lookup-identities", "lookup-signers"].includes(group.invocation.nodeId));
  const runIds = [...new Set(covered.flatMap(({ group }) => group.children.flatMap(member => member.history)))];
  const failures = pageFailureMembers(repositories, owner, pages?.group, link);
  if (source === undefined) {
    if (pages === undefined) return undefined;
    return QueueRecordMembersSchema.parse({ runIds, members: [readingMember(repositories,owner,pages.group,
      pages.group.children.filter(member => statusOf(member.child) !== "failed").flatMap(member => member.history),statusOf(owner),workflowLabel,reviewAuthority !== undefined), ...failures] });
  }
  let review = reviewAuthority;
  if (review !== undefined && canonicalJsonStringify(review.revision.seed.review) !== canonicalJsonStringify(source.seed)) {
    authenticateDelegationRefresh(repositories,owner);
    const command = owner.delegationRefresh === undefined ? undefined : repositories.lifecycleJournal.getCommand(owner.delegationRefresh.commandId);
    if (command === undefined || !("kind" in command) || command.kind !== "run-lifecycle" || command.operation !== "delegation-refresh") throw new OcrReviewRefusedError();
    const refresh = DelegationRefreshRequestSchema.parse(command.request);
    const origin = repositories.ocrReviews.revision(runId,1)?.origin;
    if (refresh.phase !== "admit" || origin?.kind !== "checkpoint"
      || origin.checkpoint.claimGeneration > refresh.claimGeneration || source.checkpoint.claimGeneration <= refresh.claimGeneration
      || !source.lookups.some(entry => entry.checkpoint.claimGeneration <= refresh.claimGeneration
        && canonicalJsonStringify(entry.seed) === canonicalJsonStringify(review?.revision.seed.review))) throw new OcrReviewRefusedError();
    review = undefined;
  }
  const completed = review === undefined ? source.selected.flatMap(({ lookup,member }) => {
    const terminal = childTerminalSettlement(member.child,repositories);
    return terminal?.state !== "satisfied" ? [] : [OcrResultSchema.shape.identities.element.parse({ ...lookup,
      outcome: { ...lookup.outcome,state: "done",output: terminal.result.result.value } })];
  }) : [];
  const initial = new Map(initialOcrReviewRecords({ review: source.seed, identities: completed }).map(record => [record.recordId, record]));
  const requested = new Set(source.seed.records.filter(record => record.lookup.state === "required").map(record => record.recordId));
  const records = review === undefined ? source.seed.records : review.revision.records.map(record => ({ recordId: record.recordId,
    sourcePage: ocrRecordSourcePages(source.seed.records, record)[0], assertedEid: record.assertedEid }));
  const members = records.flatMap(record => {
    const bindings = source.bindings.filter(binding => binding.record.recordId === record.recordId);
    const children = bindings.map(binding => {
      const member = lookupChildren.get(binding.currentChildRunId);
      if (member === undefined) throw new OcrReviewRefusedError();
      return { ...member, status: statusOf(member.child) };
    });
    if (applyLookupVisibility && children.length > 0 && children.every(member => member.visibility === "linked"
      || member.visibility === "hidden-unless-failed" && member.status !== "failed")) return [];
    const selectedChild = children.find(member => member.status === "failed" || member.status === "blocked" || member.status === "cancelled")
      ?? children.find(member => member.status !== "done") ?? children[0];
    const child = selectedChild?.child, childStatus = selectedChild?.status;
    const current = review === undefined ? initial.get(record.recordId) : review.revision.records.find(current => current.recordId === record.recordId);
    if (current === undefined) throw new OcrReviewRefusedError();
    const pageMembers = ocrRecordSourcePages(source.seed.records, current).map(number => {
      const index = source.seed.accounting.manifest.pages.findIndex(page => page.sourcePage === number);
      const page = source.seed.accounting.outcomes[index];
      if (page === undefined || current.provenance === undefined && page.state !== "done") throw new OcrReviewRefusedError();
      const member = pages?.group.children.find(member => member.history.includes(page.runId));
      if (member === undefined) throw new OcrReviewRefusedError();
      return member;
    });
    const childRunIds = [...new Set([...pageMembers.flatMap(member => member.history), ...bindings.flatMap(binding => binding.childRunIds)])];
    const ref = { runId: owner.envelope.runId, recordId: record.recordId };
    const eid = current.assertedEid ?? (review === undefined ? record.assertedEid : null);
    const name = ocrRecordName(current.fields);
    const title = [name === null ? null : titleCasePersonName(name), eid === null ? null : `EID ${directIdentifierDisplay(eid)}`]
      .filter(part => part !== null).join(" · ") || `Page ${record.sourcePage}`;
    const pending = childStatus !== undefined && childStatus !== "done"
      || children.length === 0 && requested.has(record.recordId) && review === undefined;
    const status = current.discarded ? "cancelled" : childStatus === "failed" || childStatus === "blocked" || childStatus === "cancelled" ? childStatus
      : pending ? "running" : current.assertedEid !== null && current.provenance === undefined ? "done" : "awaiting-approval";
    const statusLabel = current.discarded ? "Not approved" : status === "failed" ? "Failed" : status === "blocked" ? "Blocked"
      : status === "cancelled" ? "Cancelled" : status === "running" ? "Looking up" : status === "done" ? "Verified"
        : current.provenance !== undefined ? current.assertedEid === null ? "Needs review" : "Ready" : "Needs lookup";
    const target: QueueMemberTarget = review !== undefined && status !== "failed" && status !== "blocked"
      ? { ...link(owner), panelKind: "review", section: "review", record: ref }
      : { ...link(child ?? owner), section: "logs" };
    return [{ kind: "record" as const, record: ref, title, status, statusLabel, childRunIds, target }];
  });
  return QueueRecordMembersSchema.parse({ runIds, members: [...members, ...failures] });
}

export function readOcrQueueMembers(repositories: AuthorityRepositories, reader: Pick<RunRecordService, "read">,
  runId: string, workflowLabel: (workflowId: string) => string): QueueRecordMembers | undefined {
  return readOcrRecordPresentation(repositories,reader,runId,workflowLabel,true);
}

/** An open member's own delegated child that failed or is held on an unsure write: the person reads that state and their line opens that child's logs. */
function heldMemberChild(repositories: AuthorityRepositories, member: RunRecord) {
  if (member.lifecycle.state === "terminal") return undefined;
  for (const { group } of repositories.dependencies.groups(member.envelope.runId)) for (const child of group.children) {
    const status = deriveRunStatus({ ...child.child,delegationWait: repositories.dependencies.waitState(child.child.envelope.runId) });
    if (status === "failed" || status === "blocked") return { run: child.child, status, history: child.history };
  }
  return undefined;
}

function approvedParentMembers(repositories: AuthorityRepositories, reader: Pick<RunRecordService, "read">,
  parent: RunRecord, source: QueueRecordMembers, approval: unknown, resolve: (workflowId: string) => AnyWorkflowDescriptor | undefined) {
  const reference = OcrApprovalReferenceSchema.parse(approval);
  const review = readOcrReviewAuthority(repositories,reader,reference.sourceRunId);
  if (review === undefined) throw new OcrReviewRefusedError();
  const snapshot = readOcrSnapshotsAuthority(repositories,review).find(snapshot => snapshot.snapshotId === reference.snapshotId);
  if (snapshot === undefined || snapshot.sourceRunId !== reference.sourceRunId || snapshot.revision !== reference.revision
    || ocrSnapshotDigest(snapshot) !== reference.digest) throw new OcrReviewRefusedError();
  const groups = repositories.dependencies.groups(parent.envelope.runId)
    .filter(({ group }) => group.invocation.nodeId === "members" && group.invocation.edgeId === "approved-records");
  if (groups.length > 1) throw new OcrReviewRefusedError();
  const group = groups[0]?.group;
  const bound = new Map<string, NonNullable<typeof group>["children"][number]>();
  if (group !== undefined) {
    const { checkpoint } = originalCheckpoint(repositories,group,"approved-records");
    assertPublishedCheckpoint(repositories, parent, "approved-records", checkpoint);
    if (canonicalJsonStringify(retainedField(checkpoint.output.value, "snapshot")) !== canonicalJsonStringify(snapshot)) throw new OcrReviewRefusedError();
    for (const [index, member] of group.children.entries()) {
      const input = member.child.input.parsed.value;
      const memberRecord = retainedField(input, "record");
      const recordId = retainedField(memberRecord, "recordId");
      const record = snapshot.records.find(record => record.recordId === recordId);
      if (record === undefined || canonicalJsonStringify(retainedField(input, "approval")) !== canonicalJsonStringify(approval)
        || canonicalJsonStringify(memberRecord) !== canonicalJsonStringify(record)
        || group.invocation.children[index]?.sourceRecordIds !== undefined
          && canonicalJsonStringify(group.invocation.children[index]?.sourceRecordIds) !== canonicalJsonStringify([record.recordId])
        || bound.has(record.recordId)) throw new OcrReviewRefusedError();
      bound.set(record.recordId,member);
    }
  }
  const selected = new Set(group === undefined ? snapshot.selectedRecordIds : bound.keys());
  const held = new Map([...bound].flatMap(([recordId,member]) => {
    const child = heldMemberChild(repositories,member.child);
    return child === undefined ? [] : [[recordId,child] as const];
  }));
  const runIds = [...new Set([...source.runIds,...[...bound.values()].flatMap(member => member.history),...[...held.values()].flatMap(child => child.history)])];
  return QueueRecordMembersSchema.parse({ runIds, members: source.members.filter(row => {
    const member = row.kind === "record" ? bound.get(row.record.recordId) : undefined;
    if (member === undefined || group === undefined) return true;
    const visibility = group.invocation.policy.visibility;
    return visibility === "inline" || visibility === "hidden-unless-failed"
      && deriveRunStatus({ ...member.child,delegationWait: repositories.dependencies.waitState(member.child.envelope.runId) }) === "failed";
  }).map(row => {
    if (row.kind !== "record") return row;
    if (!selected.has(row.record.recordId)) return { ...row, status: "cancelled", statusLabel: "Not approved" };
    const member = bound.get(row.record.recordId);
    if (member === undefined) {
      const status = deriveRunStatus({ ...parent,delegationWait: repositories.dependencies.waitState(parent.envelope.runId) });
      if (status === "done") return { ...row, status: "cancelled", statusLabel: "Skipped" };
      return { ...row, status: ["failed","blocked","cancelled"].includes(status) ? status : "running",
        statusLabel: status === "failed" ? "Failed" : status === "blocked" ? "Blocked" : status === "cancelled" ? "Cancelled" : parent.envelope.dryRun ? "Previewing" : "Saving" };
    }
    const waiting = held.get(row.record.recordId);
    if (waiting !== undefined) {
      const run = waiting.run;
      return { ...row, status: waiting.status, statusLabel: waiting.status === "failed" ? "Failed" : "Blocked",
        childRunIds: [...new Set([...row.childRunIds,...member.history,...waiting.history])],
        target: { runId: run.envelope.runId, workflowId: run.envelope.workflow,
          partitionDay: LocalDateSchema.parse(searchPartitionDay(new Date(run.envelope.enqueuedAt))), label: resolve(run.envelope.workflow)?.label ?? run.envelope.workflow,
          status: waiting.status, panelKind: panelKindOf(run.envelope.shape, false), section: "logs" } };
    }
    const child = member.child, descriptor = resolve(child.envelope.workflow);
    const exactDescriptor = descriptor?.version === child.envelope.descriptorVersion
      && descriptor.contractFingerprint === child.envelope.contractFingerprint;
    const support = exactDescriptor ? workflowDryRunSupport(descriptor) : undefined;
    const readOnly = support?.state === "unsupported" && support.reason === "no-transaction-node";
    const status = deriveRunStatus({ ...child,delegationWait: repositories.dependencies.waitState(child.envelope.runId) });
    const terminal = member.terminal;
    if (status === "done" && terminal?.state !== "satisfied") throw new OcrReviewRefusedError();
    const omittedWrite = child.envelope.workflow === "emergency-contact-member"
      && child.envelope.stepOmissions?.some(({ workflow, step }) => workflow === undefined && (step === "contact-preview" || step === "onbase-filing")) === true;
    const statusLabel = status === "failed" ? "Failed" : status === "blocked" ? "Blocked" : status === "cancelled" ? "Cancelled"
      : terminal?.state === "satisfied" ? terminal.kind === "preview" ? "Previewed" : omittedWrite ? "Done outside Relay"
        : !exactDescriptor ? "Done" : readOnly ? "Verified" : "Saved"
      : !exactDescriptor ? "Running" : readOnly ? "Looking up" : child.envelope.dryRun ? "Previewing" : "Saving";
    return { ...row, status: status === "done" || status === "failed" || status === "blocked" || status === "cancelled" ? status : "running", statusLabel,
      childRunIds: [...new Set([...row.childRunIds,...member.history])],
      target: { runId: child.envelope.runId, workflowId: child.envelope.workflow,
        partitionDay: LocalDateSchema.parse(searchPartitionDay(new Date(child.envelope.enqueuedAt))), label: descriptor?.label ?? child.envelope.workflow,
        status, panelKind: panelKindOf(child.envelope.shape, false), section: "logs" } };
  }) });
}

export function hostedOcrRun(repositories: AuthorityRepositories, host: RunRecord): RunRecord | undefined {
  if (host.envelope.workflow === "ocr" || !repositories.runs.listChildren(host.envelope.runId).some(child => child.envelope.workflow === "ocr")) return undefined;
  const hosted = repositories.dependencies.groups(host.envelope.runId).filter(({ manifest }) => manifest.policy.visibility !== "inline")
    .flatMap(({ group }) => group.children.filter(member => member.child.envelope.workflow === "ocr"));
  return hosted.length === 1 ? hosted[0]?.child : undefined;
}

export function ocrHostRun(repositories: AuthorityRepositories, ocr: RunRecord): RunRecord | undefined {
  const hostId = ocr.envelope.workflow === "ocr" ? ocr.envelope.parent?.runId : undefined;
  const host = hostId === undefined ? undefined : repositories.runs.get(hostId);
  return host !== undefined && hostedOcrRun(repositories, host)?.envelope.runId === ocr.envelope.runId ? host : undefined;
}

export function readQueueRecordMembers(repositories: AuthorityRepositories, reader: Pick<RunRecordService, "read">,
  run: RunRecord, children: readonly RunRecord[], resolve: (workflowId: string) => AnyWorkflowDescriptor | undefined): QueueRecordMembers | undefined {
  const workflowLabel = (id: string) => resolve(id)?.label ?? id;
  if (run.envelope.workflow === "ocr") return readOcrQueueMembers(repositories, reader, run.envelope.runId, workflowLabel);
  if (!children.some(child => child.envelope.workflow === "ocr") && run.envelope.continuation === undefined) return undefined;
  const sources = repositories.dependencies.groups(run.envelope.runId)
    .filter(({ manifest }) => manifest.policy.visibility !== "inline")
    .flatMap(({ group }) => group.children.filter(member => member.child.envelope.workflow === "ocr")
      .flatMap(member => {
        const approval = member.terminal?.state === "satisfied" && member.terminal.kind === "ordinary"
          ? OcrApprovalReferenceSchema.nullable().parse(retainedField(member.terminal.result.result.value, "approvedSnapshot")) : null;
        if (approval !== null && approval.sourceRunId !== member.child.envelope.runId) throw new OcrReviewRefusedError();
        if (OcrCanonicalInputSchema.shape.approval.parse(retainedField(member.child.input.parsed.value, "approval")) === "release" && approval === null) {
          authenticateOcrOperator(repositories,reader,member.child);
          const groups = repositories.dependencies.groups(member.child.envelope.runId);
          const pages = groups.filter(({ group }) => group.invocation.nodeId === "read-pages");
          if (pages.length > 1) throw new OcrReviewRefusedError();
          if (pages[0] === undefined) return [];
          const runIds = [...new Set(groups.flatMap(({ group }) => group.children.flatMap(child => child.history)))];
          // A failed page stays on the host's row with its own Logs; once no page is left reading, nothing says Reading.
          const failures = pageFailureMembers(repositories, member.child, pages[0].group, page => runLink(repositories, page, workflowLabel, false));
          const failed = new Set(failures.flatMap(failure => failure.childRunIds));
          const reading = failures.length < pages[0].group.children.length
            ? [readingMember(repositories,member.child,pages[0].group,runIds.filter(id => !failed.has(id)),runStatus(repositories, run),workflowLabel,
              !endedUnfinished(run) && offeredOcrReview(repositories, reader, member.child) !== undefined)] : [];
          return [QueueRecordMembersSchema.parse({ runIds, members: [...reading, ...failures] })];
        }
        const descriptor = resolve(run.envelope.workflow);
        const hasMembers = repositories.dependencies.groups(run.envelope.runId)
          .some(({ group }) => group.invocation.nodeId === "members" && group.invocation.edgeId === "approved-records")
          || descriptor?.version === run.envelope.descriptorVersion && descriptor.contractFingerprint === run.envelope.contractFingerprint
            && descriptorRuntimeNodes(descriptor).some(node => node.kind === "child-run" && node.id === "members" && node.edgeId === "approved-records");
        const source = readOcrRecordPresentation(repositories, reader, member.child.envelope.runId, workflowLabel,!hasMembers);
        if (source === undefined) return [];
        return [approval !== null && hasMembers ? approvedParentMembers(repositories,reader,run,source,approval,resolve) : source];
      }));
  return sources.length === 0 ? undefined : QueueRecordMembersSchema.parse({
    runIds: [...new Set(sources.flatMap(source => source.runIds))], members: sources.flatMap(source => source.members),
  });
}
