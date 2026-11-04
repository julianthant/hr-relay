import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ReviewPageSchema, type ReviewPage } from "../../models/dashboard/run-detail.js";
import type { DashboardClient } from "../client/index.js";
import type { DashboardCommandBinding } from "../app/dashboard-app-model.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../models/failures/error-catalog.js";
import type { LogSelection } from "../surfaces/run-detail/logs/log-selection-model.js";
import { CommandRequestSchema, type CommandRequest } from "../../rules/commands/commands.js";
import { OcrApprovedSnapshotSchema, ocrSnapshotDigest } from "../../models/ocr/review.js";
import { OcrApprovalReferenceSchema } from "../../models/workflows/ocr/result.js";
import { deriveSchemaHash } from "../../models/validation/schema-bound-value.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { correctedOcrRecord } from "../surfaces/run-detail/review/review-model.js";

type ReviewState = Readonly<{ state: "loading" | "loaded" | "failed"; page?: ReviewPage; error?: string }>;

export async function readRunReview(client: Pick<DashboardClient, "runDetail" | "runSection">, selection: LogSelection, signal: AbortSignal): Promise<ReviewPage> {
  const { row } = selection;
  const detail = await client.runDetail(row.runId, signal);
  if (detail.runId !== row.runId || detail.header.workflowId !== row.workflowId || detail.header.traceId !== row.traceId
    || detail.header.attempt !== row.attempt || detail.rowRevision !== row.rowRevision || !detail.availableSections.includes("review")) {
    throw new Error("RUN_REVIEW_IDENTITY_MISMATCH");
  }
  signal.throwIfAborted();
  const section = await client.runSection(row.runId, "review", undefined, signal);
  if (section.section !== "review" || section.payload.runId !== row.runId) throw new Error("RUN_REVIEW_IDENTITY_MISMATCH");
  return section.payload;
}

export function useRunReview(client: DashboardClient, selection: LogSelection, binding: DashboardCommandBinding | undefined) {
  const { row } = selection;
  const request = useMemo(() => ({ client, selection: { row, workflowLabel: selection.workflowLabel }, runId: row.runId, revision: row.rowRevision, epoch: binding?.authority.epoch,
    actor: binding?.scope.actorId, day: binding?.authority.day, dayRequest: binding?.authority.dayState.request,
    dayState: binding?.authority.dayState.day.state }),
  [client, row, selection.workflowLabel, binding?.authority.epoch, binding?.scope.actorId, binding?.authority.day,
    binding?.authority.dayState.request, binding?.authority.dayState.day.state]);
  const current = useRef(request);
  current.current = request;
  const [settled, setSettled] = useState<{ request: typeof request; value: ReviewState }>({ request, value: { state: "loading" } });
  const sameOwner = settled.request.client === client && settled.request.runId === row.runId
    && settled.request.epoch === request.epoch && settled.request.actor === request.actor && settled.request.day === request.day;
  const value: ReviewState = settled.request === request ? settled.value : { state: "loading", ...(sameOwner && settled.value.page ? { page: settled.value.page } : {}) };
  useEffect(() => {
    if (request.dayState !== undefined && request.dayState !== "loaded") return;
    const controller = new AbortController();
    void readRunReview(client, request.selection, controller.signal).then(page => {
      if (current.current === request && !controller.signal.aborted) setSettled({ request, value: { state: "loaded", page } });
    }, () => {
      if (current.current !== request || controller.signal.aborted) return;
      const error = formatErrorCatalogFailure(createErrorCatalogFailure("OCR_REVIEW_REFUSED", {})).text;
      setSettled(previous => ({ request, value: { state: "failed", error,
        ...(previous.request.client === client && previous.request.runId === row.runId && previous.request.epoch === request.epoch
          && previous.request.actor === request.actor && previous.request.day === request.day && previous.value.page ? { page: previous.value.page } : {}) } }));
    });
    return () => controller.abort();
  }, [client, request, row.runId]);
  return value;
}

