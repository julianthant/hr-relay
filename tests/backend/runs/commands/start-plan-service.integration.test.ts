
import assert from "node:assert/strict";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

const CLOCK = manualClock(new Date(NOW));
// Use a different fact EID; repeating the submitted title would make the wire-leak assertion vacuous.
const READING_FACTS = { eid: "20111222", effectiveDate: "01/02/2026" };
const roots: string[] = [];
const databases: AuthorityDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function harnessFor(descriptor: AnyWorkflowDescriptor, recovery?: "restart-from-start") {
  const root = mkdtempSync(join(tmpdir(), "hrauto-rebuild-omission-plan-"));
  roots.push(root);
  const database = AuthorityDatabase.open(
    { path: join(root, "state.sqlite"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
    CLOCK,
  );
  databases.push(database);
  database.authority.runtimeConfig.initialize({ ...CONFIG_SNAPSHOT, configSnapshotId: UUID_4 });
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

describe("start plan recovery", () => {
  it.each([undefined, "restart-from-start"] as const)("retains trusted recovery=%s without exposing public ingress", recovery => {
    const harness = harnessFor(omissionAssertingDescriptor, recovery);
    const input = request(omissionAssertingDescriptor, {});
    const wire = harness.service.plan(input);
    assert.equal(harness.database.authority.startPlans.get(wire.startPlanId)?.recovery, recovery);
    assert.equal("recovery" in wire, false);
    assert.throws(() => harness.service.plan({ ...input, recovery: "restart-from-start" }));
  });
});

describe("start plan step omissions", () => {
  it("carries the reconciled omissions onto the served wire and the durable plan record", () => {
    const harness = harnessFor(omissionAssertingDescriptor);
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

  it("omits the field entirely when every omittable step is selected to run", () => {
    const harness = harnessFor(omissionAssertingDescriptor);
    const wire = harness.service.plan(request(omissionAssertingDescriptor, {
      selectedStepKeys: ["reading", "folding", "auditing"],
    }));
    assert.equal(wire.omittedSteps, undefined);
    assert.equal(harness.database.authority.startPlans.get(wire.startPlanId)?.stepOmissions, undefined);
  });

  it("refuses invalid facts before a plan row, a run identity or a transaction exists", () => {
    const harness = harnessFor(omissionAssertingDescriptor);
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

  it("refuses omissions submitted with no explicit step selection", () => {
    const harness = harnessFor(omissionAssertingDescriptor);
    const error = refusal(() => harness.service.plan(request(omissionAssertingDescriptor, {
      stepOmissions: [{ step: "reading", facts: READING_FACTS }],
    })));
    assert.equal(error.code, "selection-required");
    assert.equal(harness.transactions(), 0);
  });

  it("refuses typed facts for a plan that carries more than one subject", () => {
    const harness = harnessFor(omissionAssertingDescriptor);
    const error = refusal(() => harness.service.plan(request(omissionAssertingDescriptor, {
      submissions: [{ eid: "10873698" }, { eid: "10101010" }],
      selectedStepKeys: ["folding", "auditing"],
      stepOmissions: [{ step: "reading", facts: READING_FACTS }],
    })));
    assert.equal(error.code, "single-subject-only");
    assert.equal(harness.transactions(), 0);
  });

  it("refuses an omitted step whose facts never arrived", () => {
    const harness = harnessFor(omissionAssertingDescriptor);
    const error = refusal(() => harness.service.plan(request(omissionAssertingDescriptor, {
      selectedStepKeys: ["folding", "auditing"],
    })));
    assert.equal(error.code, "facts-missing");
    assert.equal(harness.transactions(), 0);
  });

  it("refuses a selection that keeps a step the omission leaves unable to read", () => {
    const harness = harnessFor(omissionCascadingDescriptor);
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


it("plan service selects the active snapshot inside its write boundary after boot", () => {
 const h = harnessFor(omissionAssertingDescriptor);
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


describe("start plan workers", () => {
  it.each([undefined, "auto", 1, 8] as const)("persists and returns %s with omitted starts selecting Auto", workers => {
    const h = harnessFor(omissionAssertingDescriptor);
    const wire = h.service.plan(request(h.descriptor, workers === undefined ? {} : { workers }));
    assert.equal(wire.workers, workers ?? "auto");
    assert.equal(h.database.authority.startPlans.get(wire.startPlanId)?.workers, workers ?? "auto");
    assert.equal(h.database.authority.workerSlots.list().length, 0);
  });
  it.each([0, 9, 1.5, "1", null])("rejects invalid workers %s before writing a plan", workers => {
    const h = harnessFor(omissionAssertingDescriptor);
    assert.throws(() => h.service.plan(request(h.descriptor, { workers })));
    assert.equal(h.transactions(), 0);
    assert.deepEqual(h.ids.minted(), []);
  });
});
