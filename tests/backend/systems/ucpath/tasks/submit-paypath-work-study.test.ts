import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { redactObservedDataPoints } from "../../../../../src/backend/logs/observed-data.js";
import type { ObservedDataPoint } from "../../../../../src/backend/logs/span-emitter.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../../../src/backend/systems/ucpath/driver/fake.js";
import { deterministicPayPathOperations, type FakePayPathSubmit } from "../../../../../src/backend/systems/ucpath/driver/paypath-fake.js";
import { submitPayPathWorkStudyTask } from "../../../../../src/backend/systems/ucpath/tasks/submit-paypath-work-study.js";
import { UcpathSubmitPayPathWorkStudy } from "../../../../../src/models/systems/ucpath/submit-paypath-work-study.js";
import { UcpathPayPathWorkStudyTargetSchema } from "../../../../../src/models/ui/ucpath-paypath.js";
import { FingerprintSchema, PositiveIntSchema } from "../../../../../src/rules/identity/ids.js";
import { RecordedDataPointSchema, type DataPoint } from "../../../../../src/rules/workflow/task-provenance.js";
import { mintMutationCapability } from "../../../../../src/workflow-kit/mutation-capability.js";

const TARGET = UcpathPayPathWorkStudyTargetSchema.parse({
  emplId: "10000001", expectedName: "Lee, Jordan", effectiveDate: "08/03/2026", positionChangeReason: "JRL", positionPool: "F",
  comments: "Updated pool id to F per work study award 08/03/2026",
});

class Failed extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

async function submit(submitAs: FakePayPathSubmit, recordData: (point: DataPoint | readonly DataPoint[]) => void = () => undefined) {
  const operations = deterministicPayPathOperations({ submit: submitAs });
  await operations.stagePayPathWorkStudy(TARGET);
  const result = submitPayPathWorkStudyTask.impl.run({ input: TARGET, ctx: {
    signal: new AbortController().signal, log: { debug: () => undefined, info: () => undefined, warn: () => undefined },
    fail: (code: string, message: string): never => { throw new Failed(code, message); }, recordData,
    mutation: mintMutationCapability(PositiveIntSchema.parse(1), FingerprintSchema.parse("a".repeat(64))),
    driver: { ...createDeterministicUcpathPersonOrgDriver(), ...operations, readTransactionFindings: operations.readTransactionFindings },
  } });
  return { result, operations };
}

describe("UCPath submit-paypath-work-study task", () => {
  it("returns the receipt only after reading the filed transaction back", async () => {
    const { result, operations } = await submit("files");
    assert.deepEqual(await result, { receipt: {
      kind: "ucpath-paypath-work-study", emplId: "10000001", effectiveDate: "08/03/2026", transactionId: "T009000001", action: "Data Chg",
      approvalStatus: "Pending", displayedName: "Lee, Jordan", source: "ss-smart-hr-detail-read",
    } });
    assert.deepEqual(operations.events, ["prepare:paypath:10000001", "commit:paypath:10000001", "read:transactions:10000001"]);
  });

  it.each<FakePayPathSubmit>(["answer-lost", "nothing-filed"])("throws, never returns a receipt, when the Save answer is %s", async submitAs => {
    const { result } = await submit(submitAs);
    await assert.rejects(result, (error: unknown) => !(error instanceof Failed));
  });

  it("classifies PeopleSoft's answer through the sequencer's real redactor and fails paypath-submit-refused", async () => {
    const observed: ObservedDataPoint[] = [];
    // The sequencer stamps each transaction-task batch with its execution and redacts it through the same function.
    const recordData = (point: DataPoint | readonly DataPoint[]) => {
      const points = ("field" in point ? [point] : point).map(entry => RecordedDataPointSchema.parse({ ...entry, recordedAt: "2026-11-01T12:01:00.000Z",
        execution: { runId: "aaaaaaaa-0001-4000-8000-000100000000", traceId: "ws-190000-aaaa", attempt: 1, workflowId: "work-study", nodeId: "save-transaction", taskId: UcpathSubmitPayPathWorkStudy.id } }));
      observed.push(...redactObservedDataPoints(UcpathSubmitPayPathWorkStudy.id, points));
    };
    const { result } = await submit("alert", recordData);
    await assert.rejects(result, (error: unknown) => error instanceof Failed && error.code === "paypath-submit-refused" && error.message.length > 0);
    assert.deepEqual(observed.map(point => [point.field, point.values.map(value => value.classification)]), [["alertText", ["direct-identifier"]]]);
  });
});
