import { requireWorkflowOperationDisplaySnapshot } from "../../../models/workflow/operation-display-snapshot.js";
import { randomUUID } from "node:crypto";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import {
  OperationSourceRequestSchema, OperationSourceResponseSchema, requireOperationSourceDeclaration,
  type OperationSourceResponse,
} from "../../../models/dashboard/operation-structure.js";
import { NoteWireSchema } from "../../../models/events/types.js";
import { timelineNoteLocation } from "../../storage/events/timeline-reader.js";
import { RunResultRecordSchema, terminalEvidenceResult } from "../../../models/run/result.js";
import type { RunRecord } from "../../../models/run/record.js";
import { operationStructureForRun, type RunLogScanEntry } from "./run-logs.js";
import type { RunDetailQueryDeps } from "./run-detail-types.js";


type HeldCursor = Readonly<{ ownerRunId: string; identity: string; after: number; through: number }>;
const cursorCaches = new WeakMap<RunDetailQueryDeps, Map<string, HeldCursor>>();
function cursorCache(deps: RunDetailQueryDeps): Map<string, HeldCursor> {
  const existing = cursorCaches.get(deps);
  if (existing !== undefined) return existing;
  const created = new Map<string, HeldCursor>();
  cursorCaches.set(deps, created);
  return created;
}

export function resolveOperationSource(deps: RunDetailQueryDeps, ownerRunId: string, requestInput: unknown, signal?: AbortSignal): OperationSourceResponse {
  const work = () => resolveOperationSourceInSnapshot(deps, ownerRunId, requestInput, signal);
  return deps.canonical === undefined ? work() : deps.canonical.database.withAuthorityReadSnapshot(work);
}

