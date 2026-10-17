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
        ["cli", "dry-run-scenario", "separations", "--subject", "synthetic-subject"],
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

it("takes exclusive admission before an orphan retirement storage command", async () => {
  let mode: string | undefined;
  await assert.rejects(runSecureEnvironmentBootstrap(["cli", "storage", "retire-orphan-verification", "--acquisition", "11111111-1111-4111-8111-111111111111", "--plan"], {
    acquireAdmission: selected => { mode = selected; throw new Error("fixture admission stop"); },
    assertEnvironment: () => { throw new Error("environment must not be read"); },
  }), /fixture admission stop/u);
  assert.equal(mode, "exclusive");
});
