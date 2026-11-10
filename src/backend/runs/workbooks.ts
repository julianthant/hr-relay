import type { TimelineEventRecord } from "../../models/events/timeline.js";
import { readTimelineRecords } from "../storage/events/timeline-reader.js";
import { authenticateRootRun } from "../storage/sqlite/delegation-root-authority.js";
import { validateNativeLifecycleRequest } from "../storage/sqlite/native-lifecycle-request.js";
import { CanonicalWorkerTransitionRequestSchema } from "../storage/sqlite/run-store-contracts.js";
import { parseCanonicalInputSnapshot } from "../../models/workflow/canonical-input.js";
import { z } from "zod";
import type { AuthorityDatabase, AuthorityRepositories } from "../storage/sqlite/authority-database.js";
import { RunWorkbookSnapshotReferenceSchema, RunWorkbookNamedReferenceSchema, CapturedWorkbookWriteSourceSchema, parseRunWorkbookReference, encodeSavedWorkbook, type WorkbookOperationReceipt, type WorkbookOperationRecord } from "../../models/dashboard/workbooks.js";
import { ActionDescriptorWireSchema, type ActionDescriptorWire } from "../../models/dashboard/actions.js";
import type { RunDecisionWire } from "../../models/dashboard/run-decision.js";
import { projectDecision } from "./decisions/project-decision.js";
import { DECISION_CATALOG } from "./decisions/decision-catalog.js";
import type { DecisionAnswerer } from "./decisions/decision-answer.js";
import { NativeRunEventWireSchema, RunWorkbookWritesWireSchema, WorkbookReferenceRowCandidateWireSchema, RunWorkbookReferenceChoiceWireSchema, type RunWorkbookReferenceChoiceWire, type RunWorkbookWritesWire } from "../../models/dashboard/run-detail.js";

import { WorkbookReferenceWriteSchema } from "../../models/processing/workbooks/read-result.js";
import { schemaBoundValueSchema, deriveSchemaHash, type SchemaBoundCanonicalValue } from "../../models/validation/schema-bound-value.js";
import type { RunRecord } from "../../models/run/record.js";
import type { CommandRequest } from "../../rules/commands/commands.js";
import { deriveStableUuid, lifecycleCommandId } from "../../rules/identity/identifiers.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../rules/validation/sha256.js";
import { localDatePart, type Clock } from "../../rules/time/clock.js";
import { WorkbookLibraryError } from "../workbooks/workbook-library-error.js";
import { snapshotRetainedWorkbookReference, writeRecordedRunWorkbook, readRetainedWorkbookReference, verifyRetainedNamedWorkbookReference } from "../workbooks/workbook-library-service.js";
import type { AnyWorkflowDescriptor } from "../../workflow-kit/workflow.js";
import { WorkbookReferenceReadRequestSchema, WorkbookReferenceReadSchema } from "../../models/processing/workbooks/read-reference.js";
import { OnboardingCanonicalInput, OnboardingCanonicalValueSchema, OnboardingInput } from "../../models/workflows/onboarding/input.js";
import { ONBOARDING_ROSTER_GATE_ID, ONBOARDING_ROSTER_TYPE_ID, OnboardingRosterChoiceSchema } from "../../models/workflows/onboarding/roster.js";
import { bindOnboardingRosterSources, onboardingRosterRow } from "../../rules/onboarding/roster.js";
import { deriveGateResultCheckpointFingerprint, type GateResultRecord } from "../../models/workflow/gates.js";
import { readRunCheckpoint, readContinuationGate, validateRunContinuation } from "../storage/sqlite/run-continuation.js";
import { rejectCommandRequest } from "./commands/command-refusal.js";
import { OcrCanonicalInput } from "../../models/workflows/ocr/input.js";
import { EmergencyContactCanonicalInput } from "../../models/workflows/emergency-contact/input.js";
import { bindOcrRoster } from "../../models/workflows/ocr/roster.js";
import { CrmDocDownloadCanonicalInput } from "../../models/workflows/crm-doc-download/input.js";
import { ReadCrmDocumentRows, CrmDocumentRowCandidateSchema, CrmDocumentRowChoiceSchema, CRM_DOCUMENT_ROW_CHOICE_GATE_ID } from "../../models/workflows/crm-doc-download/read-document-rows.js";
import { taskImplFingerprint } from "../../workflow-kit/fingerprints.js";
import { workbookMatches } from "../workbooks/master-changes.js";


const onboardingInputBinding = Object.freeze({
  sourceToIngress(source: unknown) {
    const { roster: _roster, ...input } = OnboardingCanonicalValueSchema.parse(source);
    return OnboardingInput.parse(input);
  },
  assertSubmission(input: unknown) {
    if (input !== null && typeof input === "object" && Object.hasOwn(input, "roster")) {
      throw new Error("Onboarding roster values are captured by Relay; caller-supplied roster input is invalid");
    }
  },
  bind(input: unknown, references: readonly SchemaBoundCanonicalValue[] | undefined, capturedAt: string) {
    if (input === null || typeof input !== "object" || Array.isArray(input)) throw new WorkbookLibraryError("WORKBOOK_INVALID");
    const email = OnboardingInput.shape.email.parse(Reflect.get(input, "email"));
    if (references === undefined || references.length === 0) throw new WorkbookLibraryError("WORKBOOK_INVALID");
    if (references.length === 1) {
      const retained = parseRunWorkbookReference(references[0]);
      if ("mode" in retained.request) throw new WorkbookLibraryError("WORKBOOK_INVALID");
      const selection = "selectedRow" in retained.request ? retained.request.selectedRow : undefined;
      const selectedEmail = selection === undefined ? email : OnboardingInput.shape.email.parse(retained.snapshot.rows
        .flatMap(row => row.matches).find(match => match.sheetId === selection.sheetId && match.rowId === selection.rowId)?.values.email);
      if (selectedEmail !== email) throw new WorkbookLibraryError("WORKBOOK_INVALID");
      return { ...input, email: selectedEmail, roster: bindOnboardingRosterSources(references, selectedEmail, capturedAt) };
    }
    if (references.some(reference => "selectedRow" in parseRunWorkbookReference(reference).request)) throw new WorkbookLibraryError("WORKBOOK_INVALID");
    return { ...input, email, roster: bindOnboardingRosterSources(references, email, capturedAt) };
  },
});
const ocrInputBinding = Object.freeze({
  assertSubmission(input: unknown) {
    if (input !== null && typeof input === "object" && Reflect.get(input, "roster") != null) {
      throw new Error("OCR roster values are captured by Relay; caller-supplied roster input is invalid");
    }
  },
  bind(input: unknown, references: readonly SchemaBoundCanonicalValue[] | undefined, capturedAt: string) {
    if (input === null || typeof input !== "object" || Array.isArray(input) || references?.length !== 1) throw new WorkbookLibraryError("WORKBOOK_INVALID");
    return { ...input, roster: bindOcrRoster(references[0], capturedAt) };
  },
});
interface WorkbookInputBinding {
  sourceToIngress?(this: void, source: unknown): unknown;
  assertSubmission(input: unknown): void;
  bind(input: unknown, references: readonly SchemaBoundCanonicalValue[] | undefined, capturedAt: string): unknown;
}
const workbookInputBindings: ReadonlyMap<object, WorkbookInputBinding> = new Map<object, WorkbookInputBinding>([
  [OnboardingCanonicalInput, onboardingInputBinding], [OcrCanonicalInput, ocrInputBinding], [EmergencyContactCanonicalInput, ocrInputBinding],
]);

export function workbookInputBinding(canonicalInput: object) {
  return workbookInputBindings.get(canonicalInput);
}

type Reference = z.infer<typeof RunWorkbookSnapshotReferenceSchema>;
type ReferenceCommand = Extract<CommandRequest, { type: "resolve-workbook-reference-row" }>;
type RowCommand = Extract<CommandRequest, { type: "resolve-workbook-row" }>;
const crmReferenceWorkflows = new Set(["crm-doc-download", "crm-doc-download-reference", "crm-doc-download-package-worksheets"]);


function references(run: RunRecord): readonly Readonly<{ value: Reference; digest: string; bound: SchemaBoundCanonicalValue }>[] {
  const parsed = (run.input.workbookReferences ?? []).map(bound => ({
    value: parseRunWorkbookReference(bound),
    digest: sha256Hex(canonicalJsonStringify(bound)), bound,
  }));
  const identity = (reference: Reference) => {
    const versionId = "versionId" in reference.snapshot ? reference.snapshot.versionId : "";
    return JSON.stringify([reference.snapshot.libraryId, versionId, reference.snapshot.worksheets.map(sheet => sheet.sheetId)]);
  };
  if (new Set(parsed.map(reference => identity(reference.value))).size !== parsed.length) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
  return parsed;
}

