import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DashboardClientError } from "../client/errors.js";
import type { ConfirmedActionEvent } from "../../models/events/confirmed-action.js";
import type { DashboardClient } from "../client/index.js";
import type { DashboardCommandBinding } from "../app/dashboard-app-model.js";
import type { CommandOutcome, CommandExecutionScope } from "../app/commands/command-executor.js";
import { composeCommandRequest, verifyShellCommandEffect } from "../app/commands/command-dispatch.js";
import { CommandRequestSchema, type CommandRequest } from "../../rules/commands/commands.js";
import type { LogDecisionAction, LogDecisionAnswer } from "../surfaces/run-detail/logs/log-decision-model.js";
import { identityCeremonyFor } from "../surfaces/run-detail/identity/identity-ceremony.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure, resolveErrorCatalogFailure } from "../../models/failures/error-catalog.js";
import { DeclaredActionIdentitySchema } from "../../models/workflow/operation-action-identity.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { directIdentifierDisplay } from "../../rules/redaction/redaction.js";
import type { ConfirmedActionBindingWire, NativeRunEventWire, IdentityGateDetailWire, RunDetailSectionResponse, RunDetailWire } from "../../models/dashboard/run-detail.js";
import { appendLogPage, logRowsOf, type NotePage } from "../surfaces/run-detail/logs-model.js";
import type { LogEntry, LogScreenshot, LogStep } from "../surfaces/run-detail/logs/log-feed-model.js";
import type { LogTimelineStage, LogTimelineState } from "../surfaces/run-detail/logs/log-timeline-model.js";
import type { LogSelection } from "../surfaces/run-detail/logs/log-selection-model.js";
import { fmtActionClock, fmtElapsed } from "../surfaces/shared/status/format.js";

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

