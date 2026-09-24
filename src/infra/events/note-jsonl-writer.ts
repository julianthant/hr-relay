/**
 * The JSONL note writer — the high-volume half of the D10 split (ref dashboard-surfaces
 * §1.1). Notes are evidence, not control state: log lines and structured
 * fields addressed to their exact task attempt or worker/browser lifetime.
 *
 * Redaction is schema-owned (ref clock-config-secrets): a caller submits CLASSIFIED fields —
 * `{key, classification, transform, value}` — and the writer runs them through
 * `redactDiagnosticFields` before anything touches disk. An unclassified field
 * is DROPPED, never passed through, and the drop is visible: the emitted note
 * carries a `redactionWarnings` count so a disappearing field reads as a
 * redaction event rather than as data that never existed.
 */
import { z } from "zod";
import type { Clock } from "../../domain/clock.js";
import { localDatePart } from "../../domain/clock.js";
import { redactDiagnosticFields } from "../../domain/redaction.js";
import { NoteLevelSchema, NoteWireSchema, browserActionMessage, type NoteFieldWire, type NoteWire } from "../../events/types.js";
import type { BrowserAction } from "../browser/action-notes.js";
import { assertNoteWithinRunScope } from "../../domain/run/note-scope.js";
import type { RunRecord } from "../../domain/run/record.js";
import { TaskRunNoteKindSchema, taskRunNoteMessage, type TaskRunNoteKind } from "../../domain/run/task-note.js";
import { appendEventStreamLine } from "./jsonl-streams.js";
import { CURRENT_DIAGNOSTIC_SAFETY_VERSION } from "../../domain/trust/failure.js";

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
  /** Classified diagnostic values; the writer redacts, callers never pre-redact. */
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

function toWireField(field: ReturnType<typeof redactDiagnosticFields>["fields"][number]): NoteFieldWire | undefined {
  if (field.state === "redacted") return undefined;
  if (field.state === "allowed") {
    return { key: field.key, kind: "text", value: typeof field.value === "string" ? field.value : JSON.stringify(field.value) };
  }
  switch (field.transform) {
    case "digest": return { key: field.key, kind: "digest", value: z.string().parse(field.value) };
    case "last4": return { key: field.key, kind: "last4", value: z.string().parse(field.value) };
    case "basename": return { key: field.key, kind: "basename", value: z.string().parse(field.value) };
    case "count": return { key: field.key, kind: "count", value: z.number().parse(field.value) };
  }
}

export function createNoteJsonlWriter(deps: NoteJsonlWriterDeps): NoteJsonlWriter {
  const pid = z.number().int().positive().parse(deps.pid ?? process.pid);
  const write = (input: unknown, authority?: RunRecord, occurredAt?: string, action?: BrowserAction): NoteWire => {
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
    const redaction = redactDiagnosticFields(ingress.fields ?? []);
    const fields: NoteFieldWire[] = [];
    for (const field of redaction.fields) {
      const wire = toWireField(field);
      if (wire !== undefined) fields.push(wire);
    }
    if (redaction.warnings.length > 0) {
      fields.push({ key: "redactionWarnings", kind: "count", value: redaction.warnings.length });
    }
    const note = NoteWireSchema.parse({
      diagnosticSafetyVersion: CURRENT_DIAGNOSTIC_SAFETY_VERSION,
      ...ingress.address,
      ts: occurredAt ?? at.toISOString(),
      workflow: ingress.workflow,
      pid,
      level: ingress.level,
      message: ingress.message,
      ...(action === undefined ? {} : { action: { kind: action.kind, targetId: action.targetId } }),
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
  const emitRunAction: NoteJsonlWriter["emitRunAction"] = (input, authority) => {
    const action = z.strictObject({
      kind: z.enum(["opened", "clicked", "typed", "selected", "checked", "set", "cleared", "pressed"]),
      targetId: z.string().regex(/^[a-z][a-z0-9._/-]{2,119}$/iu),
      at: z.iso.datetime({ offset: true }),
    }).parse(input.action);
    if (Date.parse(action.at) > deps.clock.now().getTime()) {
      throw new Error("browser action occurred after note append time");
    }
    return write({
      workflow: input.workflow,
      address: input.address,
      level: "step",
      message: browserActionMessage(action),
    }, authority, action.at, action);
  };
  return Object.freeze({
    emitNote: (input: unknown): NoteWire => write(input),
    emitRunNote,
    emitRunAction,
  });
}
