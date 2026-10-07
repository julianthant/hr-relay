/**
 * The hub's pending bound must hold END TO END (ref frontend-backend-integration §3.5): through
 * the Web Stream bridge and through the real Node adapter to a client that
 * stopped reading. Before 2026-09-02 the route pushed every envelope into the
 * stream controller the moment the hub published it, so the bound guarded
 * only the window before subscription and a slow browser grew an unbounded
 * buffer the hub could not see.
 */
import assert from "node:assert/strict";
import { request, type IncomingMessage } from "node:http";
import { Hono } from "hono";
import { afterEach, describe, it } from "vitest";
import type { ActorId } from "../../../../../../src/rules/identity/ids.js";
import { DashboardStreamEnvelopeSchema, type DashboardStreamEnvelope } from "../../../../../../src/models/dashboard/subscription.js";
import { startDashboardHttpServer, type DashboardHttpServer } from "../../../../../../src/backend/transports/http/http-server.js";
import {
  createDashboardStreamHub,
  type DashboardStreamConnection,
  type DashboardStreamHub,
} from "../../../../../../src/backend/transports/http/subscriptions/dashboard-stream.js";
import { dashboardEventStreamBody } from "../../../../../../src/backend/transports/http/subscriptions/sse-response.js";
import { BackfillGapObservationSchema } from "../../../../../../src/backend/runs/notifications/backfill-gap.js";
import { claimEventOf, DAY, makeWorld, queuedEventOf, taskEventsOf, type DashboardWorld } from "../../../../../support/helpers/backend/dashboard-harness.js";

type TestDashboardEnv = { Variables: { requestActorId: ActorId } };

const MAX_PENDING = 4;
const worlds: DashboardWorld[] = [];
const hubs: DashboardStreamHub[] = [];
const servers = new Set<DashboardHttpServer>();

afterEach(async () => {
  for (const hub of hubs.splice(0)) hub.close();
  const open = [...servers];
  servers.clear();
  await Promise.all(open.map((server) => server.close()));
  for (const w of worlds.splice(0)) w.dispose();
});

function harness(): { w: DashboardWorld; hub: DashboardStreamHub } {
  const w = makeWorld();
  worlds.push(w);
  const hub = createDashboardStreamHub({
    projection: w.projection,
    maxPending: MAX_PENDING,
    backfillGaps: {
      detected: (input: unknown) => Promise.resolve({ published: false as const, gap: BackfillGapObservationSchema.parse(input) }),
    },
  });
  hubs.push(hub);
  queuedEventOf(w, { seed: 1 });
  claimEventOf(w, 1);
  return { w, hub };
}

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
  it("bridge: a reader that stops pulling leaves the hub bounded and reads exactly one reset-required on resume", async () => {
    const { w, hub } = harness();
    const connection = await hub.connect({ day: DAY });
    const body = dashboardEventStreamBody(connection);
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    for (let step = 0; step < connection.initial.length; step += 1) {
      const chunk = await reader.read();
      assert.equal(chunk.done, false);
      text += decoder.decode(chunk.value, { stream: true });
    }
    assert.deepEqual(parseSse(text).map(({ type }) => type), ["hello", "snapshot", "health"]);

    // Nobody reads. The bridge may hold at most one pulled chunk (its own
    // highWaterMark) plus one outstanding pull; everything else waits in the
    // hub, whose bound collapses it into one reset.
    for (let step = 0; step < 10 * MAX_PENDING; step += 1) taskEventsOf(w, 1, `node-${String(step)}`);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(connection.pending, 1, "the bridge holds at most its own highWaterMark; the hub holds exactly the one reset");

    const seen: DashboardStreamEnvelope[] = [];
    while (seen.filter(({ type }) => type === "reset-required").length === 0) {
      const chunk = await reader.read();
      assert.equal(chunk.done, false);
      seen.push(...parseSse(decoder.decode(chunk.value, { stream: true })));
    }
    // The chunks the bridge had already pulled before the bound tripped arrive
    // in order; the reset is the LAST state the connection carries.
    assert.equal(seen.at(-1)?.type, "reset-required");
    assert.ok(seen.slice(0, -1).every(({ type }) => type === "patch"));
    assert.equal(connection.pending, 0);

    await reader.cancel();
    assert.equal(hub.subscriberCount(), 0, "cancel closes the hub connection");
    assert.equal(await connection.next(), undefined);
  });

  it("bridge: a hub close ends the body cleanly and closes the connection exactly once", async () => {
    const { hub } = harness();
    const connection = await hub.connect({ day: DAY });
    const reader = dashboardEventStreamBody(connection).getReader();
    for (let step = 0; step < connection.initial.length; step += 1) await reader.read();
    const pendingRead = reader.read();
    hub.close();
    assert.deepEqual(await pendingRead, { done: true, value: undefined });
    assert.equal(hub.subscriberCount(), 0);
  });

  it("Node adapter: a client that stops reading backs the hub up to its bound, resumes to one reset, and disconnect closes the connection", { timeout: 60_000 }, async () => {
    const { w, hub } = harness();
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
    // The adapter reports a client that vanished mid-transfer to its local
    // observer and refuses to close silently without one — this test's ending
    // IS that disconnect, so the observer is part of the proof.
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

    // Publish until the socket stops draining — the kernel and Node absorb a
    // bounded number of bytes first — then well past the bound. Bounded loudly:
    // if the socket never fills, the test says so rather than passing vacuously.
    // A publish can land before the bridge's pull() microtask asks for it, so
    // "pending > 0" right after a publish proves nothing. Yield a macrotask
    // after EVERY publish: only a socket that has genuinely stopped draining
    // leaves an envelope pending across that yield.
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
