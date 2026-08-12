/**
 * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * src/dashboard/components/shared/IconActionButton.tsx
 *
 * IT LIVES OUTSIDE `ds/`, AND THAT IS THE PORT BEING FAITHFUL.
 *
 * This control draws with literal sizes (`h-6 w-6`) and the shadcn semantic
 * layer (`text-destructive`, `bg-warning/15`) rather than the `--ds-*` face, so
 * by `DESIGN.md`'s rules it could not be a design-system primitive. It is not
 * one in the design reference either: the demo reaches OUT of its own DS for it
 * (`DemoActions.tsx:18`, `DemoLogPanel.tsx:35`, both importing
 * `@/components/shared/IconActionButton`), which is why its palette is narrower
 * than the wire's seven intents and why `INTENT_TONE` exists to squeeze them
 * into four.
 *
 * So the honest placement is the one the demo uses — a shared component beside
 * the surfaces, never inside `ds/`. Keeping it in `ds/` was the actual defect:
 * it put a fork inside the folder whose whole rule is that primitives are not
 * forked, one directory away from the `IconButton` a builder should reach for
 * instead. Redrawing it on `--ds-*` tokens is a separate, deliberate change to
 * the design language and belongs upstream in the demo first — doing it here
 * would move this tree off the visual oracle it is being held to.
 */
import type { MouseEvent, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "../lib/utils.js";

type Size = "sm" | "md";
type Tone = "destructive" | "warning" | "primary" | "muted";

const SIZE_CLASS: Record<Size, string> = {
  sm: "h-6 w-6",
  md: "h-8 w-8",
};

const TONE_CLASS: Record<Tone, string> = {
  destructive: "text-muted-foreground hover:text-destructive hover:bg-destructive/10 focus-visible:ring-destructive/40",
  warning: "text-warning bg-warning/15 border border-warning/45 hover:bg-warning/25 hover:border-warning/65 focus-visible:ring-warning",
  primary: "text-muted-foreground hover:text-primary hover:bg-muted focus-visible:ring-primary/40",
  muted: "text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-primary/40",
};

export function IconActionButton({
  size = "sm",
  tone,
  pending,
  icon,
  label,
  title,
  onClick,
  disabled,
  className,
  spinnerClassName,
}: {
  size?: Size;
  tone: Tone;
  pending?: boolean;
  icon: ReactNode;
  label: string;
  title?: string;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  className?: string;
  spinnerClassName?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      onClick={onClick}
      disabled={disabled || pending}
      className={cn(
        SIZE_CLASS[size],
        "inline-flex shrink-0 items-center justify-center rounded-md cursor-pointer transition-colors outline-none",
        "focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-card",
        "disabled:opacity-60 disabled:cursor-wait",
        TONE_CLASS[tone],
        className,
      )}
    >
      {pending ? (
        <Loader2 aria-hidden className={cn("h-3.5 w-3.5 animate-spin motion-reduce:animate-none", spinnerClassName)} />
      ) : (
        icon
      )}
    </button>
  );
}
