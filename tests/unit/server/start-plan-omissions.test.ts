/**
 * D307 — the plan service reconciles step omissions against the descriptor
 * BEFORE it plans.
 *
 * The ingress schema only ever proved the SHAPE of `stepOmissions`: an array
 * of `{ step, facts }` with unique steps. Which steps this workflow lets the
 * operator omit, which facts each one's own form requires, and whether a node
 * that still runs would read what the omission leaves unread are all facts
 * about the DESCRIPTOR, and until this seam existed the service passed the
 * request straight through to `planStart`.
 *
 * The property under test is that a refusal costs nothing durable: no plan
 * row, no run identity, no authority transaction at all. So the transaction
 * count and the minted-id list are the evidence, and a valid plan through the
 * same service is the positive control that proves neither is vacuous.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../../src/domain/clock.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/index.js";
import { createStartPlanService } from "../../../src/server/dashboard/commands/start-plan-service.js";
import { StartStepOmissionRefusedError } from "../../../src/services/start/step-selection.js";
import type { AnyWorkflowDescriptor } from "../../../src/base/workflow.js";
import { CONFIG_SNAPSHOT, HASH_A, NOW, UUID_4 } from "../../fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../fixtures/phase1f-run-fixtures.js";
import {
  omissionAssertingDescriptor,
  omissionCascadingDescriptor,
} from "../fixtures/start-step-omission-fixtures.js";

const CLOCK = manualClock(new Date(NOW));
/**
 * Deliberately NOT the submitted subject's eid: the plan legitimately serves
 * the submission's own title and match key, so a fact that repeated it would
 * make the "no facts on the wire" assertion below unfalsifiable.
 */
const READING_FACTS = { eid: "20111222", effectiveDate: "01/02/2026" };
const roots: string[] = [];
const databases: AuthorityDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function harnessFor(descriptor: AnyWorkflowDescriptor) {
  const root = mkdtempSync(join(tmpdir(), "hrauto-rebuild-omission-plan-"));
  roots.push(root);
  const database = AuthorityDatabase.open(
    { path: join(root, "state.sqlite"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
    CLOCK,
  );
  databases.push(database);
  database.authority.configSnapshots.insert({...CONFIG_SNAPSHOT,configSnapshotId:UUID_4,fingerprint:HASH_A});
  const ids = sequentialIdFactory("b");
  let transactions = 0;
  const service = createStartPlanService({
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
    configFingerprint: HASH_A,
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

describe("start plan step omissions (D307)", () => {
  it("carries the reconciled omissions onto the served wire and the durable plan record", () => {
    const harness = harnessFor(omissionAssertingDescriptor);
    const wire = harness.service.plan(request(omissionAssertingDescriptor, {
      selectedStepKeys: ["folding", "auditing"],
      stepOmissions: [{ step: "reading", facts: READING_FACTS }],
    }));

    // KEYS only on the wire. The typed facts are the same kind of value the
    // response already refuses to echo back for `rawInput`: a step form can
    // ask for an employee id or a date about a real person.
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
      submissions: [{ eid: "10873698" }, { eid: "10001573" }],
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
