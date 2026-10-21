import { z } from "zod";
import type {
SettingsSectionPrimitiveSchema
} from "../../../models/dashboard/bootstrap.js";
import { PreflightCheckWireSchema } from "../../../models/dashboard/bootstrap.js";
import type {
EditableSettingsWire
} from "../../../models/dashboard/settings-editor.js";
import {
SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID
} from "../../../models/dashboard/settings.js";


export type PreflightCheckWire = z.infer<typeof PreflightCheckWireSchema>;

export type SettingsSection = z.infer<typeof SettingsSectionPrimitiveSchema>;


/** Which glyph a nav entry draws. A KEY rather than the component itself
 * because this module may not export a component (see the boundary note above) */
export type SettingsNavIcon =
  | "general"
  | "display"
  | "credentials"
  | "performance"
  | "paths"
  | "storage"
  | "preflight"
  | "routes"
  | "capabilities"
  | "keyboard"
  | "unrendered"
  | "spreadsheets"
  | "explorer"
  | "activity";


/** The glyph for each SERVED section this build renders, keyed by the id the
 * server lists. A served id that is not here draws `unrendered` and the pane */
const SERVED_NAV_ICON: Readonly<Record<string, SettingsNavIcon>> = Object.freeze({
  general: "general",
  performance: "performance",
  paths: "paths",
  routes: "routes",
  credentials: "general",
  storage: "storage",
  [SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID]: "capabilities",
});

const EDITOR_SECTIONS = new Set(["general", "display", "performance", "paths", "routes", "annual-dates", "providers"]);
const FOLDED_EDITOR_SECTIONS = new Set(["display", "annual-dates"]);
const SETTINGS_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  display: "general",
  "annual-dates": "general",
  "runtime-isolation": "paths",
  providers: "general",
  "provider-env": "general",
  "protected-store": "credentials",
});

const servedEntry = (id: string, label: string): SettingsNavEntry => ({
  id,
  label,
  icon: SERVED_NAV_ICON[id] ?? "unrendered",
  source: "served",
});

const clientEntry = (id: string, label: string, icon: SettingsNavIcon): SettingsNavEntry => ({
  id,
  label,
  icon,
  source: "client",
});


export interface SettingsNavEntry {
  readonly id: string;
  readonly label: string;
  readonly icon: SettingsNavIcon;
  /** Served entries come from the bootstrap; client entries are owned by this bundle. */
  readonly source: "served" | "client";
}


export interface SettingsNavGroup {
  readonly id: "personal" | "advanced" | "data" | "status" | "help";
  readonly heading: string;
  readonly entries: readonly SettingsNavEntry[];
}


/** The Help group's keyboard entry — the Help → Keyboard destination. */
export const SETTINGS_KEYBOARD_SECTION_ID = "keyboard";


/** Route token kept only for compatibility notices */
export const SETTINGS_UI_CATALOG_SECTION_ID = "ui-catalog";
export const SETTINGS_PREFLIGHT_SECTION_ID = "preflight";
export const SETTINGS_DATA_SECTION_IDS: ReadonlySet<string> = new Set(["explorer", "activity"]);


/** The gear's stable DOM id, and the app shell's main region behind the
 * takeover — the two focus-restoration targets on close . */
export const SETTINGS_GEAR_ID = "settings-gear";

export const DASHBOARD_MAIN_REGION_ID = "dashboard-main-region";


/** Which id to focus when the takeover closes: the gear it was opened from, or
 * if the gear is not mounted — the main region the takeover was covering. */
export function settingsCloseFocusTargetId(gearMounted: boolean): string {
  return gearMounted ? SETTINGS_GEAR_ID : DASHBOARD_MAIN_REGION_ID;
}


/** The approved Settings page list stays available while the current editor
 * projection loads or fails. Each page still reads its values and edit */
