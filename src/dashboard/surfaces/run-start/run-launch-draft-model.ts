import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import type { RerunValuesSnapshot } from "../../../models/dashboard/rerun-values.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../models/failures/error-catalog.js";
import type { StepOmissionForm } from "../../../models/workflow/step-omission.js";
import type { TypedInputDraft } from "../../../models/workflow/ingress.js";
import type { RunStartWorkflow } from "./run-start.js";
import {
  defaultRerunSteps, initialRerunValueDrafts, partialRerunTypedInput, plainRerunInputText, rerunsInOneClick, type RerunValueDraft,
} from "./run-start-rerun-model.js";
import {
  changeTypedInput, foldStepOmissionFacts, initialStepOmissionDraft, restoreTypedInput, stoppedStepOmissions, toggleStepSelection, typedControlAvailable, typedInputDefaults, typedInputText, typedDateControls, usDateText,
  type BrowserMode, type StartPriority, type StepOmissionDraft, type StepOmissionFactDraft,
} from "./run-start-model.js";
import type { RerunLaunchSource } from "./run-launch-model.js";
import type { PdfRunDraft, PdfRunPicks } from "./run-start-pdfs.js";
import type { WorkbookRowChoice } from "./run-workbook-rows-model.js";
import { childStepViews, factDraft, includedRowCount, rowFieldsOpen, rowIncluded, preselectionBadge, retainedRowSteps, sourceTypedFacts, startRowsOf, type ManualRows, type StepRow } from "./run-steps-model.js";

/** `sheetIds` holds at least one worksheet; more than one only where the workflow reads them all. */
export type ReferenceSelection = Readonly<{ libraryId: string; versionId: string; sheetIds: readonly string[] }>;
type WorksheetSource = Readonly<{ libraryId: string; versionId: string; sheetId: string }>;
export type CheckPick = Readonly<{ versionId: string; sheetIds: readonly string[] }>;
export type ReferenceDraft = Readonly<{ libraryId: string; versionId?: string }>;

/** Everything the operator has entered into the Run and Rerun dialog. The PDF files stay with their upload hook. */
export type LaunchDraft = Readonly<{
  text: string;
  /** A typed draft belongs to the workflow that made it. */
  typed: Readonly<{ workflowId: string; draft: TypedInputDraft }>;
  sourceInputUnchanged: boolean;
  interruptedRerun?: true;
  /** A step selection belongs to the workflow that made it; another workflow shows its own defaults. */
  stepSelection?: Readonly<{ workflowId: string; keys: readonly string[] }>;
  /** Typed fields by row key. */
  stepDrafts: Readonly<Record<string, StepOmissionDraft>>;
  /** Rows whose typed fields are open without a step switch: a locked row's Enter manually, a child row switched off. */
  manualRows: ManualRows;
  /** Undefined until the operator picks; `effectivePriority` supplies the default. */
  priority: StartPriority | undefined;
  dryRunRequested: boolean;
  browserMode: BrowserMode;
  referenceSelections: Readonly<Record<string, ReferenceSelection>>;
  referenceDrafts: Readonly<Record<string, ReferenceDraft>>;
  /** The optional check's picked spreadsheets: library id to the named version and the worksheets chosen in it. */
  checkPicks: Readonly<Record<string, CheckPick>>;
  selectedWorkbookRows?: Readonly<{ source: string; choices: readonly WorkbookRowChoice[] }>;
  /** Declared launch fields by key; a field is absent until the operator picks it. */
  launchFields: Readonly<Record<string, string>>;
  valueDrafts: Readonly<Record<number, RerunValueDraft>>;
  copiedOmissions: Readonly<Record<number, boolean>>;
}>;

const NO_TYPED_DRAFT: TypedInputDraft = {};
const typedDeclarationOf = (workflow: RunStartWorkflow | undefined) =>
  workflow?.inputRun.state === "present" ? workflow.inputRun.surface.typedInput : undefined;
