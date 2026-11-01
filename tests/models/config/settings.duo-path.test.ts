import assert from "node:assert/strict";
import { it } from "vitest";
import { SettingsOverrideSchema } from "../../../src/models/config/schema.js";
import { containsRetiredSettingsPatch, mergeSettingsPatch, SettingsPatchSchema } from "../../../src/models/config/settings.js";

it("parses retired Duo path journal commands and refuses to apply them", () => {
  const saved = {};
  assert.equal(SettingsOverrideSchema.safeParse({ paths: { duoCredential: "/private/previous-credential.json" } }).success, false);
  for (const operation of [{ set: "/private/another.json" }, { clear: true }] as const) {
    const patch = SettingsPatchSchema.parse({ "paths.duoCredential": operation });
    assert.equal(containsRetiredSettingsPatch(patch), true);
    assert.throws(() => mergeSettingsPatch(saved, patch), /retired settings cannot be edited/u);
    assert.deepEqual(saved, {});
  }
  assert.equal(containsRetiredSettingsPatch(SettingsPatchSchema.parse({ "actor.label": { set: "Operator" } })), false);
});
