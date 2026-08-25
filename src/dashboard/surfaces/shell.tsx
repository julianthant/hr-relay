/**
 * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * src/dashboard/components/dev/rebuild-demo/DemoShell.tsx — the Workflow Panel
 * (three display modes), the Status Bar, and the Session Panel.
 *
 * THE ONE COUNT PATH (D81) is the load-bearing rule in this file, and here it
 * is structural rather than disciplined: nothing below counts anything. The
 * Workflow Panel badges read `workflowCounts`, the Status Bar pills read
 * `statusCounts`, the day total reads `monthCounts` — all three served by the
 * same projection transaction as the rows themselves, so two surfaces cannot
 * disagree because there is no second derivation for them to disagree from.
 *
 * The demo's counting helpers (`countRows`, `countRowsByWorkflow`,
 * `railEntryCounts`, `attentionAcrossWorkflows`) are deliberately NOT ported:
 * every one of them folded a row array, which is precisely the second path this
 * projection exists to delete.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent, type ReactElement, type SVGProps, type UIEvent } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Eye,
  LayoutDashboard,
  Minus,
  PanelLeft,
  PanelLeftClose,
  PanelLeftOpen,
  PictureInPicture2,
} from "lucide-react";
import { cn } from "../lib/utils.js";
import {
  Button,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  StatusDot,
  Tooltip,
  dsBorder,
  dsElev,
  dsFocus,
  dsIcon,
  dsLayer,
  dsMotion,
  dsRadius,
  dsSize,
  dsSurface,
  dsText,
} from "../ds/ui.js";


import type { SubscriptionState } from "../client/index.js";
import { PROPOSED_STATUS, dsStatusOf, type QueueStatus } from "./status-model.js";
import { SYSTEM_LABEL } from "./system-chip-model.js";
import { elapsedSecondsBetween, fmtElapsed, plural } from "./format.js";
import {
  type WorkflowGroupEntry,
} from "./workflow-category.js";
import {
  ALWAYS_TALLIED,
  STATUS_PILL_ORDER,
  type StatusBucket,
  type StatusCountWire,
  WORKER_STATE_ORDER,
  WORKER_STOP_REASON_LABEL,
  WORKER_TONE,
  WORKFLOW_PANEL_MODE_LABEL,
  type WorkerCardWire,
  type WorkerPoolWire,
  type SessionMemberView,
  type SessionGroupView,
  type SessionListItem,
  type SessionListLayoutRow,
  type SessionView,
  type WorkerSessionMembership,
  type WorkerState,
  type WorkflowBootstrapPrimitive,
  type WorkflowCountWire,
  type QueueSurfaceWire,
  type WorkflowPanelMode,
  activeCount,
  buildSessionListLayout,
  buildWorkflowRailGroups,
  buildSessionPanelView,
  canStopWorker,
  capacityChip,
  connectionTone,
  needsYouCount,
  SESSION_LIST_DEFAULT_VIEWPORT_HEIGHT,
  sessionPoolDisplay,
  sessionListNavigationTarget,
  sessionListScrollTopForIndex,
  sessionListVisibleIndex,
  sessionListWindow,
  statusCount,
  toolbarControl,
  totalCount,
  workerDirectiveNote,
  workerElapsedSeconds,
  workflowCount,
  workflowStatusCounts,
} from "./shell-model.js";

const WORKFLOW_PANEL_ID = "dashboard-workflow-panel";
const WORKFLOW_PANEL_TOGGLE_ID = "dashboard-workflow-panel-toggle";

interface PanelModeProps {
  mode: WorkflowPanelMode;
  onMode: (mode: WorkflowPanelMode) => void;
}

/**
 * The panel's own window controls. Every transition is one press from here or
 * from the toggle, and `w` cycles all three from anywhere — a state you can only
 * reach with the mouse is one a keyboard operator does not have.
 */
function WorkflowPanelControls({ mode, onMode }: PanelModeProps) {
  return (
    <span className="flex shrink-0 items-center gap-[var(--ds-space-hair)]">
      {mode === "sidebar" ? (
        <IconButton
          size="sm"
          label="Float the Workflow Panel"
          onClick={() => onMode("floating")}
          icon={<PictureInPicture2 aria-hidden className={dsIcon.md} />}
        />
      ) : (
        <IconButton
          size="sm"
          label="Dock the Workflow Panel as a sidebar"
          onClick={() => onMode("sidebar")}
          icon={<PanelLeft aria-hidden className={dsIcon.md} />}
        />
      )}
      <IconButton
        size="sm"
        label="Minimise the Workflow Panel to an icon"
        onClick={() => onMode("icon")}
        icon={<Minus aria-hidden className={dsIcon.md} />}
      />
    </span>
  );
}

/**
 * The launcher, and the one control present in all three modes.
 *
 * ONE NUMBER, AND IT IS THE DEMAND. It carries ACTIVE — queued + running —
 * across EVERY workflow on the selected day, the same quantity as the rail's
 * orange `active` column summed down its length, so the collapsed badge and the
 * open list cannot disagree. It used to carry the day's row TOTAL, which lit
 * the amber on an idle day and is a number nobody acts on.
 *
 * The demo derived both from a row array; here they are read off the day's
 * served `statusCounts`, which is day-scoped across workflows and therefore
 * gives `queued + running` exactly — no second fold, no second corpus (D81).
 *
 * The scope survives in the tooltip and the accessible name, both of which say
 * the count spans every workflow, and the control carries the workflow's 2-char
 * code — the prefix of every one of its trace ids — so it is never an anonymous
 * glyph. At zero the number dims rather than vanishing, so the action bar does
 * not reflow every time the day goes idle.
 */
export function WorkflowPanelToggle({
  mode,
  onMode,
  activeWorkflowLabel,
  activeWorkflowCode,
  dayActive,
  dayCount,
}: PanelModeProps & {
  activeWorkflowLabel: string;
  /** the active workflow's served 2-char code — the prefix of its trace ids */
  activeWorkflowCode: string;
  /** queued + running across every workflow on the selected day */
  dayActive: number;
  /** the selected day's served row total — the denominator of the sentence */
  dayCount: number;
}) {
  const showing = mode !== "icon";
  const scope = `${dayActive} of ${plural(dayCount, "row")} across every workflow are queued or running today`;
  return (
    <button
      id={WORKFLOW_PANEL_TOGGLE_ID}
      type="button"
      aria-expanded={showing}
      aria-controls={mode === "floating" ? WORKFLOW_PANEL_ID : undefined}
      // The count goes in the LABEL, not only in the badge: an `aria-label`
      // replaces a button's contents outright, so the number was being
      // announced to nobody — the thing this control exists to carry.
      aria-label={`Workflow Panel — ${activeWorkflowLabel}${showing ? `, ${WORKFLOW_PANEL_MODE_LABEL[mode]}` : ", minimised"}. ${scope}`}
      title={`Workflow Panel — ${activeWorkflowLabel} (${activeWorkflowCode})\n${scope}\nThe Status Bar's Needs you pill is attention, not this count\nw cycles floating · icon · sidebar`}
      onClick={() => onMode(showing ? "icon" : "floating")}
      className={cn(
        toolbarControl(),
        dsMotion.fast,
        "active:translate-y-px",
        showing
          ? cn(dsBorder.loud, "bg-[var(--ds-surface-selected)] font-semibold text-[color:var(--ds-fg)]")
          : cn(dsBorder.strong, dsSurface.card, "text-[color:var(--ds-fg-muted)] hover:bg-[var(--ds-surface-3)] hover:text-[color:var(--ds-fg)]"),
      )}
    >
      {showing ? (
        <PanelLeftClose aria-hidden className={dsIcon.sm} />
      ) : (
        <PanelLeftOpen aria-hidden className={dsIcon.sm} />
      )}
      <span className={dsText.nums}>{activeWorkflowCode}</span>
      {/* The rule separates the panel you are IN from a count that belongs to
          the whole day. It sits on the control's OWN surface, where
          `--ds-border` against a white card is not a line anybody sees. */}
      <span aria-hidden className={cn("mx-[var(--ds-space-hair)] h-4 w-px shrink-0", "bg-[var(--ds-border-loud)]")} />
      {/* ACTIVE (queued + running) across every workflow — same orange as the
          rail's left column, and the same total when you add that column down. */}
      <span
        className={cn(
          dsText.nums,
          "shrink-0 tabular-nums",
          dsMotion.base,
          dayActive > 0
            ? "font-semibold text-[color:var(--ds-status-waiting-fg)]"
            : "text-[color:var(--ds-fg-faint)]",
        )}
      >
        {dayActive}
      </span>
    </button>
  );
}

