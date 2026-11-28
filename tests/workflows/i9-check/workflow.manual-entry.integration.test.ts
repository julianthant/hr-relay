import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { i9CheckModule } from "../../support/helpers/registered-workflows.js";
import { i9Candidate, i9CheckInput, i9Search } from "../../support/fixtures/i9-check.js";
import { descriptorRuntimeNodes } from "../../../src/workflow-kit/workflow.js";
import { ActorIdSchema, FingerprintSchema, IsoInstantSchema } from "../../../src/rules/identity/ids.js";
import type { JsonObject } from "../../../src/rules/validation/canonical-json.js";
import type { StepOmissions } from "../../../src/models/workflow/step-omission.js";
import type { UcpathPersonOrgDriver } from "../../../src/models/ui/ucpath-person-org.js";
import { I9CheckInput } from "../../../src/models/workflows/i9-check/input.js";
import { ReadEmploymentCandidates } from "../../../src/models/workflows/i9-check/read-employment-candidates.js";
import { ReadRetentionRow } from "../../../src/models/workflows/i9-check/read-retention-row.js";
import { deriveCheckpointOutputDigest } from "../../../src/models/run/result.js";
import { i9RetentionRow } from "../../../src/rules/i9-check/retention.js";
import { resolveStartStepOmissions } from "../../../src/backend/runs/start/step-selection.js";
import { planStart } from "../../../src/backend/runs/start/plan.js";
import { queuedRunFixture } from "../../support/fixtures/backend/queued-run.js";
import { executeClaimedRun } from "../../../src/backend/runtime/execution/run-executor.js";
import { createOperatorProjection, createOperatorRunDetail } from "../../../src/backend/app/composition/dashboard/operator.js";
import { buildRunDetail } from "../../../src/backend/runs/queries/run-detail.js";
import { runQueuedSpanEvent } from "../../../src/backend/runs/commands/run-queued-span.js";
import { createTransactionHistory } from "../../../src/backend/storage/sqlite/transaction-history.js";
import { createTimelineEmitter } from "../../../src/backend/storage/events/timeline-emitter.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../src/backend/systems/ucpath/driver/fake.js";
import { createRunExecutorTestWorld } from "../../support/helpers/backend/run-executor-world.js";
import { sessionFactoryHarness } from "../../support/helpers/phase1f-executor-harness.js";
import { testRunService, testWorkerPorts } from "../../support/fixtures/run-lifecycle-fixtures.js";
import { sequentialIdFactory } from "../../support/fixtures/phase1f-run-fixtures.js";
import { CONFIG_SNAPSHOT } from "../../support/fixtures/phase1c-contract-fixtures.js";

const descriptor = i9CheckModule.descriptor;
const FOUND = { status: "found", eid: "10000002", name: "Typed, Person" };
const NOT_FOUND = { status: "not-found", eid: null, name: null };
const CANDIDATE = { emplId: "10000003", name: "Candidate, Typed", hireDate: "06/16/2020" };
const EMPTY = { emplId: null, name: null, hireDate: null };
const world = createRunExecutorTestWorld();
afterEach(world.cleanup);

