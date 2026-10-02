/**
 * The Session Panel's authority joins are a pure read of the day wire: worker
 * leases name active work, a queue row names the session its run belongs to,
 * and a pool row is only a declaration. This fixture starts at the strict, real
 * dashboard wire rather than rebuilding a second session vocabulary beside it.
 *
 * D305 retired the drawer's membership LIST (the demo's strip holds sessions,
 * and a list of runs grouped by session id is not one), so the folds pinned
 * here are the two the panel still draws from: the per-card membership join
 * and the per-workflow pool facts, plus the by-id pool group the Add workers
 * dialog plans against.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { DashboardDayWireSchema, type DashboardDayWire } from "../../../../src/domain/dashboard/projection.js";
import {
  buildSessionPanelView,
  poolFactsForWorkflow,
  sessionMembershipForWorker,
  sessionPoolGroupFor,
  workerBrowserView,
} from "../../../../src/dashboard/surfaces/shell-model.js";
import { FIXTURE_DAY_WIRE, uuidOf } from "../../../parity/helpers/fixture-day.js";

const SESSION_ID = uuidOf(700);

function sessionDay(): DashboardDayWire {
  const failedWorker = FIXTURE_DAY_WIRE.workerCards.find((card) => card.state === "failed");
  if (failedWorker === undefined) throw new Error("the real wire fixture needs a failed retained worker card");
  return DashboardDayWireSchema.parse({
    ...FIXTURE_DAY_WIRE,
    queueSurfaces: FIXTURE_DAY_WIRE.queueSurfaces.map((row) => {
      if (String(row.runId) === uuidOf(2) || String(row.runId) === uuidOf(3)) {
        return { ...row, session: { state: "present", sessionId: SESSION_ID } };
      }
      if (String(row.runId) === uuidOf(4)) {
        return { ...row, session: { state: "absent", reason: "this run predates D269 session grouping" } };
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
      ...FIXTURE_DAY_WIRE.workerCards,
      {
        ...failedWorker,
        workerId: "person-lookup-worker-stopped-retained",
        state: "stopped",
        stopReason: "operator",
      },
    ],
  });
}

describe("Session Panel authority joins", () => {
  it("joins a working card to its run's served session by exact run id", () => {
    const day = sessionDay();
    const working = day.workerCards.find((card) => card.state === "working");
    if (working === undefined) throw new Error("the real wire fixture needs a working worker");

    const membership = sessionMembershipForWorker(working, day.queueSurfaces);
    assert.equal(membership.state, "present");
    if (membership.state !== "present") return;
    assert.equal(String(membership.sessionId), SESSION_ID);
    assert.equal(String(membership.row.runId), uuidOf(2));
  });

  it("keeps an absent session as the row's served reason, never a guessed id", () => {
    const day = sessionDay();
    const working = day.workerCards.find((card) => card.state === "working");
    if (working === undefined) throw new Error("the real wire fixture needs a working worker");
    const onAbsentRow = DashboardDayWireSchema.parse({
      ...day,
      workerCards: [{ ...working, currentRun: { state: "present", runId: uuidOf(4), traceId: "pl-160500-0004" } }],
    }).workerCards[0];
    if (onAbsentRow === undefined) throw new Error("the parsed day wire dropped its only worker card");

    assert.deepEqual(sessionMembershipForWorker(onAbsentRow, day.queueSurfaces), {
      state: "absent",
      reason: "this run predates D269 session grouping",
    });
  });

  it("distinguishes a declared pool from authority worker facts and treats no row as no declaration", () => {
    const day = sessionDay();

    assert.deepEqual(poolFactsForWorkflow("person-lookup", day.workerCards, day.workerPools), {
      state: "declared",
      desiredWorkers: 3,
      version: 2,
      activeWorkers: 4,
    });
    assert.deepEqual(poolFactsForWorkflow("separations", day.workerCards, day.workerPools), {
      state: "absent",
      activeWorkers: 0,
    });
    assert.equal(day.workerCards.length, 6, "the fixture keeps failed and stopped worker cards as retained authority records");
    assert.equal(
      day.workerCards.filter((card) => card.state === "failed" || card.state === "stopped").length,
      2,
      "neither terminal record may inflate the active count",
    );
  });

  it("does not turn an idle worker's absence of a current run into an absent session or browser verdict", () => {
    const day = sessionDay();
    const idle = day.workerCards.find((card) => card.state === "idle");
    if (idle === undefined) throw new Error("the real wire fixture needs an idle worker");

    const membership = sessionMembershipForWorker(idle, day.queueSurfaces);
    assert.deepEqual(membership, { state: "unassigned", reason: "no claimable work at this priority" });
    assert.equal("sessionId" in membership, false);
    assert.equal("browserStatus" in membership, false);
    assert.deepEqual(
      idle.browsers.map((browser) => browser.system),
      ["ucpath"],
      "the browser tile retains only the served system fact; no health state is invented",
    );
  });

  it("keeps descriptor browser order, upgrades observed sessions, and retains observed extras", () => {
    const day = sessionDay();
    const idle = day.workerCards.find((card) => card.state === "idle");
    if (idle === undefined) throw new Error("the real wire fixture needs an idle worker");
    const ucpath = idle.browsers[0];
    if (ucpath === undefined) throw new Error("the real wire fixture needs an observed UCPath browser");
    const card = DashboardDayWireSchema.parse({
      ...day,
      workerCards: [{
        ...idle,
        browserRequirements: { state: "present", systems: ["kuali", "ucpath", "crm"] },
        browsers: [
          ucpath,
          { sessionId: uuidOf(901), system: "servicenow", openedAt: "2026-08-03T16:59:00.000Z" },
        ],
      }],
    }).workerCards[0];
    if (card === undefined) throw new Error("the parsed day wire dropped its worker card");

    assert.deepEqual(workerBrowserView(card), {
      slots: [
        { state: "required", system: "kuali" },
        { state: "open", browser: ucpath },
        { state: "required", system: "crm" },
        {
          state: "open",
          browser: { sessionId: uuidOf(901), system: "servicenow", openedAt: "2026-08-03T16:59:00.000Z" },
        },
      ],
    });
  });

  it("serves requirement authority failures explicitly without hiding observed browsers", () => {
    const day = sessionDay();
    const idle = day.workerCards.find((card) => card.state === "idle");
    if (idle === undefined) throw new Error("the real wire fixture needs an idle worker");

    assert.deepEqual(workerBrowserView({
      ...idle,
      browserRequirements: { state: "unavailable", reason: "workflow descriptor is not registered" },
    }), {
      slots: idle.browsers.map((browser) => ({ state: "open", browser })),
      unavailableReason: "workflow descriptor is not registered",
    });
  });

  it("shows no browser slots on a retained terminal worker card", () => {
    const day = sessionDay();
    const terminal = day.workerCards.find((card) => card.state === "stopped");
    if (terminal === undefined) throw new Error("the real wire fixture needs a stopped retained worker card");

    assert.deepEqual(workerBrowserView({
      ...terminal,
      browserRequirements: { state: "present", systems: ["ucpath", "crm"] },
    }), { slots: [] });
  });

  it("folds one membership per served card, in wire order, for the strip to read by worker id", () => {
    const day = sessionDay();
    const view = buildSessionPanelView(day.queueSurfaces, day.workerCards, day.workerPools);

    assert.deepEqual(
      view.workers.map(({ card }) => String(card.workerId)),
      day.workerCards.map((card) => String(card.workerId)),
    );
    assert.deepEqual(view.poolGroups.map((group) => group.workflowId), ["person-lookup"]);
  });

  it("plans a workflow with neither a card nor a pool row at basis 0 with an empty roster (D305)", () => {
    const day = sessionDay();

    const group = sessionPoolGroupFor("separations", day.workerCards, day.workerPools);
    assert.deepEqual(group, {
      workflowId: "separations",
      facts: { state: "absent", activeWorkers: 0 },
      declaration: undefined,
      expectedVersion: 0,
      slots: [],
      unindexedCards: [],
    });
    // The by-id fold IS the roster's fold: a workflow the roster already
    // holds answers identically through either door.
    assert.deepEqual(
      sessionPoolGroupFor("person-lookup", day.workerCards, day.workerPools),
      buildSessionPanelView(day.queueSurfaces, day.workerCards, day.workerPools).poolGroups[0],
    );
  });
});
