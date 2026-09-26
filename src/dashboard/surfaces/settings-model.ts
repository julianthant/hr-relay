import { z } from "zod";
import type {
SettingsSectionPrimitiveSchema
} from "../../domain/dashboard/bootstrap.js";
import { PreflightCheckWireSchema } from "../../domain/dashboard/bootstrap.js";
import type {
EditableSettingsWire
} from "../../domain/dashboard/settings-editor.js";
import {
SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID
} from "../../domain/dashboard/settings.js";


export type PreflightCheckWire = z.infer<typeof PreflightCheckWireSchema>;

export type SettingsSection = z.infer<typeof SettingsSectionPrimitiveSchema>;


/**
 * Which glyph a nav entry draws. A KEY rather than the component itself,
 * because this module may not export a component (see the boundary note above)
 * and the surface owns the mapping.
 */
export type SettingsNavIcon =
  | "general"
  | "display"
  | "performance"
  | "paths"
  | "storage"
  | "preflight"
  | "routes"
  | "capabilities"
  | "keyboard"
  | "ui-catalog"
  | "unrendered";


/**
 * The glyph for each SERVED section this build renders, keyed by the id the
 * server lists. A served id that is not here draws `unrendered` and the pane
 * says so by name — the list stays the server's, and this map only decides what
 * the entry looks like once it has arrived.
 */
const SERVED_NAV_ICON: Readonly<Record<string, SettingsNavIcon>> = Object.freeze({
  general: "general",
  performance: "performance",
  paths: "paths",
  routes: "routes",
  providers: "performance",
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
  "provider-env": "credentials",
  "protected-store": "credentials",
});

const servedEntry = (id: string, label: string): SettingsNavEntry => ({
  id,
  label,
  icon: SERVED_NAV_ICON[id] ?? "unrendered",
  source: "served",
});


export interface SettingsNavEntry {
  readonly id: string;
  readonly label: string;
  readonly icon: SettingsNavIcon;
  /**
   * `served` — the server LISTED this section; `client` — the bundle
   * contributes it and `settingsSections` does not name it. It is about who
   * owns the LIST, not who holds the data: `Keyboard` is client-owned end to
   * end (SE7 — a legend of this build's own bindings, so a served section for
   * it would be the server describing the client to itself), while the
   * `UI catalog` added by D295 is client-LISTED and still reads a served
   * artifact over `GET /api/v1/ui-catalog`. Nothing on the wire lists it
   * because the catalog is not a setting; it is the reference the operator
   * looks up, and the demo's Help group is where a looked-up page lives.
   */
  readonly source: "served" | "client";
}


export interface SettingsNavGroup {
  readonly heading: string;
  readonly entries: readonly SettingsNavEntry[];
}


/** The Help group's keyboard entry — the destination the top bar's deleted keyboard glyph was traded for. */
export const SETTINGS_KEYBOARD_SECTION_ID = "keyboard";


/**
 * The Help group's catalog entry (D295).
 *
 * The generated UI catalog was its own takeover behind `?catalog=`, entered
 * from a queue-toolbar button. D295 retires both: it is reference material an
 * operator LOOKS UP, which is the Help group's whole membership rule, and one
 * takeover with one nav is a shorter path to it than a toolbar button that had
 * been added, removed and restored three times (D275 item 1, D281 item 2).
 */
export const SETTINGS_UI_CATALOG_SECTION_ID = "ui-catalog";
export const SETTINGS_PREFLIGHT_SECTION_ID = "preflight";


/**
 * The gear's stable DOM id, and the app shell's main region behind the
 * takeover — the two focus-restoration targets on close (unit F4b finding 1).
 *
 * Settings was a `Dialog`, and Radix restores focus to the element that opened
 * it when a dialog closes. As a routed page it has no such trigger ref — the
 * takeover can be reached from two doors (the gear, and the storage band's
 * `Storage checks`) and can survive a reload — so the target is looked up by
 * id the same way `WORKFLOW_PANEL_TOGGLE_ID` is (`shell.tsx`), rather than
 * held as a React ref threaded down through `TopBar`.
 */
export const SETTINGS_GEAR_ID = "settings-gear";

export const DASHBOARD_MAIN_REGION_ID = "dashboard-main-region";


/**
 * Which id to focus when the takeover closes: the gear it was opened from, or
 * — if the gear is not mounted — the main region the takeover was covering.
 * The gear is part of the persistent `TopBar` and is always mounted while
 * `SettingsPage` is, so `gearMounted` is normally `true`; the fallback exists
 * because the id lookup happens through the DOM rather than through a prop the
 * type system can prove present.
 */
