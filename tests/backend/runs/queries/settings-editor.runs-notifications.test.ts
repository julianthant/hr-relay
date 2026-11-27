import assert from "node:assert/strict";
import { it } from "vitest";
import { fixtureSettingsDocument } from "../../../support/fixtures/dashboard/fixture-settings.js";

/** Labels, descriptions and defaults of the approved mock's Runs and Notifications groups. */
const MOCK_ROWS = [
  { path: "preferences.preventSleepWhileRunning", input: "boolean", label: "Prevent sleep while running", description: "Keep this Mac awake while a run is going.", defaultValue: true },
  { path: "preferences.confirmCloseDuringRun", input: "text", label: "Confirm before closing during a run", description: "Warn before Relay closes while a run is going.", defaultValue: "active-run" },
  { path: "preferences.notifications.runFinished", input: "text", label: "Run finished", description: "Set when Relay alerts you that a run has finished.", defaultValue: "unfocused" },
  { path: "preferences.notifications.needsYou", input: "boolean", label: "Needs you", description: "Alert when a run is waiting for you.", defaultValue: true },
  { path: "preferences.notifications.failures", input: "boolean", label: "Failures", description: "Alert when a run fails.", defaultValue: true },
  { path: "preferences.notifications.sound", input: "text", label: "Notification sound", description: "Sound for finished runs, failures and runs that need you.", defaultValue: "default" },
] as const;

it("serves the six Runs and Notifications settings on General with the mock's labels, descriptions and defaults", () => {
  const document = fixtureSettingsDocument({}, 1);
  const general = document.sections.find(section => section.id === "general")?.leaves ?? [];
  for (const row of MOCK_ROWS) {
    const leaf = general.find(candidate => candidate.path === row.path);
    assert.deepEqual({ path: leaf?.path, input: leaf?.input, label: leaf?.label, description: leaf?.description,
      defaultValue: leaf?.defaultValue, effectiveValue: leaf?.effectiveValue, source: leaf?.source }, { ...row, effectiveValue: row.defaultValue, source: "default" });
    assert.equal(leaf?.editable, true, row.path);
  }
});

it("serves a saved value as the setting's value while keeping the mock's default beside it", () => {
  const document = fixtureSettingsDocument({ preferences: { preventSleepWhileRunning: false, notifications: { runFinished: "always", sound: "none" } } }, 2);
  const leaves = document.sections.flatMap(section => section.leaves);
  const served = (path: string) => { const leaf = leaves.find(candidate => candidate.path === path); return { settingsValue: leaf?.settingsValue, effectiveValue: leaf?.effectiveValue, defaultValue: leaf?.defaultValue, source: leaf?.source }; };
  assert.deepEqual(served("preferences.preventSleepWhileRunning"), { settingsValue: false, effectiveValue: false, defaultValue: true, source: "settings" });
  assert.deepEqual(served("preferences.notifications.runFinished"), { settingsValue: "always", effectiveValue: "always", defaultValue: "unfocused", source: "settings" });
  assert.deepEqual(served("preferences.notifications.sound"), { settingsValue: "none", effectiveValue: "none", defaultValue: "default", source: "settings" });
  assert.deepEqual(served("preferences.notifications.needsYou"), { settingsValue: undefined, effectiveValue: true, defaultValue: true, source: "default" });
});
