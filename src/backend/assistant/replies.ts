import { z } from "zod";
import { AssistantAcceptedTurnSchema, AssistantDataTargetSchema, AssistantInlineSchema, AssistantReplyPartsSchema,
  AssistantReplyPartSchema, AssistantSessionPartSchema, AssistantSessionViewSchema, AssistantValueSourceSchema,
  type AssistantAcceptedTurn, type AssistantInline, type AssistantReplyPart } from "../../models/dashboard/assistant.js";
import { QueueSurfaceWireSchema, TERMINAL_QUEUE_STATUSES, type QueueSurfaceWire } from "../../models/dashboard/projection.js";
import { PersonLookupCanonicalInput } from "../../models/workflows/person-lookup/input.js";
import { parseCanonicalInputSnapshot } from "../../models/workflow/canonical-input.js";
import type { RunRecord } from "../../models/run/record.js";
import { ERROR_CATALOG, type ErrorCatalogCode } from "../../models/failures/error-catalog.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { deepFreeze } from "../../rules/validation/immutability.js";
import { sha256Hex } from "../../rules/validation/sha256.js";
import { AssistantActionBindingSchema, CommandEnvelopeSchema } from "../../rules/commands/commands.js";
import { deriveRunStatus } from "../../rules/runs/run-status.js";
import { searchPartitionDay } from "../../models/dashboard/search-calendar.js";
import { hasProtectedSubject, protectedSubjectDisplay } from "../runs/start/protected-input.js";
import { AssistantToolRefusal } from "./plugins/plugin.js";
import type { AssistantReferenceEntry, AssistantReferenceTable } from "./references.js";

type BindingBase = Readonly<{ reference: string; entry: AssistantReferenceEntry; value: string; source?: z.input<typeof AssistantValueSourceSchema>; run?: RunRecord; rowRevision?: number }>;
export type ServerReplyBinding = BindingBase & (
  Readonly<{ kind: "value-only"; previous?: string }> | Readonly<{ kind: "target"; target: z.input<typeof AssistantDataTargetSchema> }>);
const fingerprint = (value: unknown) => sha256Hex(canonicalJsonStringify(value));
function refuse(code: "ASSISTANT_INVALID" | "ASSISTANT_READ_STALE" | "ASSISTANT_READ_UNAVAILABLE" | "ASSISTANT_LIMIT" = "ASSISTANT_READ_UNAVAILABLE"): never { throw new AssistantToolRefusal(code); }
const parts = (input: unknown) => deepFreeze(AssistantReplyPartsSchema.parse(input));

function personIdentity(row: RunRecord, entry: AssistantReferenceEntry) {
  if (hasProtectedSubject(row.input.parsed.protectedBindings)) refuse();
  if (row.envelope.workflow !== "person-lookup" || !["single", "operation-member"].includes(row.envelope.shape)) refuse();
  let canonical: z.infer<typeof PersonLookupCanonicalInput>;
  try { canonical = parseCanonicalInputSnapshot(PersonLookupCanonicalInput, row.input.parsed); } catch { return refuse(); }
  if (canonical.mode !== "search" || !("emplId" in canonical) || canonical.emplId === undefined || canonical.emplId !== entry.expand || !["P", "E"].includes(entry.kind)) refuse("ASSISTANT_READ_STALE");
  return { runId: row.envelope.runId, inputSchemaHash: row.input.parsed.schemaHash, inputFingerprint: fingerprint(canonical) };
}

/** The caller supplies a current admitted canonical row, never a model-provided identity or a protected-subject flag. */
export function assistantPersonBinding(table: AssistantReferenceTable, reference: string, row: RunRecord): ServerReplyBinding {
  const entry = table.resolve(reference, ["P", "E"]), identityRef = personIdentity(row, entry);
  const binding: ServerReplyBinding = { kind: "target", reference, entry, value: entry.display, rowRevision: row.version, run: structuredClone(row), target: { kind: "person", identityRef } };
  return deepFreeze(binding);
}