type RunReads = Pick<DashboardClient, "runDetail" | "runSection">;
export interface RunLogSnapshot {
  readonly detail: RunDetailWire;
  readonly logs: NotePage;
  readonly sections: readonly RunDetailSectionResponse[];
  readonly actionEvidence: Readonly<{ state: "available" | "unavailable"; events: readonly ConfirmedActionEvent[]; missingPages: readonly string[] }>;
  readonly confirmedActionBindings?: readonly ConfirmedActionBindingWire[];
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
  const missingPages: string[] = logs.confirmedActions === undefined ? ["initial"] : [];
  const actions: ConfirmedActionEvent[] = logs.confirmedActions === undefined ? [] : [...logs.confirmedActions];
  const confirmedActionBindings = [...(logs.confirmedActionBindings ?? [])];
  const cursors = new Set<string>();
  while (logs.nextCursor.state === "present") {
    signal.throwIfAborted();
    const cursor = logs.nextCursor.value;
    if (cursors.has(cursor)) throw new RunLogIdentityError("RUN_LOG_CURSOR_REPEATED");
    cursors.add(cursor);
    const next = await client.runSection(row.runId, "logs", cursor, signal);
    if (next.section !== "logs") throw new RunLogIdentityError("RUN_SECTION_IDENTITY_MISMATCH");
    if (next.payload.confirmedActions === undefined) missingPages.push(cursor);
    else actions.push(...next.payload.confirmedActions);
    confirmedActionBindings.push(...(next.payload.confirmedActionBindings ?? []));
    logs = appendLogPage(logs, cursor, next.payload);
  }
  if (actions.some(event => event.action.runId !== row.runId
    || event.action.attempt > row.attempt || event.traceId !== row.traceId)) throw new RunLogIdentityError("RUN_LOG_ACTION_IDENTITY_MISMATCH");
  if (detail.captures !== undefined && detail.captures.state !== "error" && ((detail.captures.state === "available") !== detail.availableSections.includes("captures"))) throw new RunLogIdentityError("RUN_CAPTURE_CAPABILITY_MISMATCH");
  if (new Set(actions.map(event => event.eventId)).size !== actions.length) throw new RunLogIdentityError("RUN_LOG_ACTION_DUPLICATE");
  if (logRowsOf(logs, "identity").some(log => log.kind !== "note" && (log.attempt > row.attempt || log.traceId !== row.traceId))) throw new RunLogIdentityError("RUN_LOG_ROW_IDENTITY_MISMATCH");
  if (logs.operationStructure?.state === "observed" && logs.operationStructure.observations.some(observation =>
    observation.occurrence.runId !== row.runId || observation.occurrence.attempt > row.attempt)) throw new RunLogIdentityError("RUN_LOG_ACTION_IDENTITY_MISMATCH");
  signal.throwIfAborted();
  const unavailableEvidence: string[] = [];
  if (missingPages.length > 0) unavailableEvidence.push("Confirmed actions unavailable on one or more pages");
  if (detail.captures === undefined) unavailableEvidence.push("Capture availability not supplied");
  else if (detail.captures.state === "error") unavailableEvidence.push("Captures unavailable");
  const sections = await Promise.all(detail.availableSections.filter(name => ["captures", "identity-gate", "parked-write", "failure"].includes(name)
    && (name !== "captures" || detail.captures?.state === "available"))
    .map(name => client.runSection(row.runId, name, undefined, signal)));
  for (const section of sections) {
    if (section.section === "captures" && (detail.captures?.state !== "available"
      || detail.captures.artifactCount !== section.payload.artifacts.length)) throw new RunLogIdentityError("RUN_CAPTURE_CAPABILITY_MISMATCH");
    if (section.section === "identity-gate" && section.payload.state === "available"
      && (section.payload.value.expectedVersion !== row.rowRevision || detail.gate.state !== "open"
        || (detail.gate.nodeId !== undefined && detail.gate.nodeId !== section.payload.value.gateId))) throw new RunLogIdentityError("RUN_GATE_IDENTITY_MISMATCH");
    if (section.section === "failure" && section.payload.state === "available" && (section.payload.value.attempt !== row.attempt
      || section.payload.value.traceId !== row.traceId || section.payload.value.workflowId !== row.workflowId)) throw new RunLogIdentityError("RUN_FAILURE_IDENTITY_MISMATCH");
    if (section.section === "parked-write" && section.payload.runAttempt !== row.attempt) throw new RunLogIdentityError("RUN_WRITE_IDENTITY_MISMATCH");
  }
  if (sections.some(section => section.section === "identity-gate" && section.payload.state === "available") && detail.gate.state === "open" && detail.gate.nodeId === undefined) {
    unavailableEvidence.push("Identity decision join not supplied");
  }
  const snapshot: RunLogSnapshot = { detail, logs, sections, confirmedActionBindings, actionEvidence: { state: missingPages.length === 0 ? "available" : "unavailable", events: actions, missingPages }, unavailableEvidence };
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
  const bindings = snapshot.confirmedActionBindings ?? [];
  const actions = snapshot.actionEvidence.events;
  if (bindings.length !== actions.length || new Set(actions.map(event => event.eventId)).size !== actions.length
    || new Set(bindings.map(binding => binding.native.eventId)).size !== bindings.length
    || new Set(bindings.map(binding => binding.eventId)).size !== bindings.length) throw new RunLogIdentityError("RUN_LOG_CONFIRMATION_BINDING_MISMATCH");
  for (const event of actions) {
    if (event.action.runId !== detail.runId || event.action.attempt > detail.header.attempt) throw new RunLogIdentityError("RUN_LOG_ACTION_IDENTITY_MISMATCH");
    const binding = bindings.find(binding => binding.eventId === event.eventId);
    if (binding === undefined) throw new RunLogIdentityError("RUN_LOG_CONFIRMATION_BINDING_MISSING");
    const identity = native(binding.native);
    const owner = rows.find(row => row.native?.eventId === identity.eventId);
    const target = rows.find(row => row.logId === binding.logId);
    const observation = logs.operationStructure?.state === "observed"
      ? logs.operationStructure.observations.filter(observation => observation.logId === binding.logId) : [];
    const { value: _value, ...action } = event.action;
    const targetAction = observation[0]?.occurrence;
    const { value: _targetValue, ...targetIdentity } = targetAction ?? {};
    if (owner?.kind !== "note" || target === undefined || observation.length !== 1
      || canonicalJsonStringify(DeclaredActionIdentitySchema.parse(targetIdentity)) !== canonicalJsonStringify(DeclaredActionIdentitySchema.parse(action))
      || canonicalJsonStringify(identity) !== canonicalJsonStringify(owner.native)
      || identity.attempt !== target.native?.attempt || identity.nodeId !== event.action.nodeId
      || identity.attempt !== event.action.attempt || event.traceId !== identity.traceId
      || target.native?.nodeId !== event.action.nodeId
      || target.native?.order === undefined) throw new RunLogIdentityError("RUN_LOG_CONFIRMATION_TARGET_MISMATCH");
  }
  for (const section of snapshot.sections) {
    const identity = section.section === "parked-write" ? native(section.payload.native)
      : (section.section === "failure" || section.section === "identity-gate") && section.payload.state === "available"
        ? native(section.payload.value.native) : undefined;
    if (identity === undefined) continue;
    const timelineOwner = detail.timeline.events.find(event => event.native?.eventId === identity.eventId);
    if (timelineOwner !== undefined) {
      if (section.section !== "identity-gate" || section.payload.state !== "available"
        || canonicalJsonStringify(timelineOwner.native) !== canonicalJsonStringify(identity)) {
        throw new RunLogIdentityError("RUN_LOG_DECISION_IDENTITY_DUPLICATE");
      }
    } else {
      if (eventIds.has(identity.eventId) || orders.has(identity.order)) throw new RunLogIdentityError("RUN_LOG_DECISION_IDENTITY_DUPLICATE");
      eventIds.add(identity.eventId); orders.add(identity.order);
    }
    if (identity.nodeId !== undefined && !nodes.has(identity.nodeId)) throw new RunLogIdentityError("RUN_LOG_NODE_CATEGORY_MISSING");
    if (section.section === "parked-write" && (section.payload.runId !== identity.runId
      || section.payload.runAttempt !== identity.attempt || identity.nodeId === undefined)) throw new RunLogIdentityError("RUN_LOG_WRITE_IDENTITY_MISMATCH");
    if (section.section === "identity-gate" && section.payload.state === "available"
      && (section.payload.value.runId !== identity.runId || section.payload.value.gateId !== identity.nodeId)) throw new RunLogIdentityError("RUN_LOG_GATE_IDENTITY_MISMATCH");
    if (section.section === "failure" && section.payload.state === "available"
      && (section.payload.value.runId !== identity.runId || section.payload.value.attempt !== identity.attempt
        || section.payload.value.nodeId !== identity.nodeId)) throw new RunLogIdentityError("RUN_LOG_FAILURE_IDENTITY_MISMATCH");
  }
}