async function runCase(options: Readonly<{ useMatch: boolean; entries?: StepOmissions; matchFound?: boolean; results?: Parameters<typeof i9Search>[0]; failure?: boolean }>) {
  let matches = 0, searches = 0;
  const input = I9CheckInput.parse({ ...i9CheckInput, person: { ...i9CheckInput.person, ...(options.useMatch ? { dob: "2000-01-15" } : {}) } });
  const sessions = sessionFactoryHarness({ ucpath: (): UcpathPersonOrgDriver => ({ ...createDeterministicUcpathPersonOrgDriver(),
    async searchPersonMatch(request) {
      matches++;
      assert.deepEqual(request, { firstName: "Person", lastName: "Example", dob: "01/15/2000" });
      const hit = { emplId: i9Candidate.emplId, name: i9Candidate.name };
      return { hits: [hit], confirmed: options.matchFound ? [hit] : [], dropped: [] };
    },
    async searchPersonOrg(request) {
      searches++;
      assert.deepEqual(request, { kind: "by-name", name: input.person.name, keepNonHdh: true });
      return i9Search(options.results);
    },
  }) });
  const harness = await world.executorHarness({ descriptor, sessions });
  const { database, clock, path } = harness.authority;
  const stepOmissions = resolveStartStepOmissions(descriptor, descriptor.timeline.map(step => step.key).filter(key => !options.entries?.some(entry => entry.step === key)), options.entries);
  const plan = planStart({ authority: database, clock, ids: sequentialIdFactory("f"), planTtlMs: 600000 }, {
    descriptor, submissions: [input], dryRun: false, priority: "bulk", shape: "operation-member", plannedBy: "local-operator",
    configFingerprint: CONFIG_SNAPSHOT.fingerprint, configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId, stepOmissions,
  });
  assert.equal(plan.refused.length, 0);
  const entry = plan.planned[0]; assert.ok(entry);
  const queued = queuedRunFixture({ descriptor, runId: "22222222-2222-4222-8222-222222222222", itemId: entry.itemId, traceId: "ic-090000-2222",
    rawInput: entry.rawInput, canonicalInput: entry.input, ingressSchemaHash: plan.ingressSchemaHash,
    configFingerprint: plan.configFingerprint, configSnapshotId: plan.configSnapshotId, resolvedInstance: plan.resolvedInstance,
    shape: plan.shape, priority: plan.priority, dryRun: false, stepOmissions: plan.stepOmissions, attempt: 1, runNumber: 1, appVersion: "0.1.0", now: clock.now().toISOString() });
  testWorkerPorts(database, clock, { path, descriptor, poolIndex: 1 });
  const slot = database.authority.workerSlots.list(descriptor.id).find(member => member.poolIndex === 1 && member.retiredAt === null); assert.ok(slot);
  database.authority.runs.enqueue(queued);
  createTimelineEmitter({ repository: database.authority.timelineEvents, clock }).emit(runQueuedSpanEvent({ run: queued, actorId: ActorIdSchema.parse("local-operator"), title: input.person.name, subtitle: "I-9 retention check" }));
  const claimed = database.authority.runs.claimNext({ workflow: descriptor.id, workerId: slot.workerId, now: clock.now().toISOString() });
  assert.equal(claimed.state, "claimed");
  if (claimed.state !== "claimed") throw new Error("Fixture claim failed");
  const result = await executeClaimedRun(harness.deps, { run: claimed.run, claim: { workerId: slot.workerId, claimGeneration: claimed.run.claimGeneration }, signal: world.SIGNAL });
  const failures = database.authority.failures.listByRun(queued.envelope.runId);
  assert.equal(result.state, options.failure ? "failed" : "done", JSON.stringify(failures));
  const terminal = database.authority.runResults.get(queued.envelope.runId);
  const checkpoints = database.authority.runCheckpoints.listByItem(descriptor.id, entry.itemId).filter(row => row.runId === queued.envelope.runId);
  const served = () => {
    const reader = testRunService(database, clock);
    const descriptors = { resolve: (id: string) => id === descriptor.id ? descriptor : undefined };
    const projection = createOperatorProjection({ database, stateRoot: harness.authority.stateRoot, clock, reader, appVersion: "0.1.0",
      descriptorSetHash: FingerprintSchema.parse("a".repeat(64)), ledger: createTransactionHistory(database.authority), descriptors });
    projection.ingestFromTimeline();
    const deps = createOperatorRunDetail({ database, stateRoot: harness.authority.stateRoot, projection, runReader: reader,
      canonical: { database, reader, descriptors } });
    return buildRunDetail(deps, queued.envelope.runId);
  };
  return { input, matches, searches, queued, terminal, failures, checkpoints, served, output: options.failure ? undefined : ReadRetentionRow.output.parse(terminal?.result.value) };
}

function produced(step: string, facts: JsonObject) {
  const spec = descriptor.stepOmissions?.find(entry => entry.step === step);
  assert.ok(spec, `${step} declares typed values`);
  return Object.entries(spec.produces).map(([id, produce]) => {
    const node = descriptorRuntimeNodes(descriptor).find(entry => String(entry.id) === id);
    assert.ok(node?.kind === "task");
    const value = produce({ facts, scope: { input: i9CheckInput, outputs: {} }, assertedAt: IsoInstantSchema.parse("2026-11-01T00:00:00.000Z") });
    return [id, node.uses.output.parse(value)];
  });
}

