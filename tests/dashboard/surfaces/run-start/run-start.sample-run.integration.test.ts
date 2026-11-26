// @vitest-environment jsdom
import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { PositiveIntSchema, RunIdSchema } from "../../../../src/rules/identity/ids.js";
import { createRunStartDialogHarness } from "../../../support/helpers/dashboard/run-start-dialog-harness.js";

const h = createRunStartDialogHarness();
afterEach(h.cleanup);

it("refuses a Rerun of a sample run with a toast and closes, never planning", async () => {
  const planned: unknown[] = [];
  await h.openDialog(h.stubClient({
    rerunValues: async () => ({ state: "refused", code: "sample-run" }),
    submitStartPlan: async input => { planned.push(input); throw new Error("unexpected plan"); },
  }), { workflows: h.WORKFLOWS, panelWorkflowId: h.WORKFLOW_ID, rerunSource: { runId: RunIdSchema.parse("5a000000-0000-4000-8000-000000000009"), expectedVersion: PositiveIntSchema.parse(3) } });
  for (let wait = 0; wait < 6; wait += 1) await h.settle();
  assert.match(document.body.textContent ?? "", /Sample run: nothing runs\./u);
  assert.equal(h.closed.at(-1), false);
  assert.deepEqual(planned, []);
});
