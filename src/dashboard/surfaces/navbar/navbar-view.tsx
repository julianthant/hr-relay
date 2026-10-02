import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, ChevronLeft, ChevronRight, Moon, Search, Settings, Sun, X } from "lucide-react";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger, dsFocus, type DemoTheme } from "../../ds/ui.js";
import { cn } from "../../lib/utils.js";
import type { NavControls } from "../navigation-controls.js";
import type { ShellView, ShellViewSelection } from "../top-bar-model.js";
import { NAVBAR_VIEWS, navbarCalendarKey, navbarDayLabel, navbarMonthCells, navbarMonthLabel, navbarSearch, navbarShiftDay, navbarShiftMonth, type NavbarData, type NavbarSearchResult } from "./navbar-view-model.js";

const iconButton = cn("inline-flex size-7.5 shrink-0 items-center justify-center rounded-md text-ui-secondary hover:bg-ui-hover hover:text-ui-primary disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent", dsFocus);
const floating = "ui-theme-scope bg-ui-panel font-ui text-ui-primary border-ui-stroke-control [&>div:last-child]:p-0";

export function NavbarSearch({ data, onResult }: { data: NavbarData; onResult: (result: NavbarSearchResult) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const results = navbarSearch(data.results, query);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.closest("input, textarea, select, [contenteditable=true], [role=dialog]"))) return;
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => input.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><button type="button" aria-label="Search runs" className={cn("ml-auto flex h-8 min-w-38.5 max-w-75 flex-1 items-center gap-2 rounded-md border border-ui-stroke-control bg-ui-canvas px-2.5 text-body text-ui-muted hover:bg-ui-hover", dsFocus)}><Search aria-hidden className="size-3.5" /><span>Search runs…</span><kbd aria-hidden className="ml-auto rounded border border-ui-stroke px-1 text-caption leading-4">/</kbd></button></PopoverTrigger>
    <PopoverContent title="Search runs" hideTitle align="end" className={cn(floating, "w-96")}>
      <div className="flex items-center gap-2 border-b border-ui-stroke px-3 py-2.5"><Search aria-hidden className="size-4 text-ui-muted" /><input ref={input} type="search" aria-label="Find a run" value={query} onChange={event => { setQuery(event.target.value); setNotice(""); }} placeholder="Name, workflow, date or status" className={cn("h-8 min-w-0 flex-1 rounded bg-ui-field px-2 text-control text-ui-primary placeholder:text-ui-muted", dsFocus)} onKeyDown={event => {
        if (event.key !== "ArrowDown") return;
        event.preventDefault();
        event.currentTarget.closest("[role=dialog]")?.querySelector<HTMLButtonElement>("[data-navbar-result]")?.focus();
      }} /><PopoverClose asChild><button type="button" aria-label="Close search" className={iconButton}><X aria-hidden className="size-4" /></button></PopoverClose></div>
      <ul aria-label="Search results" className="m-0 max-h-72 list-none overflow-y-auto p-1.5">
        {results.map(result => <li key={result.id}><button type="button" data-navbar-result className={cn("flex w-full flex-col gap-1 rounded-md px-3 py-2.5 text-left hover:bg-ui-hover", dsFocus)} onClick={() => { onResult(result); setNotice("Run navigation is not connected yet."); }} onKeyDown={event => {
          const options = [...event.currentTarget.closest("ul")!.querySelectorAll<HTMLButtonElement>("[data-navbar-result]")];
          const index = options.indexOf(event.currentTarget);
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            options[(index + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length]?.focus();
          }
        }}><span className="flex w-full items-center justify-between gap-4 text-body"><strong className="truncate font-semibold">{result.subject}</strong><span className="shrink-0 text-caption text-ui-secondary">{result.state}</span></span><span className="text-caption text-ui-secondary">{result.workflow} · {navbarDayLabel(result.day)}</span></button></li>)}
        {results.length === 0 && <li className="px-3 py-8 text-center text-body text-ui-secondary">No runs match your search.</li>}
      </ul>
      <p role="status" className="m-0 border-t border-ui-stroke px-4 py-2 text-caption text-ui-muted">{notice || `${results.length} ${results.length === 1 ? "run" : "runs"}`}</p>
    </PopoverContent>
  </Popover>;
}

