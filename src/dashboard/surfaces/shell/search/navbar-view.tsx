import { useViewState } from "../../../app/navigation/view-route-model.js";
import { shortcutActionForEvent, shortcutLabel, useShortcutPreferences } from "../../settings/navigation/keyboard-preferences-model.js";
import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Tooltip, dsFocus } from "../../../ds/ui.js";
import { cn } from "../../../lib/utils.js";
import type { NavbarData, NavbarSearchResult } from "./navbar-view-model.js";
import { SearchPalette } from "./search-palette.js";
import { type PaletteAction, type PaletteWorkflow } from "./search-palette-model.js";

const iconButton = cn("inline-flex size-7.5 shrink-0 items-center justify-center rounded-md text-ui-secondary hover:bg-ui-hover hover:text-ui-primary disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent", dsFocus);

export function RailSearch({ data, workflows, startKey, onAction, onWorkflow, onResult }: {
  data: NavbarData; workflows: readonly PaletteWorkflow[]; startKey?: string;
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
      event.preventDefault(); setQuery(""); setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preferences, setOpen, setQuery]);
  return <div className="rail-search">
    <Tooltip side="bottom" content="Search" shortcut={preferences.bindings.search[0] && shortcutLabel(preferences.bindings.search[0])}><button ref={trigger} type="button" aria-label="Search" aria-haspopup="dialog" aria-expanded={open} className={iconButton} onClick={() => { setQuery(""); setOpen(true); }}><Search aria-hidden className="size-4" /></button></Tooltip>
    <SearchPalette open={open} onOpenChange={next => { setOpen(next); setQuery(""); if (!next) setNotice(""); }} query={query} onQuery={value => { setQuery(value); setNotice(""); }}
      runs={data.unavailable ? [] : data.results} loading={data.loading === true} runsMatched={data.totalMatches !== undefined} workflows={workflows} sheets={data.sheets ?? []} startKey={startKey} onAction={onAction} onWorkflow={onWorkflow}
      onRun={result => onResult(result, () => { setOpen(false); setNotice(""); }, setNotice)} notice={notice || data.unavailable || data.sheetsUnavailable || ""}
      onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus(); }} />
  </div>;
}
