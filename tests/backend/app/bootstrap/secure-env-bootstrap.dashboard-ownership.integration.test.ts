import assert from "node:assert/strict";
import { it } from "vitest";
import { runSecureEnvironmentBootstrap } from "../../../../src/backend/app/bootstrap/secure-env-bootstrap.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

for (const accepted of [false, true]) it(`honors the dashboard admission-ownership acknowledgement: ${accepted}`, async () => {
  const profile = await createBoundProfileFixture({ sharedMachine: true });
  const argv = [...process.argv];
  try {
    await runSecureEnvironmentBootstrap(["cli", "dashboard"], {
      acquireAdmission: () => profile.machine,
      assertEnvironment: () => undefined,
      runCli: async (_admission, _worker, accept) => { if (accepted) { assert.ok(accept); accept(); } },
    });
    if (accepted) profile.machine.assertLive();
    else assert.throws(() => profile.machine.assertLive(), { message: "runtime-admission: missing or released admission" });
  } finally { process.argv.splice(0, process.argv.length, ...argv); await profile.close(); }
});