function referencesFor(run: RunRecord, typeId: string) {
  const found = references(run).filter(reference => reference.value.request.typeId === typeId);
  if (found.length === 0 || found.some(reference => "mode" in reference.value.request)) throw new WorkbookLibraryError("WORKBOOK_INVALID");
  return found;
}

function referenceOfOperation(run: RunRecord, entry: WorkbookOperationRecord) {
  const source = entry.operation.source;
  const found = (source.kind !== "run" && source.kind !== "run-reference") || source.runId !== run.envelope.runId ? undefined
    : references(run).find(reference => reference.digest === source.referenceDigest && reference.value.snapshot.libraryId === entry.libraryId);
  if (found === undefined) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
  const change = entry.operation.change;
  if ("mode" in found.value.request || (change.kind !== "patch" && change.kind !== "add") || !found.value.request.keys.includes(change.key)
    || Object.keys(change.values).some(field => !found.value.request.fields.includes(field))) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
  if (source.kind === "run-reference") {
    const authority = source.authority, request = found.value.request, snapshot = found.value.snapshot;
    if (!("versionId" in snapshot) || snapshot.versionId !== authority.versionId
      || !snapshot.worksheets.some(sheet => sheet.sheetId === authority.sheetId)
      || snapshot.type.keyFieldId !== authority.keyFieldId
      || authority.requiredFields.length !== request.fields.length
      || authority.requiredFields.some(field => !request.fields.includes(field))
      || Object.keys(change.values).some(field => !authority.writableFields.includes(field))) {
      throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
    }
  }
  return found;
}

/** D11's answer: the resolving write's recorded command, at the time it was recorded. */
function rowAnswer(repositories: AuthorityRepositories, run: RunRecord, resolving: WorkbookOperationRecord, answer: DecisionAnswerer) {
  const event = repositories.timelineEvents.get(operationEventId(run.envelope.runId, resolving.libraryId, resolving.operation.operationId));
  if (event?.payload.kind !== "workbook-write-recorded" || event.payload.resolvedBy === undefined) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
  return answer(event.payload.resolvedBy, { id: "confirm", label: DECISION_CATALOG["workbook-row"].options[0]?.label ?? "Confirm row" }, event.payload.at);
}

function operationEventId(runId: string, libraryId: string, operationId: string) {
  return deriveStableUuid("run-workbook-write", canonicalJsonStringify({ runId, libraryId, operationId }));
}

function appendReceipt(repositories: AuthorityRepositories, run: RunRecord, receipt: WorkbookOperationReceipt, resolvedBy?: string) {
  const eventId = operationEventId(run.envelope.runId, receipt.libraryId, receipt.operationId);
  const digest = sha256Hex(canonicalJsonStringify(receipt));
  const existing = repositories.timelineEvents.get(eventId);
  if (existing !== undefined) {
    if (existing.payload.kind !== "workbook-write-recorded" || existing.payload.runId !== run.envelope.runId
      || existing.payload.libraryId !== receipt.libraryId || existing.payload.operationId !== receipt.operationId
      || existing.payload.receiptDigest !== digest) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
    return;
  }
  repositories.timelineEvents.append({ schemaVersion: 1, eventId, workflow: run.envelope.workflow,
    scope: { kind: "run", runId: run.envelope.runId }, occurredAt: receipt.at, recordedAt: receipt.at,
    retentionDate: localDatePart(new Date(receipt.at)), source: { kind: "native" },
    payload: { kind: "workbook-write-recorded", runId: run.envelope.runId, workflow: run.envelope.workflow,
      attempt: run.envelope.attempt, traceId: run.envelope.traceId, claimGeneration: run.claimGeneration,
      libraryId: receipt.libraryId, operationId: receipt.operationId, receiptDigest: digest, at: receipt.at,
      ...(resolvedBy === undefined ? {} : { resolvedBy }) } });
}

function capturedOperations(repositories: AuthorityRepositories, run: RunRecord) {
  const entries = repositories.workbooks.runOperations(run.envelope.runId)
    .filter(entry => (entry.operation.source.kind === "run" || entry.operation.source.kind === "run-reference") && entry.operation.source.referenceDigest !== undefined);
  for (const entry of entries) referenceOfOperation(run, entry);
  return entries;
}

function resolvingEntry(entries: readonly WorkbookOperationRecord[], entry: WorkbookOperationRecord): WorkbookOperationRecord | undefined {
  return entries.find(candidate => candidate.libraryId === entry.libraryId && candidate.receipt.state === "applied"
    && candidate.operation.change.kind === "patch" && candidate.operation.change.resolves?.operationId === entry.operation.operationId);
}

function liveCandidates(repositories: AuthorityRepositories, reference: Reference, key: string, historical = false) {
  if ("mode" in reference.request) throw new WorkbookLibraryError("WORKBOOK_INVALID");
  if (!historical && "versionId" in reference.snapshot && reference.snapshot.versionId !== undefined
    && reference.snapshot.worksheets.length === 1) {
    verifyRetainedNamedWorkbookReference(repositories.workbooks, reference);
    const record = repositories.workbooks.read(reference.snapshot.libraryId);
    const capturedSheet = reference.snapshot.worksheets[0];
    const state = repositories.workbooks.libraryState(reference.snapshot.libraryId);
    if (record === undefined || capturedSheet === undefined
      || state.removed || state.selectedVersionId !== reference.snapshot.versionId) {
      throw new WorkbookLibraryError("WORKBOOK_VERSION_CONFLICT");
    }
    const sheet = encodeSavedWorkbook(record).workbook.sheets.find(item => item.id === capturedSheet.sheetId);
    if (sheet === undefined || sheet.name !== capturedSheet.name) throw new WorkbookLibraryError("WORKBOOK_VERSION_CONFLICT");
    const bound = (field: string) => sheet.columnBindings?.filter(binding => binding.fieldId === field).length ?? 0;
    const fields = reference.request.fields;
    const keyFieldId = reference.snapshot.type.keyFieldId;
    if (keyFieldId === null) throw new WorkbookLibraryError("WORKBOOK_INVALID");
    if (bound(keyFieldId) !== 1 || new Set(fields).size !== fields.length || fields.some(field => bound(field) !== 1)) {
      throw new WorkbookLibraryError("WORKBOOK_VERSION_CONFLICT");
    }
    const candidates = workbookMatches({ ...encodeSavedWorkbook(record).workbook, sheets: [sheet] }, keyFieldId, key)
      .map(match => {
        const rowNumber = sheet.rows.findIndex(row => row.id === match.rowId) + 1;
        const values = Object.fromEntries(fields.map(field => {
          const column = sheet.columnBindings?.findIndex(binding => binding.fieldId === field) ?? -1;
          return [field, match.row.cells[column]?.value];
        }));
        return { sheetId: sheet.id, rowId: match.rowId, values, label: `${sheet.name} · Row ${rowNumber}`, rowNumber };
      });
    return { version: record.version, candidates };
  }
  const live = snapshotRetainedWorkbookReference(repositories.workbooks, { ...reference.request, libraryId: reference.snapshot.libraryId, keys: [key] });
  if (live.type.keyFieldId !== reference.snapshot.type.keyFieldId) throw new WorkbookLibraryError("WORKBOOK_INVALID");
  const sheets = new Set(reference.snapshot.worksheets.map(sheet => sheet.sheetId));
  const record = repositories.workbooks.read(live.libraryId);
  if (record === undefined || record.version !== live.version) throw new WorkbookLibraryError("WORKBOOK_VERSION_CONFLICT");
  const matches = live.rows[0];
  if (matches === undefined || matches.key !== key) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
  return { version: live.version, candidates: matches.matches.filter(match => sheets.has(match.sheetId)).map(match => {
    const sheet = record.workbook.sheets.find(sheet => sheet.id === match.sheetId);
    const row = sheet?.rows.findIndex(row => row.id === match.rowId);
    if (sheet === undefined || row === undefined || row < 0) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
    return { ...match, label: `${sheet.name} · Row ${row + 1}`, rowNumber: row + 1 };
  }) };
}