/** A required date starts on the dashboard day; clearing it still refuses. A declaration with no initial mode starts on its first mode. */
const typedDefaultsOf = (workflow: RunStartWorkflow | undefined, today: string | undefined): TypedInputDraft => {
  const declaration = typedDeclarationOf(workflow);
  if (declaration === undefined) return {};
  const defaults = typedInputDefaults(declaration, declaration.initialMode ?? declaration.modes[0]?.value ?? null);
  const day = today === undefined ? undefined : usDateText(today);
  return day === undefined ? defaults : { ...defaults, ...Object.fromEntries(typedDateControls(declaration, String(defaults[declaration.modeField] ?? declaration.initialMode)).filter(control => control.required).map(control => [control.field, day])) };
};
const defaultStepKeys = (workflow: RunStartWorkflow | undefined): string[] =>
  workflow?.steps.filter(({ includedByDefault }) => includedByDefault).map(({ key }) => key) ?? [];
const omit = <T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> =>
  Object.fromEntries(Object.entries(record).filter(([entry]) => entry !== key));
const withSteps = (draft: LaunchDraft, workflowId: string, keys: readonly string[]): LaunchDraft => ({ ...draft, stepSelection: { workflowId, keys } });

/** Every input the plan request is built from or refused by. A new one must be added here to reach the request. */
export type LaunchRequestInputs = Readonly<{
  /** The whole draft, so a new draft field shapes the request without being named. */
  draft: LaunchDraft;
  rowIdentity: string;
  customizeSteps: boolean;
  typedValues: TypedInputDraft;
  rerunSource: RerunLaunchSource | undefined;
  pdf: Readonly<{ draft: PdfRunDraft | null; picks: PdfRunPicks; loading: boolean; error: string | null }>;
  workbookRows: Readonly<{ state: string; fresh: boolean }>;
  library: Readonly<{ loading: boolean; refreshing: boolean; error: string | null; compatibility: unknown }>;
  spreadsheets: ReturnType<typeof namedSpreadsheets>;
  versionSources: Readonly<{ state: string; sources: readonly WorksheetSource[] }>;
  checks: Readonly<{ pending: boolean; selections: readonly WorksheetSource[] }>;
  /** `startRequestFingerprint`: the request controls as the dialog resolves them. */
  request: string;
}>;

/** The library facts of every spreadsheet the draft names, picked or half picked. */
export function namedSpreadsheets(draft: LaunchDraft, catalog: readonly Readonly<{ libraryId: string; version: number; state: Readonly<{ revision: number }> }>[]) {
  const named = new Set([...[draft.referenceSelections, draft.referenceDrafts].flatMap(picks => Object.values(picks).map(pick => pick.libraryId)), ...Object.keys(draft.checkPicks)]);
  return catalog.filter(entry => named.has(entry.libraryId)).map(entry => [entry.libraryId, entry.version, entry.state.revision] as const);
}

/** A plan is good for one fingerprint: a change to any input drops it. */
export function launchRequestFingerprint(inputs: LaunchRequestInputs): string {
  // JSON drops the draft's undefined fields, which the canonical form refuses.
  return canonicalJsonStringify(JSON.parse(JSON.stringify(inputs)));
}

export function freshLaunchDraft(workflow: RunStartWorkflow | undefined, today?: string): LaunchDraft {
  return {
    text: "", typed: { workflowId: workflow?.workflowId ?? "", draft: typedDefaultsOf(workflow, today) }, sourceInputUnchanged: false,
    interruptedRerun: undefined, stepSelection: undefined, stepDrafts: {}, manualRows: [],
    priority: undefined, dryRunRequested: false, browserMode: "headed",
    referenceSelections: {}, referenceDrafts: {}, checkPicks: {}, selectedWorkbookRows: undefined, launchFields: {},
    valueDrafts: {}, copiedOmissions: {},
  };
}

/** A routed workflow the draft was not made for (a restored route, a late catalog) shows the workflow's own defaults, not an empty draft. */
export function typedDraftOf(draft: LaunchDraft, workflowId: string, workflow?: RunStartWorkflow, today?: string): TypedInputDraft {
  if (draft.typed.workflowId === workflowId) return draft.typed.draft;
  return workflow?.workflowId === workflowId ? typedDefaultsOf(workflow, today) : NO_TYPED_DRAFT;
}