export function NavbarCalendar({ data }: { data: NavbarData }) {
  const [day, setDay] = useState(data.today);
  const [month, setMonth] = useState(data.today.slice(0, 7));
  const [focused, setFocused] = useState(data.today);
  const [open, setOpen] = useState(false);
  const surface = useRef<HTMLDivElement>(null);
  const cells = navbarMonthCells(month, data.today);
  const count = data.counts[day];
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => surface.current?.querySelector<HTMLButtonElement>(`[data-calendar-day="${day}"]`)?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open, day]);
  const focusDay = (next: string) => {
    if (next > data.today) return;
    setMonth(next.slice(0, 7));
    setFocused(next);
    window.requestAnimationFrame(() => surface.current?.querySelector<HTMLButtonElement>(`[data-calendar-day="${next}"]`)?.focus());
  };
  const choose = (next: string) => { setDay(next); setOpen(false); };
  return <div className="flex h-8 shrink-0 items-center rounded-md border border-ui-stroke bg-ui-canvas p-px">
    <button type="button" aria-label="Previous day" title="Previous day" className={cn(iconButton, "size-7")} onClick={() => setDay(navbarShiftDay(day, -1))}><ChevronLeft aria-hidden className="size-3.5" /></button>
    <Popover open={open} onOpenChange={next => { setOpen(next); if (next) { setMonth(day.slice(0, 7)); setFocused(day); } }}>
      <PopoverTrigger asChild><button type="button" aria-label="Choose date" className={cn("flex h-7 items-center gap-1.5 rounded px-1.5 text-body hover:bg-ui-hover", dsFocus)}><CalendarDays aria-hidden className="size-3.5 text-ui-secondary" /><span>{navbarDayLabel(day)}</span><span title={count === undefined ? "Run count unavailable" : `${count} runs`} className="min-w-4.5 rounded bg-ui-table px-1 text-center text-caption tabular-nums text-ui-info">{count ?? "—"}</span></button></PopoverTrigger>
      <PopoverContent title="Choose date" hideTitle align="end" className={cn(floating, "w-72")} surfaceRef={surface}>
        <div className="flex items-center gap-1 border-b border-ui-stroke p-2"><button type="button" aria-label="Previous month" className={iconButton} onClick={() => { const next = navbarShiftMonth(month, -1); setMonth(next); setFocused(`${next}-01`); }}><ChevronLeft aria-hidden className="size-4" /></button><h2 className="m-0 flex-1 text-center text-heading">{navbarMonthLabel(month)}</h2><button type="button" aria-label="Next month" className={iconButton} disabled={month >= data.today.slice(0, 7)} onClick={() => { const next = navbarShiftMonth(month, 1); setMonth(next); setFocused(`${next}-01`); }}><ChevronRight aria-hidden className="size-4" /></button><PopoverClose asChild><button type="button" aria-label="Close calendar" className={iconButton}><X aria-hidden className="size-4" /></button></PopoverClose></div>
        <table aria-label={navbarMonthLabel(month)} className="w-full table-fixed border-separate border-spacing-1 p-2 text-center text-body"><thead><tr>{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(name => <th key={name} scope="col" className="pb-1 text-caption font-normal text-ui-muted">{name}</th>)}</tr></thead><tbody>{Array.from({ length: 6 }, (_, row) => <tr key={row}>{cells.slice(row * 7, row * 7 + 7).map(cell => <td key={cell.day}><button type="button" data-calendar-day={cell.day} aria-label={navbarDayLabel(cell.day)} aria-pressed={cell.day === day} aria-current={cell.day === data.today ? "date" : undefined} disabled={!cell.available} tabIndex={cell.day === focused ? 0 : -1} onClick={() => choose(cell.day)} onFocus={() => setFocused(cell.day)} onKeyDown={event => {
          const next = navbarCalendarKey(cell.day, event.key);
          if (next === undefined) return;
          event.preventDefault();
          focusDay(next);
        }} className={cn("flex size-8 items-center justify-center rounded text-body tabular-nums hover:bg-ui-hover disabled:opacity-35", dsFocus, cell.inMonth ? "text-ui-primary" : "text-ui-muted", cell.day === day && "bg-ui-table font-semibold text-ui-info ring-1 ring-ui-info")}>{cell.label}</button></td>)}</tr>)}</tbody></table>
        <div className="flex items-center justify-between border-t border-ui-stroke px-3 py-2"><span className="text-caption text-ui-muted">Dates through {navbarDayLabel(data.today)}</span><button type="button" className={cn("rounded px-2 py-1 text-body text-ui-info hover:bg-ui-hover", dsFocus)} onClick={() => choose(data.today)}>Today</button></div>
      </PopoverContent>
    </Popover>
    <button type="button" aria-label="Next day" title="Next day" disabled={day >= data.today} className={cn(iconButton, "size-7")} onClick={() => setDay(navbarShiftDay(day, 1))}><ChevronRight aria-hidden className="size-3.5" /></button>
  </div>;
}

