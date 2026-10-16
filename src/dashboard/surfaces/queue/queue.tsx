import type { QueueBusinessOutcome } from "../shared/status/status-model.js";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "../../ds/primitives/dropdown-menu.js";
import { memo, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, ArrowRight, ArrowUpRight, ChevronDown, ChevronUp, FileText } from "lucide-react";
import { cn } from "../../lib/utils.js";
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
} from "../../ds/ui.js";
import type { ActionDescriptorWire } from "../../../models/dashboard/actions.js";
import { isTerminalQueueStatus } from "../../../models/dashboard/projection.js";
import {
  FooterActions,
  OutcomeActionButton,
  type DashboardActionHandler,
} from "../shared/actions/actions.js";
import { dayLabel, fmtClock, fmtElapsed, plural, runTiming } from "../shared/status/format.js";
import { testInstanceHazardTitle, testInstanceSystems } from "../shared/status/test-instance-hazard.js";
import { runDisplayId } from "../shared/status/run-display-model.js";
import { StatusBadge } from "../shared/status/status.js";
import {
  PROPOSED_STATUS,
  dsStatusOf,
  statusAccessibleName,
  statusText,
  type ProposedStatus,
} from "../shared/status/status-model.js";
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

/** ── the queue's client-owned view state (ref frontend-backend-integration ) ─────────────────────── */

export interface QueueViewState {
  /** the row the detail panel is showing */
  selectedRunId?: string;
  /** Which member WELLS are open to their tall shape. */
  openWells: ReadonlySet<string>;
  /** bulk-selection mode: checkboxes on top-level rows */
  selectMode?: boolean;
  bulkIds?: ReadonlySet<string>;
  /** The workflow this queue is scoped to. A row of that workflow does not reprint its label —
 * the panel header already said it. */
  panelWorkflowId?: string;
  /** Display-only "now", from the app's bootstrap-calibrated clock (ref frontend-backend-integration
 * last row). Passed in rather than read here so elapsed values are a pure */
  nowIso: string;
}

export interface QueueHandlers {
  onSetBatchGrouping?: (batch: QueueBatch, grouped: boolean) => Promise<void>;
  onSelect: (runId: string) => void;
  /** every command control on a row goes through here — see `./actions.js` */
  onAction?: DashboardActionHandler;
  /** grow this row's member well from 5 lines to 20, or back */
  onToggleWell?: (runId: string) => void;
  /** The dedicated roster route. Rendered ONLY when supplied: the full-list
 * surface is a served People section, and a disclosure */
  onOpenRoster?: (runId: string) => void;
  /** add/remove a row from the bulk target set */
  onToggleBulk?: (runId: string) => void;
  onSelectBulk?: (runId: string) => void;
  onExitSelection?: () => void;
  onPreviewAction?: (action: 'retry' | 'delete', ids: readonly string[]) => void;
  /** Mark a loaded member checked by you. This has no authority effect. */
  /** Jump to the run that delegated this one — the panel switch AND the selection */
  onOpenParent?: (runId: string) => void;
  /** Jump to a run this row DELEGATED TO . Same shape as
 * `onOpenParent` and separate from it on purpose: the wire hands the whole */
  onOpenLinked?: (link: LinkedRunWire) => void;
}

/** What a row needs to draw a route back to its parent: the parent's own
 * identity and status, resolved from the SERVED day projection. It answers */
export type QueueParentLookup = (
  parentRunId: string,
) => { runId: string; title: string; workflowLabel: string; status: ProposedStatus } | undefined;

/** How a surface reaches its served actions. The default is honest emptiness. */
export type QueueActionsOf = (surface: QueueSurfaceWire) => readonly ActionDescriptorWire[];

const NO_ACTIONS: QueueActionsOf = () => [];
const NO_MEMBERS: readonly MemberSurfaceWire[] = [];

/** the band ordering and its sort vocabulary live in `queue-model.ts` — see the note there */
export type { QueueSortKey };

/** ── small row pieces ────────────────────────────────────────────────────── */

/** The served pipeline, one segment per step.
 * The state vocabulary is the wire's own closed enum; each state gets a token */
