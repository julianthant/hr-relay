import { useViewState } from "../../../app/navigation/view-route-model.js";
import { shortcutActionForEvent, useShortcutPreferences } from "../../settings/navigation/keyboard-preferences-model.js";
import { useEffect, useId, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Button, DatePicker, Dialog, DialogContent, dsFocus } from "../../../ds/ui.js";
import { Command, CommandInput, CommandEmpty, CommandGroup, CommandItem, CommandList } from "../../../ds/primitives/command.js";
import { cn } from "../../../lib/utils.js";
import type { NavControls } from "../navigation-controls.js";
import { navbarDayLabel, navbarSearch, type NavbarData, type NavbarSearchResult } from "./navbar-view-model.js";

const iconButton = cn("inline-flex size-7.5 shrink-0 items-center justify-center rounded-md text-ui-secondary hover:bg-ui-hover hover:text-ui-primary disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent", dsFocus);

export function RailSearch({ data, onResult }: { data: NavbarData; onResult: (result: NavbarSearchResult, opened: () => void, refused: (message: string) => void) => void }) {
  const preferences = useShortcutPreferences();
  const [open, setOpen] = useViewState("search", false);
  const [query, setQuery] = useViewState("searchQuery", "", "replace");
  const [notice, setNotice] = useState("");
  const [activeResult, setActiveResult] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const optionPrefix = useId();
  const results = data.unavailable ? [] : data.totalMatches === undefined ? navbarSearch(data.results, query) : data.results;
  const total = data.totalMatches ?? results.length;
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
    <button ref={trigger} type="button" aria-label="Search runs" title="Search runs" aria-haspopup="dialog" aria-expanded={open} className={iconButton} onClick={() => setOpen(true)}><Search aria-hidden className="size-4" /></button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent title="Search runs" description="Search recent runs by name, workflow or status." size="lg" className="navbar-search-dialog" onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus(); }}>
        <Command className="navbar-search-command" label="Search runs" value={activeResult} onValueChange={setActiveResult} shouldFilter={false} loop>
          <div className="p-4"><CommandInput ref={input} autoFocus aria-label="Search runs" aria-expanded="true" aria-activedescendant={results.some(result => result.id === activeResult) ? `${optionPrefix}-${activeResult}` : undefined} placeholder="Search by name, workflow or status…" value={query}
            onValueChange={value => { setQuery(value); setActiveResult(""); setNotice(""); }}
            onClear={() => { setQuery(""); setActiveResult(""); setNotice(""); input.current?.focus(); }} /></div>
          <CommandList label="Search results">
            <CommandEmpty>{data.unavailable ?? "No runs match your search."}</CommandEmpty>
            <CommandGroup heading={query.trim() ? "Matching runs" : "Recent runs"}>
              {results.map(result => <CommandItem asChild key={result.id} value={result.id} onSelect={() => { onResult(result, () => { setOpen(false); setNotice(""); }, setNotice); }}>
                <div id={`${optionPrefix}-${result.id}`}><div className="flex min-w-0 flex-1 flex-col gap-1 py-1"><div className="flex items-center justify-between gap-3"><strong className="truncate font-semibold">{result.subject}</strong><span className="shrink-0 text-caption text-ui-secondary">{result.state}</span></div><span className="truncate text-caption text-ui-muted">{result.workflow} · {navbarDayLabel(result.day)}</span></div></div>
              </CommandItem>)}
            </CommandGroup>
          </CommandList>
          <p role="status" className="m-0 border-t border-ui-stroke px-4 py-3 text-caption text-ui-muted">{notice || data.unavailable || `${total} ${total === 1 ? "run" : "runs"}`}</p>
        </Command>
      </DialogContent>
    </Dialog>
  </div>;
}

export function NavbarCalendar({ data }: { data: NavbarData; nav?: NavControls }) {
  const [day, setDay] = useState(data.today);
  return <DatePicker label="Dashboard date" triggerLabel="Choose date" hideLabel required value={day}
    onChange={next => { if (next !== "" && next <= data.today) setDay(next); }} max={data.today} className="w-44" footer={choose => <Button size="sm" variant="ghost" onClick={() => choose(data.today)}>Today</Button>} />;
}
