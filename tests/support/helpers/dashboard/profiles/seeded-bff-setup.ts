import type { RuntimeProcessLockHandle } from "../../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { sqliteRunReader } from "../../canonical-run-reader.js";
import { personLookupDescriptor } from "../../registered-workflows.js";
import { AuthorityDatabase } from "../../synthetic-storage-admission.js";
import { CONTRACT_FINGERPRINT } from "../served-fixtures/seeded-identity.js";
import { SEEDED_APP_VERSION } from "../served-fixtures/seeded-identity.js";
import { SEEDED_AT } from "../served-fixtures/seeded-identity.js";
import { SEEDED_DAY } from "../served-fixtures/seeded-identity.js";
import { WORKFLOW_ID } from "../served-fixtures/seeded-identity.js";
import { seed } from "../served-fixtures/seeded-lifecycle.js";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { descriptorSetHash } from "../../../../../src/backend/app/composition/dashboard/compose.js";
import { createRunQueueProjection } from "../../../../../src/backend/runs/projections/run-queue-projection.js";
import { createNoteTimelineWriter } from "../../../../../src/backend/storage/events/note-timeline-writer.js";
import { createTimelineEmitter } from "../../../../../src/backend/storage/events/timeline-emitter.js";
import { createTransactionHistory } from "../../../../../src/backend/storage/sqlite/transaction-history.js";
import type { DashboardAppDeps } from "../../../../../src/backend/transports/http/routes/api-types.js";
import { type DashboardApp } from "../../../../../src/backend/transports/http/routes/api.js";
import type { Clock } from "../../../../../src/rules/time/clock.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { type ParityBundleProof } from "../served-fixtures/bundle.js";
import { createStaticAssetFixture } from "../static-assets.js";
import type * as SeededServicesTypes from "../served-fixtures/seeded-services.js";
import type * as BundleTypes from "../served-fixtures/bundle.js";
import type * as DateNavigationServerTypes from "../served-fixtures/date-navigation-server.js";


export interface SeededServer {
  readonly port: number;
  readonly baseUrl: string;
  readonly day: string;
  readonly runIds: Readonly<Record<string, string>>;
  close(): Promise<void>;
}

