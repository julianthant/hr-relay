/**
 * Start planning and plan consumption (doc 13 §5.1).
 *
 * The property under test throughout is that the operator acts on the truth:
 * what the plan says will start is what starts, what it refuses is named with a
 * reason, and a confirmation that no longer describes reality refuses rather
 * than starting something else.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import { deriveItemId, deriveTraceId } from "../../src/domain/identifiers.js";
import { deriveSchemaHash } from "../../src/domain/schema-bound-value.js";
import {
  deriveCanonicalInputDigest,
  derivePlannedInputFingerprint,
  StartPlanRecordSchema,
} from "../../src/domain/run/start-plan.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import { buildQueuedRun } from "../../src/services/runs/enqueue.js";
import { descriptorRuntimeNodes, workflowDryRunSupport } from "../../src/base/workflow.js";
import {
  dryRunRefusalMessage,
  planStart,
  resolveInstances,
  supportsDryRun,
} from "../../src/services/start/plan.js";
import { kualiTimekeeperAnnotationDescriptor } from "../../src/workflows/kuali-timekeeper-annotation/descriptor.js";
import { separationsKualiFinalizationDescriptor } from "../../src/workflows/separations-kuali-finalization/descriptor.js";
import { separationsUcpathTerminationDescriptor } from "../../src/workflows/separations-ucpath-termination/descriptor.js";
import { separationsDescriptor } from "../../src/workflows/separations/descriptor.js";
import {
  PersonLookupCanonicalInput,
  PersonLookupInput,
  personLookupDescriptor,
} from "../../src/workflows/person-lookup/descriptor.js";
import { HASH_A, HASH_B, NOW, UUID_4 } from "./fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "./fixtures/phase1f-run-fixtures.js";
import {
  defineAuthoredDryRunDescriptor,
  WRITE_FIXTURE_NODE_ID,
  writeFixtureDescriptorWithoutDryRunArm,
} from "./fixtures/write-sequencer-fixtures.js";

const CLOCK = manualClock(new Date(NOW));
const PLAN_TTL_MS = 10 * 60 * 1000;
const roots: string[] = [];
const databases: AuthorityDatabase[] = [];

function openDatabase(): AuthorityDatabase {
  const root = mkdtempSync(join(tmpdir(), "hrauto-rebuild-start-"));
  roots.push(root);
  const database = AuthorityDatabase.open(
    { path: join(root, "state.sqlite"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
    CLOCK,
  );
  databases.push(database);
  return database;
}

function plannerDeps(authority: AuthorityDatabase, ids = sequentialIdFactory()) {
  return { authority, clock: CLOCK, ids, planTtlMs: PLAN_TTL_MS };
}

function baseRequest(submissions: readonly unknown[], overrides: Record<string, unknown> = {}) {
  return {
    descriptor: personLookupDescriptor,
    submissions,
    dryRun: false,
    priority: "bulk" as const,
    shape: "single" as const,
    configFingerprint: HASH_A,
    configSnapshotId: UUID_4,
    plannedBy: "local-operator",
    ...overrides,
  };
}

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

describe("derived identity", () => {
  it("derives one logical item per match key, stably", () => {
    const first = deriveItemId("person-lookup", "eid:10873698");
    assert.equal(first, deriveItemId("person-lookup", "eid:10873698"));
    assert.notEqual(first, deriveItemId("person-lookup", "eid:10001573"));
    assert.notEqual(first, deriveItemId("separation", "eid:10873698"));
  });

  it("derives a trace id bound to the run it names", () => {
    const runId = "abcdef01-2345-4678-8abc-def012345678";
    const traceId = deriveTraceId("pl", runId, CLOCK);
    assert.match(traceId, /^pl-\d{6}-abcd$/);
  });

  it("hashes a schema by its shape, and reads ingress and canonical as different shapes", () => {
    const ingress = deriveSchemaHash(PersonLookupInput, "input");
    const canonical = deriveSchemaHash(PersonLookupCanonicalInput, "output");
    assert.notEqual(ingress, canonical, "defaults applied is not the same shape as defaults resolved");
    assert.equal(ingress, deriveSchemaHash(PersonLookupInput, "input"));
  });
});

describe("start planning", () => {
  it("plans every valid submission and derives its identity from the workflow's own match key", () => {
    const database = openDatabase();
    const plan = planStart(plannerDeps(database), baseRequest([
      { emplId: "10873698" },
      { name: "Battistessa, Johnnie" },
    ]));
    assert.equal(plan.planned.length, 2);
    assert.equal(plan.refused.length, 0);
    assert.deepEqual(plan.planned.map(({ matchKey }) => matchKey), [
      "eid:10873698",
      "name:Battistessa, Johnnie",
    ]);
    assert.equal(plan.planned[0].itemId, deriveItemId("person-lookup", "eid:10873698"));
    assert.equal(plan.planned[0].title, "EID 10873698");
    assert.equal(plan.planned[0].subtitle, "person lookup");
    // The canonical snapshot carries resolved defaults, bound to the canonical
    // schema's own hash rather than the ingress schema's.
    assert.deepEqual(plan.planned[0].input.value, {
      emplId: "10873698",
      keepNonHdh: false,
      includeCrmDates: false,
    });
    assert.deepEqual(plan.planned[0].rawInput, { emplId: "10873698" });
    assert.notDeepEqual(plan.planned[0].rawInput, plan.planned[0].input.value);
    assert.equal(plan.ingressSchemaHash, deriveSchemaHash(PersonLookupInput, "input"));
    assert.equal(plan.canonicalInputSchemaHash, deriveSchemaHash(PersonLookupCanonicalInput, "output"));
    assert.equal(plan.planned[0].input.schemaHash, deriveSchemaHash(PersonLookupCanonicalInput, "output"));
    assert.equal(plan.planned[0].canonicalInputDigest, deriveCanonicalInputDigest(plan.planned[0].input.value));
  });

  it("refuses an unparseable submission by name instead of dropping it", () => {
    const database = openDatabase();
    const plan = planStart(plannerDeps(database), baseRequest([
      { emplId: "10873698" },
      { emplId: "99" },
    ]));
    assert.equal(plan.planned.length, 1);
    assert.equal(plan.refused.length, 1);
    assert.equal(plan.refused[0].entry, 2);
    assert.equal(plan.refused[0].code, "input-invalid");
    assert.deepEqual(plan.refused[0].rawInput, { emplId: "99" });
  });

  it("fails the entire planning request when raw ingress cannot be retained as strict JSON", () => {
    const database = openDatabase();
    const ids = sequentialIdFactory();
    assert.throws(() => planStart(plannerDeps(database, ids), baseRequest([
      { emplId: "10873698" },
      undefined,
    ])), /entry 2 is not strict JSON and cannot be retained/);
    assert.deepEqual(ids.minted(), [], "no proposal ids were minted");
  });

  it("rejects a sparse submissions array before minting any proposal ids", () => {
    const database = openDatabase();
    const ids = sequentialIdFactory();
    const submissions = new Array<unknown>(3);
    submissions[0] = { emplId: "10873698" };
    submissions[2] = { emplId: "10001573" };
    const authorityGeneration = database.getMeta().authorityGeneration;

    assert.equal(Object.hasOwn(submissions, 1), false, "the fixture must contain a real middle hole");
    assert.throws(
      () => planStart(plannerDeps(database, ids), baseRequest(submissions)),
      /entry 2 is missing; submissions must be a dense array/,
    );
    assert.deepEqual(ids.minted(), [], "no proposal ids were minted before dense validation completed");
    assert.equal(database.getMeta().authorityGeneration, authorityGeneration, "planning failure must not mutate authority");
  });

  it("refuses a repeat of a logical item already in the same plan", () => {
    const database = openDatabase();
    const plan = planStart(plannerDeps(database), baseRequest([
      { emplId: "10873698" },
      { emplId: "10873698", includeCrmDates: true },
    ]));
    assert.equal(plan.planned.length, 1);
    assert.deepEqual(plan.refused.map(({ code }) => code), ["active-run-exists"]);
    assert.deepEqual(plan.refused[0].rawInput, { emplId: "10873698", includeCrmDates: true });
  });

  it("refuses a submission whose logical item already has an active run", () => {
    const database = openDatabase();
    const itemId = deriveItemId("person-lookup", "eid:10873698");
    database.authority.runs.enqueue(buildQueuedRun({
      descriptor: personLookupDescriptor,
      appVersion: "0.1.0",
      runId: "aaaaaaaa-0001-4000-8000-000100000000",
      itemId,
      traceId: "pl-170000-aaaa",
      rawInput: { emplId: "10873698" },
      canonicalInput: {
        schemaHash: deriveSchemaHash(PersonLookupCanonicalInput, "output"),
        value: { emplId: "10873698", keepNonHdh: false, includeCrmDates: false },
      },
      ingressSchemaHash: deriveSchemaHash(PersonLookupInput, "input"),
      configFingerprint: HASH_A,
      configSnapshotId: UUID_4,
      resolvedInstance: { ucpath: "prod", crm: "prod" },
      shape: "single",
      priority: "bulk",
      dryRun: false,
      now: NOW,
    }));

    const plan = planStart(plannerDeps(database), baseRequest([{ emplId: "10873698" }]));
    assert.equal(plan.planned.length, 0);
    assert.equal(plan.refused[0].code, "active-run-exists");
    assert.deepEqual(plan.refused[0].rawInput, { emplId: "10873698" });
    assert.match(plan.refused[0].message, /pl-170000-aaaa/);
  });

  it("refuses a dry run the GRAPH does not offer, and says which fact refused it (D209)", () => {
    const database = openDatabase();
    // Person Lookup is read-only. A dry run of it would execute exactly the same
    // nodes as a real run, so "supported" would silently redefine the request.
    assert.equal(supportsDryRun(personLookupDescriptor), false);
    assert.deepEqual(workflowDryRunSupport(personLookupDescriptor), {
      state: "unsupported",
      reason: "no-transaction-node",
    });
    const plan = planStart(plannerDeps(database), baseRequest([{ emplId: "10873698" }], { dryRun: true }));
    assert.equal(plan.planned.length, 0);
    assert.equal(plan.refused[0].code, "dry-run-unsupported");
    assert.deepEqual(plan.refused[0].rawInput, { emplId: "10873698" });
    assert.match(plan.refused[0].message, /has no transaction node/);
  });

  /**
   * D209's whole point, stated as a test on the SHIPPED descriptors: every
   * registered write workflow carries `surfaces: {}` and every one of them is
   * now dry-startable, because the question is what the graph writes rather than
   * whether an operator can paste a line into a textbox.
   */
  it("makes all four registered write workflows dry-startable through the graph (D209)", () => {
    for (const descriptor of [
      kualiTimekeeperAnnotationDescriptor,
      separationsUcpathTerminationDescriptor,
      separationsKualiFinalizationDescriptor,
      // The composition, whose three transaction nodes each declare the arm —
      // D209's "every transaction node, not only the first a preview reaches".
      separationsDescriptor,
    ]) {
      assert.deepEqual(descriptor.surfaces, {}, `${descriptor.id} still has no input surface`);
      assert.equal(supportsDryRun(descriptor), true, `${descriptor.id} must be previewable`);
      const support = workflowDryRunSupport(descriptor);
      assert.equal(support.state, "supported");
      // The stop node is the FIRST transaction node, which is where doc 01
      // §10.1 says a preview ends.
      const firstTransaction = descriptorRuntimeNodes(descriptor)
        .find((node) => node.kind === "transaction");
      assert.ok(firstTransaction);
      assert.equal(support.state === "supported" ? support.stopsAt : "", String(firstTransaction.id));
    }
  });

  it("refuses a graph whose transaction node declares no preview arm, by node name (D209)", () => {
    assert.deepEqual(workflowDryRunSupport(writeFixtureDescriptorWithoutDryRunArm), {
      state: "unsupported",
      reason: "node-declares-unsupported",
      nodeId: WRITE_FIXTURE_NODE_ID,
    });
    assert.equal(supportsDryRun(writeFixtureDescriptorWithoutDryRunArm), false);
    assert.match(
      dryRunRefusalMessage(writeFixtureDescriptorWithoutDryRunArm),
      new RegExp(`transaction node "${WRITE_FIXTURE_NODE_ID}" declares dryRun:"unsupported"`),
    );
  });

  it("refuses an AUTHORED supportsDryRun rather than overwriting it (D209)", () => {
    assert.throws(
      () => defineAuthoredDryRunDescriptor(),
      /surfaces\.inputRun\.supportsDryRun is derived from the graph \(D209\) and cannot be authored/,
    );
  });

  it("resolves every reached system to production unless test is requested", () => {
    assert.deepEqual(resolveInstances(personLookupDescriptor, undefined), { ucpath: "prod", crm: "prod" });
    assert.deepEqual(resolveInstances(personLookupDescriptor, { crm: "test" }), { ucpath: "prod", crm: "test" });
    assert.throws(
      () => resolveInstances(personLookupDescriptor, { kuali: "test" }),
      /never reaches kuali/,
    );
  });

  it("fingerprints the planned set so a re-plan cannot be started by an old confirmation", () => {
    const database = openDatabase();
    const one = planStart(plannerDeps(database), baseRequest([{ emplId: "10873698" }]));
    const two = planStart(plannerDeps(database), baseRequest([
      { emplId: "10873698" },
      { emplId: "10001573" },
    ]));
    assert.notEqual(one.inputFingerprint, two.inputFingerprint);
    assert.equal(one.inputFingerprint, derivePlannedInputFingerprint(
      one.planned,
      one.ingressSchemaHash,
      one.canonicalInputSchemaHash,
    ));
  });

  it("binds raw ingress even when defaults produce the same canonical snapshot", () => {
    const database = openDatabase();
    const omittedDefault = planStart(plannerDeps(database), baseRequest([{ emplId: "10873698" }]));
    const explicitDefault = planStart(plannerDeps(database), baseRequest([{
      emplId: "10873698",
      keepNonHdh: false,
      includeCrmDates: false,
    }]));
    assert.deepEqual(omittedDefault.planned[0].input, explicitDefault.planned[0].input);
    assert.notDeepEqual(omittedDefault.planned[0].rawInput, explicitDefault.planned[0].rawInput);
    assert.notEqual(omittedDefault.inputFingerprint, explicitDefault.inputFingerprint);
  });

  it("rejects schema, digest, and confirmation drift inside a stored plan", () => {
    const database = openDatabase();
    const plan = planStart(plannerDeps(database), baseRequest([{ emplId: "10873698" }]));
    assert.throws(() => StartPlanRecordSchema.parse({
      ...plan,
      planned: [{ ...plan.planned[0], input: { ...plan.planned[0].input, schemaHash: HASH_B } }],
    }), /canonical-input schema hash/);
    assert.throws(() => StartPlanRecordSchema.parse({
      ...plan,
      planned: [{ ...plan.planned[0], canonicalInputDigest: HASH_B }],
    }), /canonical-input digest/);
    assert.throws(() => StartPlanRecordSchema.parse({ ...plan, inputFingerprint: HASH_B }), /confirmation fingerprint/);
  });
});

