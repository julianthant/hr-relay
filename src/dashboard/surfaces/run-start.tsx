/**
 * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * src/dashboard/components/dev/rebuild-demo/DemoRunStart.tsx — and re-ported
 * region by region from hr-automation@1bffbd65 for the 2026-08-13 detail
 * fidelity pass (docs/plans/2026-08-13-detail-fidelity-audit.md, R8).
 *
 * **The** Start Run surface — 1i's typed method, wired to the real start
 * protocol (doc 13 §5.1):
 *
 *   1. the descriptor's own input surface decides the door exists; a workflow
 *      that declares none renders the served absence, not empty scaffolding;
 *   2. the operator types into the descriptor's placeholder, and the
 *      descriptor's own parser spec previews exactly how that text splits;
 *   3. `POST /start-plans` returns the exact proposed runs, the refusals, and a
 *      short-lived plan token bound to every fingerprint;
 *   4. the operator CONFIRMS, and one `start-run` command consumes that token
 *      idempotently;
 *   5. the queue changes only from the authoritative projection. This surface
 *      never inserts a row, never turns a status, and stops at "applied".
 *
 * Nothing here knows a workflow: every input, constant and system is read off
 * props the app composed from the descriptor/bootstrap projections, so a
 * workflow registered tomorrow gets a correct dialog for free — and one whose
 * start capability is absent is not offered rather than offered and broken.
 *
 * The picker is the demo's, over the SERVED catalogue: the boot document's
 * workflows and categories plus each descriptor's declared input surface are
 * all the list, the grouping, the filter, the selection and the
 * "{n} not startable" count need. (An earlier header claimed the picker waited
 * on a bootstrap start-capability projection. That was wrong — R8 finding 12.)
 *
 * Deferred with their owning slices, and omitted rather than faked: the upload,
 * capture, spreadsheet and bare start methods and their peer-method tabs (2h),
 * the per-workflow REASON each unstartable workflow is refused for, the
 * capability note under the workflow heading, presets, preflight/doctor
 * results, per-system host lines, and the active-run enqueue-policy select (the
 * policy is a descriptor declaration in this tree, not an operator choice).
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Keyboard, Layers, Play, Search, SlidersHorizontal } from "lucide-react";
import { cn } from "../lib/utils.js";
import {
  Banner,
  Button,
  Chip,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  EmptyState,
  Field,
  MetaLine,
  SectionLabel,
  Select,
  Textarea,
  Well,
  dsFg,
  dsFocus,
  dsIcon,
  dsMotion,
  dsRadius,
  dsText,
} from "../ds/ui.js";
import { systemClock } from "../../domain/clock.js";
import type { CommandResult } from "../../domain/commands.js";
import {
  parseInputRunText,
  toRawSubmission,
  type InputParserSpec,
  type InputRunSurface,
  type ParsedInputEntry,
} from "../../domain/workflow/ingress.js";
import type { StartPlanResponse } from "../client/index.js";
import { useDashboardClient } from "../state/client-context.js";
import type { WorkflowCategoryPrimitive } from "./shell.js";
import {
  EnqueueResultBanner,
  InstanceSelector,
  PlanPreview,
  PlanRefusals,
  RunFlagChips,
  StageRail,
  StartChoiceControl,
  StartFlagControl,
  testSystemsOf,
  type InstanceChoice,
  type SystemInstancePrimitive,
} from "./run-start-kit.js";

/** the surface id this command family is audited under (doc 13 §3.4) */
const SOURCE_SURFACE = "run-start";

const STAGES = Object.freeze([
  { key: "input", label: "Input" },
  { key: "plan", label: "Plan" },
  { key: "result", label: "Result" },
] as const);

