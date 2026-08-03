/**
 * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * src/dashboard/components/dev/rebuild-demo/demo-status.tsx
 *
 * The eight ratified queue statuses, as the shell consumes them — an ADAPTER
 * over `DS_STATUS`, never a second hue/icon table, so the queue chip, the
 * Status Bar pill, the rail and every other consumer cannot disagree about
 * what a status is.
 *
 * NEW here relative to the demo: the fixed wire→ds mapping (doc 13 §0.4). The
 * wire's closed `QueueStatus` enum is the server's vocabulary; `DsStatus` is
 * the approved visual vocabulary; `dsStatusOf` / `outcomeDsStatusOf` are the
 * ONE place the two meet. `partial` renders with the Done-with-warnings
 * treatment — the demo's receipt notes it is the one verdict with no status
 * chip of its own, and the amber tint plus warnings word is its honest chip.
 */
import type { ComponentType, SVGProps } from "react";
import type { z } from "zod";
import { cn } from "../lib/utils.js";
import { DS_STATUS, StatusPill, dsStatusText, dsText, type DsStatus } from "../ds/ui.js";
import type { QueueStatusSchema } from "../../domain/dashboard/projection.js";
import type { OutcomeWireSchema } from "../../domain/dashboard/run-detail.js";

export type QueueStatus = z.infer<typeof QueueStatusSchema>;
export type OutcomeWire = z.infer<typeof OutcomeWireSchema>;
export type TerminalOutcomeResult = Extract<OutcomeWire, { state: "terminal" }>["result"];

/** The fixed wire→ds status mapping — exhaustive over the closed wire enum. */
const WIRE_DS_STATUS: Record<QueueStatus, DsStatus> = {
  queued: "queued",
  running: "running",
  blocked: "parked",
  "awaiting-approval": "waiting",
  done: "verifiedDone",
  failed: "failed",
  cancelled: "cancelled",
  partial: "doneWarnings",
};

export function dsStatusOf(status: QueueStatus): DsStatus {
  return WIRE_DS_STATUS[status];
}

/** The fixed terminal-outcome→ds mapping (doc 03 D22: verified-done renders as Done). */
const OUTCOME_DS_STATUS: Record<TerminalOutcomeResult, DsStatus> = {
  "verified-done": "verifiedDone",
  "done-with-warnings": "doneWarnings",
  failed: "failed",
  cancelled: "cancelled",
  partial: "doneWarnings",
};

export function outcomeDsStatusOf(result: TerminalOutcomeResult): DsStatus {
  return OUTCOME_DS_STATUS[result];
}

export type ProposedStatus = DsStatus;

interface ProposedStatusSpec {
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /**
   * Color alone — for a parent that wraps icon + text. Never put `iconClass`
   * on that parent: it includes Running's rotation utility and would orbit the
   * digit around the glyph.
   */
  soloTone: string;
  /**
   * The icon's class when it is rendered ALONE on a panel surface (a row's
   * leading glyph), spin included. Not the in-chip tone — see `soloTone`.
   */
  iconClass: string;
  /** what this status means for the operator */
  meaning: string;
}

export const PROPOSED_STATUS: Record<ProposedStatus, ProposedStatusSpec> = Object.fromEntries(
  (Object.keys(DS_STATUS) as ProposedStatus[]).map((status) => {
    const spec = DS_STATUS[status];
    return [
      status,
      {
        label: spec.label,
        icon: spec.icon,
        soloTone: spec.soloTone,
        iconClass: cn(spec.soloTone, spec.spin && "animate-spin motion-reduce:animate-none"),
        meaning: spec.meaning,
      },
    ];
  }),
) as Record<ProposedStatus, ProposedStatusSpec>;

/**
 * A collapsed row must say how OLD the decision is, not just that there is one.
 * "Waiting on you" is a state; "Waiting on you · 10m" is a priority — it is the
 * difference between a queue you scan and a queue you triage.
 */
export function statusText(status: ProposedStatus, age?: string): string {
  return dsStatusText(status, age);
}

/**
 * The row-level status chip. A thin wrapper over the one ratified `StatusPill`
 * so a status can never be rendered two ways: `hideIcon` is for the places that
 * already lead with this exact glyph, and `label` is only ever "Rejected" — a
 * record that never became work and therefore has no status of its own.
 */
export function StatusBadge({
  status,
  label,
  age,
  hideIcon,
}: {
  status: ProposedStatus;
  label?: string;
  age?: string;
  hideIcon?: boolean;
}) {
  return <StatusPill status={status} label={label} age={age} size="sm" hideIcon={hideIcon} />;
}

/**
 * A member's OUTCOME — what its run found — as a word in a column.
 *
 * Presentation vocabulary, not wire: the 1g wire does not serve member outcome
 * words yet; the type stays here so the queue's member lines and the Log
 * Panel's stream render an outcome one way when a served source lands.
 * Status and outcome are orthogonal axes and this is the component that keeps
 * them apart: an outcome is deliberately NEVER a `StatusPill` — a negative
 * answer in status chrome is exactly how `Done · Not found` comes to read as a
 * failure. It is a word, the word is always the differentiator, and the tone
 * only decides how loudly it is said.
 */
export interface MemberOutcomeSpec {
  label: string;
  tone: "danger" | "warn" | "neutral" | "quiet";
  meaning: string;
}

const MEMBER_OUTCOME_TONE: Record<MemberOutcomeSpec["tone"], string> = {
  danger: "font-medium text-[color:var(--ds-status-failed-fg)]",
  warn: "font-medium text-[color:var(--ds-status-waiting-fg)]",
  neutral: "text-[color:var(--ds-fg-secondary)]",
  quiet: "text-[color:var(--ds-fg-muted)]",
};

export function MemberOutcomeWord({
  outcome,
  className,
}: {
  outcome: MemberOutcomeSpec;
  className?: string;
}) {
  return (
    <span title={outcome.meaning} className={cn(dsText.meta, "min-w-0 truncate", MEMBER_OUTCOME_TONE[outcome.tone], className)}>
      {outcome.label}
    </span>
  );
}

/**
 * The em dash a member shows in the outcome column before it has answered.
 *
 * A blank cell reads as a value that failed to render; an em dash reads as
 * "nothing yet". The free-text detail is deliberately NOT dropped in here — a
 * column headed `Outcome` holding `person-lookup…` is the two-axes-in-one-column
 * defect the vocabulary exists to end.
 */
export function MemberOutcomePending({ className }: { className?: string }) {
  return <span className={cn(dsText.meta, dsText.nums, "text-[color:var(--ds-fg-faint)]", className)}>—</span>;
}
