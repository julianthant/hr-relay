import { Button as HeroButton, ProgressBar as HeroProgressBar } from "@heroui/react";
import { useState, type DragEvent, type HTMLAttributes, type KeyboardEvent, type ReactNode, type TdHTMLAttributes, type ThHTMLAttributes } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, GripVertical } from "lucide-react";
import { cn } from "../../lib/utils.js";
import { IconButton } from "./primitives-core.js";
import { ShadcnTable, ShadcnTableBody, ShadcnTableCell, ShadcnTableHead, ShadcnTableHeader, ShadcnTableRow } from "./shadcn-table.js";
import { dsFocus, dsIcon, dsLayer, dsMotion, dsRadius, dsText } from "../theme/tokens.js";

/** Data display primitives: Table, ProgressBar, TimelineSteps. Density is the point. */

/** Table */

/** <Table label="Queued runs">
 * <THead><TR><TH>Person</TH><TH align="right">Elapsed</TH></TR></THead> */
export function Table({
  label,
  layout = "auto",
  rowCount,
  className,
  children,
}: {
  label: string;
  /** `fixed` sizes the columns from the first row (or a `<colgroup>`) and never
 * re-measures. Reach for it whenever the BODY IS WINDOWED: an `auto` table */
  layout?: "auto" | "fixed";
  /** `aria-rowcount`, for a table whose body is WINDOWED */
  rowCount?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <ShadcnTable
      aria-label={label}
      aria-rowcount={rowCount}
      className={cn(
        "w-full border-separate border-spacing-0 text-left",
        layout === "fixed" && "table-fixed",
        dsText.body,
        className,
      )}
    >
      {children}
    </ShadcnTable>
  );
}

/** Sticky by default — the header must survive scrolling a long queue. */
export function THead({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <ShadcnTableHeader className={cn("sticky top-0", dsLayer.sticky, "bg-[var(--ds-surface-2)]", className)}>
      {children}
    </ShadcnTableHeader>
  );
}

export function TBody({ className, children }: { className?: string; children: ReactNode }) {
  return <ShadcnTableBody className={className}>{children}</ShadcnTableBody>;
}

export function TR({
  selected,
  interactive,
  className,
  children,
  ...props
}: {
  selected?: boolean;
  interactive?: boolean;
  className?: string;
  children: ReactNode;
} & HTMLAttributes<HTMLTableRowElement>) {
  return (
    <ShadcnTableRow
      aria-selected={selected}
      className={cn(
        "h-[var(--ds-h-row)]",
        dsMotion.base,
                // A row that opens a panel DISCLOSES; it does not commit, so it takes no press dip.
        // spent on COMMANDs, so a row takes a hover tint and deliberately no press dip.
        interactive && "cursor-pointer hover:bg-[var(--ds-surface-2)]",
        selected && "bg-[var(--ds-surface-selected)]",
        className,
      )}
      {...props}
    >
      {children}
    </ShadcnTableRow>
  );
}

export type DsSortDirection = "ascending" | "descending" | "none";

