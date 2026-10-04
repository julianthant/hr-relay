import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Moon, Settings, Sun } from "lucide-react";
import { Button, DatePicker, dsFocus, type DemoTheme } from "../../ds/ui.js";
import { Command, CommandInput, CommandEmpty, CommandGroup, CommandItem, CommandList } from "../../ds/command.js";
import { Popover as SearchPopover, PopoverAnchor as SearchPopoverAnchor, PopoverContent as SearchPopoverContent } from "../../ds/popover.js";
import { cn } from "../../lib/utils.js";
import type { NavControls } from "../navigation-controls.js";
import { navbarDayLabel, navbarSearch, type NavbarData, type NavbarSearchResult } from "./navbar-view-model.js";

const iconButton = cn("inline-flex size-7.5 shrink-0 items-center justify-center rounded-md text-ui-secondary hover:bg-ui-hover hover:text-ui-primary disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent", dsFocus);

export function NavbarSearch({ data, onResult }: { data: NavbarData; onResult: (result: NavbarSearchResult) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [activeResult, setActiveResult] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const command = useRef<HTMLDivElement>(null);
  // Stable option IDs bind the input to the lazily mounted result list.
  const optionPrefix = useId();
  const results = navbarSearch(data.results, query);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable=true], [role=dialog], [role=menu]")) return;
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      input.current?.focus();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return <Command ref={command} variant="inline" className="navbar-search" label="Search runs" value={activeResult} onValueChange={setActiveResult} shouldFilter={false} loop>
    <SearchPopover open={open} onOpenChange={setOpen}>
      <SearchPopoverAnchor asChild><div>
        <CommandInput ref={input} aria-label="Search runs" aria-expanded={open} aria-activedescendant={open && results.some(result => result.id === activeResult) ? `${optionPrefix}-${activeResult}` : undefined} placeholder="Search runs…" value={query}
          onValueChange={value => { setQuery(value); setActiveResult(""); setNotice(""); setOpen(true); }}
          onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
          onKeyDown={event => {
            if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") setOpen(true);
          }}
          onClear={() => { setQuery(""); setActiveResult(""); setNotice(""); input.current?.focus(); }}
          shortcut={<kbd aria-hidden className="rounded border border-ui-stroke px-1.5 text-caption">/</kbd>} />
      </div></SearchPopoverAnchor>
      <SearchPopoverContent container={command.current} role="presentation" className="navbar-search-results" align="center"
        onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={event => event.preventDefault()}>
        <CommandList label="Search results">
          <CommandEmpty>No runs match your search.</CommandEmpty>
          <CommandGroup heading={query.trim() ? "Matching runs" : "Recent runs"}>
            {results.map(result => <CommandItem asChild key={result.id} value={result.id} onSelect={() => { onResult(result); setNotice("Run navigation is not connected yet."); }}>
              <div id={`${optionPrefix}-${result.id}`}><div className="flex min-w-0 flex-1 flex-col gap-1 py-1"><div className="flex items-center justify-between gap-3"><strong className="truncate font-semibold">{result.subject}</strong><span className="shrink-0 text-caption text-ui-secondary">{result.state}</span></div><span className="truncate text-caption text-ui-muted">{result.workflow} · {navbarDayLabel(result.day)}</span></div></div>
            </CommandItem>)}
          </CommandGroup>
        </CommandList>
        <p role="status" className="m-0 border-t border-ui-stroke px-2 py-2 text-caption text-ui-muted">{notice || `${results.length} ${results.length === 1 ? "run" : "runs"}`}</p>
      </SearchPopoverContent>
    </SearchPopover>
  </Command>;
}

export function NavbarCalendar({ data }: { data: NavbarData }) {
  const [day, setDay] = useState(data.today);
  const count = data.counts[day];
  return <div className="ds-date-navigation flex h-8 shrink-0 items-center border p-px">
    <DatePicker label="Dashboard date" triggerLabel="Choose date" hideLabel required value={day} onChange={next => { if (next !== "" && next <= data.today) setDay(next); }} max={data.today}
      className="ds-date-picker--embedded w-36.5 [&_.date-input-group]:h-7 [&_.date-input-group__input]:px-1.5 [&_.date-input-group__input]:py-0 [&_.date-input-group__input]:text-body"
      footer={choose => <div className="mt-3 flex items-center justify-between border-t border-ui-stroke pt-2"><span className="text-caption text-ui-muted">Dates through {navbarDayLabel(data.today)}</span><Button size="sm" variant="ghost" onClick={() => choose(data.today)}>Today</Button></div>} />
    <span title={count === undefined ? "Run count unavailable" : `${count} runs`} className="mx-1 min-w-4.5 rounded bg-ui-table px-1 text-center text-caption tabular-nums text-ui-info">{count ?? "—"}</span>
  </div>;
}

export function NavbarView({ data, onDashboard, nav, theme, onToggleTheme, settingsOpen, onOpenSettings, onResult, notifications }: {
  data: NavbarData; onDashboard: () => void; nav: NavControls;
  theme: DemoTheme; onToggleTheme: () => void; settingsOpen: boolean; onOpenSettings: () => void;
  onResult: (result: NavbarSearchResult) => void; notifications: ReactNode;
}) {
  return <header role="banner" className="navbar-shell ui-theme-scope h-13.5 shrink-0 items-center gap-3 border-b border-ui-stroke bg-ui-panel px-3 font-ui text-ui-primary min-[1151px]:px-4">
    <div className="flex min-w-0 items-center gap-2 min-[1151px]:gap-3">
    <h1 aria-label="RRSS HR" className="m-0 shrink-0 whitespace-nowrap text-control font-semibold tracking-[var(--ds-tracking-brand)]"><button type="button" aria-label="Dashboard" onClick={onDashboard} className={cn("rounded", dsFocus)}>RRSS HR</button></h1>
    <div className="flex shrink-0 border-l border-ui-stroke pl-2 min-[1151px]:ml-1 min-[1151px]:pl-2.5"><button type="button" aria-label="Back" title={nav.backTo ? `Back to ${nav.backTo}` : "Back"} disabled={!nav.canBack} className={cn(iconButton, "size-7")} onClick={nav.onBack}><ArrowLeft aria-hidden className="size-3.5" /></button><button type="button" aria-label="Forward" title={nav.forwardTo ? `Forward to ${nav.forwardTo}` : "Forward"} disabled={!nav.canForward} className={cn(iconButton, "size-7")} onClick={nav.onForward}><ArrowRight aria-hidden className="size-3.5" /></button></div>
    </div>
    <NavbarSearch data={data} onResult={onResult} />
    <div className="flex shrink-0 items-center justify-end gap-3"><NavbarCalendar data={data} />
    <div className="flex shrink-0 items-center gap-0.5 border-l border-ui-stroke pl-2">
      {notifications}
      <button type="button" aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} className={iconButton} onClick={onToggleTheme}>{theme === "dark" ? <Sun aria-hidden className="size-4" /> : <Moon aria-hidden className="size-4" />}</button>
      <button type="button" aria-label="Settings" title="Settings" aria-pressed={settingsOpen} className={cn(iconButton, settingsOpen && "bg-ui-table text-ui-primary")} onClick={onOpenSettings}><Settings aria-hidden className="size-4" /></button>
    </div></div>
  </header>;
}
