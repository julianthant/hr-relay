import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { DESCRIPTORS } from "../../../../src/backend/app/registries/workflow-registry.js";
import type { RunStartWorkflow } from "../../../../src/dashboard/surfaces/run-start/run-start.js";
import {
  changeDryRun, changeFact, changeText, changeTypedValue, changeWorkflow, clearWorkbookRows, copyOmittedValue,
  enterCustomization, freshLaunchDraft, launchRequestFingerprint, leaveCustomization, namedSpreadsheets, pickReference, pickReferenceVersion, pickWorksheet, removeReference,
  restoreRerunDraft, selectWorkbookRows, selectedStepKeys, setLaunchField, toggleManual, toggleRow, typedDraftOf, type LaunchDraft, type LaunchRequestInputs,
} from "../../../../src/dashboard/surfaces/run-start/run-launch-draft-model.js";
import { initialRunDialogState, visibleRunDialog, type RunDialogState } from "../../../../src/dashboard/surfaces/run-start/run-dialog-model.js";
import { sourceBadge, startRowsOf, type StepRow } from "../../../../src/dashboard/surfaces/run-start/run-steps-model.js";
import { RerunValuesRequestSchema, RerunValuesSnapshotSchema } from "../../../../src/models/dashboard/rerun-values.js";
import { WORK_STUDY_TYPED_INPUT } from "../../../../src/models/workflows/work-study/input.js";

const OMIT_FORM = { fields: [{ key: "reason", label: "Reason", kind: "text" }, { key: "confirmed", label: "Confirmed", kind: "boolean" }] } as unknown as Extract<RunStartWorkflow["steps"][number]["control"], { state: "omittable" }>["form"];
const plain: RunStartWorkflow = {
  workflowId: "plain", version: 1, label: "Plain", categoryId: "operations", role: { kind: "standalone" }, icon: "Search",
  enqueue: "reject-active", spreadsheetIntake: false, requiredWorkbookFields: [],
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
    descriptorVersion: 1, contractFingerprint: "a".repeat(64), outcome: "failed", dryRun: false, priority: "interactive", browserMode: "headed" },
  steps: [{ key: "read", state: "completed", nodes: [{ nodeId: "read", state: "completed", reason: "checkpoint" }] },
    { key: "write", state: "completed", nodes: [{ nodeId: "write", state: "completed", reason: "checkpoint" }] },
    { key: "finish", state: "failed", nodes: [{ nodeId: "finish", state: "failed", reason: "failure" }] }],
  values: [], transactions: [],
});

const AT = "2026-08-03T10:00:00.000Z";
const candidate = (field: string, value: unknown, target: Record<string, string> = { targetStepKey: "read", targetFieldPath: field }) => ({
  state: "available", sourceStepKey: "read", nodeId: "read", fieldPath: field, ...target, label: field, value,
  checkpoint: { attempt: 1, writtenAt: AT }, provenance: { path: field, source: "live", observedAt: AT, originalObservedAt: AT } });

const row = (key: string): StepRow => {
  const found = startRowsOf(plain).find(entry => entry.key === key);
  assert.ok(found);
  return found;
};
const used = (draft: LaunchDraft): LaunchDraft => ({ ...draft, text: "x", sourceInputUnchanged: true, priority: "bulk", dryRunRequested: true, browserMode: "headless",
  stepDrafts: { read: { reason: "r" } }, manualRows: ["kid"],
  referenceSelections: { ref: { libraryId: "l", versionId: "v", sheetIds: ["s"] } }, referenceDrafts: { ref: { libraryId: "l", versionId: "v" } },
  selectedWorkbookRows: { source: "s", choices: [] }, launchFields: { fileToOnBase: "yes" },
  valueDrafts: { 0: { text: "t", copied: false } }, copiedOmissions: { 0: true } });

