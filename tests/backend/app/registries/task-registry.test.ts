import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";

describe("Person Lookup task implementations", () => {
  it("binds every descriptor task into the one runtime task-store index", () => {
    assert.deepEqual(
      taskStoreRegistry.stores
        .flatMap((store) => Object.values(store.tasks).map((task) => String(task.contract.id)))
        .sort(),
      [
        "crm/read-onboarding-dates",
        "crm/read-onboarding-record",
        "crm/read-onboarding-results",
        "crm/search-onboarding-records",
        "crm/verify-onboarding-record",
        // The extraction service store lands before any descriptor consumes it.
        "extraction/extract-pdf-pages",
        "extraction/extract-spreadsheet",
        // Separations chunk 5's finalization family shares the SAME driver
        // declaration as the separation form read.
        "kuali/match-separation-finalization",

        "kuali/read-separation-document",
        "kuali/save-separation-finalization",
        "kuali/search-separation-action",
        "kuali/stage-separation-finalization",
        "kuali/verify-separation-finalization",

        "new-kronos/read-separation-timecard",
        "new-kronos/search-employee",

        "normalization/read-contact-advice",

        "ocr/extract-form-page",

        "roster/match-spreadsheet",

        "ucpath/create-termination",
        "ucpath/delete-pending-terminations",
        "ucpath/match-existing-termination",
        "ucpath/match-pending-terminations",
        "ucpath/read-job-summary",
        "ucpath/read-pending-termination-set",
        "ucpath/search-person-match",
        "ucpath/search-person-org",
        "ucpath/stage-pending-termination-sweep",
        "ucpath/stage-termination",
        "ucpath/verify-pending-terminations-cleared",
        "ucpath/verify-termination",
        "ucpath/verify-termination-filing-present",
        "workflow:person-lookup/read-active-status",
        "workflow:person-lookup/read-resolved-identity",

        "workflow:separations/match-active-employment",
        "workflow:separations/match-department-option",
        "workflow:separations/match-identity",
        "workflow:separations/match-separation-subject",
        "workflow:separations/match-termination-type",
        "workflow:separations/read-separation-dates",
        "workflow:separations/read-separation-plan",
        "workflow:separations/verify-identity-approval",
        "workflow:separations/verify-termination-receipt",
      ],
    );
  })
});
