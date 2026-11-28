import { deriveEvidenceReceiptId } from "../../../models/trust/evidence-identity.js";
import { readRunSettlementRow, runSettlementContext } from "./run-settlement-row.js";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { confirmationPublicationFromRow, reconstructConfirmedOperation, type ConfirmationPublication } from "../../../models/events/confirmed-operation.js";
import { timelineAppendContent, timelineCheckpointReference, type TimelineAppend } from "../../../models/events/timeline.js";
import { completionFromAuthorization } from "../../../models/run/completion.js";
import { PredecessorRunRecordSchema, type PredecessorRunRecord } from "../../../models/run/record.js";
import { RunResultRecordSchema, createRunTerminalEvidenceResult, deriveTerminalFailureDigest, terminalEvidenceResult, type RunResultRecord } from "../../../models/run/result.js";
import { CanonicalCrashRecoveryRequestSchema } from "../../../models/run/worker.js";
import { AuthorityCommandAuditRecordSchema, AuthorityCommandRecordSchema, RunLifecycleCommandAuditRecordSchema, RunLifecycleCommandRecordSchema } from "../../../rules/commands/commands.js";
import { deriveStableUuid,lifecycleCommandId } from "../../../rules/identity/identifiers.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { DelegationManifestSchema } from "../../../rules/workflow/dependencies.js";
import { authenticateAuditedParkedWriteResolution,authenticateParkedWriteRecheck,authenticateParkedWriteResolution } from "../../../rules/write-safety/parked-resolution.js";
import { NativeCommandAuditSchema, commandFromRow, settledRunDeletionIds } from "./command-record-row.js";
import { deletedRunFromRow } from "./deleted-run-row.js";
import { nativeOrdinaryRecordFromRow } from "./native-record-row.js";
import { predecessorCommandFromRow, predecessorCustodyRunFromRow, predecessorCustodyRunRow, predecessorLifecycleRequest } from "./worker-custody-predecessor.js";
import { predecessorRunRecordFromRow, runRecordFromRow } from "./run-record-row.js";
import { timelineEventFromRow } from "./timeline-repository.js";
import { RecoveryActivitySchema, recoveryActivitySpanPath } from "../../../models/run/recovery-activity.js";
import { createWorkbookLibraryRepository } from "./workbook-library-repository.js";
import type { RunEvidenceReceipt } from "../../../models/trust/evidence.js";
import { FailureRecordSchema } from "../../../models/trust/failure.js";
import { RunCheckpointRecordSchema, checkpointLookupKey } from "../../../models/workflow/checkpoint.js";
import { CommandAuditIdSchema, FailureIdSchema, PositiveIntSchema, RunIdSchema } from "../../../rules/identity/ids.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { WriteAttemptRecordSchema, WriteIntentRecordSchema, type WriteIntentRecord } from "../../../rules/write-safety/write-safety.js";
import { authenticateDelegationRefresh } from "./delegation-refresh.js";
import { BUILD_ID_ENVELOPE_SCHEMA_VERSION, CURRENT_AUTHORITY_SCHEMA_VERSION, WORKER_CUSTODY_SCHEMA_VERSION } from "./migrations.js";
import { FailureTerminalizationRequestSchema, SuccessTerminalizationRequestSchema } from "./run-terminal-contracts.js";
import { authorityIntegrityError } from "./authority-errors.js";
import type { AuthorityRepositories } from "./authority-repositories.js";

export function authenticateStoredParkedWriteRecheck(
  repositories: Pick<AuthorityRepositories, "writeAttempts" | "commands" | "commandAudits">,
  intent: Extract<WriteIntentRecord, { status: "parked" }>,
  recheck: NonNullable<typeof intent.recheck>,
) {
  return authenticateParkedWriteRecheck(
    intent,
    repositories.writeAttempts.get(intent.currentAttemptId),
    repositories.commands.get(recheck.commandId),
    repositories.commandAudits.get(recheck.auditId),
  );
}

export const JsonRowSchema = z.strictObject({ payload_json: z.string() });
// Notes are the timeline's high-volume stream; storage inspection never reads them, nor a predecessor store's debug rows.
export const INSPECTED_TIMELINE_KINDS = "kind NOT IN ('debug','note')";