export function settingsCloseFocusTargetId(gearMounted: boolean): string {
  return gearMounted ? SETTINGS_GEAR_ID : DASHBOARD_MAIN_REGION_ID;
}


/**
 * The demo's three nav groups, minus the ones this build has no member for.
 *
 * The demo draws `Settings` (the server's strict resolver-owned editable
 * leaves) · `Status` · `Help`. Help carries TWO entries here (D295) where the
 * demo has one: the demo has no generated selector catalog to put anywhere.
 * The Settings group is present only when that
 * exact editor inventory is served; its one revision/schema/patch-bound
 * command applies the reviewed leaves atomically, while environment-owned
 * leaves remain locked. Status is separately read-only and Help remains
 * client-owned, so an absent group is never disguised as a failed load.
 */
export function buildSettingsNav(
  sections: readonly SettingsSection[],
  editor?: EditableSettingsWire,
): readonly SettingsNavGroup[] {
  const groups: SettingsNavGroup[] = [];
  if (editor !== undefined) {
    const entries = [
      servedEntry("general", "General"),
      servedEntry("performance", "Performance"),
      servedEntry("paths", "Paths"),
      servedEntry("routes", "Routes"),
      servedEntry("providers", "Provider budgets & models"),
      servedEntry("credentials", "Credentials"),
      ...editor.sections.filter(section => !EDITOR_SECTIONS.has(section.id) && !FOLDED_EDITOR_SECTIONS.has(section.id))
        .map(section => servedEntry(section.id, section.label)),
    ];
    groups.push({ heading: "Settings", entries });
  }
  const statusEntries: SettingsNavEntry[] = [];
  for (const section of sections) {
    statusEntries.push(servedEntry(section.id, section.label));
    if (section.id === "storage") statusEntries.push({ id: SETTINGS_PREFLIGHT_SECTION_ID, label: "Preflight", icon: "preflight", source: "client" });
  }
  if (!statusEntries.some(entry => entry.id === SETTINGS_PREFLIGHT_SECTION_ID)) {
    statusEntries.unshift({ id: SETTINGS_PREFLIGHT_SECTION_ID, label: "Preflight", icon: "preflight", source: "client" });
  }
  groups.push({ heading: "Status", entries: statusEntries });
  groups.push({
    heading: "Help",
    entries: [
      { id: SETTINGS_KEYBOARD_SECTION_ID, label: "Keyboard", icon: "keyboard", source: "client" },
      { id: SETTINGS_UI_CATALOG_SECTION_ID, label: "UI catalog", icon: "ui-catalog", source: "client" },
    ],
  });
  return groups;
}


/**
 * Which section the page opens on, resolved from `?settings=`.
 *
 * An empty value is the demo's `initialSection` default — the first entry. A
 * value naming a section this build has no entry for resolves to `unknown`
 * rather than quietly falling back to the first one: a link that says
 * `?settings=budgets` and lands on Storage has told the operator they are
 * looking at something they are not.
 */
export type SettingsSectionResolution =
  | { readonly state: "open"; readonly entry: SettingsNavEntry }
  | { readonly state: "unknown"; readonly requested: string }
  | { readonly state: "empty" };


export function resolveSettingsSection(
  groups: readonly SettingsNavGroup[],
  requested: string,
): SettingsSectionResolution {
  const entries = groups.flatMap((group) => group.entries);
  const first = entries[0];
  if (requested.length === 0) {
    return first === undefined ? { state: "empty" } : { state: "open", entry: first };
  }
  const found = entries.find((entry) => entry.id === (SETTINGS_ALIASES[requested] ?? requested));
  return found === undefined ? { state: "unknown", requested } : { state: "open", entry: found };
}
export { CAPABILITY_SPECS,capabilityAvailableCount,capabilityMatrix,dryRunPostureSentence } from "./settings-capabilities-model.js";
export type { CapabilityCell,CapabilityKey,CapabilityRow,CapabilitySpec } from "./settings-capabilities-model.js";
export { useEditableSettings } from "./settings-editor-model.js";
export type { EditableSettingsState,PreflightRerunState,SettingsSaveState } from "./settings-editor-model.js";
export { useSettingsFacts } from "./settings-facts-model.js";
export type { SettingsFactsState } from "./settings-facts-model.js";
export { SYSTEM_HOST_PRESENTATION } from "./settings-hosts-model.js";
export type { SystemHostPresentation } from "./settings-hosts-model.js";
export { spanAuthorityProblemDetail,storageNeedsAttention } from "./storage-settings-model.js";
export type { SpanAuthorityProblem,StorageHealthSummary } from "./storage-settings-model.js";
