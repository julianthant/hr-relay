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
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactElement, type SVGProps } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Eye,
  LayoutDashboard,
  Minus,
  PanelLeft,
  PanelLeftClose,
  PanelLeftOpen,
  PictureInPicture2,
} from "lucide-react";
import { z } from "zod";
import { readEnumPreference, writePreference } from "../lib/preference-storage.js";
import { cn } from "../lib/utils.js";
import {
  IconButton,
  dsBorder,
  dsClip,
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
import {
  WorkflowBootstrapPrimitiveSchema,
  WorkflowCategoryPrimitiveSchema,
} from "../../domain/dashboard/bootstrap.js";
import type {
  StatusCountWireSchema,
  WorkerCardWireSchema,
  WorkflowCountWireSchema,
} from "../../domain/dashboard/projection.js";
import type { SubscriptionState } from "../client/index.js";
import { PROPOSED_STATUS, dsStatusOf, type QueueStatus } from "./status.js";
import { SystemChip } from "./system-chip.js";
import { plural } from "./format.js";

export type WorkflowCountWire = z.infer<typeof WorkflowCountWireSchema>;
export type StatusCountWire = z.infer<typeof StatusCountWireSchema>;
export type WorkerCardWire = z.infer<typeof WorkerCardWireSchema>;
export type WorkflowBootstrapPrimitive = z.infer<typeof WorkflowBootstrapPrimitiveSchema>;
export type WorkflowCategoryPrimitive = z.infer<typeof WorkflowCategoryPrimitiveSchema>;

/**
 * The bootstrap wire types its projection arrays as `unknown[]` on purpose —
 * the schema is composed from owner-provided parts, so a consumer states which
 * closed shape it expects and PARSES. This is the same call the bootstrap
 * schema's own `superRefine` makes; it is schema-derived typing, never a
 * handwritten mirror.
 */
export function parseWorkflows(workflows: readonly unknown[]): WorkflowBootstrapPrimitive[] {
  return z.array(WorkflowBootstrapPrimitiveSchema).parse(workflows);
}

export function parseWorkflowCategories(categories: readonly unknown[]): WorkflowCategoryPrimitive[] {
  return z.array(WorkflowCategoryPrimitiveSchema).parse(categories);
}

/**
 * A count the projection did not serve is ZERO, not unknown.
 *
 * This is a documented, provably-correct default rather than a guess: the
 * projection builds each count array by folding the surfaces it is serving, so
 * a status or workflow with no row simply has no entry. Absence IS zero here,
 * and rendering it as zero is what keeps a slot from vanishing when a bucket
 * empties.
 */
function servedCount<Entry>(entries: readonly Entry[], match: (entry: Entry) => boolean): number {
  const entry = entries.find(match);
  return entry === undefined ? 0 : (entry as { count: number }).count;
}

export function workflowCount(counts: readonly WorkflowCountWire[], workflowId: string): number {
  return servedCount(counts, (entry) => String(entry.workflowId) === workflowId);
}

export function statusCount(counts: readonly StatusCountWire[], status: QueueStatus): number {
  return servedCount(counts, (entry) => entry.status === status);
}

/* ── the toolbar control shape ───────────────────────────────────────────── */

/**
 * Ported from DemoBulkBar's `toolbarControl`. It lives here because the
 * Workflow Panel toggle sits a hairline from the queue's own toolbar controls
 * and every control in a toolbar is `--ds-h-toolbar` tall (DESIGN.md) — a
 * repeated literal is exactly how one of thirteen came to be 30px in a row
 * of 24.
 */
const toolbarControl = (): string =>
  cn(
    "inline-flex shrink-0 cursor-pointer items-center border",
    "h-[var(--ds-h-toolbar)] gap-[var(--ds-space-snug)] px-[var(--ds-space-base)]",
    dsRadius.md,
    dsText.meta,
    dsFocus,
    dsMotion.fast,
    "active:translate-y-px",
  );

/* ── Workflow Panel ──────────────────────────────────────────────────────── */

/**
 * Where the Workflow Panel is, and how much of the window it costs.
 *
 * `floating` — a window over the panels. It costs no column, so the queue and
 * the detail panel get the full width; it is dismissable, and dismissing it
 * lands on `icon`.
 * `icon` — nothing is drawn over the content at all. The toggle in the action
 * bar is the launcher, and it keeps carrying the day's count so a collapsed
 * panel can never hide one.
 * `sidebar` — docked, always visible. For the operator who wants it.
 */
export type WorkflowPanelMode = "floating" | "icon" | "sidebar";

const PANEL_MODE_CYCLE: WorkflowPanelMode[] = ["floating", "icon", "sidebar"];

export const WORKFLOW_PANEL_MODE_LABEL: Record<WorkflowPanelMode, string> = {
  floating: "floating window",
  icon: "icon",
  sidebar: "sidebar",
};

/** Rebuild-scoped so it can never collide with the legacy demo's stored mode. */
const PANEL_MODE_STORAGE_KEY = "hr-dashboard.workflow-panel";
const WORKFLOW_PANEL_ID = "dashboard-workflow-panel";
const WORKFLOW_PANEL_TOGGLE_ID = "dashboard-workflow-panel-toggle";

/** The documented mode for an operator who has expressed no preference. */
const PANEL_MODE_DEFAULT: WorkflowPanelMode = "floating";

function readStoredPanelMode(): WorkflowPanelMode {
  // Nothing stored, storage refused, and a stored value outside the cycle are
  // three different things; `readEnumPreference` keeps them apart and lands
  // them all on the named default, rather than a catch block inventing one.
  return readEnumPreference(PANEL_MODE_STORAGE_KEY, PANEL_MODE_CYCLE, PANEL_MODE_DEFAULT);
}

/**
 * Owns the mode, its persistence, and one thing more: whether the OPERATOR has
 * moved it this session (`opened`).
 *
 * That flag is what keeps the window honest on first paint. A window that
 * animates in and grabs focus because it was the persisted default is animating
 * on page load and stealing the caret from the queue — both banned.
 */
export function useWorkflowPanelMode(): {
  mode: WorkflowPanelMode;
  setMode: (mode: WorkflowPanelMode) => void;
  cycleMode: () => void;
  opened: boolean;
} {
  const [mode, setModeState] = useState<WorkflowPanelMode>(readStoredPanelMode);
  const [opened, setOpened] = useState(false);

  const setMode = useCallback((next: WorkflowPanelMode) => {
    setOpened(true);
    setModeState(next);
    // Same as the read: an unwritable store loses the preference for next time,
    // which is not a reason to refuse the operator this one — but the outcome
    // is returned rather than swallowed.
    void writePreference(PANEL_MODE_STORAGE_KEY, next);
  }, []);

  const cycleMode = useCallback(() => {
    setMode(PANEL_MODE_CYCLE[(PANEL_MODE_CYCLE.indexOf(mode) + 1) % PANEL_MODE_CYCLE.length]);
  }, [mode, setMode]);

  return { mode, setMode, cycleMode, opened };
}

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
 * It carries the SELECTED DAY's served row total — `monthCounts` for the day
 * the whole app is reading. The demo carried "active" (queued + running across
 * every workflow), which the projection does not serve as a fact; deriving it
 * here would mean folding rows, which is the second count path D81 deletes. The
 * number is therefore the day's rows, and it says so in its own label rather
 * than wearing a different quantity's name.
 *
 * At zero it dims rather than vanishing, so the action bar does not reflow every
 * time the day goes idle.
 */
export function WorkflowPanelToggle({
  mode,
  onMode,
  activeWorkflowLabel,
  dayCount,
}: PanelModeProps & {
  activeWorkflowLabel: string;
  /** the selected day's served row total */
  dayCount: number;
}) {
  const showing = mode !== "icon";
  const scope = `${plural(dayCount, "row")} on this day, across every workflow`;
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
      title={`Workflow Panel — ${activeWorkflowLabel}\n${scope}\nThe Status Bar's Needs you pill is attention, not this count\nw cycles floating · icon · sidebar`}
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
      <span aria-hidden className={cn("mx-[var(--ds-space-hair)] h-4 w-px shrink-0", "bg-[var(--ds-border-loud)]")} />
      <span
        className={cn(
          dsText.nums,
          "shrink-0 tabular-nums",
          dsMotion.base,
          dayCount > 0
            ? "font-semibold text-[color:var(--ds-status-waiting-fg)]"
            : "text-[color:var(--ds-fg-faint)]",
        )}
      >
        {dayCount}
      </span>
    </button>
  );
}

