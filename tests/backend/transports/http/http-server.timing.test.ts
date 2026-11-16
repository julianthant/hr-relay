import type { getRequestListener, HttpBindings } from "@hono/node-server";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDebugEventWriter } from "../../../../src/backend/logs/debug-events.js";
import { startDashboardHttpServer, type DashboardHttpListener } from "../../../../src/backend/transports/http/http-server.js";
import type { DashboardApp } from "../../../../src/backend/transports/http/routes/api.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { debugTimelineFixture } from "../../../support/helpers/backend/debug-timeline-fixture.js";

const adapter = vi.hoisted(() => {
  let handler: Parameters<typeof getRequestListener>[0] | undefined;
  return {
    capture(value: Parameters<typeof getRequestListener>[0]) { handler = value; },
    async dispatch(request: Request, bindings: HttpBindings): Promise<Response> {
      if (handler === undefined) throw new Error("test HTTP adapter has no handler");
      const response = await handler(request, bindings);
      if (!(response instanceof Response)) throw new Error("test HTTP handler returned no response");
      bindings.outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      await response.body?.cancel();
      return response;
    },
  };
});

vi.mock("@hono/node-server", () => ({ getRequestListener: (handler: Parameters<typeof getRequestListener>[0]) => {
  adapter.capture(handler);
  return () => undefined;
} }));

vi.mock("node:http", async importOriginal => {
  const original = await importOriginal<typeof import("node:http")>();
  const { EventEmitter } = await import("node:events");
  class TestServer extends EventEmitter {
    listening = false;
    listen() { this.listening = true; queueMicrotask(() => this.emit("listening")); }
    address() { return { port: 12345 }; }
    close(callback: () => void) { this.listening = false; callback(); }
    closeAllConnections = vi.fn();
  }
  return { ...original, createServer: () => new TestServer() };
});