export function selectedStepKeys(draft: LaunchDraft, workflow: RunStartWorkflow | undefined): readonly string[] {
  return draft.stepSelection !== undefined && draft.stepSelection.workflowId === workflow?.workflowId
    ? draft.stepSelection.keys : defaultStepKeys(workflow);
}

/** Another workflow cannot reuse the old one's input, steps, facts or options; reference picks and rerun values stay. */
export function changeWorkflow(draft: LaunchDraft, workflow: RunStartWorkflow | undefined, today?: string): LaunchDraft {
  return { ...freshLaunchDraft(workflow, today), referenceDrafts: draft.referenceDrafts, valueDrafts: draft.valueDrafts, copiedOmissions: draft.copiedOmissions };
}

export function changeText(draft: LaunchDraft, text: string): LaunchDraft {
  return { ...draft, text, sourceInputUnchanged: false };
}

export function changeTypedValue(draft: LaunchDraft, workflow: RunStartWorkflow, field: string, value: string | boolean): LaunchDraft {
  const declaration = typedDeclarationOf(workflow);
  if (declaration === undefined) return draft;
  const values = typedDraftOf(draft, workflow.workflowId, workflow);
  const next = changeTypedInput(declaration, values, field, value);
  const current = selectedStepKeys(draft, workflow);
  const keys = workflow.steps.filter(step => step.control.state !== "selectable"
    ? current.includes(step.key) : next[step.control.inputField] === true).map(step => step.key);
  return withSteps({ ...draft, typed: { workflowId: workflow.workflowId, draft: next },
    sourceInputUnchanged: field === declaration.modeField ? false : draft.sourceInputUnchanged }, workflow.workflowId, keys);
}

/** Offer the source run's values in a row that just opened: what it typed, else what its step produced. Typed text is kept. */
function prefillRow(draft: LaunchDraft, snapshot: RerunValuesSnapshot | null, row: StepRow): LaunchDraft {
  const form = row.form;
  if (snapshot === null || form === undefined || draft.stepDrafts[row.key] !== undefined) return draft;
  const typed = sourceTypedFacts(row, snapshot);
  if (typed !== undefined) {
    const values = Object.fromEntries(form.fields.flatMap(field => field.key in typed ? [[field.key, factDraft(field, typed[field.key])]] : []));
    return { ...draft, stepDrafts: { ...draft.stepDrafts, [row.key]: { ...initialStepOmissionDraft(form), ...values } } };
  }
  let next = draft;
  snapshot.values.forEach((candidate, index) => {
    if (candidate.state === "available" && row.stepKey !== undefined && candidate.targetStepKey === row.stepKey
      && form.fields.some(field => field.key === candidate.targetFieldPath)) next = copyOmittedValue(next, snapshot, index, row.key, form);
  });
  return next;
}

/** A switch row on or off. Off opens its typed fields; on closes them and keeps what was typed. */
export function toggleRow(draft: LaunchDraft, workflow: RunStartWorkflow, snapshot: RerunValuesSnapshot | null, row: StepRow, next: boolean): LaunchDraft {
  if (snapshot?.retainedSteps !== undefined) {
    const retained = retainedRowSteps(row, snapshot);
    if (!retained.length || retained.some(step => !step.repeatable)) return draft;
    const keys = new Set(selectedStepKeys(draft, workflow));
    for (const { key } of retained) if (next) keys.add(key); else keys.delete(key);
    return withSteps(draft, workflow.workflowId, workflow.steps.map(step => step.key).filter(key => keys.has(key)));
  }
  if (row.kind !== "switch") return draft;
  let changed: LaunchDraft;
  if (row.stepKey !== undefined) changed = withSteps(draft, workflow.workflowId, toggleStepSelection(workflow.steps, selectedStepKeys(draft, workflow), row.stepKey, next));
  else {
    const children = childStepViews(startRowsOf(workflow));
    const keys = children.map(({ key }) => key);
    const selected = toggleStepSelection(children, keys.filter(key => !draft.manualRows.includes(key)), row.key, next);
    changed = { ...draft, manualRows: [...draft.manualRows.filter(key => !keys.includes(key)), ...keys.filter(key => !selected.includes(key))] };
  }
  return next ? changed : prefillRow(changed, snapshot, row);
}