const STEP_TONE: Record<PipelineStep["state"], string> = {
  done: "bg-ui-info",
  active: "bg-ui-info ring-1 ring-ui-info ring-offset-1 ring-offset-[var(--ds-surface-1)]",
  pending: "bg-[var(--ds-border)]",
  failed: "bg-[var(--ds-danger)]",
  blocked: "bg-[var(--ds-status-waiting-mark)]",
  skipped: "bg-[var(--ds-border-subtle)]",
  // the pipeline's own `cancelled` arm, in the same hue the run-detail timeline
  // draws a cancelled step: one span, one word, one colour.
  cancelled: "bg-[var(--ds-status-cancelled-mark)]",
};

/** One step, including only served measurements.
 * Ported from the demo's own `MicroSteps` title */
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


type RowChipTone = "neutral" | "info" | "warning" | "rehearsal";

const ROW_CHIP_TONE: Record<RowChipTone, string> = {
  neutral: "border-[color:var(--ds-recess-border)] bg-[var(--ds-recess-bg)] text-[color:var(--ds-recess-fg-quiet)]",
  info: "border-[color:var(--ds-info-border)] bg-[var(--ds-info-bg)] text-[color:var(--ds-info-fg)]",
  warning: "border-[color:var(--ds-status-waiting-border)] bg-[var(--ds-status-waiting-bg)] text-[color:var(--ds-status-waiting-fg)]",
  /* Give rehearsals a distinct hue from warning and test-instance chips. */
  rehearsal: "border-[color:var(--ds-rehearsal-border)] bg-[var(--ds-rehearsal-bg)] text-[color:var(--ds-rehearsal-fg)]",
};

