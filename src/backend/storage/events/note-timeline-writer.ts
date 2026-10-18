import { deriveStableUuid } from "../../../rules/identity/identifiers.js";

import { z } from "zod";
import type { Clock } from "../../../rules/time/clock.js";
import { localDatePart } from "../../../rules/time/clock.js";
import { ClassifiedDiagnosticValueSchema, maskSsnText, sanitizeDebugText } from "../../../rules/redaction/redaction.js";
import { NoteLevelSchema, NoteWireSchema, browserActionMessage, type NoteFieldWire, type NoteWire } from "../../../models/events/types.js";
import type { BrowserAction } from "../../systems/browser-shared/action-notes.js";
import type { JsonValue } from "../../../rules/validation/canonical-json.js";
import { DeclaredActionOccurrenceSchema } from "../../../rules/workflow/task-provenance.js";
import { assertNoteWithinRunScope } from "../../../models/run/note-scope.js";
import type { RunRecord } from "../../../models/run/record.js";
import { TaskRunNoteKindSchema, taskRunNoteMessage, type TaskRunNoteKind } from "../../../models/run/task-note.js";
import { randomUUID } from "node:crypto";
import type { TimelineRepository } from "../../../models/events/timeline.js";
import { CURRENT_DIAGNOSTIC_SAFETY_VERSION } from "../../../models/trust/failure.js";
import type { TaskLogger } from "../../../workflow-kit/task.js";
import { ConfirmedActionEventSchema, type ConfirmedActionEvent } from "../../../models/events/confirmed-action.js";
import { registeredUiSensitivity } from "../../systems/browser-shared/semantic-ui-effect.js";

export function isLocalActionValueEligible(
  action: ConfirmedActionEvent["action"],
  authority: RunRecord,
  source: ConfirmedActionEvent["source"],
): boolean {
  const declaredAction = (action: ConfirmedActionEvent["action"]) => {
    const invocation = authority.envelope.operationDisplaySnapshot?.invocations.find(candidate =>
      candidate.id === action.invocationId && candidate.entryId === action.nodeId
      && candidate.taskId === action.taskId);
    if (invocation === undefined) throw new Error("confirmed-action-frozen-invocation-missing");
    if (JSON.stringify(action.occurrencePath) !== JSON.stringify(invocation.occurrencePath)
      || action.logicalSessionId !== invocation.operation.session.id
      || (source.kind === "browser"
        ? invocation.operation.system !== source.system
          || invocation.operation.session.kind !== "browser"
          || invocation.operation.session.system !== source.system
        : invocation.operation.system !== "local" || invocation.operation.session.kind !== "local")) {
      throw new Error("confirmed-action-frozen-source-mismatch");
    }
    const matches: (typeof invocation.operation.actions)[number][] = [];
    const visit = (actions: readonly (typeof invocation.operation.actions)[number][]): void => {
      for (const candidate of actions) {
        if (candidate.id === action.logicalActionId) matches.push(candidate);
        if (candidate.children !== undefined) visit(candidate.children);
      }
    };
    visit(invocation.operation.actions);
    if (matches.length !== 1) throw new Error("confirmed-action-frozen-action-mismatch");
    return matches[0];
  };
  const declared = declaredAction(action);
  if (action.value?.consumed.state !== "observed") return true;
  if (source.kind === "browser") {
    const sensitivity = registeredUiSensitivity(source.system, declared.target ?? declared.id);
    if (sensitivity !== "public" && sensitivity !== "hr") return false;
  }
  const invocation = authority.envelope.operationDisplaySnapshot?.invocations.find(candidate => candidate.id === action.invocationId);
  const slot = invocation?.operation.values.find(candidate => candidate.id === declared.valueSlot);
  if (slot === undefined || declared.valueSlot !== action.value.slot || slot.source.path !== action.value.fieldPath) {
    throw new Error("confirmed-action-frozen-value-slot-mismatch");
  }
  const reference = slot.source.kind === "contract-output"
    ? { kind: "task-output" as const, entryId: invocation!.entryId, path: slot.source.path }
    : invocation?.bindings.find(binding => binding.slot === slot.id)?.value;
  const producer = action.value.producer;
  const matches = reference !== undefined && producer.kind === reference.kind && (() => {
    switch (reference.kind) {
      case "run-input": return producer.kind === "run-input" && producer.path === reference.path;
      case "configuration": return producer.kind === "configuration" && producer.key === reference.key && producer.schemaHash === reference.schemaHash;
      case "constant": return producer.kind === "constant" && producer.valueDigest === reference.valueDigest;
      case "task-output": case "child-output": return (producer.kind === "task-output" || producer.kind === "child-output")
        && producer.entryId === reference.entryId && producer.path === reference.path;
      case "transformation": return producer.kind === "transformation" && producer.transformId === reference.transformId && producer.path === reference.path;
      default: return false;
    }
  })();
  if (!matches) throw new Error("confirmed-action-frozen-value-producer-mismatch");
  if (source.kind === "headless") {
    return declared.valueSlot !== undefined && declared.valueSlot === action.value.slot
      && invocation?.operation.values.some(slot => slot.id === declared.valueSlot) === true;
  }
  const sensitivity = registeredUiSensitivity(source.system, declared.target ?? declared.id);
  return sensitivity === "public" || sensitivity === "hr";
}

