import type { ComponentType, SVGProps } from "react";
import {
  Ban,
  CheckCircle2,
  CircleAlert,
  CircleStop,
  Clock,
  Loader2,
  PauseCircle,
  TriangleAlert,
  UserRoundSearch,
} from "lucide-react";
import { cn } from "../../lib/utils.js";
import { ShadcnBadge } from "./shadcn-badge.js";
import { dsClip, dsIcon, dsRadius, dsText } from "../theme/tokens.js";
import { DISPLAY_STATUS_LABELS } from "../../../models/dashboard/status-vocabulary.js";
import type { displayStatusOf } from "../../../models/dashboard/status-vocabulary.js";

/** The shared queue status vocabulary.
 * These values are shared across the product: the queue, the rail */

export type DsStatus = ReturnType<typeof displayStatusOf>;

/** How loud a status is allowed to be. Drives fill, weight and dot shape. */
export type DsStatusTier = "solid" | "dashed" | "tinted" | "outline" | "ghost";

export interface DsStatusSpec {
  /** The operator-facing name. */
  label: string;
  /** The ACCESSIBLE name, when the visible word alone does not separate this
 * status from a sibling. */
  accessibleLabel?: string;
  tier: DsStatusTier;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** chip surface: background + border */
  chip: string;
  /** the label's color inside the chip */
  text: string;
  /** the icon's color inside the chip */
  iconTone: string;
  /** The icon's color when it stands ALONE on a panel surface with no chip
 * behind it (a row's leading glyph, a menu item, a legend). */
  soloTone: string;
  /** the standalone dot/marker fill (loud tiers) */
  dot: string;
  /** the standalone dot/marker outline (quiet tiers) — a literal class, never derived from `dot` at runtime */
  dotBorder: string;
  /** extra text treatment that is not colour (e.g. strikethrough) */
  labelDecoration?: string;
  /** the icon spins — `running` only */
  spin?: boolean;
  /** This status's PILL carries no icon — `verifiedDone` only.
 * The word `Done` in the success green is the whole chip */
  pillHideIcon?: boolean;
  /** what this status means for the operator; used as the chip's tooltip */
  meaning: string;
}

