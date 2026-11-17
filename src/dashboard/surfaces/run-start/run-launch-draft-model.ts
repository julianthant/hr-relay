import type { RerunValuesSnapshot } from "../../../models/dashboard/rerun-values.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../models/failures/error-catalog.js";
import type { StepOmissionForm } from "../../../models/workflow/step-omission.js";
import type { TypedInputDraft } from "../../../models/workflow/ingress.js";
import { JsonValueSchema } from "../../../rules/validation/canonical-json.js";
import type { RunStartWorkflow } from "./run-start.js";
import {
  candidateText, defaultRerunSteps, initialRerunValueDrafts, partialRerunTypedInput, plainRerunInputText, type RerunValueDraft,
} from "./run-start-rerun-model.js";
import {
  changeTypedInput, initialStepOmissionDraft, restoreTypedInput, toggleStepSelection, typedInputDefaults, typedInputText,
  type BrowserMode, type StartPriority, type StepOmissionDraft, type StepOmissionFactDraft,
} from "./run-start-model.js";
import type { WorkbookRowChoice } from "./run-workbook-rows-model.js";

export type ReferenceSelection = Readonly<{ libraryId: string; versionId: string; sheetId: string }>;
export type ReferenceDraft = Readonly<{ libraryId: string; versionId?: string }>;

/** Everything the operator has entered into the Run and Rerun dialog. The PDF files stay with their upload hook. */
export type LaunchDraft = Readonly<{
  text: string;
  /** A typed draft belongs to the workflow that made it. */
  typed: Readonly<{ workflowId: string; draft: TypedInputDraft }>;
  sourceInputUnchanged: boolean;
  /** A step selection belongs to the workflow that made it; another workflow shows its own defaults. */
  stepSelection?: Readonly<{ workflowId: string; keys: readonly string[] }>;
  stepDrafts: Readonly<Record<string, StepOmissionDraft>>;
  touchedFacts: ReadonlySet<string>;
  factsAttempted: boolean;
  priority: StartPriority;
  dryRunRequested: boolean;
  browserMode: BrowserMode;
  referenceSelections: Readonly<Record<string, ReferenceSelection>>;
  referenceDrafts: Readonly<Record<string, ReferenceDraft>>;
  /** The optional check's picked spreadsheets: library id to the worksheet chosen in it. */
  checkPicks: Readonly<Record<string, string>>;
  selectedWorkbookRows?: Readonly<{ source: string; choices: readonly WorkbookRowChoice[] }>;
  /** Declared launch fields by key; a field is absent until the operator picks it. */
  launchFields: Readonly<Record<string, string>>;
  valueDrafts: Readonly<Record<number, RerunValueDraft>>;
  copiedOmissions: Readonly<Record<number, boolean>>;
}>;

const NO_TYPED_DRAFT: TypedInputDraft = {};
const typedDeclarationOf = (workflow: RunStartWorkflow | undefined) =>
  workflow?.inputRun.state === "present" ? workflow.inputRun.surface.typedInput : undefined;
const typedDefaultsOf = (workflow: RunStartWorkflow | undefined): TypedInputDraft => {
  const declaration = typedDeclarationOf(workflow);
  return declaration === undefined ? {} : typedInputDefaults(declaration);
};
const defaultStepKeys = (workflow: RunStartWorkflow | undefined): string[] =>
  workflow?.steps.filter(({ includedByDefault }) => includedByDefault).map(({ key }) => key) ?? [];
const omit = <T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> =>
  Object.fromEntries(Object.entries(record).filter(([entry]) => entry !== key));
const withSteps = (draft: LaunchDraft, workflowId: string, keys: readonly string[]): LaunchDraft => ({ ...draft, stepSelection: { workflowId, keys } });