describe("the launch request fingerprint", () => {
  const REST: LaunchRequestInputs = { draft: freshLaunchDraft(plain), rowIdentity: "row", customizeSteps: false, typedValues: {}, rerunSource: undefined,
    pdf: { draft: null, picks: {}, loading: false, error: null }, workbookRows: { state: "ready", fresh: true }, library: { loading: false, refreshing: false, error: "", compatibility: undefined },
    spreadsheets: [], versionSources: { state: "ready", sources: [] }, checks: { pending: false, selections: [] }, request: "request" };
  const sheet = { libraryId: "l", versionId: "v", sheetIds: ["s"] };
  const source = { libraryId: "l", versionId: "v", sheetId: "s" };
  /** One change per draft field and per input; a field added without one fails to typecheck here. */
  const DRAFT = {
    text: "x", typed: { workflowId: "plain", draft: { mode: "match" } }, sourceInputUnchanged: true, interruptedRerun: true,
    stepSelection: { workflowId: "plain", keys: ["read"] },
    stepDrafts: { read: { reason: "r" } }, manualRows: ["kid"], priority: "bulk", dryRunRequested: true, browserMode: "headless",
    referenceSelections: { ref: sheet }, referenceDrafts: { ref: { libraryId: "l" } }, checkPicks: { l: { versionId: "v", sheetIds: ["s"] } },
    selectedWorkbookRows: { source: "s", choices: [] }, launchFields: { fileToOnBase: "yes" }, valueDrafts: { 0: { text: "t", copied: false } }, copiedOmissions: { 0: true },
  } satisfies Required<LaunchDraft>;
  const INPUTS = {
    draft: Object.entries(DRAFT).map(([key, value]) => ({ ...REST.draft, [key]: value })),
    rowIdentity: ["other"], customizeSteps: [true], typedValues: [{ mode: "match" }], rerunSource: [RerunValuesRequestSchema.parse({ runId: "10000000-0000-4000-8000-000000000001", expectedVersion: 3 })],
    pdf: [{ ...REST.pdf, draft: { files: [], asOf: AT, reviewer: "r" } }, { ...REST.pdf, picks: { form: "w4" } }, { ...REST.pdf, loading: true }, { ...REST.pdf, error: "refused" }],
    workbookRows: [{ state: "loading", fresh: true }, { state: "ready", fresh: false }],
    library: [{ ...REST.library, loading: true }, { ...REST.library, refreshing: true }, { ...REST.library, error: "failed" }, { ...REST.library, compatibility: { libraries: [] } }],
    spreadsheets: [[["l", 1, 1]], [["l", 2, 1]], [["l", 1, 2]]], versionSources: [{ state: "loading", sources: [] }, { state: "ready", sources: [source] }],
    checks: [{ pending: true, selections: [] }, { pending: false, selections: [source] }], request: ["other"],
  } satisfies { [K in keyof LaunchRequestInputs]: readonly LaunchRequestInputs[K][] };

  it("moves for every draft field and every other input, and a moved one drops the plan on screen", () => {
    assert.deepEqual(Object.keys(DRAFT).sort(), Object.keys(freshLaunchDraft(plain)).sort(), "every draft field has a change");
    assert.deepEqual(Object.keys(INPUTS).sort(), Object.keys(REST).sort(), "every input has a change");
    const rest = launchRequestFingerprint(REST);
    const shown = { for: rest, plan: {}, request: {}, expired: false } as unknown as NonNullable<RunDialogState["shown"]>;
    const state: RunDialogState = { ...initialRunDialogState, stage: "Start", shown };
    assert.equal(visibleRunDialog(state, launchRequestFingerprint({ ...REST, draft: { ...REST.draft } })).shown, shown, "an unchanged request keeps its plan");
    const seen = new Set([rest]);
    for (const [key, values] of Object.entries(INPUTS)) for (const value of values) {
      const moved = launchRequestFingerprint({ ...REST, [key]: value });
      assert.ok(!seen.has(moved), `${key}: ${JSON.stringify(value)} did not move the fingerprint`);
      seen.add(moved);
      assert.equal(visibleRunDialog(state, moved).shown, undefined, `${key} kept the plan`);
    }
  });

  it("names the spreadsheets of every pick: a worksheet, a half-made reference and a check", () => {
    const catalog = ["a", "b", "c", "d"].map((libraryId, index) => ({ libraryId, version: index, state: { revision: index + 10 } }));
    const draft = { ...freshLaunchDraft(plain), referenceSelections: { ref: { ...sheet, libraryId: "a" } }, referenceDrafts: { ref: { libraryId: "b" } }, checkPicks: { c: { versionId: "v", sheetIds: [] } } };
    assert.deepEqual(namedSpreadsheets(draft, catalog), [["a", 0, 10], ["b", 1, 11], ["c", 2, 12]]);
  });
});

