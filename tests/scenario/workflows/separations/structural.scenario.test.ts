/**
 * Executable scenarios for `separations` — chunk 6, the COMPOSITION.
 *
 * This is the **T1a** half of this workflow's pair (ref guards-and-tests §10.9):
 * `tests/scenario/workflows/<workflow-id>/structural.scenario.test.ts`, ONE per
 * workflow, no browser, claiming every coverage point the graph derives. The
 * **T1b** half is the sibling `dry-run.scenario.ts` — the checkpoint manifest
 * for the live rehearsal, which no vitest project may collect and which the
 * last `it` in this file proves stayed uncollected.
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
 * Nothing here touches a browser and nothing here writes anything real. The
 * live half is not missing, it is the OTHER file: `dry-run.scenario.ts` runs
 * the same graph against real Kuali / UCPath / New Kronos under `dryRun=true`
 * and settles what only the world can settle — which nodes a real subject
 * actually reaches, and that the write tables did not move. The controlled real
 * commit remains open on the operator's §4f2 canary.
 *
 * **Every subject value here is SYNTHETIC** (ref guards-and-tests §10.3): the
 * harness's `10800000`/`10800001` EIDs and document `4444`, which no live
 * system resolves. A real person's identifier is a dry-run fact and lives in
 * the target registry, reached by LABEL — never in a structural walk, which
 * could not assert anything about that person anyway.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { afterEach, describe, it } from "vitest";
import { descriptorRuntimeNodes } from "../../../../src/base/workflow.js";
import { WriteParkedError } from "../../../../src/core/write-sequencer.js";
import { NewKronosReadSeparationTimecard } from "../../../../src/domain/contracts/new-kronos/read-separation-timecard.js";
import {
  legacyUcpathPendingSweepIdempotencyKey,
  ucpathPendingTransactionSetDigest,
} from "../../../../src/domain/contracts/ucpath/delete-pending-terminations.js";
import { deriveItemId } from "../../../../src/domain/identifiers.js";
import { checkpointLookupKey } from "../../../../src/domain/workflow/checkpoint.js";
import { DateOnlySchema, EidSchema, IsoInstantSchema } from "../../../../src/domain/ids.js";
import { MatchIdentityOutputSchema } from "../../../../src/domain/contracts/separations/match-identity.js";
import { deriveIdentityEvidenceDigest } from "../../../../src/domain/separations/identity-evidence.js";
import { deriveIdempotencyKeyDigest } from "../../../../src/domain/write-safety.js";
import { WriteIntentRecordSchema } from "../../../../src/domain/write-safety.js";
import { KUALI_TERMINATION_TYPE_OPTIONS } from "../../../../src/domain/separations/termination-type.js";
import type { KualiDateField } from "../../../../src/domain/ui/kuali-separation-document.js";
import type { UcpathPersonSelection } from "../../../../src/domain/contracts/ucpath/search-person-org.js";
import type { UcpathJobRow, UcpathJobSummary } from "../../../../src/domain/ui/ucpath-job-summary.js";
import type { UcpathTerminationProof } from "../../../../src/domain/ui/ucpath-smart-hr-termination.js";
import type { UcpathTransactionRow } from "../../../../src/domain/ui/ucpath-smart-hr-termination.js";
import { createDeterministicKualiDriver, createKualiFakeWorld } from "../../../../src/stores/kuali/driver/fake.js";
import { searchSeparationActionTask } from "../../../../src/stores/kuali/tasks/search-separation-action.js";
import { manualClock } from "../../../../src/domain/clock.js";
import { matchActiveEmploymentTask } from "../../../../src/stores/separations/tasks/match-active-employment.js";
import { matchDepartmentOptionTask } from "../../../../src/stores/separations/tasks/match-department-option.js";
import { matchIdentityTask } from "../../../../src/stores/separations/tasks/match-identity.js";
import { matchSeparationSubjectTask } from "../../../../src/stores/separations/tasks/match-separation-subject.js";
import { matchTerminationTypeTask } from "../../../../src/stores/separations/tasks/match-termination-type.js";
import { readSeparationDatesTask } from "../../../../src/stores/separations/tasks/read-separation-dates.js";
import { readSeparationPlanTask } from "../../../../src/stores/separations/tasks/read-separation-plan.js";
import { verifyIdentityApprovalTask } from "../../../../src/stores/separations/tasks/verify-identity-approval.js";
import { verifyTerminationReceiptTask } from "../../../../src/stores/separations/tasks/verify-termination-receipt.js";
import { SeparationsCanonicalInput } from "../../../../src/workflows/separations/workflow.js";
import { KUALI_FAKE_UNFINALIZED_FIELDS } from "../../../../src/stores/kuali/driver/fake.js";
import { SEPARATIONS_CLAIMS } from "../../coverage-claims.js";
import { walkDescriptor } from "../../helpers/pure-walk.js";
import {
  COMPOSITION_ACTION_HREF,
  COMPOSITION_ACTION_ID,
  COMPOSITION_ACTION_RESOLUTION,
  COMPOSITION_AS_OF_DATE,
  COMPOSITION_DEPARTMENT_OPTION,
  COMPOSITION_DOCUMENT,
  COMPOSITION_DOCUMENT_NAME,
  COMPOSITION_EFFECTIVE_DATE,
  COMPOSITION_EID,
  COMPOSITION_NOW,
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
  compositionPendingSet,
  compositionQueuedRun,
  compositionSweepIdempotencyKey,
  type CompositionHarness,
} from "../../../unit/fixtures/separations-composition-fixtures.js";
import { separationsDescriptor } from "../../../helpers/registered-workflows.js";

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

/* ── D261's head node: one document number becomes one Kuali action ───────── */

