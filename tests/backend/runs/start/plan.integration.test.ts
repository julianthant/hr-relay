import { ProtectedStoreRecordSchema as ProtectedStoreRecordSchema_m0 } from "../../../../src/models/config/protected-settings.js";
import { canonicalJsonStringify as canonicalJsonStringify_m0 } from "../../../../src/rules/validation/canonical-json.js";

import assert_m0 from "node:assert/strict";
import { mkdtempSync as mkdtempSync_m0,rmSync as rmSync_m0 } from "node:fs";
import { tmpdir as tmpdir_m0 } from "node:os";
import { join as join_m0 } from "node:path";
import { afterEach as afterEach_m0,describe as describe_m0,it as it_m0 } from "vitest";
import { planStart as planStart_m0 } from "../../../../src/backend/runs/start/plan.js";
import { StartCommandRequestSchema as StartCommandRequestSchema_m1 } from "../../../../src/rules/commands/commands.js";
import { manualClock as manualClock_m0 } from "../../../../src/rules/time/clock.js";
import { HASH_A as HASH_A_m0,NOW as NOW_m0,UUID_4 as UUID_4_m0 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory as sequentialIdFactory_m0 } from "../../../support/fixtures/phase1f-run-fixtures.js";
import {
uuidOf as uuidOf_m0,
type DashboardWorld as DashboardWorld_m0
} from "../../../support/helpers/backend/dashboard-harness.js";
import { protectedSecretSource as protectedSecretSource_m0,protectedSecretSource as protectedSecretSource_m1 } from "../../../support/helpers/protected-secret-source.js";
import { separationsDescriptor as separationsDescriptor_m0 } from "../../../support/helpers/registered-workflows.js";
import { AuthorityDatabase as AuthorityDatabase_m0 } from "../../../support/helpers/synthetic-storage-admission.js";

import assert_m1 from "node:assert/strict";
import { mkdtempSync as mkdtempSync_m1,realpathSync as realpathSync_m1,rmSync as rmSync_m1 } from "node:fs";
import { tmpdir as tmpdir_m1 } from "node:os";
import { join as join_m1 } from "node:path";
import { afterEach as afterEach_m1,describe as describe_m1,it as it_m1 } from "vitest";
import {
dryRunRefusalMessage as dryRunRefusalMessage_m1,
planStart as planStart_m1,
resolveInstances as resolveInstances_m1,
supportsDryRun as supportsDryRun_m1
} from "../../../../src/backend/runs/start/plan.js";
import {
deriveCanonicalInputDigest as deriveCanonicalInputDigest_m1,
derivePlannedInputFingerprint as derivePlannedInputFingerprint_m1,
StartPlanRecordSchema as StartPlanRecordSchema_m1
} from "../../../../src/models/run/start-plan.js";
import { deriveSchemaHash as deriveSchemaHash_m1 } from "../../../../src/models/validation/schema-bound-value.js";
import { deriveItemId as deriveItemId_m1 } from "../../../../src/rules/identity/identifiers.js";
import { manualClock as manualClock_m1 } from "../../../../src/rules/time/clock.js";
import { descriptorRuntimeNodes as descriptorRuntimeNodes_m1,workflowDryRunSupport as workflowDryRunSupport_m1 } from "../../../../src/workflow-kit/workflow.js";
import { PersonLookupCanonicalInput as PersonLookupCanonicalInput_m1,PersonLookupInput as PersonLookupInput_m1 } from "../../../../src/workflows/person-lookup/workflow.js";
import { CONFIG_SNAPSHOT as CONFIG_SNAPSHOT_m1,HASH_B as HASH_B_m1,NOW as NOW_m1 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory as sequentialIdFactory_m1 } from "../../../support/fixtures/phase1f-run-fixtures.js";
import {
WRITE_FIXTURE_NODE_ID as WRITE_FIXTURE_NODE_ID_m1,
writeFixtureDescriptorWithoutDryRunArm as writeFixtureDescriptorWithoutDryRunArm_m1
} from "../../../support/fixtures/write-sequencer-fixtures.js";
import { personLookupDescriptor as personLookupDescriptor_m1,separationsDescriptor as separationsDescriptor_m1,separationsKualiFinalizationDescriptor as separationsKualiFinalizationDescriptor_m1,separationsUcpathTerminationDescriptor as separationsUcpathTerminationDescriptor_m1 } from "../../../support/helpers/registered-workflows.js";
import { AuthorityDatabase as AuthorityDatabase_m1 } from "../../../support/helpers/synthetic-storage-admission.js";