function liveOperationCandidates(repositories: AuthorityRepositories, reference: Reference, entry: WorkbookOperationRecord, key: string) {
  const source = entry.operation.source;
  if (source.kind !== "run-reference") return liveCandidates(repositories, reference, key, true);
  if (!("versionId" in reference.snapshot) || source.authority.versionId !== reference.snapshot.versionId) {
    throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
  }
  verifyRetainedNamedWorkbookReference(repositories.workbooks, reference);
  const capturedSheet = reference.snapshot.worksheets.find(sheet => sheet.sheetId === source.authority.sheetId);
  const current = repositories.workbooks.read(entry.libraryId);
  const state = repositories.workbooks.libraryState(entry.libraryId);
  if (capturedSheet === undefined || current === undefined
    || state.removed || state.selectedVersionId !== source.authority.versionId)
    throw new WorkbookLibraryError("WORKBOOK_VERSION_CONFLICT");
  const workbook = encodeSavedWorkbook(current).workbook;
  const sheet = workbook.sheets.find(item => item.id === source.authority.sheetId);
  if (sheet === undefined || sheet.name !== capturedSheet.name
    || sheet.columnBindings?.filter(binding => binding.fieldId === source.authority.keyFieldId).length !== 1) {
    throw new WorkbookLibraryError("WORKBOOK_VERSION_CONFLICT");
  }
  const candidates = workbookMatches(workbook, source.authority.keyFieldId, key)
    .filter(match => match.sheetId === sheet.id).map(match => {
      const rowNumber = sheet.rows.findIndex(row => row.id === match.rowId) + 1;
      return { sheetId: sheet.id, rowId: match.rowId, label: `${sheet.name} · Row ${rowNumber}`, rowNumber };
    });
  return { version: current.version, candidates };
}
function expectedSourceChange(cause: unknown): cause is WorkbookLibraryError {
  return cause instanceof WorkbookLibraryError && (cause.code === "WORKBOOK_VERSION_CONFLICT"
    || cause.code === "WORKBOOK_NOT_FOUND" || cause.code === "WORKBOOK_REVISION_UNAVAILABLE");
}

function onboardingReference(run: RunRecord) {
  if (run.envelope.workflow !== "onboarding") throw new WorkbookLibraryError("WORKBOOK_INVALID");
  const input = parseCanonicalInputSnapshot(OnboardingCanonicalInput, run.input.parsed);
  const roster = OnboardingCanonicalValueSchema.parse(input).roster;
  const group = references(run).filter(reference => reference.value.request.typeId === ONBOARDING_ROSTER_TYPE_ID);
  if (group.length === 0) throw new WorkbookLibraryError("WORKBOOK_INVALID");
  const binding = roster.state === "resolved" ? roster.row.binding : roster.binding;
  if (canonicalJsonStringify(bindOnboardingRosterSources(group.map(reference => reference.bound), input.email, binding.capturedAt))
    !== canonicalJsonStringify(roster)) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
  const reference = group.find(candidate => candidate.digest === binding.referenceDigest) ?? group[0];
  return { roster, reference, group, binding };
}

function referenceNative(run: RunRecord, record: TimelineEventRecord | undefined) {
  const event = record?.payload.kind === "span" ? record.payload.event : undefined;
  if (record === undefined || record.source.kind !== "native" || record.scope.kind !== "run"
    || record.scope.runId !== run.envelope.runId || record.workflow !== run.envelope.workflow
    || event === undefined || !("runId" in event) || event.runId !== run.envelope.runId
    || event.workflow !== run.envelope.workflow || event.traceId !== run.envelope.traceId
    || event.attempt > run.envelope.attempt || event.spanPath !== run.envelope.traceId
    || record.occurredAt !== event.ts) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
  return NativeRunEventWireSchema.parse({ eventId: record.eventId, order: record.cursor, runId: event.runId,
    attempt: event.attempt, traceId: event.traceId, spanPath: event.spanPath });
}

function queuedReferenceNative(repositories: AuthorityRepositories, run: RunRecord) {
  const authority = authenticateRootRun(repositories, run);
  const records = readTimelineRecords(repositories.timelineEvents, 0, run.envelope.runId).records
    .filter(record => record.payload.kind === "span" && record.payload.event.t === "run.queued");
  const record = records[0];
  const event = record?.payload.kind === "span" && record.payload.event.t === "run.queued" ? record.payload.event : undefined;
  const id = deriveStableUuid("timeline-span-singleton", canonicalJsonStringify({ scope: { kind: "run", runId: run.envelope.runId },
    attempt: run.envelope.attempt, spanPath: run.envelope.traceId, type: "run.queued" }));
  if (records.length !== 1 || record?.eventId !== id || event === undefined || event.ts !== run.envelope.enqueuedAt
    || event.attempt !== run.envelope.attempt || event.itemId !== run.envelope.itemId
    || event.actorId !== authority.command.requestedBy || event.descriptorVersion !== run.envelope.descriptorVersion
    || event.contractFingerprint !== run.envelope.contractFingerprint || event.configFingerprint !== run.envelope.configFingerprint
    || event.configSnapshotId !== run.envelope.configSnapshotId
    || canonicalJsonStringify(event.resolvedInstance) !== canonicalJsonStringify(run.envelope.resolvedInstance)) {
    throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
  }
  return referenceNative(run, record);
}

function pendingReferenceNative(repositories: AuthorityRepositories, run: RunRecord, gateId = ONBOARDING_ROSTER_GATE_ID) {
  if (run.lifecycle.state === "parked-gate" && run.lifecycle.gateId === gateId) {
    const lifecycle = run.lifecycle;
    const parked = repositories.lifecycleJournal.findGatePark(run.envelope.runId, lifecycle.gateId, run.version);
    if (parked === undefined) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
    validateNativeLifecycleRequest(parked);
    const audit = repositories.lifecycleJournal.findAuditByCommand(parked.commandId);
    const request = CanonicalWorkerTransitionRequestSchema.parse(parked.request);
    if (parked.operation !== "worker-transition" || audit === undefined || !("kind" in audit) || audit.kind !== "run-lifecycle"
      || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(parked) || audit.result.kind !== "run"
      || audit.result.runId !== run.envelope.runId || audit.result.appliedVersion > run.version
      || request.runId !== run.envelope.runId || Number(request.claim.claimGeneration) !== Number(run.claimGeneration)
      || canonicalJsonStringify(request.lifecycle) !== canonicalJsonStringify(lifecycle)) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
    const record = repositories.timelineEvents.get(lifecycleCommandId("timeline-lifecycle", parked.commandId));
    const event = record?.payload.kind === "span" ? record.payload.event : undefined;
    if (event?.t !== "gate.opened" || event.gate !== lifecycle.gateId || event.ts !== lifecycle.parkedAt) {
      throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
    }
    return referenceNative(run, record);
  }
  if (run.lifecycle.state === "terminal") {
    const lifecycle = run.lifecycle;
    const records = readTimelineRecords(repositories.timelineEvents, 0, run.envelope.runId).records
      .filter(record => record.payload.kind === "span" && record.payload.event.t === "span.ended" && record.payload.event.kind === "run");
    const record = records[0];
    const event = record?.payload.kind === "span" ? record.payload.event : undefined;
    if (records.length !== 1 || event?.t !== "span.ended" || event.kind !== "run" || event.outcome !== lifecycle.outcome
      || event.ts !== lifecycle.endedAt || lifecycle.outcome === "failed" && event.failureId !== lifecycle.failureId) {
      throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
    }
    return referenceNative(run, record);
  }
  return queuedReferenceNative(repositories, run);
}

export function authenticateOnboardingRosterChoice(repositories: AuthorityRepositories, run: RunRecord, gate: GateResultRecord) {
  const { roster, reference, group, binding } = onboardingReference(run);
  const row = schemaBoundValueSchema(OnboardingRosterChoiceSchema, deriveSchemaHash(OnboardingRosterChoiceSchema, "output")).parse(gate.result).value.row;
  const command = "commandId" in gate ? repositories.commands.get(gate.commandId) : undefined;
  const audit = "commandId" in gate ? repositories.commandAudits.findByCommand(gate.commandId) : undefined;
  const eventId = "commandId" in gate ? lifecycleCommandId("timeline-gate-resolved", gate.commandId) : undefined;
  const recorded = eventId === undefined ? undefined : repositories.timelineEvents.get(eventId);
  const native = recorded?.payload.kind === "span" && recorded.payload.event.t === "gate.resolved" ? recorded.payload.event : undefined;
  if (recorded?.source.kind !== "native" || recorded.eventId !== eventId || recorded.scope.kind !== "run" || recorded.scope.runId !== run.envelope.runId
    || recorded.workflow !== run.envelope.workflow || native === undefined || native.runId !== gate.runId
    || native.workflow !== run.envelope.workflow || native.traceId !== run.envelope.traceId || native.gate !== gate.gateId
    || native.attempt > run.envelope.attempt || native.ts !== gate.resolvedAt || recorded.occurredAt !== gate.resolvedAt
    || native.resultHash !== sha256Hex(`hrauto:gate-resolved-span:v1\0${canonicalJsonStringify(gate.result)}`)) {
    throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
  }
  if (roster.state !== "resolve-required" || gate.runId !== run.envelope.runId || gate.gateId !== ONBOARDING_ROSTER_GATE_ID
    || gate.nodeId !== ONBOARDING_ROSTER_GATE_ID || !("resolvedBy" in gate)
    || gate.checkpointFingerprint !== deriveGateResultCheckpointFingerprint(gate.result)
    || command?.family !== "run" || command.type !== "resolve-workbook-reference-row"
    || command.target.runId !== gate.runId || command.target.gateId !== gate.gateId || command.target.expectedVersion !== gate.expectedVersion
    || command.requestedBy !== gate.resolvedBy || command.target.referenceDigest !== binding.referenceDigest
    || command.target.libraryId !== binding.workbookId || command.target.typeId !== binding.workbookType || command.target.key !== binding.rowKey.email
    || row.binding.referenceDigest !== (command.payload.referenceDigest ?? reference.digest)
    || !group.some(candidate => candidate.digest === row.binding.referenceDigest && candidate.value.snapshot.libraryId === row.binding.workbookId
      && candidate.value.snapshot.worksheets.some(sheet => sheet.sheetId === row.binding.sheetId))
    || row.binding.workbookType !== binding.workbookType
    || row.binding.rowKey.email !== binding.rowKey.email
    || row.binding.workbookVersion !== (command.payload.workbookVersion ?? command.target.workbookVersion)
    || row.binding.capturedAt !== gate.resolvedAt || row.binding.sheetId !== command.payload.sheetId || row.binding.rowId !== command.payload.rowId
    || audit?.result.state !== "applied" || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(command)) {
    throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
  }
  return { row, native: referenceNative(run, recorded) };
}

