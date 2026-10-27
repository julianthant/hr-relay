import { createStreamBackpressureFixtures } from "../../../support/helpers/backend/stream-backpressure-fixtures.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";

import { Hono } from "hono";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { request, type IncomingMessage } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join as join_m0 } from "node:path";
import { afterEach, describe, it } from "vitest";
import { createContentAddressedArtifactWriter } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { createServerVerifiedArtifactReader } from "../../../../src/backend/storage/artifacts/server-verified-artifact-reader.js";
import { startDashboardHttpServer, type DashboardHttpServer, type DashboardHttpListener } from "../../../../src/backend/transports/http/http-server.js";
import { type DashboardApp } from "../../../../src/backend/transports/http/routes/api.js";
import { verifiedByteResponse } from "../../../../src/backend/transports/http/routes/verified-byte-response.js";
import { type ActorId } from "../../../../src/rules/identity/ids.js";



import { type DashboardStreamConnection, type DashboardStreamHub } from "../../../../src/backend/transports/http/subscriptions/dashboard-stream.js";
import { dashboardEventStreamBody } from "../../../../src/backend/transports/http/subscriptions/sse-response.js";
import { DashboardStreamEnvelopeSchema, type DashboardStreamEnvelope } from "../../../../src/models/dashboard/subscription.js";

import { DAY, taskEventsOf, type DashboardWorld } from "../../../support/helpers/backend/dashboard-harness.js";

