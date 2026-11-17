import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { DESCRIPTORS } from "../../../../src/backend/app/registries/workflow-registry.js";
import type { RunStartWorkflow } from "../../../../src/dashboard/surfaces/run-start/run-start.js";
import {
  attemptFacts, changeDryRun, changeFact, changeText, changeTypedValue, changeWorkflow, clearWorkbookRows, copyOmittedValue,
  enterCustomization, freshLaunchDraft, leaveCustomization, pickReference, pickReferenceVersion, pickWorksheet, removeReference,
  restoreRerunDraft, selectWorkbookRows, selectedStepKeys, setLaunchField, toggleStep, touchFact, typedDraftOf, type LaunchDraft,
} from "../../../../src/dashboard/surfaces/run-start/run-launch-draft-model.js";
import { RerunValuesSnapshotSchema } from "../../../../src/models/dashboard/rerun-values.js";
import { WORK_STUDY_TYPED_INPUT } from "../../../../src/models/workflows/work-study/input.js";

const OMIT_FORM = { fields: [{ key: "reason", kind: "text" }, { key: "confirmed", kind: "boolean" }] } as unknown as Extract<RunStartWorkflow["steps"][number]["control"], { state: "omittable" }>["form"];
const plain: RunStartWorkflow = {
  workflowId: "plain", version: 1, label: "Plain", categoryId: "operations", role: { kind: "standalone" },
  enqueue: "reject-active", spreadsheetIntake: false, requiredWorkbookFields: [], referenceSources: [],
  inputRun: { state: "present", surface: { placeholder: "Employee ID", parser: {
    split: { kind: "whole-text" }, rules: [{ when: { kind: "pattern", pattern: "eid" }, emit: "eid" }],
  } } },
  steps: [
    { key: "read", label: "Read", includedByDefault: true, control: { state: "omittable", form: OMIT_FORM, forces: ["write"] } },
    { key: "write", label: "Write", includedByDefault: true, control: { state: "omittable", form: { fields: [] }, forces: [] } },
    { key: "finish", label: "Finish", includedByDefault: true, control: { state: "required", reason: "Required" } },
    { key: "extra", label: "Extra", includedByDefault: false, control: { state: "omittable", form: { fields: [] }, forces: [] } },
  ],
};
const other: RunStartWorkflow = { ...plain, workflowId: "other", steps: plain.steps.slice(2) };
const workStudy: RunStartWorkflow = { ...plain, workflowId: "work-study",
  inputRun: { state: "present", surface: { placeholder: "Employee ID", parser: plain.inputRun.state === "present" ? plain.inputRun.surface.parser : (() => { throw new Error("fixture"); })(), typedInput: WORK_STUDY_TYPED_INPUT } } };
const onboardingSurface = DESCRIPTORS.find(workflow => workflow.id === "onboarding")?.surfaces.inputRun;
assert.ok(onboardingSurface?.typedInput);
const modal: RunStartWorkflow = { ...plain, workflowId: "onboarding", inputRun: { state: "present", surface: onboardingSurface },
  steps: [{ key: "a", label: "A", includedByDefault: true, control: { state: "required", reason: "Required" } }] };

const snapshot = RerunValuesSnapshotSchema.parse({
  sourceInput: { state: "available", value: { eid: "10812345" } },
  source: { runId: "10000000-0000-4000-8000-000000000001", version: 3, workflow: "plain",
    descriptorVersion: 1, contractFingerprint: "a".repeat(64), outcome: "failed" },
  steps: [{ key: "read", state: "completed", nodes: [{ nodeId: "read", state: "completed", reason: "checkpoint" }] },
    { key: "write", state: "completed", nodes: [{ nodeId: "write", state: "completed", reason: "checkpoint" }] },
    { key: "finish", state: "failed", nodes: [{ nodeId: "finish", state: "failed", reason: "failure" }] }],
  values: [], transactions: [],
});

const AT = "2026-08-03T10:00:00.000Z";
const candidate = (field: string, value: unknown, target: Record<string, string> = { targetStepKey: "read", targetFieldPath: field }) => ({
  state: "available", sourceStepKey: "read", nodeId: "read", fieldPath: field, ...target, label: field, value,
  checkpoint: { attempt: 1, writtenAt: AT }, provenance: { path: field, source: "live", observedAt: AT, originalObservedAt: AT } });