/** How stored runs and commands are read; a stopped store below the custody schema reads both through the predecessor readers. */
export type StoredReaders = Readonly<{ run: (raw: unknown) => PredecessorRunRecord; command: (raw: unknown) => ReturnType<typeof commandFromRow>;
  /** A lifecycle request in the current grammar, for checks that parse it with a current request schema. */
  lifecycleRequest: (operation: string, request: unknown) => unknown }>;
export const CURRENT_READERS: StoredReaders = { run: runRecordFromRow, command: raw => commandFromRow(raw), lifecycleRequest: (_operation, request) => request };
export const PREDECESSOR_CUSTODY_READERS: StoredReaders = { run: predecessorCustodyRunFromRow, command: predecessorCommandFromRow, lifecycleRequest: predecessorLifecycleRequest };

export function readTimelineRun(database: DatabaseSync, runId: string, read: StoredReaders = CURRENT_READERS): PredecessorRunRecord | undefined {
  const row = database.prepare("SELECT * FROM runs WHERE id = ?").get(runId);
  return row === undefined ? undefined : read.run(row);
}

export function authenticatedPublicationDeletion(database: DatabaseSync, runId: string, publication: ConfirmationPublication, read: StoredReaders = CURRENT_READERS): boolean {
  const raw = database.prepare("SELECT * FROM deleted_runs WHERE run_id=?").get(runId);
  if (raw === undefined) return false;
  const {receipt} = deletedRunFromRow(raw);
  const facts = publication.ledger;
  const commandRaw = database.prepare("SELECT * FROM commands WHERE id=?").get(receipt.commandId);
  const audits = database.prepare("SELECT * FROM command_audits WHERE command_id=?").all(receipt.commandId);
  if (commandRaw === undefined || audits.length !== 1) throw new Error("confirmed-publication-deletion-command-missing");
  const command = read.command(commandRaw);
  const audit = NativeCommandAuditSchema.parse(nativeOrdinaryRecordFromRow("command_audits",audits[0]));
  if (receipt.runId !== facts.runId || receipt.workflow !== facts.workflowId || receipt.itemId !== facts.itemId
    || audit.completedAt !== receipt.deletedAt
    || receipt.traceId !== facts.traceId || receipt.attempt < facts.attempt || receipt.deletedAt < facts.confirmedAt
    || receipt.removed.find(entry=>entry.table === "runs")?.rows !== 1
    || !receipt.removed.some(entry=>entry.table === "run_checkpoints" && entry.rows > 0)
    || !receipt.removed.some(entry=>entry.table === "timeline_events" && entry.rows > 0)
    || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(command)
    || z.object({state:z.literal("succeeded"),outcome_json:z.string()}).parse(commandRaw).outcome_json !== canonicalJsonStringify(audit)
    || !settledRunDeletionIds(audit)?.includes(runId)) throw new Error("confirmed-publication-deletion-settlement-mismatch");
  return true;
}

export function readConfirmationPublication(database: DatabaseSync,id:string): ConfirmationPublication | undefined {
  const row = database.prepare("SELECT * FROM write_intents WHERE id=?").get(id);
  if (row === undefined) return undefined;
  const intent = WriteIntentRecordSchema.parse(nativeOrdinaryRecordFromRow("write_intents",row));
  return confirmationPublicationFromRow(intent,Reflect.get(row,"publication_json"));
}

export function assertConfirmationPublication(database:DatabaseSync,id:string,read: StoredReaders = CURRENT_READERS): void {
  const publication = readConfirmationPublication(database,id);
  if (publication === undefined) return;
  const owner = readTimelineRun(database,publication.ledger.runId,read);
  const deleted = database.prepare("SELECT 1 FROM deleted_runs WHERE run_id=?").get(publication.ledger.runId) !== undefined;
  if (owner !== undefined && deleted) throw authorityIntegrityError("confirmed-publication-owner-ambiguous");
  if (deleted && !authenticatedPublicationDeletion(database,publication.ledger.runId,publication,read)) throw authorityIntegrityError("confirmed-publication-deletion-unverified");
  const evidence = timelineEvidenceRepositories(database,read);
  reconstructConfirmedOperation(evidence,publication.timeline);
  const raw = database.prepare("SELECT * FROM timeline_events WHERE id=?").get(publication.timeline.eventId);
  if (raw === undefined) {
    if (!authenticatedPublicationDeletion(database,publication.ledger.runId,publication,read)) throw authorityIntegrityError("confirmed-publication-timeline-missing");
    if (readTimelineRun(database,publication.ledger.runId,read) !== undefined) throw authorityIntegrityError("confirmed-publication-deleted-run-still-present");
  } else {
    const timeline = timelineEventFromRow(raw);
    if (timelineAppendContent(timeline) !== canonicalJsonStringify(publication.timeline)) throw authorityIntegrityError("confirmed-publication-timeline-mismatch");
    assertTimelineOwner(database,timeline,false,read);
  }
}

