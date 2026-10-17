import { readOnboardingResultsTask } from "../../../src/backend/systems/crm/tasks/read-onboarding-results.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { searchPersonOrgTask } from "../../../src/backend/systems/ucpath/tasks/search-person-org.js";
import { searchPersonMatchTask } from "../../../src/backend/systems/ucpath/tasks/search-person-match.js";
import { verifyOnboardingRecordTask } from "../../../src/backend/systems/crm/tasks/verify-onboarding-record.js";
import { searchOnboardingRecordsTask } from "../../../src/backend/systems/crm/tasks/search-onboarding-records.js";
import { crmStore } from "../../../src/backend/systems/crm/task-registry.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../src/backend/systems/ucpath/driver/fake.js";
import { createDeterministicCrmOnboardingDriver } from "../../../src/backend/systems/crm/driver/fake.js";
import { CrmDiscoveredRecordSchema } from "../../../src/models/systems/crm/search-onboarding-records.js";
import { TaskError } from "../../../src/workflow-kit/errors.js";

const record = CrmDiscoveredRecordSchema.parse({ recordId: "ONB-1", recordUrl: "https://act-crm.my.site.com/hr/ONB_ViewOnboarding?id=ONB-1", emplId: "10000001", name: "Example, Person", department: "Housing", firstDayOfService: "07/01/2026", dateSigned: "" });
function context(enabled = true, failure = false) {
  const calls: string[] = [];
  return { calls, ctx: { signal: new AbortController().signal, log: { info() {}, warn() {}, debug() {} }, recordData() {},
    fail(code: string, message: string): never { throw new Error(`${code}: ${message}`); },
    captureScreenshot: async () => { if (!enabled) return; calls.push("capture"); if (failure) throw new TaskError(searchPersonOrgTask.contract.id, "BROWSER_SCREENSHOT_CAPTURE_FAILED", "Screenshot capture failed."); },
  } };
}
const crm = createDeterministicCrmOnboardingDriver({ record: { state: "absent", queriedEid: record.emplId, reason: "none" }, dates: { state: "no-confident-record", emplId: record.emplId, employmentDate: null, oathDate: null, reason: "none" } });

describe("Person Lookup walkthrough screenshots", () => {
  for (const enabled of [true, false]) for (const mode of ["by-eid", "by-name"] as const) for (const found of [true, false]) {
    it(`captures P10/P19 ${mode} ${found ? "detail" : "results"} once (enabled=${enabled})`, async () => {
      const { calls, ctx } = context(enabled);
      const base = createDeterministicUcpathPersonOrgDriver();
      const output = found ? await base.searchPersonOrg({ kind: "by-eid", emplId: record.emplId }) : { results: [], selection: { status: "not-found" as const, selected: null, candidateEids: [], searchName: "Example, Person" } };
      const driver = { ...base, searchPersonOrg: async () => { calls.push(found ? "detail" : "results"); return output; } };
      await searchPersonOrgTask.impl.run({ input: mode === "by-eid" ? { kind: mode, emplId: record.emplId } : { kind: mode, name: "Example, Person", keepNonHdh: false }, ctx: { ...ctx, driver } });
      assert.deepEqual(calls, [found ? "detail" : "results", ...(enabled ? ["capture"] : [])]);
    });
  }
  for (const enabled of [true, false]) for (const found of [true, false]) it(`captures P23 Match result once (found=${found}, enabled=${enabled})`, async () => {
    const { calls, ctx } = context(enabled);
    const hit = { emplId: record.emplId, name: record.name };
    await searchPersonMatchTask.impl.run({ input: { firstName: "Person", lastName: "Example", dob: "01/01/1990" }, ctx: { ...ctx, driver: { ...createDeterministicUcpathPersonOrgDriver(), searchPersonMatch: async () => { calls.push("match-result"); return { hits: found ? [hit] : [], confirmed: found ? [hit] : [], dropped: [] }; } } } });
    assert.deepEqual(calls, ["match-result", ...(enabled ? ["capture"] : [])]);
  });
  for (const enabled of [true, false]) it(`captures P30 selected exact record once (enabled=${enabled})`, async () => {
    const { calls, ctx } = context(enabled);
    await searchOnboardingRecordsTask.impl.run({ input: { eid: record.emplId }, ctx: { ...ctx, driver: { ...crm, searchOnboardingRecords: async () => [record] } } });
    assert.equal(calls.length, 0);
    await verifyOnboardingRecordTask.impl.run({ input: record, ctx: { ...ctx, driver: { ...crm, verifyOnboardingRecord: async () => { calls.push("selected-record"); return record; } } } });
    assert.deepEqual(calls, ["selected-record", ...(enabled ? ["capture"] : [])]);
  });
  for (const records of [[], [record, { ...record, recordId: "ONB-2" }]]) for (const enabled of [true, false]) it(`captures P30 unresolved results once (records=${records.length}, enabled=${enabled})`, async () => {
    const { calls, ctx } = context(enabled);
    const task = Object.values(crmStore.tasks).find(task => String(task.contract.id) === "crm/read-onboarding-results");
    assert.equal(task, readOnboardingResultsTask, "CRM results fallback must be registered");
    await readOnboardingResultsTask.impl.run({ input: { query: { eid: record.emplId }, records }, ctx: { ...ctx, driver: { ...crm, searchOnboardingRecords: async () => { calls.push("restored-results"); return records; } } } });
    assert.deepEqual(calls, ["restored-results", ...(enabled ? ["capture"] : [])]);
  });
  for (const point of ["person-org", "match", "crm"] as const) it(`preserves the named capture failure at ${point}`, async () => {
    const { ctx } = context(true, true);
    const operation = point === "person-org" ? searchPersonOrgTask.impl.run({ input: { kind: "by-eid", emplId: record.emplId }, ctx: { ...ctx, driver: createDeterministicUcpathPersonOrgDriver() } })
      : point === "match" ? searchPersonMatchTask.impl.run({ input: { firstName: "Person", lastName: "Example", dob: "01/01/1990" }, ctx: { ...ctx, driver: { ...createDeterministicUcpathPersonOrgDriver(), searchPersonMatch: async () => ({ hits: [], confirmed: [], dropped: [] }) } } })
        : verifyOnboardingRecordTask.impl.run({ input: record, ctx: { ...ctx, driver: { ...crm, verifyOnboardingRecord: async () => record } } });
    await assert.rejects(operation, error => error instanceof TaskError && error.code === "BROWSER_SCREENSHOT_CAPTURE_FAILED");
  });
});
