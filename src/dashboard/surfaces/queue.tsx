import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "../ds/dropdown-menu.js";
/**
 * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * src/dashboard/components/dev/rebuild-demo/DemoQueue.tsx
 *
 * The Queue Panel: attention bands, the three row types, ONE member shape at
 * every count, with aligned content and a provenance footer that wraps.
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
 *    carries the server's reason; the queue does not invent a value.
 *
 * Bands, member ordering and elapsed formatting are the only derivations, and
 * each is a fixed map over a closed served enum or a display-only subtraction
 * of two served instants — never a second opinion about what a run IS.
 */
import { memo, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, ArrowRight, ArrowUpRight, ChevronDown, ChevronUp, FileText } from "lucide-react";
import { cn } from "../lib/utils.js";
import {
  BareButton,
  Chip,
  Checkbox,
  dsBorder,
  dsClip,
  dsFocus,
  dsIcon,
  dsMotion,
  dsRadius,
  dsSize,
  dsSurface,
  dsText,
  openContextMenuFor,
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
import { runDisplayId } from "./run-display-model.js";
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
  type LinkedRunWire,
  type MemberSurfaceWire,
  type OperationSurfaceWire,
  type PipelineStep,
  type QueueSurfaceWire,
  bandOf,
  canViewAllMembers,
  orderMembers,
  partition,
  queueGateAge,
  queueRowAccessibleName,
  queueRowTitle,
  queueRowTitleTooltip,
  groupQueueAttempts,
  queueItemLayout,
  type QueueBatch,
  type QueueItemGroup,
  queueDisplayGroups,
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
  onSetBatchGrouping?: (batch: QueueBatch, grouped: boolean) => Promise<void>;
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
  onSelectBulk?: (runId: string) => void;
  onExitSelection?: () => void;
  onPreviewAction?: (action: 'retry' | 'archive' | 'delete', ids: readonly string[]) => void;
  previewArchive?: boolean;
  /** Mark a loaded member checked by you. This has no authority effect. */
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

/* the band ordering and its sort vocabulary live in `queue-model.ts` — see the note there */
export type { QueueSortKey };

/* ── small row pieces ────────────────────────────────────────────────────── */

/**
 * The served pipeline, one segment per step.
 *
 * The state vocabulary is the wire's own closed enum; each state gets a token,
 * while the Running badge owns the single animated indicator.
 */
const STEP_TONE: Record<PipelineStep["state"], string> = {
  done: "bg-ui-info",
  active: "bg-ui-info ring-1 ring-ui-info ring-offset-1 ring-offset-[var(--ds-surface-1)]",
  pending: "bg-[var(--ds-border)]",
  failed: "bg-[var(--ds-danger)]",
  blocked: "bg-[var(--ds-status-waiting-mark)]",
  skipped: "bg-[var(--ds-border-subtle)]",
  // D268 — the pipeline's own `cancelled` arm, in the same hue the run-detail
  // timeline draws a cancelled step: one span, one word, one colour.
  cancelled: "bg-[var(--ds-status-cancelled-mark)]",
};

/**
 * One step, including only served measurements.
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

function QueueProgress({ pipeline }: { pipeline: QueueSurfaceWire["pipeline"] }) {
  if (pipeline.length === 0) return null;
  return (
    <div
      data-queue-progress
      className="flex min-w-0 items-center gap-[var(--ds-space-tight)]"
      aria-label={`Steps: ${pipeline.map(stepTitle).join(", ")}`}
    >
      {pipeline.map((step) => (
        <span key={step.id} title={stepTitle(step)} className={cn("h-1.5 min-w-0 flex-1 rounded-full", STEP_TONE[step.state])} />
      ))}
    </div>
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
      <StatusBadge
        status={status}
        presentation="queue"
        hideIcon={status !== "running" && status !== "waiting" && status !== "failed"}
        {...(gateAge === undefined ? {} : { age: gateAge })}
      />
      {surface.surfaceKind === "operation" && (
        <span
          data-queue-member-count
          title={`${surface.memberRollup.terminal} of ${surface.memberRollup.total} finished; ${surface.memberRollup.failed} failed`}
          aria-label={`${surface.memberRollup.terminal} of ${surface.memberRollup.total} finished; ${surface.memberRollup.failed} failed`}
          className={cn(dsText.meta, dsText.nums, dsRadius.sm, dsBorder.base,
            "inline-flex h-[var(--ds-h-xs)] min-w-[var(--ds-w-queue-counter)] items-center justify-center whitespace-nowrap border bg-[var(--ds-surface-2)] px-[var(--ds-space-tight)] text-[color:var(--ds-fg-secondary)]")}
        >
          {surface.memberRollup.terminal}/{surface.memberRollup.total}
        </span>
      )}
    </>
  );
}

const PANEL_EXPLANATION: Record<QueueSurfaceWire["panelKind"], string> = {
  run: "Opening it shows the logs, recorded values, screenshots and operator decisions.",
  review: "Opening it starts the review — the scanned page beside the fields read from it, one person at a time.",
  group: "Opening it lists the people it holds, attention first, and you can open any one of them from there.",
  member: "Opening it walks the set — previous, next, and a checked mark so you keep your place in it.",
};

/**
 * The subline is TEXT ONLY, and it is the server's `liveMessage` — the one
 * sentence the projection authors about what this run is doing or why it
 * stopped. Its tone follows the status; a run whose message is absent has no
 * subline rather than a manufactured one.
 */
const SUBLINE_TONE: Record<ProposedStatus, string> = {
  waiting: "text-ui-info",
  failed: "text-ui-danger",
  parked: "text-[color:var(--ds-status-parked-fg)]",
  running: "text-[color:var(--ds-status-running-fg)]",
  cancelling: "text-[color:var(--ds-status-running-fg)]",
  queued: "text-[color:var(--ds-fg-muted)]",
  verifiedDone: "text-[color:var(--ds-fg-muted)]",
  doneWarnings: "text-[color:var(--ds-fg-muted)]",
  cancelled: "text-[color:var(--ds-fg-muted)]",
};

/**
 * The row's FOOTER — the run's provenance line and its controls.
 *
 * The meta zone is one wrapping provenance line, and
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
  itemGroup,
  onSelect,
  onPreviewAction,
}: {
  surface: QueueSurfaceWire;
  itemGroup?: QueueItemGroup;
  onSelect: (runId: string) => void;
  actions: readonly ActionDescriptorWire[];
  onAction?: DashboardActionHandler;
  nowIso: string;
  onPreviewAction?: (action: 'retry' | 'archive' | 'delete') => void;
}) {
  // Elapsed is display-only arithmetic over two SERVED instants (ref frontend-backend-integration §4).
  //
  // The second instant is the whole point. A queued run has started nothing,
  // so it shows no timer. A run still in flight shows live elapsed against
  // `now`. A FINISHED run shows what it took — `endedAt − startedAt` — because
  // `now − startedAt` answers a question nobody asked of a settled run and
  // grows forever: the live exit run displayed 2h 47m for ~14.5 minutes of
  // execution (D124). A terminal row with no served end instant says the
  // duration is unmeasured and omitted; it never falls back to `now`.
  const timing = isTerminalQueueStatus(surface.status) && surface.endedAt.state === "absent"
    ? undefined : runTiming(surface, nowIso, isTerminalQueueStatus);
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
        <QueueAttemptSelector
          title={queueRowTitle(surface)}
          surface={surface}
          item={itemGroup}
          selectedRunId={String(surface.runId)}
          onSelect={onSelect}
        />
        {/* The compact alias is display-only; the tooltip retains the exact trace. */}
        <span className="whitespace-nowrap text-[color:var(--ds-fg-secondary)]" title={surface.traceId}>
          {runDisplayId(surface.runId, surface.traceId)}
        </span>
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
          onPreviewAction={onPreviewAction}
          {...(onAction === undefined ? {} : { onAction })}
        />
      </div>
      <span className="sr-only">{`Right-click or press m for every command on ${queueRowTitle(surface)}`}</span>
    </div>
  );
}

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
    <div className="flex flex-col overflow-hidden rounded-[var(--ds-radius-sm)] border border-[color:var(--ds-border)] bg-[var(--ds-surface-1)]">
      {header}
      <div
        className={cn(
          "min-h-0 overflow-y-auto",
          open ? "max-h-[var(--ds-h-queue-member-well-open)]" : "max-h-[var(--ds-h-queue-member-well)]",
        )}
      >
        {children}
      </div>
      {footer}
    </div>
  );
}

