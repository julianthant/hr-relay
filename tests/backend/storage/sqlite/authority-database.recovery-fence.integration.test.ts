import { fenceWriteFixture } from "../../../support/helpers/write-fence-fixture.js";
import { releaseSeededWriteOwners } from "../../../support/helpers/timeline-write-fixture.js";
import { deriveWriteAuthorityReason } from "../../../../src/rules/write-safety/write-authority-reason.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";
import { WRITE_FIXTURE_KEY, writeFixtureDescriptor } from "../../../support/fixtures/write-sequencer-fixtures.js";

describe("crash recovery routes probe-first with evidence-qualified settlement", () => {
  async function recoveryWorld() {
    const clock = manualClock(new Date("2026-08-03T09:00:00.000Z"));
    const profile = await createBoundProfileFixture();
    const database = AuthorityDatabase.open(
      { path: profile.path, busyTimeoutMs: 250, migrationOwner: "write-safety-guard" },
      clock,
    );
    testWorkerPorts(database, clock, { path: profile.path, descriptor: writeFixtureDescriptor, poolIndex: 1 });
    return {
      clock, database,
      dispose: async () => {
        const now = clock.now().toISOString();
        const authorityReason = deriveWriteAuthorityReason("recovery-probe-unknown", "probe", "fixture release");
        for (const run of database.authority.runs.listByWorkflow(writeFixtureDescriptor.id)) {
          for (const intent of database.authority.writeIntents.listByRun(run.envelope.runId)) {
            if (intent.status !== "attempting") continue;
            database.authority.writeIntents.parkAttempt({
              writeIntentId: intent.writeIntentId, generation: intent.generation, expectedVersion: intent.version,
              code: "unknown", message: "fixture release", authorityReason, now,
            });
          }
        }
        releaseSeededWriteOwners(database, now);
        database.close();
        await profile.close();
      },
    };
  }

  it("blocks a second fence for a permanent key in every non-retryable state", async () => {
    const { parkedAttemptingWriteFixture, foreignAttemptingIntent } = await import("./authority-database.recovery-fence-fixtures.js");
    const w = await recoveryWorld();
    parkedAttemptingWriteFixture(w.database, w.clock);
    const second = foreignAttemptingIntent("55555555-5555-4555-8555-555555555555", "66666666-6666-4666-8666-666666666666");
    const resolution = fenceWriteFixture(w.database, second);
    assert.equal(resolution.state, "existing", "the permanent primary key is the same-key mutex");
    if (resolution.state === "existing") {
      assert.equal(resolution.intent.idempotencyKey, WRITE_FIXTURE_KEY);
    }
    await w.dispose();
  });
});
