import { Hono } from "hono";
import { startDashboardHttpServer } from "../../../src/backend/transports/http/http-server.js";
import type { DashboardApp } from "../../../src/backend/transports/http/routes/api-types.js";
import { failureStatus } from "../../../src/backend/transports/http/routes/failure-status.js";
import { registerRunDetailRoutes } from "../../../src/backend/transports/http/routes/run-detail.js";
import { registerTrustRoutes } from "../../../src/backend/transports/http/routes/trust.js";
import { registerOcrRoutes } from "../../../src/backend/transports/http/routes/ocr.js";
import { createOperatorRunDetail } from "../../../src/backend/app/composition/dashboard/run-detail.js";
import { createOperatorProjection } from "../../../src/backend/app/composition/dashboard/queue.js";
import { createTransactionHistory } from "../../../src/backend/storage/sqlite/transaction-history.js";
import { DashboardStreamEnvelopeSchema } from "../../../src/models/dashboard/subscription.js";
import { CommandRequestSchema } from "../../../src/rules/commands/commands.js";
import { FrontendBootstrapWireSchema } from "../../../src/models/dashboard/bootstrap.js";
import { register } from "tsx/esm/api";
import { startFixtureServer, type FixtureDashboardProfile } from "../../support/helpers/dashboard/fixture-bff.js";
import { MOCK_DIST_DIR } from "./bundle.js";
import { FIXTURE_START_PICKER_BOOTSTRAP } from "./fixture-start.js";

/** Actual HTTP routes over synthetic authority; the shell serves only surrounding fixture data. */
export async function startSweepOverlay(app: DashboardApp, profile?: FixtureDashboardProfile) {
  app.onError((error, c) => { const failure = failureStatus(error); return c.json(failure.body, failure.status); });
  const shell = await startFixtureServer({ distDir: MOCK_DIST_DIR, bundle: { proof: "working-tree" }, ...(profile === undefined ? {} : { profile }) });
  app.all("*", async c => {
    const url = new URL(c.req.url);
    return fetch(new URL(`${url.pathname}${url.search}`, shell.baseUrl), {
      method: c.req.method, headers: c.req.raw.headers,
      ...(c.req.method === "GET" || c.req.method === "HEAD" ? {} : { body: await c.req.arrayBuffer() }),
    });
  });
  try {
    const http = await startDashboardHttpServer({ app, port: 0 });
    return { baseUrl: `http://127.0.0.1:${http.port}`, async close() {
      const results = await Promise.allSettled([http.close(), shell.close()]);
      const failures = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
      if (failures.length) throw new AggregateError(failures, "sweep fixture server cleanup failed");
    } };
  } catch (error) { await shell.close(); throw error; }
}

export async function startOcrSweepServer(mode: "review" | "member-retry") {
  // These existing executor fixtures import JSON; use the installed TS loader for that graph.
  const unregister = register();
  const { createOcrReviewWorld } = await import("../../support/helpers/backend/ocr-review-world.js");
  const { createEcRetryWorld } = await import("../../support/helpers/backend/ec-retry-world.js");
  const reviewWorld = createOcrReviewWorld(), retryWorld = createEcRetryWorld();
  const cleanup = async () => { try { await (mode === "review" ? reviewWorld.cleanup() : retryWorld.cleanup()); } finally { await unregister(); } };
  try {
    const f = mode === "review" ? await reviewWorld.fixture({ coordinator: true, record: true }) : await retryWorld.fixture();
    if (mode === "member-retry") await f.canonical.execute(f.parentRun, new AbortController().signal);
    const failed = f.database.authority.runs.listChildren(f.parentRun.envelope.runId).find(run =>
      run.envelope.workflow === "emergency-contact-member" && run.lifecycle.state === "terminal" && run.lifecycle.outcome === "failed");
    if (mode === "member-retry" && failed === undefined) throw new Error("sweep fixture has no failed Emergency Contact member");
    const reader = f.canonical.lifecycle, database = f.database, stateRoot = f.harness.authority.stateRoot;
    const descriptorHash = FIXTURE_START_PICKER_BOOTSTRAP.descriptorHash;
    const projection = createOperatorProjection({ database, stateRoot, reader, clock: f.clock, appVersion: "0.1.0", descriptorSetHash: descriptorHash,
      descriptors: { resolve: f.resolve }, ledger: createTransactionHistory(database.authority) });
    projection.rebuildFromTimeline();
    const day = f.clock.now().toISOString().slice(0, 10);
    const snapshot = () => { projection.ingestFromTimeline(); return projection.buildDashboardDayWire(day); };
    const bootstrap = FrontendBootstrapWireSchema.parse({ ...FIXTURE_START_PICKER_BOOTSTRAP,
      serverClock: { now: f.clock.now().toISOString(), zone: "America/Los_Angeles" }, projectionGeneration: projection.generation() });
    const runDetail = createOperatorRunDetail({ database, stateRoot, projection, runReader: reader,
      canonical: { database, reader, descriptors: { resolve: f.resolve } } });
    const app: DashboardApp = new Hono();
    app.use("*", async (c, next) => { c.set("requestActorId", "local-operator"); await next(); });
    registerRunDetailRoutes(app, { runDetail });
    registerTrustRoutes(app, { runDetail });
    registerOcrRoutes(app, { ocr: f.sources });
    app.get("/api/v1/bootstrap", c => c.json(bootstrap));
    app.get("/api/v1/dashboard", c => c.json(snapshot()));
    app.get("/events/v1", c => c.body(new ReadableStream<Uint8Array>({ start(controller) {
      for (const envelope of [
        { type: "hello", wireVersion: 1, descriptorHash, projectionGeneration: projection.generation(), cursor: projection.cursor() },
        { type: "snapshot", topic: "dashboard-day", cursor: projection.cursor(), payload: snapshot() }, { type: "health", state: "live" },
      ]) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(DashboardStreamEnvelopeSchema.parse(envelope))}\n\n`));
    } }), 200, { "content-type": "text/event-stream" }));
    const commands: unknown[] = [];
    app.post("/api/v1/commands", async c => {
      const command = CommandRequestSchema.parse(await c.req.json()); commands.push(command);
      return c.json(f.canonical.kernel.execute(command));
    });
    const server = await startSweepOverlay(app, { bootstrap, descriptorHash, day: snapshot() });
    return { ...server, f, commands, day, ocrRunId: f.run.envelope.runId, runId: failed?.envelope.runId ?? f.parentRun.envelope.runId,
      async close() { try { await server.close(); } finally { await cleanup(); } } };
  } catch (error) { await cleanup(); throw error; }
}
