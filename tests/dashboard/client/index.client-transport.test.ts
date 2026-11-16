import { zeroMatchSearchPage } from "../../support/helpers/dashboard/search-page-fixtures.js";
import { createClientDayFixtures } from "../../support/helpers/dashboard/client-day-fixtures.js";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe,it } from "vitest";
import { applyDashboardDayPatch,createDashboardClient,DashboardClientError,type SubscriptionState } from "../../../src/dashboard/client/index.js";

import type { DashboardDayPatch } from "../../../src/dashboard/client/queries/day-state.js";
import { type DashboardDayWire } from "../../../src/models/dashboard/projection.js";

const DAY = "2026-08-03";
const HASH_D = "d".repeat(64);
const RUN_ID = "3b8f0a1e-2c4d-4e6f-8a9b-0c1d2e3f4a5b";

const { surfaceOf: surfaceInput, dayOf: dayInput } = createClientDayFixtures(DAY, HASH_D);

function surfaceOf(rowRevision: number, status = "queued"): Record<string, unknown> {
  return surfaceInput(RUN_ID, rowRevision, "EID 10873698", status);
}

function dayOf(surfaces: readonly Record<string, unknown>[]): DashboardDayWire {
  return dayInput(surfaces, "pc:1");
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function measuredSearchPage(resultPatch: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return {
    wireVersion: 1,
    generatedAt: "2026-08-28T16:00:00.000Z",
    snapshot: {
      authorityGeneration: 19,
      order: "match-strength/enqueued-desc/run-id-asc:v2",
      token: "test-snapshot-token",
    },
    totalMatches: 1,
    coverage:{matched:1,subjectUnavailable:1,actorUnavailable:1,candidateLimit:10000},
    results: [{
      runId: RUN_ID,
      traceId: "sp-160000-3b8f",
      workflowId: "separations",
      registration: {
        state: "registered",
        label: "Separations",
        code: "sp",
        categoryId: "separation",
      },
      partitionDay: "2026-08-28",
      state: "parked-gate",
      shape: "single",
      dryRun: true,
      priority: "interactive",
      systems: ["kuali", "new-kronos", "ucpath"],
      runNumber: { state: "absent", reason: "No run number is recorded for this fixture." },
      retryOf: { state: "absent", reason: "this run is not a retry" },
      enqueuedAt: "2026-08-28T16:00:00.000Z",
      endedAt: { state: "absent", reason: `run ${RUN_ID} is parked-gate, not terminal` },
      metadata:{subject:{state:"unavailable",reason:"declaration-unavailable"},actor:{state:"unavailable",reason:"not-recorded"},version:1,failureCode:null,evidence:{receipt:false,failure:false,diagnostic:false}},
      match: { field: "workflow", strength: "exact" },
      ...resultPatch,
    }],
    nextCursor: { state: "absent", reason: "the snapshot has no later matching run" },
  };
}

describe("day-state patch application", () => {
  it("replaces by identity, keeps counts untouched, and dedupes stale revisions", () => {
    const day = dayOf([surfaceOf(2)]);
    const replaced = applyDashboardDayPatch(day, {
      operation: "replace-queue-surface",
      target: { runId: RUN_ID, rowRevision: 3 },
      replacement: surfaceOf(3),
    } as unknown as DashboardDayPatch);
    assert.equal(replaced.queueSurfaces[0].rowRevision, 3);
    assert.deepEqual(replaced.workflowCounts, day.workflowCounts);

    const stale = applyDashboardDayPatch(replaced, {
      operation: "replace-queue-surface",
      target: { runId: RUN_ID, rowRevision: 2 },
      replacement: surfaceOf(2),
    } as unknown as DashboardDayPatch);
    assert.equal(stale.queueSurfaces[0].rowRevision, 3);
  });

  it("treats a patch for an unheld run as a protocol failure, never an insert", () => {
    const empty = dayOf([]);
    assert.throws(
      () => applyDashboardDayPatch(empty, {
        operation: "replace-queue-surface",
        target: { runId: RUN_ID, rowRevision: 1 },
        replacement: surfaceOf(1),
      } as unknown as DashboardDayPatch),
      (error: unknown) => error instanceof DashboardClientError && error.kind === "protocol",
    );
  });
});

describe("typed queries and error normalization", () => {
  it("posts a strict XLSX selection and returns its evidenced attachment headers with bytes", async () => {
    const workbookBytes = Uint8Array.from([0x50, 0x4b, 0x03, 0x04]);
    const digest = createHash("sha256").update(workbookBytes).digest("hex");
    let method = "";
    let body = "";
    const client = createDashboardClient({
      baseUrl: "http://bff.test",
      fetchImpl: (_input, init) => {
        method = init?.method ?? "GET";
        if (typeof init?.body !== "string") throw new Error("XLSX request body must be JSON text");
        body = init.body;
        return Promise.resolve(new Response(workbookBytes, {
          status: 200,
          headers: {
            "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "content-disposition": "attachment; filename=\"hr-activity-2026-08-01_2026-08-28.xlsx\"",
            "content-length": String(workbookBytes.byteLength),
            etag: `"${digest}"`,
            "x-operator-export-id": "00020002-0002-4002-8002-000200020002",
            "x-selection-digest":createHash("sha256").update("as1.test.token").digest("hex"),
          },
        }));
      },
    });

    const download = await client.exportXlsx({
      requestVersion:3, selection: { kind: "activity", from: "2026-08-01", to: "2026-08-28", snapshotToken:"as1.test.token" },
    });

    assert.equal(method, "POST");
    assert.deepEqual(JSON.parse(body), {
      requestVersion:3, selection: { kind: "activity", from: "2026-08-01", to: "2026-08-28", snapshotToken:"as1.test.token" },
    });
    assert.equal(download.filename, "hr-activity-2026-08-01_2026-08-28.xlsx");
    assert.equal(download.sha256, digest);
    assert.deepEqual(new Uint8Array(download.bytes), workbookBytes);
  });

  it("encodes and parses the strict cross-date search contract", async () => {
    let requested = "";
    const queryText = "x".repeat(160);
    const client = createDashboardClient({
      baseUrl: "http://bff.test",
      fetchImpl: (input) => {
        requested = String(input);
        return Promise.resolve(jsonResponse(200, zeroMatchSearchPage()));
      },
    });

    const page = await client.searchRuns({
      q: queryText,
      scope: "workflow",
      facets: { day: "2026-08-28", dryRun: true, system: "ucpath" },
      limit: 50,
    });

    assert.equal(page.totalMatches, 0);
    assert.match(requested, /\/api\/v1\/search\?/);
    assert.equal(new URL(requested).searchParams.get("q"), queryText);
    assert.match(requested, /day=2026-08-28/);
    assert.match(requested, /dryRun=true/);
    assert.match(requested, /limit=50/);
  });

  it("rejects malformed and unknown cross-date search response bodies", async () => {
    const validPage = zeroMatchSearchPage();
    const bodies = [
      { wireVersion: 1 },
      { ...validPage, unknownAuthorityFact: true },
    ];
    let call = 0;
    const client = createDashboardClient({
      baseUrl: "http://bff.test",
      fetchImpl: () => Promise.resolve(jsonResponse(200, bodies[call++])),
    });

    for (let index = 0; index < bodies.length; index += 1) {
      await assert.rejects(
        client.searchRuns({ q: "person-lookup" }),
        (error: unknown) => error instanceof DashboardClientError && error.kind === "schema",
      );
    }
  });

  it("accepts a non-empty page from the measured search corpus", async () => {
    const client = createDashboardClient({
      baseUrl: "http://bff.test",
      fetchImpl: () => Promise.resolve(jsonResponse(200, measuredSearchPage({}))),
    });

    const page = await client.searchRuns({ q: "separations" });

    assert.deepEqual(page.results[0]?.registration, {
      state: "registered",
      label: "Separations",
      code: "sp",
      categoryId: "separation",
    });
  });

  it("accepts expanded typed metadata and still rejects malformed dimensions", async () => {
    const foreignResults = [
      { workflowId: "person-lookup" },
      {
        registration: {
          state: "registered",
          label: "Person lookup",
          code: "pl",
          categoryId: "search",
        },
      },
      { state: "queued" },
      { shape: "preview" },
      { dryRun: false },
      { systems: ["ucpath"] },
      { systems: ["crm", "kuali", "new-kronos", "ucpath"] },
    ];

    for (const result of foreignResults) {
      const client=createDashboardClient({baseUrl:"http://bff.test",fetchImpl:()=>Promise.resolve(jsonResponse(200,measuredSearchPage(result)))});
      assert.equal((await client.searchRuns({q:"separations"})).results.length,1);
    }
    for(const result of [{workflowId:""},{registration:{state:"guessed"}},{state:"invented"},{shape:"batch"},{dryRun:"false"},{systems:["unknown"]},{metadata:{subject:"raw"}}]) {
      const client=createDashboardClient({baseUrl:"http://bff.test",fetchImpl:()=>Promise.resolve(jsonResponse(200,measuredSearchPage(result)))});
      await assert.rejects(client.searchRuns({q:"separations"}),(error:unknown)=>error instanceof DashboardClientError&&error.kind==="schema");
    }
  });

  it("refuses an invalid cross-date search query before sending it", async () => {
    let requests = 0;
    const client = createDashboardClient({
      baseUrl: "http://bff.test",
      fetchImpl: () => {
        requests += 1;
        return Promise.resolve(jsonResponse(200, {}));
      },
    });

    const queryWithUnmeasuredPriority = {
      q: "separations",
      facets: { day: "2026-08-28", priority: "interactive" },
    };
    await assert.rejects(client.searchRuns({ q: "x".repeat(161) }));
    await assert.rejects(client.searchRuns(queryWithUnmeasuredPriority));
    assert.equal(requests, 0);
  });

  it("parses a valid day and rejects a contract-violating body as a schema error", async () => {
    const valid = dayOf([surfaceOf(1)]);
    let call = 0;
    const client = createDashboardClient({
      baseUrl: "http://bff.test",
      fetchImpl: () => {
        call += 1;
        return Promise.resolve(jsonResponse(200, call === 1 ? valid : { ...valid, queueSurfaces: [{ bogus: true }] }));
      },
    });
    const day = await client.dashboardDay(DAY);
    assert.equal(day.queueSurfaces.length, 1);
    await assert.rejects(
      client.dashboardDay(DAY),
      (error: unknown) => error instanceof DashboardClientError && error.kind === "schema",
    );
  });

  it("carries the server's typed wire error through as an http error", async () => {
    const client = createDashboardClient({
      baseUrl: "http://bff.test",
      fetchImpl: () => Promise.resolve(jsonResponse(404, {
        state: "error", code: "TARGET_NOT_FOUND", message: "run x does not exist", retryable: false,
      })),
    });
    await assert.rejects(
      client.runDetail(RUN_ID),
      (error: unknown) => error instanceof DashboardClientError
        && error.kind === "http" && error.status === 404 && error.code === "TARGET_NOT_FOUND",
    );
  });

  it("normalizes transport failure as a retryable network error and validates requests before sending", async () => {
    const client = createDashboardClient({
      baseUrl: "http://bff.test",
      fetchImpl: () => Promise.reject(new Error("ECONNREFUSED")),
    });
    await assert.rejects(
      client.bootstrap(),
      (error: unknown) => error instanceof DashboardClientError && error.kind === "network" && error.retryable,
    );
    // A malformed command never leaves the client.
    await assert.rejects(client.executeCommand({ family: "start" }), /invalid/i);
  });

  it("sends command mutations with the exact transport Origin and JSON media type", async () => {
    let sentHeaders: Headers | undefined;
    const commandId = "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b76";
    const client = createDashboardClient({
      baseUrl: "http://127.0.0.1:3938",
      fetchImpl: (_url, init) => {
        sentHeaders = new Headers(init?.headers);
        return Promise.resolve(jsonResponse(200, {
          state: "applied",
          commandId,
          affectedTargets: [{ family: "run", runId: RUN_ID }],
        }));
      },
    });

    await client.executeCommand({
      commandId,
      requestedAt: "2026-08-28T12:00:00.000Z",
      requestedBy: "local-operator",
      source: "dashboard",
      family: "run",
      type: "cancel",
      target: { runId: RUN_ID, expectedVersion: 1 },
    });

    assert.equal(sentHeaders?.get("origin"), "http://127.0.0.1:3938");
    assert.equal(sentHeaders?.get("content-type"), "application/json");
  });

  it("attaches the transport Origin to every guarded mutation door and to no GET", async () => {
    const sent: { path: string; method: string; origin: string | null; contentType: string | null }[] = [];
    const client = createDashboardClient({
      baseUrl: "http://127.0.0.1:3938",
      fetchImpl: (url, init) => {
        const headers = new Headers(init?.headers);
        sent.push({
          path: new URL(url).pathname,
          method: init?.method ?? "GET",
          origin: headers.get("origin"),
          contentType: headers.get("content-type"),
        });
        // Every door answers a body the caller rejects at parse time; the
        // request headers are the subject here, so the refusal is expected.
        return Promise.resolve(jsonResponse(500, { state: "error", code: "FIXTURE", message: "fixture", retryable: false }));
      },
    });

    await assert.rejects(client.submitStartPlan({ workflowId: "x", submissions: [{}], dryRun: true, browserMode: "headless", captureBrowserScreenshots: false }));
    await assert.rejects(client.uploadIntakeFile({
      workflowId: "x", fileName: "roster.csv", mediaType: "text/csv", bytes: new Uint8Array([1, 2, 3]).buffer,
    }));
    await assert.rejects(client.exportXlsx({ requestVersion:3, selection: { kind: "activity", from: "2026-08-01", to: "2026-08-28", snapshotToken:"as1.test.token" } }));
    await assert.rejects(client.bootstrap());

    assert.deepEqual(sent, [
      { path: "/api/v1/start-plans", method: "POST", origin: "http://127.0.0.1:3938", contentType: "application/json" },
      { path: "/api/v1/intake/files", method: "POST", origin: "http://127.0.0.1:3938", contentType: "text/csv" },
      { path: "/api/v1/exports/xlsx", method: "POST", origin: "http://127.0.0.1:3938", contentType: "application/json" },
      { path: "/api/v1/bootstrap", method: "GET", origin: null, contentType: null },
    ]);
  });

  it.each([
    [403, "OPERATOR_MUTATION_ORIGIN_REFUSED"],
    [415, "OPERATOR_MUTATION_MEDIA_TYPE_REFUSED"],
  ] as const)("surfaces an operator-ingress %i command refusal as an HTTP error", async (status, code) => {
    const client = createDashboardClient({
      baseUrl: "http://127.0.0.1:3938",
      fetchImpl: () => Promise.resolve(jsonResponse(status, {
        state: "error",
        code,
        message: "the command request was refused before command parsing",
        retryable: false,
      })),
    });

    await assert.rejects(
      client.executeCommand({
        commandId: "8d7c6b5a-4938-4271-806f-1e2d3c4b5a69",
        requestedAt: "2026-08-28T12:00:00.000Z",
        requestedBy: "local-operator",
        source: "dashboard",
        family: "run",
        type: "cancel",
        target: { runId: RUN_ID, expectedVersion: 1 },
      }),
      (error: unknown) => error instanceof DashboardClientError
        && error.kind === "http"
        && error.status === status
        && error.code === code,
    );
  });

  it("parses only the command route's declared non-success result statuses", async () => {
    const commandId = "7c6b5a49-3827-4160-9f1e-2d3c4b5a6978";
    let call = 0;
    const client = createDashboardClient({
      baseUrl: "http://127.0.0.1:3938",
      fetchImpl: () => {
        call += 1;
        return Promise.resolve(call === 1
          ? jsonResponse(409, {
            state: "conflict",
            commandId,
            currentVersion: 2,
            message: "the run revision advanced",
          })
          : jsonResponse(422, {
            state: "refused",
            code: "schema-mismatch",
            message: "the bulk envelope is invalid",
          }));
      },
    });

    const conflict = await client.executeCommand({
      commandId,
      requestedAt: "2026-08-28T12:00:00.000Z",
      requestedBy: "local-operator",
      source: "dashboard",
      family: "run",
      type: "cancel",
      target: { runId: RUN_ID, expectedVersion: 1 },
    });
    assert.equal(conflict.state, "conflict");

    const refused = await client.executeBulkCommand({
      commandId: "6b5a4938-2716-405f-8e2d-3c4b5a697887",
      bulkCommandId: "6b5a4938-2716-405f-8e2d-3c4b5a697887",
      requestedAt: "2026-08-28T12:00:00.000Z",
      requestedBy: "local-operator",
      source: "dashboard",
      family: "run",
      type: "cancel",
      targets: [{ runId: RUN_ID, expectedVersion: 1 }],
      mode: "best-effort",
    });
    assert.equal(refused.state, "refused");
  });

  it("keeps bulk 409 as an HTTP error even with a valid bulk result body", async () => {
    let status = 200;
    const body = { state: "refused", code: "schema-mismatch", message: "the bulk envelope is invalid" };
    const client = createDashboardClient({
      baseUrl: "http://127.0.0.1:3938",
      fetchImpl: () => Promise.resolve(jsonResponse(status, body)),
    });
    const request = {
      commandId: "6b5a4938-2716-405f-8e2d-3c4b5a697887",
      bulkCommandId: "6b5a4938-2716-405f-8e2d-3c4b5a697887",
      requestedAt: "2026-08-28T12:00:00.000Z",
      requestedBy: "local-operator",
      source: "dashboard",
      family: "run",
      type: "cancel",
      targets: [{ runId: RUN_ID, expectedVersion: 1 }],
      mode: "best-effort",
    };
    assert.deepEqual(await client.executeBulkCommand(request), body);

    status = 409;

    await assert.rejects(
      client.executeBulkCommand(request),
      (error: unknown) => error instanceof DashboardClientError
        && error.kind === "http" && error.status === 409,
    );
  });

  it.each([409, 422])("keeps non-command %i as an HTTP error even with a valid query body", async (refusalStatus) => {
    let status = 200;
    const body = dayOf([surfaceOf(1)]);
    const client = createDashboardClient({
      baseUrl: "http://127.0.0.1:3938",
      fetchImpl: () => Promise.resolve(jsonResponse(status, body)),
    });
    assert.deepEqual(await client.dashboardDay(DAY), body);

    status = refusalStatus;

    await assert.rejects(
      client.dashboardDay(DAY),
      (error: unknown) => error instanceof DashboardClientError
        && error.kind === "http" && error.status === refusalStatus,
    );
  });

  it("keeps undeclared command 500 as an HTTP error even with a valid command result body", async () => {
    let status = 200;
    const commandId = "7c6b5a49-3827-4160-9f1e-2d3c4b5a6978";
    const body = { state: "applied", commandId, affectedTargets: [{ family: "run", runId: RUN_ID }] };
    const client = createDashboardClient({
      baseUrl: "http://127.0.0.1:3938",
      fetchImpl: () => Promise.resolve(jsonResponse(status, body)),
    });
    const request = {
      commandId,
      requestedAt: "2026-08-28T12:00:00.000Z",
      requestedBy: "local-operator",
      source: "dashboard",
      family: "run",
      type: "cancel",
      target: { runId: RUN_ID, expectedVersion: 1 },
    };
    assert.deepEqual(await client.executeCommand(request), body);

    status = 500;

    await assert.rejects(
      client.executeCommand(request),
      (error: unknown) => error instanceof DashboardClientError
        && error.kind === "http" && error.status === 500,
    );
  });
});

/* ── subscription protocol over a scripted SSE transport ─────────────────── */

interface ScriptedStream {
  push(envelope: Record<string, unknown>, id?: string): void;
  fail(): void;
  readonly lastEventId: string | undefined;
  readonly lastProjectionGeneration: string | undefined;
}

function scriptedFetch(): {
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>;
  streams: ScriptedStream[];
} {
  const streams: ScriptedStream[] = [];
  const fetchImpl = (input: string, init?: RequestInit): Promise<Response> => {
    void input;
    const headers = new Headers(init?.headers);
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c): void {
        controller = c;
      },
    });
    const stream: ScriptedStream = {
      lastEventId: headers.get("last-event-id") ?? undefined,
      lastProjectionGeneration: headers.get("dashboard-projection-generation") ?? undefined,
      push: (envelope, id) => {
        const idLine = id === undefined ? "" : `id: ${id}\n`;
        controller.enqueue(encoder.encode(`${idLine}data: ${JSON.stringify(envelope)}\n\n`));
      },
      fail: () => controller.error(new Error("connection dropped")),
    };
    streams.push(stream);
    return Promise.resolve(new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }));
  };
  return { fetchImpl, streams };
}