export function timelineEvidenceRepositories(database: DatabaseSync, read: StoredReaders = CURRENT_READERS) {
  return {
    workbooks: createWorkbookLibraryRepository({ database, read: work => work(), mutate: () => { throw new Error("timeline-workbook-reader-is-read-only"); } }),
    writeAttempts: {get(id:string) {
      const row=database.prepare("SELECT * FROM write_attempts WHERE id=?").get(id);
      return row === undefined ? undefined : WriteAttemptRecordSchema.parse(nativeOrdinaryRecordFromRow("write_attempts",row));
    }},
    writeIntents: {
      getPublication:(id:string)=>readConfirmationPublication(database,id),
      authenticatedDeletion:(runId:string,publication:ConfirmationPublication)=>authenticatedPublicationDeletion(database,runId,publication,read),
      get(id:string) {
      const row=database.prepare("SELECT * FROM write_intents WHERE id=?").get(id);
      return row === undefined ? undefined : WriteIntentRecordSchema.parse(nativeOrdinaryRecordFromRow("write_intents",row));
    }},
    commands: {get(id:string) {
      const row=database.prepare("SELECT * FROM commands WHERE id=?").get(id);
      return row === undefined ? undefined : read.command(row);
    }},
    commandAudits: {get(id:string) {
      const row=database.prepare("SELECT * FROM command_audits WHERE id=?").get(id);
      return row === undefined ? undefined : NativeCommandAuditSchema.parse(nativeOrdinaryRecordFromRow("command_audits",row));
    }},
    runCheckpoints: {get(workflow:string,itemId:string,nodeId:string,attempt:number,claimGeneration:number) {
      const key=checkpointLookupKey(workflow,itemId,nodeId,attempt,claimGeneration);
      const row=database.prepare("SELECT * FROM run_checkpoints WHERE id=?").get(key);
      return row === undefined ? undefined : RunCheckpointRecordSchema.parse(nativeOrdinaryRecordFromRow("run_checkpoints",row));
    }},
  };
}

