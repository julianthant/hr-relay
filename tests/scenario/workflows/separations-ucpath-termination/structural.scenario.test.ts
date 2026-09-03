/**
 * Executable scenarios for `separations-ucpath-termination` — separations
 * chunk 4 (`docs/migrations/separations.md` §3, §9.7): the UCPath termination
 * write and the pending sweep that precedes it.
 *
 * The corpus is split by what each arm falsifies:
 *
 * - **Task walks** run the REAL task implementations against the deterministic
 *   Smart HR driver, because a refusal is only observable as "it refused"
 *   rather than "it returned something plausible" when the real implementation
 *   runs. Every one of them is a scenario the behaviour review rates
 *   `silent-risk` in legacy (S45–S53).
 * - **A graph walk** runs the descriptor's real binds and its real terminal
 *   derive, so it falsifies the PATH and produces the coverage points the two
 *   transaction nodes exercise.
 *
 * Nothing here touches a browser and nothing here submits anything: the
 * controlled real commit is still open, waiting on the operator-named canary
 * (§4f2).
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import type { Page } from "playwright";
import { EidSchema, IsoInstantSchema } from "../../../../src/domain/ids.js";
import { directIdentifierDigestReference } from "../../../../src/domain/redaction.js";
import {
  UCPATH_SMART_HR_DISPLAYED_PERSON_NAME,
  UCPATH_SMART_HR_TERMINATION_STAGED,
  isUcpathTerminationAction,
  isUcpathTerminationInProgress,
} from "../../../../src/domain/ui/ucpath-smart-hr-termination.js";
import { WriteParkedError } from "../../../../src/core/write-sequencer.js";
import { ucpathPendingTransactionSetDigest } from "../../../../src/domain/contracts/ucpath/delete-pending-terminations.js";
import type {
  UcpathTerminationStaging,
  UcpathTransactionRow,
  UcpathTransactionScan,
} from "../../../../src/domain/ui/ucpath-smart-hr-termination.js";
import { MatchIdentityOutputSchema } from "../../../../src/domain/contracts/separations/match-identity.js";
import type { MatchIdentityOutput } from "../../../../src/domain/contracts/separations/match-identity.js";
import { UcpathJobSummaryReadSchema } from "../../../../src/domain/ui/ucpath-job-summary.js";
import type { UcpathJobSummary } from "../../../../src/domain/ui/ucpath-job-summary.js";
import type { SearchPersonOrgOutput } from "../../../../src/domain/contracts/ucpath/search-person-org.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../../src/stores/ucpath/driver/fake.js";
import { deriveJobRowFromCells } from "../../../../src/stores/ucpath/driver/person-org-operation.js";
import { readJobSummaryTask } from "../../../../src/stores/ucpath/tasks/read-job-summary.js";
import { matchIdentityTask } from "../../../../src/stores/separations/tasks/match-identity.js";
import { verifyIdentityApprovalTask } from "../../../../src/stores/separations/tasks/verify-identity-approval.js";
import { createDeterministicUcpathSmartHrDriver } from "../../../../src/stores/ucpath/driver/smart-hr-fake.js";
import { scanTerminationTransactionsOnPage } from "../../../../src/stores/ucpath/driver/smart-hr-operation.js";
import { matchExistingTerminationTask } from "../../../../src/stores/ucpath/tasks/match-existing-termination.js";
import { matchPendingTerminationsTask } from "../../../../src/stores/ucpath/tasks/match-pending-terminations.js";
import { stageTerminationTask } from "../../../../src/stores/ucpath/tasks/stage-termination.js";
import { verifyTerminationTask } from "../../../../src/stores/ucpath/tasks/verify-termination.js";
import { separationsUcpathTerminationDescriptor } from "../../../../src/workflows/separations/ucpath-transaction/descriptor.js";
import { SEPARATIONS_UCPATH_TERMINATION_CLAIMS } from "../../coverage-claims.js";
import { walkDescriptor } from "../../helpers/pure-walk.js";
import {
  SWEEP_IDEMPOTENCY_KEY,
  sweepIdempotencyKey,
  TERMINATION_EFFECTIVE_DATE,
  TERMINATION_EID,
  TERMINATION_FILE_NODE,
  TERMINATION_IDEMPOTENCY_KEY,
  TERMINATION_NAME,
  TERMINATION_OTHER_NAME,
  TERMINATION_RECEIPT,
  TERMINATION_SWEEP_NODE,
  terminationClaimRunning,
  terminationContext,
  terminationDurableFootprint,
  terminationHarness,
  terminationPendingSet,
  terminationQueuedRun,
  type TerminationHarness,
} from "../../../unit/fixtures/ucpath-termination-fixtures.js";
import { noSeparationWritePlan } from "../../../../src/domain/separations/write-plan.js";

const taskCtx = Object.freeze({
  signal: new AbortController().signal,
  log: Object.freeze({ debug: () => undefined, info: () => undefined, warn: () => undefined }),
  fail: (code: string, message: string): never => { throw new Error(`${code}: ${message}`); },
  recordData: () => undefined,
});

const EID = EidSchema.parse("10800000");
const NAME = "Primary Fixture";
const EFFECTIVE_DATE = "06/11/2026";
const LAST_DATE_WORKED = "06/10/2026";
const OBSERVED_AT = IsoInstantSchema.parse("2026-08-13T18:00:00.000Z");

const TARGET = Object.freeze({
  emplId: EID,
  expectedName: NAME,
  emplRecord: "0",
  effectiveDate: EFFECTIVE_DATE,
  template: "UC_VOL_TERM" as const,
  reasonCode: "Resign - No Reason Given",
  lastDateWorked: LAST_DATE_WORKED,
  initiatorComments: "Separation filed from Kuali RRSS document 4444.",
});

const SWEEP_TARGET = Object.freeze({
  emplId: EID,
  expectedName: NAME,
  observedSet: {
    kind: "ucpath-pending-termination-set" as const,
    emplId: EID,
    eligible: [],
    protected: [],
    observedAt: OBSERVED_AT,
    source: "ss-smart-hr-detail-read" as const,
  },
});

function scan(rows: readonly UcpathTransactionRow[]): UcpathTransactionScan {
  return { state: "read", emplId: EID, rows: [...rows], scannedRowCount: rows.length, observedAt: OBSERVED_AT };
}

function unreadable(reason: string): UcpathTransactionScan {
  return {
    state: "unreadable",
    emplId: EID,
    reason,
    diagnostic: { state: "not-attempted", cause: "not-indeterminate-settlement" },
    observedAt: OBSERVED_AT,
  };
}

function staging(overrides: Partial<UcpathTerminationStaging> = {}): UcpathTerminationStaging {
  return {
    stagedPageState: UCPATH_SMART_HR_TERMINATION_STAGED,
    emplId: EID,
    observedName: NAME,
    observedEmplRecord: "0",
    template: "UC_VOL_TERM",
    transactionDate: EFFECTIVE_DATE,
    effectiveDate: EFFECTIVE_DATE,
    resolvedReasonOption: "Resign - No Reason Given",
    observedReasonOptions: ["Resign - No Reason Given", "Resign - Personal Reasons"],
    lastDateWorked: LAST_DATE_WORKED,
    lastDateWorkedOverridden: true,
    transactionIdDisplay: "NEW",
    observedAt: OBSERVED_AT,
    ...overrides,
  };
}

/** One Employment Instances row, in the live grid's twelve-column order. */
const CELLS: readonly string[] = [
  "0", "07/01/2025", "Active", "SDCMP", "40012345", "000412",
  "HOUSING/DINING/HOSPITALITY", "004921", "STDT 2", "", "0.500000", "Student",
];

