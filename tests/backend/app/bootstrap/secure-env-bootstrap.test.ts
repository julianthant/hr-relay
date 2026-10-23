import assert from "node:assert/strict";
import { it } from "vitest";
import { runSecureEnvironmentBootstrap } from "../../../../src/backend/app/bootstrap/secure-env-bootstrap.js";
it("takes exclusive admission before an orphan retirement storage command", async () => {
  let mode: string | undefined;
  await assert.rejects(runSecureEnvironmentBootstrap(["cli", "storage", "retire-orphan-verification", "--acquisition", "11111111-1111-4111-8111-111111111111", "--plan"], {
    acquireAdmission: selected => { mode = selected; throw new Error("fixture admission stop"); },
    assertEnvironment: () => { throw new Error("environment must not be read"); },
  }), /fixture admission stop/u);
  assert.equal(mode, "exclusive");
});
