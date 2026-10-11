import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { DataPoint } from "../../../../src/rules/workflow/task-provenance.js";
import { matchDepartmentOptionTask } from "../../../../src/workflows/separations/tasks/match-department-option.js";

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

function cell(value: string) {
  return { state: "present" as const, value };
}

const LIVE_DEPARTMENT_OPTIONS = [
  "- - -",
  "000141 - Early Childhood Education Center",
  "000412 - Housing/Dining/Hospitality",
  "000414 - Bookstore",
  "000422 - Triton Print & Digital Media",
  "000719 -  Supply Chain Services",
];

describe("separations workflow task wrappers", () => {

  it("records the exact department option and refuses an option the control did not offer", async () => {
    const input = {
      documentNumber: DOCUMENT,
      deptId: cell("000412"),
      department: cell("HOUSING/DINING/HOSPITALITY"),
      observedOptions: LIVE_DEPARTMENT_OPTIONS,
    };
    const success = taskContext();
    const output = await matchDepartmentOptionTask.impl.run({ input, ctx: success.ctx });
    const expected = {
      option: "000412 - Housing/Dining/Hospitality",
      departmentCode: "000412",
      optionDescription: "Housing/Dining/Hospitality",
      ucpathDepartment: "HOUSING/DINING/HOSPITALITY",
      observedOptionCount: 6,
    };
    assert.deepEqual(output, expected);
    const entries = Object.entries(expected);
    assert.deepEqual(success.records.map(({ direction, field }) => ({ direction, field })), entries.map(([field]) => ({
      direction: "read",
      field,
    })));
    assert.deepEqual(Object.fromEntries(success.records.map(({ field, value }) => [field, value])), expected);

    const refusal = taskContext();
    await assert.rejects(() => matchDepartmentOptionTask.impl.run({
      input: { ...input, deptId: cell("000999") },
      ctx: refusal.ctx,
    }), (error: unknown) => error instanceof TaskRefusal && error.code === "department-code-not-offered");
    assert.deepEqual(refusal.records, []);
  });
});
