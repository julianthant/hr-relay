
import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { createStartPlanService } from "../../../../src/backend/runs/commands/start-plan-service.js";
import { StartStepOmissionRefusedError } from "../../../../src/backend/runs/start/step-selection.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import type { AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { CONFIG_SNAPSHOT,NOW,UUID_4 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import {
omissionAssertingDescriptor,
omissionCascadingDescriptor,
} from "../../../support/fixtures/start-step-omission-fixtures.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { createBoundProfileFixture, boundProfileCredentials } from "../../../support/helpers/admission-fixture.js";
import { separationsDescriptor } from "../../../support/helpers/registered-workflows.js";
import { protectedSecretSource } from "../../../support/helpers/protected-secret-source.js";
import { RerunRefusedError } from "../../../../src/backend/runs/start/rerun.js";

const CLOCK = manualClock(new Date(NOW));
// Use a different fact EID; repeating the submitted title would make the wire-leak assertion vacuous.
const READING_FACTS = { eid: "20111222", effectiveDate: "01/02/2026" };
const profiles: Awaited<ReturnType<typeof createBoundProfileFixture>>[] = [];
const databases: AuthorityDatabase[] = [];

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  for (const profile of profiles.splice(0)) await profile.close();
});

async function harnessFor(descriptor: AnyWorkflowDescriptor, recovery?: "restart-from-start", initialize = true) {
  const profile = await createBoundProfileFixture(); profiles.push(profile);
  const database = AuthorityDatabase.open(profile.admission,
    { path: profile.path, busyTimeoutMs: 250, migrationOwner: "unit-test" }, CLOCK,
    undefined, undefined, undefined, boundProfileCredentials(profile.admission));
  databases.push(database);
  if (initialize) database.authority.runtimeConfig.initialize({ ...CONFIG_SNAPSHOT, configSnapshotId: UUID_4 });
  const ids = sequentialIdFactory("b");
  let transactions = 0;
  const service = createStartPlanService({
    ...(recovery === undefined ? {} : { recovery }),
    // The ONE door a plan row can be written through: counting it is what
    // makes "nothing durable happened" a measurement rather than a claim.
    authority: {
      withAuthorityTransaction: (work) => {
        transactions += 1;
        return database.withAuthorityTransaction(work);
      },
    },
    authorityRead: database,
    descriptors: {
      resolve: (workflowId) => (workflowId === String(descriptor.id) ? descriptor : undefined),
    },
    clock: CLOCK,
    ids,
    planTtlMs: 10 * 60 * 1000,
    configFingerprint: CONFIG_SNAPSHOT.fingerprint,
    configSnapshotId: UUID_4,
    plannedBy: "local-operator",
    protectedSecrets: protectedSecretSource({ timekeeperName: "Synthetic Timekeeper" }),
  });
  return { database, service, ids, transactions: () => transactions, descriptor };
}

function request(descriptor: AnyWorkflowDescriptor, overrides: Record<string, unknown>) {
  return {
    workflowId: String(descriptor.id),
    submissions: [{ eid: "10873698" }],
    dryRun: false,
    ...overrides,
  };
}

function refusal(run: () => unknown): StartStepOmissionRefusedError {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof StartStepOmissionRefusedError, `threw ${String(error)}`);
    return error;
  }
  return assert.fail("the plan was accepted");
}

it("keeps document-number starts available while restricting an entered EID to its failure action", async () => {
  const h = await harnessFor(separationsDescriptor);
  const input = { workflowId: "separations", submissions: [{ documentNumber: "4502" }], dryRun: true,
    selectedStepKeys: separationsDescriptor.timeline.map(step => step.key) };
  const wire = h.service.plan(input);
  assert.equal(wire.refused.length, 0);
  assert.equal(wire.planned.length, 1);
  assert.equal(wire.planned[0]?.matchKey, "separations:4502");
  assert.throws(() => h.service.plan({ ...input, submissions: [{ documentNumber: "4502", operatorEmployeeId: "10800001" }] }),
    (error: unknown) => error instanceof RerunRefusedError && error.code === "invalid-value");
});

describe("start plan recovery", () => {
  it.each([undefined, "restart-from-start"] as const)("retains trusted recovery=%s without exposing public ingress", async recovery => {
    const harness = await harnessFor(omissionAssertingDescriptor, recovery);
    const input = request(omissionAssertingDescriptor, {});
    const wire = harness.service.plan(input);
    assert.equal(harness.database.authority.startPlans.get(wire.startPlanId)?.recovery, recovery);
    assert.equal("recovery" in wire, false);
    assert.throws(() => harness.service.plan({ ...input, recovery: "restart-from-start" }));
  });
});