/**
 * The resolve task over the deterministic Kuali driver. It runs the REAL task
 * implementation and the REAL pure fold, so what these three arms falsify is
 * the refusal — that a document the Action List does not hold, and a number two
 * actions answer to, each become a distinct named failure rather than a
 * plausible id.
 */
async function runResolveAction(world: Parameters<typeof createDeterministicKualiDriver>[0]): Promise<unknown> {
  const clock = manualClock(new Date(COMPOSITION_NOW));
  return await searchSeparationActionTask.impl.run({
    input: { documentNumber: COMPOSITION_DOCUMENT },
    ctx: { ...taskCtx, driver: createDeterministicKualiDriver(world, clock) },
  });
}

function actionListWorld(): ReturnType<typeof createKualiFakeWorld> {
  return createKualiFakeWorld({
    actionId: COMPOSITION_ACTION_ID,
    documentNumber: COMPOSITION_DOCUMENT,
    displayedEid: String(COMPOSITION_EID),
  });
}

/**
 * Every module specifier a file actually imports — static `import`/`export …
 * from`, and dynamic `import(…)`. A dynamic import whose specifier is not a
 * literal is refused rather than ignored: a computed specifier is exactly how a
 * manifest would be reached without this audit noticing.
 */
function moduleSpecifiers(file: string, source: string): readonly string[] {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier !== undefined
      && ts.isStringLiteralLike(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [only] = node.arguments;
      if (only === undefined || !ts.isStringLiteralLike(only)) {
        throw new Error(`${file} takes a dynamic import whose specifier is not a literal`);
      }
      specifiers.push(only.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return specifiers;
}

describe("separations scenarios — the composition", () => {
  it("separations/action-resolved — the operator types a document number and the graph finds the action", async () => {
    const resolved = await runResolveAction(actionListWorld()) as {
      actionId: string; documentNumber: string; matchedLinkCount: number; actionHref: string;
    };
    assert.equal(resolved.actionId, COMPOSITION_ACTION_ID);
    assert.equal(resolved.documentNumber, COMPOSITION_DOCUMENT);
    // TWO links for one document is the ORDINARY live row — Kuali publishes the
    // number in both `Document #` and `Document Title` (measured 2026-08-20) —
    // so a surface that demanded exactly one node would refuse every real row.
    assert.equal(resolved.matchedLinkCount, 2);
    assert.equal(resolved.actionHref, COMPOSITION_ACTION_HREF);
    // The node walks no graph path: a head read produces no branch, gate,
    // delegation or transaction point, so it correctly claims none.
    assert.equal(SEPARATIONS_CLAIMS.some(({ scenarioId }) => scenarioId === "separations/action-resolved"), false);
  });

  it("separations/action-not-in-action-list — a document nobody holds an action on refuses BY NAME", async () => {
    const world = actionListWorld();
    world.actionListLinks = { [COMPOSITION_DOCUMENT]: [] };
    world.actionListListedNumbers = ["4444", "4445"];
    const code = await refusalCode(async () => await runResolveAction(world));
    // Not an empty answer and not a fallback: a completed Kuali step leaves the
    // Action List, which is a REAL and common state, and the run that cannot be
    // addressed must say so rather than open something else.
    assert.equal(code, "document-not-in-action-list");
  });

  it("separations/action-ambiguous — two actions for one number is a refusal, never a choice", async () => {
    const world = actionListWorld();
    world.actionListLinks = {
      [COMPOSITION_DOCUMENT]: [
        { name: COMPOSITION_DOCUMENT, href: COMPOSITION_ACTION_HREF },
        {
          name: COMPOSITION_DOCUMENT,
          href: "/build/space/5e47518b90adda9474c14adb/actions/0123456789abcdef01234568",
        },
      ],
    };
    const code = await refusalCode(async () => await runResolveAction(world));
    assert.equal(code, "ambiguous-action-list-match");
  });

  it("an Action-List link with no href is unreadable, not absent", async () => {
    const world = actionListWorld();
    world.actionListLinks = { [COMPOSITION_DOCUMENT]: [{ name: COMPOSITION_DOCUMENT, href: null }] };
    // The distinction is load-bearing: "the row is not there" and "the row is
    // there and carries no address" are different facts about a real document,
    // and only one of them means the separation cannot be filed today.
    assert.equal(await refusalCode(async () => await runResolveAction(world)), "unreadable-action-link");
  });

  it("an href addressing another space is unreadable, never trusted for its last segment", async () => {
    const world = actionListWorld();
    world.actionListLinks = {
      [COMPOSITION_DOCUMENT]: [{
        name: COMPOSITION_DOCUMENT,
        href: `/build/space/ffffffffffffffffffffffff/actions/${COMPOSITION_ACTION_ID}`,
      }],
    };
    assert.equal(await refusalCode(async () => await runResolveAction(world)), "unreadable-action-link");
  });

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
      // S7's synthetic future-date shape: the read accepts it because reading
      // a form is not filing a termination. This node is where it refuses.
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
      // A well-formed synthetic T-number can still belong to a transaction
      // UCPath refused; format validity is not settlement authority.
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
    // attempt, claimGeneration) with no run id, so a second run of one document
    // replays the first run's reads — whose `observedAt` differs by
    // construction. The operator's explicit re-read is part of the canonical
    // input, therefore part of `matchKey`, therefore a NEW logical item.
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
    // termination — ref write-safety's same-key mutex refuses the second fence.
    assert.match(TERMINATION_IDEMPOTENCY_KEY, /^ucpath:termination\|/u);
    assert.equal(TERMINATION_IDEMPOTENCY_KEY.includes("re-read"), false);
    assert.equal(SWEEP_IDEMPOTENCY_KEY.includes("re-read"), false);
    assert.equal(FINALIZATION_IDEMPOTENCY_KEY.includes("re-read"), false);

    /*
     * D221 — and a RETRY is the other intent, which §9.17 had to substitute a
     * re-read for. A retry keeps the logical item (that is what lets it replay
     * the failed run's reads at all), so the ONLY thing that can separate its
     * `timecard-search` executions from the failed run's is the attempt — and
     * the attempt is the ITEM's, so a retry takes the next one. Minting it at 1
     * is what made every retry of this graph die on that node.
     */
    const retryItemId = deriveItemId(COMPOSITION_WORKFLOW_ID, matchKey(base));
    const timecardAt = (attempt: number): string =>
      checkpointLookupKey(String(separationsDescriptor.id), retryItemId, "timecard-search", attempt, 1);
    assert.notEqual(timecardAt(1), timecardAt(2));
    assert.equal(timecardAt(1), checkpointLookupKey(
      String(separationsDescriptor.id),
      deriveItemId(COMPOSITION_WORKFLOW_ID, matchKey(base)),
      "timecard-search",
      1,
      1,
    ), "a retry is the SAME item — it is not a re-read, and it replays what it may");
  });

  /**
   * D214 over the REAL composed graph — the shape chunk 6b's run `00419600` died
   * in, asserted structurally rather than re-driven.
   *
   * The composition puts an `always-rerun` node (`timecard-search`, by chunk 1's
   * rule that a node whose product is BROWSER state may not replay) UPSTREAM of
   * the name-only operator gate, with task nodes downstream of it — so a gate resume
   * necessarily re-executes it inside the same attempt. Two things must both
   * hold, and either one alone is not enough: the graph must be that shape (or
   * this whole class of defect is unreachable and the guard is theatre), and the
   * checkpoint identity must tell the two executions apart. The interpreter walk
   * that proves the second end-to-end is
   * `tests/unit/gate-resume-always-rerun.test.ts`.
   */
  it("separations/gate-resume-shape — an always-rerun node sits before the gate, and its executions are distinct", () => {
    const nodes = descriptorRuntimeNodes(separationsDescriptor);
    const gateIndex = nodes.findIndex((node) => node.kind === "gate");
    assert.ok(gateIndex > 0, "the composition has exactly one gate, and it is not first");
    assert.equal(nodes.filter((node) => node.kind === "gate").length, 1);

    const alwaysRerunBeforeGate = nodes
      .slice(0, gateIndex)
      .filter((node) => node.kind === "task" && node.replay === "always-rerun")
      .map((node) => String(node.id));
    assert.deepEqual(
      alwaysRerunBeforeGate,
      ["timecard-search"],
      "chunk 1's rule puts a browser-state node upstream of the gate; the resume re-executes it",
    );
    assert.ok(
      nodes.slice(gateIndex + 1).some((node) => node.kind === "task" || node.kind === "transaction"),
      "the resume must actually reach a node past the gate",
    );

    /*
     * And the durable identity separates the park's execution from the resume's.
     * A gate resume advances no attempt — it is the same attempt, re-claimed —
     * so before D214 these two keys were equal and the second observation was
     * refused as "already exists with different content".
     */
    const itemId = deriveItemId(COMPOSITION_WORKFLOW_ID, `separations:${COMPOSITION_DOCUMENT}`);
    const atGeneration = (claimGeneration: number): string =>
      checkpointLookupKey(String(separationsDescriptor.id), itemId, "timecard-search", 1, claimGeneration);
    assert.notEqual(atGeneration(1), atGeneration(2));
    // …while a row stored before D214 keeps the exact four-component key it was
    // written under, so nothing this database already holds becomes unreachable.
    assert.equal(
      checkpointLookupKey(String(separationsDescriptor.id), itemId, "timecard-search", 1),
      [String(separationsDescriptor.id), itemId, "timecard-search", "1"].join("\u0000"),
    );
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
      compositionContext(pendingRun.run, pendingRun.claim, SWEEP_NODE, true, withPending.ucpath.rows),
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
      // §4e's 2026-08-14 amendment shows up in the REHEARSAL: the Kuali preview
      // stages twelve fields, and the two date write-backs carry the reconciled
      // values rather than the document's own stale ones.
      if (node === FINALIZE_NODE && preview.outcome.state === "would-prepare") {
        const staged = (preview.outcome.prepare.value as {
          stagedFields: Record<string, unknown>;
        }).stagedFields;
        assert.equal(Object.keys(staged).length, 12);
        assert.equal(staged["lastDayWorked"], COMPOSITION_LAST_DAY_WORKED);
        assert.equal(staged["separationDate"], COMPOSITION_SEPARATION_DATE);
      }
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
    // Ref write-safety beat ③, on all three writes. The composition is where this matters
    // most: three fences over two systems, all bound to ONE verified identity.
    for (const node of [SWEEP_NODE, TERMINATION_NODE]) {
      // The sweep needs something to sweep, or its probe settles
      // `already-present` before the subject is ever observed.
      const rows = node === SWEEP_NODE ? [inProgressTermination({ startDate: "05/01/2026" })] : [];
      const h = harness({ rows, ucpathNameAfterStage: COMPOSITION_OTHER_NAME });
      const { run, claim } = compositionClaimRunning(
        h.database, h.clock, compositionQueuedRun(), node,
      );
      await assert.rejects(
        h.bound(() => h.sequencer.executeTransaction(compositionContext(run, claim, node, false, rows))),
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
    const pendingRows = [inProgressTermination(), inProgressTermination({
      transactionId: "T009000002", startDate: "05/01/2026",
    })];
    const h = harness({ rows: pendingRows });
    const { run, claim } = compositionClaimRunning(
      h.database, h.clock, compositionQueuedRun(), SWEEP_NODE,
    );

    const outcome = await h.bound(() => h.sequencer.executeTransaction(
      compositionContext(run, claim, SWEEP_NODE, false, pendingRows),
    ));

    assert.equal(Reflect.get(outcome as object, "disposition"), "committed");
    assert.deepEqual(h.ucpath.rows, [], "both in-progress rows were swept");
    const footprint = compositionDurableFootprint(
      h, "ucpath", SWEEP_NODE, compositionSweepIdempotencyKey(pendingRows),
    );
    assert.notEqual(footprint.intent, undefined, "a delete gets a fence like every other write");
    const intent = WriteIntentRecordSchema.parse(footprint.intent);
    assert.equal(intent.status, "committed");
    if (intent.status === "committed") {
      assert.deepEqual(intent.completionProof.value, {
        kind: "ucpath-pending-terminations-clear",
        emplId: COMPOSITION_EID,
        scannedRowCount: 0,
        observedAt: COMPOSITION_NOW,
        source: "ss-smart-hr-detail-read",
        version: 2,
        selectedTransactionIds: "T009000000,T009000002",
        protectedTransactionIds: "none",
        setDigest: ucpathPendingTransactionSetDigest(compositionPendingSet(pendingRows)),
      });
    }

    assert.deepEqual(claimFor("separations/pending-sweep-committed"), [
      `transaction:${SWEEP_NODE}/committed`,
    ]);
  });

  it("separations/pending-sweep-nothing-to-do — a SETTLED termination is never swept", async () => {
    const settledRows = [inProgressTermination({ approvalStatus: "Approved" })];
    const h = harness({ rows: settledRows });
    const { run, claim } = compositionClaimRunning(
      h.database, h.clock, compositionQueuedRun(), SWEEP_NODE,
    );

    const outcome = await h.bound(() => h.sequencer.executeTransaction(
      compositionContext(run, claim, SWEEP_NODE, false, settledRows),
    ));

    assert.equal(Reflect.get(outcome as object, "disposition"), "already-present");
    assert.equal(h.ucpath.events.some((event) => event.startsWith("commit:")), false, "zero clicks");
    assert.equal(h.ucpath.rows.length, 1, "deleting a settled row would destroy a real record");

    assert.deepEqual(claimFor("separations/pending-sweep-nothing-to-do"), [
      `transaction:${SWEEP_NODE}/already-present`,
    ]);
  });

  it("refuses an immutable pre-exact-set sweep intent before any probe, browser, fence, or click", async () => {
    const pendingRows = [inProgressTermination()];
    const h = harness({ rows: pendingRows });
    const { run, claim } = compositionClaimRunning(
      h.database, h.clock, compositionQueuedRun(), SWEEP_NODE,
    );
    const oldKey = legacyUcpathPendingSweepIdempotencyKey({
      emplId: COMPOSITION_EID,
      expectedName: COMPOSITION_UCPATH_NAME,
      observedSet: compositionPendingSet(pendingRows),
    });
    const recorded = h.database.authority.writeIntents.recordObservedPresent({
      writeIntentId: "88888888-8888-4888-8888-888888888888",
      workflowId: COMPOSITION_WORKFLOW_ID,
      itemId: run.envelope.itemId,
      taskId: "ucpath/delete-pending-terminations",
      system: "ucpath",
      idempotencyKey: oldKey,
      idempotencyKeyDigest: deriveIdempotencyKeyDigest("ucpath", oldKey),
      generation: 1,
      status: "observed-present",
      // Historical authority keeps its historical schema/value bytes. The
      // current contract may detect this row, but may never reinterpret it as
      // exact-set proof or rewrite it under the v2 key.
      observedProof: {
        schemaHash: "9".repeat(64),
        value: {
          kind: "ucpath-pending-terminations-clear",
          emplId: COMPOSITION_EID,
          scannedRowCount: 0,
          observedAt: COMPOSITION_NOW,
          source: "ss-smart-hr-detail-read",
        },
      },
      observedAt: COMPOSITION_NOW,
      version: 1,
      createdAt: COMPOSITION_NOW,
      updatedAt: COMPOSITION_NOW,
    });
    assert.equal(recorded.state, "recorded-observed-present");

    await assert.rejects(
      h.bound(() => h.sequencer.executeTransaction(
        compositionContext(run, claim, SWEEP_NODE, false, pendingRows),
      )),
      /immutable retired-key intent .* Refusing before any probe, browser, fence, or click/u,
    );
    assert.deepEqual(h.ucpath.events, [], "the old intent stopped before the first live read");
    assert.equal(
      h.database.authority.writeIntents.findByPermanentKey(
        "ucpath", compositionSweepIdempotencyKey(pendingRows),
      ),
      undefined,
      "no current v2 intent was minted beside the immutable old row",
    );
    assert.equal(
      h.database.authority.writeIntents.findByPermanentKey("ucpath", oldKey)?.status,
      "observed-present",
      "the historical row stayed byte-authoritative",
    );
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

  it("separations/finalization-committed — one save writes all twelve fields, and the reload read-back is the proof", async () => {
    // The document starts the way a real one does: the requester already filled
    // the two date controls, and they hold the STALE dates the reconciliation
    // moved. §4e's 2026-08-14 amendment is what replaces them.
    const h = harness({
      persistedFinalization: {
        ...KUALI_FAKE_UNFINALIZED_FIELDS,
        lastDayWorked: COMPOSITION_KUALI_LDW,
        separationDate: COMPOSITION_KUALI_LDW,
      },
    });
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
    // §4e's 2026-08-14 amendment, at composed level and for the case it exists
    // for: this fixture's separation date MOVED (06/12 → 06/19 on a holiday),
    // and the value the document ends up carrying is the `dates` node's
    // RECONCILED one — not the stale date the document was read with. This
    // synthetic case preserves the shape that replaces legacy step 13.
    assert.equal(h.kuali.persistedFinalization?.separationDate, COMPOSITION_SEPARATION_DATE);
    assert.equal(h.kuali.persistedFinalization?.lastDayWorked, COMPOSITION_LAST_DAY_WORKED);
    assert.notEqual(COMPOSITION_SEPARATION_DATE, COMPOSITION_KUALI_LDW);
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
        documentEid: { state: "absent", reason: "name-only structural path" },
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
        eid: { state: "absent" as const, reason: "name-only structural path" },
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
            timekeeperName: { kind: "legacy-protected-input", name: "timekeeperName", inputPath: "timekeeperName" },
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
            source: dates.source,
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
        "resolve-action": COMPOSITION_ACTION_RESOLUTION,
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
        "pending-set": compositionPendingSet([]),
        [SWEEP_NODE]: {
          disposition: "committed",
          output: {
            cleared: {
              kind: "ucpath-pending-terminations-clear",
              emplId: COMPOSITION_EID,
              scannedRowCount: 0,
              observedAt: OBSERVED_AT,
              source: "ss-smart-hr-detail-read",
              version: 2,
              selectedTransactionIds: "none",
              protectedTransactionIds: "none",
              setDigest: ucpathPendingTransactionSetDigest(compositionPendingSet([])),
            },
          },
        },
        [TERMINATION_NODE]: { disposition: "committed", output: { receipt: receiptProof } },
        receipt,
        "filing-presence": {
          kind: "ucpath-termination-filing-presence",
          transactionId: COMPOSITION_RECEIPT,
          emplId: COMPOSITION_EID,
          effectiveDate: COMPOSITION_EFFECTIVE_DATE,
          approvalStatus: "Pending",
          displayedName: COMPOSITION_UCPATH_NAME,
          observedAt: OBSERVED_AT,
          source: "ss-smart-hr-detail-read",
          receiptDisposition: "committed",
          authority: "kuali-finalization-precondition",
        },
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
      approved: { authority: string };
      termination: { transactionNumber: string; approvalStatus: string };
      dates: { terminationEffectiveDate: string };
      department: { option: string };
      employment: { emplRecord: string };
    };
    assert.equal(result.approved.authority, "operator-approval");
    // §4c's completion shape: the PAIR, on the terminal result.
    assert.equal(result.termination.transactionNumber, COMPOSITION_RECEIPT);
    assert.equal(result.termination.approvalStatus, "Pending");
    assert.equal(result.dates.terminationEffectiveDate, COMPOSITION_EFFECTIVE_DATE);
    assert.equal(result.department.option, COMPOSITION_DEPARTMENT_OPTION);
    assert.equal(result.employment.emplRecord, "0");
  });

  /**
   * Ref guards-and-tests §10.4/§10.9's structural half, asserted where the pair
   * lives — the same arm `separations-kuali-finalization` carries, because the
   * invariant is per-pair and a second pair that skipped it would be the first
   * one nobody checked.
   *
   * `dry-run.scenario.ts` is a DECLARATION: running it starts a browser and
   * reaches live Kuali, live UCPath and live New Kronos, so a vitest project
   * that collected it — or a collected file that imported it and executed its
   * side effects — would put a live rehearsal inside the per-commit gate. Two
   * facts keep it out, and neither is self-evident from reading the manifest:
   * it carries no `.test.` segment, and nothing vitest collects imports it.
   */
  it("keeps the dry-run manifest out of every vitest project", () => {
    const testsRoot = join(import.meta.dirname, "..", "..", "..");
    const manifest = join(import.meta.dirname, "dry-run.scenario.ts");
    assert.ok(existsSync(manifest), "the T1b manifest is missing from this workflow's folder");

    // The NAME, asserted against what is on disk rather than against the string
    // this test just built: a hard-coded literal cannot carry `.test.`, so the
    // old form could never fail. A `dry-run*.test.*` sibling would be collected
    // and would start a browser.
    assert.deepEqual(
      readdirSync(import.meta.dirname).filter((entry) => /^dry-run.*\.test\./u.test(entry)),
      [],
      "a collectible dry-run file sits beside the manifest",
    );

    // An actual import of a manifest — determined by the PARSER, not by a
    // pattern over the raw text. A dynamic import executes the declaration
    // exactly as a static one does, `.ts` resolves as readily as `.js`, and
    // prose that merely names a manifest is not an import. A regex could not
    // separate those three, and the file it would false-positive on first is
    // this one.
    //
    // Every `.ts` under `tests/` is scanned, not only `*.test.ts`: a helper,
    // fixture or world file is never collected by vitest itself, but a
    // collected `*.test.ts` importing THAT file would import the manifest
    // transitively without this audit's direct-specifier check on the
    // `.test.ts` file ever seeing it. Scanning every file the corpus can
    // reach closes that gap without re-deriving the whole import graph.
    const collected: string[] = [];
    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const full = join(directory, entry.name);
        if (entry.isDirectory()) visit(full);
        else if (entry.isFile() && entry.name.endsWith(".ts")) collected.push(full);
      }
    };
    visit(testsRoot);
    assert.ok(collected.length > 0, "the test corpus scan found nothing, so it proves nothing");
    const importers = collected.filter((file) => {
      if (file === manifest) return false;
      const source = readFileSync(file, "utf8");
      // Cheap pre-filter; every candidate is then judged by the parser alone.
      if (!source.includes("dry-run.scenario.")) return false;
      return moduleSpecifiers(file, source).some((specifier) =>
        /dry-run\.scenario\.(?:js|ts)$/u.test(specifier));
    });
    assert.deepEqual(importers, [], "a file the test corpus can reach imports a dry-run manifest");
  });
});
