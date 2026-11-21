import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DashboardDayWireSchema } from "../../../../../src/models/dashboard/projection.js";
import { RunDetailWireSchema } from "../../../../../src/models/dashboard/run-detail.js";
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

/** Every status the stream itself has delivered for one run's row, in order. */
function streamedStatuses(envelopes: readonly DashboardStreamEnvelope[], runId: string): string[] {
  return envelopes.flatMap(envelope => {
    if (envelope.type === "snapshot") return envelope.payload.queueSurfaces.filter(surface => surface.runId === runId).map(surface => surface.status);
    if (envelope.type === "change" && envelope.day?.operation === "replace-queue-surface" && envelope.day.target.runId === runId) return [envelope.day.replacement.status];
    return [];
  });
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

  it("parks a Work-Study run at the gate its workflow declares, through the executor", async () => {
    const server = await boot();
    const stream = await openStream(server);

    const runId = await server.drive.startDeclaredGateRun();
    await expect.poll(() => streamedStatuses(stream.envelopes, runId).at(-1), { message: "the stream delivers the running row" }).toBe("running");

    expect(await server.drive.parkAtDeclaredGate()).toBe(runId);

    await expect.poll(() => streamedStatuses(stream.envelopes, runId).at(-1), { message: "the stream delivers the parked row" }).toBe("awaiting-approval");
    expect((await rowOf(server, runId)).workflowId).toBe("work-study");
    const detail = await fetch(`${server.baseUrl}/api/v1/runs/${runId}`);
    expect(detail.status).toBe(200);
    const logs = await fetch(`${server.baseUrl}/api/v1/runs/${runId}/logs`);
    expect(logs.status, await logs.clone().text()).toBe(200);
    const { gate } = RunDetailWireSchema.parse(await detail.json());
    if (gate.state !== "open") throw new Error(`the parked run serves a ${gate.state} gate`);
    expect([gate.nodeId, gate.decision?.type]).toEqual(["reference-check-review", "review-before-write"]);
    const cursors = stream.envelopes.flatMap(envelope => envelope.type === "change" || envelope.type === "snapshot" ? [envelope] : []);
    for (const [index, envelope] of cursors.entries()) {
      if (envelope.type === "change") expect(envelope.after).toBe(cursors[index - 1]?.cursor);
    }
  });

  it("stops cleanly with the run still held at its read", async () => {
    const server = await boot();
    const runId = await server.drive.startDeclaredGateRun();
    expect((await rowOf(server, runId)).status).toBe("running");

    await server.close();
    await expect(server.drive.parkAtDeclaredGate()).rejects.toThrow("no declared-gate run is held");
  });

  it("parks the running Person Lookup run at its task node with a healthy detail read", async () => {
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