{

type TestDashboardEnv = { Variables: { requestActorId: ActorId } };

const openServers = new Set<DashboardHttpServer>();

const _afterEachFixture0 = async () => {
  const servers = [...openServers];
  openServers.clear();
  const settled = await Promise.allSettled(servers.map((server) => server.close()));
  const failures: unknown[] = [];
  for (const result of settled) {
    if (result.status === "rejected") failures.push(result.reason);
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "dashboard HTTP test cleanup failed");
};

async function startServer(
  app: DashboardApp,
  onTransferError?: (error: Error) => void,
): Promise<DashboardHttpServer> {
  const server = await startDashboardHttpServer({
    app,
    port: 0,
    ...(onTransferError === undefined ? {} : { onTransferError }),
  });
  openServers.add(server);
  return server;
}

async function closeServer(server: DashboardHttpServer): Promise<void> {
  try {
    await server.close();
  } finally {
    openServers.delete(server);
  }
}

interface LoopbackGet {
  readonly response: Promise<IncomingMessage>;
  readonly clientErrors: Error[];
}

function loopbackGet(port: number, path: string): LoopbackGet {
  const response = Promise.withResolvers<IncomingMessage>();
  const clientErrors: Error[] = [];
  const client = request({
    hostname: "127.0.0.1",
    port,
    method: "GET",
    path,
  });
  client.once("response", response.resolve);
  client.on("error", (error) => {
    clientErrors.push(error);
    response.reject(error);
  });
  client.end();
  return { response: response.promise, clientErrors };
}

function errorTree(error: unknown): readonly unknown[] {
  if (error instanceof AggregateError) {
    return [error, ...error.errors.flatMap((nested) => errorTree(nested))];
  }
  return [error];
}

describe("dashboard HTTP request ownership", () => {
afterEach(_afterEachFixture0);

  it("preserves an occupied-port refusal and can bind the port after its owner closes", async () => {
    const owner = createServer();
    await new Promise<void>((resolve, reject) => {
      owner.once("error", reject);
      owner.listen(0, "127.0.0.1", resolve);
    });
    const address = owner.address();
    assert.ok(address !== null && typeof address !== "string");
    const port = address.port;
    try {
      await assert.rejects(startDashboardHttpServer({ app: new Hono<TestDashboardEnv>(), port }), (error: unknown) =>
        typeof error === "object" && error !== null && "code" in error && error.code === "EADDRINUSE");
    } finally {
      await new Promise<void>((resolve, reject) => owner.close((error) => error === undefined ? resolve() : reject(error)));
    }
    const recovered = await startDashboardHttpServer({ app: new Hono<TestDashboardEnv>(), port });
    openServers.add(recovered);
    await closeServer(recovered);
  });

  it("adapts a Node request body to the exact web request bytes", async () => {
    const expected = Buffer.from([0x00, 0x01, 0x7f, 0x80, 0xfe, 0xff, 0x44]);
    const received = Promise.withResolvers<Uint8Array>();
    const app = new Hono<TestDashboardEnv>();
    app.post("/body", async (context) => {
      received.resolve(new Uint8Array(await context.req.arrayBuffer()));
      return new Response(null, { status: 204 });
    });
    const server = await startServer(app);
    const response = Promise.withResolvers<IncomingMessage>();
    const client = request({
      hostname: "127.0.0.1",
      port: server.port,
      method: "POST",
      path: "/body",
      headers: { "content-length": String(expected.byteLength) },
    });
    client.once("response", response.resolve);
    client.end(expected);

    const actualResponse = await response.promise;
    actualResponse.resume();
    await new Promise<void>((resolve) => actualResponse.once("end", resolve));
    await closeServer(server);

    assert.equal(actualResponse.statusCode, 204);
    assert.deepEqual(Buffer.from(await received.promise), expected);
  });

  it("aborts the exact routed Request and settles route cleanup when the client disconnects before headers", async () => {
    const routeStarted = Promise.withResolvers<Request>();
    const signalAborted = Promise.withResolvers<AbortSignal>();
    const cleanupSettled = Promise.withResolvers<void>();
    const events: string[] = [];
    const app = new Hono<TestDashboardEnv>();
    app.get("/awaiting", async (context) => {
      const routedRequest = context.req.raw;
      events.push("route-started");
      routeStarted.resolve(routedRequest);
      try {
        await new Promise<void>((resolve) => {
          routedRequest.signal.addEventListener("abort", () => {
            events.push("signal-aborted");
            signalAborted.resolve(routedRequest.signal);
            resolve();
          }, { once: true });
        });
      } finally {
        events.push("cleanup-settled");
        cleanupSettled.resolve();
      }
      return new Response(null, { status: 204 });
    });

    const server = await startServer(app);
    const responses: IncomingMessage[] = [];
    const clientErrors: Error[] = [];
    const clientClosed = Promise.withResolvers<void>();
    const client = request({
      hostname: "127.0.0.1",
      port: server.port,
      method: "GET",
      path: "/awaiting",
    });
    client.on("response", (response) => {
      responses.push(response);
      response.resume();
    });
    client.on("error", (error) => {
      clientErrors.push(error);
    });
    client.once("close", clientClosed.resolve);
    client.end();

    const routedRequest = await routeStarted.promise;
    assert.equal(routedRequest.signal.aborted, false);
    client.destroy();

    const observedSignal = await signalAborted.promise;
    await cleanupSettled.promise;
    await clientClosed.promise;
    assert.equal(observedSignal, routedRequest.signal, "the socket must abort the Request delivered to Hono");
    assert.equal(routedRequest.signal.aborted, true);
    assert.match(String(routedRequest.signal.reason), /disconnected before response handoff/);
    assert.deepEqual(events, ["route-started", "signal-aborted", "cleanup-settled"]);
    assert.equal(responses.length, 0, "a disconnected pre-handoff request must not receive headers");
  });

  it("cancels a backpressured body and reports cancellation failure without an unhandled rejection", async () => {
    const routedRequest = Promise.withResolvers<Request>();
    const cancelStarted = Promise.withResolvers<unknown>();
    const releaseCancel = Promise.withResolvers<void>();
    const cancelSettled = Promise.withResolvers<void>();
    const transferReported = Promise.withResolvers<Error>();
    const transferErrors: Error[] = [];
    const unhandledRejections: unknown[] = [];
    const cancelFailure = new Error("owned body cancellation failed");
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024).fill(0x5a));
      },
      async cancel(reason) {
        cancelStarted.resolve(reason);
        await releaseCancel.promise;
        cancelSettled.resolve();
        throw cancelFailure;
      },
    });
    const app = new Hono<TestDashboardEnv>();
    app.get("/backpressure", (context) => {
      routedRequest.resolve(context.req.raw);
      return new Response(body, { headers: { "content-type": "application/octet-stream" } });
    });
    const server = await startServer(app, (error) => {
      transferErrors.push(error);
      transferReported.resolve(error);
    });
    const onUnhandledRejection = (reason: unknown): void => {
      unhandledRejections.push(reason);
    };
    process.prependListener("unhandledRejection", onUnhandledRejection);

    try {
      const connection = loopbackGet(server.port, "/backpressure");
      const response = await connection.response;
      response.on("error", (error) => {
        connection.clientErrors.push(error);
      });
      response.pause();
      const requestAtRoute = await routedRequest.promise;
      response.destroy();

      const cancelReason = await cancelStarted.promise;
      assert.equal(requestAtRoute.signal.aborted, true);
      assert.equal(requestAtRoute.signal.reason, cancelReason, "Request abort and body cancel must share one cause");
      releaseCancel.resolve();
      await cancelSettled.promise;

      const reportedError = await transferReported.promise;
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(transferErrors.length, 1, "one failed transfer has one local report");
      assert.ok(errorTree(reportedError).includes(cancelFailure), "the reported outcome must retain cleanup failure identity");
      assert.deepEqual(unhandledRejections, [], "body cancellation rejection must remain owned");
    } finally {
      process.removeListener("unhandledRejection", onUnhandledRejection);
    }
  });

  it("waits for owned body cancellation to settle before server.close resolves", async () => {
    const cancelStarted = Promise.withResolvers<void>();
    const releaseCancel = Promise.withResolvers<void>();
    const cancelSettled = Promise.withResolvers<void>();
    const transferErrors: Error[] = [];
    const events: string[] = [];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024).fill(0x33));
      },
      async cancel() {
        events.push("body-cancel-started");
        cancelStarted.resolve();
        await releaseCancel.promise;
        events.push("body-cancel-settled");
        cancelSettled.resolve();
      },
    });
    const app = new Hono<TestDashboardEnv>();
    app.get("/owned-body", () => new Response(body));
    const server = await startServer(app, (error) => {
      transferErrors.push(error);
    });
    const connection = loopbackGet(server.port, "/owned-body");
    const response = await connection.response;
    response.on("error", (error) => {
      connection.clientErrors.push(error);
    });
    response.pause();
    events.push("response-owned");

    events.push("close-called");
    const closeSettled = closeServer(server).then(() => {
      events.push("close-settled");
    });
    await cancelStarted.promise;
    await Promise.resolve();
    assert.deepEqual(events, ["response-owned", "close-called", "body-cancel-started"]);

    releaseCancel.resolve();
    await cancelSettled.promise;
    await closeSettled;
    assert.deepEqual(events, [
      "response-owned",
      "close-called",
      "body-cancel-started",
      "body-cancel-settled",
      "close-settled",
    ]);
    assert.deepEqual(transferErrors, []);
  });

  it("does not hang when a body read finishes after its response already closed", async () => {
    const pullStarted = Promise.withResolvers<void>();
    const releasePull = Promise.withResolvers<void>();
    const app = new Hono<TestDashboardEnv>();
    app.get("/late-body-finish", () => new Response(new ReadableStream<Uint8Array>({
      async pull(controller) {
        pullStarted.resolve();
        await releasePull.promise;
        controller.close();
      },
    })));
    const server = await startServer(app);
    const clientClosed = Promise.withResolvers<void>();
    const client = request({
      hostname: "127.0.0.1",
      port: server.port,
      method: "GET",
      path: "/late-body-finish",
    });
    client.on("error", () => undefined);
    client.once("close", clientClosed.resolve);
    client.end();

    await pullStarted.promise;
    client.destroy();
    await clientClosed.promise;
    releasePull.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    openServers.delete(server);
    let closeSettled = false;
    const closing = server.close().then(() => {
      closeSettled = true;
    });
    for (let turn = 0; turn < 4; turn += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    assert.equal(closeSettled, true, "a destroyed response must not retain an endResponse listener forever");
    await closing;
  });

  it("waits for a real verified-byte lease to close during server shutdown", async () => {
    const workspace = await mkdtemp(join_m0(tmpdir(), "hrauto-http-verified-shutdown-"));
    let leaseClosed = false;
    const cancelStarted = Promise.withResolvers<void>();
    const releaseCancel = Promise.withResolvers<void>();
    try {
      const artifacts = createContentAddressedArtifactWriter({
        admission: RuntimeAdmission.syntheticRoots(join_m0(workspace, ".tracker/data"), join_m0(workspace, ".tracker/data/artifacts")),
      });
      const ref = await artifacts.put(Buffer.alloc(2 * 1024 * 1024, 0x4b), {
        mediaType: "application/octet-stream",
      });
      const reader = createServerVerifiedArtifactReader({
        admission: RuntimeAdmission.syntheticRoots(join_m0(workspace, ".tracker/data"), join_m0(workspace, ".tracker/data/artifacts")),
        observeLeaseClosed() {
          leaseClosed = true;
        },
      });
      const app = new Hono<TestDashboardEnv>();
      app.get("/verified-shutdown", async (context) => {
        const actualLease = await reader.prepare(ref, context.req.raw.signal);
        return verifiedByteResponse({
          lease: Object.freeze({
            ref: actualLease.ref,
            async takeBody() {
              const actualReader = (await actualLease.takeBody()).getReader();
              return new ReadableStream<Uint8Array>({
                async pull(controller) {
                  const chunk = await actualReader.read();
                  if (chunk.done) controller.close();
                  else controller.enqueue(chunk.value);
                },
                async cancel(reason) {
                  cancelStarted.resolve();
                  await releaseCancel.promise;
                  await actualReader.cancel(reason);
                },
              });
            },
            dispose: () => actualLease.dispose(),
          }),
          method: context.req.method,
          range: context.req.header("range"),
          profile: "generic",
        });
      });
      const server = await startServer(app);
      const connection = loopbackGet(server.port, "/verified-shutdown");
      const response = await connection.response;
      response.on("error", (error) => connection.clientErrors.push(error));
      response.pause();

      let closeSettled = false;
      const closing = closeServer(server).then(() => {
        closeSettled = true;
      });
      await cancelStarted.promise;
      await Promise.resolve();
      assert.equal(closeSettled, false, "server.close must remain pending while lease cancellation is pending");
      assert.equal(leaseClosed, false);
      releaseCancel.resolve();
      await closing;
      assert.equal(leaseClosed, true, "server.close must await the selected verified-byte lease disposal");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("destroys the response and retains a throwing local transfer observer until close", async () => {
    const transferFailure = new Error("owned response body failed");
    const observerFailure = new Error("local transfer observer failed");
    const observed = Promise.withResolvers<Error>();
    const app = new Hono<TestDashboardEnv>();
    app.get("/transfer-failure", () => new Response(new ReadableStream<Uint8Array>({
      pull() {
        throw transferFailure;
      },
    })));
    const server = await startServer(app, (error) => {
      observed.resolve(error);
      throw observerFailure;
    });

    const connection = loopbackGet(server.port, "/transfer-failure");
    const clientSettled = connection.response.then((response) => new Promise<void>((resolve) => {
      response.on("error", () => resolve());
      response.on("end", resolve);
      response.resume();
    })).catch((error: unknown) => {
      if (error instanceof Error) connection.clientErrors.push(error);
    });
    const actualObserved = await observed.promise;
    await clientSettled;
    assert.ok(errorTree(actualObserved).includes(transferFailure));

    await assert.rejects(
      closeServer(server),
      (error: unknown) => {
        const tree = errorTree(error);
        assert.ok(tree.includes(transferFailure));
        assert.ok(tree.includes(observerFailure));
        assert.equal(error instanceof AggregateError ? error.cause : undefined, actualObserved);
        return true;
      },
    );
  });

  it("retains an unobserved transfer failure until close refuses success", async () => {
    const transferFailure = new Error("owned response body failed without an observer");
    const app = new Hono<TestDashboardEnv>();
    app.get("/unobserved-transfer-failure", () => new Response(new ReadableStream<Uint8Array>({
      pull() {
        throw transferFailure;
      },
    })));
    const server = await startServer(app);

    const connection = loopbackGet(server.port, "/unobserved-transfer-failure");
    await connection.response.then((response) => new Promise<void>((resolve) => {
      response.on("error", () => resolve());
      response.on("end", resolve);
      response.resume();
    })).catch((error: unknown) => {
      if (error instanceof Error) connection.clientErrors.push(error);
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    await assert.rejects(closeServer(server), (error: unknown) => {
      const tree = errorTree(error);
      assert.ok(tree.includes(transferFailure));
      assert.match(error instanceof Error ? error.message : String(error), /no local observer/u);
      return true;
    });
  });

  it("retains every completed transfer-observer failure until close", async () => {
    const transferFailures = [
      new Error("first completed transfer failed"),
      new Error("second completed transfer failed"),
    ];
    const observerFailures = [
      new Error("first transfer observer failed"),
      new Error("second transfer observer failed"),
    ];
    const observedTwice = Promise.withResolvers<void>();
    let observedCount = 0;
    const app = new Hono<TestDashboardEnv>();
    app.get("/failed/:index", (context) => {
      const index = Number(context.req.param("index"));
      return new Response(new ReadableStream<Uint8Array>({
        pull() {
          throw transferFailures[index];
        },
      }));
    });
    const server = await startServer(app, () => {
      const failure = observerFailures[observedCount];
      observedCount += 1;
      if (observedCount === 2) observedTwice.resolve();
      if (failure === undefined) throw new Error("unexpected third transfer-observer failure");
      throw failure;
    });

    for (const index of [0, 1]) {
      const connection = loopbackGet(server.port, `/failed/${String(index)}`);
      await connection.response.then((response) => new Promise<void>((resolve) => {
        response.on("error", () => resolve());
        response.on("end", resolve);
        response.resume();
      })).catch((error: unknown) => {
        if (error instanceof Error) connection.clientErrors.push(error);
      });
    }
    await observedTwice.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));

    await assert.rejects(closeServer(server), (error: unknown) => {
      const tree = errorTree(error);
      for (const failure of [...transferFailures, ...observerFailures]) {
        assert.ok(tree.includes(failure), `shutdown must retain ${failure.message}`);
      }
      return true;
    });
  });

  it("propagates a real verified-byte route disconnect and settles its lease", async () => {
    const workspace = await mkdtemp(join_m0(tmpdir(), "hrauto-http-verified-route-"));
    const leaseClosed = Promise.withResolvers<void>();
    const transferReported = Promise.withResolvers<Error>();
    let routedRequest: Request | undefined;
    try {
      const artifacts = createContentAddressedArtifactWriter({
        admission: RuntimeAdmission.syntheticRoots(join_m0(workspace, ".tracker/data"), join_m0(workspace, ".tracker/data/artifacts")),
      });
      const ref = await artifacts.put(Buffer.alloc(2 * 1024 * 1024, 0x5a), {
        mediaType: "application/octet-stream",
      });
      const reader = createServerVerifiedArtifactReader({
        admission: RuntimeAdmission.syntheticRoots(join_m0(workspace, ".tracker/data"), join_m0(workspace, ".tracker/data/artifacts")),
        observeLeaseClosed: leaseClosed.resolve,
      });
      const app = new Hono<TestDashboardEnv>();
      app.get("/artifacts/v1/:artifactId", async (context) => {
        routedRequest = context.req.raw;
        assert.equal(context.req.param("artifactId"), ref.id);
        return verifiedByteResponse({
          lease: await reader.prepare(ref, context.req.raw.signal),
          method: context.req.method,
          range: context.req.header("range"),
          profile: "generic",
        });
      });
      const server = await startServer(app, transferReported.resolve);
      const connection = loopbackGet(server.port, `/artifacts/v1/${ref.id}`);
      const response = await connection.response;
      response.on("error", (error) => connection.clientErrors.push(error));
      response.pause();
      response.destroy();

      await leaseClosed.promise;
      const transferError = await transferReported.promise;
      assert.match(transferError.message, /response closed while waiting for drain/u);
      assert.equal(routedRequest?.signal.aborted, true);
      await new Promise<void>((resolve) => setImmediate(resolve));
      await closeServer(server);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("streams ordinary success bytes exactly and closes without a transfer error", async () => {
    const expected = Buffer.from([0x00, 0x01, 0x7f, 0x80, 0xfe, 0xff, 0x44]);
    const transferErrors: Error[] = [];
    const app = new Hono<TestDashboardEnv>();
    app.get("/success", () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from(expected.subarray(0, 3)));
        controller.enqueue(Uint8Array.from(expected.subarray(3)));
        controller.close();
      },
    }), { headers: { "content-type": "application/octet-stream" } }));
    const server = await startServer(app, (error) => {
      transferErrors.push(error);
    });

    const connection = loopbackGet(server.port, "/success");
    const response = await connection.response;
    const chunks: Uint8Array[] = [];
    for await (const chunk of response as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    await closeServer(server);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(Buffer.concat(chunks), expected);
    assert.deepEqual(connection.clientErrors, []);
    assert.deepEqual(transferErrors, []);
  });
});
}

