/**
 * Which tabs a run detail advertises, and which one opens.
 *
 * It lives beside `log-panel.tsx` rather than inside it because a module that
 * exports a component may export nothing else if React Fast Refresh is to treat
 * it as a refresh boundary: one non-component export makes every edit to the
 * surface invalidate upward into `dashboard-app.tsx` and remount the app
 * instead of hot-swapping the component.
 */
import type { z } from "zod";
import type { RunDetailWireSchema } from "../../domain/dashboard/run-detail.js";
import type { RunDetailSectionSchema } from "../../domain/dashboard/primitives.js";

type RunDetailWire = z.infer<typeof RunDetailWireSchema>;
type RunDetailSection = z.infer<typeof RunDetailSectionSchema>;

/** The tab set this slice can draw. Review and People are advertised, not assumed. */
export type PanelTab = "review" | "people" | "logs" | "receipt";

/**
 * The tabs are SERVED, never fixed at four and never decided from a workflow.
 * `availableSections` is the descriptor's own answer, and the ORDER is doc 13
 * §3.3's fixed composition: `Review · Logs · Receipt` / `People · Logs ·
 * Receipt` / `Logs · Receipt`. A section the wire does not advertise draws no
 * tab — a dead tab that opens an empty panel is worse than an absent one.
 */
const TAB_ORDER: readonly PanelTab[] = ["review", "people", "logs", "receipt"];

export function tabsFor(detail: RunDetailWire): PanelTab[] {
  const advertised = new Set<RunDetailSection>(detail.availableSections);
  return TAB_ORDER.filter((tab) => advertised.has(tab));
}

/**
 * A failed run opens on the LOGS, ahead of every other default: its record now
 * lives in the stream at the line it died on, and moving the record off the
 * panel top must never put it behind a tab. Otherwise a run that has finished
 * opens on its receipt — the answer — and a run still working opens on its
 * stream.
 */
export function defaultTabFor(detail: RunDetailWire): PanelTab {
  const available = tabsFor(detail);
  const pick = (...preferred: PanelTab[]): PanelTab =>
    preferred.find((tab) => available.includes(tab)) ?? available[0] ?? "logs";
  if (detail.outcome.state === "terminal" && detail.outcome.result === "failed") return pick("logs");
  if (detail.outcome.state === "terminal") return pick("receipt", "logs");
  return pick("logs", "receipt");
}
