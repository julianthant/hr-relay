import { forwardRef, useContext, type ComponentProps, type ReactNode } from "react";
import { Button, IconButton, Tooltip } from "../../../ds/ui.js";
import { LogHeaderCompact } from "./log-header-compact.js";
import { cn } from "../../../lib/utils.js";

export const LogActionButton = forwardRef<HTMLButtonElement, Omit<ComponentProps<typeof Button>, "icon" | "children"> & { label: string; icon: ReactNode; text?: ReactNode }>(function LogActionButton({ label, text, icon, className, ...props }, ref) {
  const compact = useContext(LogHeaderCompact);
  const button = <Button ref={ref} size="md" aria-label={compact ? label : undefined} icon={icon} className={cn(compact && "w-[var(--ds-h-md)] justify-center px-0", className)} {...props}>{compact ? undefined : text ?? label}</Button>;
  return compact ? <Tooltip side="bottom" content={label}>{button}</Tooltip> : button;
});

/** A 28px icon button for the Logs footer: the shared Tooltip names it, an optional count rides on the icon, `pressed` marks a toggle that is on. */
export const LogFooterButton = forwardRef<HTMLButtonElement, Omit<ComponentProps<typeof IconButton>, "title"> & { count?: number; pressed?: boolean }>(function LogFooterButton({ label, icon, count, pressed, className, ...props }, ref) {
  return <Tooltip side="top" content={label}><IconButton ref={ref} title="" label={label} aria-pressed={pressed} className={cn("relative", pressed && "bg-[var(--ds-surface-3)] text-[color:var(--ds-fg)]", className)}
    icon={<>{icon}{count !== undefined && <span aria-hidden className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--ds-surface-3)] px-1 text-[10px] font-medium leading-none tabular-nums text-[color:var(--ds-fg)] ring-2 ring-[var(--ui-panel)]">{count}</span>}</>} {...props} /></Tooltip>;
});
