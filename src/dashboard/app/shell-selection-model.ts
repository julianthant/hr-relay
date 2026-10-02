import type { DashboardDayWire } from "../../models/dashboard/projection.js";
import type { RunDetailWire } from "../../models/dashboard/run-detail.js";
import type { AsyncResource } from "../state/async-resource.js";
import { defaultTabFor, tabsFor, type PanelTab } from "../surfaces/log-panel-model.js";
import type { AppRouteState } from "./url-state.js";

export const SHELL_PANEL_TABS: readonly PanelTab[] = ["review", "people", "logs", "receipt"];
export interface ShellAbsence { readonly title: string; readonly description: string }
export type ShellSelection =
  | { readonly state: "ready"; readonly detail: RunDetailWire; readonly tab: PanelTab }
  | { readonly state: "absent"; readonly absence: ShellAbsence };

/** A loaded resource alone cannot authorize painting it beside a different route. */
export function shellSelection(route: AppRouteState, day: string, dayWire: DashboardDayWire | undefined,
  detail: AsyncResource<RunDetailWire>): ShellSelection {
  const absent = (title: string, description: string): ShellSelection => ({state:"absent",absence:{title,description}});
  if (route.run === undefined) return absent("No run open", "Select a run from the queue to open its logs and decisions.");
  if (dayWire === undefined) return absent("Waiting for the queue", `The queue for ${day} must load before this run can open.`);
  const row = dayWire.queueSurfaces.find(candidate => String(candidate.runId) === route.run);
  if (row === undefined) return absent("Run unavailable", `Run ${route.run} is not in the queue for ${day}. Select a run from this day.`);
  if (detail.state === "failed") return absent("Could not load run", detail.error.message);
  if (detail.state !== "loaded") return absent("Loading run", `Loading run ${route.run}.`);
  if (String(detail.value.runId) !== route.run || detail.value.header.workflowId !== row.workflowId) {
    return absent("Run identity mismatch", "The served detail does not match the selected run and workflow. Reload to request it again.");
  }
  const tab = route.section === "receipt" ? "logs" : SHELL_PANEL_TABS.find(candidate => candidate === route.section);
  if (route.section !== undefined && tab === undefined) return absent("Unknown section", `Section ${route.section} is not supported. Select the run again to open its logs.`);
  if (tab !== undefined && !tabsFor(detail.value).includes(tab)) return absent("Section unavailable", `This run does not offer ${tab}. Select the run again to open its logs.`);
  return {state:"ready",detail:detail.value,tab:tab ?? defaultTabFor(detail.value)};
}
