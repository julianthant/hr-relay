/**
 * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * src/dashboard/components/dev/rebuild-demo/DemoQueue.tsx
 *
 * The Queue Panel: attention bands, the three row types, ONE member shape at
 * every count, and the row rhythm DESIGN.md mandates (one grid, one gap, a
 * footer that wraps rather than truncates).
 *
 * WHAT CHANGED IN THE PORT. The demo rendered a fixture row object that knew
 * its own facts, chips, links, records and explanations. Here every row is a
 * `QueueSurfaceWire` — a finished server read model — and the component is a
 * pure renderer of it (ref frontend-backend-integration §0.1/§0.4): it classifies nothing, counts no
 * authoritative total, and derives no availability. Three consequences worth
 * knowing before editing:
 *
 *  - **Status is served.** `dsStatusOf` is the ONE wire→ds mapping and a status
 *    is drawn only through `StatusBadge`/`StatusDot`.
 *  - **Actions are served.** Nothing here decides a row is retryable; the
 *    surface renders exactly the `ActionDescriptorWire[]` it is handed, so the
 *    honest default (the 1g BFF serves none yet) is a row with no command
 *    controls at all.
 *  - **Absence is served too.** A `subtitle`/`liveMessage` that is absent
 *    carries the server's reason, and the row shows that reason as a fact about
 *    this run in its ⓘ rather than inventing a value or silently dropping it.
 *
 * Bands, member ordering and elapsed formatting are the only derivations, and
 * each is a fixed map over a closed served enum or a display-only subtraction
 * of two served instants — never a second opinion about what a run IS.
 */
import { memo } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, ArrowRight, ArrowUpRight, CheckCircle2, ChevronDown, ChevronUp, FileText, Info } from "lucide-react";
import { cn } from "../lib/utils.js";
import {
  Chip,
  IconButton,
  MetaLine,
  Popover,
  PopoverContent,
  PopoverTrigger,
  dsBorder,
  dsClip,
  dsFocus,
  dsIcon,
  dsMotion,
  dsRadius,
  dsSize,
  dsSurface,
  dsText,
} from "../ds/ui.js";
import type { ActionDescriptorWire } from "../../domain/dashboard/actions.js";
import { isTerminalQueueStatus } from "../../domain/dashboard/projection.js";
import {
  FooterActions,
  OutcomeActionButton,
  RowContextMenu,
  type DashboardActionHandler,
} from "./actions.js";
import { dayLabel, fmtClock, fmtElapsed, plural, runTiming } from "./format.js";
import { testInstanceHazardTitle, testInstanceSystems } from "./test-instance-hazard.js";
import { StatusBadge } from "./status.js";
import {
  PROPOSED_STATUS,
  dsStatusOf,
  statusAccessibleName,
  statusText,
  type ProposedStatus,
} from "./status-model.js";
import type { QueueSortKey } from "./queue-model.js";
import { MEMBER_WELL_LINES } from "./layout-metrics.js";
import {
  BAND_LABEL,
  BAND_ORDER,
  MEMBER_NAME_TOUCH_TARGET,
  MEMBER_TOUCH_TARGET,
  MEMBER_TOUCH_TARGET_HOST,
  ROW_INFO_TOUCH_LINE,
  ROW_INFO_TOUCH_TARGET,
  type LinkedRunWire,
  type MemberSurfaceWire,
  type OperationSurfaceWire,
  type PipelineStep,
  type QueueSurfaceWire,
  bandOf,
  canViewAllMembers,
  checkedByYouCount,
  orderMembers,
  partition,
  queueGateAge,
  queueRowAccessibleName,
  queueRowTitle,
  queueRowTitleTooltip,
  rowInfoFacts,
  sortQueueBand,
  useAttentionAnnounce,
} from "./queue-model.js";

/* ── the queue's client-owned view state (ref frontend-backend-integration §4) ─────────────────────── */

export interface QueueViewState {
  /** the row the detail panel is showing */
  selectedRunId?: string;
  /**
   * Which member WELLS are open to their tall shape. This answers "how many of
   * them fit before it scrolls", never "are the members drawn at all" — every
   * group keeps its people on screen.
   */
  openWells: ReadonlySet<string>;
  /** bulk-selection mode: checkboxes on top-level rows */
  selectMode?: boolean;
  bulkIds?: ReadonlySet<string>;
  /** Ephemeral operator triage. This is browser-local context, never a served
   * member outcome or durable evidence; reload starts with an empty set. */
  checkedIds?: ReadonlySet<string>;
  /**
   * The workflow this queue is scoped to. A row of that workflow does not
   * reprint its label — the panel header already said it. Left undefined by a
   * surface that mixes workflows, where the chip is the only thing naming the
   * owner.
   */
  panelWorkflowId?: string;
  /**
   * Display-only "now", from the app's bootstrap-calibrated clock (ref frontend-backend-integration §4,
   * last row). Passed in rather than read here so elapsed values are a pure
   * function of served instants — which is also what makes a parity capture
   * of the same state byte-identical twice.
   */
  nowIso: string;
}

export interface QueueHandlers {
  onSelect: (runId: string) => void;
  /** every command control on a row goes through here — see `./actions.js` */
  onAction?: DashboardActionHandler;
  /** grow this row's member well from 5 lines to 20, or back */
  onToggleWell?: (runId: string) => void;
  /**
   * The dedicated roster route. Rendered ONLY when supplied: the full-list
   * surface is a served People section (deferred past 1i), and a disclosure
   * that travels nowhere is worse than no disclosure.
   */
  onOpenRoster?: (runId: string) => void;
  /** add/remove a row from the bulk target set */
  onToggleBulk?: (runId: string) => void;
  /** Mark a loaded member checked by you. This has no authority effect. */
  onToggleChecked?: (runId: string) => void;
  /**
   * Jump to the run that delegated this one — the panel switch AND the
   * selection, because a parent can belong to another workflow and selecting it
   * without moving the panel would open a run the queue beside it cannot show.
   */
  onOpenParent?: (runId: string) => void;
  /**
   * Jump to a run this row DELEGATED TO (D231's `linkedRuns[]`). Same shape as
   * `onOpenParent` and separate from it on purpose: the wire hands the whole
   * link — its workflow, its panel kind and its live status — so the route does
   * not have to find the target in the day payload first, which is exactly what
   * fails when the child ran on another day.
   */
  onOpenLinked?: (link: LinkedRunWire) => void;
}

/**
 * What a row needs to draw a route back to its parent: the parent's own
 * identity and status, resolved from the SERVED day projection. It answers
 * `undefined` for a parent the day does not hold (another day, or paged out),
 * and the chip is then not drawn — never a chip whose label was guessed.
 */
export type QueueParentLookup = (
  parentRunId: string,
) => { runId: string; title: string; workflowLabel: string; status: ProposedStatus } | undefined;

/** How a surface reaches its served actions. The default is honest emptiness. */
export type QueueActionsOf = (surface: QueueSurfaceWire) => readonly ActionDescriptorWire[];

const NO_ACTIONS: QueueActionsOf = () => [];
const NO_CHECKED_IDS: ReadonlySet<string> = new Set();

/* the band ordering and its sort vocabulary live in `queue-model.ts` — see the note there */
export type { QueueSortKey };

/* ── small row pieces ────────────────────────────────────────────────────── */

/**
 * The served pipeline, as dots.
 *
 * The state vocabulary is the wire's own closed enum; each state gets a token,
 * and `active` is the only one that moves — the same "one spinning thing"
 * discipline the Running status keeps.
 */
const STEP_TONE: Record<PipelineStep["state"], string> = {
  done: "bg-[var(--ds-success-mark)]",
  active: "bg-[var(--ds-status-running-mark)] animate-pulse motion-reduce:animate-none",
  pending: "bg-[var(--ds-border)]",
  failed: "bg-[var(--ds-danger)]",
  blocked: "bg-[var(--ds-status-waiting-mark)]",
  skipped: "bg-[var(--ds-border-subtle)]",
  // D268 — the pipeline's own `cancelled` arm, in the same hue the run-detail
  // timeline draws a cancelled step: one span, one word, one colour.
  cancelled: "bg-[var(--ds-status-cancelled-mark)]",
};

/**
 * One step, as the dots' hover sentence reads it.
 *
 * Ported from the demo's own `MicroSteps` title
 * (`DemoQueue.tsx:273`, `${label}${durationSec ? ` ${fmtElapsed()}` : ""} (${state})`)
 * — a duration is printed only when the server measured one, and an unmeasured
 * step says its state alone rather than ` 0s`, which would be a measurement.
 *
 * `executions` has no demo counterpart because the demo has no gate resume:
 * ref dashboard-surfaces serves it only at two or more (D214/D225), and a node that ran twice
 * across a park spent BOTH intervals, so the count is what keeps `1m 40s` from
 * reading as one long try.
 */
function stepTitle(step: PipelineStep): string {
  const duration = step.durationSec === undefined ? "" : ` ${fmtElapsed(step.durationSec)}`;
  const executions = step.executions === undefined ? "" : ` ×${String(step.executions)}`;
  return `${step.label}${duration}${executions} (${step.state})`;
}