{

type TestDashboardEnv = { Variables: { requestActorId: ActorId } };

const MAX_PENDING = 4;
const worlds: DashboardWorld[] = [];
const hubs: DashboardStreamHub[] = [];
const servers = new Set<DashboardHttpServer>();

const _afterEachFixture0 = async () => {
  for (const hub of hubs.splice(0)) hub.close();
  const open = [...servers];
  servers.clear();
  await Promise.all(open.map((server) => server.close()));
  for (const w of worlds.splice(0)) await w.dispose();
};

const { harness } = createStreamBackpressureFixtures(worlds, hubs, MAX_PENDING);

/** Parse every COMPLETE event block; a trailing partial block is not an event yet. */
function parseSse(text: string): DashboardStreamEnvelope[] {
  const blocks = text.split("\n\n");
  if (!text.endsWith("\n\n")) blocks.pop();
  return blocks.filter((block) => block.includes("data: ")).map((block) => {
    const data = block.split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n");
    return DashboardStreamEnvelopeSchema.parse(JSON.parse(data));
  });
}

/** A node name wide enough that a few hundred patches fill the loopback buffers. */
const WIDE_NODE = "n".repeat(4096);

describe("dashboard stream backpressure (bridge + Node adapter)", () => {
afterEach(_afterEachFixture0);

  it("Node adapter: a client that stops reading backs the hub up to its bound, resumes to one reset, and disconnect closes the connection", { timeout: 60_000 }, async () => {
    const { w, hub } = await harness();
    const captured = Promise.withResolvers<DashboardStreamConnection>();
    const app = new Hono<TestDashboardEnv>();
    app.get("/events", async () => {
      const connection = await hub.connect({ day: DAY });
      captured.resolve(connection);
      return new Response(dashboardEventStreamBody(connection), {
        status: 200,
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
      });
    });

    const transferErrors: Error[] = [];
    const server = await startDashboardHttpServer({ app, port: 0, onTransferError: (error) => transferErrors.push(error) });
    servers.add(server);

    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const client = request({ hostname: "127.0.0.1", port: server.port, method: "GET", path: "/events" });
      client.once("response", resolve);
      client.once("error", reject);
      client.end();
    });
    const connection = await captured.promise;
    response.pause();

    const yieldMacrotask = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));
    let published = 0;
    let stalled = false;
    while (!stalled && published < 20_000) {
      for (let step = 0; step < 32; step += 1) {
        taskEventsOf(w, 1, `${WIDE_NODE}-${String(published)}`);
        published += 1;
      }
      await yieldMacrotask();
      stalled = connection.pending > 0;
    }
    assert.ok(stalled, `the paused socket never stalled after ${String(published)} publishes`);
    await yieldMacrotask();
    assert.ok(connection.pending > 0, "a real stall survives a further macrotask yield");
    for (let step = 0; step < 5 * MAX_PENDING; step += 1) taskEventsOf(w, 1, `over-${String(step)}`);
    await yieldMacrotask();
    assert.equal(connection.pending, 1, "one reset-required supersedes everything the socket could not take");

    const chunks: Buffer[] = [];
    const resetSeen = Promise.withResolvers<DashboardStreamEnvelope[]>();
    response.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      const envelopes = parseSse(Buffer.concat(chunks).toString("utf8"));
      if (envelopes.some(({ type }) => type === "reset-required")) resetSeen.resolve(envelopes);
    });
    response.resume();
    const envelopes = await resetSeen.promise;
    assert.deepEqual(envelopes.slice(0, 3).map(({ type }) => type), ["hello", "snapshot", "health"]);
    assert.equal(envelopes.filter(({ type }) => type === "reset-required").length, 1);
    assert.equal(envelopes.at(-1)?.type, "reset-required");
    assert.ok(envelopes.slice(3, -1).every(({ type }) => type === "patch"), "no envelope is dropped or reordered before the reset");

    response.destroy();
    for (let attempt = 0; attempt < 50 && hub.subscriberCount() > 0; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(hub.subscriberCount(), 0, "client disconnect closes the hub connection");
    assert.equal(await connection.next(), undefined);
    for (let attempt = 0; attempt < 50 && transferErrors.length === 0; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(transferErrors.length, 1, "the disconnect is observed exactly once, never swallowed");
    assert.match(transferErrors[0]?.message ?? "", /closed while waiting for drain|disconnected/u);
  });
});
}


