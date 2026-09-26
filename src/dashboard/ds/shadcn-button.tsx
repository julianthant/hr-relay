/** Adapted from shadcn/ui Button (MIT):
 * https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/bases/radix/ui/button.tsx
 * Dashboard variants live in primitives-core; this base retains shadcn's
 * Radix Slot composition and data slot without imposing another visual scale.
 */
import { Slot } from "@radix-ui/react-slot";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../lib/utils.js";

export const ShadcnButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }>(
  function ShadcnButton({ asChild = false, className, type = "button", ...props }, ref) {
    const Component = asChild ? Slot : "button";
    return <Component ref={ref} type={asChild ? undefined : type} data-slot="button" className={cn(className)} {...props} />;
  },
);
