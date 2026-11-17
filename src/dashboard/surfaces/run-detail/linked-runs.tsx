import { useRef, useState, type KeyboardEvent } from "react";
import { ArrowUpRight, GitBranch } from "lucide-react";
import { IconButton, Popover, PopoverContent, PopoverTrigger, dsFocus } from "../../ds/ui.js";
import { cn } from "../../lib/utils.js";
import type { QueueSurfaceWire, LinkedRunWire } from "../queue/queue-model.js";
import { dsStatusOf, statusText } from "../shared/status/status-model.js";

export type LinkedRunEntry = Readonly<{ name: string; workflow: string; status: string; relation: "Parent" | "Child"; target: LinkedRunWire }>;

/** The served parent first, then the runs it delegated to; the wire carries nothing else. */
export function linkedRunEntries(row: Pick<QueueSurfaceWire, "parent" | "linkedRuns">): readonly LinkedRunEntry[] {
  const entry = (target: LinkedRunWire, relation: LinkedRunEntry["relation"], name: string): LinkedRunEntry =>
    ({ name, workflow: target.label, status: statusText(dsStatusOf(target.status)), relation, target });
  return [...row.parent === null ? [] : [entry(row.parent, "Parent", row.parent.title)], ...row.linkedRuns.map(link => entry(link, "Child", link.label))];
}

/** The Logs header's icon button with its count; it renders nothing for a run with no linked run. */
export function LinkedRunsButton({ entries, onOpen }: { entries: readonly LinkedRunEntry[]; onOpen?: (target: LinkedRunWire) => void }) {
  const [open, setOpen] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  if (entries.length === 0) return null;
  const move = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = [...list.current?.querySelectorAll<HTMLButtonElement>("button") ?? []];
    if (rows.length === 0) return;
    event.preventDefault();
    const at = rows.indexOf(document.activeElement as HTMLButtonElement), step = event.key === "ArrowDown" ? 1 : -1;
    rows[(at + step + rows.length) % rows.length]?.focus();
  };
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><IconButton size="md" variant="outline" label={`Linked runs (${entries.length})`} icon={<GitBranch aria-hidden className="size-4" />} /></PopoverTrigger>
    <PopoverContent title="Linked runs" align="end" width="md" hideClose>
      <ul ref={list} onKeyDown={move} className="m-0 list-none space-y-1 p-0">{entries.map(entry => <li key={entry.target.runId}>
        <button type="button" onClick={() => { setOpen(false); onOpen?.(entry.target); }} className={cn("flex min-h-10 w-full items-center gap-3 rounded-md px-2 py-2 text-left text-body hover:bg-ui-hover", dsFocus)}>
          <span className="min-w-0 flex-1"><span className="block truncate text-ui-primary" title={entry.name}>{entry.name}</span>
            <span className="flex gap-1 text-caption text-ui-muted"><span className="min-w-0 truncate">{entry.relation === "Parent" ? `Parent · ${entry.workflow}` : entry.relation}</span><span aria-hidden>·</span><span className="shrink-0">{entry.status}</span></span></span>
          <ArrowUpRight aria-hidden className="size-4 shrink-0 text-ui-muted" />
        </button>
      </li>)}</ul>
    </PopoverContent>
  </Popover>;
}
