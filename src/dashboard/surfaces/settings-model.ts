/**
 * Whether the storage summary owes the operator attention, and the Settings
 * page's own navigation fold.
 *
 * It lives beside `settings.tsx` rather than inside it because a module that
 * exports a component may export nothing else if React Fast Refresh is to treat
 * it as a refresh boundary: one non-component export makes every edit to the
 * surface invalidate upward into `dashboard-app.tsx` and remount the app
 * instead of hot-swapping the component.
 */
import type { z } from "zod";
import type {
  SettingsSectionPrimitiveSchema,
  StorageHealthSummaryWireSchema,
} from "../../domain/dashboard/bootstrap.js";

export type StorageHealthSummary = z.infer<typeof StorageHealthSummaryWireSchema>;
export type SettingsSection = z.infer<typeof SettingsSectionPrimitiveSchema>;

/** True when the top-bar gear should carry the attention dot. */
export function storageNeedsAttention(storage: StorageHealthSummary): boolean {
  return storage.authority !== "healthy" || storage.backup !== "current";
}

/**
 * Which glyph a nav entry draws. A KEY rather than the component itself,
 * because this module may not export a component (see the boundary note above)
 * and the surface owns the mapping.
 */
export type SettingsNavIcon = "storage" | "keyboard" | "unrendered";

export interface SettingsNavEntry {
  readonly id: string;
  readonly label: string;
  readonly icon: SettingsNavIcon;
  /**
   * `served` — the server listed this section; `client` — it is a page of the
   * bundle itself with nothing behind it on the wire. Help is the only `client`
   * entry today, and the ledger row that asked for it (SE7) says exactly why:
   * a keyboard legend is a fact about THIS build's bindings, so a served
   * section for it would be the server describing the client to itself.
   */
  readonly source: "served" | "client";
}

export interface SettingsNavGroup {
  readonly heading: string;
  readonly entries: readonly SettingsNavEntry[];
}

/** The Help group's one entry — the destination the top bar's deleted keyboard glyph was traded for. */
export const SETTINGS_KEYBOARD_SECTION_ID = "keyboard";

/**
 * The gear's stable DOM id, and the app shell's main region behind the
 * takeover — the two focus-restoration targets on close (unit F4b finding 1).
 *
 * Settings was a `Dialog`, and Radix restores focus to the element that opened
 * it when a dialog closes. As a routed page it has no such trigger ref — the
 * takeover can be reached from two doors (the gear, and the storage band's
 * `Storage health`) and can survive a reload — so the target is looked up by
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
 * The demo draws `Settings` (editable leaves) · `Status` · `Help`. Editable
 * settings are a deferred command family (`apply-settings`, doc 04) and the
 * server lists none, so the first heading is not drawn over an empty list —
 * a group heading with nothing under it reads as a section that failed to
 * load. Every section the server DOES list is read-only status today, which is
 * the heading they get.
 */
export function buildSettingsNav(sections: readonly SettingsSection[]): readonly SettingsNavGroup[] {
  const groups: SettingsNavGroup[] = [];
  if (sections.length > 0) {
    groups.push({
      heading: "Status",
      entries: sections.map((section) => ({
        id: section.id,
        label: section.label,
        icon: section.id === "storage" ? "storage" : "unrendered",
        source: "served",
      })),
    });
  }
  groups.push({
    heading: "Help",
    entries: [{ id: SETTINGS_KEYBOARD_SECTION_ID, label: "Keyboard", icon: "keyboard", source: "client" }],
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
  const found = entries.find((entry) => entry.id === requested);
  return found === undefined ? { state: "unknown", requested } : { state: "open", entry: found };
}