const used = (draft: LaunchDraft): LaunchDraft => ({ ...draft, text: "x", sourceInputUnchanged: true, priority: "bulk", dryRunRequested: true, browserMode: "headless",
  stepDrafts: { read: { reason: "r" } }, touchedFacts: new Set(["read:reason"]), factsAttempted: true,
  referenceSelections: { ref: { libraryId: "l", versionId: "v", sheetId: "s" } }, referenceDrafts: { ref: { libraryId: "l", versionId: "v" } },
  selectedWorkbookRows: { source: "s", choices: [] }, launchFields: { fileToOnBase: "yes" },
  valueDrafts: { 0: { text: "t", copied: false } }, copiedOmissions: { 0: true } });

describe("the fresh draft", () => {
  it("starts empty with the resting options", () => {
    const draft = freshLaunchDraft(plain);
    assert.deepEqual({ ...draft, touchedFacts: [...draft.touchedFacts] }, {
      text: "", typed: { workflowId: "plain", draft: {} }, sourceInputUnchanged: false, stepSelection: undefined,
      stepDrafts: {}, touchedFacts: [], factsAttempted: false, priority: undefined, dryRunRequested: false, browserMode: "headed",
      referenceSelections: {}, referenceDrafts: {}, checkPicks: {}, selectedWorkbookRows: undefined, launchFields: {}, valueDrafts: {}, copiedOmissions: {},
    });
  });
  it("seeds a typed workflow's declared defaults and none without a workflow", () => {
    assert.equal(typedDraftOf(freshLaunchDraft(workStudy), "work-study").effectiveDate, "");
    assert.deepEqual(freshLaunchDraft(undefined).typed, { workflowId: "", draft: {} });
  });
  it("shows another workflow's typed draft as empty", () => {
    assert.deepEqual(typedDraftOf(freshLaunchDraft(workStudy), "plain"), {});
  });
});

describe("workflow change", () => {
  it("clears what belongs to the old workflow and keeps references and rerun values", () => {
    const next = changeWorkflow(used(freshLaunchDraft(plain)), other);
    assert.equal(next.text, "");
    assert.equal(next.sourceInputUnchanged, false);
    assert.deepEqual([next.priority, next.dryRunRequested, next.browserMode], [undefined, false, "headed"]);
    assert.deepEqual([next.stepDrafts, [...next.touchedFacts], next.factsAttempted, next.referenceSelections, next.selectedWorkbookRows, next.launchFields, next.stepSelection],
      [{}, [], false, {}, undefined, {}, undefined]);
    assert.deepEqual(next.referenceDrafts, { ref: { libraryId: "l", versionId: "v" } });
    assert.deepEqual([next.valueDrafts, next.copiedOmissions], [{ 0: { text: "t", copied: false } }, { 0: true }]);
    assert.equal(next.typed.workflowId, "other");
  });
});

describe("step selection", () => {
  it("falls back to the workflow's default steps", () => {
    assert.deepEqual(selectedStepKeys(freshLaunchDraft(plain), plain), ["read", "write", "finish"]);
  });
  it("applies the shared cascade and orders by the timeline", () => {
    const off = toggleStep(freshLaunchDraft(plain), plain, "read", false);
    assert.deepEqual(selectedStepKeys(off, plain), ["finish"]);
    assert.deepEqual(selectedStepKeys(toggleStep(off, plain, "read", true), plain), ["read", "write", "finish"]);
  });
  it("refuses a step the workflow does not declare", () => {
    assert.throws(() => toggleStep(freshLaunchDraft(plain), plain, "nope", true), /does not declare/u);
  });
  it("shows a selection made for another workflow as that workflow's defaults", () => {
    const made = toggleStep(freshLaunchDraft(plain), plain, "read", false);
    assert.deepEqual(selectedStepKeys(made, other), ["finish"]);
    assert.deepEqual(selectedStepKeys({ ...made, stepSelection: { workflowId: "plain", keys: ["x"] } }, other), ["finish"]);
  });
  it("entering customization resets the keys and keeps the facts", () => {
    const next = enterCustomization(used(toggleStep(freshLaunchDraft(plain), plain, "read", false)), plain);
    assert.deepEqual(selectedStepKeys(next, plain), ["read", "write", "finish"]);
    assert.deepEqual(next.stepDrafts, { read: { reason: "r" } });
    assert.equal(next.factsAttempted, true);
  });
  it("leaving customization also clears the facts so unchosen assertions cannot survive", () => {
    const next = leaveCustomization(used(freshLaunchDraft(plain)), plain);
    assert.deepEqual([next.stepDrafts, [...next.touchedFacts], next.factsAttempted], [{}, [], false]);
    assert.deepEqual(selectedStepKeys(next, plain), ["read", "write", "finish"]);
  });
});

