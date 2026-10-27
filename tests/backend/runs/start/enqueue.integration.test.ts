import { createPersonLookupStartFixtures } from "../../../support/helpers/backend/person-lookup-start-fixtures.js";
import { StartCommandRequestSchema } from "../../../../src/rules/commands/commands.js";

import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { afterEach,describe,it } from "vitest";
import { buildQueuedRun } from "../../../../src/backend/runs/start/enqueue.js";
import {
planStart
} from "../../../../src/backend/runs/start/plan.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { deriveItemId } from "../../../../src/rules/identity/identifiers.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { PersonLookupCanonicalInput,PersonLookupInput } from "../../../../src/workflows/person-lookup/workflow.js";
import { CONFIG_SNAPSHOT,HASH_B,NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import {
defineAuthoredDryRunDescriptor
} from "../../../support/fixtures/write-sequencer-fixtures.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

const CLOCK = manualClock(new Date(NOW));
const PLAN_TTL_MS = 10 * 60 * 1000;
const PERSON_EID_MATCH_KEY = "eid:10873698";
const roots: string[] = [];
const databases: AuthorityDatabase[] = [];

const { openDatabase, plannerDeps, baseRequest } = createPersonLookupStartFixtures(roots, databases, CLOCK, PLAN_TTL_MS);

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

describe("start planning", () => {

  it("buildQueuedRun carries stepOmissions onto the run envelope byte for byte", async () => {
    const database = await openDatabase();
    const itemId = deriveItemId("person-lookup", PERSON_EID_MATCH_KEY);
    const stepOmissions = [{ step: "kronos-timecard", facts: { lastDayWorked: "06/18/2026", separationDate: "06/19/2026" } }];
    const withOmissions = buildQueuedRun({
      descriptor: personLookupDescriptor,
      appVersion: "0.1.0",
      runId: "aaaaaaaa-0002-4000-8000-000200000000",
      itemId,
      traceId: "pl-170000-bbbb",
      rawInput: { emplId: "10873698" },
      canonicalInput: {
        schemaHash: deriveSchemaHash(PersonLookupCanonicalInput, "output"),
        protectedBindings: [],
        value: { emplId: "10873698", keepNonHdh: false, includeCrmDates: false },
      },
      ingressSchemaHash: deriveSchemaHash(PersonLookupInput, "input"),
      configFingerprint: CONFIG_SNAPSHOT.fingerprint,
      configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId,
      resolvedInstance: { ucpath: "prod", crm: "prod" },
      shape: "single",
      priority: "bulk",
      dryRun: false,
      stepOmissions,
      attempt: database.authority.runs.nextItemAttempt({ workflow: "person-lookup", itemId }),
      runNumber: database.authority.runs.nextWorkflowRunNumber("person-lookup"),
      now: NOW,
    });
    assert.deepEqual(withOmissions.envelope.stepOmissions, stepOmissions);

    const withoutOmissions = buildQueuedRun({
      descriptor: personLookupDescriptor,
      appVersion: "0.1.0",
      runId: "aaaaaaaa-0003-4000-8000-000300000000",
      itemId: deriveItemId("person-lookup", "eid:10101010"),
      traceId: "pl-170000-cccc",
      rawInput: { emplId: "10101010" },
      canonicalInput: {
        schemaHash: deriveSchemaHash(PersonLookupCanonicalInput, "output"),
        protectedBindings: [],
        value: { emplId: "10101010", keepNonHdh: false, includeCrmDates: false },
      },
      ingressSchemaHash: deriveSchemaHash(PersonLookupInput, "input"),
      configFingerprint: CONFIG_SNAPSHOT.fingerprint,
      configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId,
      resolvedInstance: { ucpath: "prod", crm: "prod" },
      shape: "single",
      priority: "bulk",
      dryRun: false,
      attempt: 1,
      runNumber: 1,
      now: NOW,
    });
    assert.equal(Object.hasOwn(withoutOmissions.envelope, "stepOmissions"), false);
  });

  it("refuses a submission whose logical item already has an active run", async () => {
    const database = await openDatabase();
    const itemId = deriveItemId("person-lookup", PERSON_EID_MATCH_KEY);
    database.authority.runs.enqueue(buildQueuedRun({
      descriptor: personLookupDescriptor,
      appVersion: "0.1.0",
      runId: "aaaaaaaa-0001-4000-8000-000100000000",
      itemId,
      traceId: "pl-170000-aaaa",
      rawInput: { emplId: "10873698" },
      canonicalInput: {
        schemaHash: deriveSchemaHash(PersonLookupCanonicalInput, "output"),
        protectedBindings: [],
        value: { emplId: "10873698", keepNonHdh: false, includeCrmDates: false },
      },
      ingressSchemaHash: deriveSchemaHash(PersonLookupInput, "input"),
      configFingerprint: CONFIG_SNAPSHOT.fingerprint,
      configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId,
      resolvedInstance: { ucpath: "prod", crm: "prod" },
      shape: "single",
      priority: "bulk",
      dryRun: false,

      attempt: database.authority.runs.nextItemAttempt({ workflow: "person-lookup", itemId }),

      runNumber: database.authority.runs.nextWorkflowRunNumber("person-lookup"),
      now: NOW,
    }));

    const plan = planStart(plannerDeps(database), baseRequest([{ emplId: "10873698" }]));
    assert.equal(plan.planned.length, 0);
    assert.equal(plan.refused[0].code, "active-run-exists");
    assert.deepEqual(plan.refused[0].rawInput, { emplId: "10873698" });
    assert.match(plan.refused[0].message, /pl-170000-aaaa/);
  });

  it("refuses an AUTHORED supportsDryRun rather than overwriting it", () => {
    assert.throws(
      () => defineAuthoredDryRunDescriptor(),
      /surfaces\.inputRun\.supportsDryRun is derived from the graph and cannot be authored/,
    );
  });
});

describe("start plan consumption", () => {
  function storedPlan(database: AuthorityDatabase) {
    const plan = planStart(plannerDeps(database), baseRequest([{ emplId: "10873698" }]));
    const stored = database.authority.startPlans.create(plan);
    assert.equal(stored.state, "inserted");
    database.authority.commands.insert(StartCommandRequestSchema.parse({commandId:"cccccccc-0001-4000-8000-000100000000",
      family:"start",type:"start-run",requestedAt:NOW,requestedBy:"local-operator",source:"dashboard",
      target:{workflowId:plan.workflowId,startPlanId:plan.startPlanId,expectedVersion:plan.version},
      payload:{descriptorFingerprint:plan.descriptorFingerprint,configFingerprint:plan.configFingerprint,ingressSchemaHash:plan.ingressSchemaHash,
        canonicalInputSchemaHash:plan.canonicalInputSchemaHash,inputFingerprint:plan.inputFingerprint}}));
    return plan;
  }

  function consumeRequest(plan: ReturnType<typeof storedPlan>, overrides: Record<string, unknown> = {}) {
    return {
      startPlanId: plan.startPlanId,
      expectedVersion: plan.version,
      commandId: "cccccccc-0001-4000-8000-000100000000",
      descriptorFingerprint: plan.descriptorFingerprint,
      configFingerprint: plan.configFingerprint,
      ingressSchemaHash: plan.ingressSchemaHash,
      canonicalInputSchemaHash: plan.canonicalInputSchemaHash,
      inputFingerprint: plan.inputFingerprint,
      now: NOW,
      ...overrides,
    };
  }

  it("consumes a matching plan exactly once and treats the same command as idempotent", async () => {
    const database = await openDatabase();
    const plan = storedPlan(database);
    const first = database.authority.startPlans.consume(consumeRequest(plan));
    assert.equal(first.state, "consumed");
    const again = database.authority.startPlans.consume(consumeRequest(plan));
    assert.equal(again.state, "already-consumed");
    for (const field of [
      "descriptorFingerprint",
      "configFingerprint",
      "ingressSchemaHash",
      "canonicalInputSchemaHash",
      "inputFingerprint",
    ] as const) {
      const changedReplay = database.authority.startPlans.consume(consumeRequest(plan, {
        [field]: HASH_B,
      }));
      assert.equal(changedReplay.state, "refused");
      if (changedReplay.state !== "refused") throw new Error("a changed replay must refuse");
      assert.equal(changedReplay.code, "fingerprint-mismatch");
    }
    const other = database.authority.startPlans.consume(consumeRequest(plan, {
      commandId: "cccccccc-0002-4000-8000-000200000000",
    }));
    assert.equal(other.state, "refused");
    if (other.state !== "refused") throw new Error("a spent plan must refuse");
    assert.equal(other.code, "spent");
  });

  it("round-trips the exact raw and canonical ingress authority through SQLite", async () => {
    const database = await openDatabase();
    const plan = storedPlan(database);
    assert.deepEqual(database.authority.startPlans.get(plan.startPlanId), plan);
  });

  it("refuses a plan whose descriptor, config, schema, or confirmation has since changed", async () => {
    const database = await openDatabase();
    const plan = storedPlan(database);
    for (const field of [
      "descriptorFingerprint",
      "configFingerprint",
      "ingressSchemaHash",
      "canonicalInputSchemaHash",
      "inputFingerprint",
    ] as const) {
      const outcome = database.authority.startPlans.consume(consumeRequest(plan, { [field]: HASH_B }));
      assert.equal(outcome.state, "refused");
      if (outcome.state !== "refused") throw new Error("a changed fingerprint must refuse");
      assert.equal(outcome.code, "fingerprint-mismatch");
    }
  });

  it("binds consumption to the pre-consume plan revision while preserving exact replay idempotency", async () => {
    const database = await openDatabase();
    const plan = storedPlan(database);
    const stale = database.authority.startPlans.consume(consumeRequest(plan, {
      expectedVersion: plan.version + 1,
    }));
    assert.equal(stale.state, "refused");
    if (stale.state !== "refused") throw new Error("a stale revision must refuse");
    assert.equal(stale.code, "version-mismatch");

    const first = database.authority.startPlans.consume(consumeRequest(plan));
    assert.equal(first.state, "consumed");
    if (first.state !== "consumed") throw new Error("the original confirmation must consume");
    assert.equal(first.plan.version, plan.version + 1);
    const replay = database.authority.startPlans.consume(consumeRequest(plan));
    assert.equal(replay.state, "already-consumed");
  });

  it("refuses an expired confirmation rather than starting it late", async () => {
    const database = await openDatabase();
    const plan = storedPlan(database);
    const outcome = database.authority.startPlans.consume(consumeRequest(plan, {
      now: new Date(Date.parse(NOW) + PLAN_TTL_MS + 1000).toISOString(),
    }));
    assert.equal(outcome.state, "refused");
    if (outcome.state !== "refused") throw new Error("an expired plan must refuse");
    assert.equal(outcome.code, "expired");
  });

  it("leaves a plan unspent when an outer authority transaction rolls back after consume", async () => {
    const database = await openDatabase();
    const plan = storedPlan(database);
    assert.throws(() => database.withAuthorityTransaction(() => {
      const consumed = database.authority.startPlans.consume(consumeRequest(plan));
      assert.equal(consumed.state, "consumed");
      throw new Error("inject later enqueue failure");
    }), /inject later enqueue failure/);
    const retry = database.authority.startPlans.consume(consumeRequest(plan));
    assert.equal(retry.state, "consumed");
  });
});
