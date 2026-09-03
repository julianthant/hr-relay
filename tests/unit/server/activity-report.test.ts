/**
 * The Activity report (D180, ref frontend-backend-integration §5/§6.7) — the range rendering of THE ONE
 * run/queue projection.
 *
 * The report is not a second counting path, so the assertions below are mostly
 * about AGREEMENT: the same archived row and contained member that
 * leave `buildDashboardDayWire` leave every aggregate here, once, at the same
 * instant, because the exclusion is decided in one place and inherited. The
 * other half is D124 at scale — a terminal run whose surface carries no end
 * instant is reported as unmeasured and is never counted as a zero, because a
 * median over a denominator that quietly swallowed the unknowns is a lie the
 * operator cannot see.
 */
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync } from "node:fs";
import { afterEach, describe, it } from "vitest";
import type { AnyWorkflowDescriptor } from "../../../src/base/workflow.js";
import { ActivityReportWireSchema, type ActivityReportWire } from "../../../src/domain/dashboard/activity.js";
import { RunEvidenceReceiptSchema } from "../../../src/domain/trust/evidence.js";
import { deriveIdempotencyKeyDigest } from "../../../src/domain/write-safety.js";
import { ledgerDirectory, ledgerFilePath } from "../../../src/infra/ledger/ledger-projector.js";
import { IDEMPOTENCY_KEY, LEDGER_PAYLOAD } from "../fixtures/phase1c-contract-fixtures.js";
import { separationsKualiFinalizationDescriptor } from "../../../src/workflows/separations/kuali-finalization/descriptor.js";
import { fixtureDescriptor } from "../architecture/helpers/descriptor-fixtures.js";
import {
  atDayOffset,
  claimEventOf,
  cleanReceiptOf,
  dayOffsetOf,
  failureRecordOf,
  instantOffsetOf,
  makeWorld,
  queuedEventOf,
  receiptWithWarningsOf,
  runEndedEventOf,
  runRecordOf,
  uuidOf,
  type DashboardWorld,
} from "./helpers/dashboard-harness.js";
import { personLookupDescriptor } from "../../helpers/registered-workflows.js";

const worlds: DashboardWorld[] = [];

function world(...args: Parameters<typeof makeWorld>): DashboardWorld {
  const created = makeWorld(...args);
  worlds.push(created);
  return created;
}

afterEach(() => {
  for (const w of worlds.splice(0)) w.dispose();
});

/**
 * Two REAL descriptors plus the graph fixture, spanning search, separation,
 * and generic operations categories.
 */
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

function pseudonymEvidenceOf(input: Readonly<{
  seed: number;
  pseudonym: string;
  keyGeneration?: string;
  workflowId?: string;
  runId?: string;
}>) {
  return {
    runId: input.runId ?? uuidOf(input.seed),
    workflowId: input.workflowId ?? "separations",
    keyGeneration: input.keyGeneration ?? "activity-person-g1",
    pseudonym: input.pseudonym,
    derivation: "hmac-sha-256/activity-person/v1",
  } as const;
}

/**
 * A three-day range with one row of every kind the report must decide about.
 *
 * D0: 1 done (5s) · 2 failed/transient (20s) · 3 HIDDEN
 * D1: 4 failed/transient (60s, kuali) · 5 failed/permanent (10s, kuali) · 6 ARCHIVED
 * D2: 7 terminal-interrupted on a RETIRED workflow · 8 running (fixture-graph)
 *     · 9 operation + 10/11 its MEMBERS
 * D3: 12 done — outside the range entirely
 */
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

  queuedEventOf(w, { seed: 6, workflow: kuali });
  w.authority.archived.add(uuidOf(6));

  atDayOffset(w, 2);
  // A workflow that has since been retired from the registry. Its run still
  // happened and still counts; only its label and category are unavailable.
  queuedEventOf(w, { seed: 7, workflow: "retired-flow" });
  w.authority.put(runRecordOf({
    seed: 7,
    workflow: "retired-flow",
    lifecycle: { state: "terminal", outcome: "interrupted", endedAt: instantOffsetOf(2, 30_000) },
    version: 3,
  }));

  queuedEventOf(w, { seed: 8, workflow: fixtureDescriptor.id });
  w.authority.put(runRecordOf({
    seed: 8,
    workflow: fixtureDescriptor.id,
    lifecycle: { state: "running", ...CLAIM },
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
    lifecycle: { state: "terminal", outcome: "done", endedAt: instantOffsetOf(3, 1_000) },
    version: 3,
  }));
}

