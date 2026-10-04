import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Undo2, Redo2, Moon, Settings, Sun } from "lucide-react";
import { Button, DatePicker, Dialog, DialogContent, SearchInput, dsFocus, type DemoTheme } from "../../ds/ui.js";
import { Command, CommandInput, CommandEmpty, CommandGroup, CommandItem, CommandList } from "../../ds/command.js";
import { cn } from "../../lib/utils.js";
import type { NavControls } from "../navigation-controls.js";
import { navbarDayLabel, navbarSearch, type NavbarData, type NavbarSearchResult } from "./navbar-view-model.js";

const iconButton = cn("inline-flex size-7.5 shrink-0 items-center justify-center rounded-md text-ui-secondary hover:bg-ui-hover hover:text-ui-primary disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent", dsFocus);

export function NavbarSearch({ data, onResult }: { data: NavbarData; onResult: (result: NavbarSearchResult) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [activeResult, setActiveResult] = useState("");
  const trigger = useRef<HTMLInputElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const optionPrefix = useId();
  const results = navbarSearch(data.results, query);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable=true], [role=dialog], [role=menu]")) return;
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault(); setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return <div className="navbar-search">
    <SearchInput ref={trigger} aria-label="Search runs" aria-haspopup="dialog" aria-expanded={open} placeholder="Search runs…" readOnly
      onClick={() => setOpen(true)} onKeyDown={event => {
        if (["Enter", " ", "/", "ArrowDown"].includes(event.key)) { event.preventDefault(); setOpen(true); }
      }} shortcut={<kbd aria-hidden className="text-caption">/</kbd>} />
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent title="Search runs" description="Search recent runs by name, workflow or status." size="lg" className="navbar-search-dialog" onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus(); }}>
        <Command className="navbar-search-command" label="Search runs" value={activeResult} onValueChange={setActiveResult} shouldFilter={false} loop>
          <div className="p-4"><CommandInput ref={input} autoFocus aria-label="Search runs" aria-expanded="true" aria-activedescendant={results.some(result => result.id === activeResult) ? `${optionPrefix}-${activeResult}` : undefined} placeholder="Search by name, workflow or status…" value={query}
            onValueChange={value => { setQuery(value); setActiveResult(""); setNotice(""); }}
            onClear={() => { setQuery(""); setActiveResult(""); setNotice(""); input.current?.focus(); }} /></div>
          <CommandList label="Search results">
            <CommandEmpty>No runs match your search.</CommandEmpty>
            <CommandGroup heading={query.trim() ? "Matching runs" : "Recent runs"}>
              {results.map(result => <CommandItem asChild key={result.id} value={result.id} onSelect={() => { onResult(result); setNotice("Run navigation is not connected yet."); }}>
                <div id={`${optionPrefix}-${result.id}`}><div className="flex min-w-0 flex-1 flex-col gap-1 py-1"><div className="flex items-center justify-between gap-3"><strong className="truncate font-semibold">{result.subject}</strong><span className="shrink-0 text-caption text-ui-secondary">{result.state}</span></div><span className="truncate text-caption text-ui-muted">{result.workflow} · {navbarDayLabel(result.day)}</span></div></div>
              </CommandItem>)}
            </CommandGroup>
          </CommandList>
          <p role="status" className="m-0 border-t border-ui-stroke px-4 py-3 text-caption text-ui-muted">{notice || `${results.length} ${results.length === 1 ? "run" : "runs"}`}</p>
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

export function NavbarView({ data, onDashboard, nav, theme, onToggleTheme, settingsOpen, onOpenSettings, onResult, notifications }: {
  data: NavbarData; onDashboard: () => void; nav: NavControls;
  theme: DemoTheme; onToggleTheme: () => void; settingsOpen: boolean; onOpenSettings: () => void;
  onResult: (result: NavbarSearchResult) => void; notifications: ReactNode;
}) {
  return <header role="banner" className="navbar-shell ui-theme-scope h-12 shrink-0 items-center gap-3 border-b border-ui-stroke bg-ui-panel px-3 font-ui text-ui-primary min-[1151px]:px-4">
    <div role="group" aria-label="Navigation history" className="flex items-center gap-0.5">
      <button type="button" aria-label="Back" title={nav.backTo ? `Back to ${nav.backTo}` : "Back"} disabled={!nav.canBack} className={iconButton} onClick={nav.onBack}><Undo2 aria-hidden className="size-4" /></button>
      <button type="button" aria-label="Forward" title={nav.forwardTo ? `Forward to ${nav.forwardTo}` : "Forward"} disabled={!nav.canForward} className={iconButton} onClick={nav.onForward}><Redo2 aria-hidden className="size-4" /></button>
    </div>
    <NavbarSearch data={data} onResult={onResult} />
    <div className="flex shrink-0 items-center justify-end gap-0.5">
      {notifications}
      <button type="button" aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} className={iconButton} onClick={onToggleTheme}>{theme === "dark" ? <Sun aria-hidden className="size-4" /> : <Moon aria-hidden className="size-4" />}</button>
      <button type="button" aria-label="Settings" title="Settings" aria-pressed={settingsOpen} className={cn(iconButton, settingsOpen && "bg-ui-table text-ui-primary")} onClick={settingsOpen ? onDashboard : onOpenSettings}><Settings aria-hidden className="size-4" /></button>
    </div>
  </header>;
}
