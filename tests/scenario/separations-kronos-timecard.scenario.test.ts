/**
 * Executable scenarios for `separations-kronos-timecard` — separations chunk 1
 * (`docs/migrations/separations.md` §3), the New Kronos passage.
 *
 * Two of them walk the real descriptor's real bind/derive functions along the
 * happy path and the S38 empty-card path. The other three are the §4b arms, and
 * they are NOT graph walks: an unreachable Kronos, a search that never answered
 * and a wrong-person timecard all fail INSIDE a task, so what they falsify is
 * the task's refusal — that the outcome is a distinct structured failure naming
 * expected against observed, and never an empty timecard. Those run the real
 * task implementation against a fake driver, which is the only way to observe
 * "it refused" rather than "it returned something plausible".
 *
 * The corresponding fixture values are the ones measured live on 2026-08-12
 * (EID 10776990, window 06/01/2026–08/12/2026): 73 days covered, 9 scroll steps
 * on the virtualized grid, last punch 06/12, one `Holiday - Hourly` day and two
 * pay codes the ported classifier does not recognise.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { EidSchema } from "../../src/domain/ids.js";
import { directIdentifierDigestReference } from "../../src/domain/redaction.js";
import { createDeterministicNewKronosTimecardDriver } from "../../src/stores/new-kronos/driver/fake.js";
import { readSeparationTimecardTask } from "../../src/stores/new-kronos/tasks/read-separation-timecard.js";
import { searchEmployeeTask } from "../../src/stores/new-kronos/tasks/search-employee.js";
import { separationsKronosTimecardDescriptor } from "../helpers/registered-workflows.js";
import { walkDescriptor } from "./helpers/pure-walk.js";

/**
 * The minimum task context a read task needs. `fail` throws, which is what
 * makes a refusal observable as a rejection instead of a returned value.
 */
const taskCtx = Object.freeze({
  signal: new AbortController().signal,
  log: Object.freeze({ debug: () => undefined, info: () => undefined, warn: () => undefined }),
  fail: (code: string, message: string): never => { throw new Error(`${code}: ${message}`); },
  recordData: () => undefined,
});

const EMPL_ID = EidSchema.parse("10776990");
const MATCHED = { displayName: "Kou, Nathan", employeeId: EMPL_ID };

const SEARCH_RESOLVED = {
  query: EMPL_ID,
  totalCount: 1,
  candidates: [MATCHED],
  matched: MATCHED,
  selectedCount: 1,
  panelContext: "portal-frame",
} as const;

const COLUMN_HEADERS = [
  "Date", "Schedule", "In", "Out", "Transfer", "Pay code",
  "Amount", "Shift", "Daily", "Period", "Absence",
];

const SUBJECT = {
  observationId: "new-kronos.timecard.displayed-eid",
  expectedEid: EMPL_ID,
  observedEmployeeId: EMPL_ID,
  observedDisplayName: "Kou, Nathan",
  matches: true,
} as const;

const APPLIED_RANGE = {
  requestedStart: "06/01/2026",
  requestedEnd: "08/12/2026",
  observedLabel: "6/01/2026 - 8/12/2026",
  observedStart: "06/01/2026",
  observedEnd: "08/12/2026",
  applied: true,
} as const;

const TIMECARD_WITH_PUNCHES = {
  subject: SUBJECT,
  range: APPLIED_RANGE,
  grid: {
    columnHeaders: COLUMN_HEADERS,
    scrollSteps: 9,
    daysCovered: 73,
    populatedRows: 10,
    lastPunchDate: "06/12/2026",
    punchDates: ["06/01/2026", "06/08/2026", "06/12/2026"],
    sickDates: [],
    holidayDates: ["06/19/2026"],
    payCodeDays: [
      { date: "06/19/2026", payCode: "Holiday - Hourly", amount: "4.00" },
      { date: "06/19/2026", payCode: "Juneteenth Observed", amount: "0.00" },
      { date: "07/03/2026", payCode: "Independence Day Observed", amount: "0.00" },
    ],
    unclassifiedPayCodes: ["Independence Day Observed", "Juneteenth Observed"],
  },
} as const;

const TIMECARD_WITHOUT_PUNCHES = {
  subject: SUBJECT,
  range: APPLIED_RANGE,
  grid: {
    columnHeaders: COLUMN_HEADERS,
    scrollSteps: 0,
    daysCovered: 14,
    populatedRows: 0,
    lastPunchDate: null,
    punchDates: [],
    sickDates: [],
    holidayDates: [],
    payCodeDays: [],
    unclassifiedPayCodes: [],
  },
} as const;

const RUN_INPUT = {
  emplId: EMPL_ID,
  expectedName: "Kou, Nathan",
  rangeStart: "06/01/2026",
  rangeEnd: "08/12/2026",
};

