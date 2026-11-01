import type { EditableSettingsWire } from "../../../../models/dashboard/settings-editor.js";
import { resolveSettingsSection, type SettingsNavEntry, type SettingsNavGroup } from "../settings-model.js";
import { settingNote, settingTitle } from "../settings-presentation.js";
import { routePresentation } from "../routes/settings-routes-model.js";

export interface SettingsSearchResult {
  readonly id: string;
  readonly entry: SettingsNavEntry;
  readonly label: string;
  readonly context: string;
  readonly target?: string;
  readonly terms: string;
}

/** Search presentation metadata only; values, credentials and paths on disk never enter the index. */
export function settingsSearchIndex(groups: readonly SettingsNavGroup[], document?: EditableSettingsWire, runtimePaths = false): readonly SettingsSearchResult[] {
  const results: SettingsSearchResult[] = [];
  const add = (section: string, label: string, target: string | undefined, description = "", context?: string) => {
    const resolution = resolveSettingsSection(groups, section);
    if (resolution.state !== "open") return;
    const entry = resolution.entry;
    results.push({ id: `${entry.id}:${target ?? "page"}`, entry, label, target,
      context: context ?? entry.label, terms: `${label} ${entry.label} ${description} ${context ?? ""}`.toLocaleLowerCase() });
  };
  for (const group of groups) for (const entry of group.entries) add(entry.id, entry.label, undefined, group.heading, group.heading);
  add("performance", "Performance", undefined, "Advanced");
  add("general", "Animations", "appearance.animations", "Appearance subtle motion reduced motion");
  add("general", "Assistant permission", "assistant.permission", "Ask before every action");
  add("general", "Browser window", "browser.window", "Browser width height size");
  add("general", "Dark theme", "appearance.theme", "Appearance dashboard color light dark");
  add("general", "ChatGPT account", "chatgpt.account", "OpenAI sign in login subscription plan OCR manage usage");
  if (runtimePaths && document !== undefined) {
    add("paths", "Data", "paths.stateRoot", "Persistent settings and run data; runtime state folder");
    add("paths", "Evidence", "paths.artifactRoot", "Run evidence and generated artifacts; artifact folder");
  }
  if (document === undefined) return results;
  for (const section of document.sections) for (const leaf of section.leaves) {
    // The folded General page renders these controls, not the retired operator-label field.
    if (leaf.path === "features.debugScreenshots" || leaf.path === "features.duoWebAuthn" || leaf.path === "actor.label" || leaf.path.startsWith("display.") || section.id === "providers") continue;
    if (section.id === "routes") {
      const presentation = routePresentation(leaf);
      add("routes", presentation.name, leaf.path, presentation.description);
      if (leaf.control.input === "object") for (const field of leaf.control.fields) {
        const detail = presentation.fields[field.name];
        add("routes", `${presentation.name} · ${detail.name}`, `${leaf.path}.${field.name}`, detail.description);
      }
    } else {
      const label = settingTitle(leaf);
      add(section.id, label, leaf.path, settingNote(leaf));
    }
  }
  for (const row of document.protectedSettings.rows) {
    const routes = row.name === "sharepointOnboardingRosterUrl";
    add(routes ? "routes" : "credentials", row.name === "ucpathUserId" ? "UCPath username" : row.label, `protected.${row.name}`, row.purpose);
  }
  return results;
}

export function searchSettings(index: readonly SettingsSearchResult[], query: string): readonly SettingsSearchResult[] {
  const term = query.trim().toLocaleLowerCase();
  if (!term) return [];
  const words = term.split(/\s+/u);
  return index.filter(result => words.every(word => result.terms.includes(word))).sort((a, b) => {
    const rank = (result: SettingsSearchResult) => result.label.toLocaleLowerCase() === term ? 0 : result.label.toLocaleLowerCase().startsWith(term) ? 1 : 2;
    return rank(a) - rank(b);
  });
}