export function assertTimelineOwner(database: DatabaseSync, record: TimelineAppend, appending = false, read: StoredReaders = CURRENT_READERS,
  readOwner = (runId: string) => readTimelineRun(database, runId, read)): void {
    const refuse = appending ? Error : authorityIntegrityError;
    if (record.scope.kind !== "run") return;
    const run = readOwner(record.scope.runId);
    if (run === undefined) throw refuse("timeline-event-owner-missing");
    if (run.envelope.workflow !== record.workflow) throw refuse("timeline-event-owner-mismatch");
    if (record.payload.kind === "workbook-write-recorded") {
      const event = record.payload, repositories = timelineEvidenceRepositories(database, read);
      const entry = repositories.workbooks.runOperations(run.envelope.runId).find(entry => entry.libraryId === event.libraryId && entry.operation.operationId === event.operationId);
      const digest = entry?.operation.source.kind === "run" || entry?.operation.source.kind === "run-reference" ? entry.operation.source.referenceDigest : undefined;
      if (entry === undefined || (entry.operation.source.kind !== "run" && entry.operation.source.kind !== "run-reference") || entry.operation.source.referenceDigest === undefined
        || !run.input.workbookReferences?.some(reference => sha256Hex(canonicalJsonStringify(reference)) === digest)
        || event.runId !== run.envelope.runId || event.workflow !== run.envelope.workflow || event.traceId !== run.envelope.traceId
        || event.attempt > run.envelope.attempt || Number(event.claimGeneration) > Number(run.claimGeneration)
        || event.receiptDigest !== sha256Hex(canonicalJsonStringify(entry.receipt)) || event.at !== entry.receipt.at
        || record.occurredAt !== event.at || record.source.kind !== "native"
        || record.eventId !== deriveStableUuid("run-workbook-write", canonicalJsonStringify({ runId: event.runId, libraryId: event.libraryId, operationId: event.operationId }))) {
        throw refuse("workbook-write-timeline-identity-mismatch");
      }
      if (appending && event.resolvedBy === undefined && (run.lifecycle.state !== "running" || Number(event.claimGeneration) !== Number(run.claimGeneration))) {
        throw new Error("workbook-write-claim-unavailable");
      }
      if (event.resolvedBy !== undefined) {
        const command = repositories.commands.get(event.resolvedBy);
        const change = entry.operation.change;
        if (command === undefined || !("family" in command) || command.family !== "run" || command.type !== "resolve-workbook-row" || command.target.runId !== event.runId
          || command.target.libraryId !== event.libraryId || change.kind !== "patch" || change.resolves?.operationId !== command.target.operationId
          || change.resolves?.receiptDigest !== command.target.receiptDigest || change.selection?.sheetId !== command.payload.sheetId
          || change.selection?.rowId !== command.payload.rowId || change.selection?.expectedVersion !== command.target.workbookVersion
          || entry.receipt.state !== "applied") throw refuse("workbook-write-resolution-timeline-mismatch");
      }
    }
    const recoveryStart = (activityId: string) => {
      const row = database.prepare("SELECT * FROM timeline_events WHERE id=?").get(activityId);
      const start = row === undefined ? undefined : timelineEventFromRow(row);
      if (start?.payload.kind !== "recovery-activity-started") throw refuse("recovery-activity-start-missing");
      return RecoveryActivitySchema.strip().parse(start.payload);
    };
    const recoveryEnd = (activityId: string) => {
      const row = database.prepare("SELECT * FROM timeline_events WHERE id=?").get(deriveStableUuid("recovery-activity-ended", activityId));
      const end = row === undefined ? undefined : timelineEventFromRow(row);
      if (end !== undefined && end.payload.kind !== "recovery-activity-ended") throw refuse("recovery-activity-end-invalid");
      return end?.payload.kind === "recovery-activity-ended" ? end.payload : undefined;
    };
    if (record.payload.kind === "recovery-activity-started" || record.payload.kind === "recovery-activity-ended") {
      const { kind } = record.payload;
      const activity = RecoveryActivitySchema.strip().parse(record.payload);
      const attempt = timelineEvidenceRepositories(database, read).writeAttempts.get(activity.writeAttemptId);
      if (activity.traceId !== run.envelope.traceId || activity.attempt > run.envelope.attempt
        || attempt === undefined || attempt.runId !== activity.runId || attempt.runAttempt !== activity.attempt
        || attempt.writeIntentId !== activity.writeIntentId || attempt.generation !== activity.generation
        || attempt.bindingProof.afterPrepareSpanPath !== `${activity.traceId}/${activity.nodeId}/prepare`) {
        throw refuse("recovery-activity-owner-mismatch");
      }
      if (kind === "recovery-activity-started" && appending) {
        const raw = database.prepare("SELECT * FROM write_intents WHERE id=?").get(activity.writeIntentId);
        const intent = raw === undefined ? undefined : WriteIntentRecordSchema.parse(nativeOrdinaryRecordFromRow("write_intents", raw));
        if (intent === undefined || intent.status === "observed-present" || intent.currentAttemptId !== activity.writeAttemptId
          || intent.generation !== activity.generation || intent.runId !== activity.runId
          || activity.attempt !== run.envelope.attempt
          || (activity.operation === "parked-write-check" ? intent.status !== "parked" : intent.status !== "attempting")) {
          throw new Error("recovery-activity-authority-changed");
        }
      }
      if (kind === "recovery-activity-ended") {
        if (record.eventId !== deriveStableUuid("recovery-activity-ended", activity.activityId)
          || canonicalJsonStringify(recoveryStart(activity.activityId)) !== canonicalJsonStringify(activity)) {
          throw refuse("recovery-activity-end-mismatch");
        }
      }
    }
    if (record.payload.kind === "operation-confirmed") {
      const facts = record.payload.facts;
      if (facts.traceId !== run.envelope.traceId || facts.itemId !== run.envelope.itemId
        || (appending ? facts.attempt !== run.envelope.attempt : facts.attempt > run.envelope.attempt) || facts.configFingerprint !== run.envelope.configFingerprint
        || facts.instance !== run.envelope.resolvedInstance[facts.system] || run.envelope.dryRun) {
        throw refuse("confirmed-history-run-mismatch");
      }
      // The resolver validates all exact proof/output/attempt references before append.
      reconstructConfirmedOperation(timelineEvidenceRepositories(database, read), record);
    }
    if (record.payload.kind === "checkpoint-replayed" || record.payload.kind === "checkpoint-recorded") {
      const reference = record.payload.checkpoint;
      const checkpoint = timelineEvidenceRepositories(database, read).runCheckpoints.get(reference.workflowId, reference.itemId,
        reference.nodeId, reference.attempt, reference.claimGeneration);
      if ((record.payload.kind === "checkpoint-recorded" && record.eventId !== deriveStableUuid("timeline-checkpoint-recorded", checkpointLookupKey(reference.workflowId, reference.itemId, reference.nodeId, reference.attempt, reference.claimGeneration)))
        || (appending ? record.payload.attempt !== run.envelope.attempt : record.payload.attempt > run.envelope.attempt)
        || (appending && record.payload.kind === "checkpoint-replayed" && Number(record.payload.claimGeneration) !== Number(run.claimGeneration))
        || reference.itemId !== run.envelope.itemId
        || checkpoint === undefined
        || canonicalJsonStringify(timelineCheckpointReference(checkpoint)) !== canonicalJsonStringify(reference)) {
        throw refuse("timeline-checkpoint-reference-mismatch");
      }
    }
    if (record.payload.kind === "write-parked") {
      const event = record.payload;
      if (event.traceId !== run.envelope.traceId || event.attempt > run.envelope.attempt) {
        throw refuse("timeline-parked-write-owner-mismatch");
      }
    }
    if (record.payload.kind === "note") {
      const note = record.payload.note;
      if (!("runId" in note) || note.traceId !== run.envelope.traceId || note.attempt > run.envelope.attempt) {
        throw refuse("timeline-note-owner-mismatch");
      }
      if ("recoveryActivityId" in note && note.recoveryActivityId !== undefined) {
        const activity = recoveryStart(note.recoveryActivityId);
        const end = recoveryEnd(activity.activityId);
        if (activity.runId !== note.runId || activity.workflow !== note.workflow || activity.attempt !== note.attempt
          || activity.traceId !== note.traceId || note.spanPath !== recoveryActivitySpanPath(activity)
          || Date.parse(note.ts) < Date.parse(activity.openedAt)
          || (end !== undefined && (appending || Date.parse(note.ts) > Date.parse(end.endedAt)))) {
          throw refuse("recovery-activity-note-not-open");
        }
      }
    }
    if (record.payload.kind === "span") {
      const event = record.payload.event;
      if (!("runId" in event) || event.traceId !== run.envelope.traceId
        || event.attempt > run.envelope.attempt
        || (event.t === "run.queued" && event.itemId !== run.envelope.itemId)) {
        throw refuse("timeline-event-owner-mismatch");
      }
    }
  }