export const DS_STATUS: Record<DsStatus, DsStatusSpec> = {
  waiting: {
    // The blue `Review` pill — the word names the work, not the wait.
    label: DISPLAY_STATUS_LABELS.waiting,
    tier: "solid",
    icon: UserRoundSearch,
    chip: "bg-[var(--ds-info-solid-bg)] border-transparent",
    text: "text-[color:var(--ds-info-solid-fg)] font-semibold",
    pillHideIcon: true,
    iconTone: "text-[color:var(--ds-info-solid-fg)]",
    soloTone: "text-[color:var(--ds-info-fg)]",
    dot: "bg-[var(--ds-info-solid-bg)]",
    dotBorder: "border-[color:var(--ds-info-solid-bg)]",
    meaning:
      "Stopped at a gate for a decision. Nothing is written until you answer. Open Review to act.",
  },
  failed: {
    label: DISPLAY_STATUS_LABELS.failed,
    tier: "solid",
    icon: TriangleAlert,
    chip: "bg-[var(--ds-status-failed-solid-bg)] border-transparent",
    text: "text-[color:var(--ds-status-failed-solid-fg)] font-semibold",
    iconTone: "text-[color:var(--ds-status-failed-solid-fg)]",
    soloTone: "text-[color:var(--ds-status-failed-fg)]",
    dot: "bg-[var(--ds-status-failed-mark)]",
    dotBorder: "border-[color:var(--ds-status-failed-mark)]",
    meaning: "Stopped on an error. Retry replays the same input.",
  },
  parked: {
    label: DISPLAY_STATUS_LABELS.parked,
    tier: "dashed",
    icon: PauseCircle,
    // The dashed hairline is this status's shape cue — nothing else dashes.
    chip:
      "bg-[var(--ds-status-parked-bg)] border-[color:var(--ds-status-parked-border)] ds-dashed",
    text: "text-[color:var(--ds-status-parked-fg)] font-medium",
    iconTone: "text-[color:var(--ds-status-parked-fg)]",
    soloTone: "text-[color:var(--ds-status-parked-fg)]",
    dot: "bg-[var(--ds-status-parked-mark)]",
    dotBorder: "border-[color:var(--ds-status-parked-mark)]",
    meaning:
      "A write may or may not have landed. Never auto-retried — you resolve present or absent.",
  },
  doneWarnings: {
        // Word is just `Done` — same length as verified Done. Amber tint + the △ count
    // chip distinguish it from the green solid Done; the CircleAlert stays for filters/solo.
    label: DISPLAY_STATUS_LABELS.doneWarnings,
    accessibleLabel: "Done with warnings",
    tier: "tinted",
    icon: CircleAlert,
    chip:
      "bg-[var(--ds-status-done-warnings-bg)] border-[color:var(--ds-status-done-warnings-border)]",
    text: "text-[color:var(--ds-fg-secondary)]",
    pillHideIcon: true,
    iconTone: "text-[color:var(--ds-status-done-warnings-fg)]",
    soloTone: "text-[color:var(--ds-status-done-warnings-fg)]",
    dot: "bg-[var(--ds-status-done-warnings-mark)]",
    dotBorder: "border-[color:var(--ds-status-done-warnings-mark)]",
    meaning:
      "Finished, but something needs your eyes — a fallback, a gap, a rejected page. The △ count beside the pill names how many.",
  },
  running: {
    label: DISPLAY_STATUS_LABELS.running,
    tier: "tinted",
    icon: Loader2,
    chip:
      "bg-[var(--ds-status-running-bg)] border-[color:var(--ds-status-running-border)]",
    text: "text-[color:var(--ds-status-running-fg)]",
    iconTone: "text-[color:var(--ds-status-running-fg)]",
    soloTone: "text-[color:var(--ds-status-running-fg)]",
    dot: "bg-[var(--ds-status-running-mark)]",
    dotBorder: "border-[color:var(--ds-status-running-mark)]",
    spin: true,
    meaning: "A worker owns it right now. Only cancel is offered.",
  },
  cancelling: {
    label: DISPLAY_STATUS_LABELS.cancelling,
    tier: "tinted",
    icon: CircleStop,
    chip: "bg-[var(--ds-status-running-bg)] border-[color:var(--ds-status-running-border)]",
    text: "text-[color:var(--ds-status-running-fg)]",
    iconTone: "text-[color:var(--ds-status-running-fg)]",
    soloTone: "text-[color:var(--ds-status-running-fg)]",
    dot: "bg-[var(--ds-status-running-mark)]",
    dotBorder: "border-[color:var(--ds-status-running-mark)]",
    meaning: "Cancellation requested. The worker has not settled the run yet.",
  },
  queued: {
    label: DISPLAY_STATUS_LABELS.queued,
    tier: "outline",
    icon: Clock,
    // No fill at all: nothing has happened to this row yet.
    chip: "bg-transparent border-[color:var(--ds-status-queued-border)]",
    text: "text-[color:var(--ds-status-queued-fg)]",
    iconTone: "text-[color:var(--ds-status-queued-fg)]",
    soloTone: "text-[color:var(--ds-status-queued-fg)]",
    dot: "bg-[var(--ds-status-queued-mark)]",
    dotBorder: "border-[color:var(--ds-status-queued-mark)]",
    meaning: "Accepted, nothing has run. Can be bumped or cancelled.",
  },
  cancelled: {
        // Same solid pill shape as Done, gray, no strikethrough: neither amber nor red —
    // a deliberate stop is not a warning and not a failure.
    label: DISPLAY_STATUS_LABELS.cancelled,
    tier: "solid",
    icon: Ban,
    chip: "bg-[var(--ds-status-cancelled-solid-bg)] border-transparent",
    text: "text-[color:var(--ds-status-cancelled-solid-fg)] font-semibold",
    pillHideIcon: true,
    iconTone: "text-[color:var(--ds-status-cancelled-solid-fg)]",
    soloTone: "text-[color:var(--ds-status-cancelled-fg)]",
    dot: "bg-[var(--ds-status-cancelled-mark)]",
    dotBorder: "border-[color:var(--ds-status-cancelled-mark)]",
    meaning: "You stopped it. Not an alert — a deliberate act.",
  },
  verifiedDone: {
        // `Verified done` → `Done`. Both terminal dones share the short word; green solid
    // vs amber tint (+ △ count chip when warnings exist) is the distinction.
    label: DISPLAY_STATUS_LABELS.verifiedDone,
    tier: "solid",
    icon: CheckCircle2,
    chip: "bg-[var(--ds-status-verified-done-solid-bg)] border-transparent",
    text: "text-[color:var(--ds-status-verified-done-solid-fg)] font-semibold",
    pillHideIcon: true,
    iconTone: "text-[color:var(--ds-status-verified-done-solid-fg)]",
    soloTone: "text-[color:var(--ds-status-verified-done-fg)]",
    dot: "bg-[var(--ds-status-verified-done-mark)]",
    dotBorder: "border-[color:var(--ds-status-verified-done-mark)]",
    meaning:
      "Finished and read back from the system.",
  },
};

/** Reading order for pickers, legends and status bars */
export const DS_STATUS_ORDER: DsStatus[] = [
  "waiting",
  "failed",
  "parked",
  "doneWarnings",
  "running",
  "cancelling",
  "queued",
  "cancelled",
  "verifiedDone",
];

/** The two statuses that own the operator's attention. */
export const DS_ATTENTION_STATUSES: DsStatus[] = ["waiting", "failed"];