const DOCUMENT_NAME = "Fixture, Primary";

const RUN_INPUT = {
  documentNumber: "4444",
  employeeName: DOCUMENT_NAME,
  emplId: EID,
  emplIdSource: "document-eid" as const,
  documentEid: { state: "present" as const, value: EID },
  terminationType: { state: "present" as const, value: "No Reason Given" },
  observedTerminationTypeOptions: ["- - -", "No Reason Given"],
  emplRecord: "0",
  effectiveDate: EFFECTIVE_DATE,
  lastDateWorked: LAST_DATE_WORKED,
  initiatorComments: TARGET.initiatorComments,
};
const NAME_ONLY_RUN_INPUT = {
  ...RUN_INPUT,
  emplIdSource: "name-resolved" as const,
  documentEid: { state: "absent" as const, reason: "name-only structural path" },
};


function jobSummaryFixture(): UcpathJobSummary {
  const jobRows = [deriveJobRowFromCells(CELLS, 0)];
  return {
    pageStateId: "ucpath.person-org.detail-ready",
    emplId: EID,
    displayedName: NAME,
    jobRows,
    rowCount: jobRows.length,
    renderContext: {
      entry: "auto-detail",
      searchResultRows: 0,
      employmentInstances: "already-complete",
    },
    observedAt: OBSERVED_AT,
  };
}

function nameSearchFixture(): SearchPersonOrgOutput {
  const candidate = {
    emplId: EID,
    name: DOCUMENT_NAME,
    department: "Housing Dining Hospitality",
    jobTitle: "STDT 2",
    employeeStatus: "active" as const,
    hdh: true,
  };
  return {
    results: [candidate],
    selection: { status: "resolved", selected: candidate, candidateEids: [EID] },
  };
}

