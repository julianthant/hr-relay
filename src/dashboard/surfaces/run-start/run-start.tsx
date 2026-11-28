import type { IconName } from "../../../models/workflow/presentation.js";
import { RunList, RunListRow } from "../../ds/primitives/run-list.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../models/failures/error-catalog.js";
import { useViewNavigation, useViewState } from "../../app/navigation/view-route-model.js";
import { servedLaunchWorkflows, type WorkflowCatalogEntry } from "../workflows/workflow-catalog-model.js";
import "./launch-presentation.css";
import { RunChoice, RunOptionsLayout } from "./run-launch-layout.js";
import { RunWorkflowPicker } from "./run-start-picker.js";
import { RunChecksStage } from "./run-checks.js";
import { FailureNotice } from "../../ds/primitives/failure-notice.js";
import { failedCheckSentence, useRunChecks, type RunCheckRow } from "./run-checks-model.js";

import { readLaunchRecovery, readLaunchVerificationPlan, retainLaunchFinal, dismissLaunchRecovery } from "./run-launch-recovery.js";
import { createRunLaunchService, type RerunLaunchSource } from "./run-launch-model.js";
import * as launchDraft from "./run-launch-draft-model.js";
import type { LaunchDraft } from "./run-launch-draft-model.js";
import { useKeepFocusInDialog } from "./run-dialog-focus.js";
import { heldFingerprint, runDialogControls, shownRepeatWarning, useRunDialogMachine, visibleRunDialog, type AuthorityCheck, type LaunchRecovery, type RunDialogPrimaryInput } from "./run-dialog-model.js";
/** Descriptor-driven launch UI; server planning and durable command recovery own admission. */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, CircleAlert, ListChecks, Play } from "lucide-react";
import { cn } from "../../lib/utils.js";
import { useToasts, BareButton, Banner, Button, Switch, Dialog, DialogBody, DialogContent, DialogFooter, EmptyState, KeyValueList, MetaLine, dsFocus, dsIcon } from "../../ds/ui.js";

import { runStartRefusalToast, sampleRunRefusalToast } from "../../app/commands/command-result.js";
import { type InputRunSurface, type UploadRunSurface } from "../../../models/workflow/ingress.js";
import type { WorkflowModuleRole } from "../../../workflow-kit/validation/module-role.js";
import type { EnqueuePolicy } from "../../../models/workflow/presentation.js";

import { useDashboardCommandBinding, useDashboardClient } from "../../state/client-context.js";
import type { WorkflowStartWire } from "../../../models/dashboard/bootstrap.js";
import { SYSTEM_NAME } from "../shared/status/system-chip-model.js";
import { planRefusalNotice, forcedStepOmissions, handOffStepOmissions, initialStepOmissionDraft, stoppedStepOmissions, typedInputDefaults, typedInputMode, typedDateControls, usDateText, typedControlAvailable } from "./run-start-model.js";
import { includedRowCount, rowFieldsOpen, rowOpenFold, startRowsOf, stepEntries, type OpenStepRow, type StartStep, type StepRow } from "./run-steps-model.js";
import { reconcileRunStartStage, runStartStages } from "./run-start-timeline.js";
import { pdfRunOcrFooter, pdfRunRequiresOcr, pdfRunSelectValue, pdfRunSwitchValue, restorePdfRun, usePdfRunInput } from "./run-start-pdfs.js";
import { RunStartInput } from "./run-start-input.js";
import { RunStartSteps } from "./run-start-steps.js";
import { runStartGates, runStartPlanRequest, runStartRequestFingerprint, useRunStartInputPreview } from "./run-start-request-model.js";
import { runStartSpreadsheetReadiness, useRunStartSpreadsheets, useRunStartWorkbookRows } from "./run-start-spreadsheets-model.js";

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
}

function sameDefinition(left: RunStartWorkflow, right: RunStartWorkflow | undefined): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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

const offersOcrReadings = ({ form }: Pick<StepRow, "form">): boolean => form?.fields.some(field =>
  field.kind === "text-list" && field.format === "ocr-document-readings") === true;

