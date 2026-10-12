
import assert_m0 from "node:assert/strict";
import { describe as describe_m0,it as it_m0 } from "vitest";
import {
buildSessionPanelView as buildSessionPanelView_m0,
poolFactsForWorkflow as poolFactsForWorkflow_m0,
sessionMembershipForWorker as sessionMembershipForWorker_m0,
sessionPoolGroupFor as sessionPoolGroupFor_m0,
workerBrowserView as workerBrowserView_m0
} from "../../../../src/dashboard/surfaces/shell/shell-model.js";
import { DashboardDayWireSchema as DashboardDayWireSchema_m0,type DashboardDayWire as DashboardDayWire_m0 } from "../../../../src/models/dashboard/projection.js";
import { FIXTURE_DAY_WIRE as FIXTURE_DAY_WIRE_m0,uuidOf as uuidOf_m0 } from "../../../parity/helpers/fixture-day.js";

import { describe as describe_m1,expect as expect_m1,it as it_m1 } from "vitest";
import { z as z_m1 } from "zod";
import {
activeCount as activeCount_m1,
activeStatusWords as activeStatusWords_m1,
needsYouCount as needsYouCount_m1,
statusCount as statusCount_m1,
statusPillOrder as statusPillOrder_m1,
totalCount as totalCount_m1,
workflowStatusCounts as workflowStatusCounts_m1
} from "../../../../src/dashboard/surfaces/shell/shell-model.js";
import { WorkflowCountWireSchema as WorkflowCountWireSchema_m1 } from "../../../../src/models/dashboard/projection.js";

import assert_m2 from "node:assert/strict";
import { describe as describe_m2,it as it_m2 } from "vitest";
import { workerCardOf as workerCardOf_m2 } from "../../../../src/backend/runs/projections/worker-cards.js";
import {
WORKER_STOP_REASON_LABEL as WORKER_STOP_REASON_LABEL_m2,
WORKER_TONE as WORKER_TONE_m2
} from "../../../../src/dashboard/surfaces/shell/shell-model.js";
import { WorkerLeaseRecordSchema as WorkerLeaseRecordSchema_m2 } from "../../../../src/models/run/worker.js";


