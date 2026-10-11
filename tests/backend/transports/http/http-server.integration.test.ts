import { RuntimeAdmission as RuntimeAdmission_m0 } from "../../../../src/backend/storage/admission/admission.js";

import { Hono as Hono_m0 } from "hono";
import assert_m0 from "node:assert/strict";
import { mkdtemp as mkdtemp_m0,rm as rm_m0 } from "node:fs/promises";
import { request as request_m0,type IncomingMessage as IncomingMessage_m0 } from "node:http";
import { createServer as createServer_m0 } from "node:net";
import { tmpdir as tmpdir_m0 } from "node:os";
import { join as join_m0 } from "node:path";
import { afterEach as afterEach_m0,describe as describe_m0,it as it_m0 } from "vitest";
import { createContentAddressedArtifactWriter as createContentAddressedArtifactWriter_m0 } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { createServerVerifiedArtifactReader as createServerVerifiedArtifactReader_m0 } from "../../../../src/backend/storage/artifacts/server-verified-artifact-reader.js";
import {
startDashboardHttpServer as startDashboardHttpServer_m0,
type DashboardHttpServer as DashboardHttpServer_m0
} from "../../../../src/backend/transports/http/http-server.js";
import type { DashboardApp as DashboardApp_m0 } from "../../../../src/backend/transports/http/routes/api.js";
import { verifiedByteResponse as verifiedByteResponse_m0 } from "../../../../src/backend/transports/http/routes/verified-byte-response.js";
import type { ActorId as ActorId_m0 } from "../../../../src/rules/identity/ids.js";

import { Hono as Hono_m1 } from "hono";
import assert_m1 from "node:assert/strict";
import { request as request_m1,type IncomingMessage as IncomingMessage_m1 } from "node:http";
import { afterEach as afterEach_m1,describe as describe_m1,it as it_m1 } from "vitest";
import { BackfillGapObservationSchema as BackfillGapObservationSchema_m1 } from "../../../../src/backend/runs/notifications/backfill-gap.js";
import { startDashboardHttpServer as startDashboardHttpServer_m1,type DashboardHttpServer as DashboardHttpServer_m1 } from "../../../../src/backend/transports/http/http-server.js";
import {
createDashboardStreamHub as createDashboardStreamHub_m1,
type DashboardStreamConnection as DashboardStreamConnection_m1,
type DashboardStreamHub as DashboardStreamHub_m1
} from "../../../../src/backend/transports/http/subscriptions/dashboard-stream.js";
import { dashboardEventStreamBody as dashboardEventStreamBody_m1 } from "../../../../src/backend/transports/http/subscriptions/sse-response.js";
import { DashboardStreamEnvelopeSchema as DashboardStreamEnvelopeSchema_m1,type DashboardStreamEnvelope as DashboardStreamEnvelope_m1 } from "../../../../src/models/dashboard/subscription.js";
import type { ActorId as ActorId_m1 } from "../../../../src/rules/identity/ids.js";
import { claimEventOf as claimEventOf_m1,DAY as DAY_m1,makeWorld as makeWorld_m1,queuedEventOf as queuedEventOf_m1,taskEventsOf as taskEventsOf_m1,type DashboardWorld as DashboardWorld_m1 } from "../../../support/helpers/backend/dashboard-harness.js";


{


type TestDashboardEnv = { Variables: { requestActorId: ActorId_m0 } };

const openServers = new Set<DashboardHttpServer_m0>();

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
  app: DashboardApp_m0,
  onTransferError?: (error: Error) => void,
): Promise<DashboardHttpServer_m0> {
  const server = await startDashboardHttpServer_m0({
    app,
    port: 0,
    ...(onTransferError === undefined ? {} : { onTransferError }),
  });
  openServers.add(server);
  return server;
}

async function closeServer(server: DashboardHttpServer_m0): Promise<void> {
  try {
    await server.close();
  } finally {
    openServers.delete(server);
  }
}

interface LoopbackGet {
  readonly response: Promise<IncomingMessage_m0>;
  readonly clientErrors: Error[];
}

