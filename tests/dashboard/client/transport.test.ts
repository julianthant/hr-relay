
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { DashboardClientError } from "../../../src/dashboard/client/index.js";

import { createDashboardTransport } from "../../../src/dashboard/client/transport.js";
const HASH_D = "d".repeat(64);

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function hello(cursor: string): Record<string, unknown> {
  return { type: "hello", wireVersion: 1, descriptorHash: HASH_D, projectionGeneration: 7, cursor };
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/* ── openStream's three endings, at the transport seam ───────────────────── */


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
    // A block arrives, and only THEN does the body fail — the drop this
    // subscription exists to survive, not a request that never started.
    controller!.enqueue(encoder.encode(`data: ${JSON.stringify(hello("pc:1"))}\n\n`));
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
      fetchImpl: () => Promise.resolve(jsonResponse(503, {
        state: "error",
        code: "PROJECTION_DEGRADED",
        message: "the day projection is unavailable",
        retryable: true,
      })),
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
    // A real fetch abort errors its open body; model that settlement in the fake.
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
