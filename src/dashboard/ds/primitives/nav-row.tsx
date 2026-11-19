import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/utils.js";
import { dsFocus, dsIcon, dsMotion } from "../theme/tokens.js";

type NavRowBase = {
  /** A 14px glyph in the leading slot. */
  icon?: ReactNode;
  /** A count, pill or chevron after the label. */
  trailing?: ReactNode;
  selected?: boolean;
  label: ReactNode;
  className?: string;
};

export type DsNavRowProps = NavRowBase &
  (
    | ({ href: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "children" | "className" | "href">)
    | ({ href?: undefined } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className">)
  );

const NAV_ROW = cn(
  "flex h-8 w-full min-w-0 cursor-pointer items-center gap-[var(--ds-space-snug)] rounded-[8px] border-0 bg-transparent",
  "px-[var(--ds-space-cozy)] text-left text-[length:var(--ds-text-body-row)] font-normal text-[color:var(--ds-fg)]",
  dsFocus,
  dsMotion.base,
  "hover:bg-[var(--ds-surface-3)] aria-[current=page]:bg-[var(--ds-surface-selected)] aria-[current=page]:hover:bg-[var(--ds-surface-selected)]",
  "disabled:pointer-events-none disabled:opacity-45",
);

/** The one navigation row: 32px, icon slot, label, trailing slot, with hover and selected fills.
 * It is the workflow rail's row and Settings' row. A `href` makes it a real link. */
export const NavRow = forwardRef<HTMLAnchorElement & HTMLButtonElement, DsNavRowProps>(function NavRow(
  { icon, trailing, selected, label, className, ...rest },
  ref,
) {
  const body = (
    <>
      {icon && <span aria-hidden className={cn("flex shrink-0 items-center justify-center", dsIcon.md)}>{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing && <span className="flex shrink-0 items-center gap-[var(--ds-space-tight)]">{trailing}</span>}
    </>
  );
  const current = selected ? ("page" as const) : undefined;
  if (rest.href !== undefined) {
    const { href, ...anchor } = rest;
    return <a ref={ref} href={href} aria-current={current} className={cn(NAV_ROW, className)} {...anchor}>{body}</a>;
  }
  const { href: _unused, ...button } = rest;
  return <button ref={ref} type="button" aria-current={current} className={cn(NAV_ROW, className)} {...button}>{body}</button>;
});
