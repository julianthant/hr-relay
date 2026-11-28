import { createHash } from "node:crypto";
import { createProfileFixtureSet } from "../../../../support/helpers/admission-fixture.js";
import { composedQueueLane, refuseMainReads } from "../../../../support/helpers/backend/composed-queue-lane.js";
import { BackfillGapObservationSchema } from "../../../../../src/backend/runs/notifications/backfill-gap.js";
import type { StartPlanService } from "../../../../../src/backend/runs/commands/start-plan-service.js";
import { registerQueueRoutes } from "../../../../../src/backend/transports/http/routes/queue.js";
import { registerShellRoutes } from "../../../../../src/backend/transports/http/routes/shell.js";
import type { ShellRouteDeps } from "../../../../../src/backend/transports/http/routes/shell-types.js";
import type { QueueRouteDeps } from "../../../../../src/backend/transports/http/routes/queue-types.js";
import { createDashboardStreamHub } from "../../../../../src/backend/transports/http/subscriptions/dashboard-stream.js";
import { DashboardStreamEnvelopeSchema } from "../../../../../src/models/dashboard/subscription.js";
import { searchPartitionDay } from "../../../../../src/models/dashboard/search-calendar.js";
import { foreignOriginCases } from "../../../../support/helpers/backend/http-route-harness.js";
import { Hono } from "hono";
import assert from "node:assert/strict";
import { afterAll, it, afterEach, describe, expect, vi } from "vitest";
import { type DashboardApp } from "../../../../../src/backend/transports/http/routes/api-types.js";
import { StartPlanWireSchema } from "../../../../../src/models/dashboard/start-plan.js";
import { CommandResultSchema } from "../../../../../src/rules/commands/commands.js";
import { servedPreflightRuntime } from "../../../../support/fixtures/preflight/served-runtime.js";
import { installRunOperationsRoutes } from "../../../../support/fixtures/run-operations.js";
import { singleAppliedRunId } from "../../../../support/fixtures/operator-command-fixtures.js";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { readTimelineRecords, timelineSpanLocation } from "../../../../../src/backend/storage/events/timeline-reader.js";
import { RunDetailSectionResponseSchema } from "../../../../../src/models/dashboard/run-detail.js";
import { DAY } from "../../../../support/helpers/backend/dashboard-harness.js";
import { OPERATOR_JSON_HEADERS, captureDiagnosticBundle, disposeHttpRouteHarness, harness, json } from "../../../../support/helpers/backend/http-route-harness.js";

const profileFixtures = createProfileFixtureSet();
afterAll(() => profileFixtures.close());

