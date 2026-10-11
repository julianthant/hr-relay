import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { ConfirmedActionEventSchema, confirmedStepOccurrence } from "../../../../src/models/events/confirmed-action.js";
import { NoteWireSchema } from "../../../../src/models/events/types.js";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { DeclaredActionOccurrenceSchema } from "../../../../src/rules/workflow/task-provenance.js";
import { OperationActionIdSchema } from "../../../../src/models/workflow/operation-display.js";
import type { RunRecord } from "../../../../src/models/run/record.js";

const RUN = "11111111-1111-4111-8111-111111111111";
const HASH = "a".repeat(64);
const AT = "2026-10-02T12:00:00.000Z";
const action = {
  runId: RUN, definitionFingerprint: HASH, nodeId: "first", taskId: "ucpath/read-write-fixture",
  attempt: 1, claimGeneration: 1, taskAttempt: 1, invocationId: "first-operation",
  occurrencePath: ["first"], logicalActionId: "read-field", occurrence: 1,
  logicalSessionId: "browser-session", physicalSessionId: "22222222-2222-4222-8222-222222222222",
  state: "started" as const,
  value: { slot: "field-value", fieldPath: "emplId", producer: { kind: "run-input", path: "emplId" },
    consumed: { state: "observed", value: "private-data" } },
};
const event = ConfirmedActionEventSchema.parse({ version: 1, kind: "trace", state: "started",
  eventId: "worker-incarnation/1", workerId: "fixture-worker-1", workerStreamId: "worker-incarnation",
  sequence: 1, traceId: "fpo-120000-0002", stepOccurrence: confirmedStepOccurrence(action),
  action, source: { kind: "browser", system: "ucpath" }, occurredAt: AT, recordedAt: AT });
const authority = { envelope: { runId: RUN, workflow: "onboarding", traceId: "fpo-120000-0002",
  contractFingerprint: HASH, attempt: 1,
  operationDisplaySnapshot: { invocations: [{ id: "first-operation", entryId: "first",
    taskId: "ucpath/read-write-fixture", occurrencePath: ["first"], bindings: [{ slot: "field-value", value: { kind: "run-input", path: "emplId" } }], operation: { system: "ucpath",
      session: { kind: "browser", id: "browser-session", system: "ucpath" },
      actions: [{ id: "read-field", target: "unregistered.private" }] } }] } },
  createdAt: AT, updatedAt: AT, lifecycle: { state: "running" } } as unknown as RunRecord;

