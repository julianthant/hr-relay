
import { mkdtempSync,rmSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,describe,expect,it } from "vitest";
import { FrontendBootstrapWireSchema } from "../../../../../src/models/dashboard/bootstrap.js";
import { DashboardDayWireSchema } from "../../../../../src/models/dashboard/projection.js";
import {
RunDetailSectionResponseSchema,
RunDetailWireSchema,
} from "../../../../../src/models/dashboard/run-detail.js";
import { DashboardStreamEnvelopeSchema } from "../../../../../src/models/dashboard/subscription.js";
import { startSeededServer,type SeededServer } from "./seeded-bff.js";

const servers: SeededServer[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function boot(): Promise<SeededServer> {
  const distDir = mkdtempSync(join(tmpdir(), "hrauto-parity-dist-"));
  roots.push(distDir);
  writeFileSync(join(distDir, "index.html"), "<!doctype html><title>parity</title>");
  // API-only probe: nothing renders the app here, so the bundle is declared
  // unverified instead of demanding a working-tree build.
  const server = await startSeededServer({
    distDir,
    bundle: { proof: "unverified", reason: "API/SSE route probe; the served dist is a one-file stub, never rendered" },
  });
  servers.push(server);
  return server;
}

async function dashboardDay(baseUrl: string, day: string) {
  const response = await fetch(`${baseUrl}/api/v1/dashboard?day=${day}`);
  const body: unknown = await response.json();
  expect(response.ok, JSON.stringify(body)).toBe(true);
  return body;
}

describe("seeded parity BFF (adapter #2 — real machinery)", () => {
  it("serves a strict bootstrap document", async () => {
    const server = await boot();
    const bootstrap = FrontendBootstrapWireSchema.parse(
      await (await fetch(`${server.baseUrl}/api/v1/bootstrap`)).json(),
    );
    expect(bootstrap.appVersion).toBe("0.1.0");
    expect(bootstrap.workflows.length).toBe(1);
  });

  it("projects one queue surface per seeded role with the expected status", async () => {
    const server = await boot();
    const day = DashboardDayWireSchema.parse(
      await dashboardDay(server.baseUrl, server.day),
    );
    // Keyed by the plain string: run ids are branded on the wire, and the
    // seed reports them as the raw ids a parity spec would address.
    const byId = new Map(day.queueSurfaces.map((surface) => [String(surface.runId), surface]));

    const expected: readonly [string, string][] = [
      ["queuedRun", "queued"],
      ["runningRun", "running"],
      ["doneRun", "done"],
      ["failedRun", "failed"],
      ["openGateRun", "awaiting-approval"],
      ["parkedRun", "blocked"],
      ["cancelledRun", "cancelled"],
    ];
    for (const [role, status] of expected) {
      const surface = byId.get(server.runIds[role]);
      expect(surface, `${role} is absent from the projection`).toBeDefined();
      expect(surface?.status, `${role} status`).toBe(status);
    }

    const group = byId.get(server.runIds.groupRun);
    expect(group?.surfaceKind).toBe("operation");
    expect(group?.panelKind).toBe("group");
    if (group?.surfaceKind === "operation") {
      expect(group.memberRunIds.length).toBe(3);
      expect(group.memberRollup.total).toBe(3);
    }
    const member = byId.get(server.runIds.memberRun);
    expect(member?.surfaceKind).toBe("member");
    expect(member?.lineage).toEqual({ state: "child", parentRunId: server.runIds.groupRun });
  });

  it("keeps counts on the one path, excluding member surfaces", async () => {
    const server = await boot();
    const day = DashboardDayWireSchema.parse(
      await dashboardDay(server.baseUrl, server.day),
    );
    const countable = day.queueSurfaces.filter((surface) => surface.surfaceKind !== "member");

    const statuses = new Map<string, number>();
    for (const surface of countable) {
      statuses.set(surface.status, (statuses.get(surface.status) ?? 0) + 1);
    }
    expect(new Map(day.statusCounts.map(({ status, count }) => [status, count]))).toEqual(statuses);

    const workflowTotal = day.workflowCounts.reduce((sum, { count }) => sum + count, 0);
    expect(workflowTotal).toBe(countable.length);

    const dayCount = day.monthCounts.find(({ day: value }) => value === server.day);
    expect(dayCount?.count).toBe(countable.length);
  });

  it("serves the failed run's detail, failure section, and note-backed logs", async () => {
    const server = await boot();
    const runId = server.runIds.failedRun;

    const detail = RunDetailWireSchema.parse(
      await (await fetch(`${server.baseUrl}/api/v1/runs/${runId}`)).json(),
    );
    expect(detail.panelKind).toBe("run");
    expect(detail.availableSections).toContain("failure");
    expect(detail.header.status).toBe("failed");

    const failure = RunDetailSectionResponseSchema.parse(
      await (await fetch(`${server.baseUrl}/api/v1/runs/${runId}/failure`)).json(),
    );
    expect(failure.section).toBe("failure");
    if (failure.section === "failure") {
      expect(failure.payload.state).toBe("available");
      if (failure.payload.state === "available") {
        expect(failure.payload.value.failureId).toBe(server.runIds.failureId);
      }
    }

    const logs = RunDetailSectionResponseSchema.parse(
      await (await fetch(`${server.baseUrl}/api/v1/runs/${runId}/logs`)).json(),
    );
    if (logs.section !== "logs") throw new Error("expected the logs section");
    expect(logs.payload.notes.length).toBeGreaterThan(0);
    expect(logs.payload.notes.some(({ level }) => level === "error")).toBe(true);
  });


  it("serves the parked run's section from a real fenced-and-parked write intent", async () => {
    const server = await boot();
    const runId = server.runIds.parkedRun;

    const detail = RunDetailWireSchema.parse(
      await (await fetch(`${server.baseUrl}/api/v1/runs/${runId}`)).json(),
    );
    expect(detail.availableSections).toContain("parked-write");

    expect(detail.header.status).toBe("blocked");

    const response = await fetch(`${server.baseUrl}/api/v1/runs/${runId}/parked-write`);
    expect(response.status, "a parked run with no intent answers 500, not an empty panel").toBe(200);
    const section = RunDetailSectionResponseSchema.parse(await response.json());
    if (section.section !== "parked-write") throw new Error("expected the parked-write section");
    expect(section.payload.acceptsTransactionId).toBe(false);
    expect(section.payload.generation).toBe(1);
    expect(section.payload.system).toBe("ucpath");
    expect(section.payload.subject.state).toBe("subject-match");
    // Both typed resolutions, both intent-scoped, both confirm-first — the
    // three properties a surface may not supply for itself.
    expect(section.payload.actions.map((action) => action.kind === "command" && action.command))
      .toEqual(["recheck-write", "resolve-write-absent"]);
    for (const action of section.payload.actions) {
      if (action.kind !== "command") throw new Error("expected a command descriptor");
      expect(action.confirm).toBeDefined();
      expect(action.writeTarget?.intentGeneration).toBe(1);
    }
  });

  it("opens a resumable stream whose first envelope parses", async () => {
    const server = await boot();
    const controller = new AbortController();
    try {
      const response = await fetch(`${server.baseUrl}/events/v1?topics=dashboard-day:${server.day}`, {
        headers: { accept: "text/event-stream" },
        signal: controller.signal,
      });
      expect(response.ok).toBe(true);
      if (response.body === null) throw new Error("the stream carried no body");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let block: string | undefined;
      while (block === undefined) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error("the stream closed before its first envelope");
        buffer += decoder.decode(chunk.value, { stream: true });
        const boundary = buffer.indexOf("\n\n");
        if (boundary !== -1) block = buffer.slice(0, boundary);
      }
      const dataLine = block.split("\n").find((line) => line.startsWith("data: "));
      if (dataLine === undefined) throw new Error(`the first event carried no data: ${block}`);
      const envelope = DashboardStreamEnvelopeSchema.parse(JSON.parse(dataLine.slice(6)));
      expect(envelope.type).toBe("hello");
    } finally {
      controller.abort();
    }
  });
});
