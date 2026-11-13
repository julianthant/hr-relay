import assert from "node:assert/strict";
import { afterAll, afterEach, describe, it } from "vitest";
import { createOnboardingRunWorld } from "../../../support/helpers/backend/onboarding-run-world.js";
import { testRunService } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { readRunDetail } from "../../../../src/backend/runs/queries/run-detail.js";
import { createOperatorProjection, createOperatorRunDetail } from "../../../../src/backend/app/composition/dashboard/operator.js";
import { createTransactionHistory } from "../../../../src/backend/storage/sqlite/transaction-history.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { SearchPersonMatchOutputSchema } from "../../../../src/models/systems/ucpath/search-person-match.js";
import { compileWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";
import { onboardingWorkflow } from "../../../../src/workflows/onboarding/workflow.js";

const descriptor = compileWorkflow(onboardingWorkflow).descriptor;

describe("the run-detail route at Onboarding's hire review", () => {
  const runWorld = createOnboardingRunWorld();
  afterAll(runWorld.close);
  afterEach(runWorld.cleanup);

  it("serves a new hire whose every UCPath hit is dropped under another name with its decision packet and name parts", async () => {
    const dropped = ["10800001", "10800002", "10800003"].map(emplId => ({ emplId, name: "Other, Person" }));
    const personMatch = SearchPersonMatchOutputSchema.parse({ hits: dropped, confirmed: [], dropped: dropped.map(hit => ({ ...hit, reason: "Last name does not match" })) });
    const f = await runWorld.executionFixture(false, { match: "unique", dryRun: true, legalName: "Fixture  Marie Hire", livedName: "Fix Hire", personMatch }), root = f.start();
    const parked = await f.rawExecution.execute(root, new AbortController().signal);
    assert.ok(parked.run?.lifecycle.state === "parked-gate" && parked.run.lifecycle.gateId === "hire-review");
    const reader = testRunService(f.database, f.clock);
    const descriptors = { resolve: (id: string) => id === descriptor.id ? descriptor : undefined };
    const projection = createOperatorProjection({ database: f.database, stateRoot: f.stateRoot, clock: f.clock, reader, appVersion: "0.1.0",
      descriptorSetHash: FingerprintSchema.parse("a".repeat(64)), ledger: createTransactionHistory(f.database.authority), descriptors });
    projection.ingestFromTimeline();
    const detail = await readRunDetail(createOperatorRunDetail({ database: f.database, stateRoot: f.stateRoot, projection, runReader: reader,
      canonical: { database: f.database, reader, descriptors } }), root.envelope.runId);
    assert.ok(detail.gate.state === "open" && detail.gate.decision !== undefined, "the served gate carries its decision packet");
    assert.equal(detail.gate.nodeId, "hire-review");
    assert.deepEqual(detail.gate.decision.options.map(option => [option.id, option.label, option.hint]),
      [["new-hire", "File as a new hire", "None of the 3 UCPath matches is this person. Relay creates a new person."]]);
    assert.equal(detail.gate.decision.context, "Legal name: first Fixture, middle Marie, last Hire. Preferred name: first Fix, no middle name, last Hire. "
      + "UCPath returned 3 possible matches and Relay confirmed none. Searched by name and date of birth. "
      + "Under another name: Other, Person (••••0001): Last name does not match; Other, Person (••••0002): Last name does not match; Other, Person (••••0003): Last name does not match. "
      + "Relay cannot file a hire under another name. If one of them is this person, cancel this run and file the rehire by hand in UCPath.");
    // The dashboard draws the packet on the gate's own blocked timeline line.
    assert.deepEqual(detail.timeline.events.filter(event => event.native?.nodeId === "hire-review").map(event => [event.label, event.state]), [["gate:hire-review", "blocked"]]);
  });
});