/** Restore intake focus to its launcher; it is the control that opened the workspace. */

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
  const lastOpenedWorkflow = useRef(workflowId);
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
  const { stepDrafts, manualRows, priority: priorityChoice, dryRunRequested, browserMode, referenceSelections, copiedOmissions } = draft;
  const typedDraft = launchDraft.typedDraftOf(draft, workflowId, workflows.find(entry => entry.workflowId === workflowId), commandBinding?.authority.today);
  const spreadsheets = useRunStartSpreadsheets(open, workflows, workflowId, client, commandBinding, draft, update);
  const { library, selectedWorkflow, requiredTypes, compatibilityMissing } = spreadsheets;
  const [customizeSteps, setCustomizeSteps] = useViewState("launchCustomize", false);
  const customizedStepKeys = useMemo(() => [...launchDraft.selectedStepKeys(draft, selectedWorkflow)], [draft, selectedWorkflow]);
  const captureBrowserScreenshots = true;

  const workflow = workflows.find((entry) => entry.workflowId === workflowId);

  const inputRun = workflow?.inputRun ?? NO_WORKFLOW_SELECTED;
  const pdfSurface = draft.interruptedRerun || workflow?.uploadRun?.pdfInput === undefined ? undefined : workflow.uploadRun;
  const typedDeclaration = inputRun.state === "present" ? inputRun.surface.typedInput : undefined;
  const declaredInput = typedDeclaration !== undefined;
  const typedValues = useMemo(() => {
    if (typedDeclaration === undefined) return typedDraft;
    const values = { ...typedInputDefaults(typedDeclaration), ...typedDraft };
    if (draft.interruptedRerun) return values;
    for (const step of workflow?.steps ?? []) {
      const control = step.control;
      if (control.state === "selectable" && typedDeclaration.controls.some(field => field.field === control.inputField && field.placement === "step"))
        values[control.inputField] = typedControlAvailable(typedDeclaration, values, control.inputField) && (customizeSteps || isRerun ? customizedStepKeys.includes(step.key) : step.includedByDefault);
    }
    return values;
  }, [typedDeclaration, typedDraft, workflow, customizeSteps, isRerun, customizedStepKeys, draft.interruptedRerun]);
  const defaultStepKeys = useMemo(() => workflow?.steps.filter(step => {
    const control = step.control;
    return declaredInput && control.state === "selectable"
      ? typedValues[control.inputField] === true
      : step.includedByDefault;
  }).map(step => step.key) ?? [], [workflow, declaredInput, typedValues]);
  const steps = workflow?.steps ?? EMPTY_STEPS;
  const requestedStepKeys = customizeSteps || isRerun ? customizedStepKeys : defaultStepKeys;
  const stoppedByStep = useMemo(() => draft.interruptedRerun ? new Map<string, readonly string[]>() : stoppedStepOmissions(steps, requestedStepKeys),
    [draft.interruptedRerun, steps, requestedStepKeys]);
  const selectedStepKeys = useMemo(() => stoppedByStep.size === 0 ? requestedStepKeys : requestedStepKeys.filter(key => !stoppedByStep.has(key)),
    [requestedStepKeys, stoppedByStep]);
  const savedRows = useRunStartWorkbookRows(spreadsheets, draft, client, commandBinding, open, isRerun, actorId, workflowId, workflow, inputRun);
  const supportsDryRun = (inputRun.state === "present" && inputRun.surface.supportsDryRun === true) || workflow?.uploadRun?.supportsDryRun === true;
  const dryRunDescription = pdfSurface?.supportsDryRun === true
    ? "Fill and check every step without submitting or saving."
    : "Fill and check every step without submitting.";
  const dryRun = supportsDryRun && dryRunRequested;
  const launchStages = useMemo(() => runStartStages(isRerun, customizeSteps), [isRerun, customizeSteps]);

  useEffect(() => {
    setCurrentStage((current) => reconcileRunStartStage(launchStages, current));
  }, [launchStages, setCurrentStage]);

  /** Lock forced omissions using the descriptor cascade; the planner owns the rule. */
  const forcedByStep = useMemo(() => new Map([...forcedStepOmissions(steps, selectedStepKeys), ...stoppedByStep]), [steps, selectedStepKeys, stoppedByStep]);
  const handOffByStep = useMemo(() => handOffStepOmissions(steps, selectedStepKeys), [steps, selectedStepKeys]);
  const rows = useMemo(() => startRowsOf({ steps, rows: workflow?.rows }), [steps, workflow?.rows]);
  const inputDriven = useCallback((row: StepRow): boolean => launchDraft.rowInputDriven(workflow, typedValues, row), [workflow, typedValues]);
  const openRowDrafts = useMemo(() => customizeSteps && !draft.interruptedRerun ? rows.flatMap(row => {
    if (row.form === undefined || inputDriven(row) || !rowFieldsOpen(row, selectedStepKeys, manualRows)) return [];
    return [{ row, form: row.form, draft: stepDrafts[row.key] ?? initialStepOmissionDraft(row.form) }];
  }) : [], [customizeSteps, rows, selectedStepKeys, manualRows, stepDrafts, inputDriven, draft.interruptedRerun]);
  const requestFingerprint = runStartRequestFingerprint(draft, spreadsheets, savedRows, pdfInput, rerunSource, workflowId, typedValues,
    customizeSteps, dryRun, captureBrowserScreenshots, selectedStepKeys, openRowDrafts);
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
  /** The workflow the rerun draft was restored for. */
  const restoredFor = useRef<RunStartWorkflow | undefined>(undefined);
  const { state: machine, send } = useRunDialogMachine({
    stage: currentStage,
    setStage: next => { if (!suppressStage.current) setCurrentStage(next); },
    fingerprint: requestFingerprint,
    effects: {
      loadSource: async source => {
        const response = await launchService.openRerun({ runId: source.runId, expectedVersion: source.expectedVersion });
        if (response.state === "refused" && response.code === "sample-run") {
          // A sample run never reruns: say so in a toast and close, never as the dialog's banner.
          toast(sampleRunRefusalToast());
          onOpenChange(false);
        }
        if (response.state === "refused") throw new Error(`Rerun unavailable: ${response.code}`);
        return response.snapshot;
      },
      restoreSource: restored => {
        const sourceWorkflow = workflowsRef.current.find(entry => entry.workflowId === restored.source.workflow);
        if (sourceWorkflow === undefined) throw new Error("RERUN_WORKFLOW_UNAVAILABLE");
        if (restored.retainedSteps === undefined && sourceWorkflow.uploadRun?.pdfInput !== undefined) {
          const pdfs = restored.sourceInput.state === "available" ? restorePdfRun(sourceWorkflow.uploadRun, restored.sourceInput.value, actorId) : null;
          if (pdfs === null) throw new Error(RERUN_INPUT_GONE);
          pdfInput.restore(pdfs);
        }
        const next = launchDraft.restoreRerunDraft(restored, sourceWorkflow, rerunInputText);
        restoredFor.current = sourceWorkflow;
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
  const filedBySource = snapshot?.transactions.filter(entry => entry.filedBySource) ?? [];
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
  const openedFor = useRef<Readonly<{ source: RerunLaunchSource; text: string | undefined; service: object }> | undefined>(undefined);
  const [opened, setOpened] = useState<RerunLaunchSource>();
  const unattended = useRef(view.unattended);
  unattended.current = view.unattended;
  const held = useRef({ sending, failed: sourceError !== null });
  held.current = { sending, failed: sourceError !== null };
  const fromRerun = useRef(false);
  const keptPending = useRef(false);
  useEffect(() => { if (!open) { openedFor.current = undefined; setOpened(undefined); } }, [open]);
  /** Nothing is drawn while a one-click rerun goes on by itself. */
  const drawn = open && !hidden && view.unattended === undefined && !(rerunInOneClick && opened !== rerunSource);

  // Opening lands on the panel you are standing in, every time — including the
  // second time, which is why this keys on `open` rather than running once.
  useEffect(() => {
    if (!open) return;
    // A refresh under a rerun already open keeps its draft and its requests. A source that failed, or whose workflow changed, is read again once no command is out.
    const previous = openedFor.current, restored = restoredFor.current;
    const reopened = previous !== undefined && previous.source === rerunSource && previous.text === rerunInputText && previous.service === launchService;
    const changed = restored !== undefined && !sameDefinition(restored, workflows.find(entry => entry.workflowId === restored.workflowId));
    if (reopened && (held.current.sending || !held.current.failed && !changed)) return;
    resetPdfs();
    setPickerQuery("");
    // Landing on another workflow clears the draft, so there is nothing kept to announce.
    if (lastOpenedWorkflow.current !== (routed ? selectedWorkflowRef.current : defaultWorkflowId(workflows, panelWorkflowId))) keptPending.current = false;
    if (!routed && selectedWorkflowRef.current !== defaultWorkflowId(workflows, panelWorkflowId)) selectWorkflow(defaultWorkflowId(workflows, panelWorkflowId), true);
    // The Start run doors name the workflow, so an open can land on another one than the last: its draft starts clean.
    if (lastOpenedWorkflow.current !== selectedWorkflowRef.current) update(current => launchDraft.changeWorkflow(current, workflows.find(entry => entry.workflowId === selectedWorkflowRef.current), commandBindingRef.current?.authority.today));
    lastOpenedWorkflow.current = selectedWorkflowRef.current;
    update(current => ({ ...current, valueDrafts: {}, copiedOmissions: {}, sourceInputUnchanged: false,
      ...(rerunSource === undefined ? {} : { typed: { workflowId: "", draft: {} }, text: "" }) }));
    let recoveryState: LaunchRecovery;
    try {
      const retained = readLaunchRecovery(window.sessionStorage, actorId);
      recoveryState = retained === null ? { state: "none" } : { state: "retained", command: retained };
    } catch { recoveryState = { state: "unreadable", message: "Relay cannot send the saved start again. Check the queue first." }; }
    if (rerunSource !== undefined) setCustomizeSteps(true);
    else if (fromRerun.current) {
      setCustomizeSteps(false);
      update(() => launchDraft.freshLaunchDraft(workflows.find(entry => entry.workflowId === selectedWorkflowRef.current), commandBindingRef.current?.authority.today));
    }
    fromRerun.current = rerunSource !== undefined;
    // A start keeps the routed stage; only a rerun opens on its own first stage.
    suppressStage.current = rerunSource === undefined;
    try { send({ type: "open", recovery: recoveryState, ...(rerunSource === undefined ? {} : { rerun: rerunSource,
      // A dialog already open for this rerun starts over by itself only while nothing was asked for.
      unattended: rerunInOneClick && (previous?.source !== rerunSource || unattended.current === "waiting") }) }); }
    finally { suppressStage.current = false; }
    openedFor.current = rerunSource === undefined ? undefined : { source: rerunSource, text: rerunInputText, service: launchService };
    restoredFor.current = undefined;
    setOpened(rerunSource);
  }, [open, workflows, panelWorkflowId, selectWorkflow, rerunSource, rerunInputText, rerunInOneClick, actorId, launchService, routed, setCustomizeSteps, resetPdfs, update, send]);

  /** Closing without starting keeps the draft; the next open says so for a few seconds. */
  const [draftKept, setDraftKept] = useState(false);
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

  const pickWorkflow = useCallback((id: string) => {
    if (selectedWorkflowRef.current === id || sending) return;
    const entry = catalog.find(flow => flow.id === id);
    if (!entry || entry.launch.state === "unavailable") return;
    selectedWorkflowRef.current = id;
    if (entry.served) {
      // A pick starts a clean draft here, so a later reopen on it keeps what was typed and there is nothing kept to announce now.
      lastOpenedWorkflow.current = id;
      setDraftKept(false);
      send({ type: "pick-workflow" });
      selectWorkflow(id);
    }
  }, [catalog, selectWorkflow, send, sending]);

  const typedOcr = openRowDrafts.some(offersOcrReadings);
  const ocrChoicePending = !isRerun && customizeSteps && currentStage === "Start" && rows.some(offersOcrReadings);
  const requiresOcr = !typedOcr && !ocrChoicePending && pdfSurface !== undefined && pdfRunRequiresOcr(pdfSurface, pdfInput.draft, pdfInput.picks, selectedStepKeys);
  const checks = useRunChecks(client, workflow?.workflowId, open && !hidden, currentStage === "Start" || (!isRerun && currentStage === "Steps"), open, requiresOcr);
  /** The check whose Fix opened Settings; once the checks are re-read after the return, its row takes focus again. */
  const fixedCheck = useRef<{ check: string; reread: boolean } | null>(null);
  const fixCheck = (item: RunCheckRow) => {
    if (item.fix === undefined || onFixCheck === undefined) return;
    fixedCheck.current = { check: item.check, reread: false };
    checks.prepareAfterFix();
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

  const preview = useRunStartInputPreview(draft, savedRows, inputRun, typedValues, snapshot, rerunSource, pdfSurface, pdfInput);
  const openRows: readonly OpenStepRow[] = useMemo(() => openRowDrafts.map(({ row, form, draft }) =>
    rowOpenFold(row, form, draft, { submissions: preview.submissions })),
    [openRowDrafts, preview.submissions]);
  const stepOmissions = useMemo(() => stepEntries(openRows), [openRows]);

  /** Priority starts off when more than one person is entered, until the operator picks it. */
  const priority = launchDraft.effectivePriority(priorityChoice, preview.entries.length);
  const buildPlanRequest = runStartPlanRequest(draft, spreadsheets, savedRows, { workflowId, snapshot, acknowledgment,
    pdfSurface, preview, selectedStepKeys, customizeSteps, openRows, stepOmissions, dryRun, captureBrowserScreenshots, priority });
  const spreadsheetReadiness = runStartSpreadsheetReadiness(spreadsheets, referenceSelections, isRerun, snapshot);
  const { spreadsheetsError, spreadsheetsReading } = spreadsheetReadiness;
  const handOff = [...handOffByStep.keys()].map(key => rows.find(row => row.stepKey === key)?.label ?? steps.find(step => step.key === key)?.label ?? key);
  const handOffReason = draft.interruptedRerun || handOff.length === 0 ? null : `Turn off ${handOff.join(", ")} if done by hand.`;
  const { gates, blockedReason, launchFields, optionsBlockedReason, multiSubject, stepsFailure, stepsBlockedReason,
    sentOmittedSteps, planOmittedSteps, omissionMismatch, onLastStage, rerunInputGone, dryRunGone } = runStartGates(
    draft, spreadsheets, savedRows, spreadsheetReadiness, { workflowId, inputRun, pdfSurface, pdfInput, preview, declaredInput,
      openRows, customizeSteps, stepOmissions, handOffReason, plan, snapshot, supportsDryRun, dryRun, checks, launchStages, currentStage });

  const stepLabel = (key: string): string => {
    const step = steps.find((candidate) => candidate.key === key);
    if (step === undefined) throw new Error(`the Steps screen named step "${key}", which this workflow does not declare`);
    return step.label;
  };
  const stepsShown = currentStage === "Steps" && (isRerun ? snapshot !== null : customizeSteps);

  const changeCustomizeSteps = (next: boolean) => {
    setCustomizeSteps(next);
    update(current => ({ ...(next ? current : launchDraft.leaveCustomization(current, workflow)),
      stepSelection: { workflowId, keys: defaultStepKeys } }));
  };

  const selectedLaunch = catalog.find(entry => entry.id === workflowId)?.launch;
  const launchRefusal = selectedLaunch?.state === 'unavailable' ? selectedLaunch.reason : undefined;

  /** The one thing that stops the operator, in the slot pinned under the stage tabs: a refused plan, unavailable checks or a failed PDF. */
  const planRefusal = onLastStage && plan !== null ? planRefusalNotice(plan.refused, preview.entries, isRerun) : null;
  const notice: { sentence: string; action?: { label: string; onClick: () => void; icon?: ReactNode } } | null = planRefusal !== null
    ? { sentence: planRefusal.sentence, ...(planRefusal.goesToQueue ? { action: { label: "Go to queue", icon: <ListChecks aria-hidden className={dsIcon.md} />, onClick: () => closeAndReset(false) } } : {}) }
    : rerunInputGone ? { sentence: RERUN_INPUT_GONE }
    : dryRunGone ? { sentence: "No dry run here; use Start run." }
    : spreadsheetsError ? { sentence: "Spreadsheets can't be checked.", ...(sending ? {} : { action: { label: "Retry", onClick: () => void library.adapter.refreshCatalog() } }) }
    : currentStage === "Input" && pdfSurface !== undefined && pdfInput.error !== null
    ? { sentence: pdfInput.error, ...(pdfInput.retryable && !sending ? { action: { label: "Retry", onClick: pdfInput.retry } } : {}) }
    : null;
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
    ...(draft.interruptedRerun || typedDeclaration === undefined ? [] : typedDateControls(typedDeclaration, typedInputMode(typedDeclaration, typedValues)?.value ?? "").flatMap(control => {
      const date = typeof typedValues[control.field] === "string" ? usDateText(String(typedValues[control.field]).trim()) : undefined;
      return date === undefined ? [] : [{ key: control.label, value: date }];
    })),
    ...(pdfSurface === undefined ? [] : requiredTypes).flatMap(typeId => {
      const selection = referenceSelections[typeId];
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
  const planHint = planRefusal === null ? null : planRefusal.sentence.replace(/\. .*$/u, ".");
  // With nothing entered yet, the off button and the empty input say enough.
  const nothingEntered = preview.entries.length === 0 && preview.problem === null && !pdfInput.loading;
  const stageHint = currentStage === "Input" ? (compatibilityMissing || nothingEntered ? null : blockedReason)
    : currentStage === "Steps" ? stepsBlockedReason ?? (onLastStage ? planHint : null)
    : currentStage === "Start" ? optionsBlockedReason ?? (onLastStage ? stepsBlockedReason ?? planHint : null)
    : null;
  /** The last stage and Start show the checks, so only there do they speak in the footer. */
  const checksShown = onLastStage || currentStage === "Start";
  const failedChecks = checksShown ? failedCheckSentence(checks.state) : undefined;
  return (
    <Dialog open={drawn} onOpenChange={closeAndReset}>
      <DialogContent
        onOpenAutoFocus={event => { if (isRerun) { event.preventDefault(); (event.currentTarget as HTMLElement).focus({ preventScroll: true }); } }}
        onCloseAutoFocus={event => { if (hidden) event.preventDefault(); else onCloseAutoFocus?.(event); }}
        size="lg"
        title={isRerun ? "Rerun" : "Start run"}
        description={isRerun ? [workflow?.label, rerunSource?.label].filter(Boolean).join(" · ") : workflow ? workflow.label : "Choose a workflow to begin"}
        className={cn("launch-design launch-dialog", isRerun && "launch-rerun")}
      >
          {!isRerun && <RunWorkflowPicker catalog={catalog} value={workflowId} locked={sending} onChange={pickWorkflow} query={pickerQuery} onQuery={setPickerQuery} />}

          {launchRefusal ? <><DialogBody><EmptyState title="Workflow unavailable" description={launchRefusal} /></DialogBody><DialogFooter><Button onClick={() => closeAndReset(false)}>Close</Button></DialogFooter></> : <>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <ol aria-label="Run configuration path" className="launch-stagebar">
              {launchStages.map((stage, index) => {
                const activeIndex = launchStages.findIndex(entry => entry.label === currentStage);
                const current = index === activeIndex;
                return <li key={stage.label} aria-current={current ? "step" : undefined}>
                  <BareButton disabled={index > activeIndex || sending} aria-label={`${stage.number} ${stage.label}`} className={dsFocus} onClick={() => send({ type: "go-to", stage: stage.label, path: gates.path })}>
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
            {sourceError !== null && <FailureNotice sentence={sourceError} />}
            {recoveryError !== null && <FailureNotice sentence={recoveryError} />}
            {/* While the Start is in flight its outcome is not unknown yet; only a settled, unresolved command needs readback. */}
            {recovery !== null && !readback && !busy && (
              <Banner tone="warning" title="A previous submission needs readback">
                <MetaLine items={[workflows.find(candidate => candidate.workflowId === recovery.target.workflowId)?.label ?? "An earlier start"]} />
                <Button disabled={busy} onClick={() => send({ type: "replay", authority: authority() })}>Replay exact submission</Button>
              </Banner>
            )}
            {error !== null && (
              <FailureNotice sentence={error} />
            )}

            <div className="launch-sections">
              {(!isRerun && currentStage === "Input" || isRerun && stepsShown && Object.keys(referenceSelections).length > 0) && (
                <RunStartInput workflow={workflow} workflowId={workflowId} inputRun={inputRun} pdfSurface={pdfSurface} pdfInput={pdfInput}
                  draft={draft} typedValues={typedValues} typedInputRef={typedInputRef} preview={preview} busy={busy} sending={sending}
                  recovery={recovery} update={update} spreadsheets={spreadsheets} savedRows={savedRows} referencesOnly={isRerun} />
              )}

              {onLastStage && warning !== null && (
                <section aria-label="Repeat transaction warning" className="launch-section">
                  <Banner tone="warning" title="These transactions were already submitted">
                    Running them again may create duplicates.
                  </Banner>
                  <RunList label="Already submitted">{warning.rerun.warnings.map((entry) => {
                    const step = snapshot?.steps.find((candidate) => candidate.nodes.some((node) => node.nodeId === entry.nodeId));
                    if (step === undefined) throw new Error("RERUN_WARNING_STEP_UNAVAILABLE");
                    return <RunListRow key={`${entry.nodeId}:${entry.writeIntentId}`} title={stepLabel(step.key)}><span className="text-[13px] text-ui-secondary">{SYSTEM_NAME[entry.system]}</span></RunListRow>;
                  })}</RunList>
                </section>
              )}

              {/* The source's own receipts show before Start, whether or not their step runs again; the repeat warning replaces them once Start asks for consent. */}
              {onLastStage && isRerun && warning === null && filedBySource.length > 0 && (
                <section aria-label="Already submitted by this run" className="launch-section">
                  <RunList title="Already submitted" description="The earlier run filed these." label="Already submitted by this run">{filedBySource.map((entry) => (
                    <RunListRow key={`${entry.nodeId}:${entry.writeIntentId}`} title={stepLabel(entry.stepKey)}>
                      <span className="text-[13px] text-ui-secondary">{selectedStepKeys.includes(entry.stepKey) ? "Runs again" : "Not run again"}</span>
                    </RunListRow>))}</RunList>
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
                <RunStartSteps workflow={workflow} snapshot={snapshot} rows={rows} selectedStepKeys={selectedStepKeys} manualRows={manualRows}
                  forcedByStep={forcedByStep} handOffByStep={handOffByStep} openRows={openRows} isRerun={isRerun} multiSubject={multiSubject} inputDriven={inputDriven}
                  sending={sending} stepLabel={stepLabel} stepsFailure={stepsFailure} copiedOmissions={copiedOmissions} update={update} />
              )}

              {currentStage === "Start" && <RunChecksStage checks={checks.state} onFix={fixCheck} onRecheck={checks.recheck} />}

              {onLastStage && lastStageFacts.length > 0 && <KeyValueList items={lastStageFacts} />}

              {onLastStage && plan !== null && (
                <section id="run-start-plan" aria-label="Plan" className="flex flex-col gap-[var(--ds-space-cozy)]">
                  {expiredPlan && <p className="text-body text-ui-secondary">The plan expired and was rebuilt. Review it again.</p>}
                  {omissionMismatch && (
                    <FailureNotice sentence={`You omitted ${sentOmittedSteps.length === 0 ? "no steps" : sentOmittedSteps.join(", ")}, but the plan omits ${planOmittedSteps.length === 0 ? "no steps" : planOmittedSteps.join(", ")}.`} />
                  )}
                </section>
              )}
            </div>
          </DialogBody>
          </div>

        <DialogFooter
          meta={failedChecks !== undefined
            ? <span className="flex items-center gap-1.5 text-ui-danger"><CircleAlert aria-hidden className={dsIcon.md} />{failedChecks}</span>
            : stageHint ?? <MetaLine
              tone="faint"
              items={[
                workflow?.label,
                workflow === undefined ? undefined : `${includedRowCount(rows, selectedStepKeys, manualRows, snapshot)} of ${rows.length} steps`,
                typedOcr ? "Manual reading" : pdfSurface === undefined ? undefined : pdfRunOcrFooter(pdfSurface, pdfInput.draft, pdfInput.picks),
                priority === "interactive" ? "Priority" : undefined,
              ].filter((item): item is string => item !== undefined)}
            />}
        >
          <Button
            variant="primary"
            {...(onLastStage ? { icon: <Play aria-hidden className={dsIcon.md} /> } : {})}
            loading={controls.primary.loading || checksShown && checks.state.state === "checking"}
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
