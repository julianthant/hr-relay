import assert from "node:assert/strict";
import { it } from "vitest";
import { SettingsOverrideSchema } from "../../../src/models/config/schema.js";
import { containsRetiredSettingsPatch, mergeSettingsPatch, SettingsPatchSchema } from "../../../src/models/config/settings.js";

it("keeps the saved Duo path inspectable while refusing new set and clear commands", () => {
  const saved = { paths: { duoCredential: "/private/previous-credential.json" } };
  assert.deepEqual(SettingsOverrideSchema.parse(saved), saved);
  for (const operation of [{ set: "/private/another.json" }, { clear: true }] as const) {
    const patch = SettingsPatchSchema.parse({ "paths.duoCredential": operation });
    assert.equal(containsRetiredSettingsPatch(patch), true);
    assert.throws(() => mergeSettingsPatch(saved, patch), /retired settings cannot be edited/u);
    assert.deepEqual(saved, { paths: { duoCredential: "/private/previous-credential.json" } });
  }
  assert.equal(containsRetiredSettingsPatch(SettingsPatchSchema.parse({ "actor.label": { set: "Operator" } })), false);
});