describe("separations-kronos-timecard scenarios", () => {
  it("separations-kronos-timecard/reads-a-real-timecard — search, timecard, derived separation dates", () => {
    const walk = walkDescriptor(separationsKronosTimecardDescriptor, RUN_INPUT, {
      outputs: { search: SEARCH_RESOLVED, timecard: TIMECARD_WITH_PUNCHES },
    });
    assert.deepEqual(walk.visited, ["search", "timecard"]);
    assert.deepEqual(walk.skipped, []);
    // Zero coverage points is the correct answer for a branchless read graph.
    assert.deepEqual(walk.covered, []);
    assert.deepEqual(walk.result, {
      subject: {
        expectedEid: EMPL_ID,
        observedEmployeeId: EMPL_ID,
        expectedName: "Kou, Nathan",
        observedDisplayName: "Kou, Nathan",
        nameSimilarity: "same",
      },
      window: {
        requestedStart: "06/01/2026",
        requestedEnd: "08/12/2026",
        observedStart: "06/01/2026",
        observedEnd: "08/12/2026",
        observedLabel: "6/01/2026 - 8/12/2026",
        daysCovered: 73,
      },
      timecard: {
        lastPunchDate: "06/12/2026",
        punchDates: ["06/01/2026", "06/08/2026", "06/12/2026"],
        sickDates: [],
        holidayDates: ["06/19/2026"],
        payCodeDays: TIMECARD_WITH_PUNCHES.grid.payCodeDays,
        unclassifiedPayCodes: ["Independence Day Observed", "Juneteenth Observed"],
      },
      derived: {
        lastPunchDate: "06/12/2026",
        // S39: leave extends the separation date past the last physical punch.
        latestLeaveDate: "06/19/2026",
        separationDateCandidate: "06/19/2026",
        hasPunches: true,
      },
      search: { totalCount: 1, candidates: [MATCHED], panelContext: "portal-frame" },
    });
  });

  it("separations-kronos-timecard/timecard-without-punches — an empty card is a REAL outcome (S38)", () => {
    const walk = walkDescriptor(separationsKronosTimecardDescriptor, RUN_INPUT, {
      outputs: { search: SEARCH_RESOLVED, timecard: TIMECARD_WITHOUT_PUNCHES },
    });
    assert.deepEqual(walk.visited, ["search", "timecard"]);
    const result = walk.result as { derived: Record<string, unknown> };
    assert.deepEqual(result.derived, {
      lastPunchDate: null,
      latestLeaveDate: null,
      separationDateCandidate: null,
      hasPunches: false,
    });
  });

  it("separations-kronos-timecard/employee-not-found — WFD's own sentinel is a real negative", async () => {
    const driver = createDeterministicNewKronosTimecardDriver({
      search: {
        state: "no-results",
        query: EMPL_ID,
        sentinel: "There are no items to display.",
        panelContext: "top-level",
        observedAt: "2026-08-12T18:45:00.000Z",
      },
    });
    await assert.rejects(
      searchEmployeeTask.impl.run({
        input: { emplId: EMPL_ID, searchTimeoutMs: 15_000 },
        ctx: { ...taskCtx, driver },
      }),
      /employee-not-found: .*There are no items to display/,
    );
  });

  it("separations-kronos-timecard/search-no-signal — a timeout is never a factual negative (S35)", async () => {
    const driver = createDeterministicNewKronosTimecardDriver({
      search: {
        state: "no-signal",
        query: EMPL_ID,
        reason: "neither a result row nor the sentinel surfaced in either render context",
        waitedMs: 15_000,
        observedAt: "2026-08-12T18:45:00.000Z",
      },
    });
    await assert.rejects(
      searchEmployeeTask.impl.run({
        input: { emplId: EMPL_ID, searchTimeoutMs: 15_000 },
        ctx: { ...taskCtx, driver },
      }),
      /search-no-signal: .*The check could not run/,
    );
  });

  it("separations-kronos-timecard/wrong-employee-timecard — the wrong subject fails, naming both (S37)", async () => {
    const driver = createDeterministicNewKronosTimecardDriver({
      search: { ...SEARCH_RESOLVED, state: "resolved", observedAt: "2026-08-12T18:45:00.000Z" },
      timecard: {
        subject: {
          observationId: "new-kronos.timecard.displayed-eid",
          expectedEid: EMPL_ID,
          observedEmployeeId: "10001946",
          observedDisplayName: "Yang, Somebody",
          matches: false,
        },
        range: APPLIED_RANGE,
        grid: TIMECARD_WITH_PUNCHES.grid,
        observedAt: "2026-08-12T18:45:00.000Z",
      },
    });
    await assert.rejects(
      readSeparationTimecardTask.impl.run({
        input: { emplId: EMPL_ID, rangeStart: "06/01/2026", rangeEnd: "08/12/2026" },
        ctx: { ...taskCtx, driver },
      }),
      new RegExp(`subject-mismatch: .*${directIdentifierDigestReference("10001946")}`),
    );
  });
});
