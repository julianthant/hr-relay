import { StartPlanRequestSchema, type StartPlanRequest } from "../../../models/dashboard/start-plan.js";
import { useWorkbookRows, useWorkbookVersionSources, useCheckVersionSheets, checkVersionKey, previewWorkbookRows, resolveWorkbookRowSelection, WORKBOOK_ROW_UNAVAILABLE_TEXT } from "./run-workbook-rows-model.js";
import { spreadsheetField } from "../../../models/fields/workbook-fields.js";
import type { IconName } from "../../../models/workflow/presentation.js";
import { RunList, RunListRow, RunListSkeleton } from "../../ds/primitives/run-list.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../models/failures/error-catalog.js";
import { useViewNavigation, useViewState } from "../../app/navigation/view-route-model.js";
import { servedLaunchWorkflows, type WorkflowCatalogEntry } from "../workflows/workflow-catalog-model.js";
import "./launch-presentation.css";
import { RunChoice, RunOptionsLayout } from "./run-launch-layout.js";
import { RunWorkflowPicker } from "./run-start-picker.js";
import { RunChecksStage } from "./run-checks.js";
import { FailureNotice } from "../../ds/primitives/failure-notice.js";
import { runChecksBlocked, useRunChecks, type RunCheckRow } from "./run-checks-model.js";

import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { rerunTypedSourceInput, rerunSubmission } from "./run-start-rerun-model.js";
import { readLaunchRecovery, readLaunchVerificationPlan, retainLaunchFinal, dismissLaunchRecovery } from "./run-launch-recovery.js";
import { createRunLaunchService, type RerunLaunchSource } from "./run-launch-model.js";
import * as launchDraft from "./run-launch-draft-model.js";
import type { LaunchDraft } from "./run-launch-draft-model.js";
import { useKeepFocusInDialog } from "./run-dialog-focus.js";
import { heldFingerprint, runDialogControls, shownRepeatWarning, useRunDialogMachine, visibleRunDialog, type AuthorityCheck, type LaunchGates, type LaunchRecovery, type RunDialogPrimaryInput } from "./run-dialog-model.js";
/** Descriptor-driven launch UI; server planning and durable command recovery own admission. */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Check, Keyboard, ListChecks, Play } from "lucide-react";
import { cn } from "../../lib/utils.js";
import { useToasts, BareButton, Badge, Banner, Button, Checkbox, Switch, Dialog, DialogBody, DialogContent, DialogFooter, EmptyState, KeyValueList, MetaLine, Table, THead, TBody, TR, TH, TD, Skeleton, Well, dsFg, dsFocus, dsIcon, dsText } from "../../ds/ui.js";

import { runStartRefusalToast } from "../../app/commands/command-result.js";
import { type InputRunSurface, type UploadRunSurface } from "../../../models/workflow/ingress.js";
import type { WorkflowModuleRole } from "../../../workflow-kit/validation/module-role.js";
import type { EnqueuePolicy } from "../../../models/workflow/presentation.js";

import { useDashboardCommandBinding, useDashboardClient } from "../../state/client-context.js";
import { TypedInput, StepOmissionFactsForm, RunSpreadsheets, type CheckSheet } from "./run-start-kit.js";
import { useSpreadsheetWiringAdapter } from "../../state/spreadsheet-wiring-adapter.js";
import type { WorkflowStartWire } from "../../../models/dashboard/bootstrap.js";
import { SYSTEM_NAME } from "../shared/status/system-chip-model.js";
import { planRefusalNotice, forcedStepOmissions, initialStepOmissionDraft, startRequestFingerprint, previewRunInput, launchWorkbookReferences, MISSING_REFERENCE_REASON, typedInputDefaults, typedInputMode, typedDateControls, usDateText, typedControlAvailable, type RunInputPreview, type StepOmissionFactDraft } from "./run-start-model.js";
import { firstStepsFailure, includedRowCount, lastIncludedSwitch, rowFieldsOpen, rowIncluded, rowOpenFold, sourceBadge, startRowsOf, stepEntries, type OpenStepRow, type StartStep, type StepRow } from "./run-steps-model.js";
import { adjacentRunStartStage, reconcileRunStartStage, runStartStages, type RunStartStage } from "./run-start-timeline.js";
import type { StepOmissionForm } from "../../../models/workflow/step-omission.js";
import { WorkflowPdfInput } from "./run-start-pdf-input.js";
import { pdfRunLaunchFields, pdfRunOcrFooter, pdfRunSelectValue, pdfRunSwitchValue, previewPdfRun, restorePdfRun, unpickedPdfRunField, usePdfRunInput } from "./run-start-pdfs.js";

/** the surface id this command family is audited under (ref frontend-backend-integration ) */

/** What the app composes from the descriptor and bootstrap projections. The
 * dialog reads exactly this and imports no workflow module. */
export interface RunStartWorkflow {
  readonly uploadRun?: UploadRunSurface;
  readonly workflowId: string;
  readonly label: string;
  /** the served category this workflow is filed under — the picker's grouping */
  readonly categoryId: string;
  // Use the served role; never infer it from an ID prefix.
  readonly role: WorkflowModuleRole;
  /** The definition's own icon name; the dashboard names no workflow to choose one. */
  readonly icon: IconName;
  readonly code?: string;
  /** the descriptor's own sentence about what this workflow does */
  readonly summary?: string;
  /** The descriptor's DECLARED active-run policy . It is a fact, not a
 * control: `planStart` reads `descriptor.enqueue` and `StartPlanIngress` */
  readonly enqueue: EnqueuePolicy;
  /** The served descriptor version, shown in Options and Confirm. */
  readonly version: number;
  readonly steps: readonly StartStep[];
  /** The served rows of the Steps stage; a workflow that serves none shows one row per step. */
  readonly rows?: NonNullable<WorkflowStartWire["rows"]>;
  /** the descriptor's declared typed-input surface */
  readonly inputRun:
    | { readonly state: "present"; readonly surface: InputRunSurface }
    | { readonly state: "absent"; readonly reason: string };
  /** Retained served intake capability. Spreadsheet registration lives in
 * Settings and is not a Run input method. */
  readonly spreadsheetIntake: boolean;
  readonly requiredWorkbookFields: readonly string[];
  readonly workbookReference?: Readonly<{ id: string; keyFieldId: string; mode: "keys" | "all"; writableFields: readonly string[] }>;
  /** The optional second check: any library spreadsheet that maps the key field fits, and a start may pick none. */
  readonly workbookCheck?: Readonly<{ id: string; keyFieldId: string }>;
  readonly referenceSources: readonly Readonly<{ libraryId: string; versionId: string; sheetId: string; sheetName: string }>[];
}

function isStartable(workflow: RunStartWorkflow): boolean {
  return workflow.inputRun.state === "present" || workflow.uploadRun?.pdfInput !== undefined;
}

/** What the dialog reads when the served catalogue holds nothing to select. It
 * is a statement about the dialog's own state, not a substituted descriptor */
/** a stable empty step list, so "no workflow selected" is not a fresh array each render */
const EMPTY_STEPS: RunStartWorkflow["steps"] = Object.freeze([]);

const NO_WORKFLOW_SELECTED = Object.freeze({
  state: "absent",
  reason: "no workflow is selected",
} as const);

/** The original input cannot be sent again: a spreadsheet, worksheet, row or PDF of the source run is gone or unreadable, or its value was protected. */
const RERUN_INPUT_GONE = formatErrorCatalogFailure(createErrorCatalogFailure("RERUN_SOURCE_INPUT_PROTECTED", {})).text;

/** Compare omission sets, not order; added or missing keys describe a different run and must refuse. */
function sameStepKeys(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((key, index) => key === sortedRight[index]);
}



/** Restore intake focus to its launcher; it is the control that opened the workspace. */

export function RunStartButton({ id, onOpen }: { id: string; onOpen: () => void }) {
  return (
    <Button
      id={id}
      size="toolbar"
      variant="brand"
      className="queue-start-trigger"
      aria-label="Start run"
      onClick={onOpen}
      icon={<Play aria-hidden className={dsIcon.sm} />}
      // Keep shortcut hints in their shared discovery route so the primary control stays focused on its verb.
      title="Start a run — any workflow, from anywhere (r)"
    >
      <span className="queue-start-label">Start run</span>
    </Button>
  );
}



/** Never auto-pick a harness; select one only when the operator already chose its panel. */
function defaultWorkflowId(
  workflows: readonly RunStartWorkflow[],
  panelWorkflowId: string,
): string {
  const autoPickable = (workflow: RunStartWorkflow): boolean =>
    workflow.role.kind === "standalone" || workflow.role.kind === "composition";
  const startable = workflows.filter(isStartable);
  const onPanel = startable.find((workflow) => workflow.workflowId === panelWorkflowId);
  const chosen = onPanel
    ?? startable.find(autoPickable)
    ?? workflows.find((workflow) => workflow.workflowId === panelWorkflowId)
    ?? workflows.find(autoPickable);
  return chosen === undefined ? "" : chosen.workflowId;
}