/** Enter manually on a locked row that offers it. */
export function toggleManual(draft: LaunchDraft, snapshot: RerunValuesSnapshot | null, row: StepRow, next: boolean): LaunchDraft {
  if (row.kind !== "locked-manual") return draft;
  const changed = { ...draft, manualRows: next ? [...new Set([...draft.manualRows, row.key])] : draft.manualRows.filter(key => key !== row.key) };
  return next ? prefillRow(changed, snapshot, row) : changed;
}

/** Every row starts as the workflow serves it; a change of steps keeps the rows closed. */
export function enterCustomization(draft: LaunchDraft, workflow: RunStartWorkflow | undefined): LaunchDraft {
  return workflow === undefined ? draft : withSteps(draft, workflow.workflowId, defaultStepKeys(workflow));
}

/** Leaving customization clears the facts so unchosen assertions cannot survive invisibly. */
export function leaveCustomization(draft: LaunchDraft, workflow: RunStartWorkflow | undefined): LaunchDraft {
  return { ...enterCustomization(draft, workflow), stepDrafts: {}, manualRows: [] };
}

export function changeFact(draft: LaunchDraft, snapshot: RerunValuesSnapshot | null, row: StepRow, form: StepOmissionForm,
  field: string, next: StepOmissionFactDraft): LaunchDraft {
  const copiedOmissions = Object.fromEntries(Object.entries(draft.copiedOmissions).filter(([index]) => {
    const candidate = snapshot?.values[Number(index)];
    return candidate === undefined || candidate.targetStepKey !== row.stepKey || candidate.targetFieldPath !== field;
  }));
  return { ...draft, copiedOmissions, stepDrafts: { ...draft.stepDrafts, [row.key]: { ...(draft.stepDrafts[row.key] ?? initialStepOmissionDraft(form)), [field]: next } } };
}

export function copyOmittedValue(draft: LaunchDraft, snapshot: RerunValuesSnapshot | null, index: number, rowKey: string, form: StepOmissionForm): LaunchDraft {
  const candidate = snapshot?.values[index];
  if (candidate === undefined || candidate.state !== "available") throw new Error("RERUN_OMISSION_FIELD_UNAVAILABLE");
  const field = form.fields.find(entry => entry.key === candidate.targetFieldPath);
  if (field === undefined) throw new Error("RERUN_OMISSION_FIELD_UNAVAILABLE");
  return { ...draft, stepDrafts: { ...draft.stepDrafts, [rowKey]: { ...(draft.stepDrafts[rowKey] ?? initialStepOmissionDraft(form)), [field.key]: factDraft(field, candidate.value) } },
    copiedOmissions: { ...draft.copiedOmissions, [index]: true } };
}

export function effectivePriority(choice: StartPriority | undefined, people: number): StartPriority {
  return choice ?? (people > 1 ? "bulk" : "interactive");
}
export function changePriority(draft: LaunchDraft, priority: StartPriority): LaunchDraft { return { ...draft, priority }; }
export function changeDryRun(draft: LaunchDraft, dryRunRequested: boolean): LaunchDraft { return { ...draft, dryRunRequested }; }
export function changeBrowserMode(draft: LaunchDraft, browserMode: BrowserMode): LaunchDraft { return { ...draft, browserMode }; }

export function setLaunchField(draft: LaunchDraft, key: string, value: string): LaunchDraft {
  return { ...draft, launchFields: { ...draft.launchFields, [key]: value } };
}

/** A new library or version pick invalidates the worksheet chosen under the old one. */
export function pickReference(draft: LaunchDraft, typeId: string, libraryId: string, versionId: string | undefined): LaunchDraft {
  return { ...draft, referenceDrafts: { ...draft.referenceDrafts, [typeId]: { libraryId, versionId } }, referenceSelections: omit(draft.referenceSelections, typeId) };
}

export function pickReferenceVersion(draft: LaunchDraft, typeId: string, versionId: string): LaunchDraft {
  const picked = draft.referenceDrafts[typeId];
  return picked === undefined ? draft : pickReference(draft, typeId, picked.libraryId, versionId);
}

