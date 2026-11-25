import { forwardRef, useContext, type ComponentProps, type ReactNode } from "react";
import { Button, IconButton, Tooltip } from "../../../ds/ui.js";
import { LogHeaderCompact } from "./log-header-compact.js";
import { cn } from "../../../lib/utils.js";

export const LogActionButton = forwardRef<HTMLButtonElement, Omit<ComponentProps<typeof Button>, "icon" | "children"> & { label: string; icon: ReactNode; text?: ReactNode }>(function LogActionButton({ label, text, icon, className, ...props }, ref) {
  const compact = useContext(LogHeaderCompact);
  const button = <Button ref={ref} size="md" aria-label={compact ? label : undefined} icon={icon} className={cn(compact && "w-[var(--ds-h-md)] justify-center px-0", className)} {...props} {...(compact && { title: "" })}>{compact ? undefined : text ?? label}</Button>;
  return compact ? <Tooltip side="bottom" content={label}>{button}</Tooltip> : button;
});

/** An icon button in the run header: the shared Tooltip names it. */
export const LogHeaderButton = forwardRef<HTMLButtonElement, Omit<ComponentProps<typeof IconButton>, "title" | "size">>(function LogHeaderButton({ label, ...props }, ref) {
  return <Tooltip side="bottom" content={label}><IconButton ref={ref} size="md" title="" label={label} {...props} /></Tooltip>;
});
