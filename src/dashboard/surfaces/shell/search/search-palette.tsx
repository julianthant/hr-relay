import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { Circle, CircleAlert, CircleCheck, Clock, FileSpreadsheet, LoaderCircle, Play, Settings, Table2, Workflow, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { dsLayer } from "../../../ds/theme/tokens.js";
import { cn } from "../../../lib/utils.js";
import { PALETTE_FILTERS, paletteRowValue, paletteSections, type PaletteAction, type PaletteFilter, type PaletteRow, type PaletteSheet } from "./search-palette-model.js";
import type { NavbarSearchResult } from "./navbar-view-model.js";
import "./search-palette.css";

const TONE_CLASS = { danger: "text-ui-danger", warning: "text-ui-warning", positive: "text-ui-positive", info: "text-ui-info", neutral: "" } as const;
const TONE_ICON: Record<keyof typeof TONE_CLASS, LucideIcon> = { danger: CircleAlert, warning: Clock, positive: CircleCheck, info: LoaderCircle, neutral: Circle };
const ACTION_ICON: Record<PaletteAction, LucideIcon> = { start: Play, spreadsheets: Table2, settings: Settings };

function RowIcon({ row }: { row: PaletteRow }) {
  if (row.kind === "run") { const Icon = TONE_ICON[row.tone]; return <Icon aria-hidden className={cn(TONE_CLASS[row.tone], row.tone === "info" && "animate-spin motion-reduce:animate-none")} />; }
  if (row.kind === "action") { const Icon = ACTION_ICON[row.id]; return <Icon aria-hidden />; }
  return row.kind === "workflow" ? <Workflow aria-hidden /> : <FileSpreadsheet aria-hidden />;
}

/** Search Relay: quick actions, runs, workflows and spreadsheets in one palette. The input is its first row. */
export function SearchPalette({ open, onOpenChange, query, onQuery, runs, runsMatched, workflows, sheets, startKey, onAction, onWorkflow, onRun, notice, onCloseAutoFocus }: {
  open: boolean; onOpenChange: (open: boolean) => void; query: string; onQuery: (query: string) => void;
  runs: readonly NavbarSearchResult[]; /** The served search already matched the query. */ runsMatched?: boolean; workflows: readonly { id: string; label: string }[]; sheets: readonly PaletteSheet[]; startKey?: string;
  onAction: (action: PaletteAction) => void; onWorkflow: (id: string) => void; onRun: (result: NavbarSearchResult) => void; notice: string;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const [filter, setFilter] = useState<PaletteFilter>("all");
  const sections = useMemo(() => paletteSections({ query, filter, runs, runsMatched, workflows, sheets }), [query, filter, runs, runsMatched, workflows, sheets]);
  useEffect(() => { if (!open) setFilter("all"); }, [open]);
  const choose = (row: PaletteRow) => {
    if (row.kind === "run") onRun(row.result);
    else { onOpenChange(false); if (row.kind === "action") onAction(row.id); else if (row.kind === "workflow") onWorkflow(row.id); else onAction("spreadsheets"); }
  };
  return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={cn("search-palette-scrim", dsLayer.modal)} />
      <DialogPrimitive.Content aria-describedby={undefined} className={cn("search-palette ds-menu-surface font-ui", dsLayer.modal)} onCloseAutoFocus={onCloseAutoFocus}>
        <DialogPrimitive.Title className="sr-only">Search Relay</DialogPrimitive.Title>
        <Command shouldFilter={false} loop label="Search Relay" className="flex min-h-0 flex-1 flex-col">
          <Command.Input autoFocus aria-label="Search Relay" placeholder="Search Relay" value={query} onValueChange={onQuery} className="search-palette-input" />
          <Command.List label="Results" className="search-palette-list">
            {sections.length === 0 && <p role="status" className="search-palette-empty">No matches</p>}
            {sections.map(section => <Command.Group key={section.id} aria-label={section.label}>
              <div aria-hidden className="search-palette-label">{section.label}</div>
              {section.rows.map(row => <Command.Item key={paletteRowValue(row)} value={paletteRowValue(row)} className="search-palette-row" onSelect={() => choose(row)}>
                <RowIcon row={row} /><span className="search-palette-row-label">{row.label}</span>
                {row.kind === "action" && row.id === "start" && startKey && <kbd className="search-palette-key">{startKey}</kbd>}
                {(row.kind === "run" || row.kind === "sheet") && <span className="search-palette-row-tag">{row.tag}</span>}
              </Command.Item>)}
            </Command.Group>)}
          </Command.List>
        </Command>
        {notice && <p role="status" className="search-palette-notice">{notice}</p>}
        <div className="search-palette-chips" role="group" aria-label="Filter results">
          {PALETTE_FILTERS.map(chip => <button key={chip.id} type="button" aria-pressed={filter === chip.id} onClick={() => setFilter(chip.id)}>{chip.label}</button>)}
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}