export function pickWorksheet(draft: LaunchDraft, typeId: string, selection: ReferenceSelection): LaunchDraft {
  return { ...draft, referenceSelections: { ...draft.referenceSelections, [typeId]: selection } };
}

export function removeReference(draft: LaunchDraft, typeId: string): LaunchDraft {
  return { ...draft, referenceDrafts: omit(draft.referenceDrafts, typeId), referenceSelections: omit(draft.referenceSelections, typeId) };
}

export function pickCheck(draft: LaunchDraft, libraryId: string, pick: CheckPick): LaunchDraft {
  return { ...draft, checkPicks: { ...draft.checkPicks, [libraryId]: pick } };
}

export function removeCheck(draft: LaunchDraft, libraryId: string): LaunchDraft {
  return { ...draft, checkPicks: omit(draft.checkPicks, libraryId) };
}

export function selectWorkbookRows(draft: LaunchDraft, source: string, choices: readonly WorkbookRowChoice[]): LaunchDraft {
  return { ...draft, selectedWorkbookRows: { source, choices } };
}

export function clearWorkbookRows(draft: LaunchDraft): LaunchDraft {
  return { ...draft, selectedWorkbookRows: undefined };
}

const refusal = (code: Parameters<typeof createErrorCatalogFailure>[0]): Error =>
  new Error(formatErrorCatalogFailure(createErrorCatalogFailure(code, {})).text);

/** The spreadsheets the source run was started with, including every selected worksheet of the named reference version. */
function spreadsheetPicks(snapshot: RerunValuesSnapshot, workflow: RunStartWorkflow): Pick<LaunchDraft, "referenceSelections" | "referenceDrafts" | "checkPicks"> {
  const picked = (typeId: string | undefined) => (snapshot.spreadsheets ?? []).filter(pick => pick.typeId === typeId);
  const [required, ...others] = picked(workflow.workbookReference?.id);
  const checkPicks: Record<string, CheckPick> = {};
  for (const { libraryId, versionId, sheetId } of picked(workflow.workbookCheck?.id))
    checkPicks[libraryId] = { versionId, sheetIds: [...(checkPicks[libraryId]?.sheetIds ?? []), sheetId] };
  if (required === undefined || others.some(other => other.libraryId !== required.libraryId || other.versionId !== required.versionId))
    return { referenceSelections: {}, referenceDrafts: {}, checkPicks };
  const { typeId, libraryId, versionId } = required;
  return { referenceSelections: { [typeId]: { libraryId, versionId, sheetIds: [required, ...others].map(pick => pick.sheetId) } }, referenceDrafts: { [typeId]: { libraryId, versionId } }, checkPicks };
}

/** A step the typed input decides (its control sits on the Input stage or is unavailable) is neither switched nor typed on its row. */
export function rowInputDriven(workflow: RunStartWorkflow | undefined, typedValues: TypedInputDraft, row: StepRow): boolean {
  const declaration = typedDeclarationOf(workflow);
  const control = row.stepKey === undefined ? undefined : workflow?.steps.find(step => step.key === row.stepKey)?.control;
  return declaration !== undefined && control?.state === "selectable"
    && (declaration.controls.some(field => field.field === control.inputField && field.placement === "input") || !typedControlAvailable(declaration, typedValues, control.inputField));
}

/** A rerun picks up from the first row that did not complete: completed rows before it are off and rows the source skipped stay skipped.
 * A row stays on when switching it off would take a later row with it, or leave a value nobody recorded to type. */
