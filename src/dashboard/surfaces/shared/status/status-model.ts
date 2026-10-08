/**
 * The eight statuses as the SHELL's chrome consumes them — label, accessible
 * name, icon and tone, folded once out of `DS_STATUS` so the queue chip, the
 * status bar pill and the rail cannot disagree about what a status is.
 *
 * It lives beside `status.tsx` rather than inside it because a module that
 * exports a component may export nothing else if React Fast Refresh is to
 * treat it as a refresh boundary: one non-component export (this record) makes
 * every edit to the status surface invalidate upward into `dashboard-app.tsx`
 * and remount the app instead of hot-swapping the component.
 */
import type { ComponentType, SVGProps } from "react";
import { cn } from "../../../lib/utils.js";
import { DS_STATUS, dsStatusAccessibleName, dsStatusText, type DsStatus } from "../../../ds/ui.js";
import {
  displayStatusOf,
} from "../../../../models/dashboard/status-vocabulary.js";
import type { z } from "zod";
import type { QueueStatusSchema } from "../../../../models/dashboard/projection.js";
import type { OutcomeWireSchema } from "../../../../models/dashboard/run-detail.js";

export type QueueStatus = z.infer<typeof QueueStatusSchema>;

export type OutcomeWire = z.infer<typeof OutcomeWireSchema>;

export type TerminalOutcomeResult = Extract<OutcomeWire, { state: "terminal" }>["result"];

export type ProposedStatus = ReturnType<typeof displayStatusOf>;

export interface ProposedStatusSpec {
  label: string;
  /**
   * The name an `aria-label` must use. Equals `label` for six of the eight
   * statuses; `doneWarnings` announces `Done with warnings` so it cannot
   * collide with `verifiedDone`, whose visible word is also `Done` (D22,
   * amended 2026-08-04). Never render this — it is the non-visual channel.
   */
  accessibleLabel: string;
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
        accessibleLabel: dsStatusAccessibleName(status),
        icon: spec.icon,
        soloTone: spec.soloTone,
        iconClass: cn(spec.soloTone, spec.spin && "animate-spin motion-reduce:animate-none"),
        meaning: spec.meaning,
      },
    ];
  }),
) as Record<ProposedStatus, ProposedStatusSpec>;

export function dsStatusOf(status: QueueStatus): DsStatus {
  return displayStatusOf(status);
}

/** The fixed terminal-outcome→ds mapping (ref dashboard-surfaces D22: verified-done renders as Done). */
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

/**
 * A collapsed row must say how OLD the decision is, not just that there is one.
 * "Waiting on you" is a state; "Waiting on you · 10m" is a priority — it is the
 * difference between a queue you scan and a queue you triage.
 */
export function statusText(status: ProposedStatus, age?: string): string {
  return dsStatusText(status, age);
}

/**
 * The same status as a screen reader must hear it. Every `aria-label` (and
 * every `title` that stands in for one) names a status through THIS function;
 * `statusText` stays the visible word. The two differ only for `doneWarnings`,
 * which shares the visible word `Done` with `verifiedDone` and is separated on
 * screen by hue plus its `△ n` count chip — neither of which an assistive
 * technology can read.
 */
export function statusAccessibleName(status: ProposedStatus, age?: string): string {
  return dsStatusAccessibleName(status, age);
}