function bindingInline(binding: ServerReplyBinding, table: AssistantReferenceTable): AssistantInline {
  const entry = table.resolve(binding.reference, ["P", "E", "R", "N", "S", "A", "T", "V"]);
  if (canonicalJsonStringify(entry) !== canonicalJsonStringify(binding.entry) || binding.value !== entry.display) refuse("ASSISTANT_READ_STALE");
  const row = binding.run;
  if (row !== undefined && ((binding.rowRevision ?? entry.version) !== row.version || entry.version !== undefined && entry.version !== row.version)) refuse("ASSISTANT_READ_STALE");
  const protectedSubject = row !== undefined && hasProtectedSubject(row.input.parsed.protectedBindings);
  if (binding.kind === "value-only") {
    if (protectedSubject) refuse();
    const source = binding.source === undefined ? undefined : AssistantValueSourceSchema.parse(binding.source);
    if (source !== undefined && source.valueFingerprint !== fingerprint(binding.value)) refuse("ASSISTANT_READ_STALE");
    if (source?.kind === "run-input" && (row === undefined || source.runId !== row.envelope.runId || source.inputSchemaHash !== row.input.parsed.schemaHash
      || source.inputFingerprint !== fingerprint(row.input.parsed.value))) refuse("ASSISTANT_READ_STALE");
    return AssistantInlineSchema.parse({ kind: "value", value: binding.value,
      ...(binding.previous === undefined ? {} : { previous: binding.previous }), ...(source === undefined ? {} : { source }) });
  }
  const target = AssistantDataTargetSchema.parse(binding.target);
  if (target.kind === "person") {
    if (row === undefined || canonicalJsonStringify(personIdentity(row, entry)) !== canonicalJsonStringify(target.identityRef)) refuse("ASSISTANT_READ_STALE");
  } else if (target.kind === "run") {
    if (row === undefined || entry.kind !== "R" || entry.target !== row.envelope.runId || target.runId !== row.envelope.runId
      || target.day !== searchPartitionDay(new Date(row.envelope.enqueuedAt))) refuse("ASSISTANT_READ_STALE");
  } else {
    if (protectedSubject) refuse();
    const source = binding.source === undefined ? undefined : AssistantValueSourceSchema.parse(binding.source);
    if (source === undefined || source.valueFingerprint !== fingerprint(binding.value)) refuse();
    if (target.kind === "workbook") table.resolve(binding.reference, ["S"]);
    if (target.kind === "attachment") table.resolve(binding.reference, ["A"]);
    if (target.kind === "workbook" && (source.kind !== "workbook" || source.libraryId !== target.libraryId || source.revision !== target.revision || entry.version !== undefined && entry.version !== target.revision
      || entry.target !== target.libraryId || target.location.kind !== "master" && source.sheetId !== target.location.sheetId
      || target.location.kind === "cell" && (source.rowId !== target.location.rowId || source.fieldId !== target.location.fieldId))) refuse("ASSISTANT_READ_STALE");
    if (target.kind === "attachment" && (source.kind !== "attachment" || entry.target !== target.attachmentId || source.attachmentId !== target.attachmentId
      || source.sha256 !== target.sha256 || target.page !== undefined && source.page !== target.page)) refuse("ASSISTANT_READ_STALE");
    if (target.kind === "queue") refuse();
  }
  return AssistantInlineSchema.parse({ kind: "link", label: protectedSubject ? "Protected test subject" : binding.value, target });
}

/** Model text is literal wording; only context-owned handles can insert server-authored facts. */
export function resolveAssistantReply(modelText: string, table: AssistantReferenceTable, bindings: readonly ServerReplyBinding[]): readonly AssistantReplyPart[] {
  z.string().min(1).max(8000).parse(modelText);
  const facts = new Map<string, AssistantInline>();
  for (const binding of bindings) {
    if (facts.has(binding.reference)) refuse("ASSISTANT_INVALID");
    facts.set(binding.reference, bindingInline(binding, table));
  }
  const runs = table.segments(modelText).map(segment => segment.kind === "text" ? { kind: "plain" as const, text: segment.text }
    : facts.get(segment.token) ?? refuse());
  return parts([{ kind: "text", runs }]);
}