describe("I-9 typed outputs", () => {
  it("produces schema-valid local values for both identity arms and both candidate arms, without producing a search", () => {
    assert.deepEqual(produced("person-match", FOUND), [
      ["match-outcome", { identity: { status: "found", eid: FOUND.eid, name: FOUND.name }, shouldLookup: false }],
      ["initial-candidates", { candidates: [] }],
    ]);
    assert.deepEqual(produced("person-match", NOT_FOUND), [
      ["match-outcome", { identity: { status: "not-found", candidateCount: 0 }, shouldLookup: true }],
      ["initial-candidates", { candidates: [] }],
    ]);
    assert.deepEqual(produced("person-lookup", CANDIDATE), [["employment-candidates", { candidates: [CANDIDATE] }]]);
    assert.deepEqual(produced("person-lookup", EMPTY), [["employment-candidates", { candidates: [] }]]);
  });

  it("refuses partial candidate fields and a found identity missing either required field at plan time", () => {
    const selected = descriptor.timeline.map(step => step.key);
    for (const [step, facts] of [["person-match", { ...FOUND, eid: null }], ["person-match", { ...FOUND, name: null }],
      ...Object.keys(EMPTY).map(key => ["person-lookup", { ...CANDIDATE, [key]: null }] as const)] as const) {
      assert.throws(() => resolveStartStepOmissions(descriptor, selected.filter(key => key !== step), [{ step, facts }]), /omission facts are invalid at:/u);
    }
    assert.equal(ReadEmploymentCandidates.input.safeParse({}).success, false);
    assert.equal(ReadEmploymentCandidates.input.safeParse({ search: undefined }).success, false);
  });
});

describe.each([false, true])("I-9 switch combinations, useMatch=%s", useMatch => {
  const cases: readonly Readonly<{ name: string; entries?: StepOmissions; eid: string; searches: number }>[] = [
    { name: "both on", entries: undefined, eid: "10000001", searches: 1 },
    { name: "match on, dates typed", entries: [{ step: "person-lookup", facts: CANDIDATE }], eid: CANDIDATE.emplId, searches: useMatch ? 0 : 1 },
    { name: "match on, dates blank", entries: [{ step: "person-lookup", facts: EMPTY }], eid: "", searches: useMatch ? 0 : 1 },
    { name: "match found typed, dates on", entries: [{ step: "person-match", facts: FOUND }], eid: FOUND.eid, searches: 0 },
    { name: "match found typed, dates typed", entries: [{ step: "person-match", facts: FOUND }, { step: "person-lookup", facts: CANDIDATE }], eid: FOUND.eid, searches: 0 },
    { name: "match not found typed, dates on", entries: [{ step: "person-match", facts: NOT_FOUND }], eid: "10000001", searches: 1 },
    { name: "both typed, one dated candidate", entries: [{ step: "person-match", facts: NOT_FOUND }, { step: "person-lookup", facts: CANDIDATE }], eid: CANDIDATE.emplId, searches: 0 },
    { name: "both typed, no candidate", entries: [{ step: "person-match", facts: NOT_FOUND }, { step: "person-lookup", facts: EMPTY }], eid: "", searches: 0 },
  ];
  it.each(cases)("$name: uses the selected values and records every typed field as operator evidence", async ({ entries, eid, searches }) => {
    const f = await runCase({ useMatch, entries });
    assert.ok(f.output);
    assert.equal(f.output.row.ucpathEmplId, eid);
    assert.equal(f.output.row.foundInUcpath, eid === "" ? "Not found in UCPath" : "Yes");
    assert.equal(f.searches, searches);
    assert.equal(f.matches, useMatch && !entries?.some(entry => entry.step === "person-match") ? 1 : 0);
    if (eid === FOUND.eid) assert.deepEqual(f.output.identity, { status: "found", eid, name: FOUND.name });
    if (eid === CANDIDATE.emplId) assert.deepEqual(f.output.identity, { status: "found", eid, name: CANDIDATE.name });
    const detail = f.served();
    for (const entry of entries ?? []) {
      assert.deepEqual(f.queued.envelope.stepOmissions?.find(stored => stored.step === entry.step)?.facts, entry.facts);
      const fields: readonly (readonly [string, string])[] = entry.step === "person-match"
        ? [["status", "Found in UCPath"], ["eid", "Matched Employee ID"], ["name", "UCPath name"]]
        : [["emplId", "UCPath Employee ID"], ["name", "UCPath name"], ["hireDate", "UCPath hire date"]];
      assert.deepEqual(detail.timeline.steps?.find(step => step.key === entry.step)?.typedValues, {
        title: "Operator-entered values", reading: "Not run, typed by hand",
        fields: fields.map(([key, label]) => ({ key, label, value: entry.facts[key] === null ? "(empty)" : entry.facts[key], mark: "Typed by hand" })),
      });
      const spec = descriptor.stepOmissions?.find(candidate => candidate.step === entry.step); assert.ok(spec);
      for (const nodeId of Object.keys(spec.produces)) {
        if (nodeId === "initial-candidates" && useMatch) {
          assert.ok(!f.checkpoints.some(row => String(row.nodeId) === nodeId));
          continue;
        }
        const checkpoint = f.checkpoints.find(row => String(row.nodeId) === nodeId); assert.ok(checkpoint);
        assert.equal(checkpoint.assertion?.step, entry.step);
        assert.ok(checkpoint.provenance.every(point => point.source === "operator"));
        const node = descriptorRuntimeNodes(descriptor).find(row => String(row.id) === nodeId); assert.ok(node?.kind === "task");
        assert.ok(node.uses.output.safeParse(checkpoint.output.value).success);
      }
      for (const field of spec.form.fields) {
        assert.equal(f.queued.envelope.stepOmissions?.find(stored => stored.step === entry.step)?.labels?.[field.key], field.label);
        if (entry.facts[field.key] === null) continue;
        assert.ok(field.replaces);
        const checkpoint = f.checkpoints.find(row => String(row.nodeId) === field.replaces?.nodeId); assert.ok(checkpoint);
        assert.ok(checkpoint.provenance.some(point => point.source === "operator" && (field.replaces?.path === String(point.path) || field.replaces?.path.startsWith(`${String(point.path)}.`))), field.replaces.path);
      }
      for (const skipped of spec.skips ?? []) assert.ok(!f.checkpoints.some(row => String(row.nodeId) === skipped));
    }
    const asserted = f.checkpoints.filter(row => row.assertion !== undefined).map(row => String(row.nodeId));
    assert.ok(asserted.every(id => !["identifier-match", "initial-name-search", "name-search"].includes(id)));
    const expectedAssertions: [string, string][] = [];
    if (entries?.some(entry => entry.step === "person-match")) {
      expectedAssertions.push(["match-outcome", "person-match"]);
      if (!useMatch) expectedAssertions.push(["initial-candidates", "person-match"]);
    }
    if (entries?.some(entry => entry.step === "person-lookup")) expectedAssertions.push(["employment-candidates", "person-lookup"]);
    assert.ok(f.terminal);
    assert.deepEqual(f.terminal.dependencies.filter(dependency => dependency.state === "asserted").map(dependency => [dependency.nodeId, dependency.step]), expectedAssertions);
    for (const [nodeId, step] of expectedAssertions) {
      const dependency: NonNullable<typeof f.terminal>["dependencies"][number] | undefined = f.terminal.dependencies.find(candidate => String(candidate.nodeId) === nodeId);
      const checkpoint = f.checkpoints.find(candidate => String(candidate.nodeId) === nodeId);
      assert.ok(dependency?.state === "asserted");
      assert.ok(checkpoint?.assertion);
      assert.deepEqual(dependency, { state: "asserted", nodeId, step, assertedAt: checkpoint.assertion.assertedAt,
        outputSchemaHash: checkpoint.output.schemaHash, outputDigest: deriveCheckpointOutputDigest(checkpoint.output) });
    }
  });
});

