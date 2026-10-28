import { createIntakeCommandResultQuery } from "../../../../src/backend/runs/queries/intake-command-result.js";
import { runQueuedSpanEvent } from "../../../../src/backend/runs/commands/run-queued-span.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { ActorIdSchema } from "../../../../src/rules/identity/ids.js";
import { descriptorSetHash } from "../../../../src/backend/app/registries/workflow-registry.js";
import { createRunQueueProjection } from "../../../../src/backend/runs/projections/run-queue-projection.js";
import { createTransactionHistory } from "../../../../src/backend/storage/sqlite/transaction-history.js";
import { registerQueueRoutes } from "../../../../src/backend/transports/http/routes/queue.js";
import { sqliteRunReader } from "../../helpers/canonical-run-reader.js";
import { createBoundProfileFixture } from "../../helpers/admission-fixture.js";
/** Disposable production Intake pipeline. Surrounding dashboard reads use the named fixture server. */
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createCommandKernel } from "../../../../src/backend/runs/commands/command-kernel.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../src/rules/identity/ids.js";
import { createContentAddressedArtifactWriter } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { AuthorityDatabase } from "../../helpers/synthetic-storage-admission.js";
import { createIntakeService } from "../../../../src/backend/runs/commands/intake-service.js";
import { createIntakeParser } from "../../../../src/backend/processing/spreadsheet/intake-parser.js";
import { registerIntakeRoutes } from "../../../../src/backend/transports/http/routes/intake.js";
import { registerCommandsRoutes } from "../../../../src/backend/transports/http/routes/commands.js";
import { operatorMutationIngressGuard, operatorOpaqueIngressGuard } from "../../../../src/backend/transports/http/routes/operator-mutation-ingress.js";
import { createSoloRequestIdentityCheckpoint } from "../../../../src/backend/transports/http/request-identity.js";
import type { DashboardApp } from "../../../../src/backend/transports/http/routes/api-types.js";
import type { DashboardCommandService } from "../../../../src/backend/runs/commands/command-service.js";
import type { AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { CONFIG_SNAPSHOT, NOW, UUID_1 } from "../phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../phase1f-run-fixtures.js";
import { intakeFixtureDescriptor, intakeFixtureProjection } from "../intake-workflow-fixture.js";
import { FrontendBootstrapWireSchema, WorkflowBootstrapPrimitiveSchema } from "../../../../src/models/dashboard/bootstrap.js";
import type { ParityBundleProof } from "../../../parity/helpers/bundle.js";

export const INTAKE_CSV = "Employee ID#,Effective Date,Dept\n10456712,07/01/2026,Housing\n10-4567,07/01/2026,Housing\n10998801,07/01/2026,Student Affairs\n";
export async function createIntakeAuthority() {
  const profile = await createBoundProfileFixture();
  const root = profile.stateRoot, path = profile.path, artifactRoot = profile.admission.artifactRoot;
  const clock = manualClock(new Date(NOW));
  let database = AuthorityDatabase.open({ path, busyTimeoutMs: 500, migrationOwner: "intake-disposable-proof" }, clock);
  database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  database.authority.runtimeConfig.activate({ settingsRevision: 1, settingsFingerprint: CONFIG_SNAPSHOT.fingerprint,
    configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId, configFingerprint: CONFIG_SNAPSHOT.fingerprint, activatedAt: NOW });
  const ownedArtifacts = createContentAddressedArtifactWriter({ admission: profile.admission });
  let artifactReads = 0;
  const artifacts = { ...ownedArtifacts, open: (...args: Parameters<typeof ownedArtifacts.open>) => {
    artifactReads += 1;
    return ownedArtifacts.open(...args);
  } };
  let descriptor: AnyWorkflowDescriptor = intakeFixtureDescriptor;
  const descriptors = { resolve: (id: string) => id === descriptor.id ? descriptor : undefined };
  const projections = { resolve: (id: string) => id === descriptor.id ? intakeFixtureProjection : undefined };
  const ids = sequentialIdFactory("c");
  const kernelIds = sequentialIdFactory("d");
  const lifecycleIds = sequentialIdFactory("e");
  const forbidden = (): never => { throw new Error("disposable Intake proof has no external worker or HR execution"); };
  const compose = () => {
    const parser = createIntakeParser({ artifacts });
    const spans = createTimelineEmitter({ repository: database.authority.timelineEvents, clock });
    const intake = createIntakeService({ authority: database, authorityRead: {
      getIntakeSession: id => database.authority.intakeSessions.get(id),
      getIntakeManifest: id => database.authority.intakeManifests.get(id),
      findIntakeManifestsBySource: sha => database.authority.intakeManifests.findBySource(sha),
    }, artifacts, parser, projections, descriptors, clock, ids, actorId: LOCAL_OPERATOR_ACTOR_ID });
    const kernel = createCommandKernel({ lifecycle: new RunRecordService({ database, clock, ids: lifecycleIds, publishQueued: (run, publication) => {
      if (publication === undefined) throw new Error("command-created run lacks queue presentation");
      spans.emit(runQueuedSpanEvent({ run, ...publication, actorId: ActorIdSchema.parse(publication.actorId) }));
    } }),
      appVersion: "0.1.0", authority: database, clock, ids: kernelIds,
      configIdentity: { configFingerprint: CONFIG_SNAPSHOT.fingerprint, configSnapshotId: UUID_1 }, descriptors,
      writeResolution: { recheck: forbidden, resolveAbsent: forbidden },
      workerRuntime: { pool: { planPoolWorkerCount: forbidden, spawnPoolWorker: forbidden, refreshPoolBrowser: forbidden, reopenPoolBrowser: forbidden, stopPoolWorker: forbidden, pausePoolWorker: forbidden, resumePoolWorker: forbidden } },
      intakeParser: parser, intakeProjections: projections });
    const projection = createRunQueueProjection({
      timeline: database.authority.timelineEvents, reader: sqliteRunReader(database, clock), stateRoot: root,
      clock, appVersion: "0.1.0", descriptorSetHash: descriptorSetHash([descriptor.contractFingerprint]),
      ledger: createTransactionHistory(database.authority),
      authority: {
        listNotifications: () => [], listNotificationCheckpoints: () => [],
        listCheckpoints: (workflowId, itemId) => database.authority.runCheckpoints.listByItem(workflowId, itemId),
        listGateResults: runId => database.authority.gateResults.listByRun(runId),
        listLiveWorkerLeases: () => database.authority.workerLeases.listLive(),
        getWorkerLease: workerId => database.authority.workerLeases.get(workerId),
        listWorkerPools: () => database.authority.workerPools.list(),
        listRunBatches: () => database.authority.runSessions.list(), getRunBatch: id => database.authority.runSessions.get(id),
        getFailure: failureId => database.authority.failures.get(failureId),
        getReceipt: runId => database.authority.evidenceReceipts.findByRun(runId),
        canonicalPerson: runId => database.canonicalPerson(runId),
        latestCheckpoint: (workflowId, itemId, nodeId) => database.authority.runCheckpoints.latest(workflowId, itemId, nodeId),
      }, descriptors,
    });
    projection.rebuildFromTimeline();
    return { intake, kernel, projection };
  };
  let runtime = compose();
  const identity = createSoloRequestIdentityCheckpoint({ id: LOCAL_OPERATOR_ACTOR_ID, label: "Synthetic operator" });
  const app: DashboardApp = new Hono();
  app.use("*", async (c, next) => { c.set("requestActorId", identity.identify(c.req.raw)); await next(); });
  app.use("/api/v1/intake/files", operatorOpaqueIngressGuard);
  app.use("/api/v1/commands", operatorMutationIngressGuard);
  registerIntakeRoutes(app, { intake: {
    upload: request => runtime.intake.upload(request), read: id => runtime.intake.read(id), prepare: request => runtime.intake.prepare(request),
  }, intakeCommandResult: (sessionId, commandId) => createIntakeCommandResultQuery(database)(sessionId, commandId) });
  registerQueueRoutes(app, { queue: { day: day => { runtime.projection.ingestFromTimeline(); return runtime.projection.buildDashboardDayWire(day); } },
    startPlans: { plan: forbidden, previewWarnings: forbidden },
  });
  // This harness starts no executing worker.
  const commands: DashboardCommandService = {
    execute: request => runtime.kernel.execute(request),
    submit: async request => runtime.kernel.execute(request),
    executeBulk: forbidden,
  };
  registerCommandsRoutes(app, { clock, commands, commandJournal: { get: id => database.authority.commands.get(id) },
    protectedCommandAcceptedAt: forbidden, bulkCommandAcceptances: { withTransaction: work => database.withAuthorityTransaction(repositories => work({ get: repositories.commands.getBulk, insert: repositories.commands.acceptBulk })) },
    intake: { prepare: request => runtime.intake.prepare(request) },
  });
  app.onError((error, c) => c.json({ state: "error", code: "INTAKE_PROOF_ERROR", message: error.message, retryable: false }, 500));
  return {
    root, path, artifactRoot, clock, app, artifacts,
    get artifactReads() { return artifactReads; },
    get mintedIds() { return [...ids.minted(), ...kernelIds.minted(), ...lifecycleIds.minted()]; },
    get database() { return database; }, get intake() { return runtime.intake; }, get kernel() { return runtime.kernel; },
    setDescriptor(next: AnyWorkflowDescriptor) { descriptor = next; },
    restart() { database.close(); database = AuthorityDatabase.open({ path, busyTimeoutMs: 500, migrationOwner: "intake-disposable-restart" }, clock); runtime = compose(); },
    request(session: { intakeSessionId: string; expectedVersion: number }, type: string, payload?: unknown) {
      return { commandId: randomUUID(), requestedAt: clock.now().toISOString(), requestedBy: LOCAL_OPERATOR_ACTOR_ID,
        source: "intake-workspace", family: "intake", type, target: { intakeSessionId: session.intakeSessionId, expectedVersion: session.expectedVersion },
        ...(payload === undefined ? {} : { payload }) };
    },
    async post(request: unknown) { return app.request("http://127.0.0.1/api/v1/commands", { method: "POST", headers: { host: "127.0.0.1", origin: "http://127.0.0.1", "content-type": "application/json" }, body: JSON.stringify(request) }); },
    async upload(csv = INTAKE_CSV) { const result = await runtime.intake.upload({ workflow: descriptor.id, fileName: "synthetic.csv", mediaType: "text/csv", bytes: new TextEncoder().encode(csv) }); if (result.state === "refused") throw new Error(result.message); return result; },
    async close() { database.close(); await profile.close(); },
  };
}

export async function startIntakeAuthorityServer(input: { distDir: string; bundle: ParityBundleProof }) {
  const [{DEFAULT_DASHBOARD_PROFILE},{startFixtureServer}]=await Promise.all([import("./fixture-profile.js"),
    import("../../helpers/dashboard/fixture-bff.js")]);
  const template = DEFAULT_DASHBOARD_PROFILE.bootstrap.workflows.map(workflow => WorkflowBootstrapPrimitiveSchema.parse(workflow)).find(workflow => workflow.start?.spreadsheetIntake === true);
  if (template === undefined) throw new Error("Intake browser fixture has no spreadsheet entry template");
  const profile = { ...DEFAULT_DASHBOARD_PROFILE, bootstrap: FrontendBootstrapWireSchema.parse({ ...DEFAULT_DASHBOARD_PROFILE.bootstrap,
    workflows: [{ ...template, id: intakeFixtureDescriptor.id, label: "Intake fixture", code: "if" }],
  }) };
  const fixture = await startFixtureServer({ ...input, profile });
  const authority = await createIntakeAuthority();
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
      const own = url.pathname.startsWith("/api/v1/intake/") || url.pathname === "/api/v1/commands" || (url.pathname === "/api/v1/dashboard" && url.searchParams.get("day") !== profile.day.day);
      const chunks: Buffer[] = [];
      if (req.method !== "GET" && req.method !== "HEAD") for await (const chunk of req) {
        const bytes: unknown = chunk;
        if (!(bytes instanceof Uint8Array)) throw new Error("Intake HTTP stream delivered non-bytes");
        chunks.push(Buffer.from(bytes));
      }
      const headers = Object.fromEntries(Object.entries(req.headers).filter((row): row is [string, string] => typeof row[1] === "string"));
      const request = new Request(own ? url : new URL(url.pathname + url.search, fixture.baseUrl), { method: req.method ?? "GET", headers,
        ...(chunks.length === 0 ? {} : { body: new Uint8Array(Buffer.concat(chunks)) }) });
      const response = own ? await authority.app.fetch(request) : await fetch(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body !== null) {
        const reader = response.body.getReader();
        res.on("close", () => { void reader.cancel().catch(() => undefined); });
        for (;;) { const next = await reader.read(); if (next.done) break; res.write(next.value); }
      }
      res.end();
    })().catch((error: unknown) => { if (!res.headersSent) res.writeHead(500); res.end(error instanceof Error ? error.message : String(error)); });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (address === null || typeof address === "string") throw new Error("Intake proof did not bind loopback");
  return { authority, baseUrl: `http://127.0.0.1:${address.port}`, async close() {
    server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error)));
    await fixture.close(); await authority.close();
  } };
}