function MicroSteps({ pipeline }: { pipeline: QueueSurfaceWire["pipeline"] }) {
  if (pipeline.length === 0) return null;
  return (
    <span
      // Same height as StatusBadge `sm` / the title row — centres the dots on
      // the name instead of leaving them top-aligned in a taller chip stack.
      className="inline-flex h-[var(--ds-h-xs)] shrink-0 items-center gap-[3px]"
      title={pipeline.map(stepTitle).join(" · ")}
      aria-label={`Steps: ${pipeline.map((step) => `${step.label} ${step.state}`).join(", ")}`}
    >
      {pipeline.map((step) => (
        <span key={step.id} aria-hidden className={cn("h-1.5 w-2.5 rounded-full", STEP_TONE[step.state])} />
      ))}
    </span>
  );
}

/**
 * ONE shell for every chip in a row header. Tone is the only thing a caller
 * chooses — six hand-rolled copies of this span is how a queue ends up with six
 * chip heights on one line.
 */
type RowChipTone = "neutral" | "info" | "warning" | "rehearsal";

const ROW_CHIP_TONE: Record<RowChipTone, string> = {
  neutral: "border-[color:var(--ds-recess-border)] bg-[var(--ds-recess-bg)] text-[color:var(--ds-recess-fg-quiet)]",
  info: "border-[color:var(--ds-info-border)] bg-[var(--ds-info-bg)] text-[color:var(--ds-info-fg)]",
  warning: "border-[color:var(--ds-status-waiting-border)] bg-[var(--ds-status-waiting-bg)] text-[color:var(--ds-status-waiting-fg)]",
  /*
   * THE FOURTH TONE (D232), and the whole reason a fifth hue was bought.
   *
   * The demo names this tone `violet` and binds it to `--ds-status-parked-*`,
   * which every theme in this tree derives from AMBER — so on screen the demo's
   * rehearsal chip is the same colour as the `△ N` warning chip that can sit
   * beside it, and one step off the `test` chip on its other side. Those two
   * neighbours are exactly the pair a glance has to separate, so this binds the
   * real violet the demo's tone NAME describes rather than the amber its tokens
   * resolve to. It is the one deliberate colour deviation on this row.
   */
  rehearsal: "border-[color:var(--ds-rehearsal-border)] bg-[var(--ds-rehearsal-bg)] text-[color:var(--ds-rehearsal-fg)]",
};

const rowChip = (tone: RowChipTone, extra?: string): string =>
  cn(
    // A chip is a single-line token at every width: it truncates INSIDE its
    // border rather than wrapping outside it, and `text-ellipsis` is the half
    // that says something was cut.
    "inline-flex shrink-0 items-center border text-ellipsis",
    dsClip.token,
    "h-[var(--ds-h-xs)] gap-[var(--ds-space-tight)] px-[var(--ds-space-snug)]",
    dsRadius.sm,
    dsText.micro,
    dsText.flush,
    ROW_CHIP_TONE[tone],
    extra,
  );

function HeaderChips({
  surface,
  status,
  nowIso,
}: {
  surface: QueueSurfaceWire;
  status: ProposedStatus;
  /** the bootstrap-calibrated instant every elapsed on this panel measures against */
  nowIso: string;
}) {
  const testSystems = testInstanceSystems(surface.resolvedInstances);
  /**
   * D12 — `Waiting on you · 10m`. The SERVED gate instant against the same
   * calibrated `nowIso` the row's elapsed uses, so the two clocks on one card
   * cannot disagree. Display-only arithmetic: the server dates the gate from
   * the gate's own record and never from `updatedAt`, which is what keeps an
   * aging gate from rendering young. The fold is shared with the row's own
   * accessible name (`queueGateAge`), so the pill and the sentence a screen
   * reader hears are the same measurement.
   */
  const gateAge = queueGateAge(surface, nowIso);
  return (
    <>
      {/* A run against a TEST instance can never be mistaken for a real filing,
          and a rehearsal says so before you read its receipt. */}
      {testSystems.length > 0 && (
        <span
          title={testInstanceHazardTitle(testSystems)}
          className={rowChip("info", cn(dsText.caps, "tracking-[var(--ds-tracking-caps)]"))}
        >
          test
        </span>
      )}
      {/*
        DRY RUN — the rehearsal flag, in the demo's own slot and words
        (`DemoQueue.tsx:437`, *"this rehearsal reads the systems and writes
        nothing"*).

        It is SERVED (D6 — `dryRun` is on the envelope, so there is no absent
        arm and no inference), and it sits immediately after `test` because the
        two are the row's two hazards and are read together. A rehearsal that
        renders identically to a real filing is the cheapest possible way to
        read a dry run as a submitted transaction, which is why this is a chip
        on the row rather than a fact behind the ⓘ.
      */}
      {surface.dryRun && (
        <span
          title="Dry run — this rehearsal reads the systems and writes nothing."
          className={rowChip("rehearsal", cn(dsText.caps, "tracking-[var(--ds-tracking-caps)]"))}
        >
          dry run
        </span>
      )}
      {/*
        △ N — the warning count, beside the status pill.

        Operator, quoted in the demo: *"if there is warning add the triangle
        with the n number of warnings."* It is also what breaks the D22 hue-only
        collision on screen: `verifiedDone` and `doneWarnings` both draw the
        word `Done`, and the triangle is the non-colour half of telling them
        apart.

        The count is SERVED (`QueueBaseFields.warnings`) — the run's evidence
        receipt's own warning set, titled with the first warning's sentence.

        The absent arm keeps the older "at least one" reading, and only for a
        row the server settled as `partial` (→ `doneWarnings`): that row
        finished with warnings by definition, so `1` is the smallest true
        statement about it, and dropping the triangle would take D126's
        argument from three visible channels to two on exactly the rows the
        argument is about. Every other status draws nothing when the count is
        absent — an unsettled run has no warning set, and a triangle on one
        would be a number about a real HR run that nothing produced.
      */}
      {(surface.warnings.state === "present" || status === "doneWarnings") && (
        <span
          title={surface.warnings.state === "present" ? surface.warnings.first : "Finished with warnings"}
          className={rowChip("warning")}
        >
          <AlertTriangle aria-hidden className={dsIcon.sm} />
          {surface.warnings.state === "present" ? surface.warnings.count : 1}
        </span>
      )}
      {/* Progress dots then the status pill — both on the TITLE row's right
          edge. The dots sit in the same `--ds-h-xs` box as the badge so they
          centre on the name rather than hugging the top of the chip line. */}
      {status === "running" && surface.surfaceKind !== "operation" && <MicroSteps pipeline={surface.pipeline} />}
      <StatusBadge status={status} hideIcon {...(gateAge === undefined ? {} : { age: gateAge })} />
    </>
  );
}

/**
 * The four panel kinds, in the demo's own words.
 *
 * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * `demo-catalog.ts:418-430` (`PANEL_KIND_SPECS` names + `PANEL_EXPLANATION`).
 * This is FRONTEND COPY, the same move R2 made for the category table: the
 * sentence is a fact about what this product's panel does with a kind, not a
 * fact about the run, so the server serves the closed `panelKind` enum and the
 * frontend owns the words. A new arm on the enum fails `tsc` here rather than
 * rendering a hole.
 *
 * The demo's other two sentences (`doing` / `why`) come off its row-VARIANT
 * naming layer, which needs a wire this projection does not serve — they stay
 * on the wire-hookup ledger (R3 finding 16) rather than being invented here.
 */
const PANEL_KIND_NAME: Record<QueueSurfaceWire["panelKind"], string> = {
  run: "Run Panel",
  review: "Review Panel",
  group: "Group Panel",
  member: "Member Panel",
};

const PANEL_EXPLANATION: Record<QueueSurfaceWire["panelKind"], string> = {
  run: "Opening it shows the log stream, every value the run read or wrote, and the receipt once it ends.",
  review: "Opening it starts the review — the scanned page beside the fields read from it, one person at a time.",
  group: "Opening it lists the people it holds, attention first, and you can open any one of them from there.",
  member: "Opening it walks the set — previous, next, and a checked mark so you keep your place in it.",
};

/**
 * The ⓘ on a queue row.
 *
 * IT IS ALWAYS DRAWN. It used to render only when the server had reported an
 * absence, so the affordance appeared and disappeared down the column and an
 * operator learned it was not there — the demo's own rule is that *quiet at
 * rest is not the same as absent* (R3 finding 16). Two things are inside it,
 * and both are honest:
 *
 *  - **What opening the row will show**, from the SERVED `panelKind` through
 *    the frontend vocabulary above. The field was already on the wire and read
 *    by nothing.
 *  - **What this run did not report** — an absent subtitle or live message
 *    arrives with the server's own reason, and that reason is a fact about THIS
 *    run, which is the one thing beyond the panel sentence the ⓘ may hold.
 *  - **What a present fact SAYS IN FULL** — the fold that composes both lives
 *    in `queue-model.ts` (`rowInfoFacts`), because a fact drawn as a chip is
 *    clipped by design and this is the row's only hover-free route to the whole
 *    value.
 *
 * It EXPLAINS; it never HIDES. Nothing load-bearing (status, counts, error,
 * trace, every command) moves in here from the row — it is the same values,
 * unclipped, in the place DESIGN.md sanctions for detail.
 */

