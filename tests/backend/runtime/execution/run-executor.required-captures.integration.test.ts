import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";
import { executeClaimedRun } from "../../../../src/backend/runtime/execution/run-executor.js";
import { defineTask } from "../../../../src/workflow-kit/task.js";
import { ucpathDriver } from "../../../../src/backend/systems/ucpath/driver-declaration.js";
import { CrmDiscoveryOutputSchema } from "../../../../src/models/systems/crm/search-onboarding-records.js";
import { SearchPersonOrg } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { createRunExecutorTestWorld, registryWithUcpathSearch } from "../../../support/helpers/backend/run-executor-world.js";
import { healthyCrmDriver, healthyUcpathDriver, personLookupQueuedRun, sessionFactoryHarness } from "../../../support/helpers/phase1f-executor-harness.js";

const { executorHarness, enqueueAndClaim, SIGNAL, cleanup } = createRunExecutorTestWorld();
afterEach(async () => { vi.restoreAllMocks(); await cleanup(); });

describe("required browser task captures", () => {
  for (const placement of ["finish", "task", "swallowed-failure"] as const) it(`enforces ${placement} capture before a task checkpoint`, async () => {
    const task = defineTask(ucpathDriver, SearchPersonOrg, {
      screenshots: "task",
      sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }],
      async run({ input, ctx }) {
        const output = await ctx.driver.searchPersonOrg(input);
        if (placement === "task") await ctx.captureScreenshot();
        if (placement === "swallowed-failure") {
          try { await ctx.captureScreenshot(); } catch { /* Exercise a swallowed capture failure. */ }
        }
        ctx.recordData(Object.entries(output).map(([field, value]) => ({ direction: "read" as const, field, value })));
        return output;
      },
    });
    const h = await executorHarness({ stores: registryWithUcpathSearch(task) });
    const claimed = enqueueAndClaim(h.authority.database, personLookupQueuedRun(), h.authority.clock.now().toISOString());
    let captures = 0;
    const original = h.manager.withDriver.bind(h.manager);
    const withDriver: typeof h.manager.withDriver = (need, instance, signal, operation, owner) => original(need, instance, signal,
      (driver, capture) => operation(driver, async () => {
        if (owner?.nodeId === "searching") {
          captures += 1;
          assert.equal(owner.attempt, claimed.run.envelope.attempt);
          if (placement === "swallowed-failure") throw new Error("synthetic required capture failed");
        }
        await capture();
      }), owner);
    vi.spyOn(h.manager, "withDriver").mockImplementation(withDriver);
    const outcome = await executeClaimedRun(h.deps, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, placement === "swallowed-failure" ? "failed" : "done");
    assert.equal(captures, 1);
    const checkpoint = h.authority.database.authority.runCheckpoints.latest("person-lookup", claimed.run.envelope.itemId, "searching");
    assert.equal(checkpoint === undefined, placement === "swallowed-failure");
  });

  for (const failed of [false, true]) it(`captures CRM discovery and selected record when check-failed=${failed}`, async () => {
    const crm = healthyCrmDriver();
    const sessions = sessionFactoryHarness({ ucpath: () => healthyUcpathDriver(), crm: () => ({ ...crm,
      verifyOnboardingRecord: failed ? async () => { throw new Error("synthetic CRM check unavailable"); } : crm.verifyOnboardingRecord,
    }) });
    const h = await executorHarness({ sessions });
    const claimed = enqueueAndClaim(h.authority.database, personLookupQueuedRun(), h.authority.clock.now().toISOString());
    const captures: string[] = [];
    const original = h.manager.withDriver.bind(h.manager);
    const withDriver: typeof h.manager.withDriver = (need, instance, signal, operation, owner) => original(need, instance, signal,
      (driver, capture) => operation(driver, async () => { if (owner !== undefined) captures.push(owner.nodeId); await capture(); }), owner);
    vi.spyOn(h.manager, "withDriver").mockImplementation(withDriver);
    const outcome = await executeClaimedRun(h.deps, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "done");
    assert.equal(captures.filter(node => node === "cross-verify").length, 1);
    assert.equal(captures.filter(node => node === "crm-selected-record").length, 1);
    const checkpoint = h.authority.database.authority.runCheckpoints.latest("person-lookup", claimed.run.envelope.itemId, "crm-selected-record");
    assert.ok(checkpoint);
    assert.equal(CrmDiscoveryOutputSchema.parse(checkpoint.output.value).state, failed ? "check-failed" : "checked");
  });
});
