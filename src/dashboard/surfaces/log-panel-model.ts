/** Tab and terminal copy for the run-detail composition. */
import type { z } from "zod";
import { fmtClock } from "./format.js";
import type { RunDetailWireSchema } from "../../domain/dashboard/run-detail.js";
import type { RunDetailSectionSchema } from "../../domain/dashboard/primitives.js";

type RunDetailWire = z.infer<typeof RunDetailWireSchema>;
type RunDetailSection = z.infer<typeof RunDetailSectionSchema>;
export * from "./run-detail/logs-model.js";

export type PanelTab = "review" | "people" | "logs" | "receipt";

/** Display only advertised operator tabs; historical receipt selections fall back to Logs. */
export const TAB_ORDER: readonly PanelTab[] = ["review", "people", "logs"];

/**
 * The tab's WORD, in the one place both readers of it can see.
 *
 * `log-panel.tsx`'s `TAB_META` pairs each label with its glyph and the row/panel
 * catalog prints the same strip without one, so the label lived in a `.tsx` only
 * one of them could import. A specimen page naming a tab `Log` while the panel
 * draws `Logs` is precisely the drift a reference surface exists to prevent.
 */
export const PANEL_TAB_LABEL: Record<PanelTab, string> = {
  review: "Review",
  people: "People",
  logs: "Logs",
  receipt: "Receipt",
};

export function tabsFor(detail: Pick<RunDetailWire, "availableSections">): PanelTab[] {
  const advertised = new Set<RunDetailSection>(detail.availableSections);
  return TAB_ORDER.filter((tab) => advertised.has(tab));
}

/** Run outcomes and failures remain in the chronological Logs stream. */
export function defaultTabFor(detail: Pick<RunDetailWire, "availableSections" | "outcome">): PanelTab {
  const available = tabsFor(detail);
  const pick = (...preferred: PanelTab[]): PanelTab =>
    preferred.find((tab) => available.includes(tab)) ?? available[0] ?? "logs";
  if (detail.outcome.state === "terminal" && detail.outcome.result === "failed") return pick("logs");
  return pick("logs");
}

/**
 * THE OUTCOME BAR'S WORDS for a settled run — D238.
 *
 * A REHEARSAL says so first. The bar states what the run came to, and for a dry
 * run what it came to is a PREVIEW: nothing was written, nothing was fenced,
 * and the verdict beside the word is `partial` rather than `verified-done`
 * because the receipt for the same run derives exactly that. The word leads
 * because the verdict is only readable once you know which kind of run produced
 * it — `partial` alone reads as a run that half-worked, which is the opposite
 * of what a clean rehearsal means.
 *
 * Exported as a pure function so the sentence is pinned by a test rather than
 * only by a screenshot: this tree renders no React in the unit lane, and the
 * one label that must never say `verified-done` for a preview is not a thing to
 * leave to the parity corpus alone (D187's lesson, from the other side).
 */
export function terminalOutcomeText(
  outcome: Extract<RunDetailWire["outcome"], { state: "terminal" }>,
): string {
  const rehearsal = outcome.rehearsal === true ? "dry run · " : "";
  return `${rehearsal}${outcome.result} · ${fmtClock(outcome.completedAt)}`;
}

export { timelineAxisTotals, timelineHasOrphanGate, timelineSegmentUnmeasured } from "./run-detail/timeline-model.js";
export type { TimelineAxisTotals, TimelineSegmentState } from "./run-detail/timeline-model.js";
