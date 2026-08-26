/**
 * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * src/dashboard/components/dev/rebuild-demo/DemoRunStart.tsx — and re-ported
 * region by region from hr-automation@1bffbd65 for the 2026-08-13 detail
 * fidelity pass (docs/plans/2026-08-13-detail-fidelity-audit.md, R8).
 *
 * **The** Start Run surface — 1i's typed method, wired to the real start
 * protocol (ref frontend-backend-integration §5.1):
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
 * workflows plus each descriptor's declared input surface are
 * all the list, the grouping, the filter, the selection and the
 * "{n} not startable" count need. (An earlier header claimed the picker waited
 * on a bootstrap start-capability projection. That was wrong — R8 finding 12.)
 *
 * Deferred with their owning slices, and omitted rather than faked: the upload,
 * capture, spreadsheet and bare start methods (2h), presets, preflight/doctor
 * results, and per-system host lines.
 *
 * **The peer-method TABS are not deferred, they are not applicable** (D251).
 * The demo renders them only at `methods.length > 1`, and this tree has one
 * method kind — `WorkflowSurfaces.uploadRun` is declared by no registered
 * workflow — so no tabs IS the demo-faithful rendering of one method, and a tab
 * strip over a set of one would be D186's sample-of-one. The demo's per-method
 * `note` goes with them: with one method it would be a second sentence about
 * the same thing `summary` already says.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
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
import { settleCommandResult } from "../app/command-result.js";
import {
  inputRunParserLabel,
  inputRunSeparatorLabel,
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
  groupWorkflowsByCategory,
  workflowCategoryLabel,
  type WorkflowCategoryGroup,
  type WorkflowGroupEntry,
} from "./workflow-category.js";
import { WorkflowHarnessTag } from "./workflow-harness-tag.js";
import {
  EnqueueResultBanner,
  InstanceSelector,
  LockedFact,
  PlanPreview,
  PlanRefusals,
  RunFlagChips,
  StageRail,
  StartChoiceControl,
  StartFlagControl,
} from "./run-start-kit.js";
import { type InstanceChoice, type SystemInstancePrimitive } from "./run-start-kit-model.js";
import { testSystemsOf } from "./run-start-kit-model.js";
import {
  ENQUEUE_POLICY_MEANING,
  ENQUEUE_POLICY_REASON,
  runControlGroups,
  startRequestFingerprint,
  type StartPriority,
} from "./run-start-model.js";
import { versionTag } from "./format.js";

/** the surface id this command family is audited under (ref frontend-backend-integration §3.4) */
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
  /**
   * The descriptor's own version, served on the boot document's start block
   * (C96). The footer prints `{label} v{n}` because a confirmation dialog owes
   * the operator the one thing the label cannot say — WHICH shape of this
   * workflow is about to run — and it is the same integer every archived row's
   * token tooltip carries, so the two agree by construction.
   */
  readonly version: number;
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
// The workflow picker — the rail's own categories, inside the dialog
//
// The picker's groups are the SHELL RAIL'S OWN RULE, not a restatement of it
// (R2 D17/D18): `groupWorkflowsByCategory` is called here over the startable
// catalogue and there over every workflow, so the two lists differ in their
// ENTRIES and can never differ in their headings or their order. This used to
// be a hand-copied second implementation, which is exactly the drift one
// shared helper makes unrepresentable.
// ---------------------------------------------------------------------------

function matchesQuery(workflow: RunStartWorkflow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  return workflow.label.toLowerCase().includes(needle)
    || (workflow.code !== undefined && workflow.code.toLowerCase().includes(needle))
    || workflowCategoryLabel(workflow.categoryId).toLowerCase().includes(needle);
}

/** the picker's own view-model, carrying the identity the ONE rule keys on */
type PickerEntry = RunStartWorkflow & { readonly id: string };

