import { createContext, forwardRef, useContext, type ComponentProps, type ReactNode } from "react";
import { Button, Tooltip } from "../../../ds/ui.js";
import { cn } from "../../../lib/utils.js";

/** True while the Logs header is too narrow for text buttons: they collapse to their icon and show the label as a tooltip. */
export const LogHeaderCompact = createContext(false);

export const LogActionButton = forwardRef<HTMLButtonElement, Omit<ComponentProps<typeof Button>, "icon" | "children"> & { label: string; icon: ReactNode; text?: ReactNode }>(function LogActionButton({ label, text, icon, className, ...props }, ref) {
  const compact = useContext(LogHeaderCompact);
  const button = <Button ref={ref} size="md" aria-label={compact ? label : undefined} icon={icon} className={cn(compact && "w-[var(--ds-h-md)] justify-center px-0", className)} {...props}>{compact ? undefined : text ?? label}</Button>;
  return compact ? <Tooltip side="bottom" content={label}>{button}</Tooltip> : button;
});
