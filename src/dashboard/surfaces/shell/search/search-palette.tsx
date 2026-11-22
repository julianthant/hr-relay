import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { ChartNoAxesColumn, Circle, CircleAlert, CircleCheck, Clock, FileSpreadsheet, ListTree, LoaderCircle, Play, Settings, Table2, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Kbd, Skeleton } from "../../../ds/ui.js";
import { workflowIcon } from "../../workflows/workflow-icons.js";
import { dsLayer } from "../../../ds/theme/tokens.js";
import { cn } from "../../../lib/utils.js";
import { PALETTE_FILTERS, paletteRowValue, paletteSections, type PaletteAction, type PaletteFilter, type PaletteRow, type PaletteSheet, type PaletteWorkflow } from "./search-palette-model.js";
import type { NavbarSearchResult } from "./navbar-view-model.js";
import "./search-palette.css";

const TONE_CLASS = { danger: "text-ui-danger", warning: "text-ui-warning", positive: "text-ui-positive", info: "text-ui-info", neutral: "" } as const;
const TONE_ICON: Record<keyof typeof TONE_CLASS, LucideIcon> = { danger: CircleAlert, warning: Clock, positive: CircleCheck, info: LoaderCircle, neutral: Circle };
const ACTION_ICON: Record<PaletteAction, LucideIcon> = { start: Play, spreadsheets: Table2, explorer: ListTree, analytics: ChartNoAxesColumn, settings: Settings };

function RowIcon({ row }: { row: PaletteRow }) {
  if (row.kind === "run") { const Icon = TONE_ICON[row.tone]; return <Icon aria-hidden className={cn(TONE_CLASS[row.tone], row.tone === "info" && "animate-spin motion-reduce:animate-none")} />; }
  if (row.kind === "action") { const Icon = ACTION_ICON[row.id]; return <Icon aria-hidden />; }
  if (row.kind === "workflow") { const Icon = workflowIcon(row.icon); return <Icon aria-hidden />; }
  return <FileSpreadsheet aria-hidden />;
}

/** Search Relay: quick actions, runs, workflows and spreadsheets in one palette. The input is its first row. */
export function SearchPalette({ open, onOpenChange, query, onQuery, runs, runsMatched, loading = false, workflows, sheets, startKey, onAction, onWorkflow, onRun, notice, onCloseAutoFocus }: {
  open: boolean; onOpenChange: (open: boolean) => void; query: string; onQuery: (query: string) => void;
  runs: readonly NavbarSearchResult[]; /** The served search already matched the query. */ runsMatched?: boolean; /** The served search has not answered yet. */ loading?: boolean; workflows: readonly PaletteWorkflow[]; sheets: readonly PaletteSheet[]; startKey?: string;
  onAction: (action: PaletteAction) => void; onWorkflow: (id: string) => void; onRun: (result: NavbarSearchResult) => void; notice: string;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const [filter, setFilter] = useState<PaletteFilter>("all");
  const sections = useMemo(() => paletteSections({ query, filter, runs, runsMatched, workflows, sheets }), [query, filter, runs, runsMatched, workflows, sheets]);
  useEffect(() => { if (!open) setFilter("all"); }, [open]);
  // cmdk leaves aria-activedescendant unset until the selection first moves
  const watchSelection = (root: HTMLElement | null) => {
    if (!root) return;
    const sync = () => {
      const input = root.querySelector("[cmdk-input]");
      const selected = root.querySelector('[cmdk-item][aria-selected="true"]');
      if (input && selected) input.setAttribute("aria-activedescendant", selected.id);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-selected"] });
    return () => observer.disconnect();
  };
  const choose = (row: PaletteRow) => {
    if (row.kind === "run") onRun(row.result);
    else { onOpenChange(false); if (row.kind === "action") onAction(row.id); else if (row.kind === "workflow") onWorkflow(row.id); else onAction("spreadsheets"); }
  };
  return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={cn("search-palette-scrim", dsLayer.modal)} />
      <DialogPrimitive.Content aria-describedby={undefined} className={cn("search-palette ds-menu-surface font-ui", dsLayer.modal)} onCloseAutoFocus={onCloseAutoFocus}
        onEscapeKeyDown={event => { if (query !== "") { event.preventDefault(); onQuery(""); } }}>
        <DialogPrimitive.Title className="sr-only">Search Relay</DialogPrimitive.Title>
        <Command ref={watchSelection} shouldFilter={false} loop label="Search Relay" className="flex min-h-0 flex-1 flex-col">
          <Command.Input autoFocus aria-label="Search Relay" placeholder="Search Relay" value={query} onValueChange={onQuery} className="search-palette-input" />
          <div className="search-palette-chips" role="group" aria-label="Filter results">
            {PALETTE_FILTERS.map(chip => <button key={chip.id} type="button" aria-pressed={filter === chip.id} onClick={() => setFilter(chip.id)}>{chip.label}</button>)}
          </div>
          <Command.List label="Results" className="search-palette-list">
            {sections.length === 0 && !loading && <p role="status" className="search-palette-empty">No matches</p>}
            {sections.map(section => <Command.Group key={section.id} aria-label={section.label}>
              <div aria-hidden className="search-palette-label">{section.label}</div>
              {section.rows.map(row => <Command.Item key={paletteRowValue(row)} value={paletteRowValue(row)} className="search-palette-row" onSelect={() => choose(row)}>
                <RowIcon row={row} /><span className="search-palette-row-label">{row.label}</span>
                {row.kind === "action" && row.id === "start" && startKey && <Kbd>{startKey}</Kbd>}
                {(row.kind === "run" || row.kind === "sheet") && <span className="search-palette-row-tag">{row.tag}</span>}
              </Command.Item>)}
            </Command.Group>)}
            {loading && <div role="status" aria-label="Loading runs" className="search-palette-skeletons">
              <div aria-hidden className="search-palette-label">Runs</div>
              {[0, 1, 2].map(index => <div key={index} aria-hidden className="search-palette-row search-palette-skeleton-row"><Skeleton className="size-4 shrink-0 rounded-full" /><Skeleton className="h-3 flex-1" /><Skeleton className="h-3 w-16" /></div>)}
            </div>}
          </Command.List>
        </Command>
        {notice && <p role="status" className="search-palette-notice">{notice}</p>}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}