function maskNoteValue(value: JsonValue): JsonValue {
  if (typeof value === "string") return maskSsnText(value);
  if (Array.isArray(value)) return value.map(maskNoteValue);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, maskNoteValue(child)]));
}

function maskOccurrenceValue(action: ConfirmedActionEvent["action"]): ConfirmedActionEvent["action"] {
  const value = action.value;
  return value?.consumed.state === "observed" ? { ...action,
    value: { ...value, consumed: { ...value.consumed, value: maskNoteValue(value.consumed.value) } } } : action;
}

function safeConfirmedAction(input: ConfirmedActionEvent, authority: RunRecord): ConfirmedActionEvent {
  const event = ConfirmedActionEventSchema.parse(input);
  if (event.eventId !== `${event.workerStreamId}/${String(event.sequence)}`) throw new Error("confirmed-action-stream-identity-mismatch");
  if (event.action.runId !== authority.envelope.runId
    || event.action.definitionFingerprint !== authority.envelope.contractFingerprint
    || event.action.attempt > authority.envelope.attempt) throw new Error("confirmed-action-authority-mismatch");
  const safeAction = isLocalActionValueEligible(event.action, authority, event.source) ? event.action : { ...event.action, value: undefined };
  if (event.kind === "trace") return ConfirmedActionEventSchema.parse({ ...event, action: maskOccurrenceValue(safeAction) });
  const verifier = event.proof.verifier;
  const safeVerifier = isLocalActionValueEligible(verifier, authority, event.source) ? verifier : { ...verifier, value: undefined };
  return ConfirmedActionEventSchema.parse({ ...event, action: maskOccurrenceValue(safeAction),
    proof: { ...event.proof, verifier: maskOccurrenceValue(safeVerifier) } });
}

const RunNoteAddressSchema = z.strictObject({
  runId: z.string().min(1),
  attempt: z.number().int().positive(),
  traceId: z.string().min(1),
  spanPath: z.string().min(1),
  parentSpanPath: z.string().min(1).optional(),
});
const WorkerNoteAddressSchema = z.strictObject({
  workerId: z.string().min(1),
  spanPath: z.string().min(1),
  parentSpanPath: z.string().min(1).optional(),
});

export const NoteIngressSchema = z.strictObject({
  workflow: z.string().min(1),
  address: z.union([RunNoteAddressSchema, WorkerNoteAddressSchema]),
  level: NoteLevelSchema,
  message: z.string().min(1),
  /** Classified diagnostic values; the writer retains their original values. */
  fields: z.array(z.unknown()).optional(),
});
export type NoteIngress = z.input<typeof NoteIngressSchema>;

export interface NoteTimelineWriterDeps {
  readonly repository: Pick<TimelineRepository, "append">;
  readonly clock: Clock;
  readonly pid?: number;

}

export interface NoteTimelineWriter {
  emitNote(input: unknown): NoteWire;
  emitConfirmedAction(input: ConfirmedActionEvent, authority: RunRecord): NoteWire;
  emitRunLog(input: Readonly<{
    workflow: string;
    address: z.input<typeof RunNoteAddressSchema>;
    level: "step" | "debug" | "warn";
    message: string;
    fields?: Parameters<TaskLogger["info"]>[1];
  }>, authority: RunRecord): NoteWire;
  emitRunNote(input: Readonly<{
    workflow: string;
    address: z.input<typeof RunNoteAddressSchema>;
    kind: TaskRunNoteKind;
  }>, authority: RunRecord): NoteWire;
  emitRunAction(input: Readonly<{
    workflow: string;
    address: z.input<typeof RunNoteAddressSchema>;
    action: BrowserAction;
  }>, authority: RunRecord): NoteWire;
}

