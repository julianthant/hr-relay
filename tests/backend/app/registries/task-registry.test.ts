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
        "crm/read-hire-data",
        "crm/read-idocs",
        "crm/read-onboarding-dates",
        "crm/read-onboarding-record",
        "crm/read-onboarding-results",
        "crm/search-document-records",
        "crm/search-onboarding-records",
        "crm/verify-onboarding-record",
        // The extraction service store lands before any descriptor consumes it.
        "extraction/extract-pdf-pages",
        "extraction/extract-spreadsheet",
        "i9/create-profile",
        "i9/create-remote-record",
        "i9/match-profile",
        "i9/match-remote-record",
        "i9/read-section2-signer",
        "i9/stage-profile",
        "i9/stage-remote-record",
        "i9/verify-profile",
        "i9/verify-remote-record",
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
        "ocr/read-approved-record",
        "ocr/read-approved-records",
        "ocr/read-approved-snapshot",

        "onbase/match-import",
        "onbase/read-source-page",
        "onbase/stage-import",
        "onbase/upload-import",
        "onbase/verify-import",

        "roster/match-spreadsheet",

        "ucpath/create-hire",
        "ucpath/create-termination",
        "ucpath/delete-pending-terminations",
        "ucpath/match-emergency-contact-plan",
        "ucpath/match-existing-termination",
        "ucpath/match-hire",
        "ucpath/match-paypath-work-study",
        "ucpath/match-pending-terminations",
        "ucpath/read-emergency-contacts",
        "ucpath/read-hire-findings",
        "ucpath/read-hire-receipt",
        "ucpath/read-job-summary",
        "ucpath/read-paypath-position",
        "ucpath/read-pending-termination-set",
        "ucpath/read-transaction-findings",
        "ucpath/save-emergency-contact",
        "ucpath/search-person-match",
        "ucpath/search-person-org",
        "ucpath/stage-emergency-contact",
        "ucpath/stage-hire",
        "ucpath/stage-paypath-work-study",
        "ucpath/stage-pending-termination-sweep",
        "ucpath/stage-termination",
        "ucpath/submit-paypath-work-study",
        "ucpath/verify-emergency-contact-plan",
        "ucpath/verify-hire",
        "ucpath/verify-paypath-work-study",
        "ucpath/verify-pending-terminations-cleared",
        "ucpath/verify-termination",
        "ucpath/verify-termination-filing-present",
        "workbooks/read-reference",
        "workbooks/read-result",
        "workflow:crm-doc-download/read-document-rows",
        "workflow:crm-doc-download/read-worksheet-archives",
        "workflow:emergency-contact-member/read-approved-contact",
        "workflow:emergency-contact-member/read-contact-plan",
        "workflow:emergency-contact/read-result",
        "workflow:i9-check-start/read-people",
        "workflow:i9-check-start/read-publication",
        "workflow:i9-check-start/read-requests",
        "workflow:i9-check-start/read-rows",
        "workflow:i9-check/read-match-outcome",
        "workflow:i9-check/read-retention-row",
        "workflow:i9-lookup/read-result",
        "workflow:ocr-page/read-manual-reading",
        "workflow:ocr-page/read-page-reading",
        "workflow:ocr/read-result",
        "workflow:ocr/read-review-seed",
        "workflow:ocr/read-source-pages",

        "workflow:onboarding/match-hire-subject",
        "workflow:onboarding/read-hire-plan",
        "workflow:onboarding/read-i9-lookup",
        "workflow:onboarding/read-i9-profile-plan",
        "workflow:onboarding/read-write-plan",

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

        "workflow:work-study/read-transaction-plan",
      ],
    );
  })
});
