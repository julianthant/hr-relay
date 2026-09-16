/**
 * Private A15–A18 browser host. Archive query/route, command ingress/service/kernel,
 * lifecycle storage and SQLite are production code. Shell, non-Archive APIs and SSE
 * are explicitly synthetic surroundings.
 */
import { Hono } from "hono";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ArchiveFileReferenceSchema } from "../../../src/domain/archive/report.js";
import { createRunLifecycleStorage } from "../../../src/core/run-lifecycle-storage.js";
import { RunRecordService } from "../../../src/core/run-record-service.js";
import { createDashboardCommandService } from "../../../src/server/dashboard/commands/command-service.js";
import { readArchiveReport } from "../../../src/server/dashboard/queries/archive-reports.js";
import { failureStatus } from "../../../src/server/dashboard/routes/failure-status.js";
import { operatorMutationIngressGuard } from "../../../src/server/dashboard/routes/operator-mutation-ingress.js";
import { registerArchiveRoutes } from "../../../src/server/dashboard/routes/archive.js";
import { registerCommandsRoutes } from "../../../src/server/dashboard/routes/commands.js";
import type { DashboardApp } from "../../../src/server/dashboard/routes/api-types.js";
import { createSoloRequestIdentityCheckpoint } from "../../../src/server/dashboard/request-identity.js";
import { startDashboardHttpServer } from "../../../src/server/dashboard/http-server.js";
import { archiveFixture } from "../../unit/archive-transfer/fixtures.js";
import { id } from "../../unit/database-foundation/fixtures.js";
import { FIXTURE_ARCHIVE_EVIDENCE_BYTES } from "./fixture-archive-evidence.js";
import { FIXTURE_DAY } from "./fixture-identity.js";
import { PARITY_DIST_DIR } from "./bundle.js";
import { fixtureHealthEnvelope, fixtureHelloEnvelope, fixtureSnapshotEnvelope, startFixtureServer } from "./fixture-bff.js";

function unexpected(): never {
  throw new Error("Archive browser acceptance reached an unrelated effect");
}

export async function startArchiveAuthorityServer() {
  const fixture = archiveFixture();
  const runId = fixture.base.run.envelope.runId;
  const bytes = Buffer.from(FIXTURE_ARCHIVE_EVIDENCE_BYTES);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const artifactId = id(8990);
  const file = ArchiveFileReferenceSchema.parse({
    digest,
    byteLength: bytes.length,
    mediaType: "image/png",
    name: "Synthetic retained screenshot.png",
    artifactIds: [artifactId],
  });
  mkdirSync(join(fixture.base.root, "artifacts"), { recursive: true });
  writeFileSync(join(fixture.base.root, "artifacts", `${digest}.artifact`), JSON.stringify({
    ref: { id: artifactId, sha256: digest, bytes: bytes.length, mediaType: file.mediaType },
    payloadBase64: bytes.toString("base64"),
  }));
  fixture.database.authority.diagnosticBundles.insert({
    bundleId: id(8991),
    runId,
    origin: { kind: "operator-request", requestedBy: "local-operator" },
    createdAt: fixture.base.clock.now().toISOString(),
    contentDigest: "a".repeat(64),
    configFingerprint: "a".repeat(64),
    descriptorFingerprint: "a".repeat(64),
    redaction: { fields: [], warnings: [] },
    attachments: [{
      kind: "screenshot",
      artifactId,
      digest,
      byteLength: bytes.length,
      mediaType: file.mediaType,
      width: 1440,
      height: 900,
      sensitivity: "redacted",
    }],
    retention: { kind: "ordinary", purgeAfter: "2030-01-01T00:00:00.000Z" },
  });
  fixture.terminal();
  const planned = fixture.plan();
  const applied = fixture.kernel.execute(fixture.applyRequest(planned));
  if (applied.state !== "applied") throw new Error("Archive browser seed did not transfer its report");

  const storage = createRunLifecycleStorage(fixture.database);
  const savedReport = readArchiveReport(storage, runId);
  if (savedReport.state !== "available" || savedReport.files.length !== 1) {
    throw new Error("Archive browser seed did not retain its exact image member");
  }
  const savedFile = savedReport.files[0];
  const commands = createDashboardCommandService({
    kernel: fixture.kernel,
    versionChanges: storage,
    archiveDeletionCommands: fixture.database.authority.lifecycleJournal,
    projection: { ingestFromTimeline: unexpected, refreshRun: unexpected },
  });
  const app: DashboardApp = new Hono();
  const identity = createSoloRequestIdentityCheckpoint({ id: "local-operator", label: "Local operator" });
  const exchanges: { method: string; path: string; status: number }[] = [];
  app.onError((error, c) => {
    const failure = failureStatus(error);
    return c.json(failure.body, failure.status);
  });
  app.use("*", async (c, next) => {
    c.set("requestActorId", identity.identify(c.req.raw));
    await next();
    exchanges.push({ method: c.req.method, path: c.req.path, status: c.res.status });
  });
  app.use("/api/v1/commands", operatorMutationIngressGuard);
  app.use("/api/v1/commands/bulk", operatorMutationIngressGuard);
  registerArchiveRoutes(app, {
    archive: {
      storage,
      reader: new RunRecordService({
        database: fixture.database,
        clock: fixture.base.clock,
        ids: { uuid: unexpected },
        publishQueued: unexpected,
      }),
      clock: fixture.base.clock,
      appVersion: "0.1.0",
      descriptors: { list: () => [] },
      get authority() { return unexpected(); },
      get ledger() { return unexpected(); },
    },
  });
  registerCommandsRoutes(app, {
    clock: fixture.base.clock,
    commands,
    commandJournal: fixture.database.authority.commands,
    bulkCommandAcceptances: { withTransaction: unexpected },
    protectedCommandAcceptedAt: unexpected,
    intake: { prepare: async () => {} },
  });

  let shell: Awaited<ReturnType<typeof startFixtureServer>> | undefined;
  let http: Awaited<ReturnType<typeof startDashboardHttpServer>> | undefined;
  try {
    shell = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    app.get("/events/v1", c => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const envelope of [fixtureHelloEnvelope(), fixtureSnapshotEnvelope(), fixtureHealthEnvelope()]) {
            const cursor = "cursor" in envelope ? `id: ${envelope.cursor}\n` : "";
            controller.enqueue(new TextEncoder().encode(`${cursor}data: ${JSON.stringify(envelope)}\n\n`));
          }
        },
      });
      return c.body(body, 200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    });
    const shellUrl = shell.baseUrl;
    app.get("*", async c => {
      const response = await fetch(new URL(`${c.req.path}${new URL(c.req.url).search}`, shellUrl));
      return new Response(await response.arrayBuffer(), { status: response.status, headers: response.headers });
    });
    http = await startDashboardHttpServer({ app, port: 0 });
  } catch (error) {
    if (http !== undefined) await http.close();
    if (shell !== undefined) await shell.close();
    fixture.dispose();
    throw error;
  }
  const server = http;
  const surroundings = shell;
  return {
    baseUrl: `http://127.0.0.1:${String(server.port)}`,
    day: FIXTURE_DAY,
    root: fixture.base.root,
    runId,
    file: savedFile,
    bytes,
    database: fixture.database,
    interruptNextAudit: () => fixture.failAfter("audit"),
    exchanges: () => [...exchanges],
    async close() {
      try { await server.close(); }
      finally {
        try { await surroundings.close(); }
        finally {
          fixture.dispose();
          if (existsSync(fixture.base.root)) rmSync(fixture.base.root, { recursive: true, force: true });
        }
      }
    },
  };
}
