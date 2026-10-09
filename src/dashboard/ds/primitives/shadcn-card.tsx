/** Adapted from shadcn/ui Card (MIT)
 * https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/bases/radix/ui/card.tsx */
import { Slot } from "@radix-ui/react-slot";
import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/utils.js";

type CardPartProps = HTMLAttributes<HTMLElement> & { asChild?: boolean; children: ReactNode };

export function ShadcnCard({ asChild = false, className, ...props }: CardPartProps) {
  const Component = asChild ? Slot : "div";
  return <Component data-slot="card" className={cn("flex flex-col border", className)} {...props} />;
}

export function ShadcnCardHeader({ asChild = false, className, ...props }: CardPartProps) {
  const Component = asChild ? Slot : "div";
  return <Component data-slot="card-header" className={cn("flex items-center", className)} {...props} />;
}

export function ShadcnCardContent({ asChild = false, className, ...props }: CardPartProps) {
  const Component = asChild ? Slot : "div";
  return <Component data-slot="card-content" className={cn(className)} {...props} />;
}

export function ShadcnCardFooter({ asChild = false, className, ...props }: CardPartProps) {
  const Component = asChild ? Slot : "div";
  return <Component data-slot="card-footer" className={cn("flex items-center", className)} {...props} />;
}
