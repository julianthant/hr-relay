import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, it, vi } from "vitest";
import { createOperatorProjection } from "../../../src/backend/app/composition/dashboard/queue.js";
import { createOperatorRunDetail } from "../../../src/backend/app/composition/dashboard/run-detail.js";
import { createCommandKernel } from "../../../src/backend/runs/commands/command-kernel.js";
import { buildRunDetail } from "../../../src/backend/runs/queries/run-detail.js";
import { buildRunLogsWhole } from "../../../src/backend/runs/queries/run-logs.js";
import { createWriteResolutionExecutor } from "../../../src/backend/runtime/writes/write-recovery.js";
import { createReceiptService } from "../../../src/backend/runs/trust/receipt-service.js";
import { createWriteSequencer } from "../../../src/backend/runtime/writes/write-sequencer.js";
import { createNoteTimelineWriter } from "../../../src/backend/storage/events/note-timeline-writer.js";
import { createTransactionHistory } from "../../../src/backend/storage/sqlite/transaction-history.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../src/backend/systems/ucpath/driver/fake.js";
import { deterministicPayPathOperations } from "../../../src/backend/systems/ucpath/driver/paypath-fake.js";
import { projectRunLogs } from "../../../src/dashboard/state/run-wiring-adapter.js";
import { logPlainText } from "../../../src/dashboard/surfaces/run-detail/logs/log-feed-model.js";
import type { RunRecord } from "../../../src/models/run/record.js";
import { UcpathPayPathReadSchema } from "../../../src/models/ui/ucpath-paypath.js";
import { UcpathTransactionFindingSchema } from "../../../src/models/ui/ucpath-transaction-findings.js";
import { WorkStudyResultSchema } from "../../../src/models/workflows/work-study/result.js";
import { FingerprintSchema, LOCAL_OPERATOR_ACTOR_ID } from "../../../src/rules/identity/ids.js";
import type { Clock } from "../../../src/rules/time/clock.js";
import { compileWorkflow } from "../../../src/workflow-kit/workflow-definition.js";
import { workStudyWorkflow } from "../../../src/workflows/work-study/workflow.js";
import { NO_INTAKE_PROJECTIONS, UNSTORED_CONFIG_IDENTITY, UNWIRED_INTAKE_PARSER } from "../../support/fixtures/intake-kernel-seams.js";
import { testRunContinuation, testRunLifecycle, testRunService } from "../../support/fixtures/run-lifecycle-fixtures.js";
import { canonicalChildExecution } from "../../support/helpers/backend/canonical-child-execution.js";
import { createReferenceCheckWriteWorld } from "../../support/helpers/backend/reference-check-write-world.js";
import { createRunExecutorTestWorld } from "../../support/helpers/backend/run-executor-world.js";
import { unusedWorkerPool } from "../../support/helpers/backend/unused-worker-pool.js";
import { sessionFactoryHarness } from "../../support/helpers/phase1f-executor-harness.js";
import type { AuthorityDatabase } from "../../support/helpers/synthetic-storage-admission.js";

const build = vi.hoisted((): { id?: string } => ({}));
vi.mock("../../../src/backend/runtime/build-id.js", async importOriginal => {
  const original = await importOriginal<typeof import("../../../src/backend/runtime/build-id.js")>();
  return { ...original, currentBuildId: () => build.id ?? original.currentBuildId() };
});

const world = createRunExecutorTestWorld();
const referenceWorld = createReferenceCheckWriteWorld();
afterEach(world.cleanup);
afterEach(referenceWorld.cleanup);
afterEach(() => { delete build.id; });
const compiled = compileWorkflow(workStudyWorkflow);
const INPUT = { emplId: "10000001", effectiveDate: "08/03/2026" };
const COMMENTS = "Updated pool id to F per work study award 08/03/2026";
const read = UcpathPayPathReadSchema.parse({
  pageStateId: "ucpath.paypath.position-data-ready", observedAt: "2026-08-01T12:00:00.000Z", emplId: "10000001", displayedName: "Lee, Jordan",
  position: { effectiveDate: "07/01/2026", positionChangeReason: "", positionPool: "", positionNumber: "40012345" },
});
const PLAN = {
  emplId: "10000001", name: "Lee, Jordan", effectiveDate: "08/03/2026", positionChangeReason: "JRL", positionPool: "F", comments: COMMENTS,
  current: { effectiveDate: "07/01/2026", positionChangeReason: "", positionPool: "", positionNumber: "40012345" },
};
const filed = (overrides: Readonly<Record<string, string>> = {}) => UcpathTransactionFindingSchema.parse({
  transactionId: "T008000001", emplId: "10000001", action: "Data Chg", approvalStatus: "Pending", startDate: "08/03/2026",
  displayedName: "Lee, Jordan", submittedAt: "08/02/26 09:00:00.000000AM", detailVerified: true, ...overrides,
});