export function TH({
  align = "left",
  sort,
  onSort,
  className,
  children,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & {
  align?: "left" | "right" | "center";
  /** present = sortable; drives `aria-sort` and the indicator glyph */
  sort?: DsSortDirection;
  onSort?: () => void;
}) {
  const SortIcon = sort === "ascending" ? ArrowUp : sort === "descending" ? ArrowDown : ChevronsUpDown;
  return (
    <ShadcnTableHead
      scope="col"
      aria-sort={sort}
      className={cn(
        "border-b border-[color:var(--ds-border)] px-[var(--ds-space-base)] py-[var(--ds-space-snug)]",
        dsText.caps,
        "text-[color:var(--ds-fg-muted)]",
        align === "right" && "text-right",
        align === "center" && "text-center",
        className,
      )}
      {...props}
    >
      {onSort ? (
        <HeroButton
          type="button"
          variant="ghost"
          onClick={onSort}
          className={cn(
            "inline-flex h-auto w-auto min-w-0 cursor-pointer items-center gap-[var(--ds-space-tight)] whitespace-nowrap border-0 bg-transparent p-0 shadow-none",
            dsFocus,
            dsMotion.fast,
            "hover:text-[color:var(--ds-fg)]",
            "active:translate-y-px",
          )}
        >
          {children}
          <SortIcon aria-hidden className={cn(dsIcon.sm, sort === "none" && "opacity-40")} />
        </HeroButton>
      ) : (
        children
      )}
    </ShadcnTableHead>
  );
}

export function TD({
  align = "left",
  numeric,
  className,
  children,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & {
  align?: "left" | "right" | "center";
  /** monospace + tabular — use it for every id, count, duration and amount */
  numeric?: boolean;
}) {
  return (
    <ShadcnTableCell
      className={cn(
        "border-b border-[color:var(--ds-border-subtle)] px-[var(--ds-space-base)] py-[var(--ds-space-snug)]",
        "text-[color:var(--ds-fg-secondary)]",
        align === "right" && "text-right",
        align === "center" && "text-center",
        numeric && dsText.nums,
        className,
      )}
      {...props}
    >
      {children}
    </ShadcnTableCell>
  );
}

export interface DsRankedItem {
  id: string;
  label: string;
  /** Editable content keeps the plain label available for move announcements. */
  content?: ReactNode;
  actions?: ReactNode;
  /** Optional quiet detail shown below or beside the primary label. */
  description?: string;
  /** A product-defined role such as Primary or Fallback. */
  role?: string;
}

/** A controlled ordered list with pointer drag and keyboard reordering. */
export function RankedList({
  label,
  items,
  onReorder,
  disabled = false,
  className,
}: {
  label: string;
  items: readonly DsRankedItem[];
  onReorder: (items: DsRankedItem[]) => void;
  /** Keep visible order readable while reordering is unavailable. */
  disabled?: boolean;
  className?: string;
}) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const move = (fromId: string, toIndex: number) => {
    if (disabled) return;
    const fromIndex = items.findIndex((item) => item.id === fromId);
    if (fromIndex < 0 || toIndex < 0 || toIndex >= items.length || fromIndex === toIndex) return;
    const next = [...items];
    const [item] = next.splice(fromIndex, 1);
    if (!item) return;
    next.splice(toIndex, 0, item);
    onReorder(next);
    setAnnouncement(`${item.label} moved to position ${toIndex + 1} of ${items.length}.`);
  };

  const onHandleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, id: string, index: number) => {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      move(id, index - 1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      move(id, index + 1);
    }
  };

  const onHandleDragStart = (event: DragEvent<HTMLButtonElement>, id: string) => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    setDraggedId(id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
  };

  const onItemDrop = (event: DragEvent<HTMLLIElement>, targetId: string) => {
    event.preventDefault();
    if (disabled) {
      setDraggedId(null);
      setDropTargetId(null);
      return;
    }
    const sourceId = event.dataTransfer.getData("text/plain") || draggedId;
    if (!sourceId || sourceId === targetId) {
      setDraggedId(null);
      setDropTargetId(null);
      return;
    }
    const fromIndex = items.findIndex((item) => item.id === sourceId);
    const targetIndex = items.findIndex((item) => item.id === targetId);
    const targetRect = event.currentTarget.getBoundingClientRect();
    const afterTarget = event.clientY >= targetRect.top + targetRect.height / 2;
    const finalIndex = targetIndex + Number(afterTarget) - Number(fromIndex < targetIndex);
    move(sourceId ?? "", finalIndex);
    setDraggedId(null);
    setDropTargetId(null);
  };

  return (
    <>
      <ol aria-label={label} aria-disabled={disabled || undefined} className={cn("ds-ranked-list", className)}>
        {items.map((item, index) => (
          <li
            key={item.id}
            className="ds-ranked-item"
            data-dragging={draggedId === item.id ? "true" : undefined}
            data-drop-target={dropTargetId === item.id ? "true" : undefined}
            onDragOver={(event) => {
              if (!disabled && draggedId) {
                event.preventDefault();
                setDropTargetId(item.id);
              }
            }}
            onDrop={(event) => onItemDrop(event, item.id)}
          >
            <span className="ds-ranked-position" aria-hidden="true">{index + 1}</span>
            <IconButton
              type="button"
              label={`Move ${item.label}. Position ${index + 1} of ${items.length}. Use arrow keys to reorder.`}
              aria-keyshortcuts="ArrowUp ArrowDown"
              disabled={disabled}
              variant="ghost"
              size="sm"
              draggable={!disabled}
              onKeyDown={(event) => onHandleKeyDown(event, item.id, index)}
              onDragStart={(event) => onHandleDragStart(event, item.id)}
              onDragEnd={() => { setDraggedId(null); setDropTargetId(null); }}
              icon={<GripVertical aria-hidden className={dsIcon.sm} />}
              className="ds-ranked-handle"
            />
            <span className="ds-ranked-label">
              {item.content ?? item.label}
              {item.description && <span className="ds-field-description block">{item.description}</span>}
            </span>
            {item.role && <span className="ds-ranked-role">{item.role}</span>}
            {item.actions}
          </li>
        ))}
      </ol>
      <span className="ds-ranked-live" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
    </>
  );
}