/**
 * BOTH picker lists go through the ONE rule (ref dashboard-surfaces §Shell, D219) — the
 * startable catalogue and the "not startable" disclosure alike — so a chunk
 * harness is a step under its composition in each of them and a peer in
 * neither.
 *
 * The query filters the LIST, before grouping, rather than each group's
 * entries after it: filtering afterwards could delete a composition while
 * keeping a harness that had just been nested under it. Filtering first hands
 * the rule an honest list, and a harness whose composition the query dropped
 * takes the rule's own orphan arm — top level, still marked as a harness of
 * the composition it names.
 */
function pickerGroups(
  workflows: readonly RunStartWorkflow[],
  query = "",
): WorkflowCategoryGroup<PickerEntry>[] {
  return groupWorkflowsByCategory(
    workflows
      .filter((workflow) => matchesQuery(workflow, query))
      .map((workflow) => ({ ...workflow, id: workflow.workflowId })),
  );
}

/**
 * ONE level of picker entries, and the nested level under each of them.
 *
 * The nesting is a real nested list inside the parent's own `<li>` rather than
 * padding on a flat list: the operator hears the same hierarchy the eye reads
 * (D187), and the nested list names the composition it belongs to. `row` is
 * supplied by the caller because the two lists this picker draws — the
 * startable catalogue and the "not startable" disclosure — differ in exactly
 * one thing, whether a row is a control, and in nothing about the structure.
 */
