import { DelegatedRecordBindingSchema, type DelegatedRecordBinding } from "../../../models/workflow/delegated-record.js";
import { delegationChildInputFingerprint } from "../../../models/workflow/delegation.js";
import { valueFreeProtectedData } from "../../../models/write-safety/protected-input.js";
import { bindOcrLookupOutcomes, ocrLookupRequests } from "../../../models/workflows/ocr/lookup.js";
import { OcrResultSchema, OcrWorkflowResultSchema } from "../../../models/workflows/ocr/result.js";
import { OcrCanonicalInputSchema } from "../../../models/workflows/ocr/input.js";
import { OcrReviewSeedSchema, type OcrReviewSeed } from "../../../models/workflows/ocr/review-seed.js";
import { OcrPageWorkflowInputSchema } from "../../../models/workflows/ocr-page/input.js";
import { ReadOcrSourcePages } from "../../../models/workflows/ocr/read-source-pages.js";
import { QueueRecordMembersSchema, type QueueMemberTarget, type QueueRecordMembers } from "../../../models/dashboard/projection.js";
import { initialOcrReviewRecords, ocrRecordName } from "../../../models/ocr/review.js";
import type { RunRecord } from "../../../models/run/record.js";
import { titleCasePersonName } from "../../../models/fields/cell-coercion.js";
import { deriveRunStatus, panelKindOf } from "../../../rules/runs/run-status.js";
import { LocalDateSchema } from "../../../rules/identity/ids.js";
import { localDatePart } from "../../../rules/time/clock.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";
import { childTerminalSettlement, readDelegationScopeEvidence } from "../../storage/sqlite/delegation-authority.js";
import { authenticateOcrOperator, readOcrReviewAuthority, requireCurrentOcrSnapshot } from "../lifecycle/ocr-review-authority.js";
import { OcrReviewRefusedError } from "../../processing/ocr/review-authority.js";
import type { RunRecordService } from "../lifecycle/run-record-service.js";
import { ReadApprovedOcrSnapshot } from "../../../models/processing/ocr/read-approved-snapshot.js";
import { ApprovedOcrRecordInputSchema } from "../../../models/workflows/ocr/approved-record.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";
import { descriptorRuntimeNodes, workflowDryRunSupport, type AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";

type AuthenticatedGroup = ReturnType<AuthorityRepositories["dependencies"]["authenticateGroup"]>;

function originalCheckpoint(repositories: AuthorityRepositories, group: AuthenticatedGroup, nodeId: string) {
  const scope = readDelegationScopeEvidence(repositories, group.parent, group.invocation.scopeEvidence);
  if (sha256Hex(canonicalJsonStringify(valueFreeProtectedData(scope))) !== group.invocation.approvalDigest) throw new OcrReviewRefusedError();
  const sources = scope.filter(source => source.nodeId === nodeId && "checkpoint" in source);
  const source = sources[0];
  if (sources.length !== 1 || source === undefined || !("checkpoint" in source) || source.checkpoint === undefined) throw new OcrReviewRefusedError();
  return source.checkpoint;
}

function readingMember(repositories: AuthorityRepositories, owner: RunRecord, pages: AuthenticatedGroup,
  childRunIds: readonly string[], status: QueueRecordMembers["members"][number]["status"], workflowLabel: (workflowId: string) => string) {
  const prepared = ReadOcrSourcePages.output.parse(originalCheckpoint(repositories,pages,"read-source-pages").output.value);
  return { kind: "reading" as const, ownerRunId: owner.envelope.runId,
    title: `${prepared.manifest.pageCount} ${prepared.manifest.pageCount === 1 ? "page" : "pages"}`,
    status, statusLabel: status === "failed" ? "Failed" : status === "blocked" ? "Blocked" : status === "cancelled" ? "Cancelled" : "Reading",
    childRunIds, target: { runId: owner.envelope.runId, workflowId: owner.envelope.workflow,
      partitionDay: LocalDateSchema.parse(localDatePart(new Date(owner.envelope.enqueuedAt))), label: workflowLabel(owner.envelope.workflow),
      status: deriveRunStatus({ ...owner,delegationWait: repositories.dependencies.waitState(owner.envelope.runId) }),
      panelKind: panelKindOf(owner.envelope.shape), section: "logs" as const } };
}

export function readOcrRecordBindings(repositories: AuthorityRepositories, runId: string): Readonly<{ seed: OcrReviewSeed; bindings: readonly DelegatedRecordBinding[] }> | undefined {
  const owner = repositories.runs.get(runId);
  if (owner?.envelope.workflow !== "ocr") throw new OcrReviewRefusedError();
  const groups = repositories.dependencies.groups(runId).filter(({ group }) => ["lookup-identities", "lookup-signers"].includes(group.invocation.nodeId));
  if (groups.length === 0) return undefined;
  if (new Set(groups.map(({ group }) => group.invocation.nodeId)).size !== groups.length) throw new OcrReviewRefusedError();
  const seeds = groups.map(({ group }) => OcrReviewSeedSchema.parse(originalCheckpoint(repositories, group, "build-review").output.value));
  const seed = seeds[0];
  if (seed === undefined || seeds.some(other => canonicalJsonStringify(other) !== canonicalJsonStringify(seed))
    || seed.sourceRunId !== undefined && seed.sourceRunId !== owner.envelope.runId) throw new OcrReviewRefusedError();
  const bindings = groups.flatMap(({ group }) => {
    const family = group.invocation.nodeId === "lookup-identities" ? "person-lookup" : "i9-lookup";
    if (group.invocation.target.workflowId !== family) throw new OcrReviewRefusedError();
    const lookups = bindOcrLookupOutcomes(seed, group.children.map(member => ({
      itemId: member.child.envelope.itemId, runId: member.child.envelope.runId,
    })), family);
    return lookups.flatMap((lookup, index) => {
      const member = group.children[index];
      if (member === undefined || delegationChildInputFingerprint(lookup.input) !== member.entry.canonicalInputFingerprint) throw new OcrReviewRefusedError();
      return lookup.recordIds.map(recordId => ({ record: { runId: owner.envelope.runId, recordId },
        childRunIds: member.history, currentChildRunId: member.child.envelope.runId }));
    });
  });
  const recordOrder = new Map(seed.records.map((record, index) => [record.recordId, index]));
  bindings.sort((left, right) => {
    const a = recordOrder.get(left.record.recordId), b = recordOrder.get(right.record.recordId);
    if (a === undefined || b === undefined) throw new OcrReviewRefusedError();
    return a - b;
  });
  return { seed, bindings: DelegatedRecordBindingSchema.array().parse(bindings) };
}

function readOcrRecordPresentation(repositories: AuthorityRepositories, reader: Pick<RunRecordService, "read">,
  runId: string, workflowLabel: (workflowId: string) => string, applyLookupVisibility: boolean): QueueRecordMembers | undefined {
  const existence = reader.read(runId);
  if (existence.state !== "present" || existence.disposition !== "live") throw new OcrReviewRefusedError();
  const owner = existence.run;
  if (owner.envelope.workflow !== "ocr") return undefined;
  authenticateOcrOperator(repositories, reader, owner);
  const statusOf = (run: RunRecord) => deriveRunStatus({ ...run, delegationWait: repositories.dependencies.waitState(run.envelope.runId) });
  const link = (run: RunRecord) => ({ runId: run.envelope.runId, workflowId: run.envelope.workflow,
    partitionDay: LocalDateSchema.parse(localDatePart(new Date(run.envelope.enqueuedAt))), label: workflowLabel(run.envelope.workflow),
    status: statusOf(run), panelKind: panelKindOf(run.envelope.shape) });
  const source = readOcrRecordBindings(repositories, runId);
  const groups = repositories.dependencies.groups(runId);
  const lookups = groups.filter(({ group }) => ["lookup-identities", "lookup-signers"].includes(group.invocation.nodeId));
  const lookupChildren = new Map(lookups.flatMap(({ group, manifest }) => group.children.map(member => [member.child.envelope.runId, {
    child: member.child, visibility: manifest.policy.visibility,
  }] as const)));
  const pageGroups = groups.filter(({ group }) => group.invocation.nodeId === "read-pages");
  const pages = pageGroups[0];
  if (pageGroups.length > 1) throw new OcrReviewRefusedError();
  const covered = groups.filter(({ group }) => ["read-pages", "lookup-identities", "lookup-signers"].includes(group.invocation.nodeId));
  const runIds = [...new Set(covered.flatMap(({ group }) => group.children.flatMap(member => member.history)))];
  const failures = (pages?.group.children ?? []).filter(member => statusOf(member.child) === "failed").map(member => {
    const input = OcrPageWorkflowInputSchema.parse(member.child.input.parsed.value);
    return { kind: "page-failure" as const, ownerRunId: owner.envelope.runId, sourcePage: input.page.sourcePage,
      title: `Page ${input.page.sourcePage}`, status: "failed" as const, statusLabel: "Failed", childRunIds: member.history,
      target: { ...link(member.child), section: "logs" as const } };
  });
  if (source === undefined) {
    if (pages === undefined) return undefined;
    return QueueRecordMembersSchema.parse({ runIds, members: [readingMember(repositories,owner,pages.group,
      pages.group.children.filter(member => statusOf(member.child) !== "failed").flatMap(member => member.history),statusOf(owner),workflowLabel), ...failures] });
  }
  const review = readOcrReviewAuthority(repositories, reader, runId);
  const completed = review === undefined ? lookups.flatMap(({ group }) => bindOcrLookupOutcomes(source.seed, group.children.map(member => ({
    itemId: member.child.envelope.itemId, runId: member.child.envelope.runId,
  })), group.invocation.nodeId === "lookup-identities" ? "person-lookup" : "i9-lookup").flatMap((lookup, index) => {
    const member = group.children[index];
    if (member === undefined) throw new OcrReviewRefusedError();
    const terminal = childTerminalSettlement(member.child, repositories);
    return terminal?.state !== "satisfied" ? [] : [OcrResultSchema.shape.identities.element.parse({ ...lookup,
      outcome: { ...lookup.outcome, state: "done", output: terminal.result.result.value } })];
  })) : [];
  const initial = new Map(initialOcrReviewRecords({ review: source.seed, identities: completed }).map(record => [record.recordId, record]));
  const requested = new Set(ocrLookupRequests(source.seed).flatMap(request => request.recordIds));
  const members = source.seed.records.flatMap(record => {
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
    const page = source.seed.accounting.outcomes[record.sourcePage - 1];
    if (page?.state !== "done") throw new OcrReviewRefusedError();
    const pageMember = pages?.group.children.find(member => member.history.includes(page.runId));
    if (pageMember === undefined) throw new OcrReviewRefusedError();
    const childRunIds = [...new Set([...pageMember.history, ...bindings.flatMap(binding => binding.childRunIds)])];
    const ref = { runId: owner.envelope.runId, recordId: record.recordId };
    const eid = current.assertedEid ?? (review === undefined ? record.assertedEid : null);
    const name = ocrRecordName(current.fields);
    const title = [name === null ? null : titleCasePersonName(name), eid === null ? null : `EID ${eid}`]
      .filter(part => part !== null).join(" · ") || `Page ${record.sourcePage}`;
    const pending = childStatus !== undefined && childStatus !== "done"
      || children.length === 0 && requested.has(record.recordId) && review === undefined;
    const status = current.discarded ? "cancelled" : childStatus === "failed" || childStatus === "blocked" || childStatus === "cancelled" ? childStatus
      : pending ? "running" : current.assertedEid !== null ? "done" : "awaiting-approval";
    const statusLabel = current.discarded ? "Not approved" : status === "failed" ? "Failed" : status === "blocked" ? "Blocked"
      : status === "cancelled" ? "Cancelled" : status === "running" ? "Looking up" : status === "done" ? "Verified" : "Needs lookup";
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

function approvedParentMembers(repositories: AuthorityRepositories, reader: Pick<RunRecordService, "read">,
  parent: RunRecord, source: QueueRecordMembers, approval: unknown, resolve: (workflowId: string) => AnyWorkflowDescriptor | undefined) {
  const snapshot = requireCurrentOcrSnapshot(repositories,reader,approval);
  const groups = repositories.dependencies.groups(parent.envelope.runId)
    .filter(({ group }) => group.invocation.nodeId === "members" && group.invocation.edgeId === "approved-records");
  if (groups.length > 1) throw new OcrReviewRefusedError();
  const group = groups[0]?.group;
  const bound = new Map<string, NonNullable<typeof group>["children"][number]>();
  if (group !== undefined) {
    const checkpoint = originalCheckpoint(repositories,group,"approved-records");
    if (checkpoint.output.schemaHash !== deriveSchemaHash(ReadApprovedOcrSnapshot.output,"output")
      || canonicalJsonStringify(ReadApprovedOcrSnapshot.output.parse(checkpoint.output.value).snapshot) !== canonicalJsonStringify(snapshot)) throw new OcrReviewRefusedError();
    for (const [index, member] of group.children.entries()) {
      const input = member.child.input.parsed.value;
      if (typeof input !== "object" || input === null) throw new OcrReviewRefusedError();
      const memberApproval: unknown = Reflect.get(input,"approval"), memberRecord: unknown = Reflect.get(input,"record");
      const approved = ApprovedOcrRecordInputSchema.parse({ approval: memberApproval, record: memberRecord });
      const record = snapshot.records.find(record => record.recordId === approved.record.recordId);
      if (record === undefined || canonicalJsonStringify(approved.approval) !== canonicalJsonStringify(approval)
        || canonicalJsonStringify(approved.record) !== canonicalJsonStringify(record)
        || canonicalJsonStringify(group.invocation.children[index]?.sourceRecordIds) !== canonicalJsonStringify([record.recordId])
        || bound.has(record.recordId)) throw new OcrReviewRefusedError();
      bound.set(record.recordId,member);
    }
  }
  const selected = new Set(group === undefined ? snapshot.selectedRecordIds : bound.keys());
  const runIds = [...new Set([...source.runIds,...[...bound.values()].flatMap(member => member.history)])];
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
      return { ...row, status: ["failed","blocked","cancelled"].includes(status) ? status : "running",
        statusLabel: status === "failed" ? "Failed" : status === "blocked" ? "Blocked" : status === "cancelled" ? "Cancelled" : parent.envelope.dryRun ? "Previewing" : "Saving" };
    }
    const child = member.child, descriptor = resolve(child.envelope.workflow);
    if (descriptor === undefined || descriptor.version !== child.envelope.descriptorVersion
      || descriptor.contractFingerprint !== child.envelope.contractFingerprint) throw new OcrReviewRefusedError();
    const support = workflowDryRunSupport(descriptor);
    const readOnly = support.state === "unsupported" && support.reason === "no-transaction-node";
    const status = deriveRunStatus({ ...child,delegationWait: repositories.dependencies.waitState(child.envelope.runId) });
    const terminal = member.terminal;
    if (status === "done" && terminal?.state !== "satisfied") throw new OcrReviewRefusedError();
    const statusLabel = status === "failed" ? "Failed" : status === "blocked" ? "Blocked" : status === "cancelled" ? "Cancelled"
      : terminal?.state === "satisfied" ? terminal.kind === "preview" ? "Previewed" : readOnly ? "Verified" : "Saved"
      : readOnly ? "Looking up" : child.envelope.dryRun ? "Previewing" : "Saving";
    return { ...row, status: status === "done" || status === "failed" || status === "blocked" || status === "cancelled" ? status : "running", statusLabel,
      childRunIds: [...new Set([...row.childRunIds,...member.history])],
      target: { runId: child.envelope.runId, workflowId: child.envelope.workflow,
        partitionDay: LocalDateSchema.parse(localDatePart(new Date(child.envelope.enqueuedAt))), label: descriptor.label,
        status, panelKind: panelKindOf(child.envelope.shape), section: "logs" } };
  }) });
}

