// @vitest-environment jsdom
import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { groupDeploymentFacts,settingsFactLabel } from "../../../../../src/dashboard/surfaces/settings/editor/ui-settings-records-labels.js";
import { fixtureSettingsDocument } from "../../../../support/fixtures/dashboard/fixture-settings.js";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
describe("typed Settings catalog controls", () => {
  it("labels the served deployment facts", () => {
    const document = fixtureSettingsDocument({ annualDates: { FY2027: { jobEndDate: "6/30/2027", kronosDefaultEndDate: "6/30/2027", kronosDefaultStartDate: "7/1/2026" } } }, 2);
    assert.deepEqual(groupDeploymentFacts(document.deployment).map(group => group.label), ["Operator", "Local paths"]);
    assert.equal(settingsFactLabel("paths.stateRoot"), "Runtime state folder");
    assert.equal(settingsFactLabel("urls.ucpath.prod"), "UCPath production routes");
    assert.equal(settingsFactLabel("smartHr"), "SmartHR URL");
  });
});