{


const SESSION_ID = uuidOf_m0(700);

function sessionDay(): DashboardDayWire_m0 {
  const failedWorker = FIXTURE_DAY_WIRE_m0.workerCards.find((card) => card.state === "failed");
  if (failedWorker === undefined) throw new Error("the real wire fixture needs a failed retained worker card");
  return DashboardDayWireSchema_m0.parse({
    ...FIXTURE_DAY_WIRE_m0,
    queueSurfaces: FIXTURE_DAY_WIRE_m0.queueSurfaces.map((row) => {
      if (String(row.runId) === uuidOf_m0(2) || String(row.runId) === uuidOf_m0(3)) {
        return { ...row, session: { state: "present", sessionId: SESSION_ID } };
      }
      if (String(row.runId) === uuidOf_m0(4)) {
        return { ...row, session: { state: "absent", reason: "This fixture has no run session." } };
      }
      return row;
    }),
    workerPools: [{
      workflowId: "person-lookup",
      desiredWorkers: 3,
      version: 2,
      plannedBy: "local-operator",
      plannedAt: "2026-08-03T09:00:00.000-07:00",
    }],
    workerCards: [
      ...FIXTURE_DAY_WIRE_m0.workerCards,
      {
        ...failedWorker,
        workerId: "person-lookup-worker-stopped-retained",
        state: "stopped",
        stopReason: "operator",
      },
    ],
  });
}

describe_m0("Session Panel authority joins", () => {
  it_m0("joins a working card to its run's served session by exact run id", () => {
    const day = sessionDay();
    const working = day.workerCards.find((card) => card.state === "working");
    if (working === undefined) throw new Error("the real wire fixture needs a working worker");

    const membership = sessionMembershipForWorker_m0(working, day.queueSurfaces);
    assert_m0.equal(membership.state, "present");
    if (membership.state !== "present") return;
    assert_m0.equal(String(membership.sessionId), SESSION_ID);
    assert_m0.equal(String(membership.row.runId), uuidOf_m0(2));
  });

  it_m0("keeps an absent session as the row's served reason, never a guessed id", () => {
    const day = sessionDay();
    const working = day.workerCards.find((card) => card.state === "working");
    if (working === undefined) throw new Error("the real wire fixture needs a working worker");
    const onAbsentRow = DashboardDayWireSchema_m0.parse({
      ...day,
      workerCards: [{ ...working, currentRun: { state: "present", runId: uuidOf_m0(4), traceId: "pl-160500-0004" } }],
    }).workerCards[0];
    if (onAbsentRow === undefined) throw new Error("the parsed day wire dropped its only worker card");

    assert_m0.deepEqual(sessionMembershipForWorker_m0(onAbsentRow, day.queueSurfaces), {
      state: "absent",
      reason: "This fixture has no run session.",
    });
  });

  it_m0("distinguishes a declared pool from authority worker facts and treats no row as no declaration", () => {
    const day = sessionDay();

    assert_m0.deepEqual(poolFactsForWorkflow_m0("person-lookup", day.workerCards, day.workerPools), {
      state: "declared",
      desiredWorkers: 3,
      version: 2,
      activeWorkers: 4,
    });
    assert_m0.deepEqual(poolFactsForWorkflow_m0("separations", day.workerCards, day.workerPools), {
      state: "absent",
      activeWorkers: 0,
    });
    assert_m0.equal(day.workerCards.length, 6, "the fixture keeps failed and stopped worker cards as retained authority records");
    assert_m0.equal(
      day.workerCards.filter((card) => card.state === "failed" || card.state === "stopped").length,
      2,
      "neither terminal record may inflate the active count",
    );
  });

  it_m0("does not turn an idle worker's absence of a current run into an absent session or browser verdict", () => {
    const day = sessionDay();
    const idle = day.workerCards.find((card) => card.state === "idle");
    if (idle === undefined) throw new Error("the real wire fixture needs an idle worker");

    const membership = sessionMembershipForWorker_m0(idle, day.queueSurfaces);
    assert_m0.deepEqual(membership, { state: "unassigned", reason: "no claimable work at this priority" });
    assert_m0.equal("sessionId" in membership, false);
    assert_m0.equal("browserStatus" in membership, false);
    assert_m0.deepEqual(
      idle.browsers.map((browser) => browser.system),
      ["ucpath"],
      "the browser tile retains only the served system fact; no health state is invented",
    );
  });

  it_m0("keeps descriptor browser order, upgrades observed sessions, and retains observed extras", () => {
    const day = sessionDay();
    const idle = day.workerCards.find((card) => card.state === "idle");
    if (idle === undefined) throw new Error("the real wire fixture needs an idle worker");
    const ucpath = idle.browsers[0];
    if (ucpath === undefined) throw new Error("the real wire fixture needs an observed UCPath browser");
    const card = DashboardDayWireSchema_m0.parse({
      ...day,
      workerCards: [{
        ...idle,
        browserRequirements: { state: "present", systems: ["kuali", "ucpath", "crm"] },
        browsers: [
          ucpath,
          { sessionId: uuidOf_m0(901), system: "servicenow", openedAt: "2026-08-03T16:59:00.000Z" },
        ],
      }],
    }).workerCards[0];
    if (card === undefined) throw new Error("the parsed day wire dropped its worker card");

    assert_m0.deepEqual(workerBrowserView_m0(card), {
      slots: [
        { state: "required", system: "kuali" },
        { state: "open", browser: ucpath },
        { state: "required", system: "crm" },
        {
          state: "open",
          browser: { sessionId: uuidOf_m0(901), system: "servicenow", openedAt: "2026-08-03T16:59:00.000Z" },
        },
      ],
    });
  });

  it_m0("serves requirement authority failures explicitly without hiding observed browsers", () => {
    const day = sessionDay();
    const idle = day.workerCards.find((card) => card.state === "idle");
    if (idle === undefined) throw new Error("the real wire fixture needs an idle worker");

    assert_m0.deepEqual(workerBrowserView_m0({
      ...idle,
      browserRequirements: { state: "unavailable", reason: "workflow descriptor is not registered" },
    }), {
      slots: idle.browsers.map((browser) => ({ state: "open", browser })),
      unavailableReason: "workflow descriptor is not registered",
    });
  });

  it_m0("shows no browser slots on a retained terminal worker card", () => {
    const day = sessionDay();
    const terminal = day.workerCards.find((card) => card.state === "stopped");
    if (terminal === undefined) throw new Error("the real wire fixture needs a stopped retained worker card");

    assert_m0.deepEqual(workerBrowserView_m0({
      ...terminal,
      browserRequirements: { state: "present", systems: ["ucpath", "crm"] },
    }), { slots: [] });
  });

  it_m0("folds one membership per served card, in wire order, for the strip to read by worker id", () => {
    const day = sessionDay();
    const view = buildSessionPanelView_m0(day.queueSurfaces, day.workerCards, day.workerPools);

    assert_m0.deepEqual(
      view.workers.map(({ card }) => String(card.workerId)),
      day.workerCards.map((card) => String(card.workerId)),
    );
    assert_m0.deepEqual(view.poolGroups.map((group) => group.workflowId), ["person-lookup"]);
  });

  it_m0("plans a workflow with neither a card nor a pool row at basis 0 with an empty roster", () => {
    const day = sessionDay();

    const group = sessionPoolGroupFor_m0("separations", day.workerCards, day.workerPools);
    assert_m0.deepEqual(group, {
      workflowId: "separations",
      facts: { state: "absent", activeWorkers: 0 },
      declaration: undefined,
      expectedVersion: 0,
      slots: [],
      unindexedCards: [],
    });
    // The by-id fold IS the roster's fold: a workflow the roster already
    // holds answers identically through either door.
    assert_m0.deepEqual(
      sessionPoolGroupFor_m0("person-lookup", day.workerCards, day.workerPools),
      buildSessionPanelView_m0(day.queueSurfaces, day.workerCards, day.workerPools).poolGroups[0],
    );
  });
});
}