export function buildSettingsNav(
  sections: readonly SettingsSection[],
  editor?: EditableSettingsWire,
): readonly SettingsNavGroup[] {
  const groups: SettingsNavGroup[] = [];
  groups.push({ id: "personal", heading: "Personal", entries: [
    clientEntry("general", "General", "general"),
    clientEntry("credentials", "Credentials", "credentials"),
  ] });
  groups.push({ id: "advanced", heading: "Advanced", entries: [
    clientEntry("paths", "Paths", "paths"),
    clientEntry("routes", "Routes", "routes"),
    ...(editor?.sections.filter(section => !EDITOR_SECTIONS.has(section.id) && !FOLDED_EDITOR_SECTIONS.has(section.id))
      .map(section => servedEntry(section.id, section.label)) ?? []),
  ] });
  groups.push({ id: "data", heading: "Data", entries: [
    clientEntry("spreadsheets", "Spreadsheets", "spreadsheets"),
    clientEntry("explorer", "Explorer", "explorer"),
    clientEntry("activity", "Analytics", "activity"),
  ] });
  const statusEntries: SettingsNavEntry[] = [];
  for (const section of sections) {
    if (section.id === SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID || section.id === "providers" || section.id === SETTINGS_UI_CATALOG_SECTION_ID) continue;
    statusEntries.push(servedEntry(section.id, section.id === "storage" ? "Storage" : section.label));
    if (section.id === "storage") statusEntries.push({ id: SETTINGS_PREFLIGHT_SECTION_ID, label: "Preflight", icon: "preflight", source: "client" });
  }
  if (!statusEntries.some(entry => entry.id === SETTINGS_PREFLIGHT_SECTION_ID)) {
    statusEntries.unshift({ id: SETTINGS_PREFLIGHT_SECTION_ID, label: "Preflight", icon: "preflight", source: "client" });
  }
  groups.push({ id: "status", heading: "Status", entries: statusEntries });
  groups.push({
    id: "help",
    heading: "Help",
    entries: [
      { id: SETTINGS_KEYBOARD_SECTION_ID, label: "Keyboard", icon: "keyboard", source: "client" },
    ],
  });
  return groups;
}


/** Which section the page opens on, resolved from `?settings=`. An empty value is the demo's `initialSection` default —
 * the first entry. A */
export type SettingsSectionResolution =
  | { readonly state: "open"; readonly entry: SettingsNavEntry }
  | { readonly state: "unknown"; readonly requested: string }
  | { readonly state: "empty" };


export function resolveSettingsSection(
  groups: readonly SettingsNavGroup[],
  requested: string,
): SettingsSectionResolution {
  const entries = groups.flatMap((group) => group.entries);
  // Existing editor deep links remain available outside the approved HUB navigation.
  if (requested === "performance") return { state: "open", entry: clientEntry("performance", "Performance", "performance") };
  if (requested === SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID) requested = SETTINGS_PREFLIGHT_SECTION_ID;
  const first = entries[0];
  if (requested.length === 0) {
    return first === undefined ? { state: "empty" } : { state: "open", entry: first };
  }
  const found = entries.find((entry) => entry.id === (SETTINGS_ALIASES[requested] ?? requested));
  return found === undefined ? { state: "unknown", requested } : { state: "open", entry: found };
}
export { CAPABILITY_SPECS,capabilityAvailableCount,capabilityMatrix,dryRunPostureSentence } from "./preflight/settings-capabilities-model.js";
export type { CapabilityCell,CapabilityKey,CapabilityRow,CapabilitySpec } from "./preflight/settings-capabilities-model.js";
export { useEditableSettings } from "./editor/settings-editor-model.js";
export type { EditableSettingsState,PreflightRerunState,SettingsSaveState } from "./editor/settings-editor-model.js";
export { useSettingsFacts } from "./editor/settings-facts-model.js";
export type { SettingsFactsState } from "./editor/settings-facts-model.js";
export { SYSTEM_HOST_PRESENTATION } from "./general/settings-hosts-model.js";
export type { SystemHostPresentation } from "./general/settings-hosts-model.js";
export { spanAuthorityProblemDetail,storageNeedsAttention } from "./storage/storage-settings-model.js";
export type { SpanAuthorityProblem,StorageHealthSummary } from "./storage/storage-settings-model.js";