export function authenticateStoredWriteResolution(database: DatabaseSync, input: unknown, read: StoredReaders = CURRENT_READERS): void {
  const intent = WriteIntentRecordSchema.parse(input);
  if ((intent.status !== "committed" && intent.status !== "retryable") || intent.resolution === undefined) return;
  const attempt = database.prepare("SELECT * FROM write_attempts WHERE id=?").get(intent.resolution.writeAttemptId);
  const command = database.prepare("SELECT * FROM commands WHERE id=?").get(intent.resolution.commandId);
  const audit = database.prepare("SELECT * FROM command_audits WHERE id=?").get(intent.resolution.auditId);
  if (attempt === undefined || command === undefined || audit === undefined) throw authorityIntegrityError("parked-write-resolution-authority-missing");
  authenticateParkedWriteResolution(intent,nativeOrdinaryRecordFromRow("write_attempts",attempt),read.command(command),nativeOrdinaryRecordFromRow("command_audits",audit));
}

export function authenticateStoredResolutionAudit(database: DatabaseSync,input:unknown,read: StoredReaders = CURRENT_READERS) {
  const audit=NativeCommandAuditSchema.parse(input);
  if (!("writeResolution" in audit) || audit.writeResolution === undefined) return audit;
  const intent=audit.writeResolution;
  if (intent.status !== "parked" && ((intent.status !== "committed" && intent.status !== "retryable") || intent.resolution === undefined)) throw authorityIntegrityError("parked-write-resolution-audit-authority-missing");
  const attemptId = intent.status === "parked" ? intent.currentAttemptId : intent.resolution?.writeAttemptId;
  if (attemptId === undefined) throw authorityIntegrityError("parked-write-resolution-audit-authority-missing");
  const attempt=database.prepare("SELECT * FROM write_attempts WHERE id=?").get(attemptId);
  const command=database.prepare("SELECT * FROM commands WHERE id=?").get(audit.request.commandId);
  if(attempt === undefined || command === undefined) throw authorityIntegrityError("parked-write-resolution-audit-authority-missing");
  authenticateAuditedParkedWriteResolution(nativeOrdinaryRecordFromRow("write_attempts",attempt),read.command(command),audit);
  return audit;
}

