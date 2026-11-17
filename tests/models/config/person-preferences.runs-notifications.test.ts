import assert from "node:assert/strict";
import { it } from "vitest";
import { resolveConfigWithProvenance } from "../../../src/backend/app/config/resolve.js";
import { hostConfigFacts } from "../../../src/models/config/host-display.js";
import { NEUTRAL_PERSON_PREFERENCES, resolvePersonPreferences } from "../../../src/models/config/person-preferences.js";
import { mergeSettingsPatch, SettingsPatchSchema } from "../../../src/models/config/settings.js";

const SAVED = [
  ["preferences.preventSleepWhileRunning", false],
  ["preferences.confirmCloseDuringRun", "always"],
  ["preferences.notifications.runFinished", "never"],
  ["preferences.notifications.needsYou", false],
  ["preferences.notifications.failures", false],
  ["preferences.notifications.sound", "none"],
] as const;

it("defaults the Runs and Notifications settings to the approved mock's values", () => {
  const { preventSleepWhileRunning, confirmCloseDuringRun, notifications } = NEUTRAL_PERSON_PREFERENCES;
  assert.deepEqual({ preventSleepWhileRunning, confirmCloseDuringRun, notifications }, {
    preventSleepWhileRunning: true, confirmCloseDuringRun: "active-run",
    notifications: { runFinished: "unfocused", needsYou: true, failures: true, sound: "default" },
  });
});

it.each(SAVED)("saves %s and reads it back without changing any other preference", (path, value) => {
  const resolved = resolveConfigWithProvenance(mergeSettingsPatch({}, { [path]: { set: value } }), hostConfigFacts({})).preferences;
  const expected = structuredClone(NEUTRAL_PERSON_PREFERENCES) as Record<string, unknown>;
  const parts = path.split(".").slice(1);
  let cursor = expected;
  for (const part of parts.slice(0, -1)) cursor = cursor[part] as Record<string, unknown>;
  cursor[parts.at(-1) ?? ""] = value;
  assert.deepEqual(resolved, expected);
});

it("returns a cleared setting to its default and keeps the other notification settings", () => {
  const saved = mergeSettingsPatch({}, { "preferences.notifications.sound": { set: "none" }, "preferences.notifications.failures": { set: false } });
  const cleared = mergeSettingsPatch(saved, { "preferences.notifications.sound": { clear: true } });
  assert.deepEqual(resolvePersonPreferences(cleared.preferences).notifications, { runFinished: "unfocused", needsYou: true, failures: false, sound: "default" });
});

it("refuses values outside each setting's choices", () => {
  for (const [path, value] of [["preferences.confirmCloseDuringRun", "sometimes"], ["preferences.notifications.runFinished", true],
    ["preferences.notifications.sound", "loud"], ["preferences.preventSleepWhileRunning", "yes"], ["preferences.notifications.other", true]] as const) {
    assert.equal(SettingsPatchSchema.safeParse({ [path]: { set: value } }).success, false, path);
  }
});