const TIMELINE_STATE: Record<RunDetailWire["timeline"]["events"][number]["state"], LogTimelineState> = {
  pending: "pending", active: "active", done: "completed", failed: "failed", blocked: "waiting", cancelled: "cancelled", skipped: "skipped",
};

function operatorActionReason(reason: string): string {
  switch (reason) {
    case "condition-false": return "Not needed for this run";
    case "branch-not-selected": return "Another path was selected";
    case "operator-asserted": return "Supplied by the operator";
    case "step-omitted": return "Step omitted";
    case "dry-run": return "Dry run";
    case "cancelled": return "Cancelled";
    case "callback-failed": return "Action failed";
    default: return "Details retained in diagnostics";
  }
}

export function projectRunLogs(snapshot: RunLogSnapshot, client: Pick<DashboardClient, "artifactUrl">): Readonly<{ steps: readonly LogStep[]; timeline: readonly LogTimelineStage[] }> {
  validateRunLogSnapshot(snapshot);
  const { detail, logs, sections } = snapshot;
  const order = new Map<string, number>();
  const groupable = new Set<string>();
  const node = new Map<string, string | undefined>();
  const bindings = snapshot.confirmedActionBindings ?? [];
  const confirmationNotes = new Set(bindings.map(binding => binding.native.eventId));
  const confirmedActions = snapshot.actionEvidence.events;
  const captures = sections.find(section => section.section === "captures");
  const screenshotsOf = (row: ReturnType<typeof logRowsOf>[number]): readonly LogScreenshot[] => {
    const logId = row.logId;
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
      const { artifact, capturedAt } = matches[0];
      return [{ src: client.artifactUrl(artifact.artifactId), alt: "Browser capture", time: fmtActionClock(capturedAt),
        width: artifact.width, height: artifact.height, kind: "browser" }];
    }
    const observation = logs.operationStructure?.state === "observed" ? logs.operationStructure.observations.find(row => row.logId === logId) : undefined;
    if (captures?.section !== "captures" || observation === undefined) return [];
    const { value: _value, ...occurrence } = observation.occurrence;
    const identity = canonicalJsonStringify(DeclaredActionIdentitySchema.parse(occurrence));
    return captures.payload.artifacts.flatMap(capture => {
      const artifact = capture.artifact;
      if (artifact.mediaKind !== "image") return [];
      return capture.origins.flatMap(origin =>
      origin.operation !== undefined && origin.capturedAt !== undefined && canonicalJsonStringify(origin.operation) === identity
        ? [{ src: client.artifactUrl(artifact.artifactId), alt: `${origin.originKind} capture`, time: fmtActionClock(origin.capturedAt),
          width: artifact.width, height: artifact.height }] : []);
    });
  };
  const observedCauses = new Set<string>();
  const steps = logRowsOf(logs, "projection").filter(row => !confirmationNotes.has(requireNative(row.native).eventId) || bindings.some(binding => binding.logId === row.logId)).flatMap((row): LogStep[] => {
    if (row.kind !== "transaction-fenced") groupable.add(row.logId);
    order.set(row.logId, requireNative(row.native).order);
    node.set(row.logId, requireNative(row.native).nodeId);
    const at = row.kind === "note" ? row.note.at : row.at;
    const time = fmtActionClock(at);
    const screenshots = screenshotsOf(row);
    let entry: LogEntry | undefined;
    if (row.kind === "observed") {
      const fields = row.displayFields?.flatMap((field, index) => {
        if (field.causal !== undefined) {
          const key = canonicalJsonStringify([field.direction, field.causal]);
          if (observedCauses.has(key)) return [];
          observedCauses.add(key);
        }
        return [{ id: `${row.logId}:${index}`, time, kind: field.direction === "read" ? "read" as const : "fill" as const, label: field.label, value: field.value }];
      }) ?? [];
      entry = row.displayFields === undefined || row.displayFields.length === 0
        ? { kind: "note", id: row.logId, time, message: "Observed values have no declared operator labels; retained in run data." }
        : fields.length > 0 ? { kind: "fields", id: row.logId, fields, screenshots }
        : screenshots.length > 0 ? { kind: "decision", id: `${row.logId}:captures`, time, decision: { title: "Screenshot", state: "recorded", screenshots } } : undefined;
    }
    else if (row.kind === "transaction-fenced") entry = { kind: "note", id: row.logId, time, message: "Write fenced; submission is not confirmed." };
    else if (row.note.screenshot !== undefined) entry = undefined;
    else if (row.note.operatorAction !== undefined) {
      const action = row.note.operatorAction;
      if (action.state === "failed" || action.state === "not-run" || action.state === "started") {
        const state = action.state === "failed" ? "Failed" : action.state === "not-run" ? "Skipped" : "Started";
        entry = { kind: "note", id: row.logId, time, message: `${state}: ${action.label}${action.reason === undefined ? "" : ` · ${operatorActionReason(action.reason)}`}`,
          ...(action.state === "failed" ? { tone: "danger" } : {}) };
      } else if (action.kind === "click") entry = { kind: "click", id: row.logId, time, label: action.label };
      else if (action.kind === "fill" || action.kind === "read") entry = action.value === undefined
        ? { kind: "note", id: row.logId, time, message: `${action.kind === "fill" ? "Fill" : "Read"}: ${action.label}. Value not retained.` }
        : { kind: "fields", id: row.logId, fields: [{ id: row.logId, time, kind: action.kind, label: action.label, value: action.value }] };
      else entry = { kind: "note", id: row.logId, time, message: action.kind === "screenshot"
        ? "Screenshot unavailable: no verified capture association." : action.label };
    } else entry = { kind: "note", id: row.logId, time, message: row.note.message, ...(row.note.level === "error" ? { tone: "danger" } : {}) };
    const entries: LogEntry[] = entry === undefined ? [] : [entry];
    for (const binding of bindings.filter(binding => binding.logId === row.logId).toSorted((left, right) => left.native.order - right.native.order)) {
      const event = confirmedActions.find(event => event.eventId === binding.eventId);
      if (event === undefined) throw new RunLogIdentityError("RUN_LOG_CONFIRMATION_BINDING_MISSING");
      const message = event.kind === "fact" ? `${event.meaning} confirmed`
        : `${{ started: "Action started", completed: "Action completed", failed: "Action failed", "not-run": "Action skipped" }[event.state]}${event.reason === undefined ? "" : ` · ${operatorActionReason(event.reason)}`}`;
      entries.push({ kind: "note", id: event.eventId,
        time: fmtActionClock(event.kind === "fact" ? event.confirmedAt : event.occurredAt), message,
        ...(event.kind === "trace" && event.state === "failed" ? { tone: "danger" } : {}) });
    }
    if (row.kind !== "observed" && screenshots.length > 0) entries.push({ kind: "decision", id: `${row.logId}:captures`, time,
      decision: { title: "Screenshot", state: "recorded", screenshots } });
    if (row.kind === "observed" && entries.length === 0) return [];
    return [{ id: row.logId, time, title: row.kind === "note" ? row.note.screenshot === undefined ? "Run note" : "Screenshot" : row.producer.step,
      ...(row.kind !== "note" && row.producer.system !== undefined ? { system: row.producer.system }
        : row.kind === "note" && row.note.operatorAction?.system !== undefined ? { system: row.note.operatorAction.system } : {}), entries }];
  });
  for (const section of sections) {
    if (section.section === "parked-write") {
      const write = section.payload;
      order.set(write.writeIntentId, requireNative(write.native).order); node.set(write.writeIntentId, requireNative(write.native).nodeId);
      steps.push({ id: write.writeIntentId, time: fmtActionClock(write.parkedAt), title: "Write parked", system: write.system,
        entries: [{ kind: "decision", id: write.writeIntentId, time: fmtActionClock(write.parkedAt), decision: { title: "Write parked", state: "parked",
          message: write.parkedMessage, footer: "Resolution unavailable: this panel cannot collect the required write proof." } }] });
    } else if (section.section === "failure" && section.payload.state === "available") {
      const failure = section.payload.value;
      const resolution = resolveErrorCatalogFailure(failure, "http-response");
      const message = resolution.state === "resolved" ? resolution.text : resolution.catalogFault.text;
      order.set(failure.failureId, requireNative(failure.native).order); node.set(failure.failureId, requireNative(failure.native).nodeId);
      steps.push({ id: failure.failureId, time: fmtActionClock(failure.occurredAt), title: failure.display?.title ?? failure.code,
        entries: [{ kind: "decision", id: failure.failureId, time: fmtActionClock(failure.occurredAt), decision: { title: failure.display?.title ?? failure.code,
          state: failure.writeState === "unknown" ? "unconfirmed" : "failed", message, caution: `Write state: ${failure.writeState}`,
          footer: "Resolution unavailable: this panel cannot collect a failure annotation." } }] });
    } else if (section.section === "identity-gate" && section.payload.state === "available") {
      const gate = section.payload.value;
      const ceremony = identityCeremonyFor(gate, "approved");
      order.set(gate.gateId, requireNative(gate.native).order); node.set(gate.gateId, requireNative(gate.native).nodeId);
      steps.push({ id: gate.gateId, time: fmtActionClock(gate.parkedAt), title: gate.label,
        entries: [{ kind: "decision", id: gate.gateId, time: fmtActionClock(gate.parkedAt), decision: { title: gate.label, state: "review",
          message: gate.packet.comparisons.map(comparison => comparison.note).join(" "),
          comparison: gate.packet.comparisons.map(comparison => ({ label: comparison.field, expected: comparison.documentValue, observed: comparison.ucpathValue })),
          ...(ceremony.kind === "confirm" ? { field: { label: "Approving employee", value: `${ceremony.option.displayName} · ${directIdentifierDisplay(ceremony.option.eid)}`,
            outcome: `${ceremony.option.chosenFrom} · ${ceremony.option.origin}` } } : {}),
          footer: "Some resolutions are unavailable: this panel cannot collect typed identity or rejection text.", actions: detail.gate.state === "open" && detail.gate.nodeId === gate.gateId && detail.captures !== undefined && detail.captures.state !== "error" ? gateLogActions(gate) : undefined } }] });
    }
  }
  const decisionEvents = new Set(sections.flatMap(section => section.section === "identity-gate" && section.payload.state === "available"
    ? [requireNative(section.payload.value.native).eventId] : []));
  for (const event of detail.timeline.events) {
    if (decisionEvents.has(requireNative(event.native).eventId)) continue;
    const time = fmtActionClock(event.at);
    groupable.add(event.noteId);
    order.set(event.noteId, requireNative(event.native).order); node.set(event.noteId, requireNative(event.native).nodeId);
    const state = { pending: "Pending", active: "In progress", done: "Completed", failed: "Failed", blocked: "Waiting", cancelled: "Cancelled", skipped: "Skipped" }[event.state];
    steps.push({ id: event.noteId, time, title: event.label, entries: event.state === "done" ? [] : [{ kind: "note", id: event.noteId, time,
      message: `${state}${event.notRun.state === "present" ? ` · ${operatorActionReason(event.notRun.reason)}` : ""}` }] });
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
  for (const [index, step] of grouped.entries()) if (step.entries.length === 0) grouped[index] = { ...step,
    entries: [{ kind: "note", id: step.id, time: step.time, message: `${step.title} completed.` }] };
  const timeline: LogTimelineStage[] = categories.map(category => {
    const members = new Set<string | undefined>(category.members.map(member => member.nodeId));
    const first = grouped.find(step => members.has(node.get(step.id)));
    if (category.key === undefined) throw new RunLogIdentityError("RUN_LOG_CATEGORY_IDENTITY_MISSING");
    return { id: category.key, label: category.label, state: category.state === "replayed" ? "completed" : TIMELINE_STATE[category.state],
      ...(first === undefined ? {} : { stepId: first.id, time: first.time }),
      ...(category.durationSec === undefined ? {} : { durationLabel: fmtElapsed(category.durationSec) }),
      substeps: category.members.map(member => {
        if (member.nodeId === undefined) throw new RunLogIdentityError("RUN_LOG_CATEGORY_MEMBER_IDENTITY_MISMATCH");
        return { id: member.nodeId, label: member.label,
        state: member.state === "replayed" ? "completed" : TIMELINE_STATE[member.state],
        ...(member.durationSec === undefined ? {} : { durationLabel: fmtElapsed(member.durationSec) }) }; }) };
  });
  return { steps: grouped, timeline };
}

