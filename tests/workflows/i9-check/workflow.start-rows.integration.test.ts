import assert from "node:assert/strict";
import { it } from "vitest";
import { projectStartRows, projectStartSteps, resolveStartStepOmissions } from "../../../src/backend/runs/start/step-selection.js";
import { i9CheckStartModule } from "../../support/helpers/registered-workflows.js";

const descriptor = i9CheckStartModule.descriptor;

it("serves the OCR and UCPath child switches and keeps retention required", () => {
  assert.deepEqual(projectStartRows(descriptor).map(({ key, label, kind, lockReason, target }) => ({ key, label, kind, lockReason: lockReason ?? null, target: target ?? null })), [
    { key: "ocr-source-pages", label: "Prepare source pages", kind: "switch", lockReason: null, target: { workflow: "ocr", step: "source-pages" } },
    { key: "read-forms", label: "Read I-9 forms", kind: "switch", lockReason: null, target: { workflow: "ocr", step: "page-readings" } },
    { key: "ocr-group-records", label: "Group records for review", kind: "switch", lockReason: null, target: { workflow: "ocr", step: "review-records" } },
    { key: "match-people", label: "Match extracted people", kind: "switch", lockReason: null, target: { workflow: "ocr", step: "identity-lookups" } },
    { key: "ocr-signer-lookups", label: "Look up official signers", kind: "switch", lockReason: null, target: { workflow: "ocr", step: "signer-lookups" } },
    { key: "review-records", label: "Review extracted records", kind: "switch", lockReason: null, target: { workflow: "ocr", step: "approval" } },
    { key: "ucpath-match", label: "Match person in UCPath", kind: "switch", lockReason: null, target: { workflow: "i9-check", step: "person-match" } },
    { key: "ucpath-dates", label: "Read employment dates", kind: "switch", lockReason: null, target: { workflow: "i9-check", step: "person-lookup" } },
    { key: "tracker-row", label: "Append retention tracker row", kind: "locked", lockReason: "form-action", target: null },
  ]);
  const match = projectStartRows(descriptor).find(row => row.key === "ucpath-match");
  assert.ok(match?.members.some(member => member.workflow === "i9-check" && member.step === "reference-check"));
  const steps = projectStartSteps(descriptor).map(step => step.key);
  assert.deepEqual(steps, ["documents", "roster-reference", "retention"]);
  assert.equal(resolveStartStepOmissions(descriptor, steps, undefined), undefined);
  const typed = resolveStartStepOmissions(descriptor, steps, [{ workflow: "i9-check", step: "person-lookup", facts: { emplId: null, name: null, hireDate: null } }]);
  assert.deepEqual(typed, [{ workflow: "i9-check", step: "person-lookup", facts: { emplId: null, name: null, hireDate: null }, labels: { emplId: "UCPath Employee ID", name: "UCPath name", hireDate: "UCPath hire date" } }]);
});
