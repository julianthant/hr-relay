import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { taskStoreRegistry } from "../../../../../../src/backend/app/registries/task-registry.js";

describe("Phase 1f Person Lookup task implementations", () => {
  it("binds every descriptor task into the one runtime task-store index", () => {
    assert.deepEqual(
      taskStoreRegistry.stores
        .flatMap((store) => Object.values(store.tasks).map((task) => String(task.contract.id)))
        .sort(),
      [
        "crm/read-onboarding-dates",
        "crm/read-onboarding-record",
        // The extraction service store lands before any descriptor consumes it.
        "extraction/extract-pdf-pages",
        "extraction/extract-spreadsheet",
        // Separations chunk 5's finalization family shares the SAME driver
        // declaration as the separation form read.
        "kuali/match-separation-finalization",
        // Separations chunk 2's Kuali passage: ONE task for the whole
        // separation form (D194), a sibling of the write family on the SAME
        // driver declaration rather than a second store.
        "kuali/read-separation-document",
        "kuali/save-separation-finalization",
        "kuali/search-separation-action",
        "kuali/stage-separation-finalization",
        "kuali/verify-separation-finalization",
        // Separations chunk 1's New Kronos passage: one task per PAGE VISIT
        // (D194), which is why the timecard's navigate/subject/range/read are
        // one entry and not four.
        "new-kronos/read-separation-timecard",
        "new-kronos/search-employee",
        // The normalization service store (D165) lands before any descriptor
        // consumes it.
        "normalization/read-contact-advice",
        // Route 1 of D151; a peer of the `cli ocr` routes, not a
        // privileged path.
        "ocr/extract-form-page",
        // The roster service store (D163) lands before any descriptor consumes it.
        "roster/match-spreadsheet",
        // D194's rich Person Org read: the whole Employment Instances grid,
        // one page visit (separations chunk 3).
        // Separations chunk 4's UCPath termination write: TWO transactions
        // (the date-agnostic pending sweep, then the filing) with ref write-safety §5's
        // two probe kinds and a verifier each, all on the SAME `ucpath` driver
        // declaration as the Person Org reads (D197 rule 1).
        "ucpath/create-termination",
        "ucpath/delete-pending-terminations",
        "ucpath/match-existing-termination",
        "ucpath/match-pending-terminations",
        "ucpath/read-job-summary",
        "ucpath/read-pending-termination-set",
        "ucpath/search-person-org",
        "ucpath/stage-pending-termination-sweep",
        "ucpath/stage-termination",
        "ucpath/verify-pending-terminations-cleared",
        "ucpath/verify-termination",
        "ucpath/verify-termination-filing-present",
        "workflow:person-lookup/read-active-status",
        // The `separations` pure workflow mini-store, complete as of chunk 6:
        // §4a's termination-type refusal, chunk 3's identity comparison and
        // post-gate check, chunk 5's department fold, and the five decisions
        // only a graph holding ALL of the reads can make — the document's own
        // plan (S7's future refusal and the Kronos window), S18/S19's subject
        // fork, S23/S24's employment selection, the date reconciliation that is
        // the write's payload, and D130's receipt-pair check. Every one of them
        // is sessionless and browser-free.
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
