/**
 * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * src/dashboard/components/dev/rebuild-demo/demo-status.tsx
 *
 * The eight ratified queue statuses, as the shell consumes them — an ADAPTER
 * over `DS_STATUS`, never a second hue/icon table, so the queue chip, the
 * Status Bar pill, the rail and every other consumer cannot disagree about
 * what a status is.
 *
 * NEW here relative to the demo: the fixed wire→ds mapping (ref frontend-backend-integration §0.4). The
 * wire's closed `QueueStatus` enum is the server's vocabulary; `DsStatus` is
 * the approved visual vocabulary; `dsStatusOf` / `outcomeDsStatusOf` are the
 * ONE place the two meet. `partial` renders with the Done-with-warnings
 * treatment — the demo's receipt notes it is the one verdict with no status
 * chip of its own, and the amber tint plus warnings word is its honest chip.
 */
import { cn } from "../lib/utils.js";
import { StatusPill, dsText } from "../ds/ui.js";
import type {
  OutcomeWire,
  ProposedStatus,
  QueueStatus,
  TerminalOutcomeResult,
} from "./status-model.js";

export type { OutcomeWire, ProposedStatus, QueueStatus, TerminalOutcomeResult };

/* the wire types, the wire→ds maps, the two naming functions and the folded
   status record all live in `status-model.ts` — see the note there */


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
  presentation,
}: {
  status: ProposedStatus;
  label?: string;
  age?: string;
  hideIcon?: boolean;
  presentation?: "default" | "queue";
}) {
  return <StatusPill status={status} label={label} age={age} size="sm" hideIcon={hideIcon} presentation={presentation} />;
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
