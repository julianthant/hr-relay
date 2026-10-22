import { join } from "node:path";
import { createCredentialDoctorWriter } from "../../../support/helpers/credential-doctor-fixtures.js";
import { createCredentialDoctorFixtures } from "../../../support/helpers/credential-doctor-fixtures.js";
import assert from "node:assert/strict";
import { chmodSync } from "node:fs";


import { isDeepStrictEqual } from "node:util";
import { afterEach,describe,it } from "vitest";



import { AuthorityHealthPreflightRunner } from "../../../../src/backend/storage/sqlite/authority-health-runner.js";
import { ProtectedSettingsNameSchema } from "../../../../src/models/config/protected-settings.js";

const COMMAND_ID = "11111111-1111-4111-8111-111111111111";
const WRITE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.reverse()) cleanup();
  cleanups.length = 0;
});

const { fixture, snapshot } = createCredentialDoctorFixtures(cleanups);

const writeCredentials = createCredentialDoctorWriter(COMMAND_ID, WRITE_ID);



describe("credential presence doctor", () => {

  it("reports the same presence facts through authority.health and fails unreadable closed", async () => {
    const f = fixture();
    writeCredentials(f, { timekeeperName: { set: "Protected Doctor Canary" } });
    const runner = new AuthorityHealthPreflightRunner(f.admission,f.options, undefined, f.credentialStore);
    const context = {
      signal: new AbortController().signal,
      timeoutMs: 10_000,
      deadlineMonotonicMs: 10_000,
      redaction: "presence-only" as const,
    };
    const before = snapshot(f.machineRoot), controlBefore = snapshot(join(f.workspace, ".tracker", "control"));
    const observation = await runner.run(context);
    assert.ok(isDeepStrictEqual(snapshot(f.machineRoot), before), "preflight changed source inventory or bytes");
    assert.ok(isDeepStrictEqual(snapshot(join(f.workspace, ".tracker", "control")), controlBefore), "preflight changed control bytes");
    for (const name of ProtectedSettingsNameSchema.options) {
      assert.ok(observation.summary.includes(
        `${name}=${name === "timekeeperName" ? "present" : "absent"}`,
      ));
    }
    assert.equal(observation.summary.includes("Protected Doctor Canary"), false);

    chmodSync(f.credentialPath, 0o644);
    const unavailable = await runner.run(context);
    assert.equal(unavailable.state, "unhealthy");
    assert.ok(unavailable.summary.includes("could not be verified read-only"));
    assert.equal(unavailable.summary.includes(f.root), false);
  });
});