export function authenticateOnboardingRosterExecution(repositories: AuthorityRepositories, run: RunRecord) {
  if (run.envelope.workflow !== "onboarding") return;
  const { roster } = onboardingReference(run);
  validateRunContinuation(repositories, run.envelope);
  const gate = readContinuationGate(repositories, run.envelope, ONBOARDING_ROSTER_GATE_ID);
  if (gate === undefined) {
    if (roster.state === "resolve-required" && run.lifecycle.state === "terminal" && run.lifecycle.outcome === "done") {
      throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
    }
    return;
  }
  if (roster.state !== "resolve-required") throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
  const source = repositories.runs.get(gate.runId);
  if (source === undefined || source.input.workbookReferences === undefined || run.input.workbookReferences === undefined
    || canonicalJsonStringify(source.input.parsed) !== canonicalJsonStringify(run.input.parsed)
    || canonicalJsonStringify(source.input.workbookReferences) !== canonicalJsonStringify(run.input.workbookReferences)) {
    throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
  }
  return { ...authenticateOnboardingRosterChoice(repositories, source, gate), gate };
}

function authenticateCrmReferenceChoice(repositories: AuthorityRepositories, run: RunRecord, gate: GateResultRecord) {
  const data = crmReferenceRows(repositories, run);
  if (data === undefined || data.rows.state !== "resolve-required" || !("commandId" in gate)) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
  const complete = completeCrmReferenceChoice(data, crmReferenceSelections(repositories, run, data));
  const command = repositories.commands.get(gate.commandId), audit = repositories.commandAudits.findByCommand(gate.commandId);
  const recorded = repositories.timelineEvents.get(lifecycleCommandId("timeline-gate-resolved", gate.commandId));
  const event = recorded?.payload.kind === "span" && recorded.payload.event.t === "gate.resolved" ? recorded.payload.event : undefined;
  if (complete === undefined || gate.runId !== run.envelope.runId || gate.gateId !== CRM_DOCUMENT_ROW_CHOICE_GATE_ID || String(gate.nodeId) !== String(gate.gateId)
    || gate.result.schemaHash !== deriveSchemaHash(CrmDocumentRowChoiceSchema, "output")
    || gate.checkpointFingerprint !== deriveGateResultCheckpointFingerprint(gate.result)
    || canonicalJsonStringify(gate.result.value) !== canonicalJsonStringify(complete)
    || command?.family !== "run" || command.type !== "resolve-workbook-reference-row"
    || command.target.runId !== gate.runId || command.target.gateId !== gate.gateId || command.target.expectedVersion !== gate.expectedVersion
    || command.requestedBy !== gate.resolvedBy || audit?.result.state !== "applied" || audit.completedAt !== gate.resolvedAt
    || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(command)
    || event === undefined || event.gate !== gate.gateId || event.ts !== gate.resolvedAt
    || event.resultHash !== sha256Hex(`hrauto:gate-resolved-span:v1\0${canonicalJsonStringify(gate.result)}`) || recorded === undefined) {
    throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
  }
  return { native: referenceNative(run, recorded) };
}

export function authenticateWorkbookReferenceChoice(repositories: AuthorityRepositories, run: RunRecord, gate: GateResultRecord) {
  return crmReferenceWorkflows.has(run.envelope.workflow) ? authenticateCrmReferenceChoice(repositories, run, gate)
    : authenticateOnboardingRosterChoice(repositories, run, gate);
}

export function authenticateWorkbookReferenceExecution(repositories: AuthorityRepositories, run: RunRecord) {
  if (!crmReferenceWorkflows.has(run.envelope.workflow)) return authenticateOnboardingRosterExecution(repositories, run);
  const data = crmReferenceRows(repositories, run);
  validateRunContinuation(repositories, run.envelope);
  const gate = readContinuationGate(repositories, run.envelope, CRM_DOCUMENT_ROW_CHOICE_GATE_ID);
  if (gate === undefined) {
    if (data?.rows.state === "resolve-required" && run.lifecycle.state === "terminal" && run.lifecycle.outcome === "done") throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
    return;
  }
  const source = repositories.runs.get(gate.runId);
  if (source === undefined || canonicalJsonStringify(source.input.parsed) !== canonicalJsonStringify(run.input.parsed)
    || canonicalJsonStringify(source.input.workbookReferences) !== canonicalJsonStringify(run.input.workbookReferences)) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
  return { ...authenticateCrmReferenceChoice(repositories, source, gate), gate };
}

function crmReferenceRows(repositories: AuthorityRepositories, run: RunRecord) {
  const checkpoint = readRunCheckpoint(repositories, run.envelope, "document-rows", true);
  if (checkpoint === undefined) return undefined;
  const owner = checkpoint.runId === run.envelope.runId ? run : repositories.runs.get(checkpoint.runId);
  if (owner === undefined || checkpoint.runId !== run.envelope.runId && run.envelope.continuation === undefined
    || canonicalJsonStringify(owner.input.parsed) !== canonicalJsonStringify(run.input.parsed)
    || canonicalJsonStringify(owner.input.workbookReferences) !== canonicalJsonStringify(run.input.workbookReferences)
    || checkpoint.workflowId !== run.envelope.workflow || checkpoint.itemId !== run.envelope.itemId
    || checkpoint.nodeId !== "document-rows" || checkpoint.attempt > run.envelope.attempt || Number(checkpoint.claimGeneration) > Number(owner.claimGeneration)
    || checkpoint.descriptorVersion !== run.envelope.descriptorVersion
    || checkpoint.contractFingerprint !== run.envelope.contractFingerprint
    || checkpoint.implFingerprint !== taskImplFingerprint(ReadCrmDocumentRows)
    || checkpoint.output.schemaHash !== deriveSchemaHash(ReadCrmDocumentRows.output, "output")) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
  const rows = ReadCrmDocumentRows.output.parse(checkpoint.output.value);
  const sources = referencesFor(run, ONBOARDING_ROSTER_TYPE_ID).map(reference => ({
    ...reference, value: RunWorkbookNamedReferenceSchema.parse(reference.value),
  }));
  const input = parseCanonicalInputSnapshot(CrmDocDownloadCanonicalInput, run.input.parsed);
  if (canonicalJsonStringify(rows.sourceDigests) !== canonicalJsonStringify(sources.map(source => source.digest))
    || sources.some(source => source.value.snapshot.versionId === undefined)
    || canonicalJsonStringify(rows.people.map(person => person.subject)) !== canonicalJsonStringify(input.people)) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
  return { rows, sources, sourceAttempt: checkpoint.attempt, checkpointDigest: sha256Hex(canonicalJsonStringify(checkpoint)) };
}
type CrmRows = NonNullable<ReturnType<typeof crmReferenceRows>>;
type CrmSelection = Readonly<{ candidate: z.infer<typeof CrmDocumentRowCandidateSchema>; record: TimelineEventRecord }>;

