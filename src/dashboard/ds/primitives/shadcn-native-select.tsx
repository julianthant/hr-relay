/** Adapted from shadcn/ui Native Select (MIT):
 * https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/bases/radix/ui/native-select.tsx
 * The wrapper accepts dashboard icon slots and forwards the native select ref.
 */
import { forwardRef, type ReactNode, type SelectHTMLAttributes } from "react";
import { cn } from "../../lib/utils.js";

export const NativeSelect = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & {
    wrapperClassName?: string;
    leading?: ReactNode;
    trailing?: ReactNode;
  }
>(function NativeSelect({ className, wrapperClassName, leading, trailing, children, ...props }, ref) {
  return (
    <span data-slot="native-select-wrapper" className={cn("relative flex min-w-0 items-center", wrapperClassName)}>
      {leading && <span data-slot="native-select-leading" aria-hidden className="pointer-events-none absolute left-[var(--ds-space-snug)] flex items-center">{leading}</span>}
      <select data-slot="native-select" ref={ref} className={cn("cursor-pointer appearance-none outline-none", className)} {...props}>
        {children}
      </select>
      {trailing && <span data-slot="native-select-icon" aria-hidden className="pointer-events-none absolute right-[var(--ds-space-base)]">{trailing}</span>}
    </span>
  );
});
