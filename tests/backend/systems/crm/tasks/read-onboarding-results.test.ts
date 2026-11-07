import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { readOnboardingResultsTask } from "../../../../../src/backend/systems/crm/tasks/read-onboarding-results.js";
import { createDeterministicCrmOnboardingDriver } from "../../../../../src/backend/systems/crm/driver/fake.js";
import { CrmDiscoveredRecordSchema } from "../../../../../src/models/systems/crm/search-onboarding-records.js";
import { taskFailer } from "../../../../../src/workflow-kit/task.js";
import { TaskError } from "../../../../../src/workflow-kit/errors.js";

const record = CrmDiscoveredRecordSchema.parse({ recordId: "ONB-1", recordUrl: "https://act-crm.my.site.com/hr/ONB_ViewOnboarding?id=ONB-1", emplId: "10000001", name: "Example, Person", department: "Housing", firstDayOfService: "07/01/2026", dateSigned: "" });
const driver = createDeterministicCrmOnboardingDriver({ record: { state: "absent", queriedEid: record.emplId, reason: "none" }, dates: { state: "no-confident-record", emplId: record.emplId, employmentDate: null, oathDate: null, reason: "none" } });
const common = { signal: new AbortController().signal, log: { info() {}, warn() {}, debug() {} }, fail: taskFailer(readOnboardingResultsTask.contract), recordData() {} };

describe("unresolved CRM results", () => {
  for (const enabled of [true, false]) it(`revalidates results and returns actual records (enabled=${enabled})`, async () => {
    const calls: string[] = [];
    const output = await readOnboardingResultsTask.impl.run({ input: { query: { eid: record.emplId }, records: [record] }, ctx: { ...common,
      driver: { ...driver, searchOnboardingRecords: async query => { assert.deepEqual(query, { eid: record.emplId }); calls.push("read"); return [record]; } },
      captureScreenshot: async () => { if (enabled) calls.push("capture"); },
    } });
    assert.deepEqual(output, { records: [record] });
    assert.deepEqual(calls, enabled ? ["read", "capture"] : ["read"]);
  });
  it("refuses changed results before any capture", async () => {
    for (const changed of [[], [{ ...record, department: "Changed" }]]) {
      let captures = 0;
      await assert.rejects(readOnboardingResultsTask.impl.run({ input: { query: { eid: record.emplId }, records: [record] }, ctx: { ...common,
        driver: { ...driver, searchOnboardingRecords: async () => changed }, captureScreenshot: async () => { captures++; },
      } }), error => error instanceof TaskError && error.code === "PERSON_LOOKUP_CRM_RESULTS_CHANGED");
      assert.equal(captures, 0);
    }
  });
  it("keeps capture failure distinct from CRM acquisition failure", async () => {
    const failure = new TaskError(readOnboardingResultsTask.contract.id, "BROWSER_SCREENSHOT_CAPTURE_FAILED", "Capture failed");
    await assert.rejects(readOnboardingResultsTask.impl.run({ input: { query: { eid: record.emplId }, records: [record] }, ctx: { ...common,
      driver: { ...driver, searchOnboardingRecords: async () => [record] }, captureScreenshot: async () => { throw failure; },
    } }), error => error === failure);
  });
});

it("keeps acquisition refusal and cancellation distinct without capturing a page", async () => {
  for (const aborted of [true, false]) {
    const controller = new AbortController();
    if (aborted) controller.abort();
    const failure = new Error("CRM acquisition failed");
    let captures = 0;
    await assert.rejects(readOnboardingResultsTask.impl.run({ input: { query: { eid: record.emplId }, records: [record] }, ctx: { ...common,
      signal: controller.signal, driver: { ...driver, searchOnboardingRecords: async () => { throw failure; } },
      captureScreenshot: async () => { captures++; },
    } }), error => aborted ? error === failure : error instanceof TaskError && error.code === "PERSON_LOOKUP_CRM_CHECK_FAILED");
    assert.equal(captures, 0);
  }
});
