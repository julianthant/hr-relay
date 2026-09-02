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
 * Deferred with their owning slices, and omitted rather than faked: the upload
 * and bare start methods (2h), presets, preflight/doctor results, and
 * per-system host lines.
 *
 * **The peer-method TABS are back, because there are now two methods** (D296).
 * D251 recorded them as "not applicable, not deferred" — the demo draws them
 * only at `methods.length > 1` and this tree had one method kind, so no tabs
 * WAS the demo-faithful rendering of one method and a strip over a set of one
 * would have been D186's sample-of-one. That reading has not changed; the SET
 * has. A module that declares an intake projection is spreadsheet-capable
 * (`command-kernel.ts`'s own words), the boot document now serves that fact as
 * `start.spreadsheetIntake`, and a workflow carrying it has two ways in. The
 * strip still draws only when the set is larger than one, from the same
 * condition, so a workflow with no projection renders exactly what it does
 * today. `uploadRun` is still declared by nothing and still absent.
 *
 * The spreadsheet method IS the intake's dropzone (D298). D296 shipped it as a
 * paragraph over an `Open the intake…` primary; the paragraph described the
 * zone that was one click away, and the primary's only job was to reach it. The
 * zone is now the panel: the drop uploads, the session opens, and this dialog
 * closes on `?intake=<sessionId>` with the file already read. The footer keeps
 * `Cancel` alone. Mapping, per-row review and the enqueue stay in the workspace
 * (D170/D173) — a durable session that takes minutes is not a modal's job.
 *
 * That is what the queue toolbar's `Import spreadsheet` button stood in for
 * until this existed, and D296 deletes it — a takeover with two doors was the
 * duplicate-door problem D295 ruled on for the catalog. D298 leaves ONE door:
 * `?intake=` is now always a session id, because the workspace's own empty
 * upload page is gone with the sentinel that addressed it.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { ArrowRight, FileSpreadsheet, Keyboard, Play, Search } from "lucide-react";
import { cn } from "../lib/utils.js";
import {
  Banner,
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  Dropzone,
  EmptyState,
  Field,
  KeyValueList,
  MetaLine,
  Refusal,
  SectionLabel,
  Select,
  Textarea,
  Well,
  dsElev,
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
import type { IntakeUploadResult, StartPlanResponse } from "../client/index.js";
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
  LockedFact,
  PlanPreview,
  PlanRefusals,
  RunFlagChips,
  StartChoiceControl,
  StartFlagControl,
} from "./run-start-kit.js";
import { surfaceValueLabel } from "./run-start-kit-model.js";
import { INTAKE_ACCEPT, INTAKE_DROPZONE_HINT, intakeDropzoneLabel } from "./intake-model.js";
import {
  ENQUEUE_POLICY_MEANING,
  ENQUEUE_POLICY_REASON,
  START_METHOD_LABEL,
  startRequestFingerprint,
  type StartMethod,
  type BrowserMode,
  type StartPriority,
} from "./run-start-model.js";
import {
  adjacentRunStartStage,
  reconcileRunStartStage,
  runStartStages,
  type RunStartStage,
} from "./run-start-timeline.js";
import { versionTag } from "./format.js";

/** the surface id this command family is audited under (ref frontend-backend-integration §3.4) */
const SOURCE_SURFACE = "run-start";

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
  readonly steps: readonly Readonly<{
    key: string;
    label: string;
    includedByDefault: boolean;
    control: { state: "selectable"; inputField: string } | { state: "required"; reason: string };
  }>[];
  /** the descriptor's declared typed-input surface, or why there is none */
  readonly inputRun:
    | { readonly state: "present"; readonly surface: InputRunSurface }
    | { readonly state: "absent"; readonly reason: string };
  /**
   * Whether the MODULE declares an intake projection (D296) — served on the
   * boot document's start block, never inferred from a workflow id. It is the
   * same fact the kernel refuses an intake commit by, so the dialog cannot
   * offer a door the server would close.
   */
  readonly spreadsheetIntake: boolean;
}

