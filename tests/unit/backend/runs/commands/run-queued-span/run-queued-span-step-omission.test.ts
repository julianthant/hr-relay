
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { runQueuedSpanEvent } from "../../../../../../src/backend/runs/commands/run-queued-span.js";
import { ActorIdSchema } from "../../../../../../src/rules/identity/ids.js";
import { RunRecordSchema } from "../../../../../../src/models/run/record.js";
import { QUEUED_RUN } from "../../../../../support/fixtures/phase1f-run-fixtures.js";

const ACTOR = ActorIdSchema.parse("local-operator");
const SENSITIVE_FACT_VALUE = "06/19/2026-SENSITIVE-SEPARATION-DATE";

function runWithOmissions(stepOmissions: readonly Readonly<{ step: string; facts: Record<string, unknown> }>[]) {
  return RunRecordSchema.parse({
    ...QUEUED_RUN,
    envelope: { ...QUEUED_RUN.envelope, stepOmissions },
  });
}

describe("runQueuedSpanEvent", () => {
  it("emits omittedSteps as the step keys only, never the operator's typed facts", () => {
    const run = runWithOmissions([
      { step: "kronos-timecard", facts: { lastDayWorked: "06/18/2026", separationDate: SENSITIVE_FACT_VALUE } },
      { step: "reading", facts: { note: "another sensitive fact" } },
    ]);
    const event = runQueuedSpanEvent({ run, actorId: ACTOR, title: "Fixture run" });
    assert.deepEqual(event.omittedSteps, ["kronos-timecard", "reading"]);
    const serialized = JSON.stringify(event);
    assert.ok(!serialized.includes(SENSITIVE_FACT_VALUE), "the span leaked an operator-typed fact value");
    assert.ok(!serialized.includes("lastDayWorked"), "the span leaked a fact FIELD NAME");
    assert.ok(!serialized.includes("another sensitive fact"), "the span leaked a second omission's fact value");
    assert.ok(!serialized.includes("facts"), "the span carries no `facts` key at all");
  });

  it("omits `omittedSteps` entirely when the run carries no step omissions", () => {
    const run = RunRecordSchema.parse(QUEUED_RUN);
    const event = runQueuedSpanEvent({ run, actorId: ACTOR, title: "Fixture run" });
    assert.equal(Object.hasOwn(event, "omittedSteps"), false);
  });

  it("projects a restart-from-start recovery choice onto the queue root, and omits the key for a resume or ordinary start", () => {
    const priorRunId = "aaaaaaaa-0007-4000-8000-000000000007";
    const restarted = RunRecordSchema.parse({
      ...QUEUED_RUN,
      envelope: { ...QUEUED_RUN.envelope, retryOf: priorRunId, recovery: "restart-from-start" },
    });
    const restartEvent = runQueuedSpanEvent({ run: restarted, actorId: ACTOR, title: "Fixture run" });
    assert.equal(restartEvent.recovery, "restart-from-start");
    assert.equal(restartEvent.retryOf, priorRunId);

    const resumed = RunRecordSchema.parse({
      ...QUEUED_RUN,
      envelope: { ...QUEUED_RUN.envelope, retryOf: priorRunId },
    });
    const resumeEvent = runQueuedSpanEvent({ run: resumed, actorId: ACTOR, title: "Fixture run" });
    assert.equal(resumeEvent.retryOf, priorRunId);
    assert.equal(Object.hasOwn(resumeEvent, "recovery"), false, "a resume carries retryOf alone");

    const ordinary = runQueuedSpanEvent({ run: RunRecordSchema.parse(QUEUED_RUN), actorId: ACTOR, title: "Fixture run" });
    assert.equal(Object.hasOwn(ordinary, "recovery"), false);
  });
});