describe("omission facts", () => {
  it("seeds the form's resting draft, then sets the field", () => {
    const next = changeFact(freshLaunchDraft(plain), snapshot, "read", OMIT_FORM, "reason", "because");
    assert.deepEqual(next.stepDrafts, { read: { reason: "because", confirmed: false } });
  });
  it("drops the copied marker of the candidate that targeted that field", () => {
    const withCandidate = RerunValuesSnapshotSchema.parse({ ...snapshot, values: [
      candidate("reason", "old"),
      candidate("confirmed", true)] });
    const base = { ...freshLaunchDraft(plain), copiedOmissions: { 0: true, 1: true } };
    assert.deepEqual(changeFact(base, withCandidate, "read", OMIT_FORM, "reason", "new").copiedOmissions, { 1: true });
    assert.deepEqual(changeFact(base, null, "read", OMIT_FORM, "reason", "new").copiedOmissions, { 0: true, 1: true });
  });
  it("copies an available candidate into its field and marks it copied", () => {
    const withCandidate = RerunValuesSnapshotSchema.parse({ ...snapshot, values: [
      candidate("reason", "old")] });
    const next = copyOmittedValue(freshLaunchDraft(plain), withCandidate, 0, "read", OMIT_FORM);
    assert.deepEqual(next.stepDrafts, { read: { reason: "old", confirmed: false } });
    assert.deepEqual(next.copiedOmissions, { 0: true });
  });
  it("refuses to copy a candidate the form has no field for", () => {
    const withCandidate = RerunValuesSnapshotSchema.parse({ ...snapshot, values: [
      candidate("gone", "old")] });
    assert.throws(() => copyOmittedValue(freshLaunchDraft(plain), withCandidate, 0, "read", OMIT_FORM), /RERUN_OMISSION_FIELD_UNAVAILABLE/u);
    assert.throws(() => copyOmittedValue(freshLaunchDraft(plain), snapshot, 0, "read", OMIT_FORM), /RERUN_OMISSION_FIELD_UNAVAILABLE/u);
  });
  it("records touched fields once and an attempt", () => {
    const touched = touchFact(touchFact(freshLaunchDraft(plain), "read", "reason"), "read", "reason");
    assert.deepEqual([...touched.touchedFacts], ["read:reason"]);
    assert.equal(touchFact(touched, "read", "reason"), touched);
    assert.equal(attemptFacts(touched).factsAttempted, true);
  });
});

describe("input", () => {
  it("typing text marks the source input as edited", () => {
    const next = changeText({ ...freshLaunchDraft(plain), sourceInputUnchanged: true }, "10812345");
    assert.deepEqual([next.text, next.sourceInputUnchanged], ["10812345", false]);
  });
  it("a typed value changes the draft and re-derives the selectable steps from it", () => {
    const next = changeTypedValue(freshLaunchDraft(workStudy), workStudy, "effectiveDate", "08/03/2026");
    assert.equal(typedDraftOf(next, "work-study").effectiveDate, "08/03/2026");
    assert.equal(next.typed.workflowId, "work-study");
    assert.deepEqual(selectedStepKeys(next, workStudy), ["read", "write", "finish"]);
  });
  it("changing the mode field marks the source input as edited; another field keeps it", () => {
    const modeField = onboardingSurface?.typedInput?.modeField ?? "";
    const start = { ...freshLaunchDraft(modal), sourceInputUnchanged: true };
    assert.equal(changeTypedValue(start, modal, modeField, "rehire").sourceInputUnchanged, false);
    assert.equal(changeTypedValue(start, modal, "email", "a@example.test").sourceInputUnchanged, true);
  });
  it("a workflow without a typed declaration ignores typed values", () => {
    const start = freshLaunchDraft(plain);
    assert.equal(changeTypedValue(start, plain, "x", "y"), start);
  });
  it("holds a declared launch field by its key, with no default", () => {
    const start = freshLaunchDraft(plain);
    assert.equal(start.launchFields.fileToOnBase, undefined);
    assert.deepEqual(setLaunchField(start, "fileToOnBase", "yes").launchFields, { fileToOnBase: "yes" });
    assert.deepEqual(setLaunchField(setLaunchField(start, "fileToOnBase", "yes"), "fileToOnBase", "no").launchFields, { fileToOnBase: "no" });
  });
  it("sets the options", () => {
    assert.equal(changeDryRun(freshLaunchDraft(plain), true).dryRunRequested, true);
  });
});