/** Use indeterminate progress when the denominator is unknown; never invent transaction completion. */
export function ProgressBar({
  value,
  max = 100,
  label,
  tone = "accent",
  showValue,
  className,
}: {
  /** omit for an indeterminate bar */
  value?: number;
  max?: number;
  /** accessible name — required */
  label: string;
  tone?: "accent" | "success" | "warning" | "danger";
  showValue?: boolean;
  className?: string;
}) {
  const indeterminate = typeof value !== "number";
  const pct = indeterminate ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  const fill =
    tone === "success"
      ? "bg-[var(--ds-success-fg)]"
      : tone === "warning"
        ? "bg-[var(--ds-status-waiting-mark)]"
        : tone === "danger"
          ? "bg-[var(--ds-danger-solid)]"
          : "bg-[var(--ds-accent)]";

  return (
    <HeroProgressBar
      value={value}
      maxValue={max}
      isIndeterminate={indeterminate}
      aria-label={label}
      className={cn("flex min-w-0 items-center gap-[var(--ds-space-base)]", className)}
    >
      <HeroProgressBar.Track
        className={cn("h-1 min-w-0 flex-1 overflow-hidden bg-[var(--ds-surface-3)]", dsRadius.pill)}
      >
        <HeroProgressBar.Fill
          className={cn(
            "h-full",
            fill,
            dsRadius.pill,
            indeterminate
              ? "w-1/3 animate-pulse motion-reduce:animate-none"
              : "transition-[width] duration-[var(--ds-dur-3)] ease-[var(--ds-ease-standard)]",
          )}
          style={indeterminate ? undefined : { width: `${pct}%` }}
        />
      </HeroProgressBar.Track>
      {showValue && !indeterminate && (
        <span className={cn(dsText.meta, dsText.nums, "shrink-0 text-[color:var(--ds-fg-muted)]")}>
          {Math.round(pct)}%
        </span>
      )}
    </HeroProgressBar>
  );
}



export type DsStepState = "done" | "current" | "pending" | "failed" | "skipped";

export interface DsStep {
  label: string;
  state: DsStepState;
  /** a duration or a note shown under the label in the `full` variant */
  detail?: string;
  /** Compare measured durations in one aligned unit column; unknown durations are never zero. */
  trailing?: string;
  /** Why `trailing` reads the way it does — carried on the row's `title`. */
  trailingTitle?: string;
}

const STEP_DOT: Record<DsStepState, string> = {
  done: "bg-[var(--ds-success-fg)] border-transparent",
  current: "bg-[var(--ds-status-running-mark)] border-transparent",
  pending: "bg-[var(--ds-surface-3)] border-[color:var(--ds-border-strong)]",
  failed: "bg-[var(--ds-status-failed-mark)] border-transparent",
  skipped: "bg-transparent border-[color:var(--ds-border-strong)]",
};

