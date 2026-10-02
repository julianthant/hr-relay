import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  DryRunScenarioUnavailableError,
  listDryRunScenarioWorkflows,
  loadDryRunScenarioManifest,
} from "../../../../../src/backend/app/dry-run/manifests.js";
import { runSecureEnvironmentBootstrap } from "../../../../../src/backend/app/bootstrap/secure-env-bootstrap.js";

describe("absent dry-run scenario manifests", () => {
  it("lists no executable manifests and names known unavailable workflows", () => {
    assert.deepEqual(listDryRunScenarioWorkflows(), []);
    for (const workflow of ["person-lookup", "separations", "separations-kuali-finalization"]) {
      assert.throws(() => loadDryRunScenarioManifest(workflow), (error: unknown) =>
        error instanceof DryRunScenarioUnavailableError
        && error.message === `dry-run scenario manifest unavailable for ${workflow}`);
    }
    assert.throws(() => loadDryRunScenarioManifest("unknown-workflow"),
      /unknown dry-run scenario workflow unknown-workflow; registered: $/u);
  });

  it("refuses before installation admission or environment access", async () => {
    let admissionCalls = 0;
    let environmentCalls = 0;
    await assert.rejects(
      runSecureEnvironmentBootstrap(
        ["cli", "dry-run-scenario", "person-lookup", "--subject", "synthetic-subject"],
        {
          acquireAdmission: () => { admissionCalls++; throw new Error("admission reached"); },
          assertEnvironment: () => { environmentCalls++; },
        },
      ),
      DryRunScenarioUnavailableError,
    );
    assert.equal(admissionCalls, 0);
    assert.equal(environmentCalls, 0);
  });
});
