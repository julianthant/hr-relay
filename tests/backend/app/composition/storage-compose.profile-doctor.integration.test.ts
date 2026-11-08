import assert from "node:assert/strict";
import { it } from "vitest";
import { z } from "zod";
import { composeStorageCommand } from "../../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

it("runs storage doctor --json from the machine admission against each ready person's store", async () => {
  const profile = await createBoundProfileFixture({ sharedMachine: true });
  try {
    const doctor = await composeStorageCommand(rebuildRuntimeIsolation, ["doctor", "--json"], systemClock, profile.workspace, profile.machine);
    const report = z.object({ profiles: z.array(z.object({ profileId: z.string(), report: z.object({ authority: z.object({ state: z.string() }) }) })) })
      .parse(JSON.parse(doctor.output));
    assert.deepEqual(report.profiles.map(entry => entry.profileId), [profile.admission.profileBinding.profileId]);
    assert.equal(doctor.exitCode, 0, doctor.output);
    profile.machine.assertLive(); profile.admission.assertLive();
  } finally { await profile.close(); }
});