function loopbackGet(port: number, path: string): LoopbackGet {
  const response = Promise.withResolvers<IncomingMessage_m0>();
  const clientErrors: Error[] = [];
  const client = request_m0({
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

describe_m0("dashboard HTTP request ownership", () => {
afterEach_m0(_afterEachFixture0);

  it_m0("preserves an occupied-port refusal and can bind the port after its owner closes", async () => {
    const owner = createServer_m0();
    await new Promise<void>((resolve, reject) => {
      owner.once("error", reject);
      owner.listen(0, "127.0.0.1", resolve);
    });
    const address = owner.address();
    assert_m0.ok(address !== null && typeof address !== "string");
    const port = address.port;
    try {
      await assert_m0.rejects(startDashboardHttpServer_m0({ app: new Hono_m0<TestDashboardEnv>(), port }), (error: unknown) =>
        typeof error === "object" && error !== null && "code" in error && error.code === "EADDRINUSE");
    } finally {
      await new Promise<void>((resolve, reject) => owner.close((error) => error === undefined ? resolve() : reject(error)));
    }
    const recovered = await startDashboardHttpServer_m0({ app: new Hono_m0<TestDashboardEnv>(), port });
    openServers.add(recovered);
    await closeServer(recovered);
  });

  it_m0("adapts a Node request body to the exact web request bytes", async () => {
    const expected = Buffer.from([0x00, 0x01, 0x7f, 0x80, 0xfe, 0xff, 0x44]);
    const received = Promise.withResolvers<Uint8Array>();
    const app = new Hono_m0<TestDashboardEnv>();
    app.post("/body", async (context) => {
      received.resolve(new Uint8Array(await context.req.arrayBuffer()));
      return new Response(null, { status: 204 });
    });
    const server = await startServer(app);
    const response = Promise.withResolvers<IncomingMessage_m0>();
    const client = request_m0({
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

    assert_m0.equal(actualResponse.statusCode, 204);
    assert_m0.deepEqual(Buffer.from(await received.promise), expected);
  });

  it_m0("aborts the exact routed Request and settles route cleanup when the client disconnects before headers", async () => {
    const routeStarted = Promise.withResolvers<Request>();
    const signalAborted = Promise.withResolvers<AbortSignal>();
    const cleanupSettled = Promise.withResolvers<void>();
    const events: string[] = [];
    const app = new Hono_m0<TestDashboardEnv>();
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
    const responses: IncomingMessage_m0[] = [];
    const clientErrors: Error[] = [];
    const clientClosed = Promise.withResolvers<void>();
    const client = request_m0({
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
    assert_m0.equal(routedRequest.signal.aborted, false);
    client.destroy();

    const observedSignal = await signalAborted.promise;
    await cleanupSettled.promise;
    await clientClosed.promise;
    assert_m0.equal(observedSignal, routedRequest.signal, "the socket must abort the Request delivered to Hono");
    assert_m0.equal(routedRequest.signal.aborted, true);
    assert_m0.match(String(routedRequest.signal.reason), /disconnected before response handoff/);
    assert_m0.deepEqual(events, ["route-started", "signal-aborted", "cleanup-settled"]);
    assert_m0.equal(responses.length, 0, "a disconnected pre-handoff request must not receive headers");
  });

  it_m0("cancels a backpressured body and reports cancellation failure without an unhandled rejection", async () => {
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
    const app = new Hono_m0<TestDashboardEnv>();
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
      assert_m0.equal(requestAtRoute.signal.aborted, true);
      assert_m0.equal(requestAtRoute.signal.reason, cancelReason, "Request abort and body cancel must share one cause");
      releaseCancel.resolve();
      await cancelSettled.promise;

      const reportedError = await transferReported.promise;
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert_m0.equal(transferErrors.length, 1, "one failed transfer has one local report");
      assert_m0.ok(errorTree(reportedError).includes(cancelFailure), "the reported outcome must retain cleanup failure identity");
      assert_m0.deepEqual(unhandledRejections, [], "body cancellation rejection must remain owned");
    } finally {
      process.removeListener("unhandledRejection", onUnhandledRejection);
    }
  });

  it_m0("waits for owned body cancellation to settle before server.close resolves", async () => {
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
    const app = new Hono_m0<TestDashboardEnv>();
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
    assert_m0.deepEqual(events, ["response-owned", "close-called", "body-cancel-started"]);

    releaseCancel.resolve();
    await cancelSettled.promise;
    await closeSettled;
    assert_m0.deepEqual(events, [
      "response-owned",
      "close-called",
      "body-cancel-started",
      "body-cancel-settled",
      "close-settled",
    ]);
    assert_m0.deepEqual(transferErrors, []);
  });

  it_m0("does not hang when a body read finishes after its response already closed", async () => {
    const pullStarted = Promise.withResolvers<void>();
    const releasePull = Promise.withResolvers<void>();
    const app = new Hono_m0<TestDashboardEnv>();
    app.get("/late-body-finish", () => new Response(new ReadableStream<Uint8Array>({
      async pull(controller) {
        pullStarted.resolve();
        await releasePull.promise;
        controller.close();
      },
    })));
    const server = await startServer(app);
    const clientClosed = Promise.withResolvers<void>();
    const client = request_m0({
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
    assert_m0.equal(closeSettled, true, "a destroyed response must not retain an endResponse listener forever");
    await closing;
  });

  it_m0("waits for a real verified-byte lease to close during server shutdown", async () => {
    const workspace = await mkdtemp_m0(join_m0(tmpdir_m0(), "hrauto-http-verified-shutdown-"));
    let leaseClosed = false;
    const cancelStarted = Promise.withResolvers<void>();
    const releaseCancel = Promise.withResolvers<void>();
    try {
      const artifacts = createContentAddressedArtifactWriter_m0({
        admission: RuntimeAdmission_m0.syntheticRoots(join_m0(workspace, ".tracker/data"), join_m0(workspace, ".tracker/data/artifacts")),
      });
      const ref = await artifacts.put(Buffer.alloc(2 * 1024 * 1024, 0x4b), {
        mediaType: "application/octet-stream",
      });
      const reader = createServerVerifiedArtifactReader_m0({
        admission: RuntimeAdmission_m0.syntheticRoots(join_m0(workspace, ".tracker/data"), join_m0(workspace, ".tracker/data/artifacts")),
        observeLeaseClosed() {
          leaseClosed = true;
        },
      });
      const app = new Hono_m0<TestDashboardEnv>();
      app.get("/verified-shutdown", async (context) => {
        const actualLease = await reader.prepare(ref, context.req.raw.signal);
        return verifiedByteResponse_m0({
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
      assert_m0.equal(closeSettled, false, "server.close must remain pending while lease cancellation is pending");
      assert_m0.equal(leaseClosed, false);
      releaseCancel.resolve();
      await closing;
      assert_m0.equal(leaseClosed, true, "server.close must await the selected verified-byte lease disposal");
    } finally {
      await rm_m0(workspace, { recursive: true, force: true });
    }
  });

  it_m0("destroys the response and retains a throwing local transfer observer until close", async () => {
    const transferFailure = new Error("owned response body failed");
    const observerFailure = new Error("local transfer observer failed");
    const observed = Promise.withResolvers<Error>();
    const app = new Hono_m0<TestDashboardEnv>();
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
    assert_m0.ok(errorTree(actualObserved).includes(transferFailure));

    await assert_m0.rejects(
      closeServer(server),
      (error: unknown) => {
        const tree = errorTree(error);
        assert_m0.ok(tree.includes(transferFailure));
        assert_m0.ok(tree.includes(observerFailure));
        assert_m0.equal(error instanceof AggregateError ? error.cause : undefined, actualObserved);
        return true;
      },
    );
  });

  it_m0("retains an unobserved transfer failure until close refuses success", async () => {
    const transferFailure = new Error("owned response body failed without an observer");
    const app = new Hono_m0<TestDashboardEnv>();
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

    await assert_m0.rejects(closeServer(server), (error: unknown) => {
      const tree = errorTree(error);
      assert_m0.ok(tree.includes(transferFailure));
      assert_m0.match(error instanceof Error ? error.message : String(error), /no local observer/u);
      return true;
    });
  });

  it_m0("retains every completed transfer-observer failure until close", async () => {
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
    const app = new Hono_m0<TestDashboardEnv>();
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

    await assert_m0.rejects(closeServer(server), (error: unknown) => {
      const tree = errorTree(error);
      for (const failure of [...transferFailures, ...observerFailures]) {
        assert_m0.ok(tree.includes(failure), `shutdown must retain ${failure.message}`);
      }
      return true;
    });
  });

  it_m0("propagates a real verified-byte route disconnect and settles its lease", async () => {
    const workspace = await mkdtemp_m0(join_m0(tmpdir_m0(), "hrauto-http-verified-route-"));
    const leaseClosed = Promise.withResolvers<void>();
    const transferReported = Promise.withResolvers<Error>();
    let routedRequest: Request | undefined;
    try {
      const artifacts = createContentAddressedArtifactWriter_m0({
        admission: RuntimeAdmission_m0.syntheticRoots(join_m0(workspace, ".tracker/data"), join_m0(workspace, ".tracker/data/artifacts")),
      });
      const ref = await artifacts.put(Buffer.alloc(2 * 1024 * 1024, 0x5a), {
        mediaType: "application/octet-stream",
      });
      const reader = createServerVerifiedArtifactReader_m0({
        admission: RuntimeAdmission_m0.syntheticRoots(join_m0(workspace, ".tracker/data"), join_m0(workspace, ".tracker/data/artifacts")),
        observeLeaseClosed: leaseClosed.resolve,
      });
      const app = new Hono_m0<TestDashboardEnv>();
      app.get("/artifacts/v1/:artifactId", async (context) => {
        routedRequest = context.req.raw;
        assert_m0.equal(context.req.param("artifactId"), ref.id);
        return verifiedByteResponse_m0({
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
      assert_m0.match(transferError.message, /response closed while waiting for drain/u);
      assert_m0.equal(routedRequest?.signal.aborted, true);
      await new Promise<void>((resolve) => setImmediate(resolve));
      await closeServer(server);
    } finally {
      await rm_m0(workspace, { recursive: true, force: true });
    }
  });

  it_m0("streams ordinary success bytes exactly and closes without a transfer error", async () => {
    const expected = Buffer.from([0x00, 0x01, 0x7f, 0x80, 0xfe, 0xff, 0x44]);
    const transferErrors: Error[] = [];
    const app = new Hono_m0<TestDashboardEnv>();
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

    assert_m0.equal(response.statusCode, 200);
    assert_m0.deepEqual(Buffer.concat(chunks), expected);
    assert_m0.deepEqual(connection.clientErrors, []);
    assert_m0.deepEqual(transferErrors, []);
  });
});
}

{


type TestDashboardEnv = { Variables: { requestActorId: ActorId_m1 } };

const MAX_PENDING = 4;
const worlds: DashboardWorld_m1[] = [];
const hubs: DashboardStreamHub_m1[] = [];
const servers = new Set<DashboardHttpServer_m1>();

const _afterEachFixture0 = async () => {
  for (const hub of hubs.splice(0)) hub.close();
  const open = [...servers];
  servers.clear();
  await Promise.all(open.map((server) => server.close()));
  for (const w of worlds.splice(0)) w.dispose();
};

function harness(): { w: DashboardWorld_m1; hub: DashboardStreamHub_m1 } {
  const w = makeWorld_m1();
  worlds.push(w);
  const hub = createDashboardStreamHub_m1({
    projection: w.projection,
    maxPending: MAX_PENDING,
    backfillGaps: {
      detected: (input: unknown) => Promise.resolve({ published: false as const, gap: BackfillGapObservationSchema_m1.parse(input) }),
    },
  });
  hubs.push(hub);
  queuedEventOf_m1(w, { seed: 1 });
  claimEventOf_m1(w, 1);
  return { w, hub };
}

/** Parse every COMPLETE event block; a trailing partial block is not an event yet. */
function parseSse(text: string): DashboardStreamEnvelope_m1[] {
  const blocks = text.split("\n\n");
  if (!text.endsWith("\n\n")) blocks.pop();
  return blocks.filter((block) => block.includes("data: ")).map((block) => {
    const data = block.split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n");
    return DashboardStreamEnvelopeSchema_m1.parse(JSON.parse(data));
  });
}

/** A node name wide enough that a few hundred patches fill the loopback buffers. */
const WIDE_NODE = "n".repeat(4096);

describe_m1("dashboard stream backpressure (bridge + Node adapter)", () => {
afterEach_m1(_afterEachFixture0);


  it_m1("Node adapter: a client that stops reading backs the hub up to its bound, resumes to one reset, and disconnect closes the connection", { timeout: 60_000 }, async () => {
    const { w, hub } = harness();
    const captured = Promise.withResolvers<DashboardStreamConnection_m1>();
    const app = new Hono_m1<TestDashboardEnv>();
    app.get("/events", async () => {
      const connection = await hub.connect({ day: DAY_m1 });
      captured.resolve(connection);
      return new Response(dashboardEventStreamBody_m1(connection), {
        status: 200,
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
      });
    });

    const transferErrors: Error[] = [];
    const server = await startDashboardHttpServer_m1({ app, port: 0, onTransferError: (error) => transferErrors.push(error) });
    servers.add(server);

    const response = await new Promise<IncomingMessage_m1>((resolve, reject) => {
      const client = request_m1({ hostname: "127.0.0.1", port: server.port, method: "GET", path: "/events" });
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
        taskEventsOf_m1(w, 1, `${WIDE_NODE}-${String(published)}`);
        published += 1;
      }
      await yieldMacrotask();
      stalled = connection.pending > 0;
    }
    assert_m1.ok(stalled, `the paused socket never stalled after ${String(published)} publishes`);
    await yieldMacrotask();
    assert_m1.ok(connection.pending > 0, "a real stall survives a further macrotask yield");
    for (let step = 0; step < 5 * MAX_PENDING; step += 1) taskEventsOf_m1(w, 1, `over-${String(step)}`);
    await yieldMacrotask();
    assert_m1.equal(connection.pending, 1, "one reset-required supersedes everything the socket could not take");

    const chunks: Buffer[] = [];
    const resetSeen = Promise.withResolvers<DashboardStreamEnvelope_m1[]>();
    response.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      const envelopes = parseSse(Buffer.concat(chunks).toString("utf8"));
      if (envelopes.some(({ type }) => type === "reset-required")) resetSeen.resolve(envelopes);
    });
    response.resume();
    const envelopes = await resetSeen.promise;
    assert_m1.deepEqual(envelopes.slice(0, 3).map(({ type }) => type), ["hello", "snapshot", "health"]);
    assert_m1.equal(envelopes.filter(({ type }) => type === "reset-required").length, 1);
    assert_m1.equal(envelopes.at(-1)?.type, "reset-required");
    assert_m1.ok(envelopes.slice(3, -1).every(({ type }) => type === "patch"), "no envelope is dropped or reordered before the reset");

    response.destroy();
    for (let attempt = 0; attempt < 50 && hub.subscriberCount() > 0; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    assert_m1.equal(hub.subscriberCount(), 0, "client disconnect closes the hub connection");
    assert_m1.equal(await connection.next(), undefined);
    for (let attempt = 0; attempt < 50 && transferErrors.length === 0; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    assert_m1.equal(transferErrors.length, 1, "the disconnect is observed exactly once, never swallowed");
    assert_m1.match(transferErrors[0]?.message ?? "", /closed while waiting for drain|disconnected/u);
  });
});
}
