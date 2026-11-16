import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { initialProtectedStoreRecord, markProtectedSettingsPatch, ProtectedSettingsNameSchema, ProtectedSettingsPatchSchema,
  ProtectedSettingsReadbackSchema, ProtectedSettingsReceiptEntriesSchema } from "../../../src/models/config/protected-settings.js";

describe("current protected settings and retained receipts", () => {
  it("exposes exactly three editable credentials and refuses retired setting writes", () => {
    assert.deepEqual(ProtectedSettingsNameSchema.options, ["ucpathUserId", "ucpathPassword", "sharepointOnboardingRosterUrl"]);
    assert.equal(initialProtectedStoreRecord().schemaVersion, 2);
    for (const name of ["timekeeperName", "activityPersonPseudonym"]) {
      assert.equal(ProtectedSettingsPatchSchema.safeParse({ [name]: { clear: true } }).success, false);
      assert.throws(() => markProtectedSettingsPatch({ [name]: { set: "<set>" } }));
    }
  });

  it("preserves exact value-free historical receipt membership without allowing it in a fresh readback", () => {
    const current = { ucpathUserId: { present: false }, ucpathPassword: { present: false }, sharepointOnboardingRosterUrl: { present: false } };
    const historical = { ...current, timekeeperName: { present: true, valueId: "10000000-0000-4000-8000-000000000001", updatedAt: "2026-11-04T00:00:00.000Z" }, activityPersonPseudonym: { present: false } };
    assert.deepEqual(ProtectedSettingsReceiptEntriesSchema.parse(current), current);
    assert.deepEqual(ProtectedSettingsReceiptEntriesSchema.parse(historical), historical);
    assert.equal(ProtectedSettingsReadbackSchema.safeParse({ revision: 2, entries: historical }).success, false);
    assert.equal(ProtectedSettingsReceiptEntriesSchema.safeParse({ ...current, timekeeperName: historical.timekeeperName }).success, false);
    assert.equal(ProtectedSettingsReceiptEntriesSchema.safeParse({ ...historical, unexpected: { present: false } }).success, false);
    assert.equal(ProtectedSettingsReceiptEntriesSchema.safeParse({ ...historical, timekeeperName: { ...historical.timekeeperName, value: "Private signer" } }).success, false);
  });
});
