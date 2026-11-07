import assert from "node:assert/strict";
import { describe,it } from "vitest";
import {
DryRunScenarioUnavailableError,
listDryRunScenarioWorkflows,
loadDryRunScenarioManifest,
} from "../../../../src/backend/app/dry-run/manifests.js";

describe("registered dry-run scenario manifests", () => {
  it("lists no manifests and names known unavailable workflows", () => {
    assert.deepEqual(listDryRunScenarioWorkflows(), []);
    for (const workflow of ["person-lookup", "separations", "separations-kuali-finalization"]) {
      assert.throws(() => loadDryRunScenarioManifest(workflow), (error: unknown) =>
        error instanceof DryRunScenarioUnavailableError
        && error.message === `dry-run scenario manifest unavailable for ${workflow}`);
    }
    assert.throws(() => loadDryRunScenarioManifest("unknown-workflow"),
      /unknown dry-run scenario workflow unknown-workflow; registered: $/u);
  });
});
