import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { stageTerminationTask } from "../../../../../src/backend/systems/ucpath/tasks/stage-termination.js";
import { createDeterministicUcpathSmartHrDriver } from "../../../../../src/backend/systems/ucpath/driver/smart-hr-fake.js";
import { UcpathStageTermination } from "../../../../../src/models/systems/ucpath/stage-termination.js";
import { UcpathEmploymentRecordMismatchError, UcpathTerminationStagingSchema, UcpathTerminationTargetSchema, UcpathTransactionScanSchema } from "../../../../../src/models/ui/ucpath-smart-hr-termination.js";
import { TaskError } from "../../../../../src/workflow-kit/errors.js";

const staging = UcpathTerminationStagingSchema.parse({ ...UcpathStageTermination.example, observedEmplRecord: "4" });
const input = UcpathTerminationTargetSchema.parse({ emplId: staging.emplId, expectedName: staging.observedName,
  emplRecord: "4", effectiveDate: staging.effectiveDate, template: staging.template,
  reasonCode: staging.resolvedReasonOption, lastDateWorked: staging.lastDateWorked, initiatorComments: "Synthetic approval" });

function run(observedRecord: string, failure?: Error) {
  const recorded: unknown[] = [];
  const driver = createDeterministicUcpathSmartHrDriver({ staging,
    scan: UcpathTransactionScanSchema.parse({ state: "read", emplId: staging.emplId, rows: [],
      scannedRowCount: 0, observedAt: staging.observedAt }),
  });
  const result = stageTerminationTask.impl.run({ input, ctx: {
    driver: { ...driver, stageTermination: async () => {
      if (failure !== undefined) throw failure;
      return { ...staging, observedEmplRecord: observedRecord };
    } },
    signal: new AbortController().signal,
    log: { debug: () => undefined, info: () => undefined, warn: () => undefined },
    fail: (code: string, message: string): never => { throw new TaskError(UcpathStageTermination.id, code, message); },
    recordData: (points) => { recorded.push(points); },
  } });
  return { result, recorded };
}

describe("termination task employment record boundary", () => {
  for (const record of ["0", "", "   "]) {
    it(`refuses a driver's observed record ${JSON.stringify(record)} before recording staging`, async () => {
      const h = run(record);
      await assert.rejects(h.result, (error: unknown) => error instanceof TaskError && error.code === "employment-record-mismatch");
      assert.deepEqual(h.recorded, []);
    });
  }
  it("maps the real driver's typed employment-record refusal to employment-record-mismatch", async () => {
    const refusal = new UcpathEmploymentRecordMismatchError("4", "0");
    const h = run("4", refusal);
    await assert.rejects(h.result, (error: unknown) => error instanceof TaskError
      && error.code === "employment-record-mismatch" && error.message.includes(refusal.message));
    assert.deepEqual(h.recorded, []);
  });
  it("accepts the approved employment record", async () => {
    const h = run("4");
    assert.equal((await h.result).observedEmplRecord, "4");
    assert.equal(h.recorded.length, 1);
  });
});
