import { useRef, useState, type HTMLAttributes } from "react";
import { Input } from "../../../ds/ui.js";
import { cn } from "../../../lib/utils.js";

/** Double-click renames in place. Enter or blur saves; Escape cancels; an empty name restores the default. */
export function RenameableTitle({
  name,
  onRename,
  heading = false,
  className,
  inputClassName,
  ...props
}: Omit<HTMLAttributes<HTMLElement>, "onDoubleClick"> & {
  name: string;
  onRename?: (name: string) => void;
  heading?: boolean;
  inputClassName?: string;
}) {
  const [draft, setDraft] = useState<string>();
  // Enter and Escape unmount the field, which then blurs. One close owns the result.
  const closed = useRef(false);
  if (draft !== undefined && onRename !== undefined) {
    const finish = (save: boolean) => {
      if (closed.current) return;
      closed.current = true;
      if (save) onRename(draft.trim());
      setDraft(undefined);
    };
    return (
      <Input
        autoFocus
        aria-label="Run name"
        value={draft}
        className={cn("h-7 min-w-0 flex-1 font-semibold", inputClassName)}
        onChange={(event) => setDraft(event.target.value)}
        onClick={(event) => event.stopPropagation()}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={() => finish(true)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            finish(true);
          }
          if (event.key === "Escape") {
            event.preventDefault();
            finish(false);
          }
        }}
      />
    );
  }
  const Tag = heading ? "h2" : "span";
  return (
    <Tag
      {...props}
      className={className}
      onDoubleClick={onRename === undefined ? undefined : (event) => {
        event.stopPropagation();
        closed.current = false;
        setDraft(name);
      }}
    >
      {name}
    </Tag>
  );
}