function RowInfo({
  surface,
  workflowLabel,
}: {
  surface: QueueSurfaceWire;
  workflowLabel: string;
}) {
  const facts = rowInfoFacts(surface);
  const panelName = PANEL_KIND_NAME[surface.panelKind];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton
          size="xs"
          label={`What is this row? — ${panelName}`}
          icon={<Info aria-hidden className={dsIcon.sm} />}
          // Both stopped: the card root is itself a button, so without these a
          // press on the ⓘ also selects the row underneath it.
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") event.stopPropagation();
          }}
          className={cn(
            "text-[color:var(--ds-fg-faint)] hover:text-[color:var(--ds-fg)] data-[state=open]:text-[color:var(--ds-fg)]",
            // 20px of paint, and the row's only hover-free route to a clipped
            // fact's whole value; the line it sits on grows with it
            // (`ROW_INFO_TOUCH_LINE`), or the card's clip takes the height back.
            ROW_INFO_TOUCH_TARGET,
          )}
        />
      </PopoverTrigger>
      {/* `md`, not `lg`: a 380px surface in a 380px queue column is
          collision-shifted on every open, which moves the point the entrance
          scales out of. */}
      <PopoverContent title={panelName} side="bottom" align="start" width="md">
        <div className="flex flex-col gap-[var(--ds-space-base)]">
          {/*
            NO PRODUCT EXPLANATION HERE, and that is the operator's own ruling:
            *"dont put unnecessary explanations in there. just put the subtitle
            and other important stuff related to the run."*

            Two paragraphs used to lead this surface — what opening a panel of
            this KIND shows, and what this row's containment means. Both are
            frontend copy about the PRODUCT: identical on every row that shares
            a `panelKind`, and therefore worth exactly one read ever. Printed
            above the one thing an operator opened the ⓘ to see, they are what
            it costs to reach that thing. `PANEL_EXPLANATION` survives one map
            up because `LinkedRunChip` still titles itself with it — a chip
            pointing at a panel you have NOT opened is the one place the
            sentence is news.

            What is left is this run's own facts, and nothing that is on the
            row already.
          */}
          {facts.map((fact) => (
            <p
              key={`${fact.state}:${fact.label}`}
              className={cn(dsText.body, "leading-relaxed text-[color:var(--ds-fg-secondary)]")}
            >
              <span className="font-semibold text-[color:var(--ds-fg)]">{fact.label}: </span>
              {fact.state === "present" ? (
                /* A PRESENT fact is the row's chip, UNCLIPPED — `break-words`
                   rather than a second truncation, following
                   `intake.tsx`'s `IdentifierPopover`: a popover that clipped
                   the value again would be the hover surface's failure moved
                   somewhere quieter. Monospace, because it is the same token
                   the chip draws. */
                <span className={cn(dsText.nums, "break-words text-[color:var(--ds-fg)]")}>{fact.text}</span>
              ) : (
                fact.text
              )}
            </p>
          ))}
          <MetaLine items={[workflowLabel, surface.traceId]} tone="faint" />
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The subline is TEXT ONLY, and it is the server's `liveMessage` — the one
 * sentence the projection authors about what this run is doing or why it
 * stopped. Its tone follows the status; a run whose message is absent has no
 * subline rather than a manufactured one.
 */
const SUBLINE_TONE: Record<ProposedStatus, string> = {
  waiting: "text-[color:var(--ds-status-waiting-fg)]",
  failed: "text-[color:var(--ds-status-failed-fg)]",
  parked: "text-[color:var(--ds-status-parked-fg)]",
  running: "text-[color:var(--ds-status-running-fg)]",
  queued: "text-[color:var(--ds-fg-muted)]",
  verifiedDone: "text-[color:var(--ds-fg-muted)]",
  doneWarnings: "text-[color:var(--ds-fg-muted)]",
  cancelled: "text-[color:var(--ds-fg-muted)]",
};

/**
 * The row's FOOTER — the run's provenance line and its controls.
 *
 * The meta zone is ONE WRAPPING provenance line at the row's own indent, and
 * the controls are a sibling pinned top-right. When a run carries a trace, a
 * subtitle and an elapsed, all three stay readable — the demo's production
 * predecessor packed them onto one line and `truncate`d whatever lost, which at
 * a 400px queue rendered a trace id cut to a single character.
 */
function RowFooterLine({
  surface,
  actions,
  onAction,
  nowIso,
}: {
  surface: QueueSurfaceWire;
  actions: readonly ActionDescriptorWire[];
  onAction?: DashboardActionHandler;
  nowIso: string;
}) {
  // Elapsed is display-only arithmetic over two SERVED instants (ref frontend-backend-integration §4).
  //
  // The second instant is the whole point. A queued run has started nothing,
  // so it shows no timer. A run still in flight shows live elapsed against
  // `now`. A FINISHED run shows what it took — `endedAt − startedAt` — because
  // `now − startedAt` answers a question nobody asked of a settled run and
  // grows forever: the live exit run displayed 2h 47m for ~14.5 minutes of
  // execution (D124). A terminal row with no served end instant says the
  // duration is unknown and names why; it never falls back to `now`.
  const timing = runTiming(surface, nowIso, isTerminalQueueStatus);
  return (
    <div
      className={cn(
        // THE recessed plane: a fill, no line.
        "flex items-start gap-[var(--ds-space-base)] border-t px-[var(--ds-space-cozy)] py-[var(--ds-space-tight)]",
        dsBorder.subtle,
        "bg-[var(--ds-recess-bg)]",
      )}
    >
      <div
        className={cn(
          dsText.meta,
          dsText.nums,
          "flex min-h-[var(--ds-h-sm)] min-w-0 flex-1 flex-wrap items-center",
          "gap-x-[var(--ds-space-base)] gap-y-[var(--ds-space-hair)] text-[color:var(--ds-fg-muted)]",
        )}
      >
        <span className="whitespace-nowrap">{fmtClock(surface.startedAt)}</span>
        {/*
          #N — the run's ATTEMPT, in the demo's own chip slot
          (`DemoQueue.tsx:709`). The operator ruled the number here is the
          attempt — how many times this item has been run — not the run's
          ordinal within its workflow. `#1` is the ordinary case and is still
          drawn, because the demo draws it on every row and a slot that appears
          only on re-runs would shift the trace id sideways between rows.

          The workflow ordinal (`runNumber`) is context, not provenance; it
          moved into the ⓘ (`rowInfoFacts`), whole, where its absence was
          already recorded (D230/D133).
        */}
        <span
          title={surface.attempt > 1 ? `Attempt ${String(surface.attempt)} of this item` : "First attempt"}
          className={cn(
            "inline-flex shrink-0 items-center border px-[var(--ds-space-tight)] whitespace-nowrap",
            "h-[var(--ds-h-xs)]",
            dsRadius.sm,
            "border-[color:var(--ds-recess-border)] bg-transparent",
          )}
        >
          #{surface.attempt}
        </span>
        {/* The trace id is the run's NAME in every log, every receipt and every
            support conversation, so it is the last thing that may be cut. It is
            `nowrap`: if the line runs out, the SEGMENTS AFTER IT wrap. It is
            plain text in the band's secondary ink (`DemoQueue.tsx:715`) — the
            chip beside it is the only outlined segment on the line. */}
        <span className="whitespace-nowrap text-[color:var(--ds-fg-secondary)]" title={surface.traceId}>
          {surface.traceId}
        </span>
        {timing !== undefined && (
          <span className="whitespace-nowrap" {...(timing.title === undefined ? {} : { title: timing.title })}>
            {timing.text}
          </span>
        )}
        {/*
          THE SUBTITLE IS NOT HERE, and its absence is the rule.

          This line is PROVENANCE — when the run started, which run it is,
          which trace names it, how long it took. The demo's own fact set is
          those four and nothing else (`DemoQueue.tsx:698-717`; its `subtitle`
          IS the trace, `se-140211-9f3a`, which is why it has no fifth
          segment). `subtitle` is a different KIND of fact: across the whole
          product it is the workflow's own name, a start option, the filer, or
          a re-read ordinal with the operator's free-text reason
          (each `descriptor.ts`'s `presentation.subtitle`). None of those
          is provenance, and one of them is unbounded prose — a 200-character
          ceiling on `reRead.reason` alone.

          Two treatments were tried here and both were wrong the same way:
          `nowrap` let the card's `overflow-hidden` clip it silently, and
          `break-words` obeyed DESIGN.md's *"A row footer's facts WRAP; they
          never truncate"* literally and turned a one-line footer into a
          FOUR-line one, with `took 24m 48s` stranded under two lines of prose.
          That rule is stated over four short tokens; applying it to a sentence
          applies it to something it never covered. Truncating instead only
          moved the damage somewhere quieter.

          So the segment is GONE, on the operator's rule: the row surface
          carries what the run PRODUCED — status, outcome facts, warnings,
          timing, trace — and context about how the run came to BE lives in the
          ⓘ. That is this file's own charter for the ⓘ read from the other
          side: nothing load-bearing moves INTO it, and a fact that is not
          load-bearing need not be on the row at all. `rowInfoFacts` carries
          the present subtitle there, unclipped.

          What it buys, and why it beats every truncation: the footer can no
          longer GROW. Its four segments are bounded by construction, so no
          descriptor can author a row that reflows by writing a longer string.
        */}
      </div>
      {/* The frequent commands, inline. The full set is one right-click away —
          there is no `⋯`, because a button whose only job is to admit there are
          more buttons is a slot spent on every row in the queue. */}
      <div className="flex shrink-0 items-center gap-[var(--ds-space-hair)] pt-[var(--ds-space-hair)]">
        <FooterActions
          actions={actions}
          target={{ runId: surface.runId, expectedVersion: surface.rowRevision }}
          {...(onAction === undefined ? {} : { onAction })}
        />
      </div>
      <span className="sr-only">{`Right-click or press m for every command on ${queueRowTitle(surface)}`}</span>
    </div>
  );
}

