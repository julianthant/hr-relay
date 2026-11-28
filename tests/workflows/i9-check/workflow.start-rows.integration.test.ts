import assert from "node:assert/strict";
import { it } from "vitest";
import { projectStartRows, projectStartSteps, resolveStartStepOmissions, startRowWire, startStepWireControl } from "../../../src/backend/runs/start/step-selection.js";
import { restoreRerunDraft, selectedStepKeys } from "../../../src/dashboard/surfaces/run-start/run-launch-draft-model.js";
import { stoppedStepOmissions, toggleStepSelection } from "../../../src/dashboard/surfaces/run-start/run-start-model.js";
import { pdfRunRequiresOcr } from "../../../src/dashboard/surfaces/run-start/run-start-pdfs.js";
import { rowFieldsOpen, rowIncluded, rowOpenFold, startRowsOf, stepEntries } from "../../../src/dashboard/surfaces/run-start/run-steps-model.js";
import type { RunStartWorkflow } from "../../../src/dashboard/surfaces/run-start/run-start.js";
import { RerunValuesSnapshotSchema } from "../../../src/models/dashboard/rerun-values.js";
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
  const pdfSurface = descriptor.surfaces.uploadRun;
  assert.ok(pdfSurface);
  assert.equal(pdfRunRequiresOcr(pdfSurface, null, {}, all), true);
  assert.equal(pdfRunRequiresOcr(pdfSurface, null, {}, selected), false);
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

it("requires both matched-person values before starting", () => {
  const rows = startRowsOf({ steps: projectStartSteps(descriptor), rows: projectStartRows(descriptor).map(startRowWire) });
  const row = rows.find(candidate => candidate.key === "ucpath-match");
  assert.ok(row?.form);
  const found = { status: "found", eid: "10812345", name: "Example Person" };
  assert.equal(stepEntries([rowOpenFold(row, row.form, { ...found, eid: "" })]), null);
  assert.equal(stepEntries([rowOpenFold(row, row.form, { ...found, name: "" })]), null);
  assert.ok(stepEntries([rowOpenFold(row, row.form, found)]));
  assert.ok(stepEntries([rowOpenFold(row, row.form, { status: "not-found", eid: "", name: "" })]));
});

it.each(["roster-reference", "retention", "publication"])("keeps the steps needed to rerun a failed %s", failed => {
  const workflow: RunStartWorkflow = {
    workflowId: "i9-check-start", version: descriptor.version, label: "I-9 Check", categoryId: "operations",
    role: { kind: "standalone" }, icon: "Search", enqueue: "reject-active", spreadsheetIntake: false, requiredWorkbookFields: [],
    inputRun: { state: "absent", reason: "This workflow uses PDFs." },
    steps: projectStartSteps(descriptor).map(step => ({ ...step, control: startStepWireControl(step.control) })),
    rows: projectStartRows(descriptor).map(startRowWire),
  };
  const restart = descriptor.timeline.findIndex(step => step.key === failed);
  const snapshot = RerunValuesSnapshotSchema.parse({
    sourceInput: { state: "available", value: {} },
    source: { runId: "10000000-0000-4000-8000-000000000001", version: 3, workflow: workflow.workflowId,
      descriptorVersion: descriptor.version, contractFingerprint: "a".repeat(64), outcome: "failed", dryRun: false, priority: "interactive", browserMode: "headed" },
    steps: descriptor.timeline.map((step, index) => {
      const state = index < restart ? "completed" : index === restart ? "failed" : "unfinished";
      return { key: step.key, state, nodes: step.nodes.map(node => ({ nodeId: node.id, state,
        reason: state === "completed" ? "checkpoint" : state === "failed" ? "failure" : "incomplete-execution" })) };
    }),
    values: [], transactions: [],
  });
  const draft = restoreRerunDraft(snapshot, workflow);
  const requested = selectedStepKeys(draft, workflow), stopped = stoppedStepOmissions(workflow.steps, requested);
  const selected = requested.filter(key => !stopped.has(key));
  assert.ok(selected.includes("documents"));
  assert.ok(selected.includes(failed));
});
