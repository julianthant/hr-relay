import * as React from "react";
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import { cn } from "../lib/utils.js";

const ToggleGroupContext = React.createContext({ segmented: false });

/** shadcn Base UI ToggleGroup with the dashboard's compact segmented variant. */
export function ToggleGroup({ className, variant = "default", children, ...props }: ToggleGroupPrimitive.Props & { variant?: "default" | "segmented" }) {
  return <ToggleGroupPrimitive data-slot="toggle-group" className={cn("flex items-center gap-1 rounded-lg", variant === "segmented" && "border border-border bg-background p-1", className)} {...props}>
    <ToggleGroupContext.Provider value={{ segmented: variant === "segmented" }}>{children}</ToggleGroupContext.Provider>
  </ToggleGroupPrimitive>;
}

export function ToggleGroupItem({ className, ...props }: TogglePrimitive.Props) {
  const { segmented } = React.useContext(ToggleGroupContext);
  return <TogglePrimitive data-slot="toggle-group-item" className={cn(
    "inline-flex min-w-0 items-center justify-center gap-1 rounded-md px-2 text-sm font-medium whitespace-nowrap outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 aria-pressed:bg-accent aria-pressed:text-accent-foreground",
    segmented ? "h-8 px-1 text-body text-muted-foreground" : "h-8",
    className,
  )} {...props} />;
}