type StartSelection = Pick<Parameters<ReturnType<typeof canonicalChildExecution>["start"]>[2], "selectedStepKeys" | "stepOmissions">;

async function workStudyRun(options: Parameters<typeof deterministicPayPathOperations>[0] & { dryRun?: boolean; selection?: StartSelection } = {}) {
  const { dryRun, selection, ...paypathOptions } = options;
  const paypath = deterministicPayPathOperations({ read, ...paypathOptions });
  const sessions = sessionFactoryHarness({ ucpath: () => ({
    ...createDeterministicUcpathPersonOrgDriver(), ...paypath, readTransactionFindings: paypath.readTransactionFindings, read: paypath.read,
  }) });
  const h = await world.executorHarness({ descriptor: compiled.descriptor, sessions });
  const { database, clock, path } = h.authority;
  const sequencer = createWriteSequencer({ lifecycle: testRunLifecycle(database, clock), stores: h.deps.stores, authority: database,
    sessions: h.manager, emitter: h.deps.emitter, clock, ids: { uuid: randomUUID }, scheduler: h.scheduler, taskDeadlineMs: 60_000,
    operator: "local-operator", log: h.deps.log });
  const taskNotes = createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock });
  const execution = canonicalChildExecution({ ...h.deps, taskNotes, writeSequencer: sequencer }, database, path,
    id => id === compiled.descriptor.id ? compiled.descriptor : undefined);
  const runOnce = async (runDryRun: boolean) => {
    const run = execution.start(compiled.descriptor, INPUT, { dryRun: runDryRun, ...selection });
    const { run: settled } = await execution.execute(run, world.SIGNAL);
    const runId = run.envelope.runId;
    return {
      runId, failures: database.authority.failures.listByRun(runId), intents: database.authority.writeIntents.listByRun(runId),
      stored: database.authority.runResults.get(runId), lifecycle: settled?.lifecycle.state,
    };
  };
  const first = await runOnce(dryRun ?? false);
  const commits = () => paypath.events.filter(event => event.startsWith("commit:")).length;
  const history = (runId: string) => {
    const date = clock.now().toISOString().slice(0, 10);
    return createTransactionHistory(database.authority).query({ from: date, to: date, runId }).rows;
  };
  return { ...first, clock, database, execution, paypath, commits, history, stateRoot: h.authority.stateRoot, again: () => runOnce(false) };
}

it("records the transaction as done outside Relay with no PayPath prepare or write intent", async () => {
  const { descriptor } = compiled;
  const f = await workStudyRun({ selection: { selectedStepKeys: ["ucpath-auth", "reference-check"], stepOmissions: [{ step: "transaction", facts: {} }] } });
  assert.deepEqual(f.failures.map(failure => failure.summary), []);
  assert.deepEqual(f.paypath.events, ["read:paypath:10000001"]);
  assert.deepEqual(f.intents, []);
  assert.deepEqual(f.stored?.result.value, { state: "omitted", step: "transaction" });

  const { database, stateRoot, clock, runId } = f;
  const reader = f.execution.lifecycle;
  const descriptors = { resolve: (id: string) => id === descriptor.id ? descriptor : undefined };
  const projection = createOperatorProjection({ database, stateRoot, clock, reader, appVersion: "0.1.0",
    descriptorSetHash: FingerprintSchema.parse("a".repeat(64)), ledger: createTransactionHistory(database.authority), descriptors });
  projection.ingestFromTimeline();
  const deps = createOperatorRunDetail({ database, stateRoot, projection, runReader: reader, canonical: { database, reader, descriptors } });
  const detail = buildRunDetail(deps, runId);
  const run = database.authority.runs.get(runId);
  assert.ok(run);
  const section = buildRunLogsWhole(deps, runId, projection.runFold(runId), run);
  const projected = projectRunLogs({ detail, logs: section.payload, sections: [], unavailableEvidence: [] }, { artifactUrl: () => "unused" });
  const transaction = projected.steps.find(step => step.title === "Submit work-study transaction");
  assert.ok(transaction);
  assert.match(logPlainText([transaction]), /Done outside Relay/u);
});