function hello(cursor: string): Record<string, unknown> {
  return { type: "hello", wireVersion: 1, descriptorHash: HASH_D, projectionGeneration: 7, cursor };
}

function snapshotEnvelope(cursor: string, surfaces: readonly Record<string, unknown>[]): Record<string, unknown> {
  return { type: "snapshot", topic: "dashboard-day", cursor, payload: { ...dayOf(surfaces), snapshotCursor: cursor } };
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("resumable subscription protocol", () => {
  it("applies snapshot then count-neutral patches, and resumes with Last-Event-ID after a drop", async () => {
    const { fetchImpl, streams } = scriptedFetch();
    const client = createDashboardClient({ baseUrl: "http://bff.test", fetchImpl });
    const days: DashboardDayWire[] = [];
    const states: SubscriptionState[] = [];
    const subscription = client.subscribeDay({
      day: DAY,
      onDay: (day) => days.push(day),
      onState: (state) => states.push(state),
      schedule: (_delay, run) => {
        run();
        return () => undefined;
      },
    });
    await tick();
    streams[0].push(hello("pc:1"), "pc:1");
    streams[0].push(snapshotEnvelope("pc:1", [surfaceOf(1)]), "pc:1");
    streams[0].push({ type: "health", state: "live" });
    streams[0].push({
      type: "patch", topic: "dashboard-day", cursor: "pc:2",
      payload: { operation: "replace-queue-surface", target: { runId: RUN_ID, rowRevision: 2 }, replacement: surfaceOf(2) },
    }, "pc:2");
    await tick();
    assert.equal(days.length, 2);
    assert.equal(days[1].queueSurfaces[0].rowRevision, 2);

    streams[0].fail();
    await tick();
    await tick();
    assert.equal(streams.length, 2);
    assert.equal(streams[1].lastEventId, "pc:2");
    assert.equal(streams[1].lastProjectionGeneration, "7");
    assert.equal(states.some(({ state }) => state === "reconnecting"), true);
    subscription.close();
  });

  it("forces a fresh snapshot on a cursor gap by reconnecting without Last-Event-ID", async () => {
    const { fetchImpl, streams } = scriptedFetch();
    const client = createDashboardClient({ baseUrl: "http://bff.test", fetchImpl });
    const subscription = client.subscribeDay({
      day: DAY,
      onDay: () => undefined,
      onState: () => undefined,
      schedule: (_delay, run) => {
        run();
        return () => undefined;
      },
    });
    await tick();
    streams[0].push(hello("pc:1"), "pc:1");
    streams[0].push(snapshotEnvelope("pc:1", []), "pc:1");
    // pc:5 with nothing between: a gap the client must not paper over.
    streams[0].push({
      type: "patch", topic: "dashboard-day", cursor: "pc:5",
      payload: { operation: "replace-queue-surface", target: { runId: RUN_ID, rowRevision: 1 }, replacement: surfaceOf(1) },
    }, "pc:5");
    await tick();
    await tick();
    assert.equal(streams.length, 2);
    assert.equal(streams[1].lastEventId, undefined);
    subscription.close();
  });

  it("clears state and resubscribes on reset-required", async () => {
    const { fetchImpl, streams } = scriptedFetch();
    const client = createDashboardClient({ baseUrl: "http://bff.test", fetchImpl });
    const subscription = client.subscribeDay({
      day: DAY,
      onDay: () => undefined,
      onState: () => undefined,
      schedule: (_delay, run) => {
        run();
        return () => undefined;
      },
    });
    await tick();
    streams[0].push(hello("pc:1"), "pc:1");
    streams[0].push(snapshotEnvelope("pc:1", []), "pc:1");
    streams[0].push({ type: "reset-required", reason: "generation-changed", cursor: "pc:2" }, "pc:2");
    await tick();
    await tick();
    assert.equal(streams.length, 2);
    assert.equal(streams[1].lastEventId, undefined);
    subscription.close();
  });

  it("stops loudly on a malformed envelope instead of ignoring it", async () => {
    const { fetchImpl, streams } = scriptedFetch();
    const client = createDashboardClient({ baseUrl: "http://bff.test", fetchImpl });
    const states: SubscriptionState[] = [];
    client.subscribeDay({
      day: DAY,
      onDay: () => undefined,
      onState: (state) => states.push(state),
      schedule: (_delay, run) => {
        run();
        return () => undefined;
      },
    });
    await tick();
    streams[0].push({ type: "mystery-envelope" });
    await tick();
    const last = states.at(-1);
    assert.equal(last?.state, "stopped");
    if (last?.state !== "stopped") assert.fail("expected stopped");
    assert.equal(last.error?.kind, "protocol");
  });
});


describe("command response identity", () => {
  it.each(["commandId", "affectedTargets"])("refuses a valid single reply with wrong %s", async field => {
    const commandId = "11111111-1111-4111-8111-111111111111";
    const reply = { state: "applied", commandId: field === "commandId" ? "22222222-2222-4222-8222-222222222222" : commandId,
      affectedTargets: [{ family: "run", runId: field === "affectedTargets" ? "33333333-3333-4333-8333-333333333333" : RUN_ID }] };
    const client = createDashboardClient({ baseUrl: "http://bff.test", fetchImpl: async () => Response.json(reply) });
    await assert.rejects(client.executeCommand({ commandId, requestedAt: "2026-08-03T12:00:00.000Z", requestedBy: "local-operator",
      source: "dashboard", family: "run", type: "bump", target: { runId: RUN_ID, expectedVersion: 1 } }),
      (error: unknown) => error instanceof DashboardClientError && error.code === "COMMAND_RESULT_IDENTITY_MISMATCH"
        && error.kind === "protocol" && JSON.stringify(error.cause) === JSON.stringify(reply));
  });
});