describe("dashboard HTTP request timing", () => {
  let server: DashboardHttpListener | undefined;

  beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] }); });
  afterEach(async () => {
    try { await server?.close(); }
    finally { server = undefined; vi.useRealTimers(); }
  });

  function transport() {
    const incoming = new IncomingMessage(new Socket());
    return { incoming, outgoing: new ServerResponse(incoming) };
  }

  it("records one slow response with the registered pattern and full transfer duration", async () => {
    const { records, repository } = debugTimelineFixture();
    const debugEvents = createDebugEventWriter({ repository, clock: systemClock, build: "test" });
    const app: DashboardApp = new Hono();
    app.use("*", async (_c, next) => { await next(); });
    app.get("/api/v1/runs/:runId", c => c.body(null, 200));
    app.all("*", c => c.body(null, 404));
    server = await startDashboardHttpServer({ app, port: 0, observation: { clock: systemClock, debugEvents } });
    const bindings = transport();
    await adapter.dispatch(new Request("http://localhost/api/v1/runs/PRIVATE_ID_CANARY?secret=PRIVATE_QUERY_CANARY"), bindings);
    expect(records).toEqual([]);
    vi.advanceTimersByTime(501);
    bindings.outgoing.emit("finish");
    bindings.outgoing.emit("finish");

    expect(records).toHaveLength(1);
    expect(records[0]?.payload).toMatchObject({ kind: "debug", event: {
      category: "http", reason: "slow-request", method: "GET", route: "/api/v1/runs/:runId", status: 200, durationMs: 501,
    } });
    expect(JSON.stringify(records)).not.toContain("CANARY");
  });

  it.each([
    [200, 0, false], [200, 499, false], [200, 500, false],
    [404, 10, false], [404, 501, true], [500, 1, true], [503, 800, true],
  ] as const)("status %i completing in %i ms records an event: %s", async (status, durationMs, recorded) => {
    const { records, repository } = debugTimelineFixture();
    const app: DashboardApp = new Hono();
    app.post("/api/v1/commands", () => new Response(null, { status }));
    server = await startDashboardHttpServer({ app, port: 0, observation: { clock: systemClock,
      debugEvents: createDebugEventWriter({ repository, clock: systemClock, build: "test" }) } });
    const bindings = transport();
    await adapter.dispatch(new Request("http://localhost/api/v1/commands", { method: "POST" }), bindings);
    vi.advanceTimersByTime(durationMs);
    bindings.outgoing.emit("finish");

    expect(records).toHaveLength(recorded ? 1 : 0);
    if (recorded) expect(records[0]?.payload).toMatchObject({ kind: "debug", event: {
      method: "POST", route: "/api/v1/commands", status, durationMs,
      reason: status >= 500 ? "request-failed" : "slow-request",
    } });
  });

  it("includes handler time and uses monotonic time across wall-clock changes", async () => {
    const { records, repository } = debugTimelineFixture();
    const app: DashboardApp = new Hono();
    app.get("/api/v1/runs/:runId", async c => {
      await new Promise(resolve => setTimeout(resolve, 300));
      return c.body(null, 200);
    });
    server = await startDashboardHttpServer({ app, port: 0, observation: { clock: systemClock,
      debugEvents: createDebugEventWriter({ repository, clock: systemClock, build: "test" }) } });
    const bindings = transport();
    const response = adapter.dispatch(new Request("http://localhost/api/v1/runs/PRIVATE_ID_CANARY"), bindings);
    await vi.advanceTimersByTimeAsync(300);
    await response;
    vi.setSystemTime(new Date("2000-01-01T00:00:00.000Z"));
    vi.advanceTimersByTime(201);
    bindings.outgoing.emit("finish");
    expect(records[0]?.payload).toMatchObject({ kind: "debug", event: { durationMs: 501 } });
  });

  it("keeps a long-lived SSE response quiet", async () => {
    const { records, repository } = debugTimelineFixture();
    const app: DashboardApp = new Hono();
    app.get("/api/v1/events", () => new Response(null, {
      headers: { "content-type": "text/event-stream; charset=utf-8" },
    }));
    server = await startDashboardHttpServer({ app, port: 0, observation: { clock: systemClock,
      debugEvents: createDebugEventWriter({ repository, clock: systemClock, build: "test" }) } });
    const bindings = transport();
    await adapter.dispatch(new Request("http://localhost/api/v1/events"), bindings);
    vi.advanceTimersByTime(60_000);
    bindings.outgoing.emit("finish");
    expect(records).toEqual([]);
  });

  it("records HEAD against its GET pattern without private path or query values", async () => {
    const { records, repository } = debugTimelineFixture();
    const app: DashboardApp = new Hono();
    app.get("/api/v1/runs/:runId", () => new Response(null, { status: 502 }));
    server = await startDashboardHttpServer({ app, port: 0, observation: { clock: systemClock,
      debugEvents: createDebugEventWriter({ repository, clock: systemClock, build: "test" }) } });
    const bindings = transport();
    await adapter.dispatch(new Request("http://localhost/api/v1/runs/PRIVATE_ID_CANARY?search=PRIVATE_QUERY_CANARY", { method: "HEAD" }), bindings);
    bindings.outgoing.emit("finish");
    expect(records[0]?.payload).toMatchObject({ kind: "debug", event: {
      method: "HEAD", route: "/api/v1/runs/:runId", status: 502, durationMs: 0,
    } });
    expect(JSON.stringify(records)).not.toContain("CANARY");
  });

  it("uses the selected mount's writer and releases it before a replacement mounts", async () => {
    const root = debugTimelineFixture(), first = debugTimelineFixture(), second = debugTimelineFixture();
    const observe = (fixture: ReturnType<typeof debugTimelineFixture>) => ({ clock: systemClock,
      debugEvents: createDebugEventWriter({ repository: fixture.repository, clock: systemClock, build: "test" }) });
    const app: DashboardApp = new Hono();
    app.get("/health", c => c.body(null, 503));
    const active: DashboardApp = new Hono();
    active.get("/api/v1/runs/:runId", c => c.body(null, 500));
    server = await startDashboardHttpServer({ app, port: 0, observation: observe(root) });
    const mount = server.mount(active, request => new URL(request.url).pathname.startsWith("/api/"), observe(first));
    const bindings = transport();
    await adapter.dispatch(new Request("http://localhost/api/v1/runs/PRIVATE_ID_CANARY"), bindings);
    bindings.outgoing.emit("finish");
    await mount.close();

    const replacement = server.mount(active, () => true, observe(second));
    const next = transport();
    await adapter.dispatch(new Request("http://localhost/api/v1/runs/PRIVATE_ID_CANARY"), next);
    next.outgoing.emit("finish");
    await replacement.close();
    expect(root.records).toEqual([]);
    for (const fixture of [first, second]) {
      expect(fixture.records).toHaveLength(1);
      expect(fixture.records[0]?.payload).toMatchObject({ kind: "debug", event: { route: "/api/v1/runs/:runId", status: 500 } });
    }
  });

  it("records an unmatched request without its private URL", async () => {
    const { records, repository } = debugTimelineFixture();
    const app: DashboardApp = new Hono();
    app.notFound(c => c.body(null, 503));
    server = await startDashboardHttpServer({ app, port: 0, observation: { clock: systemClock,
      debugEvents: createDebugEventWriter({ repository, clock: systemClock, build: "test" }) } });
    const bindings = transport();
    await adapter.dispatch(new Request("http://localhost/PRIVATE_PATH_CANARY?secret=PRIVATE_QUERY_CANARY"), bindings);
    bindings.outgoing.emit("finish");
    expect(records[0]?.payload).toMatchObject({ kind: "debug", event: { route: "(unmatched)", status: 503 } });
    expect(JSON.stringify(records)).not.toContain("CANARY");
  });

  it("cancels unfinished wire timing before releasing a mounted writer", async () => {
    const { records, repository } = debugTimelineFixture();
    const app: DashboardApp = new Hono();
    app.get("/health", c => c.body(null, 200));
    server = await startDashboardHttpServer({ app: new Hono(), port: 0 });
    const mount = server.mount(app, () => true, { clock: systemClock,
      debugEvents: createDebugEventWriter({ repository, clock: systemClock, build: "test" }) });
    const bindings = transport();
    await adapter.dispatch(new Request("http://localhost/health"), bindings);
    const closing = mount.close();
    expect(bindings.outgoing.destroyed).toBe(true);
    bindings.outgoing.emit("close");
    await closing;
    vi.advanceTimersByTime(1000);
    bindings.outgoing.emit("finish");
    expect(records).toEqual([]);
  });

  it("retains a timing-log failure for shutdown instead of swallowing it", async () => {
    const failure = new Error("fixture logging unavailable");
    const app: DashboardApp = new Hono();
    app.get("/health", c => c.body(null, 503));
    server = await startDashboardHttpServer({ app, port: 0, observation: { clock: systemClock,
      debugEvents: { emit() { throw failure; } } } });
    const bindings = transport();
    await adapter.dispatch(new Request("http://localhost/health"), bindings);
    bindings.outgoing.emit("finish");
    const closing = server.close();
    server = undefined;
    await expect(closing).rejects.toMatchObject({ cause: failure });
  });
});
