import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { CrmOnboardingDriverSchema } from "../../../src/models/ui/crm-onboarding.js";

describe("CRM onboarding selector-backed driver", () => {
  it("keeps the task-facing driver boundary strict and operation-shaped", () => {
    const valid = {
      system: "crm",
      readHireData: async () => ({ state: "unused" }),
      searchOnboardingRecords: async () => [],
      verifyOnboardingRecord: async () => ({ state: "unused" }),
      readOnboardingRecord: async () => ({ state: "unused" }),
      findDocumentRecord: async () => ({ state: "unused" }),
      readIdocs: async () => ({ state: "unused" }),
      readOnboardingDates: async () => ({ state: "unused" }),
    };
    assert.equal(CrmOnboardingDriverSchema.safeParse(valid).success, true);
    for (const method of ["findDocumentRecord", "readIdocs"]) {
      const missing = Object.fromEntries(Object.entries(valid).filter(([key]) => key !== method));
      assert.equal(CrmOnboardingDriverSchema.safeParse(missing).success, false);
    }
    assert.equal(CrmOnboardingDriverSchema.safeParse({ ...valid, page: {} }).success, false);
    assert.equal(CrmOnboardingDriverSchema.safeParse({ ...valid, readOnboardingRecord: "raw" }).success, false);
    assert.equal(CrmOnboardingDriverSchema.safeParse({ ...valid, readHireData: "raw" }).success, false);
  });
});
