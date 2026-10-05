import type { LogRowWire } from "../../../domain/dashboard/run-detail.js";
import type { RunOperationStructureWire } from "../../../domain/dashboard/operation-structure.js";
import type { LogEntry, LogField, LogScreenshot, LogStep } from "./logs/log-feed-model.js";
import type { OperationActionObservationWire } from "../../../domain/dashboard/operation-structure.js";
import { fmtActionClock } from "../shared/status/format.js";
import { SYSTEM_HOST_PRESENTATION } from "../settings/general/settings-hosts-model.js";
import { contiguousOperationRows, observedOperationOutcome, operationAction, operationObservationParent, operationValueText } from "../explorer/operation-structure-model.js";
import { exactOperationCaptures, type RunCaptureItem } from "./run-captures-model.js";
import { groupLogRows, logPillsOf } from "./logs-model.js";

export type RetainedLogStep = Readonly<{ step: LogStep; lastLogId: string }>;

/** Minimal projection of the existing read. No new transport or evidence semantics. */
export function retainedLogFeed(rows: readonly LogRowWire[], structure: RunOperationStructureWire | undefined, captures: readonly RunCaptureItem[], breaks: ReadonlySet<string>): readonly RetainedLogStep[] {
  if (structure?.state !== "observed") return groupLogRows(rows).map(group => {
    const first = group.rows[0];
    const entries: LogEntry[] = group.rows.map(row => row.kind === "observed" ? {
      kind: "fields", id: row.logId,
      fields: logPillsOf(row).map((pill, index) => ({ id: `${row.logId}-${index}`, time: fmtActionClock(row.at), kind: pill.direction === "write" ? "fill" : "read", label: pill.label, value: pill.value })),
    } : { kind: "note", id: row.logId, time: fmtActionClock(row.kind === "note" ? row.note.at : row.at), message: row.kind === "note" ? row.note.message : "Transaction evidence retained." });
    return { lastLogId: group.rows.at(-1)!.logId, step: { id: first.logId, time: fmtActionClock(first.kind === "note" ? first.note.at : first.at), title: group.label ?? "Run activity", entries } };
  });
  const steps: RetainedLogStep[] = [];
  let previousInvocation: string | undefined;
  for (const chunk of contiguousOperationRows(rows, structure.definition, structure.observations, breaks)) {
    const confirmed = chunk.observations.filter(item => item.occurrence.state === "confirmed");
    const first = confirmed[0];
    if (first === undefined) {
      if (chunk.rows.some(row => breaks.has(row.logId))) previousInvocation = undefined;
      continue;
    }
    const { invocation } = operationAction(structure.definition, first);
    const parent = operationObservationParent(structure.definition, first);
    const entries: LogEntry[] = [];
    let pending: LogField[] = [];
    let pendingScreenshots: LogScreenshot[] = [];
    const screenshotsOf = (observation: OperationActionObservationWire, label: string): readonly LogScreenshot[] => exactOperationCaptures(captures, observation.occurrence).map(({ item, capturedAt }) => {
      const artifact = item.capture.artifact;
      if (artifact.mediaKind !== "image") throw new Error("log-capture-is-not-an-image");
      return { src: item.downloadUrl, alt: `Screenshot of ${label}`, time: fmtActionClock(capturedAt), width: artifact.width, height: artifact.height };
    });
    const computed = confirmed.every(item => operationAction(structure.definition, item).action.kind === "compute");
    const outcome = parent === undefined || computed ? undefined : observedOperationOutcome(parent, confirmed);
    const flush = (last: boolean) => {
      if (!pending.length) {
        const lastField = entries.findLastIndex(entry => entry.kind === "fields");
        const previous = entries[lastField];
        if (last && previous?.kind === "fields" && outcome?.state === "selected") entries[lastField] = { ...previous, result: outcome.label };
        return;
      }
      entries.push({ kind: "fields", id: pending[0].id, fields: pending, ...(!computed && parent?.label !== undefined ? { title: parent.label } : {}), ...(last && outcome?.state === "selected" ? { result: outcome.label } : {}), ...(pendingScreenshots.length ? { screenshots: pendingScreenshots } : {}) });
      pending = [];
      pendingScreenshots = [];
    };
    for (const observation of confirmed) {
      const { action } = operationAction(structure.definition, observation);
      const time = fmtActionClock(observation.occurrence.confirmation!.verifiedAt);
      const label = action.label ?? action.target ?? action.id;
      if (action.kind === "read-field" || action.kind === "fill-field" || action.kind === "select-field" || action.kind === "check-field" || action.kind === "compute") {
        pending.push({ id: observation.logId, time, label, kind: action.kind === "read-field" ? "read" : action.kind === "compute" ? "compute" : "fill", value: observation.occurrence.value === undefined ? "Value not retained" : operationValueText(observation.occurrence.value) });
        pendingScreenshots.push(...screenshotsOf(observation, label));
        if (pendingScreenshots.length) flush(false);
      } else if (action.kind === "click" || action.kind === "keypress") {
        flush(false);
        entries.push({ kind: "click", id: observation.logId, time, label, screenshots: screenshotsOf(observation, label) });
      }
    }
    flush(true);
    const lastLogId = chunk.rows.at(-1)!.logId;
    const identity = first.occurrence;
    const invocationKey = [identity.invocationId, identity.attempt, identity.claimGeneration, identity.taskAttempt, identity.physicalSessionId].join(":");
    if (previousInvocation !== invocationKey) previousInvocation = undefined;
    if (entries.length) {
      const previous = steps.at(-1);
      if (previous !== undefined && previousInvocation === invocationKey) steps[steps.length - 1] = { lastLogId, step: { ...previous.step, entries: [...previous.step.entries, ...entries] } };
      else steps.push({ lastLogId, step: { id: first.logId, time: fmtActionClock(first.occurrence.confirmation!.verifiedAt), title: invocation.label ?? invocation.operation.id, ...(invocation.operation.system === "local" ? {} : { system: SYSTEM_HOST_PRESENTATION[invocation.operation.system].name }), entries } });
      previousInvocation = invocationKey;
    }
    if (breaks.has(lastLogId)) previousInvocation = undefined;
  }
  return steps;
}
