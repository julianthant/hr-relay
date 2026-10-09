/** Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc
 * src/dashboard/components/dev/rebuild-demo/demo-status.tsx */
import { cn } from "../../../lib/utils.js";
import { StatusPill, dsText } from "../../../ds/ui.js";
import type {
  OutcomeWire,
  ProposedStatus,
  QueueStatus,
  TerminalOutcomeResult,
} from "./status-model.js";

export type { OutcomeWire, ProposedStatus, QueueStatus, TerminalOutcomeResult };

/** the wire types, the wire→ds maps and the naming functions live in `status-model.ts` */


/** The row-level status chip. A thin wrapper over the one ratified
 * `StatusPill` so a status can never be rendered two ways */
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

/** A member's OUTCOME — what its run found — as a word in a column.
 * Presentation vocabulary, not wire: the wire does not serve member outcome */
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

/** The em dash a member shows in the outcome column before it has answered.
 * A blank cell reads as a value that failed to render */
export function MemberOutcomePending({ className }: { className?: string }) {
  return <span className={cn(dsText.meta, dsText.nums, "text-[color:var(--ds-fg-faint)]", className)}>—</span>;
}