function crmReferenceSelections(repositories: AuthorityRepositories, run: RunRecord, data: CrmRows) {
  const selections = new Map<string, CrmSelection>();
  const anchor = data.sources[0];
  for (const record of readTimelineRecords(repositories.timelineEvents, 0, run.envelope.runId).records) {
    const event = record.payload;
    if (event.kind !== "workbook-reference-row-selected" || event.attempt < data.sourceAttempt) continue;
    const command = repositories.commands.get(event.commandId), audit = repositories.commandAudits.findByCommand(event.commandId);
    const person = data.rows.people.find(person => person.subject.value === event.key);
    const source = data.sources.find(item => item.digest === event.referenceDigest);
    const referenceCommand = command?.type === "resolve-workbook-reference-row" ? command : undefined;
    const chosenDigest = referenceCommand?.payload.referenceDigest ?? (data.sources.length === 1 ? anchor?.digest : undefined);
    const candidate = person?.resolution.state === "resolve-required"
      ? person.resolution.candidates.find(candidate => candidate.referenceDigest === event.referenceDigest && candidate.row.worksheetId === event.sheetId && candidate.row.rowId === event.rowId) : undefined;
    if (record.source.kind !== "native" || record.scope.kind !== "run" || record.scope.runId !== run.envelope.runId || record.workflow !== run.envelope.workflow
      || event.runId !== run.envelope.runId || event.workflow !== run.envelope.workflow || event.traceId !== run.envelope.traceId
      || event.attempt !== data.sourceAttempt || event.gateId !== CRM_DOCUMENT_ROW_CHOICE_GATE_ID
      || anchor === undefined || source === undefined || chosenDigest !== event.referenceDigest || event.checkpointDigest !== data.checkpointDigest
      || record.occurredAt !== event.at || record.recordedAt !== event.at
      || record.eventId !== deriveStableUuid("workbook-reference-row-selected", event.commandId)
      || command?.family !== "run" || command.type !== "resolve-workbook-reference-row"
      || command.target.runId !== event.runId || command.target.gateId !== event.gateId || command.target.key !== event.key
      || command.target.referenceDigest !== anchor.digest || command.target.libraryId !== anchor.value.snapshot.libraryId
      || command.target.typeId !== ONBOARDING_ROSTER_TYPE_ID || command.target.workbookVersion !== anchor.value.snapshot.version
      || (command.payload.referenceDigest === undefined) !== (data.sources.length === 1)
      || command.payload.workbookVersion !== undefined && command.payload.workbookVersion !== source.value.snapshot.version
      || command.payload.sheetId !== event.sheetId || command.payload.rowId !== event.rowId
      || audit?.result.state !== "applied" || audit.completedAt !== event.at || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(command)
      || candidate === undefined || selections.has(event.key)) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
    selections.set(event.key, { candidate, record });
  }
  return selections;
}

function completeCrmReferenceChoice(data: CrmRows, selections: ReadonlyMap<string, CrmSelection>) {
  if (data.rows.people.some(person => person.resolution.state !== "resolved" && !selections.has(person.subject.value))) return undefined;
  return CrmDocumentRowChoiceSchema.parse({ ...data.rows, state: "resolved", decision: "selected", people: data.rows.people.map(person => {
    if (person.resolution.state === "resolved") return person;
    const selected = selections.get(person.subject.value);
    if (selected === undefined) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
    return { ...person, resolution: { state: "resolved", selected: selected.candidate } };
  }) });
}

const FIELD_LABELS: Readonly<Record<string, string>> = { email: "Email", fullName: "Legal name", livedName: "Lived name", firstName: "First name", lastName: "Last name", middleName: "Middle name",
  "roster.livedFirstName": "Lived first name", "roster.livedLastName": "Lived last name", "roster.livedMiddleName": "Lived middle name" };

type PickCandidate = Readonly<{ sheetId: string; rowId: string; label: string; rowNumber?: number;
  referenceDigest?: string; workbookVersion?: number;
  values?: z.infer<typeof WorkbookReferenceRowCandidateWireSchema>["values"] }>;

/** D3 / D11: confirm one served candidate row. A typed row number is offered only when every candidate's row number is known and unique. */
export function rowPickDecision(type: "pick-row" | "workbook-row", title: string, action: ActionDescriptorWire, candidates: readonly PickCandidate[]): RunDecisionWire {
  const fields = candidates[0]?.values?.map(({ fieldId }) => fieldId) ?? [];
  const numbers = candidates.flatMap(({ rowNumber }) => rowNumber === undefined ? [] : [rowNumber]);
  const typed = numbers.length === candidates.length && new Set(numbers).size === numbers.length;
  return projectDecision(type, [{ id: "confirm", send: { via: "action", actionKey: action.key },
    ...(action.kind === "command" && action.confirm !== undefined ? { confirm: action.confirm } : {}),
    input: { kind: "candidate", table: {
      title,
      columns: [{ id: "row", label: "Row" }, ...fields.map(fieldId => ({ id: fieldId, label: FIELD_LABELS[fieldId] ?? fieldId }))],
      rows: candidates.map(candidate => ({ id: candidate.referenceDigest === undefined ? `${candidate.sheetId}/${candidate.rowId}` : `${candidate.referenceDigest}/${candidate.sheetId}/${candidate.rowId}`,
        name: candidate.label, sheetId: candidate.sheetId, rowId: candidate.rowId,
        ...(candidate.rowNumber === undefined ? {} : { rowNumber: candidate.rowNumber }),
        cells: [{ columnId: "row", value: candidate.label }, ...(candidate.values ?? []).map(({ fieldId, value }) => ({ columnId: fieldId, value: value === null ? "" : typeof value === "object" ? value.value : String(value) }))] })),
      ...(typed ? { typed: { label: "Enter row number", placeholder: "Row number", pattern: "^[1-9]\\d*$" } } : {}),
    } } }], { title: type === "pick-row" ? "Which row should Relay use?" : "Which row should Relay update?", context: `${candidates.length} rows match this person.` });
}

function crmCandidateWire(candidate: z.infer<typeof CrmDocumentRowCandidateSchema>, multiple: boolean, version: number) {
  const { row, key } = candidate, { legalName, livedName } = row.names;
  return WorkbookReferenceRowCandidateWireSchema.parse({ sheetId: row.worksheetId, rowId: row.rowId,
    label: `${row.worksheetName} · ${legalName.lastName}, ${legalName.firstName} · ${row.rowId}`,
    ...(multiple ? { referenceDigest: candidate.referenceDigest, workbookVersion: version } : {}),
    values: [{ fieldId: "email", value: key }, { fieldId: "firstName", value: legalName.firstName }, { fieldId: "lastName", value: legalName.lastName },
      { fieldId: "middleName", value: legalName.middleName }, { fieldId: "roster.livedFirstName", value: livedName === null ? null : livedName.firstName },
      { fieldId: "roster.livedLastName", value: livedName === null ? null : livedName.lastName }, { fieldId: "roster.livedMiddleName", value: livedName === null ? null : livedName.middleName }],
  });
}

