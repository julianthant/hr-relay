import assert from "node:assert/strict";
import { it } from "vitest";
import { projectStartRows, projectStartSteps, resolveStartStepOmissions, startRowWire, startStepWireControl } from "../../../src/backend/runs/start/step-selection.js";
import { stoppedStepOmissions, toggleStepSelection } from "../../../src/dashboard/surfaces/run-start/run-start-model.js";
import { rowFieldsOpen, rowIncluded, rowOpenFold, startRowsOf, stepEntries } from "../../../src/dashboard/surfaces/run-start/run-steps-model.js";
import { i9CheckStartModule } from "../../support/helpers/registered-workflows.js";

const descriptor = i9CheckStartModule.descriptor;

it("serves a switch for every I-9 Check row", () => {
  assert.deepEqual(projectStartRows(descriptor).map(({ key, kind, off, lockReason, target }) => [key, kind, off, lockReason, target]), [
    ["read-forms", "switch", "values", undefined, { step: "documents" }],
    ["match-people", "switch", "values", undefined, { step: "documents" }],
    ["review-records", "switch", "values", undefined, { step: "documents" }],
    ["roster-reference", "switch", "values", undefined, { step: "roster-reference" }],
    ["ucpath-match", "switch", "values", undefined, { workflow: "i9-check", step: "person-match" }],
    ["ucpath-dates", "switch", "values", undefined, { workflow: "i9-check", step: "person-lookup" }],
    ["retention", "switch", "values", undefined, { step: "retention" }],
    ["tracker-row", "switch", "manual", undefined, { step: "publication" }],
  ]);
  const match = projectStartRows(descriptor).find(row => row.key === "ucpath-match");
  assert.ok(match?.members.some(member => member.workflow === "i9-check" && member.step === "reference-check"));
  const steps = projectStartSteps(descriptor).map(step => step.key);
  assert.deepEqual(steps, ["documents", "roster-reference", "retention", "publication"]);
  assert.equal(resolveStartStepOmissions(descriptor, steps, undefined), undefined);
  const typed = resolveStartStepOmissions(descriptor, steps, [{ workflow: "i9-check", step: "person-lookup", facts: { emplId: null, name: null, hireDate: null } }]);
  assert.deepEqual(typed, [{ workflow: "i9-check", step: "person-lookup", facts: { emplId: null, name: null, hireDate: null }, labels: { emplId: "UCPath Employee ID", name: "UCPath name", hireDate: "UCPath hire date" } }]);
});

it("switching off OCR review also skips its source and dependent rows without opening any OCR values form", () => {
  const steps = projectStartSteps(descriptor).map(step => ({ ...step, control: startStepWireControl(step.control) }));
  const rows = startRowsOf({ steps, rows: projectStartRows(descriptor).map(startRowWire) });
  const review = rows.find(row => row.key === "review-records");
  assert.ok(review?.stepKey);
  assert.match(review.note ?? "", /Also skips: Read I-9 forms, Match extracted people/u);
  assert.match(review.note ?? "", /Match person in UCPath/u);
  const all = steps.map(step => step.key);
  const requested = toggleStepSelection(steps, all, review.stepKey, false);
  assert.deepEqual(requested, ["roster-reference", "retention", "publication"]);
  const stopped = stoppedStepOmissions(steps, requested);
  const selected = requested.filter(key => !stopped.has(key));
  assert.deepEqual(selected, []);
  assert.ok(rows.every(row => !rowIncluded(row, selected, [])));
  const open = rows.flatMap(row => row.form !== undefined && rowFieldsOpen(row, selected, []) ? [rowOpenFold(row, row.form, {})] : []);
  assert.ok(open.every(({ form }) => form.fields.length === 0));
  const entries = steps.map(({ key }) => ({ step: key, facts: {} }));
  assert.deepEqual(stepEntries(open), entries);
  assert.deepEqual(toggleStepSelection(steps, requested, review.stepKey, true), all);
  assert.deepEqual(toggleStepSelection(steps, requested.filter(key => key !== "retention" && key !== "publication"), review.stepKey, true),
    ["documents", "roster-reference"]);
  assert.deepEqual(resolveStartStepOmissions(descriptor, selected, entries)?.map(entry => entry.step), entries.map(entry => entry.step));
  assert.throws(() => resolveStartStepOmissions(descriptor, ["roster-reference", "retention", "publication"], [{ step: "documents", facts: {} }]), /dependency-omitted/u);
  assert.throws(() => resolveStartStepOmissions(descriptor, selected, [
    ...entries, { workflow: "i9-check", step: "person-lookup", facts: { emplId: null, name: null, hireDate: null } },
  ]), /will not run/u);
});
