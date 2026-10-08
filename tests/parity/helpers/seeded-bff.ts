import type { DashboardAppDeps } from "../../../src/backend/transports/http/routes/api-types.js";
import type { Clock } from "../../../src/rules/time/clock.js";
import { dateNavigationReader, seedDateNavigation } from "./date-navigation-server.js";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer,type IncomingMessage,type Server,type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { extname,join,normalize } from "node:path";
import { manualClock } from "../../../src/rules/time/clock.js";
import { createNoteJsonlWriter } from "../../../src/backend/storage/events/note-jsonl-writer.js";
import { createTimelineEmitter } from "../../../src/backend/storage/events/timeline-emitter.js";
import { AuthorityDatabase } from "../../support/helpers/synthetic-storage-admission.js";
import { createTransactionHistory } from "../../../src/backend/storage/sqlite/transaction-history.js";
import { descriptorSetHash } from "../../../src/backend/app/composition/dashboard/compose.js";
import { createRunQueueProjection } from "../../../src/backend/runs/projections/run-queue-projection.js";
import { type DashboardApp } from "../../../src/backend/transports/http/routes/api.js";
import { seedInitialSettingsRuntimeConfig } from "../../support/fixtures/operator-command-fixtures.js";
import { sqliteRunReader } from "../../support/helpers/canonical-run-reader.js";
import { personLookupDescriptor } from "../../support/helpers/registered-workflows.js";
import { assertServedBundle,type ParityBundleProof } from "./bundle.js";
import { CONTRACT_FINGERPRINT,SEEDED_APP_VERSION,SEEDED_AT,SEEDED_DAY,WORKFLOW_ID } from "./seeded-identity.js";
import { seed } from "./seeded-lifecycle.js";
import { composeSeededServices } from "./seeded-services.js";


/**
 * States the 1i slice's real machinery CANNOT reach, and why. These are the
 * honest differences between adapter #1's fixture matrix and this adapter; a
 * parity spec must not assert them against the seeded backend.
 */
export const SEEDED_COVERAGE_GAPS: readonly string[] = Object.freeze([
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


/* ── static asset serving (mirrors the fixture adapter) ──────────────────── */

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".map": "application/json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};


async function serveStatic(distDir: string, pathname: string, res: ServerResponse): Promise<void> {
  const relative = pathname === "/" ? "/index.html" : pathname;
  const target = normalize(join(distDir, relative));
  if (!target.startsWith(normalize(distDir))) {
    res.writeHead(404).end("not found");
    return;
  }
  try {
    const body = await readFile(target);
    const type = CONTENT_TYPES[extname(target)];
    res.writeHead(200, type === undefined ? {} : { "content-type": type }).end(body);
  } catch {
    // A missing asset is a 404, never a silent empty 200 — a parity capture of
    // a blank page must fail loudly rather than be frozen as a reference.
    res.writeHead(404).end("not found");
  }
}


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


/* ── the server ──────────────────────────────────────────────────────────── */

export interface SeededServer {
  readonly port: number;
  readonly baseUrl: string;
  readonly day: string;
  readonly runIds: Readonly<Record<string, string>>;
  close(): Promise<void>;
}


export async function startSeededServer(
  input: Readonly<{ distDir: string; bundle: ParityBundleProof; dateNavigation?: boolean; prepareSelection?: (context:{database:AuthorityDatabase;clock:Clock;root:string}) => Promise<Pick<DashboardAppDeps,"activity"|"search"|"xlsxExports"|"searchMetadataExports"> | undefined> }>,
): Promise<SeededServer> {
  // Ref frontend-backend-integration §7: the same working-tree proof the fixture adapter demands —
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

  seedInitialSettingsRuntimeConfig(database, clock);
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
      listNotificationCheckpoints: (workflowId, itemId, nodeId, attempt) => database.authority.runCheckpoints.listByAttempt(workflowId, itemId, nodeId, attempt),
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
  const jsonlWriter = createTimelineEmitter({
    repository: database.authority.timelineEvents,
    clock,
    pid: 4242,
  });
  // D218: the projection's one live feed is the SQLite cursor feed; the seeder ticks
  // it after every append so each event folds through the production path.
  const spans: ReturnType<typeof createTimelineEmitter> = Object.freeze({
    emit: (event: unknown): void => {
      jsonlWriter.emit(event);
      database.afterAuthorityCommit(() => projection.ingestFromTimeline());
    },
  });
  const notes = createNoteJsonlWriter({ stateRoot, clock, pid: 4242 });

  const runIds = seed({ database, spans, notes });
  if (input.dateNavigation === true) {
    const source = runIds.runningRun;
    if (source === undefined) throw new Error("date-proof-source-run-missing");
    seedDateNavigation(database, source);
  }

  let selectionServices:Awaited<ReturnType<NonNullable<typeof input.prepareSelection>>>|undefined;
  try {selectionServices=await input.prepareSelection?.({database,clock,root});}
  catch(error) {database.close();rmSync(root,{recursive:true,force:true});throw error;}
  const { app, hub, runLogsHub } = composeSeededServices({database,clock,stateRoot,root,projection,spans,descriptors,runIds,selectionServices});

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
      server.closeAllConnections();
      await new Promise<void>((resolvePromise, rejectPromise) => {
        server.close((error) => (error === undefined ? resolvePromise() : rejectPromise(error)));
      });
      hub.close();
      runLogsHub.close();
      database.close();
      rmSync(root, { recursive: true, force: true });
    },
  });
}
export { SEEDED_APP_VERSION,SEEDED_AT,SEEDED_DAY,SEEDED_NOW } from "./seeded-identity.js";
