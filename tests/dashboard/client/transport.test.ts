
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { DashboardClientError } from "../../../src/dashboard/client/index.js";

import { createDashboardTransport } from "../../../src/dashboard/client/transport.js";
const HASH_D = "d".repeat(64);

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
  it("gives doctor reads sixty seconds without bounding mutation requests", async () => {
    const { vi } = await import("vitest"); vi.useFakeTimers();
    const write = Promise.withResolvers<Response>();
    const transport = createDashboardTransport({ baseUrl: "http://bff.test", fetchImpl: (_url, init) => init?.method === "POST" ? write.promise : new Promise(() => {}) });
    try {
      let wrote = false;
      const writing = transport.requestJson("/api/v1/settings/editable", { method: "POST" }).then(() => { wrote = true; });
      let settled = false;
      const reading = transport.requestJson("/api/v1/storage/doctor").catch((error: unknown) => { settled = true; return error; });
      await vi.advanceTimersByTimeAsync(59_999); assert.equal(settled, false); assert.equal(wrote, false);
      await vi.advanceTimersByTimeAsync(1); assert.ok(await reading instanceof DashboardClientError); assert.equal(wrote, false);
      write.resolve(new Response("{}")); await writing; assert.equal(wrote, true);
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
