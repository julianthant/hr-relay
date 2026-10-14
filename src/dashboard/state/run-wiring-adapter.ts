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
import type { IdentityGateDetailWire, RunDetailSectionResponse, RunDetailWire } from "../../models/dashboard/run-detail.js";
import { appendLogPage, logPillsOf, logRowsOf, type NotePage } from "../surfaces/run-detail/logs-model.js";
import type { LogEntry, LogScreenshot, LogStep } from "../surfaces/run-detail/logs/log-feed-model.js";
import type { LogTimelineStage, LogTimelineState } from "../surfaces/run-detail/logs/log-timeline-model.js";
import type { LogSelection } from "../surfaces/run-detail/logs/log-selection-model.js";
import { fmtActionClock, fmtElapsed } from "../surfaces/shared/status/format.js";

type RunReads = Pick<DashboardClient, "runDetail" | "runSection">;
export interface RunLogSnapshot {
  readonly detail: RunDetailWire;
  readonly logs: NotePage;
  readonly sections: readonly RunDetailSectionResponse[];
  readonly actionEvidence: Readonly<{ state: "available" | "unavailable"; events: readonly ConfirmedActionEvent[]; missingPages: readonly string[] }>;
  readonly unavailableEvidence: readonly string[];
}

export async function readRunLogs(client: RunReads, selection: LogSelection, signal: AbortSignal): Promise<RunLogSnapshot> {
  const { row } = selection;
  const detail = await client.runDetail(row.runId, signal);
  if (detail.runId !== row.runId || detail.rowRevision !== row.rowRevision || detail.header.traceId !== row.traceId
    || detail.header.attempt !== row.attempt || detail.header.workflowId !== row.workflowId) throw new Error("RUN_DETAIL_IDENTITY_MISMATCH");
  signal.throwIfAborted();
  if (!detail.availableSections.includes("logs")) throw new Error("RUN_LOGS_UNAVAILABLE");
  const section = await client.runSection(row.runId, "logs", undefined, signal);
  if (section.section !== "logs" || section.payload.runId !== row.runId) throw new Error("RUN_SECTION_IDENTITY_MISMATCH");
  let logs = section.payload;
  logRowsOf(logs, "initial");
  const missingPages: string[] = logs.confirmedActions === undefined ? ["initial"] : [];
  const actions: ConfirmedActionEvent[] = logs.confirmedActions === undefined ? [] : [...logs.confirmedActions];
  const cursors = new Set<string>();
  while (logs.nextCursor.state === "present") {
    signal.throwIfAborted();
    const cursor = logs.nextCursor.value;
    if (cursors.has(cursor)) throw new Error("RUN_LOG_CURSOR_REPEATED");
    cursors.add(cursor);
    const next = await client.runSection(row.runId, "logs", cursor, signal);
    if (next.section !== "logs") throw new Error("RUN_SECTION_IDENTITY_MISMATCH");
    if (next.payload.confirmedActions === undefined) missingPages.push(cursor);
    else actions.push(...next.payload.confirmedActions);
    logs = appendLogPage(logs, cursor, next.payload);
  }
  if (actions.some(event => event.action.runId !== row.runId
    || event.action.attempt > row.attempt || event.traceId !== row.traceId)) throw new Error("RUN_LOG_ACTION_IDENTITY_MISMATCH");
  if (detail.captures !== undefined && detail.captures.state !== "error" && ((detail.captures.state === "available") !== detail.availableSections.includes("captures"))) throw new Error("RUN_CAPTURE_CAPABILITY_MISMATCH");
  if (new Set(actions.map(event => event.eventId)).size !== actions.length) throw new Error("RUN_LOG_ACTION_DUPLICATE");
  if (logRowsOf(logs, "identity").some(log => log.kind !== "note" && (log.attempt > row.attempt || log.traceId !== row.traceId))) throw new Error("RUN_LOG_ROW_IDENTITY_MISMATCH");
  if (logs.operationStructure?.state === "observed" && logs.operationStructure.observations.some(observation =>
    observation.occurrence.runId !== row.runId || observation.occurrence.attempt > row.attempt)) throw new Error("RUN_LOG_ACTION_IDENTITY_MISMATCH");
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
      || detail.captures.artifactCount !== section.payload.artifacts.length)) throw new Error("RUN_CAPTURE_CAPABILITY_MISMATCH");
    if (section.section === "identity-gate" && section.payload.state === "available"
      && (section.payload.value.expectedVersion !== row.rowRevision || detail.gate.state !== "open"
        || (detail.gate.nodeId !== undefined && detail.gate.nodeId !== section.payload.value.gateId))) throw new Error("RUN_GATE_IDENTITY_MISMATCH");
    if (section.section === "failure" && section.payload.state === "available" && (section.payload.value.attempt !== row.attempt
      || section.payload.value.traceId !== row.traceId || section.payload.value.workflowId !== row.workflowId)) throw new Error("RUN_FAILURE_IDENTITY_MISMATCH");
    if (section.section === "parked-write" && section.payload.runAttempt !== row.attempt) throw new Error("RUN_WRITE_IDENTITY_MISMATCH");
  }
  if (sections.some(section => section.section === "identity-gate" && section.payload.state === "available") && detail.gate.state === "open" && detail.gate.nodeId === undefined) {
    unavailableEvidence.push("Identity decision join not supplied");
  }
  return { detail, logs, sections, actionEvidence: { state: missingPages.length === 0 ? "available" : "unavailable", events: actions, missingPages }, unavailableEvidence };
}

