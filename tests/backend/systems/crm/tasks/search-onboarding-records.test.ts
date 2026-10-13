import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { verifyOnboardingRecordTask } from "../../../../../src/backend/systems/crm/tasks/verify-onboarding-record.js";
import { CrmDiscoveredRecordSchema, CrmRecordIdentityDriftError } from "../../../../../src/models/systems/crm/search-onboarding-records.js";
import { createDeterministicCrmOnboardingDriver } from "../../../../../src/backend/systems/crm/driver/fake.js";
const record = CrmDiscoveredRecordSchema.parse({ recordId: "ONB-1", recordUrl: "https://act-crm.my.site.com/hr/ONB_ViewOnboarding?id=ONB-1", emplId: "10000001", name: "Example, Person", department: "Housing", firstDayOfService: "07/01/2026", dateSigned: "" });
const ctx = { signal: new AbortController().signal, log: { info() {}, warn() {}, debug() {} }, recordData() {}, fail(code: string, message: string): never { throw new Error(`${code}: ${message}`); } };
describe("selected CRM record verification", () => {
 it("keeps acquisition failure distinct from changed identity and accepts current facts", async () => {
  const base = createDeterministicCrmOnboardingDriver({ record: { state: "absent", queriedEid: record.emplId, reason: "none" }, dates: { state: "no-confident-record", emplId: record.emplId, employmentDate: null, oathDate: null, reason: "none" } });
  const failed = await verifyOnboardingRecordTask.impl.run({ input: record, ctx: { ...ctx, driver: { ...base, verifyOnboardingRecord: async () => { throw new Error("unavailable"); } } } });
  assert.deepEqual(failed, { state: "check-failed", code: "person-lookup-crm-check-failed", reason: "CRM check failed." });
  await assert.rejects(verifyOnboardingRecordTask.impl.run({ input: record, ctx: { ...ctx, driver: { ...base, verifyOnboardingRecord: async () => { throw new CrmRecordIdentityDriftError(); } } } }), /subject-mismatch: CRM selected record identity changed/);
  const changed = { ...record, firstDayOfService: "07/02/2026" };
  assert.deepEqual(await verifyOnboardingRecordTask.impl.run({ input: record, ctx: { ...ctx, driver: { ...base, verifyOnboardingRecord: async () => changed } } }), { state: "checked", records: [changed] });
 });
});
