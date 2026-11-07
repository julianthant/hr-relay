
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { runQueuedSpanEvent } from "../../../../src/backend/runs/commands/run-queued-span.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { ActorIdSchema } from "../../../../src/rules/identity/ids.js";
import { QUEUED_RUN } from "../../../support/fixtures/phase1f-run-fixtures.js";

import { personLookupQueuedRun } from "../../../support/helpers/phase1f-executor-harness.js";

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


describe("protected queue publication", () => {
  for (const subject of [
    { inputPath: "emplId", name: "personLookupCanaryEid", value: "10873698" },
    { inputPath: "documentNumber", name: "separationsKualiFinalizationCanaryDocumentNumber", value: "synthetic-document-proof" },
  ] as const) {
    for (const display of [{ title: "synthetic-unmasked-proof" },
      { title: "Protected test subject", subtitle: "synthetic-unmasked-proof" },
      { title: "Protected test subject", subtitle: "" }]) {
      it(`refuses an unmasked ${subject.inputPath} title/subtitle at publication`, () => {
        const initial = RunRecordSchema.parse(personLookupQueuedRun());
        assert.ok(initial.input.parsed);
        const value = initial.input.parsed.value;
        assert.ok(value !== null && typeof value === "object" && !Array.isArray(value));
        const run = RunRecordSchema.parse({ ...initial, input: { ...initial.input, parsed: {
          ...initial.input.parsed, value: { ...value, [subject.inputPath]: subject.value },
          protectedBindings: [{ kind: "test-data-local", inputPath: subject.inputPath, name: subject.name,
            sourceId: "44444444-4444-4444-8444-444444444444" }] } } });
        assert.throws(() => runQueuedSpanEvent({ run, actorId: ACTOR, ...display }), /protected subject display/u);
        const event = runQueuedSpanEvent({ run, actorId: ACTOR, title: "Protected test subject" });
        assert.equal(event.subtitle, undefined);
        assert.equal(JSON.stringify(event).includes(subject.value), false);
      });
    }
  }
});
