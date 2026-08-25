/**
 * The ONE typed client (ref frontend-backend-integration §0.2): schema-parsed queries, normalized
 * errors, day-state patch application, and the resumable subscription's
 * protocol behavior — resume with Last-Event-ID, cursor-gap resnapshot,
 * reset-required, and a malformed envelope stopping loudly.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  applyDashboardDayPatch,
  createDashboardClient,
  DashboardClientError,
  type SubscriptionState,
} from "../../../src/dashboard/client/index.js";
import { DashboardDayWireSchema, type DashboardDayWire } from "../../../src/domain/dashboard/projection.js";
import type { DashboardDayPatch } from "../../../src/dashboard/client/day-state.js";

const DAY = "2026-08-03";
const HASH_D = "d".repeat(64);
const RUN_ID = "3b8f0a1e-2c4d-4e6f-8a9b-0c1d2e3f4a5b";

function surfaceOf(rowRevision: number, status = "queued"): Record<string, unknown> {
  return {
    surfaceKind: "single",
    runId: RUN_ID,
    itemId: "9c8b7a6d-5e4f-43a2-9b8c-7d6e5f4a3b2c",
    workflowId: "person-lookup",
    traceId: "pl-104233-3b8f",
    attempt: 1,
    lineage: { state: "root" },
    actorId: "local-operator",
    appVersion: { state: "present", value: "0.1.0" },
    descriptorVersion: 1,
    descriptorHash: HASH_D,
    configFingerprint: HASH_D,
    resolvedInstances: [{ system: "ucpath", instance: "prod" }],
    dryRun: false,
  priority: "interactive",
  runNumber: { state: "present", value: 1 },
  session: { state: "absent", reason: "fixture row predates run sessions (D269)" },
  containment: "root",
  linkedRuns: [],
  facts: { state: "absent", reason: "run is running and has not produced a terminal result" },
    startedAt: "2026-08-03T17:00:00.000Z",
    updatedAt: "2026-08-03T17:00:00.000Z",
    endedAt: { state: "absent", reason: "run is running" },
    gateOpenedAt: { state: "absent", reason: "no gate has opened on this run" },
    displayName: { state: "absent", reason: "the operator has not renamed this run" },
    title: "EID 10873698",
    subtitle: { state: "absent", reason: "none planned" },
    status,
    liveMessage: { state: "absent", reason: "no producer authors a live progress sentence on this wire" },
    warnings: { state: "absent", reason: "this run has produced no terminal result" },
    pipeline: [],
    panelKind: "run",
    availableSections: ["logs"],
    // No served controls: this fixture exercises patch application, not the
    // action projection, and an empty list is a real answer on the wire.
    actions: [],
    rowRevision,
  };
}

function dayOf(surfaces: readonly Record<string, unknown>[]): DashboardDayWire {
  return DashboardDayWireSchema.parse({
    day: DAY,
    descriptorHash: HASH_D,
    projectionGeneration: 7,
    snapshotCursor: "pc:1",
    monthCounts: [{ day: DAY, count: surfaces.length }],
    workflowCounts: surfaces.length === 0
      ? []
      : [{ workflowId: "person-lookup", count: surfaces.length, statusCounts: [{ status: "queued", count: surfaces.length }] }],
    statusCounts: surfaces.length === 0 ? [] : [{ status: "queued", count: surfaces.length }],
    queueSurfaces: surfaces,
    workerCards: [],
    workerPools: [],
    notifications: [],
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("day-state patch application (D81: apply, never derive)", () => {
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
