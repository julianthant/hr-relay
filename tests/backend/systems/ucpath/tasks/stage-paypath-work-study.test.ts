import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { redactObservedDataPoints } from "../../../../../src/backend/logs/observed-data.js";
import type { ObservedDataPoint } from "../../../../../src/backend/logs/span-emitter.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../../../src/backend/systems/ucpath/driver/fake.js";
import { deterministicPayPathOperations } from "../../../../../src/backend/systems/ucpath/driver/paypath-fake.js";
import { stagePayPathWorkStudyTask } from "../../../../../src/backend/systems/ucpath/tasks/stage-paypath-work-study.js";
import { UcpathStagePayPathWorkStudy } from "../../../../../src/models/systems/ucpath/stage-paypath-work-study.js";
import { UcpathPayPathWorkStudyTargetSchema } from "../../../../../src/models/ui/ucpath-paypath.js";
import { RecordedDataPointSchema, type DataPoint } from "../../../../../src/rules/workflow/task-provenance.js";

const COMMENTS = "Updated pool id to F per work study award 08/03/2026";
const TARGET = UcpathPayPathWorkStudyTargetSchema.parse({
  emplId: "10000001", expectedName: "Lee, Jordan", effectiveDate: "08/03/2026", positionChangeReason: "JRL", positionPool: "F", comments: COMMENTS,
});

class Failed extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

function harness(options: Parameters<typeof deterministicPayPathOperations>[0], recordData?: (point: DataPoint | readonly DataPoint[]) => void) {
  const recorded: string[] = [], order: string[] = [];
  const operations = deterministicPayPathOperations(options);
  const run = () => stagePayPathWorkStudyTask.impl.run({ input: TARGET, ctx: {
    captureScreenshot: async () => { order.push("screenshot"); }, signal: new AbortController().signal,
    log: { debug: () => undefined, info: () => undefined, warn: () => undefined },
    fail: (code: string, message: string): never => { throw new Failed(code, message); },
    recordData: recordData ?? ((point: DataPoint | readonly DataPoint[]) => { for (const entry of "field" in point ? [point] : point) { order.push(`record:${entry.field}`); recorded.push(entry.field); } }),
    driver: { ...createDeterministicUcpathPersonOrgDriver(), ...operations },
  } });
  return { run, recorded, order, operations };
}

describe("UCPath stage-paypath-work-study task", () => {
  it("returns the staged page after a screenshot when every value PayPath kept equals the target", async () => {
    const h = harness({});
    const output = await h.run();
    assert.equal(output.stagedPageState, "ucpath.paypath.work-study-staged");
    assert.deepEqual(output.staged.values, { effectiveDate: "08/03/2026", positionChangeReason: "JRL", positionPool: "F", jobDataComments: COMMENTS, initiatorComments: COMMENTS });
    assert.equal(h.order[0], "screenshot");
    assert.deepEqual(h.recorded, ["staged.pageStateId", "staged.emplId", "staged.displayedName", "staged.values", "staged.observedAt"]);
  });

  it.each([
    ["effectiveDate", "08/04/2026"], ["positionChangeReason", ""], ["positionPool", "A"], ["jobDataComments", ""], ["initiatorComments", "other"],
  ])("fails staged-value-mismatch when PayPath kept %s as %j", async (field, value) => {
    const h = harness({ stagedValues: { [field]: value } });
    await assert.rejects(h.run(), (error: unknown) => error instanceof Failed && error.code === "staged-value-mismatch" && error.message.length > 0);
    assert.deepEqual(h.recorded, []);
  });

  it("classifies the alert text through the sequencer's real redactor and still fails paypath-alert-shown", async () => {
    const observed: ObservedDataPoint[] = [];
    // The sequencer stamps each transaction-task batch with its execution and redacts it through the same function.
    const recordData = (point: DataPoint | readonly DataPoint[]) => {
      const points = ("field" in point ? [point] : point).map(entry => RecordedDataPointSchema.parse({ ...entry, recordedAt: "2026-11-01T12:01:00.000Z",
        execution: { runId: "aaaaaaaa-0001-4000-8000-000100000000", traceId: "ws-190000-aaaa", attempt: 1, workflowId: "work-study", nodeId: "save-transaction", taskId: UcpathStagePayPathWorkStudy.id } }));
      observed.push(...redactObservedDataPoints(UcpathStagePayPathWorkStudy.id, points));
    };
    const h = harness({ stageRefusal: "paypath-alert-shown", alertText: "Synthetic alert for Lee, Jordan" }, recordData);
    await assert.rejects(h.run(), (error: unknown) => error instanceof Failed && error.code === "paypath-alert-shown");
    assert.deepEqual(observed.map(point => [point.field, point.values.map(value => value.classification)]), [["alertText", ["direct-identifier"]]]);
  });
});