export function RunStartDialog({
  open,
  onOpenChange,
  catalog,
  panelWorkflowId,
  actorId,
  onApplied,
  onCloseAutoFocus,
  hidden = false,
  onFixCheck,
  rerunSource,
  rerunInputText,
  rerunInOneClick = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Settings is open from a Fix button: the dialog stays mounted with everything typed, but is not drawn. */
  hidden?: boolean;
  /** Opens the Settings section that fixes a failed check, over this dialog. */
  onFixCheck?: (section: string, target?: string) => void;
  /** Shared registration and explicit launch capabilities from the app boundary. */
  catalog: readonly WorkflowCatalogEntry[];
  /** the Workflow Panel the operator is standing in — the dialog's default */
  panelWorkflowId: string;
  /** echoed from bootstrap; the server matches it against the request identity */
  actorId: string;
  onApplied?: (workflowId: string, count?: number, runId?: string) => void;
  /** Hand intake the picker’s workflow, never the panel’s incidental scope. */
  onOpenIntake: (workflowId: string, intakeSessionId: string) => void;
  onCloseAutoFocus?: (event: Event) => void;
  rerunSource?: RerunLaunchSource;
  rerunInputText?: string;
  /** Rerun was pressed on a successful run: it queues without the dialog unless something needs the operator. */
  rerunInOneClick?: boolean;
}) {
  const workflows = useMemo(() => servedLaunchWorkflows(catalog), [catalog]);
  const navigation = useViewNavigation();
  const routed = navigation !== undefined;
  const [pickerQuery, setPickerQuery] = useState("");
  const client = useDashboardClient();
  const commandBinding = useDashboardCommandBinding();
  const pdfInput = usePdfRunInput(client, commandBinding);
  const resetPdfs = pdfInput.reset;
  const commandBindingRef = useRef(commandBinding);
  commandBindingRef.current = commandBinding;
  const launchService = useMemo(() => createRunLaunchService(client, actorId, { uuid: () => crypto.randomUUID(), now: () => {
    const binding = commandBindingRef.current;
    if (binding === undefined || binding.scope.client !== client || binding.scope.actorId !== actorId) throw new Error("RUN_LAUNCH_AUTHORITY_UNAVAILABLE");
    return binding.authority.now();
  } }), [client, actorId]);
  const { toast } = useToasts();
  const isRerun = rerunSource !== undefined;

  const [workflowId, setWorkflowId] = useViewState("launchServed", () => defaultWorkflowId(workflows, panelWorkflowId));
  const selectedWorkflowRef = useRef(workflowId);
  useEffect(() => { selectedWorkflowRef.current = workflowId; }, [workflowId]);
  const [currentStage, setCurrentStage] = useViewState("launchStage", "Input");
  const [draft, setDraft] = useState(() => launchDraft.freshLaunchDraft(workflows.find(entry => entry.workflowId === defaultWorkflowId(workflows, panelWorkflowId)), commandBinding?.authority.today));
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const update = useCallback((change: (current: LaunchDraft) => LaunchDraft) => {
    const next = change(draftRef.current);
    draftRef.current = next;
    setDraft(next);
  }, []);
  const { text, sourceInputUnchanged, stepDrafts, manualRows, priority: priorityChoice, dryRunRequested, browserMode,
    referenceSelections, referenceDrafts, checkPicks, selectedWorkbookRows, valueDrafts, copiedOmissions } = draft;
  const typedDraft = launchDraft.typedDraftOf(draft, workflowId, workflows.find(entry => entry.workflowId === workflowId), commandBinding?.authority.today);
  const library = useSpreadsheetWiringAdapter(open && workflows.some(workflow => workflow.workflowId === workflowId && (workflow.workbookReference !== undefined || workflow.workbookCheck !== undefined)), null, true, false);
  const selectedWorkflow = workflows.find(workflow => workflow.workflowId === workflowId);
  const workbookReference = selectedWorkflow?.workbookReference;
  const requiredTypes = useMemo(() => workbookReference === undefined ? [] : [workbookReference.id], [workbookReference]);
  const referenceId = workbookReference?.id;
  /** A rerun writes to the current version of the original spreadsheet; every other start keeps the version picked. */
  const writtenVersion = isRerun && (workbookReference?.writableFields.length ?? 0) > 0
    ? library.catalog.find(entry => referenceId !== undefined && entry.libraryId === referenceDrafts[referenceId]?.libraryId)?.state.selectedVersionId : undefined;
  const atWrittenVersion = <T extends object>(picks: Readonly<Record<string, T>>): Readonly<Record<string, T>> => referenceId === undefined || writtenVersion === undefined || picks[referenceId] === undefined
    ? picks : { ...picks, [referenceId]: { ...picks[referenceId], versionId: writtenVersion } };
  const selectedReferences = atWrittenVersion(referenceSelections);
  const selectedDraft = referenceId === undefined ? undefined : atWrittenVersion(referenceDrafts)[referenceId];
  const selectedLibrary = library.catalog.find(entry => entry.libraryId === selectedDraft?.libraryId && entry.state.origin.kind === 'local' && !entry.state.removed);
  const selectedVersion = selectedLibrary?.state.versions.find(version => version.id === selectedDraft?.versionId);
  const sourceProjection = library.compatibility?.workflows.find(entry => entry.workflowId === workflowId);
  /** Relay answered but has no reference-spreadsheet check for this workflow: the input stage says so, the rest of the dialog keeps working. */
  const compatibilityMissing = library.compatibility !== undefined && workbookReference !== undefined && sourceProjection === undefined;
  if (sourceProjection !== undefined && selectedWorkflow !== undefined && (canonicalJsonStringify(sourceProjection.requiredWorkbookFields) !== canonicalJsonStringify(selectedWorkflow.requiredWorkbookFields)
    || canonicalJsonStringify(sourceProjection.workbookReference ?? null) !== canonicalJsonStringify(workbookReference ?? null)))
    throw new Error(`WORKBOOK_COMPATIBILITY_DECLARATION_MISMATCH: ${workflowId}`);
  const referenceSources = sourceProjection?.sources ?? [];
  const workbookCheck = selectedWorkflow?.workbookCheck;
  /** Every local library spreadsheet whose current version maps the check's key field, apart from the one the required reference already picked. */
  const checkLibraries = useMemo(() => workbookCheck === undefined || library.compatibility === undefined ? [] : library.compatibility.libraries.flatMap(source => {
    const entry = library.catalog.find(candidate => candidate.libraryId === source.libraryId && candidate.state.origin.kind === "local" && !candidate.state.removed);
    const worksheets = source.sheets.filter(sheet => sheet.mappings.some(mapping => mapping.fieldId === workbookCheck.keyFieldId)).map(sheet => ({ sheetId: sheet.sheetId, sheetName: sheet.sheetName }));
    return entry === undefined || worksheets.length === 0 || entry.libraryId === referenceDrafts[workbookReference?.id ?? ""]?.libraryId ? []
      : [{ libraryId: entry.libraryId, name: entry.name, pinned: entry.state.pinned, currentVersionId: source.versionId, currentSheets: worksheets,
        versions: entry.state.versions.map((version, index) => ({ id: version.id, savedAt: version.savedAt, name: version.name || `v${entry.state.versions.length - index}` })) }];
  }).toSorted((a, b) => a.name.localeCompare(b.name)), [workbookCheck, library.compatibility, library.catalog, referenceDrafts, workbookReference?.id]);
  const historicalChecks = useMemo(() => checkLibraries.flatMap(entry => {
    const pick = checkPicks[entry.libraryId];
    return pick === undefined || pick.versionId === entry.currentVersionId ? [] : [{ libraryId: entry.libraryId, versionId: pick.versionId }];
  }), [checkLibraries, checkPicks]);
  const checkVersionSheets = useCheckVersionSheets(client, commandBinding?.authority.epoch ?? client, historicalChecks, workbookCheck?.keyFieldId);
  const checkSheets = useMemo((): readonly CheckSheet[] => checkLibraries.map(entry => {
    const pick = checkPicks[entry.libraryId];
    const versionId = pick?.versionId ?? entry.currentVersionId;
    const loaded = versionId === entry.currentVersionId ? { state: "ready" as const, sheets: entry.currentSheets } : checkVersionSheets[checkVersionKey(entry.libraryId, versionId)] ?? { state: "loading" as const, sheets: [] };
    return { libraryId: entry.libraryId, name: entry.name, pinned: entry.pinned, versions: entry.versions, versionId, versionName: entry.versions.find(version => version.id === versionId)?.name ?? "",
      worksheets: loaded.sheets, worksheetsState: loaded.state, ...(pick === undefined ? {} : { pickedSheetIds: pick.sheetIds }) };
  }), [checkLibraries, checkPicks, checkVersionSheets]);
  /** The picks that can be sent: named version read, at least one of its worksheets chosen. */
  const pickedChecks = checkSheets.filter(sheet => sheet.pickedSheetIds !== undefined && sheet.worksheetsState === "ready"
    && sheet.worksheets.some(worksheet => sheet.pickedSheetIds?.includes(worksheet.sheetId)));
  const checkPending = checkSheets.some(sheet => sheet.pickedSheetIds !== undefined && sheet.worksheetsState !== "ready");
  const checkSelections = pickedChecks.flatMap(sheet => sheet.worksheets.filter(worksheet => sheet.pickedSheetIds?.includes(worksheet.sheetId))
    .map(worksheet => ({ libraryId: sheet.libraryId, versionId: sheet.versionId, sheetId: worksheet.sheetId })));
  useEffect(() => {
    for (const sheet of checkSheets) if (sheet.pickedSheetIds?.length === 0 && sheet.worksheetsState === "ready" && sheet.worksheets.length > 0)
      update(current => launchDraft.pickCheck(current, sheet.libraryId, { versionId: sheet.versionId, sheetIds: [sheet.worksheets[0].sheetId] }));
  }, [checkSheets, update]);
  const versionSources = useWorkbookVersionSources(client, commandBinding?.authority.epoch ?? client,
    selectedLibrary?.libraryId, selectedVersion, selectedLibrary?.state.selectedVersionId,
    selectedWorkflow?.requiredWorkbookFields ?? [], referenceSources);
  const [customizeSteps, setCustomizeSteps] = useViewState("launchCustomize", false);
  const customizedStepKeys = useMemo(() => [...launchDraft.selectedStepKeys(draft, selectedWorkflow)], [draft, selectedWorkflow]);
  const captureBrowserScreenshots = true;

  const workflow = workflows.find((entry) => entry.workflowId === workflowId);

  const inputRun = workflow?.inputRun ?? NO_WORKFLOW_SELECTED;
  const pdfSurface = workflow?.uploadRun?.pdfInput === undefined ? undefined : workflow.uploadRun;
  const typedDeclaration = inputRun.state === "present" ? inputRun.surface.typedInput : undefined;
  const declaredInput = typedDeclaration !== undefined;
  const typedValues = useMemo(() => {
    if (typedDeclaration === undefined) return typedDraft;
    const values = { ...typedInputDefaults(typedDeclaration), ...typedDraft };
    for (const step of workflow?.steps ?? []) {
      const control = step.control;
      if (control.state === "selectable" && typedDeclaration.controls.some(field => field.field === control.inputField && field.placement === "step"))
        values[control.inputField] = typedControlAvailable(typedDeclaration, values, control.inputField) && (customizeSteps || isRerun ? customizedStepKeys.includes(step.key) : step.includedByDefault);
    }
    return values;
  }, [typedDeclaration, typedDraft, workflow, customizeSteps, isRerun, customizedStepKeys]);
  const defaultStepKeys = useMemo(() => workflow?.steps.filter(step => {
    const control = step.control;
    return declaredInput && control.state === "selectable"
      ? typedValues[control.inputField] === true
      : step.includedByDefault;
  }).map(step => step.key) ?? [], [workflow, declaredInput, typedValues]);
  const selectedStepKeys = customizeSteps || isRerun ? customizedStepKeys : defaultStepKeys;
  const rowCapability = !isRerun && inputRun.state === "present" ? inputRun.surface.workbookRows : undefined;
  const rowReference = rowCapability === undefined ? undefined : selectedReferences[rowCapability.typeId];
  const rowLibrary = library.catalog.find(entry => entry.libraryId === rowReference?.libraryId && entry.state.origin.kind === "local" && !entry.state.removed);
  const rowVersion = rowLibrary?.state.versions.find(version => version.id === rowReference?.versionId);
  const rowReadReady = !library.catalogLoading && !library.catalogRefreshing && !library.catalogError && rowLibrary !== undefined && rowVersion !== undefined
    && versionSources.state === 'ready' && versionSources.sources.some(source => source.libraryId === rowReference?.libraryId && source.versionId === rowReference?.versionId && source.sheetId === rowReference?.sheetId);
  const rowIdentity = canonicalJsonStringify([actorId, workflowId, workflow?.version ?? null, inputRun, rowReference ?? null, rowLibrary?.state.revision ?? null]);
  const workbookRows = useWorkbookRows(client, rowIdentity, commandBinding?.authority.epoch ?? client, open && rowCapability !== undefined,
    rowReadReady, rowReference?.libraryId ?? "", rowVersion, workbookReference?.keyFieldId, rowReference?.sheetId);
  const rowSource = canonicalJsonStringify([rowReference?.libraryId ?? null, rowReference?.versionId ?? null, rowReference?.sheetId ?? null]);
  const rowSelectionFresh = selectedWorkbookRows === undefined || selectedWorkbookRows.source === rowSource;
  const rowChoices = rowSelectionFresh ? workbookRows.choices : selectedWorkbookRows?.choices ?? [];
  const supportsDryRun = (inputRun.state === "present" && inputRun.surface.supportsDryRun === true) || workflow?.uploadRun?.supportsDryRun === true;
  const dryRunDescription = pdfSurface?.supportsDryRun === true
    ? "Fill and check every step without submitting or saving."
    : "Fill and check every step without submitting.";
  const dryRun = supportsDryRun && dryRunRequested;
  const launchStages = useMemo(() => runStartStages(isRerun), [isRerun]);

  useEffect(() => {
    setCurrentStage((current) => reconcileRunStartStage(launchStages, current));
  }, [launchStages, setCurrentStage]);

  /** Plans and results expire when any request-shaping fact changes. */
  /** Lock forced omissions using the descriptor cascade; the planner owns the rule. */
  const steps = workflow?.steps ?? EMPTY_STEPS;
  const forcedByStep = useMemo(() => forcedStepOmissions(steps, selectedStepKeys), [steps, selectedStepKeys]);
  const rows = useMemo(() => startRowsOf({ steps, rows: workflow?.rows }), [steps, workflow?.rows]);
  const inputDriven = useCallback((row: StepRow): boolean => launchDraft.rowInputDriven(workflow, typedValues, row), [workflow, typedValues]);
  const openRows: readonly OpenStepRow[] = useMemo(() => customizeSteps ? rows.flatMap(row => {
    if (row.form === undefined || inputDriven(row) || !rowFieldsOpen(row, selectedStepKeys, manualRows)) return [];
    return [rowOpenFold(row, row.form, stepDrafts[row.key] ?? initialStepOmissionDraft(row.form))];
  }) : [], [customizeSteps, rows, selectedStepKeys, manualRows, stepDrafts, inputDriven]);
  const stepOmissions = useMemo(() => stepEntries(openRows), [openRows]);
  const requestFingerprint = launchDraft.launchRequestFingerprint({
    draft, rowIdentity, customizeSteps, typedValues, rerunSource,
    pdf: { draft: pdfInput.draft, picks: pdfInput.picks, loading: pdfInput.loading, error: pdfInput.error },
    workbookRows: { state: workbookRows.state, fresh: rowSelectionFresh },
    library: { loading: library.catalogLoading, refreshing: library.catalogRefreshing, error: library.catalogError, compatibility: library.compatibility },
    spreadsheets: launchDraft.namedSpreadsheets(draft, library.catalog),
    versionSources: { state: versionSources.state, sources: versionSources.sources },
    checks: { pending: checkPending, selections: checkSelections },
    request: startRequestFingerprint({
      workflowId,
      text,
      dryRun,
      browserMode,
      captureBrowserScreenshots,
      priority: priorityChoice,
      selectedStepKeys,
      stepOmissionDrafts: openRows.map(({ row, draft }) => ({ step: row.key, draft })),
    }),
  });
  const [requestProblem, setRequestProblem] = useState<string | null>(null);
  const suppressStage = useRef(false);
  /** `submit` as last drawn: the one way on from this stage, for the footer button, the Enter key and a clean plan's own start. Null when refused. */
  const submitRef = useRef<(() => void) | null>(null);
  const workflowsRef = useRef(workflows);
  workflowsRef.current = workflows;
  const authority = (): AuthorityCheck => {
    const binding = commandBindingRef.current;
    return binding !== undefined && binding.scope.client === client && binding.scope.actorId === actorId ? { state: "ok" } : { state: "replaced" };
  };
  const { state: machine, send } = useRunDialogMachine({
    stage: currentStage,
    setStage: next => { if (!suppressStage.current) setCurrentStage(next); },
    fingerprint: requestFingerprint,
    effects: {
      loadSource: async source => {
        const response = await launchService.openRerun({ runId: source.runId, expectedVersion: source.expectedVersion });
        if (response.state === "refused") throw new Error(`Rerun unavailable: ${response.code}`);
        return response.snapshot;
      },
      restoreSource: restored => {
        const sourceWorkflow = workflowsRef.current.find(entry => entry.workflowId === restored.source.workflow);
        if (sourceWorkflow === undefined) throw new Error("RERUN_WORKFLOW_UNAVAILABLE");
        if (sourceWorkflow.uploadRun?.pdfInput !== undefined) {
          const pdfs = restored.sourceInput.state === "available" ? restorePdfRun(sourceWorkflow.uploadRun, restored.sourceInput.value) : null;
          if (pdfs === null) throw new Error(RERUN_INPUT_GONE);
          pdfInput.restore(pdfs);
        }
        const next = launchDraft.restoreRerunDraft(draftRef.current, restored, sourceWorkflow, rerunInputText);
        setWorkflowId(sourceWorkflow.workflowId);
        draftRef.current = next;
        setDraft(next);
      },
      requestPlan: planRequest => launchService.preview(planRequest),
      checkWarnings: () => {
        if (snapshot === null) return Promise.reject(new Error("RERUN_SOURCE_UNAVAILABLE"));
        return launchService.previewWarnings({ workflowId, source: { runId: snapshot.source.runId,
          expectedVersion: snapshot.source.version, intent: "rerun", selectedStepKeys } });
      },
      retain: (command, planned) => {
        retainLaunchFinal(window.sessionStorage, command, planned);
        return readLaunchVerificationPlan(window.sessionStorage, command.requestedBy);
      },
      submit: (command, verification) => {
        const binding = commandBindingRef.current;
        if (binding === undefined) return Promise.reject(new Error("RUN_LAUNCH_AUTHORITY_UNAVAILABLE"));
        return launchService.submit(command, binding, verification);
      },
      dismissRecovery: command => dismissLaunchRecovery(window.sessionStorage, command),
      feedback: outcome => commandBindingRef.current?.feedback(outcome),
      applied: (applied, count, _workerStartup, runId) => onApplied?.(applied, count, runId),
      closeDialog: () => onOpenChange(false),
      refusalToast: () => toast(runStartRefusalToast(formatErrorCatalogFailure(createErrorCatalogFailure("RUN_START_READINESS_UNAVAILABLE", {})).text)),
      autoStart: () => { submitRef.current?.(); send({ type: "attend" }); },
    },
  });
  const fingerprint = heldFingerprint(machine, requestFingerprint);
  const view = visibleRunDialog(machine, fingerprint);
  const plan = view.shown?.plan ?? null;
  const expiredPlan = view.shown?.expired ?? false;
  const recovery = view.recovery.state === "retained" ? view.recovery.command : null;
  const recoveryError = view.recovery.state === "unreadable" ? view.recovery.message : null;
  const readback = view.recovery.state === "retained" && view.recovery.answer !== undefined;
  const load = view.source.kind === "rerun" ? view.source.load : undefined;
  const snapshot = load?.state === "ready" ? load.snapshot : null;
  const sourceError = load?.state === "failed" ? load.message : null;
  const warning = shownRepeatWarning(view, fingerprint) ?? null;
  const acknowledgment = load?.state === "ready" ? load.acknowledgment : undefined;
  const busy = view.activity.kind !== "idle";
  const error = requestProblem ?? view.problem ?? null;
  const sending = [view.activity, ...view.detached].some(request => request.kind === "submitting" || request.kind === "replanning");
  useEffect(() => { send({ type: "draft-changed" }); setRequestProblem(null); }, [fingerprint, send]);
  useEffect(() => { send({ type: "binding-changed" }); }, [commandBinding?.scope, send]);

  /** Changing workflow clears its parser input and bound plan; another workflow cannot reuse either. */
  const selectWorkflow = useCallback((next: string, preserveStage = false) => {
    resetPdfs();
    setWorkflowId(next);
    update(current => launchDraft.changeWorkflow(current, workflows.find(entry => entry.workflowId === next), commandBinding?.authority.today));
    if (!preserveStage) { setCurrentStage("Input"); setCustomizeSteps(false); }
  }, [workflows, update, setCurrentStage, setCustomizeSteps, setWorkflowId, resetPdfs, commandBinding?.authority.today]);

  /** The rerun this dialog is open for, and whether its one click is still going. */
  const openedFor = useRef<RerunLaunchSource | undefined>(undefined);
  const [opened, setOpened] = useState<RerunLaunchSource>();
  const unattended = useRef(view.unattended);
  unattended.current = view.unattended;
  const fromRerun = useRef(false);
  useEffect(() => { if (!open) { openedFor.current = undefined; setOpened(undefined); } }, [open]);
  /** Nothing is drawn while a one-click rerun goes on by itself. */
  const drawn = open && !hidden && view.unattended === undefined && !(rerunInOneClick && opened !== rerunSource);

  // Opening lands on the panel you are standing in, every time — including the
  // second time, which is why this keys on `open` rather than running once.
  useEffect(() => {
    if (!open) return;
    resetPdfs();
    if (!routed && selectedWorkflowRef.current !== defaultWorkflowId(workflows, panelWorkflowId)) selectWorkflow(defaultWorkflowId(workflows, panelWorkflowId), true);
    setPickerQuery("");
    update(current => ({ ...current, valueDrafts: {}, copiedOmissions: {}, sourceInputUnchanged: false,
      ...(rerunSource === undefined ? {} : { typed: { workflowId: "", draft: {} }, text: "" }) }));
    let recoveryState: LaunchRecovery;
    try {
      const retained = readLaunchRecovery(window.sessionStorage, actorId);
      recoveryState = retained === null ? { state: "none" } : { state: "retained", command: retained };
    } catch { recoveryState = { state: "unreadable", message: "Relay cannot send the saved start again. Check the queue first." }; }
    if (rerunSource !== undefined) setCustomizeSteps(true);
    else if (fromRerun.current) update(() => launchDraft.freshLaunchDraft(workflows.find(entry => entry.workflowId === selectedWorkflowRef.current), commandBindingRef.current?.authority.today));
    fromRerun.current = rerunSource !== undefined;
    // A start keeps the routed stage; only a rerun opens on its own first stage.
    suppressStage.current = rerunSource === undefined;
    try { send({ type: "open", recovery: recoveryState, ...(rerunSource === undefined ? {} : { rerun: rerunSource,
      // A dialog already open for this rerun starts over by itself only while nothing was asked for.
      unattended: rerunInOneClick && (openedFor.current !== rerunSource || unattended.current === "waiting") }) }); }
    finally { suppressStage.current = false; }
    openedFor.current = rerunSource;
    setOpened(rerunSource);
  }, [open, workflows, panelWorkflowId, selectWorkflow, rerunSource, rerunInputText, rerunInOneClick, actorId, launchService, routed, setCustomizeSteps, resetPdfs, update, send]);

  const pickWorkflow = useCallback((id: string) => {
    if (selectedWorkflowRef.current === id || sending) return;
    const entry = catalog.find(flow => flow.id === id);
    if (!entry || entry.launch.state === "unavailable") return;
    selectedWorkflowRef.current = id;
    if (entry.served) {
      send({ type: "pick-workflow" });
      selectWorkflow(id);
    }
  }, [catalog, selectWorkflow, send, sending]);

  /** Closing without starting keeps the draft; the next open says so for a few seconds. */
  const [draftKept, setDraftKept] = useState(false);
  const keptPending = useRef(false);
  const closeAndReset = useCallback((next: boolean) => {
    if (!next && rerunSource === undefined) {
      keptPending.current = JSON.stringify(draftRef.current) !== JSON.stringify(launchDraft.freshLaunchDraft(workflows.find(entry => entry.workflowId === workflowId), commandBinding?.authority.today));
    }
    // The close event resets the routed stage, so it goes first and closing the route then drops every launch coordinate.
    if (!next) send({ type: "close" });
    onOpenChange(next);
  }, [onOpenChange, send, rerunSource, workflows, workflowId, commandBinding?.authority.today]);
  useEffect(() => {
    if (!open) return;
    if (!keptPending.current) return;
    keptPending.current = false;
    setDraftKept(true);
    const timer = window.setTimeout(() => setDraftKept(false), 6000);
    return () => window.clearTimeout(timer);
  }, [open]);
  useEffect(() => { if (!open) setDraftKept(false); }, [open]);

  const checks = useRunChecks(client, workflow?.workflowId, open && !hidden, currentStage === "Start", open);
  /** The check whose Fix opened Settings; once the checks are re-read after the return, its row takes focus again. */
  const fixedCheck = useRef<{ check: string; reread: boolean } | null>(null);
  const fixCheck = (item: RunCheckRow) => {
    if (item.fix === undefined || onFixCheck === undefined) return;
    fixedCheck.current = { check: item.check, reread: false };
    onFixCheck(item.fix.section, item.fix.target);
  };
  useEffect(() => {
    const fixed = fixedCheck.current;
    if (fixed === null || hidden) return;
    if (checks.state.state === "checking") { fixed.reread = true; return; }
    if (!fixed.reread) return;
    const row = document.querySelector<HTMLElement>(`[data-run-check-fix="${fixed.check}"]`) ?? document.querySelector<HTMLElement>(`[data-run-check="${fixed.check}"]`);
    if (row === null) return;
    fixedCheck.current = null;
    row.focus();
  }, [checks.state, hidden]);


  const typedInputRef = useRef<HTMLTextAreaElement>(null);

  const preview = useMemo((): RunInputPreview => {
    if (pdfSurface !== undefined) return previewPdfRun(pdfSurface, pdfInput.draft, pdfInput.picks);
    if (inputRun.state !== "present") return { entries: [], submissions: [], problem: null };
    if (rowCapability !== undefined) {
      const selected = selectedWorkbookRows?.choices ?? [];
      const value = previewWorkbookRows(inputRun.surface, selected, selected, typedValues);
      if (!rowSelectionFresh) return { ...value, submissions: [], problem: "Selected rows are out of date. Choose them again." };
      if (rowReference === undefined) return { ...value, submissions: [], problem: null };
      if (workbookRows.state !== "ready") return { ...value, submissions: [], problem: workbookRows.error ?? (workbookRows.state === "loading" ? "Loading saved spreadsheet rows." : "Saved rows are unavailable. Choose another version.") };
      return value;
    }
    return previewRunInput(inputRun.surface, text, typedValues,
      sourceInputUnchanged && snapshot?.source.runId === rerunSource?.runId && snapshot?.source.version === rerunSource?.expectedVersion && snapshot !== null ? rerunTypedSourceInput(inputRun.surface.typedInput, snapshot.sourceInput) : undefined);
  }, [inputRun, rowCapability, rowReference, selectedWorkbookRows, rowSelectionFresh, workbookRows.state, workbookRows.error, text, typedValues, snapshot, rerunSource, sourceInputUnchanged, pdfSurface, pdfInput.draft, pdfInput.picks]);



  /** Priority starts off when more than one person is entered, until the operator picks it. */
  const priority = launchDraft.effectivePriority(priorityChoice, preview.entries.length);
  /** The saved row the source run was started from, when it was started from one. */
  const sourceRow = snapshot?.spreadsheets?.flatMap(({ typeId, selectedRow }) => selectedRow === undefined || typeId !== referenceId ? [] : [{ typeId, row: selectedRow }])[0];
  /** The plan request for the draft on screen; the gates keep it from being asked for a draft that cannot plan. */
  const openStepKeys = new Set(openRows.flatMap(({ row }) => row.stepKey === undefined ? [] : [row.stepKey]));
  const buildPlanRequest = (): StartPlanRequest => {
    const values = snapshot === null ? null : pdfSurface === undefined ? rerunSubmission(snapshot, preview.submissions[0] ?? {}, valueDrafts)
      : { submission: preview.submissions[0], copiedFrom: [] };
    const copiedFrom = [...(values?.copiedFrom ?? []), ...Object.entries(copiedOmissions).flatMap(([index, copied]) => {
      const candidate = snapshot?.values[Number(index)];
      return copied && candidate?.state === "available" && candidate.targetStepKey !== undefined
        && openStepKeys.has(candidate.targetStepKey)
        ? [{ nodeId: candidate.nodeId, fieldPath: candidate.fieldPath, targetFieldPath: candidate.targetFieldPath, targetStepKey: candidate.targetStepKey }] : [];
    })];
    return StartPlanRequestSchema.parse({
      workflowId,
      submissions: values === null ? preview.submissions : [values.submission],
      ...(snapshot === null ? {} : { rerunSource: { runId: snapshot.source.runId, expectedVersion: snapshot.source.version,
        intent: "rerun", selectedStepKeys, copiedFrom }, ...(acknowledgment === undefined ? {} : { warningAcknowledgment: acknowledgment }) }),
      dryRun,
      browserMode,
      captureBrowserScreenshots,
      priority,
      ...(requiredTypes.length || checkSelections.length ? { workbookReferences: launchWorkbookReferences(requiredTypes, library.catalog, selectedReferences, values === null ? preview.submissions.length : 1,
        [...versionSources.sources, ...checkSelections],
        (workbookReference?.writableFields.length ?? 0) > 0,
        rowCapability !== undefined ? { typeId: rowCapability.typeId, rows: selectedWorkbookRows?.choices ?? [] } : sourceRow === undefined ? undefined : { typeId: sourceRow.typeId, rows: [sourceRow.row] },
        workbookCheck === undefined ? undefined : { typeId: workbookCheck.id, picks: checkSelections }) } : {}),
      selectedStepKeys,
      // Send omission facts only after every declared form parses.
      ...(customizeSteps && stepOmissions !== null && stepOmissions.length > 0 ? { stepOmissions } : {}),
    });
  };

  const referenceMissing = requiredTypes.some(typeId => selectedReferences[typeId] === undefined);
  const blockedReason = pdfSurface !== undefined ? pdfInput.loading ? "Reading PDFs…" : pdfInput.error !== null ? "Fix the refused PDF selection first." : preview.entries.length === 0 ? "Choose at least one PDF." : referenceMissing ? MISSING_REFERENCE_REASON : null : inputRun.state !== "present"
    ? inputRun.reason
    : preview.problem !== null
      ? preview.dateProblems === undefined ? "Fix the refused entry first." : "Fix the date first."
      : preview.entries.length === 0
        ? rowCapability === undefined ? "Type at least one value." : "Select at least one saved row."
        : referenceMissing
          ? MISSING_REFERENCE_REASON
          : null;
  const launchFields = pdfSurface === undefined ? [] : pdfRunLaunchFields(pdfSurface);
  const unpickedField = pdfSurface === undefined ? null : unpickedPdfRunField(pdfSurface, pdfInput.picks);
  /** A required launch field without a pick blocks planning from Options, where it is picked. */
  const optionsBlockedReason = unpickedField === null ? null : `Pick ${unpickedField.label}.`;
  const rerunInputBlocked = pdfSurface !== undefined ? blockedReason !== null : preview.problem !== null || preview.entries.length > 1 || (declaredInput && preview.entries.length === 0);
  /** Incomplete omitted-step facts block confirmation using the descriptor’s own schema refusal. */
  /** Omission facts describe one person; fan-out must not assert the same dates for multiple subjects. */
  const subjectCount = preview.entries.length;
  const multiSubject = subjectCount > 1;
  const multiSubjectOmissionReason = `Typed values fit one person; ${String(subjectCount)} are entered.`;
  /** The first thing wrong on the Steps stage: more than one person entered with typed values, else the first missing or invalid field. */
  const stepsFailure = !customizeSteps ? null : multiSubject && openRows.length > 0
    ? { text: multiSubjectOmissionReason, rowKey: "", fieldKey: "" } : firstStepsFailure(openRows);
  const stepsBlockedReason = stepsFailure?.text ?? null;
  /** A plan retaining different omissions describes another run; refuse its token. */
  const sentOmittedSteps = customizeSteps && stepOmissions !== null ? stepOmissions.map(({ step }) => step) : [];
  const planOmittedSteps = plan?.omittedSteps ?? [];
  const omissionMismatch = plan !== null && !sameStepKeys(planOmittedSteps, sentOmittedSteps);
  const stepLabel = (key: string): string => {
    const step = steps.find((candidate) => candidate.key === key);
    if (step === undefined) throw new Error(`the Steps screen named step "${key}", which this workflow does not declare`);
    return step.label;
  };
  const stepLabels = (keys: readonly string[]): string => keys.map(stepLabel).join(", ");
  const nextStage = adjacentRunStartStage(launchStages, currentStage, "next");
  const onLastStage = nextStage === null;
  const stepsShown = isRerun ? currentStage === "Steps" && snapshot !== null : currentStage === "Start" && customizeSteps;

  const changeCustomizeSteps = (next: boolean) => {
    setCustomizeSteps(next);
    update(current => ({ ...(next ? current : launchDraft.leaveCustomization(current, workflow)),
      stepSelection: { workflowId, keys: defaultStepKeys } }));
  };

  /** Use the shared cascade; locked omissions cannot be changed by another checkbox path. */
  const toggleRow = (row: StepRow, next: boolean) => {
    if (workflow !== undefined) update(current => launchDraft.toggleRow(current, workflow, snapshot, row, next));
  };
  const toggleManual = (row: StepRow, next: boolean) => update(current => launchDraft.toggleManual(current, snapshot, row, next));

  const changeFact = (row: StepRow, form: StepOmissionForm, field: string, next: StepOmissionFactDraft) =>
    update(current => launchDraft.changeFact(current, snapshot, row, form, field, next));
  /** The fields of a row still holding a value copied unedited from the earlier run. */
  const copiedFields = (row: StepRow): ReadonlySet<string> => new Set(Object.keys(copiedOmissions).flatMap(index => {
    const candidate = snapshot?.values[Number(index)];
    return candidate?.targetStepKey !== undefined && candidate.targetStepKey === row.stepKey ? [candidate.targetFieldPath] : [];
  }));


  const picker = <RunWorkflowPicker catalog={catalog} value={workflowId} locked={sending} onChange={pickWorkflow} query={pickerQuery} onQuery={setPickerQuery} />;
  const selectedLaunch = catalog.find(entry => entry.id === workflowId)?.launch;
  const launchRefusal = selectedLaunch?.state === 'unavailable' ? selectedLaunch.reason : undefined;

  const checkBusy = library.catalogRefreshing || library.compatibility === undefined;
  const checkHandlers = {
    onAdd: (libraryId: string) => { const sheet = checkSheets.find(candidate => candidate.libraryId === libraryId);
      if (sheet !== undefined) update(current => launchDraft.pickCheck(current, libraryId, { versionId: sheet.versionId, sheetIds: sheet.worksheets.slice(0, 1).map(worksheet => worksheet.sheetId) })); },
    onVersion: (libraryId: string, versionId: string) => update(current => launchDraft.pickCheck(current, libraryId, { versionId, sheetIds: [] })),
    onSheets: (libraryId: string, sheetIds: readonly string[]) => update(current => {
      const pick = current.checkPicks[libraryId];
      return pick === undefined ? current : launchDraft.pickCheck(current, libraryId, { versionId: pick.versionId, sheetIds });
    }),
    onRemove: (libraryId: string) => update(current => launchDraft.removeCheck(current, libraryId)),
  };
  const requiredLabelOf = (labels: readonly string[]) => labels.length > 1 ? `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}` : labels.join('');
  const referenceLoading = (description: string) => <div role="status" aria-label="Loading reference data"><RunList title="Spreadsheets" description={description}><RunListSkeleton rows={2} /></RunList></div>;
  /** The one Spreadsheets field: the reference spreadsheet a run looks people up in and, when the workflow allows, the extra spreadsheets it checks each person against. */
  const referenceControls = (types: readonly string[], withCheck: boolean) => {
    const check = withCheck && workbookCheck !== undefined ? { sheets: checkSheets, ...checkHandlers } : undefined;
    if (types.length === 0) return check === undefined ? undefined : library.catalogLoading ? referenceLoading("Spreadsheets this run also looks the person up in. Needs Employee ID. Optional.")
      : <RunSpreadsheets check={check} busy={checkBusy} locked={sending} catalogError={library.catalogError} onRefresh={() => void library.adapter.refreshCatalog()} />;
    if (library.catalogLoading) return referenceLoading(`Spreadsheets this run looks people up in. Needs ${requiredLabelOf(selectedWorkflow?.requiredWorkbookFields.map(id => spreadsheetField(id).label) ?? [])}.`);
    return <>{types.map(typeId => {
      const draft = referenceDrafts[typeId];
      const sheetOptions = versionSources.state === 'ready' ? versionSources.sources : [];
      const requiredFields = selectedWorkflow?.requiredWorkbookFields.map(id => spreadsheetField(id).label) ?? [];
      const sheets = library.catalog.filter(entry => entry.state.origin.kind === 'local' && !entry.state.removed).map(entry => ({ libraryId: entry.libraryId, name: entry.name, pinned: entry.state.pinned,
        versions: entry.state.versions.map((version, index) => ({ id: version.id, savedAt: version.savedAt, name: version.name || `v${entry.state.versions.length - index}` })), currentVersionId: entry.state.selectedVersionId, worksheets: referenceSources.filter(source => source.libraryId === entry.libraryId).map(source => source.sheetName) }));
      return <RunSpreadsheets key={typeId} check={check !== undefined && checkSheets.length > 0 ? check : undefined} busy={library.catalogRefreshing || library.compatibility === undefined} locked={sending} catalogError={library.catalogError}
        onRefresh={() => void library.adapter.refreshCatalog()}
        reference={{ requiredLabel: requiredLabelOf(requiredFields), sheets, chosenLibraryId: draft?.libraryId, chosenVersionId: draft?.versionId, chosenSheetId: selectedReferences[typeId]?.sheetId ?? '',
          worksheets: sheetOptions.map(source => ({ sheetId: source.sheetId, sheetName: source.sheetName })), worksheetsState: versionSources.state, worksheetsError: versionSources.error,
          onPick: (libraryId, versionId) => update(current => launchDraft.pickReference(current, typeId, libraryId, versionId)),
          onVersion: versionId => update(current => launchDraft.pickReferenceVersion(current, typeId, versionId)),
          onWorksheet: sheetId => {
            const source = sheetOptions.find(candidate => candidate.sheetId === sheetId);
            if (source !== undefined) update(current => launchDraft.pickWorksheet(current, typeId, { libraryId: source.libraryId, versionId: source.versionId, sheetId: source.sheetId }));
          },
          onRemove: () => update(current => launchDraft.removeReference(current, typeId)) }} />;
    })}</>;
  };
  /** The one thing that stops the operator, in the slot pinned under the stage tabs: a refused plan, unavailable checks or a failed PDF. */
  const planRefusal = onLastStage && plan !== null ? planRefusalNotice(plan.refused, preview.entries, isRerun) : null;
  const usesSpreadsheets = workbookReference !== undefined || workbookCheck !== undefined;
  const spreadsheetsError = isRerun && usesSpreadsheets && (Boolean(library.catalogError) || compatibilityMissing);
  const spreadsheetsReading = usesSpreadsheets && !spreadsheetsError && (library.catalogLoading || library.catalogRefreshing || library.compatibility === undefined
    || selectedDraft !== undefined && versionSources.state === "loading" || checkSheets.some(sheet => sheet.pickedSheetIds !== undefined && sheet.worksheetsState === "loading"));
  const reference = referenceId === undefined ? undefined : selectedReferences[referenceId];
  const spreadsheetGone = usesSpreadsheets && !spreadsheetsReading && !spreadsheetsError && (workbookReference !== undefined
    && !versionSources.sources.some(source => source.libraryId === reference?.libraryId && source.versionId === reference.versionId && source.sheetId === reference.sheetId)
    || checkSelections.length !== (snapshot?.spreadsheets ?? []).filter(pick => pick.typeId === workbookCheck?.id).length);
  const rerunInputGone = snapshot !== null && snapshot.source.workflow === workflowId && (spreadsheetGone || rerunInputBlocked
    || declaredInput && preview.submissions.length !== 1 || preview.entries.length === 0 && Object.keys(valueDrafts).length === 0);
  /** A dry source whose workflow has no dry run any more would run live. */
  const dryRunGone = snapshot?.source.dryRun === true && !supportsDryRun;
  const notice: { sentence: string; action?: { label: string; onClick: () => void; icon?: ReactNode } } | null = planRefusal !== null
    ? { sentence: planRefusal.sentence, ...(planRefusal.goesToQueue ? { action: { label: "Go to queue", icon: <ListChecks aria-hidden className={dsIcon.md} />, onClick: () => closeAndReset(false) } } : {}) }
    : rerunInputGone ? { sentence: RERUN_INPUT_GONE }
    : dryRunGone ? { sentence: "No dry run here; use Start run." }
    : spreadsheetsError ? { sentence: "Spreadsheets can't be checked.", ...(sending ? {} : { action: { label: "Retry", onClick: () => void library.adapter.refreshCatalog() } }) }
    : currentStage === "Input" && pdfSurface !== undefined && pdfInput.error !== null
    ? { sentence: pdfInput.error, ...(pdfInput.retryable && !sending ? { action: { label: "Retry", onClick: pdfInput.retry } } : {}) }
    : null;
  const gates: LaunchGates = {
    next: nextStage, inputBlocked: blockedReason !== null, stepsBlocked: stepsBlockedReason !== null, optionsBlocked: optionsBlockedReason !== null,
    rerunInputBlocked: rerunInputBlocked || rerunInputGone || dryRunGone || spreadsheetsError || spreadsheetsReading,
    checksBlocked: runChecksBlocked(checks.state),
    referencesUnavailable: checkPending || compatibilityMissing || requiredTypes.length > 0 && (library.catalogLoading || library.catalogRefreshing || Boolean(library.catalogError) || library.compatibility === undefined || versionSources.state !== "ready"),
    path: launchStages.map(stage => stage.label),
    omissionMismatch, plannedCount: plan?.planned.length ?? 0, ...(supportsDryRun ? { dryRun } : {}),
  };
  // A blocked Start on Steps stays pressable: pressing it shows the facts still missing.
  useKeepFocusInDialog(drawn);
  const controls = runDialogControls(view, gates, fingerprint);
  const primaryInput: RunDialogPrimaryInput = { gates, authority: authority(), planRequest: buildPlanRequest, prepare: target => launchService.prepareFinal(target) };
  const submit = !controls.primary.enabled ? null : () => {
    try { send(controls.primary.event(primaryInput)); }
    catch (caught) { setRequestProblem(caught instanceof Error ? caught.message : String(caught)); }
  };
  submitRef.current = submit;
  // A one-click rerun presses Start once, when its source, checks and spreadsheets are read; anything that stops it draws the dialog.
  const oneClickReady = open && !hidden && view.unattended === "waiting" && snapshot !== null && snapshot.source.workflow === workflowId
    && checks.state.state !== "checking" && !spreadsheetsReading;
  useEffect(() => {
    if (!oneClickReady) return;
    submitRef.current?.();
    send({ type: "attend" });
  }, [oneClickReady, send]);
  /** What a workflow's last stage still shows before Start: its chosen references and typed dates. */
  const lastStageFacts = [
    ...(typedDeclaration === undefined ? [] : typedDateControls(typedDeclaration, typedInputMode(typedDeclaration, typedValues)?.value ?? "").flatMap(control => {
      const date = typeof typedValues[control.field] === "string" ? usDateText(String(typedValues[control.field]).trim()) : undefined;
      return date === undefined ? [] : [{ key: control.label, value: date }];
    })),
    ...(pdfSurface === undefined ? [] : requiredTypes).flatMap(typeId => {
      const selection = selectedReferences[typeId];
      const chosen = library.catalog.find(entry => entry.libraryId === selection?.libraryId);
      if (selection === undefined || chosen === undefined) return [];
      const version = chosen.state.versions.find(entry => entry.id === selection.versionId)?.name;
      return [{ key: "Reference spreadsheet", value: version ? `${chosen.name} \u00b7 ${version}` : chosen.name }];
    }),
    ...launchFields.flatMap(field => { if (field.kind === "boolean") return []; const option = field.options.find(candidate => candidate.value === pdfInput.picks[field.field]); return option === undefined ? [] : [{ key: field.label, value: option.label }]; }),
  ];
  // Enter continues from a text field; it starts a run only when no control has focus. Every other control keeps Enter for itself, and Shift+Enter keeps its newline.
  const launchesRef = useRef(false);
  launchesRef.current = onLastStage;
  useEffect(() => {
    if (!drawn) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.repeat || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented || event.isComposing) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target === null || (target !== document.body && target.closest('[role="dialog"]') === null)) return;
      if (launchesRef.current && target !== document.body && !target.matches(".launch-dialog")) return;
      if (target.closest('a, button, select, input[type="radio"], input[type="checkbox"], [role="checkbox"], [role="switch"], [role="combobox"], [role="listbox"], [role="menu"], [role="option"]')) return;
      if (submitRef.current === null) return;
      event.preventDefault();
      submitRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [drawn]);
  /** The one thing stopping Continue or Start on this stage, as its own line beside the buttons. */
  const checksHint = gates.checksBlocked ? (checks.state.state === "ready" ? "Fix the failed checks first." : checks.state.state === "checking" ? "Checking…" : null) : null;
  const stageHint = currentStage === "Input" ? (compatibilityMissing ? null : blockedReason)
    : currentStage === "Steps" ? stepsBlockedReason
    : currentStage === "Start" ? optionsBlockedReason ?? stepsBlockedReason ?? checksHint ?? (planRefusal === null ? null : planRefusal.sentence.replace(/\. .*$/u, "."))
    : null;
  return (
    <Dialog open={drawn} onOpenChange={closeAndReset}>
      <DialogContent
        onOpenAutoFocus={event => { if (isRerun) { event.preventDefault(); (event.currentTarget as HTMLElement).querySelector<HTMLElement>('button[aria-label="Close"]')?.focus(); } }}
        onCloseAutoFocus={event => { if (hidden) event.preventDefault(); else onCloseAutoFocus?.(event); }}
        size="lg"
        title={isRerun ? "Rerun" : "Start run"}
        description={isRerun ? [workflow?.label, rerunSource?.label].filter(Boolean).join(" · ") : workflow ? workflow.label : "Choose a workflow to begin"}
        className={cn("launch-design launch-dialog", isRerun && "launch-rerun")}
      >
          {!isRerun && picker}

          {launchRefusal ? <><DialogBody><EmptyState title="Workflow unavailable" description={launchRefusal} /></DialogBody><DialogFooter><Button onClick={() => closeAndReset(false)}>Close</Button></DialogFooter></> : <>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <ol aria-label="Run configuration path" className="launch-stagebar">
              {launchStages.map((stage, index) => {
                const activeIndex = launchStages.findIndex(entry => entry.label === currentStage);
                const current = index === activeIndex;
                return <li key={stage.label} aria-current={current ? "step" : undefined}>
                  <BareButton disabled={index > activeIndex || busy || sending || recovery !== null} aria-label={`${stage.number} ${stage.label}`} className={dsFocus} onClick={() => send({ type: "go-to", stage: stage.label, via: "stage-bar" })}>
                  <span aria-hidden className="launch-stage-marker" data-current={current || undefined} data-completed={index < activeIndex || undefined}>{index < activeIndex ? <Check aria-hidden className={dsIcon.sm} /> : stage.number}</span>
                  <span className={cn("text-body", current ? "font-medium" : "text-ui-secondary")}>{stage.label}</span>
                  </BareButton>
                </li>;
              })}
            </ol>
            {notice !== null && <div className="shrink-0 border-b border-ui-stroke px-5 py-3"><FailureNotice {...notice} /></div>}
            {notice === null && draftKept && <p role="status" className="m-0 shrink-0 border-b border-ui-stroke px-5 py-2 text-caption text-ui-muted">Draft kept. Your earlier entries are still here.</p>}
          <DialogBody key={currentStage} className="launch-content @container">
            {isRerun && snapshot === null && sourceError === null && <p role="status">Loading source…</p>}
            {sourceError !== null && <Banner tone="danger" title="Rerun unavailable">{sourceError}</Banner>}
            {recoveryError !== null && <Banner tone="danger" title="Saved start unavailable">{recoveryError}</Banner>}
            {/* While the Start is in flight its outcome is not unknown yet; only a settled, unresolved command needs readback. */}
            {recovery !== null && !readback && !busy && (
              <Banner tone="warning" title="A previous submission needs readback">
                <MetaLine items={[workflows.find(candidate => candidate.workflowId === recovery.target.workflowId)?.label ?? "An earlier start"]} />
                <Button disabled={busy} onClick={() => send({ type: "replay", authority: authority() })}>Replay exact submission</Button>
              </Banner>
            )}
            {error !== null && (
              <Banner tone="danger" title="The request did not complete">{error}</Banner>
            )}

            <div className="flex min-w-0 flex-col gap-[var(--ds-space-loose)]">
              {!isRerun && currentStage === "Input" && compatibilityMissing && <FailureNotice sentence="Spreadsheets can't be checked." {...(sending ? {} : { action: { label: "Retry", onClick: () => void library.adapter.refreshCatalog() } })} />}
              {!isRerun && currentStage === "Input" && !compatibilityMissing && (
                <section aria-label="Input" className="flex min-h-0 flex-1 flex-col gap-[var(--ds-space-loose)]">
                  {pdfSurface !== undefined ? <>
                    <WorkflowPdfInput files={pdfInput.draft?.files.map(file => ({ name: file.source.fileName, size: file.source.artifact.bytes })) ?? []}
                      busy={busy || sending || pdfInput.loading} onChoose={files => { void pdfInput.choose(pdfSurface, files); }} onRemove={pdfInput.remove} onClear={pdfInput.clear} />
                  </> : inputRun.state === "present" ? (
                    <TypedInput
                      surface={inputRun.surface}
                      workflowId={workflowId}
                      text={text}
                      onText={next => update(current => launchDraft.changeText(current, next))}
                      preview={preview}
                      inputRef={typedInputRef}
                      autoFocus
                      draft={typedValues}
                      locked={sending}
                      rowInput={rowCapability === undefined ? undefined : <>
                        {referenceControls([rowCapability.typeId], true)}
                        {library.catalogRefreshing && <p role="status">Refreshing reference data. Row selection is disabled.</p>}
                        {workbookRows.state === "loading" && <div role="status" aria-label="Loading saved rows"><Skeleton className="h-9 w-full" /></div>}
                        {workbookRows.state === "error" && <Banner tone="danger" title="Saved rows unavailable">{workbookRows.error}<Button variant="secondary" disabled={sending} onClick={() => void library.adapter.refreshCatalog()}>Refresh reference data</Button></Banner>}
                        {!rowSelectionFresh && <Banner tone="warning" title="Previous row selection"><p>Selected rows are out of date.</p><Button variant="secondary" disabled={sending} onClick={() => update(launchDraft.clearWorkbookRows)}>Clear previous row selection</Button></Banner>}
                        {workbookRows.state === "ready" && rowChoices.length === 0 && <EmptyState title="No saved data rows" description="This version has only headers." />}
                        {rowChoices.length > 0 && <Table label="Saved spreadsheet rows"><THead><TR><TH>Select</TH><TH>Source row</TH><TH>Lookup key</TH></TR></THead><TBody>{rowChoices.map(choice => {
                          const selected = selectedWorkbookRows?.choices.some(row => row.sheetId === choice.sheetId && row.rowId === choice.rowId) ?? false;
                          const label = `${choice.sourceLabel}: ${choice.key.state === "available" ? choice.key.value : WORKBOOK_ROW_UNAVAILABLE_TEXT[choice.key.reason]}`;
                          return <TR key={JSON.stringify([choice.sheetId, choice.rowId])} selected={selected}><TD><Checkbox label={<span className="sr-only">{`Select ${label}`}</span>} checked={selected}
                            disabled={workbookRows.state !== "ready" || !rowSelectionFresh || choice.key.state === "unavailable" || recovery !== null || sending}
                            onCheckedChange={checked => update(current => launchDraft.selectWorkbookRows(current, rowSource,
                              resolveWorkbookRowSelection(workbookRows.choices, checked === true ? [...(current.selectedWorkbookRows?.choices ?? []), choice] : (current.selectedWorkbookRows?.choices ?? []).filter(row => row.sheetId !== choice.sheetId || row.rowId !== choice.rowId))))} /></TD>
                            <TD>{choice.sourceLabel}</TD><TD className="break-all">{choice.key.state === "available" ? choice.key.value : WORKBOOK_ROW_UNAVAILABLE_TEXT[choice.key.reason]}</TD></TR>;
                        })}</TBody></Table>}
                      </>}
                      onValue={(field, value) => { if (workflow !== undefined) update(current => launchDraft.changeTypedValue(current, workflow, field, value)); }}
                    />
                  ) : (
                    <Well>
                      <EmptyState
                        className="p-[var(--ds-space-base)]"
                        icon={<Keyboard aria-hidden className={dsIcon.lg} />}
                        title="No typed start for this workflow"
                        description={inputRun.reason}
                      />
                    </Well>
                  )}
                  {referenceControls(requiredTypes.filter(typeId => typeId !== rowCapability?.typeId), rowCapability === undefined)}
                </section>
              )}

              {onLastStage && warning !== null && (
                <section aria-label="Repeat transaction warning" className="flex flex-col gap-[var(--ds-space-cozy)]">
                  <Banner tone="warning" title="These transactions were already submitted">
                    Running them again may create duplicates.
                  </Banner>
                  {warning.rerun.warnings.map((entry) => {
                    const step = snapshot?.steps.find((candidate) => candidate.nodes.some((node) => node.nodeId === entry.nodeId));
                    if (step === undefined) throw new Error("RERUN_WARNING_STEP_UNAVAILABLE");
                    return <Well key={`${entry.nodeId}:${entry.writeIntentId}`}>
                      <KeyValueList items={[{ key: "Step", value: <span className="font-[family-name:var(--ds-font-body)]">{stepLabel(step.key)}</span> }, { key: "System", value: <span className="font-[family-name:var(--ds-font-body)]">{SYSTEM_NAME[entry.system]}</span> }]} />
                    </Well>;
                  })}
                </section>
              )}

              {currentStage === "Start" && (
                <RunOptionsLayout locked={sending} priority={priority} onPriorityChange={next => update(current => launchDraft.changePriority(current, next))} browserMode={browserMode} onBrowserModeChange={next => update(current => launchDraft.changeBrowserMode(current, next))}
                  flags={<>
                    {!isRerun && <RunListRow title="Customize steps" description="Choose optional steps."><Switch hideLabel disabled={sending} label="Customize steps" checked={customizeSteps} onCheckedChange={next => changeCustomizeSteps(next === true)} className="!min-h-0 !w-auto !py-0" /></RunListRow>}
                    {!isRerun && supportsDryRun && <RunListRow title="Dry run" description={dryRunDescription}><Switch hideLabel disabled={sending} label="Dry run" checked={dryRun} onCheckedChange={next => update(current => launchDraft.changeDryRun(current, next === true))} className="!min-h-0 !w-auto !py-0" /></RunListRow>}
                    {launchFields.map(field => field.kind === "boolean"
                      ? <RunListRow key={field.field} title={field.label} {...(field.description === undefined ? {} : { description: field.description })}><Switch hideLabel disabled={sending} label={field.label} checked={pdfRunSwitchValue(field, pdfInput.picks)} onCheckedChange={next => pdfInput.pick(field.field, next === true)} className="!min-h-0 !w-auto !py-0" /></RunListRow>
                      : <RunListRow key={field.field} title={field.label}><RunChoice locked={sending} label={field.label} value={pdfRunSelectValue(field, pdfInput.picks)} onChange={value => pdfInput.pick(field.field, value)} options={field.options} /></RunListRow>)}
                  </>} />
              )}

              {stepsShown && workflow !== undefined && (
                <section aria-labelledby="run-start-steps" className="flex flex-col gap-[var(--ds-space-cozy)]">
                  <div className="flex items-baseline justify-between gap-3">
                    <h4 id="run-start-steps" className="m-0 text-[length:var(--ds-row-heading)] font-normal leading-[var(--ds-row-heading-lh)] text-[color:var(--ds-fg)]">Steps</h4>
                    <span className="text-caption text-ui-muted">{includedRowCount(rows, selectedStepKeys, manualRows)} of {rows.length} included</span>
                  </div>
                  <p className="m-0 text-caption text-ui-secondary">{isRerun ? "Choose steps. Status shows the earlier result." : "Replace reading steps with manual values. Form actions stay included."}</p>
                  <RunList label="Steps">
                    {rows.map((row) => {
                      const included = rowIncluded(row, selectedStepKeys, manualRows);
                      const forcedBy = row.stepKey === undefined ? [] : forcedByStep.get(row.stepKey) ?? [];
                      const open = openRows.find(candidate => candidate.row.key === row.key);
                      const badge = isRerun && snapshot !== null ? sourceBadge(row, snapshot) : undefined;
                      const oneSubjectOnly = multiSubject && row.form !== undefined && included;
                      const disabled = forcedBy.length > 0 || inputDriven(row) || sending || lastIncludedSwitch(row, rows, selectedStepKeys, manualRows) || oneSubjectOnly;
                      const note = forcedBy.length > 0 ? `Omitted with ${stepLabels(forcedBy)}.`
                        : oneSubjectOnly ? "One person only." : row.note;
                      const failure = stepsFailure !== null && stepsFailure.rowKey === row.key ? { [stepsFailure.fieldKey]: stepsFailure.text } : {};
                      return <RunListRow key={row.key} title={row.label} description={note}
                        {...(row.kind === "switch" ? { check: { checked: included, disabled, onChange: next => toggleRow(row, next) } } : { locked: true })}
                        below={open === undefined ? undefined : <StepOmissionFactsForm step={row.label} form={open.form} draft={open.draft} errors={failure}
                          copied={copiedFields(row)} onChange={(field, next) => changeFact(row, open.form, field, next)} disabled={sending} />}>
                        {badge !== undefined && <Badge tone={badge === "completed" ? "success" : badge === "failed" ? "danger" : "neutral"} className="launch-step-status" data-status={badge}>{badge === "completed" ? "Completed" : badge === "skipped" ? "Skipped" : badge === "failed" ? "Failed" : "Not started"}</Badge>}
                        {row.kind === "locked-manual" && <>
                          <Switch label={<>Enter manually<span className="sr-only"> for {row.label}</span></>} checked={manualRows.includes(row.key)} disabled={sending || multiSubject && !manualRows.includes(row.key)} onCheckedChange={next => toggleManual(row, next)} className="!min-h-0 !w-auto !py-0" /></>}
                      </RunListRow>;
                    })}
                  </RunList>
                  {stepsFailure !== null && stepsFailure.rowKey === "" && <p role="alert" className="text-caption text-ui-danger">{stepsFailure.text}</p>}
                </section>
              )}

              {currentStage === "Start" && <RunChecksStage checks={checks.state} onFix={fixCheck} onRecheck={checks.recheck} />}

              {onLastStage && lastStageFacts.length > 0 && <KeyValueList items={lastStageFacts} />}

              {onLastStage && plan !== null && (
                <section id="run-start-plan" aria-label="Plan" className="flex flex-col gap-[var(--ds-space-cozy)]">
                  {expiredPlan && <p className="text-body text-ui-secondary">The plan expired and was rebuilt. Review it again.</p>}
                  {omissionMismatch && (
                    <Banner tone="danger" title="This plan does not describe the steps you omitted">
                      {`You omitted ${sentOmittedSteps.length === 0 ? "no steps" : sentOmittedSteps.join(", ")}; the plan came back omitting `
                        + `${planOmittedSteps.length === 0 ? "no steps" : planOmittedSteps.join(", ")}. `
                        + "Go back and plan again."}
                    </Banner>
                  )}
                </section>
              )}
            </div>
          </DialogBody>
          </div>

        <DialogFooter
          meta={
            <MetaLine
              tone="faint"
              items={[
                workflow?.label,
                workflow === undefined ? undefined : `${includedRowCount(rows, selectedStepKeys, manualRows)} of ${rows.length} steps`,
                pdfSurface === undefined ? undefined : pdfRunOcrFooter(pdfSurface, pdfInput.picks),
                priority === "interactive" ? "Priority" : undefined,
              ].filter((item): item is string => item !== undefined)}
            />
          }
        >
          {stageHint !== null && <span className="launch-hint">{stageHint}</span>}
          {controls.back !== null && (
            <Button variant="secondary" disabled={sending} icon={<ArrowLeft aria-hidden className={dsIcon.sm} />} onClick={() => send({ type: "go-to", stage: controls.back as RunStartStage, via: "back", path: gates.path })}>Back</Button>
          )}
          <Button variant="secondary" onClick={() => closeAndReset(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            {...(onLastStage ? { icon: <Play aria-hidden className={dsIcon.md} /> } : { iconAfter: <ArrowRight aria-hidden className={dsIcon.md} /> })}
            loading={controls.primary.loading}
            disabled={submit === null}
            onClick={() => submit?.()}
          >
            {controls.primary.label}
          </Button>
        </DialogFooter>
        </>}
      </DialogContent>
    </Dialog>
  );
}

/** Mount the launcher at the shell root so views without queue toolbars can still start runs. */
export function RunStartSurfaces({
  open,
  onOpenChange,
  catalog,
  panelWorkflowId,
  actorId,
  onApplied,
  onOpenIntake,
  onCloseAutoFocus,
  hidden,
  onFixCheck,
  rerunSource,
  rerunInputText,
  rerunInOneClick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hidden?: boolean;
  onFixCheck?: (section: string, target?: string) => void;
  catalog: readonly WorkflowCatalogEntry[];
  panelWorkflowId: string;
  actorId: string;
  onApplied?: (workflowId: string, count?: number, runId?: string) => void;
  onOpenIntake: (workflowId: string, intakeSessionId: string) => void;
  onCloseAutoFocus?: (event: Event) => void;
  rerunSource?: RerunLaunchSource;
  rerunInputText?: string;
  rerunInOneClick?: boolean;
}) {
  return (
    <RunStartDialog
      open={open}
      onOpenChange={onOpenChange}
      catalog={catalog}
      panelWorkflowId={panelWorkflowId}
      actorId={actorId}
      onApplied={onApplied}
      onOpenIntake={onOpenIntake}
      onCloseAutoFocus={onCloseAutoFocus}
      hidden={hidden}
      onFixCheck={onFixCheck}
      rerunSource={rerunSource}
      rerunInputText={rerunInputText}
      rerunInOneClick={rerunInOneClick}
    />
  );
}