{


const CLOCK = manualClock_m0(new Date(NOW_m0));


const SUBMISSION = Object.freeze({
  documentNumber: "4510",
});

const roots: string[] = [];
const databases: AuthorityDatabase_m0[] = [];
const worlds: DashboardWorld_m0[] = [];

const _afterEachFixture0 = () => {
  while (databases.length > 0) databases.pop()?.close();
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) rmSync_m0(root, { recursive: true, force: true });
  }
  for (const world of worlds.splice(0)) world.dispose();
};

function openDatabase(): AuthorityDatabase_m0 {
  const root = mkdtempSync_m0(join_m0(tmpdir_m0(), "hrauto-separations-wire-"));
  roots.push(root);
  const database = AuthorityDatabase_m0.open(
    { path: join_m0(root, "state.sqlite"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
    CLOCK,
  );
  databases.push(database);
  return database;
}

describe_m0("separations — start planning through the existing service", () => {
afterEach_m0(_afterEachFixture0);

  it_m0("reads protected input once, retains it across rotation, and refuses override/absence before IDs", () => {
    const authority = openDatabase();
    let current = ProtectedStoreRecordSchema_m0.parse(protectedSecretSource_m0({ timekeeperName: "Synthetic First Operator" }).read());
    let reads = 0;
    let ids = 0;
    const source = { read: () => { reads += 1; return current; } };
    const request = { descriptor: separationsDescriptor_m0, submissions: [SUBMISSION], dryRun: true,
      priority: "bulk" as const, shape: "single" as const, configFingerprint: HASH_A_m0,
      configSnapshotId: UUID_4_m0, plannedBy: "local-operator" };
    const deps = { authority, clock: CLOCK, ids: { uuid: () => { ids += 1; return uuidOf_m0(ids + 50); } },
      planTtlMs: 600_000, protectedSecrets: source };
    const first = planStart_m0(deps, request);
    assert_m0.equal(reads, 1);
    const retained = first.planned[0]?.input;
    assert_m0.ok(retained);
    assert_m0.equal(Reflect.get(retained.value as object, "timekeeperName"), "Synthetic First Operator");
    const changedBytes = ProtectedStoreRecordSchema_m0.parse(protectedSecretSource_m0({ timekeeperName: "Synthetic Second Operator" }).read());
    current = changedBytes;
    const sameBinding = planStart_m0(deps, request);
    assert_m0.equal(sameBinding.inputFingerprint, first.inputFingerprint, "values cannot enter fingerprints");
    current = { ...changedBytes, entries: { ...changedBytes.entries, timekeeperName: {
      ...changedBytes.entries.timekeeperName!, valueId: uuidOf_m0(90),
    } } };
    const rotated = planStart_m0(deps, request);
    assert_m0.notEqual(rotated.inputFingerprint, first.inputFingerprint, "the retained valueId is identity");
    const beforeRetained = reads;
    const rerun = planStart_m0(deps, { ...request, retainedInputs: [retained] });
    assert_m0.equal(reads, beforeRetained);
    assert_m0.deepEqual(rerun.planned[0]?.input, retained);
    current = ProtectedStoreRecordSchema_m0.parse(protectedSecretSource_m0().read());
    const beforeBlocked = ids;
    assert_m0.throws(() => planStart_m0(deps, request), /protected input timekeeperName is absent/);
    assert_m0.equal(ids, beforeBlocked);
    const beforeOverride = reads;
    assert_m0.throws(() => planStart_m0(deps, { ...request, submissions: [{ ...SUBMISSION, timekeeperName: "Do Not Echo This" }] }),
      /^Error: caller-supplied protected input timekeeperName is refused$/);
    assert_m0.equal(reads, beforeOverride);
    assert_m0.equal(ids, beforeBlocked);
    assert_m0.throws(() => planStart_m0({ ...deps, protectedSecrets: { read: () => { throw new Error("Do Not Echo This"); } } }, request),
      /^Error: protected input timekeeperName source is unreadable$/);
    assert_m0.equal(ids, beforeBlocked);
  });

  it_m0("binds protected canary plans without document-derived titles, match keys or fingerprints", () => {
    const deps = { authority: openDatabase(), clock: CLOCK, ids: sequentialIdFactory_m0(), planTtlMs: 600_000,
      protectedSecrets: protectedSecretSource_m0({ timekeeperName: "Synthetic Timekeeper" }) };
    const request = { descriptor: separationsDescriptor_m0, submissions: [{ documentNumber: "4511" }],
      protectedSubmissionBindings: [{ kind: "test-data-local" as const, inputPath: "documentNumber" as const,
        name: "separationsKualiFinalizationCanaryDocumentNumber" as const, sourceId: uuidOf_m0(88) }],
      dryRun: true, priority: "bulk" as const, shape: "single" as const, configFingerprint: HASH_A_m0,
      configSnapshotId: UUID_4_m0, plannedBy: "local-operator" };
    const first = planStart_m0(deps, request);
    const changed = planStart_m0(deps, { ...request, submissions: [{ documentNumber: "4512" }] });
    assert_m0.equal(first.inputFingerprint, changed.inputFingerprint);
    const retained = first.planned[0].input;
    assert_m0.equal(first.planned[0].title, "Protected test subject");
    assert_m0.equal(first.planned[0].matchKey.includes("4511"), false);
    assert_m0.equal(first.planned[0].itemId, changed.planned[0].itemId);
    assert_m0.throws(() => planStart_m0(deps, { ...request, retainedInputs: [retained],
      submissions: [{ documentNumber: "4512" }] }), /retained protected input .* cannot change/);
    const rereadRefusal = { read: () => { throw new Error("must not reread"); } };
    assert_m0.deepEqual(planStart_m0({ ...deps, protectedSecrets: rereadRefusal }, { ...request, retainedInputs: [retained] })
      .planned[0].input, retained);
  });

  it_m0("gives an explicit protected reread a stable new item without changing captured source identity", () => {
    const deps = { authority: openDatabase(), clock: CLOCK, ids: sequentialIdFactory_m0(), planTtlMs: 600_000,
      protectedSecrets: protectedSecretSource_m0({ timekeeperName: "Synthetic Timekeeper" }) };
    const request = { descriptor: separationsDescriptor_m0, submissions: [{ documentNumber: "4511" }],
      protectedSubmissionBindings: [{ kind: "test-data-local" as const, inputPath: "documentNumber" as const,
        name: "separationsKualiFinalizationCanaryDocumentNumber" as const, sourceId: uuidOf_m0(88) }],
      dryRun: true, priority: "bulk" as const, shape: "single" as const, configFingerprint: HASH_A_m0,
      configSnapshotId: UUID_4_m0, plannedBy: "local-operator" };
    const read = (ordinal: number, reason = "Synthetic complete rehearsal", documentNumber = "4511") =>
      planStart_m0(deps, { ...request, submissions: [{ documentNumber, reRead: { ordinal, reason } }] });
    const original = planStart_m0(deps, request);
    const fresh = read(1);
    const sameDecision = read(1, "Synthetic revised explanation");
    const nextDecision = read(2);
    const changedValue = read(1, "Synthetic complete rehearsal", "4512");
    for (const result of [original, fresh, sameDecision, nextDecision, changedValue]) {
      assert_m0.equal(result.planned.length, 1);
      assert_m0.equal(result.refused.length, 0);
    }
    const first = original.planned[0];
    const reread = fresh.planned[0];
    assert_m0.notEqual(first.itemId, reread.itemId, "fresh reads cannot reuse the original item's checkpoints");
    assert_m0.equal(first.matchKey, `protected-input:${canonicalJsonStringify_m0(first.input.protectedBindings)}`);
    assert_m0.equal(reread.matchKey, `${first.matchKey}#re-read-1`);
    assert_m0.equal(reread.itemId, sameDecision.planned[0].itemId, "reason text is not item identity");
    assert_m0.notEqual(fresh.inputFingerprint, sameDecision.inputFingerprint, "confirmation still binds the reason");
    assert_m0.notEqual(reread.itemId, nextDecision.planned[0].itemId);
    assert_m0.equal(reread.itemId, changedValue.planned[0].itemId, "private values cannot derive item identity");
    assert_m0.equal(fresh.inputFingerprint, changedValue.inputFingerprint);
    assert_m0.deepEqual(reread.input.protectedBindings, first.input.protectedBindings);
    assert_m0.equal(reread.title, "Protected test subject");
    assert_m0.equal(reread.subtitle, undefined);
    assert_m0.equal(reread.matchKey.includes("Synthetic"), false);
    assert_m0.equal(reread.matchKey.includes("4511"), false);

    const retained = planStart_m0({ ...deps, protectedSecrets: { read: () => { throw new Error("must not reread"); } } },
      { ...request, submissions: [{ documentNumber: "4511", reRead: { ordinal: 1, reason: "Synthetic complete rehearsal" } }],
        retainedInputs: [reread.input] });
    assert_m0.equal(retained.planned[0].itemId, reread.itemId);
    assert_m0.deepEqual(retained.planned[0].input, reread.input);
    const duplicate = planStart_m0(deps, { ...request, submissions: [
      { documentNumber: "4511", reRead: { ordinal: 1, reason: "Synthetic first reason" } },
      { documentNumber: "4511", reRead: { ordinal: 1, reason: "Synthetic second reason" } },
    ] });
    assert_m0.equal(duplicate.planned.length, 1);
    assert_m0.equal(duplicate.refused[0].code, "active-run-exists");
    for (const ordinal of [0, 100, 1.5]) assert_m0.equal(read(ordinal).refused[0].code, "input-invalid");
  });
});
}

{


const CLOCK = manualClock_m1(new Date(NOW_m1));
const PLAN_TTL_MS = 10 * 60 * 1000;
const PERSON_EID_MATCH_KEY = "eid:10873698";
const PERSON_NAME_MATCH_KEY = "name:Battistessa, Johnnie";
const roots: string[] = [];
const databases: AuthorityDatabase_m1[] = [];

function openDatabase(): AuthorityDatabase_m1 {
  const root = mkdtempSync_m1(join_m1(realpathSync_m1(tmpdir_m1()), "hrauto-rebuild-start-"));
  roots.push(root);
  const database = AuthorityDatabase_m1.open(
    { path: join_m1(root, "state.sqlite"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
    CLOCK,
  );
  database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT_m1);
  databases.push(database);
  return database;
}

function plannerDeps(authority: AuthorityDatabase_m1, ids = sequentialIdFactory_m1()) {
  return { authority, clock: CLOCK, ids, planTtlMs: PLAN_TTL_MS };
}

function baseRequest(submissions: readonly unknown[], overrides: Record<string, unknown> = {}) {
  return {
    descriptor: personLookupDescriptor_m1,
    submissions,
    dryRun: false,
    priority: "bulk" as const,
    shape: "single" as const,
    configFingerprint: CONFIG_SNAPSHOT_m1.fingerprint,
    configSnapshotId: CONFIG_SNAPSHOT_m1.configSnapshotId,
    plannedBy: "local-operator",
    ...overrides,
  };
}

const _afterEachFixture0 = () => {
  while (databases.length > 0) databases.pop()?.close();
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) rmSync_m1(root, { recursive: true, force: true });
  }
};

describe_m1("start planning", () => {
afterEach_m1(_afterEachFixture0);

  it_m1("refuses an unbound reserved private field before planning any submission", () => {
    const database = openDatabase();
    const ids = sequentialIdFactory_m1();
    const generation = database.getMeta().authorityGeneration;
    assert_m1.throws(() => planStart_m1(plannerDeps(database, ids),
      baseRequest([{ emplId: "10873698" }, { emplId: "10001573", timekeeperName: "Synthetic unbound signer" }])),
    /protected input timekeeperName binding is absent/u);
    assert_m1.deepEqual(ids.minted(), []);
    assert_m1.deepEqual(database.authority.runs.listByWorkflow("person-lookup"), []);
    assert_m1.equal(database.getMeta().authorityGeneration, generation);
  });
  it_m1("retains the actual protected-store origin admitted before canonical planning",()=>{
    const database=openDatabase();
    const plan=planStart_m1({...plannerDeps(database),protectedSecrets:protectedSecretSource_m1({timekeeperName:"Synthetic signer"})},
      baseRequest([{documentNumber:"12345678"}],{descriptor:separationsDescriptor_m1}));
    assert_m1.equal(plan.refused.length,0);
    assert_m1.equal(plan.planned.length,1);
    assert_m1.deepEqual(plan.planned[0].input.protectedBindings,[{kind:"protected-store",inputPath:"timekeeperName",name:"timekeeperName",valueId:"00000000-0000-4000-8000-000000000010"}]);
    const value=plan.planned[0].input.value;const raw=plan.planned[0].rawInput;
    assert_m1.ok(value!==null && typeof value === "object" && !Array.isArray(value));
    assert_m1.ok(raw!==null && typeof raw === "object" && !Array.isArray(raw));
    assert_m1.equal(Reflect.get(value, "timekeeperName"),"Synthetic signer");
    assert_m1.equal(Object.hasOwn(raw,"timekeeperName"),false);
  });
  it_m1("planning reserves no lifecycle identity", () => {
    const database = openDatabase();
    const ids = sequentialIdFactory_m1();
    const plan = planStart_m1(plannerDeps(database, ids),
      baseRequest([{ emplId: "10873698" }]));
    assert_m1.deepEqual(ids.minted(), [plan.startPlanId], "only the start-plan identity may be minted");
    assert_m1.equal(Object.hasOwn(plan.planned[0], "runId"), false);
    assert_m1.equal(Object.hasOwn(plan.planned[0], "traceId"), false);
  });

  it_m1("plans every valid submission and derives its identity from the workflow's own match key", () => {
    const database = openDatabase();
    const plan = planStart_m1(plannerDeps(database), baseRequest([
      { emplId: "10873698" },
      { name: "Battistessa, Johnnie" },
    ]));
    assert_m1.equal(plan.planned.length, 2);
    assert_m1.equal(plan.refused.length, 0);
    for(const entry of plan.planned)assert_m1.deepEqual(entry.input.protectedBindings,[]);
    assert_m1.deepEqual(plan.planned.map(({ matchKey }) => matchKey), [
      PERSON_EID_MATCH_KEY,
      PERSON_NAME_MATCH_KEY,
    ]);
    assert_m1.equal(plan.planned[0].itemId, deriveItemId_m1("person-lookup", PERSON_EID_MATCH_KEY));
    assert_m1.equal(plan.planned[0].title, "EID 10873698");
    assert_m1.equal(plan.planned[0].subtitle, "person lookup");
    // The canonical snapshot carries resolved defaults, bound to the canonical
    // schema's own hash rather than the ingress schema's.
    assert_m1.deepEqual(plan.planned[0].input.value, {
      emplId: "10873698",
      keepNonHdh: false,
      includeCrmDates: false,
    });
    assert_m1.deepEqual(plan.planned[0].rawInput, { emplId: "10873698" });
    assert_m1.notDeepEqual(plan.planned[0].rawInput, plan.planned[0].input.value);
    assert_m1.equal(plan.ingressSchemaHash, deriveSchemaHash_m1(PersonLookupInput_m1, "input"));
    assert_m1.equal(plan.canonicalInputSchemaHash, deriveSchemaHash_m1(PersonLookupCanonicalInput_m1, "output"));
    assert_m1.equal(plan.planned[0].input.schemaHash, deriveSchemaHash_m1(PersonLookupCanonicalInput_m1, "output"));
    assert_m1.equal(plan.planned[0].canonicalInputDigest, deriveCanonicalInputDigest_m1(plan.planned[0].input.value));
  });

  it_m1("retains the effective browser screenshot choice without backfilling historical plans", () => {
    const database = openDatabase();
    const captured = planStart_m1(
      plannerDeps(database),
      baseRequest([{ emplId: "10873698" }], { captureBrowserScreenshots: true }),
    );
    const defaulted = planStart_m1(plannerDeps(database), baseRequest([{ emplId: "10001573" }]));
    const { captureBrowserScreenshots: _captureBrowserScreenshots, ...historicalBytes } = captured;
    void _captureBrowserScreenshots;
    const historical = StartPlanRecordSchema_m1.parse(historicalBytes);

    assert_m1.equal(captured.captureBrowserScreenshots, true);
    assert_m1.equal(defaulted.captureBrowserScreenshots, false);
    assert_m1.equal(Object.hasOwn(historical, "captureBrowserScreenshots"), false);
  });

  it_m1("retains the operator's step omissions on the plan record, byte for byte", () => {
    const database = openDatabase();
    const stepOmissions = [{ step: "kronos-timecard", facts: { lastDayWorked: "06/18/2026", separationDate: "06/19/2026" } }];
    const plan = planStart_m1(plannerDeps(database), baseRequest([{ emplId: "10873698" }], { stepOmissions }));
    assert_m1.deepEqual(plan.stepOmissions, stepOmissions);
    assert_m1.deepEqual(StartPlanRecordSchema_m1.parse(plan).stepOmissions, stepOmissions);
    const plain = planStart_m1(plannerDeps(database), baseRequest([{ emplId: "10001573" }]));
    assert_m1.equal(Object.hasOwn(plain, "stepOmissions"), false);
  });

  it_m1("refuses an unparseable submission by name instead of dropping it", () => {
    const database = openDatabase();
    const plan = planStart_m1(plannerDeps(database), baseRequest([
      { emplId: "10873698" },
      { emplId: "99" },
    ]));
    assert_m1.equal(plan.planned.length, 1);
    assert_m1.equal(plan.refused.length, 1);
    assert_m1.equal(plan.refused[0].entry, 2);
    assert_m1.equal(plan.refused[0].code, "input-invalid");
    assert_m1.deepEqual(plan.refused[0].rawInput, { emplId: "99" });
  });

  it_m1("fails the entire planning request when raw ingress cannot be retained as strict JSON", () => {
    const database = openDatabase();
    const ids = sequentialIdFactory_m1();
    assert_m1.throws(() => planStart_m1(plannerDeps(database, ids), baseRequest([
      { emplId: "10873698" },
      undefined,
    ])), /entry 2 is not strict JSON and cannot be retained/);
    assert_m1.deepEqual(ids.minted(), [], "no proposal ids were minted");
  });

  it_m1("rejects a sparse submissions array before minting any proposal ids", () => {
    const database = openDatabase();
    const ids = sequentialIdFactory_m1();
    const submissions = new Array<unknown>(3);
    submissions[0] = { emplId: "10873698" };
    submissions[2] = { emplId: "10001573" };
    const authorityGeneration = database.getMeta().authorityGeneration;

    assert_m1.equal(Object.hasOwn(submissions, 1), false, "the fixture must contain a real middle hole");
    assert_m1.throws(
      () => planStart_m1(plannerDeps(database, ids), baseRequest(submissions)),
      /entry 2 is missing; submissions must be a dense array/,
    );
    assert_m1.deepEqual(ids.minted(), [], "no proposal ids were minted before dense validation completed");
    assert_m1.equal(database.getMeta().authorityGeneration, authorityGeneration, "planning failure must not mutate authority");
  });

  it_m1("refuses a repeat of a logical item already in the same plan", () => {
    const database = openDatabase();
    const plan = planStart_m1(plannerDeps(database), baseRequest([
      { emplId: "10873698" },
      { emplId: "10873698", includeCrmDates: true },
    ]));
    assert_m1.equal(plan.planned.length, 1);
    assert_m1.deepEqual(plan.refused.map(({ code }) => code), ["active-run-exists"]);
    assert_m1.deepEqual(plan.refused[0].rawInput, { emplId: "10873698", includeCrmDates: true });
  });

  it_m1("refuses a dry run the GRAPH does not offer, and says which fact refused it", () => {
    const database = openDatabase();
    // Person Lookup is read-only. A dry run of it would execute exactly the same
    // nodes as a real run, so "supported" would silently redefine the request.
    assert_m1.equal(supportsDryRun_m1(personLookupDescriptor_m1), false);
    assert_m1.deepEqual(workflowDryRunSupport_m1(personLookupDescriptor_m1), {
      state: "unsupported",
      reason: "no-transaction-node",
    });
    const plan = planStart_m1(plannerDeps(database), baseRequest([{ emplId: "10873698" }], { dryRun: true }));
    assert_m1.equal(plan.planned.length, 0);
    assert_m1.equal(plan.refused[0].code, "dry-run-unsupported");
    assert_m1.deepEqual(plan.refused[0].rawInput, { emplId: "10873698" });
    assert_m1.match(plan.refused[0].message, /has no transaction node/);
  });


  it_m1("makes all three registered write workflows dry-startable through the graph", () => {
    for (const descriptor of [
      separationsUcpathTerminationDescriptor_m1,
      separationsKualiFinalizationDescriptor_m1,

      separationsDescriptor_m1,
    ]) {
      assert_m1.equal(supportsDryRun_m1(descriptor), true, `${descriptor.id} must be previewable`);
      const support = workflowDryRunSupport_m1(descriptor);
      assert_m1.equal(support.state, "supported");
      // The stop node is the FIRST transaction node, which is where ref task-contract
      // §10.1 says a preview ends.
      const firstTransaction = descriptorRuntimeNodes_m1(descriptor)
        .find((node) => node.kind === "transaction");
      assert_m1.ok(firstTransaction);
      assert_m1.equal(support.state === "supported" ? support.stopsAt : "", String(firstTransaction.id));
    }
    // The independence, stated in both directions on the shipped set.
    assert_m1.deepEqual(separationsUcpathTerminationDescriptor_m1.surfaces, {});
    assert_m1.deepEqual(separationsKualiFinalizationDescriptor_m1.surfaces, {});
    assert_m1.notEqual(separationsDescriptor_m1.surfaces.inputRun, undefined, "Separations declares typed ingress");
  });

  it_m1("refuses a graph whose transaction node declares no preview arm, by node name", () => {
    assert_m1.deepEqual(workflowDryRunSupport_m1(writeFixtureDescriptorWithoutDryRunArm_m1), {
      state: "unsupported",
      reason: "node-declares-unsupported",
      nodeId: WRITE_FIXTURE_NODE_ID_m1,
    });
    assert_m1.equal(supportsDryRun_m1(writeFixtureDescriptorWithoutDryRunArm_m1), false);
    assert_m1.match(
      dryRunRefusalMessage_m1(writeFixtureDescriptorWithoutDryRunArm_m1),
      new RegExp(`transaction node "${WRITE_FIXTURE_NODE_ID_m1}" declares dryRun:"unsupported"`),
    );
  });

  it_m1("resolves every reached system to production and refuses retired test targets", () => {
    assert_m1.deepEqual(resolveInstances_m1(personLookupDescriptor_m1, undefined), { ucpath: "prod", crm: "prod" });
    assert_m1.throws(() => resolveInstances_m1(personLookupDescriptor_m1, { crm: "test" }), /retired test instance/u);
    assert_m1.throws(
      () => resolveInstances_m1(personLookupDescriptor_m1, { kuali: "prod" }),
      /never reaches kuali/,
    );
  });

  it_m1("fingerprints the planned set so a re-plan cannot be started by an old confirmation", () => {
    const database = openDatabase();
    const one = planStart_m1(plannerDeps(database), baseRequest([{ emplId: "10873698" }]));
    const same = planStart_m1(plannerDeps(database), baseRequest([{ emplId: "10873698" }]));
    const two = planStart_m1(plannerDeps(database), baseRequest([
      { emplId: "10873698" },
      { emplId: "10001573" },
    ]));
    assert_m1.equal(one.inputFingerprint, same.inputFingerprint);
    assert_m1.equal(one.inputFingerprint, same.inputFingerprint);
    assert_m1.notEqual(one.inputFingerprint, two.inputFingerprint);
    assert_m1.equal(one.inputFingerprint, derivePlannedInputFingerprint_m1(
      one.planned,
      one.ingressSchemaHash,
      one.canonicalInputSchemaHash,
    ));
  });

  it_m1("binds raw ingress even when defaults produce the same canonical snapshot", () => {
    const database = openDatabase();
    const omittedDefault = planStart_m1(plannerDeps(database), baseRequest([{ emplId: "10873698" }]));
    const explicitDefault = planStart_m1(plannerDeps(database), baseRequest([{
      emplId: "10873698",
      keepNonHdh: false,
      includeCrmDates: false,
    }]));
    assert_m1.deepEqual(omittedDefault.planned[0].input, explicitDefault.planned[0].input);
    assert_m1.notDeepEqual(omittedDefault.planned[0].rawInput, explicitDefault.planned[0].rawInput);
    assert_m1.notEqual(omittedDefault.inputFingerprint, explicitDefault.inputFingerprint);
  });

  it_m1("rejects schema, digest, and confirmation drift inside a stored plan", () => {
    const database = openDatabase();
    const plan = planStart_m1(plannerDeps(database), baseRequest([{ emplId: "10873698" }]));
    assert_m1.throws(() => StartPlanRecordSchema_m1.parse({
      ...plan,
      planned: [{ ...plan.planned[0], input: { ...plan.planned[0].input, schemaHash: HASH_B_m1 } }],
    }), /canonical-input schema hash/);
    assert_m1.throws(() => StartPlanRecordSchema_m1.parse({
      ...plan,
      planned: [{ ...plan.planned[0], canonicalInputDigest: HASH_B_m1 }],
    }), /canonical-input digest/);
    assert_m1.throws(() => StartPlanRecordSchema_m1.parse({ ...plan, inputFingerprint: HASH_B_m1 }), /confirmation fingerprint/);
  });
});

describe_m1("start plan consumption", () => {
afterEach_m1(_afterEachFixture0);

  function _storedPlan(database: AuthorityDatabase_m1) {
    const plan = planStart_m1(plannerDeps(database), baseRequest([{ emplId: "10873698" }]));
    const stored = database.authority.startPlans.create(plan);
    assert_m1.equal(stored.state, "inserted");
    database.authority.commands.insert(StartCommandRequestSchema_m1.parse({commandId:"cccccccc-0001-4000-8000-000100000000",
      family:"start",type:"start-run",requestedAt:NOW_m1,requestedBy:"local-operator",source:"dashboard",
      target:{workflowId:plan.workflowId,startPlanId:plan.startPlanId,expectedVersion:plan.version},
      payload:{descriptorFingerprint:plan.descriptorFingerprint,configFingerprint:plan.configFingerprint,ingressSchemaHash:plan.ingressSchemaHash,
        canonicalInputSchemaHash:plan.canonicalInputSchemaHash,inputFingerprint:plan.inputFingerprint}}));
    return plan;
  }

  function _consumeRequest(plan: ReturnType<typeof _storedPlan>, overrides: Record<string, unknown> = {}) {
    return {
      startPlanId: plan.startPlanId,
      expectedVersion: plan.version,
      commandId: "cccccccc-0001-4000-8000-000100000000",
      descriptorFingerprint: plan.descriptorFingerprint,
      configFingerprint: plan.configFingerprint,
      ingressSchemaHash: plan.ingressSchemaHash,
      canonicalInputSchemaHash: plan.canonicalInputSchemaHash,
      inputFingerprint: plan.inputFingerprint,
      now: NOW_m1,
      ...overrides,
    };
  }

  it_m1("refuses to store a plan that claims it was already consumed", () => {
    const database = openDatabase();
    const plan = planStart_m1(plannerDeps(database), baseRequest([{ emplId: "10873698" }]));
    assert_m1.throws(
      () => database.authority.startPlans.create({
        ...plan,
        consumedBy: { commandId: "cccccccc-0003-4000-8000-000300000000", consumedAt: NOW_m1 },
        version: plan.version + 1,
      }),
      /cannot be created already consumed/,
    );
  });
});
}