/**
 * The methods this workflow actually offers, in the demo's own order (typed
 * first) — derived from declarations, never a fixed pair.
 *
 * A workflow with no typed-input surface still has a spreadsheet door if its
 * module declares a projection, and the dialog's absent state belongs to the
 * TYPED method rather than to the dialog: the intake workspace parses rows
 * through the descriptor's own input schema, so it needs no typed surface.
 */
function startMethodsOf(workflow: RunStartWorkflow | undefined): readonly StartMethod[] {
  if (workflow === undefined) return ["typed"];
  return [
    ...(workflow.inputRun.state === "present" ? (["typed"] as const) : []),
    ...(workflow.spreadsheetIntake ? (["spreadsheet"] as const) : []),
  ];
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
    <div className="hidden w-[204px] shrink-0 flex-col border-r border-[color:var(--ds-border)] min-[768px]:flex">
      <div className="box-content flex h-[var(--ds-h-sm)] shrink-0 items-center border-b border-[color:var(--ds-border)] px-[var(--ds-space-base)] py-[var(--ds-space-cozy)]">
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
// The peer methods — how you are starting it (D296)
// ---------------------------------------------------------------------------

const METHOD_ICON: Readonly<Record<StartMethod, ReactNode>> = Object.freeze({
  typed: <Keyboard aria-hidden className={dsIcon.sm} />,
  spreadsheet: <FileSpreadsheet aria-hidden className={dsIcon.sm} />,
});

/**
 * Ported from the demo's `MethodTabs` (`DemoRunStart.tsx:277-324`) — markup,
 * roles, label and treatment verbatim, over this tree's two-arm method set.
 *
 * It is a `tablist` and not a segmented radio group because that is what the
 * demo chose and the choice is already made; what the two arms select is which
 * of the two INPUT surfaces below it renders, which is a tab panel's own job.
 */
function MethodTabs({
  methods,
  value,
  onChange,
}: {
  methods: readonly StartMethod[];
  value: StartMethod;
  onChange: (next: StartMethod) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="How to start this run"
      className={cn(
        "inline-flex items-center gap-[var(--ds-space-hair)] p-[var(--ds-space-hair)]",
        dsRadius.md,
        "bg-[var(--ds-surface-2)]",
      )}
    >
      {methods.map((method) => {
        const selected = method === value;
        return (
          <button
            key={method}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(method)}
            className={cn(
              "inline-flex cursor-pointer items-center gap-[var(--ds-space-snug)]",
              "h-[var(--ds-h-md)] px-[var(--ds-space-cozy)]",
              dsRadius.sm,
              dsText.ui,
              dsFocus,
              dsMotion.fast,
              "active:translate-y-px",
              selected
                ? cn("bg-[var(--ds-surface-overlay)] font-semibold", dsFg.base, dsElev.low)
                : cn(dsFg.muted, "hover:text-[color:var(--ds-fg)]"),
            )}
          >
            {METHOD_ICON[method]}
            {START_METHOD_LABEL[method]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The spreadsheet method's whole Input stage: the intake's own dropzone, moved
 * one screen earlier (D298).
 *
 * D296 drew a paragraph here and put `Open the intake…` in the footer, on the
 * reading that a picker in this dialog would land the operator "past the
 * mapping step". That was wrong about the workspace it was protecting — the
 * workspace's FIRST screen is this exact zone, and a file dropped on it skips
 * nothing: the upload opens a session and the mapping grid is what comes up.
 * So the panel is the zone, the drop IS the press, and the footer keeps
 * `Cancel` alone.
 *
 * What did NOT move: mapping, per-row review, the manifest and the enqueue all
 * stay in the workspace, because the session is durable and reviewing four
 * hundred rejections takes minutes a modal would trap (D170/D173).
 *
 * The three strings are the workspace's own (`intake-model.ts`), so the two
 * doors cannot disagree about what is accepted or how large it may be.
 *
 * Neither failure arm is swallowed. A REFUSAL is the server's typed answer —
 * its code and its sentence, verbatim, saying no session was opened — and a
 * transport failure says the upload never landed. Both leave the zone live so
 * the same file can be dropped again.
 */
function SpreadsheetIntake({
  workflowId,
  workflowLabel,
  onOpened,
}: {
  workflowId: string;
  workflowLabel: string;
  onOpened: (intakeSessionId: string) => void;
}) {
  const client = useDashboardClient();
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<{ code: string; message: string } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const upload = useCallback(
    (file: File): void => {
      setBusy(true);
      setRefusal(null);
      setFailure(null);
      void file.arrayBuffer().then(
        (bytes) => client.uploadIntakeFile({
          workflowId,
          fileName: file.name,
          // A browser that cannot name the type sends nothing rather than a
          // guess; the route reads magic bytes and refuses by name either way.
          mediaType: file.type.length > 0 ? file.type : "application/octet-stream",
          bytes,
        }),
      ).then(
        (result: IntakeUploadResult) => {
          setBusy(false);
          if (result.state === "refused") {
            setRefusal({ code: result.code, message: result.message });
            return;
          }
          onOpened(result.session.intakeSessionId);
        },
        (caught: unknown) => {
          setBusy(false);
          setFailure(caught instanceof Error ? caught.message : String(caught));
        },
      );
    },
    [client, onOpened, workflowId],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[var(--ds-space-base)]">
      {refusal !== null && (
        <Refusal title="That file could not be read" code={refusal.code} outcome="no session was opened">
          {refusal.message}
        </Refusal>
      )}
      {failure !== null && (
        <Banner tone="danger" title="The file never reached the server">
          {failure}
        </Banner>
      )}
      {/* The zone GROWS to fill the stage, for the workspace's own reason: it
          is the only act available on this arm, and a thin band floating in an
          empty panel reads as a detail of a screen whose content failed. */}
      <Dropzone
        label={intakeDropzoneLabel(workflowLabel)}
        accept={INTAKE_ACCEPT}
        hint={INTAKE_DROPZONE_HINT}
        busy={busy}
        busyLabel="Reading the file…"
        onFile={upload}
        className="min-h-[var(--ds-h-dialog-dropzone)] flex-1"
      />
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
  onOpenIntake,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** every workflow the boot document serves, with its declared start surface */
  workflows: readonly RunStartWorkflow[];
  /** the Workflow Panel the operator is standing in — the dialog's default */
  panelWorkflowId: string;
  /** echoed from bootstrap; the server matches it against the request identity */
  actorId: string;
  /**
   * D296's handoff: close this dialog and open the intake workspace ON THIS
   * WORKFLOW. The dialog names the workflow rather than assuming the panel's,
   * because the picker beside it is the whole point of "any workflow, from
   * anywhere" and an intake seeded from the panel would map the file's columns
   * onto a workflow the operator did not choose.
   */
  onOpenIntake: (workflowId: string, intakeSessionId: string) => void;
}) {
  const client = useDashboardClient();

  const [workflowId, setWorkflowId] = useState<string>(() => defaultWorkflowId(workflows, panelWorkflowId));
  const [currentStage, setCurrentStage] = useState<RunStartStage>("Input");
  const [method, setMethod] = useState<StartMethod>("typed");
  const initialWorkflow = workflows.find((entry) => entry.workflowId === defaultWorkflowId(workflows, panelWorkflowId));
  const [customizeSteps, setCustomizeSteps] = useState(false);
  const [selectedStepKeys, setSelectedStepKeys] = useState<string[]>(() =>
    initialWorkflow?.steps.filter(({ includedByDefault }) => includedByDefault).map(({ key }) => key) ?? []);
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
    setMethod("typed");
    const nextWorkflow = workflows.find((entry) => entry.workflowId === next);
    setSelectedStepKeys(nextWorkflow?.steps.filter(({ includedByDefault }) => includedByDefault).map(({ key }) => key) ?? []);
    setPriority("interactive");
    setDryRunRequested(false);
    setBrowserMode("headed");
    setCaptureBrowserScreenshots(true);
  }, [workflows]);

  // Opening lands on the panel you are standing in, every time — including the
  // second time, which is why this keys on `open` rather than running once.
  useEffect(() => {
    if (open) selectWorkflow(defaultWorkflowId(workflows, panelWorkflowId));
  }, [open, workflows, panelWorkflowId, selectWorkflow]);

  const workflow = workflows.find((entry) => entry.workflowId === workflowId);

  const inputRun = workflow?.inputRun ?? NO_WORKFLOW_SELECTED;
  const supportsDryRun = inputRun.state === "present" && inputRun.surface.supportsDryRun === true;
  const dryRun = supportsDryRun && dryRunRequested;
  /**
   * D296 — the served method set, and the arm the dialog is on.
   *
   * `method` is state so the tabs can move it, but `activeMethod` is what
   * everything below reads: a selected arm this workflow does not offer is
   * unrepresentable rather than merely unlikely, which is the same rule
   * `reconcileRunStartStage` applies to a stage that stopped existing.
   */
  const methods = useMemo(() => startMethodsOf(workflow), [workflow]);
  const activeMethod: StartMethod = methods.includes(method) ? method : (methods[0] ?? "typed");
  const isHandoff = activeMethod === "spreadsheet";
  const launchStages = useMemo(
    () => runStartStages(customizeSteps, activeMethod),
    [customizeSteps, activeMethod],
  );

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
  const requestFingerprint = startRequestFingerprint({
    workflowId,
    text,
    dryRun,
    browserMode,
    captureBrowserScreenshots,
    priority,
    selectedStepKeys,
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
    setCurrentStage((current) => current === "Confirm" ? "Input" : current);
  }, [requestFingerprint]);

  /**
   * The typed box, so an exit from a settled banner can put the keyboard back
   * where the operator types.
   */
  const typedInputRef = useRef<HTMLTextAreaElement>(null);
  const restoreInputFocusRef = useRef(false);

  useEffect(() => {
    if (currentStage !== "Input" || !restoreInputFocusRef.current) return;
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

  const constants = inputRun.state === "present" ? (inputRun.surface.parser.constants ?? []) : [];
  const stepControlledFields = new Set(
    workflow?.steps.flatMap((step) => step.control.state === "selectable" ? [step.control.inputField] : []) ?? [],
  );
  const visibleConstants = constants.filter((constant) => !stepControlledFields.has(String(constant.field)));

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
        browserMode,
        captureBrowserScreenshots,
        priority,
        ...(customizeSteps ? { selectedStepKeys } : {}),
      });
      // The operator edited the form while this was on the wire, so the server
      // answered a question the form no longer asks and the plan token it
      // carries is already unusable. Landing it would put a proposal for text
      // that has left the box under a primary button that says Start run.
      if (requestFingerprintRef.current !== dispatchedFor) return;
      setPlan(next);
      setResult(null);
      setCurrentStage("Confirm");
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
  }, [browserMode, captureBrowserScreenshots, client, customizeSteps, dryRun, preview, priority, requestFingerprint, selectedStepKeys, workflowId]);

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
    } catch (caught) {
      if (requestFingerprintRef.current !== dispatchedFor) return;
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }, [actorId, client, plan, requestFingerprint]);

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
  const previousStage = adjacentRunStartStage(launchStages, currentStage, "previous");
  const nextStage = adjacentRunStartStage(launchStages, currentStage, "next");
  const optionChanges = [
    ...(priority === "bulk" ? ["Priority: Bulk"] : []),
    ...(dryRun ? ["Dry run: On"] : []),
    `Browser: ${browserMode === "headless" ? "Headless" : "Headed"}`,
    `Browser screenshots: ${captureBrowserScreenshots ? "On" : "Off"}`,
  ];
  const inputSummary = preview.entries.map((entry) => entry.sourceText).join(", ");
  const valuesSummary = visibleConstants.length === 0
    ? "No manual values"
    : visibleConstants.map((constant) => `${constant.field}: ${surfaceValueLabel(constant)}`).join(" · ");

  const changeCustomizeSteps = useCallback((next: boolean) => {
    setCustomizeSteps(next);
    if (!next) {
      setSelectedStepKeys(workflow?.steps.filter(({ includedByDefault }) => includedByDefault).map(({ key }) => key) ?? []);
    } else if (currentStage === "Confirm") {
      setCurrentStage("Steps");
    }
  }, [currentStage, workflow]);

  const advance = useCallback(async (): Promise<void> => {
    if (nextStage === null) return;
    if (nextStage === "Confirm") {
      if (plan === null) await submitPlan();
      else setCurrentStage("Confirm");
      return;
    }
    setCurrentStage(nextStage);
  }, [nextStage, plan, submitPlan]);

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
    restoreInputFocusRef.current = true;
    setPlan(null);
    setResult(null);
    setError(null);
    setCurrentStage("Input");
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
      setCurrentStage("Input");
    }
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={closeAndReset}>
      <DialogContent
        size="lg"
        title="Start a run"
        description={<span className="sr-only">Choose a workflow, configure its start, review the server plan, and confirm.</span>}
        className="h-[min(86dvh,720px)]"
      >
        <div className="flex min-h-0 flex-1">
          <WorkflowPicker
            workflows={workflows}
            value={workflowId}
            onChange={selectWorkflow}
          />

          <DialogBody className="@container flex flex-1 flex-col gap-[var(--ds-space-section)]">
            <Field label="Workflow" className="min-[768px]:hidden">
              <Select value={workflowId} onChange={(event) => selectWorkflow(event.target.value)}>
                {workflows.filter(isStartable).map((candidate) => (
                  <option key={candidate.workflowId} value={candidate.workflowId}>{candidate.label}</option>
                ))}
              </Select>
            </Field>

            {result !== null && (
              <EnqueueResultBanner result={result} onDismiss={returnToInput} onReload={returnToInput} />
            )}
            {error !== null && (
              <Banner tone="danger" title="The request did not complete">{error}</Banner>
            )}

            <ol
              aria-label="Run configuration path"
              className="-mx-[var(--ds-space-loose)] flex flex-wrap items-center gap-[var(--ds-space-base)] border-b border-[color:var(--ds-border)] px-[var(--ds-space-loose)] pb-[var(--ds-space-cozy)]"
            >
              {launchStages.map((stage, index) => (
                <li key={stage.label} aria-current={stage.label === currentStage ? "step" : undefined} className="flex items-center gap-[var(--ds-space-base)]">
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-[var(--ds-h-sm)] shrink-0 items-center justify-center",
                      dsRadius.pill,
                      dsText.micro,
                      dsText.nums,
                      stage.label === currentStage
                        ? "bg-[var(--ds-accent)] text-[color:var(--ds-accent-fg)]"
                        : "bg-[var(--ds-surface-3)]",
                      stage.label !== currentStage && dsFg.muted,
                    )}
                  >
                    {stage.number}
                  </span>
                  <span className={cn(dsText.ui, stage.label === currentStage ? "font-semibold" : dsFg.muted)}>
                    {stage.label}
                  </span>
                  {index < launchStages.length - 1 && <ArrowRight aria-hidden className={cn(dsIcon.sm, dsFg.faint)} />}
                </li>
              ))}
            </ol>

            <section className="flex flex-col gap-[var(--ds-space-snug)]">
              <h3 className={cn(dsText.section, "min-w-0 font-semibold", dsFg.base)}>
                {workflow?.label ?? "No workflow"}
              </h3>
              {workflow?.summary !== undefined && currentStage === "Input" && (
                <p className={cn(dsText.body, dsFg.secondary, "max-w-[74ch]")}>{workflow.summary}</p>
              )}
            </section>

            <div className="flex min-w-0 flex-col gap-[var(--ds-space-loose)]">
              {currentStage === "Input" && (
                <section aria-label="Input" className="flex min-h-0 flex-1 flex-col gap-[var(--ds-space-loose)]">
                  {/* The demo's own condition, verbatim: a strip over a set of
                      one is D186's sample-of-one, so a workflow whose module
                      declares no intake projection draws no tabs at all and
                      renders exactly what it rendered before D296. */}
                  {methods.length > 1 && (
                    <MethodTabs methods={methods} value={activeMethod} onChange={setMethod} />
                  )}
                  {isHandoff ? (
                    <SpreadsheetIntake
                      workflowId={workflowId}
                      workflowLabel={workflow?.label ?? workflowId}
                      onOpened={(intakeSessionId) => {
                        closeAndReset(false);
                        onOpenIntake(workflowId, intakeSessionId);
                      }}
                    />
                  ) : inputRun.state === "present" ? (
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
                </section>
              )}

              {currentStage === "Options" && (
                <section aria-label="Options" className="flex flex-col gap-[var(--ds-space-cozy)]">
                  <div className="flex flex-col gap-[var(--ds-space-loose)]">
                    <div className="grid grid-cols-1 gap-[var(--ds-space-cozy)] @min-[480px]:grid-cols-2">
                      <Checkbox
                        checked={customizeSteps}
                        onCheckedChange={(next) => changeCustomizeSteps(next === true)}
                        label="Customize steps"
                        description="Review the workflow and change any optional steps. Required steps stay locked."
                      />
                      {supportsDryRun && (
                        <StartFlagControl label="Dry run" checked={dryRun} onChange={setDryRunRequested} />
                      )}
                      <StartFlagControl
                        label="Capture browser screenshots"
                        checked={captureBrowserScreenshots}
                        onChange={setCaptureBrowserScreenshots}
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-[var(--ds-space-cozy)] @min-[480px]:grid-cols-2">
                      {visibleConstants.map((constant) => (
                        <StartChoiceControl key={constant.field} constant={constant} reason="Fixed by this workflow." />
                      ))}
                      {workflow !== undefined && (
                        <LockedFact label="Active-run policy" value={ENQUEUE_POLICY_MEANING[workflow.enqueue]} reason={ENQUEUE_POLICY_REASON} />
                      )}
                      <Field label="Priority" description="Bulk work yields whenever interactive work needs the browser.">
                        <Select value={priority} onChange={(event) => setPriority(event.target.value === "bulk" ? "bulk" : "interactive")}>
                          <option value="interactive">Interactive</option>
                          <option value="bulk">Bulk</option>
                        </Select>
                      </Field>
                      <Field label="Browser mode">
                        <Select value={browserMode} onChange={(event) => setBrowserMode(event.target.value === "headed" ? "headed" : "headless")}>
                          <option value="headless">Headless</option>
                          <option value="headed">Headed</option>
                        </Select>
                      </Field>
                    </div>
                  </div>
                </section>
              )}

              {currentStage === "Steps" && workflow !== undefined && (
                <section aria-labelledby="run-start-steps" className="flex flex-col gap-[var(--ds-space-cozy)]">
                  <div className="flex flex-wrap items-baseline justify-between gap-[var(--ds-space-base)]">
                    <h4 id="run-start-steps" className={cn(dsText.title, "font-semibold", dsFg.base)}>Steps</h4>
                    <span className={cn(dsText.meta, dsText.nums, dsFg.muted)}>
                      {selectedStepKeys.length} of {workflow.steps.length} included
                    </span>
                  </div>
                  <ul className="divide-y divide-[color:var(--ds-border)] border-y border-[color:var(--ds-border)]">
                    {workflow.steps.map((step) => {
                      const selected = selectedStepKeys.includes(step.key);
                      return (
                        <li key={step.key} className="py-[var(--ds-space-cozy)]">
                          <Checkbox
                            checked={selected}
                            disabled={step.control.state === "required"}
                            onCheckedChange={(next) => {
                              if (step.control.state === "required") return;
                              setSelectedStepKeys((current) => next === true
                                ? [...current, step.key]
                                : current.filter((key) => key !== step.key));
                            }}
                            label={step.label}
                            description={step.control.state === "required" ? step.control.reason : "Optional for this workflow."}
                          />
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              {currentStage === "Confirm" && plan !== null && (
                <section aria-labelledby="run-start-confirm" className="flex flex-col gap-[var(--ds-space-cozy)]">
                  <div className="flex flex-wrap items-center justify-between gap-[var(--ds-space-base)]">
                    <h4 id="run-start-confirm" className={cn(dsText.title, "font-semibold", dsFg.base)}>Confirm</h4>
                    <RunFlagChips dryRun={plan.dryRun} priority={plan.priority} />
                  </div>
                  <Well className="p-[var(--ds-space-cozy)]">
                    <KeyValueList
                      className="grid-cols-[max-content_minmax(0,1fr)] [&_dd]:overflow-visible [&_dd]:whitespace-normal [&_dd]:break-words [&_dd]:text-clip"
                      items={[
                        { key: "Workflow", value: workflow?.label ?? plan.workflowId },
                        { key: "Input", value: inputSummary },
                        { key: "Creates", value: plan.planned.length === 1 ? "1 run" : `${String(plan.planned.length)} runs` },
                        { key: "Steps", value: customizeSteps ? `${String(selectedStepKeys.length)} of ${String(workflow?.steps.length ?? 0)} included` : "Default workflow" },
                        { key: "Values", value: valuesSummary },
                        { key: "Options", value: optionChanges.length > 0 ? optionChanges.join(" · ") : "Defaults retained" },
                        { key: "Safety", value: workflow === undefined ? "Workflow unavailable" : ENQUEUE_POLICY_MEANING[workflow.enqueue] },
                      ]}
                    />
                  </Well>
                  <PlanPreview plan={plan} />
                  <PlanRefusals refused={plan.refused} />
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
                // `{label} v{n}` — the demo's own footer item 1
                // (`DemoRunStart.tsx:946`). The version is what separates two
                // runs of one workflow started a descriptor bump apart, and
                // this dialog is the last screen before one is enqueued.
                workflow === undefined ? undefined : `${workflow.label} ${versionTag(workflow.version)}`,
                isHandoff
                  ? undefined
                  : currentStage === "Input"
                  ? blockedReason ?? undefined
                  : currentStage === "Confirm" && plan !== null
                    ? `${String(plan.planned.length)} to create`
                    : undefined,
              ].filter((item): item is string => item !== undefined)}
            />
          }
        >
          {previousStage !== null && (
            <Button variant="secondary" onClick={() => setCurrentStage(previousStage)}>Back</Button>
          )}
          <Button variant="secondary" onClick={() => closeAndReset(false)}>
            Cancel
          </Button>
          {isHandoff ? (
            /* D298 — the spreadsheet arm has NO primary. Its one act is the
               drop, and the button that used to sit here only led to the zone
               that is now on screen. A primary beside a dropzone is either a
               second way to do the same thing or a dead control; `Cancel`
               alone is the honest footer. */
            null
          ) : currentStage === "Confirm" && plan !== null ? (
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
              disabled={busy || (currentStage === "Input" && blockedReason !== null) || nextStage === null}
              onClick={() => void advance()}
            >
              Next
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
  onOpenIntake,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflows: readonly RunStartWorkflow[];
  panelWorkflowId: string;
  actorId: string;
  onOpenIntake: (workflowId: string, intakeSessionId: string) => void;
}) {
  return (
    <RunStartDialog
      open={open}
      onOpenChange={onOpenChange}
      workflows={workflows}
      panelWorkflowId={panelWorkflowId}
      actorId={actorId}
      onOpenIntake={onOpenIntake}
    />
  );
}