it.each([{ useMatch: false, matchFound: false }, { useMatch: true, matchFound: false }, { useMatch: true, matchFound: true }])("all switches on keep the fixture identity, tracker row and conditional reads ($useMatch / $matchFound)", async ({ useMatch, matchFound }) => {
  const f = await runCase({ useMatch, matchFound });
  assert.deepEqual(f.output, { identity: { status: "found", eid: "10000001", name: "Example, Person" }, row: {
    recordId: "record-1", employeeName: "Example, Person", ppsEid: "000012345", ucpathEmplId: "10000001", hireDate: "2020-06-15",
    separationDate: "2021-11-01", foundInUcpath: "Yes", action: "Keep", reviewerName: "Example Reviewer", notes: "Shred on 2026-11-02",
  } });
  assert.equal(f.matches, useMatch ? 1 : 0);
  assert.equal(f.searches, matchFound ? 0 : 1);
  assert.equal(f.queued.envelope.stepOmissions, undefined);
  assert.ok(f.checkpoints.every(row => row.assertion === undefined));
});

it("keeps the retention reads and their conditions alongside the generated reference comparison", () => {
  const initialWhen = { kind: "is-false", of: { from: "input", path: "person.useMatch" } };
  const lookupWhen = { kind: "is-true", of: { from: "node", nodeId: "match-outcome", path: "shouldLookup" } };
  assert.deepEqual(descriptorRuntimeNodes(descriptor).filter(node => !String(node.id).startsWith("reference-")).map(node => {
    assert.equal(node.kind, "task");
    if (node.kind !== "task") throw new Error("Expected read-only I-9 node");
    return [String(node.id), String(node.uses.id), node.dependsOn.map(String), node.replay, node.when ?? null];
  }), [
    ["identifier-match", "ucpath/search-person-match", [], "checkpoint", { kind: "is-true", of: { from: "input", path: "person.useMatch" } }],
    ["initial-name-search", "ucpath/search-person-org", [], "checkpoint", initialWhen],
    ["match-outcome", "workflow:i9-check/read-match-outcome", ["identifier-match", "initial-name-search"], "always-rerun", null],
    ["initial-candidates", "workflow:i9-check/read-employment-candidates", ["initial-name-search"], "always-rerun", initialWhen],
    ["name-search", "ucpath/search-person-org", ["match-outcome"], "checkpoint", lookupWhen],
    ["employment-candidates", "workflow:i9-check/read-employment-candidates", ["match-outcome", "name-search"], "always-rerun", lookupWhen],
    ["retention-row", "workflow:i9-check/read-retention-row", ["match-outcome", "initial-candidates", "employment-candidates"], "always-rerun", null],
  ]);
});

