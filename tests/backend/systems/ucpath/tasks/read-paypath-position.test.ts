import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { redactObservedDataPoints } from "../../../../../src/backend/logs/observed-data.js";
import { createTaskProvenanceCollector } from "../../../../../src/backend/runs/provenance/task-provenance.js";
import type { ObservedDataPoint } from "../../../../../src/backend/logs/span-emitter.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { compileWorkflow } from "../../../../../src/workflow-kit/workflow-definition.js";
import { workStudyWorkflow } from "../../../../../src/workflows/work-study/workflow.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../../../src/backend/systems/ucpath/driver/fake.js";
import { deterministicPayPathOperations } from "../../../../../src/backend/systems/ucpath/driver/paypath-fake.js";
import { readPayPathPositionTask } from "../../../../../src/backend/systems/ucpath/tasks/read-paypath-position.js";
import { UcpathReadPayPathPosition } from "../../../../../src/models/systems/ucpath/read-paypath-position.js";
import { UCPATH_PAYPATH_REFUSAL_CODES, UcpathPayPathReadSchema, type UcpathPayPathRefusalCode } from "../../../../../src/models/ui/ucpath-paypath.js";
import { EidSchema } from "../../../../../src/rules/identity/ids.js";
import type { DataPoint } from "../../../../../src/rules/workflow/task-provenance.js";

const EMPL_ID = EidSchema.parse("10000001");
const READ = UcpathPayPathReadSchema.parse(UcpathReadPayPathPosition.example);

class Failed extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

function harness(options: Parameters<typeof deterministicPayPathOperations>[0], abort = false) {
  const recorded: { field: string; value: unknown }[] = [];
  const order: string[] = [];
  const controller = new AbortController();
  if (abort) controller.abort();
  const run = () => readPayPathPositionTask.impl.run({
    input: { emplId: EMPL_ID },
    ctx: {
      captureScreenshot: async () => { order.push("screenshot"); },
      signal: controller.signal,
      log: { debug: () => undefined, info: () => undefined, warn: () => undefined },
      fail: (code: string, message: string): never => { throw new Failed(code, message); },
      recordData: (point: DataPoint | readonly DataPoint[]) => { for (const entry of "field" in point ? [point] : point) { order.push(`record:${entry.field}`); recorded.push({ field: entry.field, value: entry.value }); } },
      driver: { ...createDeterministicUcpathPersonOrgDriver(), ...deterministicPayPathOperations(options) },
    },
  });
  return { run, recorded, order };
}

describe("UCPath read-paypath-position task", () => {
  it("returns the read after a screenshot and records every output leaf", async () => {
    const h = harness({ read: READ });
    assert.deepEqual(await h.run(), READ);
    assert.deepEqual(h.recorded.map(entry => entry.field), ["pageStateId", "emplId", "displayedName", "position", "observedAt"]);
    assert.equal(h.order[0], "screenshot");
    assert.deepEqual(h.recorded.find(entry => entry.field === "position")?.value, READ.position);
  });

  it.each<UcpathPayPathRefusalCode>(UCPATH_PAYPATH_REFUSAL_CODES)("fails %s with that code", async (code) => {
    const h = harness({ refusal: code });
    await assert.rejects(h.run(), (error: unknown) => error instanceof Failed && error.code === code && error.message.length > 0);
    assert.equal(h.recorded.some(entry => entry.field === "alertText"), code === "paypath-alert-shown");
  });

  it("records the alert text before failing paypath-alert-shown", async () => {
    const h = harness({ refusal: "paypath-alert-shown", alertText: "Synthetic alert text" });
    await assert.rejects(h.run(), (error: unknown) => error instanceof Failed && error.code === "paypath-alert-shown");
    assert.deepEqual(h.recorded, [{ field: "alertText", value: "Synthetic alert text" }]);
  });

  it("classifies the recorded alert text through the real collector and still fails paypath-alert-shown", async () => {
    const descriptor = compileWorkflow(workStudyWorkflow).descriptor;
    const observed: ObservedDataPoint[] = [];
    const collector = createTaskProvenanceCollector({
      descriptor, execution: { runId: "aaaaaaaa-0001-4000-8000-000100000000", traceId: "ws-190000-aaaa", attempt: 1, workflowId: descriptor.id,
        nodeId: "paypath-position", taskId: UcpathReadPayPathPosition.id },
      upstreamEvidence: { checkpoints: [] }, clock: manualClock(new Date("2026-11-01T12:01:00Z")),
      onRecord: batch => { observed.push(...redactObservedDataPoints(UcpathReadPayPathPosition.id, batch.points)); },
    });
    let clicked = false;
    const operations = deterministicPayPathOperations({ refusal: "paypath-alert-shown", alertText: "Synthetic alert for Lee, Jordan" });
    await assert.rejects(readPayPathPositionTask.impl.run({ input: { emplId: EMPL_ID }, ctx: {
      captureScreenshot: async () => { clicked = true; }, signal: new AbortController().signal,
      log: { debug: () => undefined, info: () => undefined, warn: () => undefined },
      fail: (code: string, message: string): never => { throw new Failed(code, message); }, recordData: collector.recordData,
      driver: { ...createDeterministicUcpathPersonOrgDriver(), ...operations },
    } }), (error: unknown) => error instanceof Failed && error.code === "paypath-alert-shown");
    assert.equal(clicked, false);
    assert.deepEqual(operations.events, ["read:paypath:10000001"]);
    assert.equal(observed.length, 1);
    assert.equal(observed[0]?.field, "alertText");
    assert.deepEqual(observed[0]?.values.map(value => value.classification), ["direct-identifier"]);
  });

  it("refuses a read for another Empl ID", async () => {
    const h = harness({ read: UcpathPayPathReadSchema.parse({ ...READ, emplId: "10000002" }) });
    await assert.rejects(h.run(), (error: unknown) => error instanceof Failed && error.code === "subject-mismatch");
    assert.deepEqual(h.recorded, []);
  });

  it("rethrows an aborted run instead of failing the task", async () => {
    const h = harness({ refusal: "unexpected-page-state" }, true);
    await assert.rejects(h.run(), (error: unknown) => !(error instanceof Failed));
  });
});