describe("the Activity report (D180)", () => {
  it("refuses the old receipt-digest path when keyed pseudonym evidence is missing", () => {
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
      reason: "1 of 1 current Separations run/member rows lack pseudonym evidence; distinct people is unavailable",
    });
    assert.equal(JSON.stringify(report).includes(digest), false, "the aggregate wire published a person digest");
  });

  it("deduplicates keyed pseudonyms within one complete generation and includes operation members", () => {
    const w = world({ descriptors: REGISTRY });
    atDayOffset(w, 0);
    queuedEventOf(w, { seed: 41, workflow: "separations" });
    queuedEventOf(w, { seed: 42, workflow: "separations", shape: "operation", title: "People batch" });
    queuedEventOf(w, { seed: 43, workflow: "separations", shape: "operation-member", parentSeed: 42 });
    queuedEventOf(w, { seed: 44, workflow: "separations", shape: "operation-member", parentSeed: 42 });
    for (const [seed, pseudonym] of [[41, "a"], [43, "a"], [44, "b"]] as const) {
      w.authority.putActivityPersonPseudonym(pseudonymEvidenceOf({ seed, pseudonym: pseudonym.repeat(64) }));
    }

    const report = w.projection.buildActivityReportWire(D0, D0);

    assert.deepEqual(report.people, { state: "present", distinct: 2, evidenceRows: 3 });
  });

  it("keeps missing keyed evidence distinct from a zero-Separations range", () => {
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
          reason: "1 of 1 current Separations run/member rows lack pseudonym evidence; distinct people is unavailable",
        },
        { state: "present", distinct: 0, evidenceRows: 0 },
      ],
    );
    assert.equal(JSON.stringify(unavailable).includes("3698"), false, "the absent wire published a suffix");
  });

  it("refuses duplicate, multi-generation, mixed and foreign pseudonym evidence without combining it", () => {
    const cases = [
      {
        name: "duplicate row for one generation",
        evidence: [
          pseudonymEvidenceOf({ seed: 46, pseudonym: "a".repeat(64) }),
          pseudonymEvidenceOf({ seed: 46, pseudonym: "b".repeat(64) }),
        ],
        expected: { evidenceRows: 0, unavailableRows: 1, reason: /more than one pseudonym evidence row/u },
      },
      {
        name: "multiple generations for one run",
        evidence: [
          pseudonymEvidenceOf({ seed: 46, pseudonym: "a".repeat(64), keyGeneration: "activity-person-g1" }),
          pseudonymEvidenceOf({ seed: 46, pseudonym: "b".repeat(64), keyGeneration: "activity-person-g2" }),
        ],
        expected: { evidenceRows: 0, unavailableRows: 1, reason: /more than one pseudonym key generation/u },
      },
      {
        name: "mixed generations across complete rows",
        evidence: [
          pseudonymEvidenceOf({ seed: 46, pseudonym: "a".repeat(64), keyGeneration: "activity-person-g1" }),
          pseudonymEvidenceOf({ seed: 47, pseudonym: "b".repeat(64), keyGeneration: "activity-person-g2" }),
        ],
        second: true,
        expected: { evidenceRows: 2, unavailableRows: 0, reason: /mixed pseudonym key generations/u },
      },
      {
        name: "foreign workflow evidence",
        evidence: [pseudonymEvidenceOf({ seed: 46, pseudonym: "a".repeat(64), workflowId: "person-lookup" })],
        expected: { evidenceRows: 0, unavailableRows: 1, reason: /outside the served current Separations/u },
      },
      {
        name: "foreign run evidence",
        evidence: [
          pseudonymEvidenceOf({ seed: 46, pseudonym: "a".repeat(64) }),
          pseudonymEvidenceOf({ seed: 99, pseudonym: "b".repeat(64) }),
        ],
        expected: { evidenceRows: 1, unavailableRows: 0, reason: /outside the served current Separations/u },
      },
    ] as const;
    for (const fixture of cases) {
      const w = world({ descriptors: REGISTRY });
      atDayOffset(w, 0);
      queuedEventOf(w, { seed: 46, workflow: "separations" });
      if ("second" in fixture && fixture.second === true) queuedEventOf(w, { seed: 47, workflow: "separations" });
      for (const evidence of fixture.evidence) w.authority.putActivityPersonPseudonym(evidence);

      const people = w.projection.buildActivityReportWire(D0, D0).people;
      assert.equal(people.state, "absent", fixture.name);
      if (people.state !== "absent") throw new Error(`${fixture.name} unexpectedly measured people`);
      assert.equal(people.evidenceRows, fixture.expected.evidenceRows, fixture.name);
      assert.equal(people.unavailableRows, fixture.expected.unavailableRows, fixture.name);
      assert.match(people.reason, fixture.expected.reason, fixture.name);
      assert.equal(JSON.stringify(people).includes("a".repeat(64)), false, fixture.name);
    }
  });

  it("rolls the range up by day, workflow, category, status and outcome from the one surface set", () => {
    const w = world({ descriptors: REGISTRY });
    seedActivityWorld(w);

    const report = ActivityReportWireSchema.parse(w.projection.buildActivityReportWire(D0, D2));

    // 8 top-level rows: the archived row, the two members and the out-of-range
    // day are all gone, and the schema's own superRefine has
    // already asserted that statuses sum to this number and that terminal +
    // in-flight partition it.
    assert.equal(report.totalRuns, 8);
    assert.equal(report.terminalRuns, 5);
    assert.equal(report.inFlightRuns, 3);
    // The seeded rows are non-Separations workflows. D288 does not re-derive
    // identities from their receipts, so this range honestly contains no
    // current Separations person-bearing rows rather than an unavailable
    // partial People axis.
    assert.deepEqual(report.people, { state: "present", distinct: 0, evidenceRows: 0 });
    assert.deepEqual(report.days, [
      { day: D0, runs: 3 },
      { day: D1, runs: 2 },
      { day: D2, runs: 3 },
    ]);

    // The workflow axis CROSSED with the status axis, in the one pass. The
    // schema's own refinements have already asserted that each row's buckets
    // partition its own `runs` and that the four rows reconcile column by
    // column with the whole-report totals below.
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
        // The one `done` run has no derived receipt, so its warning set is
        // UNREAD — never folded into `readBack`, which would report a run
        // nobody checked as one that came back clean.
        completion: { readBack: 0, warnings: 0, warningsUnknown: 1 },
        failed: 1, cancelled: 0, partial: 0, open: 2,
      },
      {
        workflowId: "retired-flow",
        registration: {
          state: "unregistered",
          reason: "workflow retired-flow is no longer registered; its label and category are unavailable",
        },
        runs: 1,
        completion: clean,
        // Terminal by LIFECYCLE, `blocked` by STATUS: an interrupted run may
        // still be requeued, so the column that asks "what is still open"
        // counts it and the one that asks "what has settled" does too. The
        // two axes are different questions and the report keeps them apart.
        failed: 0, cancelled: 0, partial: 0, open: 1,
      },
      {
        workflowId: "separations-kuali-finalization",
        registration: { state: "registered", label: "Kuali Finalization", code: "sf", categoryId: "separation" },
        runs: 2,
        completion: clean,
        failed: 2, cancelled: 0, partial: 0, open: 0,
      },
    ]);
    assert.deepEqual(report.completion, { readBack: 0, warnings: 0, warningsUnknown: 1 });

    // Registered workflows fold into their declared categories, and the
    // retired workflow's run lands in the explicitly-unregistered bucket.
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
    // The run settled against a failure id authority no longer holds. Reporting
    // "2 failures" over three failed runs would understate the day silently.
    w.authority.failures.delete(uuidOf(9002));
    assert.throws(
      () => w.projection.buildActivityReportWire(D0, D2),
      /which authority does not hold; refusing to report a failure breakdown with a hole in it/,
    );
  });

  it("measures the durations it can and REPORTS the ones it cannot (D124 at scale)", () => {
    const w = world({ descriptors: REGISTRY });
    seedActivityWorld(w);
    const report = w.projection.buildActivityReportWire(D0, D2);

    // Four terminal rows carry a start and an end; the interrupted one carries
    // no terminal instant on its surface, because an interrupted run may still
    // be requeued and a row that says "it ended at X" would be claiming a
    // verdict nobody reached. It is counted as unmeasured — never as a zero,
    // which would drag the median down, and never as `now − startedAt`, which
    // would grow on every refresh.
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
    // Three runs settled `done` on the same workflow, one per arm of the
    // completion split: a receipt with warnings, a receipt with none, and a
    // run for which no receipt has been derived at all.
    for (const seed of [31, 32, 33]) {
      queuedEventOf(w, { seed });
      runEndedEventOf(w, seed, "done");
      w.authority.put(runRecordOf({
        seed,
        lifecycle: { state: "terminal", outcome: "done", endedAt: instantOffsetOf(0, 1_000) },
        version: 3,
      }));
    }
    w.authority.receipts.set(uuidOf(31), receiptWithWarningsOf({
      seed: 31,
      summaries: ["CRM dates were replayed past their freshness limit", "a second warning"],
    }));
    w.authority.receipts.set(uuidOf(32), cleanReceiptOf({ seed: 32 }));

    const report = ActivityReportWireSchema.parse(w.projection.buildActivityReportWire(D0, D0));

    // ONE warned run, not two: the column counts RUNS, and run 31 carries two
    // warnings. And run 33 sits in its own column — folding it into `readBack`
    // would put "3 came back clean" on a supervisor's copy over a run whose
    // warning set nobody has read.
    assert.deepEqual(report.completion, { readBack: 1, warnings: 1, warningsUnknown: 1 });
    assert.deepEqual(report.workflows[0].completion, { readBack: 1, warnings: 1, warningsUnknown: 1 });
    assert.deepEqual(report.statuses, [{ status: "done", runs: 3, sample: [] }]);

    // The row chip and the report column are the SAME derivation, so the two
    // cannot disagree about a run: the queue says warned, the report counts it
    // in the warned column, and neither counts the receipt-less run as clean.
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

  it("refuses a per-workflow cross-tab that disagrees with the totals it is part of (D81)", () => {
    const w = world({ descriptors: REGISTRY });
    seedActivityWorld(w);
    const report = w.projection.buildActivityReportWire(D0, D2);

    // Every arm below is a payload the schema must REFUSE. A report whose rows
    // and totals disagree is the count/badge divergence D81 exists to make
    // unrepresentable, so it never reaches a surface that would have to pick.
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

describe("the Activity report inherits the day's exclusions rather than re-deciding them (D81)", () => {
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

  it("drops an archived run from the range at the same instant it leaves the day", () => {
    const w = world({ descriptors: REGISTRY });
    seedActivityWorld(w);
    const before = w.projection.buildActivityReportWire(D0, D2);
    assert.equal(before.totalRuns, 8);
    assert.equal(w.projection.buildDashboardDayWire(D0).queueSurfaces.length, 3);

    // D80/D179: one version bump archives the run. Nothing re-runs, nothing
    // re-decides — the next read of either surface simply does not see it.
    w.authority.archived.add(uuidOf(1));
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
    // The day payload refuses a span-known run authority does not hold. The
    // report bounds its range FIRST, so a stale row on some other day cannot
    // make an unrelated week unanswerable.
    w.authority.records.delete(uuidOf(12));
    assert.equal(w.projection.buildActivityReportWire(D0, D2).totalRuns, 8);
    assert.throws(() => w.projection.buildActivityReportWire(D3, D3), /not in authority/);
  });
});

/**
 * D236 — the write-ledger block: the ONE total on this payload that does not
 * descend from the run/queue fold.
 *
 * Both cases below exist because the two corpora genuinely do not cover the
 * same rows. The block is read over the same window and reported BESIDE the
 * totals, and the wire deliberately asserts no relationship between them —
 * which is exactly why a range holding zero runs can still hold entries.
 */
describe("the Activity report's write-ledger block (D236)", () => {
  function fileLedgerEntry(
    w: DashboardWorld,
    seq: number,
    overrides: Readonly<{ system?: string; instance?: "prod" | "test"; confirmedAt: string }>,
  ): void {
    const system = overrides.system ?? "ucpath";
    mkdirSync(ledgerDirectory(w.stateRoot), { recursive: true });
    const path = ledgerFilePath(w.stateRoot, system, overrides.confirmedAt.slice(0, 10));
    appendFileSync(path, `${JSON.stringify({
      outboxId: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
      seq,
      payload: {
        ...LEDGER_PAYLOAD,
        system,
        idempotencyKeyDigest: deriveIdempotencyKeyDigest(system, IDEMPOTENCY_KEY),
        instance: overrides.instance ?? "prod",
        confirmedAt: overrides.confirmedAt,
      },
    })}\n`, "utf8");
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
    // No spans at all — the run corpus is empty for this range, which is also
    // what an archived-away week looks like. A ledger entry outlives the run
    // that filed it, so reporting "nothing was filed" here would be a false
    // statement about a real HR transaction.
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