export function createNoteTimelineWriter(deps: NoteTimelineWriterDeps): NoteTimelineWriter {
  const pid = z.number().int().positive().parse(deps.pid ?? process.pid);
  const write = (input: unknown, authority?: RunRecord, occurredAt?: string, action?: BrowserAction,
    taskFields?: Parameters<TaskLogger["info"]>[1], confirmedAction?: ConfirmedActionEvent): NoteWire => {
    const ingress = NoteIngressSchema.parse(input);
    const at = deps.clock.now();
    if (authority !== undefined) {
      if (!("runId" in ingress.address)) {
        throw new Error("a run-scoped note requires run identity, not worker identity");
      }
      const { runId, attempt, traceId } = ingress.address;
      if (runId !== authority.envelope.runId
        || attempt !== authority.envelope.attempt
        || traceId !== authority.envelope.traceId) {
        throw new Error(`run note identity does not match authority for run ${authority.envelope.runId}`);
      }
      assertNoteWithinRunScope(authority, { runId, workflow: ingress.workflow, at });
    }
    const fields: NoteFieldWire[] = [];
    let invalidFieldCount = 0;
    for (const candidate of ingress.fields ?? []) {
      const field = ClassifiedDiagnosticValueSchema.safeParse(candidate);
      if (!field.success) { invalidFieldCount += 1; continue; }
      if (field.data.classification === "secret" || field.data.classification === "credential-file" || /password|token|cookie|authorization|privatekey|challenge|signature/iu.test(field.data.key)) { invalidFieldCount++; continue; }
      fields.push({ key: field.data.key, kind: "text",
        value: sanitizeDebugText(typeof field.data.value === "string" ? field.data.value : JSON.stringify(field.data.value)) });
    }
    for (const [key, value] of Object.entries(taskFields ?? {})) {
      if (/password|token|cookie|authorization|privatekey|challenge|signature/iu.test(key)) { invalidFieldCount++; continue; }
      fields.push({ key, kind: "text", value: sanitizeDebugText(String(value)) });
    }
    if (invalidFieldCount > 0) {
      fields.push({ key: "invalidFields", kind: "count", value: invalidFieldCount });
    }
    const note = NoteWireSchema.parse({
      diagnosticSafetyVersion: CURRENT_DIAGNOSTIC_SAFETY_VERSION,
      ...ingress.address,
      ts: occurredAt ?? at.toISOString(),
      workflow: ingress.workflow,
      pid,
      level: ingress.level,
      message: sanitizeDebugText(ingress.message),
      ...(confirmedAction === undefined ? {} : { confirmedAction }),
      ...(action === undefined ? {} : { action: { kind: action.kind, targetId: action.targetId,
        ...(action.value === undefined ? {} : { value: typeof action.value === "string" && action.kind !== "screenshot" ? maskSsnText(action.value) : action.value }),
        ...(action.kind !== "screenshot" || action.physicalSessionId === undefined ? {} : { physicalSessionId: action.physicalSessionId }),
        ...(action.operation === undefined ? {} : { operation: maskOccurrenceValue(action.operation) }) } }),
      ...(fields.length === 0 ? {} : { fields }),
    });
    if (Buffer.byteLength(JSON.stringify(note), "utf8") > 256 * 1024) {
      throw new Error("timeline-note-size-exceeded");
    }
    deps.repository.append({ schemaVersion: 1, eventId: confirmedAction === undefined ? randomUUID() : deriveStableUuid("browser-action", confirmedAction.eventId), workflow: note.workflow,
      scope: "runId" in note ? { kind: "run", runId: note.runId } : { kind: "worker", workerId: note.workerId },
      occurredAt: note.ts, recordedAt: confirmedAction?.recordedAt ?? at.toISOString(), retentionDate: localDatePart(confirmedAction === undefined ? at : new Date(confirmedAction.recordedAt)),
      payload: { kind: "note", note }, source: { kind: "native" } });
    return note;
  };
  const emitRunNote: NoteTimelineWriter["emitRunNote"] = (input, authority) => {
    const ingress = z.strictObject({
      workflow: z.string().min(1),
      address: RunNoteAddressSchema,
      kind: TaskRunNoteKindSchema,
    }).parse(input);
    return write({
      workflow: ingress.workflow,
      address: ingress.address,
      level: "step",
      message: taskRunNoteMessage(ingress.kind),
    }, authority);
  };
  const emitRunLog: NoteTimelineWriter["emitRunLog"] = (input, authority) => write({
    workflow: input.workflow,
    address: input.address,
    level: input.level,
    message: input.message,
  }, authority, undefined, undefined, input.fields);
  const emitRunAction: NoteTimelineWriter["emitRunAction"] = (input, authority) => {
    const action = z.strictObject({
      kind: z.enum(["opened", "clicked", "typed", "selected", "checked", "set", "cleared", "pressed", "read", "computed", "verified", "branched", "joined", "gated", "delegated", "session", "screenshot"]),
      targetId: z.string().regex(/^[a-z][a-z0-9._/-]{2,119}$/iu),
      at: z.iso.datetime({ offset: true }),
      value: z.union([z.string(), z.boolean()]).optional(),
      physicalSessionId: z.uuid().optional(),
      operation: DeclaredActionOccurrenceSchema.optional(),
    }).parse(input.action);
    if (Date.parse(action.at) > deps.clock.now().getTime()) {
      throw new Error("browser action occurred after note append time");
    }
    const occurrence = action.operation;
    const observed = occurrence?.value?.consumed.state === "observed";
    let eligible = false;
    if (occurrence !== undefined) {
      if (occurrence.runId !== authority.envelope.runId
        || occurrence.definitionFingerprint !== authority.envelope.contractFingerprint
        || occurrence.attempt > authority.envelope.attempt) throw new Error("confirmed-action-authority-mismatch");
      const invocation = authority.envelope.operationDisplaySnapshot?.invocations.find(candidate =>
        candidate.id === occurrence.invocationId);
      if (invocation === undefined) throw new Error("confirmed-action-frozen-invocation-missing");
      const session = invocation.operation.session;
      let source: ConfirmedActionEvent["source"];
      if (session.kind === "browser") {
        if (session.system === undefined) throw new Error("confirmed-action-frozen-source-mismatch");
        source = { kind: "browser", system: session.system };
      } else {
        source = { kind: "headless", system: "workflow" };
      }
      const admitted = isLocalActionValueEligible(occurrence, authority, source);
      eligible = observed && admitted;
    }
    const { value: rawValue, ...withoutRawValue } = action;
    const screenshotAssociation = action.kind === "screenshot"
      ? z.templateLiteral([z.uuid(), ":", z.uuid()]).parse(rawValue) : undefined;
    const durableAction: BrowserAction = {
      ...withoutRawValue,
      ...(screenshotAssociation === undefined ? {} : { value: screenshotAssociation }),
      ...(eligible && rawValue !== undefined && occurrence?.value?.consumed.state === "observed"
        && rawValue === occurrence.value.consumed.value ? { value: rawValue } : {}),
      ...(observed && !eligible && occurrence.value !== undefined ? { operation: {
        ...occurrence, value: { ...occurrence.value,
          consumed: { state: "withheld", reason: "classification-required" } },
      } } : {}),
    };
    return write({
      workflow: input.workflow,
      address: input.address,
      level: "step",
      message: browserActionMessage(durableAction),
    }, authority, action.at, durableAction);
  };
  const emitConfirmedAction: NoteTimelineWriter["emitConfirmedAction"] = (input, authority) => {
    const confirmedAction = safeConfirmedAction(input, authority);
    return write({
      workflow: authority.envelope.workflow,
      address: { runId: confirmedAction.action.runId, attempt: confirmedAction.action.attempt,
        traceId: confirmedAction.traceId,
        spanPath: `confirmed/${confirmedAction.action.nodeId}/${confirmedAction.action.taskId}/${String(confirmedAction.action.taskAttempt)}` },
      level: "step", message: confirmedAction.kind === "fact" ? "Confirmed action" : "Action lifecycle",
    }, authority, confirmedAction.recordedAt, undefined, undefined, confirmedAction);
  };
  return Object.freeze({
    emitNote: (input: unknown): NoteWire => write(input),
    emitConfirmedAction,
    emitRunLog,
    emitRunNote,
    emitRunAction,
  });
}