/**
 * The member line's column template.
 *
 * THREE columns, not the demo's four: the fourth held each member's EID, and
 * the queue wire serves no per-member identifier beyond its run id — a column
 * of run ids is not the column the operator was reading. Its leading track is
 * the card's own `--ds-w-row-indent`, which is what puts a member's NAME on the
 * same x as the card's TITLE and its status glyph under the card's own.
 */
const MEMBER_GRID = "grid grid-cols-[var(--ds-w-row-indent)_minmax(0,1fr)_var(--ds-w-member-detail)]";

/** Shared horizontal inset for every row inside the member mini-table. */
const MEMBER_WELL_PAD = "px-[var(--ds-space-snug)]";

/**
 * A group's served rollup, as a tally strip.
 *
 * EXACTLY the three numbers the wire authorises — `total`, `terminal`,
 * `failed`. The demo read an eight-status tally off its fixture store; a
 * rollup of three cannot produce that without inventing five, so the strip
 * says what it knows. Per DESIGN.md a count that hits zero DIMS rather than
 * disappearing, so the eye does not have to re-scan the strip between ticks.
 */
function RollupStrip({ rollup }: { rollup: OperationSurfaceWire["memberRollup"] }) {
  const done = PROPOSED_STATUS.verifiedDone;
  const failed = PROPOSED_STATUS.failed;
  const DoneIcon = done.icon;
  const FailedIcon = failed.icon;
  return (
    <>
      <span
        className={cn("inline-flex shrink-0 items-center gap-[var(--ds-space-tight)] whitespace-nowrap", dsText.flush)}
        title={`${rollup.terminal} of ${rollup.total} members have finished`}
        aria-label={`${rollup.terminal} of ${rollup.total} finished`}
      >
        <DoneIcon
          aria-hidden
          className={cn(dsIcon.sm, "shrink-0", rollup.terminal === 0 ? "text-[color:var(--ds-fg-faint)]" : done.iconClass)}
        />
        <span
          className={cn(
            dsText.nums,
            "font-medium",
            rollup.terminal === 0 ? "text-[color:var(--ds-fg-faint)]" : done.soloTone,
          )}
        >
          {rollup.terminal}/{rollup.total}
        </span>
      </span>
      <span
        className={cn("inline-flex shrink-0 items-center gap-[var(--ds-space-tight)] whitespace-nowrap", dsText.flush)}
        title={`${rollup.failed} of ${rollup.total} members failed`}
        aria-label={`${rollup.failed} failed`}
      >
        <FailedIcon
          aria-hidden
          className={cn(dsIcon.sm, "shrink-0", rollup.failed === 0 ? "text-[color:var(--ds-fg-faint)]" : failed.iconClass)}
        />
        <span
          className={cn(
            dsText.nums,
            "font-medium",
            rollup.failed === 0 ? "text-[color:var(--ds-fg-faint)]" : failed.soloTone,
          )}
        >
          {rollup.failed}
        </span>
      </span>
    </>
  );
}

/**
 * THE WELL. One container for a row's people.
 *
 * IT IS AN OUTLINE, NOT A HOLE — the well sits ON the card plane and is
 * separated by its EDGE, so the lines inside it are the content and the
 * container is a frame around them rather than a second surface underneath.
 * Only the person lines scroll, and that region clips on a LINE, never through
 * one — both heights are `N × line + (N−1) hairlines`.
 */
function MemberWell({
  children,
  open,
  header,
  footer,
}: {
  children: ReactNode;
  open?: boolean;
  header?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex flex-col overflow-hidden border border-x-0 border-[color:var(--ds-border)] bg-[var(--ds-surface-1)]">
      {header}
      <div
        className={cn(
          "min-h-0 divide-y overflow-y-auto",
          "divide-[color:var(--ds-border-subtle)]",
          open ? "max-h-[var(--ds-h-member-well-open)]" : "max-h-[var(--ds-h-member-well)]",
        )}
      >
        {children}
      </div>
      {footer}
    </div>
  );
}

/**
 * ONE member, on ONE line: status glyph · name · detail, on the fixed
 * `MEMBER_GRID` track so the names down the left land on the same edge in every
 * list, in every row, at every count. Status changes a member's ORDER and its
 * INK, never its row shape.
 */
function MemberLine({
  surface,
  selected,
  checked,
  onSelect,
  onToggleChecked,
}: {
  surface: MemberSurfaceWire;
  selected: boolean;
  checked: boolean;
  onSelect: () => void;
  onToggleChecked?: () => void;
}) {
  const status = dsStatusOf(surface.status);
  const spec = PROPOSED_STATUS[status];
  const Icon = spec.icon;
  const selectionLabel = `${queueRowTitle(surface)} ${
    surface.subtitle.state === "present" ? surface.subtitle.value : statusAccessibleName(status).toLowerCase()
  }`;
  return (
    <div
      data-demo-row-id={surface.runId}
      // A member line draws no status word at all — only the leading glyph —
      // so the row's title keeps the status distinction available on hover.
      title={`${queueRowTitle(surface)} — ${statusAccessibleName(status).toLowerCase()}`}
      className={cn(
        MEMBER_GRID,
        MEMBER_WELL_PAD,
        "w-full items-center text-left",
        // The line's own rhythm token; the well's height is a multiple of it,
        // which is the whole mechanism that stops the container clipping
        // through a row.
        "h-[var(--ds-h-member-line)] gap-x-[var(--ds-space-base)]",
        dsText.body,
        dsMotion.fast,
        "hover:bg-[var(--ds-surface-3)]",
        selected && "bg-[var(--ds-surface-selected)]",
      )}
    >
      <Icon aria-hidden className={cn(dsIcon.sm, "shrink-0", spec.iconClass)} />
      <span
        className={cn(
          "flex min-w-0 items-center gap-[var(--ds-space-tight)] text-[color:var(--ds-fg)]",
          // This cell is what clips the toggle's coarse-pointer overlay; the
          // constant carries both its `truncate` and the gated escape.
          MEMBER_TOUCH_TARGET_HOST,
        )}
      >
        {/* Selection and local triage are sibling controls: nesting the latter
            in a row button would create an invalid interactive hierarchy. */}
        <button
          type="button"
          title={`${queueRowTitle(surface)} — ${statusAccessibleName(status).toLowerCase()}`}
          aria-label={selectionLabel}
          onClick={onSelect}
          // The line is 44px on a coarse pointer and this button is the row's
          // SELECTION — the only way into the member's panel — so it takes the
          // whole height rather than the 16px its text paints.
          className={cn("min-w-0 truncate text-left", MEMBER_NAME_TOUCH_TARGET, dsFocus)}
        >
          {queueRowTitle(surface)}
        </button>
        {checked && (
          <span title="Marked checked by you" className="inline-flex shrink-0 items-center text-[color:var(--ds-success-fg)]">
            <CheckCircle2 aria-hidden className={dsIcon.sm} />
            <span className="sr-only">checked by you</span>
          </span>
        )}
        {onToggleChecked !== undefined && (
          <IconButton
            size="sm"
            className={MEMBER_TOUCH_TARGET}
            label={checked ? `Mark ${queueRowTitle(surface)} unchecked` : `Mark ${queueRowTitle(surface)} checked by you`}
            onClick={(event) => {
              event.stopPropagation();
              onToggleChecked();
            }}
            icon={<CheckCircle2 aria-hidden className={cn(dsIcon.sm, checked && "text-[color:var(--ds-success-fg)]")} />}
          />
        )}
      </span>
      {surface.subtitle.state === "present" ? (
        <span
          className={cn(
            dsText.meta,
            "min-w-0 truncate",
            // A FAILED member's fact is the failure (R3 finding 21). The demo
            // tints this cell whenever the member failed and was not contained
            // as `rejected`, and the tint keys off the served status ALONE —
            // which is now provably identical rather than merely wider:
            // `containment` IS served (D231) and has no `rejected` arm, because
            // a submission the parent could not turn into work never becomes a
            // run at all. A member the server called failed is never rejected,
            // so the demo's second condition can only ever hold.
            status === "failed" ? "text-[color:var(--ds-status-failed-fg)]" : "text-[color:var(--ds-fg-muted)]",
          )}
        >
          {surface.subtitle.value}
        </span>
      ) : (
        // A blank cell reads as a value that failed to render; an em dash reads
        // as "nothing yet". The server's reason for the absence rides the title.
        <span
          className={cn(dsText.meta, dsText.nums, "text-[color:var(--ds-fg-faint)]")}
          title={surface.subtitle.reason}
        >
          —
        </span>
      )}
    </div>
  );
}

