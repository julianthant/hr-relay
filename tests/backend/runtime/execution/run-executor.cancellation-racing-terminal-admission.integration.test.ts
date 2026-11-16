import { afterAll } from "vitest";
import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import { createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";
import { testRunService } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { executeClaimedRun, type RunExecutorDependencies } from "../../../../src/backend/runtime/execution/run-executor.js";
import { RUN_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { personLookupQueuedRun } from "../../../support/helpers/phase1f-executor-harness.js";

const profiles = createProfileFixtureSet();
afterAll(() => profiles.close());
const {executorHarness, enqueueAndClaim, SIGNAL, cleanup } = createRunExecutorTestWorld(profiles.create);

afterEach(cleanup);

describe("cancellation racing terminal admission", () => {
  it("settles cancellation after a success request loses its version at service admission", async () => {
    const h = await executorHarness();
    const { database, clock } = h.authority;
    const claimed = enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());
    const lifecycle = h.deps.lifecycle;
    let interleaved = false;
    const deps: RunExecutorDependencies = { ...h.deps, lifecycle: { ...lifecycle,
      terminalize: (...args) => {
        if (!interleaved) {
          interleaved = true;
          const current = database.authority.runs.get(RUN_ID);
          assert.ok(current?.lifecycle.state === "running");
          assert.equal(testRunService(database, clock).transition({
            commandId: "ffffffff-ffff-4fff-8fff-ffffffffffff", runId: RUN_ID,
            expectedVersion: current.version,
            lifecycle: { state: "terminal", outcome: "cancelled", endedAt: clock.now().toISOString() },
          }).state, "applied");
        }
        return lifecycle.terminalize(...args);
      },
    } };
    assert.equal((await executeClaimedRun(deps, { ...claimed, signal: SIGNAL })).state, "abandoned");
    assert.equal(interleaved, true);
    const settled = database.authority.runs.get(RUN_ID);
    assert.ok(settled?.lifecycle.state === "terminal");
    assert.equal(settled.lifecycle.outcome, "cancelled");
    assert.equal(z.object({ kind: z.literal("lifecycle-evidence"), outcome: z.literal("cancelled") }).parse(database.authority.runResults.get(RUN_ID)?.result.value).outcome, "cancelled");
    assert.equal(database.authority.runs.get(RUN_ID)?.completion, undefined);
    assert.deepEqual(h.emitter.events().filter((event) => event.t === "span.ended" && event.kind === "run")
      .map((event) => event.outcome), ["cancelled"]);
  });
});