export function readQueueRecordMembers(repositories: AuthorityRepositories, reader: Pick<RunRecordService, "read">,
  run: RunRecord, children: readonly RunRecord[], resolve: (workflowId: string) => AnyWorkflowDescriptor | undefined): QueueRecordMembers | undefined {
  const workflowLabel = (id: string) => resolve(id)?.label ?? id;
  if (run.envelope.workflow === "ocr") return readOcrQueueMembers(repositories, reader, run.envelope.runId, workflowLabel);
  if (!children.some(child => child.envelope.workflow === "ocr") && run.envelope.continuation === undefined) return undefined;
  const sources = repositories.dependencies.groups(run.envelope.runId)
    .filter(({ manifest }) => manifest.policy.visibility === "linked")
    .flatMap(({ group }) => group.children.filter(member => member.child.envelope.workflow === "ocr")
      .flatMap(member => {
        const approval = member.terminal?.state === "satisfied" && member.terminal.kind === "ordinary"
          ? OcrWorkflowResultSchema.parse(member.terminal.result.result.value).approvedSnapshot : null;
        if (OcrCanonicalInputSchema.parse(member.child.input.parsed.value).approval === "release" && approval === null) {
          authenticateOcrOperator(repositories,reader,member.child);
          const groups = repositories.dependencies.groups(member.child.envelope.runId);
          const pages = groups.filter(({ group }) => group.invocation.nodeId === "read-pages");
          if (pages.length > 1) throw new OcrReviewRefusedError();
          if (pages[0] === undefined) return [];
          const runIds = [...new Set(groups.flatMap(({ group }) => group.children.flatMap(child => child.history)))];
          const status = deriveRunStatus({ ...run,delegationWait: repositories.dependencies.waitState(run.envelope.runId) });
          return [QueueRecordMembersSchema.parse({ runIds, members: [readingMember(repositories,member.child,pages[0].group,runIds,status,workflowLabel)] })];
        }
        const descriptor = resolve(run.envelope.workflow);
        if (descriptor === undefined || descriptor.version !== run.envelope.descriptorVersion
          || descriptor.contractFingerprint !== run.envelope.contractFingerprint) throw new OcrReviewRefusedError();
        const hasMembers = descriptorRuntimeNodes(descriptor)
          .some(node => node.kind === "child-run" && node.id === "members" && node.edgeId === "approved-records");
        const source = readOcrRecordPresentation(repositories, reader, member.child.envelope.runId, workflowLabel,!hasMembers);
        if (source === undefined) return [];
        return [approval !== null && hasMembers ? approvedParentMembers(repositories,reader,run,source,approval,resolve) : source];
      }));
  return sources.length === 0 ? undefined : QueueRecordMembersSchema.parse({
    runIds: [...new Set(sources.flatMap(source => source.runIds))], members: sources.flatMap(source => source.members),
  });
}