export function readDelegationRefreshCommands(database: DatabaseSync, runId: string, read: StoredReaders = CURRENT_READERS) {
  return database.prepare(`SELECT * FROM commands WHERE family='run-lifecycle'
    AND json_extract(request_json,'$.operation')='delegation-refresh'
    AND json_extract(request_json,'$.request.runId')=? ORDER BY id`).all(RunIdSchema.parse(runId))
    .map(row => RunLifecycleCommandRecordSchema.parse(read.command(row)));
}

export function assertRefreshedReceiptSettlement(database: DatabaseSync, record: RunEvidenceReceipt, row: unknown, schemaVersion = CURRENT_AUTHORITY_SCHEMA_VERSION): void {
  const { settlement_version: version } = z.object({ settlement_version: PositiveIntSchema }).parse(row);
  if (database.prepare("SELECT 1 FROM run_results WHERE run_id=? AND settlement_version<? LIMIT 1").get(record.runId,version) === undefined) return;
  const raw = readRunSettlementRow(database,record.runId,version);
  if (raw === undefined) throw authorityIntegrityError("receipt-settlement-unavailable");
  const run = schemaVersion < BUILD_ID_ENVELOPE_SCHEMA_VERSION ? runSettlementContext(raw, PredecessorRunRecordSchema) : runSettlementContext(raw);
  if (record.receiptId !== deriveEvidenceReceiptId(record.runId,record.attempt,version)
    || record.workflowId !== run.envelope.workflow || record.traceId !== run.envelope.traceId || record.attempt !== run.envelope.attempt
    || record.descriptorFingerprint !== run.envelope.contractFingerprint || record.configFingerprint !== run.envelope.configFingerprint
    || run.lifecycle.state !== "terminal" || record.generatedAt !== run.lifecycle.endedAt) throw authorityIntegrityError("receipt-settlement-binding-mismatch");
}

