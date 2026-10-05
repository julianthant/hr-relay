import "./launch-presentation.css";
import { mockWorkflow, type MockWorkflowId } from "./workflow-mock-catalog.js";
import { WorkflowMockRunForm } from "./workflow-mock-run.js";
import { RunConfirmLayout, RunOptionsLayout, RunStepsList } from "./run-launch-layout.js";
import type { MockDraft, MockRun } from "./workflow-mock-model.js";
import { RunWorkflowPicker } from "./run-start-picker.js";
import type { RerunValuesSnapshot } from "../../domain/dashboard/rerun-values.js";
import type { RerunWarningWire } from "../../domain/dashboard/rerun-warning.js";
import { canonicalJsonStringify, JsonValueSchema } from "../../domain/canonical-json.js";
import { candidateText, defaultRerunSteps, initialRerunValueDrafts, rerunSubmission, type RerunValueDraft } from "./run-start-rerun-model.js";
import { readLaunchRecovery, retainLaunchFinal, dismissLaunchRecovery, type LaunchFinalCommand } from "../app/run-launch-recovery.js";
import { createRunLaunchService, type RerunLaunchSource } from "../app/run-launch-model.js";
/** Descriptor-driven launch UI; server planning and durable command recovery own admission. */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ArrowLeft, ArrowRight, Check, Keyboard, Play } from "lucide-react";
import { cn } from "../lib/utils.js";
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
  SectionLabel,
  ChoicePicker,
  Textarea,
  Well,
  dsFg,
  dsFocus,
  dsIcon,
  dsText,
} from "../ds/ui.js";
import type { CommandResult } from "../../domain/commands.js";
import { settleCommandResult } from "../app/command-result.js";
import {
  inputRunValueNoun,
  parseInputRunText,
  toRawSubmission,
  type InputRunSurface,
  type ParsedInputEntry,
} from "../../domain/workflow/ingress.js";
import type { WorkflowModuleRole } from "../../domain/workflow/module-role.js";
import type { EnqueuePolicy } from "../../domain/workflow/presentation.js";
import type { StartPlanResponse } from "../client/index.js";
import { useDashboardClient } from "../state/client-context.js";
import {
  EnqueueResultBanner,
  LockedFact,
  PlanRefusals,
  RunFlagChips,
  StepOmissionFactsForm,
} from "./run-start-kit.js";
import { useSpreadsheetMocks } from "./spreadsheet-mock-model.js";
import { SYSTEM_LABEL, type BrowserSystemId } from "./system-chip-model.js";
import {
  ENQUEUE_POLICY_MEANING,
  ENQUEUE_POLICY_REASON,
  foldStepOmissionFacts,
  forcedStepOmissions,
  initialStepOmissionDraft,
  inputRunDelimiterHint,
  inputRunFieldLabel,
  omittedStepViews,
  startRequestFingerprint,
  toggleStepSelection,
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
  type RunStartStage,
} from "./run-start-timeline.js";
import { versionTag } from "./format.js";
import type { StepOmissionForm } from "../../domain/workflow/step-omission.js";

/** the surface id this command family is audited under (ref frontend-backend-integration §3.4) */

/**
 * What the app composes from the descriptor and bootstrap projections. The
 * dialog reads exactly this and imports no workflow module.
 */
export interface RunStartWorkflow {
  readonly workflowId: string;
  readonly label: string;
  /** the served category this workflow is filed under — the picker's grouping */
  readonly categoryId: string;
  /**
   * The served taxonomy fact (ref workflow-model §1.2.1, D219) — composed from the boot
   * document exactly as served, never inferred from an id prefix. It is what
   * the ONE grouping rule nests a chunk harness by, and what keeps this
   * dialog's default selection from opening on a step of a workflow.
   */
  readonly role: WorkflowModuleRole;
  /**
   * The short code the picker row carries — the descriptor's own guarded
   * 2-char code, served on the bootstrap workflow projection since R2 D1/D2.
   * It stays OPTIONAL here because the app composes this view-model and the
   * row must render nothing at all rather than a placeholder if a future
   * composition has none: a fabricated identity is the value this tree bans.
   */
  readonly code?: string;
  /**
   * D229's own sentence about what this workflow does — the demo's
   * `capability.note`, and the descriptor's plain data (D251). Optional because
   * the declaration is: a workflow with none draws no paragraph rather than a
   * composed one.
   */
  readonly summary?: string;
  /**
   * The descriptor's DECLARED active-run policy (D251). It is a fact, not a
   * control: `planStart` reads `descriptor.enqueue` and `StartPlanIngress`
   * carries no per-start override, so the demo's select would offer an answer
   * the server would ignore.
   */
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
      /**
       * D307 — the step declares an omission the operator may take instead of
       * running it, with the closed form to draw and the other steps the
       * choice forces out. The Steps screen's OMISSION UI lands with its own
       * unit; the arm is carried here so the served wire assigns without a
       * widening cast, and the existing `required`/`selectable` branches keep
       * drawing exactly what they drew.
       */
      | { state: "omittable"; form: StepOmissionForm; forces: readonly string[] }
      | { state: "required"; reason: string };
  }>[];
  /** the descriptor's declared typed-input surface, or why there is none */
  readonly inputRun:
    | { readonly state: "present"; readonly surface: InputRunSurface }
    | { readonly state: "absent"; readonly reason: string };
  /**
   * Retained served intake capability. Spreadsheet registration lives in
   * Settings and is not a Run input method.
   */
  readonly spreadsheetIntake: boolean;
}

