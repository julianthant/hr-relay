import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { CrmOnboardingDriverSchema } from "../../../src/models/ui/crm-onboarding.js";

describe("CRM onboarding selector-backed driver", () => {
  it("keeps the task-facing driver boundary strict and operation-shaped", () => {
    const valid = {
      system: "crm",
      searchOnboardingRecords: async () => [],
      verifyOnboardingRecord: async () => ({ state: "unused" }),
      readOnboardingRecord: async () => ({ state: "unused" }),
      readOnboardingDates: async () => ({ state: "unused" }),
    };
    assert.equal(CrmOnboardingDriverSchema.safeParse(valid).success, true);
    assert.equal(CrmOnboardingDriverSchema.safeParse({ ...valid, page: {} }).success, false);
    assert.equal(CrmOnboardingDriverSchema.safeParse({ ...valid, readOnboardingRecord: "raw" }).success, false);
  });
});