const STEP_TEXT: Record<DsStepState, string> = {
  done: "text-[color:var(--ds-fg-muted)]",
  current: "text-[color:var(--ds-fg)] font-medium",
  pending: "text-[color:var(--ds-fg-faint)]",
  failed: "text-[color:var(--ds-status-failed-fg)] font-medium",
  skipped: "text-[color:var(--ds-fg-faint)] line-through",
};

/** Decorative rails need an accessible summary; detailed rails identify the current step. */
export function TimelineSteps({
  steps,
  variant = "compact",
  label = "Progress",
  className,
}: {
  steps: DsStep[];
  variant?: "compact" | "full";
  label?: string;
  className?: string;
}) {
  if (variant === "compact") {
    const current = steps.find((step) => step.state === "current");
    const done = steps.filter((step) => step.state === "done").length;
    return (
      <div
        role="img"
        aria-label={`${label}: ${done} of ${steps.length} ${steps.length === 1 ? "step" : "steps"} done${current ? `, now ${current.label}` : ""}`}
        title={steps.map((step) => step.label).join(" · ")}
        className={cn("flex min-w-0 items-center", className)}
      >
        {steps.map((step, index) => (
          <span key={step.label} className="flex flex-1 items-center last:flex-none">
            <span
              aria-hidden
              className={cn("size-1.5 shrink-0 rounded-full border", STEP_DOT[step.state])}
            />
            {index < steps.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  "h-px min-w-[3px] flex-1",
                  step.state === "done"
                    ? "bg-[var(--ds-success-border)]"
                    : "bg-[var(--ds-border)]",
                )}
              />
            )}
          </span>
        ))}
      </div>
    );
  }

  return (
    <ol aria-label={label} className={cn("flex min-w-0 flex-col", className)}>
      {steps.map((step, index) => (
        <li
          key={step.label}
          aria-current={step.state === "current" ? "step" : undefined}
          className="flex min-w-0 gap-[var(--ds-space-base)]"
        >
          <span className="flex shrink-0 flex-col items-center">
            <span className={cn("mt-1 size-2 shrink-0 rounded-full border", STEP_DOT[step.state])} />
            {index < steps.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  "w-px flex-1",
                  step.state === "done" ? "bg-[var(--ds-success-border)]" : "bg-[var(--ds-border)]",
                )}
              />
            )}
          </span>
          <span className="flex min-w-0 flex-1 items-baseline gap-[var(--ds-space-base)] pb-[var(--ds-space-base)]">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className={cn(dsText.ui, STEP_TEXT[step.state])}>{step.label}</span>
              {step.detail && (
                <span className={cn(dsText.meta, dsText.nums, "text-[color:var(--ds-fg-faint)]")}>
                  {step.detail}
                </span>
              )}
            </span>
            {step.trailing !== undefined && (
              <span
                title={step.trailingTitle}
                className={cn(dsText.meta, dsText.nums, "shrink-0 text-[color:var(--ds-fg-faint)]")}
              >
                {step.trailing}
              </span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** KeyValue — the fact list under a run, a receipt or a record */

export function KeyValueList({
  items,
  className,
}: {
  items: { key: string; value: ReactNode; tone?: "default" | "warning" | "danger" }[];
  className?: string;
}) {
  return (
    <dl className={cn("grid grid-cols-[auto_1fr] gap-x-[var(--ds-space-cozy)] gap-y-[var(--ds-space-snug)]", className)}>
      {items.map((item) => (
        <div key={item.key} className="contents">
          <dt className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>{item.key}</dt>
          <dd
            className={cn(
              dsText.body,
              dsText.nums,
              "min-w-0 truncate",
              item.tone === "warning"
                ? "text-[color:var(--ds-status-waiting-fg)]"
                : item.tone === "danger"
                  ? "text-[color:var(--ds-danger)]"
                  : "text-[color:var(--ds-fg)]",
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