{
it("shared Setup admission refuses a late fault without consuming review, then exact replay remains read-only", async () => {
  const setup = await servedPreflightRuntime("healthy");
  try {
    const app: DashboardApp = new Hono(); const h = installRunOperationsRoutes(app, setup);
    const post = (path: string, body: unknown) => app.request(`http://localhost${path}`, { method: "POST",
      headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify(body) });
    const response = await post("/api/v1/start-plans", { workflowId: setup.scope, submissions: [{ emplId: "10873698" }], dryRun: false });
    assert.equal(response.status, 200);
    const plan = StartPlanWireSchema.parse(await response.json());
    assert.equal(plan.planned.length, 1, JSON.stringify(plan));
    assert.equal(h.runs().length, 0); assert.equal(h.mintedRunIdentities, 0); assert.equal(h.publications, 0);
    const command = { commandId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", requestedAt: setup.clock.now().toISOString(),
      requestedBy: "local-operator", source: "dashboard", family: "start", type: "start-run",
      target: { workflowId: plan.workflowId, startPlanId: plan.startPlanId, expectedVersion: plan.expectedVersion }, payload: plan.fingerprints };
    h.fault(); await setup.runtime.admission.prepare(setup.runtime.currentScope(setup.scope), new AbortController().signal);
    const rejected = CommandResultSchema.parse(await (await post("/api/v1/commands", command)).json());
    assert.equal(rejected.state, "rejected"); assert.equal(h.runs().length, 0); assert.equal(h.publications, 0);
    assert.equal(setup.database.authority.startPlans.get(plan.startPlanId)?.consumedBy, undefined);
    h.repair(); await setup.runtime.admission.prepare(setup.runtime.currentScope(setup.scope), new AbortController().signal);
    const freshCommand = { ...command, commandId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" };
    const applied = CommandResultSchema.parse(await (await post("/api/v1/commands", freshCommand)).json());
    assert.equal(applied.state, "applied"); assert.equal(h.publications, 1, JSON.stringify(applied));
    const run = h.runs()[0]; assert.ok(run); assert.equal(run.lifecycle.state, "queued"); assert.equal(run.envelope.dryRun, false);
    h.fault(); await setup.runtime.admission.prepare(setup.runtime.currentScope(setup.scope), new AbortController().signal);
    const before = JSON.stringify({ meta: setup.database.getMeta(), runs: h.runs(), minted: h.mintedRunIdentities });
    const replay = CommandResultSchema.parse(await (await post("/api/v1/commands", freshCommand)).json());
    assert.deepEqual(replay, { ...applied, state: "already-applied" }); assert.equal(h.publications, 1);
    assert.equal(JSON.stringify({ meta: setup.database.getMeta(), runs: h.runs(), minted: h.mintedRunIdentities }), before);
  } finally { await setup.close(); }
});
}

{
describe("BFF spine flow (start plan -> kernel -> spans -> projection)", () => {
afterEach(cleanupOriginalFixture);

  it("round-trips an explicit headed browser presentation from the request through the queued run", async () => {
    const h = await harness({ profileFixture: profileFixtures.create });
    const planResponse = await h.app.request("/api/v1/start-plans", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        workflowId: "fixture-graph",
        submissions: [{ eid: "10873698", mode: "read-only" }],
        dryRun: false,
        browserMode: "headed",
      }),
    });
    assert.equal(planResponse.status, 200);
    const plan = await json(planResponse);
    assert.equal(plan.browserMode, "headed");

    const stored = h.database.authority.startPlans.get(String(plan.startPlanId));
    assert.equal((stored as { browserMode?: unknown } | undefined)?.browserMode, "headed");

    const fingerprints = plan.fingerprints as Record<string, string>;
    const command = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        commandId: "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b7d",
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "local-operator",
        source: "start-run",
        family: "start",
        type: "start-run",
        target: {
          workflowId: "fixture-graph",
          startPlanId: plan.startPlanId,
          expectedVersion: plan.expectedVersion,
        },
        payload: fingerprints,
      }),
    });
    assert.equal(command.status, 200);
    const runId = singleAppliedRunId(CommandResultSchema.parse(await json(command)));
    assert.ok(runId, "the browser-mode plan must propose a run");
    const run = h.database.authority.runs.get(runId);
    assert.equal((run?.envelope as { browserMode?: unknown } | undefined)?.browserMode, "headed");
  });

  it("plans, starts, projects, and serves the run through the one payload", async () => {
    const h = await harness({ profileFixture: profileFixtures.create });

    const planResponse = await h.app.request("/api/v1/start-plans", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        workflowId: "fixture-graph",
        submissions: [{ eid: "10873698", mode: "read-only" }, { eid: "not-an-eid", mode: "read-only" }],
        dryRun: false,
      }),
    });
    assert.equal(planResponse.status, 200);
    const plan = await json(planResponse);
    const planned = plan.planned as { logicalKey: string; title: string }[];
    const refused = plan.refused as { entry: number; code: string }[];
    assert.equal(planned.length, 1);
    assert.equal(planned[0].title, "Fixture 10873698");
    assert.deepEqual(refused.map(({ entry, code }) => ({ entry, code })), [{ entry: 2, code: "input-invalid" }]);

    const fingerprints = plan.fingerprints as Record<string, string>;
    const command = {
      commandId: "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b7a",
      requestedAt: h.clock.now().toISOString(),
      requestedBy: "local-operator",
      source: "start-run",
      family: "start",
      type: "start-run",
      target: {
        workflowId: "fixture-graph",
        startPlanId: plan.startPlanId,
        expectedVersion: plan.expectedVersion,
      },
      payload: {
        descriptorFingerprint: fingerprints.descriptorFingerprint,
        configFingerprint: fingerprints.configFingerprint,
        ingressSchemaHash: fingerprints.ingressSchemaHash,
        canonicalInputSchemaHash: fingerprints.canonicalInputSchemaHash,
        inputFingerprint: fingerprints.inputFingerprint,
      },
    };
    const commandResponse = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify(command),
    });
    assert.equal(commandResponse.status, 200);
    const createdRunId = singleAppliedRunId(CommandResultSchema.parse(await json(commandResponse)));
    const created = h.database.authority.runs.get(createdRunId); assert.ok(created);

    // The run.queued event commits with its canonical run.
    const spanLines = readTimelineRecords(h.database.authority.timelineEvents).records.map(timelineSpanLocation);
    assert.equal(spanLines.length, 1);
    assert.match(spanLines[0].text, /"t":"run\.queued"/);
    assert.match(spanLines[0].text, /"title":"Fixture 10873698"/);

    // A replay returns already-applied and emits NO second span.
    const replay = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify(command),
    });
    assert.equal((await json(replay)).state, "already-applied");
    assert.equal(readTimelineRecords(h.database.authority.timelineEvents).records.length, 1);

    // THE payload serves the row and its counts from one fold.
    const dayResponse = await h.app.request(`/api/v1/dashboard?day=${DAY}`);
    assert.equal(dayResponse.status, 200);
    const day = await json(dayResponse);
    const surfaces = day.queueSurfaces as { runId: string; status: string; pipeline: { id: string }[] }[];
    assert.equal(surfaces.length, 1);
    assert.equal(surfaces[0].runId, created.envelope.runId);
    assert.equal(surfaces[0].status, "queued");
    // Pipeline comes from the descriptor's runtime nodes, pending until spans arrive.
    assert.equal(surfaces[0].pipeline.length > 0, true);
    assert.equal(surfaces[0].pipeline.every(({ id }) => typeof id === "string"), true);
    assert.deepEqual(day.workflowCounts, [
      { workflowId: "fixture-graph", count: 1, statusCounts: [{ status: "queued", count: 1 }] },
    ]);
    assert.deepEqual(day.statusCounts, [{ status: "queued", count: 1 }]);

    // Detail header + note-backed logs slice.
    const runId = created.envelope.runId;
    const detail = await json(await h.app.request(`/api/v1/runs/${runId}`));
    assert.equal((detail.header as { title: string }).title, "Fixture 10873698");
    // A live read states capture absence explicitly.
    assert.deepEqual(detail.captures, {
      state: "absent", reason: "this run has no indexed diagnostic capture artifacts",
    });
    const bundle = await captureDiagnosticBundle(h, runId);
    const capturedDetail = await json(await h.app.request(`/api/v1/runs/${runId}`));
    assert.deepEqual(capturedDetail.captures, { state: "available", artifactCount: 1 });
    const capturesResponse = await h.app.request(`/api/v1/runs/${runId}/captures`);
    assert.equal(capturesResponse.status, 200);
    const captures = RunDetailSectionResponseSchema.parse(await capturesResponse.json());
    assert.equal(captures.section, "captures");
    if (captures.section !== "captures") throw new Error("expected captures");
    assert.equal(captures.payload.runId, runId);
    assert.deepEqual(captures.payload.artifacts.map(({ artifact, origins }) => ({ artifactId: artifact.artifactId, origins })),
      bundle.attachments.map(({ artifactId }) => ({ artifactId, origins: [{ bundleId: bundle.bundleId, originKind: "operator-request" }] })));
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    rmSync(join(h.stateRoot, "artifacts", `${attachment.digest}.artifact`));
    const missingDetailResponse = await h.app.request(`/api/v1/runs/${runId}`);
    assert.equal(missingDetailResponse.status, 200);
    assert.deepEqual((await json(missingDetailResponse)).captures, {
      state: "error",
      code: "DIAGNOSTIC_BUNDLE_BYTES_MISSING",
      message: `diagnostic bundle ${bundle.bundleId}: attachment ${attachment.artifactId} (${attachment.kind}) has no stored bytes`,
      retryable: false,
    });
    const missingCapturesResponse = await h.app.request(`/api/v1/runs/${runId}/captures`);
    assert.equal(missingCapturesResponse.status, 500);
    assert.equal((await json(missingCapturesResponse)).code, "DIAGNOSTIC_BUNDLE_BYTES_MISSING");
    h.noteWriter.emitNote({
      workflow: "fixture-graph",
      address: { runId, attempt: 1, traceId: created.envelope.traceId, spanPath: created.envelope.traceId },
      level: "step",
      message: "opened person search",
    });
    const logs = await json(await h.app.request(`/api/v1/runs/${runId}/logs`));
    const payload = logs.payload as { notes: { message: string; level: string }[]; nextCursor: { state: string } };
    assert.deepEqual(payload.notes.map(({ message, level }) => ({ message, level })), [
      { message: "opened person search", level: "info" },
    ]);
    assert.equal(payload.nextCursor.state, "absent");

    // The SSE hub serves the day the query returns, stamped with the connection's own cursor.
    const currentDay = await json(await h.app.request(`/api/v1/dashboard?day=${DAY}`));
    const connection = await h.hub.connect({ day: DAY });
    const snapshot = connection.initial[1];
    if (snapshot.type !== "snapshot" || snapshot.topic !== "dashboard-day") assert.fail("expected a dashboard-day snapshot");
    assert.notEqual(snapshot.cursor, currentDay.snapshotCursor);
    expect(snapshot.payload).toEqual({ ...currentDay, snapshotCursor: snapshot.cursor });
    connection.close();
  });

  const FOREIGN_ORIGIN_CASES = foreignOriginCases();

  function observeStartPlanning(real: StartPlanService, onPlan: () => void): StartPlanService {
    const prepareAndPlan = real.prepareAndPlan?.bind(real);
    assert.ok(prepareAndPlan, "expected the real start-plan service to support prepareAndPlan");
    return {
      ...real,
      prepareAndPlan(input, signal) {
        onPlan();
        return prepareAndPlan(input, signal);
      },
    };
  }

  it.each(FOREIGN_ORIGIN_CASES)(
    "refuses a start plan with %s before the planner or the body is touched",
    async (_label, headers) => {
      let plans = 0;
      const h = await harness({
        profileFixture: profileFixtures.create,
        startPlans: (real) => observeStartPlanning(real, () => { plans += 1; }),
      });
      const request = new Request("http://localhost/api/v1/start-plans", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ workflowId: "fixture-graph", submissions: [{ eid: "10873698", mode: "read-only" }] }),
      });
      const reads = (["json", "text", "arrayBuffer", "blob", "formData"] as const)
        .map((method) => vi.spyOn(request, method));

      const response = await h.app.request(request);

      assert.equal(response.status, 403);
      assert.equal((await json(response)).code, "OPERATOR_MUTATION_ORIGIN_REFUSED");
      for (const read of reads) expect(read).not.toHaveBeenCalled();
      assert.equal(request.bodyUsed, false);
      assert.equal(plans, 0);
    },
  );

  it("refuses a start plan whose JSON body rides text/plain, and admits the same body as JSON", async () => {
    let plans = 0;
    const h = await harness({
      profileFixture: profileFixtures.create,
      startPlans: (real) => observeStartPlanning(real, () => { plans += 1; }),
    });
    const body = JSON.stringify({
      workflowId: "fixture-graph",
      submissions: [{ eid: "10873698", mode: "read-only" }],
      dryRun: false,
      browserMode: "headed",
    });
    const refused = await h.app.request("http://localhost/api/v1/start-plans", {
      method: "POST",
      headers: { ...OPERATOR_JSON_HEADERS, "content-type": "text/plain" },
      body,
    });
    assert.equal(refused.status, 415);
    assert.equal((await json(refused)).code, "OPERATOR_MUTATION_MEDIA_TYPE_REFUSED");
    assert.equal(plans, 0);

    const admitted = await h.app.request("http://localhost/api/v1/start-plans", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body,
    });
    assert.equal(admitted.status, 200);
    assert.equal(plans, 1);
  });
});
const cleanupOriginalFixture = disposeHttpRouteHarness;
}