describe("confirmed action note append boundary", () => {
  it("withholds unregistered values before the append port and preserves exact owner/identity", () => {
    const lines: string[] = [];
    const writer = createNoteTimelineWriter({ clock: manualClock(new Date(AT)),
      pid: 1, repository: { append: (input) => { lines.push(JSON.stringify((input as {payload: {note: unknown}}).payload.note)); return {} as never; } } });
    const note = writer.emitConfirmedAction(event, authority);
    assert.equal(lines.length, 1);
    const stored = NoteWireSchema.parse(JSON.parse(lines[0]));
    assert.equal(stored.confirmedAction?.eventId, event.eventId);
    assert.equal("runId" in stored ? stored.runId : undefined, RUN);
    assert.equal(stored.confirmedAction?.action.value, undefined);
    assert.equal(note.confirmedAction?.action.value, undefined);
    assert.equal(lines[0].includes("private-data"), false);
  });

  it.each(["protection-unresolved", "classification-required"] as const)("persists the canonical withheld reason %s without raw values", (reason) => {
    const lines: string[] = [];
    const writer = createNoteTimelineWriter({ clock: manualClock(new Date(AT)),
      pid: 1, repository: { append: (input) => { lines.push(JSON.stringify((input as {payload: {note: unknown}}).payload.note)); return {} as never; } } });
    const occurrence = DeclaredActionOccurrenceSchema.parse({ ...event.action, state: "completed" as const,
      value: { slot: "field-value", fieldPath: "emplId", producer: { kind: "run-input" as const, path: "emplId" },
        consumed: { state: "withheld" as const, reason } } });
    const note = writer.emitRunAction({ workflow: "onboarding", address: { runId: RUN, attempt: 1,
      traceId: "fpo-120000-0002", spanPath: "first" },
      action: { kind: "typed", targetId: "unregistered.private", at: AT, operation: occurrence } }, authority);
    assert.equal(lines.length, 1);
    const stored = NoteWireSchema.parse(JSON.parse(lines[0]));
    assert.deepEqual(stored.action?.operation?.value, occurrence.value);
    assert.deepEqual(note.action?.operation?.value, occurrence.value);
    assert.equal(lines[0].includes("private-data"), false);
    for (const consumed of [{ state: "withheld", reason: "arbitrary" },
      { state: "withheld", reason, extra: true }, { state: "withheld", reason, value: "private-data" }]) {
      assert.equal(NoteWireSchema.safeParse({ ...stored, action: { ...stored.action,
        operation: { ...occurrence, value: { ...occurrence.value, consumed } } } }).success, false);
    }
  });

  it.each(["browser", "headless"] as const)("retains eligible %s local consumption through the frozen append boundary", (source) => {
    const lines: string[] = [];
    const writer = createNoteTimelineWriter({ clock: manualClock(new Date(AT)), pid: 1,
      repository: { append: (input) => { lines.push(JSON.stringify((input as {payload: {note: unknown}}).payload.note)); return {} as never; } } });
    const target = source === "browser" ? "ucpath.person-org.eid-input" : "read-local";
    const frozenInvocation = authority.envelope.operationDisplaySnapshot!.invocations[0];
    const session = source === "browser" ? frozenInvocation.operation.session : { kind: "local", id: "browser-session" };
    const frozen = { ...authority, envelope: { ...authority.envelope, operationDisplaySnapshot: {
      ...authority.envelope.operationDisplaySnapshot, invocations: [{ ...frozenInvocation,
        operation: { ...frozenInvocation.operation, system: source === "browser" ? "ucpath" : "local", session,
          actions: [{ id: "read-field", target, valueSlot: "field-value" }],
          values: [{ id: "field-value", source: { kind: "contract-input", path: "emplId" } }] } }] } } } as unknown as RunRecord;
    const { physicalSessionId, ...headlessAction } = event.action;
    const local = ConfirmedActionEventSchema.parse({ ...event,
      source: source === "browser" ? event.source : { kind: "headless", system: "workflow" },
      action: { ...(source === "browser" ? { ...headlessAction, physicalSessionId } : headlessAction), value: { ...action.value, consumed: { state: "observed", value: { supplied: "complete" } } } } });
    const stored = writer.emitConfirmedAction(local, frozen);
    assert.deepEqual(stored.confirmedAction?.action.value?.consumed, { state: "observed", value: { supplied: "complete" } });
    assert.deepEqual(NoteWireSchema.parse(JSON.parse(lines[0])).confirmedAction?.action.value?.consumed,
      { state: "observed", value: { supplied: "complete" } });
    const missingSlot = { ...frozen, envelope: { ...frozen.envelope, operationDisplaySnapshot: {
      ...frozen.envelope.operationDisplaySnapshot, invocations: [{ ...frozen.envelope.operationDisplaySnapshot!.invocations[0],
        operation: { ...frozen.envelope.operationDisplaySnapshot!.invocations[0].operation, values: [] } }] } } } as unknown as RunRecord;
    assert.throws(() => writer.emitConfirmedAction(local, missingSlot), /frozen-value-slot-mismatch/u);
    const missingDeclaration = { ...frozen, envelope: { ...frozen.envelope, operationDisplaySnapshot: {
      ...frozen.envelope.operationDisplaySnapshot, invocations: [{ ...frozen.envelope.operationDisplaySnapshot!.invocations[0],
        operation: { ...frozen.envelope.operationDisplaySnapshot!.invocations[0].operation,
          actions: [{ id: "read-field", target }] } }] } } } as unknown as RunRecord;
    assert.throws(() => writer.emitConfirmedAction(local, missingDeclaration), /frozen-value-slot-mismatch/u);
    assert.equal(lines.length, 1);
    for (const value of [{ ...local.action.value!, slot: "forged" }, { ...local.action.value!, fieldPath: "foreign" },
      { ...local.action.value!, producer: { kind: "run-input", path: "foreign" } },
      { ...local.action.value!, producer: { kind: "task-output", entryId: "first", path: "emplId" } }]) {
      assert.throws(() => writer.emitConfirmedAction({ ...local, action: { ...local.action, value } } as typeof local, frozen), /frozen-value-(slot|producer)-mismatch/u);
    }
    assert.throws(() => writer.emitConfirmedAction({ ...local, action: { ...local.action, logicalActionId: OperationActionIdSchema.parse("forged") } }, frozen), /frozen-action-mismatch/u);
  });

  it.each(["browser", "headless"] as const)("binds eligible %s constant consumption to its exact frozen digest", (source) => {
    const lines: string[] = [];
    const writer = createNoteTimelineWriter({ clock: manualClock(new Date(AT)), pid: 1,
      repository: { append: (input) => { lines.push(JSON.stringify((input as {payload: {note: unknown}}).payload.note)); return {} as never; } } });
    const invocation = authority.envelope.operationDisplaySnapshot!.invocations[0];
    const frozen = { ...authority, envelope: { ...authority.envelope, operationDisplaySnapshot: {
      invocations: [{ ...invocation, bindings: [{ slot: "field-value", value: { kind: "constant", valueDigest: HASH } }],
        operation: { ...invocation.operation, system: source === "browser" ? "ucpath" : "local",
          session: source === "browser" ? invocation.operation.session : { kind: "local", id: "browser-session" },
          actions: [{ id: "read-field", target: source === "browser" ? "ucpath.person-org.eid-input" : "read-local", valueSlot: "field-value" }],
          values: [{ id: "field-value", source: { kind: "contract-input", path: "emplId" } }] } }] } } } as unknown as RunRecord;
    const { physicalSessionId: _physicalSessionId, ...headless } = event.action;
    const local = ConfirmedActionEventSchema.parse({ ...event,
      source: source === "browser" ? event.source : { kind: "headless", system: "workflow" },
      action: { ...(source === "browser" ? event.action : headless), value: { ...event.action.value!,
        producer: { kind: "constant", valueDigest: HASH }, consumed: { state: "observed", value: { complete: ["constant", 1] } } } } });
    const stored = writer.emitConfirmedAction(local, frozen).confirmedAction;
    assert.deepEqual(stored?.action.value?.consumed, local.action.value?.consumed);
    assert.equal(stored?.action.logicalSessionId, local.action.logicalSessionId);
    assert.equal(stored?.action.definitionFingerprint, HASH);
    assert.equal(stored?.action.runId, RUN);
    assert.throws(() => writer.emitConfirmedAction({ ...local, action: { ...local.action, value: {
      ...local.action.value!, producer: { kind: "constant", valueDigest: "b".repeat(64) } } } } as typeof local, frozen), /frozen-value-producer-mismatch/u);
    assert.equal(lines.length, 1);
  });

  it("throws on append failure and refuses a foreign frozen run before any append", () => {
    let attempts = 0;
    const writer = createNoteTimelineWriter({ clock: manualClock(new Date(AT)),
      pid: 1, repository: { append: () => { attempts++; throw new Error("append failed"); } } });
    assert.throws(() => writer.emitConfirmedAction(event, authority), /append failed/u);
    assert.equal(attempts, 1);
    const foreignAction = { ...event.action, runId: "33333333-3333-4333-8333-333333333333" };
    assert.throws(() => writer.emitConfirmedAction({ ...event, action: foreignAction,
      stepOccurrence: confirmedStepOccurrence(foreignAction) } as typeof event, authority), /confirmed-action-authority-mismatch/u);
    assert.equal(attempts, 1);
  });

  it("binds submit and saved verifier to their separate frozen invocations", () => {
    const lines: string[] = [];
    const writer = createNoteTimelineWriter({ clock: manualClock(new Date(AT)),
      pid: 1, repository: { append: (input) => { lines.push(JSON.stringify((input as {payload: {note: unknown}}).payload.note)); return {} as never; } } });
    const commit = { ...action, invocationId: "commit-operation", taskId: "ucpath/fixture-commit",
      logicalActionId: "submit", state: "completed" as const };
    const verifier = { ...action, invocationId: "verify-operation", taskId: "ucpath/fixture-verify",
      logicalActionId: "saved", state: "completed" as const };
    if (event.kind !== "trace") throw new Error("fixture-event-not-trace");
    const { state: _traceState, ...baseEvent } = event;
    const submit = ConfirmedActionEventSchema.parse({ ...baseEvent, kind: "fact", meaning: "submit",
      purpose: "saved-effect", action: commit,
      stepOccurrence: `${RUN}/1/1/first/transaction`,
      proof: { verifier, verdict: "matched", observationDigest: HASH },
      confirmedAt: AT, disposition: "committed",
      durableProof: { writeIntentId: "intent-1", checkpointNodeId: "first", proofDigest: HASH } });
    const frozen = { ...authority, envelope: { ...authority.envelope,
      operationDisplaySnapshot: { invocations: [
        { id: "commit-operation", entryId: "first", taskId: "ucpath/fixture-commit",
          occurrencePath: ["first"], bindings: [{ slot: "field-value", value: { kind: "run-input", path: "emplId" } }], operation: { system: "ucpath", session: { kind: "browser", id: "browser-session", system: "ucpath" },
            actions: [{ id: "submit", target: "unregistered.private" }] } },
        { id: "verify-operation", entryId: "first", taskId: "ucpath/fixture-verify",
          occurrencePath: ["first"], bindings: [{ slot: "field-value", value: { kind: "run-input", path: "emplId" } }], operation: { system: "ucpath", session: { kind: "browser", id: "browser-session", system: "ucpath" },
            actions: [{ id: "saved", target: "unregistered.private" }] } },
      ] } } } as unknown as RunRecord;
    const stored = writer.emitConfirmedAction(submit, frozen).confirmedAction;
    assert.equal(lines.length, 1);
    assert.equal(stored?.kind, "fact");
    assert.equal(stored?.action.value, undefined);
    assert.equal(stored?.kind === "fact" ? stored.proof.verifier.value : undefined, undefined);
    assert.equal(lines[0].includes("private-data"), false);
    const wrongFrozen = { ...frozen, envelope: { ...frozen.envelope,
      operationDisplaySnapshot: { invocations: frozen.envelope.operationDisplaySnapshot?.invocations.slice(0, 1) } } } as RunRecord;
    assert.throws(() => writer.emitConfirmedAction(submit, wrongFrozen), /frozen-invocation-missing/u);
    assert.equal(lines.length, 1);
  });
});
