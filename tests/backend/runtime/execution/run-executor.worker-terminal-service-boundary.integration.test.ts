import { afterAll } from "vitest";
import { createClonedProfileFixtures } from "../../../support/helpers/admission-fixture.js";
import { createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";
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


describe("worker terminal service boundary", () => {
  it("honours an admitted cancellation before the next non-fenced operation", async () => {
    const h = await executorHarness();
    const { database, clock } = h.authority;
    const claimed = enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());
    assert.equal(testRunService(database, clock).transition({
      commandId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", runId: RUN_ID,
      expectedVersion: claimed.run.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: clock.now().toISOString() },
    }).state, "applied");
    const outcome = await executeClaimedRun(h.deps, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "abandoned");
    const settled = database.authority.runs.get(RUN_ID);
    assert.ok(settled?.lifecycle.state === "terminal");
    assert.equal(settled.lifecycle.outcome, "cancelled");
    assert.equal(h.sessions.opens("ucpath"), 0);
    assert.equal(h.emitter.events().filter((event) => event.t === "span.ended" && event.kind === "run"
      && event.outcome === "cancelled").length, 1);
  });

  for (const failure of ["refusal", "outer-rollback"] as const) {
    it(`never publishes run end after terminal ${failure}`, async () => {
      const h = await executorHarness();
      const { database, clock } = h.authority;
      const claimed = enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());
      const lifecycle = h.deps.lifecycle;
      const deps: RunExecutorDependencies = { ...h.deps, lifecycle: { ...lifecycle,
        terminalize: (...args) => database.withAuthorityTransaction(() => {
          if (failure === "refusal") return { state: "refused", refusal: { reason: "lost" } };
          const result = lifecycle.terminalize(...args);
          assert.equal(result.state, "applied");
          assert.equal(h.emitter.events().filter((event) => event.t === "span.ended" && event.kind === "run").length, 1, "state and event coexist inside the uncommitted transaction");
          throw new Error("outer terminal rollback");
        }),
      } };
      if (failure === "refusal") assert.equal((await executeClaimedRun(deps, { ...claimed, signal: SIGNAL })).state, "abandoned");
      else await assert.rejects(executeClaimedRun(deps, { ...claimed, signal: SIGNAL }), /outer terminal rollback/);
      assert.equal(database.authority.runs.get(RUN_ID)?.lifecycle.state, "running");
      assert.equal(database.authority.runResults.get(RUN_ID), undefined);
      assert.equal(database.authority.runs.get(RUN_ID)?.completion, undefined);
      assert.deepEqual(database.authority.failures.listByRun(RUN_ID), []);
      assert.equal(h.emitter.events().filter((event) => event.t === "span.ended" && event.kind === "run").length, 0);
    });
  }
});
