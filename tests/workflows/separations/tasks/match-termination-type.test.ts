import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { KUALI_TERMINATION_TYPE_OPTIONS } from "../../../../src/rules/separations/termination-type.js";
import type { DataPoint } from "../../../../src/rules/workflow/task-provenance.js";
import { matchTerminationTypeTask } from "../../../../src/workflows/separations/tasks/match-termination-type.js";

const DOCUMENT = "4444";

class TaskRefusal extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function taskContext() {
  const records: DataPoint[] = [];
  const ctx = {
    signal: new AbortController().signal,
    log: Object.freeze({ debug: () => undefined, info: () => undefined, warn: () => undefined }),
    fail: (code: string, message: string): never => {
      throw new TaskRefusal(code, message);
    },
    recordData(input: DataPoint | readonly DataPoint[]): void {
      records.push(...(Array.isArray(input) ? input : [input]) as DataPoint[]);
    },
  };
  return { ctx: ctx as never, records };
}

function assertRecordedOutput(records: readonly DataPoint[], output: object): void {
  const entries = Object.entries(output);
  assert.deepEqual(records.map(({ direction, field }) => ({ direction, field })), entries.map(([field]) => ({
    direction: "read",
    field,
  })));
  assert.deepEqual(Object.fromEntries(records.map(({ field, value }) => [field, value])), output);
}

function assertExpectedOutput(
  records: readonly DataPoint[],
  output: object,
  expected: object,
): void {
  assert.deepEqual(output, expected);
  assertRecordedOutput(records, expected);
}

async function expectRefusal(run: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(run, (error: unknown) => error instanceof TaskRefusal && error.code === code);
}

describe("separations workflow task wrappers", () => {

  it("records the termination mapping and refuses a blank selected type", async () => {
    const success = taskContext();
    const output = await matchTerminationTypeTask.impl.run({
      input: {
        documentNumber: DOCUMENT,
        terminationType: { state: "present", value: "Graduated/No longer a Student" },
        observedOptions: [...KUALI_TERMINATION_TYPE_OPTIONS],
      },
      ctx: success.ctx,
    });
    assertExpectedOutput(success.records, output, {
      terminationType: "Graduated/No longer a Student",
      classification: "involuntary",
      template: "UC_INVOL_TERM",
      reasonCode: "No Longer Student",
      observedOptionCount: 17,
    });

    const refusal = taskContext();
    await expectRefusal(() => matchTerminationTypeTask.impl.run({
      input: {
        documentNumber: DOCUMENT,
        terminationType: { state: "absent", reason: "the control was empty" },
        observedOptions: [...KUALI_TERMINATION_TYPE_OPTIONS],
      },
      ctx: refusal.ctx,
    }), "blank-termination-type");
    assert.deepEqual(refusal.records, []);
  });
});
