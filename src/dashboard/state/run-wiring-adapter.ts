import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { StartPlanWire } from "../../models/dashboard/start-plan.js";
import { createRunLaunchService } from "../surfaces/run-start/run-launch-model.js";
import { DashboardClientError } from "../client/errors.js";
import type { DashboardClient } from "../client/index.js";
import type { DashboardCommandBinding } from "../app/dashboard-app-model.js";
import type { CommandOutcome, CommandExecutionScope } from "../app/commands/command-executor.js";
import { batchMemberRetryAction, batchMemberRetrySourceMatches, childRetrySourceMatches, composeCommandRequest, verifyShellCommandEffect } from "../app/commands/command-dispatch.js";
import { DashboardCommandRequestSchema, type DashboardCommandRequest } from "../../rules/commands/commands.js";
import type { DecisionOptionWire } from "../../models/dashboard/run-decision.js";
import { answeredRow, decisionAnswerValid, lookupTyped, type LogDecisionAnswer } from "../surfaces/run-detail/logs/log-decision-model.js";
import { identityCeremonyFor } from "../surfaces/run-detail/identity/identity-ceremony.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure, operatorFailureSentence } from "../../models/failures/error-catalog.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { directIdentifierDisplay } from "../../rules/redaction/redaction.js";
import type { NativeRunEventWire, IdentityGateDetailWire, ParkedWriteDetailWire, RunDetailSectionResponse, RunDetailWire } from "../../models/dashboard/run-detail.js";
import { appendLogPage, logRowsOf, type NotePage } from "../surfaces/run-detail/logs-model.js";
import type { LogEntry, LogScreenshot, LogStep } from "../surfaces/run-detail/logs/log-feed-model.js";
import type { LogTimelineStage, LogTimelineState } from "../surfaces/run-detail/logs/log-timeline-model.js";
import type { LogSelection } from "../surfaces/run-detail/logs/log-selection-model.js";
import type { PendingCommand } from "../surfaces/shared/actions/actions.js";
import { fmtActionClock, fmtElapsed } from "../surfaces/shared/status/format.js";
import { plainStepLabel } from "./log-display.js";
import { SYSTEM_NAME } from "../surfaces/shared/status/system-chip-model.js";
import { ucpathFoundPresentation, type UcpathFoundDecision, type UcpathFoundPresentation } from "../surfaces/run-detail/logs/ucpath-found-model.js";
import { workbookReferenceChoiceId, workbookReferenceLogDecision, workbookReferenceMatchesReplay, workbookReferenceTimelineEvent, workbookWriteLogStep, workbookWriteMatchesReplay, type WorkbookReferenceChoice, type WorkbookWrite } from "../surfaces/run-detail/logs/workbook-write-model.js";

class RunLogIdentityError extends Error {
  readonly code = "LOGS_IDENTITY_REFUSED";
}

class RunLogSelectionBehindError extends RunLogIdentityError {
  override name = "RunLogSelectionBehindError";
}

function requireNative(value: NativeRunEventWire | undefined): NativeRunEventWire {
  if (value === undefined) throw new RunLogIdentityError("RUN_LOG_NATIVE_IDENTITY_MISSING");
  return value;
}

function requireOrder(value: number | undefined): number {
  if (value === undefined) throw new RunLogIdentityError("RUN_LOG_NATIVE_IDENTITY_MISSING");
  return value;
}

/** The timeline event the identity review takes the place of: the gate opening at the review's log position. */
function gateTimelineOwner(detail: RunDetailWire, gate: IdentityGateDetailWire): RunDetailWire["timeline"]["events"][number] | undefined {
  return gate.order === undefined ? undefined : detail.timeline.events.find(event => event.native?.order === gate.order);
}

function sameHeldOccurrence(envelope: DashboardCommandRequest, write: ParkedWriteDetailWire | undefined): boolean {
  if (envelope.family !== "worker-browser" || envelope.type !== "check-parked-write" || write === undefined) return false;
  const target = envelope.target;
  const action = write.actions.find(action => action.kind === "command" && action.command === "recheck-write");
  return action?.kind === "command" && action.writeTarget !== undefined && target.runId === write.runId
    && target.runVersion === action.expectedVersion && target.runAttempt === write.runAttempt
    && target.traceId === write.native?.traceId && target.nodeId === write.native.nodeId
    && target.writeIntentId === write.writeIntentId && target.intentGeneration === write.generation
    && target.writeAttemptId === action.writeTarget.writeAttemptId && target.bindingProofDigest === action.writeTarget.bindingProofDigest
    && target.occurrenceKeyDigest === action.writeTarget.occurrenceKeyDigest;
}

type RunReads = Pick<DashboardClient, "runDetail" | "runSection">;
export interface RunLogSnapshot {
  readonly detail: RunDetailWire;
  readonly logs: NotePage;
  readonly sections: readonly RunDetailSectionResponse[];
  readonly unavailableEvidence: readonly string[];
}

export async function readRunLogs(client: RunReads, selection: LogSelection, signal: AbortSignal): Promise<RunLogSnapshot> {
  const { row } = selection;
  const detail = await client.runDetail(row.runId, signal);
  if (detail.runId !== row.runId || detail.rowRevision < row.rowRevision || detail.header.traceId !== row.traceId
    || detail.header.attempt !== row.attempt || detail.header.workflowId !== row.workflowId) throw new RunLogIdentityError("RUN_DETAIL_IDENTITY_MISMATCH");
  if (detail.rowRevision > row.rowRevision) throw new RunLogSelectionBehindError("RUN_DETAIL_REVISION_AHEAD");
  signal.throwIfAborted();
  if (!detail.availableSections.includes("logs")) throw new RunLogIdentityError("RUN_LOGS_UNAVAILABLE");
  const section = await client.runSection(row.runId, "logs", undefined, signal);
  if (section.section !== "logs" || section.payload.runId !== row.runId) throw new RunLogIdentityError("RUN_SECTION_IDENTITY_MISMATCH");
  let logs = section.payload;
  logRowsOf(logs, "initial");
  const cursors = new Set<string>();
  while (logs.nextCursor.state === "present") {
    signal.throwIfAborted();
    const cursor = logs.nextCursor.value;
    if (cursors.has(cursor)) throw new RunLogIdentityError("RUN_LOG_CURSOR_REPEATED");
    cursors.add(cursor);
    const next = await client.runSection(row.runId, "logs", cursor, signal);
    if (next.section !== "logs") throw new RunLogIdentityError("RUN_SECTION_IDENTITY_MISMATCH");
    logs = appendLogPage(logs, cursor, next.payload);
  }
  if (detail.captures !== undefined && detail.captures.state !== "error" && ((detail.captures.state === "available") !== detail.availableSections.includes("captures"))) throw new RunLogIdentityError("RUN_CAPTURE_CAPABILITY_MISMATCH");
  if (logRowsOf(logs, "identity").some(log => log.kind !== "note" && (log.attempt > row.attempt || log.traceId !== row.traceId))) throw new RunLogIdentityError("RUN_LOG_ROW_IDENTITY_MISMATCH");
  signal.throwIfAborted();
  const unavailableEvidence: string[] = [];
  if (detail.captures?.state === "error") unavailableEvidence.push("Captures unavailable");
  const sections = await Promise.all(detail.availableSections.filter(name => ["captures", "identity-gate", "parked-write", "failure", "workbook-writes"].includes(name)
    && (name !== "captures" || detail.captures?.state === "available"))
    .map(name => client.runSection(row.runId, name, undefined, signal)));
  for (const section of sections) {
    if (section.section === "workbook-writes" && section.payload.runId !== row.runId) throw new RunLogIdentityError("RUN_WORKBOOK_IDENTITY_MISMATCH");
    if (section.section === "workbook-writes" && section.payload.referenceChoices?.some(choice => choice.resolution.state === "available"
      && (choice.resolution.target.expectedVersion.valueOf() !== row.rowRevision.valueOf() || detail.gate.state !== "open"
        || detail.gate.nodeId?.valueOf() !== choice.resolution.target.gateId.valueOf()))) throw new RunLogIdentityError("RUN_GATE_IDENTITY_MISMATCH");
    if (section.section === "captures" && (detail.captures?.state !== "available"
      || detail.captures.artifactCount !== section.payload.artifacts.length)) throw new RunLogIdentityError("RUN_CAPTURE_CAPABILITY_MISMATCH");
    if (section.section === "identity-gate" && section.payload.state === "available"
      && (section.payload.value.expectedVersion !== row.rowRevision || detail.gate.state !== "open")) throw new RunLogIdentityError("RUN_GATE_IDENTITY_MISMATCH");
    if (section.section === "failure" && section.payload.state === "available" && (section.payload.value.attempt !== row.attempt
      || section.payload.value.traceId !== row.traceId || section.payload.value.workflowId !== row.workflowId
      || (section.payload.value.recovery !== undefined && section.payload.value.recovery.expectedVersion !== row.rowRevision))) throw new RunLogIdentityError("RUN_FAILURE_IDENTITY_MISMATCH");
    if (section.section === "parked-write" && section.payload.runAttempt !== row.attempt) throw new RunLogIdentityError("RUN_WRITE_IDENTITY_MISMATCH");
  }
  if (sections.some(section => section.section === "identity-gate" && section.payload.state === "available") && detail.gate.state === "open" && detail.gate.nodeId === undefined) {
    unavailableEvidence.push("Identity decision join not supplied");
  }
  const snapshot: RunLogSnapshot = { detail, logs, sections, unavailableEvidence };
  validateRunLogSnapshot(snapshot);
  return snapshot;
}

