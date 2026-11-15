import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, it } from "vitest";
import { createReceiptService } from "../../../src/backend/runs/trust/receipt-service.js";
import { createWriteSequencer } from "../../../src/backend/runtime/writes/write-sequencer.js";
import { createNoteTimelineWriter } from "../../../src/backend/storage/events/note-timeline-writer.js";
import { createTransactionHistory } from "../../../src/backend/storage/sqlite/transaction-history.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../src/backend/systems/ucpath/driver/fake.js";
import { deterministicPayPathOperations } from "../../../src/backend/systems/ucpath/driver/paypath-fake.js";
import { UcpathPayPathReadSchema } from "../../../src/models/ui/ucpath-paypath.js";
import { UcpathTransactionFindingSchema } from "../../../src/models/ui/ucpath-transaction-findings.js";
import { WorkStudyResultSchema } from "../../../src/models/workflows/work-study/result.js";
import { compileWorkflow } from "../../../src/workflow-kit/workflow-definition.js";
import { workStudyWorkflow } from "../../../src/workflows/work-study/workflow.js";
import { testRunLifecycle } from "../../support/fixtures/run-lifecycle-fixtures.js";
import { canonicalChildExecution } from "../../support/helpers/backend/canonical-child-execution.js";
import { createRunExecutorTestWorld } from "../../support/helpers/backend/run-executor-world.js";
import { sessionFactoryHarness } from "../../support/helpers/phase1f-executor-harness.js";

const world = createRunExecutorTestWorld();
afterEach(world.cleanup);
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

async function workStudyRun(options: Parameters<typeof deterministicPayPathOperations>[0] & { dryRun?: boolean } = {}) {
  const { dryRun, ...paypathOptions } = options;
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
    const run = execution.start(compiled.descriptor, INPUT, { dryRun: runDryRun });
    await execution.execute(run, world.SIGNAL);
    const runId = run.envelope.runId;
    return {
      runId, failures: database.authority.failures.listByRun(runId), intents: database.authority.writeIntents.listByRun(runId),
      stored: database.authority.runResults.get(runId), lifecycle: database.authority.runs.get(runId)?.lifecycle.state,
    };
  };
  const first = await runOnce(dryRun ?? false);
  const commits = () => paypath.events.filter(event => event.startsWith("commit:")).length;
  const history = (runId: string) => {
    const date = clock.now().toISOString().slice(0, 10);
    return createTransactionHistory(database.authority).query({ from: date, to: date, runId }).rows;
  };
  return { ...first, database, execution, paypath, commits, history, again: () => runOnce(false) };
}

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