function preselectRerunSteps(draft: LaunchDraft, snapshot: RerunValuesSnapshot, workflow: RunStartWorkflow): LaunchDraft {
  if (snapshot.retainedSteps !== undefined) {
    const retained = new Set(snapshot.retainedSteps.map(step => step.key));
    return withSteps(draft, workflow.workflowId, workflow.steps.map(step => step.key).filter(key => !retained.has(key)));
  }
  const rows = startRowsOf(workflow), badges = rows.map(row => preselectionBadge(row, snapshot));
  const failed = badges.indexOf("failed"), restart = failed >= 0 ? failed : rerunsInOneClick(snapshot) ? 0 : Math.max(0, badges.indexOf("not-started"));
  const leavesOut = (index: number) => badges[index] === "skipped" || badges[index] === "completed" && index < restart;
  const includedSteps = (choice: LaunchDraft) => {
    const requested = selectedStepKeys(choice, workflow), stopped = stoppedStepOmissions(workflow.steps, requested);
    return requested.filter(key => !stopped.has(key));
  };
  let next = draft;
  for (const [index, row] of rows.entries()) {
    if (!leavesOut(index) || rowInputDriven(workflow, typedDraftOf(next, workflow.workflowId, workflow), row)) continue;
    const candidate = row.kind === "switch" ? toggleRow(next, workflow, snapshot, row, false)
      : badges[index] === "skipped" ? toggleManual(next, snapshot, row, true) : next;
    const before = includedSteps(next), after = includedSteps(candidate);
    const losesLater = rows.some((other, position) => !leavesOut(position) && rowIncluded(other, before, next.manualRows) && !rowIncluded(other, after, candidate.manualRows));
    const complete = rows.every(other => other.form === undefined || !rowFieldsOpen(other, after, candidate.manualRows)
      || foldStepOmissionFacts(other.form, candidate.stepDrafts[other.key] ?? initialStepOmissionDraft(other.form)).state === "facts");
    if (!losesLater && complete && includedRowCount(rows, after, candidate.manualRows) > 0) next = candidate;
  }
  return next;
}

/** The draft a rerun opens with, from its source snapshot and the workflow that ran it. */
export function restoreRerunDraft(snapshot: RerunValuesSnapshot, workflow: RunStartWorkflow, rerunInputText?: string): LaunchDraft {
  const id = workflow.workflowId, { browserMode } = snapshot.source;
  if (browserMode === undefined) throw refusal("RERUN_BROWSER_MODE_UNKNOWN");
  const base = { ...freshLaunchDraft(workflow), dryRunRequested: snapshot.source.dryRun, priority: snapshot.source.priority, browserMode };
  const defaults = defaultRerunSteps(snapshot, workflow);
  if (snapshot.retainedSteps !== undefined) {
    return preselectRerunSteps(withSteps({ ...base, interruptedRerun: true }, id, defaults), snapshot, workflow);
  }
  let next = withSteps({ ...base, ...spreadsheetPicks(snapshot, workflow), valueDrafts: initialRerunValueDrafts(snapshot, workflow) }, id, defaults);
  if (rerunInputText !== undefined) {
    if (workflow.inputRun.state !== "present" || workflow.inputRun.surface.typedInput !== undefined
      || snapshot.source.outcome !== "failed" || snapshot.transactions.length !== 0) throw refusal("COMMAND_REFUSED");
    // A corrected input may be another person's, so no earlier result stands in for a step.
    return withSteps({ ...next, text: rerunInputText, valueDrafts: {} }, id, workflow.steps.map(step => step.key));
  }
  if (workflow.inputRun.state === "present" && workflow.inputRun.surface.typedInput !== undefined) {
    if (snapshot.sourceInput.state === "unavailable") throw refusal("RERUN_SOURCE_INPUT_PROTECTED");
    const declaration = workflow.inputRun.surface.typedInput;
    const input = snapshot.sourceInput.value;
    const partial = snapshot.sourceInput.state === "partial" ? partialRerunTypedInput(declaration, snapshot.sourceInput) : undefined;
    const restored = partial?.draft ?? restoreTypedInput(declaration, input);
    return preselectRerunSteps(withSteps({ ...next, typed: { workflowId: id, draft: restored }, text: partial?.text ?? typedInputText(declaration, input),
      sourceInputUnchanged: partial === undefined || snapshot.sourceInput.state === "partial" && snapshot.sourceInput.identityCopied, valueDrafts: {} },
    id, workflow.steps.filter(step => step.control.state !== "selectable" || restored[step.control.inputField] === true).map(step => step.key)), snapshot, workflow);
  }
  if (workflow.inputRun.state === "present") next = { ...next, text: plainRerunInputText(workflow.inputRun.surface, snapshot.sourceInput) };
  return preselectRerunSteps(next, snapshot, workflow);
}
