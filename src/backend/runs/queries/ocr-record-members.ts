import { DelegatedRecordBindingSchema, type DelegatedRecordBinding } from "../../../models/workflow/delegated-record.js";
import { delegationChildInputFingerprint } from "../../../models/workflow/delegation.js";
import { valueFreeProtectedData } from "../../../models/write-safety/protected-input.js";
import { bindOcrLookupOutcomes } from "../../../models/workflows/ocr/lookup.js";
import { OcrReviewSeedSchema, type OcrReviewSeed } from "../../../models/workflows/ocr/review-seed.js";
import { OcrPageWorkflowInputSchema } from "../../../models/workflows/ocr-page/input.js";
import { ReadOcrSourcePages } from "../../../models/workflows/ocr/read-source-pages.js";
import { QueueRecordMembersSchema, type QueueMemberTarget, type QueueRecordMembers } from "../../../models/dashboard/projection.js";
import { ocrRecordName } from "../../../models/ocr/review.js";
import type { RunRecord } from "../../../models/run/record.js";
import { titleCasePersonName } from "../../../models/fields/cell-coercion.js";
import { deriveRunStatus, panelKindOf } from "../../../rules/runs/run-status.js";
import { LocalDateSchema } from "../../../rules/identity/ids.js";
import { localDatePart } from "../../../rules/time/clock.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";
import { readDelegationScopeEvidence } from "../../storage/sqlite/delegation-authority.js";
import { authenticateOcrOperator, readOcrReviewAuthority } from "../lifecycle/ocr-review-authority.js";
import { OcrReviewRefusedError } from "../../processing/ocr/review-authority.js";
import type { RunRecordService } from "../lifecycle/run-record-service.js";

type AuthenticatedGroup = ReturnType<AuthorityRepositories["dependencies"]["authenticateGroup"]>;

function originalCheckpoint(repositories: AuthorityRepositories, group: AuthenticatedGroup, nodeId: string) {
  const scope = readDelegationScopeEvidence(repositories, group.parent, group.invocation.scopeEvidence);
  if (sha256Hex(canonicalJsonStringify(valueFreeProtectedData(scope))) !== group.invocation.approvalDigest) throw new OcrReviewRefusedError();
  const sources = scope.filter(source => source.nodeId === nodeId && "checkpoint" in source);
  const source = sources[0];
  if (sources.length !== 1 || source === undefined || !("checkpoint" in source) || source.checkpoint === undefined) throw new OcrReviewRefusedError();
  return source.checkpoint;
}

export function readOcrRecordBindings(repositories: AuthorityRepositories, runId: string): Readonly<{ seed: OcrReviewSeed; bindings: readonly DelegatedRecordBinding[] }> | undefined {
  const owner = repositories.runs.get(runId);
  if (owner?.envelope.workflow !== "ocr") throw new OcrReviewRefusedError();
  const groups = repositories.dependencies.groups(runId).filter(({ group }) => group.invocation.nodeId === "lookup-identities");
  if (groups.length === 0) return undefined;
  const entry = groups[0];
  if (groups.length !== 1 || entry === undefined) throw new OcrReviewRefusedError();
  const { group } = entry;
  const seed = OcrReviewSeedSchema.parse(originalCheckpoint(repositories, group, "build-review").output.value);
  if (seed.sourceRunId !== undefined && seed.sourceRunId !== owner.envelope.runId) throw new OcrReviewRefusedError();
  const lookups = bindOcrLookupOutcomes(seed, group.children.map(member => ({
    itemId: member.child.envelope.itemId, runId: member.child.envelope.runId,
  })));
  const bindings = lookups.flatMap((lookup, index) => {
    const member = group.children[index];
    if (member === undefined || delegationChildInputFingerprint(lookup.input) !== member.entry.canonicalInputFingerprint) throw new OcrReviewRefusedError();
    return lookup.recordIds.map(recordId => ({ record: { runId: owner.envelope.runId, recordId },
      childRunIds: member.history, currentChildRunId: member.child.envelope.runId }));
  });
  const recordOrder = new Map(seed.records.map((record, index) => [record.recordId, index]));
  bindings.sort((left, right) => {
    const a = recordOrder.get(left.record.recordId), b = recordOrder.get(right.record.recordId);
    if (a === undefined || b === undefined) throw new OcrReviewRefusedError();
    return a - b;
  });
  return { seed, bindings: DelegatedRecordBindingSchema.array().parse(bindings) };
}

