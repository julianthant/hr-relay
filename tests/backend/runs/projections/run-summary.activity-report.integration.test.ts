import { fenceWriteFixture } from "../../../support/helpers/write-fence-fixture.js";
import { join } from "node:path";
import { deriveCanonicalPerson } from "../../../../src/backend/runs/projections/run-summary.js";
import { DeletedRunRecordSchema,type DeletedRunRecord } from "../../../../src/models/run/deleted-run.js";
import { RunLifecycleSchema,RunRecordSchema,type RunRecord } from "../../../../src/models/run/record.js";
import type { RunResultRecord } from "../../../../src/models/run/result.js";
import { FingerprintSchema,RunIdSchema } from "../../../../src/rules/identity/ids.js";
import { activityPersonPseudonymResultRecord,CURRENT_SEPARATIONS_RESULT } from "../../../support/fixtures/integration/activity-person-pseudonym-fixtures.js";
import { inMemoryRunReaderFake } from "../../../support/helpers/canonical-run-reader.js";

import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { ActivityReportWireSchema,type ActivityReportWire } from "../../../../src/models/dashboard/activity.js";
import { RunEvidenceReceiptSchema, type RunEvidenceReceipt } from "../../../../src/models/trust/evidence.js";
import type { AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { fixtureDescriptor } from "../../../support/fixtures/descriptor-fixtures.js";
import { fixtureUuid,ledgerCommitFixture } from "../../../support/fixtures/ledger-projection-fixtures.js";
import {
atDayOffset,
claimEventOf,
cleanReceiptOf,
dayOffsetOf,
failureRecordOf,
instantOffsetOf,
makeWorld,
queuedEventOf as queuedEventBase,
receiptWithWarningsOf,
runEndedEventOf,
runRecordOf as runRecordBase,
uuidOf,
type DashboardWorld,
} from "../../../support/helpers/backend/dashboard-harness.js";
import { personLookupDescriptor,separationsKualiFinalizationDescriptor } from "../../../support/helpers/registered-workflows.js";
import { atomicWriteCheckpoint,seedAtomicWriteOwner } from "../../../support/helpers/timeline-write-fixture.js";

/** C completion contract: projection fixtures still carry a valid terminal settlement. */
function runRecordOf(input: Parameters<typeof runRecordBase>[0]) {
  const lifecycle = RunLifecycleSchema.parse(input.lifecycle ?? {state:"queued"});
  if (lifecycle.state !== "terminal" || !["done","failed"].includes(lifecycle.outcome)) return runRecordBase(input);
  const base = runRecordBase({...input,lifecycle:{state:"queued"}});
  const version = Math.max(2,base.version), claimGeneration = Math.max(1,base.claimGeneration);
  return RunRecordSchema.parse({...base,lifecycle,version,claimGeneration,updatedAt:lifecycle.endedAt,completion:{
    schemaVersion:1,kind:lifecycle.outcome,expectedVersion:version-1,
    claim:{workerId:"activity-fixture-worker",claimGeneration},authorizedAt:lifecycle.endedAt,
    ...(lifecycle.outcome === "done" ? {resultDigest:"a".repeat(64)} : {failureId:lifecycle.failureId}),
  }});
}
function queuedEventOf(w: DashboardWorld, input: Parameters<typeof runRecordBase>[0]) {
  const event = queuedEventBase(w,{...input,lifecycle:{state:"queued"}});
  if (input.lifecycle !== undefined) w.authority.put(runRecordOf({...input,enqueuedAt:input.enqueuedAt ?? w.clock.now().toISOString()}));
  return event;
}

const worlds: DashboardWorld[] = [];
const canonicalResults = new WeakMap<DashboardWorld,Map<string,RunResultRecord>>();
const deletedRuns = new WeakMap<DashboardWorld, Map<string, DeletedRunRecord>>();

function world(...args: Parameters<typeof makeWorld>): DashboardWorld {
  const state = { records: new Map<string, RunRecord>(), deleted: new Map<string, DeletedRunRecord>(), generation: 0 };
  const created = makeWorld({ ...args[0], reader: inMemoryRunReaderFake(state) });
  state.records = created.authority.records;
  deletedRuns.set(created, state.deleted);
  const results = new Map<string,RunResultRecord>();
  Object.assign(created.authority,{canonicalPerson:(runId:string)=> {
    const run=created.authority.records.get(runId);
    if(run===undefined)throw new Error("activity-fixture-run-missing");
    return deriveCanonicalPerson(run,results.get(runId)??null);
  }});
  canonicalResults.set(created,results);
  worlds.push(created);
  return created;
}

afterEach(() => {
  for (const w of worlds.splice(0)) w.dispose();
});


const REGISTRY = {
  resolve: (workflowId: string): AnyWorkflowDescriptor | undefined => {
    if (workflowId === "person-lookup") return personLookupDescriptor;
    if (workflowId === "separations-kuali-finalization") return separationsKualiFinalizationDescriptor;
    if (workflowId === fixtureDescriptor.id) return fixtureDescriptor;
    return undefined;
  },
};

const D0 = dayOffsetOf(0);
const D1 = dayOffsetOf(1);
const D2 = dayOffsetOf(2);
const D3 = dayOffsetOf(3);

const CLAIM = {
  workerId: "person-lookup-worker-1",
  claimedAt: "2026-08-03T17:00:05.000Z",
  heartbeatAt: "2026-08-03T17:00:05.000Z",
} as const;

function boundReceipt(w: DashboardWorld, receipt: RunEvidenceReceipt): RunEvidenceReceipt {
  const run = w.authority.records.get(receipt.runId);
  assert.ok(run);
  const e = run.envelope;
  return RunEvidenceReceiptSchema.parse({ ...receipt, runId: e.runId, traceId: e.traceId, attempt: e.attempt,
    workflowId: e.workflow, descriptorFingerprint: e.contractFingerprint, configFingerprint: e.configFingerprint });
}

function receiptWithPersonFactOf(
  seed: number,
  identity: Readonly<{ transform: "digest" | "last4"; value: string }>,
) {
  return RunEvidenceReceiptSchema.parse({
    ...cleanReceiptOf({ seed }),
    observations: [{
      id: uuidOf(seed + 7300),
      field: "emplId",
      mandatory: true,
      source: { kind: "system", taskId: "ucpath/search-person-org", observedAt: instantOffsetOf(0) },
      state: "satisfied",
      value: {
        key: "selection.selected.emplId",
        state: "transformed",
        classification: "direct-identifier",
        transform: identity.transform,
        value: identity.value,
      },
    }],
  });
}

function personResult(w: DashboardWorld, seed: number, identity: string) {
  const prior=w.authority.records.get(uuidOf(seed));
  if(prior===undefined)throw new Error("activity-fixture-run-missing");
  const run=runRecordOf({seed,workflow:"separations",lifecycle:{state:"terminal",outcome:"done",endedAt:instantOffsetOf(0,1000)}});
  const result=activityPersonPseudonymResultRecord(run,{...CURRENT_SEPARATIONS_RESULT,
    approved:{...CURRENT_SEPARATIONS_RESULT.approved,emplId:identity}});
  w.authority.put({...run,envelope:{...run.envelope,shape:prior.envelope.shape,...(prior.envelope.parent===undefined?{}:{parent:prior.envelope.parent})}});
  canonicalResults.get(w)?.set(run.envelope.runId,result);
}

// The seeded days intentionally cross lifecycle and workflow categories.
function deleteFixtureRun(w: DashboardWorld, seed: number): void {
  const run = w.authority.getRun(uuidOf(seed));
  assert.ok(run);
  const deleted = deletedRuns.get(w);
  assert.ok(deleted);
  deleted.set(run.envelope.runId, DeletedRunRecordSchema.parse({
    runId: run.envelope.runId, workflow: run.envelope.workflow, traceId: run.envelope.traceId,
    itemId: run.envelope.itemId, attempt: run.envelope.attempt, runNumber: run.runNumber ?? null,
    ordinalSource: "tombstone", origin: "queue", commandId: uuidOf(8000 + seed),
    deletedAt: w.clock.now().toISOString(), tallyVersion: 3, removed: [],
  }));
  w.authority.records.delete(run.envelope.runId);
}

function seedActivityWorld(w: DashboardWorld): void {
  atDayOffset(w, 0);
  queuedEventOf(w, { seed: 1 });
  claimEventOf(w, 1);
  runEndedEventOf(w, 1, "done");
  w.authority.put(runRecordOf({
    seed: 1,
    lifecycle: { state: "terminal", outcome: "done", endedAt: instantOffsetOf(0, 5_000) },
    version: 3,
  }));

  queuedEventOf(w, { seed: 2 });
  claimEventOf(w, 2);
  w.authority.failures.set(uuidOf(9002), failureRecordOf({ seed: 2, code: "STALE_SESSION", transient: true }));
  runEndedEventOf(w, 2, "failed", { failureId: uuidOf(9002) });
  w.authority.put(runRecordOf({
    seed: 2,
    lifecycle: {
      state: "terminal", outcome: "failed", endedAt: instantOffsetOf(0, 20_000), failureId: uuidOf(9002),
    },
    version: 3,
  }));

  queuedEventOf(w, { seed: 3 });

  atDayOffset(w, 1);
  const kuali = "separations-kuali-finalization";
  for (const [seed, code, transient, ms] of [
    [4, "STALE_SESSION", true, 60_000],
    [5, "SUBJECT_MISMATCH", false, 10_000],
  ] as const) {
    queuedEventOf(w, { seed, workflow: kuali });
    w.authority.failures.set(
      uuidOf(9000 + seed),
      failureRecordOf({ seed, code, transient, workflow: kuali }),
    );
    runEndedEventOf(w, seed, "failed", { workflow: kuali, failureId: uuidOf(9000 + seed) });
    w.authority.put(runRecordOf({
      seed,
      enqueuedAt: instantOffsetOf(1),
      workflow: kuali,
      lifecycle: {
        state: "terminal",
        outcome: "failed",
        endedAt: instantOffsetOf(1, ms),
        failureId: uuidOf(9000 + seed),
      },
      version: 3,
    }));
  }

  queuedEventOf(w, { seed: 6, workflow: kuali, lifecycle: { state: "terminal", outcome: "done", endedAt: instantOffsetOf(1) } });
  deleteFixtureRun(w, 6);

  atDayOffset(w, 2);
  // An unregistered workflow still counts; its label and category remain unavailable.
  queuedEventOf(w, { seed: 7, workflow: "unknown-flow" });
  w.authority.put(runRecordOf({
    seed: 7,
    enqueuedAt: instantOffsetOf(2),
    workflow: "unknown-flow",
    lifecycle: { state: "terminal", outcome: "interrupted", endedAt: instantOffsetOf(2, 30_000) },
    version: 3,
  }));

  queuedEventOf(w, { seed: 8, workflow: fixtureDescriptor.id });
  w.authority.put(runRecordOf({
    seed: 8,
    enqueuedAt: instantOffsetOf(2),
    workflow: fixtureDescriptor.id,
    lifecycle: { state: "running", ...CLAIM, claimedAt: instantOffsetOf(2), heartbeatAt: instantOffsetOf(2) },
    claimGeneration: 1,
    version: 2,
  }));
  claimEventOf(w, 8);

  queuedEventOf(w, { seed: 9, shape: "operation", title: "I-9 batch" });
  queuedEventOf(w, { seed: 10, shape: "operation-member", parentSeed: 9 });
  queuedEventOf(w, { seed: 11, shape: "operation-member", parentSeed: 9 });

  atDayOffset(w, 3);
  queuedEventOf(w, { seed: 12 });
  runEndedEventOf(w, 12, "done");
  w.authority.put(runRecordOf({
    seed: 12,
    enqueuedAt: instantOffsetOf(3),
    lifecycle: { state: "terminal", outcome: "done", endedAt: instantOffsetOf(3, 1_000) },
    version: 3,
  }));
}

describe("the Activity report", () => {
  it("refuses the old receipt-digest path when validated canonical identity is missing", () => {
    const w = world({ descriptors: REGISTRY });
    atDayOffset(w, 0);
    queuedEventOf(w, { seed: 40, workflow: "separations" });
    runEndedEventOf(w, 40, "done", { workflow: "separations" });
    w.authority.put(runRecordOf({
      seed: 40,
      workflow: "separations",
      lifecycle: { state: "terminal", outcome: "done", endedAt: instantOffsetOf(0, 1_000) },
      version: 3,
    }));
    const digest = "a".repeat(64);
    w.authority.receipts.set(uuidOf(40), receiptWithPersonFactOf(40, {
      transform: "digest",
      value: digest,
    }));

    const report = w.projection.buildActivityReportWire(D0, D0);

    assert.deepEqual(report.people, {
      state: "absent",
      evidenceRows: 0,
      unavailableRows: 1,
      reason: "1 of 1 current Separations run/member rows lack validated canonical identity; distinct people is unavailable",
    });
    assert.equal(JSON.stringify(report).includes(digest), false, "the aggregate wire published a person digest");
  });

  it("deduplicates canonical identities and includes operation members", () => {
    const w = world({ descriptors: REGISTRY });
    atDayOffset(w, 0);
    queuedEventOf(w, { seed: 41, workflow: "separations" });
    queuedEventOf(w, { seed: 42, workflow: "separations", shape: "operation", title: "People batch" });
    queuedEventOf(w, { seed: 43, workflow: "separations", shape: "operation-member", parentSeed: 42 });
    queuedEventOf(w, { seed: 44, workflow: "separations", shape: "operation-member", parentSeed: 42 });
    for (const [seed, identity] of [[41, "10800001"], [43, "10800001"], [44, "10800002"]] as const) personResult(w,seed,identity);

    const report = w.projection.buildActivityReportWire(D0, D0);

    assert.deepEqual(report.people, { state: "present", distinct: 2, evidenceRows: 3 });
  });

  it("keeps missing canonical identity distinct from a zero-Separations range", () => {
    const w = world({ descriptors: REGISTRY });
    atDayOffset(w, 0);
    queuedEventOf(w, { seed: 45, workflow: "separations" });
    w.authority.receipts.set(uuidOf(45), receiptWithPersonFactOf(45, {
      transform: "last4",
      value: "3698",
    }));

    const unavailable = w.projection.buildActivityReportWire(D0, D0);
    const zero = world({ descriptors: REGISTRY }).projection.buildActivityReportWire(D0, D0);

    assert.deepEqual(
      [unavailable.people, zero.people],
      [
        {
          state: "absent",
          evidenceRows: 0,
          unavailableRows: 1,
          reason: "1 of 1 current Separations run/member rows lack validated canonical identity; distinct people is unavailable",
        },
        { state: "present", distinct: 0, evidenceRows: 0 },
      ],
    );
    assert.equal(JSON.stringify(unavailable).includes("3698"), false, "the absent wire published a suffix");
  });

  it("refuses foreign result bindings, malformed canonical values and old schema hashes without leaking identity", () => {
    for(const defect of ["foreign","malformed","schema"] as const) {
      const w=world({descriptors:REGISTRY});atDayOffset(w,0);
      queuedEventOf(w,{seed:46,workflow:"separations"});personResult(w,46,"10800001");
      const result=canonicalResults.get(w)?.get(uuidOf(46));if(result===undefined)throw new Error("fixture result missing");
      canonicalResults.get(w)?.set(uuidOf(46),{...result,
        ...(defect==="foreign"?{runId:RunIdSchema.parse(uuidOf(99))}:{}),
        ...(defect==="schema"?{resultSchemaHash:FingerprintSchema.parse("a".repeat(64))}:{}),
        ...(defect==="malformed"?{result:{...result.result,value:{approved:{emplId:"10800001"}}}}:{}),
      });
      if(defect==="foreign")assert.throws(()=>w.projection.buildActivityReportWire(D0,D0),/identity-mismatch/u);
      else {
        const report=w.projection.buildActivityReportWire(D0,D0);
        assert.equal(report.people.state,"absent");
        assert.equal(JSON.stringify(report).includes("10800001"),false);
        assert.equal(JSON.stringify(report).includes("a".repeat(64)),false);
      }
    }
  });

  it("rolls the range up by day, workflow, category, status and outcome from the one surface set", () => {
    const w = world({ descriptors: REGISTRY });
    seedActivityWorld(w);

    const report = ActivityReportWireSchema.parse(w.projection.buildActivityReportWire(D0, D2));


    assert.equal(report.totalRuns, 8);
    assert.equal(report.terminalRuns, 5);
    assert.equal(report.inFlightRuns, 3);

    assert.deepEqual(report.people, { state: "present", distinct: 0, evidenceRows: 0 });
    assert.deepEqual(report.days, [
      { day: D0, runs: 3 },
      { day: D1, runs: 2 },
      { day: D2, runs: 3 },
    ]);


    const clean = { readBack: 0, warnings: 0, warningsUnknown: 0 };
    assert.deepEqual(report.workflows, [
      {
        workflowId: fixtureDescriptor.id,
        registration: { state: "registered", label: "Fixture Graph", code: "fx", categoryId: "operations" },
        runs: 1,
        completion: clean,
        failed: 0, cancelled: 0, partial: 0, open: 1,
      },
      {
        workflowId: "person-lookup",
        registration: { state: "registered", label: "Person Lookup", code: "pl", categoryId: "search" },
        runs: 4,

        completion: { readBack: 0, warnings: 0, warningsUnknown: 1 },
        failed: 1, cancelled: 0, partial: 0, open: 2,
      },
      {
        workflowId: "separations-kuali-finalization",
        registration: { state: "registered", label: "Kuali Finalization", code: "sf", categoryId: "separation" },
        runs: 2,
        completion: clean,
        failed: 2, cancelled: 0, partial: 0, open: 0,
      },
      {
        workflowId: "unknown-flow",
        registration: {
          state: "unregistered",
          reason: "workflow unknown-flow is no longer registered; its label and category are unavailable",
        },
        runs: 1,
        completion: clean,
        // Interrupted is terminal lifecycle but still requeueable, so status and open-work columns differ.
        failed: 0, cancelled: 0, partial: 0, open: 1,
      },
    ]);
    assert.deepEqual(report.completion, { readBack: 0, warnings: 0, warningsUnknown: 1 });


    assert.deepEqual(report.categories, [
      { category: { state: "registered", categoryId: "operations" }, runs: 1 },
      { category: { state: "registered", categoryId: "search" }, runs: 4 },
      { category: { state: "registered", categoryId: "separation" }, runs: 2 },
      {
        category: {
          state: "unregistered",
          reason: "the workflows behind these runs are no longer registered",
        },
        runs: 1,
      },
    ]);

    // The Who sample rides the OPEN buckets only — a terminal bucket carries
    // none, and the schema refuses either mistake.
    assert.deepEqual(report.statuses, [
      { status: "blocked", runs: 1, sample: [uuidOf(7)] },
      { status: "done", runs: 1, sample: [] },
      { status: "failed", runs: 3, sample: [] },
      { status: "queued", runs: 2, sample: [uuidOf(3), uuidOf(9)] },
      { status: "running", runs: 1, sample: [uuidOf(8)] },
    ]);
    // Outcomes are AUTHORITY's settled verdicts, so only the five terminal
    // rows appear — the running and queued rows have reached none.
    assert.deepEqual(report.outcomes, [
      { outcome: "done", runs: 1 },
      { outcome: "failed", runs: 3 },
      { outcome: "interrupted", runs: 1 },
    ]);
    assert.equal(
      report.outcomes.reduce((total, { runs }) => total + runs, 0),
      report.terminalRuns,
    );
  });

  it("breaks failures down by their own code and says how many of them were transient", () => {
    const w = world({ descriptors: REGISTRY });
    seedActivityWorld(w);
    const report = w.projection.buildActivityReportWire(D0, D2);

    // "3 failures" reads very differently once two of them are known retryable.
    assert.deepEqual(report.failures, [
      { code: "STALE_SESSION", runs: 2, transient: 2, sample: [uuidOf(2), uuidOf(4)] },
      { code: "SUBJECT_MISMATCH", runs: 1, transient: 0, sample: [uuidOf(5)] },
    ]);
    assert.equal(
      report.failures.reduce((total, { runs }) => total + runs, 0),
      report.outcomes.find(({ outcome }) => outcome === "failed")?.runs,
    );
  });

  it("refuses to report a failure breakdown with a hole in it", () => {
    const w = world({ descriptors: REGISTRY });
    seedActivityWorld(w);

    w.authority.failures.delete(uuidOf(9002));
    assert.throws(
      () => w.projection.buildActivityReportWire(D0, D2),
      /which authority does not hold; refusing to report a failure breakdown with a hole in it/,
    );
  });

  it("measures the durations it can and REPORTS the ones it cannot", () => {
    const w = world({ descriptors: REGISTRY });
    seedActivityWorld(w);
    const report = w.projection.buildActivityReportWire(D0, D2);


    assert.equal(report.durations.measuredRuns, 4);
    assert.equal(report.durations.unmeasuredRuns, 1);
    assert.equal(report.durations.measuredRuns + report.durations.unmeasuredRuns, report.terminalRuns);

    // 5s, 10s, 20s, 60s.
    assert.deepEqual(report.durations.medianMs, { state: "present", value: 10_000 });
    assert.deepEqual(report.durations.longestMs, { state: "present", value: 60_000, runId: uuidOf(4) });
    assert.equal(report.durations.totalMs, 95_000);
  });

  it("names the absence rather than reporting a zero when nothing in range is measurable", () => {
    const w = world({ descriptors: REGISTRY });
    atDayOffset(w, 0);
    queuedEventOf(w, { seed: 1 });
    claimEventOf(w, 1);
    const report = w.projection.buildActivityReportWire(D0, D0);

    assert.equal(report.totalRuns, 1);
    assert.equal(report.terminalRuns, 0);
    assert.deepEqual(report.durations, {
      measuredRuns: 0,
      unmeasuredRuns: 0,
      medianMs: {
        state: "absent",
        reason: "no terminal run in range carries both a start and an end instant",
      },
      longestMs: {
        state: "absent",
        reason: "no terminal run in range carries both a start and an end instant",
      },
      totalMs: 0,
    });
  });

  it("splits the done runs three ways and never reports an unread one as clean", () => {
    const w = world({ descriptors: REGISTRY });
    atDayOffset(w, 0);

    for (const seed of [31, 32, 33]) {
      queuedEventOf(w, { seed });
      runEndedEventOf(w, seed, "done");
      w.authority.put(runRecordOf({
        seed,
        lifecycle: { state: "terminal", outcome: "done", endedAt: instantOffsetOf(0, 1_000) },
        version: 3,
      }));
    }
    w.authority.receipts.set(uuidOf(31), boundReceipt(w, receiptWithWarningsOf({
      seed: 31,
      summaries: ["CRM dates were replayed past their freshness limit", "a second warning"],
    })));
    w.authority.receipts.set(uuidOf(32), boundReceipt(w, cleanReceiptOf({ seed: 32 })));

    const report = ActivityReportWireSchema.parse(w.projection.buildActivityReportWire(D0, D0));


    assert.deepEqual(report.completion, { readBack: 1, warnings: 1, warningsUnknown: 1 });
    assert.deepEqual(report.workflows[0].completion, { readBack: 1, warnings: 1, warningsUnknown: 1 });
    assert.deepEqual(report.statuses, [{ status: "done", runs: 3, sample: [] }]);


    const dayRows = w.projection.buildDashboardDayWire(D0).queueSurfaces;
    const armOf = (seed: number): string => {
      const row = dayRows.find((surface) => surface.runId === uuidOf(seed));
      if (row === undefined) throw new Error(`no queue row for seed ${String(seed)}`);
      return row.warnings.state === "present" ? "present" : row.warnings.reason;
    };
    assert.equal(armOf(31), "present");
    assert.equal(armOf(32), "this run's evidence receipt records no warning");
    assert.equal(armOf(33), "no evidence receipt has been derived for this run, so its warning set is unknown");
  });

  it("refuses a per-workflow cross-tab that disagrees with the totals it is part of", () => {
    const w = world({ descriptors: REGISTRY });
    seedActivityWorld(w);
    const report = w.projection.buildActivityReportWire(D0, D2);


    const refusals: [string, ActivityReportWire, RegExp][] = [
      [
        "a row that does not partition its own runs",
        { ...report, workflows: report.workflows.map((row, index) => (index === 0 ? { ...row, open: 0 } : row)) },
        /splits into 0 runs but counts 1/,
      ],
      [
        "a row column that outruns its whole-report total",
        { ...report, workflows: report.workflows.map((row, index) => (index === 0 ? { ...row, open: 2, runs: 2 } : row)) },
        /workflow rows sum to 5 open but the non-terminal status totals says 4/,
      ],
      [
        "a completion split that does not cover the done runs",
        { ...report, completion: { readBack: 1, warnings: 0, warningsUnknown: 1 } },
        /completion split covers 2 runs but 1 settled done/,
      ],
    ];
    for (const [what, payload, message] of refusals) {
      assert.throws(() => ActivityReportWireSchema.parse(payload), message, what);
    }
  });

  it("refuses category totals that disagree with their workflow rows", () => {
    const w = world({ descriptors: REGISTRY });
    seedActivityWorld(w);
    const report = w.projection.buildActivityReportWire(D0, D2);
    const categories = report.categories.map((category, index) => (
      index === 0 ? { ...category, runs: category.runs + 1 } : category
    ));

    assert.throws(
      () => ActivityReportWireSchema.parse({ ...report, categories }),
      /category operations counts 2 runs but its workflow rows count 1/,
    );
  });

  it("caps a failure sample at five runs while the tally keeps counting", () => {
    const w = world({ descriptors: REGISTRY });
    atDayOffset(w, 0);
    for (let seed = 20; seed < 27; seed += 1) {
      queuedEventOf(w, { seed });
      w.authority.failures.set(uuidOf(9000 + seed), failureRecordOf({ seed, code: "STALE_SESSION", transient: true }));
      runEndedEventOf(w, seed, "failed", { failureId: uuidOf(9000 + seed) });
      w.authority.put(runRecordOf({
        seed,
        lifecycle: {
          state: "terminal", outcome: "failed", endedAt: instantOffsetOf(0, 1_000), failureId: uuidOf(9000 + seed),
        },
        version: 3,
      }));
    }
    const report = w.projection.buildActivityReportWire(D0, D0);
    assert.equal(report.failures.length, 1);
    assert.equal(report.failures[0].runs, 7);
    assert.equal(report.failures[0].transient, 7);
    assert.equal(report.failures[0].sample.length, 5);
  });
});

describe("the Activity report inherits the day's exclusions rather than re-deciding them", () => {
  it("agrees with the day payload it summarises, row for row and count for count", () => {
    const w = world({ descriptors: REGISTRY });
    seedActivityWorld(w);

    for (const [day, offset] of [[D0, 0], [D1, 1], [D2, 2]] as const) {
      const dayWire = w.projection.buildDashboardDayWire(day);
      const countable = dayWire.queueSurfaces.filter(({ surfaceKind }) => surfaceKind !== "member");
      const oneDay = w.projection.buildActivityReportWire(day, day);

      assert.equal(oneDay.totalRuns, countable.length, `day ${day} (offset ${String(offset)}) row count`);
      assert.deepEqual(oneDay.days, [{ day, runs: countable.length }]);
      assert.deepEqual(
        oneDay.statuses.map(({ status, runs }) => [status, runs]),
        [...dayWire.statusCounts].map(({ status, count }) => [status, count]),
      );
      assert.deepEqual(
        oneDay.workflows.map(({ workflowId, runs }) => [workflowId, runs]),
        [...dayWire.workflowCounts].map(({ workflowId, count }) => [workflowId, count]),
      );
    }
  });

  it("drops a deleted run from the range at the same instant it leaves the day", () => {
    const w = world({ descriptors: REGISTRY });
    seedActivityWorld(w);
    const before = w.projection.buildActivityReportWire(D0, D2);
    assert.equal(before.totalRuns, 8);
    assert.equal(w.projection.buildDashboardDayWire(D0).queueSurfaces.length, 3);


    deleteFixtureRun(w, 1);
    const after = w.projection.buildActivityReportWire(D0, D2);
    assert.equal(after.totalRuns, 7);
    assert.equal(after.terminalRuns, 4);
    assert.deepEqual(after.days[0], { day: D0, runs: 2 });
    assert.equal(after.durations.measuredRuns, 3);
    assert.equal(after.durations.totalMs, 90_000);
    assert.equal(w.projection.buildDashboardDayWire(D0).queueSurfaces.length, 2);
  });

  it("counts a delegated member inside its operation, never a second time at top level", () => {
    const w = world({ descriptors: REGISTRY });
    seedActivityWorld(w);
    const report = w.projection.buildActivityReportWire(D2, D2);
    const dayWire = w.projection.buildDashboardDayWire(D2);

    // The members ride the day payload flat for layout — the report counts the
    // operation once and the members not at all.
    assert.equal(dayWire.queueSurfaces.length, 5);
    assert.equal(dayWire.queueSurfaces.filter(({ surfaceKind }) => surfaceKind === "member").length, 2);
    assert.equal(report.totalRuns, 3);
    assert.deepEqual(report.days, [{ day: D2, runs: 3 }]);
  });
});

describe("the Activity report refuses rather than inventing a window", () => {
  it("refuses a range that ends before it starts", () => {
    const w = world({ descriptors: REGISTRY });
    seedActivityWorld(w);
    assert.throws(
      () => w.projection.buildActivityReportWire(D2, D0),
      new RegExp(`activity range ${D2}\\.\\.${D0} ends before it starts`),
    );
  });

  it("refuses a bound that is not a date", () => {
    const w = world({ descriptors: REGISTRY });
    assert.throws(() => w.projection.buildActivityReportWire("today", D0));
    assert.throws(() => w.projection.buildActivityReportWire(D0, "2026-08"));
  });

  it("refuses to serve aggregates while the projection is degraded", () => {
    const w = world({ descriptors: REGISTRY, collectRebuilds: true });
    queuedEventOf(w, { seed: 1 });
    // A claim naming a run with no `run.queued` cannot fold. `apply` never
    // throws into the emitting path; it degrades and schedules the rebuild.
    w.projection.apply({
      t: "run.claimed", ts: w.clock.now().toISOString(), workflow: "person-lookup", pid: 4242,
      runId: uuidOf(60), attempt: 1, traceId: "pl-100060-0060", spanPath: "pl-100060-0060",
      workerId: "person-lookup-worker-1",
    } as never);

    assert.equal(w.projection.health().state, "degraded");
    assert.throws(
      () => w.projection.buildActivityReportWire(D0, D2),
      /degraded and refuses to serve activity aggregates/,
    );

    // A half-folded range is never served as healthy; the guarded rebuild is
    // what makes it answerable again.
    w.scheduledRebuilds[0]();
    assert.equal(w.projection.health().state, "live");
    assert.equal(w.projection.buildActivityReportWire(D0, D2).totalRuns, 1);
  });

  it("keeps an out-of-range row out of the range even when authority never held it", () => {
    const w = world({ descriptors: REGISTRY });
    seedActivityWorld(w);

    w.authority.records.delete(uuidOf(12));
    assert.equal(w.projection.buildActivityReportWire(D0, D2).totalRuns, 8);
    assert.equal(w.projection.buildActivityReportWire(D3, D3).totalRuns, 0);
  });
});

// Write history outlives run history; an empty run range may still contain filed transactions.
describe("the Activity report's write-ledger block", () => {
  function fileLedgerEntry(
    w: DashboardWorld,
    seq: number,
    overrides: Readonly<{ system?: string; instance?: "prod" | "test"; confirmedAt: string }>,
  ): void {
    const f = ledgerCommitFixture(seq, { ...overrides, runId: fixtureUuid(`activity-history-${String(seq)}`), itemId: fixtureUuid(`activity-history-item-${String(seq)}`) });
    seedAtomicWriteOwner(w.database, f.commit, join(w.stateRoot, "authority.db"));
    fenceWriteFixture(w.database, { intent: f.intent, attempt: f.attempt });
    w.database.commitWriteAttempt(f.commit, atomicWriteCheckpoint(f.commit));
  }

  it("serves what was filed beside the totals, without reconciling the two", () => {
    const w = world({ descriptors: REGISTRY });
    seedActivityWorld(w);
    fileLedgerEntry(w, 0, { confirmedAt: instantOffsetOf(1) });
    fileLedgerEntry(w, 1, { confirmedAt: instantOffsetOf(1), instance: "test" });

    const report = w.projection.buildActivityReportWire(D0, D2);
    assert.deepEqual(report.ledger, {
      systems: [{ system: "ucpath", entries: 2, prod: 1, test: 1 }],
    });
    // The seam, stated as an assertion: the block is NOT a partition of the
    // range's runs, and nothing on the wire pretends it is.
    assert.notEqual(report.ledger.systems[0]?.entries, report.totalRuns);
  });

  it("still reports entries over a window whose runs are all gone", () => {
    const w = world({ descriptors: REGISTRY });

    fileLedgerEntry(w, 0, { system: "kuali", confirmedAt: instantOffsetOf(1) });

    const report = w.projection.buildActivityReportWire(D0, D2);
    assert.equal(report.totalRuns, 0);
    assert.deepEqual(report.ledger, {
      systems: [{ system: "kuali", entries: 1, prod: 1, test: 0 }],
    });
  });

  it("serves an empty block when nothing in the window filed anything", () => {
    const w = world({ descriptors: REGISTRY });
    seedActivityWorld(w);
    assert.deepEqual(w.projection.buildActivityReportWire(D0, D2).ledger, { systems: [] });
  });
});