{



const WORKFLOW_COUNTS = z_m1.array(WorkflowCountWireSchema_m1).parse([
  {
    workflowId: "person-lookup",
    count: 6,
    statusCounts: [
      { status: "queued", count: 2 },
      { status: "running", count: 1 },
      { status: "done", count: 3 },
    ],
  },
  {
    workflowId: "separations-kuali-read",
    count: 5,
    statusCounts: [
      { status: "failed", count: 3 },
      { status: "awaiting-approval", count: 1 },
      { status: "blocked", count: 1 },
    ],
  },
]);

describe_m1("workflowStatusCounts — the band's scope selector", () => {
  it_m1("reads the ACTIVE workflow's entry, not the day's fold", () => {
    expect_m1(workflowStatusCounts_m1(WORKFLOW_COUNTS, "person-lookup")).toEqual(
      WORKFLOW_COUNTS[0].statusCounts,
    );
    expect_m1(statusCount_m1(workflowStatusCounts_m1(WORKFLOW_COUNTS, "person-lookup"), "failed")).toBe(0);
    expect_m1(statusCount_m1(workflowStatusCounts_m1(WORKFLOW_COUNTS, "separations-kuali-read"), "failed")).toBe(3);
  });


  it_m1("answers an unserved workflow with an empty array, so every pill reads zero", () => {
    const none = workflowStatusCounts_m1(WORKFLOW_COUNTS, "workflow-with-no-row");
    expect_m1(none).toEqual([]);
    expect_m1(totalCount_m1(none)).toBe(0);
    expect_m1(activeCount_m1(none)).toBe(0);
    expect_m1(needsYouCount_m1(none)).toBe(0);
  });
});

describe_m1("totalCount — the `All` segment", () => {
  it_m1("keeps Cancelling active and selectable, including after its selected bucket empties", () => {
    const counts = z_m1.array(WorkflowCountWireSchema_m1).parse([{
      workflowId: "person-lookup", count: 4,
      statusCounts: [{ status: "cancelling", count: 3 }, { status: "done", count: 1 }],
    }])[0].statusCounts;
    expect_m1(activeCount_m1(counts)).toBe(3);
    expect_m1(activeStatusWords_m1(counts)).toBe("queued, running or cancelling");
    expect_m1(activeStatusWords_m1([])).toBe("queued or running");
    expect_m1(needsYouCount_m1(counts)).toBe(0);
    expect_m1(totalCount_m1(counts)).toBe(4);
    expect_m1(statusPillOrder_m1(counts, "all")).toContain("cancelling");
    expect_m1(statusPillOrder_m1([], "cancelling")).toContain("cancelling");
    expect_m1(statusPillOrder_m1([], "all")).toHaveLength(8);
  });

  it_m1("folds the SAME array the pills render, and matches the served row total", () => {
    for (const entry of WORKFLOW_COUNTS) {
      expect_m1(totalCount_m1(entry.statusCounts)).toBe(entry.count);
    }
  });

  it_m1("stays closed under addition with the composites beside it", () => {
    const separations = workflowStatusCounts_m1(WORKFLOW_COUNTS, "separations-kuali-read");
    // needsYou is the ONLY deliberate overlap, and it is a sum of two pills.
    expect_m1(needsYouCount_m1(separations)).toBe(2);
    expect_m1(activeCount_m1(separations)).toBe(0);
    expect_m1(totalCount_m1(separations)).toBe(
      statusCount_m1(separations, "failed") + needsYouCount_m1(separations),
    );
  });
});
}

{


const STARTED = "2026-08-20T16:00:00.000Z";

function leaseOf(overrides: Readonly<Record<string, unknown>> = {}): ReturnType<typeof WorkerLeaseRecordSchema_m2.parse> {
  return WorkerLeaseRecordSchema_m2.parse({
    workerId: "person-lookup-worker-1",
    workflow: "person-lookup",
    browserSystems: ["ucpath"],
    processId: 1234,
    leaseGeneration: 1, controlRevision: 1,
    lifecycle: { state: "idle", startedAt: STARTED, heartbeatAt: "2026-08-20T16:00:30.000Z" },
    control: { directive: "run", requestedAt: STARTED, requestedBy: "local-operator" },
    version: 5,
    createdAt: STARTED,
    updatedAt: "2026-08-20T16:00:30.000Z",
    ...overrides,
  });
}

const NO_TRACE = (): undefined => undefined;

describe_m2("the words the card carries", () => {
  const _live = workerCardOf_m2({
    lease: leaseOf(),
    fold: undefined,
    resolveTrace: NO_TRACE,
  });

  it_m2("has a word for every state and every recorded stop reason", () => {

    const labels = Object.values(WORKER_TONE_m2).map(({ label }) => label);
    assert_m2.equal(new Set(labels).size, labels.length);
    const reasons = Object.values(WORKER_STOP_REASON_LABEL_m2);
    assert_m2.equal(new Set(reasons).size, reasons.length);
    assert_m2.notEqual(WORKER_STOP_REASON_LABEL_m2.crashed, WORKER_STOP_REASON_LABEL_m2.operator);
  });
});
}
