/**
 * Executable scenarios for `separations` — chunk 6, the COMPOSITION.
 *
 * Three kinds of arm, the same split chunk 5 established:
 *
 * - **Fold walks** run the REAL task implementations of the five folds only a
 *   composition needs, because a refusal is observable as "it refused" rather
 *   than "it returned something plausible" only when the real implementation
 *   runs. They walk no graph path and correctly claim none.
 * - **Sequencer walks** drive the REAL write sequencer over a REAL authority
 *   database and BOTH deterministic browsers, which is the only way to say
 *   "zero rows in `write_intents`" about anything. They produce the three
 *   transaction nodes' twelve coverage points, plus §4c's park.
 * - **A pure graph walk** runs every one of the descriptor's real binds and its
 *   real terminal derive, so it falsifies the PATH and produces the gate's two
 *   points.
 *
 * Nothing here touches a browser and nothing here writes anything real: the
 * live pipeline dry run is 6b, and the controlled real commit is still open on
 * the operator's §4f2 canary.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { descriptorRuntimeNodes } from "../../src/base/workflow.js";
import { WriteParkedError } from "../../src/core/write-sequencer.js";
import { NewKronosReadSeparationTimecard } from "../../src/domain/contracts/new-kronos/read-separation-timecard.js";
import { deriveItemId } from "../../src/domain/identifiers.js";
import { DateOnlySchema, EidSchema, IsoInstantSchema } from "../../src/domain/ids.js";
import { MatchIdentityOutputSchema } from "../../src/domain/contracts/separations/match-identity.js";
import { deriveIdentityEvidenceDigest } from "../../src/domain/separations/identity-evidence.js";
import { KUALI_TERMINATION_TYPE_OPTIONS } from "../../src/domain/separations/termination-type.js";
import type { KualiDateField } from "../../src/domain/ui/kuali-separation-document.js";
import type { UcpathPersonSelection } from "../../src/domain/contracts/ucpath/search-person-org.js";
import type { UcpathJobRow, UcpathJobSummary } from "../../src/domain/ui/ucpath-job-summary.js";
import type { UcpathTerminationProof } from "../../src/domain/ui/ucpath-smart-hr-termination.js";
import type { UcpathTransactionRow } from "../../src/domain/ui/ucpath-smart-hr-termination.js";
import { matchActiveEmploymentTask } from "../../src/stores/separations/tasks/match-active-employment.js";
import { matchDepartmentOptionTask } from "../../src/stores/separations/tasks/match-department-option.js";
import { matchIdentityTask } from "../../src/stores/separations/tasks/match-identity.js";
import { matchSeparationSubjectTask } from "../../src/stores/separations/tasks/match-separation-subject.js";
import { matchTerminationTypeTask } from "../../src/stores/separations/tasks/match-termination-type.js";
import { readSeparationDatesTask } from "../../src/stores/separations/tasks/read-separation-dates.js";
import { readSeparationPlanTask } from "../../src/stores/separations/tasks/read-separation-plan.js";
import { verifyIdentityApprovalTask } from "../../src/stores/separations/tasks/verify-identity-approval.js";
import { verifyTerminationReceiptTask } from "../../src/stores/separations/tasks/verify-termination-receipt.js";
import {
  SeparationsCanonicalInput,
  separationsDescriptor,
} from "../../src/workflows/separations/descriptor.js";
import { SEPARATIONS_CLAIMS } from "./coverage-claims.js";
import { walkDescriptor } from "./helpers/pure-walk.js";
import {
  COMPOSITION_ACTION_ID,
  COMPOSITION_AS_OF_DATE,
  COMPOSITION_DEPARTMENT_OPTION,
  COMPOSITION_DOCUMENT,
  COMPOSITION_DOCUMENT_NAME,
  COMPOSITION_EFFECTIVE_DATE,
  COMPOSITION_EID,
  COMPOSITION_FINALIZATION_COMMENTS,
  COMPOSITION_FINALIZATION_FIELDS,
  COMPOSITION_KUALI_LDW,
  COMPOSITION_LAST_DAY_WORKED,
  COMPOSITION_OTHER_EID,
  COMPOSITION_OTHER_NAME,
  COMPOSITION_RECEIPT,
  COMPOSITION_RUN_INPUT,
  COMPOSITION_SEPARATION_DATE,
  COMPOSITION_TIMEKEEPER,
  COMPOSITION_UCPATH_NAME,
  COMPOSITION_WORKFLOW_ID,
  FINALIZATION_IDEMPOTENCY_KEY,
  FINALIZE_NODE,
  SWEEP_IDEMPOTENCY_KEY,
  SWEEP_NODE,
  TERMINATION_IDEMPOTENCY_KEY,
  TERMINATION_NODE,
  compositionClaimRunning,
  compositionContext,
  compositionDurableFootprint,
  compositionHarness,
  compositionQueuedRun,
  type CompositionHarness,
} from "../unit/fixtures/separations-composition-fixtures.js";

const FAILURES: string[] = [];
const taskCtx = Object.freeze({
  signal: new AbortController().signal,
  log: Object.freeze({ debug: () => undefined, info: () => undefined, warn: () => undefined }),
  fail: (code: string, message: string): never => {
    FAILURES.push(code);
    throw new Error(`${code}: ${message}`);
  },
  recordData: () => undefined,
});

async function refusalCode(run: () => Promise<unknown>): Promise<string> {
  const before = FAILURES.length;
  await assert.rejects(run);
  return FAILURES[before] ?? "<no ctx.fail was called>";
}

function claimFor(scenarioId: string): readonly string[] {
  const entry = SEPARATIONS_CLAIMS.find((candidate) => candidate.scenarioId === scenarioId);
  assert.ok(entry, `no registered claim for ${scenarioId}`);
  return entry.covers;
}

/* ── the fold half: what a composition needs and no chunk owned ───────────── */

