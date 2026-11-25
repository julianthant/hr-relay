/** Tab and terminal copy for the run-detail composition. */
import type { z } from "zod";
import type { RunDetailWireSchema } from "../../../models/dashboard/run-detail.js";
import type { RunDetailSectionSchema } from "../../../models/dashboard/primitives.js";

type RunDetailWire = z.infer<typeof RunDetailWireSchema>;
type RunDetailSection = z.infer<typeof RunDetailSectionSchema>;
export * from "./logs-model.js";

export type PanelTab = "review" | "people" | "logs" | "receipt";

/** Display only advertised operator tabs; historical receipt selections fall back to Logs. */
export const TAB_ORDER: readonly PanelTab[] = ["review", "people", "logs"];

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
