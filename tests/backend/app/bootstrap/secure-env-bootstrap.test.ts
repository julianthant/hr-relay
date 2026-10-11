import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { runSecureEnvironmentBootstrap } from "../../../../src/backend/app/bootstrap/secure-env-bootstrap.js";
import {
DryRunScenarioUnavailableError
} from "../../../../src/backend/app/dry-run/manifests.js";

describe("absent dry-run scenario manifests", () => {

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