async function readJobSummaryFixture(): Promise<UcpathJobSummary> {
  const driver = createDeterministicUcpathPersonOrgDriver(
    undefined,
    UcpathJobSummaryReadSchema.parse({ state: "read", summary: jobSummaryFixture() }),
  );
  return await readJobSummaryTask.impl.run({
    input: { emplId: EID },
    ctx: { ...taskCtx, driver },
  }) as UcpathJobSummary;
}

async function comparisonFixture(
  summary: UcpathJobSummary,
  input: typeof RUN_INPUT | typeof NAME_ONLY_RUN_INPUT = RUN_INPUT,
): Promise<MatchIdentityOutput> {
  return MatchIdentityOutputSchema.parse(await matchIdentityTask.impl.run({
    input: {
      documentNumber: input.documentNumber,
      documentName: input.employeeName,
      documentEid: input.documentEid,
      emplId: input.emplId,
      emplIdSource: input.emplIdSource,
      jobSummary: summary,
      nameSelection: nameSearchFixture().selection,
      plan: noSeparationWritePlan("this fixture composes no separation write plan"),
    },
    ctx: taskCtx,
  }));
}

function claimFor(scenarioId: string): readonly string[] {
  const entry = SEPARATIONS_UCPATH_TERMINATION_CLAIMS.find((claim) => claim.scenarioId === scenarioId);
  assert.ok(entry, `no registered claim for ${scenarioId}`);
  return entry.covers;
}

const open: TerminationHarness[] = [];
afterEach(() => {
  for (const h of open.splice(0)) h.dispose();
});

function harness(options?: Parameters<typeof terminationHarness>[0]): TerminationHarness {
  const created = terminationHarness(options);
  open.push(created);
  return created;
}

/** The real `T009000010` shape, re-keyed to the fixture identity. */
function pendingTerminationRow(
  overrides: Partial<UcpathTransactionRow> = {},
): UcpathTransactionRow {
  return {
    transactionId: "T009000000",
    emplId: TERMINATION_EID,
    // `TER` — the PeopleSoft code the SS Smart HR grid and detail page BOTH
    // render live (2026-08-13). The descriptive `Terminatn` is the Transactions
    // in Progress grid's form, and both are accepted.
    action: "TER",
    approvalStatus: "Pending",
    startDate: TERMINATION_EFFECTIVE_DATE,
    displayedName: TERMINATION_NAME,
    ...overrides,
  };
}