export function freshLaunchDraft(workflow: RunStartWorkflow | undefined): LaunchDraft {
  return {
    text: "", typed: { workflowId: workflow?.workflowId ?? "", draft: typedDefaultsOf(workflow) }, sourceInputUnchanged: false,
    stepSelection: undefined, stepDrafts: {}, touchedFacts: new Set(), factsAttempted: false,
    priority: "interactive", dryRunRequested: false, browserMode: "headed",
    referenceSelections: {}, referenceDrafts: {}, checkPicks: {}, selectedWorkbookRows: undefined, launchFields: {},
    valueDrafts: {}, copiedOmissions: {},
  };
}

export function typedDraftOf(draft: LaunchDraft, workflowId: string): TypedInputDraft {
  return draft.typed.workflowId === workflowId ? draft.typed.draft : NO_TYPED_DRAFT;
}

export function selectedStepKeys(draft: LaunchDraft, workflow: RunStartWorkflow | undefined): readonly string[] {
  return draft.stepSelection !== undefined && draft.stepSelection.workflowId === workflow?.workflowId
    ? draft.stepSelection.keys : defaultStepKeys(workflow);
}

/** Another workflow cannot reuse the old one's input, steps, facts or options; reference picks and rerun values stay. */
export function changeWorkflow(draft: LaunchDraft, workflow: RunStartWorkflow | undefined): LaunchDraft {
  return { ...freshLaunchDraft(workflow), referenceDrafts: draft.referenceDrafts, valueDrafts: draft.valueDrafts, copiedOmissions: draft.copiedOmissions };
}

export function changeText(draft: LaunchDraft, text: string): LaunchDraft {
  return { ...draft, text, sourceInputUnchanged: false };
}

export function changeTypedValue(draft: LaunchDraft, workflow: RunStartWorkflow, field: string, value: string | boolean): LaunchDraft {
  const declaration = typedDeclarationOf(workflow);
  if (declaration === undefined) return draft;
  const values = { ...typedInputDefaults(declaration), ...typedDraftOf(draft, workflow.workflowId) };
  const next = changeTypedInput(declaration, values, field, value);
  const current = selectedStepKeys(draft, workflow);
  const keys = workflow.steps.filter(step => step.control.state !== "selectable"
    ? current.includes(step.key) : next[step.control.inputField] === true).map(step => step.key);
  return withSteps({ ...draft, typed: { workflowId: workflow.workflowId, draft: next },
    sourceInputUnchanged: field === declaration.modeField ? false : draft.sourceInputUnchanged }, workflow.workflowId, keys);
}

export function toggleStep(draft: LaunchDraft, workflow: RunStartWorkflow, key: string, next: boolean): LaunchDraft {
  return withSteps(draft, workflow.workflowId, toggleStepSelection(workflow.steps, selectedStepKeys(draft, workflow), key, next));
}

export function enterCustomization(draft: LaunchDraft, workflow: RunStartWorkflow | undefined): LaunchDraft {
  return workflow === undefined ? draft : withSteps(draft, workflow.workflowId, defaultStepKeys(workflow));
}

/** Leaving customization clears the facts so unchosen assertions cannot survive invisibly. */
export function leaveCustomization(draft: LaunchDraft, workflow: RunStartWorkflow | undefined): LaunchDraft {
  return { ...enterCustomization(draft, workflow), stepDrafts: {}, touchedFacts: new Set(), factsAttempted: false };
}

export function changeFact(draft: LaunchDraft, snapshot: RerunValuesSnapshot | null, step: string, form: StepOmissionForm,
  field: string, next: StepOmissionFactDraft): LaunchDraft {
  const copiedOmissions = Object.fromEntries(Object.entries(draft.copiedOmissions).filter(([index]) => {
    const candidate = snapshot?.values[Number(index)];
    return candidate?.targetStepKey !== step || candidate.targetFieldPath !== field;
  }));
  return { ...draft, copiedOmissions, stepDrafts: { ...draft.stepDrafts, [step]: { ...(draft.stepDrafts[step] ?? initialStepOmissionDraft(form)), [field]: next } } };
}