/** startable IS "declares a typed-input surface" — there is no second gate */
function isStartable(workflow: RunStartWorkflow): boolean {
  return workflow.inputRun.state === "present";
}

/**
 * What the dialog reads when the served catalogue holds nothing to select. It
 * is a statement about the dialog's own state, not a substituted descriptor
 * declaration — and it is a module constant so the parse preview memo is not
 * re-keyed by a fresh object on every render.
 */
/** a stable empty step list, so "no workflow selected" is not a fresh array each render */
const EMPTY_STEPS: RunStartWorkflow["steps"] = Object.freeze([]);

const NO_WORKFLOW_SELECTED = Object.freeze({
  state: "absent",
  reason: "no workflow is selected",
} as const);

/**
 * One omitted step, with the facts form it asks for and what the operator has
 * typed into it so far (D307).
 */
interface StepOmissionRow {
  readonly step: string;
  readonly label: string;
  readonly form: StepOmissionForm;
  readonly draft: StepOmissionDraft;
  readonly fold: StepOmissionFactsFold;
}

/**
 * The `stepOmissions` this request would carry — or `null`, because one of its
 * forms does not parse yet.
 *
 * `null` is not "send fewer": an omission whose facts are missing is a step the
 * run would reach with nothing to read, and the server refuses it by name
 * (`facts-missing` / `facts-invalid`). The dialog therefore does not ask.
 */
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

/**
 * One omitted step's typed facts, in the operator's own words: the form's own
 * field LABELS, in its own declared order, with what was typed into each.
 *
 * The Confirm screen is the operator confirming their own input, so it shows
 * the values. Nothing here crosses a wire — `stepOmissions` carries the facts
 * once, and every other projection of this run redacts them.
 */
