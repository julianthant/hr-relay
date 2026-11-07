import { z } from "zod";
import type { Clock } from "../../../rules/time/clock.js";
import { localDatePart } from "../../../rules/time/clock.js";
import { ClassifiedDiagnosticValueSchema, maskSsnText, sanitizeDebugText } from "../../../rules/redaction/redaction.js";
import { NoteLevelSchema, NoteWireSchema, browserActionMessage, type NoteFieldWire, type NoteWire } from "../../../models/events/types.js";
import type { BrowserAction } from "../../systems/browser-shared/action-notes.js";
import { assertNoteWithinRunScope } from "../../../models/run/note-scope.js";
import type { RecoveryActivity } from "../../../models/run/recovery-activity.js";
import type { RunRecord } from "../../../models/run/record.js";
import { TaskRunNoteKindSchema, taskRunNoteMessage, type TaskRunNoteKind } from "../../../models/run/task-note.js";
import { randomUUID } from "node:crypto";
import type { TimelineRepository } from "../../../models/events/timeline.js";
import { CURRENT_DIAGNOSTIC_SAFETY_VERSION } from "../../../models/trust/failure.js";
import type { TaskLogger } from "../../../workflow-kit/task.js";

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
  readonly recoveryActivity?: Readonly<{ activity: RecoveryActivity; assertOpen(): void }>;

}

export interface NoteTimelineWriter {
  emitNote(input: unknown): NoteWire;
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
    taskFields?: Parameters<TaskLogger["info"]>[1]): NoteWire => {
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
      deps.recoveryActivity?.assertOpen();
      assertNoteWithinRunScope(authority, { runId, workflow: ingress.workflow, at,
        attempt, traceId, spanPath: ingress.address.spanPath }, deps.recoveryActivity?.activity);
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
      ...(deps.recoveryActivity === undefined ? {} : { recoveryActivityId: deps.recoveryActivity.activity.activityId }),
      ts: occurredAt ?? at.toISOString(),
      workflow: ingress.workflow,
      pid,
      level: ingress.level,
      message: sanitizeDebugText(ingress.message),
      ...(action === undefined ? {} : { action: { kind: action.kind, targetId: action.targetId,
        ...(action.value === undefined ? {} : { value: typeof action.value === "string" && action.kind !== "screenshot" ? maskSsnText(action.value) : action.value }),
        ...(action.kind !== "screenshot" || action.physicalSessionId === undefined ? {} : { physicalSessionId: action.physicalSessionId }) } }),
      ...(fields.length === 0 ? {} : { fields }),
    });
    if (Buffer.byteLength(JSON.stringify(note), "utf8") > 256 * 1024) {
      throw new Error("timeline-note-size-exceeded");
    }
    deps.repository.append({ schemaVersion: 1, eventId: randomUUID(), workflow: note.workflow,
      scope: "runId" in note ? { kind: "run", runId: note.runId } : { kind: "worker", workerId: note.workerId },
      occurredAt: note.ts, recordedAt: at.toISOString(), retentionDate: localDatePart(at),
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
    }).parse(input.action);
    if (Date.parse(action.at) > deps.clock.now().getTime()) {
      throw new Error("browser action occurred after note append time");
    }
    const { value: rawValue, ...withoutRawValue } = action;
    const screenshotAssociation = action.kind === "screenshot"
      ? z.templateLiteral([z.uuid(), ":", z.uuid()]).parse(rawValue) : undefined;
    const durableAction: BrowserAction = {
      ...withoutRawValue,
      ...(screenshotAssociation === undefined ? {} : { value: screenshotAssociation }),
    };
    return write({
      workflow: input.workflow,
      address: input.address,
      level: "step",
      message: browserActionMessage(durableAction),
    }, authority, action.at, durableAction);
  };
  return Object.freeze({
    emitNote: (input: unknown): NoteWire => write(input),
    emitRunLog,
    emitRunNote,
    emitRunAction,
  });
}
