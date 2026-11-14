import { StartPlanRequestSchema, type StartPlanRequest } from "../../../models/dashboard/start-plan.js";
import { useWorkbookRows, useWorkbookVersionSources, previewWorkbookRows, resolveWorkbookRowSelection, WORKBOOK_ROW_UNAVAILABLE_TEXT, type WorkbookRowChoice } from "./run-workbook-rows-model.js";
import { spreadsheetField } from "../../../models/fields/workbook-fields.js";
import { RunList, RunListRow } from "../../ds/primitives/run-list.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../models/failures/error-catalog.js";
import { useViewNavigation, useViewState } from "../../app/navigation/view-route-model.js";
import { servedLaunchWorkflows, type WorkflowCatalogEntry } from "../workflows/workflow-catalog-model.js";
import "./launch-presentation.css";
import { mockWorkflow, type MockWorkflowId } from "../workflows/mocks/workflow-mock-catalog.js";
import { statusMock } from "../settings/status-mock/status-mock-model.js";
import { WorkflowMockRunForm } from "../workflows/mocks/workflow-mock-run.js";
import { RunConfirmLayout, RunOptionsLayout } from "./run-launch-layout.js";
import type { MockDraft, MockRun } from "../workflows/mocks/workflow-mock-model.js";
import { RunWorkflowPicker } from "./run-start-picker.js";
import type { RerunValuesSnapshot } from "../../../models/dashboard/rerun-values.js";
import type { RerunWarningWire } from "../../../models/dashboard/rerun-warning.js";
import { canonicalJsonStringify, JsonValueSchema } from "../../../rules/validation/canonical-json.js";
import { candidateText, defaultRerunSteps, partialRerunTypedInput, plainRerunInputText, rerunTypedSourceInput, initialRerunValueDrafts, rerunSubmission, type RerunValueDraft } from "./run-start-rerun-model.js";
import { readLaunchRecovery, readLaunchVerificationPlan, retainLaunchFinal, dismissLaunchRecovery, type LaunchFinalCommand } from "./run-launch-recovery.js";
import { createRunLaunchService, type RerunLaunchSource } from "./run-launch-model.js";
/** Descriptor-driven launch UI; server planning and durable command recovery own admission. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Keyboard, Lock, Play } from "lucide-react";
import { cn } from "../../lib/utils.js";
import {
  useToasts,
  BareButton,
  Badge,
  Banner,
  Button,
  Checkbox,
  Switch,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  EmptyState,
  Field,
  Input,
  KeyValueList,
  MetaLine,
  Table, THead, TBody, TR, TH, TD, Skeleton,
  Well,
  dsFg,
  dsFocus,
  dsIcon,
  dsText,
} from "../../ds/ui.js";
import type { CommandResult, RunWorkerStartupFailure } from "../../../rules/commands/commands.js";
import { runStartRefusalToast, settleCommandResult } from "../../app/commands/command-result.js";
import {
  type InputRunSurface,
  type TypedInputDraft,
  type UploadRunSurface,
} from "../../../models/workflow/ingress.js";
import type { WorkflowModuleRole } from "../../../workflow-kit/validation/module-role.js";
import type { EnqueuePolicy } from "../../../models/workflow/presentation.js";
import type { StartPlanResponse } from "../../client/index.js";
import { useDashboardCommandBinding, useDashboardClient } from "../../state/client-context.js";
import {
  TypedInput,
  PlanRefusals,
  RunFlagChips,
  StepOmissionFactsForm,
  RunReferenceRows,
} from "./run-start-kit.js";
import { useSpreadsheetWiringAdapter } from "../../state/spreadsheet-wiring-adapter.js";
import { SYSTEM_LABEL, type BrowserSystemId } from "../shared/status/system-chip-model.js";
import {
  foldStepOmissionFacts,
  forcedStepOmissions,
  initialStepOmissionDraft,
  inputRunFieldLabel,
  omittedStepViews,
  startRequestFingerprint,
  toggleStepSelection,
  previewRunInput,
  launchWorkbookReferences,
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
import { WorkflowPdfInput } from "../workflows/mocks/workflow-pdf-input.js";
import { previewPdfRun, usePdfRunInput } from "./run-start-pdfs.js";

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
  readonly requiredWorkbookFields: readonly string[];
  readonly workbookReference?: Readonly<{ id: string; keyFieldId: string; mode: "keys" | "all"; writableFields: readonly string[] }>;
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
const NO_TYPED_DRAFT: TypedInputDraft = {};

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
  rerunSource,
  rerunInputText,
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
  onApplied?: (workflowId: string, count?: number, workerStartup?: RunWorkerStartupFailure) => void;
  /** Hand intake the picker’s workflow, never the panel’s incidental scope. */
  onOpenIntake: (workflowId: string, intakeSessionId: string) => void;
  onCloseAutoFocus?: (event: Event) => void;
  rerunSource?: RerunLaunchSource;
  rerunInputText?: string;
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
  const pdfInput = usePdfRunInput(client, commandBinding);
  const resetPdfs = pdfInput.reset;
  const commandBindingRef = useRef(commandBinding);
  commandBindingRef.current = commandBinding;
  const launchService = useMemo(() => createRunLaunchService(client, actorId, { uuid: () => crypto.randomUUID(), now: () => {
    const binding = commandBindingRef.current;
    if (binding === undefined || binding.scope.client !== client || binding.scope.actorId !== actorId) throw new Error("RUN_LAUNCH_AUTHORITY_UNAVAILABLE");
    return binding.authority.nowIso;
  } }), [client, actorId]);
  const { toast } = useToasts();
  const reviewedRequest = useRef<{ planId: string; request: StartPlanRequest } | null>(null);
  const [expiredPlan, setExpiredPlan] = useState(false);
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
  const [selectedWorkbookRows, setSelectedWorkbookRows] = useState<{ source: string; choices: readonly WorkbookRowChoice[] }>();
  const [referenceSelections, setReferenceSelections] = useState<Record<string, { libraryId: string; versionId: string; sheetId: string }>>({});
  const [referenceDrafts, setReferenceDrafts] = useState<Record<string, { libraryId: string; versionId?: string }>>({});
  const library = useSpreadsheetWiringAdapter(open && workflows.some(workflow => workflow.workflowId === workflowId && workflow.workbookReference !== undefined), null, true);
  const selectedWorkflow = workflows.find(workflow => workflow.workflowId === workflowId);
  const workbookReference = selectedWorkflow?.workbookReference;
  const requiredTypes = useMemo(() => workbookReference === undefined ? [] : [workbookReference.id], [workbookReference]);
  const selectedReferences = referenceSelections;
  const referenceId = workbookReference?.id;
  const selectedDraft = referenceId === undefined ? undefined : referenceDrafts[referenceId];
  const selectedLibrary = library.catalog.find(entry => entry.libraryId === selectedDraft?.libraryId && entry.state.origin.kind === 'local' && !entry.state.removed);
  const selectedVersion = selectedLibrary?.state.versions.find(version => version.id === selectedDraft?.versionId);
  const sourceProjection = library.compatibility?.workflows.find(entry => entry.workflowId === workflowId);
  if (library.compatibility !== undefined && workbookReference !== undefined && sourceProjection === undefined) throw new Error(`WORKBOOK_COMPATIBILITY_UNAVAILABLE: ${workflowId}`);
  if (sourceProjection !== undefined && selectedWorkflow !== undefined && (canonicalJsonStringify(sourceProjection.requiredWorkbookFields) !== canonicalJsonStringify(selectedWorkflow.requiredWorkbookFields)
    || canonicalJsonStringify(sourceProjection.workbookReference ?? null) !== canonicalJsonStringify(workbookReference ?? null)))
    throw new Error(`WORKBOOK_COMPATIBILITY_DECLARATION_MISMATCH: ${workflowId}`);
  const referenceSources = sourceProjection?.sources ?? [];
  const versionSources = useWorkbookVersionSources(client, commandBinding?.authority.epoch ?? client,
    selectedLibrary?.libraryId, selectedVersion, selectedLibrary?.state.selectedVersionId,
    selectedWorkflow?.requiredWorkbookFields ?? [], referenceSources);
  const initialWorkflow = workflows.find((entry) => entry.workflowId === defaultWorkflowId(workflows, panelWorkflowId));
  const [customizeSteps, setCustomizeSteps] = useViewState("launchCustomize", false);
  const stepContext = useRef({ workflowId, workflows });
  stepContext.current = { workflowId, workflows };
  const defaultStepKeys = (forWorkflow: string, from = stepContext.current.workflows): string[] =>
    from.find((entry) => entry.workflowId === forWorkflow)?.steps.filter(({ includedByDefault }) => includedByDefault).map(({ key }) => key) ?? [];
  /** A selection belongs to the workflow that made it; the workflow shown falls back to its own defaults. */
  const [stepSelection, setStepSelection] = useState<Readonly<{ workflowId: string; keys: readonly string[] }>>();
  const selectedStepKeys = useMemo(() => stepSelection?.workflowId === workflowId ? [...stepSelection.keys] : defaultStepKeys(workflowId, workflows), [stepSelection, workflowId, workflows]);
  const setSelectedStepKeys = useCallback((next: string[] | ((current: string[]) => string[]), forWorkflow: string = stepContext.current.workflowId) =>
    setStepSelection((previous) => ({ workflowId: forWorkflow, keys: typeof next === "function"
      ? next(previous?.workflowId === forWorkflow ? [...previous.keys] : defaultStepKeys(forWorkflow)) : next })), []);
  /** Keep drafts across checkbox toggles, but clear them across workflow or customization exits. */
  const [stepDrafts, setStepDrafts] = useState<Readonly<Record<string, StepOmissionDraft>>>({});
  const [touchedFacts, setTouchedFacts] = useState<ReadonlySet<string>>(() => new Set());
  const [factsAttempted, setFactsAttempted] = useState(false);
  const [text, setText] = useState("");
  /** A draft belongs to the workflow that made it; another workflow (e.g. restored view state) sees an empty one. */
  const [typedState, setTypedState] = useState<Readonly<{ workflowId: string; draft: TypedInputDraft }>>(() => ({ workflowId: initialWorkflow?.workflowId ?? "", draft: initialWorkflow?.inputRun.state === "present" && initialWorkflow.inputRun.surface.typedInput ? typedInputDefaults(initialWorkflow.inputRun.surface.typedInput) : {} }));
  const typedDraft = typedState.workflowId === workflowId ? typedState.draft : NO_TYPED_DRAFT;
  const setTypedDraft = (forWorkflow: string, draft: TypedInputDraft) => setTypedState({ workflowId: forWorkflow, draft });
  const [sourceInputUnchanged, setSourceInputUnchanged] = useState(false);
  const [priority, setPriority] = useState<StartPriority>("interactive");
  const [dryRunRequested, setDryRunRequested] = useState(false);
  const [browserMode, setBrowserMode] = useState<BrowserMode>("headed");
  const captureBrowserScreenshots = true;
  const [plan, setPlan] = useState<StartPlanResponse | null>(null);
  const [result, setResult] = useState<Exclude<CommandResult, { state: "pending" }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { sending.current = false; setBusy(false); }, [commandBinding?.scope]);

  /** Changing workflow clears its parser input and bound plan; another workflow cannot reuse either. */
  const selectWorkflow = useCallback((next: string, preserveStage = false) => {
    resetPdfs();
    setWorkflowId(next);
    setText("");
    const nextInput = workflows.find(entry => entry.workflowId === next)?.inputRun;
    setTypedDraft(next, nextInput?.state === "present" && nextInput.surface.typedInput ? typedInputDefaults(nextInput.surface.typedInput) : {}); setSourceInputUnchanged(false);
    setPlan(null); reviewedRequest.current = null; setExpiredPlan(false);
    setResult(null);
    setError(null);
    if (!preserveStage) { setCurrentStage("Input"); setCustomizeSteps(false); }
    // Reset start method with workflow; unavailable spreadsheet declarations must not leave a selected hidden tab.
    setReferenceSelections({});
    setSelectedWorkbookRows(undefined);
    setStepSelection(undefined);
    setStepDrafts({});
    setTouchedFacts(new Set());
    setFactsAttempted(false);
    setPriority("interactive");
    setDryRunRequested(false);
    setBrowserMode("headed");
  }, [workflows, setCurrentStage, setCustomizeSteps, setWorkflowId, resetPdfs]);

  // Opening lands on the panel you are standing in, every time — including the
  // second time, which is why this keys on `open` rather than running once.
  useEffect(() => {
    reviewedRequest.current = null; setExpiredPlan(false);
    const instance = ++launchInstance.current;
    if (!open) return;
    resetPdfs();
    if (!routed && !previewLaunch && selectedWorkflowRef.current !== defaultWorkflowId(workflows, panelWorkflowId)) selectWorkflow(defaultWorkflowId(workflows, panelWorkflowId), true);
    if (!routed) setLocalPreviewSelection(previewLaunch);
    setPickerQuery("");
    setSnapshot(null); setSourceError(null); setValueDrafts({}); setCopiedOmissions({}); setSourceInputUnchanged(false);
    setWarning(null); setAcknowledgment(undefined); setBusy(false); sending.current = false;
    try { setRecovery(readLaunchRecovery(window.sessionStorage, actorId)); setRecoveryError(null); }
    catch (caught) { setRecoveryError(caught instanceof Error ? caught.message : String(caught)); }
    if (rerunSource !== undefined) {
      setTypedState({ workflowId: "", draft: {} }); setText("");
      setCurrentStage("Steps"); setCustomizeSteps(true);
      void launchService.openRerun({ runId: rerunSource.runId, expectedVersion: rerunSource.expectedVersion }).then((response) => {
        if (launchInstance.current !== instance) return;
        if (response.state === "refused") { setSourceError(`Rerun unavailable: ${response.code}`); return; }
        if (response.snapshot.source.runId !== rerunSource.runId || response.snapshot.source.version !== rerunSource.expectedVersion) throw new Error(formatErrorCatalogFailure(createErrorCatalogFailure("BOUNDARY_VALIDATION_FAILED", { source: "http-response" })).text);
        const sourceWorkflow = workflows.find((entry) => entry.workflowId === response.snapshot.source.workflow);
        if (sourceWorkflow === undefined) throw new Error("RERUN_WORKFLOW_UNAVAILABLE");
        const selection = defaultRerunSteps(response.snapshot, sourceWorkflow);
        setWorkflowId(sourceWorkflow.workflowId); setSelectedStepKeys(selection, sourceWorkflow.workflowId); setSnapshot(response.snapshot);
        setValueDrafts(initialRerunValueDrafts(response.snapshot, sourceWorkflow));
        if (rerunInputText !== undefined) {
          if (sourceWorkflow.inputRun.state !== "present" || sourceWorkflow.inputRun.surface.typedInput !== undefined
            || response.snapshot.source.outcome !== "failed" || response.snapshot.transactions.length !== 0) throw new Error(formatErrorCatalogFailure(createErrorCatalogFailure("COMMAND_REFUSED", {})).text);
          setText(rerunInputText); setValueDrafts({}); setSelectedStepKeys(sourceWorkflow.steps.map(step => step.key), sourceWorkflow.workflowId);
          setCurrentStage("Values");
        }
        if (sourceWorkflow.inputRun.state === "present" && sourceWorkflow.inputRun.surface.typedInput !== undefined) {
          if (response.snapshot.sourceInput.state === "unavailable") throw new Error(formatErrorCatalogFailure(createErrorCatalogFailure("RERUN_SOURCE_INPUT_PROTECTED", {})).text);
          const declaration = sourceWorkflow.inputRun.surface.typedInput;
          const input = response.snapshot.sourceInput.value;
          const partial = response.snapshot.sourceInput.state === "partial" ? partialRerunTypedInput(declaration, response.snapshot.sourceInput) : undefined;
          const restored = partial?.draft ?? restoreTypedInput(declaration, input);
          setTypedDraft(sourceWorkflow.workflowId, restored);
          setText(partial?.text ?? typedInputText(declaration, input));
          setSourceInputUnchanged(partial === undefined || response.snapshot.sourceInput.state === "partial" && response.snapshot.sourceInput.identityCopied);
          setSelectedStepKeys(sourceWorkflow.steps.filter(step => step.control.state !== "selectable"
            || restored[step.control.inputField] === true).map(step => step.key), sourceWorkflow.workflowId);
          setValueDrafts({});
        } else if (sourceWorkflow.inputRun.state === "present" && rerunInputText === undefined) {
          setText(plainRerunInputText(sourceWorkflow.inputRun.surface, response.snapshot.sourceInput));
        }
      }).catch((caught: unknown) => {
        if (launchInstance.current === instance) { setSnapshot(null); setSourceError(caught instanceof Error ? caught.message : String(caught)); }
      });
    }
    return () => { launchInstance.current = instance + 1; };
  }, [open, workflows, panelWorkflowId, selectWorkflow, rerunSource, rerunInputText, actorId, launchService, previewLaunch, routed, setCurrentStage, setCustomizeSteps, setWorkflowId, setSelectedStepKeys, resetPdfs]);

  const pickWorkflow = useCallback((id: string) => {
    if (selectedWorkflowRef.current === id || sending.current) return;
    const entry = catalog.find(flow => flow.id === id);
    if (!entry || entry.launch.state === "unavailable") return;
    if (entry.launch.state === "preview" && onSubmitPreview === undefined) return;
    selectedWorkflowRef.current = id;
    ++launchInstance.current;
    setBusy(false);
    if (entry.preview && (statusMock() !== undefined && entry.preview.runnable || !entry.served)) setPreviewSelection({ workflowId: entry.preview.id });
    else if (entry.served) {
      setPreviewSelection(undefined);
      selectWorkflow(id);
    }
  }, [catalog, selectWorkflow, onSubmitPreview, setPreviewSelection]);

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
        values[control.inputField] = typedControlAvailable(typedDeclaration, values, control.inputField) && selectedStepKeys.includes(step.key);
    }
    return values;
  }, [typedDeclaration, typedDraft, workflow, selectedStepKeys]);
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
  const requestFingerprint = canonicalJsonStringify([rowIdentity, workbookRows.state, rowSelectionFresh, selectedWorkbookRows?.choices.map(({ sheetId, rowId }) => ({ sheetId, rowId })) ?? [], library.catalogLoading, library.catalogRefreshing, library.catalogError, library.compatibility ?? null, versionSources.state, versionSources.sources, selectedReferences, library.catalog.filter(entry => Object.values(selectedReferences).some(selection => selection.libraryId === entry.libraryId)).map(entry => [entry.libraryId, entry.state.revision]), rerunSource ?? null, valueDrafts, copiedOmissions, typedValues, sourceInputUnchanged, pdfInput.draft, startRequestFingerprint({
    workflowId,
    text,
    dryRun,
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
    setPlan(null); reviewedRequest.current = null; setExpiredPlan(false);
    setResult(null);
    setError(null);
    if (!previewOwnsStages) setCurrentStage((current) => current === "Confirm" ? (isRerun ? "Values" : "Input") : current);
  }, [requestFingerprint, isRerun, setCurrentStage, previewOwnsStages]);

  const typedInputRef = useRef<HTMLTextAreaElement>(null);

  const preview = useMemo((): RunInputPreview => {
    if (pdfSurface !== undefined) return previewPdfRun(pdfSurface, pdfInput.draft);
    if (inputRun.state !== "present") return { entries: [], submissions: [], problem: null };
    if (rowCapability !== undefined) {
      const selected = selectedWorkbookRows?.choices ?? [];
      const value = previewWorkbookRows(inputRun.surface, selected, selected, typedValues);
      if (!rowSelectionFresh) return { ...value, submissions: [], problem: "The selected rows belong to earlier spreadsheet data. Clear the previous selection and choose rows again." };
      if (workbookRows.state !== "ready") return { ...value, submissions: [], problem: workbookRows.error ?? (workbookRows.state === "loading" ? "Loading saved spreadsheet rows." : "Saved spreadsheet rows are unavailable. Choose an available spreadsheet and version.") };
      return value;
    }
    return previewRunInput(inputRun.surface, text, typedValues,
      sourceInputUnchanged && snapshot?.source.runId === rerunSource?.runId && snapshot?.source.version === rerunSource?.expectedVersion && snapshot !== null ? rerunTypedSourceInput(inputRun.surface.typedInput, snapshot.sourceInput) : undefined);
  }, [inputRun, rowCapability, selectedWorkbookRows, rowSelectionFresh, workbookRows.state, workbookRows.error, text, typedValues, snapshot, rerunSource, sourceInputUnchanged, pdfSurface, pdfInput.draft]);



  const submitPlan = useCallback(async (): Promise<void> => {
    if (preview.problem !== null || (!isRerun && preview.entries.length === 0)) return;
    if (isRerun && (snapshot === null || preview.entries.length > 1)) return;
    if (declaredInput && preview.submissions.length !== 1 && isRerun) return;
    if (requiredTypes.length > 0 && (library.catalogLoading || library.catalogRefreshing || library.catalogError || library.compatibility === undefined || versionSources.state !== 'ready')) { setError('Reference data is unavailable. Refresh it before planning.'); return; }
    const dispatchedFor = requestFingerprint;
    const instance = launchInstance.current;
    setBusy(true);
    setError(null);
    try {
      const values = snapshot === null ? null : pdfSurface === undefined ? rerunSubmission(snapshot, preview.submissions[0] ?? {}, valueDrafts)
        : { submission: preview.submissions[0], copiedFrom: [] };
      const copiedFrom = [...(values?.copiedFrom ?? []), ...Object.entries(copiedOmissions).flatMap(([index, copied]) => {
        const candidate = snapshot?.values[Number(index)];
        return copied && candidate?.state === "available" && candidate.targetStepKey !== undefined
          && !selectedStepKeys.includes(candidate.targetStepKey)
          ? [{ nodeId: candidate.nodeId, fieldPath: candidate.fieldPath, targetFieldPath: candidate.targetFieldPath, targetStepKey: candidate.targetStepKey }] : [];
      })];
      const request = StartPlanRequestSchema.parse({
        workflowId,
        submissions: values === null ? preview.submissions : [values.submission],
        ...(snapshot === null ? {} : { rerunSource: { runId: snapshot.source.runId, expectedVersion: snapshot.source.version,
          intent: "rerun", selectedStepKeys, copiedFrom }, ...(acknowledgment === undefined ? {} : { warningAcknowledgment: acknowledgment }) }),
        dryRun,
        browserMode,
        captureBrowserScreenshots,
        priority,
        ...(requiredTypes.length ? { workbookReferences: launchWorkbookReferences(requiredTypes, library.catalog, selectedReferences, values === null ? preview.submissions.length : 1,
          versionSources.sources, (workbookReference?.writableFields.length ?? 0) > 0,
          rowCapability === undefined ? undefined : { typeId: rowCapability.typeId, rows: selectedWorkbookRows?.choices ?? [] }) } : {}),
        ...(customizeSteps || declaredInput ? { selectedStepKeys } : {}),
        // Send omission facts only after every declared form parses.
        ...(customizeSteps && stepOmissions !== null && stepOmissions.length > 0 ? { stepOmissions } : {}),
      });
      const next = await launchService.preview(request);
      // Ignore superseded plan responses; their tokens describe text no longer in the form.
      if (requestFingerprintRef.current !== dispatchedFor || launchInstance.current !== instance) return;
      reviewedRequest.current = { planId: next.startPlanId, request };
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
  }, [isRerun, snapshot, valueDrafts, copiedOmissions, acknowledgment, browserMode, captureBrowserScreenshots, launchService, customizeSteps, dryRun, preview, priority, requestFingerprint, selectedStepKeys, stepOmissions, workflowId, setCurrentStage, declaredInput, requiredTypes, library.catalog, library.catalogLoading, library.catalogRefreshing, library.catalogError, library.compatibility, versionSources, workbookReference, selectedReferences, rowCapability, selectedWorkbookRows, pdfSurface]);

  const closeAndReset = useCallback((next: boolean) => {
    onOpenChange(next);
    if (!next) {
      ++launchInstance.current;
      if (result !== null && recovery !== null) {
        dismissLaunchRecovery(window.sessionStorage, recovery); setRecovery(null); finalRequest.current = null;
      }
      // Closing invalidates single-use plans; typed drafts may survive, consumed authority may not.
      setPlan(null); reviewedRequest.current = null; setExpiredPlan(false);
      setResult(null);
      setError(null);
      setCurrentStage("Input");
    }
  }, [onOpenChange, result, recovery, setCurrentStage]);


  const sendFinal = useCallback(async (command: LaunchFinalCommand, dispatchedFor: string, expiryRequest?: StartPlanRequest): Promise<void> => {
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
      const outcome = await launchService.submit(command, binding, verificationPlan);
      if (requestFingerprintRef.current !== dispatchedFor || launchInstance.current !== instance || commandBindingRef.current?.scope !== binding.scope) return;
      const reply = outcome.reply;
      if (outcome.kind === "refused" && reply !== undefined && "state" in reply && reply.state === "rejected"
        && reply.code === "RUN_START_PLAN_EXPIRED" && expiryRequest !== undefined) {
        dismissLaunchRecovery(window.sessionStorage, command);
        finalRequest.current = null; setRecovery(null); setPlan(null); reviewedRequest.current = null; setExpiredPlan(false); setResult(null);
        try {
          const next = await launchService.preview(expiryRequest);
          if (requestFingerprintRef.current !== dispatchedFor || launchInstance.current !== instance || commandBindingRef.current?.scope !== binding.scope) return;
          reviewedRequest.current = { planId: next.startPlanId, request: expiryRequest };
          setPlan(next); setExpiredPlan(true);
          if (next.rerun !== undefined && next.rerun.warnings.length > 0 && next.rerun.acknowledgment !== next.rerun.warningDigest) {
            setWarning({ workflowId: next.workflowId, rerun: next.rerun }); setCurrentStage("Warning");
          } else setCurrentStage("Confirm");
        } catch (caught) {
          finalDiagnostic.current = { command, cause: caught };
          if (requestFingerprintRef.current !== dispatchedFor || launchInstance.current !== instance || commandBindingRef.current?.scope !== binding.scope) return;
          closeAndReset(false);
          toast(runStartRefusalToast(formatErrorCatalogFailure(createErrorCatalogFailure("RUN_START_READINESS_UNAVAILABLE", {})).text));
        }
        return;
      }
      binding.feedback(outcome);
      if (outcome.kind === "confirmed") {
        dismissLaunchRecovery(window.sessionStorage, command);
        finalRequest.current = null; setRecovery(null); setPlan(null); reviewedRequest.current = null; setExpiredPlan(false); setResult(null); setBusy(false);
        const workerStartup = reply !== undefined && "state" in reply && (reply.state === "applied" || reply.state === "already-applied")
          ? reply.workerStartup : undefined;
        onApplied?.(command.target.workflowId, plan?.planned.length, workerStartup);
        onOpenChange(false);
        ++launchInstance.current;
      } else if ((outcome.kind === "refused" || outcome.kind === "conflict") && reply !== undefined && "state" in reply
        && (reply.state === "rejected" || reply.state === "conflict")) {
        dismissLaunchRecovery(window.sessionStorage, command);
        finalRequest.current = null; setRecovery(null);
        closeAndReset(false);
      } else {
        setError(outcome.feedback.text);
        if (outcome.kind !== "uncertain" && reply !== undefined && "state" in reply
          && (reply.state === "rejected" || reply.state === "conflict" || reply.state === "confirmation-required")) {
          setResult({ ...reply, message: outcome.feedback.text });
        }
      }
    } catch (caught) {
      finalDiagnostic.current = { command, cause: caught };
      if (requestFingerprintRef.current !== dispatchedFor || launchInstance.current !== instance || commandBindingRef.current?.scope !== binding.scope) return;
      setError(formatErrorCatalogFailure(createErrorCatalogFailure("COMMAND_DISPATCH_FAILED", {})).text);
    } finally {
      if (sending.current === attempt) sending.current = false;
      if (launchInstance.current === instance && commandBindingRef.current?.scope === binding.scope) setBusy(false);
    }
  }, [launchService, onApplied, onOpenChange, plan, client, actorId, closeAndReset, setCurrentStage, toast]);
  const confirmStart = useCallback(async (): Promise<void> => {
    if (plan === null || sending.current || recoveryError !== null) return;
    if (commandBinding === undefined || commandBinding.scope.client !== client || commandBinding.scope.actorId !== actorId) { setError(formatErrorCatalogFailure(createErrorCatalogFailure("DASHBOARD_AUTHORITY_REPLACED", {})).text); return; }
    const expiryRequest = finalRequest.current === null && recovery === null && reviewedRequest.current?.planId === plan.startPlanId
      ? reviewedRequest.current.request : undefined;
    if (finalRequest.current === null || finalRequest.current.target.startPlanId !== plan.startPlanId) {
      finalRequest.current = launchService.prepareFinal(plan);
    }
    await sendFinal(finalRequest.current, requestFingerprint, expiryRequest);
  }, [client, actorId, commandBinding, launchService, plan, requestFingerprint, recoveryError, recovery, sendFinal]);

  // already-applied confirms the same enqueue; its plan token is single-use.
  const applied = result !== null && settleCommandResult(result).kind === "applied";
  const blockedReason = pdfSurface !== undefined ? pdfInput.loading ? "Reading PDFs…" : pdfInput.error !== null ? "Fix the refused PDF selection first." : preview.entries.length === 0 ? "Choose at least one PDF." : null : inputRun.state !== "present"
    ? inputRun.reason
    : preview.problem !== null
      ? "Fix the refused entry first."
      : preview.entries.length === 0
        ? rowCapability === undefined ? "Type at least one value." : "Select at least one saved row."
        : null;
  const rerunInputBlocked = pdfSurface !== undefined ? blockedReason !== null : preview.problem !== null || preview.entries.length > 1 || (declaredInput && preview.entries.length === 0);
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
  }, [currentStage, workflow, setCurrentStage, setCustomizeSteps, declaredInput, typedDeclaration, typedValues, setSelectedStepKeys]);

  /** Use the shared cascade; locked omissions cannot be changed by another checkbox path. */
  const toggleStep = useCallback((key: string, next: boolean) => {
    setSelectedStepKeys((current) => [...toggleStepSelection(workflow?.steps ?? EMPTY_STEPS, current, key, next)]);
  }, [workflow, setSelectedStepKeys]);

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
  const selectedLaunch = catalog.find(entry => entry.id === (previewSelection?.workflowId ?? workflowId))?.launch;
  const launchRefusal = selectedLaunch?.state === 'unavailable' ? selectedLaunch.reason : undefined;
  const previewFlow = previewSelection ? mockWorkflow(previewSelection.workflowId) : undefined;

  const referenceControls = (types: readonly string[]) => types.length === 0 ? undefined : <>{library.catalogLoading ? <p role="status">Loading reference data…</p> : types.map(typeId => {
    const draft = referenceDrafts[typeId];
    const sheetOptions = versionSources.state === 'ready' ? versionSources.sources : [];
    const requiredFields = selectedWorkflow?.requiredWorkbookFields.map(id => spreadsheetField(id).label) ?? [];
    const sheets = library.catalog.filter(entry => entry.state.origin.kind === 'local' && !entry.state.removed).map(entry => ({ libraryId: entry.libraryId, name: entry.name,
      versions: entry.state.versions, currentVersionId: entry.state.selectedVersionId, worksheets: referenceSources.filter(source => source.libraryId === entry.libraryId).map(source => source.sheetName) }));
    const clearSelection = () => setReferenceSelections(current => Object.fromEntries(Object.entries(current).filter(([key]) => key !== typeId)));
    return <RunReferenceRows key={typeId} requiredLabel={requiredFields.length > 1 ? `${requiredFields.slice(0, -1).join(', ')} and ${requiredFields[requiredFields.length - 1]}` : requiredFields.join('')}
      sheets={sheets} chosenLibraryId={draft?.libraryId} chosenVersionId={draft?.versionId} chosenSheetId={selectedReferences[typeId]?.sheetId ?? ''}
      worksheets={sheetOptions.map(source => ({ sheetId: source.sheetId, sheetName: source.sheetName }))} worksheetsState={versionSources.state} worksheetsError={versionSources.error}
      busy={library.catalogRefreshing || library.compatibility === undefined} catalogError={library.catalogError}
      onPick={(libraryId, versionId) => { setReferenceDrafts(current => ({ ...current, [typeId]: { libraryId, versionId } })); clearSelection(); }}
      onVersion={versionId => { if (draft !== undefined) setReferenceDrafts(current => ({ ...current, [typeId]: { libraryId: draft.libraryId, versionId } })); clearSelection(); }}
      onWorksheet={sheetId => {
        const source = sheetOptions.find(candidate => candidate.sheetId === sheetId);
        if (source !== undefined) setReferenceSelections(current => ({ ...current, [typeId]: { libraryId: source.libraryId, versionId: source.versionId, sheetId: source.sheetId } }));
      }}
      onRemove={() => { setReferenceDrafts(current => Object.fromEntries(Object.entries(current).filter(([key]) => key !== typeId))); clearSelection(); }}
      onRefresh={() => void library.adapter.refreshCatalog()} />;
  })}</>;
  const continueEnabled = !busy && recoveryError === null && recovery === null && currentStage !== "Warning" && nextStage !== null
    && !(isRerun && (snapshot === null || sourceError !== null || (currentStage === "Values" && (rerunInputBlocked || stepsBlockedReason !== null)))) && !(currentStage === "Input" && blockedReason !== null);
  const warningEnabled = currentStage === "Warning" && warning !== null && !busy && recoveryError === null && recovery === null;
  const acknowledgeWarning = () => { if (warning === null) return; setAcknowledgment(warning.rerun.warningDigest); setPlan(null); reviewedRequest.current = null; setCurrentStage("Values"); };
  const startEnabled = currentStage === "Confirm" && plan !== null && !(busy || applied || omissionMismatch || plan.planned.length === 0 || recoveryError !== null || (recovery !== null && recovery.target.startPlanId !== plan.startPlanId));
  // Enter continues or starts; Shift+Enter keeps its newline. Buttons, links and open pickers keep Enter for themselves.
  const enterRef = useRef<(() => void) | null>(null);
  enterRef.current = previewOwnsStages ? null : startEnabled ? () => void confirmStart() : warningEnabled ? acknowledgeWarning : continueEnabled ? () => void advance() : null;
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented || event.isComposing) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target === null || (target !== document.body && target.closest('[role="dialog"]') === null)) return;
      if (target.closest('a, button:not([role="checkbox"]):not([role="switch"]), [role="combobox"], [role="listbox"], [role="menu"], [role="option"]')) return;
      if (enterRef.current === null) return;
      event.preventDefault();
      enterRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={closeAndReset}>
      <DialogContent
        onCloseAutoFocus={onCloseAutoFocus}
        size="xl"
        band
        title={previewSelection?.source || isRerun ? "Rerun" : "Start run"}
        description={previewFlow ? `${previewFlow.label} · Workflow preview` : isRerun ? [workflow?.label, rerunSource?.label].filter(Boolean).join(" · ") : workflow ? `${workflow.label} · Workflow preview` : "Choose a workflow to begin"}
        className={cn("launch-design launch-dialog", (previewSelection?.source || isRerun) && "launch-rerun")}
      >
          {!previewSelection?.source && !isRerun && picker}

          {launchRefusal ? <><DialogBody><EmptyState title="Workflow unavailable" description={launchRefusal} /></DialogBody><DialogFooter><Button onClick={() => closeAndReset(false)}>Close</Button></DialogFooter></> : previewSelection && onSubmitPreview && previewRuns ? <WorkflowMockRunForm key={`${previewSelection.workflowId}:${previewSelection.source?.id ?? "start"}`} workflowId={previewSelection.workflowId} source={previewSelection.source} runs={previewRuns} initialDraft={previewDrafts.current.get(`${previewSelection.workflowId}:${previewSelection.source?.id ?? "start"}`)} onDraftChange={draft => previewDrafts.current.set(`${previewSelection.workflowId}:${previewSelection.source?.id ?? "start"}`, draft)} onClose={() => closeAndReset(false)} onSubmit={onSubmitPreview} /> : <>
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
          <DialogBody key={currentStage} className="launch-content @container">
            {isRerun && snapshot === null && sourceError === null && <p role="status">Loading source…</p>}
            {sourceError !== null && <Banner tone="danger" title="Rerun unavailable">{sourceError}</Banner>}
            {recoveryError !== null && <Banner tone="danger" title="Submission recovery unavailable">{recoveryError}</Banner>}
            {/* While the Start is in flight its outcome is not unknown yet; only a settled, unresolved command needs readback. */}
            {recovery !== null && result === null && !busy && (
              <Banner tone="warning" title="A previous submission needs readback">
                <MetaLine items={[recovery.commandId, recovery.target.workflowId]} />
                <Button disabled={busy} onClick={() => void sendFinal(recovery, requestFingerprint)}>Replay exact submission</Button>
              </Banner>
            )}
            {error !== null && (
              <Banner tone="danger" title="The request did not complete">{error}</Banner>
            )}

            {(currentStage === "Steps" || currentStage === "Confirm") && <section className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-heading font-semibold">{currentStage === "Steps" ? isRerun ? "Choose what to run again" : "Workflow steps" : "Review the plan"}</h3>
              {currentStage === "Steps" && workflow && <span className="text-caption text-ui-muted">{selectedStepKeys.length} / {workflow.steps.length} included</span>}
              </div>
              {currentStage === "Steps" && <p className="text-body text-ui-secondary">{isRerun ? "Select steps for the new run. Statuses show the source outcome." : multiSubject && steps.some(step => step.control.state === "omittable") ? multiSubjectOmissionReason : "Required steps stay included. Optional steps may be omitted."}</p>}
            </section>}

            <div className="flex min-w-0 flex-col gap-[var(--ds-space-loose)]">
              {(currentStage === "Input" || currentStage === "Values") && (
                <section aria-label={isRerun ? "Values" : "Input"} className="flex min-h-0 flex-1 flex-col gap-[var(--ds-space-loose)]">
                  {pdfSurface !== undefined ? <>
                    <WorkflowPdfInput files={pdfInput.draft?.files.map(file => ({ name: file.source.fileName, size: file.source.artifact.bytes })) ?? []}
                      busy={busy || pdfInput.loading} onChoose={files => { void pdfInput.choose(pdfSurface, files); }} onRemove={pdfInput.remove} />
                    {pdfInput.error !== null && <Banner tone="danger" title="PDF selection refused">{pdfInput.error}</Banner>}
                  </> : inputRun.state === "present" ? (
                    !declaredInput && isRerun && rerunInputText === undefined && snapshot?.values.some(candidate => candidate.state === "available" && candidate.targetStepKey === undefined && inputRun.surface.parser.rules.some(rule => rule.emit === candidate.targetFieldPath)) ? null : <TypedInput
                      surface={inputRun.surface}
                      workflowId={workflowId}
                      text={text}
                      onText={next => { setText(next); setSourceInputUnchanged(false); }}
                      preview={preview}
                      inputRef={typedInputRef}
                      draft={typedValues}
                      rowInput={rowCapability === undefined ? undefined : <>
                        {referenceControls([rowCapability.typeId])}
                        {library.catalogRefreshing && <p role="status">Refreshing reference data. Row selection is disabled.</p>}
                        {workbookRows.state === "loading" && <div role="status" aria-label="Loading saved rows"><Skeleton className="h-9 w-full" /></div>}
                        {workbookRows.state === "error" && <Banner tone="danger" title="Saved rows unavailable">{workbookRows.error}<Button variant="secondary" onClick={() => void library.adapter.refreshCatalog()}>Refresh reference data</Button></Banner>}
                        {!rowSelectionFresh && <Banner tone="warning" title="Previous row selection"><p>The selected rows are from earlier spreadsheet data and cannot be planned.</p><Button variant="secondary" onClick={() => setSelectedWorkbookRows(undefined)}>Clear previous row selection</Button></Banner>}
                        {workbookRows.state === "ready" && rowChoices.length === 0 && <EmptyState title="No saved data rows" description="This version contains no rows after the worksheet headers." />}
                        {rowChoices.length > 0 && <Table label="Saved spreadsheet rows"><THead><TR><TH>Select</TH><TH>Source row</TH><TH>Lookup key</TH></TR></THead><TBody>{rowChoices.map(choice => {
                          const selected = selectedWorkbookRows?.choices.some(row => row.sheetId === choice.sheetId && row.rowId === choice.rowId) ?? false;
                          const label = `${choice.sourceLabel}: ${choice.key.state === "available" ? choice.key.value : WORKBOOK_ROW_UNAVAILABLE_TEXT[choice.key.reason]}`;
                          return <TR key={JSON.stringify([choice.sheetId, choice.rowId])} selected={selected}><TD><Checkbox label={<span className="sr-only">{`Select ${label}`}</span>} checked={selected}
                            disabled={workbookRows.state !== "ready" || !rowSelectionFresh || choice.key.state === "unavailable" || recovery !== null}
                            onCheckedChange={checked => setSelectedWorkbookRows(current => ({ source: rowSource,
                              choices: resolveWorkbookRowSelection(workbookRows.choices, checked === true ? [...(current?.choices ?? []), choice] : (current?.choices ?? []).filter(row => row.sheetId !== choice.sheetId || row.rowId !== choice.rowId)) }))} /></TD>
                            <TD>{choice.sourceLabel}</TD><TD className="break-all">{choice.key.state === "available" ? choice.key.value : WORKBOOK_ROW_UNAVAILABLE_TEXT[choice.key.reason]}</TD></TR>;
                        })}</TBody></Table>}
                      </>}
                      onValue={(field, value) => {
                        if (typedDeclaration === undefined) return;
                        const next = changeTypedInput(typedDeclaration, typedValues, field, value);
                        setTypedDraft(workflowId, next);
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
                  {referenceControls(requiredTypes.filter(typeId => typeId !== rowCapability?.typeId))}
                  {pdfSurface === undefined && !declaredInput && isRerun && snapshot !== null && (
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
                    {!isRerun && <RunListRow title="Customize steps" description="Choose optional steps."><Switch hideLabel label="Customize steps" checked={customizeSteps} onCheckedChange={next => changeCustomizeSteps(next === true)} className="!min-h-0 !w-auto !py-0" /></RunListRow>}
                    {supportsDryRun && <RunListRow title="Dry run" description={dryRunDescription}><Switch hideLabel label="Dry run" checked={dryRun} onCheckedChange={next => setDryRunRequested(next === true)} className="!min-h-0 !w-auto !py-0" /></RunListRow>}
                    <RunListRow title="Screenshots" description="Required by this workflow."><span className="inline-flex items-center gap-1.5 text-[12px] text-ui-secondary"><Lock aria-hidden className="size-3" />Always on</span></RunListRow>
                  </>} />
              )}

              {currentStage === "Steps" && workflow !== undefined && (
                <section aria-labelledby="run-start-steps" className="flex flex-col gap-[var(--ds-space-cozy)]">
                  <h4 id="run-start-steps" className="sr-only">Steps</h4>
                  <RunList label="Steps">
                    {workflow.steps.map((step) => {
                      const selected = selectedStepKeys.includes(step.key);
                      const control = step.control;
                      const forcedBy = forcedByStep.get(step.key) ?? [];
                      const row = omissionRows.find((candidate) => candidate.step === step.key);
                      const sourceState = snapshot?.steps.find(entry => entry.key === step.key)?.state;
                      const systems = step.systems?.map(system => SYSTEM_LABEL[system]).join(" · ");
                      const note = forcedBy.length > 0 ? `Omitted with ${stepLabels(forcedBy)}.`
                        : control.state === "omittable" && !selected && !isRerun && !multiSubject ? "Use saved or entered values instead."
                        : control.state === "omittable" && control.forces.length > 0 ? `Also omits: ${stepLabels(control.forces)}` : systems;
                      const locked = control.state === "required";
                      const disabled = locked || forcedBy.length > 0 || (typedDeclaration !== undefined && control.state === "selectable" && (typedDeclaration.controls.some(field => field.field === control.inputField && field.placement === "input") || !typedControlAvailable(typedDeclaration, typedValues, control.inputField))) || (control.state === "omittable" && multiSubject && selected);
                      return <RunListRow key={step.key} title={step.label} description={note}
                        {...(locked ? { locked: true } : { check: { checked: selected, disabled, onChange: next => toggleStep(step.key, next) } })}
                        below={row !== undefined && !isRerun ? <StepOmissionFactsForm step={row.label} form={row.form} draft={row.draft} errors={visibleFactErrors(row)}
                          onChange={(field, next) => changeFact(row.step, row.form, field, next)} onTouch={(field) => touchFact(row.step, field)} /> : undefined}>
                        {isRerun && snapshot !== null && <Badge tone={sourceState === "completed" ? "success" : sourceState === "failed" ? "danger" : "neutral"} className="launch-step-status" data-status={sourceState}>{sourceState === "completed" ? "Completed" : sourceState === "failed" ? "Failed" : "Not started"}</Badge>}
                        {locked && <span className="sr-only">{isRerun && sourceState === "completed" ? `Completed in the source; this workflow requires it to run again. ${control.reason}` : control.reason}</span>}
                      </RunListRow>;
                    })}
                  </RunList>
                </section>
              )}

              {currentStage === "Confirm" && plan !== null && (
                <RunConfirmLayout count={plan.planned.length} outputs={plan.planned.flatMap(planned => planned.outputs ?? [])} inputs={pdfSurface !== undefined ? pdfInput.draft?.files.map(file => ({ label: file.source.fileName, kind: "PDF" })) : preview.entries.length ? preview.entries.map(entry => ({ label: entry.sourceText, kind: rowCapability === undefined ? inputRun.state === 'present' ? inputRunFieldLabel(inputRun.surface.parser) : 'Input' : `Entry ${entry.index + 1} · ${plan.refused.some(refusal => refusal.entry === entry.index + 1) ? "Refused" : "Accepted"}` })) : undefined} flags={<RunFlagChips dryRun={plan.dryRun} priority={plan.priority} />}
                  description={expiredPlan ? "This plan expired, so it was checked again. Review it and press Start again." : isRerun ? "A new run linked to the source." : pdfSurface !== undefined ? "One run for all attached PDFs." : "One run for each accepted entry."}
                  facts={[
                      { key: "Workflow", value: workflow === undefined ? plan.workflowId : `${workflow.label} · ${versionTag(workflow.version)}` },
                      { key: "Input", value: inputSummary || Object.values(valueDrafts).map(draft => draft.text).filter(Boolean).join(", ") },
                      ...(isRerun && snapshot ? [{ key: "Source", value: rerunSource?.traceId ?? snapshot.source.runId }] : []),
                      { key: "Steps", value: `${selectedStepKeys.length} / ${workflow?.steps.length ?? 0} included${omissionRows.length ? ` · Omitted: ${omissionRows.map(row => row.label).join(", ")}` : ""}` },
                      ...omissionRows.map(row => ({ key: row.form.fields.every(field => field.kind === "us-date") ? "Entered dates" : row.label, value: stepOmissionFactsSummary(row) })),
                      ...plan.planned.flatMap(planned => (planned.workbookReferences ?? []).map(reference => ({ key: `Reference · ${reference.type.name}`, value: `${library.catalog.find(entry => entry.libraryId === reference.libraryId)?.name ?? 'Spreadsheet unavailable'} · ${reference.versionName ?? `Revision ${reference.version}`}` }))),
                      { key: "Priority", value: plan.priority === "interactive" ? "On" : "Off" },
                      { key: "Browser", value: `${browserMode === "headed" ? "Headed" : "Headless"} · screenshots required` },
                      { key: "Dry run", value: plan.dryRun ? "On" : "Off" },
                  ]}>
                  {omissionMismatch && (
                    <Banner tone="danger" title="This plan does not describe the steps you omitted">
                      {`You omitted ${sentOmittedSteps.length === 0 ? "no steps" : sentOmittedSteps.join(", ")}; the plan came back omitting `
                        + `${planOmittedSteps.length === 0 ? "no steps" : planOmittedSteps.join(", ")}. `
                        + "Go back and plan the run again — this plan would start a different run."}
                    </Banner>
                  )}
                  <PlanRefusals refused={plan.refused} sources={rowCapability === undefined ? undefined : preview.entries} />
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
                workflow?.label,
                workflow === undefined ? undefined : `${selectedStepKeys.length} of ${workflow.steps.length} steps`,
                pdfSurface === undefined ? undefined : "OCR on",
                priority === "interactive" ? "Priority" : undefined,
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
          {(startEnabled || warningEnabled || continueEnabled) && <span className="text-[12px] text-ui-muted">{startEnabled ? "Enter to start" : "Enter to continue"}</span>}
          {currentStage !== "Warning" && previousStage !== null && (
            <Button variant="ghost" icon={<ArrowLeft aria-hidden className="size-3" />} onClick={() => setCurrentStage(previousStage)}>Back</Button>
          )}
          <Button variant="secondary" onClick={() => currentStage === "Warning" ? setCurrentStage("Steps") : closeAndReset(false)}>
            Cancel
          </Button>
          {currentStage === "Warning" && warning !== null ? (
            <Button variant="primary" onClick={acknowledgeWarning}>Confirm</Button>
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
  rerunInputText,
  previewLaunch,
  previewRuns,
  onSubmitPreview,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalog: readonly WorkflowCatalogEntry[];
  panelWorkflowId: string;
  actorId: string;
  onApplied?: (workflowId: string, count?: number, workerStartup?: RunWorkerStartupFailure) => void;
  onOpenIntake: (workflowId: string, intakeSessionId: string) => void;
  onCloseAutoFocus?: (event: Event) => void;
  rerunSource?: RerunLaunchSource;
  rerunInputText?: string;
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
      rerunInputText={rerunInputText}
      previewLaunch={previewLaunch}
      previewRuns={previewRuns}
      onSubmitPreview={onSubmitPreview}
    />
  );
}