function stepOmissionFactsSummary(row: StepOmissionRow): string {
  if (row.form.fields.length === 0) return "no facts to supply";
  if (row.fold.state !== "facts") {
    // Confirm is unreachable with an unparsed form: `advance` refuses it and
    // the fingerprint clears the plan on every keystroke. Reaching here means
    // one of those two is broken, and a plausible sentence would hide it.
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

/**
 * The omitted steps a plan says it retained, versus the ones this dialog sent.
 *
 * Compared as a SET: which steps are out is the fact, and two orderings of the
 * same set are the same answer. Anything else — a key the plan added, dropped
 * or renamed — is the plan describing a different run, and the dialog refuses
 * to start it.
 */
function sameStepKeys(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((key, index) => key === sortedRight[index]);
}

// ---------------------------------------------------------------------------
// The launcher
// ---------------------------------------------------------------------------

/**
 * The queue toolbar's one primary control — the dialog itself lives at the root.
 *
 * `id` is the intake takeover's focus-return target since D296: the modal this
 * opens is the only door into the intake workspace, so this is the control the
 * operator left when that takeover took the screen.
 */
export function RunStartButton({ id, onOpen }: { id: string; onOpen: () => void }) {
  return (
    <Button
      id={id}
      size="toolbar"
      variant="brand"
      onClick={onOpen}
      icon={<Play aria-hidden className={dsIcon.sm} />}
      // No `r` hint on the face of it: a shortcut badge on the ONE primary in
      // the toolbar spends the slot where the verb should end the eye's travel.
      // The binding stays discoverable where every other one is.
      title="Start a run — any workflow, from anywhere (r)"
    >
      Start a run
    </Button>
  );
}

// ---------------------------------------------------------------------------
// The descriptor's own parser, previewed
// ---------------------------------------------------------------------------

interface ParsePreview {
  readonly entries: readonly ParsedInputEntry[];
  /** the parser's own refusal, surfaced verbatim — never swallowed to an empty list */
  readonly problem: string | null;
}

/**
 * WHY THIS IS NOT THE DEMO'S PER-ENTRY PROBLEM MODEL (R8 finding 17).
 *
 * The demo computes a `{ code, message }` per typed value and keeps the good
 * ones (`DemoRunStart.tsx:405-472` over `parseEntries`), because its parser is
 * fixture code in the same file. This tree's parser is
 * `parseInputRunText` in `src/domain/workflow/ingress.ts` — a contract boundary
 * shared with the start-plan submission — and it THROWS on the whole text, by
 * design: "a silently dropped entry is an EID the operator believes is queued
 * and that never runs." Its split is module-private, so a per-entry preview
 * here would have to re-implement the boundary's own splitting rules in a
 * surface, and a client split that disagreed with the domain's would preview
 * entries the server never receives.
 *
 * So the refusal renders whole and verbatim, and the parsed-entry list below it
 * stays: it is what tells the operator what the boundary DID make of the text.
 * Per-entry tolerance is a change to the boundary, not to this surface.
 */
function TypedInput({
  surface,
  workflowId,
  text,
  onText,
  preview,
  inputRef,
}: {
  surface: InputRunSurface;
  workflowId: string;
  text: string;
  onText: (next: string) => void;
  preview: ParsePreview;
  /** the dialog's handle on the box, so an exit from a banner can focus it */
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  return (
    <div className="flex flex-col gap-[var(--ds-space-snug)]">
      <Field
        // D250 — both halves are DERIVED from the parser spec, so the box cannot
        // describe a rule it does not apply.
        label={inputRunFieldLabel(surface.parser)}
        description={inputRunDelimiterHint(surface.parser)}
        error={preview.problem}
      >
        <Textarea
          // Re-keyed per workflow so switching one puts the caret in the box the
          // operator is about to type into.
          key={workflowId}
          ref={inputRef}
          autoFocus
          rows={4}
          value={text}
          placeholder={inputRunFieldLabel(surface.parser) === "Kuali ID" ? surface.placeholder.replaceAll("Kuali document numbers", "Kuali IDs") : surface.placeholder}
          onChange={(event) => onText(event.target.value)}
        />
      </Field>

      {preview.entries.length > 0 && (
        <section aria-label="Parsed input" className="mt-3 flex flex-col gap-3">
          <div className="flex items-center justify-between"><h4 className="text-body font-semibold">Parsed input</h4><Badge tone="neutral">{preview.entries.length} {preview.entries.length === 1 ? 'run' : 'runs'}</Badge></div>
        <ul className="launch-parsed-input overflow-hidden rounded-md border border-ui-stroke divide-y divide-ui-stroke">
          {preview.entries.map((entry) => (
            <li
              key={entry.index}
              className={cn(
                "flex min-w-0 items-center gap-2 bg-ui-table px-[10px] py-2",
              )}
            >
              <span className="text-body">{entry.index + 1}.</span>
              <span className="min-w-0 flex-1 truncate font-mono text-caption">{entry.sourceText}</span>
              <span className="text-caption text-ui-muted">1 run</span>
            </li>
          ))}
        </ul>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The dialog
// ---------------------------------------------------------------------------

/**
 * The workflow the dialog opens on: the panel the operator is standing in when
 * that workflow can be started, then the first that can, rather than opening on
 * nothing.
 *
 * **A chunk harness is never AUTO-picked** (D219). It is a step of its
 * composition, and a dialog that opens on a step the operator did not ask for
 * proposes a run of one piece of a workflow — so a harness is only ever the
 * default when the operator is standing in that harness's own panel, which is
 * a choice they already made. Every fallback below skips harnesses; if the
 * served catalogue holds nothing else, the dialog opens with NOTHING selected
 * and renders the absent state, which is the honest reading of "there is no
 * whole workflow to default to" rather than a step chosen on the operator's
 * behalf.
 *
 * The auto-pick set is exactly the rail's set — the main workflows,
 * compositions and standalones — so the two surfaces cannot disagree about
 * what counts as a workflow to start. Harnesses remain explicitly startable
 * from their own panels and from the picker's nested entries.
 */
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
  workflows,
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
  /** every workflow the boot document serves, with its declared start surface */
  workflows: readonly RunStartWorkflow[];
  /** the Workflow Panel the operator is standing in — the dialog's default */
  panelWorkflowId: string;
  /** echoed from bootstrap; the server matches it against the request identity */
  actorId: string;
  onApplied?: (workflowId: string, count?: number) => void;
  /**
   * D296's handoff: close this dialog and open the intake workspace ON THIS
   * WORKFLOW. The dialog names the workflow rather than assuming the panel's,
   * because the picker beside it is the whole point of "any workflow, from
   * anywhere" and an intake seeded from the panel would map the file's columns
   * onto a workflow the operator did not choose.
   */
  onOpenIntake: (workflowId: string, intakeSessionId: string) => void;
  onCloseAutoFocus?: (event: Event) => void;
  rerunSource?: RerunLaunchSource;
  previewLaunch?: Readonly<{ workflowId: MockWorkflowId; source?: MockRun }>;
  previewRuns?: readonly MockRun[];
  onSubmitPreview?: (id: MockWorkflowId, draft: MockDraft, sourceId?: string) => void;
}) {
  if ((previewRuns === undefined) !== (onSubmitPreview === undefined) || (previewLaunch !== undefined && onSubmitPreview === undefined)) throw new Error("RUN_PREVIEW_CAPABILITY_INCOMPLETE");
  if (previewLaunch && !previewLaunch.source && !mockWorkflow(previewLaunch.workflowId).runnable) throw new Error("RUN_PREVIEW_NOT_RUNNABLE");
  const [previewSelection, setPreviewSelection] = useState(previewLaunch);
  const [pickerQuery, setPickerQuery] = useState("");
  const client = useDashboardClient();
  const launchService = useMemo(() => createRunLaunchService(client, actorId), [client, actorId]);
  const finalRequest = useRef<LaunchFinalCommand | null>(null);
  const sending = useRef(false);
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

  const [workflowId, setWorkflowId] = useState<string>(() => defaultWorkflowId(workflows, panelWorkflowId));
  const selectedWorkflowRef = useRef(previewSelection?.workflowId ?? workflowId);
  useEffect(() => { selectedWorkflowRef.current = previewSelection?.workflowId ?? workflowId; }, [previewSelection, workflowId]);
  const [currentStage, setCurrentStage] = useState<RunStartStage>("Input");
  const [workbookId, setWorkbookId] = useState("");
  const spreadsheetMocks = useSpreadsheetMocks();
  const initialWorkflow = workflows.find((entry) => entry.workflowId === defaultWorkflowId(workflows, panelWorkflowId));
  const [customizeSteps, setCustomizeSteps] = useState(false);
  const [selectedStepKeys, setSelectedStepKeys] = useState<string[]>(() =>
    initialWorkflow?.steps.filter(({ includedByDefault }) => includedByDefault).map(({ key }) => key) ?? []);
  /**
   * D307 — what the operator has typed into each omitted step's form, keyed by
   * step key, and which of those controls they have finished with.
   *
   * The drafts survive a re-check of the step (re-typing two dates because a
   * checkbox was pressed twice is a cost with no benefit); they do NOT survive
   * a workflow change or leaving `Customize steps`, because a fact typed for
   * one workflow's step is not a fact about another's.
   *
   * `touchedFacts` and `factsAttempted` decide only WHEN a refusal is drawn,
   * never whether one exists: an empty box the operator has not reached yet is
   * still an incomplete form, and the footer says so from the moment it is.
   */
  const [stepDrafts, setStepDrafts] = useState<Readonly<Record<string, StepOmissionDraft>>>({});
  const [touchedFacts, setTouchedFacts] = useState<ReadonlySet<string>>(() => new Set());
  const [factsAttempted, setFactsAttempted] = useState(false);
  const [text, setText] = useState("");
  const [priority, setPriority] = useState<StartPriority>("interactive");
  const [dryRunRequested, setDryRunRequested] = useState(false);
  const [browserMode, setBrowserMode] = useState<BrowserMode>("headed");
  const [captureBrowserScreenshots, setCaptureBrowserScreenshots] = useState(true);
  const [plan, setPlan] = useState<StartPlanResponse | null>(null);
  const [result, setResult] = useState<CommandResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Switching workflows CLEARS the form. The typed text belongs to the
   * workflow's own parser and the plan token is bound to its identity, so
   * carrying either across would leave the dialog holding a proposal for a
   * workflow the operator is no longer looking at.
   */
  const selectWorkflow = useCallback((next: string) => {
    setWorkflowId(next);
    setText("");
    setPlan(null);
    setResult(null);
    setError(null);
    setCurrentStage("Input");
    setCustomizeSteps(false);
    // The method is a property of the workflow's own declarations, so it resets
    // with everything else: carrying `spreadsheet` onto a workflow whose module
    // declares no projection would select a tab that is not drawn.
    setWorkbookId("");
    const nextWorkflow = workflows.find((entry) => entry.workflowId === next);
    setSelectedStepKeys(nextWorkflow?.steps.filter(({ includedByDefault }) => includedByDefault).map(({ key }) => key) ?? []);
    setStepDrafts({});
    setTouchedFacts(new Set());
    setFactsAttempted(false);
    setPriority("interactive");
    setDryRunRequested(false);
    setBrowserMode("headed");
    setCaptureBrowserScreenshots(true);
  }, [workflows]);

  // Opening lands on the panel you are standing in, every time — including the
  // second time, which is why this keys on `open` rather than running once.
  useEffect(() => {
    const instance = ++launchInstance.current;
    if (!open) return;
    selectWorkflow(defaultWorkflowId(workflows, panelWorkflowId));
    setPreviewSelection(previewLaunch);
    setPickerQuery("");
    setSnapshot(null); setSourceError(null); setValueDrafts({}); setCopiedOmissions({});
    setWarning(null); setAcknowledgment(undefined); setBusy(false);
    try { setRecovery(readLaunchRecovery(window.sessionStorage, actorId)); setRecoveryError(null); }
    catch (caught) { setRecoveryError(caught instanceof Error ? caught.message : String(caught)); }
    if (rerunSource !== undefined) {
      setCurrentStage("Steps"); setCustomizeSteps(true);
      void launchService.openRerun({ runId: rerunSource.runId, expectedVersion: rerunSource.expectedVersion }).then((response) => {
        if (launchInstance.current !== instance) return;
        if (response.state === "refused") { setSourceError(`Rerun unavailable: ${response.code}`); return; }
        const sourceWorkflow = workflows.find((entry) => entry.workflowId === response.snapshot.source.workflow);
        if (sourceWorkflow === undefined) throw new Error("RERUN_WORKFLOW_UNAVAILABLE");
        const selection = defaultRerunSteps(response.snapshot, sourceWorkflow);
        setWorkflowId(sourceWorkflow.workflowId); setSelectedStepKeys(selection); setSnapshot(response.snapshot);
        setValueDrafts(initialRerunValueDrafts(response.snapshot, sourceWorkflow));
      }).catch((caught: unknown) => {
        if (launchInstance.current === instance) setSourceError(caught instanceof Error ? caught.message : String(caught));
      });
    }
    return () => { launchInstance.current = instance + 1; };
  }, [open, workflows, panelWorkflowId, selectWorkflow, rerunSource, actorId, launchService, previewLaunch]);

  const pickWorkflow = useCallback((id: string) => {
    if (selectedWorkflowRef.current === id || sending.current) return;
    const served = workflows.find(flow => flow.workflowId === id);
    const preview = !served && onSubmitPreview ? mockWorkflow(id) : undefined;
    if (served ? !isStartable(served) : !preview?.runnable) return;
    selectedWorkflowRef.current = id;
    ++launchInstance.current;
    setBusy(false);
    if (served) {
      setPreviewSelection(undefined);
      selectWorkflow(id);
    } else if (preview) setPreviewSelection({ workflowId: preview.id });
  }, [workflows, selectWorkflow, onSubmitPreview]);

  const workflow = workflows.find((entry) => entry.workflowId === workflowId);

  const inputRun = workflow?.inputRun ?? NO_WORKFLOW_SELECTED;
  const supportsDryRun = inputRun.state === "present" && inputRun.surface.supportsDryRun === true;
  const dryRun = supportsDryRun && dryRunRequested;
  const launchStages = useMemo(() => runStartStages(customizeSteps, "typed", isRerun), [customizeSteps, isRerun]);

  useEffect(() => {
    setCurrentStage((current) => reconcileRunStartStage(launchStages, current));
  }, [launchStages]);

  /**
   * C109 (D272 item 8) — a plan, and the RESULT behind it, outlive nothing that
   * shaped them.
   *
   * The demo cleared its result from inside each control's own `onChange`; this
   * derives the same thing from ONE identity, so a control added later cannot
   * leave a settled banner standing over a request that no longer exists. The
   * plan token is bound to these exact fingerprints server-side, so once any of
   * them moves the token is unusable and saying so is the only honest state.
   */
  /**
   * D307 — the steps the operator has left OUT, each with the form it asks for
   * and the facts (or refusals) its draft currently reads as.
   *
   * `forcedByStep` is the cascade the descriptor already computed: a step
   * another omitted step forces out is unchecked and LOCKED for as long as that
   * choice stands, so this screen locks exactly what the planner would refuse
   * rather than a rule restated here.
   */
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
  const requestFingerprint = canonicalJsonStringify([rerunSource ?? null, valueDrafts, copiedOmissions, startRequestFingerprint({
    workflowId,
    text,
    dryRun,
    browserMode,
    captureBrowserScreenshots,
    priority,
    selectedStepKeys,
    stepOmissionDrafts: omissionRows.map(({ step, draft }) => ({ step, draft })),
  })]);
  /**
   * The identity of the request the dialog is CURRENTLY describing, readable
   * from inside a settled promise (unit F5b finding 1).
   *
   * The effect below clears a plan the moment the request moves, but it can
   * only clear what has already landed: an in-flight `submitStartPlan` /
   * `executeCommand` that settles AFTER the edit re-lands its answer on top of
   * the cleared state, and the operator is looking at a plan for text that is
   * no longer in the box. Every dispatch below captures the fingerprint it was
   * made for and compares it against this ref before it writes anything.
   *
   * It is updated in the SAME effect that does the clearing, which is what
   * makes the ordering self-healing: if a settlement wins the race to a render
   * the effect has not run for yet, the effect runs next and clears exactly
   * what the settlement wrote.
   */
  const requestFingerprintRef = useRef(requestFingerprint);
  useEffect(() => {
    requestFingerprintRef.current = requestFingerprint;
    setPlan(null);
    setResult(null);
    setError(null);
    setCurrentStage((current) => current === "Confirm" ? (isRerun ? "Values" : "Input") : current);
  }, [requestFingerprint, isRerun]);

  /**
   * The typed box, so an exit from a settled banner can put the keyboard back
   * where the operator types.
   */
  const typedInputRef = useRef<HTMLTextAreaElement>(null);
  const restoreInputFocusRef = useRef(false);

  useEffect(() => {
    if (!["Input", "Values"].includes(currentStage) || !restoreInputFocusRef.current) return;
    restoreInputFocusRef.current = false;
    // A workflow with no typed-input surface has no box to restore to. That is
    // the served absence, not a focus fallback to an unrelated control.
    typedInputRef.current?.focus();
  }, [currentStage]);

  const preview = useMemo((): ParsePreview => {
    if (inputRun.state !== "present" || text.trim().length === 0) return { entries: [], problem: null };
    try {
      return { entries: parseInputRunText(inputRun.surface.parser, text), problem: null };
    } catch (caught) {
      // The parser refuses an entry no rule claims. That refusal is precisely
      // what the operator has to see — it is rendered, never defaulted away.
      return { entries: [], problem: caught instanceof Error ? caught.message : String(caught) };
    }
  }, [inputRun, text]);



  const submitPlan = useCallback(async (): Promise<void> => {
    if (!isRerun && preview.entries.length === 0) return;
    if (isRerun && (snapshot === null || preview.entries.length > 1)) return;
    const dispatchedFor = requestFingerprint;
    const instance = launchInstance.current;
    setBusy(true);
    setError(null);
    try {
      const values = snapshot === null ? null : rerunSubmission(snapshot,
        preview.entries[0] === undefined ? {} : JsonValueSchema.parse(toRawSubmission(preview.entries[0])), valueDrafts);
      const copiedFrom = [...(values?.copiedFrom ?? []), ...Object.entries(copiedOmissions).flatMap(([index, copied]) => {
        const candidate = snapshot?.values[Number(index)];
        return copied && candidate?.state === "available" && candidate.targetStepKey !== undefined
          && !selectedStepKeys.includes(candidate.targetStepKey)
          ? [{ nodeId: candidate.nodeId, fieldPath: candidate.fieldPath, targetFieldPath: candidate.targetFieldPath, targetStepKey: candidate.targetStepKey }] : [];
      })];
      const next = await launchService.preview({
        workflowId,
        submissions: values === null ? preview.entries.map((entry) => toRawSubmission(entry)) : [values.submission],
        ...(snapshot === null ? {} : { rerunSource: { runId: snapshot.source.runId, expectedVersion: snapshot.source.version,
          intent: "rerun", selectedStepKeys, copiedFrom }, ...(acknowledgment === undefined ? {} : { warningAcknowledgment: acknowledgment }) }),
        dryRun,
        browserMode,
        captureBrowserScreenshots,
        priority,
        ...(customizeSteps ? { selectedStepKeys } : {}),
        // D307 — sent only when the operator is customizing steps, and only
        // when every omitted step's form parses. `stepOmissions === null` is
        // an incomplete form, and `advance` never reaches this call with one.
        ...(customizeSteps && stepOmissions !== null && stepOmissions.length > 0 ? { stepOmissions } : {}),
      });
      // The operator edited the form while this was on the wire, so the server
      // answered a question the form no longer asks and the plan token it
      // carries is already unusable. Landing it would put a proposal for text
      // that has left the box under a primary button that says Start run.
      if (requestFingerprintRef.current !== dispatchedFor || launchInstance.current !== instance) return;
      setPlan(next);
      setResult(null);
      if (next.rerun !== undefined && next.rerun.warnings.length > 0 && next.rerun.acknowledgment !== next.rerun.warningDigest) {
        setWarning({ workflowId: next.workflowId, rerun: next.rerun }); setCurrentStage("Warning");
      } else setCurrentStage("Confirm");
    } catch (caught) {
      // A refusal of a superseded request is not dropped evidence: the next
      // `Plan the run` re-asks the same server the same way and surfaces it
      // against the request the operator is actually looking at. What IS
      // banned is showing this one — a danger banner naming text that is no
      // longer in the box reads as a refusal of what is.
      if (requestFingerprintRef.current !== dispatchedFor || launchInstance.current !== instance) return;
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (launchInstance.current === instance) setBusy(false);
    }
  }, [isRerun, snapshot, valueDrafts, copiedOmissions, acknowledgment, browserMode, captureBrowserScreenshots, launchService, customizeSteps, dryRun, preview, priority, requestFingerprint, selectedStepKeys, stepOmissions, workflowId]);

  const sendFinal = useCallback(async (command: LaunchFinalCommand, dispatchedFor: string): Promise<void> => {
    if (sending.current) return;
    const instance = launchInstance.current;
    sending.current = true; setBusy(true); setError(null);
    try {
      retainLaunchFinal(window.sessionStorage, command);
      finalRequest.current = command; setRecovery(command);
      const next = await launchService.submit(command);
      // Durable recovery remains available even if this launch closed or changed.
      if (requestFingerprintRef.current !== dispatchedFor || launchInstance.current !== instance) return;
      setResult(next);
      if (settleCommandResult(next).kind === "applied") {
        dismissLaunchRecovery(window.sessionStorage, command);
        finalRequest.current = null; setRecovery(null); setPlan(null); setResult(null); setBusy(false);
        onApplied?.(command.target.workflowId, plan?.planned.length);
        onOpenChange(false);
        ++launchInstance.current;
      }
    } catch (caught) {
      if (requestFingerprintRef.current !== dispatchedFor || launchInstance.current !== instance) return;
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      sending.current = false;
      if (launchInstance.current === instance) setBusy(false);
    }
  }, [launchService, onApplied, onOpenChange, plan]);
  const confirmStart = useCallback(async (): Promise<void> => {
    if (plan === null || sending.current || recoveryError !== null) return;
    if (finalRequest.current === null || finalRequest.current.target.startPlanId !== plan.startPlanId) {
      finalRequest.current = launchService.prepareFinal(plan);
    }
    await sendFinal(finalRequest.current, requestFingerprint);
  }, [launchService, plan, requestFingerprint, recoveryError, sendFinal]);

  // D253 / Track D row D3 — "did the start land" is the ONE fold's question,
  // and a replay of the same landing IS a landing: the plan token is single-use,
  // so `already-applied` means this dialog's own send arrived twice, never that
  // nothing was enqueued. `EnqueueResultBanner` still draws the four arms apart,
  // because what the operator READS about a refusal is not the same question.
  const applied = result !== null && settleCommandResult(result).kind === "applied";
  const blockedReason = inputRun.state !== "present"
    ? inputRun.reason
    : preview.problem !== null
      ? "Fix the refused entry first."
      : preview.entries.length === 0
        ? "Type at least one value."
        : null;
  /**
   * D307 — why the Steps screen cannot go on to Confirm.
   *
   * An omitted step whose form does not parse is a step the run would reach
   * with nothing to read, and the server refuses exactly that (`facts-missing`
   * / `facts-invalid`). Saying so here is not a second rule: `stepOmissions` is
   * `null` precisely when the descriptor's OWN facts schema refused the draft.
   */
  /**
   * D307 — typed facts describe ONE subject.
   *
   * A last day worked or a transaction number is a fact about a person, and a
   * plan that fans out to several would assert it for all of them; the plan
   * service refuses exactly that (`single-subject-only`). So a multi-subject
   * box does not OFFER an omission, and an omission chosen before the box grew
   * blocks the advance by name rather than reaching the server to be refused.
   */
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
  /**
   * The plan has to describe the run this dialog asked for. `omittedSteps` is
   * the server's own account of which steps it retained as omitted; if that
   * set is not the set this dialog sent, the token in hand belongs to a
   * different run and Start is refused rather than pressed hopefully.
   */
  const sentOmittedSteps = customizeSteps && stepOmissions !== null ? stepOmissions.map(({ step }) => step) : [];
  const planOmittedSteps = plan?.omittedSteps ?? [];
  const omissionMismatch = plan !== null && !sameStepKeys(planOmittedSteps, sentOmittedSteps);
  const stepLabel = (key: string): string => {
    const step = steps.find((candidate) => candidate.key === key);
    if (step === undefined) throw new Error(`the Steps screen named step "${key}", which this workflow does not declare`);
    return step.label;
  };
  const stepLabels = (keys: readonly string[]): string => keys.map(stepLabel).join(", ");
  /**
   * Which refusals are DRAWN. Every refusal exists from the moment the draft
   * does — the footer reason and the blocked advance both read the whole fold —
   * but a box the operator has not reached yet does not wear a red line.
   */
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
      setSelectedStepKeys(workflow?.steps.filter(({ includedByDefault }) => includedByDefault).map(({ key }) => key) ?? []);
      // Leaving the screen drops the facts with the choice that asked for them:
      // a draft kept behind an un-customized run is a fact nothing on screen
      // says this run would assert.
      setStepDrafts({});
      setTouchedFacts(new Set());
      setFactsAttempted(false);
    } else if (currentStage === "Confirm") {
      setCurrentStage("Steps");
    }
  }, [currentStage, workflow]);

  /**
   * One step checkbox, pressed — through the ONE fold that owns the cascade
   * (D307). The screen never edits the key list itself, so a row that is locked
   * by another omission cannot be moved by a press the fold would refuse.
   */
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
      // The press is what asks for every refusal at once: the operator has now
      // said they are done with the form, so every empty box is a real answer
      // of "nothing" and gets its line.
      setFactsAttempted(true);
      return;
    }
    if (nextStage === "Confirm") {
      if (plan === null) await submitPlan();
      else setCurrentStage("Confirm");
      return;
    }
    setCurrentStage(nextStage);
  }, [currentStage, nextStage, plan, stepsBlockedReason, submitPlan, isRerun, snapshot, requestFingerprint, launchService, workflowId, selectedStepKeys, acknowledgment]);

  /**
   * The ONE exit from a settled banner — C69's `Reload the form` and C72's
   * `Close` / `Dismiss` alike (unit F5b findings 2, 3 and 8).
   *
   * C72 is a ruling about the WORD on the button, not about the act behind it:
   * closing a receipt and dismissing a refusal read differently and land in the
   * same place, because after any of the three the plan token in this form is
   * spent. D253 refuses a re-send of the same envelope identically, so leaving
   * the plan standing would offer a Start run that can only conflict.
   *
   * Both halves are the fix. Clearing the RESULT without the STAGE left the
   * rail naming Result as the current step over a region with nothing in it,
   * and left `reachable` with a step the operator cannot re-enter. And the
   * control that was just pressed UNMOUNTS with the banner: focus on a removed
   * element falls to `document.body`, so the next Tab restarts the dialog at
   * its first control instead of resuming where the operator was working.
   */
  const returnToInput = useCallback(() => {
    if (recovery !== null && result !== null) {
      dismissLaunchRecovery(window.sessionStorage, recovery); setRecovery(null); finalRequest.current = null;
    }
    restoreInputFocusRef.current = true;
    setPlan(null);
    setResult(null);
    setError(null);
    setCurrentStage(isRerun ? "Values" : "Input");
  }, [recovery, result, isRerun]);

  const closeAndReset = useCallback((next: boolean) => {
    onOpenChange(next);
    if (!next) {
      ++launchInstance.current;
      if (result !== null && recovery !== null) {
        dismissLaunchRecovery(window.sessionStorage, recovery); setRecovery(null); finalRequest.current = null;
      }
      // The plan token is short-lived and single-use; a closed dialog must not
      // reopen holding a token the server may already have consumed. The typed
      // draft survives — retyping it is the cost this deliberately avoids.
      setPlan(null);
      setResult(null);
      setError(null);
      setCurrentStage("Input");
    }
  }, [onOpenChange, result, recovery]);

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

  const picker = <RunWorkflowPicker workflows={workflows} includePreviews={onSubmitPreview !== undefined} value={previewSelection?.workflowId ?? workflowId} onChange={pickWorkflow} query={pickerQuery} onQuery={setPickerQuery} />;
  const previewFlow = previewSelection ? mockWorkflow(previewSelection.workflowId) : undefined;

  return (
    <Dialog open={open} onOpenChange={closeAndReset}>
      <DialogContent
        onCloseAutoFocus={onCloseAutoFocus}
        size="xl"
        title={previewSelection?.source || isRerun ? "Rerun" : "Start a run"}
        description={previewFlow ? `${previewFlow.label} · Workflow preview` : isRerun ? [workflow?.label, rerunSource?.label].filter(Boolean).join(" · ") : workflow ? `New work · ${workflow.label}` : "Choose a workflow to begin"}
        className="launch-design launch-dialog"
      >
          {previewSelection?.source ? null : !isRerun ? picker : <aside aria-label="Source run" className="launch-workflow-rail flex min-h-0 shrink-0 flex-col border-r border-ui-stroke p-3 pt-[18px]">
            <SectionLabel>Source run</SectionLabel>{rerunSource?.label && <h3 className="mt-4 text-heading font-semibold">{rerunSource.label}</h3>}
            {snapshot !== null && <><p className="mt-[6px] break-all font-mono text-caption text-ui-secondary">{rerunSource?.traceId ?? snapshot.source.runId}</p>
              <dl className="mt-[18px] space-y-[14px] text-caption"><div><dt className="text-ui-muted">Workflow</dt><dd className="mt-1">{workflow?.label} · {versionTag(snapshot.source.descriptorVersion)}</dd></div><div><dt className="text-ui-muted">Outcome</dt><dd className={cn("mt-1", snapshot.source.outcome === "done" ? "text-ui-positive" : snapshot.source.outcome === "failed" ? "text-ui-danger" : "text-ui-secondary")}>{snapshot.source.outcome === "done" ? "Completed" : snapshot.source.outcome === "failed" ? `Failed${snapshot.steps.some(step => step.state === "failed") ? ` at ${stepLabel(snapshot.steps.find(step => step.state === "failed")!.key)}` : ""}` : "Interrupted"}</dd></div><div><dt className="text-ui-muted">Progress</dt><dd className="mt-1">{snapshot.steps.filter(step => step.state === "completed").length} / {snapshot.steps.length} steps completed</dd></div></dl></>}
            <p className="mt-auto border-t border-ui-stroke pt-[14px] text-caption text-ui-muted">This creates a new run. The source keeps its original history.</p>
          </aside>}

          {previewSelection && onSubmitPreview && previewRuns ? <WorkflowMockRunForm key={`${previewSelection.workflowId}:${previewSelection.source?.id ?? "start"}`} workflowId={previewSelection.workflowId} source={previewSelection.source} runs={previewRuns} onClose={() => closeAndReset(false)} onSubmit={onSubmitPreview} /> : <>
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
              {currentStage === "Input" && inputRun.state === "present" && <p className="text-body text-ui-secondary">Enter {inputRunFieldLabel(inputRun.surface.parser) === "Kuali ID" ? "Kuali IDs" : inputRunValueNoun(inputRun.surface.parser)}. Each entry starts one run.</p>}
              {currentStage === "Options" && <p className="text-body text-ui-secondary">Set how this work enters the queue.</p>}
              {currentStage === "Steps" && <p className="text-body text-ui-secondary">{isRerun ? "Select steps for the new run. Statuses show the source outcome." : multiSubject && steps.some(step => step.control.state === "omittable") ? multiSubjectOmissionReason : "Required steps stay included. Optional steps may be omitted."}</p>}
              {currentStage === "Values" && <p className="text-body text-ui-secondary">Review the input and values this rerun will use.</p>}
            </section>

            <div className="flex min-w-0 flex-col gap-[var(--ds-space-loose)]">
              {(currentStage === "Input" || currentStage === "Values") && (
                <section aria-label={isRerun ? "Values" : "Input"} className="flex min-h-0 flex-1 flex-col gap-[var(--ds-space-loose)]">
                  {inputRun.state === "present" ? (
                    isRerun && snapshot?.values.some(candidate => candidate.state === "available" && candidate.targetStepKey === undefined && inputRun.surface.parser.rules.some(rule => rule.emit === candidate.targetFieldPath)) ? null : <TypedInput
                      surface={inputRun.surface}
                      workflowId={workflowId}
                      text={text}
                      onText={setText}
                      preview={preview}
                      inputRef={typedInputRef}
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
                  {isRerun && snapshot !== null && (
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
                            <Checkbox checked={selected} disabled={control.state === "required" || forcedBy.length > 0 || (control.state === "omittable" && multiSubject && selected)}
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
              disabled={busy || recoveryError !== null || recovery !== null || (isRerun && (snapshot === null || sourceError !== null || (currentStage === "Values" && (preview.problem !== null || preview.entries.length > 1 || stepsBlockedReason !== null)))) || (currentStage === "Input" && blockedReason !== null) || nextStage === null}
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

/**
 * The launcher plus the dialog, mounted at the shell's ROOT rather than inside
 * the queue toolbar — "reachable from anywhere" has to stay true on surfaces
 * that draw no toolbar.
 */
export function RunStartSurfaces({
  open,
  onOpenChange,
  workflows,
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
  workflows: readonly RunStartWorkflow[];
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
      workflows={workflows}
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