export function assertTerminalEvidenceOwner(database: DatabaseSync, record: RunResultRecord, read: StoredReaders = CURRENT_READERS, retainedRun?: PredecessorRunRecord, refreshPath = new Set<string>(), schemaVersion = CURRENT_AUTHORITY_SCHEMA_VERSION): void {
  const evidence = terminalEvidenceResult(record);
  const rawRun = database.prepare("SELECT * FROM runs WHERE id=?").get(record.runId);
  if (rawRun === undefined) throw authorityIntegrityError("terminal-evidence-run-missing");
  const current = read.run(rawRun), run = retainedRun ?? current;
  if (run.version > current.version || canonicalJsonStringify(run.input) !== canonicalJsonStringify(current.input)
    || canonicalJsonStringify(run.envelope) !== canonicalJsonStringify({ ...current.envelope, priority: run.envelope.priority })) throw authorityIntegrityError("run-settlement-owner-mismatch");
  if (run.delegationRefresh !== undefined) {
    const key = `${run.envelope.runId}:${run.version}`;
    if (refreshPath.has(key)) throw authorityIntegrityError("delegation-refresh-settlement-cycle");
    const path = new Set(refreshPath).add(key);
    authenticateDelegationRefresh({
      lifecycleJournal: {
        listDelegationRefreshes: runId => readDelegationRefreshCommands(database,runId,read),
        getCommand: commandId => { const row = database.prepare("SELECT * FROM commands WHERE id=?").get(commandId); return row === undefined ? undefined : AuthorityCommandRecordSchema.parse(read.command(row)); },
        findAuditByCommand: commandId => { const row = database.prepare("SELECT * FROM command_audits WHERE command_id=?").get(commandId); return row === undefined ? undefined : AuthorityCommandAuditRecordSchema.parse(nativeOrdinaryRecordFromRow("command_audits",row)); },
      },
      delegationManifests: { get: manifestId => { const row = database.prepare("SELECT * FROM run_delegations WHERE id=?").get(manifestId); return row === undefined ? undefined : DelegationManifestSchema.parse(nativeOrdinaryRecordFromRow("run_delegations",row)); } },
      runResults: { getSettlement: (runId, version) => {
        const row = readRunSettlementRow(database,runId,version);
        if (row === undefined) return undefined;
        const result = RunResultRecordSchema.parse(nativeOrdinaryRecordFromRow("run_results",row,schemaVersion)), terminal = schemaVersion < BUILD_ID_ENVELOPE_SCHEMA_VERSION ? runSettlementContext(row, PredecessorRunRecordSchema) : runSettlementContext(row);
        assertTerminalEvidenceOwner(database,result,read,terminal,path,schemaVersion);
        return { run: terminal, result };
      } },
    },run);
  }
  if (retainedRun !== undefined && run.completion !== undefined) {
    if (current.completion?.expectedVersion === run.completion.expectedVersion) {
      if (canonicalJsonStringify(current.completion) !== canonicalJsonStringify(run.completion)
        || canonicalJsonStringify(current.delegationRefresh ?? null) !== canonicalJsonStringify(run.delegationRefresh ?? null)) throw authorityIntegrityError("run-settlement-completion-mismatch");
    } else {
      const rows = database.prepare(`SELECT * FROM commands WHERE family='run-lifecycle'
        AND json_extract(request_json,'$.operation') IN ('terminalize','recover-crash')
        AND json_extract(outcome_json,'$.result.runId')=?
        AND json_extract(outcome_json,'$.result.appliedVersion')=?`).all(record.runId,run.version);
      if (rows.length !== 1 || rows[0] === undefined) throw authorityIntegrityError("run-settlement-native-owner-unavailable");
      const command = RunLifecycleCommandRecordSchema.parse(read.command(rows[0]));
      const rawAudit = database.prepare("SELECT * FROM command_audits WHERE command_id=?").get(command.commandId);
      const audit = RunLifecycleCommandAuditRecordSchema.parse(nativeOrdinaryRecordFromRow("command_audits",rawAudit));
      if (audit.result.kind !== "run" || audit.result.runId !== record.runId || audit.result.appliedVersion !== run.version
        || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(command)) throw authorityIntegrityError("run-settlement-native-owner-mismatch");
      if (run.completion.kind === "done") {
        const request = z.object({ terminal: SuccessTerminalizationRequestSchema }).parse(command.request);
        if (command.operation !== "terminalize" || canonicalJsonStringify(request.terminal.result) !== canonicalJsonStringify(record)
          || canonicalJsonStringify(completionFromAuthorization(request.terminal.authorization)) !== canonicalJsonStringify(run.completion))
          throw authorityIntegrityError("run-settlement-native-owner-mismatch");
      } else if (evidence?.kind === "failed-evidence" && command.operation === "terminalize") {
        const request = z.object({ terminal: FailureTerminalizationRequestSchema }).parse(command.request);
        if (canonicalJsonStringify(request.terminal.authorization) !== canonicalJsonStringify(evidence.authorization)
          || deriveTerminalFailureDigest(request.terminal.failure) !== evidence.failureDigest)
          throw authorityIntegrityError("run-settlement-native-owner-mismatch");
      } else if (evidence?.kind === "failed-evidence" && command.operation === "recover-crash") {
        const request = CanonicalCrashRecoveryRequestSchema.parse(read.lifecycleRequest(command.operation, command.request));
        if (request.runId !== run.envelope.runId || request.expectedVersion !== evidence.authorization.expectedVersion
          || request.now !== evidence.authorization.authorizedAt || canonicalJsonStringify(request.claim) !== canonicalJsonStringify(evidence.authorization.claim)
          || evidence.authorization.failureId !== FailureIdSchema.parse(lifecycleCommandId("crash-failure",command.commandId)))
          throw authorityIntegrityError("run-settlement-native-owner-mismatch");
      } else throw authorityIntegrityError("run-settlement-native-owner-mismatch");
    }
  }
  if (evidence === undefined) {
    if (run.lifecycle.state !== "terminal" || run.lifecycle.outcome !== "done") throw authorityIntegrityError("terminal-evidence-payload-required");
    if (run.completion?.kind !== "done" || run.completion.resultDigest !== record.resultDigest) throw authorityIntegrityError("terminal-result-completion-mismatch");
    return;
  }
  if (evidence.kind === "failed-evidence") {
    const raw = database.prepare("SELECT * FROM run_failures WHERE id=?").get(evidence.authorization.failureId);
    const failure = raw === undefined ? undefined : FailureRecordSchema.parse(nativeOrdinaryRecordFromRow("run_failures",raw));
    if (failure === undefined || failure.runId !== record.runId || failure.workflowId !== record.workflowId
      || failure.attempt !== record.attempt || failure.traceId !== run.envelope.traceId
      || deriveTerminalFailureDigest(failure) !== evidence.failureDigest
      || canonicalJsonStringify(run.completion) !== canonicalJsonStringify(completionFromAuthorization(evidence.authorization))) throw authorityIntegrityError("terminal-failure-result-mismatch");
  } else {
    const commandRaw = database.prepare("SELECT * FROM commands WHERE id=?").get(evidence.commandId);
    const auditRaw = database.prepare("SELECT * FROM command_audits WHERE id=?").get(evidence.auditId);
    if (commandRaw === undefined || auditRaw === undefined) throw authorityIntegrityError("terminal-evidence-command-audit-missing");
    const command = RunLifecycleCommandRecordSchema.parse(read.command(commandRaw));
    const audit = RunLifecycleCommandAuditRecordSchema.parse(nativeOrdinaryRecordFromRow("command_audits",auditRaw));
    const request = z.record(z.string(),z.unknown()).parse(command.request);
    const lifecycle = request.lifecycle === undefined ? undefined : z.record(z.string(),z.unknown()).parse(request.lifecycle);
    const declaredOutcome = command.operation === "transition" ? lifecycle?.outcome : "cancelled";
    const declaredEndedAt = command.operation === "transition" ? lifecycle?.endedAt : command.operation === "requeue" ? audit.result.kind === "run" ? audit.result.terminal?.endedAt : undefined : command.operation === "recover-crash" ? request.now : request.endedAt;
    if (request.runId !== record.runId || request.expectedVersion !== evidence.appliedVersion - 1
      || declaredOutcome !== evidence.outcome || declaredEndedAt !== record.createdAt
      || audit.result.kind !== "run" || audit.result.terminal?.outcome !== evidence.outcome
      || audit.result.terminal.endedAt !== record.createdAt
      || ((command.operation === "requeue" || command.operation === "recover-crash") && run.cancelRequested !== true)
      || (command.operation !== "transition" && command.operation !== "terminalize" && command.operation !== "requeue" && command.operation !== "recover-crash")
      || audit.result.kind !== "run" || audit.result.runId !== record.runId || audit.result.appliedVersion !== evidence.appliedVersion
      || command.requestFingerprint !== evidence.requestFingerprint || audit.auditId !== CommandAuditIdSchema.parse(evidence.commandId)
      || z.object({outcome_json:z.string()}).parse(commandRaw).outcome_json !== canonicalJsonStringify(audit)
      || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(command)) throw authorityIntegrityError("terminal-evidence-command-audit-mismatch");
  }
  if (canonicalJsonStringify(createRunTerminalEvidenceResult(run,evidence)) !== canonicalJsonStringify(record)) throw authorityIntegrityError("terminal-evidence-result-mismatch");
}

