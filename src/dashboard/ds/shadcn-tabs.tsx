/** Adapted from shadcn/ui Tabs (MIT):
 * https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/bases/radix/ui/tabs.tsx
 * Dashboard wrappers supply the visual classes while Radix owns tab behavior.
 */
import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ComponentProps } from "react";
import { cn } from "../lib/utils.js";

export function ShadcnTabs({ className, ...props }: ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn("flex flex-col", className)} {...props} />;
}

export function ShadcnTabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List data-slot="tabs-list" className={className} {...props} />;
}

export function ShadcnTabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return <TabsPrimitive.Trigger data-slot="tabs-trigger" className={className} {...props} />;
}

export function ShadcnTabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={className} {...props} />;
}