function validateRunLogSnapshot(snapshot: RunLogSnapshot): void {
  const { detail, logs } = snapshot;
  if (logs.runId !== detail.runId) throw new RunLogIdentityError("RUN_LOG_NATIVE_IDENTITY_MISMATCH");
  const native = (value: NativeRunEventWire | undefined): NativeRunEventWire => {
    if (value === undefined || value.runId !== detail.runId || value.traceId !== detail.header.traceId
      || value.attempt > detail.header.attempt) throw new RunLogIdentityError("RUN_LOG_NATIVE_IDENTITY_MISMATCH");
    return value;
  };
  const rows = logRowsOf(logs, "native-identity");
  const rowIds = new Set(rows.map(row => row.logId));
  const eventIds = new Set<string>();
  const orders = new Set<number>();
  for (const row of rows) {
    const identity = native(row.native);
    if (identity.spanPath === undefined) throw new RunLogIdentityError("RUN_LOG_ROW_IDENTITY_MISMATCH");
    if (eventIds.has(identity.eventId) || orders.has(identity.order)) throw new RunLogIdentityError("RUN_LOG_NATIVE_IDENTITY_DUPLICATE");
    eventIds.add(identity.eventId); orders.add(identity.order);
    if (row.kind === "note") {
      if (row.note.runId !== detail.runId) throw new RunLogIdentityError("RUN_LOG_NOTE_IDENTITY_MISMATCH");
      if (row.note.native === undefined || canonicalJsonStringify(row.note.native) !== canonicalJsonStringify(identity)) throw new RunLogIdentityError("RUN_LOG_NOTE_IDENTITY_MISMATCH");
    } else if (row.attempt !== identity.attempt || row.traceId !== identity.traceId
      || row.spanPath !== identity.spanPath || row.producer.nodeId !== identity.nodeId) throw new RunLogIdentityError("RUN_LOG_ROW_IDENTITY_MISMATCH");
  }
  if (rowIds.size !== rows.length) throw new RunLogIdentityError("RUN_LOG_ROW_IDENTITY_DUPLICATE");
  const categories = detail.timeline.steps;
  if (categories === undefined) throw new RunLogIdentityError("RUN_LOG_CATEGORY_IDENTITY_MISSING");
  const keys = new Set<string>();
  const nodes = new Map<string, string>();
  for (const category of categories) {
    if (category.key === undefined || keys.has(category.key)) throw new RunLogIdentityError("RUN_LOG_CATEGORY_IDENTITY_MISMATCH");
    keys.add(category.key);
    for (const member of category.members) {
      if (member.nodeId === undefined || member.categoryKey !== category.key || nodes.has(member.nodeId)) throw new RunLogIdentityError("RUN_LOG_CATEGORY_MEMBER_IDENTITY_MISMATCH");
      nodes.set(member.nodeId, category.key);
    }
  }
  for (const event of detail.timeline.events) {
    const identity = native(event.native);
    if (identity.nodeId === undefined || event.categoryKey !== nodes.get(identity.nodeId)
      || event.categoryKey === undefined || eventIds.has(identity.eventId) || orders.has(identity.order)) throw new RunLogIdentityError("RUN_LOG_TIMELINE_IDENTITY_MISMATCH");
    eventIds.add(identity.eventId); orders.add(identity.order);
  }
  for (const row of rows) if (row.native?.nodeId !== undefined && !nodes.has(row.native.nodeId)) throw new RunLogIdentityError("RUN_LOG_NODE_CATEGORY_MISSING");
  for (const section of snapshot.sections) {
    if (section.section === "workbook-writes") {
      for (const operation of section.payload.operations) {
        const identity = native(operation.native);
        if (eventIds.has(identity.eventId) || orders.has(identity.order)) throw new RunLogIdentityError("RUN_LOG_DECISION_IDENTITY_DUPLICATE");
        eventIds.add(identity.eventId); orders.add(identity.order);
      }
      if (section.payload.runId !== detail.runId) throw new RunLogIdentityError("RUN_WORKBOOK_IDENTITY_MISMATCH");
      for (const choice of section.payload.referenceChoices ?? []) {
        const identity = native(choice.native);
        const timelineOwner = workbookReferenceTimelineEvent(choice, detail);
        if (identity.spanPath !== detail.header.traceId
          || identity.nodeId !== undefined && !nodes.has(identity.nodeId)) throw new RunLogIdentityError("RUN_LOG_REFERENCE_IDENTITY_MISMATCH");
        if (timelineOwner === undefined) {
          if (eventIds.has(identity.eventId) || orders.has(identity.order)) throw new RunLogIdentityError("RUN_LOG_DECISION_IDENTITY_DUPLICATE");
          eventIds.add(identity.eventId); orders.add(identity.order);
        }
        if (choice.resolution.state === "available" && (timelineOwner?.native?.nodeId?.valueOf() !== choice.resolution.target.gateId.valueOf()
          || identity.attempt !== detail.header.attempt || choice.resolution.target.expectedVersion.valueOf() !== detail.rowRevision.valueOf()
          || detail.gate.state !== "open" || detail.gate.nodeId?.valueOf() !== choice.resolution.target.gateId.valueOf()
          || timelineOwner.state !== "blocked" || timelineOwner.at !== detail.gate.openedAt)) throw new RunLogIdentityError("RUN_GATE_IDENTITY_MISMATCH");
      }
      continue;
    }
    if (section.section === "identity-gate" && section.payload.state === "available") {
      const gate = section.payload.value, owner = gateTimelineOwner(detail, gate);
      if (gate.runId !== detail.runId || owner !== undefined && (detail.gate.state !== "open" || owner.native?.nodeId !== detail.gate.nodeId)) {
        throw new RunLogIdentityError("RUN_LOG_GATE_IDENTITY_MISMATCH");
      }
      if (owner === undefined) {
        const order = requireOrder(gate.order);
        if (orders.has(order)) throw new RunLogIdentityError("RUN_LOG_DECISION_IDENTITY_DUPLICATE");
        orders.add(order);
      }
      continue;
    }
    const identity = section.section === "parked-write" ? native(section.payload.native)
      : section.section === "failure" && section.payload.state === "available" ? native(section.payload.value.native) : undefined;
    if (identity === undefined) continue;
    if (detail.timeline.events.some(event => event.native?.eventId === identity.eventId)
      || eventIds.has(identity.eventId) || orders.has(identity.order)) throw new RunLogIdentityError("RUN_LOG_DECISION_IDENTITY_DUPLICATE");
    eventIds.add(identity.eventId); orders.add(identity.order);
    if (identity.nodeId !== undefined && !nodes.has(identity.nodeId)) throw new RunLogIdentityError("RUN_LOG_NODE_CATEGORY_MISSING");
    if (section.section === "parked-write" && (section.payload.runId !== identity.runId
      || section.payload.runAttempt !== identity.attempt || identity.nodeId === undefined)) throw new RunLogIdentityError("RUN_LOG_WRITE_IDENTITY_MISMATCH");
    if (section.section === "failure" && section.payload.state === "available"
      && (section.payload.value.runId !== identity.runId || section.payload.value.attempt !== identity.attempt
        || section.payload.value.nodeId !== identity.nodeId)) throw new RunLogIdentityError("RUN_LOG_FAILURE_IDENTITY_MISMATCH");
  }
}

const TIMELINE_STATE: Record<RunDetailWire["timeline"]["events"][number]["state"], LogTimelineState> = {
  pending: "pending", active: "active", done: "completed", failed: "failed", blocked: "waiting", cancelled: "cancelled", skipped: "skipped",
};

function systemName(system: string | undefined): string | undefined {
  return system === undefined || system === "local" || system === "workflow" ? undefined : new Map<string, string>(Object.entries(SYSTEM_NAME)).get(system) ?? system;
}

function entryWithSystem(entry: LogEntry, system: string): LogEntry {
  const named = (shots: readonly LogScreenshot[]) => shots.map(shot => shot.system === undefined ? { ...shot, system } : shot);
  if ((entry.kind === "fields" || entry.kind === "click") && entry.screenshots !== undefined) return { ...entry, screenshots: named(entry.screenshots) };
  return entry.kind === "decision" && entry.decision.screenshots !== undefined ? { ...entry, decision: { ...entry.decision, screenshots: named(entry.decision.screenshots) } } : entry;
}

