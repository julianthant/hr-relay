import assert from "node:assert/strict";
import { it } from "vitest";
import { fixtureSettingsDocument } from "../../../support/fixtures/dashboard/fixture-settings.js";

function served(settings: Parameters<typeof fixtureSettingsDocument>[0], revision: number) {
  const leaf = fixtureSettingsDocument(settings, revision).sections.flatMap(section => section.leaves).find(candidate => candidate.path === "preferences.sendShortcut");
  return { label: leaf?.label, description: leaf?.description, settingsValue: leaf?.settingsValue, effectiveValue: leaf?.effectiveValue, defaultValue: leaf?.defaultValue, source: leaf?.source };
}

it("serves the assistant send shortcut as Enter until the person picks Command-Enter", () => {
  const copy = { label: "Send shortcut", description: "Choose which keys send a message in the assistant." };
  assert.deepEqual(served({}, 1), { ...copy, settingsValue: undefined, effectiveValue: "enter", defaultValue: "enter", source: "default" });
  assert.deepEqual(served({ preferences: { sendShortcut: "mod-enter" } }, 2), { ...copy, settingsValue: "mod-enter", effectiveValue: "mod-enter", defaultValue: "enter", source: "settings" });
});
