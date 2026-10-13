import assert from "node:assert/strict";
import { describe,it } from "vitest";
import {
DryRunScenarioUnavailableError,
listDryRunScenarioWorkflows,
loadDryRunScenarioManifest,
} from "../../../../src/backend/app/dry-run/manifests.js";

describe("absent dry-run scenario manifests", () => {
  it("lists no executable manifests and names known unavailable workflows", () => {
    assert.deepEqual(listDryRunScenarioWorkflows(), ["person-lookup"]);
    for (const workflow of ["separations", "separations-kuali-finalization"]) {
      assert.throws(() => loadDryRunScenarioManifest(workflow), (error: unknown) =>
        error instanceof DryRunScenarioUnavailableError
        && error.message === `dry-run scenario manifest unavailable for ${workflow}`);
    }
    assert.throws(() => loadDryRunScenarioManifest("unknown-workflow"),
      /unknown dry-run scenario workflow unknown-workflow; registered: person-lookup$/u);
  });
});
