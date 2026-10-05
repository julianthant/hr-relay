import type { RunDetailSectionResponse, RunDetailSectionName, PanelSections } from "./sections.js";
import type { RunDetailWire } from "../../../domain/dashboard/run-detail.js";
import type { PanelTab } from "./log-panel-model.js";

/** The run's advertised sections and current panel state determine lazy reads. */
export function sectionsWanted(detail: RunDetailWire, tab: PanelTab): string[] {
  const advertised = new Set(detail.availableSections);
  const wanted = new Set<string>();
  if (advertised.has("context-attempts")) wanted.add("context-attempts");
  const active = tab === "receipt" ? "logs" : tab;
  if (advertised.has(active)) wanted.add(active);
  if (advertised.has("failure")) wanted.add("failure");
  if (advertised.has("parked-write")) wanted.add("parked-write");
  if (advertised.has("identity-gate")) wanted.add("identity-gate");
  return [...wanted];
}

function place<K extends RunDetailSectionName>(
  into: PanelSections,
  section: K,
  payload: Extract<RunDetailSectionResponse, { section: K }>['payload'],
): PanelSections {
  return { ...into, [section]: payload };
}

/** One closed placement switch for the sections this panel currently renders. */
export function mergeSection(
  into: PanelSections,
  response: RunDetailSectionResponse,
): PanelSections {
  switch (response.section) {
    case "logs":
    case "receipt":
    case "failure":
    case "context-data":
    case "context-evidence":
    case "context-attempts":
    case "parked-write":
    case "identity-gate":
      return place(into, response.section, response.payload);
    case "review":
    case "people":
      throw new Error(`run section "${response.section}" has no panel placement in this build`);
    case "captures":
      throw new Error("capture sections are loaded by the capture owner, not the panel section bundle");
    default: {
      const exhaustive: never = response;
      throw new Error(`run section "${String(exhaustive)}" has no panel placement in this build`);
    }
  }
}