describe("start plan step omissions", () => {
  it("carries the reconciled omissions onto the served wire and the durable plan record", async () => {
    const harness = await harnessFor(omissionAssertingDescriptor);
    const wire = harness.service.plan(request(omissionAssertingDescriptor, {
      selectedStepKeys: ["folding", "auditing"],
      stepOmissions: [{ step: "reading", facts: READING_FACTS }],
    }));


    assert.deepEqual(wire.omittedSteps, ["reading"]);
    assert.equal(JSON.stringify(wire).includes(READING_FACTS.eid), false);
    assert.equal(JSON.stringify(wire).includes(READING_FACTS.effectiveDate), false);
    assert.equal(harness.transactions(), 1);
    // The wire is a projection; the RECORD is what a `start-run` command
    // consumes, so the omissions have to be durable there too.
    const stored = harness.database.authority.startPlans.get(wire.startPlanId);
    assert.deepEqual(stored?.stepOmissions, [{ step: "reading", facts: READING_FACTS }]);
    assert.equal(stored?.planned.length, 1);
  });

  it("omits the field entirely when every omittable step is selected to run", async () => {
    const harness = await harnessFor(omissionAssertingDescriptor);
    const wire = harness.service.plan(request(omissionAssertingDescriptor, {
      selectedStepKeys: ["reading", "folding", "auditing"],
    }));
    assert.equal(wire.omittedSteps, undefined);
    assert.equal(harness.database.authority.startPlans.get(wire.startPlanId)?.stepOmissions, undefined);
  });

  it("refuses invalid facts before a plan row, a run identity or a transaction exists", async () => {
    const harness = await harnessFor(omissionAssertingDescriptor);
    const error = refusal(() => harness.service.plan(request(omissionAssertingDescriptor, {
      selectedStepKeys: ["folding", "auditing"],
      stepOmissions: [{ step: "reading", facts: { eid: "20111222", effectiveDate: "2026-01-02" } }],
    })));

    assert.equal(error.code, "facts-invalid");
    assert.equal(harness.transactions(), 0);
    assert.deepEqual(harness.ids.minted(), []);
    // Positive control: the same service, the same database, a valid request —
    // so the two assertions above are measuring a real door, not a dead one.
    const wire = harness.service.plan(request(omissionAssertingDescriptor, {
      selectedStepKeys: ["folding", "auditing"],
      stepOmissions: [{ step: "reading", facts: READING_FACTS }],
    }));
    assert.equal(harness.transactions(), 1);
    assert.ok(harness.ids.minted().length > 0);
    assert.ok(harness.database.authority.startPlans.get(wire.startPlanId) !== undefined);
  });

  it("refuses omissions submitted with no explicit step selection", async () => {
    const harness = await harnessFor(omissionAssertingDescriptor);
    const error = refusal(() => harness.service.plan(request(omissionAssertingDescriptor, {
      stepOmissions: [{ step: "reading", facts: READING_FACTS }],
    })));
    assert.equal(error.code, "selection-required");
    assert.equal(harness.transactions(), 0);
  });

  it("refuses typed facts for a plan that carries more than one subject", async () => {
    const harness = await harnessFor(omissionAssertingDescriptor);
    const error = refusal(() => harness.service.plan(request(omissionAssertingDescriptor, {
      submissions: [{ eid: "10873698" }, { eid: "10101010" }],
      selectedStepKeys: ["folding", "auditing"],
      stepOmissions: [{ step: "reading", facts: READING_FACTS }],
    })));
    assert.equal(error.code, "single-subject-only");
    assert.equal(harness.transactions(), 0);
  });

  it("refuses an omitted step whose facts never arrived", async () => {
    const harness = await harnessFor(omissionAssertingDescriptor);
    const error = refusal(() => harness.service.plan(request(omissionAssertingDescriptor, {
      selectedStepKeys: ["folding", "auditing"],
    })));
    assert.equal(error.code, "facts-missing");
    assert.equal(harness.transactions(), 0);
  });

  it("refuses a selection that keeps a step the omission leaves unable to read", async () => {
    const harness = await harnessFor(omissionCascadingDescriptor);
    const error = refusal(() => harness.service.plan(request(omissionCascadingDescriptor, {
      selectedStepKeys: ["folding", "auditing"],
      stepOmissions: [{ step: "reading", facts: READING_FACTS }],
    })));
    assert.equal(error.code, "cascade-refused");
    assert.equal(harness.transactions(), 0);

    // The same run, with the forced step travelling too, plans.
    const wire = harness.service.plan(request(omissionCascadingDescriptor, {
      selectedStepKeys: ["auditing"],
      stepOmissions: [
        { step: "reading", facts: READING_FACTS },
        { step: "folding", facts: { folded: "typed" } },
      ],
    }));
    assert.deepEqual(wire.omittedSteps, ["reading", "folding"]);
    assert.deepEqual(
      harness.database.authority.startPlans.get(wire.startPlanId)?.stepOmissions,
      [{ step: "reading", facts: READING_FACTS }, { step: "folding", facts: { folded: "typed" } }],
    );
  });
});