/**
 * A group's disclosure link — one shape for `Expand` / `Collapse` and the
 * roster route, so "there is more of this behind here" always looks the same.
 */
const disclosureLink = cn(
  dsText.meta,
  "inline-flex cursor-pointer items-center gap-[var(--ds-space-tight)]",
  dsFocus,
  dsMotion.fast,
  "text-[color:var(--ds-fg-muted)] hover:text-[color:var(--ds-fg)]",
);

function GroupMemberList({
  surface,
  members,
  state,
  handlers,
}: {
  surface: OperationSurfaceWire;
  members: readonly MemberSurfaceWire[];
  state: QueueViewState;
  handlers: QueueHandlers;
}) {
  const ordered = orderMembers(members);
  const checkedIds = state.checkedIds ?? NO_CHECKED_IDS;
  const checkedCount = checkedByYouCount(ordered, checkedIds);
  const wellOpen = state.openWells.has(surface.runId);
  const canExpand = ordered.length > MEMBER_WELL_LINES;
  /**
   * DEFERRED, and this branch is currently unreachable (R3 finding 23).
   * `onOpenRoster` is never supplied by the composition, because the roster it
   * would travel to is a served People section deferred past 1i — see the
   * wire-hookup ledger row "served roster/People section + `records[]` stream"
   * in `docs/plans/2026-08-13-detail-fidelity-audit.md`, and the named trigger
   * at the top of this file. It is kept whole rather than deleted so the route
   * lands with the section instead of being rebuilt from the demo again; a
   * disclosure that travels nowhere is worse than no disclosure, which is why
   * it stays gated on the handler.
   */
  const canOpenRoster = canViewAllMembers(surface.memberRollup.total) && handlers.onOpenRoster !== undefined;
  const { onToggleWell, onOpenRoster } = handlers;

  const disclosures = (
    <>
      {canExpand && onToggleWell !== undefined && (
        <button
          type="button"
          aria-expanded={wellOpen}
          onClick={(event) => {
            event.stopPropagation();
            onToggleWell(surface.runId);
          }}
          className={disclosureLink}
        >
          {wellOpen ? <ChevronUp aria-hidden className={dsIcon.sm} /> : <ChevronDown aria-hidden className={dsIcon.sm} />}
          {wellOpen ? "Collapse" : "Expand"}
        </button>
      )}
      {/* A stable route to the dedicated roster, beside Expand even when the
          expanded well fits everyone: the two do different jobs — inspect
          inline vs work in the full-list surface. */}
      {canOpenRoster && onOpenRoster !== undefined && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpenRoster(surface.runId);
          }}
          className={disclosureLink}
        >
          <ArrowRight aria-hidden className={dsIcon.sm} />
          View full list
        </button>
      )}
    </>
  );

  const showDisclosures = (canExpand && onToggleWell !== undefined) || canOpenRoster;

  return (
    <MemberWell
      open={wellOpen && canExpand}
      header={
        <div className="shrink-0 border-b border-[color:var(--ds-border-subtle)] bg-[var(--ds-surface-2)]">
          {/* Composition chrome — the served rollup lives HERE, not as a
              floating strip above the frame. */}
          <div
            className={cn(
              MEMBER_GRID,
              MEMBER_WELL_PAD,
              "min-h-[var(--ds-h-member-line)] items-center gap-x-[var(--ds-space-base)] py-[var(--ds-space-tight)]",
              dsText.meta,
            )}
          >
            <div className="col-span-3 flex min-w-0 flex-wrap items-center gap-[var(--ds-space-cozy)]">
              <RollupStrip rollup={surface.memberRollup} />
              {checkedCount > 0 && (
                <span
                  className="inline-flex items-center gap-[var(--ds-space-tight)] text-[color:var(--ds-success-fg)]"
                  aria-label={`${checkedCount} of ${surface.memberRollup.total} checked by you`}
                  title="How many loaded members you have marked checked"
                >
                  <CheckCircle2 aria-hidden className={cn(dsIcon.sm, "shrink-0")} />
                  <span className={dsText.nums}>{checkedCount}/{surface.memberRollup.total}</span>
                </span>
              )}
              {/* The payload can legitimately hold fewer member surfaces than
                  the rollup counts (the day query pages). Saying so is a fact
                  about this list; silently drawing a short list is not. */}
              {ordered.length < surface.memberRollup.total && (
                <span className="text-[color:var(--ds-fg-muted)]">
                  {ordered.length} of {plural(surface.memberRollup.total, "member")} loaded
                </span>
              )}
            </div>
          </div>
          {/* Column heads only when there are columns under them. A labelled
              header over an empty region reads as a failed render, which is
              exactly the state a paged operation with no member surfaces is
              in — the tally above still tells the operator what the group
              holds. */}
          {ordered.length > 0 && (
            <div
              className={cn(
                MEMBER_GRID,
                MEMBER_WELL_PAD,
                "h-[var(--ds-h-member-line)] items-center gap-x-[var(--ds-space-base)]",
                dsText.meta,
                "text-[color:var(--ds-fg-faint)]",
              )}
            >
              <span className="col-span-2 col-start-1 truncate">Name</span>
              <span className="col-start-3 truncate">Detail</span>
            </div>
          )}
        </div>
      }
      footer={
        showDisclosures ? (
          <div
            className={cn(
              "grid shrink-0 border-t border-[color:var(--ds-border-subtle)] bg-[var(--ds-surface-2)]",
              canExpand && canOpenRoster ? "grid-cols-2" : "grid-cols-1",
              "[&>button]:h-[var(--ds-h-member-line)] [&>button]:w-full [&>button]:justify-center",
              "[&>button+button]:border-l [&>button+button]:border-[color:var(--ds-border-subtle)]",
            )}
          >
            {disclosures}
          </div>
        ) : undefined
      }
    >
      {ordered.map((member) => (
        <MemberLine
          key={member.runId}
          surface={member}
          selected={state.selectedRunId === member.runId}
          checked={checkedIds.has(String(member.runId))}
          onSelect={() => handlers.onSelect(member.runId)}
          {...(handlers.onToggleChecked === undefined
            ? {}
            : { onToggleChecked: () => handlers.onToggleChecked?.(String(member.runId)) })}
        />
      ))}
    </MemberWell>
  );
}

/* ── cross-panel routes ──────────────────────────────────────────────────── */

/**
 * A chip that CHANGES PANEL. Ported from legacy
 * hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc, `DemoQueue.tsx`
 * `linkChip` (:1078) + `PanelRedirectChip` (:1099) + `ParentBackChip` (:1142).
 *
 * One shape everywhere: gray matte + hairline, `Name · status`, arrow on the
 * RIGHT. Never a leading ←, never info-blue — the operator's rule is that every
 * redirect must match. It grows to fill leftover space, never truncates its
 * label, and a smaller sibling that cannot fit beside it wraps underneath.
 */
const linkChip = cn(
  "inline-flex cursor-pointer items-center border",
  dsClip.token,
  "h-[var(--ds-h-xs)] gap-[var(--ds-space-snug)] px-[var(--ds-space-base)]",
  dsRadius.sm,
  dsText.meta,
  dsText.flush,
  dsFocus,
  dsMotion.fast,
  "border-[color:var(--ds-recess-border)] bg-[var(--ds-recess-bg)] text-[color:var(--ds-fg-muted)] hover:text-[color:var(--ds-fg)]",
);

/**
 * THE shared panel jump — `Name · status ↗` (demo `PanelRedirectChip`, :1099).
 *
 * Both arms of the band go through this one component: the route BACK to the
 * run that delegated this one, and the route FORWARD to a run this one
 * delegated. The demo made the same choice for the same stated reason — every
 * redirect must look identical, so neither direction gets a leading ← or a
 * different hue.
 */
function PanelRedirectChip({
  label,
  status,
  title,
  onOpen,
}: {
  label: string;
  status: ProposedStatus;
  title: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      data-demo-row-link
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      title={title}
      aria-label={title}
      className={cn(linkChip, "min-w-max flex-1 justify-start")}
    >
      <span className="whitespace-nowrap">
        {label} · {statusText(status).toLowerCase()}
      </span>
      <ArrowUpRight aria-hidden className="size-3 shrink-0" />
    </button>
  );
}