const rowChip = (tone: RowChipTone, extra?: string): string =>
  cn(
    // Chips truncate inside their borders; wrapping would spill values outside their track.
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
  outcome,
  surface,
  status,
  nowIso,
}: {
  outcome?: QueueBusinessOutcome;
  surface: QueueSurfaceWire;
  status: ProposedStatus;
  /** the bootstrap-calibrated instant every elapsed on this panel measures against */
  nowIso: string;
}) {
  const testSystems = testInstanceSystems(surface.resolvedInstances);
  /** Share served gate age with accessible naming; updatedAt must not make old gates appear young. */
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
      {/* Display served dryRun visibly so rehearsals cannot be mistaken for real filing. */}
      {surface.dryRun && (
        <span
          title="Dry run — this rehearsal reads the systems and writes nothing."
          className={rowChip("rehearsal", cn(dsText.caps, "tracking-[var(--ds-tracking-caps)]"))}
        >
          dry run
        </span>
      )}
      {/* Missing warning counts imply at least one only for warning-complete rows; other statuses invent no count. */}
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
        outcome={outcome}
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

/** Render only the served live message; absence must not receive manufactured progress text. */
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

/** One provenance line; unusually long aliases yield before the clock and controls. */
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
  onPreviewAction?: (action: 'retry' | 'delete') => void;
}) {
  // Settled durations need a served end; never substitute now for an unmeasured terminal run.
  const timing = isTerminalQueueStatus(surface.status) && surface.endedAt.state === "absent"
    ? undefined : runTiming(surface, nowIso, isTerminalQueueStatus);
  return (
    <div
      data-queue-row-footer
      className={cn(
        // THE recessed plane: a fill, no line.
        "flex items-center gap-[var(--ds-space-base)] border-t px-[var(--ds-space-cozy)] py-[var(--ds-space-tight)]",
        dsBorder.subtle,
        "bg-[var(--ds-recess-bg)]",
      )}
    >
      <div
        className={cn(
          dsText.meta,
          dsText.nums,
          "flex min-h-[var(--ds-h-sm)] min-w-0 flex-1 flex-nowrap items-center",
          "gap-[var(--ds-space-base)] text-[color:var(--ds-fg-muted)]",
        )}
      >
        <span className="shrink-0 whitespace-nowrap">{fmtClock(surface.startedAt)}</span>
        <QueueAttemptSelector
          title={queueRowTitle(surface)}
          surface={surface}
          item={itemGroup}
          selectedRunId={String(surface.runId)}
          onSelect={onSelect}
        />
        {/* The compact alias is display-only; the tooltip retains the exact trace. */}
        <span className="min-w-0 truncate text-[color:var(--ds-fg-secondary)]" title={surface.traceId}>
          {runDisplayId(surface.runId, surface.traceId)}
        </span>
        {timing !== undefined && (
          <span className="shrink-0 whitespace-nowrap" {...(timing.title === undefined ? {} : { title: timing.title })}>
            {timing.text}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-[var(--ds-space-hair)]">
        <FooterActions
          actions={actions}
          target={{ runId: surface.runId, expectedVersion: surface.rowRevision }}
          onPreviewAction={onPreviewAction}
          {...(onAction === undefined ? {} : { onAction })}
        />
      </div>
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
            aria-label={selectionLabel} aria-pressed={selected} onClick={(event) => { event.stopPropagation(); onSelect(String(surface.runId)); }}
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
  /** Offer roster navigation only when its destination handler exists. */
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
      {/* Inline inspection and roster navigation serve different tasks; expansion does not remove the route. */}
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

/** Redirects keep one recognizable shape and complete labels across wrapping rows. */
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

/** Use served child label, status and route; current-day lookup loses cross-day links. */
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

/** Receipt facts are one served derivation; never infer absent actions or statuses from their text. */
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
      className={cn("inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-caption text-ui-muted hover:bg-ui-hover hover:text-ui-primary", dsFocus)}>
      #{surface.attempt}<ChevronDown aria-hidden className="size-3" />
    </BareButton></DropdownMenuTrigger>
    <DropdownMenuContent aria-label={`Attempts for ${title}`} className="w-56" onClick={event => event.stopPropagation()}>
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
  outcome,
  surface,
  itemGroup,
  members = NO_MEMBERS,
  state,
  handlers,
  actionsOf = NO_ACTIONS,
  workflowLabelOf,
  parentOf,
  deferOffscreen = false,
}: {
  outcome?: QueueBusinessOutcome;
  surface: QueueSurfaceWire;
  itemGroup?: QueueItemGroup;
  /** the joined member surfaces, for an operation row */
  members?: readonly MemberSurfaceWire[];
  state: QueueViewState;
  handlers: QueueHandlers;
  actionsOf?: QueueActionsOf;
  workflowLabelOf: (workflowId: string) => string;
  /** Resolve parents across the whole day because delegation can cross workflows. */
  parentOf?: QueueParentLookup;
  deferOffscreen?: boolean;
}) {
  const status = dsStatusOf(surface.status);
  const announcing = useAttentionAnnounce(status);
  const selected = itemGroup?.attempts.some((attempt) => String(attempt.runId) === state.selectedRunId)
    ?? state.selectedRunId === surface.runId;
  const actions = actionsOf(surface);
  const target = { runId: surface.runId, expectedVersion: surface.rowRevision };
  const workflowLabel = workflowLabelOf(surface.workflowId);
  /** Operation identity and visible member lists are distinct; unloaded members do not erase group chrome. */
  const isOperation = surface.surfaceKind === "operation";
  const membersVisible = isOperation && members.length > 0;
  /** Hide a group’s redundant subline while its member evidence is visible. */
  const subline =
    membersVisible || surface.liveMessage.state !== "present" ? undefined : surface.liveMessage.value;
  const parent = surface.lineage.state === "child" ? parentOf?.(surface.lineage.parentRunId) : undefined;
  /** Redirects own spare width; neighboring facts retain readable natural widths. */
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
        <div
          onClick={event => {
            if (event.detail > 1) return;
            if (state.selectMode === true) handlers.onToggleBulk?.(surface.runId);
            else handlers.onSelect(surface.runId);
          }}
          role="button"
          tabIndex={0}
          aria-pressed={selected}
          // Accessible row names include warning completion and gate age, never hue alone.
          aria-label={queueRowAccessibleName(surface, state.nowIso)}
          data-demo-row-id={surface.runId}
          onKeyDown={(event) => {
            // Nested controls keep native Enter/Space activation. Only the
            // focused row itself uses those keys to open its detail.
            if (event.target !== event.currentTarget) return;
            if (event.key === 'Escape' && state.selectMode === true) { event.preventDefault(); event.stopPropagation(); handlers.onExitSelection?.(); return; }
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              if (state.selectMode === true) handlers.onToggleBulk?.(surface.runId);
              else handlers.onSelect(surface.runId);
            }
          }}
          className={cn(
            "group relative flex min-w-0 flex-1 cursor-pointer flex-col overflow-hidden border",
            deferOffscreen && "[content-visibility:auto] [contain-intrinsic-size:auto_160px]",
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
                  // A renamed row’s subject identity outranks a tooltip repeating its truncated custom name.
                  {...(titleTooltip === undefined ? {} : { title: titleTooltip })}
                >
                  {queueRowTitle(surface)}
                </span>
                {/* Name workflow ownership only when the surface mixes workflows. */}
                {surface.workflowId !== state.panelWorkflowId && (
                  <span className={rowChip("neutral", cn(dsText.caps, "tracking-[var(--ds-tracking-caps)]"))}>
                    {workflowLabel}
                  </span>
                )}
              </div>
              <div className="ml-auto flex shrink-0 flex-nowrap items-center justify-end gap-[var(--ds-space-snug)]">
                {/* Status ALWAYS sits on the title row's right — never on the
                    subline. */}
                <HeaderChips outcome={outcome} surface={surface} status={status} nowIso={state.nowIso} />
              </div>
            </div>

            {/* Group previews supply identity only while their member list is hidden; absent previews invent no names. */}
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
                  /* Do not offer jumps to evidence the current card already renders. */
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

            {/* Render only served links and receipt facts; never infer an extracted-person count from arbitrary output arrays. */}
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
            {...(handlers.onPreviewAction === undefined ? {} : { onPreviewAction: (action: 'retry' | 'delete') => handlers.onPreviewAction?.(action, [surface.runId]) })}
            {...(onAction === undefined ? {} : { onAction })}
            nowIso={state.nowIso}
            itemGroup={itemGroup}
            onSelect={handlers.onSelect}
          />
        </div>
    </div>
  );
}

/** Filter empty states use the status vocabulary, never raw wire keys. */
export type QueueFilterScope = { kind: "needsYou" } | { kind: "status"; word: string };

const MemoQueueRow = memo(QueueRow, (before, after) => {
  const shallowEqual = (left: object, right: object): boolean => {
    const entries = Object.entries(left);
    return entries.length === Object.keys(right).length
      && entries.every(([key, value]) => value === Reflect.get(right, key));
  };
  const { state: beforeState, handlers: beforeHandlers, ...beforeProps } = before;
  const { state: afterState, handlers: afterHandlers, ...afterProps } = after;
  const { selectedRunId: beforeSelected, ...beforeView } = beforeState;
  const { selectedRunId: afterSelected, ...afterView } = afterState;
  if (!shallowEqual(beforeProps, afterProps) || !shallowEqual(beforeHandlers, afterHandlers)
    || !shallowEqual(beforeView, afterView)) return false;
  if (beforeSelected === afterSelected) return true;
  const belongs = (id: string | undefined): boolean => id !== undefined && (
    String(after.surface.runId) === id
    || after.itemGroup?.attempts.some(attempt => String(attempt.runId) === id) === true
    || after.members?.some(member => String(member.runId) === id) === true
  );
  return !belongs(beforeSelected) && !belongs(afterSelected);
});

/** Keep memoized queue props stable between deliberate live-clock ticks. */
export const QueuePanel = memo(function QueuePanel({
  outcomes,
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
  outcomes?: ReadonlyMap<string, QueueBusinessOutcome>;
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
  /** Finished today applies only to the live day partition. */
  isToday?: boolean;
  /** the active filter, absent when the scope is `All` */
  filter?: QueueFilterScope;
  /** the toolbar's ordering control; the default passes the projection through */
  sort?: QueueSortKey;
  header?: ReactNode;
  renderBody?: (body: ReactNode) => ReactNode;
}) {
  const { top, membersOf } = useMemo(() => partition(surfaces), [surfaces]);
  const { displayTop, itemByRunId } = useMemo(() => queueItemLayout(top), [top]);
  const bands = queueDisplayGroups(displayTop, sort, state.nowIso);

  /** The digest counts drawn finished rows; it cannot replace authoritative day totals. */
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
              {/* The navigator already identifies the displayed day. */}
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
                {/* Band counts describe visible rows; day totals belong to the served status projection. */}
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
              {/* Show day-finished summaries only under All; filtered subsets cannot claim day totals. */}
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
                  return <MemoQueueRow
                    key={item.key}
                    surface={visible}
                    outcome={outcomes?.get(String(visible.runId))}
                    itemGroup={item}
                    members={membersOf.get(String(visible.runId)) ?? NO_MEMBERS}
                    deferOffscreen={displayTop.length > 100}
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
