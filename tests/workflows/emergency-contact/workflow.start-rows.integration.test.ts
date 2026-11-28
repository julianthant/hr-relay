import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { WORKFLOW_MODULES } from "../../../src/backend/app/registries/workflow-registry.js";
import { StartStepOmissionRefusedError, projectStartRows, projectStartSteps, resolveStartStepOmissions } from "../../../src/backend/runs/start/step-selection.js";
import { descriptorRuntimeNodes } from "../../../src/workflow-kit/workflow.js";
import { emergencyContactMemberModule } from "../../support/helpers/registered-workflows.js";

const descriptor = WORKFLOW_MODULES.find(({ descriptor: candidate }) => String(candidate.id) === "emergency-contact")!.descriptor;

describe("Emergency Contact Start run rows", () => {
  it("serves the OCR switches and keeps the Emergency Contact member rows locked", () => {
    const member = "emergency-contact-member";
    assert.deepEqual(projectStartRows(descriptor).map(({ key, label, kind, lockReason, members }) => ({ key, label, kind, lockReason: lockReason ?? null, members })), [
      { key: "ocr-source-pages", label: "Prepare source pages", kind: "switch", lockReason: null, members: [{ workflow: "ocr", step: "source-pages" }] },
      { key: "read-emergency-contact", label: "Read emergency contact", kind: "switch", lockReason: null, members: [{ step: "read-document", nodes: ["worksheet-row-choice", "read-roster-choice", "read-document"] },
        { workflow: "ocr", step: "page-readings" }] },
      { key: "ocr-group-records", label: "Group records for review", kind: "switch", lockReason: null, members: [{ workflow: "ocr", step: "review-records" }] },
      { key: "match-extracted-people", label: "Match extracted people", kind: "switch", lockReason: null, members: [{ step: "read-document", nodes: ["approved-records"] },
        { workflow: "ocr", step: "identity-lookups" }] },
      { key: "ocr-signer-lookups", label: "Look up official signers", kind: "switch", lockReason: null, members: [{ workflow: "ocr", step: "signer-lookups" }] },
      { key: "review-extracted-records", label: "Review extracted records", kind: "switch", lockReason: null, members: [{ workflow: "ocr", step: "approval" }] },
      { key: "read-existing-contacts", label: "Read existing contacts", kind: "locked", lockReason: "bound-read", members: [{ workflow: member, step: "contact-plan" },
        { workflow: member, step: "reference-check" }] },
      { key: "fill-emergency-contact", label: "Fill emergency contact", kind: "locked", lockReason: "form-action", members: [{ workflow: member, step: "contact-preview", phase: "prepare" }] },
      { key: "save-emergency-contact", label: "Save emergency contact", kind: "locked", lockReason: "form-action", members: [{ workflow: member, step: "contact-preview", phase: "commit" },
        { workflow: member, step: "onbase-filing" }, { step: "members" }] },
    ]);
  });

  it("offers typed contact-plan values only on the member's own Start rows", () => {
    assert.equal(emergencyContactMemberModule.descriptor.stepOmissions.find(({ step }) => step === "contact-plan")?.ownStartOnly, true);
    const memberRow = projectStartRows(emergencyContactMemberModule.descriptor).find(row => row.key === "contact-plan");
    assert.ok(memberRow);
    assert.equal(memberRow.kind, "switch");
    assert.equal(memberRow.off, "values");
    assert.ok(memberRow.manual);
    const parentRow = projectStartRows(descriptor).find(row => row.key === "read-existing-contacts");
    assert.ok(parentRow);
    assert.equal(parentRow.kind, "locked");
    assert.equal(parentRow.lockReason, "bound-read");
    assert.equal(parentRow.manual, undefined);
  });

  it("offers typed fields only for OCR child steps", () => {
    for (const row of projectStartRows(descriptor)) {
      assert.deepEqual(row.target, row.kind === "switch" ? row.members.find(({ workflow }) => workflow === "ocr") : undefined, row.key);
      assert.equal(row.manual !== undefined, row.kind === "switch", row.key);
      assert.equal(row.selection, undefined, row.key);
    }
  });

  it("refuses typed facts for the parent's own steps", () => {
    const keys = projectStartSteps(descriptor).map(({ key }) => key);
    for (const step of keys) {
      assert.throws(() => resolveStartStepOmissions(descriptor, keys, [{ step, facts: { value: "typed" } }]),
        (error: unknown) => error instanceof StartStepOmissionRefusedError, step);
    }
  });

  it("keeps the roster decision ahead of the OCR child and preserves the member graph", () => {
    assert.equal(resolveStartStepOmissions(descriptor, projectStartSteps(descriptor).map(({ key }) => key), undefined), undefined);
    assert.deepEqual(descriptorRuntimeNodes(descriptor).map(node => [node.id, node.kind, node.dependsOn]), [
      ["worksheet-row-choice", "gate", []], ["read-roster-choice", "task", ["worksheet-row-choice"]], ["read-document", "child-run", ["read-roster-choice"]],
      ["approved-records", "task", ["read-document"]], ["members", "child-run", ["read-document", "approved-records"]],
      ["read-result", "task", ["read-document", "members"]],
    ]);
    assert.deepEqual(descriptorRuntimeNodes(emergencyContactMemberModule.descriptor)
      .map(node => [node.id, node.kind, node.dependsOn, "dryRun" in node ? node.dryRun : null]), [
      ["reference-fields-start", "task", [], null],
      ["reference-field-review-start", "gate", ["reference-fields-start"], null],
      ["approved-record", "task", [], null],
      ["map-contact", "task", ["approved-record"], null],
      ["reference-fields-map-contact", "task", ["map-contact", "reference-fields-start", "reference-field-review-start"], null],
      ["reference-field-review-map-contact", "gate", ["reference-fields-map-contact"], null],
      ["read-contacts", "task", ["map-contact", "approved-record"], null],
      ["reference-fields-read-contacts", "task", ["map-contact", "read-contacts", "reference-fields-start", "reference-field-review-start",
        "reference-fields-map-contact", "reference-field-review-map-contact"], null],
      ["reference-field-review-read-contacts", "gate", ["reference-fields-read-contacts"], null],
      ["contact-plan", "task", ["map-contact", "read-contacts", "reference-field-review-read-contacts"], null],
      ["contact-preview", "transaction", ["contact-plan"], "stop-after-prepare"],
      ["onbase-filing", "child-run", [], null],
    ]);
  });
});
