import { afterAll } from "vitest";
import { createClonedProfileFixtures } from "../../../support/helpers/admission-fixture.js";
import { createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { executeClaimedRun } from "../../../../src/backend/runtime/execution/run-executor.js";
import { PersonLookupResultSchema } from "../../../../src/workflows/person-lookup/workflow.js";
import { RUN_ID, WORKFLOW_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { personLookupQueuedRun } from "../../../support/helpers/phase1f-executor-harness.js";

const profiles = createClonedProfileFixtures();
afterAll(() => profiles.close());
const {executorHarness, enqueueAndClaim, SIGNAL, cleanup } = createRunExecutorTestWorld(profiles.create);

afterEach(cleanup);

describe("person-lookup full walk", () => {

  it("includes crm-dates when the operator asked for it", async () => {
    const harness = await executorHarness();
    const { database, clock } = harness.authority;
    const claimed = enqueueAndClaim(
      database,
      personLookupQueuedRun({ includeCrmDates: true }),
      clock.now().toISOString(),
    );

    const outcome = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "done");

    const result = database.authority.runResults.get(RUN_ID);
    assert.ok(result);
    const crmDates = result.dependencies.find((dependency) => dependency.nodeId === "crm-dates");
    assert.ok(crmDates?.state === "resolved");
    const value = PersonLookupResultSchema.parse(result.result.value);
    assert.equal(value.crmDates.state, "included");
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run);
    assert.ok(database.authority.runCheckpoints.latest(WORKFLOW_ID, run.envelope.itemId, "crm-dates"));
  });
});
