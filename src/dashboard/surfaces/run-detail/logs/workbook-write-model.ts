import type { RunDetailWire, RunWorkbookWritesWire } from "../../../../models/dashboard/run-detail.js";
import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
import type { LogDecision } from "./log-decision-model.js";
import type { LogStep } from "./log-feed-model.js";
import { fmtActionClock } from "../../shared/status/format.js";
import type { CommandRequest } from "../../../../rules/commands/commands.js";
import { canonicalJsonStringify } from "../../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../rules/validation/sha256.js";
import { SPREADSHEET_FIELDS } from '../../../../models/fields/workbook-fields.js';
import { deriveStableUuid } from "../../../../rules/identity/stable-uuid.js";

export type WorkbookWrite = RunWorkbookWritesWire["operations"][number];
export function workbookWriteMatchesReplay(operation: WorkbookWrite, command: CommandRequest): boolean {
  return command.family === "run" && command.type === "resolve-workbook-row"
    && operation.receipt.libraryId === command.target.libraryId && operation.receipt.operationId === command.target.operationId
    && (operation.receipt.source.kind === "run" || operation.receipt.source.kind === "run-reference") && operation.receipt.source.runId === command.target.runId
    && sha256Hex(canonicalJsonStringify(operation.receipt)) === command.target.receiptDigest;
}
export function workbookWriteLogStep(operation: WorkbookWrite): LogStep {
  const { receipt, resolution, native } = operation;
  const message = resolution.state === "unavailable" ? ERROR_CATALOG[resolution.code].text
    : resolution.state === "resolved" ? "This captured workbook change was resolved."
    : receipt.state === "applied" ? "The captured workbook change was applied."
    : receipt.state === "refused" ? ERROR_CATALOG.WORKBOOK_INVALID.text
    : "Choose a matching row. Operator-owned cells remain protected.";
  return { id: native.eventId, time: fmtActionClock(receipt.at), title: "Workbook change", entries: [{ kind: "decision",
    id: native.eventId, time: fmtActionClock(receipt.at), decision: { title: resolution.state === "available" ? resolution.decision?.title ?? "Workbook change" : "Workbook change",
      state: resolution.state === "resolved" || receipt.state === "applied" ? "recorded" : receipt.state === "refused" ? "failed" : "review",
      message, ...(resolution.state === "available" && resolution.decision !== undefined ? { served: resolution.decision } : {}),
      ...(resolution.state === "resolved" && resolution.answer !== undefined ? { answered: resolution.answer } : {}) } }] };
}

export type WorkbookReferenceChoice = NonNullable<RunWorkbookWritesWire['referenceChoices']>[number];
export function workbookReferenceChoiceId(choice: WorkbookReferenceChoice): string {
  return JSON.stringify(['reference', choice.libraryId, choice.typeId, choice.referenceDigest, choice.key]);
}
export function workbookReferenceTimelineEvent(choice: WorkbookReferenceChoice, detail: RunDetailWire): RunDetailWire['timeline']['events'][number] | undefined {
  const anchor = choice.native;
  return detail.timeline.events.find(event => {
    const native = event.native;
    return native !== undefined && native.eventId === anchor.eventId && native.order === anchor.order
      && native.runId === anchor.runId && native.attempt === anchor.attempt && native.traceId === anchor.traceId
      && native.spanPath === anchor.spanPath && (anchor.nodeId === undefined || native.nodeId === anchor.nodeId);
  });
}
export function workbookReferenceMatchesReplay(choice: WorkbookReferenceChoice, command: CommandRequest, detail: RunDetailWire): boolean {
  const event = workbookReferenceTimelineEvent(choice, detail);
  return command.family === 'run' && command.type === 'resolve-workbook-reference-row'
    && detail.runId === command.target.runId && detail.rowRevision >= command.target.expectedVersion
    && choice.native.runId === detail.runId && choice.native.traceId === detail.header.traceId
    && choice.native.spanPath === detail.header.traceId && choice.native.attempt === detail.header.attempt
    && (choice.native.eventId === deriveStableUuid('workbook-reference-row-selected', command.commandId)
      && String(choice.native.nodeId) === String(command.target.gateId)
      || detail.rowRevision > command.target.expectedVersion && event?.state === 'done' && event.native?.nodeId?.valueOf() === command.target.gateId.valueOf())
    && choice.libraryId === command.target.libraryId && choice.typeId === command.target.typeId
    && choice.referenceDigest === command.target.referenceDigest && choice.key === command.target.key
    && choice.resolution.state === 'resolved' && choice.resolution.workbookVersion === command.target.workbookVersion
    && choice.resolution.selected.sheetId === command.payload.sheetId && choice.resolution.selected.rowId === command.payload.rowId;
}
function referenceValues(candidate: Extract<WorkbookReferenceChoice['resolution'], { state: 'resolved' }>['selected']): string {
  return candidate.values.map(cell => `${SPREADSHEET_FIELDS.find(field => field.id === cell.fieldId)?.label ?? cell.fieldId}: ${cell.value === null ? '(empty)' : typeof cell.value === 'object' ? cell.value.value : String(cell.value)}`).join(' · ');
}
export function workbookReferenceLogDecision(choice: WorkbookReferenceChoice): LogDecision {
  return { title: choice.resolution.state === 'available' ? choice.resolution.decision?.title ?? 'Look up in roster' : 'Look up in roster', state: choice.resolution.state === 'resolved' ? 'recorded' : choice.resolution.state === 'unavailable' ? 'failed' : 'review',
    message: choice.resolution.state === 'resolved' ? `${choice.resolution.selected.label} · ${referenceValues(choice.resolution.selected)}`
      : choice.resolution.state === 'unavailable' ? ERROR_CATALOG[choice.resolution.code].text
      : 'No unique roster row was found. Choose the matching row to continue.',
    ...(choice.resolution.state === 'available' && choice.resolution.decision !== undefined ? { served: choice.resolution.decision } : {}),
    ...(choice.resolution.state === 'resolved' && choice.resolution.answer !== undefined ? { answered: choice.resolution.answer } : {}) };
}