/** Reads runs at a stopped store's own schema; envelopes before 22 carry no build id and are never given one. */
export function inspectionRunReader(expectedSchemaVersion: number): (raw: unknown) => PredecessorRunRecord {
  const strict = expectedSchemaVersion >= BUILD_ID_ENVELOPE_SCHEMA_VERSION ? runRecordFromRow : predecessorRunRecordFromRow;
  const read = expectedSchemaVersion >= WORKER_CUSTODY_SCHEMA_VERSION ? strict : (raw: unknown) => strict(predecessorCustodyRunRow(raw));
  return expectedSchemaVersion >= 15 ? read : (raw: unknown) => {
    const row = z.record(z.string(), z.unknown()).parse(raw);
    if (Object.hasOwn(row, "pause_state")) throw new Error("stopped-run-schema-columns-mismatch");
    return read({ ...row, pause_state: null });
  };
}

export function* readRunPages(database: DatabaseSync) {
  const next = database.prepare("SELECT * FROM runs WHERE id > ? ORDER BY id LIMIT 500");
  let rows = database.prepare("SELECT * FROM runs ORDER BY id LIMIT 500").all();
  while (rows.length > 0) {
    yield* rows;
    if (rows.length < 500) return;
    const { id } = z.object({ id: z.string() }).parse(rows.at(-1));
    rows = next.all(id);
  }
}