const OBSERVED_AT = IsoInstantSchema.parse("2026-08-14T19:00:00.000Z");

const kualiDate = (raw: string): KualiDateField => ({
  state: "present",
  raw,
  value: DateOnlySchema.parse(`${raw.slice(6, 10)}-${raw.slice(0, 2)}-${raw.slice(3, 5)}`),
});
const cell = (value: string) => ({ state: "present" as const, value });
const noCell = (reason: string) => ({ state: "absent" as const, reason });

/** §9.3's complete `Department*` capture, verbatim. */
const LIVE_DEPARTMENT_OPTIONS: readonly string[] = Object.freeze([
  "- - -",
  "000141 - Early Childhood Education Center",
  COMPOSITION_DEPARTMENT_OPTION,
  "000414 - Bookstore",
  "000422 - Triton Print & Digital Media",
  "000719 -  Supply Chain Services",
]);

function jobRow(overrides: Partial<UcpathJobRow> = {}): UcpathJobRow {
  return {
    rowIndex: 0,
    emplRecord: "0",
    hrStatus: "Active",
    businessUnit: "SDCMP",
    effectiveDate: cell("07/01/2025"),
    positionNumber: cell("40012345"),
    deptId: cell("000412"),
    department: cell("HOUSING/DINING/HOSPITALITY"),
    jobCode: cell("004921"),
    jobTitle: cell("STDT 2"),
    expectedJobEndDate: noCell("the grid rendered this cell empty"),
    fte: cell("0.500000"),
    emplClass: cell("Student"),
    ...overrides,
  };
}

function jobSummary(rows: readonly UcpathJobRow[] = [jobRow()]): UcpathJobSummary {
  return {
    pageStateId: "ucpath.person-org.detail-ready",
    emplId: COMPOSITION_EID,
    displayedName: COMPOSITION_UCPATH_NAME,
    jobRows: [...rows],
    rowCount: rows.length,
    renderContext: {
      entry: "auto-detail",
      searchResultRows: 0,
      employmentInstances: "already-complete",
    },
    observedAt: OBSERVED_AT,
  };
}

function planInput(overrides: Record<string, unknown> = {}) {
  return {
    documentNumber: COMPOSITION_DOCUMENT,
    employeeName: { state: "present" as const, value: COMPOSITION_DOCUMENT_NAME },
    lastDayWorked: kualiDate(COMPOSITION_KUALI_LDW),
    separationDate: kualiDate(COMPOSITION_KUALI_LDW),
    observedAt: OBSERVED_AT,
    ...overrides,
  };
}

async function runPlan(overrides: Record<string, unknown> = {}) {
  return await readSeparationPlanTask.impl.run({ input: planInput(overrides), ctx: taskCtx });
}

async function runDates(overrides: Record<string, unknown> = {}) {
  const plan = await runPlan();
  return await readSeparationDatesTask.impl.run({
    input: {
      plan,
      timekeeperName: COMPOSITION_TIMEKEEPER,
      lastPunchDate: COMPOSITION_LAST_DAY_WORKED,
      sickDates: [],
      holidayDates: [COMPOSITION_SEPARATION_DATE],
      unclassifiedPayCodes: ["Independence Day Observed", "Juneteenth Observed"],
      observedWindow: { start: "05/12/2026", end: "07/12/2026" },
      ...overrides,
    },
    ctx: taskCtx,
  });
}

function terminationProof(overrides: Partial<UcpathTerminationProof> = {}): UcpathTerminationProof {
  return {
    kind: "ucpath-termination",
    emplId: COMPOSITION_EID,
    effectiveDate: COMPOSITION_EFFECTIVE_DATE,
    transactionId: COMPOSITION_RECEIPT,
    approvalStatus: "Pending",
    displayedName: COMPOSITION_UCPATH_NAME,
    source: "ss-smart-hr-detail-read",
    ...overrides,
  };
}

/* ── the sequencer half ───────────────────────────────────────────────────── */

function inProgressTermination(
  overrides: Partial<UcpathTransactionRow> = {},
): UcpathTransactionRow {
  return {
    transactionId: "T009000000",
    emplId: COMPOSITION_EID,
    // `TER` — the PeopleSoft code the SS Smart HR grid and detail page BOTH
    // render live (2026-08-13, D206).
    action: "TER",
    approvalStatus: "Pending",
    startDate: COMPOSITION_EFFECTIVE_DATE,
    displayedName: COMPOSITION_UCPATH_NAME,
    ...overrides,
  };
}

const open: CompositionHarness[] = [];
afterEach(() => {
  for (const harness of open.splice(0)) harness.dispose();
});

function harness(options?: Parameters<typeof compositionHarness>[0]): CompositionHarness {
  const created = compositionHarness(options);
  open.push(created);
  return created;
}

