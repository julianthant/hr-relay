import type { RunWorkbookWritesWire } from "../../../../models/dashboard/run-detail.js";
import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
import type { LogDecisionAction } from "./log-decision-model.js";
import type { LogStep } from "./log-feed-model.js";
import { fmtActionClock } from "../../shared/status/format.js";
import type { CommandRequest } from "../../../../rules/commands/commands.js";
import { canonicalJsonStringify } from "../../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../rules/validation/sha256.js";

export type WorkbookWrite = RunWorkbookWritesWire["operations"][number];
export function workbookRowChoiceId(candidate: Readonly<{ sheetId: string; rowId: string }>): string {
  return JSON.stringify([candidate.sheetId, candidate.rowId]);
}
export function workbookWriteMatchesReplay(operation: WorkbookWrite, command: CommandRequest): boolean {
  return command.family === "run" && command.type === "resolve-workbook-row"
    && operation.receipt.libraryId === command.target.libraryId && operation.receipt.operationId === command.target.operationId
    && operation.receipt.source.kind === "run" && operation.receipt.source.runId === command.target.runId
    && sha256Hex(canonicalJsonStringify(operation.receipt)) === command.target.receiptDigest;
}
export function workbookWriteLogActions(operation: WorkbookWrite): readonly LogDecisionAction[] {
  const choice = operation.resolution;
  if (choice.state !== "available") return [];
  return [{ id: choice.action.key, label: choice.action.label, primary: true,
    input: { kind: "candidate", question: "Which matching row should receive this captured change?",
      candidates: choice.candidates.map(candidate => ({ id: workbookRowChoiceId(candidate), name: candidate.label,
        description: "Matches the captured key in an original worksheet." })) },
    result: { title: "Workbook row chosen", message: "Applying the retained values after live revalidation.", tone: "info" } }];
}
export function workbookWriteLogStep(operation: WorkbookWrite): LogStep {
  const { receipt, resolution, native } = operation;
  const message = resolution.state === "unavailable" ? ERROR_CATALOG[resolution.code].text
    : resolution.state === "resolved" ? "This captured workbook change was resolved."
    : receipt.state === "applied" ? "The captured workbook change was applied."
    : receipt.state === "refused" ? ERROR_CATALOG.WORKBOOK_INVALID.text
    : "Choose a matching row. Operator-owned cells remain protected.";
  return { id: native.eventId, time: fmtActionClock(receipt.at), title: "Workbook change", entries: [{ kind: "decision",
    id: native.eventId, time: fmtActionClock(receipt.at), decision: { title: "Workbook change",
      state: resolution.state === "resolved" || receipt.state === "applied" ? "recorded" : receipt.state === "refused" ? "failed" : "review",
      message, actions: workbookWriteLogActions(operation) } }] };
}
