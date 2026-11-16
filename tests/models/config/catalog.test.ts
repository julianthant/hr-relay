import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { SETTINGS_CATALOG } from "../../../src/models/config/catalog.js";
import { isRetiredSettingsPath, SETTINGS_SCHEMA_HASH } from "../../../src/models/config/settings.js";
import { fixtureSettingsDocument } from "../../support/fixtures/dashboard/fixture-settings.js";
describe("complete Settings catalog projection", () => {
  it("serves the canonical catalog plus exactly one server-selected annual date leaf", () => {
    const document = fixtureSettingsDocument();
    assert.deepEqual(document.catalog.map(row => row.key).sort(), SETTINGS_CATALOG.map(row => row.key).sort());
    const leaves = document.sections.flatMap(section => section.leaves);
    assert.equal(leaves.some(leaf => leaf.path === "paths.duoCredential"), false);
    const expected = SETTINGS_CATALOG.filter(row => row.sourceClass === "ordinary-settings" && !row.key.startsWith("annualDates.") && !isRetiredSettingsPath(row.key)).map(row => row.key);
    assert.deepEqual(leaves.map(leaf => leaf.catalogKey).filter(key => !key.startsWith("annualDates.")).sort(), expected.sort());
    assert.deepEqual(leaves.filter(leaf => leaf.path.startsWith("annualDates.")).map(leaf => leaf.path), [`annualDates.FY${String(document.currentFiscalYear)}.jobEndDate`]);
    assert.deepEqual([...new Set(document.catalog.map(row => row.sourceClass))].sort(), ["derived-host", "ordinary-settings", "protected-store", "runtime-isolation"]);
    assert.equal(document.settingsSchemaHash, SETTINGS_SCHEMA_HASH);
    assert.equal(JSON.stringify(document).includes("currentSource"), false);
    assert.equal(JSON.stringify(document).includes("canary"), false);
  });
});