const WRITE_STATE_NOTE = {
  "not-attempted": "No changes were made.", prepared: "A change was prepared but not sent.",
  attempting: "A change was being sent. Check the result before retrying.", committed: "The change was saved but not read back. Check the result before retrying.",
  verified: "The change was saved and read back.", unknown: "The result is unknown. Check the system before continuing.",
} as const;

const reasoned = (text: string, reason: string | undefined): string => {
  const why = reason === undefined ? undefined : operatorActionReason(reason);
  return why === undefined ? text : `${text} · ${why}`;
};

function operatorActionReason(reason: string): string | undefined {
  switch (reason) {
    case "condition-false": return "Not needed for this run";
    case "branch-not-selected": return "Another path was selected";
    case "operator-asserted": return "Supplied by the operator";
    case "step-omitted": return "Step omitted";
    case "dry-run": return "Dry run";
    case "cancelled": return "Cancelled";
    case "callback-failed": return "Action failed";
    default: return undefined;
  }
}

export function projectRunLogs(snapshot: RunLogSnapshot, client: Pick<DashboardClient, "artifactUrl">): Readonly<{
  steps: readonly LogStep[]; timeline: readonly LogTimelineStage[];
  ucpathFindings?: Readonly<{ stepId: string; attemptLabel: string; presentation: UcpathFoundPresentation }>;
}> {
  validateRunLogSnapshot(snapshot);
  const { detail, logs, sections } = snapshot;
  const order = new Map<string, number>();
  const groupable = new Set<string>();
  const node = new Map<string, string | undefined>();
  const captures = sections.find(section => section.section === "captures");
  const screenshotsOf = (row: ReturnType<typeof logRowsOf>[number]): readonly LogScreenshot[] => {
    const association = row.kind === "note" ? row.note.screenshot : undefined;
    if (association !== undefined) {
      const native = requireNative(row.native);
      if (captures?.section !== "captures" || captures.payload.runId !== native.runId) throw new RunLogIdentityError("RUN_LOG_SCREENSHOT_IDENTITY_MISMATCH");
      const matches = captures.payload.artifacts.flatMap(capture => {
        const artifact = capture.artifact;
        if (artifact.artifactId !== association.artifactId || artifact.mediaKind !== "image") return [];
        return capture.origins.flatMap(origin => {
          const capturedAt = origin.capturedAt;
          if (origin.bundleId !== association.bundleId || origin.browserCapture === undefined
            || origin.browserCapture.nodeId !== native.nodeId || origin.browserCapture.attempt !== native.attempt
            || origin.browserCapture.sessionId !== association.sessionId || capturedAt === undefined) return [];
          return [{ artifact, origin, capturedAt }];
        });
      });
      if (matches.length !== 1) throw new RunLogIdentityError("RUN_LOG_SCREENSHOT_IDENTITY_MISMATCH");
      const { artifact, capturedAt, origin } = matches[0];
      const boundary = origin.browserCapture?.boundary;
      const label = boundary === "before-submit" ? "Before submit" : boundary === "after-submit" ? "After submit" : undefined;
      return [{ logId: row.logId, src: client.artifactUrl(artifact.artifactId), alt: label ?? "Browser capture", time: fmtActionClock(capturedAt),
        ...(label === undefined ? {} : { label }), ...(boundary === undefined ? {} : { boundary }), width: artifact.width, height: artifact.height, kind: boundary === "before-submit" ? "form" : "browser" }];
    }
    return [];
  };
  const rows = logRowsOf(logs, "projection");
  const observedCauses = new Set<string>();
  const steps = rows.flatMap((row): LogStep[] => {
    if (row.kind !== "transaction-fenced") groupable.add(row.logId);
    order.set(row.logId, requireNative(row.native).order);
    node.set(row.logId, requireNative(row.native).nodeId);
    const at = row.kind === "note" ? row.note.at : row.at;
    const time = fmtActionClock(at);
    const screenshots = screenshotsOf(row);
    let entry: LogEntry | undefined;
    if (row.kind === "observed") {
      const fields = row.displayFields?.flatMap((field, index) => {
        if ("unread" in field) return [{ id: `${row.logId}:${index}`, time, kind: "read" as const, label: field.label, value: "Couldn't read", unread: true as const }];
        if (field.causal !== undefined) {
          const key = canonicalJsonStringify([field.direction, field.causal]);
          if (observedCauses.has(key)) return [];
          observedCauses.add(key);
        }
        return [{ id: `${row.logId}:${index}`, time, kind: field.direction === "read" ? "read" as const : "fill" as const, label: field.label, value: field.value }];
      }) ?? [];
      entry = fields.length > 0 ? { kind: "fields", id: row.logId, fields, screenshots }
        : screenshots.length > 0 ? { kind: "decision", id: `${row.logId}:captures`, time, decision: { title: "Screenshot", state: "recorded", screenshots } } : undefined;
    }
    else if (row.kind === "transaction-fenced") entry = { kind: "note", id: row.logId, time, message: "Write fenced; submission is not confirmed." };
    else if (row.note.screenshot !== undefined) entry = undefined;
    else if (row.note.operatorAction !== undefined) entry = row.note.operatorAction.kind === "screenshot"
      ? { kind: "note", id: row.logId, time, message: "Screenshot unavailable: no verified capture association." } : undefined;
    else if (row.note.level === "info" && row.note.fields !== undefined) entry = undefined;
    else entry = { kind: "note", id: row.logId, time, message: row.note.message, ...(row.note.level === "error" ? { tone: "danger" } : {}) };
    if (entry?.kind === "note" && row.kind === "note" && row.note.fields?.some(field => field.key === "code" && field.kind === "text" && field.value === "BROWSER_SCREENSHOT_CAPTURE_FAILED")) {
      const boundary = row.note.fields.find(field => field.key === "boundary" && field.kind === "text")?.value;
      const proved = sections.some(section => section.section === "failure" && section.payload.state === "available"
        && section.payload.value.nodeId === requireNative(row.native).nodeId
        && section.payload.value.attempt === requireNative(row.native).attempt
        && (section.payload.value.writeState === "committed" || section.payload.value.writeState === "verified"));
      if (boundary === "before-submit" || boundary === "after-submit") entry = { ...entry, tone: "danger",
        captureFailure: boundary === "before-submit" ? "pre-submit-failed" : proved ? "post-submit-proved" : "post-submit-unknown" };
    }
    const entries: LogEntry[] = entry === undefined ? [] : [entry];
    if (row.kind !== "observed" && screenshots.length > 0) entries.push({ kind: "decision", id: `${row.logId}:captures`, time,
      decision: { title: "Screenshot", state: "recorded", screenshots } });
    if (entries.length === 0) return [];
    return [{ id: row.logId, time, title: row.kind === "note" ? row.note.screenshot === undefined ? "Run note" : "Screenshot" : row.producer.step,
      ...(row.kind !== "note" && row.producer.system !== undefined ? { system: row.producer.system }
        : row.kind === "note" && row.note.operatorAction?.system !== undefined ? { system: row.note.operatorAction.system } : {}), entries }];
  });
  for (const section of sections) {
    if (section.section === "workbook-writes") {
      for (const operation of section.payload.operations) { order.set(operation.native.eventId, operation.native.order); steps.push(workbookWriteLogStep(operation)); }
      for (const choice of section.payload.referenceChoices ?? []) {
        const id = workbookReferenceChoiceId(choice), event = workbookReferenceTimelineEvent(choice, detail);
        const time = choice.resolution.state === "resolved" ? fmtActionClock(choice.resolution.resolvedAt) : event === undefined ? "—" : fmtActionClock(event.at);
        order.set(id, choice.native.order); node.set(id, event?.native?.nodeId ?? choice.native.nodeId);
        steps.push({ id, time, title: "Look up in roster", entries: [{ kind: "decision", id, time, decision: workbookReferenceLogDecision(choice) }] });
      }
    } else if (section.section === "parked-write") {
      const write = section.payload;
      const checked = write.lastCheck;
      const message = checked === undefined ? write.parkedMessage
        : formatErrorCatalogFailure(createErrorCatalogFailure(checked.code, {})).text;
      order.set(write.writeIntentId, requireNative(write.native).order); node.set(write.writeIntentId, requireNative(write.native).nodeId);
      steps.push({ id: write.writeIntentId, time: fmtActionClock(write.parkedAt), title: "Write parked", system: write.system,
        entries: [{ kind: "decision", id: write.writeIntentId, time: fmtActionClock(write.parkedAt), decision: { title: write.decision?.title ?? "Write parked", state: "parked",
          message, ...(write.decision === undefined ? {} : { served: write.decision }) } }] });
    } else if (section.section === "failure" && section.payload.state === "available") {
      const failure = section.payload.value;
      const message = operatorFailureSentence(failure.code);
      order.set(failure.failureId, requireNative(failure.native).order); node.set(failure.failureId, requireNative(failure.native).nodeId);
      steps.push({ id: failure.failureId, time: fmtActionClock(failure.occurredAt), title: failure.display?.title ?? failure.code,
        entries: [{ kind: "decision", id: failure.failureId, time: fmtActionClock(failure.occurredAt), decision: { title: failure.display?.title ?? failure.code,
          state: failure.writeState === "unknown" ? "unconfirmed" : "failed", message,
          ...(failure.writeState === "not-attempted" ? { footer: WRITE_STATE_NOTE[failure.writeState] } : { caution: WRITE_STATE_NOTE[failure.writeState] }),
          ...(failure.decision === undefined ? {} : { served: failure.decision }) } }] });
    } else if (section.section === "identity-gate" && section.payload.state === "available") {
      const gate = section.payload.value;
      const ceremony = identityCeremonyFor(gate);
      order.set(gate.gateRef, requireOrder(gate.order)); node.set(gate.gateRef, gateTimelineOwner(detail, gate)?.native?.nodeId ?? (detail.gate.state === "open" ? detail.gate.nodeId : undefined));
      steps.push({ id: gate.gateRef, time: fmtActionClock(gate.parkedAt), title: plainStepLabel(gate.label),
        entries: [{ kind: "decision", id: gate.gateRef, time: fmtActionClock(gate.parkedAt), decision: { title: gateOpen(detail) && gate.decision !== undefined ? gate.decision.title : plainStepLabel(gate.label), state: "review",
          message: gate.reason,
          comparison: gate.comparisons.map(comparison => ({ label: comparison.label, expected: comparison.request, observed: comparison.ucpath })),
          ...(ceremony.kind === "confirm" ? { field: { label: "Approving employee", value: `${ceremony.option.displayName} · ${directIdentifierDisplay(ceremony.option.maskedEid)}`,
            outcome: ceremony.option.origin } } : {}),
          ...(gateOpen(detail) && gate.decision !== undefined ? { served: gate.decision } : {}),
          ...(detail.gate.state === "resolved" && detail.gate.answer !== undefined ? { answered: detail.gate.answer } : {}) } }] });
    }
  }
  const decisionEvents = new Set(sections.flatMap(section => section.section === "identity-gate" && section.payload.state === "available"
    ? [gateTimelineOwner(detail, section.payload.value)?.native?.eventId ?? []].flat() : section.section === "workbook-writes"
      ? (section.payload.referenceChoices ?? []).map(choice => choice.native.eventId) : []));
  const failedNodes = new Set<string | undefined>(sections.flatMap(section => section.section === "failure" && section.payload.state === "available" ? [section.payload.value.nodeId] : []));
  for (const event of detail.timeline.events) {
    if (decisionEvents.has(requireNative(event.native).eventId)) continue;
    // The timeline strip already shows done, pending, running and failed stages; only a skip, wait or cancel adds a log line.
    if (event.state === "done" || event.state === "pending" || event.state === "active" || (event.state === "failed" && failedNodes.has(requireNative(event.native).nodeId))) continue;
    const time = fmtActionClock(event.at);
    groupable.add(event.noteId);
    order.set(event.noteId, requireNative(event.native).order); node.set(event.noteId, requireNative(event.native).nodeId);
    const state = { failed: "Failed", blocked: "Waiting", cancelled: "Cancelled", skipped: "Skipped" }[event.state];
    steps.push({ id: event.noteId, time, title: plainStepLabel(event.label), entries: [{ kind: "note", id: event.noteId, time,
      message: reasoned(state, event.notRun.state === "present" ? event.notRun.reason : undefined) }] });
  }
  if (new Set(steps.map(step => step.id)).size !== steps.length) throw new RunLogIdentityError("RUN_LOG_ROW_IDENTITY_DUPLICATE");
  const orderOf = (id: string): number => {
    const value = order.get(id);
    if (value === undefined) throw new RunLogIdentityError("RUN_LOG_NATIVE_IDENTITY_MISSING");
    return value;
  };
  steps.sort((left, right) => orderOf(left.id) - orderOf(right.id));
  const categories = detail.timeline.steps;
  if (categories === undefined) throw new RunLogIdentityError("RUN_LOG_CATEGORY_IDENTITY_MISSING");
  const categoryOf = new Map<string | undefined, (typeof categories)[number]>(categories.flatMap(category => category.members.map(member => [member.nodeId, category] as const)));
  const systemOf = new Map(steps.flatMap(step => step.system === undefined || node.get(step.id) === undefined ? [] : [[node.get(step.id), step.system] as const]));
  const grouped: LogStep[] = [];
  let previousKey: string | undefined;
  for (const step of steps) {
    const nodeId = node.get(step.id);
    const category = categoryOf.get(nodeId);
    const system = step.system ?? category?.system ?? systemOf.get(nodeId);
    const key = JSON.stringify([category?.key ?? step.id, system]);
    const previous = grouped.at(-1);
    if (previous !== undefined && key === previousKey && groupable.has(previous.id) && groupable.has(step.id)) {
      grouped[grouped.length - 1] = { ...previous, entries: [...previous.entries, ...step.entries] };
    } else grouped.push({ ...step, title: category?.label ?? step.title, ...(system === undefined ? {} : { system }) });
    previousKey = key;
  }
  const named = grouped.map(({ system: raw, ...step }): LogStep => {
    const system = systemName(raw);
    return system === undefined ? step : { ...step, system, entries: step.entries.map(entry => entryWithSystem(entry, system)) };
  });
  const timeline: LogTimelineStage[] = categories.map(category => {
    const members = new Set<string | undefined>(category.members.map(member => member.nodeId));
    const first = grouped.find(step => members.has(node.get(step.id)));
    if (category.key === undefined) throw new RunLogIdentityError("RUN_LOG_CATEGORY_IDENTITY_MISSING");
    return { id: category.key, label: category.label, state: category.state === "replayed" ? "completed" : TIMELINE_STATE[category.state],
      ...(first === undefined ? {} : { stepId: first.id, time: first.time }),
      ...(category.durationSec === undefined ? {} : { durationLabel: fmtElapsed(category.durationSec) }),
      substeps: category.members.map(member => {
        if (member.nodeId === undefined) throw new RunLogIdentityError("RUN_LOG_CATEGORY_MEMBER_IDENTITY_MISMATCH");
        return { id: member.nodeId, label: plainStepLabel(member.label),
        state: member.state === "replayed" ? "completed" : TIMELINE_STATE[member.state],
        ...(member.durationSec === undefined ? {} : { durationLabel: fmtElapsed(member.durationSec) }) }; }) };
  });
  const findings = sections.find(section => section.section === "parked-write" && section.payload.ucpathFindings !== undefined);
  return { steps: [...named, ...runDecisionStep(detail.decision, named.at(-1)?.time)], timeline,
    ...(findings?.section !== "parked-write" || findings.payload.ucpathFindings === undefined ? {} : { ucpathFindings: {
      stepId: findings.payload.writeIntentId, attemptLabel: `Attempt ${findings.payload.runAttempt}`,
      presentation: ucpathFoundPresentation(findings.payload.ucpathFindings),
    } }) };
}