export function readOcrQueueMembers(repositories: AuthorityRepositories, reader: Pick<RunRecordService, "read">,
  runId: string, workflowLabel: (workflowId: string) => string): QueueRecordMembers | undefined {
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
  const lookups = groups.find(({ group }) => group.invocation.nodeId === "lookup-identities");
  const lookupChildren = new Map(lookups?.group.children.map(member => [member.child.envelope.runId, member.child]));
  const pageGroups = groups.filter(({ group }) => group.invocation.nodeId === "read-pages");
  const pages = pageGroups[0];
  if (pageGroups.length > 1) throw new OcrReviewRefusedError();
  const covered = groups.filter(({ group }) => group.invocation.nodeId === "read-pages" || group.invocation.nodeId === "lookup-identities");
  const runIds = [...new Set(covered.flatMap(({ group }) => group.children.flatMap(member => member.history)))];
  const failures = (pages?.group.children ?? []).filter(member => statusOf(member.child) === "failed").map(member => {
    const input = OcrPageWorkflowInputSchema.parse(member.child.input.parsed.value);
    return { kind: "page-failure" as const, ownerRunId: owner.envelope.runId, sourcePage: input.page.sourcePage,
      title: `Page ${input.page.sourcePage}`, status: "failed" as const, statusLabel: "Failed", childRunIds: member.history,
      target: { ...link(member.child), section: "logs" as const } };
  });
  if (source === undefined) {
    if (pages === undefined) return undefined;
    const prepared = ReadOcrSourcePages.output.parse(originalCheckpoint(repositories, pages.group, "read-source-pages").output.value);
    const status = statusOf(owner);
    return QueueRecordMembersSchema.parse({ runIds, members: [{ kind: "reading", ownerRunId: owner.envelope.runId,
      title: `${prepared.manifest.pageCount} ${prepared.manifest.pageCount === 1 ? "page" : "pages"}`,
      status, statusLabel: status === "failed" ? "Failed" : status === "blocked" ? "Blocked" : status === "cancelled" ? "Cancelled" : "Reading",
      childRunIds: pages.group.children.filter(member => statusOf(member.child) !== "failed").flatMap(member => member.history),
      target: { ...link(owner), section: "logs" } }, ...failures] });
  }
  const review = readOcrReviewAuthority(repositories, reader, runId);
  if (lookups === undefined) throw new OcrReviewRefusedError();
  const members = source.seed.records.flatMap(record => {
    const binding = source.bindings.find(binding => binding.record.recordId === record.recordId);
    const child = binding === undefined ? undefined : lookupChildren.get(binding.currentChildRunId);
    if (binding !== undefined && child === undefined) throw new OcrReviewRefusedError();
    const childStatus = child === undefined ? undefined : statusOf(child);
    if (binding !== undefined && (lookups.manifest.policy.visibility === "linked"
      || lookups.manifest.policy.visibility === "hidden-unless-failed" && childStatus !== "failed")) return [];
    const current = review?.revision.records.find(current => current.recordId === record.recordId);
    if (review !== undefined && current === undefined) throw new OcrReviewRefusedError();
    const page = source.seed.accounting.outcomes[record.sourcePage - 1];
    if (page?.state !== "done") throw new OcrReviewRefusedError();
    const pageMember = pages?.group.children.find(member => member.history.includes(page.runId));
    if (pageMember === undefined) throw new OcrReviewRefusedError();
    const childRunIds = [...new Set([...pageMember.history, ...(binding?.childRunIds ?? [])])];
    const ref = { runId: owner.envelope.runId, recordId: record.recordId };
    const eid = current === undefined ? record.assertedEid : current.assertedEid;
    const name = current === undefined ? record.subjectName : ocrRecordName(current.fields);
    const title = [name === null ? null : titleCasePersonName(name), eid === null ? null : `EID ${eid}`]
      .filter(part => part !== null).join(" · ") || `Page ${record.sourcePage}`;
    const status = current?.discarded === true ? "cancelled" : childStatus === "failed" || childStatus === "blocked" || childStatus === "cancelled" ? childStatus
      : childStatus !== undefined && childStatus !== "done" ? "running" : current?.assertedEid !== undefined && current.assertedEid !== null ? "done" : "awaiting-approval";
    const statusLabel = current?.discarded === true ? "Not approved" : status === "failed" ? "Failed" : status === "blocked" ? "Blocked"
      : status === "cancelled" ? "Cancelled" : status === "running" ? "Looking up" : status === "done" ? "Verified" : "Needs lookup";
    const target: QueueMemberTarget = review !== undefined && status !== "failed" && status !== "blocked"
      ? { ...link(owner), panelKind: "review", section: "review", record: ref }
      : { ...link(child ?? owner), section: "logs" };
    return [{ kind: "record" as const, record: ref, title, status, statusLabel, childRunIds, target }];
  });
  return QueueRecordMembersSchema.parse({ runIds, members: [...members, ...failures] });
}

export function readQueueRecordMembers(repositories: AuthorityRepositories, reader: Pick<RunRecordService, "read">,
  run: RunRecord, children: readonly RunRecord[], workflowLabel: (workflowId: string) => string): QueueRecordMembers | undefined {
  if (run.envelope.workflow === "ocr") return readOcrQueueMembers(repositories, reader, run.envelope.runId, workflowLabel);
  if (!children.some(child => child.envelope.workflow === "ocr") && run.envelope.continuation === undefined) return undefined;
  const sources = repositories.dependencies.groups(run.envelope.runId)
    .filter(({ manifest }) => manifest.policy.visibility === "linked")
    .flatMap(({ group }) => group.children.filter(member => member.child.envelope.workflow === "ocr")
      .flatMap(member => {
        const source = readOcrQueueMembers(repositories, reader, member.child.envelope.runId, workflowLabel);
        return source === undefined ? [] : [source];
      }));
  return sources.length === 0 ? undefined : QueueRecordMembersSchema.parse({
    runIds: [...new Set(sources.flatMap(source => source.runIds))], members: sources.flatMap(source => source.members),
  });
}