export function createSeededBffSetup({ seedRuntimeConfig, composeFixtureServices, assertServedBundle, dateNavigationReader, seedDateNavigation }: {
seedRuntimeConfig: (database: AuthorityDatabase, clock: Clock) => void;
composeFixtureServices: (input: Parameters<typeof SeededServicesTypes.composeSeededServices>[0]) => Pick<ReturnType<typeof SeededServicesTypes.composeSeededServices>, "app" | "hub"> & { closeRunLogs: () => void };
assertServedBundle: typeof BundleTypes.assertServedBundle;
dateNavigationReader: typeof DateNavigationServerTypes.dateNavigationReader;
seedDateNavigation: typeof DateNavigationServerTypes.seedDateNavigation;
}) {
  const SEEDED_COVERAGE_GAPS: readonly string[] = Object.freeze([
    "status 'partial': the projection's RUN_OUTCOME_STATUS maps no run outcome to it "
    + "(done|failed|cancelled|discarded|superseded|interrupted only), so no real transition produces it",
    "surfaceKind 'preview': the shape is legal but nothing in the 1i slice enqueues a preview run",
    "worker-card states waiting|paused|failed: the projection derives only stopped|working|idle",
    "liveMessage 'present' on a NON-failed row: the projection serves the terminal FailureRecord's "
    + "summary for a failed run (D13) and nothing else authors a live progress sentence, so every other "
    + "status carries a reasoned absence",
    "warnings 'present': the count comes off the run's ALREADY-DERIVED evidence receipt, and this seed "
    + "derives none — D141 makes derivation an on-demand act and the projection never writes authority",
    "subtitle 'present': the start-plan path this seed uses proposes no subtitle",
  ]);

  const serveStatic = createStaticAssetFixture();

  async function readBody(req: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  async function bridge(app: DashboardApp, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
    const response = await app.fetch(new Request(`http://127.0.0.1${url.pathname}${url.search}`, {
      method: req.method ?? "GET",
      headers: Object.fromEntries(
        Object.entries(req.headers).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      ),
      ...(body === undefined ? {} : { body: new Uint8Array(body) }),
    }));
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    if (response.body === null) {
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    // SSE and other streaming bodies must be piped, not buffered — awaiting the
    // full body of an open event stream would never resolve.
    const reader = response.body.getReader();
    const pump = async (): Promise<void> => {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        res.write(Buffer.from(chunk.value));
      }
    };
    res.on("close", () => void reader.cancel().catch(() => undefined));
    await pump();
    res.end();
  }

  async function startSeededServer(
    input: Readonly<{ distDir: string; bundle: ParityBundleProof; dateNavigation?: boolean; prepareSelection?: (context:{database:AuthorityDatabase;clock:Clock;root:string}) => Promise<Pick<DashboardAppDeps,"activity"|"search"|"xlsxExports"|"searchMetadataExports"> | undefined> }>,
  ): Promise<SeededServer> {
    // Ref frontend-backend-integration: the same working-tree proof the fixture adapter demands —
    // asserted before any temp root, database or port exists.
    assertServedBundle(input.distDir, input.bundle);
    const root = realpathSync(mkdtempSync(join(tmpdir(), "hrauto-parity-seeded-")));
    const stateRoot = join(root, ".tracker");
    mkdirSync(stateRoot, { mode: 0o700 });
    const clock = manualClock(SEEDED_AT);
    const database = AuthorityDatabase.open(
      { path: join(stateRoot, "state.db"), busyTimeoutMs: 1000, migrationOwner: "parity-seeded-bff" },
      clock,
    );

    const workerHandles: RuntimeProcessLockHandle[] = [];
    const cleanupAuthority = (): void => {
      const failures: unknown[] = [];
      for (const handle of workerHandles.splice(0).reverse()) {
        try { handle.release(); } catch (error) { failures.push(error); }
      }
      try { database.close(); } catch (error) { failures.push(error); }
      try { rmSync(root, { recursive: true, force: true }); } catch (error) { failures.push(error); }
      if (failures.length > 0) throw new AggregateError(failures, "seeded authority cleanup failed");
    };
    try {
    seedRuntimeConfig(database, clock);
    const descriptors = {
      resolve: (workflowId: string) => (workflowId === WORKFLOW_ID ? personLookupDescriptor : undefined),
    };
    const projection = createRunQueueProjection({
      timeline: database.authority.timelineEvents,
      reader: input.dateNavigation === true ? dateNavigationReader(database, clock) : sqliteRunReader(database, clock),
      stateRoot,
      clock,
      appVersion: SEEDED_APP_VERSION,
      descriptorSetHash: descriptorSetHash([CONTRACT_FINGERPRINT]),
      ledger: createTransactionHistory(database.authority),
      authority: {
        listNotifications: (actorId: string) => database.authority.notifications.listByActor(actorId),
        listNotificationCheckpoints: (workflowId: string, itemId: string, nodeId: string, attempt: number) => database.authority.runCheckpoints.listByAttempt(workflowId, itemId, nodeId, attempt),
        listCheckpoints: (workflowId, itemId) => database.authority.runCheckpoints.listByItem(workflowId, itemId),
        listGateResults: runId => database.authority.gateResults.listByRun(runId),
        listWorkerSlots: () => database.authority.workerSlots.list(),
        listWorkerRuns: workerId => database.authority.runs.listByWorker(workerId),
        workerOwnerAlive: lease => database.workerLifetimeCustody(lease.workerId).state === "alive",
        workerControls: () => database.authority.workerControls.list(),
        workerBrowsers: workerId => database.authority.workerControls.browsers(workerId),
        listLiveWorkerLeases: () => database.authority.workerLeases.listLive(),
        getWorkerLease: (workerId: string) => database.authority.workerLeases.get(workerId),
        listWorkerPools: () => database.authority.workerPools.list(),
        listRunBatches: () => database.authority.runSessions.list(),
        getRunBatch: (id) => database.authority.runSessions.get(id),
        getFailure: (failureId: string) => database.authority.failures.get(failureId),
        getReceipt: (runId: string) => database.authority.evidenceReceipts.findByRun(runId),
        canonicalPerson: (runId: string) => database.canonicalPerson(runId),
        latestCheckpoint: (workflowId: string, itemId: string, nodeId: string) =>
          database.authority.runCheckpoints.latest(workflowId, itemId, nodeId),
      },
      descriptors,
    });
    const timelineWriter = createTimelineEmitter({
      repository: database.authority.timelineEvents,
      clock,
      pid: 4242,
    });

    const spans: ReturnType<typeof createTimelineEmitter> = Object.freeze({
      emit: (event: unknown): void => {
        timelineWriter.emit(event);
        database.afterAuthorityCommit(() => projection.ingestFromTimeline());
      },
    });
    const notes = createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock, pid: 4242 });

    const runIds = seed({ database, spans, notes, clock, authorityPath: join(stateRoot, "state.db"),
      retainWorker: handle => workerHandles.push(handle) });
    if (input.dateNavigation === true) {
      const source = runIds.runningRun;
      if (source === undefined) throw new Error("date-proof-source-run-missing");
      seedDateNavigation(database, source);
    }

    const selectionServices = await input.prepareSelection?.({database,clock,root});
    const { app, hub, closeRunLogs } = composeFixtureServices({database,clock,stateRoot,root,projection,spans,descriptors,runIds,selectionServices});

    const server: Server = createServer((req, res) => {
      void (async (): Promise<void> => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/events/")) {
          await bridge(app, req, res, url);
          return;
        }
        await serveStatic(input.distDir, url.pathname, res);
      })().catch((error: unknown) => {
        if (res.headersSent) {
          res.end();
          return;
        }
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({
          state: "error",
          code: "INTERNAL_FAILURE",
          message: error instanceof Error ? error.message : String(error),
          retryable: false,
        }));
      });
    });

    await new Promise<void>((resolvePromise) => {
      server.listen(0, "127.0.0.1", resolvePromise);
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("seeded server bound no TCP address");
    }

    return Object.freeze({
      port: address.port,
      baseUrl: `http://127.0.0.1:${address.port}`,
      day: SEEDED_DAY,
      runIds: Object.freeze(runIds),
      close: async (): Promise<void> => {
        try {
          server.closeAllConnections();
          await new Promise<void>((resolvePromise, rejectPromise) => {
            server.close((error) => (error === undefined ? resolvePromise() : rejectPromise(error)));
          });
          hub.close();
          closeRunLogs();
        } finally { cleanupAuthority(); }
      },
    });
    } catch (error) {
      const failures = [error];
      try { cleanupAuthority(); } catch (cleanupError) { failures.push(cleanupError); }
      if (failures.length > 1) throw new AggregateError(failures, "seeded setup and cleanup failed", { cause: error });
      throw error;
    }
  }

  return { SEEDED_COVERAGE_GAPS, startSeededServer };
}
