import { boundProfileCredentials } from '../../support/helpers/admission-fixture.js';
import { retainAuthoritySourceClosure } from '../../../src/backend/storage/source-closure.js';
import { seedInitialSettingsRuntimeConfig } from "../../support/fixtures/operator-command-fixtures.js";
import { hostConfigFacts } from "../../../src/models/config/host-display.js";
import { resolveConfigWithProvenance } from "../../../src/backend/app/config/resolve.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint, type SettingsPatch } from "../../../src/models/config/settings.js";
import { executeSettingsCommand } from "../../../src/backend/runs/commands/command-kernel.js";
import { createSettingsApplicationExecutor } from "../../../src/backend/runs/commands/settings-service.js";

import { readSettings } from "../../../src/backend/runtime/settings/settings-runtime.js";
/** Private launch fixture: real SQLite, planner, command kernel, projection and controlled executor. */

import { readFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";

import { extname, join, normalize } from "node:path";
import { launchHarness } from "../../support/fixtures/run-launch-fixtures.js";
import { createRunQueueProjection } from "../../../src/backend/runs/projections/run-queue-projection.js";
import { createTransactionHistory } from "../../../src/backend/storage/sqlite/transaction-history.js";
import { sqliteRunReader } from "../../support/helpers/canonical-run-reader.js";
import { descriptorSetHash } from "../../../src/backend/app/registries/workflow-registry.js";
import { FrontendBootstrapWireSchema, type FrontendBootstrapWire } from "../../../src/models/dashboard/bootstrap.js";
import { DashboardStreamEnvelopeSchema } from "../../../src/models/dashboard/subscription.js";
import { FIXTURE_BOOTSTRAP } from "./fixture-bootstrap.js";
import { createFixtureBff } from "../../support/helpers/dashboard/fixture-bff.js";
import { assertServedBundle, PARITY_DIST_DIR } from "./bundle.js";
import { separationsDescriptor } from "../../support/helpers/registered-workflows.js";
import { populatedProtectedRecord } from "../../support/fixtures/preflight/runtime-fixture.js";
import { FIXTURE_START_PICKER_BOOTSTRAP } from "./fixture-start.js";

const retainedRunRerunFixtureOwners = new Set<object>();

export async function startRunRerunServer() {
  assertServedBundle(PARITY_DIST_DIR, { proof: "working-tree" });
  const h = launchHarness("reject-active", seedInitialSettingsRuntimeConfig);
  const held: { harness: typeof h; primary?: unknown; server?: ReturnType<typeof createServer> } = { harness: h };
  retainedRunRerunFixtureOwners.add(held);
  try { const source = await h.completeSource(); return await serveLaunchAuthority(h, source, undefined, held); }
  catch (error) { held.primary = error; throw retainAuthoritySourceClosure([error], { admission: held }); }
}

export async function startSeparationsStartServer() {
  assertServedBundle(PARITY_DIST_DIR, { proof: "working-tree" });
  const h = launchHarness("reject-active", seedInitialSettingsRuntimeConfig, {
    descriptor: separationsDescriptor, protectedSecrets: { read: populatedProtectedRecord },
  });
  const held: { harness: typeof h; primary?: unknown; server?: ReturnType<typeof createServer> } = { harness: h };
  retainedRunRerunFixtureOwners.add(held);
  try { return await serveLaunchAuthority(h, undefined, FIXTURE_START_PICKER_BOOTSTRAP, held); }
  catch (error) { held.primary = error; throw retainAuthoritySourceClosure([error], { admission: held }); }
}

async function serveLaunchAuthority<Source>(h: ReturnType<typeof launchHarness>, source: Source, catalog: FrontendBootstrapWire | undefined, held: { harness: ReturnType<typeof launchHarness>; primary?: unknown; server?: ReturnType<typeof createServer> }) {
  const stateRoot = h.profile.stateRoot;
  const database = h.database; const descriptorHash = catalog?.descriptorHash ?? descriptorSetHash([h.descriptor.contractFingerprint]);
  const day = h.clock.now().toISOString().slice(0, 10);
  const projection = createRunQueueProjection({ timeline: database.authority.timelineEvents,
    reader: sqliteRunReader(database, h.clock), stateRoot, clock: h.clock, appVersion: "0.1.0", descriptorSetHash: descriptorHash,
    ledger: createTransactionHistory(database.authority), descriptors: { resolve: (id) => id === h.descriptor.id ? h.descriptor : undefined },
    authority: {
      listNotifications: (actorId) => database.authority.notifications.listByActor(actorId),
      listNotificationCheckpoints: (workflowId, itemId, nodeId, attempt) => database.authority.runCheckpoints.listByAttempt(workflowId, itemId, nodeId, attempt),
      listCheckpoints: (workflowId, itemId) => database.authority.runCheckpoints.listByItem(workflowId, itemId),
      listGateResults: runId => database.authority.gateResults.listByRun(runId),
      listLiveWorkerLeases: () => database.authority.workerLeases.listLive(), getWorkerLease: (id) => database.authority.workerLeases.get(id),
      listWorkerPools: () => database.authority.workerPools.list(), listRunBatches: () => database.authority.runSessions.list(),
      getRunBatch: (id) => database.authority.runSessions.get(id), getFailure: (id) => database.authority.failures.get(id),
      getReceipt: (id) => database.authority.evidenceReceipts.findByRun(id), canonicalPerson: (id) => database.canonicalPerson(id),
      latestCheckpoint: (workflowId, itemId, nodeId) => database.authority.runCheckpoints.latest(workflowId, itemId, nodeId),
    },
  });
  projection.rebuildFromTimeline();
  const snapshot = () => { projection.ingestFromTimeline(); return projection.buildDashboardDayWire(day); };
  const bootstrap = FrontendBootstrapWireSchema.parse({ ...(catalog ?? FIXTURE_BOOTSTRAP), descriptorHash,
    projectionGeneration: projection.generation(), serverClock: { now: h.clock.now().toISOString(), zone: "America/Los_Angeles" },
    workflows: catalog?.workflows ?? [{ id: h.descriptor.id, code: h.descriptor.code, label: h.descriptor.label, categoryId: h.descriptor.category,
      descriptorFingerprint: h.descriptor.contractFingerprint, availability: { state: "available" }, role: h.workflow.role,
      start: { enqueue: h.workflow.enqueue, version: h.workflow.version, steps: h.workflow.steps,
        inputRun: h.descriptor.surfaces.inputRun, spreadsheetIntake: false } }],
  });
  const fixtures = createFixtureBff({ profile: { bootstrap, descriptorHash, day: snapshot() } });
  const streams = new Set<ServerResponse>();
  const commands: unknown[] = []; let loseNextResponse = false;
  const encode = (input: unknown) => `data: ${JSON.stringify(DashboardStreamEnvelopeSchema.parse(input))}\n\n`;
  function publish() {
    const payload = snapshot(); const value = encode({ type: "snapshot", topic: "dashboard-day", cursor: projection.cursor(), payload });
    for (const stream of streams) stream.write(value);
  }
  const settings = createSettingsApplicationExecutor((value) => resolveConfigWithProvenance(value,
    hostConfigFacts({ HRAUTO_HOST_PRIMARY_DISPLAY: "2560x1440" }), h.clock, { stateRoot, artifactRoot: h.profile.admission.artifactRoot }), boundProfileCredentials(h.profile.admission));
  function saveSettings(patch: SettingsPatch) {
    return executeSettingsCommand({ authority: h.database, clock: h.clock, ids: h.ids, settings }, {
      commandId: h.ids.uuid(), family: "settings", type: "apply-settings", requestedAt: h.clock.now().toISOString(),
      requestedBy: "local-operator", source: "settings-surface", target: { expectedRevision: readSettings(h.database.authority).revision },
      payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch },
    });
  }
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
      if (url.pathname === "/events/v1") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        res.write(encode({ type: "hello", wireVersion: 1, descriptorHash, projectionGeneration: projection.generation(), cursor: projection.cursor() }));
        res.write(encode({ type: "snapshot", topic: "dashboard-day", cursor: projection.cursor(), payload: snapshot() }));
        res.write(encode({ type: "health", state: "live" })); streams.add(res); res.on("close", () => streams.delete(res)); return;
      }
      if (url.pathname === "/api/v1/dashboard") { res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(snapshot())); return; }
      if (url.pathname.startsWith("/api/")) {
        const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk as Buffer);
        const body = req.method === "GET" || req.method === "HEAD" ? undefined : new Uint8Array(Buffer.concat(chunks));
        const request = new Request(url, { method: req.method, headers: Object.fromEntries(Object.entries(req.headers)
          .filter((entry): entry is [string, string] => typeof entry[1] === "string")), ...(body === undefined ? {} : { body }) });
        const launch = /^\/api\/v1\/(?:commands|start-plans|rerun-warnings|runs\/[^/]+\/(?:rerun-values|attempt-history))$/u.test(url.pathname);
        if (url.pathname === "/api/v1/commands") commands.push(await request.clone().json());
        const response = await (launch ? h.app : fixtures.app).fetch(request);
        if (url.pathname === "/api/v1/commands") {
          publish(); if (loseNextResponse) { loseNextResponse = false; res.writeHead(200, { "content-type": "application/json" }).end(""); return; }
        }
        res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); return;
      }
      const target = normalize(join(PARITY_DIST_DIR, url.pathname === "/" ? "index.html" : url.pathname));
      if (!target.startsWith(`${PARITY_DIST_DIR}/`)) throw new Error("static path escaped launch bundle");
      const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
      res.writeHead(200, { "content-type": types[extname(target)] ?? "application/octet-stream" }).end(await readFile(target));
    })().catch((error: unknown) => { if (res.headersSent) res.destroy(); else res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: String(error) })); });
  });
  held.server = server;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (address === null || typeof address === "string") throw new Error("launch server failed to bind");
  let closePromise: Promise<void> | undefined;
  return { h, source, day, descriptorHash, projection, snapshot, commands, publish, saveSettings, baseUrl: `http://127.0.0.1:${address.port}`,
    loseResponse: () => { loseNextResponse = true; },
    close() {
      if (closePromise !== undefined) return closePromise;
      closePromise = (async () => {
        try {
          for (const stream of streams) stream.destroy(); server.closeAllConnections();
          await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
          h.dispose();
          retainedRunRerunFixtureOwners.delete(held);
        } catch (error) { held.primary = error; throw retainAuthoritySourceClosure([error], { admission: held }); }
      })();
      return closePromise;
    },
  };
}
export type RunRerunServer = Awaited<ReturnType<typeof startRunRerunServer>>;
