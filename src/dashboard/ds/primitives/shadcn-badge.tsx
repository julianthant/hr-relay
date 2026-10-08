/** Adapted from shadcn/ui Badge (MIT):
 * https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/bases/radix/ui/badge.tsx
 * Dashboard tones and sizes are supplied by their shared wrappers.
 */
import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "../../lib/utils.js";

export const ShadcnBadge = forwardRef<HTMLSpanElement, HTMLAttributes<HTMLSpanElement>>(
  function ShadcnBadge({ className, ...props }, ref) {
    return <span ref={ref} data-slot="badge" className={cn(className)} {...props} />;
  },
);