{
const cleanups: (() => unknown)[] = [];
describe("GET /api/v1/dashboard and GET /events/v1 through the composition's navigation lane", () => {
  afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

  it("answer while every main-connection read throws, with the bytes of the day built on the request thread", async () => {
    const { f, main, local } = await composedQueueLane(cleanups);
    const day = searchPartitionDay(new Date(f.run.envelope.enqueuedAt));
    const built = local().buildDashboardDayWire(day);
    assert.ok(built.queueSurfaces.length > 0, "the fixture's run is on the day");
    /** The request thread's day, stamped as main stamps the lane's: same members, same order. */
    const expected = (cursor: string) => JSON.stringify({ ...built, projectionGeneration: main.generation(), snapshotCursor: cursor });
    const hub = createDashboardStreamHub({ projection: main,
      backfillGaps: { detected: input => Promise.resolve({ published: false as const, gap: BackfillGapObservationSchema.parse(input) }) } });
    cleanups.push(() => hub.close());
    const app: DashboardApp = new Hono();
    registerQueueRoutes(app, { startPlans: {} as QueueRouteDeps["startPlans"],
      queue: { day: (requested, request) => main.servedDashboardDay(requested, { signal: request.signal }) } });
    registerShellRoutes(app, { bootstrap: {} as ShellRouteDeps["bootstrap"], search: {} as ShellRouteDeps["search"], hub });

    const restore = refuseMainReads(f.db);
    cleanups.push(restore);
    assert.throws(() => f.db.authority, /main-connection-read/u);

    const response = await app.request(`http://localhost/api/v1/dashboard?day=${day}`);
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.equal(body, expected(main.cursor()), "GET answers the request thread's day, byte for byte");
    assert.equal(response.headers.get("etag"), `"${createHash("sha256").update(body).digest("base64url")}"`);

    const stream = await app.request(`http://localhost/events/v1?topics=dashboard-day:${day}`);
    assert.equal(stream.status, 200);
    assert.equal(stream.headers.get("content-type"), "text/event-stream");
    const reader = stream.body?.getReader() ?? assert.fail("the stream has no body");
    const decoder = new TextDecoder();
    let text = "";
    while (!/data: \{"type":"snapshot"[^\n]*\n\n/u.test(text)) {
      const chunk = await reader.read();
      if (chunk.done) assert.fail(`the stream ended before its snapshot: ${text}`);
      text += decoder.decode(chunk.value, { stream: true });
    }
    await reader.cancel();
    const event = /id: (pc:\d+)\ndata: (\{"type":"snapshot"[^\n]*)\n\n/u.exec(text) ?? assert.fail("no snapshot event");
    const [, cursor = "", data = ""] = event;
    const snapshot = DashboardStreamEnvelopeSchema.parse(JSON.parse(data));
    assert.ok(snapshot.type === "snapshot");
    assert.equal(data, JSON.stringify(snapshot), "the framed snapshot is the envelope today's serializer writes");
    assert.ok(data.includes(`"payload":${expected(cursor)},"rows":`), "its payload is the request thread's day at the snapshot's cursor");
  });
});
}