export async function verifyOcrReviewEffect(client: DashboardClient, request: CommandRequest) {
  if (!(request.family === "ocr-review" || request.family === "gate" && request.payload.ocrApproval !== undefined)) throw new Error("RUN_REVIEW_COMMAND_MISMATCH");
  const recorded = await client.ocrCommandResult(request.target.runId, request.commandId);
  if (recorded.state !== "recorded" || canonicalJsonStringify(recorded.request) !== canonicalJsonStringify(request)) return { state: "mismatch" as const, evidence: recorded };
  const section = await client.runSection(request.target.runId, "review");
  if (section.section !== "review" || section.payload.runId !== request.target.runId || section.payload.ocr === undefined) return { state: "mismatch" as const, evidence: section };
  const page = section.payload, review = section.payload.ocr;
  if (request.family === "gate") {
    const snapshot = review.approvedSnapshots.find(snapshot => snapshot.snapshotId === request.commandId);
    return snapshot !== undefined && canonicalJsonStringify(request.payload.result.value) === canonicalJsonStringify({ snapshotId: snapshot.snapshotId,
      sourceRunId: snapshot.sourceRunId, revision: snapshot.revision, digest: ocrSnapshotDigest(snapshot) })
      ? { state: "matched" as const, evidence: page } : { state: "mismatch" as const, evidence: page };
  }
  if (review.revision.revision > request.target.expectedRevision + 1) return { state: "conflict" as const, evidence: page };
  const record = review.revision.records.find(record => record.recordId === request.payload.recordId);
  const effect = request.type === "correct-ocr-record" ? record !== undefined && canonicalJsonStringify({ recordId: record.recordId, fields: record.fields,
    assertedEid: record.assertedEid }) === canonicalJsonStringify(request.payload) : record?.discarded === (request.type === "discard-ocr-record");
  return review.revision.revision === request.target.expectedRevision + 1 && review.revision.origin.kind === "command"
    && review.revision.origin.commandId === request.commandId && effect ? { state: "matched" as const, evidence: page } : { state: "mismatch" as const, evidence: page };
}

type ReviewDraftFields = Record<string, Record<string, string>>;
type ReviewDraft = { revision: number; fields: ReviewDraftFields; includes: Record<string, boolean> };
type ReviewAttempt = { request?: CommandRequest; captured?: Pick<ReviewDraft, "fields" | "includes">;
  state: "pending" | "uncertain" | "conflict" | "refused"; text: string };
interface ReviewMemory {
  draft?: ReviewDraft;
  attempt?: ReviewAttempt;
  confirmed?: { revision: number; approved: boolean };
  discardedRecords?: readonly string[];
  binding?: DashboardCommandBinding;
  version: number;
  listeners: Set<() => void>;
}
const reviewMemories = new WeakMap<DashboardClient, WeakMap<object, Map<string, ReviewMemory>>>();
function reviewMemory(client: DashboardClient, runId: string, epoch: object | undefined, actor: string | undefined, day: string | undefined): ReviewMemory {
  const owner = epoch ?? client;
  let clients = reviewMemories.get(client);
  if (clients === undefined) { clients = new WeakMap(); reviewMemories.set(client, clients); }
  let memories = clients.get(owner);
  if (memories === undefined) { memories = new Map(); clients.set(owner, memories); }
  const key = JSON.stringify([actor, day, runId]);
  let memory = memories.get(key);
  if (memory === undefined) { memory = { version: 0, listeners: new Set() }; memories.set(key, memory); }
  return memory;
}
function publishReview(memory: ReviewMemory): void {
  memory.version++;
  for (const notify of memory.listeners) notify();
}

