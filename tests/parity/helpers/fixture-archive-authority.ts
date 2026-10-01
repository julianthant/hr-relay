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
import { failureStatus } from "../../../src/backend/transports/dashboard/routes/failure-status.js";
import { operatorMutationIngressGuard } from "../../../src/backend/transports/dashboard/routes/operator-mutation-ingress.js";
import { registerArchiveRoutes } from "../../../src/backend/transports/dashboard/routes/archive.js";
import { registerCommandsRoutes } from "../../../src/backend/transports/dashboard/routes/commands.js";
import type { DashboardApp } from "../../../src/backend/transports/dashboard/routes/api-types.js";
import { createSoloRequestIdentityCheckpoint } from "../../../src/backend/transports/dashboard/request-identity.js";
import { startDashboardHttpServer } from "../../../src/backend/transports/dashboard/http-server.js";
import { archiveFixture } from "../../unit/archive-transfer/fixtures.js";
import { personLookupDescriptor } from "../../helpers/registered-workflows.js";
import { id } from "../../unit/database-foundation/fixtures.js";
import { FIXTURE_ARCHIVE_EVIDENCE_BYTES } from "./fixture-archive-evidence.js";
import { FIXTURE_DAY } from "./fixture-identity.js";
import { PARITY_DIST_DIR } from "./bundle.js";
import { fixtureHealthEnvelope, fixtureHelloEnvelope, fixtureSnapshotEnvelope, startFixtureServer } from "./fixture-bff.js";

function unexpected(): never {
  throw new Error("Archive browser acceptance reached an unrelated effect");
}

