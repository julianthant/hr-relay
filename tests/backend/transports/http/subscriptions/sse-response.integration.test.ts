import { createStreamBackpressureFixtures } from "../../../../support/helpers/backend/stream-backpressure-fixtures.js";

import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";

import { type DashboardHttpServer } from "../../../../../src/backend/transports/http/http-server.js";
import {
type DashboardStreamHub
} from "../../../../../src/backend/transports/http/subscriptions/dashboard-stream.js";
import { dashboardEventStreamBody } from "../../../../../src/backend/transports/http/subscriptions/sse-response.js";
import { DashboardStreamEnvelopeSchema,type DashboardStreamEnvelope } from "../../../../../src/models/dashboard/subscription.js";
import { DAY, taskEventsOf, type DashboardWorld } from "../../../../support/helpers/backend/dashboard-harness.js";

const MAX_PENDING = 4;
const worlds: DashboardWorld[] = [];
const hubs: DashboardStreamHub[] = [];
const servers = new Set<DashboardHttpServer>();

afterEach(async () => {
  for (const hub of hubs.splice(0)) hub.close();
  const open = [...servers];
  servers.clear();
  await Promise.all(open.map((server) => server.close()));
  for (const w of worlds.splice(0)) await w.dispose();
});

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

describe("dashboard stream backpressure (bridge + Node adapter)", () => {
  it("bridge: a reader that stops pulling leaves the hub bounded and reads exactly one reset-required on resume", async () => {
    const { w, hub } = await harness();
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

    // The bridge holds its pulled chunk and outstanding pull; the bounded hub owns all remaining work.
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
    const { hub } = await harness();
    const connection = await hub.connect({ day: DAY });
    const reader = dashboardEventStreamBody(connection).getReader();
    for (let step = 0; step < connection.initial.length; step += 1) await reader.read();
    const pendingRead = reader.read();
    hub.close();
    assert.deepEqual(await pendingRead, { done: true, value: undefined });
    assert.equal(hub.subscriberCount(), 0);
  });
});
