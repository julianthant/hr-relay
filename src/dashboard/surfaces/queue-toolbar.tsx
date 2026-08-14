/**
 * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * src/dashboard/components/dev/rebuild-demo/DemoBulkBar.tsx (`DemoQueueToolbar`
 * :98 and its select-mode band).
 *
 * ONE BAR, THREE GROUPS, and the grouping is by what a control DOES — doc 03
 * §Shell's "one composed action bar", and DESIGN.md's "toolbars group by what a
 * control DOES, separated by a hairline, not by uniform gaps":
 *
 *   WHERE YOU ARE and WHAT YOU START, left  — the Workflow Panel toggle, then
 *     the intake route, then the one primary on the surface;
 *   WHAT YOU ARE LOOKING AT, middle         — the status filters, taking the
 *     slack and scrolling sideways at a narrow window rather than folding a
 *     status behind an overflow menu;
 *   HOW YOU ARE LOOKING AT IT, right        — sort, then select.
 *
 * The row never wraps: a fixed `--ds-h-bar` with `flex-wrap` silently CLIPS the
 * second line, so the middle group scrolls instead.
 *
 * WHAT IS DELIBERATELY NOT PORTED: `runBulkCommand` and the four bulk command
 * buttons. The demo sends `retry` / `bump` / `cancel` / `hide` from each row's
 * own served `actions[]`, and this projection serves NO row actions at all —
 * `QueueSurfaceWire` has no `actions` field, and the only served descriptors in
 * the tree are the run-detail gate and write resolutions (D198). Drawing four
 * buttons that could not be sent would be exactly the fabricated command
 * surface the fail-loud rule exists to prevent, so select mode states what it
 * can do in one line instead. See the band below.
 */
import type { ReactNode } from "react";
import { ArrowUpDown, CheckSquare, Square } from "lucide-react";
import { cn } from "../lib/utils.js";
import {
  Button,
  Select,
  dsBorder,
  dsIcon,
  dsSize,
  dsSurface,
  dsText,
} from "../ds/ui.js";
import { toolbarControl } from "./shell.js";
import { QUEUE_SORTS, type QueueSortKey } from "./queue.js";

export function QueueToolbar({
  sort,
  onSort,
  selectMode,
  onSelectMode,
  selectedCount,
  visibleIds,
  onSelectAll,
  onClearSelection,
  leading,
  runStart,
  filters,
}: {
  sort: QueueSortKey;
  onSort: (key: QueueSortKey) => void;
  selectMode: boolean;
  onSelectMode: (on: boolean) => void;
  selectedCount: number;
  /** the top-level rows currently on screen — the only things Select all may take */
  visibleIds: readonly string[];
  onSelectAll: () => void;
  onClearSelection: () => void;
  /** shell-owned, far left: the Workflow Panel toggle, where its column began */
  leading?: ReactNode;
  /** shell-owned: the intake route and the one Run Modal's primary control */
  runStart?: ReactNode;
  /** shell-owned: the status filter group, folded in from its own band */
  filters?: ReactNode;
}) {
  const allSelected = visibleIds.length > 0 && selectedCount === visibleIds.length;

  return (
    <div className={cn("flex shrink-0 flex-col border-b", dsBorder.subtle)}>
      <div className={cn("flex items-center", dsSize.hBar, "gap-[var(--ds-space-snug)] px-[var(--ds-shell-inset)]")}>
        {leading}
        {runStart}
        {(leading !== undefined || runStart !== undefined) && (
          <span aria-hidden className={cn("h-4 w-px shrink-0", "bg-[var(--ds-border)]")} />
        )}

        <div className="flex min-w-0 flex-1 items-center">{filters}</div>

        <span aria-hidden className={cn("h-4 w-px shrink-0", "bg-[var(--ds-border)]")} />

        {/* Sort is ONE control. The `⇅` is this select's ICON, never a glyph a
            gap away from the control it belongs to. It is the `Select`
            PRIMITIVE at `variant="toolbar"`, not a local copy: a bare
            `<select>` is `inline-block` on a line box's baseline and sits
            ~1.25px low however the height token is spelled, and the primitive's
            flex wrapper is where that is fixed once for every consumer. */}
        <Select
          variant="toolbar"
          aria-label="Order the queue"
          value={sort}
          onChange={(event) => onSort(event.target.value as QueueSortKey)}
          title={QUEUE_SORTS.find((entry) => entry.key === sort)?.note}
          icon={<ArrowUpDown className={dsIcon.sm} />}
        >
          {QUEUE_SORTS.map((entry) => (
            <option key={entry.key} value={entry.key}>
              {entry.label}
            </option>
          ))}
        </Select>

        <button
          type="button"
          aria-pressed={selectMode}
          title="Pick several rows at once"
          onClick={() => onSelectMode(!selectMode)}
          className={cn(
            toolbarControl(),
            selectMode
              ? cn(dsBorder.loud, "bg-[var(--ds-surface-selected)] font-semibold text-[color:var(--ds-fg)]")
              : cn(
                dsBorder.base,
                dsSurface.card,
                "text-[color:var(--ds-fg-muted)] hover:bg-[var(--ds-surface-3)] hover:text-[color:var(--ds-fg)]",
              ),
          )}
        >
          {selectMode ? (
            <CheckSquare aria-hidden className={dsIcon.sm} />
          ) : (
            <Square aria-hidden className={dsIcon.sm} />
          )}
          Select
        </button>
      </div>

      {/* SELECT MODE IS A MODE, so it gets its own band rather than six more
          controls shoved into a bar already carrying three groups. It exists
          only while the mode is on, so it costs nothing at rest.

          THE ACTION STRIP IS EMPTY, AND THE BAND SAYS SO. The demo's four bulk
          commands come from each selected row's served `actions[]`; this
          projection serves none, so there is nothing to offer and the band
          states that rather than drawing four buttons whose press could only
          fail. This sentence is a REFUSAL — what cannot be done and why — which
          is one of DESIGN.md's two exemptions from "the product does not explain
          itself", not a caption on a control. */}
      {selectMode && (
        <div
          className={cn(
            "flex items-center border-t bg-[var(--ds-recess-bg)]",
            dsSize.hBar,
            dsBorder.subtle,
            "gap-[var(--ds-space-snug)] px-[var(--ds-shell-inset)]",
          )}
        >
          <Button
            size="sm"
            variant="secondary"
            disabled={visibleIds.length === 0}
            onClick={allSelected ? onClearSelection : onSelectAll}
          >
            {allSelected ? "Clear" : `Select all ${visibleIds.length} in view`}
          </Button>
          <span className={cn(dsText.meta, dsText.nums, "shrink-0 text-[color:var(--ds-fg-muted)]")}>
            {selectedCount} selected
          </span>
          <span className={cn(dsText.meta, "ml-auto min-w-0 truncate text-[color:var(--ds-fg-muted)]")}>
            No command is served for a queue row yet, so nothing can be applied to a selection.
          </span>
        </div>
      )}
    </div>
  );
}
