/**
 * D307 — `runQueuedSpanEvent` projects a committed run's identity into its
 * write-once queue-root span. The step-omission envelope entry carries the
 * OPERATOR'S TYPED FACTS (`facts`), which may be sensitive HR values (a
 * separation date, an EID, a note) — the span may name WHICH steps were
 * omitted, and must never leak what the operator typed into them.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { runQueuedSpanEvent } from "../../src/server/dashboard/commands/run-queued-span.js";
import { ActorIdSchema } from "../../src/domain/ids.js";
import { RunRecordSchema } from "../../src/domain/run/record.js";
import { QUEUED_RUN } from "./fixtures/phase1f-run-fixtures.js";

const ACTOR = ActorIdSchema.parse("local-operator");
const SENSITIVE_FACT_VALUE = "06/19/2026-SENSITIVE-SEPARATION-DATE";

function runWithOmissions(stepOmissions: readonly Readonly<{ step: string; facts: Record<string, unknown> }>[]) {
  return RunRecordSchema.parse({
    ...QUEUED_RUN,
    envelope: { ...QUEUED_RUN.envelope, stepOmissions },
  });
}

describe("runQueuedSpanEvent (D307)", () => {
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
});