function PickerEntries({
  nodes,
  row,
}: {
  nodes: readonly WorkflowGroupEntry<PickerEntry>[];
  row: (node: WorkflowGroupEntry<PickerEntry>) => ReactNode;
}) {
  return (
    <ul className="flex flex-col gap-[var(--ds-space-hair)]">
      {nodes.map((node) => (
        <li key={node.entry.workflowId}>
          {row(node)}
          {node.members.length > 0 && (
            <ul
              aria-label={`Proving harnesses of ${node.entry.label}`}
              className="flex flex-col gap-[var(--ds-space-hair)] pl-[var(--ds-space-cozy)]"
            >
              {node.members.map((member) => (
                <li key={member.entry.workflowId}>{row(member)}</li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

/** one selectable workflow — or one step of one, marked as such */
function PickerRow({
  node,
  value,
  onChange,
}: {
  node: WorkflowGroupEntry<PickerEntry>;
  value: string;
  onChange: (next: string) => void;
}) {
  const workflow = node.entry;
  const selected = workflow.workflowId === value;
  return (
    <button
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
          : cn("hover:bg-[var(--ds-surface-2)]", node.harness === undefined ? dsFg.secondary : dsFg.muted),
      )}
    >
      <span className="min-w-0 flex-1 truncate">{workflow.label}</span>
      {node.harness !== undefined && <WorkflowHarnessTag harness={node.harness} />}
      {/* Served or nothing — see `RunStartWorkflow.code`. */}
      {workflow.code !== undefined && (
        <span className={cn(dsText.micro, dsText.nums, selected ? dsFg.muted : dsFg.faint)}>
          {workflow.code}
        </span>
      )}
    </button>
  );
}

/**
 * Ported from hr-automation@1bffbd65,
 * src/dashboard/components/dev/rebuild-demo/DemoRunStart.tsx:152-253.
 */
function WorkflowPicker({
  workflows,
  value,
  onChange,
}: {
  workflows: readonly RunStartWorkflow[];
  value: string;
  onChange: (next: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [showBlocked, setShowBlocked] = useState(false);
  const groups = useMemo(() => pickerGroups(workflows.filter(isStartable), query), [workflows, query]);
  const blocked = useMemo(() => workflows.filter((workflow) => !isStartable(workflow)), [workflows]);
  const blockedGroups = useMemo(() => pickerGroups(blocked), [blocked]);

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
              <PickerEntries
                nodes={group.entries}
                row={(node) => <PickerRow node={node} value={value} onChange={onChange} />}
              />
            </div>
          ))
        )}
      </nav>

      {/* Not offered, and it says WHY. A workflow that simply vanishes from a
          picker teaches the operator the list is arbitrary.

          A DISCLOSURE, not a Popover: `dsLayer.menu` is z-20 and a Dialog is
          z-40, so a popover opened from inside a modal renders BEHIND it — the
          a11y tree says it opened and the screen says nothing happened.

          D251: the demo's `<dl>` is drawn, because the reason exists and always
          did — the app composes it beside the surface it is the absence of. An
          earlier comment here claimed this tree served none, which was the same
          false-deferral shape R8 finding 1 found on the park cards. The reason
          is the MODAL's own precondition and is worded as one; see
          `run-start-model.ts`. */}
      <div className="shrink-0 border-t border-[color:var(--ds-border)] p-[var(--ds-space-base)]">
        {/* The SAME rule as the list above it (D219): a chunk harness is a step
            of its composition here too, so the two halves of one picker cannot
            say different things about the same workflow. */}
        {showBlocked && (
          <div className="mb-[var(--ds-space-snug)] flex max-h-[11rem] flex-col gap-[var(--ds-space-snug)] overflow-y-auto">
            {blockedGroups.map((group) => (
              <div key={group.label} className="flex flex-col gap-[var(--ds-space-hair)]">
                <SectionLabel className="px-[var(--ds-space-snug)]">{group.label}</SectionLabel>
                <PickerEntries
                  nodes={group.entries}
                  row={(node) => (
                    /* The demo pairs each name with its reason in a `<dl>`; this
                       stays a `<ul>` because the list also carries the D219
                       HIERARCHY — a chunk harness is a step under its
                       composition here exactly as it is above — and a nested
                       definition list inside a `<dd>` would claim a harness is a
                       definition of the composition it belongs to. The pair
                       renders as the demo draws it: name, then reason beneath. */
                    <span className="flex min-w-0 flex-col gap-[var(--ds-space-hair)] px-[var(--ds-space-snug)]">
                      <span
                        className={cn(
                          "flex min-w-0 items-center gap-[var(--ds-space-snug)]",
                          dsText.meta,
                          node.harness === undefined ? cn("font-semibold", dsFg.base) : dsFg.secondary,
                        )}
                      >
                        <span className="min-w-0 truncate">{node.entry.label}</span>
                        {node.harness !== undefined && <WorkflowHarnessTag harness={node.harness} />}
                      </span>
                      {node.entry.inputRun.state === "absent" && (
                        <span className={cn(dsText.meta, dsFg.muted)}>{node.entry.inputRun.reason}</span>
                      )}
                    </span>
                  )}
                />
              </div>
            ))}
          </div>
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
      {/* D250 — each button types the descriptor's own declared text, verbatim.
          `defineWorkflowDescriptor` has already proved it parses AND satisfies
          the workflow's input schema, so a click can never fill the box with
          something the plan refuses. A surface declaring none draws no row. */}
      {surface.examples !== undefined && (
        <div className="flex flex-wrap items-center gap-[var(--ds-space-snug)]">
          <SectionLabel>Examples</SectionLabel>
          {surface.examples.map((example) => (
            <Button
              key={example.key}
              size="sm"
              variant="outline"
              title={example.note}
              onClick={() => onText(example.text)}
            >
              {example.label}
            </Button>
          ))}
        </div>
      )}
      <Field
        // D250 — both halves are DERIVED from the parser spec, so the box cannot
        // describe a rule it does not apply.
        label={`${inputRunValueNoun(surface.parser)} — ${inputRunSeparatorLabel(surface.parser)}`}
        description={inputRunParserLabel(surface.parser)}
        hint={`${String(preview.entries.length)} parsed`}
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** every workflow the boot document serves, with its declared start surface */
  workflows: readonly RunStartWorkflow[];
  /** the Workflow Panel the operator is standing in — the dialog's default */
  panelWorkflowId: string;
  /** echoed from bootstrap; the server matches it against the request identity */
  actorId: string;
}) {
  const client = useDashboardClient();

  const [workflowId, setWorkflowId] = useState<string>(() => defaultWorkflowId(workflows, panelWorkflowId));
  const [stage, setStage] = useState<StageKey>("input");
  const [text, setText] = useState("");
  const [priority, setPriority] = useState<StartPriority>("interactive");
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
  const categoryLabel = workflow === undefined ? undefined : workflowCategoryLabel(workflow.categoryId);

  const supportsDryRun = inputRun.state === "present" && inputRun.surface.supportsDryRun === true;
  const dryRun = supportsDryRun && dryRunRequested;
  const test = testSystemsOf(systemInstances, instances);

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
  const requestFingerprint = startRequestFingerprint({
    workflowId,
    text,
    dryRun,
    priority,
    instances,
  });
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
    setStage("input");
  }, [requestFingerprint]);

  /**
   * The typed box, so an exit from a settled banner can put the keyboard back
   * where the operator types.
   */
  const typedInputRef = useRef<HTMLTextAreaElement>(null);

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
    const dispatchedFor = requestFingerprint;
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
      // The operator edited the form while this was on the wire, so the server
      // answered a question the form no longer asks and the plan token it
      // carries is already unusable. Landing it would put a proposal for text
      // that has left the box under a primary button that says Start run.
      if (requestFingerprintRef.current !== dispatchedFor) return;
      setPlan(next);
      setResult(null);
      setStage("plan");
    } catch (caught) {
      // A refusal of a superseded request is not dropped evidence: the next
      // `Plan the run` re-asks the same server the same way and surfaces it
      // against the request the operator is actually looking at. What IS
      // banned is showing this one — a danger banner naming text that is no
      // longer in the box reads as a refusal of what is.
      if (requestFingerprintRef.current !== dispatchedFor) return;
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }, [client, dryRun, instances, preview, priority, requestFingerprint, workflowId]);

  const confirmStart = useCallback(async (): Promise<void> => {
    if (plan === null) return;
    const dispatchedFor = requestFingerprint;
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
      // Same rule one stage later, and it costs no record: `applied` is a
      // RECEIPT for a request that was accepted, not the row itself — the
      // queue changes only from the authoritative projection
      // (ref frontend-backend-integration §0.5), so a run this command
      // enqueued is on screen in the queue whether or not this banner draws.
      // What the banner would claim, standing over an edited form, is that
      // THIS request is the one that landed.
      if (requestFingerprintRef.current !== dispatchedFor) return;
      setResult(next);
      setStage("result");
    } catch (caught) {
      if (requestFingerprintRef.current !== dispatchedFor) return;
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }, [actorId, client, plan, requestFingerprint]);

  const reachable = useMemo(() => {
    const keys = new Set<string>(["input"]);
    if (plan !== null) keys.add("plan");
    if (result !== null) keys.add("result");
    return keys;
  }, [plan, result]);

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
    setPlan(null);
    setResult(null);
    setError(null);
    setStage("input");
    // A workflow that declares no typed-input surface draws no box, which is a
    // real served state (`START_DOOR_ABSENCE`) rather than a missing element:
    // there is genuinely nothing to put the keyboard back into.
    typedInputRef.current?.focus();
  }, []);

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
              {/* The demo's `capability.note`, which is D229's own sentence on
                  the descriptor (D251). Absent declaration → absent paragraph:
                  a composed sentence about a workflow would be this surface
                  claiming to know one, which the header above rules out. */}
              {workflow?.summary !== undefined && (
                <p className={cn(dsText.body, dsFg.secondary, "max-w-[74ch]")}>{workflow.summary}</p>
              )}
            </section>

            {/* C107 (D272 item 8) — the typed box stays on screen at every
                stage. The two-press COMMAND is ruled (`ref dashboard-surfaces`
                §9.1: planning is a server round-trip returning a single-use
                token), but hiding what the operator typed at the moment they
                authorise runs made from it is not: §9.1 describes the four rows
                as ONE view, and the demo keeps its box mounted throughout
                (`DemoRunStart.tsx:709-718`). Editing it re-fingerprints the
                request, which voids the plan above — see `requestFingerprint`. */}
            {inputRun.state === "present" ? (
              <TypedInput
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

            {/* C108 — travels with C107: the locked constants are the shape of
                what is about to be authorised, so they may not leave the screen
                at the moment it is authorised. */}
            {constants.length > 0 && (
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
              // C69 (D272 item 8) — the ONE cure for a plan built against a
              // version that moved: drop the spent token and return to Input,
              // which is what makes the next `POST /start-plans` read the
              // server's current version. The typed text survives — it is the
              // operator's, not the plan's. `Close` / `Dismiss` land in the
              // same place for the same reason; see `returnToInput`.
              <EnqueueResultBanner
                result={result}
                onDismiss={returnToInput}
                onReload={returnToInput}
              />
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
              {/* C83 / C84 (D272 item 9) — the rail is numbered by what it
                  DRAWS. A workflow that declares no dry run draws no Safety
                  group (DESIGN.md:305: "a workflow that declares none shows
                  none: no empty scaffolding"), and Destination closes up to 02
                  rather than leaving a gap in the reading path. The numbering
                  is the fold's, so a group added later cannot mint its own. */}
              {runControlGroups(supportsDryRun).map((group) => (
                <RunControlGroup
                  key={group.key}
                  step={group.step}
                  title={group.title}
                  description={group.description}
                >
                  {group.key === "queue" && (
                    <div className="flex flex-col gap-[var(--ds-space-cozy)]">
                      {/* The demo's `Active-run policy` sits here as a `Select`,
                          and it is drawn READ-ONLY here (D251): `planStart`
                          reads `descriptor.enqueue` and `StartPlanIngress`
                          carries no per-start override, so a select would let
                          the operator choose an answer the server would ignore.
                          The shape is the `LockedValue` pair the design system
                          already uses for "you may not change this" — told apart
                          by SHAPE, not by a badge (DESIGN.md, the
                          ValueField/LockedValue rule) — and C81 (D272 item 9)
                          puts its reason ON SCREEN through the shared
                          `LockedFact`, because a tooltip is unreachable by touch
                          and by keyboard.

                          The pre-plan "nothing is running for this subject" note
                          the demo hangs off this Field has no producer before a
                          plan: the active-run check happens per submission
                          inside `planStart` and its answer is a served
                          `active-run-exists` refusal, which `PlanRefusals`
                          already draws. */}
                      {workflow !== undefined && (
                        <LockedFact
                          label="Active-run policy"
                          value={ENQUEUE_POLICY_MEANING[workflow.enqueue]}
                          reason={ENQUEUE_POLICY_REASON}
                        />
                      )}
                      <Field
                        label="Priority"
                        description="Bulk work yields whenever interactive work needs the browser."
                      >
                        <Select
                          value={priority}
                          onChange={(event) => {
                            setPriority(event.target.value === "bulk" ? "bulk" : "interactive");
                          }}
                        >
                          <option value="interactive">Interactive</option>
                          <option value="bulk">Bulk</option>
                        </Select>
                      </Field>
                    </div>
                  )}

                  {group.key === "safety" && (
                    <StartFlagControl
                      label="Dry run"
                      checked={dryRun}
                      onChange={(next) => {
                        setDryRunRequested(next);
                      }}
                    />
                  )}

                  {group.key === "destination" && (
                    <InstanceSelector
                      systems={systemInstances}
                      value={instances}
                      onChange={(next) => {
                        setInstances(next);
                      }}
                    />
                  )}
                </RunControlGroup>
              ))}
            </div>
          </aside>
        </div>

        <DialogFooter
          meta={
            <MetaLine
              tone="faint"
              items={[
                // `{label} v{n}` — the demo's own footer item 1
                // (`DemoRunStart.tsx:946`). The version is what separates two
                // runs of one workflow started a descriptor bump apart, and
                // this dialog is the last screen before one is enqueued.
                workflow === undefined ? undefined : `${workflow.label} ${versionTag(workflow.version)}`,
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
  panelWorkflowId,
  actorId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflows: readonly RunStartWorkflow[];
  panelWorkflowId: string;
  actorId: string;
}) {
  return (
    <RunStartDialog
      open={open}
      onOpenChange={onOpenChange}
      workflows={workflows}
      panelWorkflowId={panelWorkflowId}
      actorId={actorId}
    />
  );
}
