import { afterAll } from "vitest";
import { createClonedProfileFixtures } from "../../../support/helpers/admission-fixture.js";
import { createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { testRunService } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { executeClaimedRun, type RunExecutorDependencies } from "../../../../src/backend/runtime/execution/run-executor.js";
import { RUN_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { personLookupQueuedRun } from "../../../support/helpers/phase1f-executor-harness.js";

const profiles = createClonedProfileFixtures();
afterAll(() => profiles.close());
const {executorHarness, enqueueAndClaim, SIGNAL, cleanup } = createRunExecutorTestWorld(profiles.create);

afterEach(cleanup);

describe("cancellation racing failure authorization", () => {
  it("settles cancelled when admission commits after the boundary read but before authorization", async () => {
    const h = await executorHarness();
    const { database, clock } = h.authority;
    const input = RunRecordSchema.parse(personLookupQueuedRun());
    const claimed = enqueueAndClaim(database, { ...input, input: {
      ...input.input, parsed: { protectedBindings: [], schemaHash: "a".repeat(64), value: {} },
    } }, clock.now().toISOString());
    let interleaved = false;
    let validatingReads = 0;
    const deps: RunExecutorDependencies = { ...h.deps, authority: {
      authority: { ...database.authority, runs: { get: (runId) => {
        const current = database.authority.runs.get(runId);
        if (current?.lifecycle.state === "validating") validatingReads++;
        if (!interleaved && validatingReads === 2) {
          assert.ok(current);
          interleaved = true;
          assert.equal(testRunService(database, clock).transition({
            commandId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", runId,
            expectedVersion: current.version,
            lifecycle: { state: "terminal", outcome: "cancelled", endedAt: clock.now().toISOString() },
          }).state, "applied");
        }
        return current;
      } } },
      afterAuthorityCommit: database.afterAuthorityCommit.bind(database),
      withAuthorityTransaction: database.withAuthorityTransaction.bind(database),
    } };
    const outcome = await executeClaimedRun(deps, { ...claimed, signal: SIGNAL });
    assert.equal(interleaved, true);
    assert.equal(outcome.state, "abandoned");
    const settled = database.authority.runs.get(RUN_ID);
    assert.ok(settled?.lifecycle.state === "terminal");
    assert.equal(settled.lifecycle.outcome, "cancelled");
    assert.deepEqual(database.authority.failures.listByRun(RUN_ID), []);
    assert.equal(database.authority.runs.get(RUN_ID)?.completion, undefined);
    assert.deepEqual(h.emitter.events().filter((event) => event.t === "span.ended" && event.kind === "run")
      .map((event) => event.outcome), ["cancelled"]);
  });
});
