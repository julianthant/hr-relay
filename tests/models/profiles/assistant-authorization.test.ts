import assert from "node:assert/strict";
import { it } from "vitest";
import { randomUUID } from "node:crypto";
import { AssistantStoredCommandSchema } from "../../../src/models/profiles/assistant-authorization.js";
import { CommandRequestSchema } from "../../../src/rules/commands/commands.js";
import { SETTINGS_SCHEMA_HASH, deriveRawSettingsPatchFingerprint, deriveSettingsPatchFingerprint } from "../../../src/models/config/settings.js";

it("retains only admitted safe canonical values, rejecting freeform and permission self-grants", () => {
  const request = (patch: Record<string, { set: unknown }>) => CommandRequestSchema.parse({ commandId: randomUUID(), requestedAt: "2026-10-21T12:00:00.000Z", requestedBy: "local-operator", source: "settings-surface", family: "settings", type: "apply-settings", target: { expectedRevision: 1 }, payload: { patch, patchFingerprint: deriveSettingsPatchFingerprint(patch), settingsSchemaHash: SETTINGS_SCHEMA_HASH } });
  assert.equal(AssistantStoredCommandSchema.safeParse(request({ "browser.headless": { set: false } })).success, true);
  assert.equal(AssistantStoredCommandSchema.safeParse(request({ "actor.label": { set: "Synthetic Person" } })).success, false);
  const ordinary = request({ "browser.headless": { set: false } });
  assert.equal(ordinary.type, "apply-settings"); if (ordinary.type !== "apply-settings") throw new Error("settings command required");
  const permission = { ...ordinary, payload: { patch: {}, patchFingerprint: deriveRawSettingsPatchFingerprint({}), settingsSchemaHash: SETTINGS_SCHEMA_HASH,
    assistantPermission: { expectedPolicyRevision: 0, mode: "every-action" } } };
  assert.equal(CommandRequestSchema.safeParse(permission).success, true);
  assert.equal(AssistantStoredCommandSchema.safeParse(permission).success, false);
  assert.equal(CommandRequestSchema.safeParse({ ...ordinary, payload: { ...ordinary.payload, assistantPermission: permission.payload.assistantPermission } }).success, false);
  assert.equal(CommandRequestSchema.safeParse({ ...permission, payload: { ...permission.payload, assistantPermission: undefined } }).success, false);
});
