import {
Eye,
LayoutDashboard,
Minus,
PanelLeft,
  PictureInPicture2,
LayoutPanelLeft
} from "lucide-react";
import { useCallback,useEffect,useMemo,useRef,useState,type ComponentType,type ReactElement,type SVGProps } from "react";
import { BareButton, IconButton,Tooltip,dsBorder,dsElev,dsFocus,dsIcon,dsLayer,dsMotion,dsRadius,dsSize,dsSurface,dsText } from "../../ds/ui.js";
import { cn } from "../../lib/utils.js";
import { plural } from "../shared/status/format.js";
import {
WORKFLOW_PANEL_MODE_LABEL,
activeCount,
activeStatusWords,
buildWorkflowRailGroups,
needsYouCount,
statusCount,
statusPillOrder,
toolbarControl,
totalCount,
workflowCount,
workflowStatusCounts,
type StatusBucket,
type StatusCountWire,
type WorkflowBootstrapPrimitive,
type WorkflowCountWire,
type WorkflowPanelMode
} from "./shell-model.js";
import { PROPOSED_STATUS,dsStatusOf,type QueueStatus } from "../shared/status/status-model.js";
import {
type WorkflowGroupEntry,
} from "../workflows/workflow-category.js";


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


/** Icon-only launcher; served day demand stays in its accessible name and tooltip. */
export function WorkflowPanelToggle({
  mode,
  onMode,
  activeWorkflowLabel,
  activeWorkflowCode,
  dayActive,
  dayActiveWords,
  dayCount,
}: PanelModeProps & {
  activeWorkflowLabel: string;
  /** the active workflow's served 2-char code — the prefix of its trace ids */
  activeWorkflowCode: string;
  /** queued + running + cancelling across every workflow on the selected day */
  dayActive: number;
  dayActiveWords: string;
  /** the selected day's served row total — the denominator of the sentence */
  dayCount: number;
}) {
  const showing = mode !== "icon";
  const scope = `${dayActive} of ${plural(dayCount, "row")} across every workflow are ${dayActiveWords} today`;
  return (
    <BareButton
      id={WORKFLOW_PANEL_TOGGLE_ID}
      type="button"
      aria-expanded={showing}
      aria-controls={mode === "floating" ? WORKFLOW_PANEL_ID : undefined}
      aria-label={`Workflow Panel — ${activeWorkflowLabel}${showing ? `, ${WORKFLOW_PANEL_MODE_LABEL[mode]}` : ", minimised"}. ${scope}`}
      title={`Workflow Panel — ${activeWorkflowLabel} (${activeWorkflowCode})\n${scope}\nw cycles floating · icon · sidebar`}
      onClick={() => onMode(showing ? "icon" : "floating")}
      className={cn(
        toolbarControl(),
        "w-8 justify-center !px-0",
        dsMotion.fast,
        "active:translate-y-px",
        showing
          ? cn(dsBorder.loud, "bg-[var(--ds-surface-selected)] font-semibold text-[color:var(--ds-fg)]")
          : cn(dsBorder.strong, dsSurface.card, "text-[color:var(--ds-fg-muted)] hover:bg-[var(--ds-surface-3)] hover:text-[color:var(--ds-fg)]"),
      )}
    >
      <LayoutPanelLeft aria-hidden className={dsIcon.sm} />
    </BareButton>
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
      <BareButton
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
        {/* No gap: the span holds ONE child, so the gap was unrecorded spacing
            drift rather than a decision (D272 item 2, ledger row A81). */}
        <span className="flex min-w-0 flex-1 items-center">
          <span className={cn(dsText.ui, "truncate", labelWeight)}>{workflow.label}</span>
        </span>
        {/* `active │ all`, PER WORKFLOW, and it is the ONLY badge on the row —
            both numbers off the SAME served projection the Status Bar and the
            queue read. `active` is queued + running + cancelling, so the column says what
            the panel is DOING rather than what it has not begun: `queued`
            alone empties the moment a run starts, and every panel wearing a
            run then read `0`.

            Active (left) wears the same amber as the launcher badge, and at
            zero each arm DIMS rather than disappearing so the eye does not
            have to re-scan an idle panel. */}
        <span
          title={`${workflow.label}: ${active} active (${activeStatusWords(workflowStatusCounts(counts, id))}) of ${plural(total, "row")} today`}
          aria-label={`${active} active of ${total} in ${workflow.label}`}
          className={cn(
            dsText.meta,
            dsText.nums,
            // The demo's cluster exactly (D272 item 2, ledger row A82). The
            // extra `pl-base` this tree had added was an unrecorded spacing
            // change: the button's own `gap-base` is what separates a truncated
            // label from the numbers, and paying for it twice reads as a
            // different rail.
            "flex shrink-0 items-center justify-end gap-[var(--ds-space-hair)]",
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
      </BareButton>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto py-[var(--ds-space-cozy)]">
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
      <BareButton
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
      </BareButton>
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
      <BareButton
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
      </BareButton>
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
      {statusPillOrder(statusCounts, active).map(statusPill)}
    </div>
  );
}
export { SessionPanel } from "../sessions/session-panel.js";