function MemberLine({ surface, item, selected, onSelect }: {
  surface: MemberSurfaceWire;
  item: QueueItemGroup;
  selected: boolean;
  onSelect: (runId: string) => void;
}) {
  const status = dsStatusOf(surface.status);
  const spec = PROPOSED_STATUS[status];
  const Icon = spec.icon;
  const selectionLabel = `${queueRowTitle(surface)} ${
    surface.subtitle.state === "present" ? surface.subtitle.value : statusAccessibleName(status).toLowerCase()
  }`;
  return (
    <tr data-demo-row-id={surface.runId}
      title={`${queueRowTitle(surface)} — ${statusAccessibleName(status).toLowerCase()}`}
      className={cn(dsText.body, dsMotion.fast, "h-[var(--ds-h-queue-member-line)] hover:bg-[var(--ds-surface-3)]", selected && "bg-[var(--ds-surface-selected)]")}
    >
      <td className="max-w-0 border-b border-[color:var(--ds-border-subtle)] px-[var(--ds-space-base)] py-[var(--ds-space-tight)]">
        <div className="flex min-w-0 items-center gap-[var(--ds-space-snug)]">
          <Icon aria-hidden className={cn(dsIcon.sm, "shrink-0", spec.iconClass, status === "running" && "animate-spin motion-reduce:animate-none")} />
          <BareButton type="button" title={surface.subtitle.state === "present" ? surface.subtitle.value : surface.subtitle.reason}
            aria-label={selectionLabel} onClick={(event) => { event.stopPropagation(); onSelect(String(surface.runId)); }}
            className={cn("min-w-0 truncate text-left text-[color:var(--ds-fg)] hover:underline", dsFocus)}
          >{queueRowTitle(surface)}</BareButton>
          {item.attempts.length > 1 && <QueueAttemptSelector title={queueRowTitle(surface)} surface={surface} item={item}
            selectedRunId={String(surface.runId)} onSelect={onSelect} />}

        </div>
      </td>
      <td className={cn(dsText.meta, "w-px whitespace-nowrap border-b border-[color:var(--ds-border-subtle)] px-[var(--ds-space-base)] py-[var(--ds-space-tight)] text-right", status === "waiting" || status === "running" ? "text-ui-info" : status === "failed" ? "text-ui-danger" : spec.soloTone)}>
        <span aria-label={statusAccessibleName(status)}>{statusText(status)}</span>
      </td>
    </tr>
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
  itemKey,
  members,
  state,
  handlers,
}: {
  surface: OperationSurfaceWire;
  itemKey: string;
  members: readonly MemberSurfaceWire[];
  state: QueueViewState;
  handlers: QueueHandlers;
}) {
  const itemGroups = groupQueueAttempts(members);
  const ordered = orderMembers(itemGroups.map((item) => item.representative) as MemberSurfaceWire[]);
  const wellOpen = state.openWells.has(itemKey);
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
        <BareButton
          type="button"
          aria-expanded={wellOpen}
          onClick={(event) => {
            event.stopPropagation();
            onToggleWell(itemKey);
          }}
          className={disclosureLink}
        >
          {wellOpen ? <ChevronUp aria-hidden className={dsIcon.sm} /> : <ChevronDown aria-hidden className={dsIcon.sm} />}
          {wellOpen ? "Collapse" : "Expand"}
        </BareButton>
      )}
      {/* A stable route to the dedicated roster, beside Expand even when the
          expanded well fits everyone: the two do different jobs — inspect
          inline vs work in the full-list surface. */}
      {canOpenRoster && onOpenRoster !== undefined && (
        <BareButton
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpenRoster(surface.runId);
          }}
          className={disclosureLink}
        >
          <ArrowRight aria-hidden className={dsIcon.sm} />
          View full list
        </BareButton>
      )}
    </>
  );

  const showDisclosures = (canExpand && onToggleWell !== undefined) || canOpenRoster;

  return (
    <MemberWell
      open={wellOpen && canExpand}
      header={ordered.length > 0 && ordered.length < surface.memberRollup.total && (
        <div className={cn(dsText.meta, "flex flex-wrap items-center gap-[var(--ds-space-base)] border-b border-[color:var(--ds-border-subtle)] px-[var(--ds-space-base)] py-[var(--ds-space-tight)] text-[color:var(--ds-fg-muted)]")}>
          {ordered.length > 0 && ordered.length < surface.memberRollup.total && <span>
            {ordered.length} of {plural(surface.memberRollup.total, "member")} loaded
          </span>}
        </div>
      )}
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
      <table aria-label={`Members of ${queueRowTitle(surface)}`} className="w-full border-collapse text-left [&_tbody>tr:last-child>td]:border-b-0">
        <thead className="sticky top-0 bg-[var(--ds-surface-2)]">
          <tr className={cn(dsText.meta, "h-[var(--ds-h-queue-member-head)] text-[color:var(--ds-fg-secondary)]")}>
            <th scope="col" className="border-b border-[color:var(--ds-border-subtle)] px-[var(--ds-space-base)] py-[var(--ds-space-snug)] font-medium">Name</th>
            <th scope="col" className="border-b border-[color:var(--ds-border-subtle)] px-[var(--ds-space-base)] py-[var(--ds-space-snug)] text-right font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {ordered.length === 0 && <tr><td colSpan={2} className={cn(dsText.body, "px-[var(--ds-space-base)] py-[var(--ds-space-cozy)] text-[color:var(--ds-fg-muted)]")}>Members not loaded</td></tr>}
          {ordered.map((member) => {
            const item = itemGroups.find((candidate) => candidate.representative.runId === member.runId);
            if (item === undefined) throw new Error(`member list lost item ${String(member.itemId)}`);
            const visible = item.attempts.find((attempt) => String(attempt.runId) === state.selectedRunId) ?? member;
            const selected = item.attempts.some((attempt) => String(attempt.runId) === state.selectedRunId);
            return <MemberLine key={item.key} surface={visible as MemberSurfaceWire} item={item} selected={selected}
              onSelect={handlers.onSelect} />;
          })}
        </tbody>
      </table>
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
    <BareButton
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
    </BareButton>
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
 * the served panel vocabulary; the run id is the route.
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

function QueueAttemptSelector({ title, surface, item, selectedRunId, onSelect }: {
  title: string;
  surface: QueueSurfaceWire;
  item?: QueueItemGroup;
  selectedRunId?: string;
  onSelect: (runId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const attempts = item?.attempts ?? [surface];
  return <DropdownMenu open={open} onOpenChange={setOpen}>
    <DropdownMenuTrigger asChild><BareButton type="button" aria-label={`Attempts for ${title}`} title={`Attempt ${surface.attempt}`} onClick={event => event.stopPropagation()}
      className={cn("inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-caption text-ui-muted hover:bg-ui-hover hover:text-ui-primary", dsFocus)}>
      #{surface.attempt}<ChevronDown aria-hidden className="size-3" />
    </BareButton></DropdownMenuTrigger>
    <DropdownMenuContent aria-label={`Attempts for ${title}`} className="w-56">
      <DropdownMenuRadioGroup value={selectedRunId ?? String(surface.runId)} onValueChange={id => { onSelect(id); setOpen(false); }}>
        {[...attempts].reverse().map(attempt => <DropdownMenuRadioItem key={attempt.runId} value={String(attempt.runId)}>
          <span className="text-caption tabular-nums text-ui-muted">#{attempt.attempt}</span><StatusBadge status={dsStatusOf(attempt.status)} presentation="queue" />
        </DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}

/* ── the row ─────────────────────────────────────────────────────────────── */

export function QueueRow({
  surface,
  itemGroup,
  members = [],
  state,
  handlers,
  actionsOf = NO_ACTIONS,
  workflowLabelOf,
  parentOf,
}: {
  surface: QueueSurfaceWire;
  itemGroup?: QueueItemGroup;
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
  const selected = itemGroup?.attempts.some((attempt) => String(attempt.runId) === state.selectedRunId)
    ?? state.selectedRunId === surface.runId;
  const actions = actionsOf(surface);
  const target = { runId: surface.runId, expectedVersion: surface.rowRevision };
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
    <div className="flex items-start gap-[var(--ds-space-base)] px-[var(--ds-space-cozy)] pt-[var(--ds-space-snug)] first:pt-[var(--ds-space-cozy)]">
      {state.selectMode === true && onToggleBulk !== undefined && <Checkbox
        checked={bulkIds?.has(surface.runId) ?? false}
        label={<span className="sr-only">Select {queueRowTitle(surface)} for a bulk command</span>}
        onCheckedChange={() => onToggleBulk(surface.runId)}
        className="mt-[var(--ds-space-queue-top)] shrink-0"
      />}
      <RowContextMenu
        previewArchive={handlers.previewArchive}
        actions={actions}
        target={target}
        rowLabel={queueRowTitle(surface)}
        {...(onAction === undefined ? {} : { onAction })}
        {...(handlers.onSelectBulk === undefined ? {} : { onSelectRow: () => handlers.onSelectBulk?.(surface.runId) })}
        {...(handlers.onPreviewAction === undefined ? {} : { onPreviewAction: (action: 'retry' | 'archive' | 'delete') => handlers.onPreviewAction?.(action, [surface.runId]) })}
      >
        <div
          onClick={event => {
            if (event.detail > 1) return;
            if (state.selectMode === true) handlers.onToggleBulk?.(surface.runId);
            else handlers.onSelect(surface.runId);
          }}
          onDoubleClick={event => {
            if ((event.target as HTMLElement).closest('button, input, a') !== null) return;
            event.preventDefault(); openContextMenuFor(event.currentTarget);
          }}
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
            // Nested controls keep native Enter/Space activation. Only the
            // focused row itself uses those keys to open its detail.
            if (event.target !== event.currentTarget) return;
            if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
              event.preventDefault(); openContextMenuFor(event.currentTarget); return;
            }
            if (event.key === 'Escape' && state.selectMode === true) { event.preventDefault(); event.stopPropagation(); handlers.onExitSelection?.(); return; }
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              if (state.selectMode === true) handlers.onToggleBulk?.(surface.runId);
              else handlers.onSelect(surface.runId);
            }
          }}
          className={cn(
            "group relative flex min-w-0 flex-1 cursor-pointer flex-col overflow-hidden border",
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
          <div data-queue-body className="flex min-w-0 flex-col gap-[var(--ds-space-base)] px-[var(--ds-space-cozy)] pb-[var(--ds-space-cozy)] pt-[var(--ds-space-queue-top)]">
            <div className="flex min-w-0 items-center gap-x-[var(--ds-space-base)]">
              <div className="flex min-w-0 flex-1 items-center gap-[var(--ds-space-snug)]">
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

              Absent previews draw nothing; the table distinguishes unloaded members.
            */}
            {isOperation
              && surface.surfaceKind === "operation"
              && !membersVisible
              && surface.memberPreview.state === "present" && (
              <div
                className={cn(dsText.meta, "truncate text-[color:var(--ds-fg-muted)]")}
                title={surface.memberPreview.value}
              >
                {surface.memberPreview.value}
              </div>
            )}

            {status === "running" && !isOperation && <QueueProgress pipeline={surface.pipeline} />}
            {(subline !== undefined || (status === "running" && !isOperation && surface.pipeline.length > 0)) && (
              <div
                className={cn(
                  dsText.meta,
                  "flex min-w-0 flex-wrap items-center gap-x-[var(--ds-space-base)] gap-y-[var(--ds-space-tight)]",
                  SUBLINE_TONE[status],
                )}
              >
                <span className="min-w-0 flex-1 truncate">{subline}</span>
                {status === "running" && !isOperation && surface.pipeline.length > 0 && <span className="shrink-0 text-[color:var(--ds-fg-muted)]">
                  {surface.pipeline.filter((step) => step.state === "done").length} / {surface.pipeline.length} steps
                </span>}
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


            {isOperation && surface.surfaceKind === "operation" && (
              <div className="flex flex-col gap-[var(--ds-space-base)]">
                <GroupMemberList
                  surface={surface}
                  itemKey={itemGroup?.key ?? String(surface.runId)}
                  members={members}
                  state={state}
                  handlers={handlers}
                />
              </div>
            )}

            {/*
              THE BAND A CROSS-PANEL CHIP LIVES IN (`DemoQueue.tsx:1008-1046`).
              It shares the row body's left edge.

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
            {...(handlers.onPreviewAction === undefined ? {} : { onPreviewAction: (action: 'retry' | 'archive' | 'delete') => handlers.onPreviewAction?.(action, [surface.runId]) })}
            {...(onAction === undefined ? {} : { onAction })}
            nowIso={state.nowIso}
            itemGroup={itemGroup}
            onSelect={handlers.onSelect}
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
  header,
  renderBody,
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
  header?: ReactNode;
  renderBody?: (body: ReactNode) => ReactNode;
}) {
  const { top, membersOf } = partition(surfaces);
  const { displayTop, itemByRunId } = queueItemLayout(top);
  const bands = queueDisplayGroups(displayTop, sort, state.nowIso);

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
  const finished = displayTop.filter((surface) => bandOf(dsStatusOf(surface.status)) === "finished");
  const digestOf = (status: ProposedStatus): number =>
    finished.filter((surface) => dsStatusOf(surface.status) === status).length;
  const digest = {
    done: digestOf("verifiedDone"),
    warned: digestOf("doneWarnings"),
    failed: digestOf("failed"),
    cancelled: digestOf("cancelled"),
  };

  const body = (
      <div data-queue-scroll className="min-h-0 flex-1 overflow-y-auto pb-3">
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
            <div key={band.key ?? "chronological"}>
              {band.key !== null && <div data-queue-band={band.key}
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
              </div>}
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
              {band.rows.map((surface) => {
                const renderRow = (row: QueueSurfaceWire) => {
                  const item = itemByRunId.get(String(row.runId));
                  if (item === undefined) throw new Error(`queue row lost item ${String(row.itemId)}`);
                  const selectedAttempt = item.attempts.find((attempt) => String(attempt.runId) === state.selectedRunId);
                  const visible = state.selectMode === true ? item.representative : selectedAttempt ?? item.representative;
                  return <QueueRow
                    key={item.key}
                    surface={visible}
                    itemGroup={item}
                    members={membersOf.get(String(visible.runId)) ?? []}
                    state={state}
                    handlers={handlers}
                    actionsOf={actionsOf}
                    workflowLabelOf={workflowLabelOf}
                    {...(parentOf === undefined ? {} : { parentOf })}
                  />;
                };
                return renderRow(surface);
              })}
            </div>
          );
        })}
      </div>
  );
  return <section aria-label="Queue" onKeyDown={event => { if (event.key === 'Escape' && state.selectMode === true) { event.preventDefault(); event.stopPropagation(); handlers.onExitSelection?.(); } }} className={cn("flex min-h-0 flex-col overflow-hidden border", dsRadius.lg, dsBorder.base, dsSurface.card)}>
    {renderBody ? renderBody(body) : <>{header ?? <div className={cn("flex shrink-0 items-center border-b px-3", dsSize.hBar, dsBorder.subtle)}><h2 className={cn(dsText.title, "truncate font-semibold")}>{panelLabel}</h2></div>}{body}</>}
  </section>;
});