function buildCrmReferenceChoices(repositories: AuthorityRepositories, run: RunRecord, answer: DecisionAnswerer | undefined): RunWorkbookReferenceChoiceWire[] {
  const data = crmReferenceRows(repositories, run);
  if (data === undefined || data.rows.state === "resolved") return [];
  const execution = authenticateWorkbookReferenceExecution(repositories, run);
  const owner = execution === undefined ? run : repositories.runs.get(execution.gate.runId);
  if (owner === undefined) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
  const source = owner.envelope.runId === run.envelope.runId ? data : crmReferenceRows(repositories, owner);
  if (source === undefined) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
  const selections = crmReferenceSelections(repositories, owner, source);
  return data.rows.people.flatMap((person): z.input<typeof RunWorkbookReferenceChoiceWireSchema>[] => {
    if (person.resolution.state === "resolved") return [];
    const anchor = data.sources[0];
    if (anchor === undefined || anchor.value.snapshot.versionId === undefined) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
    const key = person.subject.value, multiple = data.sources.length > 1;
    const base = { libraryId: anchor.value.snapshot.libraryId, typeId: ONBOARDING_ROSTER_TYPE_ID,
      referenceDigest: anchor.digest, key, reason: person.resolution.reason };
    const selected = selections.get(key);
    if (selected !== undefined) {
      const event = selected.record.payload;
      const chosen = data.sources.find(item => item.digest === selected.candidate.referenceDigest);
      if (event.kind !== "workbook-reference-row-selected" || chosen === undefined) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
      const native = owner.envelope.runId !== run.envelope.runId ? queuedReferenceNative(repositories, run)
        : NativeRunEventWireSchema.parse({ eventId: selected.record.eventId, order: selected.record.cursor, runId: run.envelope.runId,
          attempt: event.attempt, traceId: run.envelope.traceId, spanPath: run.envelope.traceId, nodeId: event.gateId });
      const picked = crmCandidateWire(selected.candidate, multiple, chosen.value.snapshot.version);
      return [{ ...base, native, resolution: { state: "resolved", workbookVersion: chosen.value.snapshot.version, resolvedAt: event.at, selected: picked,
        ...(answer === undefined ? {} : { answer: answer(event.commandId, { id: "confirm", label: picked.label }, event.at) }) } }];
    }
    const native = pendingReferenceNative(repositories, run, CRM_DOCUMENT_ROW_CHOICE_GATE_ID);
    if (run.lifecycle.state !== "parked-gate" || run.lifecycle.gateId !== CRM_DOCUMENT_ROW_CHOICE_GATE_ID || person.resolution.candidates.length === 0) {
      return [{ ...base, native, resolution: { state: "unavailable", code: "WORKBOOK_ROW_CHOICE_UNAVAILABLE", candidates: [] } }];
    }
    const target = { runId: run.envelope.runId, expectedVersion: run.version, libraryId: base.libraryId, typeId: base.typeId,
      referenceDigest: base.referenceDigest, key, workbookVersion: anchor.value.snapshot.version, gateId: CRM_DOCUMENT_ROW_CHOICE_GATE_ID };
    const action = ActionDescriptorWireSchema.parse({
      kind: "command", key: "resolve-workbook-reference-row", command: "resolve-workbook-reference-row", label: "Choose a worksheet row",
      intent: "primary", icon: "resolve", placement: ["review"], expectedVersion: run.version, referenceTarget: target,
      confirm: { title: "Use this worksheet row", body: "Relay retains this row from the selected spreadsheet version. The batch continues after every person has a resolved row.", confirmLabel: "Use row", tone: "neutral" },
    });
    const legal = person.resolution.candidates[0]?.row.names.legalName;
    const numbered = person.resolution.candidates.map(candidate => {
      const captured = data.sources.find(item => item.digest === candidate.referenceDigest);
      if (captured === undefined || captured.value.snapshot.versionId === undefined) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
      const wire = crmCandidateWire(candidate, multiple, captured.value.snapshot.version);
      const workbook = repositories.workbooks.libraryVersion(captured.value.snapshot.libraryId, captured.value.snapshot.versionId).workbook;
      const index = workbook.sheets.find(sheet => sheet.id === wire.sheetId)?.rows.findIndex(row => row.id === wire.rowId);
      return { wire, rowNumber: index === undefined || index < 0 ? undefined : index + 1 };
    });
    const candidates = numbered.map(item => item.wire);
    const picks = numbered.map(item => item.rowNumber === undefined ? item.wire : { ...item.wire, rowNumber: item.rowNumber });
    return [{ ...base, native, resolution: { state: "available", target, candidates, action,
      decision: rowPickDecision("pick-row", legal === undefined ? "Worksheet rows" : `${legal.firstName} ${legal.lastName}`, action, picks) } }];
  }).map(choice => RunWorkbookReferenceChoiceWireSchema.parse(choice));
}

function resolveCrmReference(repositories: AuthorityRepositories, run: RunRecord, command: ReferenceCommand, capturedAt: string) {
  const data = crmReferenceRows(repositories, run);
  const anchor = data?.sources[0];
  const chosenDigest = command.payload.referenceDigest ?? (data !== undefined && data.sources.length === 1 ? anchor?.digest : undefined);
  const source = data?.sources.find(item => item.digest === chosenDigest);
  if (data === undefined || data.rows.state !== "resolve-required" || anchor === undefined || source === undefined
    || command.target.gateId !== CRM_DOCUMENT_ROW_CHOICE_GATE_ID
    || command.target.referenceDigest !== anchor.digest || command.target.libraryId !== anchor.value.snapshot.libraryId
    || command.target.typeId !== ONBOARDING_ROSTER_TYPE_ID || command.target.workbookVersion !== anchor.value.snapshot.version
    || (command.payload.referenceDigest === undefined) !== (data.sources.length === 1)
    || (command.payload.workbookVersion ?? (data.sources.length === 1 ? source.value.snapshot.version : undefined)) !== source.value.snapshot.version) {
    rejectCommandRequest(command, "invalid-state", "The retained worksheet reference changed. Reload its row choices.");
  }
  const selections = crmReferenceSelections(repositories, run, data);
  const person = data.rows.people.find(person => person.subject.value === command.target.key);
  const candidate = person?.resolution.state === "resolve-required"
    ? person.resolution.candidates.find(candidate => candidate.referenceDigest === source.digest && candidate.row.worksheetId === command.payload.sheetId && candidate.row.rowId === command.payload.rowId) : undefined;
  if (candidate === undefined || selections.has(command.target.key)) rejectCommandRequest(command, "invalid-state", "This row is not an unresolved member of the retained worksheet version.");
  const appended = repositories.timelineEvents.append({ schemaVersion: 1, eventId: deriveStableUuid("workbook-reference-row-selected", command.commandId),
    workflow: run.envelope.workflow, scope: { kind: "run", runId: run.envelope.runId }, occurredAt: capturedAt, recordedAt: capturedAt,
    retentionDate: localDatePart(new Date(capturedAt)), source: { kind: "native" }, payload: {
      kind: "workbook-reference-row-selected", runId: run.envelope.runId, workflow: run.envelope.workflow, attempt: data.sourceAttempt,
      traceId: run.envelope.traceId, gateId: CRM_DOCUMENT_ROW_CHOICE_GATE_ID, commandId: command.commandId,
      referenceDigest: source.digest, checkpointDigest: data.checkpointDigest, key: command.target.key,
      sheetId: candidate.row.worksheetId, rowId: candidate.row.rowId, at: capturedAt,
    } });
  selections.set(command.target.key, { candidate, record: appended.record });
  const complete = completeCrmReferenceChoice(data, selections);
  return complete === undefined ? { state: "pending" as const }
    : { schemaHash: deriveSchemaHash(CrmDocumentRowChoiceSchema, "output"), value: complete };
}

function buildReferenceChoices(repositories: AuthorityRepositories, run: RunRecord, answer: DecisionAnswerer | undefined) {
  if (crmReferenceWorkflows.has(run.envelope.workflow)) return buildCrmReferenceChoices(repositories, run, answer);
  if (run.envelope.workflow !== "onboarding") return [];
  const { roster, reference, group, binding } = onboardingReference(run);
  if (roster.state === "resolved") return [];
  const base = { libraryId: binding.workbookId, typeId: binding.workbookType, referenceDigest: reference.digest,
    key: binding.rowKey.email, reason: roster.reason };
  const choice = authenticateOnboardingRosterExecution(repositories, run);
  if (choice !== undefined) {
    const { row } = choice;
    const { legalName, livedName } = row.references;
    const values = [{ fieldId: "email", value: row.binding.rowKey.email }, { fieldId: "fullName", value: legalName }, { fieldId: "livedName", value: livedName }];
    const sheet = reference.value.snapshot.worksheets.find(sheet => sheet.sheetId === row.binding.sheetId);
    if (sheet === undefined) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
    const label = `${sheet.name} · ${legalName}`;
    return [{ ...base, native: choice.gate.runId === run.envelope.runId ? choice.native : queuedReferenceNative(repositories, run),
      resolution: { state: "resolved", workbookVersion: row.binding.workbookVersion, resolvedAt: choice.gate.resolvedAt,
      selected: { sheetId: row.binding.sheetId, rowId: row.binding.rowId, label, values,
        ...(group.length > 1 ? { referenceDigest: row.binding.referenceDigest, workbookVersion: row.binding.workbookVersion } : {}) },
      ...(answer === undefined || "source" in choice.gate ? {} : { answer: answer(choice.gate.commandId, { id: "confirm", label }, choice.gate.resolvedAt) }) } }];
  }
  const native = pendingReferenceNative(repositories, run);
  if (run.lifecycle.state !== "parked-gate" || run.lifecycle.gateId !== ONBOARDING_ROSTER_GATE_ID) {
    return [{ ...base, native, resolution: { state: "unavailable", code: "WORKBOOK_ROW_CHOICE_UNAVAILABLE", candidates: [] } }];
  }
  let picks: PickCandidate[];
  let anchorVersion: number | undefined;
  try {
    picks = group.flatMap(member => {
      const live = liveCandidates(repositories, member.value, binding.rowKey.email);
      if (member.digest === reference.digest) anchorVersion = live.version;
      const versionName = "versionName" in member.value.snapshot ? member.value.snapshot.versionName : undefined;
      return live.candidates.map(match => {
        onboardingRosterRow({ ...binding, workbookId: member.value.snapshot.libraryId, referenceDigest: member.digest, workbookVersion: live.version }, match);
        return { sheetId: match.sheetId, rowId: match.rowId,
          label: group.length > 1 && versionName !== undefined ? `${versionName} · ${match.label}` : match.label,
          rowNumber: match.rowNumber,
          ...(group.length > 1 ? { referenceDigest: member.digest, workbookVersion: live.version } : {}),
          values: member.value.request.fields.map(fieldId => ({ fieldId, value: match.values[fieldId] })) };
      });
    });
  } catch (cause) {
    if (!expectedSourceChange(cause)) throw cause;
    return [{ ...base, native, resolution: { state: "unavailable", code: "WORKBOOK_ROW_CHOICE_UNAVAILABLE", candidates: [] } }];
  }
  const candidates = picks.map(({ rowNumber: _rowNumber, ...candidate }) => candidate);
  if (candidates.length === 0 || anchorVersion === undefined) return [{ ...base, native, resolution: { state: "unavailable", code: "WORKBOOK_ROW_CHOICE_UNAVAILABLE", candidates: [] } }];
  const target = { runId: run.envelope.runId, expectedVersion: run.version, libraryId: binding.workbookId,
    typeId: binding.workbookType, referenceDigest: reference.digest, key: binding.rowKey.email,
    workbookVersion: anchorVersion, gateId: ONBOARDING_ROSTER_GATE_ID };
  const action = ActionDescriptorWireSchema.parse({
    kind: "command", key: "resolve-workbook-reference-row", command: "resolve-workbook-reference-row", label: "Choose a roster row",
    intent: "primary", icon: "resolve", placement: ["review"], expectedVersion: run.version, referenceTarget: target,
    confirm: { title: "Use this roster row", body: "Relay checks the current key, worksheet and revision, then retains this row's name values for the run.", confirmLabel: "Use row", tone: "neutral" },
  });
  const sheets = new Set(picks.map(({ sheetId }) => sheetId));
  const sheet = sheets.size === 1 ? reference.value.snapshot.worksheets.find(candidate => sheets.has(candidate.sheetId)) : undefined;
  return [{ ...base, native, resolution: { state: "available", target, candidates, action,
    decision: rowPickDecision("pick-row", sheet?.name ?? "Roster rows", action, picks) } }];
}