export function assistantListParts(rows: readonly (readonly AssistantInline[])[], proof?: Readonly<{ complete: boolean; total: number; target: z.input<typeof AssistantDataTargetSchema> }>): readonly AssistantReplyPart[] {
  const items = z.array(z.array(AssistantInlineSchema).min(1).max(500)).min(1).parse(rows);
  if (items.length <= 8) return parts([{ kind: "bullets", items }]);
  if (proof?.complete !== true || proof.total !== items.length || !Number.isSafeInteger(proof.total)) refuse("ASSISTANT_LIMIT");
  const target = AssistantDataTargetSchema.parse(proof.target);
  if (target.kind !== "queue") refuse();
  return parts([{ kind: "text", runs: [{ kind: "plain", text: `${String(proof.total)} results. ` }, { kind: "link", label: "Show in Queue", target }] }]);
}

export function assistantProposalParts(rows: readonly (readonly AssistantInline[])[]): readonly AssistantReplyPart[] {
  return parts([{ kind: "bullets", items: z.array(z.array(AssistantInlineSchema).min(1)).min(1).max(20).parse(rows) }]);
}

export function assistantFailurePart(code: ErrorCatalogCode): AssistantReplyPart {
  return deepFreeze(AssistantReplyPartSchema.parse({ kind: "text", runs: [{ kind: "failure", code, text: "Failed" }, { kind: "plain", text: `: ${ERROR_CATALOG[code].text}` }] }));
}

export function assistantAnsweredPart(turn: AssistantAcceptedTurn, command: z.input<typeof CommandEnvelopeSchema>, binding: z.input<typeof AssistantActionBindingSchema>, at: string) {
  const accepted = AssistantAcceptedTurnSchema.parse(turn), envelope = CommandEnvelopeSchema.parse(command), action = AssistantActionBindingSchema.parse(binding);
  if (envelope.source !== "assistant" || Date.parse(at) < Date.parse(accepted.acceptedAt) || Date.parse(envelope.requestedAt) < Date.parse(accepted.acceptedAt)) refuse();
  if (action.kind === "proposal" && (accepted.proposalAnswer === null || accepted.proposalAnswer.proposalId !== action.proposalId)) refuse("ASSISTANT_READ_STALE");
  return deepFreeze(AssistantReplyPartSchema.parse({ kind: "answered", at, attribution: { kind: "assistant", requestedBy: envelope.requestedBy,
    profileId: accepted.profileId, conversationId: accepted.conversationId, acceptedMessageId: accepted.messageId, binding: action } }));
}

export function assistantSessionPart(row: RunRecord, workflowLabel: string) {
  return deepFreeze(AssistantSessionPartSchema.parse({ kind: "session", runId: row.envelope.runId,
    label: protectedSubjectDisplay(row.input.parsed.protectedBindings, () => ({ title: row.displayName ?? workflowLabel })).title, meta: deriveRunStatus(row) }));
}

/** Fresh projection only. Integration must prove owned read-session provenance before offering Stop through the dashboard command client. */
export function readAssistantSession(part: z.infer<typeof AssistantSessionPartSchema>, readCurrent: (runId: string) => Readonly<{ run: RunRecord; surface: QueueSurfaceWire }> | undefined) {
  const stored = AssistantSessionPartSchema.parse(part), current = readCurrent(stored.runId);
  if (current === undefined) return refuse();
  const row = current.run, surface = QueueSurfaceWireSchema.parse(current.surface);
  if (row.envelope.runId !== stored.runId || surface.runId !== stored.runId || surface.itemId !== row.envelope.itemId
    || surface.workflowId !== row.envelope.workflow || surface.traceId !== row.envelope.traceId || Number(surface.rowRevision) !== Number(row.version)) refuse("ASSISTANT_READ_STALE");
  const eligible = surface.actions.filter(action => action.kind === "command" && action.command === "cancel");
  if (eligible.length > 1 || eligible.some(action => action.kind !== "command" || action.expectedVersion !== row.version)) refuse("ASSISTANT_READ_STALE");
  const stop = row.lifecycle.state === "terminal" || row.cancelRequested === true || TERMINAL_QUEUE_STATUSES.has(surface.status) || surface.status === "cancelling" || eligible.length === 0
    ? null : { runId: stored.runId, descriptor: eligible[0] };
  return deepFreeze(AssistantSessionViewSchema.parse({ runId: stored.runId, rowRevision: row.version,
    label: protectedSubjectDisplay(row.input.parsed.protectedBindings, () => ({ title: surface.title })).title, meta: surface.status, state: surface.status, stop }));
}
