import type { ComponentProps } from "react";
import { Slot } from "@radix-ui/react-slot";
import { ChevronRight, MoreHorizontal } from "lucide-react";
import { cn } from "../lib/utils.js";

export function Breadcrumb(props: ComponentProps<"nav">) {
  return <nav aria-label="Breadcrumb" data-slot="breadcrumb" {...props} />;
}
export function BreadcrumbList({ className, ...props }: ComponentProps<"ol">) {
  return <ol data-slot="breadcrumb-list" className={cn("m-0 flex min-w-0 flex-wrap list-none items-center gap-1.5 p-0 text-body text-ui-muted", className)} {...props} />;
}
export function BreadcrumbItem({ className, ...props }: ComponentProps<"li">) {
  return <li data-slot="breadcrumb-item" className={cn("inline-flex min-w-0 items-center gap-1.5", className)} {...props} />;
}
export function BreadcrumbLink({ asChild, className, ...props }: ComponentProps<"a"> & { asChild?: boolean }) {
  const Component = asChild ? Slot : "a";
  return <Component data-slot="breadcrumb-link" className={cn("inline-flex min-h-6 min-w-6 items-center rounded-sm transition-colors hover:text-ui-primary focus-visible:outline-2 focus-visible:outline-ui-info", className)} {...props} />;
}
export function BreadcrumbPage({ className, ...props }: ComponentProps<"span">) {
  return <span data-slot="breadcrumb-page" role="link" aria-disabled="true" aria-current="page" className={cn("font-normal text-ui-primary", className)} {...props} />;
}
export function BreadcrumbSeparator({ children, className, ...props }: ComponentProps<"li">) {
  return <li data-slot="breadcrumb-separator" role="presentation" aria-hidden="true" className={cn("[&>svg]:size-3.5", className)} {...props}>{children ?? <ChevronRight />}</li>;
}
export function BreadcrumbEllipsis({ className, ...props }: ComponentProps<"span">) {
  return <span data-slot="breadcrumb-ellipsis" role="presentation" aria-hidden="true" className={cn("flex size-9 items-center justify-center", className)} {...props}><MoreHorizontal className="size-4" /><span className="sr-only">More</span></span>;
}
