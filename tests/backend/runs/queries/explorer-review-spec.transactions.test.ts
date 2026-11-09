import assert from "node:assert/strict";
import { it } from "vitest";
import { buildWorkflowExplorer } from "../../../../src/backend/runs/queries/explorer.js";
import { ExplorerReviewSpecSchema } from "../../../../src/models/dashboard/explorer-review-spec.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { explorerQueryDeps } from "../../../support/fixtures/explorer-seams.js";

function workflows() {
  return buildWorkflowExplorer(explorerQueryDeps(manualClock(new Date("2026-08-09T12:00:00.000Z")), FingerprintSchema.parse("e".repeat(64)))).workflows;
}

it("discloses every approved UCPath termination and Kuali finalization form field", () => {
  const separation = workflows().find(workflow => workflow.id === "separations"); assert.ok(separation);
  const page = (stepId: string, pageId: string) => {
    const step = separation.reviewSpec.steps.find(step => step.id === stepId); assert.ok(step?.pages.state === "authored");
    const found = step.pages.items.find(page => page.id === pageId); assert.ok(found);
    return found;
  };
  const expected = [
    ["termination-setup", [["Template", "template"], ["Transaction date", "effectiveDate"]]],
    ["termination-details", [["Employee ID", "emplId"], ["Employee name", "expectedName"], ["Employee record", "emplRecord"], ["Action reason", "reasonCode"]]],
    ["termination-information", [["Last date worked", "lastDateWorked"], ["Initiator comments", "initiatorComments"], ["Transaction comments", "initiatorComments"]]],
  ] as const;
  for (const [pageId, fields] of expected) for (const [label, fieldPath] of fields) {
    const field = page("ucpath-transaction", pageId).fields.find(field => field.label === label); assert.ok(field, `${pageId}/${label}`);
    assert.deepEqual(field.sources, [{ nodeId: "file-termination", arm: "prepare", taskId: "ucpath/stage-termination", kind: "input", fieldPath }]);
    assert.ok(field.source.origin && field.source.detail);
  }
  const information = page("ucpath-transaction", "termination-information");
  const override = information.fields.find(field => field.label === "Override last date worked"); assert.ok(override);
  assert.deepEqual(override.sources, [{ nodeId: "file-termination", arm: "prepare", taskId: "ucpath/stage-termination", kind: "output", fieldPath: "lastDateWorkedOverridden" }]);
  const finalization = page("kuali-finalization", "kuali-document");
  for (const [label, fieldPath] of [
    ["Department", "variables.department"], ["Payroll title code", "variables.payrollTitleCode"], ["Payroll title", "variables.payrollTitle"],
    ["Timekeeper name", "variables.timekeeperName"], ["Last day worked", "variables.lastDayWorked"], ["Separation date", "variables.separationDate"],
    ["Termination effective date", "variables.terminationEffectiveDate"], ["Transaction number", "variables.transactionNumber"], ["Timekeeper comments", "variables.timekeeperComments"],
  ]) {
    const field = finalization.fields.find(field => field.label === label); assert.ok(field, label);
    assert.deepEqual(field.sources, [{ nodeId: "finalize-kuali", arm: "prepare", taskId: "kuali/stage-separation-finalization", kind: "input", fieldPath }]);
    assert.ok(field.source.origin && field.source.detail);
  }
  for (const [label, value] of [["Request acknowledged", true], ["Termination template submitted", true], ["Final pay", "does-not-need-final-pay-student"]] as const) {
    const field = finalization.fields.find(field => field.label === label); assert.ok(field, label);
    assert.deepEqual(field.sources, [{ nodeId: "finalize-kuali", kind: "constant", value }]);
  }
  assert.deepEqual(finalization.fields.find(field => field.label === "Department")?.source.read,
    { stepKey: "job-summary", page: "Person Organizational Summary detail", field: "Kuali department option" });
  assert.deepEqual(finalization.fields.find(field => field.label === "Transaction number")?.source.read,
    { stepKey: "ucpath-transaction", page: "SS Smart HR transaction detail", field: "Transaction number" });
  assert.deepEqual(page("ucpath-transaction", "termination-setup").fields.find(field => field.label === "Template")?.options, ["UC_INVOL_TERM", "UC_VOL_TERM"]);
});

it("discloses transaction form inputs for onboarding, contact edits and OnBase", () => {
  const entries = workflows();
  const expected: readonly (readonly [string, string, readonly string[]])[] = [
    ["onboarding", "new-employee", ["First name", "Last name", "Date of birth", "SSN", "Email", "Worksite"]],
    ["onboarding", "remote-i9", ["Profile ID", "Start date", "I-9 type"]],
    ["onboarding", "personal-data", ["Legal first name", "Legal last name", "Date of birth", "National ID", "Address", "City", "State", "Postal code", "Phone type", "Preferred phone", "Email", "Email type", "Tracker Profile ID"]],
    ["onboarding", "job-data", ["Position number", "Employee classification", "Expected job end date", "Hourly rate", "Compensation rate code", "Compensation frequency"]],
    ["onboarding", "hire-submission", ["Comments", "Initiator comments"]],
    ["emergency-contact-member", "emergency-contacts", ["Contact name", "Relationship", "Phone", "Primary contact"]],
    ["onbase", "import-document", ["Employee ID", "PDF page", "Document type", "Document name", "Last name", "First name", "Department"]],
  ];
  for (const [workflowId, pageId, labels] of expected) {
    const workflow = entries.find(workflow => workflow.id === workflowId); assert.ok(workflow);
    const pages = workflow.reviewSpec.steps.flatMap(step => step.pages.state === "authored" ? step.pages.items : []);
    const page = pages.find(page => page.id === pageId && page.mode === "Fill form"); assert.ok(page, `${workflowId}/${pageId}`);
    for (const label of labels) {
      assert.ok(page.fields.some(field => field.label === label && field.sources.length > 0 && field.source.origin && field.source.detail), `${workflowId}/${pageId}/${label}`);
    }
  }
});

it("rejects transaction source bindings with unknown arms or unchecked nested properties", () => {
  const workflow = workflows().find(workflow => workflow.id === "separations"); assert.ok(workflow);
  const step = workflow.reviewSpec.steps.find(step => step.id === "ucpath-transaction"); assert.ok(step?.pages.state === "authored");
  const page = step.pages.items.find(page => page.id === "termination-setup"); assert.ok(page);
  const field = page.fields.find(field => field.label === "Template"); assert.ok(field);
  const binding = field.sources[0]; assert.ok(binding);
  for (const source of [{ ...binding, arm: "commit" }, { ...binding, unchecked: true },
    { nodeId: "file-termination", kind: "constant", value: "" },
    { nodeId: "file-termination", kind: "constant", value: true, fieldPath: "template" }]) {
    assert.equal(ExplorerReviewSpecSchema.safeParse({ ...workflow.reviewSpec, steps: [{ ...step,
      pages: { state: "authored", items: [{ ...page, fields: [{ ...field, sources: [source] }] }] } }] }).success, false);
  }
});
