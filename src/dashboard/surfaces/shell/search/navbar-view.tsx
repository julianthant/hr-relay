import { useViewState } from "../../../app/navigation/view-route-model.js";
import { shortcutActionForEvent, shortcutLabel, useShortcutPreferences } from "../../settings/navigation/keyboard-preferences-model.js";
import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Button, DatePicker, Tooltip, dsFocus } from "../../../ds/ui.js";
import { cn } from "../../../lib/utils.js";
import type { NavControls } from "../navigation-controls.js";
import type { NavbarData, NavbarSearchResult } from "./navbar-view-model.js";
import { SearchPalette } from "./search-palette.js";
import { statusMock } from "../../settings/status-mock/status-mock-model.js";
import { PALETTE_SPREADSHEETS, type PaletteAction } from "./search-palette-model.js";

const iconButton = cn("inline-flex size-7.5 shrink-0 items-center justify-center rounded-md text-ui-secondary hover:bg-ui-hover hover:text-ui-primary disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent", dsFocus);

export function RailSearch({ data, workflows, startKey, onAction, onWorkflow, onResult }: {
  data: NavbarData; workflows: readonly { id: string; label: string }[]; startKey?: string;
  onAction: (action: PaletteAction) => void; onWorkflow: (id: string) => void;
  onResult: (result: NavbarSearchResult, opened: () => void, refused: (message: string) => void) => void;
}) {
  const preferences = useShortcutPreferences();
  const [open, setOpen] = useViewState("search", false);
  const [query, setQuery] = useViewState("searchQuery", "", "replace");
  const [notice, setNotice] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable=true], [role=dialog], [role=menu]")) return;
      if (event.defaultPrevented || event.isComposing || shortcutActionForEvent(event, preferences) !== "search") return;
      event.preventDefault(); setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preferences, setOpen]);
  return <div className="rail-search">
    <Tooltip side="bottom" content="Search" shortcut={preferences.bindings.search[0] && shortcutLabel(preferences.bindings.search[0])}><button ref={trigger} type="button" aria-label="Search" aria-haspopup="dialog" aria-expanded={open} className={iconButton} onClick={() => setOpen(true)}><Search aria-hidden className="size-4" /></button></Tooltip>
    <SearchPalette open={open} onOpenChange={next => { setOpen(next); if (!next) setNotice(""); }} query={query} onQuery={value => { setQuery(value); setNotice(""); }}
      runs={data.unavailable ? [] : data.results} runsMatched={data.totalMatches !== undefined} workflows={workflows} sheets={data.sheets ?? (statusMock() === undefined ? [] : PALETTE_SPREADSHEETS)} startKey={startKey} onAction={onAction} onWorkflow={onWorkflow}
      onRun={result => onResult(result, () => { setOpen(false); setNotice(""); }, setNotice)} notice={notice || data.unavailable || data.sheetsUnavailable || ""}
      onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus(); }} />
  </div>;
}

export function NavbarCalendar({ data }: { data: NavbarData; nav?: NavControls }) {
  const [day, setDay] = useState(data.today);
  return <DatePicker label="Dashboard date" triggerLabel="Choose date" hideLabel required value={day}
    onChange={next => { if (next !== "" && next <= data.today) setDay(next); }} max={data.today} className="w-44" footer={choose => <Button size="sm" variant="ghost" onClick={() => choose(data.today)}>Today</Button>} />;
}