describe("separations scenarios — the composition", () => {
  it("separations/plan-refusals — the document's own facts, validated before any other read", async () => {
    const planned = await runPlan();
    assert.equal(planned.employeeName, COMPOSITION_DOCUMENT_NAME);
    assert.equal(planned.asOfDate, COMPOSITION_AS_OF_DATE);
    // The ±1-month window legacy measured: narrower ones missed timecards.
    assert.deepEqual(planned.timecardWindow, { start: "05/12/2026", end: "07/12/2026" });

    for (const [code, overrides] of [
      ["employee-name-absent", { employeeName: noCell("the control was empty") }],
      ["last-day-worked-absent", { lastDayWorked: noCell("the control was empty") }],
      ["separation-date-absent", { separationDate: noCell("the control was empty") }],
      // S7. Live doc 4495 carried 09/02/2026 three weeks before it was read —
      // chunk 2 deliberately does NOT refuse that, because reading a form is
      // not filing a termination. This node is where it refuses.
      ["separation-date-in-future", { separationDate: kualiDate("09/02/2026") }],
    ] as const) {
      assert.equal(await refusalCode(() => runPlan(overrides)), code);
    }

  });

  it("separations/subject-resolution — S18/S19's fork, resolved inline rather than delegated", async () => {
    const resolved = await matchSeparationSubjectTask.impl.run({
      input: {
        documentNumber: COMPOSITION_DOCUMENT,
        employeeName: COMPOSITION_DOCUMENT_NAME,
        documentEid: { state: "present", value: COMPOSITION_EID },
        nameSelection: {
          status: "resolved",
          selected: {
            emplId: COMPOSITION_EID,
            name: COMPOSITION_DOCUMENT_NAME,
            department: "Housing Dining Hospitality",
            jobTitle: "STDT 2",
            employeeStatus: "active",
            hdh: true,
          },
          candidateEids: [COMPOSITION_EID],
        },
      },
      ctx: taskCtx,
    });
    assert.equal(resolved.emplIdSource, "document-eid");

    // §5 item 10: no delegation. A blank EID whose name resolves nobody — or
    // several people — is a subject this run may not pick, and legacy's answer
    // (delegate to person-lookup, proceed on whatever comes back) does not port.
    const blankSubjectArms: readonly (readonly [string, UcpathPersonSelection])[] = [
      ["subject-not-resolvable", {
        status: "not-found" as const,
        selected: null,
        candidateEids: [],
        searchName: COMPOSITION_DOCUMENT_NAME,
      }],
      ["subject-ambiguous", {
        status: "ambiguous" as const,
        selected: null,
        candidateEids: [COMPOSITION_EID, COMPOSITION_OTHER_EID],
        searchName: COMPOSITION_DOCUMENT_NAME,
      }],
    ];
    for (const [code, nameSelection] of blankSubjectArms) {
      assert.equal(
        await refusalCode(() => matchSeparationSubjectTask.impl.run({
          input: {
            documentNumber: COMPOSITION_DOCUMENT,
            employeeName: COMPOSITION_DOCUMENT_NAME,
            documentEid: { state: "absent", reason: "the EID control was empty" },
            nameSelection,
          },
          ctx: taskCtx,
        })),
        code,
      );
    }

  });

  it("separations/employment-refusals — S23/S24, refused BEFORE a human is asked", async () => {
    const selected = await matchActiveEmploymentTask.impl.run({
      input: { documentNumber: COMPOSITION_DOCUMENT, jobSummary: jobSummary() },
      ctx: taskCtx,
    });
    assert.equal(selected.emplRecord, "0");
    assert.equal(selected.payrollTitleCode, "004921");

    for (const [code, rows] of [
      ["no-active-employment", [jobRow({ hrStatus: "Terminated" })]],
      ["concurrent-active-employments", [jobRow(), jobRow({ rowIndex: 1, emplRecord: "1" })]],
      ["indeterminate-employment-status", [jobRow({ hrStatus: "Suspended-Pending Review" })]],
      ["payroll-title-code-unreadable", [jobRow({ jobCode: noCell("blank") })]],
      ["payroll-title-unreadable", [jobRow({ jobTitle: noCell("blank") })]],
    ] as const) {
      assert.equal(
        await refusalCode(() => matchActiveEmploymentTask.impl.run({
          input: { documentNumber: COMPOSITION_DOCUMENT, jobSummary: jobSummary(rows) },
          ctx: taskCtx,
        })),
        code,
      );
    }

  });

  it("separations/date-reconciliation — the write's payload, and the Observed codes it did not count", async () => {
    const dates = await runDates();
    assert.equal(dates.lastDayWorked, COMPOSITION_LAST_DAY_WORKED);
    assert.equal(dates.separationDate, COMPOSITION_SEPARATION_DATE, "the holiday moved it");
    assert.equal(dates.terminationEffectiveDate, COMPOSITION_EFFECTIVE_DATE, "separation date + 1");
    assert.equal(dates.separationDateChanged, true);
    // §9.1's 2026-08-13 answer: legacy-identical, and VISIBLE. The two zero-hour
    // "Observed" codes never reach `holidayDates` and never move the date; what
    // this fold owes in exchange is that the operator can see them.
    assert.deepEqual(dates.unclassifiedPayCodes, [
      "Independence Day Observed",
      "Juneteenth Observed",
    ]);
    assert.match(dates.terminationComments, /Holiday Pay on 06\/19\/2026\./u);
    assert.match(dates.dateChangeComments, /Updated Separation Date from 06\/12\/2026 to 06\/19\/2026/u);

  });

  it("separations/receipt-refusals — D130's Denied receipt never reaches the Kuali document", async () => {
    const accepted = await verifyTerminationReceiptTask.impl.run({
      input: {
        proof: terminationProof(),
        disposition: "committed",
        approvedEmplId: COMPOSITION_EID,
        expectedEffectiveDate: COMPOSITION_EFFECTIVE_DATE,
      },
      ctx: taskCtx,
    });
    assert.equal(accepted.transactionNumber, COMPOSITION_RECEIPT);
    assert.equal(accepted.approvalStatus, "Pending");

    for (const [code, overrides] of [
      // The live proof of the class: `T002204014` is a perfectly well-formed
      // T-number on a transaction UCPath REFUSED, and legacy's own read-back
      // tests only `/^T\d{6,}$/`.
      ["termination-not-in-effect", { approvalStatus: "Denied" as const }],
      ["termination-receipt-subject-mismatch", { emplId: COMPOSITION_OTHER_EID }],
      ["termination-receipt-date-mismatch", { effectiveDate: "06/11/2026" }],
    ] as const) {
      assert.equal(
        await refusalCode(() => verifyTerminationReceiptTask.impl.run({
          input: {
            proof: terminationProof(overrides),
            disposition: "already-present",
            approvedEmplId: COMPOSITION_EID,
            expectedEffectiveDate: COMPOSITION_EFFECTIVE_DATE,
          },
          ctx: taskCtx,
        })),
        code,
      );
    }

  });

  it("separations/kronos-hard-fails — §4b has no park arm, and no run mode changes the graph", async () => {
    // §4b's answer is hard-fail, always, and §4d's is that no preset, prefill or
    // resume changes the identity path. Both are STRUCTURAL here: a graph with
    // no branch and no `when` cannot grow a mode.
    const nodes = descriptorRuntimeNodes(separationsDescriptor);
    assert.equal(nodes.some((node) => node.kind === "branch" || node.kind === "parallel"), false);
    assert.equal(
      nodes.some((node) => node.kind === "task" && node.when !== undefined),
      false,
      "a `when` anywhere in this graph is a run mode waiting to happen",
    );

    // The four §4b values stay DISTINCT in the data model even though all four
    // fail today, because they are what a future §3.1 recomposition selects on.
    assert.deepEqual([...NewKronosReadSeparationTimecard.errorCodes], [
      "new-kronos-unavailable",
      "unexpected-page-state",
      "subject-mismatch",
      "timecard-navigation-failed",
      "timecard-range-not-applied",
      "timecard-unreadable",
    ]);

    // And the one arm where the READ succeeded and still established nothing.
    assert.equal(
      await refusalCode(() => runDates({ lastPunchDate: null, holidayDates: [] })),
      "no-punch-in-window",
    );

  });

  it("separations/re-read-is-a-new-item — an explicit re-read is a new ITEM and never a second write", () => {
    // §"the re-run wall" item 2. A checkpoint is keyed (workflow, itemId, node,
    // attempt) with no run id, so a second run of one document replays the
    // first run's reads — whose `observedAt` differs by construction. The
    // operator's explicit re-read is part of the canonical input, therefore
    // part of `matchKey`, therefore a NEW logical item.
    const base = SeparationsCanonicalInput.parse({ ...COMPOSITION_RUN_INPUT });
    const reRead = SeparationsCanonicalInput.parse({
      ...COMPOSITION_RUN_INPUT,
      reRead: { ordinal: 1, reason: "the department corrected the last day worked" },
    });
    const matchKey = separationsDescriptor.identity.matchKey;
    assert.equal(matchKey(base), `separations:${COMPOSITION_DOCUMENT}`);
    assert.equal(matchKey(reRead), `separations:${COMPOSITION_DOCUMENT}#re-read-1`);
    assert.notEqual(
      deriveItemId(COMPOSITION_WORKFLOW_ID, matchKey(base)),
      deriveItemId(COMPOSITION_WORKFLOW_ID, matchKey(reRead)),
    );
    // Same ordinal, same item — a re-read is a decision, not a nonce.
    assert.equal(matchKey(reRead), matchKey(SeparationsCanonicalInput.parse({
      ...COMPOSITION_RUN_INPUT,
      reRead: { ordinal: 1, reason: "a different reason for the same re-read" },
    })));
    // And it changes NO permanent key: those are derived from the EID, the
    // effective date and the document, so a re-read can never file a second
    // termination — doc 09's same-key mutex refuses the second fence.
    assert.match(TERMINATION_IDEMPOTENCY_KEY, /^ucpath:termination\|/u);
    assert.equal(TERMINATION_IDEMPOTENCY_KEY.includes("re-read"), false);
    assert.equal(SWEEP_IDEMPOTENCY_KEY.includes("re-read"), false);
    assert.equal(FINALIZATION_IDEMPOTENCY_KEY.includes("re-read"), false);

  });

  /* ── the sequencer half: the real sequencer over a real authority DB ────── */

  /**
   * D215 — the preview runs beat ①'s probe FIRST, so a rehearsal reaches the
   * same arm the performance would. Both subject shapes are walked here, because
   * §9.9's recorded refusal was reachable ONLY in the shape the old preview
   * could not tell apart:
   *
   * - a subject WITH a pending transaction: the sweep has work, so it stages;
   * - the ORDINARY subject, with none: the sweep's probe settles
   *   `already-present` before any page is staged, which is what the real run
   *   does — and used to surface as a prepare-time refusal naming a subject the
   *   grid does not carry. That is the exact state chunk 6b's live pass hit on
   *   its first real document.
   *
   * Nothing durable moves in either shape, asserted against the authority rows.
   */
  it("separations/dry-run-preview — all three transactions preview and NOTHING durable moves", async () => {
    const withPending = harness({ rows: [inProgressTermination()] });
    const pendingRun = compositionClaimRunning(
      withPending.database, withPending.clock, compositionQueuedRun({ dryRun: true }), SWEEP_NODE,
    );
    const sweepWithWork = await withPending.bound(() => withPending.sequencer.executeDryRun(
      compositionContext(pendingRun.run, pendingRun.claim, SWEEP_NODE, true),
    ));
    assert.equal(sweepWithWork.kind, "transaction-dry-run-preview");
    assert.equal(sweepWithWork.probe.state, "absent", "there is a row to sweep, so the key reads absent");
    assert.equal(sweepWithWork.outcome.state, "would-prepare");
    assert.equal(
      sweepWithWork.outcome.state === "would-prepare" ? sweepWithWork.outcome.subject.state : undefined,
      "match",
    );
    assert.equal(withPending.ucpath.rows.length, 1, "the pending row was neither swept nor duplicated");

    /* ── the ordinary subject: no pending transaction anywhere ────────────── */
    const h = harness();
    const { run, claim } = compositionClaimRunning(
      h.database, h.clock, compositionQueuedRun({ dryRun: true }), SWEEP_NODE,
    );

    const sweep = await h.bound(() => h.sequencer.executeDryRun(
      compositionContext(run, claim, SWEEP_NODE, true),
    ));
    // §9.9's state, previewed HONESTLY: the real run settles here too, so the
    // preview reports the settlement rather than refusing on a page it should
    // never have staged.
    assert.equal(sweep.probe.state, "present");
    assert.deepEqual(sweep.outcome, { state: "already-present", proofSource: "live-probe" });
    assert.equal(
      h.ucpath.events.some((event) => event.startsWith("stage:")),
      false,
      "nothing was staged: the probe settled first, exactly as the real run does",
    );

    for (const node of [TERMINATION_NODE, FINALIZE_NODE]) {
      const preview = await h.bound(() => h.sequencer.executeDryRun(
        compositionContext(run, claim, node, true),
      ));
      assert.equal(preview.kind, "transaction-dry-run-preview", node);
      assert.equal(preview.probe.state, "absent", node);
      assert.equal(
        preview.outcome.state === "would-prepare" ? preview.outcome.subject.state : undefined,
        "match",
        node,
      );
    }

    for (const world of [withPending, h]) {
      assert.equal(world.ucpath.events.some((event) => event.startsWith("commit:")), false, "zero UCPath clicks");
      assert.equal(world.kuali.events.some((event) => event.startsWith("commit:")), false, "zero Kuali clicks");
      assert.equal(world.kuali.persistedFinalization, undefined, "the document is still unfinalized");
      for (const [system, node, key] of [
        ["ucpath", SWEEP_NODE, SWEEP_IDEMPOTENCY_KEY],
        ["ucpath", TERMINATION_NODE, TERMINATION_IDEMPOTENCY_KEY],
        ["kuali", FINALIZE_NODE, FINALIZATION_IDEMPOTENCY_KEY],
      ] as const) {
        const footprint = compositionDurableFootprint(world, system, node, key);
        assert.equal(footprint.intent, undefined, `${node}: zero write intents`);
        assert.equal(footprint.checkpoint, undefined, `${node}: zero transaction checkpoints`);
        assert.deepEqual(footprint.outboxes, [], `${node}: zero ledger/span outboxes`);
      }
    }

    assert.deepEqual(claimFor("separations/dry-run-preview"), [
      `transaction:${SWEEP_NODE}/dry-run`,
      `transaction:${TERMINATION_NODE}/dry-run`,
      `transaction:${FINALIZE_NODE}/dry-run`,
    ]);
  });

  it("separations/subject-mismatch — a page that moved after staging yields zero fence and zero click", async () => {
    // Doc 09 beat ③, on all three writes. The composition is where this matters
    // most: three fences over two systems, and the operator approved ONE person.
    for (const node of [SWEEP_NODE, TERMINATION_NODE]) {
      // The sweep needs something to sweep, or its probe settles
      // `already-present` before the subject is ever observed.
      const rows = node === SWEEP_NODE ? [inProgressTermination({ startDate: "05/01/2026" })] : [];
      const h = harness({ rows, ucpathNameAfterStage: COMPOSITION_OTHER_NAME });
      const { run, claim } = compositionClaimRunning(
        h.database, h.clock, compositionQueuedRun(), node,
      );
      await assert.rejects(
        h.bound(() => h.sequencer.executeTransaction(compositionContext(run, claim, node))),
        /subject mismatch, zero fence, zero click/u,
        node,
      );
      assert.equal(h.ucpath.events.some((event) => event.startsWith("commit:")), false, node);
    }

    const kuali = harness({ kualiEidAfterStage: COMPOSITION_OTHER_EID });
    const { run, claim } = compositionClaimRunning(
      kuali.database, kuali.clock, compositionQueuedRun(), FINALIZE_NODE,
    );
    await assert.rejects(
      kuali.bound(() => kuali.sequencer.executeTransaction(
        compositionContext(run, claim, FINALIZE_NODE),
      )),
      /subject mismatch, zero fence, zero click/u,
    );
    assert.equal(kuali.kuali.persistedFinalization, undefined, "Kuali was not written");
    const footprint = compositionDurableFootprint(
      kuali, "kuali", FINALIZE_NODE, FINALIZATION_IDEMPOTENCY_KEY,
    );
    assert.equal(footprint.intent, undefined, "the fence was never reached");

    assert.deepEqual(claimFor("separations/subject-mismatch"), [
      `transaction:${SWEEP_NODE}/subject-mismatch`,
      `transaction:${TERMINATION_NODE}/subject-mismatch`,
      `transaction:${FINALIZE_NODE}/subject-mismatch`,
    ]);
  });

  it("separations/pending-sweep-committed — the sweep is a fenced write, and it runs FIRST", async () => {
    // S30/S31: in legacy this delete is the first mutation of the run, with no
    // fence, no permanent key and no read-back.
    const h = harness({ rows: [inProgressTermination(), inProgressTermination({
      transactionId: "T009000002", startDate: "05/01/2026",
    })] });
    const { run, claim } = compositionClaimRunning(
      h.database, h.clock, compositionQueuedRun(), SWEEP_NODE,
    );

    const outcome = await h.bound(() => h.sequencer.executeTransaction(
      compositionContext(run, claim, SWEEP_NODE),
    ));

    assert.equal(Reflect.get(outcome as object, "disposition"), "committed");
    assert.deepEqual(h.ucpath.rows, [], "both in-progress rows were swept");
    const footprint = compositionDurableFootprint(h, "ucpath", SWEEP_NODE, SWEEP_IDEMPOTENCY_KEY);
    assert.notEqual(footprint.intent, undefined, "a delete gets a fence like every other write");

    assert.deepEqual(claimFor("separations/pending-sweep-committed"), [
      `transaction:${SWEEP_NODE}/committed`,
    ]);
  });

  it("separations/pending-sweep-nothing-to-do — a SETTLED termination is never swept", async () => {
    const h = harness({ rows: [inProgressTermination({ approvalStatus: "Approved" })] });
    const { run, claim } = compositionClaimRunning(
      h.database, h.clock, compositionQueuedRun(), SWEEP_NODE,
    );

    const outcome = await h.bound(() => h.sequencer.executeTransaction(
      compositionContext(run, claim, SWEEP_NODE),
    ));

    assert.equal(Reflect.get(outcome as object, "disposition"), "already-present");
    assert.equal(h.ucpath.events.some((event) => event.startsWith("commit:")), false, "zero clicks");
    assert.equal(h.ucpath.rows.length, 1, "deleting a settled row would destroy a real record");

    assert.deepEqual(claimFor("separations/pending-sweep-nothing-to-do"), [
      `transaction:${SWEEP_NODE}/already-present`,
    ]);
  });

  it("separations/termination-committed — ONE fenced click files the termination", async () => {
    const h = harness();
    const { run, claim } = compositionClaimRunning(
      h.database, h.clock, compositionQueuedRun(), TERMINATION_NODE,
    );

    const outcome = await h.bound(() => h.sequencer.executeTransaction(
      compositionContext(run, claim, TERMINATION_NODE),
    ));

    assert.equal(Reflect.get(outcome as object, "disposition"), "committed");
    assert.equal(h.ucpath.rows.length, 1, "exactly one termination was filed");
    assert.equal(h.ucpath.rows[0]?.transactionId, COMPOSITION_RECEIPT);
    assert.equal(
      h.ucpath.events.filter((event) => event.startsWith("commit:")).length, 1, "exactly one click",
    );
    const footprint = compositionDurableFootprint(
      h, "ucpath", TERMINATION_NODE, TERMINATION_IDEMPOTENCY_KEY,
    );
    assert.notEqual(footprint.intent, undefined, "the fence is durable");
    assert.notEqual(footprint.checkpoint, undefined, "the settlement is durable");

    assert.deepEqual(claimFor("separations/termination-committed"), [
      `transaction:${TERMINATION_NODE}/committed`,
    ]);
  });

  it("separations/termination-already-present — a re-run finds the first termination and files nothing", async () => {
    const h = harness({ rows: [inProgressTermination()] });
    const { run, claim } = compositionClaimRunning(
      h.database, h.clock, compositionQueuedRun(), TERMINATION_NODE,
    );

    const outcome = await h.bound(() => h.sequencer.executeTransaction(
      compositionContext(run, claim, TERMINATION_NODE),
    ));

    assert.equal(Reflect.get(outcome as object, "disposition"), "already-present");
    assert.equal(h.ucpath.events.some((event) => event.startsWith("commit:")), false, "zero clicks");
    assert.equal(h.ucpath.rows.length, 1, "no second termination was filed");

    assert.deepEqual(claimFor("separations/termination-already-present"), [
      `transaction:${TERMINATION_NODE}/already-present`,
    ]);
  });

  it("separations/finalization-committed — one save writes all ten fields, and the reload read-back is the proof", async () => {
    const h = harness();
    const { run, claim } = compositionClaimRunning(
      h.database, h.clock, compositionQueuedRun(), FINALIZE_NODE,
    );

    const outcome = await h.bound(() => h.sequencer.executeTransaction(
      compositionContext(run, claim, FINALIZE_NODE),
    ));

    assert.equal(Reflect.get(outcome as object, "disposition"), "committed");
    assert.deepEqual(h.kuali.persistedFinalization, COMPOSITION_FINALIZATION_FIELDS);
    // The composition is what makes this comment exist: the transaction number
    // is the UCPath write's answer, the audit line is the date fold's, and the
    // operator's own prior text is the document read's.
    assert.equal(
      h.kuali.persistedFinalization?.timekeeperComments,
      COMPOSITION_FINALIZATION_COMMENTS,
    );
    assert.equal(
      h.kuali.events.filter((event) => event.startsWith("commit:")).length, 1, "exactly one click",
    );

    assert.deepEqual(claimFor("separations/finalization-committed"), [
      `transaction:${FINALIZE_NODE}/committed`,
    ]);
  });

  it("separations/finalization-already-present — a document already carrying this finalization is not saved twice", async () => {
    const h = harness({ persistedFinalization: COMPOSITION_FINALIZATION_FIELDS });
    const { run, claim } = compositionClaimRunning(
      h.database, h.clock, compositionQueuedRun(), FINALIZE_NODE,
    );

    const outcome = await h.bound(() => h.sequencer.executeTransaction(
      compositionContext(run, claim, FINALIZE_NODE),
    ));

    assert.equal(Reflect.get(outcome as object, "disposition"), "already-present");
    assert.equal(h.kuali.events.some((event) => event.startsWith("commit:")), false, "zero clicks");

    assert.deepEqual(claimFor("separations/finalization-already-present"), [
      `transaction:${FINALIZE_NODE}/already-present`,
    ]);
  });

  it("separations/finalization-parks-after-termination — §4c, in ONE run: the termination is real and the Kuali save is not", async () => {
    // The state §4c exists for, asserted as durable rows rather than as a
    // sentence: the UCPath termination COMMITS for real, the Kuali save lands
    // nothing, and the run holds a settled receipt beside a parked finalization
    // intent. A `failed` run here would leave "UCPath done, Kuali not" in the
    // operator's head, which is exactly what §4c refuses.
    const h = harness({ kualiCommitDoesNotPersist: true });
    const { run, claim } = compositionClaimRunning(
      h.database, h.clock, compositionQueuedRun(), TERMINATION_NODE,
    );

    const filed = await h.bound(() => h.sequencer.executeTransaction(
      compositionContext(run, claim, TERMINATION_NODE),
    ));
    assert.equal(Reflect.get(filed as object, "disposition"), "committed");

    await assert.rejects(
      h.bound(() => h.sequencer.executeTransaction(
        compositionContext(run, claim, FINALIZE_NODE),
      )),
      (error: unknown) => {
        assert.ok(error instanceof WriteParkedError, String(error));
        return true;
      },
    );

    // The receipt PAIR is durable authority BEFORE the finalization is entered
    // (§4c) — it is the termination node's own settled checkpoint, not a
    // remembered fact.
    const termination = compositionDurableFootprint(
      h, "ucpath", TERMINATION_NODE, TERMINATION_IDEMPOTENCY_KEY,
    );
    assert.notEqual(termination.checkpoint, undefined, "the termination settled durably");
    assert.equal(h.ucpath.rows.length, 1);
    assert.equal(h.ucpath.rows[0]?.transactionId, COMPOSITION_RECEIPT);

    const finalization = compositionDurableFootprint(
      h, "kuali", FINALIZE_NODE, FINALIZATION_IDEMPOTENCY_KEY,
    );
    const intent = finalization.intent as object;
    assert.notEqual(finalization.intent, undefined, "the fence is durable: the click was reachable");
    assert.equal(Reflect.get(intent, "status"), "parked", JSON.stringify(intent));
    assert.equal(Reflect.get(intent, "parkedCode"), "unknown", JSON.stringify(intent));
    assert.equal(finalization.checkpoint, undefined, "nothing settled over an unproven save");

  });

  /* ── the graph half: every real bind and the real terminal derive ───────── */

  it("separations/gate-approved — the whole graph, from one document number to three settled writes", async () => {
    const plan = await runPlan();
    const nameSearch = {
      results: [],
      selection: {
        status: "resolved" as const,
        selected: {
          emplId: COMPOSITION_EID,
          name: COMPOSITION_DOCUMENT_NAME,
          department: "Housing Dining Hospitality",
          jobTitle: "STDT 2",
          employeeStatus: "active" as const,
          hdh: true,
        },
        candidateEids: [COMPOSITION_EID],
      },
    };
    const subject = await matchSeparationSubjectTask.impl.run({
      input: {
        documentNumber: COMPOSITION_DOCUMENT,
        employeeName: plan.employeeName,
        documentEid: { state: "present", value: COMPOSITION_EID },
        nameSelection: nameSearch.selection,
      },
      ctx: taskCtx,
    });
    const employment = await matchActiveEmploymentTask.impl.run({
      input: { documentNumber: COMPOSITION_DOCUMENT, jobSummary: jobSummary() },
      ctx: taskCtx,
    });
    const department = await matchDepartmentOptionTask.impl.run({
      input: {
        deptId: employment.deptId,
        department: employment.department,
        observedOptions: [...LIVE_DEPARTMENT_OPTIONS],
        documentNumber: COMPOSITION_DOCUMENT,
      },
      ctx: taskCtx,
    });
    const terminationType = await matchTerminationTypeTask.impl.run({
      input: {
        terminationType: { state: "present", value: "Graduated/No longer a Student" },
        // §3.2's capture, complete and verbatim: a republished control refuses
        // on the first run that SEES it, not on the first run that happens to
        // select a new option.
        observedOptions: [...KUALI_TERMINATION_TYPE_OPTIONS],
        documentNumber: COMPOSITION_DOCUMENT,
      },
      ctx: taskCtx,
    });
    const dates = await runDates();

    const document = {
      pageStateId: "kuali.rrss-document.separation-ready" as const,
      actionId: COMPOSITION_ACTION_ID,
      documentNumber: COMPOSITION_DOCUMENT,
      formType: { observed: "RRSS Separation Request Form" as const, matches: true as const },
      employee: {
        name: { state: "present" as const, value: COMPOSITION_DOCUMENT_NAME },
        eid: { state: "present" as const, value: COMPOSITION_EID },
        employeeType: { state: "present" as const, value: "Student" },
        studentTitleCode: { state: "present" as const, value: "004921 - STDT 2" },
        division: { state: "present" as const, value: "Housing/Dining/Hospitality" },
        location: { state: "present" as const, value: "Sixth College" },
      },
      separation: {
        terminationType: { state: "present" as const, value: "Graduated/No longer a Student" },
        lastDayWorked: kualiDate(COMPOSITION_KUALI_LDW),
        separationDate: kualiDate(COMPOSITION_KUALI_LDW),
        additionalComments: { state: "absent" as const, reason: "the control was empty" },
      },
      timekeeper: {
        requestAcknowledged: false,
        name: { state: "absent" as const, reason: "the control was empty" },
        comments: { state: "absent" as const, reason: "the control was empty" },
      },
      finalTransactions: {
        terminationEffectiveDate: { state: "absent" as const, reason: "the control was empty" },
        department: { state: "absent" as const, reason: "the control sits on its blank sentinel" },
        payrollTitleCode: { state: "absent" as const, reason: "the control was empty" },
        payrollTitle: { state: "absent" as const, reason: "the control was empty" },
        submittedTerminationTemplate: false,
        transactionNumber: { state: "absent" as const, reason: "the control was empty" },
        finalPay: { state: "absent" as const, reason: "no option is selected" },
      },
      options: {
        terminationType: [...KUALI_TERMINATION_TYPE_OPTIONS],
        division: ["- - -", "Housing/Dining/Hospitality"],
        employeeType: ["- - -", "Student"],
        studentTitleCode: ["- - -", "004921 - STDT 2"],
        department: [...LIVE_DEPARTMENT_OPTIONS],
        finalPay: ["Does not need Final Pay (student employee)"],
      },
      observedAt: OBSERVED_AT,
    };

    const comparison = MatchIdentityOutputSchema.parse(await matchIdentityTask.impl.run({
      input: {
        documentNumber: COMPOSITION_DOCUMENT,
        documentName: plan.employeeName,
        documentEid: document.employee.eid,
        emplId: EidSchema.parse(subject.emplId),
        emplIdSource: subject.emplIdSource,
        jobSummary: jobSummary(),
        nameSelection: nameSearch.selection,
        plan: {
          state: "planned",
          termination: {
            terminationType: terminationType.terminationType,
            classification: terminationType.classification,
            template: terminationType.template,
            reasonCode: terminationType.reasonCode,
            emplRecord: employment.emplRecord,
            effectiveDate: dates.terminationEffectiveDate,
            lastDateWorked: dates.lastDayWorked,
            initiatorComments: dates.terminationComments,
          },
          document: {
            documentNumber: COMPOSITION_DOCUMENT,
            department: department.option,
            departmentCode: department.departmentCode,
            ucpathDepartment: department.ucpathDepartment,
            payrollTitleCode: employment.payrollTitleCode,
            payrollTitle: employment.payrollTitle,
            terminationEffectiveDate: dates.terminationEffectiveDate,
            timekeeperName: COMPOSITION_TIMEKEEPER,
          },
          dates: {
            kualiLastDayWorked: dates.kualiLastDayWorked,
            lastDayWorked: dates.lastDayWorked,
            lastDayWorkedChanged: dates.lastDayWorkedChanged,
            kualiSeparationDate: dates.kualiSeparationDate,
            separationDate: dates.separationDate,
            separationDateChanged: dates.separationDateChanged,
            separationDeterminingLeave: dates.separationDeterminingLeave,
            unclassifiedPayCodes: dates.unclassifiedPayCodes,
          },
        },
      },
      ctx: taskCtx,
    }));

    // §14.5's whole mechanism, stated as an assertion: the approval binds to a
    // digest over the packet INCLUDING the plan, so a reconciled date that
    // moves after approval re-derives a different digest and re-opens the gate.
    assert.equal(comparison.packet.plan.state, "planned");
    assert.notEqual(
      comparison.evidenceDigest,
      deriveIdentityEvidenceDigest({
        ...comparison.packet,
        plan: comparison.packet.plan.state === "planned"
          ? {
            ...comparison.packet.plan,
            dates: { ...comparison.packet.plan.dates, separationDate: "06/26/2026" },
          }
          : comparison.packet.plan,
      }),
      "a moved separation date must move the digest an approval binds to",
    );

    const approval = {
      decision: "approved" as const,
      eid: EidSchema.parse(COMPOSITION_EID),
      chosenFrom: "checked" as const,
      evidenceDigest: comparison.evidenceDigest,
    };
    const receiptProof = terminationProof();
    const receipt = await verifyTerminationReceiptTask.impl.run({
      input: {
        proof: receiptProof,
        disposition: "committed",
        approvedEmplId: COMPOSITION_EID,
        expectedEffectiveDate: dates.terminationEffectiveDate,
      },
      ctx: taskCtx,
    });

    const walk = walkDescriptor(separationsDescriptor, { ...COMPOSITION_RUN_INPUT }, {
      outputs: {
        document,
        plan,
        "termination-type": terminationType,
        "name-search": nameSearch,
        subject,
        "job-summary": jobSummary(),
        employment,
        "department-option": department,
        "timecard-search": {
          query: String(COMPOSITION_EID),
          totalCount: 1,
          candidates: [{ employeeId: COMPOSITION_EID, displayName: COMPOSITION_UCPATH_NAME }],
          matched: { employeeId: COMPOSITION_EID, displayName: COMPOSITION_UCPATH_NAME },
          selectedCount: 1,
          panelContext: "top-level",
        },
        timecard: {
          subject: {
            observationId: "new-kronos.timecard.displayed-eid",
            expectedEid: COMPOSITION_EID,
            observedEmployeeId: String(COMPOSITION_EID),
            observedDisplayName: COMPOSITION_UCPATH_NAME,
            matches: true,
          },
          range: {
            requestedStart: "05/12/2026",
            requestedEnd: "07/12/2026",
            observedLabel: "5/12/2026 - 7/12/2026",
            observedStart: "05/12/2026",
            observedEnd: "07/12/2026",
            applied: true,
          },
          grid: {
            columnHeaders: ["Pay code", "Amount"],
            scrollSteps: 1,
            daysCovered: 62,
            populatedRows: 2,
            lastPunchDate: COMPOSITION_LAST_DAY_WORKED,
            punchDates: [COMPOSITION_LAST_DAY_WORKED],
            sickDates: [],
            holidayDates: [COMPOSITION_SEPARATION_DATE],
            payCodeDays: [],
            unclassifiedPayCodes: ["Independence Day Observed", "Juneteenth Observed"],
          },
        },
        dates,
        comparison,
        "identity-approval": approval,
        approval: await verifyIdentityApprovalTask.impl.run({
          input: {
            packet: comparison.packet,
            evidenceDigest: comparison.evidenceDigest,
            approval,
          },
          ctx: taskCtx,
        }),
        [SWEEP_NODE]: {
          disposition: "committed",
          output: {
            cleared: {
              kind: "ucpath-pending-terminations-clear",
              emplId: COMPOSITION_EID,
              scannedRowCount: 0,
              observedAt: OBSERVED_AT,
              source: "ss-smart-hr-detail-read",
            },
          },
        },
        [TERMINATION_NODE]: { disposition: "committed", output: { receipt: receiptProof } },
        receipt,
        [FINALIZE_NODE]: {
          disposition: "committed",
          output: {
            savedState: {
              kind: "kuali-saved-finalization",
              actionId: COMPOSITION_ACTION_ID,
              documentNumber: COMPOSITION_DOCUMENT,
              observedEid: COMPOSITION_EID,
              fields: COMPOSITION_FINALIZATION_FIELDS,
              source: "reload-read-back",
            },
          },
        },
      },
    });

    for (const point of claimFor("separations/gate-approved")) {
      assert.ok(walk.covered.includes(point), point);
    }
    const result = walk.result as {
      termination: { transactionNumber: string; approvalStatus: string };
      dates: { terminationEffectiveDate: string };
      department: { option: string };
      employment: { emplRecord: string };
    };
    // §4c's completion shape: the PAIR, on the terminal result.
    assert.equal(result.termination.transactionNumber, COMPOSITION_RECEIPT);
    assert.equal(result.termination.approvalStatus, "Pending");
    assert.equal(result.dates.terminationEffectiveDate, COMPOSITION_EFFECTIVE_DATE);
    assert.equal(result.department.option, COMPOSITION_DEPARTMENT_OPTION);
    assert.equal(result.employment.emplRecord, "0");
  });
});
