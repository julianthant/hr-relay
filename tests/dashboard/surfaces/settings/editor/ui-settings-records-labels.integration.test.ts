// @vitest-environment jsdom
import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { settingsLeaves } from "../../../../../src/dashboard/surfaces/settings/editor/settings-draft-model.js";
import { differingSettingsValues,groupDeploymentFacts,groupSettingsLeaves,settingsFactLabel } from "../../../../../src/dashboard/surfaces/settings/editor/ui-settings-records-labels.js";
import { fixtureSettingsDocument } from "../../../../support/fixtures/dashboard/fixture-settings.js";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
describe("typed Settings catalog controls", () => {
  it("groups related settings and surfaces only distinct served values", () => {
    const document = fixtureSettingsDocument({ annualDates: { FY2027: { jobEndDate: "6/30/2027", kronosDefaultEndDate: "6/30/2027", kronosDefaultStartDate: "7/1/2026" } } }, 2);
    const providerLeaves = document.sections.find(section => section.id === "providers")?.leaves;
    const pathLeaves = document.sections.find(section => section.id === "paths")?.leaves;
    const dateLeaves = document.sections.find(section => section.id === "annual-dates")?.leaves;
    assert.ok(providerLeaves); assert.ok(pathLeaves); assert.ok(dateLeaves);
    assert.deepEqual(groupSettingsLeaves("providers", providerLeaves).map(group => group.label), ["Census geocoding", "Nominatim geocoding"]);
    assert.ok(groupSettingsLeaves("paths", pathLeaves).some(group => group.label === "Reports and documents"));
    assert.deepEqual(groupSettingsLeaves("annual-dates", dateLeaves).map(group => group.label), ["Job end date"]);
    assert.deepEqual(groupDeploymentFacts(document.deployment).map(group => group.label), ["Operator", "Local paths"]);
    assert.equal(settingsFactLabel("paths.stateRoot"), "Runtime state folder");
    assert.equal(settingsFactLabel("urls.ucpath.prod"), "UCPath production routes");
    assert.equal(settingsFactLabel("smartHr"), "SmartHR URL");
    const leaf = settingsLeaves(document).find(candidate => candidate.path === "actor.label"); assert.ok(leaf);
    assert.deepEqual(differingSettingsValues({ ...leaf, settingsValue: "Saved", activeValue: "Running", defaultValue: "Default" }), [
      { label: "Saved", value: "Saved" }, { label: "Active", value: "Running" }, { label: "Default", value: "Default" },
    ]);
    assert.deepEqual(differingSettingsValues({ ...leaf, settingsValue: "Same", activeValue: "Same", defaultValue: "Same" }), []);
    assert.deepEqual(differingSettingsValues({ ...leaf, settingsValue: "Saved", activeValue: "Default", defaultValue: "Default" }), [
      { label: "Saved", value: "Saved" }, { label: "Active and Default", value: "Default" },
    ]);
    assert.deepEqual(differingSettingsValues({ ...leaf, settingsValue: "Saved", activeValue: undefined, defaultValue: undefined }), [
      { label: "Saved", value: "Saved" }, { label: "Active and Default", value: undefined },
    ]);
    assert.deepEqual(differingSettingsValues({ ...leaf, settingsValue: "Saved", activeValue: "Saved", defaultValue: undefined }), [
      { label: "Saved and Active", value: "Saved" }, { label: "Default", value: undefined },
    ]);
  });
});