export function buildRunWorkbookSection(repositories: AuthorityRepositories, run: RunRecord, answer?: DecisionAnswerer): RunWorkbookWritesWire {
  const entries = capturedOperations(repositories, run);
  return RunWorkbookWritesWireSchema.parse({ runId: run.envelope.runId, referenceChoices: buildReferenceChoices(repositories, run, answer), operations: entries.map(entry => {
    const event = repositories.timelineEvents.get(operationEventId(run.envelope.runId, entry.libraryId, entry.operation.operationId));
    if (event?.payload.kind !== "workbook-write-recorded" || event.payload.runId !== run.envelope.runId
      || event.payload.attempt > run.envelope.attempt || event.payload.traceId !== run.envelope.traceId
      || event.payload.receiptDigest !== sha256Hex(canonicalJsonStringify(entry.receipt))) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
    const native = { eventId: event.eventId, order: event.cursor, runId: run.envelope.runId,
      attempt: event.payload.attempt, traceId: event.payload.traceId, spanPath: run.envelope.traceId };
    const base = { receipt: entry.receipt, native };
    if (entry.receipt.state !== "resolve-required") return { ...base, resolution: { state: "not-required" } };
    const resolving = resolvingEntry(entries, entry);
    if (resolving !== undefined) return { ...base, resolution: { state: "resolved", ...(answer === undefined ? {} : { answer: rowAnswer(repositories, run, resolving, answer) }) } };
    const reference = referenceOfOperation(run, entry).value;
    const change = entry.operation.change;
    if (change.kind !== "patch" && change.kind !== "add") throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
    let live: ReturnType<typeof liveOperationCandidates>;
    try { live = liveOperationCandidates(repositories, reference, entry, change.key); }
    catch (cause) {
      if (!expectedSourceChange(cause)) throw cause;
      return { ...base, resolution: { state: "unavailable", code: "WORKBOOK_ROW_CHOICE_UNAVAILABLE" } };
    }
    if (live.candidates.length === 0) return { ...base, resolution: { state: "unavailable", code: "WORKBOOK_ROW_CHOICE_UNAVAILABLE" } };
    const target = { runId: run.envelope.runId, expectedVersion: run.version, libraryId: entry.libraryId,
      operationId: entry.operation.operationId, receiptDigest: sha256Hex(canonicalJsonStringify(entry.receipt)), workbookVersion: live.version };
    const action = ActionDescriptorWireSchema.parse({
      kind: "command", key: "resolve-workbook-row", command: "resolve-workbook-row", label: "Choose a row", intent: "primary", icon: "resolve",
      placement: ["review"], expectedVersion: run.version, workbookTarget: target,
      confirm: { title: "Apply the captured workbook change to this row", body: "Relay checks the current key, worksheet, revision and cell ownership before applying the retained values.", confirmLabel: "Apply change", tone: "neutral" },
    });
    return { ...base, resolution: { state: "available", target, candidates: live.candidates.map(({ sheetId, rowId, label }) => ({ sheetId, rowId, label })), action,
      decision: rowPickDecision("workbook-row", "Matching rows", action, live.candidates.map(({ sheetId, rowId, label, rowNumber }) => ({ sheetId, rowId, label, rowNumber }))) } };
  }) });
}