export function copyOmittedValue(draft: LaunchDraft, snapshot: RerunValuesSnapshot | null, index: number, step: string, form: StepOmissionForm): LaunchDraft {
  const candidate = snapshot?.values[index];
  if (candidate === undefined || candidate.state !== "available") throw new Error("RERUN_OMISSION_FIELD_UNAVAILABLE");
  const field = form.fields.find(entry => entry.key === candidate.targetFieldPath);
  if (field === undefined) throw new Error("RERUN_OMISSION_FIELD_UNAVAILABLE");
  const value = typeof candidate.value === "boolean" ? candidate.value
    : Array.isArray(candidate.value) ? candidate.value.map((entry: unknown) => candidateText(JsonValueSchema.parse(entry))).join("\n")
    : candidateText(candidate.value);
  return { ...draft, stepDrafts: { ...draft.stepDrafts, [step]: { ...(draft.stepDrafts[step] ?? initialStepOmissionDraft(form)), [field.key]: value } },
    copiedOmissions: { ...draft.copiedOmissions, [index]: true } };
}

export function touchFact(draft: LaunchDraft, step: string, field: string): LaunchDraft {
  const id = `${step}:${field}`;
  return draft.touchedFacts.has(id) ? draft : { ...draft, touchedFacts: new Set([...draft.touchedFacts, id]) };
}

export function attemptFacts(draft: LaunchDraft): LaunchDraft {
  return { ...draft, factsAttempted: true };
}

export function changeValueText(draft: LaunchDraft, index: number, text: string): LaunchDraft {
  return { ...draft, valueDrafts: { ...draft.valueDrafts, [index]: { text, copied: false } } };
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

export function pickCheck(draft: LaunchDraft, libraryId: string, sheetId: string): LaunchDraft {
  return { ...draft, checkPicks: { ...draft.checkPicks, [libraryId]: sheetId } };
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

/** The draft a rerun opens with, from its source snapshot and the workflow that ran it. */
export function restoreRerunDraft(draft: LaunchDraft, snapshot: RerunValuesSnapshot, workflow: RunStartWorkflow, rerunInputText?: string): LaunchDraft {
  const id = workflow.workflowId;
  let next = withSteps({ ...draft, valueDrafts: initialRerunValueDrafts(snapshot, workflow) }, id, defaultRerunSteps(snapshot, workflow));
  if (rerunInputText !== undefined) {
    if (workflow.inputRun.state !== "present" || workflow.inputRun.surface.typedInput !== undefined
      || snapshot.source.outcome !== "failed" || snapshot.transactions.length !== 0) throw refusal("COMMAND_REFUSED");
    next = withSteps({ ...next, text: rerunInputText, valueDrafts: {} }, id, workflow.steps.map(step => step.key));
  }
  if (workflow.inputRun.state === "present" && workflow.inputRun.surface.typedInput !== undefined) {
    if (snapshot.sourceInput.state === "unavailable") throw refusal("RERUN_SOURCE_INPUT_PROTECTED");
    const declaration = workflow.inputRun.surface.typedInput;
    const input = snapshot.sourceInput.value;
    const partial = snapshot.sourceInput.state === "partial" ? partialRerunTypedInput(declaration, snapshot.sourceInput) : undefined;
    const restored = partial?.draft ?? restoreTypedInput(declaration, input);
    return withSteps({ ...next, typed: { workflowId: id, draft: restored }, text: partial?.text ?? typedInputText(declaration, input),
      sourceInputUnchanged: partial === undefined || snapshot.sourceInput.state === "partial" && snapshot.sourceInput.identityCopied, valueDrafts: {} },
    id, workflow.steps.filter(step => step.control.state !== "selectable" || restored[step.control.inputField] === true).map(step => step.key));
  }
  if (workflow.inputRun.state === "present" && rerunInputText === undefined) return { ...next, text: plainRerunInputText(workflow.inputRun.surface, snapshot.sourceInput) };
  return next;
}
