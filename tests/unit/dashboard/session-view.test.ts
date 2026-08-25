/**
 * The P4 session view is a pure read of the day wire: rows name membership,
 * worker leases name active work, and a pool row is only a declaration. This
 * fixture starts at the strict, real dashboard wire rather than rebuilding a
 * second session vocabulary beside it.
 */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { DashboardDayWireSchema, type DashboardDayWire } from "../../../src/domain/dashboard/projection.js";
import {
  SESSION_LIST_DEFAULT_VIEWPORT_HEIGHT,
  buildSessionListLayout,
  buildSessionView,
  poolFactsForWorkflow,
  sessionListScrollTopForIndex,
  sessionListWindow,
  sessionMembershipForWorker,
} from "../../../src/dashboard/surfaces/shell-model.js";
import { SessionMembershipList } from "../../../src/dashboard/surfaces/shell.js";
import { FIXTURE_DAY_WIRE, uuidOf } from "../../parity/helpers/fixture-day.js";

const SESSION_ID = uuidOf(700);
const LONG_TITLE = "Separation — Nguyễn, Thi (long subject label preserved in the session member row without truncating its value)";

function sessionDay(): DashboardDayWire {
  const failedWorker = FIXTURE_DAY_WIRE.workerCards.find((card) => card.state === "failed");
  if (failedWorker === undefined) throw new Error("the real wire fixture needs a failed retained worker card");
  return DashboardDayWireSchema.parse({
    ...FIXTURE_DAY_WIRE,
    queueSurfaces: FIXTURE_DAY_WIRE.queueSurfaces.map((row) => {
      if (String(row.runId) === uuidOf(2)) {
        return { ...row, session: { state: "present", sessionId: SESSION_ID }, title: LONG_TITLE };
      }
      if (String(row.runId) === uuidOf(3)) {
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

function hostileSessionDay(): DashboardDayWire {
  const day = sessionDay();
  const source = day.queueSurfaces[0];
  const rows = Array.from({ length: 1240 }, (_, index) => ({
    ...source,
    runId: uuidOf(10_000 + index),
    title: `Long session subject ${String(index)} — Nguyễn, Thi — this title must remain an authority row instead of being dropped for density`,
    session: { state: "present" as const, sessionId: SESSION_ID },
  }));
  return DashboardDayWireSchema.parse({ ...day, queueSurfaces: rows });
}

describe("P4 — Session Panel authority joins", () => {
  it("groups membership by the rows' served session id and joins the active worker by exact run id", () => {
    const day = sessionDay();
    const view = buildSessionView(day.queueSurfaces, day.workerCards, day.workerPools);

    assert.equal(view.sessions.length, 1);
    const session = view.sessions[0];
    assert.equal(String(session.sessionId), SESSION_ID);
    assert.equal(session.members.length, 2);
    assert.deepEqual(session.pools, [{
      workflowId: "person-lookup",
      facts: { state: "declared", desiredWorkers: 3, version: 2, activeWorkers: 4 },
    }]);
    assert.equal(session.members[0].row.title, LONG_TITLE);
    assert.deepEqual(
      session.members.map((member) => member.row.status),
      ["running", "done"],
      "mixed member states are rendered verbatim from the queue projection",
    );
    assert.deepEqual(
      session.members[0].workers.map((worker) => String(worker.workerId)),
      ["person-lookup-worker-1"],
      "a worker appears only when its authority currentRun names this exact member",
    );
    assert.deepEqual(session.members[1].workers, [], "no holder is invented for an unassigned member");
  });

  it("keeps an absent session separate and renders its served reason", () => {
    const day = sessionDay();
    const view = buildSessionView(day.queueSurfaces, day.workerCards, day.workerPools);

    assert.deepEqual(view.absentMembers.find(({ row }) => String(row.runId) === uuidOf(4)), {
      row: day.queueSurfaces.find((row) => String(row.runId) === uuidOf(4)),
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

  it("retains every member in a hostile 1,240-row session with long titles", () => {
    const hostile = hostileSessionDay();

    const view = buildSessionView(hostile.queueSurfaces, hostile.workerCards, hostile.workerPools);
    assert.equal(view.sessions.length, 1);
    assert.equal(view.sessions[0].members.length, 1240);
    assert.match(view.sessions[0].members[1239].row.title, /Long session subject 1239/);
  });

  it("bounds every mounted window while keeping all 1,240 authority members reachable", () => {
    const hostile = hostileSessionDay();
    const view = buildSessionView(hostile.queueSurfaces, hostile.workerCards, hostile.workerPools);
    const layout = buildSessionListLayout(view);

    assert.equal(layout.rows.length, 1241, "one session heading plus every authority member remains addressable");
    for (const row of layout.rows) {
      const scrollTop = sessionListScrollTopForIndex(layout, row.index, SESSION_LIST_DEFAULT_VIEWPORT_HEIGHT);
      const window = sessionListWindow(layout, scrollTop, SESSION_LIST_DEFAULT_VIEWPORT_HEIGHT);
      assert.ok(window.rows.length <= 16, `window at row ${String(row.index)} mounted ${String(window.rows.length)} rows`);
      assert.ok(window.rows.some((candidate) => candidate.index === row.index), `row ${String(row.index)} is reachable`);
    }
  });

  it("mounts only the initial virtual window for the hostile session", () => {
    const hostile = hostileSessionDay();
    const view = buildSessionView(hostile.queueSurfaces, hostile.workerCards, hostile.workerPools);
    const markup = renderToStaticMarkup(createElement(SessionMembershipList, { sessionView: view }));
    const mountedRows = markup.match(/data-session-virtual-row=/g) ?? [];

    assert.ok(mountedRows.length > 0);
    assert.ok(mountedRows.length <= 16, `initial render mounted ${String(mountedRows.length)} rows`);
    assert.doesNotMatch(markup, /Long session subject 1239/, "offscreen member is not mounted initially");
  });
});