/** The run-level decision (paused, stalled, cancelling) closes the log; a failed member's retry stays the header icon. */
export const RUN_DECISION_STEP_ID = "run-decision";
function runDecisionStep(decision: RunDetailWire["decision"], lastTime: string | undefined): readonly LogStep[] {
  if (decision === undefined || decision.type === "member-failed") return [];
  const time = lastTime ?? "—";
  const entry: LogEntry = decision.type === "cancelling" ? { kind: "note", id: RUN_DECISION_STEP_ID, time, message: decision.title }
    : { kind: "decision", id: RUN_DECISION_STEP_ID, time, decision: { title: decision.title, state: decision.type === "stalled" ? "failed" : "held", served: decision } };
  return [{ id: RUN_DECISION_STEP_ID, time, title: decision.title, header: false, entries: [entry] }];
}

function gateOpen(detail: RunDetailWire): boolean {
  return detail.gate.state === "open" && detail.gate.nodeId !== undefined && detail.captures !== undefined && detail.captures.state !== "error";
}

export type RunWiringState = Readonly<{ state: "loading" | "loaded" | "failed"; snapshot?: RunLogSnapshot; error?: string; diagnostic?: unknown }>;

interface GateCommandOwner {
  readonly client: DashboardClient;
  readonly runId: string;
  readonly day: string | undefined;
  readonly epoch: DashboardCommandBinding["authority"]["epoch"] | undefined;
  readonly dayRequest: object | undefined;
  readonly scope: CommandExecutionScope | undefined;
}

/** Shows the served confirmation for a decision and calls `onConfirmed` only when the operator confirms it. */
export type RunWiringConfirm = (pending: PendingCommand, onConfirmed: () => void) => void;

/** `source` is the failure id or identity gate ref whose served correction prepared this start. */
interface CorrectionLaunch { readonly envelope: DashboardCommandRequest; readonly sourceVersion: number; readonly source: string; readonly plan: StartPlanWire }
const correctionLaunches = new WeakMap<CommandExecutionScope, Map<string, CorrectionLaunch>>();

