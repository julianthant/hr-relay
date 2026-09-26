/**
 * Private A08–A10 host. Explorer/catalog reads, validation, command ingress,
 * command service/kernel and SQLite are production code. Only surrounding
 * shell, Settings, Archive and SSE responses use the existing reference BFF.
 */
import { Hono } from "hono";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCommandKernel } from "../../../src/core/command-kernel.js";
import { RunRecordService } from "../../../src/core/run-record-service.js";
import { CommandRequestSchema } from "../../../src/domain/commands.js";
import { manualClock } from "../../../src/domain/clock.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/authority-database.js";
import { composeExplorer } from "../../../src/server/dashboard/compose/explorer.js";
import { createDashboardCommandService } from "../../../src/server/dashboard/commands/command-service.js";
import { createSoloRequestIdentityCheckpoint } from "../../../src/server/dashboard/request-identity.js";
import { registerExplorerRoutes } from "../../../src/server/dashboard/routes/explorer.js";
import { registerCommandsRoutes } from "../../../src/server/dashboard/routes/commands.js";
import { operatorMutationIngressGuard } from "../../../src/server/dashboard/routes/operator-mutation-ingress.js";
import { failureStatus } from "../../../src/server/dashboard/routes/failure-status.js";
import type { DashboardApp } from "../../../src/server/dashboard/routes/api-types.js";
import { startDashboardHttpServer } from "../../../src/server/dashboard/http-server.js";
import { buildWorkflowExplorer } from "../../../src/server/dashboard/queries/explorer.js";
import { WORKFLOW_MODULES } from "../../../src/control/workflow-registry.js";
import { sequentialIdFactory } from "../../fixtures/phase1f-run-fixtures.js";
import { UNWIRED_ARCHIVE_SNAPSHOTS } from "../../fixtures/archive-fixtures.js";
import { NO_INTAKE_PROJECTIONS, UNSTORED_CONFIG_IDENTITY, UNWIRED_INTAKE_PARSER } from "../../fixtures/intake-kernel-seams.js";
import { FIXTURE_DESCRIPTOR_HASH } from "./fixture-identity.js";
import { PARITY_DIST_DIR } from "./bundle.js";
import { fixtureHelloEnvelope, fixtureSnapshotEnvelope, fixtureHealthEnvelope, startFixtureServer } from "./fixture-bff.js";

function unexpected(): never { throw new Error("Explorer acceptance reached an unrelated effect"); }

export async function startExplorerAuthorityServer(fault?: "empty-registry" | "unresolved-sources" | "stale-catalog" | "malformed-catalog") {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "explorer-browser-"));
  const clock = manualClock(new Date("2026-09-14T12:00:00Z"));
  const database = AuthorityDatabase.open({ path: join(root, "authority.db"), busyTimeoutMs: 250, migrationOwner: "explorer-browser" }, clock);
  const composition = composeExplorer({ database, clock, descriptorSetHash: FIXTURE_DESCRIPTOR_HASH });
  const kernel = createCommandKernel({
    lifecycle: new RunRecordService({ database, clock, ids: sequentialIdFactory("e"), publishQueued: unexpected }),
    authority: database, appVersion: "0.1.0", clock, ids: sequentialIdFactory("d"),
    descriptors: { resolve: id => WORKFLOW_MODULES.find(m => m.descriptor.id === id)?.descriptor },
    archiveSnapshots: UNWIRED_ARCHIVE_SNAPSHOTS, configIdentity: UNSTORED_CONFIG_IDENTITY,
    intakeParser: UNWIRED_INTAKE_PARSER, intakeProjections: NO_INTAKE_PROJECTIONS,
    writeResolution: { resolvePresent: unexpected, resolveAbsent: unexpected },
    workerRuntime: { planWorkerCount: unexpected, spawnWorker: unexpected, refreshBrowser: unexpected, reopenBrowser: unexpected },
    explorerEdits: composition.executor,
  });
  const commands = createDashboardCommandService({ kernel, projection: { ingestFromTimeline: unexpected, refreshRun: unexpected } });
  const app: DashboardApp = new Hono();
  const identity = createSoloRequestIdentityCheckpoint({ id: "local-operator", label: "Local operator" });
  const exchanges: { method: string; path: string; status: number }[] = [];
  app.onError((error, c) => { const failure = failureStatus(error); return c.json(failure.body, failure.status); });
  app.use("*", async (c, next) => {
    c.set("requestActorId", identity.identify(c.req.raw));
    await next();
    exchanges.push({ method: c.req.method, path: c.req.path, status: c.res.status });
  });
  app.use("/api/v1/commands", operatorMutationIngressGuard);
  app.use("/api/v1/commands/bulk", operatorMutationIngressGuard);
  app.use("/api/v1/explorer/validate", operatorMutationIngressGuard);
  const routes = composition.routes;
  registerExplorerRoutes(app, {
    ...routes,
    explorer: { ...routes.explorer,
      ...(fault === "empty-registry" ? { modules: [] } : {}),
      ...(fault === "unresolved-sources" ? { listScenarioSources: () => [] } : {}),
    },
    uiCatalog: { readCatalogJson: () => {
      if (fault === "malformed-catalog") return "{}";
      const json = routes.uiCatalog.readCatalogJson();
      if (fault !== "stale-catalog") return json;
      const catalog = JSON.parse(json) as { entries: { label: string }[] };
      const first = catalog.entries[0];
      if (first === undefined) throw new Error("catalog fault requires an existing entry");
      first.label = "Stale acceptance label";
      return JSON.stringify(catalog);
    } },
  });
  registerCommandsRoutes(app, { clock, commands, commandJournal: database.authority.commands,
    bulkCommandAcceptances: { withTransaction: unexpected },
    protectedCommandAcceptedAt: unexpected,
    intake: { prepare: async (request) => { if (CommandRequestSchema.parse(request).family !== "explorer") unexpected(); } },
  });
  let shell: Awaited<ReturnType<typeof startFixtureServer>> | undefined;
  let http: Awaited<ReturnType<typeof startDashboardHttpServer>> | undefined;
  try {
    shell = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    const shellUrl = shell.baseUrl;
    // All measured routes above terminate before this synthetic surroundings port.
    app.get("/events/v1", c => {
      const body = new ReadableStream<Uint8Array>({ start(controller) {
        for (const envelope of [fixtureHelloEnvelope(), fixtureSnapshotEnvelope(), fixtureHealthEnvelope()]) {
          const id = "cursor" in envelope ? `id: ${envelope.cursor}\n` : "";
          controller.enqueue(new TextEncoder().encode(`${id}data: ${JSON.stringify(envelope)}\n\n`));
        }
      } });
      return c.body(body, 200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    });
    app.get("*", async c => {
      const response = await fetch(new URL(`${c.req.path}${new URL(c.req.url).search}`, shellUrl));
      return new Response(await response.arrayBuffer(), { status: response.status, headers: response.headers });
    });
    http = await startDashboardHttpServer({ app, port: 0 });
  } catch (error) {
    if (http !== undefined) await http.close();
    if (shell !== undefined) await shell.close();
    database.close();
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
  const server = http;
  const surroundings = shell;
  return {
    baseUrl: `http://127.0.0.1:${String(server.port)}`, root, database, commands,
    read: () => buildWorkflowExplorer(composition.routes.explorer),
    exchanges: () => [...exchanges],
    async close() {
      try { await server.close(); }
      finally { try { await surroundings.close(); } finally { database.close(); rmSync(root, { recursive: true, force: true }); } }
    },
  };
}
