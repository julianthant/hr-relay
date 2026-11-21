import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DashboardDayWireSchema } from "../../../../../src/models/dashboard/projection.js";
import { DashboardStreamEnvelopeSchema, type DashboardStreamEnvelope } from "../../../../../src/models/dashboard/subscription.js";
import { startSeededServer, type SeededServer } from "./seeded-bff.js";

const servers: SeededServer[] = [];
const roots: string[] = [];
const streams: AbortController[] = [];

afterEach(async () => {
  for (const stream of streams.splice(0)) stream.abort();
  for (const server of servers.splice(0)) await server.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function boot(): Promise<SeededServer> {
  const distDir = mkdtempSync(join(tmpdir(), "hrauto-mock-dist-"));
  roots.push(distDir);
  writeFileSync(join(distDir, "index.html"), "<!doctype html><title>mock</title>");
  const server = await startSeededServer({
    distDir, productApp: true,
    bundle: { proof: "unverified", reason: "API/SSE route probe; the served dist is a one-file stub, never rendered" },
  });
  servers.push(server);
  return server;
}

/** The day stream as a client reads it: every envelope received so far. */
async function openStream(server: SeededServer): Promise<{ envelopes: DashboardStreamEnvelope[] }> {
  const abort = new AbortController();
  streams.push(abort);
  const response = await fetch(`${server.baseUrl}/events/v1?topics=dashboard-day:${server.day}`, { signal: abort.signal });
  expect(response.status).toBe(200);
  const envelopes: DashboardStreamEnvelope[] = [];
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("the event stream has no body");
  const decoder = new TextDecoder();
  let buffer = "";
  void (async () => {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return;
      buffer += decoder.decode(chunk.value, { stream: true });
      for (let end = buffer.indexOf("\n\n"); end !== -1; end = buffer.indexOf("\n\n")) {
        const data = buffer.slice(0, end).split("\n").find(line => line.startsWith("data: "));
        buffer = buffer.slice(end + 2);
        if (data !== undefined) envelopes.push(DashboardStreamEnvelopeSchema.parse(JSON.parse(data.slice(6))));
      }
    }
  })().catch(() => undefined);
  await expect.poll(() => envelopes.map(({ type }) => type)).toEqual(["hello", "snapshot", "health"]);
  return { envelopes };
}

async function rowOf(server: SeededServer, runId: string) {
  const response = await fetch(`${server.baseUrl}/api/v1/dashboard?day=${server.day}`);
  const row = DashboardDayWireSchema.parse(await response.json()).queueSurfaces.find(surface => surface.runId === runId);
  if (row === undefined) throw new Error(`run ${runId} is not on the seeded day`);
  return row;
}

describe("seeded drive helpers", () => {
  it("starts the seeded queued run and tells the open stream", async () => {
    const server = await boot();
    const stream = await openStream(server);
    expect((await rowOf(server, server.runIds.queuedRun ?? "")).status).toBe("queued");

    const runId = server.drive.startQueuedRun();

    expect(runId).toBe(server.runIds.queuedRun);
    expect((await rowOf(server, runId)).status).toBe("running");
    await expect.poll(() => stream.envelopes.length).toBeGreaterThan(3);
    expect((await fetch(`${server.baseUrl}/api/v1/runs/${runId}`)).status).toBe(200);
  });

  it("finishes the running run's open step as one row change", async () => {
    const server = await boot();
    const stream = await openStream(server);
    const before = await rowOf(server, server.runIds.runningRun ?? "");

    const runId = server.drive.finishRunningStep();

    expect(runId).toBe(server.runIds.runningRun);
    expect((await rowOf(server, runId)).pipeline).not.toEqual(before.pipeline);
    await expect.poll(() => stream.envelopes.slice(3).map(({ type }) => type)).toEqual(["change"]);
    const change = stream.envelopes[3];
    const snapshot = stream.envelopes[1];
    if (change?.type !== "change" || snapshot?.type !== "snapshot") throw new Error("expected a snapshot and a change");
    expect(change.day?.target.runId).toBe(runId);
    expect(change.after).toBe(snapshot.cursor);
  });

  it("parks the running run at its declared node with a healthy detail read", async () => {
    const server = await boot();
    const stream = await openStream(server);

    const runId = server.drive.parkRunningRunAtGate();

    expect((await rowOf(server, runId)).status).toBe("awaiting-approval");
    await expect.poll(() => stream.envelopes.length).toBeGreaterThan(3);
    expect((await fetch(`${server.baseUrl}/api/v1/runs/${runId}`)).status).toBe(200);
    expect((await fetch(`${server.baseUrl}/api/v1/runs/${runId}/identity-gate`)).status).toBe(200);
  });

  it("publishes a notification to the open stream", async () => {
    const server = await boot();
    const stream = await openStream(server);

    await server.drive.publishNotification();

    await expect.poll(() => stream.envelopes.slice(3).map(({ type }) => type)).toContain("notification-publication");
  });
});