describe("the fresh draft", () => {
  it("starts empty with the resting options", () => {
    assert.deepEqual(freshLaunchDraft(plain), {
      text: "", typed: { workflowId: "plain", draft: {} }, sourceInputUnchanged: false, interruptedRerun: undefined, stepSelection: undefined,
      stepDrafts: {}, manualRows: [], priority: undefined, dryRunRequested: false, browserMode: "headed",
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
    assert.deepEqual([next.stepDrafts, next.manualRows, next.referenceSelections, next.selectedWorkbookRows, next.launchFields, next.stepSelection],
      [{}, [], {}, undefined, {}, undefined]);
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
    const off = toggleRow(freshLaunchDraft(plain), plain, null, row("read"), false);
    assert.deepEqual(selectedStepKeys(off, plain), ["write", "finish"], "a step done by hand stays in until the operator turns it off");
    const both = toggleRow(off, plain, null, row("write"), false);
    assert.deepEqual(selectedStepKeys(both, plain), ["finish"]);
    assert.deepEqual(selectedStepKeys(toggleRow(both, plain, null, row("read"), true), plain), ["read", "finish"], "restoring the read keeps a step done by hand off");
  });
  it("refuses a step the workflow does not declare", () => {
    assert.throws(() => toggleRow(freshLaunchDraft(plain), plain, null, { ...row("read"), key: "nope", stepKey: "nope" }, false), /does not declare/u);
  });
  it("leaves a locked row alone", () => {
    const draft = freshLaunchDraft(plain);
    assert.equal(toggleRow(draft, plain, null, row("finish"), false), draft);
  });
  it("shows a selection made for another workflow as that workflow's defaults", () => {
    const made = toggleRow(freshLaunchDraft(plain), plain, null, row("read"), false);
    assert.deepEqual(selectedStepKeys(made, other), ["finish"]);
    assert.deepEqual(selectedStepKeys({ ...made, stepSelection: { workflowId: "plain", keys: ["x"] } }, other), ["finish"]);
  });
  it("entering customization resets the keys and keeps the facts", () => {
    const next = enterCustomization(used(toggleRow(freshLaunchDraft(plain), plain, null, row("read"), false)), plain);
    assert.deepEqual(selectedStepKeys(next, plain), ["read", "write", "finish"]);
    assert.deepEqual(next.stepDrafts, { read: { reason: "r" } });
  });
  it("leaving customization also clears the facts so unchosen assertions cannot survive", () => {
    const next = leaveCustomization(used(freshLaunchDraft(plain)), plain);
    assert.deepEqual([next.stepDrafts, next.manualRows], [{}, []]);
    assert.deepEqual(selectedStepKeys(next, plain), ["read", "write", "finish"]);
  });
});

describe("omission facts", () => {
  it("seeds the form's resting draft, then sets the field", () => {
    const next = changeFact(freshLaunchDraft(plain), snapshot, row("read"), OMIT_FORM, "reason", "because");
    assert.deepEqual(next.stepDrafts, { read: { reason: "because", confirmed: false } });
  });
  it("drops the copied marker of the candidate that targeted that field", () => {
    const withCandidate = RerunValuesSnapshotSchema.parse({ ...snapshot, values: [
      candidate("reason", "old"),
      candidate("confirmed", true)] });
    const base = { ...freshLaunchDraft(plain), copiedOmissions: { 0: true, 1: true } };
    assert.deepEqual(changeFact(base, withCandidate, row("read"), OMIT_FORM, "reason", "new").copiedOmissions, { 1: true });
    assert.deepEqual(changeFact(base, null, row("read"), OMIT_FORM, "reason", "new").copiedOmissions, { 0: true, 1: true });
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
  it("opens a switch's fields prefilled from the source run when it is turned off, and keeps them while the dialog is open", () => {
    const withCandidate = RerunValuesSnapshotSchema.parse({ ...snapshot, values: [candidate("reason", "old")] });
    const off = toggleRow(freshLaunchDraft(plain), plain, withCandidate, row("read"), false);
    assert.deepEqual(off.stepDrafts, { read: { reason: "old", confirmed: false } });
    assert.deepEqual(off.copiedOmissions, { 0: true });
    const edited = changeFact(off, withCandidate, row("read"), OMIT_FORM, "reason", "mine");
    const back = toggleRow(toggleRow(edited, plain, withCandidate, row("read"), true), plain, withCandidate, row("read"), false);
    assert.deepEqual(back.stepDrafts, { read: { reason: "mine", confirmed: false } });
    assert.deepEqual(back.copiedOmissions, {});
  });
  it("offers the facts the source run typed as typed, not as copied", () => {
    const typed = RerunValuesSnapshotSchema.parse({ ...snapshot, values: [candidate("reason", "old")], typed: [{ step: "read", facts: { reason: "hand", confirmed: true } }] });
    const off = toggleRow(freshLaunchDraft(plain), plain, typed, row("read"), false);
    assert.deepEqual(off.stepDrafts, { read: { reason: "hand", confirmed: true } });
    assert.deepEqual(off.copiedOmissions, {});
  });
  it("opens and closes a child row and a locked row through manualRows, and starts a child row empty", () => {
    const withChild: RunStartWorkflow = { ...plain, rows: [{ key: "kid", label: "Read child", kind: "switch", includedByDefault: true,
      members: [{ workflow: "kids", step: "read" }], target: { workflow: "kids", step: "read" }, manual: { form: OMIT_FORM, forces: [] } }] };
    const [kid] = startRowsOf(withChild);
    const open = toggleRow(freshLaunchDraft(withChild), withChild, snapshot, kid, false);
    assert.deepEqual([open.manualRows, open.stepDrafts], [["kid"], {}]);
    assert.deepEqual(toggleRow(open, withChild, snapshot, kid, true).manualRows, []);
    const locked: StepRow = { ...row("read"), kind: "locked-manual" };
    assert.deepEqual(toggleManual(freshLaunchDraft(plain), null, locked, true).manualRows, ["read"]);
    assert.deepEqual(toggleManual({ ...freshLaunchDraft(plain), manualRows: ["read"] }, null, locked, false).manualRows, []);
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
  const sheet = { libraryId: "l", versionId: "v", sheetIds: ["s"] };
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
  it("preselects unfinished work and lets the operator explicitly select a completed required write", () => {
    const ran = { ...plain, steps: plain.steps.slice(0, 3).map(step => ({ ...step,
      control: { state: "required" as const, reason: "Required" } })) };
    const interrupted = RerunValuesSnapshotSchema.parse({ ...snapshot, source: { ...snapshot.source, outcome: "interrupted" },
      retainedSteps: [{ key: "read", repeatable: true }, { key: "write", repeatable: true }] });
    const draft = restoreRerunDraft(interrupted, ran);
    assert.deepEqual(selectedStepKeys(draft, ran), ["finish"]);
    const write = startRowsOf(ran).find(row => row.key === "write"); assert.ok(write);
    assert.deepEqual(selectedStepKeys(toggleRow(draft, ran, interrupted, write, true), ran), ["write", "finish"]);
  });
  it("opens an interrupted typed-input rerun when its input is unavailable to the browser", () => {
    const interrupted = RerunValuesSnapshotSchema.parse({ ...snapshot,
      source: { ...snapshot.source, workflow: workStudy.workflowId, outcome: "interrupted" },
      sourceInput: { state: "unavailable", reason: "protected" },
      retainedSteps: [{ key: "read", repeatable: true }, { key: "write", repeatable: true }, { key: "extra", repeatable: true }],
    });
    const draft = restoreRerunDraft(interrupted, workStudy);
    assert.equal(draft.interruptedRerun, true);
    assert.equal(draft.text, "");
    assert.deepEqual(selectedStepKeys(draft, workStudy), ["finish"]);
  });
  it("restores the plain identity text with no value drafts and picks up from the failed step", () => {
    const partial = RerunValuesSnapshotSchema.parse({ ...snapshot, sourceInput: { state: "partial", value: { eid: "10812345" }, identityCopied: true } });
    const ran = { ...plain, steps: plain.steps.slice(0, 3) };
    const next = restoreRerunDraft(partial, ran);
    assert.equal(next.text, "10812345");
    assert.deepEqual(selectedStepKeys(next, ran), ["read", "finish"], "read stays on: nobody recorded the values to type for it");
    assert.deepEqual(next.valueDrafts, {});
  });
  const typedRead = { read: { reason: "Earlier", confirmed: true } };
  const withTyped = (extra: Record<string, unknown> = {}) => RerunValuesSnapshotSchema.parse({ ...snapshot,
    typed: Object.entries(typedRead).map(([step, facts]) => ({ step, facts })), ...extra });
  it("switches completed steps off with the values the source recorded", () => {
    const ran = { ...plain, steps: plain.steps.slice(0, 3) };
    const next = restoreRerunDraft(withTyped(), ran);
    assert.deepEqual(selectedStepKeys(next, ran), ["finish"]);
    assert.deepEqual(next.stepDrafts.read, { reason: "Earlier", confirmed: true });
  });
  it("starts every step again when the source finished with nothing failed", () => {
    const ran = { ...plain, steps: plain.steps.slice(0, 3) };
    const done = withTyped({ source: { ...snapshot.source, outcome: "done" }, steps: snapshot.steps.map(step => ({ ...step, state: "completed",
      nodes: step.nodes.map(node => ({ ...node, state: "completed", reason: "checkpoint" })) })) });
    assert.deepEqual(selectedStepKeys(restoreRerunDraft(done, ran), ran), ["read", "write", "finish"]);
  });
  const cancelled = (extra: Record<string, unknown> = {}) => withTyped({ source: { ...snapshot.source, outcome: "cancelled" },
    steps: [snapshot.steps[0], { key: "write", state: "unfinished", nodes: [{ nodeId: "write", state: "unfinished", reason: "incomplete-execution" }] },
      { key: "finish", state: "unfinished", nodes: [{ nodeId: "finish", state: "unfinished", reason: "not-recorded" }] }], ...extra });
  it("badges a step the cancelled source began as Cancelled and one it never reached as Not started", () => {
    assert.deepEqual(["read", "write", "finish"].map(key => sourceBadge(row(key), cancelled())), ["completed", "cancelled", "not-started"]);
  });
  it("picks a cancelled source up where it would if the begun step had not started", () => {
    const ran = { ...plain, steps: plain.steps.slice(0, 3) };
    const neverBegun = cancelled({ steps: cancelled().steps.map(step => ({ ...step, nodes: step.nodes.map(node => node.reason === "incomplete-execution" ? { ...node, reason: "not-recorded" } : node) })) });
    assert.equal(sourceBadge(row("write"), neverBegun), "not-started");
    assert.deepEqual(selectedStepKeys(restoreRerunDraft(cancelled(), ran), ran), selectedStepKeys(restoreRerunDraft(neverBegun, ran), ran));
  });
  it("picks steps from the evidence it read before a condition-skipped step badged Completed", () => {
    const ran = { ...plain, steps: plain.steps.slice(0, 3) };
    for (const outcome of ["interrupted", "cancelled"] as const) {
      const source = (write: Record<string, unknown>) => withTyped({ source: { ...snapshot.source, outcome },
        steps: [snapshot.steps[0], { key: "write", state: write.state, nodes: [{ nodeId: "write", ...write }] },
          { key: "finish", state: "unfinished", nodes: [{ nodeId: "finish", state: "unfinished", reason: "not-recorded" }] }] });
      const skipped = source({ state: "completed", reason: "condition-skipped" }), before = source({ state: "unfinished", reason: "incomplete-execution" });
      assert.equal(sourceBadge(row("write"), skipped), "completed");
      assert.deepEqual(selectedStepKeys(restoreRerunDraft(skipped, ran), ran), selectedStepKeys(restoreRerunDraft(before, ran), ran), outcome);
    }
  });
  it("keeps the source's mode, priority, browser and spreadsheets, and nothing of the draft before it", () => {
    const reading: RunStartWorkflow = { ...plain, workbookReference: { id: "roster", keyFieldId: "eid", mode: "keys", writableFields: [] }, workbookCheck: { id: "check", keyFieldId: "eid" } };
    const pick = (typeId: string, libraryId: string, sheetId: string) => ({ typeId, libraryId, versionId: "v1", sheetId });
    const source = RerunValuesSnapshotSchema.parse({ ...snapshot, source: { ...snapshot.source, dryRun: true, priority: "bulk", browserMode: "headless" },
      spreadsheets: [pick("roster", "people", "a"), pick("check", "extra", "b"), pick("check", "extra", "c")] });
    const next = restoreRerunDraft(source, reading);
    assert.deepEqual([next.dryRunRequested, next.priority, next.browserMode], [true, "bulk", "headless"]);
    assert.deepEqual(next.referenceSelections, { roster: { libraryId: "people", versionId: "v1", sheetIds: ["a"] } });
    assert.deepEqual(next.referenceDrafts, { roster: { libraryId: "people", versionId: "v1" } });
    assert.deepEqual(next.checkPicks, { extra: { versionId: "v1", sheetIds: ["b", "c"] } });
    const live = restoreRerunDraft(snapshot, reading);
    assert.deepEqual([live.dryRunRequested, live.referenceSelections, live.checkPicks], [false, {}, {}]);
  });
  it("picks a source's several reference worksheets again only where the workflow reads them all", () => {
    const reading = (writableFields: string[]): RunStartWorkflow => ({ ...plain, workbookReference: { id: "onboarding-roster", keyFieldId: "email", mode: "keys", writableFields } });
    const pick = (sheetId: string) => ({ typeId: "onboarding-roster", libraryId: "people", versionId: "v1", sheetId });
    const source = RerunValuesSnapshotSchema.parse({ ...snapshot, spreadsheets: [pick("a"), pick("b")] });
    assert.deepEqual(restoreRerunDraft(source, reading([])).referenceSelections, { "onboarding-roster": { libraryId: "people", versionId: "v1", sheetIds: ["a", "b"] } });
    assert.deepEqual(restoreRerunDraft(source, reading(["roster.notes"])).referenceSelections, {});
  });
  it("refuses a source whose browser mode nobody recorded instead of taking the last draft's", () => {
    const { browserMode: _browserMode, ...source } = snapshot.source;
    const older = RerunValuesSnapshotSchema.parse({ ...snapshot, source });
    assert.throws(() => restoreRerunDraft(older, plain), /The original browser mode is unknown; use Start run\./u);
  });
  it("seeds copied values for the declared input fields", () => {
    const withValue = RerunValuesSnapshotSchema.parse({ ...snapshot, values: [
      candidate("eid", "10812345", { targetFieldPath: "eid" })] });
    assert.deepEqual(restoreRerunDraft(withValue, plain).valueDrafts, { 0: { text: "10812345", copied: true } });
  });
  it("restores Work Study's date as MM/DD/YYYY in the typed draft", () => {
    const partial = RerunValuesSnapshotSchema.parse({ ...snapshot, source: { ...snapshot.source, workflow: "work-study" },
      sourceInput: { state: "partial", value: { emplId: "10000001", effectiveDate: "2026-08-03" }, identityCopied: true } });
    const next = restoreRerunDraft(partial, workStudy);
    assert.equal(typedDraftOf(next, "work-study").effectiveDate, "08/03/2026");
    assert.equal(next.text, "10000001");
    assert.equal(next.sourceInputUnchanged, true);
    assert.deepEqual(next.valueDrafts, {});
  });
  it("refuses protected typed source input", () => {
    const protectedInput = RerunValuesSnapshotSchema.parse({ ...snapshot, source: { ...snapshot.source, workflow: "work-study" }, sourceInput: { state: "unavailable", reason: "protected" } });
    assert.throws(() => restoreRerunDraft(protectedInput, workStudy), /The original input can't be reused; use Start run\./u);
  });
  it("starts from the given text with every step selected for a failed plain-input rerun", () => {
    const next = restoreRerunDraft(snapshot, plain, "10812345");
    assert.equal(next.text, "10812345");
    assert.deepEqual(selectedStepKeys(next, plain), ["read", "write", "finish", "extra"]);
    assert.deepEqual(next.valueDrafts, {});
  });
  it("refuses given text for a typed workflow or a source that ran something", () => {
    assert.throws(() => restoreRerunDraft(snapshot, workStudy, "10812345"));
    const ran = RerunValuesSnapshotSchema.parse({ ...snapshot, source: { ...snapshot.source, outcome: "done" } });
    assert.throws(() => restoreRerunDraft(ran, plain, "10812345"));
  });
});