const TIMELINE_STATE: Record<RunDetailWire["timeline"]["events"][number]["state"], LogTimelineState> = {
  pending: "pending", active: "active", done: "completed", failed: "failed", blocked: "waiting", cancelled: "cancelled", skipped: "skipped",
};

export function projectRunLogs(snapshot: RunLogSnapshot, client: Pick<DashboardClient, "artifactUrl">): Readonly<{ steps: readonly LogStep[]; timeline: readonly LogTimelineStage[] }> {
  const { detail, logs, sections } = snapshot;
  const confirmedActions = snapshot.actionEvidence.events;
  const captures = sections.find(section => section.section === "captures");
  const screenshotsOf = (logId: string): readonly LogScreenshot[] => {
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
          width: artifact.width, height: artifact.height, label: origin.bundleId }] : []);
    });
  };
  const steps = logRowsOf(logs, "projection").map((row): LogStep => {
    const at = row.kind === "note" ? row.note.at : row.at;
    const time = fmtActionClock(at);
    const screenshots = screenshotsOf(row.logId);
    let entry: LogEntry;
    if (row.kind === "observed") entry = { kind: "fields", id: row.logId, fields: logPillsOf(row).map((pill, index) => ({
      id: `${row.logId}:${index}`, time, kind: pill.direction === "read" ? "read" : "fill", label: pill.label, value: pill.value,
    })), screenshots };
    else if (row.kind === "transaction-fenced") entry = { kind: "note", id: row.logId, time, message: "Write fenced; submission is not confirmed." };
    else entry = { kind: "note", id: row.logId, time, message: row.note.message, ...(row.note.level === "error" ? { tone: "danger" } : {}) };
    const entries: LogEntry[] = [entry];
    if (row.kind !== "observed" && screenshots.length > 0) entries.push({ kind: "decision", id: `${row.logId}:captures`, time,
      decision: { title: "Capture", state: "recorded", screenshots } });
    return { id: row.logId, time, title: row.kind === "note" ? "Run note" : row.producer.step,
      ...(row.kind !== "note" && row.producer.system !== undefined ? { system: row.producer.system } : {}), entries };
  });
  for (const section of sections) {
    if (section.section === "parked-write") {
      const write = section.payload;
      steps.push({ id: write.writeIntentId, time: fmtActionClock(write.parkedAt), title: write.taskId, system: write.system,
        entries: [{ kind: "decision", id: write.writeIntentId, time: fmtActionClock(write.parkedAt), decision: { title: "Write parked", state: "parked",
          message: write.parkedMessage, footer: "Resolution unavailable: this panel cannot collect the required write proof." } }] });
    } else if (section.section === "failure" && section.payload.state === "available") {
      const failure = section.payload.value;
      const resolution = resolveErrorCatalogFailure(failure, "http-response");
      const message = resolution.state === "resolved" ? resolution.text : resolution.catalogFault.text;
      steps.push({ id: failure.failureId, time: fmtActionClock(failure.occurredAt), title: failure.display?.title ?? failure.code,
        entries: [{ kind: "decision", id: failure.failureId, time: fmtActionClock(failure.occurredAt), decision: { title: failure.display?.title ?? failure.code,
          state: failure.writeState === "unknown" ? "unconfirmed" : "failed", message, caution: `Write state: ${failure.writeState}`,
          footer: "Resolution unavailable: this panel cannot collect a failure annotation." } }] });
    } else if (section.section === "identity-gate" && section.payload.state === "available") {
      const gate = section.payload.value;
      const ceremony = identityCeremonyFor(gate, "approved");
      steps.push({ id: gate.gateId, time: fmtActionClock(gate.parkedAt), title: gate.label,
        entries: [{ kind: "decision", id: gate.gateId, time: fmtActionClock(gate.parkedAt), decision: { title: gate.label, state: "review",
          message: gate.packet.comparisons.map(comparison => comparison.note).join(" "),
          comparison: gate.packet.comparisons.map(comparison => ({ label: comparison.field, expected: comparison.documentValue, observed: comparison.ucpathValue })),
          ...(ceremony.kind === "confirm" ? { field: { label: "Approving employee", value: `${ceremony.option.displayName} · ${directIdentifierDisplay(ceremony.option.eid)}`,
            outcome: `${ceremony.option.chosenFrom} · ${ceremony.option.origin}` } } : {}),
          footer: "Some resolutions are unavailable: this panel cannot collect typed identity or rejection text.", actions: detail.gate.state === "open" && detail.gate.nodeId === gate.gateId && detail.captures !== undefined && detail.captures.state !== "error" ? gateLogActions(gate) : undefined } }] });
    }
  }
  for (const event of confirmedActions) {
    const time = fmtActionClock(event.kind === "fact" ? event.confirmedAt : event.occurredAt);
    const message = event.kind === "fact" ? `${event.meaning} confirmed` : `${event.state}${event.reason === undefined ? "" : ` · ${event.reason}`}`;
    steps.push({ id: event.eventId, time, title: event.action.logicalActionId,
      ...(event.source.kind === "browser" ? { system: event.source.system } : {}),
      entries: [{ kind: "note", id: event.eventId, time, message, ...(event.kind === "trace" && event.state === "failed" ? { tone: "danger" } : {}) }] });
  }
  for (const event of detail.timeline.events) {
    const time = fmtActionClock(event.at);
    steps.push({ id: event.noteId, time, title: event.label, entries: [{ kind: "note", id: event.noteId, time,
      message: `${event.state}${event.notRun.state === "present" ? ` · ${event.notRun.reason}` : ""}` }] });
  }
  const timeline: LogTimelineStage[] = detail.timeline.events.map(event => ({ id: event.noteId, label: event.label,
    state: TIMELINE_STATE[event.state], time: fmtActionClock(event.at), stepId: event.noteId,
    ...(event.durationMs?.state === "present" ? { durationLabel: fmtElapsed(event.durationMs.ms / 1000) } : {}), substeps: [] }));
  for (const event of confirmedActions) timeline.push({ id: event.eventId, label: event.action.logicalActionId,
    state: event.kind === "fact" || event.state === "completed" ? "completed" : event.state === "failed" ? "failed" : event.state === "not-run" ? "skipped" : "active",
    time: fmtActionClock(event.occurredAt), stepId: event.eventId, substeps: [] });
  return { steps, timeline };
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
    epoch: binding?.authority.epoch, dayRequest: binding?.authority.dayState.request }), [client, row, selection.workflowLabel, binding?.authority.day, binding?.scope, binding?.authority.epoch, binding?.authority.dayState.request]);
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
      const error = cause instanceof DashboardClientError && cause.kind !== "schema"
        ? formatErrorCatalogFailure(createErrorCatalogFailure("TASK_UNHANDLED_FAILURE", {})).text
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