export function NavbarView({ data, view, onView, nav, theme, onToggleTheme, settingsOpen, onOpenSettings, onResult, notifications }: {
  data: NavbarData; view: ShellViewSelection; onView: (view: ShellView) => void; nav: NavControls;
  theme: DemoTheme; onToggleTheme: () => void; settingsOpen: boolean; onOpenSettings: () => void;
  onResult: (result: NavbarSearchResult) => void; notifications: ReactNode;
}) {
  return <header role="banner" className="ui-theme-scope flex h-13.5 shrink-0 items-center gap-2 border-b border-ui-stroke bg-ui-panel px-3 font-ui text-ui-primary min-[1151px]:gap-3 min-[1151px]:px-4">
    <h1 className="m-0 shrink-0 whitespace-nowrap text-control font-semibold">RRSS HR</h1>
    <div className="flex shrink-0 gap-px"><button type="button" aria-label="Back" title={nav.backTo ? `Back to ${nav.backTo}` : "Back"} disabled={!nav.canBack} className={iconButton} onClick={nav.onBack}><ArrowLeft aria-hidden className="size-3.5" /></button><button type="button" aria-label="Forward" title={nav.forwardTo ? `Forward to ${nav.forwardTo}` : "Forward"} disabled={!nav.canForward} className={iconButton} onClick={nav.onForward}><ArrowRight aria-hidden className="size-3.5" /></button></div>
    <nav aria-label="Main navigation" className="flex shrink-0 items-center gap-0.5 rounded-lg border border-ui-stroke bg-ui-canvas p-0.5">{NAVBAR_VIEWS.map(item => <button type="button" key={item.id} aria-pressed={view === item.id} onClick={() => onView(item.id)} className={cn("h-6.5 rounded px-2 text-body hover:bg-ui-hover", dsFocus, view === item.id ? "bg-ui-table font-semibold text-ui-primary" : "font-medium text-ui-secondary")}>{item.label}</button>)}</nav>
    <NavbarSearch data={data} onResult={onResult} />
    <NavbarCalendar data={data} />
    <div className="flex shrink-0 items-center gap-0.5 border-l border-ui-stroke pl-2">
      {notifications}
      <button type="button" aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} className={iconButton} onClick={onToggleTheme}>{theme === "dark" ? <Sun aria-hidden className="size-4" /> : <Moon aria-hidden className="size-4" />}</button>
      <button type="button" aria-label="Settings" title="Settings" aria-pressed={settingsOpen} className={cn(iconButton, settingsOpen && "bg-ui-table text-ui-primary")} onClick={onOpenSettings}><Settings aria-hidden className="size-4" /></button>
    </div>
  </header>;
}
