import { RunWorkersSchema, type RunWorkers } from "../../../models/run/envelope.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../models/failures/error-catalog.js";
import { useViewNavigation, useViewState } from "../../app/navigation/view-route-model.js";
import { servedLaunchWorkflows, type WorkflowCatalogEntry } from "../workflows/workflow-catalog-model.js";
import "./launch-presentation.css";
import { mockWorkflow, type MockWorkflowId } from "../workflows/mocks/workflow-mock-catalog.js";
import { WorkflowMockRunForm } from "../workflows/mocks/workflow-mock-run.js";
import { RunConfirmLayout, RunOptionsLayout, RunStepsList } from "./run-launch-layout.js";
import type { MockDraft, MockRun } from "../workflows/mocks/workflow-mock-model.js";
import { RunWorkflowPicker } from "./run-start-picker.js";
import type { RerunValuesSnapshot } from "../../../models/dashboard/rerun-values.js";
import type { RerunWarningWire } from "../../../models/dashboard/rerun-warning.js";
import { canonicalJsonStringify, JsonValueSchema } from "../../../rules/validation/canonical-json.js";
import { candidateText, defaultRerunSteps, initialRerunValueDrafts, rerunSubmission, type RerunValueDraft } from "./run-start-rerun-model.js";
import { readLaunchRecovery, readLaunchVerificationPlan, retainLaunchFinal, dismissLaunchRecovery, type LaunchFinalCommand } from "./run-launch-recovery.js";
import { createRunLaunchService, type RerunLaunchSource } from "./run-launch-model.js";
/** Descriptor-driven launch UI; server planning and durable command recovery own admission. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Keyboard, Play } from "lucide-react";
import { cn } from "../../lib/utils.js";
import {
  BareButton,
  Badge,
  Banner,
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  EmptyState,
  Field,
  Input,
  KeyValueList,
  MetaLine,
  ChoicePicker,
  Well,
  dsFg,
  dsFocus,
  dsIcon,
  dsText,
} from "../../ds/ui.js";
import type { CommandResult } from "../../../rules/commands/commands.js";
import { settleCommandResult } from "../../app/commands/command-result.js";
import {
  inputRunValueNoun,
  type InputRunSurface,
  type TypedInputDraft,
} from "../../../models/workflow/ingress.js";
import type { WorkflowModuleRole } from "../../../workflow-kit/validation/module-role.js";
import type { EnqueuePolicy } from "../../../models/workflow/presentation.js";
import type { StartPlanResponse } from "../../client/index.js";
import { useDashboardCommandBinding, useDashboardClient } from "../../state/client-context.js";
import {
  TypedInput,
  EnqueueResultBanner,
  LockedFact,
  PlanRefusals,
  RunFlagChips,
  StepOmissionFactsForm,
} from "./run-start-kit.js";
import { useSpreadsheetMocks } from "../spreadsheets/spreadsheet-mock-model.js";
import { SYSTEM_LABEL, type BrowserSystemId } from "../shared/status/system-chip-model.js";
import {
  ENQUEUE_POLICY_MEANING,
  ENQUEUE_POLICY_REASON,
  foldStepOmissionFacts,
  forcedStepOmissions,
  initialStepOmissionDraft,
  inputRunFieldLabel,
  omittedStepViews,
  startRequestFingerprint,
  toggleStepSelection,
  previewRunInput,
  typedInputDefaults,
  typedInputText,
  restoreTypedInput,
  typedControlAvailable,
  changeTypedInput,
  type RunInputPreview,
  type BrowserMode,
  type StartPriority,
  type StepOmissionDraft,
  type StepOmissionFactDraft,
  type StepOmissionFactsFold,
  type StepOmissionFactValue,
} from "./run-start-model.js";
import {
  adjacentRunStartStage,
  reconcileRunStartStage,
  runStartStages,
} from "./run-start-timeline.js";
import { versionTag } from "../shared/status/format.js";
import type { StepOmissionForm } from "../../../models/workflow/step-omission.js";

/** the surface id this command family is audited under (ref frontend-backend-integration ) */

/** What the app composes from the descriptor and bootstrap projections. The
 * dialog reads exactly this and imports no workflow module. */
export interface RunStartWorkflow {
  readonly workflowId: string;
  readonly label: string;
  /** the served category this workflow is filed under — the picker's grouping */
  readonly categoryId: string;
  // Use the served role; never infer it from an ID prefix.
  readonly role: WorkflowModuleRole;
  readonly code?: string;
  /** the descriptor's own sentence about what this workflow does */
  readonly summary?: string;
  /** The descriptor's DECLARED active-run policy . It is a fact, not a
 * control: `planStart` reads `descriptor.enqueue` and `StartPlanIngress` */
  readonly enqueue: EnqueuePolicy;
  /** The served descriptor version, shown in Options and Confirm. */
  readonly version: number;
  readonly steps: readonly Readonly<{
    key: string;
    label: string;
    includedByDefault: boolean;
    systems?: readonly BrowserSystemId[];
    control:
      | { state: "selectable"; inputField: string }
      /** the step declares an omission the operator may take instead of running */
      | { state: "omittable"; form: StepOmissionForm; forces: readonly string[] }
      | { state: "required"; reason: string };
  }>[];
  /** the descriptor's declared typed-input surface */
  readonly inputRun:
    | { readonly state: "present"; readonly surface: InputRunSurface }
    | { readonly state: "absent"; readonly reason: string };
  /** Retained served intake capability. Spreadsheet registration lives in
 * Settings and is not a Run input method. */
  readonly spreadsheetIntake: boolean;
}

/** startable IS "declares a typed-input surface" — there is no second gate */
function isStartable(workflow: RunStartWorkflow): boolean {
  return workflow.inputRun.state === "present";
}

/** What the dialog reads when the served catalogue holds nothing to select. It
 * is a statement about the dialog's own state, not a substituted descriptor */
/** a stable empty step list, so "no workflow selected" is not a fresh array each render */
const EMPTY_STEPS: RunStartWorkflow["steps"] = Object.freeze([]);

const NO_WORKFLOW_SELECTED = Object.freeze({
  state: "absent",
  reason: "no workflow is selected",
} as const);

/** One omitted step, with the facts form it asks for and what the operator has
 * typed into it so far . */
interface StepOmissionRow {
  readonly step: string;
  readonly label: string;
  readonly form: StepOmissionForm;
  readonly draft: StepOmissionDraft;
  readonly fold: StepOmissionFactsFold;
}

/** The `stepOmissions` this request would carry — or `null`, because one of its
 * forms does not parse yet. */
function completeStepOmissions(
  rows: readonly StepOmissionRow[],
): readonly Readonly<{ step: string; facts: Readonly<Record<string, StepOmissionFactValue>> }>[] | null {
  const entries: Readonly<{ step: string; facts: Readonly<Record<string, StepOmissionFactValue>> }>[] = [];
  for (const row of rows) {
    if (row.fold.state !== "facts") return null;
    entries.push({ step: row.step, facts: row.fold.facts });
  }
  return Object.freeze(entries);
}

/** One omitted step's typed facts, in the operator's own words */
function stepOmissionFactsSummary(row: StepOmissionRow): string {
  if (row.form.fields.length === 0) return "no facts to supply";
  if (row.fold.state !== "facts") {
              // Confirm is unreachable with an unparsed form: `advance` refuses it.
          // fingerprint clears the plan on every keystroke, so reaching here means one of the two is broken.
    throw new Error(`the Confirm summary reached step "${row.step}" with facts that do not parse`);
  }
  const facts = row.fold.facts;
  return row.form.fields
    .map((field) => `${field.label}: ${stepOmissionFactLabel(field.key, facts[field.key])}`)
    .join(" \u00b7 ");
}

