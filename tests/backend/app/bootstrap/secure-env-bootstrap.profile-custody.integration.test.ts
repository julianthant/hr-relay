import assert from "node:assert/strict";
import { it } from "vitest";
import { runSecureEnvironmentBootstrap } from "../../../../src/backend/app/bootstrap/secure-env-bootstrap.js";
import { RuntimeCustodyUncertainError } from "../../../../src/backend/app/composition/storage-compose.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

for (const uncertain of [false, true]) it(`bootstrap ${uncertain ? "retains" : "releases"} actual parent custody after ${uncertain ? "unproved closure" : "ordinary refusal"}`, async () => {
  const f = createBoundProfileFixture();
  const cause = new Error("synthetic runtime refusal");
  const failure = uncertain ? new RuntimeCustodyUncertainError([cause]) : cause;
  try {
    await assert.rejects(runSecureEnvironmentBootstrap(["cli", "storage", "doctor"], {
      acquireAdmission: () => f.machine,
      runCli: async admission => { assert.equal(admission, f.machine); throw failure; },
    }), error => error === failure);
    if (uncertain) { f.machine.assertLive(); f.admission.assertLive(); }
    else assert.throws(() => f.machine.assertLive());
  } finally { f.close(); }
});