function ParentBackChip({
  parent,
  onOpen,
}: {
  parent: NonNullable<ReturnType<QueueParentLookup>>;
  onOpen: () => void;
}) {
  return (
    <PanelRedirectChip
      label={parent.workflowLabel}
      status={parent.status}
      title={`${parent.workflowLabel} · ${parent.title} — the run that delegated this one`}
      onOpen={onOpen}
    />
  );
}

/**
 * A run this row DELEGATED TO — the demo's `PanelRedirectChip`/
 * `LinkedReviewChip` (:1099 / :1159), which are one chip with two labels.
 *
 * EVERY WORD IT PRINTS IS SERVED (D231). `label` is what to call the target and
 * `status` is the target's live status, both resolved server-side through the
 * same status function the row's own status comes from — so the chip never
 * re-derives a status out of the day payload, which is the second status path
 * D81 exists to delete and which goes blank the moment the child ran on another
 * day. `panelKind` supplies the sentence about what OPENING it shows, through
 * the same frontend vocabulary the ⓘ uses; the run id is the route.
 */
function LinkedRunChip({ link, onOpen }: { link: LinkedRunWire; onOpen: () => void }) {
  return (
    <PanelRedirectChip
      label={link.label}
      status={dsStatusOf(link.status)}
      title={`${link.label} — this run delegated to it and is waiting on it. `
        + `${PANEL_EXPLANATION[link.panelKind]}`}
      onOpen={onOpen}
    />
  );
}

/**
 * A run's own SO-WHAT, as a chip — the demo's `FactChipView` (:168).
 *
 * `label` + `value`, and the values are the ones the RECEIPT prints (§9 D7):
 * the queue chip and the Receipt tab are ONE derivation read twice, never two
 * derivations of one result. The demo's `arrowTo` / `warn` / `fullRow` props
 * have no served counterpart — the wire carries a flat `{label, value}` pair
 * because that is what a receipt output fact is — so they are omitted rather
 * than inferred from the value's text.
 *
 * `grow` follows the demo exactly: beside a redirect chip a fact stays at its
 * natural width (`grow={0}`) and lets the redirect own the spare space;
 * otherwise it starts at full content width, refuses to shrink, and shares only
 * genuine leftover — which makes the wrap greedy, so a second fact joins the
 * line only when both stay readable and otherwise moves down intact.
 */
function FactChip({ fact, grow }: { fact: { label: string; value: string }; grow: boolean }) {
  return (
    <span
      className={grow ? "max-w-full" : "shrink-0"}
      style={grow ? { flexGrow: 1, flexShrink: 0, flexBasis: "max-content" } : undefined}
    >
      <Chip label={fact.label} title={`${fact.label} ${fact.value}`} className="w-full max-w-full">
        {fact.value}
      </Chip>
    </span>
  );
}

/* ── the row ─────────────────────────────────────────────────────────────── */

