import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { ConfirmedActionEventSchema, confirmedStepOccurrence } from "../../../../src/models/events/confirmed-action.js";
import { NoteWireSchema } from "../../../../src/models/events/types.js";
import { createNoteJsonlWriter } from "../../../../src/backend/storage/events/note-jsonl-writer.js";
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
    taskId: "ucpath/read-write-fixture", occurrencePath: ["first"], operation: { system: "ucpath",
      session: { kind: "browser", id: "browser-session", system: "ucpath" },
      actions: [{ id: "read-field", target: "unregistered.private" }] } }] } },
  createdAt: AT, updatedAt: AT, lifecycle: { state: "running" } } as unknown as RunRecord;

describe("confirmed action note append boundary", () => {
  it("withholds unregistered values before the append port and preserves exact owner/identity", () => {
    const lines: string[] = [];
    const writer = createNoteJsonlWriter({ stateRoot: "unused", clock: manualClock(new Date(AT)),
      pid: 1, appendLine: (_workflow, _date, line) => { lines.push(line); } });
    const note = writer.emitConfirmedAction(event, authority);
    assert.equal(lines.length, 1);
    const stored = NoteWireSchema.parse(JSON.parse(lines[0]));
    assert.equal(stored.confirmedAction?.eventId, event.eventId);
    assert.equal("runId" in stored ? stored.runId : undefined, RUN);
    assert.equal(stored.confirmedAction?.action.value, undefined);
    assert.equal(note.confirmedAction?.action.value, undefined);
    assert.equal(lines[0].includes("private-data"), false);
  });

  it("throws on append failure and refuses a foreign frozen run before any append", () => {
    let attempts = 0;
    const writer = createNoteJsonlWriter({ stateRoot: "unused", clock: manualClock(new Date(AT)),
      pid: 1, appendLine: () => { attempts++; throw new Error("append failed"); } });
    assert.throws(() => writer.emitConfirmedAction(event, authority), /append failed/u);
    assert.equal(attempts, 1);
    const foreignAction = { ...event.action, runId: "33333333-3333-4333-8333-333333333333" };
    assert.throws(() => writer.emitConfirmedAction({ ...event, action: foreignAction,
      stepOccurrence: confirmedStepOccurrence(foreignAction) } as typeof event, authority), /confirmed-action-authority-mismatch/u);
    assert.equal(attempts, 1);
  });

  it("binds submit and saved verifier to their separate frozen invocations", () => {
    const lines: string[] = [];
    const writer = createNoteJsonlWriter({ stateRoot: "unused", clock: manualClock(new Date(AT)),
      pid: 1, appendLine: (_workflow, _date, line) => { lines.push(line); } });
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
          occurrencePath: ["first"], operation: { system: "ucpath", session: { kind: "browser", id: "browser-session", system: "ucpath" },
            actions: [{ id: "submit", target: "unregistered.private" }] } },
        { id: "verify-operation", entryId: "first", taskId: "ucpath/fixture-verify",
          occurrencePath: ["first"], operation: { system: "ucpath", session: { kind: "browser", id: "browser-session", system: "ucpath" },
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