/** Exact identity only; each request consumes at most 200 lines and 256 KiB. */
function resolveOperationSourceInSnapshot(
  deps: RunDetailQueryDeps,
  ownerRunId: string,
  requestInput: unknown,
  signal?: AbortSignal,
): OperationSourceResponse {
  signal?.throwIfAborted();
  const request = OperationSourceRequestSchema.parse(requestInput);
  const identityKey = canonicalJsonStringify(request.identity);
  const cache = cursorCache(deps);
  const cursor = request.cursor === undefined ? undefined : cache.get(request.cursor);
  if (request.cursor !== undefined && (cursor === undefined || cursor.ownerRunId !== ownerRunId || cursor.identity !== identityKey)) {
    throw new Error("operation-source-cursor-unavailable-or-identity-mismatch");
  }
  const continuation = (position: Readonly<{ after: number; through: number }>): OperationSourceResponse => {
    const token = sha256Hex(randomUUID());
    cache.set(token, { ...position, ownerRunId, identity: identityKey });
    if (cache.size > 128) cache.delete(cache.keys().next().value!);
    return OperationSourceResponseSchema.parse({ state: "continue", cursor: token });
  };
  const requireRun = (runId: string): Readonly<{ run: RunRecord }> => {
    if (deps.runReader === undefined) throw new Error("operation-source-run-reader-not-configured");
    const existence = deps.runReader.read(runId);
    if (existence.state !== "present" || existence.run.envelope.runId !== runId) throw new Error("operation-source-run-unavailable");
    return { run: existence.run };
  };
  const owner = requireRun(ownerRunId).run;
  const ownerResultInput = deps.canonical?.database.authority.runResults.get(owner.envelope.runId);
  const ownerResult = ownerResultInput === undefined ? undefined : RunResultRecordSchema.parse(ownerResultInput);
  const evidence = ownerResult === undefined ? undefined : terminalEvidenceResult(ownerResult);
  if (ownerResult !== undefined && (owner.lifecycle.state !== "terminal"
    || (evidence === undefined ? owner.lifecycle.outcome !== "done"
      : owner.lifecycle.outcome !== (evidence.kind === "failed-evidence" ? "failed" : evidence.outcome))
    || ownerResult.runId !== owner.envelope.runId || ownerResult.workflowId !== owner.envelope.workflow
    || ownerResult.attempt !== owner.envelope.attempt || ownerResult.contractFingerprint !== owner.envelope.contractFingerprint
    || ownerResult.descriptorVersion !== owner.envelope.descriptorVersion
    || ownerResult.configFingerprint !== owner.envelope.configFingerprint || ownerResult.configSnapshotId !== owner.envelope.configSnapshotId)) throw new Error("operation-source-owner-result-identity-mismatch");
  const retainedReferences = ownerResult === undefined || evidence !== undefined ? [] : [
    ...(ownerResult.operationSources ?? []).map((source) => source.identity),
    ...ownerResult.dependencies.flatMap((dependency) => dependency.state === "resolved" || dependency.state === "child-resolved" || dependency.state === "delegation-resolved" ? (dependency.operationSources ?? []).map((source) => source.identity) : []),
    ...(ownerResult.operationLineage ?? []).flatMap((lineage) => lineage.inputs.flatMap((input) => input.identity === undefined ? input.identities ?? [] : [input.identity])),
  ];
  if (retainedReferences.length > 4096) throw new Error("operation-source-retained-reference-bound");
  const retainedOrigin = retainedReferences.some((identity) => canonicalJsonStringify(identity) === identityKey);
  if (retainedOrigin && deps.runReader?.read(request.identity.runId).state !== "present") return OperationSourceResponseSchema.parse({ state: "unavailable", reason: "exact-occurrence-not-retained" });
  const targetMembership = requireRun(request.identity.runId);
  const target = targetMembership.run;
  let ancestor = target;
  const visited = new Set<string>();
  while (!retainedOrigin && ancestor.envelope.runId !== owner.envelope.runId) {
    if (visited.has(ancestor.envelope.runId) || visited.size >= 16) throw new Error("operation-source-child-cycle-or-depth");
    visited.add(ancestor.envelope.runId);
    const parent = ancestor.envelope.parent;
    if (parent === undefined) throw new Error("operation-source-child-not-authorized");
    ancestor = requireRun(parent.runId).run;
  }
  if (target.envelope.contractFingerprint !== request.identity.definitionFingerprint
    || target.envelope.attempt !== request.identity.attempt) throw new Error("operation-source-run-identity-mismatch");
  if (request.identity.claimGeneration > target.claimGeneration) throw new Error("operation-source-claim-not-retained");
  if (target.envelope.parent === undefined && request.identity.childInvocation !== undefined) throw new Error("operation-source-child-identity-mismatch");
  if (target.envelope.operationDisplaySnapshot !== undefined) {
    const definition = requireWorkflowOperationDisplaySnapshot(target.envelope.operationDisplaySnapshot, { workflowId: target.envelope.workflow, definitionFingerprint: target.envelope.contractFingerprint });
    requireOperationSourceDeclaration(definition, request.identity);
  } else if (target.envelope.operationDisplayCapability === "complete") throw new Error("operation-source-complete-definition-unavailable");
  else return OperationSourceResponseSchema.parse({ state: "unavailable", reason: "exact-occurrence-not-retained" });
  if (target.envelope.parent !== undefined && (request.identity.childInvocation?.parentRunId !== target.envelope.parent.runId
    || request.identity.childInvocation.edgeId !== target.envelope.parent.edgeId)) throw new Error("operation-source-child-identity-mismatch");
  const through = cursor?.through ?? deps.timeline.highWaterMark();
  if (through > deps.timeline.highWaterMark()) throw new Error("operation-source-cursor-unavailable");
  const records = deps.timeline.page({ runId: target.envelope.runId, after: cursor?.after ?? 0, through, limit: 200 });
  for (const record of records) {
    if (record.payload.kind !== "note") continue;
    const line = timelineNoteLocation(record);
    signal?.throwIfAborted();
    let note;
    try { note = NoteWireSchema.parse(JSON.parse(line.text)); }
    catch (cause) { throw new Error(`operation-source-corrupt-note:${record.eventId}`, { cause }); }
    const occurrence = note.action?.operation;
    if (occurrence === undefined) continue;
    const { value: _value, ...identity } = occurrence;
    if (canonicalJsonStringify(identity) !== canonicalJsonStringify(request.identity)) continue;
    if (!("runId" in note) || note.runId !== target.envelope.runId || note.workflow !== target.envelope.workflow
      || note.attempt !== target.envelope.attempt || note.traceId !== target.envelope.traceId) throw new Error("operation-source-note-identity-mismatch");
    const entry: RunLogScanEntry = { kind: "note", line, note: { ...note, runId: note.runId } };
    return OperationSourceResponseSchema.parse({ state: "found", structure: operationStructureForRun(target, target.envelope.runId, [entry]) });
  }
  const last = records.at(-1);
  return last === undefined || records.length < 200
    ? OperationSourceResponseSchema.parse({ state: "unavailable", reason: "exact-occurrence-not-retained" })
    : continuation({ after: last.cursor, through });
}
