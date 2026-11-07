import { useState, type HTMLAttributes } from "react";
import { Input } from "../../../ds/ui.js";
import { cn } from "../../../lib/utils.js";

/** A run title that double-click renames in place: Enter saves, Escape cancels, an empty name restores the default. */
export function RenameableTitle({ name, onRename, heading = false, className, inputClassName, ...props }: Omit<HTMLAttributes<HTMLElement>, "onDoubleClick"> & {
  name: string; onRename?: (name: string) => void; heading?: boolean; inputClassName?: string;
}) {
  const [draft, setDraft] = useState<string>();
  if (draft !== undefined && onRename) return <Input autoFocus aria-label="Run name" value={draft} className={cn("h-7 min-w-0 flex-1 font-semibold", inputClassName)}
    onChange={event => setDraft(event.target.value)} onClick={event => event.stopPropagation()} onFocus={event => event.currentTarget.select()} onBlur={() => setDraft(undefined)}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === "Enter") { onRename(draft.trim()); setDraft(undefined); }
      if (event.key === "Escape") setDraft(undefined);
    }} />;
  const Tag = heading ? "h2" : "span";
  return <Tag {...props} className={className} onDoubleClick={onRename ? event => { event.stopPropagation(); setDraft(name); } : undefined}>{name}</Tag>;
}