/** one parsed fact, in the words the operator reads — never the raw JSON shape */
function stepOmissionFactLabel(field: string, value: StepOmissionFactValue | undefined): string {
  if (value === undefined) throw new Error(`omission field "${field}" parsed to no value`);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length === 0 ? "None" : value.join(", ");
  return String(value);
}

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
      onClick={onOpen}
      icon={<Play aria-hidden className={dsIcon.sm} />}
      // Keep shortcut hints in their shared discovery route so the primary control stays focused on its verb.
      title="Start a run — any workflow, from anywhere (r)"
    >
      Start a run
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
  rerunSource,
  previewLaunch,
  previewRuns,
  onSubmitPreview,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Shared registration and explicit launch capabilities from the app boundary. */
  catalog: readonly WorkflowCatalogEntry[];
  /** the Workflow Panel the operator is standing in — the dialog's default */
  panelWorkflowId: string;
  /** echoed from bootstrap; the server matches it against the request identity */
  actorId: string;
  onApplied?: (workflowId: string, count?: number) => void;
  /** Hand intake the picker’s workflow, never the panel’s incidental scope. */
  onOpenIntake: (workflowId: string, intakeSessionId: string) => void;
  onCloseAutoFocus?: (event: Event) => void;
  rerunSource?: RerunLaunchSource;
  previewLaunch?: Readonly<{ workflowId: MockWorkflowId; source?: MockRun }>;
  previewRuns?: readonly MockRun[];
  onSubmitPreview?: (id: MockWorkflowId, draft: MockDraft, sourceId?: string) => void;
}) {
  const workflows = useMemo(() => servedLaunchWorkflows(catalog), [catalog]);
  if (catalog.some(entry => entry.launch.state === "preview") && onSubmitPreview === undefined) throw new Error("RUN_PREVIEW_CAPABILITY_INCOMPLETE");
  if ((previewRuns === undefined) !== (onSubmitPreview === undefined) || (previewLaunch !== undefined && onSubmitPreview === undefined)) throw new Error("RUN_PREVIEW_CAPABILITY_INCOMPLETE");
  if (previewLaunch && !previewLaunch.source && !mockWorkflow(previewLaunch.workflowId).runnable) throw new Error("RUN_PREVIEW_NOT_RUNNABLE");
  const navigation = useViewNavigation();
  const routed = navigation !== undefined;
  const updateView = navigation?.update;
  const [localPreviewSelection, setLocalPreviewSelection] = useState(previewLaunch);
  const previewSelection = navigation ? previewLaunch : localPreviewSelection;
  const previewOwnsStages = previewSelection !== undefined;
  const setPreviewSelection = useCallback((next: typeof previewLaunch) => {
    if (updateView) updateView({ launchWorkflow: next?.workflowId, launchSource: next?.source?.id });
    else setLocalPreviewSelection(next);
  }, [updateView]);
  const previewDrafts = useRef(new Map<string, MockDraft>());
  const [pickerQuery, setPickerQuery] = useState("");
  const client = useDashboardClient();
  const commandBinding = useDashboardCommandBinding();
  const commandBindingRef = useRef(commandBinding);
  commandBindingRef.current = commandBinding;
  const launchService = useMemo(() => createRunLaunchService(client, actorId, { uuid: () => crypto.randomUUID(), now: () => {
    const binding = commandBindingRef.current;
    if (binding === undefined || binding.scope.client !== client || binding.scope.actorId !== actorId) throw new Error("RUN_LAUNCH_AUTHORITY_UNAVAILABLE");
    return binding.authority.nowIso;
  } }), [client, actorId]);
  const finalRequest = useRef<LaunchFinalCommand | null>(null);
  const sending = useRef<object | false>(false);
  const finalDiagnostic = useRef<Readonly<{ command: LaunchFinalCommand; cause: unknown }> | null>(null);
  const launchInstance = useRef(0);
  const [recovery, setRecovery] = useState<LaunchFinalCommand | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<RerunValuesSnapshot | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [valueDrafts, setValueDrafts] = useState<Readonly<Record<number, RerunValueDraft>>>({});
  const [copiedOmissions, setCopiedOmissions] = useState<Readonly<Record<number, boolean>>>({});
  const [warning, setWarning] = useState<RerunWarningWire | null>(null);
  const [acknowledgment, setAcknowledgment] = useState<string | undefined>();
  const isRerun = rerunSource !== undefined;

  const [workflowId, setWorkflowId] = useViewState("launchServed", () => defaultWorkflowId(workflows, panelWorkflowId));
  const selectedWorkflowRef = useRef(previewSelection?.workflowId ?? workflowId);
  useEffect(() => { selectedWorkflowRef.current = previewSelection?.workflowId ?? workflowId; }, [previewSelection, workflowId]);
  const [currentStage, setCurrentStage] = useViewState("launchStage", "Input");
  const [workbookId, setWorkbookId] = useState("");
  const spreadsheetMocks = useSpreadsheetMocks();
  const initialWorkflow = workflows.find((entry) => entry.workflowId === defaultWorkflowId(workflows, panelWorkflowId));
  const [customizeSteps, setCustomizeSteps] = useViewState("launchCustomize", false);
  const [selectedStepKeys, setSelectedStepKeys] = useState<string[]>(() =>
    initialWorkflow?.steps.filter(({ includedByDefault }) => includedByDefault).map(({ key }) => key) ?? []);
  /** Keep drafts across checkbox toggles, but clear them across workflow or customization exits. */
  const [stepDrafts, setStepDrafts] = useState<Readonly<Record<string, StepOmissionDraft>>>({});
  const [touchedFacts, setTouchedFacts] = useState<ReadonlySet<string>>(() => new Set());
  const [factsAttempted, setFactsAttempted] = useState(false);
  const [text, setText] = useState("");
  const [typedDraft, setTypedDraft] = useState<TypedInputDraft>(() => initialWorkflow?.inputRun.state === "present" && initialWorkflow.inputRun.surface.typedInput ? typedInputDefaults(initialWorkflow.inputRun.surface.typedInput) : {});
  const [sourceInputUnchanged, setSourceInputUnchanged] = useState(false);
  const [workers, setWorkers] = useState<RunWorkers>("auto");
  const [priority, setPriority] = useState<StartPriority>("interactive");
  const [dryRunRequested, setDryRunRequested] = useState(false);
  const [browserMode, setBrowserMode] = useState<BrowserMode>("headed");
  const [captureBrowserScreenshots, setCaptureBrowserScreenshots] = useState(true);
  const [plan, setPlan] = useState<StartPlanResponse | null>(null);
  const [result, setResult] = useState<Exclude<CommandResult, { state: "pending" }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { sending.current = false; setBusy(false); }, [commandBinding?.scope]);

  /** Changing workflow clears its parser input and bound plan; another workflow cannot reuse either. */
  const selectWorkflow = useCallback((next: string, preserveStage = false) => {
    setWorkflowId(next);
    setText("");
    const nextInput = workflows.find(entry => entry.workflowId === next)?.inputRun;
    setTypedDraft(nextInput?.state === "present" && nextInput.surface.typedInput ? typedInputDefaults(nextInput.surface.typedInput) : {}); setSourceInputUnchanged(false);
    setPlan(null);
    setResult(null);
    setError(null);
    if (!preserveStage) { setCurrentStage("Input"); setCustomizeSteps(false); }
    // Reset start method with workflow; unavailable spreadsheet declarations must not leave a selected hidden tab.
    setWorkbookId("");
    const nextWorkflow = workflows.find((entry) => entry.workflowId === next);
    setSelectedStepKeys(nextWorkflow?.steps.filter(({ includedByDefault }) => includedByDefault).map(({ key }) => key) ?? []);
    setStepDrafts({});
    setTouchedFacts(new Set());
    setFactsAttempted(false);
    setWorkers("auto");
    setPriority("interactive");
    setDryRunRequested(false);
    setBrowserMode("headed");
    setCaptureBrowserScreenshots(true);
  }, [workflows, setCurrentStage, setCustomizeSteps, setWorkflowId]);

  // Opening lands on the panel you are standing in, every time — including the
  // second time, which is why this keys on `open` rather than running once.
  useEffect(() => {
    const instance = ++launchInstance.current;
    if (!open) return;
    if (!routed && !previewLaunch && selectedWorkflowRef.current !== defaultWorkflowId(workflows, panelWorkflowId)) selectWorkflow(defaultWorkflowId(workflows, panelWorkflowId), true);
    if (!routed) setLocalPreviewSelection(previewLaunch);
    setPickerQuery("");
    setWorkers("auto");
    setSnapshot(null); setSourceError(null); setValueDrafts({}); setCopiedOmissions({}); setSourceInputUnchanged(false);
    setWarning(null); setAcknowledgment(undefined); setBusy(false); sending.current = false;
    try { setRecovery(readLaunchRecovery(window.sessionStorage, actorId)); setRecoveryError(null); }
    catch (caught) { setRecoveryError(caught instanceof Error ? caught.message : String(caught)); }
    if (rerunSource !== undefined) {
      setCurrentStage("Steps"); setCustomizeSteps(true);
      void launchService.openRerun({ runId: rerunSource.runId, expectedVersion: rerunSource.expectedVersion }).then((response) => {
        if (launchInstance.current !== instance) return;
        if (response.state === "refused") { setSourceError(`Rerun unavailable: ${response.code}`); return; }
        if (response.snapshot.source.runId !== rerunSource.runId || response.snapshot.source.version !== rerunSource.expectedVersion) throw new Error(formatErrorCatalogFailure(createErrorCatalogFailure("BOUNDARY_VALIDATION_FAILED", { source: "http-response" })).text);
        const sourceWorkflow = workflows.find((entry) => entry.workflowId === response.snapshot.source.workflow);
        if (sourceWorkflow === undefined) throw new Error("RERUN_WORKFLOW_UNAVAILABLE");
        const selection = defaultRerunSteps(response.snapshot, sourceWorkflow);
        setWorkflowId(sourceWorkflow.workflowId); setSelectedStepKeys(selection); setSnapshot(response.snapshot); setWorkers(response.snapshot.workers);
        setValueDrafts(initialRerunValueDrafts(response.snapshot, sourceWorkflow));
        if (sourceWorkflow.inputRun.state === "present" && sourceWorkflow.inputRun.surface.typedInput !== undefined) {
          if (response.snapshot.sourceInput.state !== "available") throw new Error(formatErrorCatalogFailure(createErrorCatalogFailure("RERUN_SOURCE_INPUT_PROTECTED", {})).text);
          const declaration = sourceWorkflow.inputRun.surface.typedInput;
          const input = response.snapshot.sourceInput.value;
          const restored = restoreTypedInput(declaration, input);
          setTypedDraft(restored);
          setText(typedInputText(declaration, input));
          setSourceInputUnchanged(true);
          setSelectedStepKeys(sourceWorkflow.steps.filter(step => step.control.state !== "selectable"
            || restored[step.control.inputField] === true).map(step => step.key));
          setValueDrafts({});
        }
      }).catch((caught: unknown) => {
        if (launchInstance.current === instance) { setSnapshot(null); setSourceError(caught instanceof Error ? caught.message : String(caught)); }
      });
    }
    return () => { launchInstance.current = instance + 1; };
  }, [open, workflows, panelWorkflowId, selectWorkflow, rerunSource, actorId, launchService, previewLaunch, routed, setCurrentStage, setCustomizeSteps, setWorkflowId]);

  const pickWorkflow = useCallback((id: string) => {
    if (selectedWorkflowRef.current === id || sending.current) return;
    const entry = catalog.find(flow => flow.id === id);
    if (!entry || entry.launch.state === "unavailable") return;
    if (entry.launch.state === "preview" && onSubmitPreview === undefined) return;
    selectedWorkflowRef.current = id;
    ++launchInstance.current;
    setBusy(false);
    if (entry.served) {
      setPreviewSelection(undefined);
      selectWorkflow(id);
    } else if (entry.preview) setPreviewSelection({ workflowId: entry.preview.id });
  }, [catalog, selectWorkflow, onSubmitPreview, setPreviewSelection]);

  const workflow = workflows.find((entry) => entry.workflowId === workflowId);

  const inputRun = workflow?.inputRun ?? NO_WORKFLOW_SELECTED;
  const typedDeclaration = inputRun.state === "present" ? inputRun.surface.typedInput : undefined;
  const declaredInput = typedDeclaration !== undefined;
  const typedValues = useMemo(() => {
    if (typedDeclaration === undefined) return typedDraft;
    const values = { ...typedInputDefaults(typedDeclaration), ...typedDraft };
    for (const step of workflow?.steps ?? []) {
      const control = step.control;
      if (control.state === "selectable" && typedDeclaration.controls.some(field => field.field === control.inputField && field.placement === "step"))
        values[control.inputField] = typedControlAvailable(typedDeclaration, values, control.inputField) && selectedStepKeys.includes(step.key);
    }
    return values;
  }, [typedDeclaration, typedDraft, workflow, selectedStepKeys]);
  const supportsDryRun = inputRun.state === "present" && inputRun.surface.supportsDryRun === true;
  const dryRun = supportsDryRun && dryRunRequested;
  const launchStages = useMemo(() => runStartStages(customizeSteps, "typed", isRerun), [customizeSteps, isRerun]);

  useEffect(() => {
    if (previewOwnsStages) return;
    setCurrentStage((current) => reconcileRunStartStage(launchStages, current));
  }, [launchStages, setCurrentStage, previewOwnsStages]);

  /** Plans and results expire when any request-shaping fact changes. */
  /** Lock forced omissions using the descriptor cascade; the planner owns the rule. */
  const steps = workflow?.steps ?? EMPTY_STEPS;
  const forcedByStep = useMemo(() => forcedStepOmissions(steps, selectedStepKeys), [steps, selectedStepKeys]);
  const omissionRows: readonly StepOmissionRow[] = useMemo(() => (customizeSteps ? omittedStepViews(steps, selectedStepKeys) : []).map(
    (step): StepOmissionRow => {
      if (step.control.state !== "omittable") {
        throw new Error(`step "${step.key}" is omitted but declares no omission`);
      }
      const form = step.control.form;
      const draft = stepDrafts[step.key] ?? initialStepOmissionDraft(form);
      return { step: step.key, label: step.label, form, draft, fold: foldStepOmissionFacts(form, draft) };
    },
  ), [customizeSteps, steps, selectedStepKeys, stepDrafts]);
  const stepOmissions = useMemo(() => completeStepOmissions(omissionRows), [omissionRows]);
  const requestFingerprint = canonicalJsonStringify([rerunSource ?? null, valueDrafts, copiedOmissions, typedValues, sourceInputUnchanged, startRequestFingerprint({
    workflowId,
    text,
    dryRun,
    workers,
    browserMode,
    captureBrowserScreenshots,
    priority,
    selectedStepKeys,
    stepOmissionDrafts: omissionRows.map(({ step, draft }) => ({ step, draft })),
  })]);
  /** Accept async settlements only for their captured request identity; clear stale results alongside invalidation. */
  const requestFingerprintRef = useRef(requestFingerprint);
  useEffect(() => {
    requestFingerprintRef.current = requestFingerprint;
    setPlan(null);
    setResult(null);
    setError(null);
    if (!previewOwnsStages) setCurrentStage((current) => current === "Confirm" ? (isRerun ? "Values" : "Input") : current);
  }, [requestFingerprint, isRerun, setCurrentStage, previewOwnsStages]);

  /** Return focus to the typed box when settled-banner controls unmount. */
  const typedInputRef = useRef<HTMLTextAreaElement>(null);
  const restoreInputFocusRef = useRef(false);

  useEffect(() => {
    if (!["Input", "Values"].includes(currentStage) || !restoreInputFocusRef.current) return;
    restoreInputFocusRef.current = false;
    // A workflow with no typed-input surface has no box to restore to. That is
    // the served absence, not a focus fallback to an unrelated control.
    typedInputRef.current?.focus();
  }, [currentStage]);

  const preview = useMemo((): RunInputPreview => inputRun.state !== "present" ? { entries: [], submissions: [], problem: null }
    : previewRunInput(inputRun.surface, text, typedValues,
      sourceInputUnchanged && snapshot?.source.runId === rerunSource?.runId && snapshot?.source.version === rerunSource?.expectedVersion && snapshot?.sourceInput.state === "available" ? snapshot.sourceInput.value : undefined),
    [inputRun, text, typedValues, snapshot, rerunSource, sourceInputUnchanged]);



  const submitPlan = useCallback(async (): Promise<void> => {
    if (!isRerun && preview.entries.length === 0) return;
    if (isRerun && (snapshot === null || preview.entries.length > 1)) return;
    if (declaredInput && preview.submissions.length !== 1 && isRerun) return;
    const dispatchedFor = requestFingerprint;
    const instance = launchInstance.current;
    setBusy(true);
    setError(null);
    try {
      const values = snapshot === null ? null : rerunSubmission(snapshot, preview.submissions[0] ?? {}, valueDrafts);
      const copiedFrom = [...(values?.copiedFrom ?? []), ...Object.entries(copiedOmissions).flatMap(([index, copied]) => {
        const candidate = snapshot?.values[Number(index)];
        return copied && candidate?.state === "available" && candidate.targetStepKey !== undefined
          && !selectedStepKeys.includes(candidate.targetStepKey)
          ? [{ nodeId: candidate.nodeId, fieldPath: candidate.fieldPath, targetFieldPath: candidate.targetFieldPath, targetStepKey: candidate.targetStepKey }] : [];
      })];
      const next = await launchService.preview({
        workflowId,
        submissions: values === null ? preview.submissions : [values.submission],
        ...(snapshot === null ? {} : { rerunSource: { runId: snapshot.source.runId, expectedVersion: snapshot.source.version,
          intent: "rerun", selectedStepKeys, copiedFrom }, ...(acknowledgment === undefined ? {} : { warningAcknowledgment: acknowledgment }) }),
        dryRun,
        workers,
        browserMode,
        captureBrowserScreenshots,
        priority,
        ...(customizeSteps || declaredInput ? { selectedStepKeys } : {}),
        // Send omission facts only after every declared form parses.
        ...(customizeSteps && stepOmissions !== null && stepOmissions.length > 0 ? { stepOmissions } : {}),
      });
      // Ignore superseded plan responses; their tokens describe text no longer in the form.
      if (requestFingerprintRef.current !== dispatchedFor || launchInstance.current !== instance) return;
      setPlan(next);
      setResult(null);
      if (next.rerun !== undefined && next.rerun.warnings.length > 0 && next.rerun.acknowledgment !== next.rerun.warningDigest) {
        setWarning({ workflowId: next.workflowId, rerun: next.rerun }); setCurrentStage("Warning");
      } else setCurrentStage("Confirm");
    } catch (caught) {
      // Render refusals only against their current request; superseded errors would condemn different input.
      if (requestFingerprintRef.current !== dispatchedFor || launchInstance.current !== instance) return;
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (launchInstance.current === instance) setBusy(false);
    }
  }, [isRerun, snapshot, valueDrafts, copiedOmissions, acknowledgment, workers, browserMode, captureBrowserScreenshots, launchService, customizeSteps, dryRun, preview, priority, requestFingerprint, selectedStepKeys, stepOmissions, workflowId, setCurrentStage, declaredInput]);

  const sendFinal = useCallback(async (command: LaunchFinalCommand, dispatchedFor: string): Promise<void> => {
    if (sending.current) return;
    const binding = commandBindingRef.current;
    if (binding === undefined || binding.scope.client !== client || binding.scope.actorId !== actorId || command.requestedBy !== binding.scope.actorId) { setError(formatErrorCatalogFailure(createErrorCatalogFailure("DASHBOARD_AUTHORITY_REPLACED", {})).text); return; }
    const instance = launchInstance.current;
    const attempt = {};
    sending.current = attempt; setBusy(true); setError(null);
    try {
      retainLaunchFinal(window.sessionStorage, command, plan?.startPlanId === command.target.startPlanId ? plan : undefined);
      const verificationPlan = readLaunchVerificationPlan(window.sessionStorage, command.requestedBy);
      finalRequest.current = command; setRecovery(command);
      await launchService.submit(command, binding, verificationPlan, outcome => {
        if (requestFingerprintRef.current !== dispatchedFor || launchInstance.current !== instance) return;
        binding.feedback(outcome);
        if (outcome.kind === "confirmed") {
          dismissLaunchRecovery(window.sessionStorage, command);
          finalRequest.current = null; setRecovery(null); setPlan(null); setResult(null); setBusy(false);
          onApplied?.(command.target.workflowId, plan?.planned.length);
          onOpenChange(false);
          ++launchInstance.current;
        } else {
          setError(outcome.feedback.text);
          const reply = outcome.reply;
          if (outcome.kind !== "uncertain" && reply !== undefined && "state" in reply
            && (reply.state === "rejected" || reply.state === "conflict" || reply.state === "confirmation-required")) {
            setResult({ ...reply, message: outcome.feedback.text });
          }
        }
      });
    } catch (caught) {
      finalDiagnostic.current = { command, cause: caught };
      if (requestFingerprintRef.current !== dispatchedFor || launchInstance.current !== instance || commandBindingRef.current?.scope !== binding.scope) return;
      setError(formatErrorCatalogFailure(createErrorCatalogFailure("COMMAND_DISPATCH_FAILED", {})).text);
    } finally {
      if (sending.current === attempt) sending.current = false;
      if (launchInstance.current === instance && commandBindingRef.current?.scope === binding.scope) setBusy(false);
    }
  }, [launchService, onApplied, onOpenChange, plan, client, actorId]);
  const confirmStart = useCallback(async (): Promise<void> => {
    if (plan === null || sending.current || recoveryError !== null) return;
    if (commandBinding === undefined || commandBinding.scope.client !== client || commandBinding.scope.actorId !== actorId) { setError(formatErrorCatalogFailure(createErrorCatalogFailure("DASHBOARD_AUTHORITY_REPLACED", {})).text); return; }
    if (finalRequest.current === null || finalRequest.current.target.startPlanId !== plan.startPlanId) {
      finalRequest.current = launchService.prepareFinal(plan);
    }
    await sendFinal(finalRequest.current, requestFingerprint);
  }, [client, actorId, commandBinding, launchService, plan, requestFingerprint, recoveryError, sendFinal]);

  // already-applied confirms the same enqueue; its plan token is single-use.
  const applied = result !== null && settleCommandResult(result).kind === "applied";
  const blockedReason = inputRun.state !== "present"
    ? inputRun.reason
    : preview.problem !== null
      ? "Fix the refused entry first."
      : preview.entries.length === 0
        ? "Type at least one value."
        : null;
  const rerunInputBlocked = preview.problem !== null || preview.entries.length > 1 || (declaredInput && preview.entries.length === 0);
  /** Incomplete omitted-step facts block confirmation using the descriptor’s own schema refusal. */
  /** Omission facts describe one person; fan-out must not assert the same dates for multiple subjects. */
  const subjectCount = preview.entries.length;
  const multiSubject = subjectCount > 1;
  const multiSubjectOmissionReason = `Omitting a step describes one subject; this run would create ${String(subjectCount)}.`;
  const stepsBlockedReason = customizeSteps && multiSubject && omissionRows.length > 0
    ? `${multiSubjectOmissionReason} Include every step, or type one value.`
    : customizeSteps && stepOmissions === null
    ? omissionRows.length === 1
      ? "Fill in the facts the omitted step asks for."
      : "Fill in the facts every omitted step asks for."
    : null;
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
  /** Untouched fields hide error decoration, never their actual validation refusal or blocked advance. */
  const visibleFactErrors = (row: StepOmissionRow): Readonly<Record<string, string>> => {
    if (row.fold.state !== "invalid") return {};
    if (factsAttempted) return row.fold.errors;
    return Object.fromEntries(
      Object.entries(row.fold.errors).filter(([field]) => touchedFacts.has(`${row.step}:${field}`)),
    );
  };
  const previousStage = adjacentRunStartStage(launchStages, currentStage, "previous");
  const nextStage = adjacentRunStartStage(launchStages, currentStage, "next");
  const inputSummary = preview.entries.map((entry) => entry.sourceText).join(", ");


  const changeCustomizeSteps = useCallback((next: boolean) => {
    setCustomizeSteps(next);
    if (!next) {
      setSelectedStepKeys(workflow?.steps.filter(step => {
        const control = step.control;
        return declaredInput && control.state === "selectable"
          ? typedDeclaration.controls.some(field => field.placement === "input" && field.field === control.inputField) && typedValues[control.inputField] === true
          : step.includedByDefault;
      }).map(({ key }) => key) ?? []);
      // Leaving customization clears facts so unchosen assertions cannot survive invisibly.
      setStepDrafts({});
      setTouchedFacts(new Set());
      setFactsAttempted(false);
    } else if (currentStage === "Confirm") {
      setCurrentStage("Steps");
    }
  }, [currentStage, workflow, setCurrentStage, setCustomizeSteps, declaredInput, typedDeclaration, typedValues]);

  /** Use the shared cascade; locked omissions cannot be changed by another checkbox path. */
  const toggleStep = useCallback((key: string, next: boolean) => {
    setSelectedStepKeys((current) => [...toggleStepSelection(workflow?.steps ?? EMPTY_STEPS, current, key, next)]);
  }, [workflow]);

  const changeFact = useCallback(
    (step: string, form: StepOmissionForm, field: string, next: StepOmissionFactDraft) => {
      setCopiedOmissions((current) => Object.fromEntries(Object.entries(current).filter(([index]) => {
        const candidate = snapshot?.values[Number(index)];
        return candidate?.targetStepKey !== step || candidate.targetFieldPath !== field;
      })));
      setStepDrafts((current) => ({
        ...current,
        [step]: { ...(current[step] ?? initialStepOmissionDraft(form)), [field]: next },
      }));
    },
    [snapshot],
  );

  const touchFact = useCallback((step: string, field: string) => {
    const id = `${step}:${field}`;
    setTouchedFacts((current) => current.has(id) ? current : new Set([...current, id]));
  }, []);

  const advance = useCallback(async (): Promise<void> => {
    if (nextStage === null) return;
    if (isRerun && currentStage === "Values" && rerunInputBlocked) return;
    if (isRerun && currentStage === "Steps") {
      if (snapshot === null) return;
      const instance = launchInstance.current;
      const dispatchedFor = requestFingerprint;
      setBusy(true); setError(null);
      try {
        const next = await launchService.previewWarnings({ workflowId, source: { runId: snapshot.source.runId,
          expectedVersion: snapshot.source.version, intent: "rerun", selectedStepKeys } });
        if (launchInstance.current !== instance || requestFingerprintRef.current !== dispatchedFor) return;
        setWarning(next);
        if (next.rerun.warnings.length > 0 && acknowledgment !== next.rerun.warningDigest) setCurrentStage("Warning");
        else { setAcknowledgment(next.rerun.warningDigest); setCurrentStage("Values"); }
      } catch (caught) {
        if (launchInstance.current === instance && requestFingerprintRef.current === dispatchedFor) setError(caught instanceof Error ? caught.message : String(caught));
      } finally { if (launchInstance.current === instance) setBusy(false); }
      return;
    }
    if ((currentStage === "Steps" || (isRerun && currentStage === "Values")) && stepsBlockedReason !== null) {
      // Attempted advancement exposes every invalid field so incomplete answers are actionable.
      setFactsAttempted(true);
      return;
    }
    if (nextStage === "Confirm") {
      if (plan === null) await submitPlan();
      else setCurrentStage("Confirm");
      return;
    }
    setCurrentStage(nextStage);
  }, [currentStage, nextStage, plan, stepsBlockedReason, submitPlan, isRerun, snapshot, requestFingerprint, launchService, workflowId, selectedStepKeys, acknowledgment, setCurrentStage, rerunInputBlocked]);

  /** Discard spent plans and stage state together; restore focus after settled controls unmount. */
  const returnToInput = useCallback(() => {
    if (recovery !== null && result !== null) {
      dismissLaunchRecovery(window.sessionStorage, recovery); setRecovery(null); finalRequest.current = null;
    }
    restoreInputFocusRef.current = true;
    setPlan(null);
    setResult(null);
    setError(null);
    setCurrentStage(isRerun ? "Values" : "Input");
  }, [recovery, result, isRerun, setCurrentStage]);

  const closeAndReset = useCallback((next: boolean) => {
    onOpenChange(next);
    if (!next) {
      ++launchInstance.current;
      if (result !== null && recovery !== null) {
        dismissLaunchRecovery(window.sessionStorage, recovery); setRecovery(null); finalRequest.current = null;
      }
      // Closing invalidates single-use plans; typed drafts may survive, consumed authority may not.
      setPlan(null);
      setResult(null);
      setError(null);
      setCurrentStage("Input");
    }
  }, [onOpenChange, result, recovery, setCurrentStage]);

  const copyOmittedValue = (step: string, index: number) => {
    const candidate = snapshot?.values[index];
    const row = omissionRows.find(entry => entry.step === step);
    if (!row || !candidate || candidate.state !== "available") throw new Error("RERUN_OMISSION_FIELD_UNAVAILABLE");
    const field = row.form.fields.find(entry => entry.key === candidate.targetFieldPath);
    if (!field) throw new Error("RERUN_OMISSION_FIELD_UNAVAILABLE");
    const draft = typeof candidate.value === "boolean" ? candidate.value : Array.isArray(candidate.value) ? candidate.value.map((value: unknown) => candidateText(JsonValueSchema.parse(value))).join("\n") : candidateText(candidate.value);
    setStepDrafts(current => ({ ...current, [step]: { ...(current[step] ?? initialStepOmissionDraft(row.form)), [field.key]: draft } }));
    setCopiedOmissions(current => ({ ...current, [index]: true }));
  };

  const picker = <RunWorkflowPicker catalog={catalog} value={previewSelection?.workflowId ?? workflowId} onChange={pickWorkflow} query={pickerQuery} onQuery={setPickerQuery} />;
  const previewFlow = previewSelection ? mockWorkflow(previewSelection.workflowId) : undefined;

  return (
    <Dialog open={open} onOpenChange={closeAndReset}>
      <DialogContent
        onCloseAutoFocus={onCloseAutoFocus}
        size="xl"
        title={previewSelection?.source || isRerun ? "Rerun" : "Start a run"}
        description={previewFlow ? `${previewFlow.label} · Workflow preview` : isRerun ? [workflow?.label, rerunSource?.label].filter(Boolean).join(" · ") : workflow ? `New work · ${workflow.label}` : "Choose a workflow to begin"}
        className={cn("launch-design launch-dialog", (previewSelection?.source || isRerun) && "launch-rerun")}
      >
          {!previewSelection?.source && !isRerun && picker}

          {previewSelection && onSubmitPreview && previewRuns ? <WorkflowMockRunForm key={`${previewSelection.workflowId}:${previewSelection.source?.id ?? "start"}`} workflowId={previewSelection.workflowId} source={previewSelection.source} runs={previewRuns} initialDraft={previewDrafts.current.get(`${previewSelection.workflowId}:${previewSelection.source?.id ?? "start"}`)} onDraftChange={draft => previewDrafts.current.set(`${previewSelection.workflowId}:${previewSelection.source?.id ?? "start"}`, draft)} onClose={() => closeAndReset(false)} onSubmit={onSubmitPreview} /> : <>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <ol aria-label="Run configuration path" className="launch-stagebar">
              {launchStages.map((stage, index) => {
                const activeIndex = launchStages.findIndex(entry => entry.label === (currentStage === "Warning" ? "Steps" : currentStage));
                const current = index === activeIndex;
                return <li key={stage.label} aria-current={current ? "step" : undefined}>
                  <BareButton disabled={index > activeIndex || busy || recovery !== null} aria-label={`${stage.number} ${stage.label}`} className={dsFocus} onClick={() => setCurrentStage(stage.label)}>
                  <span aria-hidden className="launch-stage-marker" data-current={current || undefined} data-completed={index < activeIndex || undefined}>{index < activeIndex ? <Check className="size-3" /> : stage.number}</span>
                  <span className={cn("text-body", current ? "font-semibold" : "text-ui-secondary")}>{stage.label}</span>
                  </BareButton>
                </li>;
              })}
            </ol>
          <DialogBody className="launch-content @container">
            {isRerun && snapshot === null && sourceError === null && <p role="status">Loading source…</p>}
            {sourceError !== null && <Banner tone="danger" title="Rerun unavailable">{sourceError}</Banner>}
            {recoveryError !== null && <Banner tone="danger" title="Submission recovery unavailable">{recoveryError}</Banner>}
            {recovery !== null && result === null && (
              <Banner tone="warning" title="A previous submission needs readback">
                <MetaLine items={[recovery.commandId, recovery.target.workflowId]} />
                <Button disabled={busy} onClick={() => void sendFinal(recovery, requestFingerprint)}>Replay exact submission</Button>
              </Banner>
            )}
            {result !== null && (
              <EnqueueResultBanner result={result} onDismiss={returnToInput} onReload={returnToInput} />
            )}
            {error !== null && (
              <Banner tone="danger" title="The request did not complete">{error}</Banner>
            )}

            <section className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-heading font-semibold">{currentStage === "Options" ? "Run options" : currentStage === "Steps" ? isRerun ? "Choose what to run again" : "Workflow steps" : currentStage === "Values" ? "Values for the new run" : currentStage === "Confirm" ? "Review the plan" : workflow === undefined ? "No workflow" : "Run input"}</h3>
              {currentStage === "Steps" && workflow && <span className="text-caption text-ui-muted">{selectedStepKeys.length} / {workflow.steps.length} included</span>}
              </div>
              {currentStage === "Input" && inputRun.state === "present" && <p className="text-body text-ui-secondary">{declaredInput ? typedDeclaration.description : <>Enter {inputRunFieldLabel(inputRun.surface.parser) === "Kuali ID" ? "Kuali IDs" : inputRunValueNoun(inputRun.surface.parser)}. Each entry starts one run.</>}</p>}
              {currentStage === "Options" && <p className="text-body text-ui-secondary">Set how this work enters the queue.</p>}
              {currentStage === "Steps" && <p className="text-body text-ui-secondary">{isRerun ? "Select steps for the new run. Statuses show the source outcome." : multiSubject && steps.some(step => step.control.state === "omittable") ? multiSubjectOmissionReason : "Required steps stay included. Optional steps may be omitted."}</p>}
              {currentStage === "Values" && <p className="text-body text-ui-secondary">Review the input and values this rerun will use.</p>}
            </section>

            <div className="flex min-w-0 flex-col gap-[var(--ds-space-loose)]">
              {(currentStage === "Input" || currentStage === "Values") && (
                <section aria-label={isRerun ? "Values" : "Input"} className="flex min-h-0 flex-1 flex-col gap-[var(--ds-space-loose)]">
                  {inputRun.state === "present" ? (
                    !declaredInput && isRerun && snapshot?.values.some(candidate => candidate.state === "available" && candidate.targetStepKey === undefined && inputRun.surface.parser.rules.some(rule => rule.emit === candidate.targetFieldPath)) ? null : <TypedInput
                      surface={inputRun.surface}
                      workflowId={workflowId}
                      text={text}
                      onText={next => { setText(next); setSourceInputUnchanged(false); }}
                      preview={preview}
                      inputRef={typedInputRef}
                      draft={typedValues}
                      onValue={(field, value) => {
                        if (typedDeclaration === undefined) return;
                        const next = changeTypedInput(typedDeclaration, typedValues, field, value);
                        setTypedDraft(next);
                        if (field === typedDeclaration.modeField) setSourceInputUnchanged(false);
                        setSelectedStepKeys(current => workflow?.steps.filter(step => step.control.state !== "selectable"
                          ? current.includes(step.key) : next[step.control.inputField] === true).map(step => step.key) ?? []);
                      }}
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
                  {!declaredInput && isRerun && snapshot !== null && (
                    <section aria-label="Previous values" className="flex flex-col gap-[var(--ds-space-cozy)]">
                      {snapshot.values.length === 0 && <p className={cn(dsText.body, dsFg.muted)}>No reusable values recorded.</p>}
                      <div className="launch-values-fields grid gap-[var(--ds-space-cozy)]">
                      {snapshot.values.map((candidate, index) => {
                        if (candidate.targetStepKey !== undefined) return null;
                        const label = candidate.label;
                        return <div key={`${candidate.nodeId}:${candidate.fieldPath}`} className="min-w-0">
                          {candidate.state === "available" && <Field label={label}><Input className="h-9" value={valueDrafts[index]?.text ?? ""} onChange={event => setValueDrafts(current => ({ ...current, [index]: { text: event.target.value, copied: false } }))} /></Field>}
                          {!(candidate.state === "available" && valueDrafts[index]?.copied && inputRun.state === "present" && inputRun.surface.parser.rules.some(rule => rule.emit === candidate.targetFieldPath)) && <div className="mt-[var(--ds-space-tight)] flex flex-wrap items-baseline justify-between gap-[var(--ds-space-base)] text-caption">
                            <span className="min-w-0 break-words text-[color:var(--ds-fg-muted)]">{candidate.state === "available" ? `Saved ${candidateText(candidate.value)}` : `Unavailable: ${candidate.reason}`}</span>
                            {candidate.state === "available" && <Button size="sm" variant="ghost" className="h-auto p-0 text-caption text-ui-info" aria-label={`Copy ${label}`} onClick={() => setValueDrafts(current => ({ ...current, [index]: { text: candidateText(candidate.value), copied: true } }))}>Use previous</Button>}
                          </div>}
                        </div>;
                      })}
                      </div>
                      {omissionRows.map(row => {
                        const datesOnly = row.form.fields.length > 0 && row.form.fields.every(field => field.kind === "us-date");
                        return <div key={row.step} className={cn("launch-values-omission border-t border-ui-stroke pt-4", datesOnly && "launch-values-dates")}>
                        <div className="mb-4 flex items-start justify-between gap-3"><div><h4 className="mb-[3px] text-body font-semibold">{datesOnly ? "Timecard dates" : row.label}</h4><p className="text-caption text-ui-muted">{datesOnly ? "Timecard read is skipped. Supply both dates to continue." : "This step is skipped. Supply its values to continue."}</p></div>{snapshot.values.some(candidate => candidate.targetStepKey === row.step && candidate.state === "available") && <Button variant="secondary" size="sm" onClick={() => snapshot.values.forEach((candidate, index) => { if (candidate.targetStepKey === row.step && candidate.state === "available") copyOmittedValue(row.step, index); })}>{datesOnly && row.form.fields.length === 2 ? "Use both previous" : "Use all previous"}</Button>}</div>
                        <StepOmissionFactsForm compact step={row.label} form={row.form} draft={row.draft} errors={visibleFactErrors(row)}
                          onChange={(field, next) => changeFact(row.step, row.form, field, next)} onTouch={field => touchFact(row.step, field)}
                          previous={Object.fromEntries(snapshot.values.flatMap((candidate, index) => candidate.targetStepKey === row.step && candidate.state === "available" ? [[candidate.targetFieldPath, { value: candidateText(candidate.value), onUse: () => copyOmittedValue(row.step, index)  }]] : []))} />
                        {datesOnly && <p className="mt-4 text-caption text-ui-muted">From the source run. You can edit dates after copying them.</p>}
                      </div>;
                      })}
                    </section>
                  )}
                </section>
              )}

              {currentStage === "Warning" && warning !== null && (
                <section aria-label="Repeat transaction warning" className="flex flex-col gap-[var(--ds-space-cozy)]">
                  <Banner tone="warning" title="These transactions were already submitted">
                    Running them again may create duplicates.
                  </Banner>
                  {warning.rerun.warnings.map((entry) => {
                    const step = snapshot?.steps.find((candidate) => candidate.nodes.some((node) => node.nodeId === entry.nodeId));
                    if (step === undefined) throw new Error("RERUN_WARNING_STEP_UNAVAILABLE");
                    return <Well key={`${entry.nodeId}:${entry.writeIntentId}`}>
                      <KeyValueList items={[{ key: "Step", value: stepLabel(step.key) }, { key: "System", value: entry.system }]} />
                    </Well>;
                  })}
                </section>
              )}

              {currentStage === "Options" && (
                <RunOptionsLayout priority={priority} onPriorityChange={setPriority} browserMode={browserMode} onBrowserModeChange={setBrowserMode}
                  flags={<>
                    {!isRerun && <Checkbox checked={customizeSteps} onCheckedChange={next => changeCustomizeSteps(next === true)} label="Customize steps" description="Choose optional steps." />}
                    {supportsDryRun && <Checkbox checked={dryRun} onCheckedChange={next => setDryRunRequested(next === true)} label="Dry run" description="Stop before submission." />}
                    <Checkbox checked={captureBrowserScreenshots} onCheckedChange={next => setCaptureBrowserScreenshots(next === true)} label="Capture screenshots" description="Keep browser captures." />
                  </>}
                  fixedFacts={workflow && <><LockedFact label="Active policy" value={ENQUEUE_POLICY_MEANING[workflow.enqueue]} reason={ENQUEUE_POLICY_REASON} /><LockedFact label="Workflow version" value={versionTag(workflow.version)} reason="Fixed by the selected workflow." /></>}>
                  <div>
                    <ChoicePicker label="Workers" value={String(workers)} options={[{ value: "auto", label: "Auto" }, ...Array.from({ length: 8 }, (_, number) => ({ value: String(number + 1), label: String(number + 1) }))]} onChange={value => setWorkers(RunWorkersSchema.parse(value === "auto" ? value : Number(value)))} />
                  </div>
                  <div>
                    <ChoicePicker label="Workbook · Optional" value={workbookId} onChange={setWorkbookId} options={[{ value: "", label: "None" }, ...spreadsheetMocks.files.map(file => ({ value: file.id, label: file.name, description: "Mock spreadsheet" }))]} />
                    <p className="mt-[5px] text-caption text-ui-muted">Choose an already imported workbook for reference or results.</p>
                  </div>
                </RunOptionsLayout>
              )}

              {currentStage === "Steps" && workflow !== undefined && (
                <section aria-labelledby="run-start-steps" className="flex flex-col gap-[var(--ds-space-cozy)]">
                  <h4 id="run-start-steps" className="sr-only">Steps</h4>
                  <RunStepsList>
                    {workflow.steps.map((step) => {
                      const selected = selectedStepKeys.includes(step.key);
                      const control = step.control;
                      const forcedBy = forcedByStep.get(step.key) ?? [];
                      const row = omissionRows.find((candidate) => candidate.step === step.key);
                      const sourceState = snapshot?.steps.find(entry => entry.key === step.key)?.state;
                      return (
                        <li key={step.key} className="launch-step-row flex min-w-0 flex-col gap-2">
                          <div className="flex items-start gap-[var(--ds-space-base)]">
                            <Checkbox checked={selected} disabled={control.state === "required" || forcedBy.length > 0 || (typedDeclaration !== undefined && control.state === "selectable" && (typedDeclaration.controls.some(field => field.field === control.inputField && field.placement === "input") || !typedControlAvailable(typedDeclaration, typedValues, control.inputField))) || (control.state === "omittable" && multiSubject && selected)}
                              onCheckedChange={next => toggleStep(step.key, next === true)} label={step.label}
                              description={step.systems?.map(system => SYSTEM_LABEL[system]).join(" · ")}
                              title={control.state === "required" ? control.reason : control.state === "omittable" && multiSubject ? multiSubjectOmissionReason : undefined} />
                            {isRerun && snapshot !== null && <Badge tone={sourceState === "completed" ? "success" : sourceState === "failed" ? "danger" : "neutral"} className="launch-step-status" data-status={sourceState}>{sourceState === "completed" ? "Completed" : sourceState === "failed" ? "Failed" : "Not started"}</Badge>}
                          </div>
                          {control.state === "required" && <span className="sr-only">{isRerun && snapshot?.steps.find(entry => entry.key === step.key)?.state === "completed" ? `Completed in the source; this workflow requires it to run again. ${control.reason}` : control.reason}</span>}
                          {(forcedBy.length > 0 || (control.state === "omittable" && !selected && !isRerun && !multiSubject)) && <p className="pl-[calc(1rem+var(--ds-space-base))] text-caption text-[color:var(--ds-fg-muted)]">{forcedBy.length > 0 ? `Omitted with ${stepLabels(forcedBy)}.` : "Use saved or entered values instead."}</p>}
                          {control.state === "omittable" && control.forces.length > 0 && (
                            <p className={cn(dsText.meta, dsFg.muted, "pl-[calc(1rem+var(--ds-space-base))]")}>
                              {`Also omits: ${stepLabels(control.forces)}`}
                            </p>
                          )}
                          {row !== undefined && !isRerun && (
                            <div className="ml-[calc(1rem+var(--ds-space-base))] rounded-[var(--ds-radius-md)] bg-[var(--ds-surface-2)] p-[var(--ds-space-cozy)]">
                              <StepOmissionFactsForm
                                step={row.label}
                                form={row.form}
                                draft={row.draft}
                                errors={visibleFactErrors(row)}
                                onChange={(field, next) => changeFact(row.step, row.form, field, next)}
                                onTouch={(field) => touchFact(row.step, field)}
                              />
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </RunStepsList>
                </section>
              )}

              {currentStage === "Confirm" && plan !== null && (
                <RunConfirmLayout count={plan.planned.length} flags={<RunFlagChips dryRun={plan.dryRun} priority={plan.priority} />}
                  description={isRerun ? "A new run linked to the source." : "One run for each accepted entry."}
                  facts={[
                      { key: "Workflow", value: `${workflow?.label ?? plan.workflowId} · ${versionTag(plan.expectedVersion)}` },
                      { key: "Input", value: inputSummary || Object.values(valueDrafts).map(draft => draft.text).filter(Boolean).join(", ") },
                      ...(isRerun && snapshot ? [{ key: "Source", value: rerunSource?.traceId ?? snapshot.source.runId }] : []),
                      { key: "Steps", value: `${selectedStepKeys.length} / ${workflow?.steps.length ?? 0} included${omissionRows.length ? ` · Omitted: ${omissionRows.map(row => row.label).join(", ")}` : ""}` },
                      ...omissionRows.map(row => ({ key: row.form.fields.every(field => field.kind === "us-date") ? "Entered dates" : row.label, value: stepOmissionFactsSummary(row) })),
                      ...(workbookId ? [{ key: "Workbook", value: `${spreadsheetMocks.files.find(file => file.id === workbookId)?.name ?? "Unavailable"}` }] : []),
                      { key: "Workers", value: plan.workers === "auto" ? "Auto" : String(plan.workers) },
                      { key: "Queue", value: plan.priority === "interactive" ? "Interactive" : "Bulk" },
                      { key: "Browser", value: `${browserMode === "headed" ? "Headed" : "Headless"} · screenshots ${captureBrowserScreenshots ? "on" : "off"}` },
                      { key: "Dry run", value: plan.dryRun ? "On" : "Off" },
                  ]}>
                  {omissionMismatch && (
                    <Banner tone="danger" title="This plan does not describe the steps you omitted">
                      {`You omitted ${sentOmittedSteps.length === 0 ? "no steps" : sentOmittedSteps.join(", ")}; the plan came back omitting `
                        + `${planOmittedSteps.length === 0 ? "no steps" : planOmittedSteps.join(", ")}. `
                        + "Go back and plan the run again — this plan would start a different run."}
                    </Banner>
                  )}
                  <PlanRefusals refused={plan.refused} />
                </RunConfirmLayout>
              )}
            </div>
          </DialogBody>
          </div>

        <DialogFooter
          meta={
            <MetaLine
              tone="faint"
              items={[
                isRerun ? "Source run · new run" : `${preview.entries.length} ${preview.entries.length === 1 ? "run" : "runs"}`,
                isRerun ? undefined : workflow?.label,
                currentStage === "Input"
                  ? blockedReason ?? undefined
                  : currentStage === "Steps" && !isRerun
                  ? stepsBlockedReason ?? undefined
                  : currentStage === "Confirm" && plan !== null
                    ? `${String(plan.planned.length)} to create`
                    : undefined,
              ].filter((item): item is string => item !== undefined)}
            />
          }
        >
          {currentStage !== "Warning" && previousStage !== null && (
            <Button variant="ghost" icon={<ArrowLeft aria-hidden className="size-3" />} onClick={() => setCurrentStage(previousStage)}>Back</Button>
          )}
          <Button variant="secondary" onClick={() => currentStage === "Warning" ? setCurrentStage("Steps") : closeAndReset(false)}>
            Cancel
          </Button>
          {currentStage === "Warning" && warning !== null ? (
            <Button variant="primary" onClick={() => { setAcknowledgment(warning.rerun.warningDigest); setPlan(null); setCurrentStage("Values"); }}>Confirm</Button>
          ) : currentStage === "Confirm" && plan !== null ? (
            <Button
              variant="primary"
              icon={<Play aria-hidden className={dsIcon.md} />}
              loading={busy}
              disabled={busy || applied || omissionMismatch || plan.planned.length === 0 || recoveryError !== null || (recovery !== null && recovery.target.startPlanId !== plan.startPlanId)}
              onClick={() => void confirmStart()}
            >
              {plan.dryRun ? "Start dry run" : isRerun ? "Create rerun" : `Start ${plan.planned.length} ${plan.planned.length === 1 ? "run" : "runs"}`}
            </Button>
          ) : (
            <Button
              variant="primary"
              loading={busy}
              iconAfter={<ArrowRight aria-hidden className="size-[14px]" />}
              disabled={busy || recoveryError !== null || recovery !== null || (isRerun && (snapshot === null || sourceError !== null || (currentStage === "Values" && (rerunInputBlocked || stepsBlockedReason !== null)))) || (currentStage === "Input" && blockedReason !== null) || nextStage === null}
              onClick={() => void advance()}
            >
              {nextStage === "Confirm" ? "Preview plan" : "Continue"}
            </Button>
          )}
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
  rerunSource,
  previewLaunch,
  previewRuns,
  onSubmitPreview,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalog: readonly WorkflowCatalogEntry[];
  panelWorkflowId: string;
  actorId: string;
  onApplied?: (workflowId: string, count?: number) => void;
  onOpenIntake: (workflowId: string, intakeSessionId: string) => void;
  onCloseAutoFocus?: (event: Event) => void;
  rerunSource?: RerunLaunchSource;
  previewLaunch?: Readonly<{ workflowId: MockWorkflowId; source?: MockRun }>;
  previewRuns?: readonly MockRun[];
  onSubmitPreview?: (id: MockWorkflowId, draft: MockDraft, sourceId?: string) => void;
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
      rerunSource={rerunSource}
      previewLaunch={previewLaunch}
      previewRuns={previewRuns}
      onSubmitPreview={onSubmitPreview}
    />
  );
}