export interface WorkflowRailGroup {
  readonly label: string;
  readonly entries: readonly WorkflowBootstrapPrimitive[];
}

/**
 * The rail's groups, in the server's display order.
 *
 * Membership is each workflow's OWN `categoryId` and the order is the served
 * category `order` — so a workflow the backend serves can never be missing from
 * the rail and can never sit under a heading the product does not use. A
 * category nothing is registered under is DROPPED rather than rendered as an
 * empty heading; a workflow whose category the server did not send falls into a
 * trailing `Other` rather than disappearing.
 */
export function buildWorkflowRailGroups(
  workflows: readonly WorkflowBootstrapPrimitive[],
  categories: readonly WorkflowCategoryPrimitive[],
): WorkflowRailGroup[] {
  const ordered = [...categories].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const groups: WorkflowRailGroup[] = [];
  for (const category of ordered) {
    const entries = workflows.filter((workflow) => workflow.categoryId === category.id);
    if (entries.length > 0) groups.push({ label: category.label, entries });
  }
  const known = new Set(categories.map((category) => category.id));
  const orphans = workflows.filter((workflow) => !known.has(workflow.categoryId));
  if (orphans.length > 0) groups.push({ label: "Other", entries: orphans });
  return groups;
}

function WorkflowEntryList({
  workflows,
  categories,
  counts,
  activeWorkflowId,
  onActive,
}: {
  workflows: readonly WorkflowBootstrapPrimitive[];
  categories: readonly WorkflowCategoryPrimitive[];
  counts: readonly WorkflowCountWire[];
  activeWorkflowId: string;
  onActive: (workflowId: string) => void;
}) {
  const groups = useMemo(() => buildWorkflowRailGroups(workflows, categories), [workflows, categories]);

  const entry = (workflow: WorkflowBootstrapPrimitive): ReactElement => {
    const id = String(workflow.id);
    const total = workflowCount(counts, id);
    const on = id === activeWorkflowId;
    const unavailable = workflow.availability.state === "unavailable";
    return (
      <button
        type="button"
        aria-current={on ? "page" : undefined}
        disabled={unavailable}
        title={workflow.availability.state === "unavailable" ? workflow.availability.reason : undefined}
        onClick={() => onActive(id)}
        className={cn(
          "group flex w-full cursor-pointer items-stretch text-left",
          "gap-[var(--ds-space-base)] pl-[var(--ds-space-tight)] pr-[var(--ds-space-base)]",
          dsSize.hRow,
          dsRadius.md,
          dsFocus,
          dsMotion.base,
          "disabled:cursor-default",
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
        <span className="flex min-w-0 flex-1 items-center">
          <span
            className={cn(
              dsText.ui,
              "truncate",
              unavailable
                ? "font-medium text-[color:var(--ds-fg-faint)]"
                : on
                  ? "font-semibold text-[color:var(--ds-fg)]"
                  : "font-medium text-[color:var(--ds-fg-secondary)]",
            )}
          >
            {workflow.label}
          </span>
        </span>
        {/* The workflow's served row total for the selected day — the SAME
            number the Status Bar and the queue read, off the same projection.
            At zero it DIMS rather than disappearing so the eye does not have to
            re-scan an idle panel. */}
        <span
          title={`${workflow.label}: ${plural(total, "row")} today`}
          aria-label={`${total} in ${workflow.label}`}
          className={cn(dsText.meta, dsText.nums, "flex shrink-0 items-center justify-end")}
        >
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
      {/* The column is named ONCE, as a head, not per row: a bare number on
          every entry is the anonymous-badge problem the launcher had. */}
      <div
        className={cn(
          dsText.caps,
          "flex items-center justify-end px-[var(--ds-space-cozy)] pb-[var(--ds-space-snug)] text-[color:var(--ds-fg-muted)]",
        )}
      >
        <span>rows</span>
      </div>
      {groups.map((group) => (
        <div key={group.label} className="pb-[var(--ds-space-cozy)]">
          {/* More air above a group heading than below it — the label belongs to
              the list under it, not to the one it just left. */}
          <div className={cn(dsText.caps, "px-[var(--ds-space-cozy)] pb-[var(--ds-space-snug)] text-[color:var(--ds-fg-muted)]")}>
            {group.label}
          </div>
          <ul className="flex flex-col gap-px px-[var(--ds-space-snug)]">
            {group.entries.map((workflow) => (
              <li key={String(workflow.id)}>{entry(workflow)}</li>
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
  categories: readonly WorkflowCategoryPrimitive[];
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

/* ── Status Bar ──────────────────────────────────────────────────────────── */

/**
 * `all`, the composite `needsYou`, and each of the eight served statuses. Every
 * status is reachable; none is folded away, and none is counted twice — each
 * row lands in exactly one status bucket, and `needsYou` is the only deliberate
 * overlap (it is a composite of two of them, labelled as such).
 */
export type StatusBucket = "all" | "needsYou" | QueueStatus;

/**
 * The demo's visual order, in the wire's vocabulary:
 * queued · running · waiting · parked · verified Done · Done-with-warnings ·
 * failed · cancelled.
 */
const STATUS_PILL_ORDER: QueueStatus[] = [
  "queued",
  "running",
  "awaiting-approval",
  "blocked",
  "done",
  "partial",
  "failed",
  "cancelled",
];

/** The two statuses that are stuck on a decision from the operator. */
const NEEDS_YOU_STATUSES: QueueStatus[] = ["awaiting-approval", "blocked"];

/**
 * The `Needs you` composite, over the SERVED counts.
 *
 * This adds two numbers the projection served; it does not count rows. That
 * distinction is the whole of D81 — the risk is a second CORPUS, and there is
 * none here: the sum is a pure function of the same `statusCounts` array the
 * two pills beside it render, so it cannot disagree with them.
 */
export function needsYouCount(counts: readonly StatusCountWire[]): number {
  return NEEDS_YOU_STATUSES.reduce((total, status) => total + statusCount(counts, status), 0);
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
 */
export function StatusFilters({
  statusCounts,
  dayCount,
  active,
  onSelect,
}: {
  statusCounts: readonly StatusCountWire[];
  /** the selected day's served row total — the `All` scope's number */
  dayCount: number;
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
      <button
        key={key}
        type="button"
        aria-pressed={on}
        title={title}
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
    );
  };

  const statusPill = (status: QueueStatus): ReactElement => {
    const on = active === status;
    const value = statusCount(statusCounts, status);
    const empty = value === 0 && !on;
    const spec = PROPOSED_STATUS[dsStatusOf(status)];
    const Icon = spec.icon;
    return (
      <button
        key={status}
        type="button"
        aria-pressed={on}
        // The ACCESSIBLE name, not the drawn word: `verifiedDone` and
        // `doneWarnings` both DRAW `Done`, separated by hue and by the amber
        // triangle — so the two filters computed the identical name
        // `Done — 2` and a screen-reader operator could not tell which pill
        // was which (D22, amended 2026-08-04). The visible pill is untouched.
        aria-label={`${spec.accessibleLabel} — ${value}`}
        title={spec.meaning}
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
        {scope("all", "All", LayoutDashboard, "text-[color:var(--ds-fg-muted)]", "Every row in this view", dayCount, "start")}
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

/* ── Session Panel ───────────────────────────────────────────────────────── */

type WorkerState = WorkerCardWire["state"];

/**
 * A worker's state, on the same hue ramp as everything else, so "this daemon is
 * alive" and "this row is running" are not two unrelated blues.
 */
const WORKER_TONE: Record<WorkerState, { dot: string; label: string; text: string }> = {
  working: { dot: "bg-[var(--ds-success-fg)]", label: "Working", text: "text-[color:var(--ds-success-fg)]" },
  waiting: {
    dot: "bg-[var(--ds-status-waiting-fg)]",
    label: "Waiting",
    text: "text-[color:var(--ds-status-waiting-fg)]",
  },
  idle: { dot: "bg-[var(--ds-fg-faint)]", label: "Idle", text: "text-[color:var(--ds-fg-muted)]" },
  paused: {
    dot: "bg-[var(--ds-status-parked-fg)]",
    label: "Paused",
    text: "text-[color:var(--ds-status-parked-fg)]",
  },
  stopped: { dot: "bg-[var(--ds-fg-faint)] opacity-60", label: "Stopped", text: "text-[color:var(--ds-fg-muted)]" },
  failed: { dot: "bg-[var(--ds-danger)]", label: "Failed", text: "text-[color:var(--ds-danger)]" },
};

const WORKER_STATE_ORDER: WorkerState[] = ["working", "waiting", "idle", "paused", "failed", "stopped"];

/** The tallies the collapsed bar always shows, even at zero. */
const ALWAYS_TALLIED: WorkerState[] = ["working", "idle"];

/**
 * The connection, as the operator sees it — the whole point of the bar's right
 * edge. `live` is the only quiet state; everything else says what is wrong,
 * because a dashboard that has stopped receiving patches while still painting
 * the last snapshot is the exact failure doc 13 §3.5 forbids.
 */
export function connectionTone(state: SubscriptionState): {
  label: string;
  text: string;
  dot: string;
  detail?: string;
} {
  if (state.state === "live") {
    return {
      label: "Live",
      text: "text-[color:var(--ds-success-fg)]",
      dot: "bg-[var(--ds-success-fg)] animate-pulse motion-reduce:animate-none",
    };
  }
  if (state.state === "connecting" || state.state === "reconnecting") {
    return {
      label: state.state === "connecting" ? "Connecting" : "Reconnecting",
      text: "text-[color:var(--ds-status-waiting-fg)]",
      dot: "bg-[var(--ds-status-waiting-fg)] animate-pulse motion-reduce:animate-none",
    };
  }
  if (state.state === "degraded") {
    return {
      label: "Degraded",
      text: "text-[color:var(--ds-status-waiting-fg)]",
      dot: "bg-[var(--ds-status-waiting-fg)]",
    };
  }
  return {
    label: "Stopped",
    text: "text-[color:var(--ds-danger)]",
    dot: "bg-[var(--ds-danger)]",
    ...(state.error === undefined ? {} : { detail: state.error.message }),
  };
}

/**
 * One worker card.
 *
 * Everything on it is served: the worker's id, its system, its state, and the
 * run it is on. The demo's browser-health tile grid, micro-pipeline, elapsed
 * clock, queued count, lease-wait sentence and `Stop` button are NOT served by
 * the 1g projection and are omitted rather than drawn from nothing — an
 * invented health tile on a panel whose entire job is health would be the worst
 * possible lie.
 */
function WorkerCard({ card }: { card: WorkerCardWire }) {
  const tone = WORKER_TONE[card.state];
  return (
    <article
      className={cn(
        // No explicit height: `align-items: stretch` only stretches an item
        // whose cross size computes to `auto`, so an `h-full` here would opt
        // every card straight back out of the uniform row.
        "flex shrink-0 flex-col border",
        "w-[var(--ds-w-session-card)] gap-[var(--ds-space-snug)] p-[var(--ds-space-base)]",
        dsRadius.lg,
        dsSurface.card,
        card.state === "failed" ? "border-[color:var(--ds-danger-border)]" : dsBorder.base,
      )}
    >
      <div className="flex items-center gap-[var(--ds-space-snug)]">
        <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", tone.dot)} />
        <span className={cn(dsText.ui, "min-w-0 truncate font-semibold text-[color:var(--ds-fg)]")}>
          {String(card.workerId)}
        </span>
        <span className={cn(dsText.caps, "ml-auto shrink-0", tone.text)}>{tone.label}</span>
      </div>

      <SystemChip system={card.system} />

      {/* THE BASE — the run this worker is on, pinned to the bottom so a row of
          cards can be read across. `currentRun` is a served union: a worker
          with no run says WHY, in the server's own words. */}
      <div
        className={cn(
          dsText.meta,
          "mt-auto flex items-center border-t text-[color:var(--ds-fg-muted)]",
          dsBorder.subtle,
          "gap-[var(--ds-space-snug)] pt-[var(--ds-space-snug)]",
        )}
      >
        {card.currentRun.state === "present" ? (
          <span
            className={cn(dsText.nums, "min-w-0 flex-1 truncate")}
            title={`Run ${String(card.currentRun.runId)} · trace ${String(card.currentRun.traceId)}`}
          >
            {String(card.currentRun.traceId)}
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate">{card.currentRun.reason}</span>
        )}
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
  connection,
  appVersion,
}: {
  workerCards: readonly WorkerCardWire[];
  connection: SubscriptionState;
  appVersion: string;
}) {
  const [open, setOpen] = useState(false);
  const tallies = useMemo(() => {
    const byState = new Map<WorkerState, number>();
    for (const card of workerCards) byState.set(card.state, (byState.get(card.state) ?? 0) + 1);
    return WORKER_STATE_ORDER.map((state) => ({ state, count: byState.get(state) ?? 0 })).filter(
      (tally) => tally.count > 0 || ALWAYS_TALLIED.includes(tally.state),
    );
  }, [workerCards]);
  const attention = useMemo(
    () => workerCards.filter((card) => card.state === "failed" || card.state === "waiting").length,
    [workerCards],
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
              <span key={tally.state} className="inline-flex items-center gap-[var(--ds-space-tight)]">
                <span aria-hidden className={cn("size-1.5 rounded-full", WORKER_TONE[tally.state].dot)} />
                {tally.count} {WORKER_TONE[tally.state].label.toLowerCase()}
              </span>
            ))}
          </span>
          {attention > 0 && (
            <span
              className={cn(
                "inline-flex shrink-0 items-center border text-ellipsis",
                dsClip.token,
                "h-[var(--ds-h-xs)] gap-[var(--ds-space-tight)] px-[var(--ds-space-snug)]",
                dsRadius.sm,
                dsText.micro,
                "border-[color:var(--ds-status-waiting-border)] bg-[var(--ds-status-waiting-bg)] text-[color:var(--ds-status-waiting-fg)]",
              )}
            >
              <AlertTriangle aria-hidden className={cn(dsIcon.sm, "shrink-0")} />
              {plural(attention, "worker")} need attention
            </span>
          )}
        </button>
        <span className="flex shrink-0 items-center gap-[var(--ds-space-snug)]">
          <span
            title={`App ${appVersion} — every run on screen is being served by this build. A run that RAN under a different version carries its own.`}
            className={cn(dsText.meta, dsText.nums, "shrink-0 text-[color:var(--ds-fg-muted)]")}
          >
            v{appVersion}
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
          {workerCards.map((card) => (
            <WorkerCard key={String(card.workerId)} card={card} />
          ))}
        </div>
      )}
    </section>
  );
}