export function QueueRow({
  surface,
  members = [],
  state,
  handlers,
  actionsOf = NO_ACTIONS,
  workflowLabelOf,
  parentOf,
}: {
  surface: QueueSurfaceWire;
  /** the joined member surfaces, for an operation row */
  members?: readonly MemberSurfaceWire[];
  state: QueueViewState;
  handlers: QueueHandlers;
  actionsOf?: QueueActionsOf;
  workflowLabelOf: (workflowId: string) => string;
  /**
   * The run that delegated this one, when the day's projection holds it. Read
   * ONCE at the composition over the whole day's surfaces (a parent can be a
   * different workflow, so the panel's own scoped list is not enough) and
   * handed down, rather than each row searching an array it does not own.
   */
  parentOf?: QueueParentLookup;
}) {
  const status = dsStatusOf(surface.status);
  const announcing = useAttentionAnnounce(status);
  const selected = state.selectedRunId === surface.runId;
  const actions = actionsOf(surface);
  const target = { runId: surface.runId, expectedVersion: surface.rowRevision };
  const StatusIcon = PROPOSED_STATUS[status].icon;
  const workflowLabel = workflowLabelOf(surface.workflowId);
  /**
   * TWO different questions, and conflating them is what R3 finding 9 caught.
   *
   *  - `isOperation` — does this row STAND FOR a set? Then its served rollup is
   *    drawn, even when the payload carried none of its members (the day query
   *    pages), because "12 members, 0 loaded" is a fact and a group row with no
   *    member chrome at all is a group row pretending to be a run.
   *  - `membersVisible` — is the LIST on screen? That is what decides whether
   *    the subline is redundant (finding 7) and whether the redirect band aligns
   *    to the well's table.
   */
  const isOperation = surface.surfaceKind === "operation";
  const membersVisible = isOperation && members.length > 0;
  /**
   * A group with its MEMBER LIST on screen has no subline (R3 finding 7).
   *
   * Ported from the demo's `groupSublineSuppressed` (`DemoQueue.tsx:638`): the
   * sentence read `11/12 signed · Grace Egan failed — signature fi…`, cut
   * mid-word, directly above a tally strip that says the same counts and a list
   * whose first line IS Grace Egan with her outcome in its own column. Three
   * renderings of one fact, and the only one that truncates is the redundant
   * one. A row whose list is shut still gets its sentence — that is the case
   * the sentence was written for.
   */
  const subline =
    membersVisible || surface.liveMessage.state !== "present" ? undefined : surface.liveMessage.value;
  const parent = surface.lineage.state === "child" ? parentOf?.(surface.lineage.parentRunId) : undefined;
  /**
   * Whether the chip band holds a REDIRECT, which is what decides how a fact
   * beside it is sized (`FactChipView`'s `grow` prop, `DemoQueue.tsx:1037`): a
   * redirect owns the spare space and the facts stay at their natural width, so
   * `Oath Upload · running ↗` never gets squeezed by a `signed 2:24 PM`.
   */
  const hasRedirect = parent !== undefined || surface.linkedRuns.length > 0;
  const { onToggleBulk, onAction } = handlers;
  const bulkIds = state.bulkIds;
  const titleTooltip = queueRowTitleTooltip(surface);

  return (
    <div className="px-[var(--ds-space-cozy)] pt-[var(--ds-space-snug)] first:pt-[var(--ds-space-cozy)]">
      <RowContextMenu
        actions={actions}
        target={target}
        rowLabel={queueRowTitle(surface)}
        {...(onAction === undefined ? {} : { onAction })}
      >
        <div
          onClick={() => handlers.onSelect(surface.runId)}
          role="button"
          tabIndex={0}
          aria-pressed={selected}
          // Same collision as the filter bar's, one surface down: the row's
          // name ended `— done` for BOTH terminal dones. The badge inside the
          // row still draws the short word; only the name lengthens.
          //
          // The gate AGE rides the name too (`DemoQueue.tsx:818`), because the
          // pill that draws it is the only place it appears and a pill is not
          // something a screen reader reaches: `— waiting on you · 18m` is the
          // difference between a queue you scan and one you triage.
          aria-label={queueRowAccessibleName(surface, state.nowIso)}
          data-demo-row-id={surface.runId}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              handlers.onSelect(surface.runId);
            }
          }}
          className={cn(
            "group relative flex cursor-pointer flex-col overflow-hidden border",
            dsRadius.lg,
            dsMotion.base,
            dsSurface.card,
            dsFocus,
            // ONE resting border for every card. Selection is the lighter
            // perimeter only — no fill change, no status-coloured edge.
            selected ? dsBorder.loud : dsBorder.base,
            // THE ANNOUNCE. Lift only, so a settling card does not also flash a
            // different outline.
            announcing && cn(dsMotion.move, "-translate-y-[var(--ds-travel-sm)]"),
          )}
        >
          {/*
            THE ROW'S RHYTHM, and the whole of it.

            One grid with a fixed leading track (`--ds-w-row-indent`) and ONE
            vertical gap. Every line under the title hangs off the same edge as
            the title, because the edge is a grid column rather than an `ml-5`
            re-typed on each of the things that can appear here. Never add a
            `mt-*` to space one of them.
          */}
          <div
            className={cn(
              "grid min-w-0 grid-cols-[var(--ds-w-row-indent)_minmax(0,1fr)] items-start",
              "gap-y-[var(--ds-space-snug)] px-[var(--ds-space-cozy)] py-[var(--ds-space-snug)]",
            )}
          >
            {/* The icon, title and status pill share one cross-axis centre. The
                icon box matches the StatusBadge (`sm` = `--ds-h-xs`) so a taller
                title line cannot leave the glyph floating above the pill. */}
            <div className={cn("col-start-1 row-start-1 flex h-[var(--ds-h-xs)] items-center", ROW_INFO_TOUCH_LINE)}>
              <StatusIcon aria-hidden className={cn(dsIcon.md, "shrink-0", PROPOSED_STATUS[status].iconClass)} />
            </div>
            <div
              className={cn(
                "col-start-2 row-start-1 flex min-w-0 flex-nowrap items-center gap-x-[var(--ds-space-base)]",
                // The ⓘ's 44px is taken by the LINE, not by the control — the
                // same move `--ds-h-member-line` makes for the member toggle.
                ROW_INFO_TOUCH_LINE,
              )}
            >
              <div className="flex min-w-0 flex-1 items-center gap-[var(--ds-space-snug)]">
                {/* Bulk selection is a TOP-LEVEL act: a member is acted on
                    through its group or on its own row, never half-selected
                    inside one. */}
                {state.selectMode === true && onToggleBulk !== undefined && (
                  <input
                    type="checkbox"
                    checked={bulkIds?.has(surface.runId) ?? false}
                    aria-label={`Select ${queueRowTitle(surface)} for a bulk command`}
                    onClick={(event) => event.stopPropagation()}
                    onChange={() => onToggleBulk(surface.runId)}
                    className={cn("size-3.5 shrink-0 accent-[var(--ds-accent)]", dsFocus)}
                  />
                )}
                <span
                  data-demo-row-title
                  className={cn(
                    dsText.title,
                    // Truncate rather than wrap — wrapping shoved the status
                    // pill onto a second line under the name.
                    "min-w-0 truncate font-semibold text-[color:var(--ds-fg)]",
                  )}
                  // Present only on a RENAMED row, where it names the subject
                  // the operator's own title replaced. A truncated title
                  // already gets the browser's own tooltip from `truncate`;
                  // this one deliberately overrides it, because "which run is
                  // this really" beats "the rest of the word".
                  {...(titleTooltip === undefined ? {} : { title: titleTooltip })}
                >
                  {queueRowTitle(surface)}
                </span>
                {/* Which workflow owns this row. Printed the moment the surface
                    mixes workflows, silent when every row would say the same
                    word. */}
                {surface.workflowId !== state.panelWorkflowId && (
                  <span className={rowChip("neutral", cn(dsText.caps, "tracking-[var(--ds-tracking-caps)]"))}>
                    {workflowLabel}
                  </span>
                )}
                <RowInfo surface={surface} workflowLabel={workflowLabel} />
              </div>
              <div className="ml-auto flex shrink-0 flex-nowrap items-center justify-end gap-[var(--ds-space-snug)]">
                {/* Status ALWAYS sits on the title row's right — never on the
                    subline. */}
                <HeaderChips surface={surface} status={status} nowIso={state.nowIso} />
              </div>
            </div>

            {/*
              WHO IS IN THE GROUP (`DemoQueue.tsx:928-931`, `memberPreview`).

              A counted anchor — `5 separations` — has no subject of its own, so
              the names ARE its identity; without them the row is a number. It
              is SUPPRESSED the moment the member list is on screen, which is
              the demo's own rule: the preview and the list are then the same
              names twice on one card, and the preview is the copy that
              truncates.

              The demo also gates this on `row.groupNoun`. That field is not
              served and was deliberately not added — no registered workflow in
              this tree is operation-shaped, so a declared noun would be shaped
              by a sample of zero (D186's argument, one level down) — and the
              gate is unnecessary here anyway: `memberPreview` exists only on
              the operation variant, so its presence IS the "this row stands for
              a set" test the noun was standing in for.

              Absent draws NOTHING: a group that has fanned out to nobody yet is
              a real state, and an empty string in this slot reads as a group of
              nobody. Its reason rides the ⓘ with every other absence.
            */}
            {isOperation
              && surface.surfaceKind === "operation"
              && !membersVisible
              && surface.memberPreview.state === "present" && (
              <div
                className={cn(dsText.meta, "col-start-2 truncate text-[color:var(--ds-fg-muted)]")}
                title={surface.memberPreview.value}
              >
                {surface.memberPreview.value}
              </div>
            )}

            {subline !== undefined && (
              <div
                className={cn(
                  dsText.meta,
                  "col-start-2 flex min-w-0 flex-wrap items-center gap-x-[var(--ds-space-base)] gap-y-[var(--ds-space-tight)]",
                  SUBLINE_TONE[status],
                )}
              >
                <span className="min-w-0 flex-1 truncate">{subline}</span>
                <OutcomeActionButton
                  actions={actions}
                  target={target}
                  {...(onAction === undefined ? {} : { onAction })}
                  className="ml-auto shrink-0"
                  /*
                    WHAT THIS CARD ALREADY RENDERS, it does not also offer as a
                    jump (R3 finding 19). The omission is per STATUS, because
                    which control is redundant depends on what the card is
                    showing: a failed row already carries its error in this very
                    line (so `open-failure` and `reupload` would travel to what
                    you are reading), a parked row carries the park, and a
                    waiting row is opened by clicking it. Ported verbatim from
                    `DemoQueue.tsx:950-958`; inert until the action projection
                    serves outcome descriptors.
                  */
                  {...(status === "failed"
                    ? { omitKeys: ["open-failure", "reupload"] }
                    : status === "parked"
                      ? { omitKeys: ["open-park"] }
                      : status === "waiting"
                        ? { omitKeys: ["open-gate"] }
                        : {})}
                />
              </div>
            )}

            {/* FULL WIDTH, both tracks. The well's own grid supplies the leading
                column, so its glyphs land under the card's status icon and its
                text under the card's title — one left edge for the whole card
                rather than a well indented inside column two. */}
            {isOperation && surface.surfaceKind === "operation" && (
              <div className="col-span-2 flex flex-col gap-[var(--ds-space-base)]">
                <GroupMemberList surface={surface} members={members} state={state} handlers={handlers} />
              </div>
            )}

            {/*
              THE BAND A CROSS-PANEL CHIP LIVES IN (`DemoQueue.tsx:1008-1046`).
              It aligns to the well's table when one is on screen, and to the
              title column otherwise, so a jump never hangs off a different
              edge from the row it belongs to.

              Three of the demo's four chip families are served and drawn: the
              forward routes to the runs this one delegated to (`linkedRuns[]`,
              D231), the route back to the run that delegated this one, and the
              run's own outcome facts (`facts[]`, §9 D7). The fourth — the
              `N people` extracted count — is NOT drawn and is not a rendering
              gap: nothing in this tree computes how many people an OCR packet
              holds, so the field was deliberately never added to the wire
              (`docs/findings/queue-rows.md`), and a count invented from an
              array length inside somebody's result is exactly the guess D7 must
              not make.

              ORDER, from the demo: forward redirects, then the parent route,
              then the facts. A redirect is where you GO and a fact is what
              happened, and putting the navigation first is what keeps the wrap
              from breaking the route across two lines.
            */}
            {(parent !== undefined || surface.linkedRuns.length > 0 || surface.facts.state === "present") && (
              <div
                className={cn(
                  "flex w-full min-w-0 flex-wrap items-center",
                  "gap-x-[var(--ds-space-snug)] gap-y-[var(--ds-space-tight)]",
                  membersVisible ? cn("col-span-2", MEMBER_WELL_PAD) : "col-start-2",
                )}
              >
                {surface.linkedRuns.map((link) => (
                  <LinkedRunChip key={link.runId} link={link} onOpen={() => handlers.onOpenLinked?.(link)} />
                ))}
                {parent !== undefined && (
                  <ParentBackChip parent={parent} onOpen={() => handlers.onOpenParent?.(parent.runId)} />
                )}
                {surface.facts.state === "present"
                  && surface.facts.value.map((fact) => (
                    <FactChip key={fact.label} fact={fact} grow={!hasRedirect} />
                  ))}
              </div>
            )}
          </div>

          <RowFooterLine
            surface={surface}
            actions={actions}
            {...(onAction === undefined ? {} : { onAction })}
            nowIso={state.nowIso}
          />
        </div>
      </RowContextMenu>
    </div>
  );
}

/**
 * The active filter, as the empty state must SAY it.
 *
 * The panel used to be handed `String(filter)`, so it printed the raw wire enum
 * key — `No Person Lookup runs are awaiting-approval` (R3 finding 3). The word
 * is the status pill's own label, lowercased, exactly as the demo's
 * `filterWord` derives it; the `needsYou` composite is not a status and gets
 * the demo's own sentence instead of a word (finding 2).
 */
export type QueueFilterScope = { kind: "needsYou" } | { kind: "status"; word: string };

/**
 * D4 (Track D, ref frontend-backend-integration §7.4; audit finding P1) — this
 * panel is `memo`'d, and every prop it takes is stable or primitive at the one
 * place that renders it (`app/dashboard-app.tsx`;
 * `dashboard-memo-prop-stability` refuses an inline object, array, arrow or
 * call in any of its prop slots, because ONE of those turns this wrapper into
 * pure overhead).
 *
 * What it buys and what it cannot: the app's live instant (D256) reaches this
 * panel through `state.nowIso` and ticks once a second, so a queue drawn from
 * a served day re-renders once a second no matter what — that is the floor,
 * and it is deliberate (a frozen elapsed is D256's own defect). What `memo`
 * removes is every re-render BETWEEN those ticks: a dialog opening, a
 * selection toggling, a run-detail section landing, a nav step, a theme swap,
 * and an SSE patch whose row is not in this panel's scope. At the §7.4
 * fixture's 1,240 rows each of those used to redraw the whole queue.
 */
