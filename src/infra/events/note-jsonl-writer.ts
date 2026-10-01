/**
 * The JSONL note writer — the high-volume half of the D10 split (ref dashboard-surfaces
 * §1.1). Notes are evidence, not control state: log lines and structured
 * fields addressed to their exact task attempt or worker/browser lifetime.
 *
 * Classified diagnostic fields and task logger fields retain their original
 * values for the local operator; invalid diagnostic fields remain counted.
 */
import { z } from "zod";
import type { Clock } from "../../domain/clock.js";
import { localDatePart } from "../../domain/clock.js";
import { ClassifiedDiagnosticValueSchema } from "../../domain/redaction.js";
import { NoteLevelSchema, NoteWireSchema, browserActionMessage, type NoteFieldWire, type NoteWire } from "../../events/types.js";
import type { BrowserAction } from "../../backend/systems/browser-shared/action-notes.js";
import { DeclaredActionOccurrenceSchema } from "../../domain/task-provenance.js";
import { assertNoteWithinRunScope } from "../../domain/run/note-scope.js";
import type { RunRecord } from "../../domain/run/record.js";
import { TaskRunNoteKindSchema, taskRunNoteMessage, type TaskRunNoteKind } from "../../domain/run/task-note.js";
import { appendEventStreamLine } from "./jsonl-streams.js";
import { CURRENT_DIAGNOSTIC_SAFETY_VERSION } from "../../domain/trust/failure.js";
import type { TaskLogger } from "../../base/task.js";

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

export interface NoteJsonlWriterDeps {
  readonly stateRoot: string;
  readonly clock: Clock;
  readonly pid?: number;
}

export interface NoteJsonlWriter {
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

export function createNoteJsonlWriter(deps: NoteJsonlWriterDeps): NoteJsonlWriter {
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
      assertNoteWithinRunScope(authority, { runId, workflow: ingress.workflow, at });
    }
    const fields: NoteFieldWire[] = [];
    let invalidFieldCount = 0;
    for (const candidate of ingress.fields ?? []) {
      const field = ClassifiedDiagnosticValueSchema.safeParse(candidate);
      if (!field.success) { invalidFieldCount += 1; continue; }
      fields.push({ key: field.data.key, kind: "text",
        value: typeof field.data.value === "string" ? field.data.value : JSON.stringify(field.data.value) });
    }
    for (const [key, value] of Object.entries(taskFields ?? {})) {
      fields.push({ key, kind: "text", value: String(value) });
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
      message: ingress.message,
      ...(action === undefined ? {} : { action: { kind: action.kind, targetId: action.targetId,
        ...(action.value === undefined ? {} : { value: action.value }),
        ...(action.operation === undefined ? {} : { operation: action.operation }) } }),
      ...(fields.length === 0 ? {} : { fields }),
    });
    appendEventStreamLine(deps.stateRoot, "notes", note.workflow, localDatePart(at), JSON.stringify(note));
    return note;
  };
  const emitRunNote: NoteJsonlWriter["emitRunNote"] = (input, authority) => {
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
  const emitRunLog: NoteJsonlWriter["emitRunLog"] = (input, authority) => write({
    workflow: input.workflow,
    address: input.address,
    level: input.level,
    message: input.message,
  }, authority, undefined, undefined, input.fields);
  const emitRunAction: NoteJsonlWriter["emitRunAction"] = (input, authority) => {
    const action = z.strictObject({
      kind: z.enum(["opened", "clicked", "typed", "selected", "checked", "set", "cleared", "pressed", "read", "computed", "verified", "branched", "joined", "gated", "delegated", "session"]),
      targetId: z.string().regex(/^[a-z][a-z0-9._/-]{2,119}$/iu),
      at: z.iso.datetime({ offset: true }),
      value: z.union([z.string(), z.boolean()]).optional(),
      physicalSessionId: z.uuid().optional(),
      operation: DeclaredActionOccurrenceSchema.optional(),
    }).parse(input.action);
    if (Date.parse(action.at) > deps.clock.now().getTime()) {
      throw new Error("browser action occurred after note append time");
    }
    const durableAction = action.operation?.value?.consumed.state === "redacted"
      ? (() => {
        const { value: _rawValue, ...withoutRawValue } = action;
        return withoutRawValue;
      })()
      : action;
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