export function useRunWiring(client: DashboardClient, selection: LogSelection, binding: DashboardCommandBinding | undefined, confirm?: RunWiringConfirm) {
  const { row } = selection;
  const request = useMemo(() => ({ client, runId: row.runId, revision: row.rowRevision, day: binding?.authority.day, selection: { row, workflowLabel: selection.workflowLabel }, binding: binding?.scope,
    epoch: binding?.authority.epoch, actorId: binding?.scope.actorId, dayState: binding?.authority.dayState.day.state, dayRequest: binding?.authority.dayState.request, refreshDay: binding?.authority.dayState.refresh }),
  [client, row, selection.workflowLabel, binding?.authority.day, binding?.scope, binding?.authority.epoch, binding?.authority.dayState.day.state, binding?.authority.dayState.request, binding?.authority.dayState.refresh]);
  const commandOwner = useMemo<GateCommandOwner>(() => ({ client, runId: row.runId, day: binding?.authority.day,
    epoch: binding?.authority.epoch, dayRequest: binding?.authority.dayState.request, scope: binding?.scope }),
  [client, row.runId, binding?.authority.day, binding?.authority.epoch, binding?.authority.dayState.request, binding?.scope]);
  const currentCommandOwner = useRef(commandOwner);
  currentCommandOwner.current = commandOwner;
  const mounted = useRef(false);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const bindingRef = useRef(binding);
  bindingRef.current = binding;
  const [command, setCommand] = useState<{ owner: GateCommandOwner; envelope: DashboardCommandRequest; state: "pending" | "uncertain" | "refused" | "settled"; feedback?: string }>();
  const commandRef = useRef(command);
  commandRef.current = command;
  const active = useRef(request);
  active.current = request;
  const refreshBudget = useMemo(() => ({ client, runId: row.runId, actorId: binding?.scope.actorId,
    epoch: binding?.authority.epoch, day: binding?.authority.day, revisions: new Set<number>() }),
  [client, row.runId, binding?.scope.actorId, binding?.authority.epoch, binding?.authority.day]);
  const [settled, setSettled] = useState<{ request: typeof request; value: RunWiringState }>({ request, value: { state: "loading" } });
  const sameRun = settled.request.client === client && settled.request.runId === row.runId && settled.request.day === binding?.authority.day
    && settled.request.epoch === request.epoch && settled.request.actorId === request.actorId;
  const value = useMemo<RunWiringState>(() => settled.request === request ? settled.value
    : { state: "loading", ...(sameRun && settled.value.snapshot ? { snapshot: settled.value.snapshot } : {}) }, [settled, request, sameRun]);
  useEffect(() => {
    if (request.dayState !== undefined && request.dayState !== "loaded") return;
    const controller = new AbortController();
    void readRunLogs(client, request.selection, controller.signal).then(snapshot => {
      if (active.current === request && !controller.signal.aborted) setSettled({ request, value: { state: "loaded", snapshot } });
    }, cause => {
      if (active.current !== request || controller.signal.aborted) return;
      if (cause instanceof RunLogSelectionBehindError && request.refreshDay !== undefined && !refreshBudget.revisions.has(request.revision)) {
        refreshBudget.revisions.add(request.revision);
        request.refreshDay();
        return;
      }
      const error = cause instanceof RunLogIdentityError || (cause instanceof DashboardClientError && cause.code === "LOGS_IDENTITY_REFUSED")
        ? formatErrorCatalogFailure(createErrorCatalogFailure("LOGS_IDENTITY_REFUSED", {})).text
        : cause instanceof DashboardClientError && cause.code === "RUN_LOG_DISPLAY_VALUE_UNMAPPED"
        ? formatErrorCatalogFailure(createErrorCatalogFailure("RUN_LOG_DISPLAY_VALUE_UNMAPPED", {})).text
        : cause instanceof DashboardClientError && cause.kind !== "schema"
        ? formatErrorCatalogFailure(createErrorCatalogFailure("DASHBOARD_READ_FAILED", {})).text
        : formatErrorCatalogFailure(createErrorCatalogFailure("BOUNDARY_VALIDATION_FAILED", { source: "http-response" })).text;
      setSettled(current => ({ request, value: { state: "failed", error, diagnostic: cause,
        ...(current.request.client === client && current.request.runId === row.runId && current.request.epoch === request.epoch && current.value.snapshot ? { snapshot: current.value.snapshot } : {}) } }));
    });
    return () => controller.abort();
  }, [client, request, row.runId, refreshBudget]);
  const gate = value.state === "loaded" ? value.snapshot?.sections.find(section => section.section === "identity-gate") : undefined;
  const detail = value.snapshot?.detail;
  const batchRetry = batchMemberRetryAction(row);
  const detailGate = detail?.gate;
  const parked = value.state === "loaded" ? value.snapshot?.sections.find(section => section.section === "parked-write") : undefined;
  const failure = value.state === "loaded" ? value.snapshot?.sections.find(section => section.section === "failure" && section.payload.state === "available") : undefined;
  const workbookWrites = value.state === "loaded" ? value.snapshot?.sections.find(section => section.section === "workbook-writes") : undefined;
  const correctionCommand = useMemo(() => {
    if (binding === undefined) return undefined;
    let launches = correctionLaunches.get(binding.scope);
    if (launches === undefined) { launches = new Map(); correctionLaunches.set(binding.scope, launches); }
    return launches;
  }, [binding]);
  const launch = useMemo(() => binding === undefined ? undefined : createRunLaunchService(client, binding.scope.actorId,
    { uuid: () => crypto.randomUUID(), now: () => binding.authority.nowIso }), [client, binding]);
  const matchesGate = useCallback((envelope: DashboardCommandRequest) => envelope.family === "gate" && gate?.section === "identity-gate" && gate.payload.state === "available"
    && detailGate?.state === "open" && detailGate.nodeId?.valueOf() === envelope.target.gateId.valueOf() && gate.payload.value.expectedVersion === envelope.target.expectedVersion
    && row.rowRevision.valueOf() === envelope.target.expectedVersion.valueOf(), [gate, detailGate, row.rowRevision]);
  const matchesDecision = useCallback((envelope: DashboardCommandRequest) => {
    if (envelope.family === "gate") return matchesGate(envelope);
    if (envelope.family === "run" && envelope.type === "retry" && detail?.childRetry?.kind === "command") {
      const composed = composeCommandRequest(detail.childRetry, { runId: row.runId, expectedVersion: row.rowRevision }, {
        actorId: envelope.requestedBy, source: "run-detail", commandId: envelope.commandId, requestedAt: envelope.requestedAt, childRetry: detail.childRetry });
      return composed.state === "ready" && canonicalJsonStringify(composed.request) === canonicalJsonStringify(envelope);
    }
    if (envelope.family === "run" && envelope.type === "retry" && row.parent !== null) return envelope.target.runId === row.runId
      && envelope.target.expectedVersion.valueOf() === row.rowRevision.valueOf()
      && row.actions.some(action => action.kind === "command" && action.command === "retry" && action.expectedVersion === row.rowRevision);
    if (envelope.family === "run" && envelope.type === "retry" && batchRetry !== undefined) return envelope.target.runId === row.runId
      && envelope.target.expectedVersion.valueOf() === row.rowRevision.valueOf();
    if (envelope.family === "run" && envelope.type === "resolve-workbook-reference-row") {
      const choice = workbookWrites?.section === "workbook-writes" ? workbookWrites.payload.referenceChoices?.find(choice => choice.resolution.state === "available"
        && canonicalJsonStringify(choice.resolution.target) === canonicalJsonStringify(envelope.target)) : undefined;
      const composed = choice?.resolution.state === "available" && choice.resolution.action.kind === "command"
        ? composeCommandRequest(choice.resolution.action, { runId: row.runId, expectedVersion: row.rowRevision }, {
          actorId: envelope.requestedBy, source: "run-detail", commandId: envelope.commandId, requestedAt: envelope.requestedAt,
          workbookReferenceChoice: choice, workbookReferenceAnswer: envelope.payload }) : undefined;
      return composed?.state === "ready" && canonicalJsonStringify(composed.request) === canonicalJsonStringify(envelope);
    }
    if (envelope.family === "run" && envelope.type === "resolve-workbook-row") {
      const operation = workbookWrites?.section === "workbook-writes" ? workbookWrites.payload.operations.find(operation => operation.resolution.state === "available"
        && canonicalJsonStringify(operation.resolution.target) === canonicalJsonStringify(envelope.target)) : undefined;
      const composed = operation?.resolution.state === "available" && operation.resolution.action.kind === "command"
        ? composeCommandRequest(operation.resolution.action, { runId: row.runId, expectedVersion: row.rowRevision }, {
          actorId: envelope.requestedBy, source: "run-detail", commandId: envelope.commandId, requestedAt: envelope.requestedAt,
          workbookWrite: operation, workbookAnswer: envelope.payload }) : undefined;
      return composed?.state === "ready" && canonicalJsonStringify(composed.request) === canonicalJsonStringify(envelope);
    }
    if (envelope.family === "failure-resolution") {
      const served = failure?.section === "failure" && failure.payload.state === "available" ? failure.payload.value : undefined;
      return served?.resolution?.capability.state === "available" && envelope.target.runId === row.runId && envelope.target.failureId === served.failureId
        && envelope.target.expectedVersion === served.resolution.capture.resolution.version
        && served.decision?.options.some(option => option.send.via === "command" && option.send.family === envelope.family && option.send.type === envelope.type) === true;
    }
    if (failure?.section === "failure" && failure.payload.state === "available" && failure.payload.value.recovery !== undefined) {
      const served = failure.payload.value;
      if (envelope.family === "run" && envelope.type === "retry") return envelope.target.runId === row.runId
        && envelope.target.expectedVersion.valueOf() === row.rowRevision.valueOf() && served.recovery?.expectedVersion === row.rowRevision;
      const prepared = correctionCommand?.get(row.runId);
      if (envelope.family === "start" && prepared !== undefined) return prepared.sourceVersion === row.rowRevision
        && prepared.source === served.failureId && canonicalJsonStringify(prepared.envelope) === canonicalJsonStringify(envelope);
    }
    const lookup = gate?.section === "identity-gate" && gate.payload.state === "available" ? gate.payload.value : undefined;
    if (envelope.family === "start" && lookup?.correction !== undefined) {
      const prepared = correctionCommand?.get(row.runId);
      return prepared !== undefined && prepared.sourceVersion === row.rowRevision && lookup.correction.expectedVersion === row.rowRevision
        && prepared.source === lookup.gateRef && canonicalJsonStringify(prepared.envelope) === canonicalJsonStringify(envelope);
    }
    const held = envelope.family === "worker-browser" && envelope.type === "check-parked-write";
    if ((!held && (envelope.family !== "run" || (envelope.type !== "recheck-write" && envelope.type !== "resolve-write-absent")))
      || parked?.section !== "parked-write") return false;
    const descriptor = parked.payload.actions.find(action => action.kind === "command" && action.command === envelope.type);
    const composed = descriptor?.kind === "command" ? composeCommandRequest(descriptor,
      { runId: row.runId, expectedVersion: row.rowRevision }, { actorId: envelope.requestedBy, source: "run-detail", parkedWrite: parked.payload,
        commandId: envelope.commandId, requestedAt: envelope.requestedAt,
        ...(envelope.type === "recheck-write" ? { transactionId: envelope.payload.transactionId } : {}) }) : undefined;
    return composed?.state === "ready" && canonicalJsonStringify(composed.request) === canonicalJsonStringify(envelope);
  }, [matchesGate, gate, parked, failure, correctionCommand, row.runId, row.rowRevision, row.parent, row.actions, workbookWrites, detail, batchRetry]);
  const commandApplies = useCallback((attempt: NonNullable<typeof command>) => attempt.state === "pending" || attempt.state === "uncertain"
    || matchesDecision(attempt.envelope) || (attempt.state === "settled" && attempt.envelope.family === "run" && attempt.envelope.type !== "resolve-workbook-reference-row" && parked === undefined
      && row.rowRevision > attempt.envelope.target.expectedVersion) || (attempt.state === "settled" && attempt.envelope.family === "gate" && detailGate?.state === "resolved"
      && detailGate.nodeId?.valueOf() === attempt.envelope.target.gateId.valueOf()) || (attempt.state === "settled"
      && (sameHeldOccurrence(attempt.envelope, parked?.section === "parked-write" ? parked.payload : undefined)
        || workbookWrites?.section === "workbook-writes" && (workbookWrites.payload.operations.some(operation => operation.resolution.state === "resolved"
          && workbookWriteMatchesReplay(operation, attempt.envelope)) || detail !== undefined && workbookWrites.payload.referenceChoices?.some(choice => workbookReferenceMatchesReplay(choice, attempt.envelope, detail))))), [matchesDecision, detail, detailGate, row.rowRevision, parked, workbookWrites]);
  const commandBlocksDecision = useCallback((attempt: NonNullable<typeof command>) => attempt.state !== "refused"
    && (attempt.state !== "settled" || matchesDecision(attempt.envelope)), [matchesDecision]);
  const currentDecisionMatches = useRef(matchesDecision);
  currentDecisionMatches.current = matchesDecision;
  const currentParkedWrite = useRef<ParkedWriteDetailWire | undefined>(undefined);
  currentParkedWrite.current = parked?.section === "parked-write" ? parked.payload : undefined;
  const currentWorkbookWrites = useRef<readonly WorkbookWrite[]>([]);
  currentWorkbookWrites.current = workbookWrites?.section === "workbook-writes" ? workbookWrites.payload.operations : [];
  const currentReferenceChoices = useRef<readonly WorkbookReferenceChoice[]>([]);
  currentReferenceChoices.current = workbookWrites?.section === "workbook-writes" ? workbookWrites.payload.referenceChoices ?? [] : [];
  const currentDetail = useRef(detail);
  currentDetail.current = detail;
  const send = useCallback(async (envelope: DashboardCommandRequest, replay = false) => {
    const replayDetail = currentDetail.current;
    if (!mounted.current || currentCommandOwner.current !== commandOwner || binding === undefined
      || binding.scope.client !== client || bindingRef.current?.scope !== binding.scope
      || envelope.requestedBy !== binding.scope.actorId
      || envelope.family === "run" && envelope.type === "retry" && bindingRef.current.authority.dayState.day.state !== "loaded") return;
    const retainedChildRetry = envelope.family === "run" && envelope.type === "retry" && replayDetail !== undefined
      && childRetrySourceMatches(replayDetail, envelope.target);
    const retainedBatchRetry = envelope.family === "run" && envelope.type === "retry" && replayDetail?.rowRevision === row.rowRevision
      && batchMemberRetrySourceMatches(row, envelope.target);
    if (replay && envelope.family !== "gate" && !currentDecisionMatches.current(envelope)
      && !retainedChildRetry
      && !retainedBatchRetry
      && !sameHeldOccurrence(envelope, currentParkedWrite.current)
      && !currentWorkbookWrites.current.some(operation => workbookWriteMatchesReplay(operation, envelope))
      && !(replayDetail !== undefined && currentReferenceChoices.current.some(choice => workbookReferenceMatchesReplay(choice, envelope, replayDetail)))) {
      binding.feedback({ kind: "refused", commandId: envelope.commandId, reason: "not-attempted",
        feedback: formatErrorCatalogFailure(createErrorCatalogFailure("COMMAND_REFUSED", {})) });
      return;
    }
    setCommand({ owner: commandOwner, envelope, state: "pending" });
    const options = { scope: binding.scope, readback: (input: DashboardCommandRequest, reply: Parameters<typeof verifyShellCommandEffect>[3]) => verifyShellCommandEffect(client, binding.authority.day, input, reply),
      publish: (outcome: CommandOutcome) => {
        if (!mounted.current) return;
        setCommand(current => current?.owner !== commandOwner ? current : { owner: commandOwner, envelope,
          state: outcome.kind === "uncertain" ? "uncertain" : outcome.kind === "confirmed" ? "settled" : "refused",
          feedback: outcome.kind === "confirmed" ? "Decision confirmed" : "feedback" in outcome ? outcome.feedback.text : undefined });
        if (currentCommandOwner.current !== commandOwner) return;
        const currentBinding = bindingRef.current;
        if (currentBinding === undefined) return;
        currentBinding.feedback(outcome);
        if (outcome.kind === "confirmed" || outcome.kind === "refused" && (envelope.type === "resolve-workbook-row" || envelope.type === "resolve-workbook-reference-row")) currentBinding.authority.dayState.refresh();
      } };
    if (envelope.family === "start" && launch !== undefined) {
      await launch.submit(envelope, binding, correctionCommand?.get(row.runId)?.plan, options.publish);
      return;
    }
    if (replay) await binding.executor.replay(envelope.commandId, options);
    else await binding.executor.execute(envelope, options);
  }, [binding, client, commandOwner, launch, correctionCommand, row]);
  const dispatch = useCallback((envelope: DashboardCommandRequest) => {
    commandRef.current = { owner: commandOwner, envelope, state: "pending" };
    void send(envelope);
  }, [commandOwner, send]);
  const dispatchIfDecisionCurrent = useRef<(envelope: DashboardCommandRequest) => void>(() => undefined);
  dispatchIfDecisionCurrent.current = (envelope: DashboardCommandRequest) => {
    if (mounted.current && currentCommandOwner.current === commandOwner && value.state === "loaded" && matchesDecision(envelope)
      && (!(envelope.family === "run" && envelope.type === "retry") || bindingRef.current?.authority.dayState.day.state === "loaded")
      && !(commandRef.current?.owner === commandOwner && commandBlocksDecision(commandRef.current))) {
      dispatch(envelope);
      return;
    }
    bindingRef.current?.feedback({ kind: "refused", commandId: envelope.commandId, reason: "not-attempted",
      feedback: formatErrorCatalogFailure(createErrorCatalogFailure("COMMAND_REFUSED", {})) });
  };
  const onChildRetry = useCallback(() => {
    if (value.state !== "loaded" || binding === undefined || detail?.childRetry?.kind !== "command") return;
    const composed = composeCommandRequest(detail.childRetry, { runId: row.runId, expectedVersion: row.rowRevision }, {
      actorId: binding.scope.actorId, source: "run-detail", requestedAt: binding.authority.nowIso, childRetry: detail.childRetry });
    if (composed.state === "ready") dispatchIfDecisionCurrent.current(DashboardCommandRequestSchema.parse(composed.request));
  }, [value.state, binding, detail, row.runId, row.rowRevision]);
  const onBatchMemberRetry = useCallback(() => {
    if (value.state !== "loaded" || binding === undefined || batchRetry === undefined) return;
    const composed = composeCommandRequest(batchRetry, { runId: row.runId, expectedVersion: row.rowRevision }, {
      actorId: binding.scope.actorId, source: "run-detail", requestedAt: binding.authority.nowIso, batchMemberRetry: row });
    if (composed.state === "ready") dispatchIfDecisionCurrent.current(DashboardCommandRequestSchema.parse(composed.request));
  }, [value.state, binding, batchRetry, row]);
  const preparingCorrection = useRef(false);
  /** The served option this answer names, or undefined when the decision no longer serves it. */
  const servedOption = (decision: Readonly<{ options: readonly DecisionOptionWire[] }> | undefined, option: DecisionOptionWire) => decision?.options.find(candidate => candidate.id === option.id);
  const onDecision = useCallback((id: string, picked: DecisionOptionWire, answer: LogDecisionAnswer) => {
    if (value.state !== "loaded" || value.snapshot === undefined || binding === undefined || (commandRef.current?.owner === commandOwner && commandBlocksDecision(commandRef.current))) return;
    const workbooks = value.snapshot.sections.find(section => section.section === "workbook-writes");
    const reference = workbooks?.section === "workbook-writes" ? workbooks.payload.referenceChoices?.find(choice => workbookReferenceChoiceId(choice) === id) : undefined;
    if (reference !== undefined) {
      const choice = reference.resolution;
      const option = choice.state === "available" ? servedOption(choice.decision, picked) : undefined;
      const named = option === undefined ? undefined : answeredRow(option, answer);
      const candidate = choice.state === "available" ? choice.candidates.find(candidate => candidate.sheetId === named?.sheetId && candidate.rowId === named?.rowId
        && (candidate.referenceDigest === undefined || named?.id === `${candidate.referenceDigest}/${candidate.sheetId}/${candidate.rowId}`)) : undefined;
      if (choice.state !== "available" || choice.action.kind !== "command" || option === undefined || option.send.via !== "action" || option.send.actionKey !== choice.action.key
        || !decisionAnswerValid(option, answer) || candidate === undefined) return;
      const composed = composeCommandRequest(choice.action, { runId: row.runId, expectedVersion: row.rowRevision }, {
        actorId: binding.scope.actorId, source: "run-detail", requestedAt: binding.authority.nowIso, workbookReferenceChoice: reference,
        workbookReferenceAnswer: { sheetId: candidate.sheetId, rowId: candidate.rowId,
          ...(candidate.referenceDigest === undefined || candidate.workbookVersion === undefined ? {}
            : { referenceDigest: candidate.referenceDigest, workbookVersion: candidate.workbookVersion }) } });
      if (composed.state === "ready") dispatchIfDecisionCurrent.current(DashboardCommandRequestSchema.parse(composed.request));
      return;
    }
    const operation = workbooks?.section === "workbook-writes" ? workbooks.payload.operations.find(operation => operation.native.eventId === id) : undefined;
    if (operation !== undefined) {
      const choice = operation.resolution;
      const option = choice.state === "available" ? servedOption(choice.decision, picked) : undefined;
      const named = option === undefined ? undefined : answeredRow(option, answer);
      const candidate = choice.state === "available" ? choice.candidates.find(candidate => candidate.sheetId === named?.sheetId && candidate.rowId === named?.rowId) : undefined;
      if (choice.state !== "available" || choice.action.kind !== "command" || option === undefined || option.send.via !== "action" || option.send.actionKey !== choice.action.key
        || !decisionAnswerValid(option, answer) || candidate === undefined || confirm === undefined) return;
      const composed = composeCommandRequest(choice.action, { runId: row.runId, expectedVersion: row.rowRevision }, {
        actorId: binding.scope.actorId, source: "run-detail", requestedAt: binding.authority.nowIso, workbookWrite: operation,
        workbookAnswer: { sheetId: candidate.sheetId, rowId: candidate.rowId } });
      if (composed.state !== "ready") return;
      const envelope = DashboardCommandRequestSchema.parse(composed.request);
      confirm({ action: choice.action, target: { runId: row.runId, expectedVersion: row.rowRevision }, subject: row.title,
        traceId: String(row.traceId), workflowLabel: selection.workflowLabel, source: "run-detail", commandId: envelope.commandId,
        requestedAt: envelope.requestedAt, triggerElement: document.activeElement instanceof HTMLElement ? document.activeElement : null },
        () => dispatchIfDecisionCurrent.current(envelope));
      return;
    }
    const failed = value.snapshot.sections.find(section => section.section === "failure");
    if (failed?.section === "failure" && failed.payload.state === "available" && failed.payload.value.failureId === id) {
      const served = failed.payload.value;
      const recovery = served.recovery;
      const option = servedOption(served.decision, picked);
      if (option?.send.via === "command") {
        const resolution = served.resolution;
        if (option.send.family !== "failure-resolution" || option.send.type !== "annotate-failure" || resolution?.capability.state !== "available"
          || !decisionAnswerValid(option, answer)) return;
        const note = option.input?.kind === "text" ? answer.text?.trim() : undefined;
        dispatchIfDecisionCurrent.current(DashboardCommandRequestSchema.parse({ family: "failure-resolution", type: "annotate-failure", commandId: crypto.randomUUID(),
          requestedAt: binding.authority.nowIso, requestedBy: binding.scope.actorId, source: "run-detail",
          target: { runId: row.runId, failureId: served.failureId, expectedVersion: resolution.capture.resolution.version },
          payload: { action: "resolve", ...(note === undefined ? {} : { note }) } }));
        return;
      }
      if (recovery === undefined || option === undefined || !decisionAnswerValid(option, answer)
        || recovery.expectedVersion !== row.rowRevision || confirm === undefined) return;
      const retry = recovery.retry;
      if (retry.kind !== "command") return;
      const showConfirm = (envelope: DashboardCommandRequest, entering: boolean) => {
        confirm({ action: { ...retry,
          ...(entering ? { label: recovery.correction.actionLabel, confirm: recovery.confirm } : {}) },
          target: { runId: row.runId, expectedVersion: row.rowRevision }, subject: row.title, traceId: String(row.traceId),
          workflowLabel: selection.workflowLabel, source: "run-detail", commandId: envelope.commandId, requestedAt: envelope.requestedAt,
          triggerElement: document.activeElement instanceof HTMLElement ? document.activeElement : null },
          () => dispatchIfDecisionCurrent.current(envelope));
      };
      if (option.send.via === "action" && option.send.actionKey === retry.key) {
        const envelope = DashboardCommandRequestSchema.parse({ family: "run", type: "retry", commandId: crypto.randomUUID(), requestedAt: binding.authority.nowIso,
          requestedBy: binding.scope.actorId, source: "run-detail", target: { runId: row.runId, expectedVersion: row.rowRevision } });
        showConfirm(envelope, false);
      } else if (option.send.via === "start-plan" && launch !== undefined && !preparingCorrection.current) {
        preparingCorrection.current = true;
        void launch.preview({ ...recovery.request, submissions: [{ [recovery.correction.inputField]: answer.text?.trim() }] }).then(plan => {
          if (currentCommandOwner.current !== commandOwner) return;
          const envelope = DashboardCommandRequestSchema.parse({ ...launch.prepareFinal(plan), source: "run-detail" });
          correctionCommand?.set(row.runId, { envelope, sourceVersion: row.rowRevision, source: served.failureId, plan });
          if (currentDecisionMatches.current(envelope)) showConfirm(envelope, true);
        }).catch(() => {
          if (currentCommandOwner.current !== commandOwner) return;
          binding.feedback({ kind: "refused", commandId: crypto.randomUUID(), reason: "not-attempted",
            feedback: formatErrorCatalogFailure(createErrorCatalogFailure("COMMAND_REFUSED", {})) });
        }).finally(() => { preparingCorrection.current = false; });
      }
      return;
    }
    const write = value.snapshot.sections.find(section => section.section === "parked-write");
    if (write?.section === "parked-write" && write.payload.writeIntentId === id) {
      const option = servedOption(write.payload.decision, picked);
      if (option === undefined || !decisionAnswerValid(option, answer)) return;
      const key = option.send.via === "action" ? option.send.actionKey : undefined;
      const descriptor = write.payload.actions.find(candidate => candidate.key === key);
      if (descriptor?.kind !== "command" || descriptor.confirm === undefined || confirm === undefined) return;
      const composed = composeCommandRequest(descriptor, { runId: row.runId, expectedVersion: row.rowRevision },
        { actorId: binding.scope.actorId, source: "run-detail", requestedAt: binding.authority.nowIso, parkedWrite: write.payload,
          ...(descriptor.command === "recheck-write" && write.payload.acceptsTransactionId && option.input?.kind === "text"
            ? { transactionId: answer.text?.trim() } : {}) });
      if (composed.state !== "ready") return;
      const envelope = DashboardCommandRequestSchema.parse(composed.request);
      confirm({ action: descriptor, target: { runId: row.runId, expectedVersion: row.rowRevision }, subject: row.title,
        traceId: String(row.traceId), workflowLabel: selection.workflowLabel, source: "run-detail", commandId: envelope.commandId,
        requestedAt: envelope.requestedAt, triggerElement: document.activeElement instanceof HTMLElement ? document.activeElement : null },
        () => dispatchIfDecisionCurrent.current(envelope));
      return;
    }
    const section = value.snapshot.sections.find(section => section.section === "identity-gate");
    if (section?.section !== "identity-gate" || section.payload.state !== "available" || section.payload.value.gateRef !== id) return;
    const gate = section.payload.value, openGate = value.snapshot.detail.gate;
    if (!gateOpen(value.snapshot.detail) || openGate.state !== "open") return;
    const option = servedOption(gate.decision, picked);
    if (option === undefined || option.send.via !== "action" || !decisionAnswerValid(option, answer)) return;
    const key = option.send.actionKey;
    const descriptor = gate.actions.find(candidate => candidate.key === key);
    if (descriptor?.kind !== "command") return;
    const typed = option.input?.kind === "candidate" && answer.typed !== undefined ? lookupTyped(option.input.table, answer.typed) : undefined;
    if (typed !== undefined) {
      // A typed Employee ID is looked up by a run that replaces this one; it never answers the gate.
      const correction = gate.correction;
      if (correction === undefined || correction.expectedVersion !== row.rowRevision || launch === undefined || confirm === undefined || preparingCorrection.current) return;
      preparingCorrection.current = true;
      void launch.preview({ ...correction.request, submissions: [{ [correction.inputField]: typed }] }).then(plan => {
        if (currentCommandOwner.current !== commandOwner) return;
        const envelope = DashboardCommandRequestSchema.parse({ ...launch.prepareFinal(plan), source: "run-detail" });
        correctionCommand?.set(row.runId, { envelope, sourceVersion: row.rowRevision, source: gate.gateRef, plan });
        if (!currentDecisionMatches.current(envelope)) return;
        confirm({ action: { ...descriptor, label: correction.confirm.confirmLabel, confirm: correction.confirm }, target: { runId: row.runId, expectedVersion: row.rowRevision },
          subject: row.title, traceId: String(row.traceId), workflowLabel: selection.workflowLabel, source: "run-detail", commandId: envelope.commandId,
          requestedAt: envelope.requestedAt, triggerElement: document.activeElement instanceof HTMLElement ? document.activeElement : null },
          () => dispatchIfDecisionCurrent.current(envelope));
      }).catch(() => {
        if (currentCommandOwner.current !== commandOwner) return;
        binding.feedback({ kind: "refused", commandId: crypto.randomUUID(), reason: "not-attempted",
          feedback: formatErrorCatalogFailure(createErrorCatalogFailure("COMMAND_REFUSED", {})) });
      }).finally(() => { preparingCorrection.current = false; });
      return;
    }
    const optionRef = answeredRow(option, answer)?.id;
    const composed = composeCommandRequest(descriptor, { runId: row.runId, expectedVersion: gate.expectedVersion }, { actorId: binding.scope.actorId, source: "run-detail",
      requestedAt: binding.authority.nowIso, gate: section.payload, gateId: openGate.nodeId,
      ...(optionRef !== undefined ? { gateAnswer: { decision: "approved", optionRef } } : {}) });
    if (composed.state !== "ready") return;
    const envelope = DashboardCommandRequestSchema.parse(composed.request);
    if (descriptor.confirm === undefined) { dispatch(envelope); return; }
    if (confirm === undefined) return;
    confirm({ action: descriptor, target: { runId: row.runId, expectedVersion: gate.expectedVersion }, subject: row.title, traceId: String(row.traceId),
      workflowLabel: selection.workflowLabel, source: "run-detail", commandId: envelope.commandId, requestedAt: envelope.requestedAt,
      triggerElement: document.activeElement instanceof HTMLElement ? document.activeElement : null }, () => dispatchIfDecisionCurrent.current(envelope));
  }, [value, binding, commandOwner, row, selection.workflowLabel, dispatch, commandBlocksDecision, confirm, launch, correctionCommand]);
  const onUcpathDecision = useCallback((decision: UcpathFoundDecision) => {
    if (decision.kind !== "check-again" || parked?.section !== "parked-write" || parked.payload.ucpathFindings === undefined
      || decision.transactionNumber !== undefined && !parked.payload.acceptsTransactionId) return;
    const wanted = decision.transactionNumber === undefined ? "check-again" : "saved";
    const option = parked.payload.decision?.options.find(candidate => candidate.id === wanted);
    if (option !== undefined) onDecision(parked.payload.writeIntentId, option,
      decision.transactionNumber === undefined ? {} : { text: decision.transactionNumber });
  }, [parked, onDecision]);
  const newest = binding?.executor.retainedAttempts().findLast(attempt => {
    const request = attempt.request;
    if ("targets" in request || request.requestedBy !== binding.scope.actorId || attempt.scope.client !== binding.scope.client
      || attempt.scope.authority !== binding.scope.authority || attempt.scope.dayRequest !== binding.scope.dayRequest) return false;
    if (request.family === "start") return correctionCommand?.get(row.runId)?.envelope.commandId === request.commandId;
    return (request.family === "gate" || (request.family === "worker-browser" && request.type === "check-parked-write")
      || (request.family === "run" && ["recheck-write", "resolve-write-absent", "retry", "resolve-workbook-row", "resolve-workbook-reference-row"].includes(request.type)))
      && request.target.runId === row.runId;
  });
  const retained = newest !== undefined && !("targets" in newest.request) && (newest.request.family === "gate" || newest.request.family === "run" || newest.request.family === "start"
    || newest.request.family === "worker-browser" && newest.request.type === "check-parked-write") && (newest.state === "pending" || newest.outcome?.kind === "uncertain"
    || (newest.outcome !== undefined && (newest.outcome.kind !== "confirmed" || newest.request.family === "start") && matchesDecision(newest.request))) ? newest : undefined;
  const retainedEnvelope = retained !== undefined && !("targets" in retained.request) && (retained.request.family === "gate" || retained.request.family === "run" || retained.request.family === "start"
    || retained.request.family === "worker-browser" && retained.request.type === "check-parked-write") ? retained.request : undefined;
  const retainedState = retained === undefined ? undefined : retained.state === "pending" ? "pending" : retained.outcome?.kind === "uncertain" ? "uncertain" : retained.outcome?.kind === "confirmed" ? "settled" : "refused";
  const retainedFeedback = retained?.outcome !== undefined && "feedback" in retained.outcome ? retained.outcome.feedback.text : undefined;
  const retainedCommand = useMemo<typeof command>(() => retainedEnvelope === undefined || retainedState === undefined ? undefined
    : { owner: commandOwner, envelope: retainedEnvelope, state: retainedState, feedback: retainedFeedback },
  [commandOwner, retainedEnvelope, retainedState, retainedFeedback]);
  const currentCommand = command?.owner === commandOwner && command !== undefined && commandApplies(command)
    && (command.state !== "refused" || newest === undefined || newest.request.commandId === command.envelope.commandId) ? command : retainedCommand;
  const replayEnvelope = currentCommand?.state === "uncertain" ? currentCommand.envelope : undefined;
  const replay = useCallback(() => { if (replayEnvelope !== undefined) void send(replayEnvelope, true); }, [replayEnvelope, send]);
  return { ...value, onDecision: value.state === "loaded" && binding !== undefined && (currentCommand === undefined || !commandBlocksDecision(currentCommand)) ? onDecision : undefined,
    onChildRetry: value.state === "loaded" && binding?.authority.dayState.day.state === "loaded" && detail?.childRetry !== undefined
      && (currentCommand === undefined || !commandBlocksDecision(currentCommand)) ? onChildRetry : undefined,
    onBatchMemberRetry: value.state === "loaded" && binding?.authority.dayState.day.state === "loaded" && batchRetry !== undefined
      && (currentCommand === undefined || !commandBlocksDecision(currentCommand)) ? onBatchMemberRetry : undefined,
    onUcpathDecision: value.state === "loaded" && binding !== undefined && parked?.section === "parked-write"
      && parked.payload.actions.some(action => action.kind === "command" && action.command === "check-parked-write")
      && (currentCommand === undefined || !commandBlocksDecision(currentCommand)) ? onUcpathDecision : undefined,
    command: currentCommand, replay: replayEnvelope === undefined || replayEnvelope.family === "run" && replayEnvelope.type === "retry" && binding?.authority.dayState.day.state !== "loaded" ? undefined : replay };
}
