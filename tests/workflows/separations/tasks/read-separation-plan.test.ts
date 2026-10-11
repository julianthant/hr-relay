import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { DateOnlySchema, IsoInstantSchema } from "../../../../src/rules/identity/ids.js";
import type { DataPoint } from "../../../../src/rules/workflow/task-provenance.js";
import { readSeparationPlanTask } from "../../../../src/workflows/separations/tasks/read-separation-plan.js";

const DOCUMENT = "4444";
const NAME = "Person, Deterministic";
const NOW = IsoInstantSchema.parse("2026-08-14T19:00:00.000Z");

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

function formDate(raw: string) {
  const [month, day, year] = raw.split("/");
  return {
    state: "present" as const,
    raw,
    value: DateOnlySchema.parse(year + "-" + month + "-" + day),
  };
}

describe("separations workflow task wrappers", () => {

  it("records the form plan and refuses a missing employee name", async () => {
    const input = {
      documentNumber: DOCUMENT,
      employeeName: { state: "present" as const, value: NAME },
      lastDayWorked: formDate("06/12/2026"),
      separationDate: formDate("06/12/2026"),
      observedAt: NOW,
    };
    const success = taskContext();
    const output = await readSeparationPlanTask.impl.run({ input, ctx: success.ctx });
    const expected = {
      documentNumber: DOCUMENT,
      employeeName: NAME,
      kualiLastDayWorked: "06/12/2026",
      kualiSeparationDate: "06/12/2026",
      asOfDate: "08/14/2026",
      timecardWindow: { start: "05/12/2026", end: "07/12/2026" },
    };
    assert.deepEqual(output, expected);
    const entries = Object.entries(expected);
    assert.deepEqual(success.records.map(({ direction, field }) => ({ direction, field })), entries.map(([field]) => ({
      direction: "read",
      field,
    })));
    assert.deepEqual(Object.fromEntries(success.records.map(({ field, value }) => [field, value])), expected);

    const refusal = taskContext();
    await assert.rejects(() => readSeparationPlanTask.impl.run({
      input: { ...input, employeeName: { state: "absent", reason: "the control was empty" } },
      ctx: refusal.ctx,
    }), (error: unknown) => error instanceof TaskRefusal && error.code === "employee-name-absent");
    assert.deepEqual(refusal.records, []);
  });
});
