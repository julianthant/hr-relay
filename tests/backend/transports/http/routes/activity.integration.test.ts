
import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";
import { activityReportCsv } from "../../../../../src/backend/runs/queries/activity-export.js";
import { ActivityPopulationSelectionSchema, ActivityPopulationSelectedReadSchema } from "../../../../../src/models/dashboard/activity-population.js";
import { ERROR_CATALOG } from "../../../../../src/models/failures/error-catalog.js";
import { ActivityReportSelectionSchema } from "../../../../../src/models/dashboard/activity-selection.js";
import { activityReportCaveats } from "../../../../../src/models/dashboard/activity.js";
import { DAY } from "../../../../support/helpers/backend/dashboard-harness.js";

describe("BFF spine flow (start plan -> kernel -> spans -> projection)", () => {

  it("serves the Activity report over a NAMED range and refuses one the caller never named", async () => {
    const h = await harness();
    const planResponse = await json(await h.app.request("/api/v1/start-plans", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({ workflowId: "fixture-graph", submissions: [{ eid: "10873698", mode: "read-only" }], dryRun: false }),
    }));
    await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        commandId: "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b7e",
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "local-operator",
        source: "start-run",
        family: "start",
        type: "start-run",
        target: {
          workflowId: "fixture-graph",
          startPlanId: planResponse.startPlanId,
          expectedVersion: planResponse.expectedVersion,
        },
        payload: planResponse.fingerprints,
      }),
    });

    const report = ActivityReportSelectionSchema.parse(
      await (await h.app.request(`/api/v1/reports/activity?from=${DAY}&to=${DAY}`)).json(),
    );
    // The report is the SAME projection the day payload is served from, so the
    // route cannot hand back a total the dashboard would disagree with.
    const day = await json(await h.app.request(`/api/v1/dashboard?day=${DAY}`));
    assert.equal(report.totalRuns, (day.queueSurfaces as unknown[]).length);
    assert.deepEqual(report.days, [{ day: DAY, runs: 1 }]);
    assert.deepEqual(report.workflows, [{
      workflowId: "fixture-graph",
      registration: { state: "registered", label: "Fixture Graph", code: "fx", categoryId: "operations" },
      runs: 1,
      completion: { readBack: 0, warnings: 0, warningsUnknown: 0 },
      failed: 0, cancelled: 0, partial: 0, open: 1,
    }]);
    assert.equal(report.terminalRuns, 0);
    assert.equal(report.durations.medianMs.state, "absent");

    const halfRange = await h.app.request(`/api/v1/reports/activity?from=${DAY}`);
    assert.equal(halfRange.ok, false);
    assert.match(String((await json(halfRange)).message), /requires both from= and to=/);

    const noRange = await h.app.request("/api/v1/reports/activity");
    assert.equal(noRange.ok, false);
    assert.match(String((await json(noRange)).message), /requires both from= and to=/);

    // A malformed bound is refused by the wire schema, by name.
    const badBound = await h.app.request(`/api/v1/reports/activity?from=today&to=${DAY}`);
    assert.equal(badBound.status, 400);
    assert.equal((await json(badBound)).code, "SCHEMA_INVALID");

    // An inverted range never returns an empty report that reads as "no work".
    const inverted = await h.app.request(`/api/v1/reports/activity?from=${DAY}&to=2026-08-01`);
    assert.equal(inverted.ok, false);
    assert.match(String((await json(inverted)).message), /ends before it starts/);
  });

  it("serves the Activity report as a CSV that carries its own caveats", async () => {
    const h = await harness();
    const activityReport = ActivityReportSelectionSchema.parse(
      await (await h.app.request(`/api/v1/reports/activity?from=${DAY}&to=${DAY}`)).json(),
    );
    const report = h.projection.buildActivityReportWire(DAY, DAY);

    const response = await h.app.request(`/api/v1/reports/activity.csv?from=${DAY}&to=${DAY}&snapshot=${activityReport.snapshot.token}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/csv; charset=utf-8");
    assert.equal(
      response.headers.get("content-disposition"),
      `attachment; filename="activity-${DAY}_${DAY}.csv"`,
    );
    const csv = await response.text();
    // The bytes are the builder's, so the route cannot serve a second rendering.
    assert.equal(csv, activityReportCsv(report));
    // Every rule the panel shows behind its ⓘ is IN the file, verbatim.
    for (const caveat of activityReportCaveats(report)) {
      assert.ok(csv.includes(caveat.includes(",") ? `"${caveat}"` : caveat), `the export carries: ${caveat}`);
    }
    assert.ok(csv.includes(`Window from,${DAY}`));
    assert.ok(csv.includes("Write ledger — what was actually filed"));

    const halfRange = await h.app.request(`/api/v1/reports/activity.csv?from=${DAY}&snapshot=${activityReport.snapshot.token}`);
    assert.equal(halfRange.ok, false);
    assert.match(String((await json(halfRange)).message), /requires both from= and to=/);

    const noRange = await h.app.request("/api/v1/reports/activity.csv");
    assert.equal(noRange.ok, false);
    assert.match(String((await json(noRange)).message), /requires both from= and to=/);

    const inverted = await h.app.request(`/api/v1/reports/activity.csv?from=${DAY}&to=2026-08-01&snapshot=${activityReport.snapshot.token}`);
    assert.equal(inverted.ok, false);
    assert.match(String((await json(inverted)).message), /ends before it starts/);
  });


});

import { OPERATOR_JSON_HEADERS, disposeHttpRouteHarness, harness, json } from "../../../../support/helpers/backend/http-route-harness.js";
afterEach(disposeHttpRouteHarness);

it("serves selected population reads and maps malformed, foreign and stale selections to catalog refusals", async () => {
  const h = await harness();
  const path = "/api/v1/reports/activity/population";
  const range = { from: DAY, to: DAY };
  const selected = ActivityPopulationSelectionSchema.parse(await (await h.app.request(`${path}?${new URLSearchParams(range)}`)).json());
  const query = { ...range, snapshot: selected.snapshot.token };
  const read = await h.app.request(`${path}/selected?${new URLSearchParams(query)}`);
  assert.equal(read.status, 200);
  assert.deepEqual(ActivityPopulationSelectedReadSchema.parse(await read.json()), { selection: selected, browse: null });
  const foreign = await harness();
  const cases = [
    [h.app, `${path}?from=${DAY}`, "ACTIVITY_POPULATION_RANGE_INVALID", 400],
    [h.app, `${path}?from=${DAY}&from=${DAY}&to=${DAY}`, "ACTIVITY_POPULATION_RANGE_INVALID", 400],
    [h.app, `${path}?${new URLSearchParams({ ...range, extra: "x" })}`, "ACTIVITY_POPULATION_RANGE_INVALID", 400],
    [h.app, `${path}/selected?${new URLSearchParams({ ...query, browse: "{" })}`, "ACTIVITY_POPULATION_BROWSE_INVALID", 400],
    [h.app, `${path}/selected?${new URLSearchParams({ ...query, browse: JSON.stringify({ metric: "completed", page: -1 }) })}`, "ACTIVITY_POPULATION_BROWSE_INVALID", 400],
    [h.app, `${path}/selected?${new URLSearchParams({ ...query, snapshot: selected.report.snapshot.token })}`, "ACTIVITY_SNAPSHOT_INVALID_OR_EXPIRED", 409],
    [foreign.app, `${path}/selected?${new URLSearchParams(query)}`, "ACTIVITY_SNAPSHOT_INVALID_OR_EXPIRED", 409],
    [h.app, `${path}.csv?${new URLSearchParams({ ...query, to: "2026-09-10" })}`, "ACTIVITY_SNAPSHOT_STALE_OR_SELECTION_MISMATCH", 409],
  ] as const;
  for (const [app, url, code, status] of cases) {
    const response = await app.request(url);
    assert.equal(response.status, status, url);
    const failure = await json(response);
    assert.equal(failure.code, code);
    assert.equal(failure.message, ERROR_CATALOG[code].text);
  }
});

it("logs the original population read failure privately and serves only catalog text", async () => {
  const h = await harness();
  const detail = "activity-query-unavailable-detail";
  const spy = vi.spyOn(h.database, "withAuthorityReadSnapshot").mockImplementation(() => { throw new Error(detail); });
  let response: Response;
  try { response = await h.app.request(`/api/v1/reports/activity/population?from=${DAY}&to=${DAY}`); }
  finally { spy.mockRestore(); }
  assert.equal(response.status, 500);
  const body = await json(response);
  assert.equal(body.code, "DASHBOARD_READ_FAILED");
  assert.equal(body.message, ERROR_CATALOG.DASHBOARD_READ_FAILED.text);
  assert.equal(JSON.stringify(body).includes(detail), false);
  const events = h.database.authority.timelineEvents.page({ limit: 500 });
  const diagnostic = events.find(row => row.payload.kind === "debug" && row.payload.event.code === "DASHBOARD_READ_FAILED");
  assert.ok(diagnostic);
  assert.equal(diagnostic.payload.kind, "debug");
  if (diagnostic.payload.kind !== "debug") throw new Error("debug event expected");
  assert.equal(diagnostic.payload.event.message, detail);
  assert.ok(diagnostic.payload.event.stack?.includes(detail));
});