describe("separations-ucpath-termination scenarios (chunk 4)", () => {
  /**
   * D215 — a preview runs beat ①'s probe first, so it reaches the arm the real
   * run would. Both subject shapes are walked: the sweep stages only when there
   * is something to sweep, and settles `already-present` for the ORDINARY
   * subject — the state §9.9 recorded as a prepare-time refusal, which is what
   * chunk 6b's live pass hit on its first real document.
   */
  it("separations-ucpath-termination/dry-run-preview — both transactions stage a real preparation and persist NOTHING", async () => {
    const withPending = harness({ rows: [pendingTerminationRow({ startDate: "05/01/2026" })] });
    const pending = terminationClaimRunning(
      withPending.database,
      withPending.clock,
      terminationQueuedRun({ dryRun: true }),
      TERMINATION_SWEEP_NODE,
    );
    const sweepWithWork = await withPending.bound(() => withPending.sequencer.executeDryRun(
      terminationContext(pending.run, pending.claim, TERMINATION_SWEEP_NODE, true, withPending.world.rows),
    ));
    assert.equal(sweepWithWork.probe.state, "absent");
    assert.equal(
      sweepWithWork.outcome.state === "would-prepare" ? sweepWithWork.outcome.subject.state : undefined,
      "match",
    );

    const h = harness();
    const { run, claim } = terminationClaimRunning(
      h.database, h.clock, terminationQueuedRun({ dryRun: true }), TERMINATION_SWEEP_NODE,
    );

    const sweep = await h.bound(() => h.sequencer.executeDryRun(
      terminationContext(run, claim, TERMINATION_SWEEP_NODE, true),
    ));
    const filing = await h.bound(() => h.sequencer.executeDryRun(
      terminationContext(run, claim, TERMINATION_FILE_NODE, true),
    ));

    assert.equal(sweep.kind, "transaction-dry-run-preview");
    assert.equal(filing.kind, "transaction-dry-run-preview");
    // Nothing pending: the sweep's probe settles first and the preview says so,
    // instead of refusing on a grid that carries no subject to bind.
    assert.equal(sweep.probe.state, "present");
    assert.deepEqual(sweep.outcome, { state: "already-present", proofSource: "live-probe" });
    assert.equal(filing.probe.state, "absent");
    assert.equal(
      filing.outcome.state === "would-prepare" ? filing.outcome.subject.state : undefined,
      "match",
    );
    // The whole three-page wizard WAS staged — this is a real preparation, not
    // a skipped one — and UCPath is untouched afterwards.
    assert.ok(h.world.events.includes(`stage:${TERMINATION_EFFECTIVE_DATE}`));
    assert.equal(h.world.events.some((event) => event.startsWith("commit:")), false, "zero clicks");
    assert.deepEqual(h.world.rows, [], "UCPath carries no new transaction");
    assert.equal(h.world.lastCapability, undefined, "no mutation capability was ever minted");
    assert.equal(withPending.world.rows.length, 1, "the pending row was neither swept nor duplicated");

    for (const [world, sweepKey] of [
      [withPending, sweepIdempotencyKey(withPending.world.rows)],
      [h, SWEEP_IDEMPOTENCY_KEY],
    ] as const) {
      for (const [node, key] of [
        [TERMINATION_SWEEP_NODE, sweepKey],
        [TERMINATION_FILE_NODE, TERMINATION_IDEMPOTENCY_KEY],
      ] as const) {
        const footprint = terminationDurableFootprint(world, node, key);
        assert.equal(footprint.intent, undefined, `${node}: zero write intents`);
        assert.equal(footprint.checkpoint, undefined, `${node}: zero transaction checkpoints`);
        assert.deepEqual(footprint.outboxes, [], `${node}: zero ledger/span outboxes`);
      }
    }

    assert.deepEqual(claimFor("separations-ucpath-termination/dry-run-preview"), [
      `transaction:${TERMINATION_SWEEP_NODE}/dry-run`,
      `transaction:${TERMINATION_FILE_NODE}/dry-run`,
    ]);
  });

  it("separations-ucpath-termination/subject-mismatch — a different displayed person yields zero fence and zero click", async () => {
    // The hardest arm, and the one ref write-safety beat ③ exists for: the probe AND the
    // prepare both saw the right person, then Page B moved to a different one
    // before the fence. It is also the arm legacy has NO control for at all —
    // it never reads the displayed name anywhere in the termination flow, which
    // is the structural cause of the wrong-person wrong-person termination.
    for (const node of [TERMINATION_SWEEP_NODE, TERMINATION_FILE_NODE]) {
      // The sweep needs something to sweep, or its probe settles
      // `already-present` before the subject is ever observed — which is itself
      // the correct behaviour and is covered by its own scenario below.
      const rows = node === TERMINATION_SWEEP_NODE
        ? [pendingTerminationRow({ startDate: "05/01/2026" })]
        : [];
      const h = harness({ rows, displayedNameAfterStage: TERMINATION_OTHER_NAME });
      const { run, claim } = terminationClaimRunning(
        h.database, h.clock, terminationQueuedRun(), node,
      );
      await assert.rejects(
        h.bound(() => h.sequencer.executeTransaction(
          terminationContext(run, claim, node, false, rows),
        )),
        /subject mismatch, zero fence, zero click/,
        node,
      );
      assert.equal(h.world.events.some((event) => event.startsWith("commit:")), false, `${node}: zero clicks`);
      assert.deepEqual(h.world.rows, rows, `${node}: UCPath was not written`);
      const key = node === TERMINATION_SWEEP_NODE ? sweepIdempotencyKey(rows) : TERMINATION_IDEMPOTENCY_KEY;
      const footprint = terminationDurableFootprint(h, node, key);
      assert.equal(footprint.intent, undefined, `${node}: the fence was never reached`);
      assert.equal(footprint.checkpoint, undefined, node);
    }

    assert.deepEqual(claimFor("separations-ucpath-termination/subject-mismatch"), [
      `transaction:${TERMINATION_SWEEP_NODE}/subject-mismatch`,
      `transaction:${TERMINATION_FILE_NODE}/subject-mismatch`,
    ]);
  });

  it("separations-ucpath-termination/committed — one fenced write files one termination, and the receipt is a PAIR", async () => {
    const h = harness();
    const { run, claim } = terminationClaimRunning(
      h.database, h.clock, terminationQueuedRun(), TERMINATION_FILE_NODE,
    );

    const outcome = await h.bound(() => h.sequencer.executeTransaction(
      terminationContext(run, claim, TERMINATION_FILE_NODE),
    ));

    assert.equal(Reflect.get(outcome as object, "disposition"), "committed");
    assert.equal(h.world.rows.length, 1, "exactly one termination was filed");
    assert.equal(h.world.rows[0]?.transactionId, TERMINATION_RECEIPT);
    // Exactly one click, and it carried a sequencer-minted capability.
    assert.equal(
      h.world.events.filter((event) => event.startsWith("commit:")).length, 1, "exactly one click",
    );
    assert.notEqual(h.world.lastCapability, undefined);
    const footprint = terminationDurableFootprint(h, TERMINATION_FILE_NODE, TERMINATION_IDEMPOTENCY_KEY);
    assert.notEqual(footprint.intent, undefined, "the fence is durable");
    assert.notEqual(footprint.checkpoint, undefined, "the settlement is durable");

    assert.deepEqual(claimFor("separations-ucpath-termination/committed"), [
      `transaction:${TERMINATION_FILE_NODE}/committed`,
    ]);
  });

  it("separations-ucpath-termination/already-present — an existing termination on the same date is the SAME transaction", async () => {
    // S44 and the whole reason the permanent key is EID + effective date: a
    // second run for the same person on the same date must find the first one
    // and refuse to file a duplicate, with no browser click at all.
    const h = harness({ rows: [pendingTerminationRow()] });
    const { run, claim } = terminationClaimRunning(
      h.database, h.clock, terminationQueuedRun(), TERMINATION_FILE_NODE,
    );

    const outcome = await h.bound(() => h.sequencer.executeTransaction(
      terminationContext(run, claim, TERMINATION_FILE_NODE),
    ));

    assert.equal(Reflect.get(outcome as object, "disposition"), "already-present");
    assert.equal(h.world.events.some((event) => event.startsWith("commit:")), false, "zero clicks");
    assert.equal(h.world.rows.length, 1, "no second termination was filed");

    assert.deepEqual(claimFor("separations-ucpath-termination/already-present"), [
      `transaction:${TERMINATION_FILE_NODE}/already-present`,
    ]);
  });

  it("separations-ucpath-termination/pending-sweep-committed — the delete is a fenced write, not a step inside a prepare", async () => {
    // S30/S31: legacy deletes every in-progress Terminat* row as *the first
    // mutation of the run*, with no fence, no permanent key and no read-back.
    const h = harness({ rows: [pendingTerminationRow(), pendingTerminationRow({
      transactionId: "T009000002", startDate: "05/01/2026",
    })] });
    const { run, claim } = terminationClaimRunning(
      h.database, h.clock, terminationQueuedRun(), TERMINATION_SWEEP_NODE,
    );

    const outcome = await h.bound(() => h.sequencer.executeTransaction(
      terminationContext(run, claim, TERMINATION_SWEEP_NODE, false, h.world.rows),
    ));

    assert.equal(Reflect.get(outcome as object, "disposition"), "committed");
    assert.deepEqual(h.world.rows, [], "both in-progress rows were swept");
    // The selection happened BEFORE the fence and the delete AFTER it. The
    // grid has no T-id column, so the driver associates the stable SS Smart HR
    // detail id only after a unique EID/name/date/action join.
    assert.ok(
      h.world.events.some((event) => event.startsWith("select:")
        && event.includes("06/11/2026") && event.includes("05/01/2026")),
      h.world.events.join(" | "),
    );
    const footprint = terminationDurableFootprint(
      h,
      TERMINATION_SWEEP_NODE,
      sweepIdempotencyKey([
        pendingTerminationRow(),
        pendingTerminationRow({ transactionId: "T009000002", startDate: "05/01/2026" }),
      ]),
    );
    assert.notEqual(footprint.intent, undefined, "a delete gets a fence like every other write");

    assert.deepEqual(claimFor("separations-ucpath-termination/pending-sweep-committed"), [
      `transaction:${TERMINATION_SWEEP_NODE}/committed`,
    ]);
  });

  it("separations-ucpath-termination/pending-sweep-nothing-to-do — a SETTLED termination is never swept", async () => {
    // The polarity that is easy to get backwards: `present` means there is
    // nothing to delete. An Approved termination is settled, so the sweep has
    // nothing to do even though the person HAS a termination row — deleting a
    // settled row would destroy the record of something that already happened.
    const settled = pendingTerminationRow({ transactionId: "T009000003", approvalStatus: "Approved" });
    assert.equal(isUcpathTerminationAction(settled.action), true);
    assert.equal(isUcpathTerminationInProgress(settled), false);
    const h = harness({ rows: [settled] });
    const { run, claim } = terminationClaimRunning(
      h.database, h.clock, terminationQueuedRun(), TERMINATION_SWEEP_NODE,
    );

    const outcome = await h.bound(() => h.sequencer.executeTransaction(
      terminationContext(run, claim, TERMINATION_SWEEP_NODE, false, [settled]),
    ));

    assert.equal(Reflect.get(outcome as object, "disposition"), "already-present");
    assert.equal(h.world.events.some((event) => event.startsWith("commit:")), false, "zero clicks");
    assert.deepEqual(h.world.rows, [settled], "the settled row is untouched");

    assert.deepEqual(claimFor("separations-ucpath-termination/pending-sweep-nothing-to-do"), [
      `transaction:${TERMINATION_SWEEP_NODE}/already-present`,
    ]);
  });

  it("separations-ucpath-termination/gate-approved — the whole graph, from two reads to two settled transactions", async () => {
    const summary = await readJobSummaryFixture();
    const comparison = await comparisonFixture(summary, NAME_ONLY_RUN_INPUT);
    const approval = {
      decision: "approved" as const,
      eid: EID,
      chosenFrom: "checked" as const,
      evidenceDigest: comparison.evidenceDigest,
    };
    const walk = walkDescriptor(separationsUcpathTerminationDescriptor, NAME_ONLY_RUN_INPUT, {
      outputs: {
        "job-summary": summary,
        "name-search": nameSearchFixture(),
        "termination-type": {
          terminationType: "No Reason Given",
          classification: "voluntary",
          template: "UC_VOL_TERM",
          reasonCode: "Resign - No Reason Given",
          observedOptionCount: 2,
        },
        comparison,
        "identity-approval": approval,
        approval: await verifyIdentityApprovalTask.impl.run({
          input: { packet: comparison.packet, evidenceDigest: comparison.evidenceDigest, approval },
          ctx: taskCtx,
        }),
        "pending-set": terminationPendingSet([], EID),
        "clear-pending": {
          disposition: "already-present",
          output: {
            cleared: {
              kind: "ucpath-pending-terminations-clear",
              emplId: EID,
              scannedRowCount: 1,
              observedAt: OBSERVED_AT,
              source: "ss-smart-hr-detail-read",
              version: 2,
              selectedTransactionIds: "none",
              protectedTransactionIds: "none",
              setDigest: ucpathPendingTransactionSetDigest(terminationPendingSet([], EID)),
            },
          },
        },
        "file-termination": {
          disposition: "committed",
          output: {
            receipt: {
              kind: "ucpath-termination",
              emplId: EID,
              effectiveDate: EFFECTIVE_DATE,
              transactionId: "T009000010",
              approvalStatus: "Pending",
              displayedName: NAME,
              source: "ss-smart-hr-detail-read",
            },
          },
        },
      },
    });

    // The gate's own points, and the descriptor's real terminal derive.
    for (const point of claimFor("separations-ucpath-termination/gate-approved")) {
      assert.ok(walk.covered.includes(point), point);
    }
    const result = walk.result as { approved: { authority: string }; termination: { proof: { transactionId: string } } };
    assert.equal(result.approved.authority, "operator-approval");
    assert.equal(result.termination.proof.transactionId, "T009000010");
  });

  it("separations-ucpath-termination/emplid-not-recognized — S48: UCPath never resolved the typed EID", async () => {
    // Legacy discovers this ten seconds later as an opaque timeout on the NEXT
    // page's first field. Here Page B's name anchor renders zero nodes — the
    // live signal (§9.8/§9.9) — and the task answers the contract's OWN code.
    //
    // The fixture is deliberately given a complete `staging`, so this cannot
    // pass on the generic "does not implement `stageTermination`" refusal. That
    // is what the scenario used to assert, which meant it would have passed for
    // any reason at all while `emplid-not-recognized` had no producer anywhere.
    const driver = createDeterministicUcpathSmartHrDriver({
      scan: scan([]),
      staging: staging(),
      emplIdNotRecognized: true,
    });
    await assert.rejects(
      stageTerminationTask.impl.run({ input: TARGET, ctx: { ...taskCtx, driver } }),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, /^emplid-not-recognized: /u, message);
        assert.match(message, new RegExp(directIdentifierDigestReference(EID), "u"), message);
        assert.doesNotMatch(message, new RegExp(EID, "u"), message);
        assert.doesNotMatch(message, /does not implement/u, message);
        return true;
      },
    );

    // And the same absence through the kernel's own beat-③ observation: there
    // is no subject to bind, so the read refuses rather than inventing a name.
    await assert.rejects(
      driver.read(UCPATH_SMART_HR_DISPLAYED_PERSON_NAME),
      /renders no Page-B name anchor/,
    );
  });

  it("separations-ucpath-termination/submit-refused — S47/S50: a refused submit parks, and files nothing", async () => {
    // The arm that could not fire before: `UiActionProofSchema.performed` is
    // `z.literal(true)`, so the commit task's `!action.performed` branch was
    // unreachable and `submit-refused` was a dead union member. A refusal is now
    // a typed THROW the task turns into its own code — post-fence, so the run
    // parks for an operator with the intent fenced and NO settlement.
    const h = harness({ commitPerformed: false });
    const { run, claim } = terminationClaimRunning(
      h.database, h.clock, terminationQueuedRun(), TERMINATION_FILE_NODE,
    );

    await assert.rejects(
      h.bound(() => h.sequencer.executeTransaction(
        terminationContext(run, claim, TERMINATION_FILE_NODE),
      )),
      (error: unknown) => {
        assert.ok(error instanceof WriteParkedError, String(error));
        return true;
      },
    );

    // The click DID happen — that is why this parks rather than failing — and
    // UCPath filed nothing, which is the whole difference from a landed write.
    assert.equal(
      h.world.events.filter((event) => event.startsWith("commit:")).length, 1, "exactly one click",
    );
    assert.deepEqual(h.world.rows, [], "a refused submit files no transaction");
    const footprint = terminationDurableFootprint(h, TERMINATION_FILE_NODE, TERMINATION_IDEMPOTENCY_KEY);
    assert.notEqual(footprint.intent, undefined, "the fence is durable: the click was reachable");
    const intent = footprint.intent as object;
    assert.equal(Reflect.get(intent, "status"), "parked", JSON.stringify(intent));
    assert.equal(Reflect.get(intent, "parkedCode"), "unknown", JSON.stringify(intent));
    // The durable authority reason retains a strict classification and evidence
    // digest. The operator sentence stays generic instead of replaying the
    // task's opaque exception text (which can contain person identifiers).
    assert.equal(
      Reflect.get(Reflect.get(intent, "authorityReason") as object, "code"),
      "post-fence-commit-exception",
    );
    assert.match(
      String(Reflect.get(Reflect.get(Reflect.get(intent, "authorityReason") as object, "evidence") as object, "digest")),
      /^[a-f0-9]{64}$/u,
    );
    assert.equal(
      String(Reflect.get(intent, "message")),
      "ucpath/create-termination threw after the fence; whether the external write landed is unknown",
    );
    assert.doesNotMatch(String(Reflect.get(intent, "message")), /submit-refused|10800009/u);
    assert.equal(footprint.checkpoint, undefined, "nothing settled over an unknown outcome");
  });

  it("separations-ucpath-termination/last-date-worked-not-verified — S49 refuses before any fence", async () => {
    const driver = createDeterministicUcpathSmartHrDriver({
      scan: scan([]),
      staging: staging({ lastDateWorked: "06/09/2026" }),
    });
    await assert.rejects(
      stageTerminationTask.impl.run({ input: TARGET, ctx: { ...taskCtx, driver } }),
      /last-date-worked-not-verified: .*06\/09\/2026/s,
    );
  });

  it("separations-ucpath-termination/submit-outcome-unknown — S51/S52: an unreadable post-submit read never says done", async () => {
    const driver = createDeterministicUcpathSmartHrDriver({
      scan: unreadable("the SS Smart HR search did not render a results grid within the bound"),
      displayedName: NAME,
    });
    const verdict = await verifyTerminationTask.impl.run({
      input: TARGET,
      ctx: { ...taskCtx, driver },
    });
    // `unknown`, which parks. It is emphatically NOT `absent`: the write may
    // have landed, and legacy's own best line refuses to guess here too.
    assert.equal(verdict.state, "unknown");
  });

  it("separations-ucpath-termination/unreadable-probe-is-not-absent — S45/S46 stated as code", async () => {
    // **S46** — the probe answered, and what it answered is "I could not read
    // this". That is `unknown`, which parks; `absent` would authorize a
    // duplicate.
    const unreadableDriver = createDeterministicUcpathSmartHrDriver({
      scan: unreadable("the transaction detail page did not render a Transaction ID"),
      displayedName: NAME,
    });
    const verdict = await matchExistingTerminationTask.impl.run({
      input: TARGET,
      ctx: { ...taskCtx, driver: unreadableDriver },
    });
    assert.equal(verdict.state, "unknown");
    assert.notEqual(verdict.state, "absent");

    // **S45** — the probe THROWS. A different failure, and the one this title
    // used to claim without simulating: it must propagate, never be caught into
    // a verdict of any kind. "The lookup blew up" is not an answer about this
    // person's transactions.
    const throwingDriver = createDeterministicUcpathSmartHrDriver({
      scan: scan([]),
      scanThrows: "the SS Smart HR search page never loaded",
      displayedName: NAME,
    });
    await assert.rejects(
      matchExistingTerminationTask.impl.run({
        input: TARGET,
        ctx: { ...taskCtx, driver: throwingDriver },
      }),
      /the SS Smart HR search page never loaded/,
    );
  });

  it("separations-ucpath-termination/pending-sweep-refuses-unreadable-scan — a delete never runs on a guess", async () => {
    const driver = createDeterministicUcpathSmartHrDriver({
      scan: unreadable("the Transactions in Progress grid did not render"),
      displayedName: NAME,
    });
    const verdict = await matchPendingTerminationsTask.impl.run({
      input: SWEEP_TARGET,
      ctx: { ...taskCtx, driver },
    });
    // NOT `present`. "We could not read the grid" must never settle as "there
    // is nothing pending", because that lets the termination file on top of a
    // pending duplicate.
    assert.equal(verdict.state, "unknown");
  });

  it("preserves one redacted settlement diagnostic when the dry-run preview refuses unknown", async () => {
    const diagnostic = {
      state: "captured" as const,
      banner: "positive-count" as const,
      oldRowCount: 2,
      route: "ss-smart-hr-search" as const,
      iframeCount: 0,
      errorRegionCount: 1,
      searchVisible: true,
      searchEnabled: true,
    };
    const h = harness({
      unreadable: {
        reason: "the SS Smart HR settlement remained indeterminate",
        diagnostic,
      },
    });
    const { run, claim } = terminationClaimRunning(
      h.database,
      h.clock,
      terminationQueuedRun({ dryRun: true }),
      TERMINATION_SWEEP_NODE,
    );

    await assert.rejects(
      h.bound(() => h.sequencer.executeDryRun(
        terminationContext(run, claim, TERMINATION_SWEEP_NODE, true),
      )),
      /preview probe .* is indeterminate/u,
    );

    const observed = h.emitter.events().flatMap((event) => {
      if (event.t !== "data.observed") return [];
      return event.taskId === "ucpath/match-pending-terminations"
        && event.points.some((point) => point.field === "diagnostic")
        ? [event]
        : [];
    });
    assert.equal(observed.length, 1);
    assert.deepEqual(observed[0]?.points, [{
      direction: "read",
      field: "diagnostic",
      values: [
        { key: "diagnostic.banner", state: "allowed", classification: "safe-diagnostic", transform: "allow", value: "positive-count" },
        { key: "diagnostic.errorRegionCount", state: "allowed", classification: "safe-diagnostic", transform: "allow", value: 1 },
        { key: "diagnostic.iframeCount", state: "allowed", classification: "safe-diagnostic", transform: "allow", value: 0 },
        { key: "diagnostic.oldRowCount", state: "allowed", classification: "safe-diagnostic", transform: "allow", value: 2 },
        { key: "diagnostic.route", state: "allowed", classification: "safe-diagnostic", transform: "allow", value: "ss-smart-hr-search" },
        { key: "diagnostic.searchEnabled", state: "allowed", classification: "safe-diagnostic", transform: "allow", value: true },
        { key: "diagnostic.searchVisible", state: "allowed", classification: "safe-diagnostic", transform: "allow", value: true },
        { key: "diagnostic.state", state: "allowed", classification: "safe-diagnostic", transform: "allow", value: "captured" },
      ],
    }]);
  });

  it("keeps identifier-bearing page failures out of clear-pending preview failure material", async () => {
    const eidSuffix = String(EID).slice(-4);
    const page = {
      goto: async () => {
        throw new Error(
          `fixture page closed during SS Smart HR search for EID ${EID} / …${eidSuffix}`,
        );
      },
    } as unknown as Page;
    const scanResult = await scanTerminationTransactionsOnPage(page, { emplId: EID }, OBSERVED_AT);
    assert.equal(scanResult.state, "unreadable");
    if (scanResult.state !== "unreadable") return;
    const h = harness({
      unreadable: { reason: scanResult.reason, diagnostic: scanResult.diagnostic },
    });
    const { run, claim } = terminationClaimRunning(
      h.database,
      h.clock,
      terminationQueuedRun({ dryRun: true }),
      TERMINATION_SWEEP_NODE,
    );
    const previewFailure: unknown = await h.bound(
      () => h.sequencer.executeDryRun(
        terminationContext(run, claim, TERMINATION_SWEEP_NODE, true),
      ),
    ).then(
      () => undefined,
      (error: unknown) => error,
    );

    assert.ok(previewFailure instanceof Error);
    const failureMaterial = JSON.stringify({
      rejected: previewFailure.message,
      failedSpans: h.emitter.events().filter(
        (event) => event.t === "span.ended" && event.outcome === "failed",
      ),
    });
    assert.doesNotMatch(failureMaterial, new RegExp(String(EID), "u"));
    assert.doesNotMatch(failureMaterial, new RegExp(eidSuffix, "u"));
    assert.match(previewFailure.message, /is indeterminate; the real run would refuse/u);
    assert.doesNotMatch(previewFailure.message, /fixture page closed during SS Smart HR search/u);

    const observed = h.emitter.events().flatMap((event) => {
      if (event.t !== "data.observed") return [];
      return event.taskId === "ucpath/match-pending-terminations"
        && event.points.some((point) => point.field === "diagnostic")
        ? [event]
        : [];
    });
    assert.equal(observed.length, 1);
    assert.deepEqual(observed[0]?.points, [{
      direction: "read",
      field: "diagnostic",
      values: [
        { key: "diagnostic.cause", state: "allowed", classification: "safe-diagnostic", transform: "allow", value: "not-indeterminate-settlement" },
        { key: "diagnostic.state", state: "allowed", classification: "safe-diagnostic", transform: "allow", value: "not-attempted" },
      ],
    }]);
  });
});