function WorkflowEntryList({
  workflows,
  counts,
  activeWorkflowId,
  onActive,
}: {
  workflows: readonly WorkflowBootstrapPrimitive[];
  counts: readonly WorkflowCountWire[];
  activeWorkflowId: string;
  onActive: (workflowId: string) => void;
}) {
  const groups = useMemo(() => buildWorkflowRailGroups(workflows), [workflows]);

  const entry = (node: WorkflowGroupEntry<WorkflowBootstrapPrimitive>): ReactElement => {
    const workflow = node.entry;
    const id = String(workflow.id);
    const total = workflowCount(counts, id);
    const active = activeCount(workflowStatusCounts(counts, id));
    const on = id === activeWorkflowId;
    const labelWeight = on
      ? "font-semibold text-[color:var(--ds-fg)]"
      : "font-medium text-[color:var(--ds-fg-secondary)]";
    return (
      <button
        type="button"
        aria-current={on ? "page" : undefined}
        onClick={() => onActive(id)}
        className={cn(
          "group flex w-full cursor-pointer items-stretch text-left",
          "gap-[var(--ds-space-base)] pl-[var(--ds-space-tight)] pr-[var(--ds-space-base)]",
          dsSize.hRow,
          dsRadius.md,
          dsFocus,
          dsMotion.base,
          on ? "bg-[var(--ds-surface-selected)]" : "hover:bg-[var(--ds-surface-3)]",
        )}
      >
        {/* The 3px marker is the non-colour cue for "this is the panel you are
            in" — the fill alone is too quiet at this density. */}
        <span
          aria-hidden
          className={cn(
            "my-[var(--ds-space-snug)] w-[var(--ds-border-w-rail)] rounded-r-full",
            dsMotion.base,
            on ? "bg-[var(--ds-ring)]" : "bg-transparent group-hover:bg-[var(--ds-border-loud)]",
          )}
        />
        <span className="flex min-w-0 flex-1 items-center gap-[var(--ds-space-snug)]">
          <span className={cn(dsText.ui, "truncate", labelWeight)}>{workflow.label}</span>
        </span>
        {/* `active │ all`, PER WORKFLOW, and it is the ONLY badge on the row —
            both numbers off the SAME served projection the Status Bar and the
            queue read. `active` is queued + running, so the column says what
            the panel is DOING rather than what it has not begun: `queued`
            alone empties the moment a run starts, and every panel wearing a
            run then read `0`.

            Active (left) wears the same amber as the launcher badge, and at
            zero each arm DIMS rather than disappearing so the eye does not
            have to re-scan an idle panel. */}
        <span
          title={`${workflow.label}: ${active} active (queued or running) of ${plural(total, "row")} today`}
          aria-label={`${active} active of ${total} in ${workflow.label}`}
          className={cn(
            dsText.meta,
            dsText.nums,
            // The row gap alone leaves a truncated label crowding the numbers;
            // this pad keeps the label→count boundary at 16px minimum.
            "flex shrink-0 items-center justify-end gap-[var(--ds-space-hair)] pl-[var(--ds-space-base)]",
          )}
        >
          <span
            className={
              active === 0
                ? "text-[color:var(--ds-fg-faint)]"
                : "font-semibold text-[color:var(--ds-status-waiting-fg)]"
            }
          >
            {active}
          </span>
          <span aria-hidden className="text-[color:var(--ds-fg-faint)]">│</span>
          <span
            className={
              total === 0
                ? "text-[color:var(--ds-fg-faint)]"
                : on
                  ? "font-semibold text-[color:var(--ds-fg)]"
                  : "text-[color:var(--ds-fg-secondary)]"
            }
          >
            {total}
          </span>
        </span>
      </button>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto py-[var(--ds-space-cozy)]">
      {/* The pair is named ONCE, as a column head, not per row: two bare
          numbers beside a rule is exactly the anonymous-badge problem the
          launcher had, and a caption on every entry would be the same word
          fourteen times. */}
      <div
        className={cn(
          dsText.caps,
          "flex items-center justify-end gap-[var(--ds-space-hair)] px-[var(--ds-space-cozy)] pb-[var(--ds-space-snug)] text-[color:var(--ds-fg-muted)]",
        )}
      >
        <span>active</span>
        <span aria-hidden className="text-[color:var(--ds-fg-faint)]">│</span>
        <span>all</span>
      </div>
      {groups.map((group) => (
        <div key={group.label} className="pb-[var(--ds-space-cozy)]">
          {/* More air above a group heading than below it — the label belongs to
              the list under it, not to the one it just left. */}
          <div className={cn(dsText.caps, "px-[var(--ds-space-cozy)] pb-[var(--ds-space-snug)] text-[color:var(--ds-fg-muted)]")}>
            {group.label}
          </div>
          <ul className="flex flex-col gap-px px-[var(--ds-space-snug)]">
            {group.entries.map((node) => (
              <li key={String(node.entry.id)}>{entry(node)}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** The header both presentations share: the surface's name, then its controls. */
function WorkflowPanelHeader({ mode, onMode }: PanelModeProps) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center border-b",
        dsSize.hBar,
        dsBorder.subtle,
        "gap-[var(--ds-space-base)] pl-[var(--ds-space-cozy)] pr-[var(--ds-space-snug)]",
      )}
    >
      <span className={cn(dsText.caps, "min-w-0 flex-1 truncate text-[color:var(--ds-fg-muted)]")}>Workflow Panel</span>
      <WorkflowPanelControls mode={mode} onMode={onMode} />
    </div>
  );
}

interface WorkflowPanelProps extends PanelModeProps {
  workflows: readonly WorkflowBootstrapPrimitive[];
  counts: readonly WorkflowCountWire[];
  activeWorkflowId: string;
  onActive: (workflowId: string) => void;
}

/** `sidebar` — docked, consuming a rail column, exactly as it always did. */
export function WorkflowSidebar({ mode, onMode, ...list }: WorkflowPanelProps) {
  return (
    <nav
      aria-label="Workflow Panel"
      className={cn("flex min-h-0 shrink-0 flex-col border-r", dsSize.wRail, dsBorder.base, dsSurface.card)}
    >
      <WorkflowPanelHeader mode={mode} onMode={onMode} />
      <WorkflowEntryList {...list} />
    </nav>
  );
}

/**
 * `floating` — the same panel as a window over the panel region.
 *
 * Deliberately NOT built on `Popover`/`Dialog`: both register modal presence,
 * which makes the toast viewport step aside and go inert for as long as they
 * are mounted, and this is a DEFAULT state — a shell that boots with its toasts
 * permanently inert would be reporting a bug, not a design. So it composes the
 * sanctioned floating tokens directly and owns the three things Radix would
 * have given it: Escape, outside-click, and focus.
 *
 * Focus is scoped, not seized. Tab cycles inside the window once the caret is
 * in it and Escape leaves — but the window never pulls focus off the queue just
 * because it happens to be the persisted mode on a fresh load.
 */
export function WorkflowWindow({
  mode,
  onMode,
  opened,
  ...list
}: WorkflowPanelProps & { opened: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [entered, setEntered] = useState(!opened);

  // It arrives from the toggle above it — so it is allowed to be animated, and
  // only when it actually arrived rather than was already there.
  useEffect(() => {
    if (entered) return;
    const id = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(id);
  }, [entered]);

  // Opened by a press: put the caret on the panel you are in, so the keyboard
  // route into the list is one press and not fourteen tabs.
  useEffect(() => {
    if (!opened) return;
    ref.current?.querySelector<HTMLElement>('[aria-current="page"]')?.focus();
  }, [opened]);

  // Clicking anywhere else dismisses it. Capture phase, so the click that
  // dismisses the window still reaches the row it landed on — you never lose a
  // press to a panel you were finished with.
  useEffect(() => {
    const onDown = (event: PointerEvent): void => {
      const element = ref.current;
      const target = event.target;
      if (element === null || !(target instanceof Node)) return;
      if (element.contains(target)) return;
      // The toggle owns its own press; letting this fire too would minimise and
      // re-open in one click.
      if (document.getElementById(WORKFLOW_PANEL_TOGGLE_ID)?.contains(target) === true) return;
      onMode("icon");
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [onMode]);

  /**
   * Hand focus back to the launcher — but ONLY when it was inside the window.
   * Stealing it from whatever the operator just clicked would be worse than not
   * returning it at all, which is why the outside-click path above does not
   * route through here.
   */
  const leave = useCallback(
    (next: WorkflowPanelMode) => {
      if (ref.current?.contains(document.activeElement) === true) {
        document.getElementById(WORKFLOW_PANEL_TOGGLE_ID)?.focus();
      }
      onMode(next);
    },
    [onMode],
  );

  return (
    <div
      ref={ref}
      id={WORKFLOW_PANEL_ID}
      role="dialog"
      aria-label="Workflow Panel"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          leave("icon");
          return;
        }
        if (event.key !== "Tab") return;
        const focusable = Array.from(
          ref.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? [],
        );
        if (focusable.length === 0) return;
        const edge = event.shiftKey ? focusable[0] : focusable[focusable.length - 1];
        if (document.activeElement !== edge) return;
        event.preventDefault();
        (event.shiftKey ? focusable[focusable.length - 1] : focusable[0]).focus();
      }}
      className={cn(
        "absolute left-[var(--ds-space-cozy)] flex flex-col overflow-hidden border",
        "inset-y-[var(--ds-space-cozy)]",
        dsSize.wRail,
        dsLayer.menu,
        dsRadius.lg,
        dsElev.high,
        dsMotion.enter,
        "origin-top-left border-[color:var(--ds-border-strong)] bg-[var(--ds-surface-overlay)]",
        entered ? "translate-y-0 scale-100 opacity-100" : "-translate-y-1 scale-[0.985] opacity-0",
      )}
    >
      <WorkflowPanelHeader mode={mode} onMode={leave} />
      <WorkflowEntryList {...list} />
    </div>
  );
}

/**
 * The queue's status filters — one GROUP inside the composed action bar.
 *
 * Two structural rules from the demo survive intact:
 *  - **The composites are a segmented control.** One bordered container with
 *    two segments, like the Top Bar's view switcher. A different SHAPE for a
 *    different kind of thing beats a hairline asking the eye to infer it.
 *  - **A zero genuinely recedes** — it drops its border, its fill AND its
 *    label, down to an icon and a `0` at `--ds-fg-faint`. It is still there, it
 *    is still clickable, and it still carries its full name to a screen reader.
 *
 * ONE DELIBERATE DEPARTURE FROM THE DEMO, and the operator filed it as a
 * defect. Every hint in this group was a native `title`, which the browser
 * paints as an OS widget AT THE CURSOR: it is anchored to the pointer rather
 * than to the control, so it lands over the rows below the bar and reads as
 * detached from the thing it is about. The `Tooltip` primitive is what
 * DESIGN.md already names for a hint — it anchors to its trigger, floats above
 * it, flips on collision, and is drawn in the product's own surface tokens. The
 * accessible name on each control is unchanged and still carries the status and
 * its count, so nothing load-bearing moved into a hover-only surface.
 */
export function StatusFilters({
  statusCounts,
  active,
  onSelect,
}: {
  /**
   * The ACTIVE workflow's served per-status counts — the same scope as the
   * queue below the bar (R4-1). The band used to be handed the day's counts
   * folded across every workflow, so `Failed 3` could sit above a queue with
   * zero failures and the ported title "Every row in this view" was false.
   * `All` folds this same array (R4-2), so every number in the group answers
   * one question about one scope.
   */
  statusCounts: readonly StatusCountWire[];
  active: StatusBucket;
  onSelect: (bucket: StatusBucket) => void;
}) {
  const scope = (
    key: "all" | "needsYou",
    label: string,
    Icon: ComponentType<SVGProps<SVGSVGElement>>,
    tone: string,
    title: string,
    value: number,
    edge: "start" | "end",
  ): ReactElement => {
    const on = active === key;
    return (
      <Tooltip key={key} content={title} side="top">
      <button
        type="button"
        aria-pressed={on}
        onClick={() => onSelect(on ? "all" : key)}
        className={cn(
          // Same OUTER height as every status pill (`--ds-h-toolbar`).
          "inline-flex h-[var(--ds-h-toolbar)] shrink-0 cursor-pointer items-center border",
          "gap-[var(--ds-space-tight)] px-[var(--ds-space-base)]",
          edge === "start" ? "rounded-l-[var(--ds-radius-md)] border-r-0" : "rounded-r-[var(--ds-radius-md)]",
          dsBorder.base,
          dsText.meta,
          dsText.flush,
          dsFocus,
          dsMotion.fast,
          on
            ? "bg-[var(--ds-surface-3)] font-semibold text-[color:var(--ds-fg)]"
            : "bg-[var(--ds-surface-2)] font-medium text-[color:var(--ds-fg-muted)] hover:text-[color:var(--ds-fg)]",
        )}
      >
        <Icon aria-hidden className={cn(dsIcon.sm, "shrink-0", tone)} />
        {label}
        <span className={dsText.nums}>{value}</span>
      </button>
      </Tooltip>
    );
  };

  const statusPill = (status: QueueStatus): ReactElement => {
    const on = active === status;
    const value = statusCount(statusCounts, status);
    const empty = value === 0 && !on;
    const spec = PROPOSED_STATUS[dsStatusOf(status)];
    const Icon = spec.icon;
    return (
      <Tooltip key={status} content={spec.meaning} side="top">
      <button
        type="button"
        aria-pressed={on}
        // The ACCESSIBLE name, not the drawn word: `verifiedDone` and
        // `doneWarnings` both DRAW `Done`, separated by hue and by the amber
        // triangle — so the two filters computed the identical name
        // `Done — 2` and a screen-reader operator could not tell which pill
        // was which (D22, amended 2026-08-04). The visible pill is untouched.
        aria-label={`${spec.accessibleLabel} — ${value}`}
        onClick={() => onSelect(on ? "all" : status)}
        className={cn(
          "inline-flex shrink-0 cursor-pointer items-center border",
          // ONE BOX, WHATEVER IS IN IT. Height AND inset are the bar's
          // constants for every pill. An empty bucket gives up its FILL, its
          // EDGE and its word — that cue is real, and a full bucket must not
          // look like an empty one — but never its padding, which was making a
          // row of identically sized controls read as three different sizes.
          "h-[var(--ds-h-toolbar)] gap-[var(--ds-space-snug)] px-[var(--ds-space-base)]",
          empty && "border-transparent",
          dsRadius.md,
          dsText.meta,
          dsText.flush,
          dsFocus,
          dsMotion.fast,
          on
            ? cn(dsBorder.loud, "bg-[var(--ds-surface-selected)] font-semibold text-[color:var(--ds-fg)]")
            : empty
              ? "text-[color:var(--ds-fg-faint)] hover:bg-[var(--ds-surface-3)] hover:text-[color:var(--ds-fg-muted)]"
              : cn(dsBorder.base, dsSurface.card, "text-[color:var(--ds-fg-muted)] hover:bg-[var(--ds-surface-3)] hover:text-[color:var(--ds-fg)]"),
        )}
      >
        <Icon
          aria-hidden
          className={cn(
            dsIcon.sm,
            "shrink-0",
            empty ? "text-[color:var(--ds-fg-faint)]" : spec.soloTone,
            status === "running" && value > 0 && "animate-spin motion-reduce:animate-none",
          )}
        />
        {/* A status that is not happening spends an icon and a digit, not a
            word. The word is still its accessible name. */}
        {!empty && spec.label}
        <span className={dsText.nums}>{value}</span>
      </button>
      </Tooltip>
    );
  };

  return (
    // A status is never hidden behind an overflow menu — one you cannot click
    // is one you cannot triage — so at a narrow window the group scrolls.
    <div
      role="group"
      aria-label="Filter the queue by status"
      className="flex min-w-0 items-center gap-[var(--ds-space-tight)] overflow-x-auto"
    >
      <div className="inline-flex h-[var(--ds-h-toolbar)] shrink-0" role="group" aria-label="Scope the queue">
        {scope(
          "all",
          "All",
          LayoutDashboard,
          "text-[color:var(--ds-fg-muted)]",
          "Every row in this view",
          totalCount(statusCounts),
          "start",
        )}
        {scope(
          "needsYou",
          "Needs you",
          Eye,
          "text-[color:var(--ds-status-waiting-fg)]",
          "Waiting on you + Write parked — the two states that are stuck on a decision from you",
          needsYouCount(statusCounts),
          "end",
        )}
      </div>
      {STATUS_PILL_ORDER.map(statusPill)}
    </div>
  );
}

/**
 * ONE browser session this worker holds (D248, R7-3).
 *
 * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * `DemoShell.tsx:1436-1516` (`BrowserTile`), with two deliberate divergences,
 * both of them the demo's own honest arm rather than a reduction of it:
 *
 * - **Every tile reads `Not checked`**, which is the demo's `unknown` tone and
 *   carries its comment verbatim — *it must NOT read as healthy.* Nothing in
 *   this build probes a live session, so any other word would be a health
 *   claim nobody made.
 * - **The second line is the session's AGE, not a URL.** No span, checkpoint or
 *   lease records a page address; composing one from the system id would put a
 *   plausible-looking string where an observation belongs. How long a session
 *   has been open is a fact the wire actually carries.
 *
 * The demo's right-click menu (Peek / Check now / Bring to front / Refresh /
 * Reopen / Pause auto-recovery) is NOT ported. `refresh-browser` and
 * `reopen-browser` are real kernel verbs whose process effects the dashboard
 * supervisor refuses BY NAME (`server/dashboard/compose.ts` —
 * `refreshBrowser`/`reopenBrowser` are undefined on purpose, ref execution-and-sessions's live
 * lane), so every item would open a menu that 500s on click.
 */
function BrowserTile({
  browser,
  span,
  nowIso,
}: {
  browser: WorkerCardWire["browsers"][number];
  span: boolean;
  nowIso: string;
}) {
  const openFor = fmtElapsed(elapsedSecondsBetween(browser.openedAt, nowIso));
  return (
    <div
      className={cn(
        "flex w-full min-w-0 flex-col border",
        "gap-[var(--ds-space-hair)] px-[var(--ds-space-base)] py-[var(--ds-space-tight)]",
        dsRadius.md,
        // The demo's `unknown` tone: no fill, faint ink — a tile that has not
        // been checked must not look like one that passed.
        "border-[color:var(--ds-border-subtle)] bg-transparent text-[color:var(--ds-fg-faint)]",
        span && "col-span-2",
      )}
    >
      <span className={cn(dsText.caps, "flex min-w-0 items-center gap-[var(--ds-space-tight)]")}>
        <CircleHelp aria-hidden className={cn(dsIcon.sm, "shrink-0")} />
        <span className="min-w-0 flex-1 truncate">{SYSTEM_LABEL[browser.system]}</span>
        <AuthorityDetails
          label={`Show full ${SYSTEM_LABEL[browser.system]} browser session details`}
          title={`${SYSTEM_LABEL[browser.system]} browser session`}
          facts={[
            { label: "Session ID", value: String(browser.sessionId) },
            { label: "Browser status", value: "Not checked" },
            { label: "Open for", value: openFor },
          ]}
        />
      </span>
      <span className={cn(dsText.micro, "truncate opacity-80")}>Not checked · open {openFor}</span>
    </div>
  );
}

/** Keyboard/touch route from a dense clipped value to every served character. */
function AuthorityDetails({
  label,
  title,
  facts,
  touchAlign = "center",
}: {
  label: string;
  title: string;
  facts: readonly Readonly<{ label: string; value: string }>[];
  touchAlign?: "center" | "up" | "down";
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton
          size="xs"
          label={label}
          icon={(
            <span
              aria-hidden
              className={cn(
                "inline-flex size-[var(--ds-h-xs)] translate-x-3 items-center justify-center",
                dsRadius.md,
                "group-hover:bg-[var(--ds-surface-3)]",
                touchAlign === "up" && "translate-y-3",
                touchAlign === "down" && "-translate-y-3",
              )}
            >
              <Eye className={dsIcon.sm} />
            </span>
          )}
          data-authority-touch-target="44"
          className={cn(
            "group relative z-10 size-11 -ml-6 rounded-none touch-manipulation hover:bg-transparent active:translate-y-0",
            touchAlign === "up" ? "-mt-6 mb-0" : touchAlign === "down" ? "mt-0 -mb-6" : "-my-3",
          )}
        />
      </PopoverTrigger>
      <PopoverContent title={title} width="lg" align="start">
        <dl className="flex min-w-0 flex-col gap-[var(--ds-space-base)]">
          {facts.map((fact) => (
            <div key={fact.label} className="min-w-0">
              <dt className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>{fact.label}</dt>
              <dd className={cn(dsText.body, dsText.nums, "select-text break-all text-[color:var(--ds-fg)]")}>
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}

/** The current worker's session membership, read from its claimed run's row. */
function WorkerSessionLine({ membership }: { membership: WorkerSessionMembership }) {
  if (membership.state === "unassigned") return null;
  if (membership.state === "present") {
    return (
      <div
        className={cn(
          "flex min-w-0 items-center border-t",
          dsBorder.subtle,
          "gap-[var(--ds-space-tight)] pt-[var(--ds-space-snug)] text-[color:var(--ds-fg-muted)]",
        )}
      >
        <span className={cn(dsText.caps, "shrink-0")}>Session</span>
        <span className={cn(dsText.micro, dsText.nums, "min-w-0 flex-1 truncate")}>
          {String(membership.sessionId)}
        </span>
        <AuthorityDetails
          label={`Show full session and run details for ${membership.row.title}`}
          title="Current session member"
          facts={[
            { label: "Session ID", value: String(membership.sessionId) },
            { label: "Member", value: membership.row.title },
            { label: "Run ID", value: String(membership.row.runId) },
          ]}
        />
        <StatusDot status={dsStatusOf(membership.row.status)} className="shrink-0" />
      </div>
    );
  }
  if (membership.state === "absent") {
    return (
      <div className={cn("min-w-0 border-t pt-[var(--ds-space-snug)]", dsBorder.subtle)}>
        <span className="flex min-w-0 items-center gap-[var(--ds-space-tight)]">
          <span className={cn(dsText.caps, "min-w-0 flex-1 text-[color:var(--ds-fg-muted)]")}>No session recorded</span>
          <AuthorityDetails
            label="Show full reason no session was recorded"
            title="No session recorded"
            facts={[{ label: "Served reason", value: membership.reason }]}
          />
        </span>
        <span className={cn(dsText.micro, "block truncate text-[color:var(--ds-fg-muted)]")}>{membership.reason}</span>
      </div>
    );
  }
  return (
    <div className={cn("min-w-0 border-t pt-[var(--ds-space-snug)]", dsBorder.subtle)}>
      <span className="flex min-w-0 items-center gap-[var(--ds-space-tight)]">
        <span className={cn(dsText.caps, "min-w-0 flex-1 text-[color:var(--ds-fg-muted)]")}>Session row not served</span>
        <AuthorityDetails
          label={`Show full unserved run ID ${String(membership.runId)}`}
          title="Session row not served"
          facts={[{ label: "Run ID", value: String(membership.runId) }]}
        />
      </span>
      <span className={cn(dsText.micro, dsText.nums, "block truncate text-[color:var(--ds-fg-muted)]")}>{String(membership.runId)}</span>
    </div>
  );
}

/** One row of a session's authority membership list; it remains a compact divider, not a nested card. */
function SessionMemberRow({ member, sessionId }: { member: SessionMemberView; sessionId: SessionGroupView["sessionId"] }) {
  const status = dsStatusOf(member.row.status);
  const workerDetails = member.workers.length === 0
    ? "No current worker card claims this run"
    : member.workers.map((worker) => `${WORKER_TONE[worker.state].label} · ${String(worker.workerId)}`).join(" · ");
  return (
    <div className={cn("grid h-full min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-[var(--ds-space-snug)] px-[var(--ds-shell-inset)] py-[var(--ds-space-snug)]")}>
      <StatusDot status={status} className="mt-px" />
      <div className="min-w-0">
        <div className="flex min-w-0 items-baseline gap-[var(--ds-space-snug)]">
          <span className={cn(dsText.meta, "min-w-0 flex-1 truncate text-[color:var(--ds-fg)]")}>
            {member.row.title}
          </span>
          <span className={cn(dsText.micro, "shrink-0 text-[color:var(--ds-fg-muted)]")}>{PROPOSED_STATUS[status].label}</span>
          <AuthorityDetails
            label={`Show full details for ${member.row.title}`}
            title="Session member"
            facts={[
              { label: "Member", value: member.row.title },
              { label: "Run ID", value: String(member.row.runId) },
              { label: "Session ID", value: String(sessionId) },
              { label: "Run state", value: PROPOSED_STATUS[status].label },
              { label: "Current worker cards", value: workerDetails },
            ]}
            touchAlign="down"
          />
        </div>
        <div className={cn(dsText.micro, dsText.nums, "mt-[var(--ds-space-hair)] min-w-0 truncate text-[color:var(--ds-fg-muted)]")}>
          {String(member.row.runId)}
        </div>
        {member.workers.length === 0 ? (
          <span className={cn(dsText.micro, "block mt-[var(--ds-space-hair)] text-[color:var(--ds-fg-muted)]")}>
            No current worker card claims this run
          </span>
        ) : (
          <span className={cn(dsText.micro, "block mt-[var(--ds-space-hair)] text-[color:var(--ds-fg-muted)]")}>
            {member.workers.map((worker) => (
              <span key={String(worker.workerId)} className="mr-[var(--ds-space-snug)] inline-block">
                {WORKER_TONE[worker.state].label} · {String(worker.workerId)}
              </span>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

function SessionHeaderRow({ session }: { session: SessionGroupView }) {
  const pool = sessionPoolDisplay(session);
  return (
    <div className="flex h-full min-w-0 items-center gap-[var(--ds-space-snug)] px-[var(--ds-shell-inset)]">
      <span className={cn(dsText.caps, "shrink-0 text-[color:var(--ds-fg-muted)]")}>Session</span>
      <span className={cn(dsText.micro, dsText.nums, "min-w-0 flex-1 truncate text-[color:var(--ds-fg)]")}>
        {String(session.sessionId)}
      </span>
      {pool.summary !== undefined && (
        <span className={cn(dsText.micro, "max-w-[45%] shrink truncate text-[color:var(--ds-fg-muted)]")}>
          {pool.summary}
        </span>
      )}
      <AuthorityDetails
        label={`Show full details for session ${String(session.sessionId)}`}
        title="Session details"
        facts={[{ label: "Session ID", value: String(session.sessionId) }, ...pool.facts]}
      />
    </div>
  );
}

function AbsentSessionMemberRow({ member }: { member: Extract<SessionListItem, { kind: "absent-member" }>["member"] }) {
  return (
    <div className="h-full min-w-0 px-[var(--ds-shell-inset)] py-[var(--ds-space-snug)]">
      <div className="flex min-w-0 items-baseline gap-[var(--ds-space-snug)]">
        <span className={cn(dsText.meta, "min-w-0 flex-1 truncate text-[color:var(--ds-fg)]")}>{member.row.title}</span>
        <AuthorityDetails
          label={`Show full details for ${member.row.title}`}
          title="Run without a recorded session"
          facts={[
            { label: "Member", value: member.row.title },
            { label: "Run ID", value: String(member.row.runId) },
            { label: "Served reason", value: member.reason },
          ]}
          touchAlign="down"
        />
      </div>
      <span className={cn(dsText.micro, "block truncate text-[color:var(--ds-fg-muted)]")}>{member.reason}</span>
      <span className={cn(dsText.micro, dsText.nums, "block truncate text-[color:var(--ds-fg-muted)]")}>{String(member.row.runId)}</span>
    </div>
  );
}

function SessionVirtualRow({
  row,
  totalRows,
  active,
  rowRef,
  onFocus,
  onKeyDown,
}: {
  row: SessionListLayoutRow;
  totalRows: number;
  active: boolean;
  rowRef: (node: HTMLDivElement | null) => void;
  onFocus: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}) {
  const item = row.item;
  const ariaLabel = item.kind === "session-header"
    ? `Session ${String(item.session.sessionId)}`
    : item.kind === "session-member"
      ? `${item.member.row.title}, run ${String(item.member.row.runId)}, session ${String(item.sessionId)}`
      : item.kind === "absent-header"
        ? "Runs without a recorded session"
        : `${item.member.row.title}, run ${String(item.member.row.runId)}, no recorded session`;
  return (
    <div
      id={`session-membership-row-${String(row.index)}`}
      role="listitem"
      aria-label={ariaLabel}
      aria-posinset={row.index + 1}
      aria-setsize={totalRows}
      tabIndex={active ? 0 : -1}
      ref={rowRef}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      data-session-virtual-row
      data-session-active={active ? "true" : undefined}
      data-session-row-index={row.index}
      data-session-run-id={item.kind === "session-member" || item.kind === "absent-member" ? String(item.member.row.runId) : undefined}
      className={cn(
        "absolute inset-x-0 border-b border-[color:var(--ds-border-subtle)]",
        dsFocus,
        active && "bg-[var(--ds-surface-2)]",
      )}
      style={{ top: row.top, height: row.height }}
    >
      {item.kind === "session-header" && <SessionHeaderRow session={item.session} />}
      {item.kind === "session-member" && <SessionMemberRow member={item.member} sessionId={item.sessionId} />}
      {item.kind === "absent-header" && (
        <div className="flex h-full items-center px-[var(--ds-shell-inset)]">
          <span className={cn(dsText.caps, "text-[color:var(--ds-fg-muted)]")}>No session recorded</span>
        </div>
      )}
      {item.kind === "absent-member" && <AbsentSessionMemberRow member={item.member} />}
    </div>
  );
}

/**
 * All day members stay in the layout; only one viewport plus one row of
 * overscan mounts. Memoization keeps the one-second worker elapsed tick from
 * reconciling this list when the authority arrays have not changed.
 */
export const SessionMembershipList = memo(function SessionMembershipList({ sessionView }: { sessionView: SessionView }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<number, HTMLDivElement>());
  const pendingFocusIndexRef = useRef<number | undefined>(undefined);
  const scrollFocusedRowIndexRef = useRef<number | undefined>(undefined);
  const scrollFrameRef = useRef<number | undefined>(undefined);
  const pendingScrollTopRef = useRef(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(SESSION_LIST_DEFAULT_VIEWPORT_HEIGHT);
  const [activeIndex, setActiveIndex] = useState(0);
  const layout = useMemo(() => buildSessionListLayout(sessionView), [sessionView]);
  const windowed = useMemo(
    () => sessionListWindow(layout, scrollTop, viewportHeight),
    [layout, scrollTop, viewportHeight],
  );
  const rovingIndex = windowed.rows.some((row) => row.index === activeIndex)
    ? activeIndex
    : sessionListVisibleIndex(layout, scrollTop);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    const measure = (): void => setViewportHeight(Math.max(1, scroller.clientHeight));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    if (scrollFrameRef.current !== undefined) cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  useLayoutEffect(() => {
    const pendingIndex = pendingFocusIndexRef.current;
    if (pendingIndex !== undefined) {
      const row = rowRefs.current.get(pendingIndex);
      if (row === undefined) return;
      pendingFocusIndexRef.current = undefined;
      scrollFocusedRowIndexRef.current = pendingIndex;
      row.focus({ preventScroll: true });
      return;
    }

    const focusedBeforeScroll = scrollFocusedRowIndexRef.current;
    if (focusedBeforeScroll === undefined || rowRefs.current.has(focusedBeforeScroll)) return;
    const activeElement = document.activeElement;
    if (activeElement !== null && activeElement !== document.body) {
      scrollFocusedRowIndexRef.current = undefined;
      return;
    }
    const row = rowRefs.current.get(rovingIndex);
    if (row === undefined) return;
    scrollFocusedRowIndexRef.current = rovingIndex;
    row.focus({ preventScroll: true });
  }, [rovingIndex, windowed.rows]);

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>): void => {
    scrollFocusedRowIndexRef.current = undefined;
    for (const [index, row] of rowRefs.current) {
      if (row === document.activeElement) {
        scrollFocusedRowIndexRef.current = index;
        break;
      }
    }
    pendingScrollTopRef.current = event.currentTarget.scrollTop;
    if (scrollFrameRef.current !== undefined) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = undefined;
      setScrollTop(pendingScrollTopRef.current);
    });
  }, []);

  const focusIndex = useCallback((index: number): void => {
    const target = Math.max(0, Math.min(index, layout.rows.length - 1));
    const nextScrollTop = sessionListScrollTopForIndex(layout, target, viewportHeight);
    pendingFocusIndexRef.current = target;
    if (scrollerRef.current !== null) scrollerRef.current.scrollTop = nextScrollTop;
    pendingScrollTopRef.current = nextScrollTop;
    setScrollTop(nextScrollTop);
    setActiveIndex(target);
  }, [layout, viewportHeight]);

  const onRowKeyDown = useCallback((index: number, event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return;
    const target = sessionListNavigationTarget(index, event.key, layout.rows.length, viewportHeight);
    if (target === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    if (target === index) {
      pendingFocusIndexRef.current = undefined;
      return;
    }
    focusIndex(target);
  }, [focusIndex, layout.rows.length, viewportHeight]);

  if (sessionView.sessions.length === 0 && sessionView.absentMembers.length === 0) {
    return <p className={cn(dsText.meta, "px-[var(--ds-shell-inset)] py-[var(--ds-space-cozy)] text-[color:var(--ds-fg-muted)]")}>No run rows on this day.</p>;
  }
  return (
    <div
      ref={scrollerRef}
      role="list"
      aria-label={`Session membership, ${String(layout.rows.length)} rows. Focus a row, then use arrow, page, Home, or End keys to move through all rows.`}
      onScroll={onScroll}
      data-session-membership
      className="max-h-[min(48dvh,32rem)] overflow-y-auto border-t border-[color:var(--ds-border-subtle)]"
    >
      <div className="relative min-w-0" style={{ height: windowed.totalHeight }}>
        {windowed.rows.map((row) => (
          <SessionVirtualRow
            key={row.key}
            row={row}
            totalRows={layout.rows.length}
            active={row.index === rovingIndex}
            rowRef={(node) => {
              if (node === null) rowRefs.current.delete(row.index);
              else rowRefs.current.set(row.index, node);
            }}
            onFocus={() => setActiveIndex(row.index)}
            onKeyDown={(event) => onRowKeyDown(row.index, event)}
          />
        ))}
      </div>
    </div>
  );
});

/**
 * One worker card — the authority lease, drawn (D248/D249).
 *
 * The header names the WORKFLOW, because that is what the operator started and
 * what the panel is about; the worker id is a process name and lives in the
 * title. The queued chip beside it is the SERVED per-workflow status count
 * (D81's one fold), never a client-side pass over the queue.
 *
 * Two demo elements are still absent, each for a producer that does not exist.
 * The lease-wait block ("waiting 4m for the ucpath lease, held by …") has
 * nothing to report: every worker opens its OWN browser session per system
 * (ref execution-and-sessions §1), so there is no cross-worker lease and no holder to name. The
 * micro-pipeline stays reserved and EMPTY: the wire serves no `steps[]`, and
 * dots drawn from nothing would be the worst kind of lie on a panel about what
 * a worker is doing.
 */
function WorkerCard({
  card,
  workflowLabel,
  queued,
  nowIso,
  membership,
  onStop,
}: {
  card: WorkerCardWire;
  workflowLabel: string;
  queued: number;
  nowIso: string;
  membership: WorkerSessionMembership;
  onStop?: (card: WorkerCardWire) => void;
}) {
  const tone = WORKER_TONE[card.state];
  const directive = workerDirectiveNote(card);
  const elapsed = workerElapsedSeconds(card, nowIso);

  /*
   * A daemon that DIED is a different object: no tiles, no clock, nothing to
   * stop. Ported from `DemoShell.tsx:1545-1569` — its own comment is the
   * reason it stays on screen at all: *keep it visible so the failure is
   * learned.* The word underneath is the lease's recorded reason, so "crashed"
   * and "you stopped it" can never render the same.
   */
  if (card.state === "failed") {
    return (
      <article
        title={`Worker ${String(card.workerId)}`}
        className={cn(
          "flex shrink-0 flex-col border",
          "w-[var(--ds-w-session-card)] gap-[var(--ds-space-tight)] p-[var(--ds-space-base)]",
          dsRadius.lg,
          "border-[color:var(--ds-danger-border)] bg-[var(--ds-danger-quiet)]",
        )}
      >
        <div className="flex items-center gap-[var(--ds-space-base)]">
          <span aria-hidden className="size-2 shrink-0 rounded-full bg-[var(--ds-danger)]" />
          <span className={cn(dsText.ui, "min-w-0 flex-1 truncate font-semibold text-[color:var(--ds-fg)]")}>
            {workflowLabel}
          </span>
          <span className={cn(dsText.caps, "shrink-0 text-[color:var(--ds-danger)]")}>{tone.label}</span>
        </div>
        <p className={cn(dsText.meta, "text-[color:var(--ds-danger)] opacity-85")}>
          {card.stopReason === undefined ? "" : WORKER_STOP_REASON_LABEL[card.stopReason]}
        </p>
      </article>
    );
  }

  return (
    <article
      title={`Worker ${String(card.workerId)}`}
      className={cn(
        // No explicit height: `align-items: stretch` only stretches an item
        // whose cross size computes to `auto`, so an `h-full` here would opt
        // every card straight back out of the uniform row.
        "flex shrink-0 flex-col border",
        "w-[var(--ds-w-session-card)] gap-[var(--ds-space-snug)] p-[var(--ds-space-base)]",
        dsRadius.lg,
        dsSurface.card,
        dsBorder.base,
      )}
    >
      <div className="flex items-center gap-[var(--ds-space-snug)]">
        <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", tone.dot)} />
        <span className={cn(dsText.ui, "min-w-0 truncate font-semibold text-[color:var(--ds-fg)]")}>
          {workflowLabel}
        </span>
        {queued > 0 && (
          <span
            className={cn(
              "inline-flex shrink-0 items-center border px-[var(--ds-space-tight)]",
              "h-[var(--ds-h-xs)] gap-[var(--ds-space-hair)]",
              dsRadius.sm,
              dsText.micro,
              "border-[color:var(--ds-status-queued-border)] text-[color:var(--ds-status-queued-fg)]",
            )}
          >
            <span className={dsText.nums}>{queued}</span> queued
          </span>
        )}
        <span className={cn(dsText.caps, "ml-auto shrink-0", tone.text)}>{tone.label}</span>
      </div>

      {/* The demo's subline. `currentRun` is a served union, so a worker with no
          run says WHY in the server's own words rather than going blank. */}
      <span className="-mt-[var(--ds-space-tight)] flex min-w-0 items-center gap-[var(--ds-space-tight)]">
        <span
          className={cn(
            dsText.meta,
            "min-w-0 flex-1 truncate text-[color:var(--ds-fg-muted)]",
            card.currentRun.state === "present" && dsText.nums,
          )}
        >
          {card.currentRun.state === "present" ? String(card.currentRun.traceId) : card.currentRun.reason}
        </span>
        {card.currentRun.state === "present" && (
          <AuthorityDetails
            label={`Show full current run and trace IDs for ${workflowLabel}`}
            title="Current run identity"
            facts={[
              { label: "Run ID", value: String(card.currentRun.runId) },
              { label: "Trace ID", value: String(card.currentRun.traceId) },
            ]}
            touchAlign="up"
          />
        )}
      </span>

      <WorkerSessionLine membership={membership} />

      {/* The operator's standing directive, beside the state and never as it —
          a worker asked to pause finishes its item first. */}
      {directive !== undefined && (
        <span className={cn(dsText.micro, capacityChip(true))}>{directive}</span>
      )}

      {/* An odd last tile spans both columns: a lone half-width tile beside dead
          space reads as one that failed to render. */}
      {card.browsers.length > 0 && (
        <div className="grid grid-cols-2 gap-[var(--ds-space-tight)]">
          {card.browsers.map((browser, index) => (
            <BrowserTile
              key={String(browser.sessionId)}
              browser={browser}
              nowIso={nowIso}
              span={card.browsers.length % 2 === 1 && index === card.browsers.length - 1}
            />
          ))}
        </div>
      )}

      {/*
        THE BASE — pipeline then footer, pinned to the bottom as ONE block
        (ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
        `DemoShell.tsx:1653-1671`; R7-7).

        Everything above this varies by card, so anchoring the whole base rather
        than the footer alone is what puts every card's pipeline band on ONE
        baseline instead of wherever its own content happened to end — that is
        the property that lets a row of cards be read across.

        The pipeline's row is RESERVED at a fixed height on every card, so a
        worker with no item in flight keeps the same baseline without being
        given a bar it has not earned. The slack lands above and is left EMPTY
        on purpose: an idle worker genuinely has less to say than a blocked one.
      */}
      <div className="mt-auto flex flex-col gap-[var(--ds-space-snug)]">
        <div aria-hidden className={cn("flex shrink-0 items-center", dsSize.hMicroPipeline)} />
        <div
          className={cn(
            dsText.meta,
            "flex items-center border-t text-[color:var(--ds-fg-muted)]",
            dsBorder.subtle,
            "gap-[var(--ds-space-snug)] pt-[var(--ds-space-snug)]",
          )}
        >
          {/* THE STEP SLOT — hard left, the demo's answer to "what is this
              worker doing", and EMPTY exactly as the demo leaves it when no
              step is known (`s.step ?? ""`). Nothing on this wire names the
              node a worker is inside; the run it is on is stated on the subline
              above, which is the nearest true statement available. */}
          <span className="min-w-0 flex-1 truncate" />
          {/* The clock is dated by the SERVED instant every other elapsed on
              screen uses, not by a browser `Date.now()` — the demo ticks its own
              because it has no server; a second, uncalibrated clock here would
              let this card and the queue row for the same run disagree. */}
          <span className={cn(dsText.nums, "shrink-0 tabular-nums")}>
            {elapsed > 0 ? fmtElapsed(elapsed) : "—"}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            disabled={onStop === undefined || !canStopWorker(card)}
            title={canStopWorker(card)
              ? `Stop worker ${String(card.workerId)} after its current item (lease version ${String(card.leaseVersion)})`
              : `Worker ${String(card.workerId)} is already ${card.directive === "stop" ? "stopping" : "settled"}`}
            onClick={() => onStop?.(card)}
          >
            Stop
          </Button>
        </div>
      </div>
    </article>
  );
}

/**
 * The Session Panel — the bar that is mounted under every view, and the drawer
 * of worker cards behind it.
 *
 * The APP's version is stated ONCE here, for the whole dashboard: every run on
 * screen is being served by this build, so one statement in the one bar that is
 * always mounted says it for all of them. A run that RAN under a different
 * version carries its own, which is a fact about the run and stays on the run.
 */
export function SessionPanel({
  workerCards,
  queueSurfaces,
  workerPools,
  workflows,
  counts,
  nowIso,
  connection,
  appVersion,
  onStopWorker,
}: {
  workerCards: readonly WorkerCardWire[];
  queueSurfaces: readonly QueueSurfaceWire[];
  workerPools: readonly WorkerPoolWire[];
  /**
   * The bootstrap's own workflow list — the SAME vocabulary the Workflow Panel
   * and the Run Modal draw from. The card names a workflow by joining this
   * list rather than by a second served label: two labels for one workflow is
   * how the panel and the card come to disagree about what a worker is running.
   */
  workflows: readonly WorkflowBootstrapPrimitive[];
  /** D81's one fold — the queued chip's number, never a pass over the rows. */
  counts: readonly WorkflowCountWire[];
  nowIso: string;
  connection: SubscriptionState;
  appVersion: string;
  onStopWorker?: (card: WorkerCardWire) => void;
}) {
  const [open, setOpen] = useState(false);
  const sessionPanelView = useMemo(
    () => buildSessionPanelView(queueSurfaces, workerCards, workerPools),
    [queueSurfaces, workerCards, workerPools],
  );
  const tallies = useMemo(() => {
    const byState = new Map<WorkerState, number>();
    for (const card of workerCards) byState.set(card.state, (byState.get(card.state) ?? 0) + 1);
    return WORKER_STATE_ORDER.map((state) => ({ state, count: byState.get(state) ?? 0 })).filter(
      (tally) => tally.count > 0 || ALWAYS_TALLIED.includes(tally.state),
    );
  }, [workerCards]);
  /**
   * WHICH workers, not only how many — the demo's chip carries the naming
   * `title` (`DemoShell.tsx:1887`) because a count with no names cannot be
   * acted on. Since D248 the sentence can be the demo's own: the card names its
   * WORKFLOW and the lease says how it ended, so the title reads
   * `Separations · crashed` rather than a worker id and a state word.
   */
  const attention = useMemo(
    () => workerCards.filter((card) => card.state === "failed"),
    [workerCards],
  );
  /**
   * The workflow's label and its queued count, joined ONCE for every card.
   * A workflow the bootstrap does not list falls back to its own id — the
   * honest stand-in, and the only one available: inventing a display name for
   * an unregistered workflow would name it something no descriptor declares.
   */
  const workflowLabels = useMemo(
    () => new Map(workflows.map((workflow) => [String(workflow.id), workflow.label])),
    [workflows],
  );
  const labelOf = useCallback(
    (card: WorkerCardWire): string => workflowLabels.get(String(card.workflowId)) ?? String(card.workflowId),
    [workflowLabels],
  );
  const link = connectionTone(connection);

  return (
    <section aria-label="Session Panel" className={cn("shrink-0 border-t", dsBorder.base, dsSurface.card)}>
      <div className={cn("flex items-center", dsSize.hBar, "gap-[var(--ds-space-base)] px-[var(--ds-shell-inset)]")}>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className={cn(
            "flex min-w-0 flex-1 cursor-pointer items-center overflow-hidden text-left",
            "h-[var(--ds-h-md)] gap-[var(--ds-space-cozy)] px-[var(--ds-space-tight)]",
            dsRadius.md,
            dsFocus,
            dsMotion.fast,
            "hover:bg-[var(--ds-surface-3)]",
          )}
        >
          {open ? (
            <ChevronDown aria-hidden className={cn(dsIcon.md, "shrink-0 text-[color:var(--ds-fg-muted)]")} />
          ) : (
            <ChevronUp aria-hidden className={cn(dsIcon.md, "shrink-0 text-[color:var(--ds-fg-muted)]")} />
          )}
          <span className={cn(dsText.ui, "shrink-0 font-semibold text-[color:var(--ds-fg)]")}>Sessions</span>
          <span className={cn(dsText.meta, "flex shrink-0 items-center gap-[var(--ds-space-cozy)] text-[color:var(--ds-fg-muted)]")}>
            {tallies.map((tally) => (
              <span
                key={tally.state}
                className={cn(
                  "inline-flex items-center gap-[var(--ds-space-tight)]",
                  // Only `failed` takes ink, and only when there is one: the
                  // demo tints the whole segment rather than the dot alone,
                  // because a 6px red dot beside muted grey words is colour
                  // doing the work on its own. Every other state stays muted —
                  // a bar where five of six tallies are coloured is a bar where
                  // none of them is.
                  tally.state === "failed" && tally.count > 0 && WORKER_TONE.failed.text,
                )}
              >
                <span aria-hidden className={cn("size-1.5 rounded-full", WORKER_TONE[tally.state].dot)} />
                {tally.count} {WORKER_TONE[tally.state].label.toLowerCase()}
              </span>
            ))}
          </span>
          {/* Renders only when the count is above zero — honest absence. Since
              D248 it CAN fire: a worker whose lease settled `crashed` or
              `lease-expired` is a `failed` card, which is the state this chip
              was built for and could never receive. */}
          {attention.length > 0 && (
            <span
              title={attention
                .map((card) => `${labelOf(card)} · ${
                  card.stopReason === undefined ? "failed" : WORKER_STOP_REASON_LABEL[card.stopReason]
                }`)
                .join(" · ")}
              className={capacityChip(true)}
            >
              <AlertTriangle aria-hidden className={cn(dsIcon.sm, "shrink-0")} />
              {plural(attention.length, "worker")} need attention
            </span>
          )}
        </button>
        <span className="flex shrink-0 items-center gap-[var(--ds-space-snug)]">
          {/*
            THE DEMO'S `+` (Add workers) IS ABSENT even though D269 now serves
            the worker pool's exact CAS version in `workerPools[]`.
            `spawn-worker` and `plan-worker-count` are real composed kernel
            commands, but the dashboard supervisor still refuses their process
            effect by name. A control may not acknowledge workers it cannot
            launch; it lands with the supervisor, not by turning the served CAS
            fact into a promise the process cannot keep.
          */}
          {/* The full sentence, ported from legacy
              hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
              `DemoShell.tsx:1919-1924` (R7-11). The rebuild IMPLEMENTS D179's
              archive semantics and had dropped the only place the operator is
              ever told them: what a MAJOR bump does to prior-version runs is
              not derivable from a version string, and the tooltip on that
              string is where the demo puts it. */}
          <span
            title={`App ${appVersion} — MAJOR moves when a dashboard change reaches some or all workflows (prior-version runs archive); MINOR when it reaches none. A run that RAN under a different version carries its own, which is a fact about the run and stays on the run.`}
            className={cn(dsText.meta, dsText.nums, "shrink-0 text-[color:var(--ds-fg-muted)]")}
          >
            app {appVersion}
          </span>
          <span aria-hidden className="h-[var(--ds-h-xs)] w-px shrink-0 bg-[var(--ds-border)]" />
          {/* The subscription, named. This is the live / reconnecting state the
              Phase-1 exit has to show. */}
          <span
            role="status"
            title={link.detail}
            className={cn(dsText.meta, "inline-flex items-center gap-[var(--ds-space-tight)]", link.text)}
          >
            <span aria-hidden className={cn("size-1.5 rounded-full", link.dot)} />
            {link.label}
          </span>
        </span>
      </div>

      {open && (
        <div
          className={cn(
            // items-stretch: every card is as tall as the tallest, so the row
            // is scannable and the trace ids can be compared down a column.
            "flex items-stretch overflow-x-auto border-t",
            dsBorder.subtle,
            "gap-[var(--ds-space-base)] px-[var(--ds-shell-inset)] py-[var(--ds-space-cozy)]",
          )}
        >
          {sessionPanelView.workers.map(({ card, membership }) => (
            <WorkerCard
              key={String(card.workerId)}
              card={card}
              workflowLabel={labelOf(card)}
              queued={statusCount(workflowStatusCounts(counts, String(card.workflowId)), "queued")}
              nowIso={nowIso}
              membership={membership}
              {...(onStopWorker === undefined ? {} : { onStop: onStopWorker })}
            />
          ))}
        </div>
      )}
      {open && <SessionMembershipList sessionView={sessionPanelView.sessionView} />}
    </section>
  );
}