it("retention still refuses a missing chosen observation instead of treating it as an empty candidate list", () => {
  const node = descriptorRuntimeNodes(descriptor).find(entry => String(entry.id) === "retention-row"); assert.ok(node?.kind === "task");
  const bound = ReadRetentionRow.input.parse(node.bind({ input: i9CheckInput, outputs: { "match-outcome": { identity: { status: "not-found", candidateCount: 0 }, shouldLookup: false } } }));
  assert.equal(bound.candidates, undefined);
  assert.throws(() => i9RetentionRow(bound), /I-9 name search observation is missing/u);
});

it("uses the typed hire date in the seven-day check while keeping the tracker's hire date from the I-9", async () => {
  const f = await runCase({ useMatch: false, entries: [{ step: "person-lookup", facts: { ...CANDIDATE, hireDate: "06/30/2020" } }] });
  assert.deepEqual(f.output?.identity, { status: "not-found", candidateCount: 1 });
  assert.equal(f.output?.row.hireDate, "2020-06-15");
  assert.equal(f.output?.row.action, "Shred");
});

it("projects every appointment in order without deduplication, trimming or date parsing", async () => {
  const f = await runCase({ useMatch: false, results: [
    { ...i9Candidate, startDate: " 06/15/2020 ", effectiveDate: "01/01/1999" },
    { ...i9Candidate, startDate: "", effectiveDate: "06/16/2020" },
    { ...i9Candidate, emplId: "10000002", name: "Second, Person", startDate: "   ", effectiveDate: "01/01/1999" },
  ] });
  const checkpoint = f.checkpoints.find(row => String(row.nodeId) === "initial-candidates"); assert.ok(checkpoint);
  assert.deepEqual(ReadEmploymentCandidates.output.parse(checkpoint.output.value).candidates, [
    { emplId: "10000001", name: "Example, Person", hireDate: " 06/15/2020 " },
    { emplId: "10000001", name: "Example, Person", hireDate: "06/16/2020" },
    { emplId: "10000002", name: "Second, Person", hireDate: "01/01/1999" },
  ]);
  assert.equal(f.output?.identity.status, "found");
});

it.each([
  { startDate: "", effectiveDate: "01/01/1999", status: "not-found" },
  { startDate: "   ", effectiveDate: "06/15/2020", status: "found" },
  { startDate: "01/01/1999", effectiveDate: "06/15/2020", status: "not-found" },
  { startDate: "02/30/2020", effectiveDate: "06/15/2020", status: "failed" },
  { startDate: "", effectiveDate: "", status: "not-found" },
])("retains date precedence and refusal for $startDate / $effectiveDate", async ({ startDate, effectiveDate, status }) => {
  const f = await runCase({ useMatch: false, results: [{ ...i9Candidate, startDate, effectiveDate }], failure: status === "failed" });
  if (status === "failed") assert.equal(f.failures[0]?.code, "I9_CHECK_DATA_INVALID");
  else {
    assert.equal(f.output?.identity.status, status);
    if (f.output?.identity.status === "not-found") assert.equal(f.output.identity.candidateCount, 1);
  }
});