describe("selected dashboard transport mounts", () => {
  it("drains only its real mounted stream while the public transition response stays live", async () => {
    const app = new Hono<{ Variables: { requestActorId: ActorId } }>();
    const selected = new Hono<{ Variables: { requestActorId: ActorId } }>();
    let cancelled = 0;
    selected.get("/active/events", () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode("data: ready\n\n")); },
      cancel() { cancelled++; },
    }), { headers: { "content-type": "text/event-stream" } }));
    let mount: ReturnType<DashboardHttpListener["mount"]> | undefined;
    app.post("/public/logout", async c => { assert.ok(mount); await mount.close(); return c.json({ state: "detached" }); });
    app.get("/", c => c.text("public login"));
    const server = await startDashboardHttpServer({ app, port: 0 });
    try {
      mount = server.mount(selected, request => new URL(request.url).pathname.startsWith("/active/"));
      const response = await fetch(`http://127.0.0.1:${String(server.port)}/active/events`);
      const reader = response.body?.getReader(); assert.ok(reader);
      assert.equal((await reader.read()).done, false);
      const logout = await fetch(`http://127.0.0.1:${String(server.port)}/public/logout`, { method: "POST" });
      assert.deepEqual(await logout.json(), { state: "detached" });
      assert.equal(cancelled, 1);
      assert.equal((await fetch(`http://127.0.0.1:${String(server.port)}/active/events`)).status, 404);
      assert.equal(await (await fetch(`http://127.0.0.1:${String(server.port)}/`)).text(), "public login");
      const replacement = server.mount(selected, request => new URL(request.url).pathname.startsWith("/active/"));
      await mount.close();
      await replacement.close();
    } finally { await server.close(); }
  });

  it("waits for an admitted request task after abort and fences new requests synchronously", async () => {
    const app = new Hono<{ Variables: { requestActorId: ActorId } }>();
    const selected = new Hono<{ Variables: { requestActorId: ActorId } }>();
    const entered = Promise.withResolvers<void>(), aborted = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    selected.post("/active/body", async c => {
      c.req.raw.signal.addEventListener("abort", () => { aborted.resolve(); }, { once: true });
      entered.resolve(); await release.promise; return c.text("finished");
    });
    const server = await startDashboardHttpServer({ app, port: 0 });
    const mount = server.mount(selected, request => new URL(request.url).pathname.startsWith("/active/"));
    const request = fetch(`http://127.0.0.1:${String(server.port)}/active/body`, { method: "POST", body: "held" });
    const requestOutcome = request.catch(() => undefined);
    try {
      await entered.promise;
      let closed = false;
      const closing = mount.close().then(() => { closed = true; });
      await aborted.promise;
      assert.equal(closed, false);
      assert.equal((await fetch(`http://127.0.0.1:${String(server.port)}/active/body`)).status, 404);
      release.resolve(); await closing; await requestOutcome;
    } finally { release.resolve(); await requestOutcome; await server.close(); }
  });

  it("drains the actual unfinished upload body before releasing its mounted owner", async () => {
    const app = new Hono<{ Variables: { requestActorId: ActorId } }>();
    const selected = new Hono<{ Variables: { requestActorId: ActorId } }>();
    const entered = Promise.withResolvers<void>(), bodyClosed = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    let requestAborted = false;
    selected.post("/active/upload", async c => {
      const body = c.req.raw.body; assert.ok(body);
      const reader = body.getReader();
      try {
        assert.equal((await reader.read()).done, false);
        entered.resolve();
        try { await reader.read(); } catch (error) {
          if (!c.req.raw.signal.aborted) throw error;
        }
        requestAborted = c.req.raw.signal.aborted;
      } finally { reader.releaseLock(); bodyClosed.resolve(); }
      await release.promise;
      return new Response(null, { status: 204 });
    });
    const server = await startDashboardHttpServer({ app, port: 0 });
    const mount = server.mount(selected, incoming => new URL(incoming.url).pathname.startsWith("/active/"));
    const clientClosed = Promise.withResolvers<void>();
    const client = request({ hostname: "127.0.0.1", port: server.port, method: "POST", path: "/active/upload" });
    const clientErrors: Error[] = [];
    client.on("error", error => { clientErrors.push(error); });
    client.once("close", clientClosed.resolve);
    client.write("owned partial upload");
    try {
      await entered.promise;
      let closed = false;
      const closing = mount.close().then(() => { closed = true; });
      await bodyClosed.promise;
      assert.equal(requestAborted, true);
      assert.equal(closed, false);
      release.resolve(); await closing; await clientClosed.promise;
      assert.ok(clientErrors.every(error => "code" in error && error.code === "ECONNRESET"));
    } finally { release.resolve(); client.destroy(); await server.close(); }
  });

  it("retains a throwing stream cancellation as unproved mount custody", async () => {
    const app = new Hono<{ Variables: { requestActorId: ActorId } }>();
    const selected = new Hono<{ Variables: { requestActorId: ActorId } }>();
    const primary = new Error("fixture cancellation failed");
    selected.get("/active/events", () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array([1])); }, cancel() { throw primary; },
    })));
    const server = await startDashboardHttpServer({ app, port: 0, onTransferError: () => undefined });
    const mount = server.mount(selected, request => new URL(request.url).pathname.startsWith("/active/"));
    try {
      const response = await fetch(`http://127.0.0.1:${String(server.port)}/active/events`);
      const reader = response.body?.getReader(); assert.ok(reader); await reader.read();
      await assert.rejects(mount.close(), error => error instanceof AggregateError && error.errors.includes(primary));
      assert.throws(() => server.mount(selected, () => true), /mount unavailable/u);
      await assert.rejects(mount.close(), /mount closure is unproved/u);
    } finally { await assert.rejects(server.close(), error => error === primary || error instanceof AggregateError); }
  });
});
