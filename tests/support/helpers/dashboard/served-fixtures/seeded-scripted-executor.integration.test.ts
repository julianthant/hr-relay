import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DashboardDayWireSchema } from "../../../../../src/models/dashboard/projection.js";
import { RunDetailWireSchema } from "../../../../../src/models/dashboard/run-detail.js";
import { SEEDED_NOW, startSeededServer, type SeededServer } from "./seeded-bff.js";
import { approveScriptedGate, seededRequestOver, startScriptedRun } from "./seeded-scripted-executor.js";

const servers: SeededServer[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function boot(): Promise<SeededServer> {
  const distDir = mkdtempSync(join(tmpdir(), "hrauto-scripted-dist-"));
  roots.push(distDir);
  writeFileSync(join(distDir, "index.html"), "<!doctype html><title>scripted</title>");
  const server = await startSeededServer({ distDir, productApp: true,
    bundle: { proof: "unverified", reason: "API probe of the scripted executor; the served dist is a one-file stub, never rendered" } });
  servers.push(server);
  return server;
}

describe("seeded scripted executor", () => {
  it("drives a started run through its declared steps and gate to done, recording its write once", async () => {
    const server = await boot();
    const request = seededRequestOver(server.baseUrl);
    const status = async (runId: string) => RunDetailWireSchema.parse(await request(`/api/v1/runs/${runId}`)).header.status;
    const worker = async () => DashboardDayWireSchema.parse(await request(`/api/v1/dashboard?day=${server.day}`))
      .workerCards.filter(card => card.workflowId === "work-study").map(card => card.state);
    const written = server.scripted.writes().length;

    const runId = await startScriptedRun(request, SEEDED_NOW, "10812345", server.scripted.reviewReference());
    expect(await status(runId)).toBe("queued");

    const run = await server.scripted.drive(runId);
    expect(run.position).toEqual({ at: "step", nodeId: "paypath-position" });
    expect(await status(runId)).toBe("running");
    expect(await worker()).toEqual(["running"]);
    expect(await run.advance()).toMatchObject({ at: "settled", outcome: { state: "parked-gate", gateId: "reference-check-review" } });
    expect(await status(runId)).toBe("awaiting-approval");
    expect(await worker()).toEqual(["idle"]);
    expect(server.scripted.writes().length).toBe(written);

    await approveScriptedGate(request, SEEDED_NOW, runId);
    const resumed = await server.scripted.drive(runId);
    // The resumed run reads PayPath again before it writes: the read guards the transaction and is never replayed from a checkpoint.
    expect(resumed.position).toEqual({ at: "step", nodeId: "paypath-position" });
    expect(await resumed.advance()).toEqual({ at: "step", nodeId: "save-transaction" });
    expect(server.scripted.writes().length).toBe(written);
    expect(await resumed.advance()).toMatchObject({ at: "settled", outcome: { state: "done" } });
    expect(await status(runId)).toBe("done");
    expect(server.scripted.writes().slice(written)).toEqual([{ runId, nodeId: "save-transaction", eid: "10812345" }]);
  });

  it("refuses to drive a run that is not the queue head and leaves the head claimable", async () => {
    const server = await boot();
    const request = seededRequestOver(server.baseUrl);
    const status = async (runId: string) => RunDetailWireSchema.parse(await request(`/api/v1/runs/${runId}`)).header.status;
    const head = await startScriptedRun(request, SEEDED_NOW, "10812345");
    const later = await startScriptedRun(request, SEEDED_NOW, "10812346");

    await expect(server.scripted.drive(later)).rejects.toThrow(`${later} is not the oldest queued scripted run`);
    expect([await status(head), await status(later)]).toEqual(["queued", "queued"]);

    expect(await (await server.scripted.drive(head)).finish()).toMatchObject({ state: "done" });
    expect(await (await server.scripted.drive(later)).finish()).toMatchObject({ state: "done" });
  });

  it("refuses to park a write whose step was already released, and the released Save completes", async () => {
    const server = await boot();
    const request = seededRequestOver(server.baseUrl);
    const written = server.scripted.writes().length;
    const runId = await startScriptedRun(request, SEEDED_NOW, "10812345");
    const run = await server.scripted.drive(runId);
    expect(await run.advance()).toEqual({ at: "step", nodeId: "save-transaction" });

    const released = run.advance();
    await expect(run.parkWrite()).rejects.toThrow("holds no step to answer");
    expect(await released).toMatchObject({ at: "settled", outcome: { state: "done" } });
    expect(RunDetailWireSchema.parse(await request(`/api/v1/runs/${runId}`)).header.status).toBe("done");
    expect(server.scripted.writes().slice(written)).toEqual([{ runId, nodeId: "save-transaction", eid: "10812345" }]);
  });

  it("records each seeded write once: the written and the parked run, never the failed or the gated one", async () => {
    const server = await boot();
    const writesOf = (role: string) => server.scripted.writes().filter(write => write.runId === server.runIds[role]).length;
    expect({ written: writesOf("writtenRun"), parked: writesOf("parkedRun"), failed: writesOf("failedRun"), gated: writesOf("openGateRun") })
      .toEqual({ written: 1, parked: 1, failed: 0, gated: 0 });
    expect(server.scripted.writes().length).toBe(2);
  });
});