type StageKey = (typeof STAGES)[number]["key"];

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
   * The short code the demo's picker row carries. The bootstrap workflow
   * projection does not serve one yet, so it is OPTIONAL and the row renders
   * nothing at all when it is absent — a placeholder in the slot where an
   * identity belongs is the fabricated value this tree bans.
   */
  readonly code?: string;
  /** the descriptor's declared typed-input surface, or why there is none */
  readonly inputRun:
    | { readonly state: "present"; readonly surface: InputRunSurface }
    | { readonly state: "absent"; readonly reason: string };
  readonly systemInstances: readonly SystemInstancePrimitive[];
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
const NO_WORKFLOW_SELECTED = Object.freeze({
  state: "absent",
  reason: "no workflow is selected",
} as const);

const NO_SYSTEM_INSTANCES: readonly SystemInstancePrimitive[] = Object.freeze([]);

// ---------------------------------------------------------------------------
// The launcher
// ---------------------------------------------------------------------------

/** the queue toolbar's one primary control — the dialog itself lives at the root */
export function RunStartButton({ onOpen }: { onOpen: () => void }) {
  return (
    <Button
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
// The workflow picker — the served rail categories, inside the dialog
// ---------------------------------------------------------------------------

interface PickerGroup {
  readonly label: string;
  readonly entries: readonly RunStartWorkflow[];
}

/**
 * The picker's groups, in the served category order.
 *
 * This is the shell rail's own rule (`buildWorkflowRailGroups`) restated over
 * the start catalogue rather than shared, because the two lists hold different
 * entries: a category nothing STARTABLE is registered under is dropped, and a
 * workflow whose category the server did not send falls into a trailing
 * `Other` rather than disappearing.
 */
function pickerGroups(
  workflows: readonly RunStartWorkflow[],
  categories: readonly WorkflowCategoryPrimitive[],
): PickerGroup[] {
  const ordered = [...categories].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const groups: PickerGroup[] = [];
  for (const category of ordered) {
    const entries = workflows.filter((workflow) => workflow.categoryId === category.id);
    if (entries.length > 0) groups.push({ label: category.label, entries });
  }
  const known = new Set(categories.map((category) => category.id));
  const orphans = workflows.filter((workflow) => !known.has(workflow.categoryId));
  if (orphans.length > 0) groups.push({ label: "Other", entries: orphans });
  return groups;
}

function matchesQuery(workflow: RunStartWorkflow, categoryLabel: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  return workflow.label.toLowerCase().includes(needle)
    || (workflow.code !== undefined && workflow.code.toLowerCase().includes(needle))
    || categoryLabel.toLowerCase().includes(needle);
}

/**
 * Ported from hr-automation@1bffbd65,
 * src/dashboard/components/dev/rebuild-demo/DemoRunStart.tsx:152-253.
 */
function WorkflowPicker({
  workflows,
  categories,
  value,
  onChange,
}: {
  workflows: readonly RunStartWorkflow[];
  categories: readonly WorkflowCategoryPrimitive[];
  value: string;
  onChange: (next: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [showBlocked, setShowBlocked] = useState(false);
  const groups = useMemo(
    () =>
      pickerGroups(workflows.filter(isStartable), categories)
        .map((group) => ({ ...group, entries: group.entries.filter((entry) => matchesQuery(entry, group.label, query)) }))
        .filter((group) => group.entries.length > 0),
    [workflows, categories, query],
  );
  const blocked = useMemo(() => workflows.filter((workflow) => !isStartable(workflow)), [workflows]);

  return (
    <div className="flex w-[204px] shrink-0 flex-col border-r border-[color:var(--ds-border)]">
      <div className="shrink-0 border-b border-[color:var(--ds-border)] p-[var(--ds-space-base)]">
        {/* A plain labelled input rather than SearchInput: this filters a short
            list, so a clear affordance would cost a control for a state one
            keystroke undoes. */}
        <label className="flex min-w-0 items-center gap-[var(--ds-space-snug)]">
          <Search aria-hidden className={cn(dsIcon.sm, "shrink-0", dsFg.muted)} />
          <span className="sr-only">Filter workflows</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter"
            className={cn(
              "min-w-0 flex-1 border-none bg-transparent outline-none",
              dsText.ui,
              "text-[color:var(--ds-fg)] placeholder:text-[color:var(--ds-fg-faint)]",
            )}
          />
        </label>
      </div>

      <nav aria-label="Workflow" className="min-h-0 flex-1 overflow-y-auto p-[var(--ds-space-base)]">
        {groups.length === 0 ? (
          <p className={cn(dsText.meta, dsFg.muted)}>No workflow matches “{query}”.</p>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="mb-[var(--ds-space-cozy)] flex flex-col gap-[var(--ds-space-hair)]">
              <SectionLabel className="px-[var(--ds-space-snug)]">{group.label}</SectionLabel>
              {group.entries.map((workflow) => {
                const selected = workflow.workflowId === value;
                return (
                  <button
                    key={workflow.workflowId}
                    type="button"
                    aria-current={selected ? "true" : undefined}
                    onClick={() => onChange(workflow.workflowId)}
                    className={cn(
                      "flex w-full min-w-0 cursor-pointer items-center gap-[var(--ds-space-snug)] text-left",
                      "h-[var(--ds-h-row)] px-[var(--ds-space-snug)]",
                      dsRadius.md,
                      dsText.ui,
                      dsFocus,
                      dsMotion.fast,
                      selected
                        ? cn("bg-[var(--ds-surface-3)] font-semibold", dsFg.base)
                        : cn("hover:bg-[var(--ds-surface-2)]", dsFg.secondary),
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{workflow.label}</span>
                    {/* Served or nothing — see `RunStartWorkflow.code`. */}
                    {workflow.code !== undefined && (
                      <span className={cn(dsText.micro, dsText.nums, selected ? dsFg.muted : dsFg.faint)}>
                        {workflow.code}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))
        )}
      </nav>

      {/* Not offered, and it says so. A workflow that simply vanishes from a
          picker teaches the operator the list is arbitrary.

          A DISCLOSURE, not a Popover: `dsLayer.menu` is z-20 and a Dialog is
          z-40, so a popover opened from inside a modal renders BEHIND it — the
          a11y tree says it opened and the screen says nothing happened.

          The demo draws a `<dl>` because it has a REASON per workflow. This
          tree serves none (the wire gap is on the audit's ledger), so it draws
          the names as a list rather than a definition list whose definitions
          would all be empty — and it invents no reason text. */}
      <div className="shrink-0 border-t border-[color:var(--ds-border)] p-[var(--ds-space-base)]">
        {showBlocked && (
          <ul className="mb-[var(--ds-space-snug)] flex max-h-[11rem] flex-col gap-[var(--ds-space-snug)] overflow-y-auto">
            {blocked.map((workflow) => (
              <li key={workflow.workflowId} className={cn(dsText.meta, "font-semibold", dsFg.base)}>
                {workflow.label}
              </li>
            ))}
          </ul>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="w-full justify-start"
          aria-expanded={showBlocked}
          onClick={() => setShowBlocked((open) => !open)}
        >
          {blocked.length} not startable
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The shared run-control rail
// ---------------------------------------------------------------------------

/**
 * One numbered group in the shared run-control rail. The number is a reading
 * aid, not state: it gives the operator a stable top-to-bottom path through
 * settings that otherwise look like one long stack of unrelated fields.
 *
 * Ported from hr-automation@1bffbd65,
 * src/dashboard/components/dev/rebuild-demo/DemoRunStart.tsx:490-525.
 */
function RunControlGroup({
  step,
  title,
  description,
  children,
}: {
  step: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-[var(--ds-space-cozy)] border-b border-[color:var(--ds-border-subtle)] pb-[var(--ds-space-loose)] last:border-b-0 last:pb-0">
      <div className="flex items-start gap-[var(--ds-space-base)]">
        <span
          aria-hidden
          className={cn(
            "flex h-[var(--ds-h-sm)] w-[var(--ds-h-sm)] shrink-0 items-center justify-center border",
            "border-[color:var(--ds-recess-border)] bg-[var(--ds-surface-3)]",
            dsRadius.sm,
            dsText.micro,
            dsText.nums,
            dsFg.muted,
          )}
        >
          {step}
        </span>
        <span className="flex min-w-0 flex-col gap-[var(--ds-space-hair)]">
          <h4 className={cn(dsText.ui, "font-semibold", dsFg.base)}>{title}</h4>
          <p className={cn(dsText.meta, dsFg.muted)}>{description}</p>
        </span>
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// The descriptor's own parser, previewed
// ---------------------------------------------------------------------------

function separatorLabel(spec: InputParserSpec): string {
  if (spec.split.kind === "whole-text") return "the whole box is one entry";
  const shown = spec.split.delimiters.map((delimiter) => (delimiter === "\n" ? "a new line" : `“${delimiter}”`));
  if (shown.length === 1) return `separated by ${shown[0]}`;
  return `separated by ${shown.slice(0, -1).join(", ")} or ${shown[shown.length - 1]}`;
}

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
}: {
  surface: InputRunSurface;
  workflowId: string;
  text: string;
  onText: (next: string) => void;
  preview: ParsePreview;
}) {
  return (
    <div className="flex flex-col gap-[var(--ds-space-snug)]">
      <Field
        label={`Entries — ${separatorLabel(surface.parser)}`}
        hint={`${String(preview.entries.length)} parsed`}
        error={preview.problem}
      >
        <Textarea
          // Re-keyed per workflow so switching one puts the caret in the box the
          // operator is about to type into.
          key={workflowId}
          autoFocus
          rows={4}
          value={text}
          placeholder={surface.placeholder}
          onChange={(event) => onText(event.target.value)}
        />
      </Field>

      {preview.entries.length > 0 && (
        <ul className="flex flex-col gap-[var(--ds-space-hair)]">
          {preview.entries.map((entry) => (
            <li
              key={entry.index}
              className={cn(
                "flex min-w-0 items-center gap-[var(--ds-space-snug)] px-[var(--ds-space-snug)] py-[var(--ds-space-hair)]",
                dsRadius.sm,
                "bg-[var(--ds-surface-2)]",
              )}
            >
              <span className={cn(dsText.micro, dsText.nums, dsFg.faint)}>{entry.index + 1}</span>
              <span className={cn(dsText.body, "min-w-0 flex-1 truncate", dsFg.base)}>{entry.sourceText}</span>
              <span className={cn(dsText.meta, dsFg.muted)}>{entry.fields[0].field}</span>
            </li>
          ))}
        </ul>
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
 */
function defaultWorkflowId(
  workflows: readonly RunStartWorkflow[],
  panelWorkflowId: string,
): string {
  const startable = workflows.filter(isStartable);
  const onPanel = startable.find((workflow) => workflow.workflowId === panelWorkflowId);
  const chosen = onPanel
    ?? startable[0]
    ?? workflows.find((workflow) => workflow.workflowId === panelWorkflowId)
    ?? workflows[0];
  return chosen === undefined ? "" : chosen.workflowId;
}

export function RunStartDialog({
  open,
  onOpenChange,
  workflows,
  categories,
  panelWorkflowId,
  actorId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** every workflow the boot document serves, with its declared start surface */
  workflows: readonly RunStartWorkflow[];
  /** the served rail categories — the picker's headings, in the served order */
  categories: readonly WorkflowCategoryPrimitive[];
  /** the Workflow Panel the operator is standing in — the dialog's default */
  panelWorkflowId: string;
  /** echoed from bootstrap; the server matches it against the request identity */
  actorId: string;
}) {
  const client = useDashboardClient();

  const [workflowId, setWorkflowId] = useState<string>(() => defaultWorkflowId(workflows, panelWorkflowId));
  const [stage, setStage] = useState<StageKey>("input");
  const [text, setText] = useState("");
  const [priority, setPriority] = useState<"interactive" | "bulk">("interactive");
  const [dryRunRequested, setDryRunRequested] = useState(false);
  const [instances, setInstances] = useState<InstanceChoice>({});
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
    setStage("input");
  }, []);

  // Opening lands on the panel you are standing in, every time — including the
  // second time, which is why this keys on `open` rather than running once.
  useEffect(() => {
    if (open) selectWorkflow(defaultWorkflowId(workflows, panelWorkflowId));
  }, [open, workflows, panelWorkflowId, selectWorkflow]);

  const workflow = workflows.find((entry) => entry.workflowId === workflowId);
  const inputRun = workflow?.inputRun ?? NO_WORKFLOW_SELECTED;
  const systemInstances = workflow?.systemInstances ?? NO_SYSTEM_INSTANCES;
  const categoryLabel = categories.find((category) => category.id === workflow?.categoryId)?.label;

  const supportsDryRun = inputRun.state === "present" && inputRun.surface.supportsDryRun === true;
  const dryRun = supportsDryRun && dryRunRequested;
  const test = testSystemsOf(systemInstances, instances);

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

  const constants = inputRun.state === "present" ? (inputRun.surface.parser.constants ?? []) : [];

  const submitPlan = useCallback(async (): Promise<void> => {
    if (preview.entries.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const next = await client.submitStartPlan({
        workflowId,
        submissions: preview.entries.map((entry) => toRawSubmission(entry)),
        dryRun,
        priority,
        ...(Object.keys(instances).length === 0 ? {} : { requestedInstance: instances }),
      });
      setPlan(next);
      setResult(null);
      setStage("plan");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }, [client, dryRun, instances, preview, priority, workflowId]);

  const confirmStart = useCallback(async (): Promise<void> => {
    if (plan === null) return;
    setBusy(true);
    setError(null);
    try {
      const next = await client.executeCommand({
        commandId: crypto.randomUUID(),
        requestedAt: systemClock.now().toISOString(),
        requestedBy: actorId,
        source: SOURCE_SURFACE,
        family: "start",
        type: "start-run",
        target: {
          workflowId: plan.workflowId,
          startPlanId: plan.startPlanId,
          expectedVersion: plan.expectedVersion,
        },
        payload: plan.fingerprints,
      });
      setResult(next);
      setStage("result");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }, [actorId, client, plan]);

  const reachable = useMemo(() => {
    const keys = new Set<string>(["input"]);
    if (plan !== null) keys.add("plan");
    if (result !== null) keys.add("result");
    return keys;
  }, [plan, result]);

  const applied = result?.state === "applied" || result?.state === "already-applied";
  const blockedReason = inputRun.state !== "present"
    ? inputRun.reason
    : preview.problem !== null
      ? "Fix the refused entry first."
      : preview.entries.length === 0
        ? "Type at least one value."
        : null;

  const closeAndReset = useCallback((next: boolean) => {
    onOpenChange(next);
    if (!next) {
      // The plan token is short-lived and single-use; a closed dialog must not
      // reopen holding a token the server may already have consumed. The typed
      // draft survives — retyping it is the cost this deliberately avoids.
      setPlan(null);
      setResult(null);
      setError(null);
      setStage("input");
    }
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={closeAndReset}>
      <DialogContent
        size="xl"
        title="Start a run"
        description="Pick what to run. It declares what it takes, and the plan says exactly what will exist before anything is enqueued."
        className="h-[min(88vh,760px)] max-w-[min(96vw,1320px)]"
      >
        <div className="flex min-h-0 flex-1">
          <WorkflowPicker
            workflows={workflows}
            categories={categories}
            value={workflowId}
            onChange={selectWorkflow}
          />

          {/* `@container`, not a viewport query: the form column's width is set
              by the picker AND the shared-control rail beside it, so a two-up
              grid has to key on the workflow column it actually lives in. */}
          <DialogBody className="@container flex flex-1 flex-col gap-[var(--ds-space-loose)]">
            <StageRail stages={STAGES} current={stage} reachable={reachable} onSelect={(key) => setStage(key as StageKey)} />

            {error !== null && (
              <Banner tone="danger" title="The request did not complete">
                {error}
              </Banner>
            )}

            {/* What you are starting — the fact everything below is conditioned
                on, on one line. */}
            <section className="flex flex-col gap-[var(--ds-space-snug)]">
              <SectionLabel>Workflow setup</SectionLabel>
              <div className="flex min-w-0 flex-wrap items-center gap-[var(--ds-space-base)]">
                <h3 className={cn(dsText.section, "min-w-0 font-semibold", dsFg.base)}>
                  {workflow?.label ?? "No workflow"}
                </h3>
                {categoryLabel !== undefined && <Chip label="group">{categoryLabel}</Chip>}
                <RunFlagChips dryRun={dryRun} test={test} priority={priority} />
              </div>
            </section>

            {stage === "input" && (
              inputRun.state === "present" ? (
                <TypedInput
                  surface={inputRun.surface}
                  workflowId={workflowId}
                  text={text}
                  onText={(next) => {
                    setText(next);
                    setPlan(null);
                    setResult(null);
                  }}
                  preview={preview}
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
              )
            )}

            {stage === "input" && constants.length > 0 && (
              <section className="flex flex-col gap-[var(--ds-space-cozy)]">
                <SectionLabel>
                  <SlidersHorizontal aria-hidden className={cn(dsIcon.sm, "mr-[var(--ds-space-tight)] inline")} />
                  How this run is shaped
                </SectionLabel>
                <div className="grid grid-cols-1 gap-[var(--ds-space-cozy)] @min-[560px]:grid-cols-2">
                  {constants.map((constant) => (
                    <StartChoiceControl
                      key={constant.field}
                      constant={constant}
                      reason="fixed by this workflow's input surface"
                    />
                  ))}
                </div>
              </section>
            )}

            {stage === "plan" && (
              <section className="flex flex-col gap-[var(--ds-space-snug)]">
                <SectionLabel>What this will create</SectionLabel>
                {plan === null ? (
                  <Well>
                    <EmptyState
                      className="p-[var(--ds-space-base)]"
                      icon={<Layers aria-hidden className={dsIcon.lg} />}
                      title="No plan yet"
                      description="Fill in the input above and this fills in with the exact rows the start would create, which panel each one lands in, and the decisions that shape it."
                    />
                  </Well>
                ) : (
                  <div className="flex flex-col gap-[var(--ds-space-loose)]">
                    <PlanPreview plan={plan} test={test} />
                    <PlanRefusals refused={plan.refused} />
                  </div>
                )}
              </section>
            )}

            {stage === "result" && result !== null && (
              <EnqueueResultBanner result={result} onDismiss={() => setResult(null)} />
            )}
          </DialogBody>

          {/* Shared run behavior is deliberately OUTSIDE the workflow form.
              These controls keep the same meaning when the workflow changes,
              so the dialog gives them a stable third column instead of mixing
              them into each workflow's unique input and choices.

              Ported from hr-automation@1bffbd65,
              src/dashboard/components/dev/rebuild-demo/DemoRunStart.tsx:839-932. */}
          <aside
            aria-label="Run controls"
            className="flex w-[300px] shrink-0 flex-col border-l border-[color:var(--ds-border)] bg-[var(--ds-recess-bg)]"
          >
            <header className="flex shrink-0 items-start gap-[var(--ds-space-base)] border-b border-[color:var(--ds-border)] bg-[var(--ds-surface-1)] px-[var(--ds-space-cozy)] py-[var(--ds-space-base)]">
              <span
                className={cn(
                  "flex h-[var(--ds-h-md)] w-[var(--ds-h-md)] shrink-0 items-center justify-center border",
                  "border-[color:var(--ds-recess-border)] bg-[var(--ds-surface-3)]",
                  dsRadius.md,
                  dsFg.secondary,
                )}
              >
                <SlidersHorizontal aria-hidden className={dsIcon.md} />
              </span>
              <span className="flex min-w-0 flex-col gap-[var(--ds-space-hair)]">
                <SectionLabel>Shared settings</SectionLabel>
                <h3 className={cn(dsText.title, "font-semibold", dsFg.base)}>Run controls</h3>
                <p className={cn(dsText.meta, dsFg.muted)}>
                  These options work the same way for every workflow.
                </p>
              </span>
            </header>

            <div className="flex min-h-0 flex-1 flex-col gap-[var(--ds-space-loose)] overflow-y-auto p-[var(--ds-space-cozy)]">
              {/* The demo's `Active-run policy` select belongs in this group and
                  is deliberately absent: the policy is a descriptor declaration
                  in this tree, not an operator choice. */}
              <RunControlGroup
                step="01"
                title="Queue behavior"
                description="Choose how this work enters the browser queue."
              >
                <Field label="Priority" description="Bulk work yields whenever interactive work needs the browser.">
                  <Select
                    value={priority}
                    onChange={(event) => {
                      setPriority(event.target.value === "bulk" ? "bulk" : "interactive");
                      setPlan(null);
                    }}
                  >
                    <option value="interactive">Interactive</option>
                    <option value="bulk">Bulk</option>
                  </Select>
                </Field>
              </RunControlGroup>

              <RunControlGroup
                step="02"
                title="Safety & mode"
                description="Apply optional limits before the run starts."
              >
                <StartFlagControl
                  label="Dry run"
                  description={supportsDryRun ? undefined : "not declared by this workflow"}
                  checked={dryRun}
                  disabled={!supportsDryRun}
                  onChange={(next) => {
                    setDryRunRequested(next);
                    setPlan(null);
                  }}
                />
              </RunControlGroup>

              <RunControlGroup
                step="03"
                title="Destination"
                description="Confirm the systems this run is allowed to write to."
              >
                <InstanceSelector
                  systems={systemInstances}
                  value={instances}
                  onChange={(next) => {
                    setInstances(next);
                    setPlan(null);
                  }}
                />
              </RunControlGroup>
            </div>
          </aside>
        </div>

        <DialogFooter
          meta={
            <MetaLine
              tone="faint"
              items={[
                workflow?.label,
                blockedReason ?? (plan === null ? undefined : `${String(plan.planned.length)} to create`),
              ].filter((item): item is string => item !== undefined)}
            />
          }
        >
          <Button variant="secondary" onClick={() => closeAndReset(false)}>
            Cancel
          </Button>
          {stage === "plan" && plan !== null ? (
            <Button
              variant="primary"
              icon={<Play aria-hidden className={dsIcon.md} />}
              loading={busy}
              disabled={busy || applied || plan.planned.length === 0}
              onClick={() => void confirmStart()}
            >
              {plan.dryRun ? "Start dry run" : "Start run"}
            </Button>
          ) : (
            <Button
              variant="primary"
              loading={busy}
              disabled={busy || blockedReason !== null}
              onClick={() => void submitPlan()}
            >
              Plan the run
            </Button>
          )}
        </DialogFooter>
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
  categories,
  panelWorkflowId,
  actorId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflows: readonly RunStartWorkflow[];
  categories: readonly WorkflowCategoryPrimitive[];
  panelWorkflowId: string;
  actorId: string;
}) {
  return (
    <RunStartDialog
      open={open}
      onOpenChange={onOpenChange}
      workflows={workflows}
      categories={categories}
      panelWorkflowId={panelWorkflowId}
      actorId={actorId}
    />
  );
}