/** A status plus its age. "Waiting on you" is a state; "Waiting on you · 10m"
 * is a priority — that is the difference between a queue you scan and a queue */
export function dsStatusText(status: DsStatus, age?: string): string {
  const base = DS_STATUS[status].label;
  return age ? `${base} · ${age}` : base;
}

/** Speak warning completion explicitly; hue and count chips do not supply an accessible status name. */
export function dsStatusAccessibleName(status: DsStatus, age?: string): string {
  const spec = DS_STATUS[status];
  const base = spec.accessibleLabel ?? spec.label;
  return age ? `${base} · ${age}` : base;
}

export type DsStatusPillSize = "sm" | "md";

const PILL_SIZE: Record<DsStatusPillSize, string> = {
  sm: "h-[var(--ds-h-xs)] px-[var(--ds-space-snug)] gap-[var(--ds-space-tight)]",
  md: "h-[var(--ds-h-sm)] px-[var(--ds-space-base)] gap-[var(--ds-space-snug)]",
};


export function StatusPill({
  status,
  age,
  size = "md",
  hideIcon,
  label,
  className,
  presentation = "default",
}: {
  status: DsStatus;
  /** how long it has been in this state — "12m", "2h". Show it when known. */
  age?: string;
  size?: DsStatusPillSize;
  /** The status label remains even when its repeated icon is omitted. */
  hideIcon?: boolean;
  /** Override labels only for non-status records; never rename real status vocabulary. */
  label?: string;
  className?: string;
  /** Queue rows use the operator-approved compact attention treatments. */
  presentation?: "default" | "queue";
}) {
  const spec = DS_STATUS[status];
  const Icon = spec.icon;
  const compactAttention = presentation === "queue" && (status === "waiting" || status === "failed");
  const chip = compactAttention
    ? status === "waiting"
      ? "bg-[var(--ds-queue-info-bg)] border-[color:var(--ds-queue-info-border)]"
      : "bg-[var(--ds-queue-danger-bg)] border-[color:var(--ds-queue-danger-border)]"
    : spec.chip;
  const text = compactAttention
    ? status === "waiting" ? "text-ui-info font-medium" : "text-ui-danger font-medium"
    : presentation === "queue" && status === "running" ? "text-ui-info" : spec.text;
  return (
    <ShadcnBadge
      title={spec.meaning}
      className={cn(
        // Allow pills to shrink within parent width so truncation happens inside their border.
        "inline-flex w-fit shrink-0 items-center border",
        dsClip.token,
        dsRadius.sm,
        dsText.meta,
        dsText.flush,
        PILL_SIZE[size],
        chip,
        text,
        className,
      )}
    >
      {!hideIcon && (!spec.pillHideIcon || compactAttention) && (
        <Icon
          aria-hidden
          className={cn(
            dsIcon.sm,
            "shrink-0",
            presentation === "queue" && (compactAttention || status === "running") ? text : spec.iconTone,
            spec.spin && "animate-spin motion-reduce:animate-none",
          )}
        />
      )}
      <span className={cn(dsClip.text, label === undefined && spec.labelDecoration)}>
        {label ?? spec.label}
      </span>
      {/* Gate age belongs where triage needs it; settled and parked pills carry no timer. */}
      {age &&
        status !== "verifiedDone" &&
        status !== "doneWarnings" &&
        status !== "waiting" &&
        status !== "parked" && (
        <span className={cn(dsText.nums, "shrink-0 opacity-80")} aria-label={`for ${age}`}>
          · {age}
        </span>
      )}
    </ShadcnBadge>
  );
}

/** Wordless status markers need an accompanying label or accessible name. */
export function StatusDot({
  status,
  className,
}: {
  status: DsStatus;
  className?: string;
}) {
  const spec = DS_STATUS[status];
  const shape =
    spec.tier === "solid"
      ? cn("size-2", spec.dot) // filled disc — loudest
      : spec.tier === "ghost"
        ? cn("size-1.5 border bg-transparent opacity-70", spec.dotBorder) // hollow — finished
        : cn("size-1.5 border-2 bg-transparent", spec.dotBorder); // ring — active
  return (
    <span
      role="img"
      // A wordless dot uses the full accessible status; its tooltip keeps visible vocabulary.
      aria-label={dsStatusAccessibleName(status)}
      title={spec.label}
      className={cn("inline-block shrink-0 rounded-full", shape, className)}
    />
  );
}

/** Standalone icons use visible status hues; chip ink assumes a colored background. */
export function StatusIcon({
  status,
  className,
}: {
  status: DsStatus;
  className?: string;
}) {
  const spec = DS_STATUS[status];
  const Icon = spec.icon;
  return (
    <Icon
      aria-hidden
      className={cn(
        dsIcon.md,
        "shrink-0",
        spec.soloTone,
        spec.spin && "animate-spin motion-reduce:animate-none",
        className,
      )}
    />
  );
}
