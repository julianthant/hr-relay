import { ProtectedStoreRecordSchema } from "../../../../src/models/config/protected-settings.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";

import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { afterEach, describe, it } from "vitest";
import { planStart } from "../../../../src/backend/runs/start/plan.js";

import { manualClock } from "../../../../src/rules/time/clock.js";
import { HASH_A, NOW, UUID_4 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { uuidOf, type DashboardWorld } from "../../../support/helpers/backend/dashboard-harness.js";
import { protectedSecretSource } from "../../../support/helpers/protected-secret-source.js";
import { separationsDescriptor } from "../../../support/helpers/registered-workflows.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

import { createPersonLookupStartFixtures } from "../../../support/helpers/backend/person-lookup-start-fixtures.js";

import { dryRunRefusalMessage, resolveInstances, supportsDryRun } from "../../../../src/backend/runs/start/plan.js";
import { deriveCanonicalInputDigest, derivePlannedInputFingerprint, StartPlanRecordSchema } from "../../../../src/models/run/start-plan.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { deriveItemId } from "../../../../src/rules/identity/identifiers.js";

import { descriptorRuntimeNodes, workflowDryRunSupport } from "../../../../src/workflow-kit/workflow.js";
import { PersonLookupCanonicalInput, PersonLookupInput } from "../../../../src/workflows/person-lookup/workflow.js";
import { HASH_B } from "../../../support/fixtures/phase1c-contract-fixtures.js";

import { WRITE_FIXTURE_NODE_ID, writeFixtureDescriptorWithoutDryRunArm } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { personLookupDescriptor, separationsKualiFinalizationDescriptor, separationsUcpathTerminationDescriptor } from "../../../support/helpers/registered-workflows.js";

{

const CLOCK = manualClock(new Date(NOW));

const SUBMISSION = Object.freeze({
  documentNumber: "4510",
});

const roots: string[] = [];
const databases: AuthorityDatabase[] = [];
const profiles: { close(): Promise<void> }[] = [];
const worlds: DashboardWorld[] = [];

const _afterEachFixture0 = async () => {
  while (databases.length > 0) databases.pop()?.close();
  for (const profile of profiles.splice(0)) await profile.close();
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
  for (const world of worlds.splice(0)) await world.dispose();
};

async function openDatabase(): Promise<AuthorityDatabase> {
  const profile = await createBoundProfileFixture();
  const database = AuthorityDatabase.open(
    { path: profile.path, busyTimeoutMs: 250, migrationOwner: "unit-test" },
    CLOCK,
  );
  profiles.push(profile);
  databases.push(database);
  return database;
}

describe("separations — start planning through the existing service", () => {
afterEach(_afterEachFixture0);

  it("reads protected input once, retains it across rotation, and refuses override/absence before IDs", async () => {
    const authority = await openDatabase();
    let current = ProtectedStoreRecordSchema.parse(protectedSecretSource({ timekeeperName: "Synthetic First Operator" }).read());
    let reads = 0;
    let ids = 0;
    const source = { read: () => { reads += 1; return current; } };
    const request = { descriptor: separationsDescriptor, submissions: [SUBMISSION], dryRun: true,
      priority: "bulk" as const, shape: "single" as const, configFingerprint: HASH_A,
      configSnapshotId: UUID_4, plannedBy: "local-operator" };
    const deps = { authority, clock: CLOCK, ids: { uuid: () => { ids += 1; return uuidOf(ids + 50); } },
      planTtlMs: 600_000, protectedSecrets: source };
    const first = planStart(deps, request);
    assert.equal(reads, 1);
    const retained = first.planned[0]?.input;
    assert.ok(retained);
    assert.equal(Reflect.get(retained.value as object, "timekeeperName"), "Synthetic First Operator");
    const changedBytes = ProtectedStoreRecordSchema.parse(protectedSecretSource({ timekeeperName: "Synthetic Second Operator" }).read());
    current = changedBytes;
    const sameBinding = planStart(deps, request);
    assert.equal(sameBinding.inputFingerprint, first.inputFingerprint, "values cannot enter fingerprints");
    current = { ...changedBytes, entries: { ...changedBytes.entries, timekeeperName: {
      ...changedBytes.entries.timekeeperName!, valueId: uuidOf(90),
    } } };
    const rotated = planStart(deps, request);
    assert.notEqual(rotated.inputFingerprint, first.inputFingerprint, "the retained valueId is identity");
    const beforeRetained = reads;
    const rerun = planStart(deps, { ...request, retainedInputs: [retained] });
    assert.equal(reads, beforeRetained);
    assert.deepEqual(rerun.planned[0]?.input, retained);
    current = ProtectedStoreRecordSchema.parse(protectedSecretSource().read());
    const beforeBlocked = ids;
    assert.throws(() => planStart(deps, request), /protected input timekeeperName is absent/);
    assert.equal(ids, beforeBlocked);
    const beforeOverride = reads;
    assert.throws(() => planStart(deps, { ...request, submissions: [{ ...SUBMISSION, timekeeperName: "Do Not Echo This" }] }),
      /^Error: caller-supplied protected input timekeeperName is refused$/);
    assert.equal(reads, beforeOverride);
    assert.equal(ids, beforeBlocked);
    assert.throws(() => planStart({ ...deps, protectedSecrets: { read: () => { throw new Error("Do Not Echo This"); } } }, request),
      /^Error: protected input timekeeperName source is unreadable$/);
    assert.equal(ids, beforeBlocked);
  });

  it("binds protected canary plans without document-derived titles, match keys or fingerprints", async () => {
    const deps = { authority: await openDatabase(), clock: CLOCK, ids: sequentialIdFactory(), planTtlMs: 600_000,
      protectedSecrets: protectedSecretSource({ timekeeperName: "Synthetic Timekeeper" }) };
    const request = { descriptor: separationsDescriptor, submissions: [{ documentNumber: "4511" }],
      protectedSubmissionBindings: [{ kind: "test-data-local" as const, inputPath: "documentNumber" as const,
        name: "separationsKualiFinalizationCanaryDocumentNumber" as const, sourceId: uuidOf(88) }],
      dryRun: true, priority: "bulk" as const, shape: "single" as const, configFingerprint: HASH_A,
      configSnapshotId: UUID_4, plannedBy: "local-operator" };
    const first = planStart(deps, request);
    const changed = planStart(deps, { ...request, submissions: [{ documentNumber: "4512" }] });
    assert.equal(first.inputFingerprint, changed.inputFingerprint);
    const retained = first.planned[0].input;
    assert.equal(first.planned[0].title, "Protected test subject");
    assert.equal(first.planned[0].matchKey.includes("4511"), false);
    assert.equal(first.planned[0].itemId, changed.planned[0].itemId);
    assert.throws(() => planStart(deps, { ...request, retainedInputs: [retained],
      submissions: [{ documentNumber: "4512" }] }), /retained protected input .* cannot change/);
    const rereadRefusal = { read: () => { throw new Error("must not reread"); } };
    assert.deepEqual(planStart({ ...deps, protectedSecrets: rereadRefusal }, { ...request, retainedInputs: [retained] })
      .planned[0].input, retained);
  });

  it("gives an explicit protected reread a stable new item without changing captured source identity", async () => {
    const deps = { authority: await openDatabase(), clock: CLOCK, ids: sequentialIdFactory(), planTtlMs: 600_000,
      protectedSecrets: protectedSecretSource({ timekeeperName: "Synthetic Timekeeper" }) };
    const request = { descriptor: separationsDescriptor, submissions: [{ documentNumber: "4511" }],
      protectedSubmissionBindings: [{ kind: "test-data-local" as const, inputPath: "documentNumber" as const,
        name: "separationsKualiFinalizationCanaryDocumentNumber" as const, sourceId: uuidOf(88) }],
      dryRun: true, priority: "bulk" as const, shape: "single" as const, configFingerprint: HASH_A,
      configSnapshotId: UUID_4, plannedBy: "local-operator" };
    const read = (ordinal: number, reason = "Synthetic complete rehearsal", documentNumber = "4511") =>
      planStart(deps, { ...request, submissions: [{ documentNumber, reRead: { ordinal, reason } }] });
    const original = planStart(deps, request);
    const fresh = read(1);
    const sameDecision = read(1, "Synthetic revised explanation");
    const nextDecision = read(2);
    const changedValue = read(1, "Synthetic complete rehearsal", "4512");
    for (const result of [original, fresh, sameDecision, nextDecision, changedValue]) {
      assert.equal(result.planned.length, 1);
      assert.equal(result.refused.length, 0);
    }
    const first = original.planned[0];
    const reread = fresh.planned[0];
    assert.notEqual(first.itemId, reread.itemId, "fresh reads cannot reuse the original item's checkpoints");
    assert.equal(first.matchKey, `protected-input:${canonicalJsonStringify(first.input.protectedBindings)}`);
    assert.equal(reread.matchKey, `${first.matchKey}#re-read-1`);
    assert.equal(reread.itemId, sameDecision.planned[0].itemId, "reason text is not item identity");
    assert.notEqual(fresh.inputFingerprint, sameDecision.inputFingerprint, "confirmation still binds the reason");
    assert.notEqual(reread.itemId, nextDecision.planned[0].itemId);
    assert.equal(reread.itemId, changedValue.planned[0].itemId, "private values cannot derive item identity");
    assert.equal(fresh.inputFingerprint, changedValue.inputFingerprint);
    assert.deepEqual(reread.input.protectedBindings, first.input.protectedBindings);
    assert.equal(reread.title, "Protected test subject");
    assert.equal(reread.subtitle, undefined);
    assert.equal(reread.matchKey.includes("Synthetic"), false);
    assert.equal(reread.matchKey.includes("4511"), false);

    const retained = planStart({ ...deps, protectedSecrets: { read: () => { throw new Error("must not reread"); } } },
      { ...request, submissions: [{ documentNumber: "4511", reRead: { ordinal: 1, reason: "Synthetic complete rehearsal" } }],
        retainedInputs: [reread.input] });
    assert.equal(retained.planned[0].itemId, reread.itemId);
    assert.deepEqual(retained.planned[0].input, reread.input);
    const duplicate = planStart(deps, { ...request, submissions: [
      { documentNumber: "4511", reRead: { ordinal: 1, reason: "Synthetic first reason" } },
      { documentNumber: "4511", reRead: { ordinal: 1, reason: "Synthetic second reason" } },
    ] });
    assert.equal(duplicate.planned.length, 1);
    assert.equal(duplicate.refused[0].code, "active-run-exists");
    for (const ordinal of [0, 100, 1.5]) assert.equal(read(ordinal).refused[0].code, "input-invalid");
  });
});
}

{

const CLOCK = manualClock(new Date(NOW));
const PLAN_TTL_MS = 10 * 60 * 1000;
const PERSON_EID_MATCH_KEY = "eid:10873698";
const PERSON_NAME_MATCH_KEY = "name:battistessa, johnnie";
const roots: string[] = [];
const databases: AuthorityDatabase[] = [];
const profiles: { close(): Promise<void> }[] = [];

const { openDatabase, plannerDeps, baseRequest } = createPersonLookupStartFixtures(roots, databases, profiles, CLOCK, PLAN_TTL_MS);

const _afterEachFixture0 = async () => {
  while (databases.length > 0) databases.pop()?.close();
  for (const profile of profiles.splice(0)) await profile.close();
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
};

describe("start planning", () => {
afterEach(_afterEachFixture0);

  it("refuses an unbound reserved private field before planning any submission", async () => {
    const database = await openDatabase();
    const ids = sequentialIdFactory();
    const generation = database.getMeta().authorityGeneration;
    assert.throws(() => planStart(plannerDeps(database, ids),
      baseRequest([{ emplId: "10873698" }, { emplId: "10101010", timekeeperName: "Synthetic unbound signer" }])),
    /protected input timekeeperName binding is absent/u);
    assert.deepEqual(ids.minted(), []);
    assert.deepEqual(database.authority.runs.listByWorkflow("person-lookup"), []);
    assert.equal(database.getMeta().authorityGeneration, generation);
  });
  it("retains the actual protected-store origin admitted before canonical planning",async ()=>{
    const database=await openDatabase();
    const plan=planStart({...plannerDeps(database),protectedSecrets:protectedSecretSource({timekeeperName:"Synthetic signer"})},
      baseRequest([{documentNumber:"12345678"}],{descriptor:separationsDescriptor}));
    assert.equal(plan.refused.length,0);
    assert.equal(plan.planned.length,1);
    assert.deepEqual(plan.planned[0].input.protectedBindings,[{kind:"protected-store",inputPath:"timekeeperName",name:"timekeeperName",valueId:"00000000-0000-4000-8000-000000000010"}]);
    const value=plan.planned[0].input.value;const raw=plan.planned[0].rawInput;
    assert.ok(value!==null && typeof value === "object" && !Array.isArray(value));
    assert.ok(raw!==null && typeof raw === "object" && !Array.isArray(raw));
    assert.equal(Reflect.get(value, "timekeeperName"),"Synthetic signer");
    assert.equal(Object.hasOwn(raw,"timekeeperName"),false);
  });
  it("planning reserves no lifecycle identity", async () => {
    const database = await openDatabase();
    const ids = sequentialIdFactory();
    const plan = planStart(plannerDeps(database, ids),
      baseRequest([{ emplId: "10873698" }]));
    assert.deepEqual(ids.minted(), [plan.startPlanId], "only the start-plan identity may be minted");
    assert.equal(Object.hasOwn(plan.planned[0], "runId"), false);
    assert.equal(Object.hasOwn(plan.planned[0], "traceId"), false);
  });

  it("plans every valid submission and derives its identity from the workflow's own match key", async () => {
    const database = await openDatabase();
    const plan = planStart(plannerDeps(database), baseRequest([
      { emplId: "10873698" },
      { name: "Battistessa, Johnnie" },
    ]));
    assert.equal(plan.planned.length, 2);
    assert.equal(plan.refused.length, 0);
    for(const entry of plan.planned)assert.deepEqual(entry.input.protectedBindings,[]);
    assert.deepEqual(plan.planned.map(({ matchKey }) => matchKey), [
      PERSON_EID_MATCH_KEY,
      PERSON_NAME_MATCH_KEY,
    ]);
    assert.equal(plan.planned[0].itemId, deriveItemId("person-lookup", PERSON_EID_MATCH_KEY));
    assert.equal(plan.planned[0].title, "10873698");
    assert.equal(plan.planned[0].subtitle, "Person Lookup");
    // The canonical snapshot carries resolved defaults, bound to the canonical
    // schema's own hash rather than the ingress schema's.
    assert.deepEqual(plan.planned[0].input.value, {
      mode: "search", crmCheck: true,
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

  it("retains the effective browser screenshot choice without backfilling historical plans", async () => {
    const database = await openDatabase();
    const captured = planStart(
      plannerDeps(database),
      baseRequest([{ emplId: "10873698" }], { captureBrowserScreenshots: true }),
    );
    const defaulted = planStart(plannerDeps(database), baseRequest([{ emplId: "10101010" }]));
    const { captureBrowserScreenshots: _captureBrowserScreenshots, ...historicalBytes } = captured;
    void _captureBrowserScreenshots;
    const historical = StartPlanRecordSchema.parse(historicalBytes);

    assert.equal(captured.captureBrowserScreenshots, true);
    assert.equal(defaulted.captureBrowserScreenshots, false);
    assert.equal(Object.hasOwn(historical, "captureBrowserScreenshots"), false);
  });

  it("retains the operator's step omissions on the plan record, byte for byte", async () => {
    const database = await openDatabase();
    const stepOmissions = [{ step: "kronos-timecard", facts: { lastDayWorked: "06/18/2026", separationDate: "06/19/2026" } }];
    const plan = planStart(plannerDeps(database), baseRequest([{ emplId: "10873698" }], { stepOmissions }));
    assert.deepEqual(plan.stepOmissions, stepOmissions);
    assert.deepEqual(StartPlanRecordSchema.parse(plan).stepOmissions, stepOmissions);
    const plain = planStart(plannerDeps(database), baseRequest([{ emplId: "10101010" }]));
    assert.equal(Object.hasOwn(plain, "stepOmissions"), false);
  });

  it("refuses an unparseable submission by name instead of dropping it", async () => {
    const database = await openDatabase();
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

  it("fails the entire planning request when raw ingress cannot be retained as strict JSON", async () => {
    const database = await openDatabase();
    const ids = sequentialIdFactory();
    assert.throws(() => planStart(plannerDeps(database, ids), baseRequest([
      { emplId: "10873698" },
      undefined,
    ])), /entry 2 is not strict JSON and cannot be retained/);
    assert.deepEqual(ids.minted(), [], "no proposal ids were minted");
  });

  it("rejects a sparse submissions array before minting any proposal ids", async () => {
    const database = await openDatabase();
    const ids = sequentialIdFactory();
    const submissions = new Array<unknown>(3);
    submissions[0] = { emplId: "10873698" };
    submissions[2] = { emplId: "10101010" };
    const authorityGeneration = database.getMeta().authorityGeneration;

    assert.equal(Object.hasOwn(submissions, 1), false, "the fixture must contain a real middle hole");
    assert.throws(
      () => planStart(plannerDeps(database, ids), baseRequest(submissions)),
      /entry 2 is missing; submissions must be a dense array/,
    );
    assert.deepEqual(ids.minted(), [], "no proposal ids were minted before dense validation completed");
    assert.equal(database.getMeta().authorityGeneration, authorityGeneration, "planning failure must not mutate authority");
  });

  it("refuses a repeat of a logical item already in the same plan", async () => {
    const database = await openDatabase();
    const plan = planStart(plannerDeps(database), baseRequest([
      { emplId: "10873698" },
      { emplId: "10873698", includeCrmDates: true },
    ]));
    assert.equal(plan.planned.length, 1);
    assert.deepEqual(plan.refused.map(({ code }) => code), ["active-run-exists"]);
    assert.deepEqual(plan.refused[0].rawInput, { emplId: "10873698", includeCrmDates: true });
  });

  it("refuses a dry run the GRAPH does not offer, and says which fact refused it", async () => {
    const database = await openDatabase();
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

  it("makes all three registered write workflows dry-startable through the graph", () => {
    for (const descriptor of [
      separationsUcpathTerminationDescriptor,
      separationsKualiFinalizationDescriptor,

      separationsDescriptor,
    ]) {
      assert.equal(supportsDryRun(descriptor), true, `${descriptor.id} must be previewable`);
      const support = workflowDryRunSupport(descriptor);
      assert.equal(support.state, "supported");
      // The stop node is the FIRST transaction node, which is where ref task-contract
      // §10.1 says a preview ends.
      const firstTransaction = descriptorRuntimeNodes(descriptor)
        .find((node) => node.kind === "transaction");
      assert.ok(firstTransaction);
      assert.equal(support.state === "supported" ? support.stopsAt : "", String(firstTransaction.id));
    }
    // The independence, stated in both directions on the shipped set.
    assert.deepEqual(separationsUcpathTerminationDescriptor.surfaces, {});
    assert.deepEqual(separationsKualiFinalizationDescriptor.surfaces, {});
    assert.notEqual(separationsDescriptor.surfaces.inputRun, undefined, "Separations declares typed ingress");
  });

  it("refuses a graph whose transaction node declares no preview arm, by node name", () => {
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

  it("resolves every reached system to production and refuses retired test targets", () => {
    assert.deepEqual(resolveInstances(personLookupDescriptor, undefined), { ucpath: "prod", crm: "prod" });
    assert.throws(() => resolveInstances(personLookupDescriptor, { crm: "test" }), /retired test instance/u);
    assert.throws(
      () => resolveInstances(personLookupDescriptor, { kuali: "prod" }),
      /never reaches kuali/,
    );
  });

  it("fingerprints the planned set so a re-plan cannot be started by an old confirmation", async () => {
    const database = await openDatabase();
    const one = planStart(plannerDeps(database), baseRequest([{ emplId: "10873698" }]));
    const same = planStart(plannerDeps(database), baseRequest([{ emplId: "10873698" }]));
    const two = planStart(plannerDeps(database), baseRequest([
      { emplId: "10873698" },
      { emplId: "10101010" },
    ]));
    assert.equal(one.inputFingerprint, same.inputFingerprint);
    assert.equal(one.inputFingerprint, same.inputFingerprint);
    assert.notEqual(one.inputFingerprint, two.inputFingerprint);
    assert.equal(one.inputFingerprint, derivePlannedInputFingerprint(
      one.planned,
      one.ingressSchemaHash,
      one.canonicalInputSchemaHash,
    ));
  });

  it("binds raw ingress even when defaults produce the same canonical snapshot", async () => {
    const database = await openDatabase();
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

  it("rejects schema, digest, and confirmation drift inside a stored plan", async () => {
    const database = await openDatabase();
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
afterEach(_afterEachFixture0);

  it("refuses to store a plan that claims it was already consumed", async () => {
    const database = await openDatabase();
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
});
}
