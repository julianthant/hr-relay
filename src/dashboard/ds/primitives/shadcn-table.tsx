/** Adapted from shadcn/ui Table (MIT):
 * https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/bases/radix/ui/table.tsx
 * The outer scroll container is omitted so windowed dashboard tables keep their owner.
 */
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.js";

export function ShadcnTable({ className, ...props }: ComponentProps<"table">) {
  return <table data-slot="table" className={cn("w-full", className)} {...props} />;
}

export function ShadcnTableHeader({ className, ...props }: ComponentProps<"thead">) {
  return <thead data-slot="table-header" className={className} {...props} />;
}

export function ShadcnTableBody({ className, ...props }: ComponentProps<"tbody">) {
  return <tbody data-slot="table-body" className={className} {...props} />;
}

export function ShadcnTableRow({ className, ...props }: ComponentProps<"tr">) {
  return <tr data-slot="table-row" className={className} {...props} />;
}

export function ShadcnTableHead({ className, ...props }: ComponentProps<"th">) {
  return <th data-slot="table-head" className={className} {...props} />;
}

export function ShadcnTableCell({ className, ...props }: ComponentProps<"td">) {
  return <td data-slot="table-cell" className={className} {...props} />;
}
