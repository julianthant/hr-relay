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
 * pure renderer of it (doc 13 §0.1/§0.4): it classifies nothing, counts no
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
import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import type { z } from "zod";
import { ArrowRight, ChevronDown, ChevronUp, FileText, Info } from "lucide-react";
import { cn } from "../lib/utils.js";
import {
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
import type { QueueSurfaceWireSchema } from "../../domain/dashboard/projection.js";
import {
  FooterActions,
  OutcomeActionButton,
  RowContextMenu,
  type DashboardActionHandler,
} from "./actions.js";
import { fmtClock, plural, runTiming } from "./format.js";
import {
  PROPOSED_STATUS,
  StatusBadge,
  dsStatusOf,
  statusAccessibleName,
  type ProposedStatus,
} from "./status.js";

export type QueueSurfaceWire = z.infer<typeof QueueSurfaceWireSchema>;
type MemberSurfaceWire = Extract<QueueSurfaceWire, { surfaceKind: "member" }>;
type OperationSurfaceWire = Extract<QueueSurfaceWire, { surfaceKind: "operation" }>;
type PipelineStep = QueueSurfaceWire["pipeline"][number];

/* ── the queue's client-owned view state (doc 13 §4) ─────────────────────── */

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
  /**
   * The workflow this queue is scoped to. A row of that workflow does not
   * reprint its label — the panel header already said it. Left undefined by a
   * surface that mixes workflows, where the chip is the only thing naming the
   * owner.
   */
  panelWorkflowId?: string;
  /**
   * Display-only "now", from the app's bootstrap-calibrated clock (doc 13 §4,
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
}

/** How a surface reaches its served actions. The default is honest emptiness. */
export type QueueActionsOf = (surface: QueueSurfaceWire) => readonly ActionDescriptorWire[];

const NO_ACTIONS: QueueActionsOf = () => [];

/* ── bands ───────────────────────────────────────────────────────────────── */

export type QueueBandKey = "attention" | "active" | "queued" | "finished";

const BAND_LABEL: Record<QueueBandKey, string> = {
  attention: "Needs you",
  active: "Active",
  queued: "Queued",
  finished: "Finished",
};

/**
 * A fixed map from the closed ds status vocabulary to a visual band — the same
 * class of pure presentation as mapping a status to an icon. It reorders what
 * the operator sees; it never reclassifies what a run is, and the band's own
 * number is the count of rows drawn in it, not a claim about the day's totals
 * (those are the Status Bar's, from the one projection — D81).
 */
function bandOf(status: ProposedStatus): QueueBandKey {
  if (status === "waiting" || status === "parked") return "attention";
  if (status === "running") return "active";
  if (status === "queued") return "queued";
  return "finished";
}

const BAND_ORDER: QueueBandKey[] = ["attention", "active", "queued", "finished"];

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
};