export function useOcrReviewEditor(client: DashboardClient, selection: LogSelection, binding: DashboardCommandBinding | undefined) {
  const resource = useRunReview(client, selection, binding);
  const memory = useMemo(() => reviewMemory(client, selection.row.runId, binding?.authority.epoch, binding?.scope.actorId, binding?.authority.day),
    [client, selection.row.runId, binding?.authority.epoch, binding?.scope.actorId, binding?.authority.day]);
  const subscribe = useCallback((notify: () => void) => { memory.listeners.add(notify); return () => { memory.listeners.delete(notify); }; }, [memory]);
  const snapshot = useCallback(() => memory.version, [memory]);
  useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => { memory.binding = binding; }, [memory, binding]);
  const { attempt, draft } = memory;
  const page = resource.page, review = page?.ocr;
  const fresh = resource.state === "loaded" && binding?.scope.client === client && binding.authority.dayState.day.state === "loaded"
    && review?.editing?.state === "available" && review.editing.runVersion === selection.row.rowRevision
    && (memory.confirmed === undefined || !memory.confirmed.approved && review.revision.revision >= memory.confirmed.revision);
  const dirty = draft !== undefined && (Object.keys(draft.fields).length > 0 || Object.keys(draft.includes).length > 0);
  const blocked = attempt !== undefined && attempt.state !== "refused";
  const conflict = dirty && review !== undefined && draft.revision < review.revision.revision
    && attempt?.state !== "pending" && attempt?.state !== "uncertain";
  const send = useCallback(async (request: CommandRequest, captured?: Pick<ReviewDraft, "fields" | "includes">, check = false) => {
    const start = memory.binding;
    if (start === undefined || start.scope.client !== client || memory.attempt?.state === "pending") return;
    memory.attempt = { request, captured, state: "pending", text: "Pending" };
    publishReview(memory);
    const options = { scope: start.scope, readback: (input: CommandRequest) => verifyOcrReviewEffect(client, input) };
    const outcome = check ? await start.executor.check(request.commandId, { ...options, observe: async input => {
      if (!(input.family === "ocr-review" || input.family === "gate")) throw new Error("RUN_REVIEW_COMMAND_MISMATCH");
      const result = await client.ocrCommandResult(input.target.runId, input.commandId);
      if (result.state !== "recorded" || canonicalJsonStringify(result.request) !== canonicalJsonStringify(input)) return undefined;
      return result.result;
    } }) : await start.executor.execute(request, options);
    if (outcome.kind === "confirmed") {
      const saved = ReviewPageSchema.parse(outcome.readback);
      if (saved.ocr === undefined) throw new Error("RUN_REVIEW_OCR_UNAVAILABLE");
      memory.confirmed = { revision: saved.ocr.revision.revision, approved: saved.ocr.approvedSnapshots.length > 0 };
      if (memory.draft !== undefined) {
        const fields = Object.fromEntries(Object.entries(memory.draft.fields).flatMap(([id, values]) => {
          const remaining = Object.fromEntries(Object.entries(values).filter(([key, value]) => captured?.fields[id]?.[key] !== value));
          return Object.keys(remaining).length > 0 ? [[id, remaining]] : [];
        }));
        const includes = Object.fromEntries(Object.entries(memory.draft.includes).filter(([id, value]) => captured?.includes[id] !== value));
        memory.draft = Object.keys(fields).length > 0 || Object.keys(includes).length > 0
          ? { revision: saved.ocr.revision.revision, fields, includes } : undefined;
      }
      memory.attempt = undefined;
    } else memory.attempt = { request, captured, state: outcome.kind === "uncertain" ? "uncertain" : outcome.kind === "conflict" ? "conflict" : "refused", text: outcome.feedback.text };
    publishReview(memory);
    if (memory.listeners.size > 0) {
      memory.binding?.feedback(outcome);
      if (outcome.kind === "confirmed") memory.binding?.authority.dayState.refresh();
    }
  }, [client, memory]);
  const save = useCallback(() => {
    if (!fresh || !dirty || blocked || conflict || draft === undefined || page === undefined || review === undefined || binding === undefined
      || draft.revision !== review.revision.revision || attempt?.state === "refused") return;
    const first = Object.entries(draft.fields)[0], include = Object.entries(draft.includes)[0];
    let request: CommandRequest;
    try {
      const mutation = first === undefined ? { type: include[1] ? "restore-ocr-record" : "discard-ocr-record", payload: { recordId: include[0] } }
        : { type: "correct-ocr-record", payload: correctedOcrRecord(page, first[0], first[1]) };
      request = CommandRequestSchema.parse({ family: "ocr-review", ...mutation, commandId: crypto.randomUUID(), requestedBy: binding.scope.actorId,
        requestedAt: binding.authority.nowIso, source: "dashboard", target: { runId: page.runId, expectedRevision: review.revision.revision } });
    } catch {
      memory.attempt = { state: "refused", text: formatErrorCatalogFailure(createErrorCatalogFailure("OCR_REVIEW_REFUSED", {})).text };
      publishReview(memory);
      return;
    }
    void send(request, { fields: first === undefined ? {} : { [first[0]]: first[1] }, includes: first !== undefined ? {} : { [include[0]]: include[1] } });
  }, [fresh, dirty, blocked, conflict, draft, page, review, binding, attempt?.state, memory, send]);
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(save, draft !== undefined && Object.keys(draft.fields).length > 0 ? 400 : 0);
    return () => clearTimeout(timer);
  }, [dirty, draft, save]);
  const edit = (recordId: string, key: string, value: string) => {
    if (!fresh || conflict || attempt?.state === "uncertain" || attempt?.state === "conflict" || review === undefined) return;
    memory.draft = { revision: draft?.revision ?? review.revision.revision, includes: draft?.includes ?? {},
      fields: { ...draft?.fields, [recordId]: { ...draft?.fields[recordId], [key]: value } } };
    if (attempt?.state === "refused") memory.attempt = undefined;
    publishReview(memory);
  };
  const include = (records: readonly { id: string; selected: boolean }[], discardReview = false) => {
    if (!fresh || blocked || dirty || review === undefined) return;
    memory.draft = { revision: review.revision.revision, fields: {}, includes: Object.fromEntries(records.map(record => [record.id, record.selected])) };
    if (discardReview) memory.discardedRecords = records.map(record => record.id);
    memory.attempt = undefined;
    publishReview(memory);
  };
  const discarded = memory.discardedRecords !== undefined && memory.discardedRecords.length > 0
    && memory.discardedRecords.every(id => review?.revision.records.find(record => record.recordId === id)?.discarded === true);
  const restore = () => {
    if (!discarded || memory.discardedRecords === undefined || !fresh || blocked || dirty) return;
    include(memory.discardedRecords.map(id => ({ id, selected: true })));
    memory.discardedRecords = undefined;
    publishReview(memory);
  };
  const approve = () => {
    if (!fresh || dirty || blocked || review?.approval === undefined || binding === undefined || page === undefined) return;
    const commandId = crypto.randomUUID(), requestedAt = binding.authority.nowIso;
    const selected = review.revision.records.filter(record => !record.discarded);
    const snapshot = OcrApprovedSnapshotSchema.parse({ snapshotId: commandId, sourceRunId: page.runId, revision: review.revision.revision,
      reviewDigest: review.digest, selectedRecordIds: selected.map(record => record.recordId), records: selected,
      approvedBy: binding.scope.actorId, approvedAt: requestedAt });
    void send(CommandRequestSchema.parse({ commandId, requestedAt, requestedBy: binding.scope.actorId, source: "dashboard", family: "gate", type: "resolve-gate",
      target: review.approval, payload: { result: { schemaHash: deriveSchemaHash(OcrApprovalReferenceSchema, "output"), value: {
        snapshotId: commandId, sourceRunId: page.runId, revision: snapshot.revision, digest: ocrSnapshotDigest(snapshot) } },
      ocrApproval: { expectedRevision: snapshot.revision, reviewDigest: review.digest, selectedRecordIds: snapshot.selectedRecordIds } } }));
  };
  return { ...resource, drafts: draft?.fields ?? {}, includes: draft?.includes ?? {}, edit, include, approve, restore, discarded, flush: save,
    readOnly: review?.editing?.state !== "available" || memory.confirmed?.approved === true, disabled: !fresh || conflict || attempt?.state === "uncertain" || attempt?.state === "conflict",
    actionsDisabled: !fresh || dirty || blocked, feedback: conflict ? formatErrorCatalogFailure(createErrorCatalogFailure("COMMAND_CONFLICT", {})).text : attempt?.text ?? (dirty ? "Pending" : undefined),
    reload: conflict || attempt?.state === "conflict" || attempt?.state === "refused" ? () => {
      memory.draft = undefined; memory.attempt = undefined; memory.discardedRecords = undefined;
      publishReview(memory); memory.binding?.authority.dayState.refresh();
    } : undefined,
    check: attempt?.state === "uncertain" && attempt.request !== undefined ? () => { const request = attempt.request; if (request !== undefined) void send(request, attempt.captured, true); } : undefined };
}