it("uses the typed PayPath values to plan and file without the automatic position read", async () => {
  const facts = { emplId: INPUT.emplId, displayedName: "Fixture, PayPath", positionNumber: "40012346",
    effectiveDate: "07/02/2026", positionChangeReason: null, positionPool: "A" };
  const f = await workStudyRun({ observedName: facts.displayedName, selection: {
    selectedStepKeys: ["reference-check", "transaction"], stepOmissions: [{ step: "ucpath-auth", facts }],
  } });
  assert.deepEqual(f.failures.map(failure => failure.summary), []);
  assert.equal(f.paypath.events.some(event => event.startsWith("read:paypath:")), false);
  assert.equal(f.commits(), 1);
  assert.deepEqual(WorkStudyResultSchema.parse(f.stored?.result.value).plan, { ...PLAN, name: "Fixture, PayPath",
    current: { effectiveDate: "07/02/2026", positionChangeReason: "", positionPool: "A", positionNumber: "40012346" } });
  assert.equal(f.intents[0]?.idempotencyKey, "ucpath:paypath-work-study|10000001|08/03/2026|40012346");
});

it("refuses a typed PayPath Employee ID for a different employee before any UCPath call", async () => {
  const f = await workStudyRun({ selection: { selectedStepKeys: ["reference-check", "transaction"], stepOmissions: [{ step: "ucpath-auth",
    facts: { emplId: "10000002", displayedName: "Fixture, Other", positionNumber: "40012346", effectiveDate: null, positionChangeReason: null, positionPool: null },
  }] } });
  assert.match(f.failures[0]?.summary ?? "", /typed Employee ID is not the run's Employee ID/u);
  assert.deepEqual(f.paypath.events, []);
  assert.deepEqual(f.intents, []);
});

it("work-study/planned-transaction — with Dry run on, reads PayPath, plans and fills the transaction, and saves nothing", async () => {
  const f = await workStudyRun({ dryRun: true });
  assert.deepEqual(f.failures.map(failure => failure.summary), []);
  assert.deepEqual(f.paypath.events, ["read:paypath:10000001", "read:transactions:10000001", "prepare:paypath:10000001"]);
  assert.equal(f.commits(), 0);
  assert.deepEqual(f.intents, []);
  assert.deepEqual(f.database.authority.writeIntents.countDryRunEvidenceByRun(f.runId), { writeIntents: 0, writeAttempts: 0, confirmedOperations: 0 });
  const itemId = f.database.authority.runs.get(f.runId)?.envelope.itemId;
  assert.ok(itemId);
  assert.deepEqual(f.database.authority.runCheckpoints.latest("work-study", itemId, "transaction-plan")?.output.value, PLAN, "the plan node ran and checkpointed the full plan");
  assert.equal(f.database.authority.runCheckpoints.latest("work-study", itemId, "save-transaction"), undefined, "no transaction checkpoint");
  assert.deepEqual(f.history(f.runId), []);
});

it("work-study/planned-transaction — with Dry run on, a person with a transaction already on the date is refused before staging", async () => {
  const f = await workStudyRun({ dryRun: true, rows: [filed()] });
  assert.match(f.failures[0]?.summary ?? "", /preview probe .* is indeterminate; the real run would refuse to fence or click here/u);
  assert.deepEqual(f.paypath.events, ["read:paypath:10000001", "read:transactions:10000001"]);
  assert.deepEqual(f.database.authority.writeIntents.countDryRunEvidenceByRun(f.runId), { writeIntents: 0, writeAttempts: 0, confirmedOperations: 0 });
});

it("work-study/verified-save — files once, proves the receipt by reading the transaction back, and reports the person as saved", async () => {
  const f = await workStudyRun();
  assert.deepEqual(f.failures.map(failure => failure.summary), []);
  assert.deepEqual(f.paypath.events, [
    "read:paypath:10000001", "read:transactions:10000001", "prepare:paypath:10000001", "commit:paypath:10000001",
    "read:transactions:10000001", "read:transactions:10000001",
  ], "PayPath read, duplicate probe, staging, one Save, the commit's read-back and the independent verifier");
  assert.ok(f.stored);
  assert.deepEqual(WorkStudyResultSchema.parse(f.stored.result.value), { state: "saved", plan: PLAN, receipt: {
    kind: "ucpath-paypath-work-study", emplId: "10000001", effectiveDate: "08/03/2026", transactionId: "T009000001", action: "Data Chg",
    approvalStatus: "Pending", displayedName: "Lee, Jordan", source: "ss-smart-hr-detail-read",
  } });
  assert.deepEqual(f.intents.map(intent => intent.status), ["committed"]);
  assert.equal(f.intents[0]?.idempotencyKey, "ucpath:paypath-work-study|10000001|08/03/2026|40012345");
  assert.equal(f.history(f.runId).length, 1);
  const receipts = createReceiptService({ database: f.database, runReader: f.execution.lifecycle, descriptors: [compiled.descriptor] });
  assert.equal(receipts.ensureReceipt(f.runId).result, "verified-done");

  const again = await f.again();
  assert.equal(f.commits(), 1, "the settled write is replayed from its checkpoint, never filed again");
  assert.deepEqual(again.intents, []);
  assert.ok(again.stored);
  assert.equal(WorkStudyResultSchema.parse(again.stored.result.value).receipt.transactionId, "T009000001");
});

it("work-study/already-filed — a person who already has a transaction on the effective date is refused before the Save, not filed twice", async () => {
  const f = await workStudyRun({ rows: [filed(), filed({ transactionId: "T008000002", startDate: "07/01/2026" })] });
  assert.match(f.failures[0]?.summary ?? "", /pre-write probe .* is indeterminate; refusing to fence or click/u);
  assert.equal(f.paypath.events.some(event => event.startsWith("prepare:")), false, "nothing is staged once the probe finds the date taken");
  assert.equal(f.commits(), 0);
  assert.deepEqual(f.intents, []);
  assert.equal(WorkStudyResultSchema.safeParse(f.stored?.result.value).success, false, "a refused person has no saved result");
  assert.deepEqual(f.history(f.runId), []);
});

it("work-study/unknown — a Save whose read-back shows another kind of transaction on the date parks, never reported saved", async () => {
  const f = await workStudyRun({ filedAction: "Terminatn" });
  assert.equal(f.commits(), 1);
  assert.deepEqual(f.intents.map(intent => intent.status), ["parked"]);
  assert.equal(f.lifecycle, "parked-write");
  assert.equal(f.stored, undefined);
});

for (const submit of ["answer-lost", "nothing-filed", "alert"] as const) {
  it(`work-study/unknown — a Save whose answer is ${submit} parks as unknown, and a second run never presses Save again`, async () => {
    const f = await workStudyRun({ submit });
    assert.equal(f.commits(), 1);
    assert.deepEqual(f.intents.map(intent => intent.status), ["parked"]);
    assert.equal(f.lifecycle, "parked-write");
    assert.equal(f.stored, undefined, "an unknown Save has no result");
    assert.deepEqual(f.history(f.runId), []);

    await assert.rejects(f.again(), /active-run-exists/u, "the parked person cannot be started again");
    assert.equal(f.commits(), 1);
    assert.deepEqual(f.database.authority.writeIntents.listByRun(f.runId).map(intent => intent.status), ["parked"]);
  });
}

function requestPayPathRecheck(database: AuthorityDatabase, clock: Clock, parked: RunRecord) {
  assert.ok(parked.lifecycle.state === "parked-write");
  const intent = database.authority.writeIntents.get(parked.lifecycle.writeIntentId);
  assert.ok(intent?.status === "parked");
  const descriptors = { resolve: (id: string) => id === compiled.descriptor.id ? compiled.descriptor : undefined };
  const ids = { uuid: randomUUID };
  const kernel = createCommandKernel({
    authority: database, lifecycle: testRunService(database, clock), clock, ids, appVersion: "0.1.0",
    descriptors, configIdentity: UNSTORED_CONFIG_IDENTITY, intakeParser: UNWIRED_INTAKE_PARSER,
    intakeProjections: NO_INTAKE_PROJECTIONS, workerRuntime: { pool: unusedWorkerPool() },
    writeResolution: createWriteResolutionExecutor({ ids, descriptors,
      continuation: testRunContinuation(database, clock) }),
  });
  const result = kernel.execute({
    commandId: randomUUID(), requestedAt: clock.now().toISOString(), requestedBy: LOCAL_OPERATOR_ACTOR_ID,
    source: "dashboard", family: "run", type: "recheck-write",
    target: { runId: parked.envelope.runId, expectedVersion: parked.version, writeIntentId: intent.writeIntentId,
      intentGeneration: intent.generation, writeAttemptId: intent.currentAttemptId, bindingProofDigest: intent.bindingProofDigest },
    payload: { occurrenceKeyDigest: intent.idempotencyKeyDigest },
  });
  assert.equal(result.state, "applied");
}

it.each(["answer-lost", "nothing-filed", "unrelated-change"] as const)("rechecks a parked PayPath Save in the %s case without clicking again", async scenario => {
  const f = await workStudyRun({ submit: scenario === "unrelated-change" ? "nothing-filed" : scenario });
  const [intent] = f.intents;
  const parked = f.database.authority.runs.get(f.runId);
  assert.ok(intent?.status === "parked" && parked?.lifecycle.state === "parked-write");
  assert.equal(f.commits(), 1);
  const attempt = f.database.authority.writeAttempts.get(intent.currentAttemptId);
  assert.ok(attempt);
  if (scenario === "unrelated-change") f.paypath.rows.push(filed({ submittedAt: "08/03/26 11:00:00.000000AM" }));
  requestPayPathRecheck(f.database, f.clock, parked);
  const before = f.paypath.events.length;
  const report = await f.execution.execute(parked, world.SIGNAL);
  assert.deepEqual(f.paypath.events.slice(before), ["read:transactions:10000001"], JSON.stringify({
    outcomes: report.outcomes, failures: f.database.authority.failures.listByRun(f.runId),
  }));
  assert.equal(f.commits(), 1);
  assert.deepEqual(f.database.authority.writeAttempts.listByIntent(intent.writeIntentId), [attempt]);
  const after = f.database.authority.writeIntents.get(intent.writeIntentId);
  assert.equal(report.outcomes[0]?.state, "parked-write");
  assert.ok(after?.status === "parked" && after.recheck === undefined);
  assert.equal(f.database.authority.runResults.get(f.runId), undefined);
  assert.deepEqual(f.history(f.runId), []);
});

it("rechecks a parked PayPath Save after a compatible build change without clicking again", async () => {
  const paypath = deterministicPayPathOperations({ read, submit: "answer-lost" });
  const sessions = sessionFactoryHarness({ ucpath: () => ({ ...createDeterministicUcpathPersonOrgDriver(), ...paypath }) });
  const f = await referenceWorld.fixture(compiled.descriptor, sessions);
  const reference = f.spreadsheet("Fall roster", "Awards", ["eid"], [["10000009"]]);
  const review = await f.execute(f.start(INPUT, [reference]));
  assert.equal(review.lifecycle.state, "parked-gate");
  assert.equal(f.continueAnyway(review).state, "applied");
  const parked = await f.execute(review);
  assert.ok(parked.lifecycle.state === "parked-write");
  const intent = f.database.authority.writeIntents.get(parked.lifecycle.writeIntentId);
  assert.ok(intent?.status === "parked");
  const attempt = f.database.authority.writeAttempts.get(intent.currentAttemptId);
  assert.ok(attempt);
  assert.equal(paypath.events.filter(event => event.startsWith("commit:")).length, 1);

  build.id = "b".repeat(64);
  assert.notEqual(parked.envelope.buildId, build.id);
  requestPayPathRecheck(f.database, f.clock, parked);
  assert.equal(f.current(parked).envelope.buildId, parked.envelope.buildId);
  const before = paypath.events.length;
  const checked = await f.execute(parked);
  assert.deepEqual(paypath.events.slice(before), ["read:transactions:10000001"],
    JSON.stringify(f.database.authority.failures.listByRun(parked.envelope.runId)));
  assert.ok(checked.lifecycle.state === "parked-write" && checked.lifecycle.writeIntentId === intent.writeIntentId);
  assert.deepEqual(f.database.authority.writeAttempts.listByIntent(intent.writeIntentId), [attempt]);
  const after = f.database.authority.writeIntents.get(intent.writeIntentId);
  assert.ok(after?.status === "parked" && after.recheck === undefined);
  assert.equal(f.database.authority.runResults.get(parked.envelope.runId), undefined);
  assert.equal(f.database.authority.writeIntents.getPublication(intent.writeIntentId), undefined);
});

it("refuses a new PayPath Save approved under an earlier build", async () => {
  const paypath = deterministicPayPathOperations({ read });
  const sessions = sessionFactoryHarness({ ucpath: () => ({ ...createDeterministicUcpathPersonOrgDriver(), ...paypath }) });
  const f = await referenceWorld.fixture(compiled.descriptor, sessions);
  const started = f.start(INPUT, []);
  build.id = "b".repeat(64);
  assert.notEqual(started.envelope.buildId, build.id);

  const refused = await f.execute(started);
  assert.ok(refused.lifecycle.state === "terminal" && refused.lifecycle.outcome === "failed");
  assert.deepEqual(f.database.authority.failures.listByRun(started.envelope.runId).map(failure => failure.code), ["WRITE_BUILD_CHANGED"]);
  assert.deepEqual(paypath.events, ["read:paypath:10000001"]);
  assert.deepEqual(f.database.authority.writeIntents.listByRun(started.envelope.runId), []);
});

it("rechecks a parked PayPath Save after the run reused an earlier workbook reference check", async () => {
  const paypath = deterministicPayPathOperations({ read, submit: "answer-lost" });
  const sessions = sessionFactoryHarness({ ucpath: () => ({ ...createDeterministicUcpathPersonOrgDriver(), ...paypath }) });
  const f = await referenceWorld.fixture(compiled.descriptor, sessions);
  const reference = f.spreadsheet("Fall roster", "Awards", ["eid"], [[INPUT.emplId]]);
  const preview = await f.execute(f.start(INPUT, [reference], true));
  assert.equal(preview.lifecycle.state, "terminal");
  const parked = await f.execute(f.start(INPUT, [reference]));
  assert.equal(parked.lifecycle.state, "parked-write");
  assert.equal(paypath.events.filter(event => event.startsWith("commit:")).length, 1);
  const initialReplay = f.events(parked).find(event => event.payload.kind === "checkpoint-replayed"
    && event.payload.checkpoint.nodeId === "reference-check" && event.payload.checkpoint.runId === preview.envelope.runId);
  assert.ok(initialReplay?.payload.kind === "checkpoint-replayed");
  requestPayPathRecheck(f.database, f.clock, parked);
  const before = paypath.events.length;
  const checked = await f.execute(parked);
  assert.deepEqual(paypath.events.slice(before), ["read:transactions:10000001"],
    JSON.stringify(f.database.authority.failures.listByRun(parked.envelope.runId)));
  assert.equal(checked.lifecycle.state, "parked-write");
  const checkedClaimGeneration: number = checked.claimGeneration;
  const recheckReplay = f.events(checked).find(event => event.payload.kind === "checkpoint-replayed"
    && event.payload.checkpoint.nodeId === "reference-check" && event.payload.claimGeneration === checkedClaimGeneration);
  assert.ok(recheckReplay?.payload.kind === "checkpoint-replayed");
  assert.deepEqual(recheckReplay.payload.checkpoint, initialReplay.payload.checkpoint);
  const intent = f.database.authority.writeIntents.get(parked.lifecycle.writeIntentId);
  assert.ok(intent?.status === "parked" && intent.recheck === undefined);
  assert.equal(f.database.authority.runResults.get(parked.envelope.runId), undefined);
});

const PROBE_UNKNOWN = /pre-write probe .* is indeterminate; refusing to fence or click/u;
it.each<[string, Parameters<typeof deterministicPayPathOperations>[0], RegExp]>([
  ["a value PayPath did not keep", { stagedValues: { positionPool: "" } }, /did not keep a work-study value/u],
  ["another person on the staged page", { observedName: "Other, Person" }, /staged-page subject does not match commit-input subject — subject mismatch, zero fence, zero click/u],
  ["an unreadable transaction search", { findingsUnreadable: true }, PROBE_UNKNOWN],
  ["two work-study transactions on the effective date", { rows: [filed(), filed({ transactionId: "T008000002" })] }, PROBE_UNKNOWN],
  ["a denied work-study transaction on the effective date", { rows: [filed({ approvalStatus: "Denied" })] }, PROBE_UNKNOWN],
  ["another kind of transaction on the effective date", { rows: [filed({ action: "Terminatn" })] }, PROBE_UNKNOWN],
  ["another person's row in the transaction list", { rows: [filed({ startDate: "07/01/2026", displayedName: "Other, Person" })] }, /pre-write probe .* failed; refusing to fence or click/u],
])("refuses %s before the fence with no Save and no write intent", async (_name, options, summary) => {
  const f = await workStudyRun(options);
  assert.match(f.failures[0]?.summary ?? "", summary);
  assert.equal(f.commits(), 0);
  assert.deepEqual(f.intents, []);
  assert.equal(f.lifecycle, "terminal");
  assert.equal(WorkStudyResultSchema.safeParse(f.stored?.result.value).success, false, "a refused person has no saved result");
});
