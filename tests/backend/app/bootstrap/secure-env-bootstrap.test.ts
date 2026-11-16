import assert from "node:assert/strict";
import { it } from "vitest";
import { runSecureEnvironmentBootstrap } from "../../../../src/backend/app/bootstrap/secure-env-bootstrap.js";
it("takes exclusive admission before a storage maintenance command", async () => {
  let mode: string | undefined;
  await assert.rejects(runSecureEnvironmentBootstrap(["cli", "storage", "upgrade"], {
    acquireAdmission: selected => { mode = selected; throw new Error("fixture admission stop"); },
    assertEnvironment: () => { throw new Error("environment must not be read"); },
  }), /fixture admission stop/u);
  assert.equal(mode, "exclusive");
});