export function gateLogActions(gate: IdentityGateDetailWire): readonly LogDecisionAction[] {
  return gate.actions.flatMap(action => {
    if (action.kind !== "command" || action.command !== "resolve-gate" || action.resolution !== "approved" || action.confirm !== undefined) return [];
    const ceremony = identityCeremonyFor(gate, "approved");
    if (ceremony.kind !== "choose" && ceremony.kind !== "confirm") return [];
    return [{ id: action.key, label: action.label, primary: action.intent === "primary", result: { title: action.label, message: "" },
      ...(ceremony.kind === "choose" ? { input: { kind: "candidate" as const, question: gate.label, candidates: ceremony.options.map(option => ({
        id: option.eid, name: option.displayName, description: `${option.chosenFrom} · ${option.origin}`,
      })) } } : {}) }];
  });
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

export function useRunWiring(client: DashboardClient, selection: LogSelection, binding: DashboardCommandBinding | undefined) {
  const { row } = selection;
  const request = useMemo(() => ({ client, runId: row.runId, revision: row.rowRevision, day: binding?.authority.day, selection: { row, workflowLabel: selection.workflowLabel }, binding: binding?.scope,
    epoch: binding?.authority.epoch, dayRequest: binding?.authority.dayState.request, refreshDay: binding?.authority.dayState.refresh }),
  [client, row, selection.workflowLabel, binding?.authority.day, binding?.scope, binding?.authority.epoch, binding?.authority.dayState.request, binding?.authority.dayState.refresh]);
  const commandOwner = useMemo<GateCommandOwner>(() => ({ client, runId: row.runId, day: binding?.authority.day,
    epoch: binding?.authority.epoch, dayRequest: binding?.authority.dayState.request, scope: binding?.scope }),
  [client, row.runId, binding?.authority.day, binding?.authority.epoch, binding?.authority.dayState.request, binding?.scope]);
  const currentCommandOwner = useRef(commandOwner);
  currentCommandOwner.current = commandOwner;
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const bindingRef = useRef(binding);
  bindingRef.current = binding;
  const [command, setCommand] = useState<{ owner: GateCommandOwner; envelope: CommandRequest; state: "pending" | "uncertain" | "refused" | "settled"; feedback?: string }>();
  const commandRef = useRef(command);
  commandRef.current = command;
  const active = useRef(request);
  active.current = request;
  const refreshedBehind = useRef<string | undefined>(undefined);
  const [settled, setSettled] = useState<{ request: typeof request; value: RunWiringState }>({ request, value: { state: "loading" } });
  const sameRun = settled.request.client === client && settled.request.runId === row.runId && settled.request.day === binding?.authority.day
    && settled.request.epoch === request.epoch;
  const value = useMemo<RunWiringState>(() => settled.request === request ? settled.value
    : { state: "loading", ...(sameRun && settled.value.snapshot ? { snapshot: settled.value.snapshot } : {}) }, [settled, request, sameRun]);
  useEffect(() => {
    const controller = new AbortController();
    void readRunLogs(client, request.selection, controller.signal).then(snapshot => {
      if (active.current === request && !controller.signal.aborted) setSettled({ request, value: { state: "loaded", snapshot } });
    }, cause => {
      if (active.current !== request || controller.signal.aborted) return;
      const behind = `${request.runId}:${String(request.revision)}`;
      if (cause instanceof RunLogSelectionBehindError && request.refreshDay !== undefined && refreshedBehind.current !== behind) {
        refreshedBehind.current = behind;
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
  }, [client, request, row.runId]);
  const gate = value.state === "loaded" ? value.snapshot?.sections.find(section => section.section === "identity-gate") : undefined;
  const detailGate = value.snapshot?.detail.gate;
  const matchesGate = useCallback((envelope: CommandRequest) => envelope.family === "gate" && gate?.section === "identity-gate" && gate.payload.state === "available"
    && detailGate?.state === "open" && detailGate.nodeId === gate.payload.value.gateId
    && gate.payload.value.gateId.valueOf() === envelope.target.gateId.valueOf() && gate.payload.value.expectedVersion === envelope.target.expectedVersion
    && row.rowRevision.valueOf() === envelope.target.expectedVersion.valueOf(), [gate, detailGate, row.rowRevision]);
  const commandApplies = useCallback((attempt: NonNullable<typeof command>) => attempt.state === "pending" || attempt.state === "uncertain"
    || matchesGate(attempt.envelope) || (attempt.state === "settled" && attempt.envelope.family === "gate" && detailGate?.state === "resolved"
      && detailGate.nodeId?.valueOf() === attempt.envelope.target.gateId.valueOf()), [matchesGate, detailGate]);
  const send = useCallback(async (envelope: CommandRequest, replay = false) => {
    if (binding === undefined || binding.scope.client !== client || bindingRef.current?.scope !== binding.scope) return;
    setCommand({ owner: commandOwner, envelope, state: "pending" });
    const options = { scope: binding.scope, readback: (input: CommandRequest, reply: Parameters<typeof verifyShellCommandEffect>[3]) => verifyShellCommandEffect(client, binding.authority.day, input, reply),
      publish: (outcome: CommandOutcome) => {
        if (!mounted.current) return;
        setCommand(current => current?.owner !== commandOwner ? current : { owner: commandOwner, envelope,
          state: outcome.kind === "uncertain" ? "uncertain" : outcome.kind === "refused" ? "refused" : "settled",
          feedback: outcome.kind === "confirmed" ? "Decision confirmed" : "feedback" in outcome ? outcome.feedback.text : undefined });
        if (currentCommandOwner.current !== commandOwner) return;
        const currentBinding = bindingRef.current;
        if (currentBinding === undefined) return;
        currentBinding.feedback(outcome);
        if (outcome.kind === "confirmed") currentBinding.authority.dayState.refresh();
      } };
    if (replay) await binding.executor.replay(envelope.commandId, options);
    else await binding.executor.execute(envelope, options);
  }, [binding, client, commandOwner]);
  const onDecision = useCallback((id: string, action: LogDecisionAction, answer: LogDecisionAnswer) => {
    if (value.state !== "loaded" || value.snapshot === undefined || binding === undefined || (commandRef.current?.owner === commandOwner && commandRef.current.state !== "refused" && commandApplies(commandRef.current))) return;
    const section = value.snapshot.sections.find(section => section.section === "identity-gate");
    if (section?.section !== "identity-gate" || section.payload.state !== "available" || section.payload.value.gateId !== id) return;
    const gate = section.payload.value;
    if (value.snapshot.detail.gate.state !== "open" || value.snapshot.detail.gate.nodeId !== gate.gateId
      || value.snapshot.detail.captures === undefined || value.snapshot.detail.captures.state === "error") return;
    if (!gateLogActions(gate).some(candidate => candidate.id === action.id)) return;
    const descriptor = gate.actions.find(candidate => candidate.key === action.id);
    if (descriptor?.kind !== "command") return;
    const composed = composeCommandRequest(descriptor, { runId: row.runId, expectedVersion: gate.expectedVersion }, { actorId: binding.scope.actorId, source: "run-detail",
      requestedAt: binding.authority.nowIso, gate: section.payload,
      ...(answer.candidate === undefined ? {} : { gateAnswer: { decision: "approved", eid: answer.candidate } }) });
    if (composed.state !== "ready") return;
    const envelope = CommandRequestSchema.parse(composed.request);
    commandRef.current = { owner: commandOwner, envelope, state: "pending" };
    void send(envelope);
  }, [value, binding, commandOwner, row.runId, send, commandApplies]);
  const newest = binding?.executor.retainedAttempts().findLast(attempt => attempt.request.family === "gate"
    && attempt.request.target.runId === row.runId && attempt.request.requestedBy === binding.scope.actorId
    && attempt.scope.client === binding.scope.client && attempt.scope.authority === binding.scope.authority && attempt.scope.dayRequest === binding.scope.dayRequest);
  const retained = newest?.request.family === "gate" && (newest.state === "pending" || newest.outcome?.kind === "uncertain"
    || (newest.outcome?.kind === "refused" && matchesGate(newest.request))) ? newest : undefined;
  const retainedEnvelope = retained?.request.family === "gate" ? retained.request : undefined;
  const retainedState = retained === undefined ? undefined : retained.state === "pending" ? "pending" : retained.outcome?.kind === "refused" ? "refused" : "uncertain";
  const retainedFeedback = retained?.outcome?.kind === "uncertain" || retained?.outcome?.kind === "refused" ? retained.outcome.feedback.text : undefined;
  const retainedCommand = useMemo(() => retainedEnvelope === undefined || retainedState === undefined ? undefined
    : { owner: commandOwner, envelope: retainedEnvelope, state: retainedState, feedback: retainedFeedback },
  [commandOwner, retainedEnvelope, retainedState, retainedFeedback]);
  const currentCommand = command?.owner === commandOwner && command !== undefined && commandApplies(command)
    && (command.state !== "refused" || newest === undefined || newest.request.commandId === command.envelope.commandId) ? command : retainedCommand;
  const replayEnvelope = currentCommand?.state === "uncertain" ? currentCommand.envelope : undefined;
  const replay = useCallback(() => { if (replayEnvelope !== undefined) void send(replayEnvelope, true); }, [replayEnvelope, send]);
  return { ...value, onDecision: value.state === "loaded" && binding !== undefined && (currentCommand === undefined || currentCommand.state === "refused") ? onDecision : undefined,
    command: currentCommand, replay: replayEnvelope === undefined ? undefined : replay };
}
