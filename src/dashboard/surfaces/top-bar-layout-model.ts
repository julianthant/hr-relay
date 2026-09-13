import { dsBorder,dsRadius,dsSize } from "../ds/ui.js";
import { cn } from "../lib/utils.js";


/**
 * THE ONE FRAME EVERY SEGMENTED COMPOSITE ON THIS BAR WEARS (2026-09-01).
 *
 * The bar used to paint three heights in a 44px band — the view switcher at
 * 30, the search field at 28, the date navigator at 24 — because the switcher
 * carried `p-hair` and a border AROUND segments that carried their own
 * `h-sm`, which is the growth DESIGN.md's layout rules name: *"a control that
 * WRAPS others takes the height itself and its segments fill it with
 * `h-full`."* The wrapper takes `--ds-h-md` here and every segment is
 * `h-full`, so the composite cannot grow by its own padding again, and the
 * three center controls land on one line.
 *
 * It is `--ds-border` on the recessed plane deliberately: the search field
 * reads the same pair, so a boxed field beside a boxed stepper reads as a pair
 * of peers rather than as one drawn control beside three loose glyphs.
 */
export const SEGMENTED_FRAME = cn(
  "inline-flex shrink-0 items-center border p-[var(--ds-space-hair)]",
  dsSize.hMd,
  dsRadius.md,
  dsBorder.base,
  "bg-[var(--ds-surface-2)]",
);