export async function startArchiveAuthorityServer(options: { seed?: "saved" | "live"; reportCount?: number } = {}) {
  const fixture = archiveFixture({ registeredRuntimeVersion: options.seed === "live" });
  if (options.seed === "live") fixture.database.registerRuntimeVersionWorkflows(["other-workflow"]);
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
  const addRun = (sequence: number, terminal = true) => {
    const run = fixture.base.createRun(id(sequence));
    const presented = fixture.database.authority.runs.updatePresentation({ runId: run.envelope.runId,
      expectedVersion: run.version, displayName: `Synthetic report ${sequence}`, now: fixture.base.clock.now().toISOString() });
    if (presented.state !== "applied") throw new Error("fixture presentation refused");
    if (terminal) {
      const result = fixture.database.authority.runs.transition({ runId: run.envelope.runId,
        expectedVersion: presented.run.version, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: fixture.base.clock.now().toISOString() }, now: fixture.base.clock.now().toISOString() });
      if (result.state !== "applied") throw new Error("fixture terminalization refused");
    }
    return run.envelope.runId;
  };
  const finishRun = (selectedRunId: string) => {
    const run = fixture.database.authority.runs.get(selectedRunId);
    if (run === undefined) throw new Error("fixture run missing");
    const result = fixture.database.authority.runs.transition({ runId: selectedRunId,
      expectedVersion: run.version, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: fixture.base.clock.now().toISOString() },
      now: fixture.base.clock.now().toISOString() });
    if (result.state !== "applied") throw new Error("fixture terminalization refused");
  };
  for (let index = 1; index < (options.reportCount ?? 1); index += 1) addRun(91000 + index);
  if (options.seed !== "live") {
    const applied = fixture.kernel.execute(fixture.applyRequest(fixture.plan()));
    if (applied.state !== "applied") throw new Error("Archive browser seed did not transfer its report");
  }

  const savedReport = readArchiveReport(createRunLifecycleStorage(fixture.database), runId);
  const savedFile = savedReport.state === "available" ? savedReport.files[0] : file;
  const exchanges: { method: string; path: string; status: number }[] = [];
  const delays: { path: string; received: () => void; released: Promise<void>; release: () => void }[] = [];
  const delayNextResponse = (path: string) => {
    let received!: () => void;
    let release!: () => void;
    const ready = new Promise<void>(resolve => { received = resolve; });
    const released = new Promise<void>(resolve => { release = resolve; });
    delays.push({ path, received, released, release });
    return { ready, release };
  };
  const makeApp = () => {
    const storage = createRunLifecycleStorage(fixture.database);
    const commands = createDashboardCommandService({
      kernel: fixture.kernel,
      versionChanges: storage,
      archiveDeletionCommands: fixture.database.authority.lifecycleJournal,
      projection: { ingestFromTimeline: unexpected, refreshRun: unexpected },
    });
    const app: DashboardApp = new Hono();
    const identity = createSoloRequestIdentityCheckpoint({ id: "local-operator", label: "Local operator" });
    app.onError((error, c) => {
      const failure = failureStatus(error);
      return c.json(failure.body, failure.status);
    });
    app.use("*", async (c, next) => {
      c.set("requestActorId", identity.identify(c.req.raw));
      await next();
      const requestPath = c.req.path + new URL(c.req.url).search;
      const delayed = delays.findIndex(delay => delay.path.endsWith("?") ? requestPath.startsWith(delay.path) : delay.path === requestPath);
      if (delayed >= 0) {
        const [delay] = delays.splice(delayed, 1);
        delay.received();
        await delay.released;
      }
      exchanges.push({ method: c.req.method, path: c.req.path, status: c.res.status });
    });
    app.use("/api/v1/commands", operatorMutationIngressGuard);
    app.use("/api/v1/commands/bulk", operatorMutationIngressGuard);
    registerArchiveRoutes(app, {
      archive: {
        storage,
        reader: new RunRecordService({
          get database() { return fixture.database; },
          clock: fixture.base.clock,
          ids: { uuid: unexpected },
          publishQueued: unexpected,
        }),
        clock: fixture.base.clock,
        appVersion: "0.1.0",
        descriptors: { list: () => options.seed === "live" ? [{ id: personLookupDescriptor.id, label: personLookupDescriptor.label,
          code: "PL", version: 2, contractFingerprint: "a".repeat(64) }] : [] },
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
      runtimeVersionAcceptedAt: commandId => fixture.database.readRuntimeVersionIndex().changes
        .find(change => change.applicationCommandId === commandId)?.applicationRequest?.requestedAt,
      intake: { prepare: async () => {} },
    });

    return app;
  };

  let buildApp: () => DashboardApp;
  let shell: Awaited<ReturnType<typeof startFixtureServer>> | undefined;
  let http: Awaited<ReturnType<typeof startDashboardHttpServer>> | undefined;
  try {
    shell = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    const shellUrl = shell.baseUrl;
    const createHostApp = () => {
      const app = makeApp();
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
      app.get("*", async c => {
        const response = await fetch(new URL(`${c.req.path}${new URL(c.req.url).search}`, shellUrl));
        return new Response(await response.arrayBuffer(), { status: response.status, headers: response.headers });
      });
      return app;
    };
    buildApp = createHostApp;
    http = await startDashboardHttpServer({ app: createHostApp(), port: 0 });
  } catch (error) {
    if (http !== undefined) await http.close();
    if (shell !== undefined) await shell.close();
    fixture.dispose();
    throw error;
  }
  let server = http;
  const surroundings = shell;
  return {
    baseUrl: `http://127.0.0.1:${String(server.port)}`,
    day: FIXTURE_DAY,
    root: fixture.base.root,
    runId,
    file: savedFile,
    bytes,
    get database() { return fixture.database; },
    addRun,
    finishRun,
    delayNextResponse,
    interruptTransfer: (step: string, occurrence = 1) => fixture.failAfter(step, occurrence),
    async restart() {
      const port = server.port;
      await server.close();
      fixture.reopen();
      fixture.base.clock.advanceWall(60_000);
      server = await startDashboardHttpServer({ app: buildApp(), port });
    },
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
