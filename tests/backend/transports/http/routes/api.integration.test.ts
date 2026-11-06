
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it, vi } from "vitest";
import { readTimelineRecords } from "../../../../../src/backend/storage/events/timeline-reader.js";
import { RequestIdentityRefusedError } from "../../../../../src/backend/runs/commands/refusals.js";
import { DashboardClientDisconnectedError } from "../../../../../src/backend/transports/http/http-server.js";
import { UUID_4 } from "../../../../support/fixtures/phase1c-contract-fixtures.js";
import { personLookupQueuedRun } from "../../../../support/helpers/phase1f-executor-harness.js";

describe("BFF spine flow (start plan -> kernel -> spans -> projection)", () => {
  it("logs a run-detail 500 cause without retaining the thrown message or request values", async () => {
    const cause = new TypeError("Quillan, Petra; fictional private record");
    cause.stack = "TypeError: private record\n    at query (/private/project/src/backend/runs/queries/run-detail.ts:42:7)";
    const h = await harness();
    h.database.authority.runs.enqueue(personLookupQueuedRun({ runId: UUID_4 }));
    vi.spyOn(h.projection, "runFold").mockImplementation(() => { throw cause; });
    const response = await h.app.request(`/api/v1/runs/${UUID_4}`);
    assert.equal(response.status, 500);
    assert.equal((await json(response)).code, "INTERNAL_FAILURE");
    const records = readTimelineRecords(h.database.authority.timelineEvents).records;
    const diagnostics = records.flatMap(record => record.payload.kind === "debug" && record.payload.event.reason === "request-cause" ? [record.payload.event] : []);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0]?.message, "TypeError");
    assert.equal(diagnostics[0]?.stack, "TypeError\n    at src/backend/runs/queries/run-detail.ts:42:7");
    assert.equal(diagnostics[0]?.status, 500);
    assert.equal(/Quillan|Petra|private record/u.test(JSON.stringify(diagnostics)), false);
  });

  it("records a client disconnect as cancellation without claiming a delivered 500", async () => {
    const h = await harness();
    h.database.authority.runs.enqueue(personLookupQueuedRun({ runId: UUID_4 }));
    const abort = new AbortController();
    vi.spyOn(h.projection, "runFold").mockImplementation(() => {
      const disconnected = new DashboardClientDisconnectedError("during response transfer");
      abort.abort(disconnected);
      throw new Error("aborted", { cause: disconnected });
    });
    await h.app.request(`/api/v1/runs/${UUID_4}`, { signal: abort.signal });
    const events = readTimelineRecords(h.database.authority.timelineEvents).records
      .flatMap(record => record.payload.kind === "debug" && record.payload.event.category === "http" ? [record.payload.event] : []);
    assert.deepEqual(events.filter(event => event.reason === "request-cause").map(event => [event.message, event.status]),
      [["Error", undefined], ["DashboardClientDisconnectedError", undefined]]);
    assert.deepEqual(events.filter(event => event.reason === "request-disconnected").map(event => [event.code, event.status]), [["INTERNAL_FAILURE", undefined]]);
    assert.equal(events.some(event => event.status !== undefined && event.status >= 500), false);
  });

  it("crosses one request-identity checkpoint on every registered route and refuses before effects", async () => {
    let checkpointCalls = 0;
    const h = await harness({
      requestIdentity: {
        identify: () => {
          checkpointCalls += 1;
          throw new RequestIdentityRefusedError("the request identity checkpoint refused this caller");
        },
      },
    });
    const beforeFault = faultAuthoritySnapshot(h);
    const materializePath = (path: string): string => path.replaceAll(/:[^/]+/gu, UUID_4);
    const routes = h.app.routes.filter((route) => route.method !== "ALL");

    assert.ok(routes.length > 0);
    for (const route of routes) {
      checkpointCalls = 0;
      const response = await h.app.request(materializePath(route.path), {
        method: route.method,
        ...(route.method === "GET" || route.method === "HEAD"
          ? {}
          : { headers: { "content-type": "application/json" }, body: "{}" }),
      });
      assert.equal(response.status, 403, `${route.method} ${route.path}`);
      assert.equal(checkpointCalls, 1, `${route.method} ${route.path}`);
      assert.equal((await json(response)).code, "REQUEST_IDENTITY_REFUSED");
    }

    checkpointCalls = 0;
    const unknownResponse = await h.app.request("/api/v1/not-registered");
    assert.equal(unknownResponse.status, 403);
    assert.equal(checkpointCalls, 1);
    assert.equal((await json(unknownResponse)).code, "REQUEST_IDENTITY_REFUSED");

    assertHttpFaultOnly(h, beforeFault, routes.length + 1);
    const artifactRoot = join(h.stateRoot, "artifacts");
    assert.deepEqual(existsSync(artifactRoot) ? readdirSync(artifactRoot) : [], []);
    const inspection = new DatabaseSync(join(h.stateRoot, "state.db"), { readOnly: true });
    try {
      const row = inspection.prepare("SELECT count(*) AS count FROM artifacts WHERE export_id IS NOT NULL").get();
      assert.equal(Reflect.get(row ?? {}, "count"), 0);
    } finally {
      inspection.close();
    }
  });


});

import { assertHttpFaultOnly, disposeHttpRouteHarness, faultAuthoritySnapshot, harness, json } from "../../../../support/helpers/backend/http-route-harness.js";
afterEach(disposeHttpRouteHarness);
