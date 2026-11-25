import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { IconButton } from "../../../ds/ui.js";
import type { LogTools } from "./log-feed.js";

/** The search icon in the run header; it opens a field with the match count, previous and next. Esc clears the search and closes it. */
export function LogSearch({ tools, onOpenChange }: { tools: LogTools; onOpenChange: (open: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const icon = useRef<HTMLButtonElement>(null);
  const change = (next: boolean) => { setOpen(next); onOpenChange(next); };
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  const close = () => { tools.setQuery(""); change(false); requestAnimationFrame(() => icon.current?.focus()); };
  if (!open) return <IconButton ref={icon} size="md" label="Search logs" icon={<Search aria-hidden className="size-4" />} onClick={() => change(true)} />;
  const none = tools.query.trim() !== "" && tools.total === 0;
  return <div role="search" className="flex h-[34px] w-[360px] max-w-full min-w-0 items-center gap-2 rounded-lg border border-ui-info bg-ui-table pl-2.5 pr-1.5">
    <Search aria-hidden className="size-4 shrink-0 text-ui-muted" />
    <input ref={input} aria-label="Search logs" placeholder="Search logs" value={tools.query} className="min-w-0 flex-1 bg-transparent text-body text-ui-primary outline-none placeholder:text-ui-muted"
      onChange={event => tools.setQuery(event.target.value)}
      onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
        else if (event.key === "Enter") { event.preventDefault(); tools.step(event.shiftKey ? -1 : 1); }
      }} />
    {tools.query.trim() !== "" && <span role="status" className={none ? "shrink-0 whitespace-nowrap text-caption text-ui-danger" : "shrink-0 whitespace-nowrap text-caption tabular-nums text-ui-secondary"}>{none ? "No matches" : `${tools.position} of ${tools.total}`}</span>}
    <IconButton size="xs" label="Previous match" icon={<ChevronUp aria-hidden className="size-4" />} disabled={tools.total === 0} onClick={() => tools.step(-1)} />
    <IconButton size="xs" label="Next match" icon={<ChevronDown aria-hidden className="size-4" />} disabled={tools.total === 0} onClick={() => tools.step(1)} />
    <IconButton size="xs" label="Close search" icon={<X aria-hidden className="size-4" />} onClick={close} />
  </div>;
}