export function createRunWorkbookService(deps: Readonly<{ database: AuthorityDatabase; clock: Clock;
  resolveDescriptor?: (workflowId: string) => AnyWorkflowDescriptor | undefined }>) {
  return Object.freeze({
    read(captured: RunRecord, value: z.input<typeof WorkbookReferenceReadRequestSchema>) {
      const command = WorkbookReferenceReadRequestSchema.parse(value);
      return deps.database.withAuthorityReadSnapshot(() => {
        const repositories = deps.database.authority, run = repositories.runs.get(captured.envelope.runId);
        if (run?.lifecycle.state !== "running" || run.cancelRequested === true || repositories.deletedRuns.get(captured.envelope.runId) !== undefined
          || Number(run.claimGeneration) !== Number(captured.claimGeneration)
          || canonicalJsonStringify(run.envelope) !== canonicalJsonStringify(captured.envelope)
          || canonicalJsonStringify(run.input) !== canonicalJsonStringify(captured.input)) throw new WorkbookLibraryError("WORKBOOK_INVALID");
        const sources = referencesFor(run, command.typeId).map(reference => {
          const read = readRetainedWorkbookReference(repositories.workbooks, reference.bound, command);
          return { referenceDigest: read.referenceDigest, reference: read.reference };
        });
        const first = sources[0];
        if (first === undefined) throw new WorkbookLibraryError("WORKBOOK_INVALID");
        return WorkbookReferenceReadSchema.parse({ state: "read", ...first, sources });
      });
    },
    resolveReference(repositories: AuthorityRepositories, command: ReferenceCommand, capturedAt: string) {
      const run = repositories.runs.get(command.target.runId);
      if (run === undefined || repositories.deletedRuns.get(command.target.runId) !== undefined || run.version !== command.target.expectedVersion
        || run.lifecycle.state !== "parked-gate" || run.lifecycle.gateId !== command.target.gateId) {
        rejectCommandRequest(command, "invalid-state", "The roster gate changed. Reload its row choice.");
      }
      if (crmReferenceWorkflows.has(run.envelope.workflow)) return resolveCrmReference(repositories, run, command, capturedAt);
      if (command.target.gateId !== ONBOARDING_ROSTER_GATE_ID) rejectCommandRequest(command, "invalid-state", "The roster gate changed. Reload its row choice.");
      const { roster, group, binding } = onboardingReference(run);
      const chosen = group.find(member => member.digest === (command.payload.referenceDigest ?? (group.length === 1 ? group[0]?.digest : undefined)));
      if (roster.state !== "resolve-required" || chosen === undefined || command.target.libraryId !== binding.workbookId || command.target.typeId !== binding.workbookType
        || command.target.referenceDigest !== binding.referenceDigest || command.target.key !== binding.rowKey.email
        || (command.payload.referenceDigest === undefined) !== (group.length === 1)) {
        rejectCommandRequest(command, "invalid-state", "The captured roster reference changed.");
      }
      let live: ReturnType<typeof liveCandidates>;
      try { live = liveCandidates(repositories, chosen.value, binding.rowKey.email); }
      catch (cause) {
        if (!(cause instanceof WorkbookLibraryError)) throw cause;
        rejectCommandRequest(command, "invalid-state", cause.message);
      }
      const selected = live.candidates.find(candidate => candidate.sheetId === command.payload.sheetId && candidate.rowId === command.payload.rowId);
      const expectedVersion = command.payload.workbookVersion ?? command.target.workbookVersion;
      if (live.version !== expectedVersion || selected === undefined || group.length > 1 && command.payload.workbookVersion === undefined) {
        rejectCommandRequest(command, "invalid-state", "The live roster row changed. Reload its row choice.");
      }
      try {
        const row = onboardingRosterRow({ ...binding, workbookId: chosen.value.snapshot.libraryId, referenceDigest: chosen.digest,
          workbookVersion: live.version, capturedAt }, selected);
        return { schemaHash: deriveSchemaHash(OnboardingRosterChoiceSchema, "output"), value: { decision: "selected" as const, row } };
      } catch (cause) {
        if (!(cause instanceof z.ZodError)) throw cause;
        rejectCommandRequest(command, "invalid-state", "The live roster name values are invalid. Correct the workbook before choosing its row.");
      }
    },
    write(captured: RunRecord, value: z.infer<typeof WorkbookReferenceWriteSchema>): WorkbookOperationReceipt {
      const command = WorkbookReferenceWriteSchema.parse(value);
      return deps.database.withAuthorityTransaction(repositories => {
        const run = repositories.runs.get(captured.envelope.runId);
        if (run?.lifecycle.state !== "running" || run.envelope.attempt !== captured.envelope.attempt
          || Number(run.claimGeneration) !== Number(captured.claimGeneration)
          || canonicalJsonStringify(run.envelope) !== canonicalJsonStringify(captured.envelope)
          || canonicalJsonStringify(run.input) !== canonicalJsonStringify(captured.input)) throw new WorkbookLibraryError("WORKBOOK_INVALID");
        const reference = references(run).find(candidate => candidate.value.request.typeId === command.typeId && candidate.digest === command.referenceDigest);
        if (reference === undefined || "mode" in reference.value.request) throw new WorkbookLibraryError("WORKBOOK_INVALID");
        const operationId = deriveStableUuid("run-workbook-write-request", canonicalJsonStringify({ runId: run.envelope.runId, writeId: command.writeId }));
        const previous = repositories.workbooks.runOperations(run.envelope.runId).find(entry => entry.operation.operationId === operationId);
        if (previous !== undefined && previous.libraryId !== reference.value.snapshot.libraryId) throw new WorkbookLibraryError("WORKBOOK_OPERATION_CONFLICT");
        const values = Object.fromEntries(command.values.map(cell => [cell.fieldId, cell.value]));
        if (previous !== undefined && ((previous.operation.source.kind !== "run-reference" && previous.operation.source.kind !== "run")
          || previous.operation.source.referenceDigest !== command.referenceDigest
          || previous.operation.change.kind !== "patch" || previous.operation.change.key !== command.key
          || canonicalJsonStringify(previous.operation.change.values) !== canonicalJsonStringify(values))) {
          throw new WorkbookLibraryError("WORKBOOK_OPERATION_CONFLICT");
        }
        if (previous !== undefined) {
          referenceOfOperation(run, previous);
          appendReceipt(repositories, run, previous.receipt);
          return previous.receipt;
        }
        verifyRetainedNamedWorkbookReference(repositories.workbooks, reference.value);
        const descriptor = deps.resolveDescriptor?.(run.envelope.workflow), declaration = descriptor?.workbookReference;
        if (run.envelope.dryRun || run.cancelRequested === true || repositories.deletedRuns.get(run.envelope.runId) !== undefined
          || descriptor === undefined || descriptor.contractFingerprint !== run.envelope.contractFingerprint || declaration === undefined
          || declaration.mode !== "keys" || declaration.id !== reference.value.request.typeId
          || declaration.id !== reference.value.snapshot.type.id
          || declaration.keyFieldId !== reference.value.snapshot.type.keyFieldId
          || canonicalJsonStringify(descriptor.requiredWorkbookFields) !== canonicalJsonStringify(reference.value.request.fields)
          || !reference.value.request.fields.includes(declaration.keyFieldId)
          || declaration.writableFields.length === 0
          || declaration.writableFields.some(field => !reference.value.request.fields.includes(field))) throw new WorkbookLibraryError("WORKBOOK_INVALID");
        const row = reference.value.snapshot.rows.find(row => row.key === command.key);
        if (row === undefined || command.values.some(cell => !reference.value.request.fields.includes(cell.fieldId))) throw new WorkbookLibraryError("WORKBOOK_INVALID");
        if (!("versionId" in reference.value.snapshot)
          || reference.value.snapshot.worksheets.length !== 1) throw new WorkbookLibraryError("WORKBOOK_INVALID");
        const source = CapturedWorkbookWriteSourceSchema.parse({ kind: "run-reference", runId: run.envelope.runId,
          referenceDigest: reference.digest, authority: { versionId: reference.value.snapshot.versionId,
            sheetId: reference.value.snapshot.worksheets[0]?.sheetId, keyFieldId: declaration.keyFieldId,
            requiredFields: [...reference.value.request.fields], writableFields: [...declaration.writableFields] } });
        const libraryState = repositories.workbooks.libraryState(reference.value.snapshot.libraryId);
        if (libraryState.removed) throw new WorkbookLibraryError("WORKBOOK_NOT_FOUND");
        if (command.values.some(cell => !source.authority.writableFields.includes(cell.fieldId))) throw new WorkbookLibraryError("WORKBOOK_INVALID");
        const admitted = "selectedRow" in reference.value.request ? reference.value.request.selectedRow : undefined;
        const matched = run.envelope.workflow !== "onboarding" && row.state === "matched" ? row.matches[0] : undefined;
        let chosen = admitted ?? (matched === undefined ? undefined : { sheetId: matched.sheetId, rowId: matched.rowId });
        let expectedVersion = reference.value.snapshot.version;
        if (run.envelope.workflow === "onboarding") {
          const roster = onboardingReference(run);
          const binding = roster.roster.state === "resolved" ? roster.roster.row.binding
            : authenticateOnboardingRosterExecution(repositories, run)?.row.binding;
          if (binding === undefined || binding.referenceDigest !== reference.digest
            || binding.referenceDigest !== command.referenceDigest || binding.workbookId !== reference.value.snapshot.libraryId
            || binding.workbookType !== command.typeId
            || binding.rowKey.email !== command.key) throw new WorkbookLibraryError("WORKBOOK_INVALID");
          chosen = { sheetId: binding.sheetId, rowId: binding.rowId };
          expectedVersion = binding.workbookVersion;
        }
        if (chosen === undefined || chosen.sheetId !== source.authority.sheetId
          || run.envelope.workflow !== "onboarding" && !row.matches.some(candidate =>
            candidate.sheetId === chosen.sheetId && candidate.rowId === chosen.rowId)) throw new WorkbookLibraryError("WORKBOOK_INVALID");
        const selection = { ...chosen, expectedVersion };
        const receipt = writeRecordedRunWorkbook(repositories.workbooks, deps.clock, source, reference.value.snapshot.libraryId, operationId,
          { kind: "patch", key: command.key, values, expectedVersion, selection });
        appendReceipt(repositories, run, receipt);
        return receipt;
      });
    },
    resolve(repositories: AuthorityRepositories, command: RowCommand): WorkbookOperationReceipt {
      const run = repositories.runs.get(command.target.runId);
      if (run === undefined || repositories.deletedRuns.get(command.target.runId) !== undefined || run.version !== command.target.expectedVersion) {
        rejectCommandRequest(command, "invalid-state", "The workbook run changed. Reload its row choice.");
      }
      const entries = capturedOperations(repositories, run);
      const original = entries.find(entry => entry.libraryId === command.target.libraryId && entry.operation.operationId === command.target.operationId);
      if (original === undefined || original.receipt.state !== "resolve-required" || resolvingEntry(entries, original) !== undefined
        || sha256Hex(canonicalJsonStringify(original.receipt)) !== command.target.receiptDigest) {
        rejectCommandRequest(command, "invalid-state", "The retained workbook choice changed.");
      }
      const reference = referenceOfOperation(run, original);
      const change = original.operation.change;
      if (change.kind !== "patch" && change.kind !== "add") throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
      let live: ReturnType<typeof liveOperationCandidates>;
      try { live = liveOperationCandidates(repositories, reference.value, original, change.key); }
      catch (cause) {
        if (!expectedSourceChange(cause)) throw cause;
        rejectCommandRequest(command, "invalid-state", "The captured workbook source changed. Reload its row choice.");
      }
      if (live.version !== command.target.workbookVersion || !live.candidates.some(candidate => candidate.sheetId === command.payload.sheetId && candidate.rowId === command.payload.rowId)) {
        rejectCommandRequest(command, "invalid-state", "The live workbook row changed. Reload its row choice.");
      }
      if (original.operation.source.kind !== "run" && original.operation.source.kind !== "run-reference") throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
      const receipt = writeRecordedRunWorkbook(repositories.workbooks, deps.clock, original.operation.source, original.libraryId,
        deriveStableUuid("run-workbook-row-resolution", command.commandId), { kind: "patch", key: change.key, values: change.values,
          expectedVersion: live.version, selection: { ...command.payload, expectedVersion: live.version },
          resolves: { operationId: original.operation.operationId, receiptDigest: command.target.receiptDigest } });
      if (receipt.state !== "applied") rejectCommandRequest(command, "invalid-state", "The selected row cannot accept the captured change; operator-owned cells remain protected.");
      appendReceipt(repositories, run, receipt, command.commandId);
      return receipt;
    },
  });
}