it("plan service selects the active snapshot inside its write boundary after boot", async () => {
 const h = await harnessFor(omissionAssertingDescriptor);
 const nextId = "83000000-0000-4000-8000-000000000097";
 const config = { ...CONFIG_SNAPSHOT.config, timeouts: { ...CONFIG_SNAPSHOT.config.timeouts, taskMs: 90_000 } };
 const fingerprint = sha256Hex(canonicalJsonStringify(config));
 h.database.authority.configSnapshots.insert({ ...CONFIG_SNAPSHOT, configSnapshotId: nextId, fingerprint, config });
 const active = h.database.authority.runtimeConfig.get();
 assert.ok(active);
 h.database.authority.runtimeConfig.activate({ settingsRevision: active.settingsRevision, settingsFingerprint: active.settingsFingerprint,
  configSnapshotId: nextId, configFingerprint: fingerprint, activatedAt: NOW });
 const wire = h.service.plan(request(h.descriptor, {}));
 assert.equal(wire.configSnapshotId, nextId);
 assert.equal(wire.fingerprints.configFingerprint, fingerprint);
 assert.equal(h.database.authority.startPlans.get(wire.startPlanId)?.configSnapshotId, nextId);
 assert.equal(h.database.authority.configSnapshots.get(UUID_4)?.fingerprint, CONFIG_SNAPSHOT.fingerprint);
});


describe("start plans have no worker choice", () => {
  it("omits workers from the stored plan and response", async () => {
    const h = await harnessFor(omissionAssertingDescriptor);
    const wire = h.service.plan(request(h.descriptor, {}));
    assert.equal(Object.hasOwn(wire, "workers"), false);
    assert.equal(Object.hasOwn(h.database.authority.startPlans.get(wire.startPlanId) ?? {}, "workers"), false);
    assert.equal(h.database.authority.workerSlots.list().length, 0);
  });
  it.each(["auto", 1, 8, 0, 9, 1.5, "1", null])("rejects removed workers %s before writing a plan", async workers => {
    const h = await harnessFor(omissionAssertingDescriptor);
    assert.throws(() => h.service.plan(request(h.descriptor, { workers })));
    assert.equal(h.transactions(), 0);
    assert.deepEqual(h.ids.minted(), []);
  });
});


it("refuses a genuinely never-initialized Settings snapshot before any plan or lifecycle identity is persisted", async () => {
  const h = await harnessFor(omissionAssertingDescriptor, undefined, false);
  const generation = h.database.getMeta().authorityGeneration;
  assert.throws(() => h.service.plan(request(h.descriptor, {})), /run-settings-snapshot-mismatch/u);
  assert.equal(h.transactions(), 1);
  assert.equal(h.database.getMeta().authorityGeneration, generation);
  assert.deepEqual(h.database.authority.runs.listByWorkflow(String(h.descriptor.id)), []);
});

it("rolls a canonical plan back with its enclosing transaction and retains the exact prior Settings identity", async () => {
  const h = await harnessFor(omissionAssertingDescriptor);
  const generation = h.database.getMeta().authorityGeneration;
  const active = h.database.authority.runtimeConfig.get();
  let proposed: ReturnType<typeof h.service.plan> | undefined;
  const failure = new Error("controlled outer transaction failure");
  assert.throws(() => h.database.withAuthorityTransaction(() => {
    proposed = h.service.plan(request(h.descriptor, {}));
    assert.ok(h.database.authority.startPlans.get(proposed.startPlanId));
    throw failure;
  }), error => error === failure);
  assert.ok(proposed);
  assert.equal(h.database.authority.startPlans.get(proposed.startPlanId), undefined);
  assert.equal(h.database.getMeta().authorityGeneration, generation);
  assert.deepEqual(h.database.authority.runtimeConfig.get(), active);
  assert.deepEqual(h.database.authority.runs.listByWorkflow(String(h.descriptor.id)), []);
  const accepted = h.service.plan(request(h.descriptor, {}));
  assert.ok(h.database.authority.startPlans.get(accepted.startPlanId));
});
