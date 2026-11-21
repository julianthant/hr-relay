import { isQueueTopLevel } from "../../../../../src/models/dashboard/queue-parent.js";

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
import { AssistantActivityWireSchema } from "../../../../../src/models/dashboard/assistant.js";
import { WorkbookCompatibilitySchema } from "../../../../../src/models/dashboard/workbook-library.js";
import { PreflightReadinessWireSchema } from "../../../../../src/models/preflight/preflight-contract.js";
import { PublicProfileStateSchema } from "../../../../../src/models/profiles/public-profile.js";
import { createDashboardClient } from "../../../../../src/dashboard/client/index.js";
import { readRunLogs } from "../../../../../src/dashboard/state/run-wiring-adapter.js";
import { SEEDED_COVERAGE_GAPS,startSeededServer,type SeededScenarios,type SeededServer } from "./seeded-bff.js";
import { SEEDED_PAST_DAYS } from "./seeded-lifecycle.js";

const servers: SeededServer[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function boot(options?: SeededScenarios & { productApp: true }): Promise<SeededServer> {
  const distDir = mkdtempSync(join(tmpdir(), "hrauto-mock-dist-"));
  roots.push(distDir);
  writeFileSync(join(distDir, "index.html"), "<!doctype html><title>mock</title>");
  // API-only probe: nothing renders the app here, so the bundle is declared
  // unverified instead of demanding a working-tree build.
  const server = await startSeededServer({
    ...options,
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

describe("seeded mock BFF (adapter #2 — real machinery)", () => {
  it("serves a strict bootstrap document", async () => {
    const server = await boot();
    const bootstrap = FrontendBootstrapWireSchema.parse(
      await (await fetch(`${server.baseUrl}/api/v1/bootstrap`)).json(),
    );
    expect(bootstrap.appVersion).toBe("0.1.0");
    expect(bootstrap.workflows.map(workflow => workflow.id)).toEqual(["person-lookup", "work-study"]);
  });

  it.each(["seeded", "empty"] as const)("serves %s workbook sources and scoped readiness for the workflow catalog", async workbookCompatibility => {
    const server = await boot({ productApp: true, workbookCompatibility });
    const response = await fetch(`${server.baseUrl}/api/v1/workbooks/compatibility`);
    expect(response.ok).toBe(true);
    const compatibility = WorkbookCompatibilitySchema.parse(await response.json());
    const servedIds = ["person-lookup", "separations", "i9-check-start", "onboarding", "work-study", "emergency-contact"];
    expect(compatibility.workflows.map(workflow => workflow.workflowId)).toEqual(expect.arrayContaining(servedIds));
    for (const workflow of compatibility.workflows.filter(workflow => workflow.workbookReference !== undefined)) {
      if (workbookCompatibility === "empty") expect(workflow.sources).toEqual([]);
      else expect(workflow.sources.length, workflow.workflowId).toBeGreaterThan(0);
    }
    for (const workflowId of servedIds) {
      const url = new URL("/api/v1/preflight", server.baseUrl);
      url.searchParams.set("selection", JSON.stringify({ workflowId }));
      const readiness = PreflightReadinessWireSchema.parse(await (await fetch(url)).json());
      expect(readiness.state, workflowId).toBe("present");
      if (readiness.state === "present") {
        expect(readiness.report.requestedCapabilities).toContain("executor.run");
        expect(readiness.report.results.map(result => result.status)).toEqual(readiness.report.results.map(() => "pass"));
      }
    }
  });

  it.each(["logout", "delete-account"] as const)("serves account edits and %s against the seeded profile", async route => {
    const { baseUrl } = await boot({ productApp: true });
    const post = (path: string, body: unknown) => fetch(`${baseUrl}/api/v1/profile/${path}`, {
      method: "POST", headers: { origin: baseUrl, "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const response = await post("account/details", { initials: "QA" });
    expect(response.ok).toBe(true);
    expect(await response.json()).toMatchObject({ state: "changed", account: { initials: "QA" } });
    const stateUrl = `${baseUrl}/api/v1/profile/state`;
    const active = PublicProfileStateSchema.parse(await (await fetch(stateUrl)).json());
    expect(active).toMatchObject({ state: "active", account: { initials: "QA" } });
    if (active.state !== "active") throw new Error("seeded profile is not active");
    const ended = await post(route, route === "logout" ? {} : { confirmed: true, expectedProfileId: active.profileId, expectedEpoch: active.epoch });
    const signedOut = { state: "signed-out", signUpRequired: route === "delete-account" };
    expect(ended.ok).toBe(true);
    expect(await ended.json()).toEqual(signedOut);
    expect(await (await fetch(stateUrl)).json()).toEqual(signedOut);
  });

  it("serves assistant activity from the seeded history", async () => {
    const { baseUrl, day } = await boot({ productApp: true });
    const response = await fetch(`${baseUrl}/api/v1/assistant/activity`);
    expect(response.ok).toBe(true);
    expect(AssistantActivityWireSchema.parse(await response.json())).toEqual({ day, rows: [] });
  });

  it("projects one queue surface per seeded role with the expected status", async () => {
    const server = await boot();
    const day = DashboardDayWireSchema.parse(
      await dashboardDay(server.baseUrl, server.day),
    );
    // Keyed by the plain string: run ids are branded on the wire, and the
    // seed reports them as the raw ids a mock spec would address.
    const byId = new Map(day.queueSurfaces.map((surface) => [String(surface.runId), surface]));

    const expected: readonly [string, string][] = [
      ["queuedRun", "queued"],
      ["runningRun", "running"],
      ["doneRun", "done"],
      ["failedRun", "failed"],
      ["openGateRun", "awaiting-approval"],
      ["parkedRun", "blocked"],
      ["cancelledRun", "cancelled"],
      // An interrupted run waits on the operator to recover it.
      ["interruptedRun", "blocked"],
      ["writtenRun", "done"],
      // The queue shows a discarded or superseded run as cancelled.
      ["discardedRun", "cancelled"],
      ["supersededRun", "cancelled"],
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
    expect(member?.surfaceKind).toBe("single");
    expect(member?.parent?.runId).toBe(server.runIds.groupRun);
    expect(member?.parent?.visibility).toBe("inline");
  });

  it("keeps counts on the one path, excluding member surfaces", async () => {
    const server = await boot();
    const day = DashboardDayWireSchema.parse(
      await dashboardDay(server.baseUrl, server.day),
    );
    const countable = day.queueSurfaces.filter((surface) => isQueueTopLevel(surface));

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

  it("serves the failed run's detail, failure section, and the logs its read recorded", async () => {
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
    if (failure.section !== "failure" || failure.payload.state !== "available") throw new Error(`expected an available failure section: ${JSON.stringify(failure)}`);
    expect(failure.payload.value.failureId).toBe(server.runIds.failureId);
    // The run's own terminal event, which the Logs feed orders the failure by.
    expect(failure.payload.value.native).toMatchObject({ runId, nodeId: "save-transaction" });

    const logs = RunDetailSectionResponseSchema.parse(
      await (await fetch(`${server.baseUrl}/api/v1/runs/${runId}/logs`)).json(),
    );
    if (logs.section !== "logs") throw new Error("expected the logs section");
    // What the run observed before it failed: the PayPath read and the plan made from it. The error itself is the failure section's.
    const observed = (logs.payload.rows ?? []).flatMap(row => row.kind === "observed" ? [row.producer.nodeId] : []);
    expect(new Set(observed)).toEqual(new Set(["paypath-position", "transaction-plan"]));
  });


  it("serves the parked run's section from the write the executor fenced and parked", async () => {
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
    expect(section.payload.native).toMatchObject({ runId, nodeId: "save-transaction" });
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

  it("serves every seeded run with logs the dashboard's identity checks accept", async () => {
    const server = await boot();
    const client = createDashboardClient({ baseUrl: server.baseUrl });
    const day = DashboardDayWireSchema.parse(await dashboardDay(server.baseUrl, server.day));
    const roles = Object.entries(server.runIds).filter(([role]) => role !== "failureId");
    expect(roles.map(([role]) => role)).toEqual(expect.arrayContaining(["failedRun", "openGateRun", "parkedRun"]));
    for (const [role, runId] of roles) {
      const row = day.queueSurfaces.find(surface => String(surface.runId) === runId);
      if (row === undefined) throw new Error(`${role} is absent from the projection`);
      const snapshot = await readRunLogs(client, { row, workflowLabel: role }, new AbortController().signal);
      expect(snapshot.detail.runId, role).toBe(runId);
    }
  });

  it("seeds more than 25 runs across several days", async () => {
    const server = await boot();
    const days = Array.from({ length: SEEDED_PAST_DAYS + 1 }, (_, back) =>
      new Date(Date.parse(`${server.day}T12:00:00.000Z`) - back * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
    const counts = await Promise.all(days.map(async day =>
      DashboardDayWireSchema.parse(await dashboardDay(server.baseUrl, day)).queueSurfaces.length));
    expect(counts.every(count => count > 0), JSON.stringify(counts)).toBe(true);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBeGreaterThan(25);
  });

  it("seeds the worker states the projection derives", async () => {
    const server = await boot();
    const day = DashboardDayWireSchema.parse(await dashboardDay(server.baseUrl, server.day));
    expect(new Set(day.workerCards.map(card => card.state))).toEqual(new Set(["idle", "running", "waiting", "paused", "failed"]));
  });

  it("lists as coverage gaps exactly the states its day does not serve", async () => {
    const server = await boot();
    const day = DashboardDayWireSchema.parse(await dashboardDay(server.baseUrl, server.day));
    const rows = day.queueSurfaces;
    const unreachable = [
      ["status 'partial'", rows.some(row => row.status === "partial")],
      ["surfaceKind 'preview'", rows.some(row => row.surfaceKind === "preview")],
      ["worker-card state 'starting'", day.workerCards.some(card => card.state === "starting")],
      ["liveMessage 'present' on a NON-failed row", rows.some(row => row.status !== "failed" && row.liveMessage.state === "present")],
      ["warnings 'present'", rows.some(row => row.warnings.state === "present")],
    ] as const;
    expect(unreachable.filter(([, served]) => served).map(([gap]) => gap)).toEqual([]);
    expect(SEEDED_COVERAGE_GAPS.map(gap => unreachable.findIndex(([name]) => gap.startsWith(`${name}:`)))).toEqual([0, 1, 2, 3, 4]);
    // Reachable, so no longer listed: a failed row's sentence and a done row's subtitle.
    expect(rows.some(row => row.liveMessage.state === "present")).toBe(true);
    expect(rows.some(row => row.subtitle.state === "present")).toBe(true);
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