export const QueuePanel = memo(function QueuePanel({
  surfaces,
  state,
  handlers,
  actionsOf = NO_ACTIONS,
  workflowLabelOf,
  parentOf,
  panelLabel,
  day,
  isToday = false,
  filter,
  sort = "attention",
}: {
  /** the day's flat queue projection, already scoped to this panel's workflow */
  surfaces: readonly QueueSurfaceWire[];
  state: QueueViewState;
  handlers: QueueHandlers;
  actionsOf?: QueueActionsOf;
  workflowLabelOf: (workflowId: string) => string;
  parentOf?: QueueParentLookup;
  /** the Workflow Panel entry this queue is scoped to — the header's one word */
  panelLabel: string;
  /** the day partition these rows came from, as `YYYY-MM-DD`; formatted here */
  day: string;
  /**
   * Whether that partition is the live one. `Finished today` is only true on
   * today's day, and a Tuesday panel saying it about Monday's rows is a lie the
   * band header told at every viewport (R3 finding 5).
   */
  isToday?: boolean;
  /** the active filter, absent when the scope is `All` */
  filter?: QueueFilterScope;
  /** the toolbar's ordering control; the default passes the projection through */
  sort?: QueueSortKey;
}) {
  const { top, membersOf } = partition(surfaces);
  const bands = BAND_ORDER.map((key) => ({
    key,
    label: BAND_LABEL[key],
    // Row order inside a band is the projection's until the operator names
    // another one on the toolbar — and even then the reorder stays inside the
    // band, so nothing leaves the group its status put it in.
    rows: sortQueueBand(
      top.filter((surface) => bandOf(dsStatusOf(surface.status)) === key),
      sort,
      state.nowIso,
    ),
  }));

  /**
   * THE FINISHED-TODAY DIGEST (R3 finding 4).
   *
   * One dashed strip under the band head, folded over THE BAND'S OWN ROWS —
   * the rows already on screen, in this component, for this filter. That is a
   * count of what is drawn, exactly like the band's own number beside its
   * label, and it is not a second opinion about the day's totals: those are the
   * Status Bar's, from the one projection (D81).
   *
   * `N verified` prints even at zero, because a finished band that says nothing
   * verified is itself the answer; the other three appear only when they
   * happened, which is how the demo folds it (`DemoQueue.tsx:1845-1850`).
   */
  const finished = bands.find((band) => band.key === "finished")?.rows ?? [];
  const digestOf = (status: ProposedStatus): number =>
    finished.filter((surface) => dsStatusOf(surface.status) === status).length;
  const digest = {
    done: digestOf("verifiedDone"),
    warned: digestOf("doneWarnings"),
    failed: digestOf("failed"),
    cancelled: digestOf("cancelled"),
  };

  return (
    <section
      aria-label="Queue"
      className={cn("flex min-h-0 flex-col overflow-hidden border", dsRadius.lg, dsBorder.base, dsSurface.card)}
    >
      {/*
        THE WORKFLOW NAME, AND NOTHING ELSE.

        The header read `Oath Upload · queue · Sat, Jul 25 · 1 run` and three
        quarters of that was already on screen: the DATE is the Top Bar's own
        navigator, the COUNT is the Status Bar's `All` pill and the rail's badge
        on the same workflow, and `queue` names the panel the operator is
        standing in. What it answers is "which panel am I in", which is the one
        question no other surface answers when the Workflow Panel is reduced to
        an icon.
      */}
      <div
        className={cn(
          "flex shrink-0 items-center border-b",
          dsSize.hBar,
          dsBorder.subtle,
          dsText.meta,
          "gap-[var(--ds-space-snug)] px-[var(--ds-space-cozy)] text-[color:var(--ds-fg-muted)]",
        )}
      >
        <h2 className={cn(dsText.title, "min-w-0 truncate font-semibold text-[color:var(--ds-fg)]")}>{panelLabel}</h2>
      </div>
      {/* ONE scrolling region, and its track runs the panel's full height. */}
      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        {/* Empty is a STATE: what would be here, why it is not, and what to do
            — in that order, and no defence of the design. */}
        {top.length === 0 && (
          <div
            className={cn(
              "mx-[var(--ds-space-cozy)] mt-[var(--ds-space-cozy)] flex flex-col items-start border border-dashed",
              "gap-[var(--ds-space-snug)] px-[var(--ds-space-loose)] py-[var(--ds-space-section)]",
              dsRadius.lg,
              dsBorder.base,
            )}
          >
            <span
              className={cn(
                dsText.ui,
                "inline-flex items-center gap-[var(--ds-space-snug)] font-semibold text-[color:var(--ds-fg)]",
              )}
            >
              <FileText aria-hidden className={cn(dsIcon.md, "text-[color:var(--ds-fg-muted)]")} />
              {/* No date in the heading (operator call, 2026-08-14): the day
                  is already the date navigator's one visible fact, and the
                  body sentence still says "on this day". */}
              {filter === undefined
                ? `No ${panelLabel} runs`
                : filter.kind === "needsYou"
                  ? `No ${panelLabel} runs need your attention`
                  : `No ${panelLabel} runs are ${filter.word}`}
            </span>
            <p className={cn(dsText.body, "max-w-[52ch] leading-relaxed text-[color:var(--ds-fg-muted)]")}>
              {filter === undefined
                ? "It is registered and can be run — there is simply nothing on this day."
                : "Nothing matches this filter."}
            </p>
            <p className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>
              {filter === undefined
                ? "Start one with Start a run, or pick another workflow."
                : "Clear the filter to see all runs."}
            </p>
          </div>
        )}
        {bands.map((band) => {
          if (band.rows.length === 0) return null;
          return (
            <div key={band.key}>
              <div
                className={cn(
                  dsText.caps,
                  "mx-[var(--ds-space-cozy)] mt-[var(--ds-space-loose)] mb-[var(--ds-space-snug)] flex items-center gap-[var(--ds-space-base)]",
                  band.key === "attention"
                    ? "text-[color:var(--ds-status-waiting-fg)]"
                    : "text-[color:var(--ds-fg-muted)]",
                )}
              >
                {/* `Finished today` is only true on today's partition. */}
                {band.key === "finished" && !isToday ? "Finished" : band.label}
                {/* How many rows are DRAWN in this band — what is on screen,
                    never a claim about the day's totals. Those are the Status
                    Bar's, and they come from the one projection (D81). */}
                <span
                  className={cn(
                    dsText.nums,
                    dsText.micro,
                    "inline-flex h-[var(--ds-h-xs)] items-center rounded-full border px-[var(--ds-space-snug)]",
                    band.key === "attention" ? "border-[color:var(--ds-status-waiting-border)]" : dsBorder.base,
                  )}
                >
                  {band.rows.length}
                </span>
                <span aria-hidden className="h-px flex-1 bg-[var(--ds-border-subtle)]" />
              </div>
              {/* The day's finished work in one line — only under `All`, where
                  the band holds everything that finished. Under a filter it
                  would count a subset and read like a day total. */}
              {band.key === "finished" && filter === undefined && (
                <div
                  className={cn(
                    dsText.meta,
                    "mx-[var(--ds-space-cozy)] mt-[var(--ds-space-base)] flex flex-wrap items-center border border-dashed",
                    "gap-x-[var(--ds-space-cozy)] gap-y-[var(--ds-space-tight)] px-[var(--ds-space-cozy)] py-[var(--ds-space-snug)]",
                    dsRadius.md,
                    dsBorder.base,
                    "text-[color:var(--ds-fg-muted)]",
                  )}
                >
                  <span className="font-semibold text-[color:var(--ds-fg-secondary)]">
                    {isToday ? "Today:" : `${dayLabel(day)}:`}
                  </span>
                  <span>
                    <span className="font-semibold text-[color:var(--ds-success-fg)]">{digest.done}</span> verified
                  </span>
                  {digest.warned > 0 && (
                    <span className="text-[color:var(--ds-status-waiting-fg)]">
                      <span className="font-semibold">{digest.warned}</span> with warnings
                    </span>
                  )}
                  {digest.failed > 0 && (
                    <span className="text-[color:var(--ds-status-failed-fg)]">
                      <span className="font-semibold">{digest.failed}</span> failed
                    </span>
                  )}
                  {digest.cancelled > 0 && (
                    <span>
                      <span className="font-semibold">{digest.cancelled}</span> cancelled
                    </span>
                  )}
                </div>
              )}
              {band.rows.map((surface) => (
                <QueueRow
                  key={surface.runId}
                  surface={surface}
                  members={membersOf.get(surface.runId) ?? []}
                  state={state}
                  handlers={handlers}
                  actionsOf={actionsOf}
                  workflowLabelOf={workflowLabelOf}
                  {...(parentOf === undefined ? {} : { parentOf })}
                />
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
});