function MicroSteps({ pipeline }: { pipeline: QueueSurfaceWire["pipeline"] }) {
  if (pipeline.length === 0) return null;
  return (
    <span
      // Same height as StatusBadge `sm` / the title row — centres the dots on
      // the name instead of leaving them top-aligned in a taller chip stack.
      className="inline-flex h-[var(--ds-h-xs)] shrink-0 items-center gap-[3px]"
      title={pipeline.map((step) => `${step.label} (${step.state})`).join(" · ")}
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
type RowChipTone = "neutral" | "info";

const ROW_CHIP_TONE: Record<RowChipTone, string> = {
  neutral: "border-[color:var(--ds-recess-border)] bg-[var(--ds-recess-bg)] text-[color:var(--ds-recess-fg-quiet)]",
  info: "border-[color:var(--ds-info-border)] bg-[var(--ds-info-bg)] text-[color:var(--ds-info-fg)]",
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

/** every system this run resolved to its TEST instance, in the served order */
function testSystemsOf(surface: QueueSurfaceWire): string[] {
  return surface.resolvedInstances.filter(({ instance }) => instance === "test").map(({ system }) => system);
}

function HeaderChips({ surface, status }: { surface: QueueSurfaceWire; status: ProposedStatus }) {
  const testSystems = testSystemsOf(surface);
  return (
    <>
      {/* A run against a TEST instance can never be mistaken for a real filing,
          and a rehearsal says so before you read its receipt. */}
      {testSystems.length > 0 && (
        <span
          title={`Ran against the TEST instance of ${testSystems.join(", ")} — nothing here reached production.`}
          className={rowChip("info", cn(dsText.caps, "tracking-[var(--ds-tracking-caps)]"))}
        >
          test
        </span>
      )}
      {/* Progress dots then the status pill — both on the TITLE row's right
          edge. The dots sit in the same `--ds-h-xs` box as the badge so they
          centre on the name rather than hugging the top of the chip line. */}
      {status === "running" && surface.surfaceKind !== "operation" && <MicroSteps pipeline={surface.pipeline} />}
      <StatusBadge status={status} hideIcon />
    </>
  );
}

/**
 * The ⓘ on a queue row — SERVED FACTS ONLY.
 *
 * The demo's popover explained what kind of row you were looking at, from a
 * fixture naming layer. There is no such wire, and inventing the copy would be
 * the product explaining itself (DESIGN.md, binding). What DOES exist is the
 * server's own reasons for the values it did not send: an absent subtitle or
 * live message arrives with a reason, and that reason is a fact about THIS run
 * — the one thing the ⓘ is sanctioned to hold. When nothing is absent there is
 * nothing to disclose and the trigger is not drawn at all.
 */
function absentFacts(surface: QueueSurfaceWire): { label: string; reason: string }[] {
  const facts: { label: string; reason: string }[] = [];
  if (surface.subtitle.state === "absent") facts.push({ label: "Subtitle", reason: surface.subtitle.reason });
  if (surface.liveMessage.state === "absent") facts.push({ label: "Live message", reason: surface.liveMessage.reason });
  return facts;
}

function RowInfo({
  surface,
  workflowLabel,
}: {
  surface: QueueSurfaceWire;
  workflowLabel: string;
}) {
  const facts = absentFacts(surface);
  if (facts.length === 0) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton
          size="xs"
          label={`What this run did not report — ${surface.title}`}
          icon={<Info aria-hidden className={dsIcon.sm} />}
          // Both stopped: the card root is itself a button, so without these a
          // press on the ⓘ also selects the row underneath it.
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") event.stopPropagation();
          }}
          className="text-[color:var(--ds-fg-faint)] hover:text-[color:var(--ds-fg)] data-[state=open]:text-[color:var(--ds-fg)]"
        />
      </PopoverTrigger>
      <PopoverContent title="Not reported" side="bottom" align="start" width="md">
        <div className="flex flex-col gap-[var(--ds-space-base)]">
          {facts.map((fact) => (
            <p key={fact.label} className={cn(dsText.body, "leading-relaxed text-[color:var(--ds-fg-secondary)]")}>
              <span className="font-semibold text-[color:var(--ds-fg)]">{fact.label}: </span>
              {fact.reason}
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
  // Elapsed is display-only arithmetic over two SERVED instants (doc 13 §4).
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
        {/* The trace id is the run's NAME in every log, every receipt and every
            support conversation, so it is the last thing that may be cut. It is
            `nowrap`: if the line runs out, the SEGMENTS AFTER IT wrap. It reads
            as an inset in the recessed band — no fill of its own. */}
        <span
          className={cn(
            "inline-flex shrink-0 items-center border px-[var(--ds-space-tight)] whitespace-nowrap",
            "h-[var(--ds-h-xs)]",
            dsRadius.sm,
            "border-[color:var(--ds-recess-border)] bg-transparent",
          )}
        >
          {surface.traceId}
        </span>
        {surface.subtitle.state === "present" && (
          <span className="whitespace-nowrap text-[color:var(--ds-fg-secondary)]" title={surface.subtitle.value}>
            {surface.subtitle.value}
          </span>
        )}
        {/* A first attempt is the ordinary case and says nothing; a re-run is a
            fact about this run that changes how its evidence reads. */}
        {surface.attempt > 1 && <span className="whitespace-nowrap">attempt {surface.attempt}</span>}
        {timing !== undefined && (
          <span className="whitespace-nowrap" {...(timing.title === undefined ? {} : { title: timing.title })}>
            {timing.text}
          </span>
        )}
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
      <span className="sr-only">{`Right-click or press m for every command on ${surface.title}`}</span>
    </div>
  );
}

/* ── the attention transition ────────────────────────────────────────────── */

/** how long the settle lasts — one `move`, then still */
const ATTENTION_ANNOUNCE_MS = 900;

/**
 * THE ATTENTION TRANSITION — the one status change this product animates.
 *
 * DESIGN.md says never animate status churn, and it is right: this dashboard
 * updates constantly, and if everything that changes also moves it is
 * unreadable exactly when it is busiest. Elapsed timers, counts, background
 * settling and self-initiated re-sorts all stay perfectly still.
 *
 * A run CROSSING INTO `Waiting on you` or `Failed` is different in kind. Those
 * are the two states allowed to shout; a run entering one has stopped being
 * background and become work, and the moment it happens is the moment the
 * operator is looking somewhere else. It fires on the EDGE, never on the state
 * — a row already waiting when you scrolled to it does nothing — never on
 * mount, once, and only for those two statuses.
 *
 * Implemented once, here. Do not re-derive it at a second call site.
 */
export function useAttentionAnnounce(status: ProposedStatus): boolean {
  const attention = status === "waiting" || status === "failed";
  const previous = useRef<ProposedStatus | null>(null);
  const [announcing, setAnnouncing] = useState(false);

  useEffect(() => {
    const was = previous.current;
    previous.current = status;
    // First sight of a row is not a transition. Mounting into an attention
    // status is how EVERY row on a busy panel would announce itself on paint.
    if (was === null || was === status) return;
    if (!attention) return;
    setAnnouncing(true);
    const timer = window.setTimeout(() => setAnnouncing(false), ATTENTION_ANNOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [attention, status]);

  return announcing;
}

/* ── the member well ─────────────────────────────────────────────────────── */

/**
 * The two well shapes, as LINE COUNTS. `--ds-h-member-well` /
 * `--ds-h-member-well-open` are these same two numbers as pixels. Labels stay
 * word-only ("Expand" / "Collapse") so the disclosure does not restate a count
 * the chrome already carries. Exported so a test can pin the two against each
 * other rather than against a hand-typed literal in a string.
 */
export const MEMBER_WELL_LINES = 5;
export const MEMBER_WELL_OPEN_LINES = 20;

/** A dedicated roster view accompanies every member set that can expand. */
export function canViewAllMembers(memberCount: number): boolean {
  return memberCount > MEMBER_WELL_LINES;
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
  onSelect,
}: {
  surface: MemberSurfaceWire;
  selected: boolean;
  onSelect: (event: ReactMouseEvent) => void;
}) {
  const status = dsStatusOf(surface.status);
  const spec = PROPOSED_STATUS[status];
  const Icon = spec.icon;
  return (
    <button
      type="button"
      data-demo-row-id={surface.runId}
      // A member line draws no status word at all — only the leading glyph —
      // so this string is the whole of what an operator is told. It uses the
      // ACCESSIBLE name: `done` alone cannot separate the verified done from
      // the done-with-warnings (D22, amended 2026-08-04).
      title={`${surface.title} — ${statusAccessibleName(status).toLowerCase()}`}
      onClick={onSelect}
      className={cn(
        MEMBER_GRID,
        MEMBER_WELL_PAD,
        "w-full items-center text-left",
        // The line's own rhythm token; the well's height is a multiple of it,
        // which is the whole mechanism that stops the container clipping
        // through a row.
        "h-[var(--ds-h-member-line)] gap-x-[var(--ds-space-base)]",
        dsText.body,
        "cursor-pointer",
        dsFocus,
        dsMotion.fast,
        "hover:bg-[var(--ds-surface-3)]",
        selected && "bg-[var(--ds-surface-selected)]",
      )}
    >
      <Icon aria-hidden className={cn(dsIcon.sm, "shrink-0", spec.iconClass)} />
      <span className="min-w-0 truncate text-[color:var(--ds-fg)]">{surface.title}</span>
      {surface.subtitle.state === "present" ? (
        <span className={cn(dsText.meta, "min-w-0 truncate text-[color:var(--ds-fg-muted)]")}>
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
    </button>
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

/**
 * Members sort attention-first and keep the same one-line tracks (DESIGN.md:
 * "Member status changes order and ink, never row shape"). Within a tier the
 * SERVER's order is preserved — the client never re-sorts a projection.
 */
const MEMBER_TIER: Record<ProposedStatus, number> = {
  failed: 0,
  waiting: 1,
  parked: 2,
  doneWarnings: 3,
  running: 4,
  queued: 5,
  verifiedDone: 6,
  cancelled: 7,
};

function orderMembers(members: readonly MemberSurfaceWire[]): MemberSurfaceWire[] {
  return [...members]
    .map((surface, index) => ({ surface, index }))
    .sort((a, b) => {
      const tier = MEMBER_TIER[dsStatusOf(a.surface.status)] - MEMBER_TIER[dsStatusOf(b.surface.status)];
      return tier !== 0 ? tier : a.index - b.index;
    })
    .map(({ surface }) => surface);
}

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
  const wellOpen = state.openWells.has(surface.runId);
  const canExpand = ordered.length > MEMBER_WELL_LINES;
  const canOpenRoster = canViewAllMembers(surface.memberRollup.total) && handlers.onOpenRoster !== undefined;
  const { onToggleWell, onOpenRoster } = handlers;
  if (ordered.length === 0) return null;

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
          onSelect={(event) => {
            event.stopPropagation();
            handlers.onSelect(member.runId);
          }}
        />
      ))}
    </MemberWell>
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
}: {
  surface: QueueSurfaceWire;
  /** the joined member surfaces, for an operation row */
  members?: readonly MemberSurfaceWire[];
  state: QueueViewState;
  handlers: QueueHandlers;
  actionsOf?: QueueActionsOf;
  workflowLabelOf: (workflowId: string) => string;
}) {
  const status = dsStatusOf(surface.status);
  const announcing = useAttentionAnnounce(status);
  const selected = state.selectedRunId === surface.runId;
  const actions = actionsOf(surface);
  const target = { runId: surface.runId, expectedVersion: surface.rowRevision };
  const StatusIcon = PROPOSED_STATUS[status].icon;
  const workflowLabel = workflowLabelOf(surface.workflowId);
  const membersVisible = surface.surfaceKind === "operation" && members.length > 0;
  const subline = surface.liveMessage.state === "present" ? surface.liveMessage.value : undefined;
  const { onToggleBulk, onAction } = handlers;
  const bulkIds = state.bulkIds;

  return (
    <div className="px-[var(--ds-space-cozy)] pt-[var(--ds-space-snug)] first:pt-[var(--ds-space-cozy)]">
      <RowContextMenu
        actions={actions}
        target={target}
        rowLabel={surface.title}
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
          aria-label={`${surface.title} — ${statusAccessibleName(status).toLowerCase()}`}
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
            <div className="col-start-1 row-start-1 flex h-[var(--ds-h-xs)] items-center">
              <StatusIcon aria-hidden className={cn(dsIcon.md, "shrink-0", PROPOSED_STATUS[status].iconClass)} />
            </div>
            <div className="col-start-2 row-start-1 flex min-w-0 flex-nowrap items-center gap-x-[var(--ds-space-base)]">
              <div className="flex min-w-0 flex-1 items-center gap-[var(--ds-space-snug)]">
                {/* Bulk selection is a TOP-LEVEL act: a member is acted on
                    through its group or on its own row, never half-selected
                    inside one. */}
                {state.selectMode === true && onToggleBulk !== undefined && (
                  <input
                    type="checkbox"
                    checked={bulkIds?.has(surface.runId) ?? false}
                    aria-label={`Select ${surface.title} for a bulk command`}
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
                >
                  {surface.title}
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
                <HeaderChips surface={surface} status={status} />
              </div>
            </div>

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
                  // The queue omits the Review ↗ — clicking the row is enough.
                  omitKeys={["open-gate"]}
                />
              </div>
            )}

            {/* FULL WIDTH, both tracks. The well's own grid supplies the leading
                column, so its glyphs land under the card's status icon and its
                text under the card's title — one left edge for the whole card
                rather than a well indented inside column two. */}
            {membersVisible && surface.surfaceKind === "operation" && (
              <div className="col-span-2 flex flex-col gap-[var(--ds-space-base)]">
                <GroupMemberList surface={surface} members={members} state={state} handlers={handlers} />
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

/* ── the panel ───────────────────────────────────────────────────────────── */

/**
 * Members are contained by their operation and are drawn INSIDE it, so a member
 * surface is never also a top-level row. Containment is read from the served
 * `memberRunIds` / `lineage`, never re-decided here.
 */
function partition(surfaces: readonly QueueSurfaceWire[]): {
  top: QueueSurfaceWire[];
  membersOf: Map<string, MemberSurfaceWire[]>;
} {
  const byRunId = new Map<string, MemberSurfaceWire>();
  for (const surface of surfaces) {
    if (surface.surfaceKind === "member") byRunId.set(surface.runId, surface);
  }
  const claimed = new Set<string>();
  const membersOf = new Map<string, MemberSurfaceWire[]>();
  for (const surface of surfaces) {
    if (surface.surfaceKind !== "operation") continue;
    const members: MemberSurfaceWire[] = [];
    for (const runId of surface.memberRunIds) {
      const member = byRunId.get(runId);
      if (member === undefined) continue;
      members.push(member);
      claimed.add(runId);
    }
    membersOf.set(surface.runId, members);
  }
  const top = surfaces.filter((surface) => !claimed.has(surface.runId));
  return { top, membersOf };
}

export function QueuePanel({
  surfaces,
  state,
  handlers,
  actionsOf = NO_ACTIONS,
  workflowLabelOf,
  panelLabel,
  dayLabel,
  filterLabel,
}: {
  /** the day's flat queue projection, already scoped to this panel's workflow */
  surfaces: readonly QueueSurfaceWire[];
  state: QueueViewState;
  handlers: QueueHandlers;
  actionsOf?: QueueActionsOf;
  workflowLabelOf: (workflowId: string) => string;
  /** the Workflow Panel entry this queue is scoped to — the header's one word */
  panelLabel: string;
  /** the day partition these rows came from; the header never invents its own */
  dayLabel: string;
  /** the active filter's own word, so the empty state names what the operator set */
  filterLabel?: string;
}) {
  const { top, membersOf } = partition(surfaces);
  const bands = BAND_ORDER.map((key) => ({
    key,
    label: BAND_LABEL[key],
    // Row order INSIDE a band is the server's; the client never re-sorts a
    // projection, it only groups it.
    rows: top.filter((surface) => bandOf(dsStatusOf(surface.status)) === key),
  }));

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
              {filterLabel === undefined
                ? `No ${panelLabel} runs on ${dayLabel}`
                : `No ${panelLabel} runs are ${filterLabel}`}
            </span>
            <p className={cn(dsText.body, "max-w-[52ch] leading-relaxed text-[color:var(--ds-fg-muted)]")}>
              {filterLabel === undefined
                ? "It is registered and can be run — there is simply nothing on this day."
                : "Nothing matches this filter."}
            </p>
            <p className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>
              {filterLabel === undefined
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
                {band.label}
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
              {band.rows.map((surface) => (
                <QueueRow
                  key={surface.runId}
                  surface={surface}
                  members={membersOf.get(surface.runId) ?? []}
                  state={state}
                  handlers={handlers}
                  actionsOf={actionsOf}
                  workflowLabelOf={workflowLabelOf}
                />
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * The j/k traversal order for the current view — the SAME order the eye sees,
 * members included, so a keyboard walk and a scroll agree.
 */
export function visibleRunIds(
  surfaces: readonly QueueSurfaceWire[],
): string[] {
  const { top, membersOf } = partition(surfaces);
  const ids: string[] = [];
  for (const key of BAND_ORDER) {
    for (const surface of top) {
      if (bandOf(dsStatusOf(surface.status)) !== key) continue;
      ids.push(surface.runId);
      for (const member of orderMembers(membersOf.get(surface.runId) ?? [])) ids.push(member.runId);
    }
  }
  return ids;
}
