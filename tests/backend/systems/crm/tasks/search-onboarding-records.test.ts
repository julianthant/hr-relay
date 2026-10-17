import { TaskRefusal } from "../../../../support/helpers/separation-task-fixtures.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { searchOnboardingRecordsTask } from "../../../../../src/backend/systems/crm/tasks/search-onboarding-records.js";
import { verifyOnboardingRecordTask } from "../../../../../src/backend/systems/crm/tasks/verify-onboarding-record.js";
import { CrmDiscoveredRecordSchema, CrmRecordIdentityDriftError } from "../../../../../src/models/systems/crm/search-onboarding-records.js";
import { createDeterministicCrmOnboardingDriver } from "../../../../../src/backend/systems/crm/driver/fake.js";
const record = CrmDiscoveredRecordSchema.parse({ recordId: "ONB-1", recordUrl: "https://act-crm.my.site.com/hr/ONB_ViewOnboarding?id=ONB-1", emplId: "10000001", name: "Example, Person", department: "Housing", firstDayOfService: "07/01/2026", dateSigned: "" });
const ctx = { signal: new AbortController().signal, log: { info() {}, warn() {}, debug() {} }, recordData() {}, fail(code: string, message: string): never { throw new TaskRefusal(code, message); } };
describe("selected CRM record verification", () => {
 it("keeps acquisition failure distinct from changed identity and accepts current facts", async () => {
  const base = createDeterministicCrmOnboardingDriver({ record: { state: "absent", queriedEid: record.emplId, reason: "none" }, dates: { state: "no-confident-record", emplId: record.emplId, employmentDate: null, oathDate: null, reason: "none" } });
  const failed = await verifyOnboardingRecordTask.impl.run({ input: record, ctx: { ...ctx, driver: { ...base, verifyOnboardingRecord: async () => { throw new Error("unavailable"); } } } });
  assert.deepEqual(failed, { state: "check-failed", code: "PERSON_LOOKUP_CRM_CHECK_FAILED", reason: "CRM check failed." });
  await assert.rejects(verifyOnboardingRecordTask.impl.run({ input: record, ctx: { ...ctx, driver: { ...base, verifyOnboardingRecord: async () => { throw new CrmRecordIdentityDriftError(); } } } }), (error: unknown) => error instanceof TaskRefusal && error.code === "PERSON_LOOKUP_CRM_RECORD_IDENTITY_DRIFT");
  const changed = { ...record, firstDayOfService: "07/02/2026" };
  assert.deepEqual(await verifyOnboardingRecordTask.impl.run({ input: record, ctx: { ...ctx, driver: { ...base, verifyOnboardingRecord: async () => changed } } }), { state: "checked", records: [changed] });
 });
});

describe("CRM discovery cause diagnostics", () => {
  const base = createDeterministicCrmOnboardingDriver({ record: { state: "absent", queriedEid: record.emplId, reason: "none" }, dates: { state: "no-confident-record", emplId: record.emplId, employmentDate: null, oathDate: null, reason: "none" } });
  async function failure(error: unknown) {
    const diagnostics: unknown[] = [];
    const result = await searchOnboardingRecordsTask.impl.run({ input: { eid: record.emplId }, ctx: { ...ctx,
      log: { ...ctx.log, debug: (message: string, fields?: Readonly<Record<string, string | number | boolean>>) => { diagnostics.push({ message, fields }); } },
      driver: { ...base, searchOnboardingRecords: async () => { throw error; } },
    } });
    assert.deepEqual(result, { state: "check-failed", code: "PERSON_LOOKUP_CRM_CHECK_FAILED", reason: "CRM check failed." });
    return diagnostics;
  }
  it("records a structural driver cause separately from the operator result", async () => {
    assert.deepEqual(await failure(new Error('CRM record field "Date Signed" resolved 2 values; expected exactly one')), [{
      message: "CRM check cause", fields: { errorName: "Error", errorMessage: 'CRM record field "Date Signed" resolved 2 values; expected exactly one' },
    }]);
  });
  it("keeps a Playwright timeout and field label without its DOM preview", async () => {
    const error = new Error("locator.waitFor: Timeout 30000ms exceeded.\nCall log:\n - waiting for locator('td').filter({ hasText: 'Date Signed' })\n - locator resolved to <td>Private Person 10000001 07/01/2026</td>");
    error.name = "TimeoutError";
    assert.deepEqual(await failure(error), [{ message: "CRM check cause", fields: { errorName: "TimeoutError", errorMessage: 'locator.waitFor: Timeout 30000ms exceeded. CRM record field "Date Signed"' } }]);
  });
  it("withholds arbitrary messages and error names including identity, dates, URLs and credentials", async () => {
    const error = new Error("Private Person 10000001 07/01/2026 <td>secret</td> https://example.com/?id=10000001 password=secret");
    error.name = "Private Person 10000001";
    assert.deepEqual(await failure(error), [{ message: "CRM check cause", fields: { errorName: "Error", errorMessage: "Unrecognized driver error detail withheld" } }]);
    assert.deepEqual(await failure("Private Person 10000001"), [{ message: "CRM check cause", fields: { errorName: "NonError", errorMessage: "Non-Error driver detail withheld" } }]);
  });
  it("rethrows cancellation without recording a CRM check cause", async () => {
    const controller = new AbortController();
    controller.abort();
    const error = new Error("cancelled");
    const diagnostics: unknown[] = [];
    await assert.rejects(searchOnboardingRecordsTask.impl.run({ input: { eid: record.emplId }, ctx: { ...ctx,
      signal: controller.signal, log: { ...ctx.log, debug: message => { diagnostics.push(message); } },
      driver: { ...base, searchOnboardingRecords: async () => { throw error; } },
    } }), error);
    assert.deepEqual(diagnostics, []);
  });

});