describe("start plan consumption", () => {
  function storedPlan(database: AuthorityDatabase) {
    const plan = planStart(plannerDeps(database), baseRequest([{ emplId: "10873698" }]));
    const stored = database.authority.startPlans.create(plan);
    assert.equal(stored.state, "inserted");
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

  it("consumes a matching plan exactly once and treats the same command as idempotent", () => {
    const database = openDatabase();
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

  it("round-trips the exact raw and canonical ingress authority through SQLite", () => {
    const database = openDatabase();
    const plan = storedPlan(database);
    assert.deepEqual(database.authority.startPlans.get(plan.startPlanId), plan);
  });

  it("refuses a plan whose descriptor, config, schema, or confirmation has since changed", () => {
    const database = openDatabase();
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

  it("binds consumption to the pre-consume plan revision while preserving exact replay idempotency", () => {
    const database = openDatabase();
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

  it("refuses an expired confirmation rather than starting it late", () => {
    const database = openDatabase();
    const plan = storedPlan(database);
    const outcome = database.authority.startPlans.consume(consumeRequest(plan, {
      now: new Date(Date.parse(NOW) + PLAN_TTL_MS + 1000).toISOString(),
    }));
    assert.equal(outcome.state, "refused");
    if (outcome.state !== "refused") throw new Error("an expired plan must refuse");
    assert.equal(outcome.code, "expired");
  });

  it("refuses to store a plan that claims it was already consumed", () => {
    const database = openDatabase();
    const plan = planStart(plannerDeps(database), baseRequest([{ emplId: "10873698" }]));
    assert.throws(
      () => database.authority.startPlans.create({
        ...plan,
        consumedBy: { commandId: "cccccccc-0003-4000-8000-000300000000", consumedAt: NOW },
        version: plan.version + 1,
      }),
      /cannot be created already consumed/,
    );
  });

  it("leaves a plan unspent when an outer authority transaction rolls back after consume", () => {
    const database = openDatabase();
    const plan = storedPlan(database);
    assert.throws(() => database.withAuthorityTransaction(() => {
      const consumed = database.authority.startPlans.consume(consumeRequest(plan));
      assert.equal(consumed.state, "consumed");
      throw new Error("inject later D113 enqueue failure");
    }), /inject later D113 enqueue failure/);
    const retry = database.authority.startPlans.consume(consumeRequest(plan));
    assert.equal(retry.state, "consumed");
  });
});
