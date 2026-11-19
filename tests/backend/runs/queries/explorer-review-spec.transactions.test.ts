import assert from "node:assert/strict";
import { it } from "vitest";
import type { ExplorerReviewSpec } from "../../../../src/models/dashboard/explorer-review-spec.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { explorerQueryDeps, readFixtureExplorer } from "../../../support/fixtures/explorer-seams.js";

function spec(id: string): ExplorerReviewSpec {
  const workflow = readFixtureExplorer(explorerQueryDeps(manualClock(new Date("2026-08-09T12:00:00.000Z")), FingerprintSchema.parse("e".repeat(64))))
    .workflows.find(candidate => candidate.id === id);
  assert.ok(workflow, id);
  return workflow.reviewSpec;
}
function card(review: ExplorerReviewSpec, stepId: string, cardId: string) {
  const found = review.steps.find(step => step.id === stepId)?.blocks.find(block => block.kind === "card" && block.id === cardId);
  assert.ok(found?.kind === "card", `${stepId}/${cardId}`);
  return found;
}

it("discloses every approved UCPath termination and Kuali finalization form field with its source", () => {
  const separations = spec("separations");
  const expected = [
    ["ucpath-transaction", "termination-setup", ["Template", "Transaction date"]],
    ["ucpath-transaction", "termination-details", ["Employee ID", "Employee name", "Employee record", "Action reason"]],
    ["ucpath-transaction", "termination-information", ["Last date worked", "Initiator comments", "Transaction comments", "Override last date worked"]],
    ["kuali-finalization", "kuali-document", ["Department", "Payroll title code", "Payroll title", "Timekeeper name", "Last day worked", "Separation date",
      "Termination effective date", "Transaction number", "Timekeeper comments", "Request acknowledged", "Termination template submitted", "Final pay"]],
  ] as const;
  for (const [stepId, cardId, labels] of expected) {
    const form = card(separations, stepId, cardId);
    assert.equal(form.mode, "fill", `${stepId}/${cardId}`);
    for (const label of labels) {
      const row = form.rows.find(candidate => candidate.label === label); assert.ok(row, `${cardId}/${label}`);
      const source = separations.sources[row.source]; assert.ok(source, `${cardId}/${label}`);
      assert.ok(source.origin && source.detail);
    }
  }
  const finalization = card(separations, "kuali-finalization", "kuali-document");
  const reads = (label: string) => { const row = finalization.rows.find(candidate => candidate.label === label); assert.ok(row); return separations.sources[row.source]?.reads; };
  assert.deepEqual(reads("Department"), [{ system: "ucpath", step: "identity-check", page: "Workforce Job Summary", field: "Kuali department option" }]);
  assert.deepEqual(reads("Transaction number"), [{ system: "ucpath", step: "ucpath-transaction", page: "SS Smart HR transaction detail", field: "Transaction number" }]);
  assert.equal(finalization.rows.find(row => row.label === "Request acknowledged")?.value, "Checked");
});

it("discloses transaction form inputs for onboarding, contact edits and OnBase", () => {
  const expected: readonly (readonly [string, string, string, readonly string[]])[] = [
    ["onboarding", "i9-creation", "new-employee", ["First name", "Last name", "Date of birth", "SSN", "Email", "Worksite"]],
    ["onboarding", "i9-creation", "remote-i9", ["Profile ID", "Start date", "I-9 type"]],
    ["onboarding", "ucpath-hire", "personal-data", ["Legal first name", "Legal last name", "Date of birth", "National ID", "Address", "City", "State", "Postal code", "Phone type", "Preferred phone", "Email", "Email type", "Tracker Profile ID"]],
    ["onboarding", "ucpath-hire", "job-data", ["Position number", "Employee classification", "Expected job end date", "Hourly rate", "Compensation rate code", "Compensation frequency"]],
    ["onboarding", "ucpath-hire", "hire-submission", ["Comments", "Initiator comments"]],
    ["emergency-contact-member", "contact-preview", "emergency-contacts", ["Contact name", "Relationship", "Phone", "Primary contact"]],
    ["onbase", "import-document", "import-document", ["Employee ID", "PDF page", "Document type", "Document name", "Last name", "First name", "Department"]],
  ];
  for (const [workflowId, stepId, cardId, labels] of expected) {
    const review = spec(workflowId);
    const form = card(review, stepId, cardId);
    assert.equal(form.mode, "fill", `${workflowId}/${cardId}`);
    for (const label of labels) {
      const row = form.rows.find(candidate => candidate.label === label); assert.ok(row, `${workflowId}/${cardId}/${label}`);
      assert.ok(review.sources[row.source]?.detail, `${workflowId}/${cardId}/${label}`);
    }
  }
});