describe("reference spreadsheet", () => {
  const sheet = { libraryId: "l", versionId: "v", sheetId: "s" };
  it("a library pick sets the draft and clears the worksheet selection", () => {
    const next = pickReference({ ...freshLaunchDraft(plain), referenceSelections: { ref: sheet, keep: sheet } }, "ref", "l2", "v2");
    assert.deepEqual(next.referenceDrafts, { ref: { libraryId: "l2", versionId: "v2" } });
    assert.deepEqual(next.referenceSelections, { keep: sheet });
  });
  it("a version pick needs a library pick first", () => {
    const start = freshLaunchDraft(plain);
    assert.equal(pickReferenceVersion(start, "ref", "v3"), start);
    const picked = pickReference(start, "ref", "l", undefined);
    assert.deepEqual(pickReferenceVersion({ ...picked, referenceSelections: { ref: sheet } }, "ref", "v3").referenceDrafts, { ref: { libraryId: "l", versionId: "v3" } });
    assert.deepEqual(pickReferenceVersion({ ...picked, referenceSelections: { ref: sheet } }, "ref", "v3").referenceSelections, {});
  });
  it("a worksheet pick records the sheet", () => {
    assert.deepEqual(pickWorksheet(freshLaunchDraft(plain), "ref", sheet).referenceSelections, { ref: sheet });
  });
  it("removing drops the draft and the selection of that reference only", () => {
    const start = { ...freshLaunchDraft(plain), referenceDrafts: { ref: { libraryId: "l" }, keep: { libraryId: "k" } }, referenceSelections: { ref: sheet, keep: sheet } };
    const next = removeReference(start, "ref");
    assert.deepEqual([next.referenceDrafts, next.referenceSelections], [{ keep: { libraryId: "k" } }, { keep: sheet }]);
  });
  it("selects and clears saved rows for a source", () => {
    const next = selectWorkbookRows(freshLaunchDraft(plain), "source-1", []);
    assert.deepEqual(next.selectedWorkbookRows, { source: "source-1", choices: [] });
    assert.equal(clearWorkbookRows(next).selectedWorkbookRows, undefined);
  });
});

describe("rerun restore", () => {
  it("restores the plain identity text, current-step defaults and no value drafts", () => {
    const partial = RerunValuesSnapshotSchema.parse({ ...snapshot, sourceInput: { state: "partial", value: { eid: "10812345" }, identityCopied: true } });
    const ran = { ...plain, steps: plain.steps.slice(0, 3) };
    const next = restoreRerunDraft(used(freshLaunchDraft(ran)), partial, ran);
    assert.equal(next.text, "10812345");
    assert.deepEqual(selectedStepKeys(next, ran), ["finish"]);
    assert.deepEqual(next.valueDrafts, {});
  });
  it("seeds copied values for the declared input fields", () => {
    const withValue = RerunValuesSnapshotSchema.parse({ ...snapshot, values: [
      candidate("eid", "10812345", { targetFieldPath: "eid" })] });
    assert.deepEqual(restoreRerunDraft(freshLaunchDraft(plain), withValue, plain).valueDrafts, { 0: { text: "10812345", copied: true } });
  });
  it("restores Work Study's date as MM/DD/YYYY in the typed draft", () => {
    const partial = RerunValuesSnapshotSchema.parse({ ...snapshot, source: { ...snapshot.source, workflow: "work-study" },
      sourceInput: { state: "partial", value: { emplId: "10000001", effectiveDate: "2026-08-03" }, identityCopied: true } });
    const next = restoreRerunDraft(freshLaunchDraft(undefined), partial, workStudy);
    assert.equal(typedDraftOf(next, "work-study").effectiveDate, "08/03/2026");
    assert.equal(next.text, "10000001");
    assert.equal(next.sourceInputUnchanged, true);
    assert.deepEqual(next.valueDrafts, {});
  });
  it("refuses protected typed source input", () => {
    const protectedInput = RerunValuesSnapshotSchema.parse({ ...snapshot, source: { ...snapshot.source, workflow: "work-study" }, sourceInput: { state: "unavailable", reason: "protected" } });
    assert.throws(() => restoreRerunDraft(freshLaunchDraft(undefined), protectedInput, workStudy), /source input is protected/u);
  });
  it("starts from the given text with every step selected for a failed plain-input rerun", () => {
    const next = restoreRerunDraft(freshLaunchDraft(plain), snapshot, plain, "10812345");
    assert.equal(next.text, "10812345");
    assert.deepEqual(selectedStepKeys(next, plain), ["read", "write", "finish", "extra"]);
    assert.deepEqual(next.valueDrafts, {});
  });
  it("refuses given text for a typed workflow or a source that ran something", () => {
    assert.throws(() => restoreRerunDraft(freshLaunchDraft(workStudy), snapshot, workStudy, "10812345"));
    const ran = RerunValuesSnapshotSchema.parse({ ...snapshot, source: { ...snapshot.source, outcome: "done" } });
    assert.throws(() => restoreRerunDraft(freshLaunchDraft(plain), ran, plain, "10812345"));
  });
});
