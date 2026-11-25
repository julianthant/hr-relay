
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { DashboardClientError } from "../../../src/dashboard/client/index.js";

import { createDashboardTransport } from "../../../src/dashboard/client/transport.js";
const HASH_D = "d".repeat(64);

it("classifies binary body failures once without reporting body values", async () => {
  const cause = new Error("PRIVATE_BINARY_BODY");
  const failures: unknown[] = [];
  const transport = createDashboardTransport({ baseUrl: "http://relay.test", onFailure: failure => { failures.push(failure); },
    fetchImpl: async () => new Response(new ReadableStream({ start(controller) { controller.error(cause); } })) });
  await assert.rejects(transport.requestBinary("/api/v1/exports/xlsx"),
    error => error instanceof DashboardClientError && error.kind === "network" && error.cause === cause);
  assert.equal(failures.length, 1);
  assert.equal(JSON.stringify(failures).includes("PRIVATE_"), false);
});

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("openStream endings", () => {
  it("rejects with the NETWORK kind when the response body errors mid-read", async () => {
    const encoder = new TextEncoder();
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(c): void {
        controller = c;
      },
    });
    const transport = createDashboardTransport({
      baseUrl: "http://bff.test",
      fetchImpl: () => Promise.resolve(new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      })),
    });
    const messages: string[] = [];
    const stream = transport.openStream("/events/v1", { onMessage: (message) => messages.push(message.data) });
    await tick();

    controller!.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "hello", wireVersion: 1, descriptorHash: HASH_D, projectionGeneration: 7, cursor: "pc:1" })}\n\n`));
    await tick();
    assert.equal(messages.length, 1);
    controller!.error(new Error("connection reset by peer"));

    const failure = await stream.done.then(() => undefined, (reason: unknown) => reason);
    assert.equal(failure instanceof DashboardClientError, true);
    if (!(failure instanceof DashboardClientError)) assert.fail("expected a DashboardClientError");
    assert.equal(failure.kind, "network");
    assert.match(failure.message, /stream \/events\/v1/u);
  });

  it("rejects with the HTTP kind when the server refuses the stream", async () => {
    const transport = createDashboardTransport({
      baseUrl: "http://bff.test",
      fetchImpl: () => Promise.resolve(new Response(JSON.stringify({
        state: "error",
        code: "PROJECTION_DEGRADED",
        message: "the day projection is unavailable",
        retryable: true,
      }), { status: 503, headers: { "content-type": "application/json" } })),
    });
    const stream = transport.openStream("/events/v1", { onMessage: () => undefined });
    const failure = await stream.done.then(() => undefined, (reason: unknown) => reason);
    assert.equal(failure instanceof DashboardClientError, true);
    if (!(failure instanceof DashboardClientError)) assert.fail("expected a DashboardClientError");

    assert.equal(failure.kind, "http");
    assert.equal(failure.status, 503);
    assert.equal(failure.code, "PROJECTION_DEGRADED");
    assert.equal(failure.message, "the day projection is unavailable");
    assert.equal(failure.retryable, true);
  });

  it("RESOLVES done when the client closes a live stream", async () => {

    let bodyController: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(c): void {
        bodyController = c;
      },
    });
    const transport = createDashboardTransport({
      baseUrl: "http://bff.test",
      fetchImpl: (_input, init) => {
        init?.signal?.addEventListener("abort", () => {
          bodyController.error(new DOMException("The operation was aborted.", "AbortError"));
        });
        return Promise.resolve(new Response(body, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }));
      },
    });
    const stream = transport.openStream("/events/v1", { onMessage: () => undefined });
    await tick();
    stream.close();

    assert.equal(await stream.done.then(() => "resolved", () => "rejected"), "resolved");
  });
});

describe("Settings read deadlines", () => {
  it("bounds an unresolved fetch and ignores its late settlement", async () => {
    const { vi } = await import("vitest"); vi.useFakeTimers();
    const response = Promise.withResolvers<Response>();
    let signal: AbortSignal | null | undefined;
    const transport = createDashboardTransport({ baseUrl: "http://bff.test", fetchImpl: (_url, init) => { signal = init?.signal; return response.promise; } });
    try {
      const result = transport.requestJson("/api/v1/settings/editable").then(() => "loaded", (error: unknown) => error);
      await vi.advanceTimersByTimeAsync(10_000);
      const failure = await result;
      assert.ok(failure instanceof DashboardClientError); assert.equal(failure.code, "SETTINGS_INITIAL_READ_UNAVAILABLE"); assert.equal(signal?.aborted, true);
      response.resolve(new Response("{}")); await Promise.resolve(); assert.equal(await result, failure);
    } finally { vi.useRealTimers(); }
  });
  it("bounds body consumption and respects caller cancellation", async () => {
    const { vi } = await import("vitest"); vi.useFakeTimers();
    const transport = createDashboardTransport({ baseUrl: "http://bff.test", fetchImpl: async () => new Response(new ReadableStream({ start() {} })) });
    try {
      const reading = transport.requestJson("/api/v1/settings/facts").then(() => undefined, (error: unknown) => error);
      await vi.advanceTimersByTimeAsync(10_000); assert.ok(await reading instanceof DashboardClientError);
      const controller = new AbortController();
      const cancelled = transport.requestJson("/api/v1/settings/facts", { signal: controller.signal }).then(() => undefined, (error: unknown) => error);
      const reason = new Error("synthetic cancellation"); controller.abort(reason); const failure = await cancelled;
      assert.ok(failure instanceof DashboardClientError); assert.equal(failure.kind, "network"); assert.equal(failure.retryable, true); assert.equal(failure.cause, reason);
    } finally { vi.useRealTimers(); }
  });
});

describe("run-start read retries", () => {
  const readiness = { state: "unavailable", reason: "Preflight evidence is unavailable for this exact scope; re-check readiness." };
  it("asks a checks read that got no answer in time again without reporting a failure", async () => {
    const { vi } = await import("vitest"); vi.useFakeTimers();
    const failures: unknown[] = [];
    let calls = 0;
    const transport = createDashboardTransport({ baseUrl: "http://relay.test", onFailure: failure => { failures.push(failure); },
      fetchImpl: () => (calls += 1) === 1 ? new Promise<Response>(() => undefined) : Promise.resolve(Response.json(readiness)) });
    try {
      const reading = transport.requestJson("/api/v1/preflight?selection=%7B%7D");
      await vi.advanceTimersByTimeAsync(10_250);
      assert.deepEqual(await reading, readiness);
      assert.equal(calls, 2); assert.deepEqual(failures, []);
    } finally { vi.useRealTimers(); }
  });
  it("asks again on a retryable 503 and reports nothing once answered", async () => {
    const { vi } = await import("vitest"); vi.useFakeTimers();
    const failures: unknown[] = [];
    let calls = 0;
    const transport = createDashboardTransport({ baseUrl: "http://relay.test", onFailure: failure => { failures.push(failure); },
      fetchImpl: async () => (calls += 1) === 1
        ? Response.json({ state: "error", code: "STORAGE_SNAPSHOT_CHANGED", message: "busy", retryable: true }, { status: 503 })
        : Response.json({ workbooks: [] }) });
    try {
      const reading = transport.requestJson("/api/v1/workbooks");
      await vi.advanceTimersByTimeAsync(250);
      assert.deepEqual(await reading, { workbooks: [] });
      assert.equal(calls, 2); assert.deepEqual(failures, []);
    } finally { vi.useRealTimers(); }
  });
  it("reports one read failure that names its cause after the last attempt", async () => {
    const { vi } = await import("vitest"); vi.useFakeTimers();
    const failures: unknown[] = [];
    let calls = 0;
    const transport = createDashboardTransport({ baseUrl: "http://relay.test", onFailure: failure => { failures.push(failure); },
      fetchImpl: () => { calls += 1; return new Promise<Response>(() => undefined); } });
    try {
      const reading = transport.requestJson("/api/v1/workbooks/library/versions/version").then(() => undefined, (error: unknown) => error);
      await vi.advanceTimersByTimeAsync(3 * 10_000 + 2 * 250);
      const failure = await reading;
      assert.ok(failure instanceof DashboardClientError); assert.equal(failure.code, "DASHBOARD_READ_FAILED");
      assert.equal(calls, 3);
      assert.deepEqual(failures, [{ code: "DASHBOARD_READ_FAILED", reason: "read-deadline", route: "/api/v1/workbooks" }]);
    } finally { vi.useRealTimers(); }
  });
  it("names a network failure as its cause", async () => {
    const { vi } = await import("vitest"); vi.useFakeTimers();
    const failures: unknown[] = [];
    const transport = createDashboardTransport({ baseUrl: "http://relay.test", onFailure: failure => { failures.push(failure); },
      fetchImpl: async () => { throw new TypeError("Failed to fetch"); } });
    try {
      const reading = transport.requestJson("/api/v1/preflight").then(() => undefined, (error: unknown) => error);
      await vi.advanceTimersByTimeAsync(500);
      assert.ok(await reading instanceof DashboardClientError);
      assert.deepEqual(failures, [{ code: "DASHBOARD_READ_FAILED", reason: "network-failed", route: "/api/v1/preflight" }]);
    } finally { vi.useRealTimers(); }
  });
});

it("keeps OAuth completion pending for its five-minute ceremony then bounds body delivery", async () => {
  const { vi } = await import("vitest"); vi.useFakeTimers();
  const transport = createDashboardTransport({ baseUrl: "http://bff.test", fetchImpl: async () => new Response(new ReadableStream({ start() {} })) });
  try {
    let settled = false;
    const result = transport.requestJson("/api/v1/settings/chatgpt-account/sign-in/attempt").catch((error: unknown) => { settled = true; return error; });
    await vi.advanceTimersByTimeAsync(300_000); assert.equal(settled, false);
    await vi.advanceTimersByTimeAsync(10_000); const error = await result;
    assert.ok(error instanceof DashboardClientError); assert.equal(error.code, "CHATGPT_AUTH_UNAVAILABLE");
  } finally { vi.useRealTimers(); }
});


it("classifies caller cancellation during a hanging Settings body and rejects late replacement content", async () => {
  const body = Promise.withResolvers<unknown>();
  const response = new Response();
  let entered = false, observed: AbortSignal | null | undefined;
  response.json = () => { entered = true; return body.promise; };
  const transport = createDashboardTransport({ baseUrl: "http://bff.test", fetchImpl: async (_url, init) => { observed = init?.signal; return response; } });
  const controller = new AbortController(), reason = new Error("synthetic body cancellation");
  const reading = transport.requestJson("/api/v1/settings/facts", { signal: controller.signal }).then(() => undefined, (error: unknown) => error);
  await Promise.resolve(); await Promise.resolve(); assert.equal(entered, true);
  controller.abort(reason);
  const error = await reading;
  assert.ok(error instanceof DashboardClientError); assert.equal(error.kind, "network"); assert.equal(error.retryable, true); assert.equal(error.cause, reason);
  assert.equal(observed?.aborted, true); assert.equal(observed?.reason, reason);
  body.resolve({ replacement: true }); await Promise.resolve(); assert.equal(await reading, error);
});
it("classifies a pre-aborted Settings read without dispatching fetch", async () => {
  let calls = 0;
  const transport = createDashboardTransport({ baseUrl: "http://bff.test", fetchImpl: async () => { calls++; return Response.json({}); } });
  const controller = new AbortController(), reason = new Error("synthetic pre-abort"); controller.abort(reason);
  await assert.rejects(transport.requestJson("/api/v1/settings/facts", { signal: controller.signal }), (error: unknown) => error instanceof DashboardClientError && error.kind === "network" && error.retryable && error.cause === reason);
  assert.equal(calls, 0);
});

describe("expected refusals", () => {
  const respond = (status: number) => async () => Response.json({ state: "error", code: "PREFLIGHT_RATE_LIMITED", message: "refused", retryable: true }, { status });
  it("does not report a preflight re-check the server turns away, and still rejects it", async () => {
    const failures: unknown[] = [];
    const transport = createDashboardTransport({ baseUrl: "http://relay.test", onFailure: failure => { failures.push(failure); }, fetchImpl: respond(429) });
    await assert.rejects(transport.requestJson("/api/v1/preflight/rerun", { method: "POST", body: "{}" }));
    assert.deepEqual(failures, []);
  });
  it("reports every other failure of the same route or status", async () => {
    for (const [path, method, status] of [["/api/v1/preflight/rerun", "POST", 500], ["/api/v1/settings/editable", "GET", 429]] as const) {
      const failures: unknown[] = [];
      const transport = createDashboardTransport({ baseUrl: "http://relay.test", onFailure: failure => { failures.push(failure); }, fetchImpl: respond(status) });
      await assert.rejects(transport.requestJson(path, { method }));
      assert.equal(failures.length, 1, `${method} ${path} ${String(status)}`);
    }
  });
});
