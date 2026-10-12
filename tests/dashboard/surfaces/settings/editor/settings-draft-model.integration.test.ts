// @vitest-environment jsdom
import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { draftError,patchFromSettingsDraft,settingsLeaves } from "../../../../../src/dashboard/surfaces/settings/editor/settings-draft-model.js";
import { mergeSettingsPatch } from "../../../../../src/models/config/settings.js";
import { fixtureSettingsDocument } from "../../../../support/fixtures/dashboard/fixture-settings.js";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
describe("typed Settings catalog controls", () => {
  it("preserves text, zero/nonzero integers, booleans, routes and provider timeouts", () => {
    const document = fixtureSettingsDocument(); const leaves = settingsLeaves(document);
    for (const [path, raw, value] of [
      ["actor.label", "New label", "New label"], ["ocr.pageConcurrency", "0", 0], ["timeouts.taskMs", "42", 42_000], ["browser.headless", "false", false],
      ["paths.downloadsDir", "/tmp/new-downloads", "/tmp/new-downloads"], ["urls.kuali.prod", { entry: "https://test.example/entry" }, { entry: "https://test.example/entry" }],
      ["providers.geocodeCensus", { timeoutMs: "100" }, { timeoutMs: 100 }],
    ] as const) {
      assert.deepEqual(patchFromSettingsDraft(leaves, { [path]: { kind: "set", raw } }), { [path]: { set: value } });
    }
    for (const [path, raw] of [["ocr.pageConcurrency", ""], ["ocr.pageConcurrency", "1.5"], ["timeouts.taskMs", "0"], ["paths.downloadsDir", "relative"], ["urls.kuali.prod", { entry: "not a URL" }]] as const) {
      const leaf = leaves.find(candidate => candidate.path === path); assert.ok(leaf);
      assert.ok(draftError(leaf, { kind: "set", raw }));
    }
  });
  it("binds one required job-end-date leaf to the current fiscal year and preserves older values", () => {
    const document = fixtureSettingsDocument();
    const year = `FY${String(document.currentFiscalYear)}`;
    const path = `annualDates.${year}.jobEndDate`;
    const leaves = settingsLeaves(document).filter(leaf => leaf.path.startsWith("annualDates."));
    assert.deepEqual(leaves.map(leaf => leaf.path), [path]);
    const patch = patchFromSettingsDraft(leaves, { [path]: { kind: "set", raw: "6/30/2027" } });
    assert.deepEqual(mergeSettingsPatch({ annualDates: { FY2024: { jobEndDate: "6/30/2024" } } }, patch), {
      annualDates: { FY2024: { jobEndDate: "6/30/2024" }, [year]: { jobEndDate: "6/30/2027" } },
    });
    assert.throws(() => mergeSettingsPatch({}, { [path]: { set: "not a date" } }));
    assert.ok(draftError(leaves[0], { kind: "set", raw: "13/1/2027" }));
  });
});
