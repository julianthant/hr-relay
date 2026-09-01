/**
 * The BFF spine end-to-end over REAL machinery: the D109 planner + a real
 * authority database + the D113 kernel behind POST /api/v1/start-plans and
 * POST /api/v1/commands, run.queued span emission into real JSONL, THE
 * projection serving GET /api/v1/dashboard, run detail + note-backed logs,
 * and strict route refusals. No projection fake, no kernel fake — the only
 * fakes are the process seams (worker supervisor, write sequencer) that 1g
 * leaves typed.
 */
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type { ArtifactRef } from "../../../src/domain/artifacts.js";
import { manualClock } from "../../../src/domain/clock.js";
import { ActivityReportWireSchema } from "../../../src/domain/dashboard/activity.js";
import { RunDetailSectionResponseSchema } from "../../../src/domain/dashboard/run-detail.js";
import { DiagnosticBundleIdSchema } from "../../../src/domain/ids.js";
import { DiagnosticBundleSchema, type DiagnosticBundle } from "../../../src/domain/trust/diagnostic.js";
import { StorageDoctorWireSchema } from "../../../src/domain/dashboard/storage.js";
import { defineWorkflowRole } from "../../../src/domain/workflow/module-role.js";
import { createCommandKernel } from "../../../src/core/command-kernel.js";
import { AuthorityDatabase, type AuthorityRepositories } from "../../../src/infra/sqlite/index.js";
import { DiagnosticAttachmentStorageRecordSchema } from "../../../src/infra/sqlite/storage-records.js";
import { createContentAddressedArtifactWriter } from "../../../src/infra/artifacts/content-addressed-artifact-writer.js";
import {
  createServerVerifiedArtifactReader,
  type ServerVerifiedArtifactReader,
} from "../../../src/infra/artifacts/server-verified-artifact-reader.js";
import { createNoteJsonlWriter } from "../../../src/infra/events/note-jsonl-writer.js";
import { createSpanJsonlWriter } from "../../../src/infra/events/span-jsonl-writer.js";
import { readEventStreamLines } from "../../../src/infra/events/jsonl-streams.js";
import { createDashboardCommandService } from "../../../src/server/dashboard/commands/command-service.js";
import { createStartPlanService } from "../../../src/server/dashboard/commands/start-plan-service.js";
import { descriptorSetHash } from "../../../src/server/dashboard/compose.js";
import {
  startDashboardHttpServer,
  type DashboardHttpServer,
} from "../../../src/server/dashboard/http-server.js";
import { createReceiptService } from "../../../src/server/trust/receipt-service.js";
import { createDashboardApp } from "../../../src/server/dashboard/routes/api.js";
import type { DiagnosticBundleQueryDeps } from "../../../src/server/dashboard/queries/diagnostic-bundle.js";
import type { ArtifactBytesQueryDeps } from "../../../src/server/dashboard/queries/artifact-bytes.js";
import { createDiagnosticCaptureService } from "../../../src/services/trust/diagnostic-capture.js";
import { activityReportCsv } from "../../../src/server/dashboard/queries/activity-export.js";
import { activityReportCaveats } from "../../../src/domain/dashboard/activity.js";
import { createRunQueueProjection } from "../../../src/server/dashboard/projectors/run-queue-projection.js";
import { createDashboardStreamHub, type DashboardStreamHub } from "../../../src/server/dashboard/subscriptions/dashboard-stream.js";
import { fixtureDescriptor } from "../architecture/helpers/descriptor-fixtures.js";
import { HASH_B, UUID_4 } from "../fixtures/phase1c-contract-fixtures.js";
import { RUN_ID, sequentialIdFactory } from "../fixtures/phase1f-run-fixtures.js";
import { personLookupQueuedRun } from "../fixtures/phase1f-executor-harness.js";
import { AT, DAY } from "./helpers/dashboard-harness.js";
import { NO_INTAKE_PROJECTIONS, UNSTORED_CONFIG_IDENTITY, UNWIRED_INTAKE_PARSER, UNWIRED_INTAKE_SERVICE } from "../../fixtures/intake-kernel-seams.js";
import { resolveConfig } from "../../../src/domain/config/resolve.js";
import { UNWIRED_CAPTURE_SERVICE } from "../../fixtures/capture-surface-seams.js";
import { explorerQueryDeps, uiCatalogQueryDeps } from "../../fixtures/explorer-seams.js";
import { archiveQueryDeps, archiveSnapshots } from "../../fixtures/archive-seams.js";
import { createLedgerReadThrough } from "../../../src/infra/ledger/ledger-read-through.js";
import { UNOBSERVED_BACKFILL_GAP_NOTIFIER } from "../../fixtures/dashboard-stream-seams.js";

interface Harness {
  readonly app: Hono;
  readonly database: AuthorityDatabase;
  readonly stateRoot: string;
  readonly clock: ReturnType<typeof manualClock>;
  readonly noteWriter: ReturnType<typeof createNoteJsonlWriter>;
  readonly hub: DashboardStreamHub;
  readonly projection: ReturnType<typeof createRunQueueProjection>;
  readonly artifacts: ReturnType<typeof createContentAddressedArtifactWriter>;
  readonly artifactSourceReads: number[];
}

type DiagnosticBundleHarnessDeps = DiagnosticBundleQueryDeps
  & ArtifactBytesQueryDeps
  & Readonly<{ artifacts: ReturnType<typeof createContentAddressedArtifactWriter> }>;

function beforeArtifactReaderOperation(
  reader: ServerVerifiedArtifactReader,
  before: (operation: "verify" | "prepare", ref: ArtifactRef) => void | Promise<void>,
): ServerVerifiedArtifactReader {
  return Object.freeze({
    async verify(ref: ArtifactRef, signal?: AbortSignal) {
      await before("verify", ref);
      await reader.verify(ref, signal);
    },
    async prepare(ref: ArtifactRef, signal?: AbortSignal) {
      await before("prepare", ref);
      return reader.prepare(ref, signal);
    },
  });
}

function observeArtifactLeaseDisposal(
  reader: ServerVerifiedArtifactReader,
  onDispose: () => void,
): ServerVerifiedArtifactReader {
  return Object.freeze({
    verify: (ref: ArtifactRef, signal?: AbortSignal) => reader.verify(ref, signal),
    async prepare(ref: ArtifactRef, signal?: AbortSignal) {
      const lease = await reader.prepare(ref, signal);
      return Object.freeze({
        ref: lease.ref,
        takeBody: () => lease.takeBody(),
        async dispose() {
          onDispose();
          await lease.dispose();
        },
      });
    },
  });
}

function writeStoredArtifactEnvelope(
  h: Harness,
  ref: ArtifactRef,
  mutation: "digest" | "oversized" | "truncated" | "identity" | "metadata digest" | "size" | "media type",
): void {
  const payloadBase64 = mutation === "digest" ? "WF0="
    : mutation === "oversized" ? "W10A"
      : mutation === "truncated" ? "Ww=="
        : "W10=";
  writeFileSync(join(h.stateRoot, "artifacts", `${ref.sha256}.artifact`), JSON.stringify({
    ref: {
      ...ref,
      ...(mutation === "identity" ? { id: "00000000-0000-4000-8000-000000000099" } : {}),
      ...(mutation === "metadata digest" ? { sha256: "0".repeat(64) } : {}),
      ...(mutation === "size" ? { bytes: 3 } : {}),
      ...(mutation === "media type" ? { mediaType: "text/plain" } : {}),
    },
    payloadBase64,
  }));
}

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function harness(options: {
  readonly capturePhoneHost?: string;
  readonly capturePhoneAssetPaths?: ReadonlySet<string>;
  readonly omitDiagnosticBundles?: boolean;
  readonly diagnosticBundles?: (
    real: DiagnosticBundleHarnessDeps,
  ) => DiagnosticBundleHarnessDeps;
  readonly observeArtifactLeaseClosed?: () => void;
  readonly runCaptureAuthority?: (
    real: AuthorityRepositories["diagnosticBundles"],
  ) => AuthorityRepositories["diagnosticBundles"];
} = {}): Harness {
  const root = mkdtempSync(join(tmpdir(), "hrauto-bff-"));
  const stateRoot = join(root, ".tracker-rebuild");
  const clock = manualClock(AT);
  const ids = sequentialIdFactory("c");
  const database = AuthorityDatabase.open(
    { path: join(root, "state.db"), busyTimeoutMs: 1000, migrationOwner: "bff-flow-test" },
    clock,
  );
  const artifacts = createContentAddressedArtifactWriter({
    workspaceRoot: root,
    artifactRoot: ".tracker-rebuild/artifacts",
  });
  const artifactSourceReads: number[] = [];
  const artifactReader = createServerVerifiedArtifactReader({
    workspaceRoot: root,
    artifactRoot: ".tracker-rebuild/artifacts",
    observeIo: (kind, bytes) => {
      if (kind === "source-read") artifactSourceReads.push(bytes);
    },
    ...(options.observeArtifactLeaseClosed === undefined
      ? {}
      : { observeLeaseClosed: options.observeArtifactLeaseClosed }),
  });
  cleanups.push(() => {
    database.close();
    rmSync(root, { recursive: true, force: true });
  });

  const descriptors = {
    resolve: (workflowId: string) => (workflowId === "fixture-graph" ? fixtureDescriptor : undefined),
  };
  const projection = createRunQueueProjection({
    stateRoot,
    clock,
    appVersion: "0.1.0",
    descriptorSetHash: descriptorSetHash([fixtureDescriptor.contractFingerprint]),
    ledger: createLedgerReadThrough(stateRoot),
    authority: { getRun: (runId) => database.authority.runs.get(runId),
      listNotifications: () => [],
      listLiveWorkerLeases: () => database.authority.workerLeases.listLive(),
      getWorkerLease: (workerId: string) => database.authority.workerLeases.get(workerId),
      listWorkerPools: () => database.authority.workerPools.list(),
      isArchived: (runId: string) => database.authority.archivedRuns.isArchived(runId),
      getFailure: (failureId: string) => database.authority.failures.get(failureId),
      getReceipt: (runId: string) => database.authority.evidenceReceipts.findByRun(runId),
      latestCheckpoint: (workflowId: string, itemId: string, nodeId: string) =>
        database.authority.runCheckpoints.latest(workflowId, itemId, nodeId),
    },
    descriptors,
    projectionStore: database,
  });
  // D218: no in-process hook — the command service ticks the projection's
  // disk tail after emitting, exactly as production wires it.
  const spans = createSpanJsonlWriter({
    stateRoot,
    clock,
    pid: 4242,
  });
  const noteWriter = createNoteJsonlWriter({ stateRoot, clock, pid: 4242 });

  const runDetailDeps = {
    stateRoot,
    projection,
    authority: {
      getRun: (runId: string) => database.authority.runs.get(runId),
      latestCheckpoint: (workflowId: string, itemId: string, nodeId: string) =>
        database.authority.runCheckpoints.latest(workflowId, itemId, nodeId),
      getWriteIntent: (writeIntentId: string) => database.authority.writeIntents.get(writeIntentId),
      listGateResults: (runId: string) => database.authority.gateResults.listByRun(runId),
    },
    descriptors: {
      resolve: (workflowId: string) => (workflowId === fixtureDescriptor.id ? fixtureDescriptor : undefined),
    },
    trust: createReceiptService({ database, descriptors: [fixtureDescriptor] }),
    captures: {
      authority: options.runCaptureAuthority?.(database.authority.diagnosticBundles)
        ?? database.authority.diagnosticBundles,
      artifactReader,
    },
  };

  const kernel = createCommandKernel({
    appVersion: "0.1.0",
    archiveSnapshots: archiveSnapshots(runDetailDeps),
    configIdentity: UNSTORED_CONFIG_IDENTITY,
    intakeParser: UNWIRED_INTAKE_PARSER,
    intakeProjections: NO_INTAKE_PROJECTIONS,
    authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
    clock,
    ids,
    descriptors,
    writeResolution: {
      resolvePresent: () => {
        throw new Error("write resolution is not wired in this harness");
      },
      resolveAbsent: () => {
        throw new Error("write resolution is not wired in this harness");
      },
    },
    workerRuntime: {
      planWorkerCount: () => ({ state: "accepted", workerIds: ["fixture-graph-worker-1"] }),
      spawnWorker: () => ({ state: "accepted" }),
      refreshBrowser: () => ({ state: "accepted" }),
      reopenBrowser: () => ({ state: "accepted" }),
    },
  });
  const commands = createDashboardCommandService({
    kernel,
    clock,
    spans,
    projection,
    descriptors,
    authorityRead: {
      getRun: (runId) => database.authority.runs.get(runId),
      getStartPlan: (startPlanId) => database.authority.startPlans.get(startPlanId),
      getIntakeSession: (intakeSessionId) => database.authority.intakeSessions.get(intakeSessionId),
      getIntakeManifest: (manifestId) => database.authority.intakeManifests.get(manifestId),
    },
  });
  const startPlans = createStartPlanService({
    authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
    authorityRead: database,
    descriptors,
    clock,
    ids,
    planTtlMs: 10 * 60 * 1000,
    configFingerprint: HASH_B,
    configSnapshotId: UUID_4,
    plannedBy: "local-operator",
  });
  const hub = createDashboardStreamHub({ projection, backfillGaps: UNOBSERVED_BACKFILL_GAP_NOTIFIER });
  cleanups.push(() => hub.close());


  const app = createDashboardApp({
    intake: UNWIRED_INTAKE_SERVICE,
    capture: UNWIRED_CAPTURE_SERVICE,
    capturePhoneHost: options.capturePhoneHost,
    capturePhoneAssetPaths: options.capturePhoneAssetPaths,
    bootstrap: {
      appVersion: "0.1.0",
      clock,
      modules: [{ descriptor: fixtureDescriptor, role: defineWorkflowRole({ kind: "standalone" }) }],
      descriptorSetHash: descriptorSetHash([fixtureDescriptor.contractFingerprint]),
      settingsSchemaHash: descriptorSetHash(["settings-schema"]),
      projection,
      authorityMeta: () => database.getMeta(),
      // The harness runs no backup lane; "missing" is its true state.
      backupSummary: () => "missing",
      // No advisory provider is composed in this harness (D178).
      advisoryAvailability: () => ({
        state: "unavailable",
        code: "not-configured",
        reason: "no ai.advisory provider is composed in this harness",
      }),
    },
    projection,
    ...(options.omitDiagnosticBundles
      ? {}
      : {
          diagnosticBundles: options.diagnosticBundles?.({
            authority: database.authority.diagnosticBundles,
            artifactReader,
            artifacts,
          }) ?? {
            authority: database.authority.diagnosticBundles,
            artifactReader,
          },
        }),
    runDetail: runDetailDeps,
    archive: archiveQueryDeps({ database, clock, appVersion: "0.1.0", descriptors: [fixtureDescriptor] }),
    commands,
    startPlans,
    hub,
    // D274 item 6 — the read-only Settings status sections read the SAME
    // resolved config and descriptor tuple this harness composes everything else
    // from, so nothing on that page can be true here and false in production.
    settings: { config: resolveConfig({}, {}, clock), descriptors: [fixtureDescriptor] },
    storage: {
      doctorOptions: {
        // The harness database lives at the temp ROOT, not under stateRoot.
        authorityPath: join(root, "state.db"),
        backupDirectory: join(stateRoot, "backups", "authority"),
        maxBackupAgeMs: 45 * 60 * 1000,
        busyTimeoutMs: 1000,
      },
      clock,
      serviceState: () => ({
        state: "never-run",
        reason: "the test harness runs no backup lane",
      }),
    },
    explorer: explorerQueryDeps(clock, descriptorSetHash([fixtureDescriptor.contractFingerprint])),
    uiCatalog: uiCatalogQueryDeps(),
  });
  return { app, database, stateRoot, clock, noteWriter, hub, projection, artifacts, artifactSourceReads };
}

async function captureDiagnosticBundle(h: Harness, runId = RUN_ID) {
  if (h.database.authority.runs.get(runId) === undefined) {
    h.database.authority.runs.enqueue(personLookupQueuedRun({ runId }));
  }
  return createDiagnosticCaptureService({
    authority: h.database.authority,
    artifacts: h.artifacts,
    clock: h.clock,
    ids: sequentialIdFactory("d"),
  }).capture({
    trigger: "operator-request",
    runId,
    requestedBy: "local-operator",
    configFingerprint: HASH_B,
    descriptorFingerprint: fixtureDescriptor.contractFingerprint,
    fields: [],
    attachments: [{
      kind: "console-summary",
      mediaType: "application/json",
      bytes: new TextEncoder().encode("[]"),
      sensitivity: "redacted",
    }],
  });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

async function loopbackResponse(
  server: DashboardHttpServer,
  path: string,
  init: Readonly<{ method: "GET" | "HEAD"; headers?: Readonly<Record<string, string>> }>,
): Promise<Readonly<{ status: number; headers: Readonly<Record<string, string | string[] | undefined>>; body: Buffer }>> {
  return new Promise((resolve, reject) => {
    const client = request({
      hostname: "127.0.0.1",
      port: server.port,
      path,
      method: init.method,
      headers: init.headers,
    }, (response) => {
      const chunks: Uint8Array[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(Uint8Array.from(chunk)));
      response.once("end", () => resolve(Object.freeze({
        status: response.statusCode ?? 0,
        headers: Object.freeze({ ...response.headers }),
        body: Buffer.concat(chunks),
      })));
      response.once("error", reject);
    });
    client.once("error", reject);
    client.end();
  });
}

describe("BFF spine flow (start plan -> kernel -> spans -> projection)", () => {
  it.each([
    { profile: "generic", method: "HEAD", range: undefined, status: 200 },
    { profile: "bundle", method: "HEAD", range: undefined, status: 200 },
    { profile: "generic", method: "GET", range: "bytes=0-0", status: 416 },
    { profile: "bundle", method: "GET", range: "bytes=0-0", status: 416 },
  ] as const)(
    "serves the real $profile $method/$status verified-byte profile over node:http",
    async ({ profile, method, range, status }) => {
      let disposals = 0;
      const transferErrors: Error[] = [];
      const h = harness({
        observeArtifactLeaseClosed: () => {
          disposals += 1;
        },
      });
      const bundle = await captureDiagnosticBundle(h);
      const attachment = bundle.attachments[0];
      if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
      const path = profile === "generic"
        ? `/artifacts/v1/${attachment.artifactId}`
        : `/api/v1/diagnostic-bundles/${bundle.bundleId}/attachments/${attachment.artifactId}`;
      const server = await startDashboardHttpServer({
        app: h.app,
        port: 0,
        onTransferError: (error) => transferErrors.push(error),
      });
      try {
        const response = await loopbackResponse(server, path, {
          method,
          ...(range === undefined ? {} : { headers: { range } }),
        });

        assert.equal(response.status, status);
        assert.equal(response.body.byteLength, 0);
        assert.equal(response.headers["cache-control"], "no-store");
        assert.equal(
          response.headers["content-disposition"],
          undefined,
          `${profile} must not inherit Archive's attachment-only disposition`,
        );
        if (status === 200) {
          assert.equal(response.headers["content-type"], attachment.mediaType);
          assert.equal(response.headers["content-length"], String(attachment.byteLength));
          assert.equal(response.headers["content-range"], undefined);
        } else {
          assert.equal(response.headers["content-range"], `bytes */${String(attachment.byteLength)}`);
          assert.equal(response.headers["content-type"], undefined);
          assert.equal(response.headers["content-length"], undefined);
        }
        assert.equal(disposals, 1);
        assert.equal(h.artifactSourceReads.length, profile === "generic" ? 1 : 2);
        assert.deepEqual(transferErrors, []);
      } finally {
        await server.close();
      }
    },
  );

  it("cancels the actual generic verified-byte route lease when its socket disconnects", async () => {
    const leaseClosed = Promise.withResolvers<void>();
    const transferErrors: Error[] = [];
    const h = harness({ observeArtifactLeaseClosed: leaseClosed.resolve });
    const bytes = Buffer.alloc(2 * 1024 * 1024, 0x5a);
    h.database.authority.runs.enqueue(personLookupQueuedRun({ runId: RUN_ID }));
    const bundle = await createDiagnosticCaptureService({
      authority: h.database.authority,
      artifacts: h.artifacts,
      clock: h.clock,
      ids: sequentialIdFactory("f"),
    }).capture({
      trigger: "operator-request",
      runId: RUN_ID,
      requestedBy: "local-operator",
      configFingerprint: HASH_B,
      descriptorFingerprint: fixtureDescriptor.contractFingerprint,
      fields: [],
      attachments: [{
        kind: "console-summary",
        mediaType: "application/json",
        bytes,
        sensitivity: "redacted",
      }],
    });
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    const server = await startDashboardHttpServer({
      app: h.app,
      port: 0,
      onTransferError: (error) => transferErrors.push(error),
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const client = request({
          hostname: "127.0.0.1",
          port: server.port,
          method: "GET",
          path: `/artifacts/v1/${attachment.artifactId}`,
        }, (response) => {
          response.once("error", () => undefined);
          response.pause();
          response.destroy();
          resolve();
        });
        client.once("error", reject);
        client.end();
      });

      await leaseClosed.promise;
      assert.ok(h.artifactSourceReads.length > 1);
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.ok(transferErrors.length <= 1, "one disconnected transfer may report at most one local error");
      for (const error of transferErrors) assert.match(error.message, /closed|disconnected/u);
    } finally {
      await server.close();
    }
  });

  it("aborts the actual generic route's preparation before headers when its socket disconnects", async () => {
    const routedSignal = Promise.withResolvers<AbortSignal>();
    const signalAborted = Promise.withResolvers<AbortSignal>();
    const transferErrors: Error[] = [];
    const h = harness({
      diagnosticBundles: (real) => ({
        ...real,
        artifactReader: Object.freeze({
          verify: (ref: ArtifactRef, signal?: AbortSignal) => real.artifactReader.verify(ref, signal),
          async prepare(ref: ArtifactRef, signal?: AbortSignal) {
            if (signal === undefined) {
              const error = new Error("the real generic route omitted its request signal");
              routedSignal.reject(error);
              throw error;
            }
            routedSignal.resolve(signal);
            await new Promise<void>((resolve) => signal.addEventListener("abort", () => {
              signalAborted.resolve(signal);
              resolve();
            }, { once: true }));
            signal.throwIfAborted();
            return real.artifactReader.prepare(ref, signal);
          },
        }),
      }),
    });
    const bundle = await captureDiagnosticBundle(h);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    const server = await startDashboardHttpServer({
      app: h.app,
      port: 0,
      onTransferError: (error) => transferErrors.push(error),
    });
    let serverClosed = false;
    try {
      const clientClosed = Promise.withResolvers<void>();
      const client = request({
        hostname: "127.0.0.1",
        port: server.port,
        method: "GET",
        path: `/artifacts/v1/${attachment.artifactId}`,
      });
      client.once("error", () => undefined);
      client.once("close", clientClosed.resolve);
      client.end();
      const signal = await routedSignal.promise;
      assert.equal(signal.aborted, false);
      client.destroy();

      const observedSignal = await signalAborted.promise;
      await clientClosed.promise;
      assert.equal(observedSignal, signal);
      assert.equal(signal.aborted, true);
      assert.match(String(signal.reason), /disconnected before response handoff/u);
      await server.close();
      serverClosed = true;
      assert.deepEqual(
        transferErrors,
        [],
        "an expected pre-handoff client abort must not be mislabeled as a response-transfer failure",
      );
    } finally {
      if (!serverClosed) await server.close();
    }
  });

  it("serves an authorized diagnostic attachment as an exact no-store resource", async () => {
    const h = harness();
    const bundle = await captureDiagnosticBundle(h);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");

    const response = await h.app.request(`/artifacts/v1/${attachment.artifactId}`);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), attachment.mediaType);
    assert.equal(response.headers.get("content-length"), String(attachment.byteLength));
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new TextEncoder().encode("[]"));
  });

  it.each(["generic", "bundle"] as const)(
    "verifies and disposes the selected %s lease before returning an exact HEAD response",
    async (profile) => {
      let disposals = 0;
      const h = harness({ diagnosticBundles: (real) => ({
        ...real,
        artifactReader: observeArtifactLeaseDisposal(real.artifactReader, () => {
          disposals += 1;
        }),
      }) });
      const bundle = await captureDiagnosticBundle(h);
      const attachment = bundle.attachments[0];
      if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
      const path = profile === "generic"
        ? `/artifacts/v1/${attachment.artifactId}`
        : `/api/v1/diagnostic-bundles/${bundle.bundleId}/attachments/${attachment.artifactId}`;

      const response = await h.app.request(path, { method: "HEAD" });

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), attachment.mediaType);
      assert.equal(response.headers.get("content-length"), String(attachment.byteLength));
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(await response.text(), "");
      assert.equal(disposals, 1);
      assert.equal(h.artifactSourceReads.length, profile === "generic" ? 1 : 2);
    },
  );

  it.each(["generic", "bundle"] as const)(
    "verifies and disposes the selected %s lease before refusing Range",
    async (profile) => {
      let disposals = 0;
      const h = harness({ diagnosticBundles: (real) => ({
        ...real,
        artifactReader: observeArtifactLeaseDisposal(real.artifactReader, () => {
          disposals += 1;
        }),
      }) });
      const bundle = await captureDiagnosticBundle(h);
      const attachment = bundle.attachments[0];
      if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
      const path = profile === "generic"
        ? `/artifacts/v1/${attachment.artifactId}`
        : `/api/v1/diagnostic-bundles/${bundle.bundleId}/attachments/${attachment.artifactId}`;

      const response = await h.app.request(path, { headers: { range: "bytes=0-0" } });

      assert.equal(response.status, 416);
      assert.equal(response.headers.get("content-range"), `bytes */${String(attachment.byteLength)}`);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(await response.text(), "");
      assert.equal(disposals, 1);
      assert.equal(h.artifactSourceReads.length, profile === "generic" ? 1 : 2);
    },
  );

  it("serves an attachment only through the exact verified bundle that indexes it", async () => {
    const readerOperations: { operation: "verify" | "prepare"; ref: ArtifactRef }[] = [];
    const h = harness({ diagnosticBundles: (real) => ({
      ...real,
      artifactReader: beforeArtifactReaderOperation(real.artifactReader, (operation, ref) => {
        readerOperations.push({ operation, ref });
      }),
    }) });
    const bundle = await captureDiagnosticBundle(h);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    const envelopeByteLength = readFileSync(
      join(h.stateRoot, "artifacts", `${attachment.digest}.artifact`),
    ).byteLength;

    const response = await h.app.request(
      `/api/v1/diagnostic-bundles/${bundle.bundleId}/attachments/${attachment.artifactId}`,
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), attachment.mediaType);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new TextEncoder().encode("[]"));
    assert.deepEqual(readerOperations, [
      {
        operation: "verify",
        ref: {
          id: attachment.artifactId,
          sha256: attachment.digest,
          bytes: attachment.byteLength,
          mediaType: attachment.mediaType,
        },
      },
      {
        operation: "prepare",
        ref: {
          id: attachment.artifactId,
          sha256: attachment.digest,
          bytes: attachment.byteLength,
          mediaType: attachment.mediaType,
        },
      },
    ], "selected success performs one E29 verification and one fresh exact-ref preparation");
    assert.deepEqual(
      h.artifactSourceReads,
      [envelopeByteLength, envelopeByteLength],
      "selected preparation performs a fresh source read after E29",
    );

    const foreign = await h.app.request(
      `/api/v1/diagnostic-bundles/00000000-0000-4000-8000-000000000099/attachments/${attachment.artifactId}`,
    );
    assert.equal(foreign.status, 404, "an indexed artifact must not detach from its requested bundle identity");
  });

  it("serves the stored screenshot bytes and its captured dimensions through one exact bundle", async () => {
    const h = harness();
    await captureDiagnosticBundle(h);
    const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jG9sAAAAASUVORK5CYII=";
    const bundle = await createDiagnosticCaptureService({
      authority: h.database.authority, artifacts: h.artifacts, clock: h.clock, ids: sequentialIdFactory("e"),
    }).capture({
      trigger: "operator-request", runId: RUN_ID, requestedBy: "local-operator",
      configFingerprint: HASH_B, descriptorFingerprint: fixtureDescriptor.contractFingerprint,
      fields: [], attachments: [{
        kind: "screenshot", mediaType: "image/png", bytes: Buffer.from(pngBase64, "base64"),
        width: 1, height: 1, sensitivity: "restricted",
      }],
    });
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its screenshot");
    const path = `/api/v1/diagnostic-bundles/${bundle.bundleId}`;
    const metadata = await h.app.request(path);
    const wire = await json(metadata);
    assert.deepEqual(wire.contents, [{
      kind: "screenshot", key: "Screenshot", detail: "image/png · 68 bytes · 1 × 1 px · restricted",
      artifactId: attachment.artifactId, mediaType: "image/png", byteLength: 68,
      digest: attachment.digest, width: 1, height: 1, sensitivity: "restricted",
    }]);
    const response = await h.app.request(`${path}/attachments/${attachment.artifactId}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.equal(response.headers.get("content-length"), "68");
    assert.equal(Buffer.from(await response.arrayBuffer()).toString("base64"), pngBase64);
  });

  it("marks diagnostic metadata and refused resource responses no-store and nosniff", async () => {
    const h = harness();
    const bundle = await captureDiagnosticBundle(h);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    const base = `/api/v1/diagnostic-bundles/${bundle.bundleId}`;

    for (const [path, status] of [
      [base, 200],
      [`${base}/manifest`, 200],
      [`${base}/attachments/${attachment.artifactId}`, 200],
      [`${base}/attachments/00000000-0000-4000-8000-000000000099`, 404],
    ] as const) {
      const response = await h.app.request(path);
      assert.equal(response.status, status);
      assert.equal(response.headers.get("cache-control"), "no-store", path);
      assert.equal(response.headers.get("x-content-type-options"), "nosniff", path);
      await response.body?.cancel();
    }
  });

  it("refuses an existing attachment owned only by another existing bundle", async () => {
    const h = harness();
    const first = await captureDiagnosticBundle(h);
    const second = await createDiagnosticCaptureService({
      authority: h.database.authority,
      artifacts: h.artifacts,
      clock: h.clock,
      ids: sequentialIdFactory("e"),
    }).capture({
      trigger: "operator-request", runId: RUN_ID, requestedBy: "local-operator",
      configFingerprint: HASH_B, descriptorFingerprint: fixtureDescriptor.contractFingerprint,
      fields: [], attachments: [{
        kind: "console-summary", mediaType: "application/json",
        bytes: new TextEncoder().encode('["other bundle"]'), sensitivity: "redacted",
      }],
    });
    const attachment = first.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    const secondBundleResponse = await h.app.request(`/api/v1/diagnostic-bundles/${second.bundleId}`);
    assert.equal(secondBundleResponse.status, 200);
    await secondBundleResponse.body?.cancel();
    const genericResponse = await h.app.request(`/artifacts/v1/${attachment.artifactId}`);
    assert.equal(genericResponse.status, 200);
    await genericResponse.body?.cancel();

    const response = await h.app.request(
      `/api/v1/diagnostic-bundles/${second.bundleId}/attachments/${attachment.artifactId}`,
      { headers: { range: "bytes=0-0" } },
    );
    assert.equal(response.status, 404);
    assert.equal((await json(response)).code, "TARGET_NOT_FOUND");
    assert.equal(response.headers.get("content-range"), null);
  });

  it("does not infer purge history from absent diagnostic authority", async () => {
    const h = harness();
    const bundle = await captureDiagnosticBundle(h);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    h.database.authority.diagnosticBundles.purge(bundle.bundleId, "2027-01-01T00:00:00.000Z");

    for (const bundleId of [bundle.bundleId, "00000000-0000-4000-8000-000000000099"]) {
      for (const suffix of ["", "/manifest", `/attachments/${attachment.artifactId}`]) {
        const response = await h.app.request(`/api/v1/diagnostic-bundles/${bundleId}${suffix}`);
        assert.equal(response.status, 404);
        const body = await json(response);
        assert.equal(body.code, "TARGET_NOT_FOUND");
        assert.equal(body.retryable, false);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.equal(response.headers.get("content-disposition"), null);
      }
    }
    assert.equal(readFileSync(join(h.stateRoot, "artifacts", `${attachment.digest}.artifact`), "utf8").length > 0, true,
      "physical bytes remain, but no longer authorize an attachment response");
  });

  it.each(["bundle identity", "bundle digest", "index identity", "index digest", "index size", "index media type", "missing index", "duplicate index"] as const)(
    "refuses exact attachment readback for corrupt %s before opening bytes", async (mutation) => {
      let opened = false;
      const h = harness({ diagnosticBundles: (real) => ({
        ...real,
        authority: {
          ...real.authority,
          get: (id) => {
            const stored = real.authority.get(id);
            if (stored === undefined) return undefined;
            return DiagnosticBundleSchema.parse({ ...stored,
              ...(mutation === "bundle identity" ? { bundleId: "00000000-0000-4000-8000-000000000099" } : {}),
              ...(mutation === "bundle digest" ? { contentDigest: "0".repeat(64) } : {}),
            });
          },
          listAttachments: (id) => {
            const rows = real.authority.listAttachments(id);
            if (mutation === "missing index") return [];
            if (mutation === "duplicate index") return [...rows, ...rows];
            return rows.map((row) => DiagnosticAttachmentStorageRecordSchema.parse({
              ...row,
              ...(mutation === "index identity" ? { bundleId: "00000000-0000-4000-8000-000000000099" } : {}),
              attachment: { ...row.attachment,
                ...(mutation === "index digest" ? { digest: "0".repeat(64) } : {}),
                ...(mutation === "index size" ? { byteLength: 3 } : {}),
                ...(mutation === "index media type" ? { kind: "accessibility-excerpt", mediaType: "text/yaml" } : {}),
              },
            }));
          },
        },
        artifactReader: beforeArtifactReaderOperation(real.artifactReader, () => {
          opened = true;
        }),
      }) });
      const bundle = await captureDiagnosticBundle(h);
      const attachment = bundle.attachments[0];
      if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");

      const response = await h.app.request(`/api/v1/diagnostic-bundles/${bundle.bundleId}/attachments/${attachment.artifactId}`);
      assert.equal(response.status, 500);
      assert.equal((await json(response)).code, "DIAGNOSTIC_BUNDLE_CORRUPT");
      assert.equal(response.headers.get("content-length"), null);
      assert.equal(opened, false, "authority must bind before storage is opened");
    },
  );

  for (const [failOnRead, phase] of [[1, "E29"], [2, "fresh selected prepare"]] as const) {
    it.each(["digest", "oversized", "truncated", "read failure"] as const)(
      `refuses %s during ${phase} without a partial byte response`, async (mutation) => {
        let reads = 0;
        const operations: ("verify" | "prepare")[] = [];
        const h: Harness = harness({ diagnosticBundles: (real) => ({
          ...real,
          artifactReader: beforeArtifactReaderOperation(real.artifactReader, async (operation, ref) => {
            operations.push(operation);
            reads += 1;
            if (reads !== failOnRead) return;
            if (mutation === "read failure") throw new Error("PRIVATE_STORAGE_PATH");
            writeStoredArtifactEnvelope(h, ref, mutation);
          }),
        }) });
        const bundle = await captureDiagnosticBundle(h);
        const attachment = bundle.attachments[0];
        if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");

        const response = await h.app.request(`/api/v1/diagnostic-bundles/${bundle.bundleId}/attachments/${attachment.artifactId}`,
          { headers: { range: "bytes=0-0" } });
        assert.equal(response.status, 500);
        const body = await json(response);
        assert.equal(body.code, "DIAGNOSTIC_BUNDLE_CORRUPT");
        assert.equal(body.retryable, false);
        assert.equal(reads, failOnRead);
        assert.deepEqual(operations, failOnRead === 1 ? ["verify"] : ["verify", "prepare"]);
        assert.doesNotMatch(JSON.stringify(body), /PRIVATE_STORAGE_PATH/u);
        assert.equal(response.headers.get("content-range"), null);
        assert.equal(response.headers.get("content-length"), null);
        assert.equal(response.headers.get("cache-control"), "no-store");
      },
    );
  }

  it("refuses a verified attachment Range without returning partial bytes", async () => {
    const h = harness();
    const bundle = await captureDiagnosticBundle(h);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    const response = await h.app.request(`/api/v1/diagnostic-bundles/${bundle.bundleId}/attachments/${attachment.artifactId}`,
      { headers: { range: "bytes=0-0" } });
    assert.equal(response.status, 416);
    assert.equal(response.headers.get("content-range"), "bytes */2");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  });

  for (const [failOnRead, phase] of [[1, "E29"], [2, "fresh selected prepare"]] as const) {
    it.each(["identity", "digest", "size", "media type"] as const)(
      `refuses a stored attachment whose physical %s changes during ${phase}`, async (mutation) => {
        let reads = 0;
        const operations: ("verify" | "prepare")[] = [];
        const h: Harness = harness({ diagnosticBundles: (real) => ({
          ...real,
          artifactReader: beforeArtifactReaderOperation(real.artifactReader, async (operation, ref) => {
            operations.push(operation);
            reads += 1;
            if (reads === failOnRead) {
              writeStoredArtifactEnvelope(h, ref, mutation === "digest" ? "metadata digest" : mutation);
            }
          }),
        }) });
        const bundle = await captureDiagnosticBundle(h);
        const attachment = bundle.attachments[0];
        if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");

        const response = await h.app.request(`/api/v1/diagnostic-bundles/${bundle.bundleId}/attachments/${attachment.artifactId}`);
        assert.equal(response.status, 500);
        const body = await json(response);
        assert.equal(body.code, "DIAGNOSTIC_BUNDLE_CORRUPT");
        assert.equal(body.retryable, false);
        assert.equal(reads, failOnRead);
        assert.deepEqual(operations, failOnRead === 1 ? ["verify"] : ["verify", "prepare"]);
        assert.doesNotMatch(JSON.stringify(body), new RegExp(h.stateRoot, "u"));
        assert.equal(response.headers.get("content-length"), null);
      },
    );
  }

  it.each([
    ["bad bundle", "..%2F..%2Flatest", "00000000-0000-4000-8000-000000000001"],
    ["bad attachment", "00000000-0000-4000-8000-000000000001", "..%2F..%2Flatest"],
  ])("rejects %s before diagnostic authority lookup", async (_case, bundleId, artifactId) => {
    let authorityRead = false;
    const h = harness({ diagnosticBundles: (real) => ({ ...real, authority: { ...real.authority,
      get: (id) => { authorityRead = true; return real.authority.get(id); },
    } }) });
    const response = await h.app.request(`/api/v1/diagnostic-bundles/${bundleId}/attachments/${artifactId}`);
    assert.equal(response.status, 400);
    assert.equal((await json(response)).code, "SCHEMA_INVALID");
    assert.equal(authorityRead, false);
    assert.equal(response.headers.get("cache-control"), "no-store");
  });

  it("refuses an uncomposed bundle attachment capability by kind", async () => {
    const h = harness({ omitDiagnosticBundles: true });
    const response = await h.app.request("/api/v1/diagnostic-bundles/00000000-0000-4000-8000-000000000001/attachments/00000000-0000-4000-8000-000000000002");
    assert.equal(response.status, 409);
    assert.equal((await json(response)).code, "SECTION_UNAVAILABLE");
    assert.equal(response.headers.get("cache-control"), "no-store");
  });

  it("distinguishes physical missing bytes during E29 and fresh selected preparation", async () => {
    for (const [failOnRead, phase] of [[1, "E29"], [2, "fresh selected prepare"]] as const) {
      let reads = 0;
      const operations: ("verify" | "prepare")[] = [];
      const h: Harness = harness({ diagnosticBundles: (real) => ({
        ...real,
        artifactReader: beforeArtifactReaderOperation(real.artifactReader, async (operation, ref) => {
          operations.push(operation);
          reads += 1;
          if (reads === failOnRead) {
            rmSync(join(h.stateRoot, "artifacts", `${ref.sha256}.artifact`));
          }
        }),
      }) });
      const bundle = await captureDiagnosticBundle(h);
      const attachment = bundle.attachments[0];
      if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");

      const response = await h.app.request(`/api/v1/diagnostic-bundles/${bundle.bundleId}/attachments/${attachment.artifactId}`,
        { headers: { range: "bytes=0-0" } });
      assert.equal(response.status, 500);
      const body = await json(response);
      assert.equal(body.code, "DIAGNOSTIC_BUNDLE_BYTES_MISSING");
      assert.equal(body.retryable, false);
      assert.equal(reads, failOnRead);
      assert.deepEqual(operations, failOnRead === 1 ? ["verify"] : ["verify", "prepare"], phase);
      assert.doesNotMatch(JSON.stringify(body), new RegExp(h.stateRoot, "u"));
      assert.match(String(body.message), new RegExp(bundle.bundleId, "u"));
      assert.match(String(body.message), new RegExp(attachment.artifactId, "u"));
      assert.equal(response.headers.get("content-length"), null);
      assert.equal(response.headers.get("content-range"), null);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
  });

  it("treats a stored object without diagnostic attachment authority as foreign", async () => {
    const h = harness();
    const storedOnly = await h.artifacts.put(
      new TextEncoder().encode("storage is not authorization"),
      { mediaType: "text/plain" },
    );

    const response = await h.app.request(`/artifacts/v1/${storedOnly.id}`, {
      headers: { range: "bytes=0-0" },
    });
    const body = await json(response);

    assert.equal(response.status, 404);
    assert.equal(body.code, "TARGET_NOT_FOUND");
    assert.equal(body.retryable, false);
    assert.doesNotMatch(JSON.stringify(body), /storage is not authorization/u);
  });

  it("reports diagnostic artifact readback unavailable when no authority is composed", async () => {
    const h = harness({ omitDiagnosticBundles: true });

    const response = await h.app.request("/artifacts/v1/00000000-0000-4000-8000-000000000099");
    const body = await json(response);

    assert.equal(response.status, 409);
    assert.equal(body.code, "SECTION_UNAVAILABLE");
    assert.equal(body.retryable, false);
    assert.equal(response.headers.get("content-length"), null);
  });

  it.each([
    ["non-UUID", "not-an-artifact-id"],
    ["traversal-shaped", "..%2F..%2Flatest"],
  ] as const)("rejects a %s artifact id before authority lookup", async (_case, artifactId) => {
    const h = harness({
      diagnosticBundles: (real) => ({
        ...real,
        authority: {
          ...real.authority,
          findByArtifact: () => {
            throw new Error("artifact authority must not see an invalid id");
          },
        },
      }),
    });

    const response = await h.app.request(`/artifacts/v1/${artifactId}`);
    const body = await json(response);

    assert.equal(response.status, 400);
    assert.equal(body.code, "SCHEMA_INVALID");
    assert.doesNotMatch(String(body.message), /artifact authority must not see/u);
  });

  it.each([
    ["digest", "digest", "X"],
    ["size", "oversized", "PRIVATE_DIAGNOSTIC_BYTES"],
  ] as const)("refuses an indexed artifact whose stored %s is corrupt before Range handling", async (
    _case,
    mutation,
    leakedBytes,
  ) => {
    const h = harness();
    const bundle = await captureDiagnosticBundle(h);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    const ref = {
      id: attachment.artifactId,
      sha256: attachment.digest,
      bytes: attachment.byteLength,
      mediaType: attachment.mediaType,
    };
    const storedBytes = mutation === "digest" ? "X]" : `[]${leakedBytes}`;
    writeFileSync(join(h.stateRoot, "artifacts", `${ref.sha256}.artifact`), JSON.stringify({
      ref,
      payloadBase64: Buffer.from(storedBytes).toString("base64"),
    }));

    const response = await h.app.request(`/artifacts/v1/${attachment.artifactId}`, {
      headers: { range: "bytes=0-0" },
    });
    const bodyText = await response.text();
    const body = JSON.parse(bodyText) as Record<string, unknown>;

    assert.equal(response.status, 500);
    assert.equal(body.code, "DIAGNOSTIC_BUNDLE_CORRUPT");
    assert.equal(body.retryable, false);
    assert.doesNotMatch(bodyText, new RegExp(leakedBytes, "u"));
    assert.equal(response.headers.get("content-range"), null);
    assert.equal(response.headers.get("content-length"), null);
  });

  it("refuses indexed content whose stored media type disagrees with authority", async () => {
    const h = harness({
      diagnosticBundles: (real) => ({
        ...real,
        authority: {
          ...real.authority,
          findByArtifact: (artifactId) => real.authority.findByArtifact(artifactId).map((row) =>
            DiagnosticAttachmentStorageRecordSchema.parse({
              ...row,
              attachment: {
                kind: "accessibility-excerpt",
                artifactId: row.attachment.artifactId,
                mediaType: "text/yaml",
                byteLength: row.attachment.byteLength,
                digest: row.attachment.digest,
                sensitivity: "redacted",
              },
            })),
        },
      }),
    });
    const bundle = await captureDiagnosticBundle(h);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");

    const response = await h.app.request(`/artifacts/v1/${attachment.artifactId}`);
    const body = await json(response);

    assert.equal(response.status, 500);
    assert.equal(body.code, "DIAGNOSTIC_BUNDLE_CORRUPT");
    assert.equal(body.retryable, false);
    assert.equal(response.headers.get("content-length"), null);
  });

  it("normalizes diagnostic attachment authority failure without leaking its storage path", async () => {
    const localPath = "/private/operator/.tracker-rebuild/state.sqlite";
    const h = harness({
      diagnosticBundles: (real) => ({
        ...real,
        authority: {
          ...real.authority,
          findByArtifact: () => {
            throw new Error(`authority unavailable at ${localPath}`);
          },
        },
      }),
    });
    const bundle = await captureDiagnosticBundle(h);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");

    const response = await h.app.request(`/artifacts/v1/${attachment.artifactId}`);
    const bodyText = await response.text();
    const body = JSON.parse(bodyText) as Record<string, unknown>;

    assert.equal(response.status, 500);
    assert.equal(body.code, "DIAGNOSTIC_BUNDLE_CORRUPT");
    assert.equal(body.retryable, false);
    assert.doesNotMatch(bodyText, new RegExp(localPath, "u"));
  });

  it("returns typed missing bytes when authority indexes an artifact whose physical object is missing", async () => {
    const h = harness();
    const bundle = await captureDiagnosticBundle(h);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    rmSync(join(h.stateRoot, "artifacts", `${attachment.digest}.artifact`));

    const response = await h.app.request(`/artifacts/v1/${attachment.artifactId}`);
    const bodyText = await response.text();
    const body = JSON.parse(bodyText) as Record<string, unknown>;

    assert.equal(response.status, 500);
    assert.equal(body.code, "DIAGNOSTIC_BUNDLE_BYTES_MISSING");
    assert.equal(body.retryable, false);
    assert.match(String(body.message), /has no stored bytes/u);
    assert.doesNotMatch(bodyText, new RegExp(h.stateRoot, "u"));
  });

  it.each(["generic", "bundle"] as const)(
    "reports a local reader filesystem failure on the %s route as path-free internal failure",
    async (profile) => {
      let sabotaged = false;
      const h = harness({ diagnosticBundles: (real) => ({
        ...real,
        artifactReader: beforeArtifactReaderOperation(real.artifactReader, (_operation, ref) => {
          if (sabotaged) return;
          sabotaged = true;
          const storedPath = join(h.stateRoot, "artifacts", `${ref.sha256}.artifact`);
          rmSync(storedPath);
          mkdirSync(storedPath);
        }),
      }) });
      const bundle = await captureDiagnosticBundle(h);
      const attachment = bundle.attachments[0];
      if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
      const path = profile === "generic"
        ? `/artifacts/v1/${attachment.artifactId}`
        : `/api/v1/diagnostic-bundles/${bundle.bundleId}/attachments/${attachment.artifactId}`;

      const response = await h.app.request(path);
      const bodyText = await response.text();
      const body = JSON.parse(bodyText) as Record<string, unknown>;

      assert.equal(response.status, 500);
      assert.equal(body.code, "INTERNAL_FAILURE");
      assert.equal(body.retryable, false);
      assert.match(String(body.message), /verified artifact storage operation failed/u);
      assert.doesNotMatch(bodyText, new RegExp(h.stateRoot, "u"));
      assert.doesNotMatch(bodyText, /DIAGNOSTIC_BUNDLE_(?:CORRUPT|BYTES_MISSING)/u);
      assert.equal(response.headers.get("content-length"), null);
    },
  );

  it("verifies a ranged artifact before refusing partial delivery", async () => {
    const h = harness();
    const bundle = await captureDiagnosticBundle(h);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");

    const response = await h.app.request(`/artifacts/v1/${attachment.artifactId}`, {
      headers: { range: "bytes=0-0" },
    });

    assert.equal(response.status, 416);
    assert.equal(response.headers.get("content-range"), `bytes */${String(attachment.byteLength)}`);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  });

  it.each([
    ["mutated", false],
    ["missing", true],
  ] as const)("returns a typed path-free failure when a real diagnostic artifact is %s", async (_case, removeArtifact) => {
    const h = harness();
    const bundle = await captureDiagnosticBundle(h);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    const artifactPath = join(h.stateRoot, "artifacts", `${attachment.digest}.artifact`);
    if (removeArtifact) rmSync(artifactPath);
    else writeFileSync(artifactPath, "{\"mutated\":true}", "utf8");

    const suffix = removeArtifact ? "/manifest" : "";
    const response = await h.app.request(`/api/v1/diagnostic-bundles/${bundle.bundleId}${suffix}`);
    const body = await json(response);
    assert.equal(response.status, 500);
    assert.equal(body.code, removeArtifact ? "DIAGNOSTIC_BUNDLE_BYTES_MISSING" : "DIAGNOSTIC_BUNDLE_CORRUPT");
    assert.equal(body.retryable, false);
    assert.match(String(body.message), new RegExp(bundle.bundleId, "u"));
    assert.match(String(body.message), new RegExp(attachment.artifactId, "u"));
    assert.match(String(body.message), new RegExp(attachment.kind, "u"));
    assert.doesNotMatch(String(body.message), new RegExp(h.stateRoot, "u"));
    assert.doesNotMatch(String(body.message), /(?:\/private\/|\/var\/folders\/)/u);
  });

  it("returns typed corruption when the diagnostic repository returns a foreign bundle id", async () => {
    const foreignBundleId = DiagnosticBundleIdSchema.parse("00000000-0000-4000-8000-000000000999");
    const h = harness({
      diagnosticBundles: (real) => ({
        ...real,
        authority: {
          get: (bundleId) => {
            const stored = real.authority.get(bundleId);
            return stored === undefined
              ? undefined
              : { ...stored, bundleId: foreignBundleId };
          },
          listAttachments: real.authority.listAttachments,
          findByArtifact: real.authority.findByArtifact,
        },
      }),
    });
    const bundle = await captureDiagnosticBundle(h);
    const response = await h.app.request(`/api/v1/diagnostic-bundles/${bundle.bundleId}`);
    const body = await json(response);

    assert.equal(response.status, 500);
    assert.equal(body.code, "DIAGNOSTIC_BUNDLE_CORRUPT");
    assert.equal(body.retryable, false);
    assert.match(String(body.message), /durable authority identity mismatch/u);
    assert.match(String(body.message), new RegExp(bundle.bundleId, "u"));
    assert.doesNotMatch(String(body.message), new RegExp(foreignBundleId, "u"));
  });

  it("reuses exact-ref verification within one captures request and re-verifies on the next request", async () => {
    const syntheticBundles: DiagnosticBundle[] = [];
    const h = harness({
      runCaptureAuthority: (real) => Object.freeze({
        ...real,
        get(bundleId: string) {
          return syntheticBundles.find((bundle) => bundle.bundleId === bundleId) ?? real.get(bundleId);
        },
        listByRun(runId: string) {
          return [...real.listByRun(runId), ...syntheticBundles.filter((bundle) => bundle.runId === runId)];
        },
        listAttachments(bundleId: string) {
          const synthetic = syntheticBundles.find((bundle) => bundle.bundleId === bundleId);
          if (synthetic === undefined) return real.listAttachments(bundleId);
          return synthetic.attachments.map((attachment) => DiagnosticAttachmentStorageRecordSchema.parse({
            bundleId: synthetic.bundleId,
            attachment,
            createdAt: synthetic.createdAt,
          }));
        },
      }),
    });
    const planResponse = await h.app.request("/api/v1/start-plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workflowId: "fixture-graph",
        submissions: [{ eid: "10873698", mode: "read-only" }],
        dryRun: false,
      }),
    });
    assert.equal(planResponse.status, 200);
    const plan = await json(planResponse);
    const plannedRun = (plan.planned as { runId: string }[])[0];
    if (plannedRun === undefined) throw new Error("the fixture start plan did not produce its run");
    const fingerprints = plan.fingerprints as Record<string, string>;
    const commandResponse = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
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
        payload: {
          descriptorFingerprint: fingerprints.descriptorFingerprint,
          configFingerprint: fingerprints.configFingerprint,
          ingressSchemaHash: fingerprints.ingressSchemaHash,
          canonicalInputSchemaHash: fingerprints.canonicalInputSchemaHash,
          inputFingerprint: fingerprints.inputFingerprint,
        },
      }),
    });
    assert.equal(commandResponse.status, 200);
    assert.equal((await json(commandResponse)).state, "applied");

    const capture = createDiagnosticCaptureService({
      authority: h.database.authority,
      artifacts: h.artifacts,
      clock: h.clock,
      ids: sequentialIdFactory("d"),
    });
    const sharedAttachment = {
      kind: "accessibility-excerpt" as const,
      mediaType: "text/yaml",
      bytes: new TextEncoder().encode("- button: Retry"),
      sensitivity: "redacted" as const,
    };
    const first = await capture.capture({
      trigger: "operator-request",
      runId: plannedRun.runId,
      requestedBy: "local-operator",
      configFingerprint: HASH_B,
      descriptorFingerprint: fixtureDescriptor.contractFingerprint,
      fields: [],
      attachments: [sharedAttachment],
    });
    const automaticCapture = createDiagnosticCaptureService({
      authority: h.database.authority,
      artifacts: h.artifacts,
      clock: h.clock,
      ids: sequentialIdFactory("e"),
    });
    const automaticCases = [
      { trigger: "task-failure", originKind: "failure" },
      { trigger: "unexpected-state", originKind: "unexpected-state" },
      { trigger: "subject-mismatch", originKind: "subject-mismatch" },
      { trigger: "recovery-park", originKind: "recovery-park" },
    ] as const;
    const automaticBundles: DiagnosticBundle[] = [];
    for (const automaticCase of automaticCases) {
      automaticBundles.push(await automaticCapture.prepare({
        trigger: automaticCase.trigger,
        runId: plannedRun.runId,
        failureId: "00000000-0000-4000-8000-0000000000f1",
        configFingerprint: HASH_B,
        descriptorFingerprint: fixtureDescriptor.contractFingerprint,
        fields: [],
        attachments: [sharedAttachment],
      }));
    }
    syntheticBundles.push(...automaticBundles);
    const firstAttachment = first.attachments[0];
    if (firstAttachment === undefined || automaticBundles.some((bundle) => bundle.attachments[0] === undefined)) {
      throw new Error("the diagnostic fixtures did not write their shared attachment");
    }
    for (const automatic of automaticBundles) {
      assert.notEqual(first.bundleId, automatic.bundleId);
      assert.notDeepEqual(first.origin, automatic.origin);
      assert.notEqual(first.contentDigest, automatic.contentDigest);
      assert.deepEqual(automatic.attachments[0], firstAttachment);
    }
    const envelopeByteLength = readFileSync(
      join(h.stateRoot, "artifacts", `${firstAttachment.digest}.artifact`),
    ).byteLength;

    const readCaptures = async () => {
      const response = await h.app.request(`/api/v1/runs/${plannedRun.runId}/captures`);
      assert.equal(response.status, 200);
      const captures = RunDetailSectionResponseSchema.parse(await response.json());
      assert.equal(captures.section, "captures");
      if (captures.section !== "captures") throw new Error("expected captures");
      return captures;
    };
    const firstResponse = await readCaptures();
    const firstRequestSourceReads = [...h.artifactSourceReads];
    const secondResponse = await readCaptures();
    const secondRequestSourceReads = [...h.artifactSourceReads];
    const expectedArtifacts = [{
      artifact: {
        mediaKind: "data",
        artifactId: firstAttachment.artifactId,
        mediaType: firstAttachment.mediaType,
        byteLength: firstAttachment.byteLength,
        sha256: firstAttachment.digest,
        sensitivity: firstAttachment.sensitivity,
        redaction: "applied",
      },
      origins: [
        { bundleId: first.bundleId, originKind: "operator-request" },
        ...automaticBundles.map((bundle, index) => ({
          bundleId: bundle.bundleId,
          originKind: automaticCases[index]?.originKind,
        })),
      ],
    }];
    for (const captures of [firstResponse, secondResponse]) {
      assert.deepEqual(captures.payload.artifacts, expectedArtifacts);
    }
    assert.deepEqual(
      firstRequestSourceReads,
      [envelopeByteLength],
      "one request must completely verify one shared exact artifact ref only once",
    );
    assert.deepEqual(
      secondRequestSourceReads,
      [envelopeByteLength, envelopeByteLength],
      "a second request must perform one additional complete source verification",
    );
  });

  it("plans, starts, projects, and serves the run through the one payload", async () => {
    const h = harness();

    const planResponse = await h.app.request("/api/v1/start-plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workflowId: "fixture-graph",
        submissions: [{ eid: "10873698", mode: "read-only" }, { eid: "not-an-eid", mode: "read-only" }],
        dryRun: false,
      }),
    });
    assert.equal(planResponse.status, 200);
    const plan = await json(planResponse);
    const planned = plan.planned as { runId: string; title: string; traceId: string }[];
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
      headers: { "content-type": "application/json" },
      body: JSON.stringify(command),
    });
    assert.equal(commandResponse.status, 200);
    assert.equal((await json(commandResponse)).state, "applied");

    // The run.queued span landed in real JSONL (authority first, JSONL after).
    const spanLines = readEventStreamLines(h.stateRoot, "spans");
    assert.equal(spanLines.length, 1);
    assert.match(spanLines[0].text, /"t":"run\.queued"/);
    assert.match(spanLines[0].text, /"title":"Fixture 10873698"/);

    // A replay returns already-applied and emits NO second span.
    const replay = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(command),
    });
    assert.equal((await json(replay)).state, "already-applied");
    assert.equal(readEventStreamLines(h.stateRoot, "spans").length, 1);

    // THE payload serves the row and its counts from one fold.
    const dayResponse = await h.app.request(`/api/v1/dashboard?day=${DAY}`);
    assert.equal(dayResponse.status, 200);
    const day = await json(dayResponse);
    const surfaces = day.queueSurfaces as { runId: string; status: string; pipeline: { id: string }[] }[];
    assert.equal(surfaces.length, 1);
    assert.equal(surfaces[0].runId, planned[0].runId);
    assert.equal(surfaces[0].status, "queued");
    // Pipeline comes from the descriptor's runtime nodes, pending until spans arrive.
    assert.equal(surfaces[0].pipeline.length > 0, true);
    assert.equal(surfaces[0].pipeline.every(({ id }) => typeof id === "string"), true);
    assert.deepEqual(day.workflowCounts, [
      { workflowId: "fixture-graph", count: 1, statusCounts: [{ status: "queued", count: 1 }] },
    ]);
    assert.deepEqual(day.statusCounts, [{ status: "queued", count: 1 }]);

    // Detail header + note-backed logs slice.
    const runId = planned[0].runId;
    const detail = await json(await h.app.request(`/api/v1/runs/${runId}`));
    assert.equal((detail.header as { title: string }).title, "Fixture 10873698");
    // DCA3: a live read must state absence, not omit capture availability.
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
      address: { runId, attempt: 1, traceId: planned[0].traceId, spanPath: planned[0].traceId },
      level: "step",
      message: "opened person search",
    });
    const logs = await json(await h.app.request(`/api/v1/runs/${runId}/logs`));
    const payload = logs.payload as { notes: { message: string; level: string }[]; nextCursor: { state: string } };
    assert.deepEqual(payload.notes.map(({ message, level }) => ({ message, level })), [
      { message: "opened person search", level: "info" },
    ]);
    assert.equal(payload.nextCursor.state, "absent");

    // The SSE hub serves the same snapshot the query returned.
    const connection = await h.hub.connect({ day: DAY });
    const snapshot = connection.initial[1];
    if (snapshot.type !== "snapshot" || snapshot.topic !== "dashboard-day") assert.fail("expected a dashboard-day snapshot");
    expect(snapshot.payload).toEqual(day);
    connection.close();
  });

  it("serves the timeline for a run whose spans a WORKER process appended to disk (D218)", async () => {
    // The regression the cross-process tail exists for: the run is enqueued
    // by THIS process, its task spans are appended by ANOTHER process (the
    // worker), and the run detail must still serve a timeline — before D218
    // the projection folded only its own emissions and `timeline.events`
    // stayed [] for every run enqueued after boot.
    const h = harness();
    const plan = await json(await h.app.request("/api/v1/start-plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workflowId: "fixture-graph",
        submissions: [{ eid: "10873698", mode: "read-only" }],
        dryRun: false,
      }),
    }));
    const planned = plan.planned as { runId: string; traceId: string }[];
    const fingerprints = plan.fingerprints as Record<string, string>;
    const commandResponse = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        commandId: "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b7c",
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "local-operator",
        source: "start-run",
        family: "start",
        type: "start-run",
        target: { workflowId: "fixture-graph", startPlanId: plan.startPlanId, expectedVersion: plan.expectedVersion },
        payload: {
          descriptorFingerprint: fingerprints.descriptorFingerprint,
          configFingerprint: fingerprints.configFingerprint,
          ingressSchemaHash: fingerprints.ingressSchemaHash,
          canonicalInputSchemaHash: fingerprints.canonicalInputSchemaHash,
          inputFingerprint: fingerprints.inputFingerprint,
        },
      }),
    });
    assert.equal((await json(commandResponse)).state, "applied");
    const { runId, traceId } = planned[0];

    // The worker process: raw O_APPEND lines in the shared stream file.
    const base = {
      workflow: "fixture-graph", pid: 777, runId, attempt: 1, traceId,
      spanPath: `${traceId}/probe#1`, parentSpanPath: traceId,
    };
    const file = join(h.stateRoot, "spans", `fixture-graph-${DAY}.jsonl`);
    appendFileSync(file, `${JSON.stringify({ ...base, t: "span.started", kind: "task", ts: h.clock.now().toISOString(), name: "probe" })}\n`);
    appendFileSync(file, `${JSON.stringify({ ...base, t: "span.ended", kind: "task", ts: h.clock.now().toISOString(), outcome: "done" })}\n`);

    // Production's poll tick, invoked directly.
    h.projection.ingestFromDisk();

    const detail = await json(await h.app.request(`/api/v1/runs/${runId}`));
    const timeline = detail.timeline as { events: { label: string; state: string }[] };
    assert.equal(timeline.events.length > 0, true);
    assert.deepEqual(
      timeline.events.filter(({ label }) => label === "probe").map(({ state }) => state),
      ["done"],
    );
  });

  it("refuses malformed and unavailable requests with typed wire errors", async () => {
    const h = harness();

    const badDay = await h.app.request("/api/v1/dashboard?day=today");
    assert.equal(badDay.status, 400);
    assert.equal((await json(badDay)).code, "SCHEMA_INVALID");

    const missingRun = await h.app.request(`/api/v1/runs/9e8d7c6b-5a49-4382-9170-2f3e4d5c6b7a`);
    assert.equal(missingRun.status, 404);
    assert.equal((await json(missingRun)).code, "TARGET_NOT_FOUND");

    const badCommand = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ family: "start", type: "start-run" }),
    });
    assert.equal(badCommand.status, 400);

    const deferredArm = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        commandId: "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b7b",
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "local-operator",
        // 2i-B activated the notification family; settings stays the
        // deferred probe.
        source: "settings-surface",
        family: "settings",
        type: "apply-settings",
        target: { expectedRevision: 1 },
        payload: { settingsSchemaHash: "a".repeat(64), patchFingerprint: "b".repeat(64), patch: {} },
      }),
    });
    assert.equal(deferredArm.status, 422);
    const rejection = await json(deferredArm);
    assert.equal(rejection.state, "rejected");
    assert.equal(rejection.code, "capability-unavailable");

    const unknownWorkflowPlan = await h.app.request("/api/v1/start-plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workflowId: "mystery-flow", submissions: [{}], dryRun: false }),
    });
    assert.equal(unknownWorkflowPlan.status, 404);

    const unknownRoute = await h.app.request("/api/v1/mystery");
    assert.equal(unknownRoute.status, 404);
    assert.equal((await json(unknownRoute)).code, "ROUTE_NOT_FOUND");

    const badTopics = await h.app.request("/events/v1?topics=everything");
    const badCursor = await h.app.request(`/events/v1?topics=dashboard-day:${DAY}`, {
      headers: { "last-event-id": "not-a-projection-cursor" },
    });
    assert.equal(badCursor.status, 400);
    const unboundGeneration = await h.app.request(`/events/v1?topics=dashboard-day:${DAY}`, {
      headers: { "dashboard-projection-generation": "7" },
    });
    assert.equal(unboundGeneration.status, 400);
    assert.equal(badTopics.status, 400);
  });

  it("serves the read-only storage doctor on demand (2i-D)", async () => {
    const h = harness();
    const response = await h.app.request("/api/v1/storage/doctor");
    assert.equal(response.status, 200);
    const report = StorageDoctorWireSchema.parse(await response.json());
    assert.equal(report.mode, "read-only");
    assert.equal(report.authority.state, "healthy");
    if (report.authority.state === "healthy") {
      assert.equal(report.authority.authorityGeneration, h.database.getMeta().authorityGeneration);
    }
    assert.equal(report.counts.state, "available");
    // The harness runs no backup lane: the on-disk truth is missing, and the
    // service arm says why in its own words rather than an inferred blank.
    assert.equal(report.backup.state, "missing");
    assert.deepEqual(report.restoreCandidates, []);
    assert.deepEqual(report.service, {
      state: "never-run",
      reason: "the test harness runs no backup lane",
    });

    // The same summary reaches bootstrap: authority probed, backup indicator real.
    const boot = await json(await h.app.request("/api/v1/bootstrap"));
    const storage = boot.storage as { authority: string; backup: string };
    assert.equal(storage.authority, "healthy");
    assert.equal(storage.backup, "missing");
    const sections = boot.settingsSections as { id: string; label: string }[];
    // The LABEL is asserted with the id, because it is served here and rendered
    // verbatim by `buildSettingsNav` — the surface authors none of it. `Storage
    // health` is the demo's one name for the entry and the page it opens
    // (UF-SET-9); the two used to disagree because only the panel header was
    // ported (D276 item 4).
    assert.deepEqual(sections, [
      { id: "storage", label: "Storage health", revision: 1 },
      { id: "system-hosts", label: "System hosts", revision: 1 },
      { id: "workflow-capabilities", label: "Workflow capabilities", revision: 1 },
    ]);
  });

  it("refuses an unavailable run-detail section by name and serves failure only when real", async () => {
    const h = harness();
    const planResponse = await json(await h.app.request("/api/v1/start-plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workflowId: "fixture-graph", submissions: [{ eid: "10873698", mode: "read-only" }], dryRun: false }),
    }));
    const fingerprints = planResponse.fingerprints as Record<string, string>;
    await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        commandId: "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b7d",
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "local-operator",
        source: "start-run",
        family: "start",
        type: "start-run",
        target: {
          workflowId: "fixture-graph",
          startPlanId: planResponse.startPlanId,
          expectedVersion: planResponse.expectedVersion,
        },
        payload: fingerprints,
      }),
    });
    const runId = (planResponse.planned as { runId: string }[])[0].runId;

    const review = await h.app.request(`/api/v1/runs/${runId}/review`);
    assert.equal(review.status, 409);
    assert.equal((await json(review)).code, "SECTION_UNAVAILABLE");

    // A receipt states a SETTLED verdict, so a queued run's absence names the
    // state rather than a missing feature (D141).
    const receipt = await json(await h.app.request(`/api/v1/runs/${runId}/receipt`));
    assert.deepEqual(receipt.payload, {
      state: "missing",
      reason: "run is queued; a receipt states a settled verdict and this run has none yet",
    });

    const failure = await json(await h.app.request(`/api/v1/runs/${runId}/failure`));
    assert.equal((failure.payload as { state: string }).state, "missing");

    const attempts = await json(await h.app.request(`/api/v1/runs/${runId}/context-attempts`));
    const entries = (attempts.payload as { entries: { label: string; valueRedacted: string }[] }).entries;
    assert.deepEqual(entries[0], { label: "current-attempt", valueRedacted: "1" });
  });

  it("serves the Activity report over a NAMED range and refuses one the caller never named (D180)", async () => {
    const h = harness();
    const planResponse = await json(await h.app.request("/api/v1/start-plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workflowId: "fixture-graph", submissions: [{ eid: "10873698", mode: "read-only" }], dryRun: false }),
    }));
    await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        commandId: "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b7e",
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "local-operator",
        source: "start-run",
        family: "start",
        type: "start-run",
        target: {
          workflowId: "fixture-graph",
          startPlanId: planResponse.startPlanId,
          expectedVersion: planResponse.expectedVersion,
        },
        payload: planResponse.fingerprints,
      }),
    });

    const report = ActivityReportWireSchema.parse(
      await (await h.app.request(`/api/v1/reports/activity?from=${DAY}&to=${DAY}`)).json(),
    );
    // The report is the SAME projection the day payload is served from, so the
    // route cannot hand back a total the dashboard would disagree with.
    const day = await json(await h.app.request(`/api/v1/dashboard?day=${DAY}`));
    assert.equal(report.totalRuns, (day.queueSurfaces as unknown[]).length);
    assert.deepEqual(report.days, [{ day: DAY, runs: 1 }]);
    assert.deepEqual(report.workflows, [{
      workflowId: "fixture-graph",
      registration: { state: "registered", label: "Fixture Graph", code: "fx", categoryId: "operations" },
      runs: 1,
      completion: { readBack: 0, warnings: 0, warningsUnknown: 0 },
      failed: 0, cancelled: 0, partial: 0, open: 1,
    }]);
    assert.equal(report.terminalRuns, 0);
    assert.equal(report.durations.medianMs.state, "absent");

    // A missing bound is never "today" or "this month": the route refuses and
    // says which parameters it needs, rather than answering a different
    // question than the link the operator followed asked.
    const halfRange = await h.app.request(`/api/v1/reports/activity?from=${DAY}`);
    assert.equal(halfRange.ok, false);
    assert.match(String((await json(halfRange)).message), /requires both from= and to=/);

    const noRange = await h.app.request("/api/v1/reports/activity");
    assert.equal(noRange.ok, false);
    assert.match(String((await json(noRange)).message), /requires both from= and to=/);

    // A malformed bound is refused by the wire schema, by name.
    const badBound = await h.app.request(`/api/v1/reports/activity?from=today&to=${DAY}`);
    assert.equal(badBound.status, 400);
    assert.equal((await json(badBound)).code, "SCHEMA_INVALID");

    // An inverted range never returns an empty report that reads as "no work".
    const inverted = await h.app.request(`/api/v1/reports/activity?from=${DAY}&to=2026-08-01`);
    assert.equal(inverted.ok, false);
    assert.match(String((await json(inverted)).message), /ends before it starts/);
  });
  /**
   * D240 — the SAME report as a file. The route is tested for the two things
   * that make an export honest: it refuses a half-named window exactly as the
   * JSON route does (an export travels further than a page, so a silently
   * defaulted window would too), and the artifact carries the rules beside the
   * numbers.
   */
  it("serves the Activity report as a CSV that carries its own caveats (D240)", async () => {
    const h = harness();
    const report = h.projection.buildActivityReportWire(DAY, DAY);

    const response = await h.app.request(`/api/v1/reports/activity.csv?from=${DAY}&to=${DAY}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/csv; charset=utf-8");
    assert.equal(
      response.headers.get("content-disposition"),
      `attachment; filename="activity-${DAY}_${DAY}.csv"`,
    );
    const csv = await response.text();
    // The bytes are the builder's, so the route cannot serve a second rendering.
    assert.equal(csv, activityReportCsv(report));
    // Every rule the panel shows behind its ⓘ is IN the file, verbatim.
    for (const caveat of activityReportCaveats(report)) {
      assert.ok(csv.includes(caveat.includes(",") ? `"${caveat}"` : caveat), `the export carries: ${caveat}`);
    }
    assert.ok(csv.includes(`Window from,${DAY}`));
    assert.ok(csv.includes("Write ledger — what was actually filed"));

    const halfRange = await h.app.request(`/api/v1/reports/activity.csv?from=${DAY}`);
    assert.equal(halfRange.ok, false);
    assert.match(String((await json(halfRange)).message), /requires both from= and to=/);

    const noRange = await h.app.request("/api/v1/reports/activity.csv");
    assert.equal(noRange.ok, false);
    assert.match(String((await json(noRange)).message), /requires both from= and to=/);

    const inverted = await h.app.request(`/api/v1/reports/activity.csv?from=${DAY}&to=2026-08-01`);
    assert.equal(inverted.ok, false);
    assert.match(String((await json(inverted)).message), /ends before it starts/);
  });

  it("executes a bulk cancel as N CAS-bound children and answers the per-run vector (D235)", async () => {
    const h = harness();

    // Three real runs through the real plan -> start doors, one per subject.
    const startRun = async (eid: string, commandId: string): Promise<string> => {
      const planResponse = await h.app.request("/api/v1/start-plans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workflowId: "fixture-graph", submissions: [{ eid, mode: "read-only" }], dryRun: false }),
      });
      assert.equal(planResponse.status, 200);
      const plan = await json(planResponse);
      const fingerprints = plan.fingerprints as Record<string, string>;
      const started = await h.app.request("/api/v1/commands", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          commandId,
          requestedAt: h.clock.now().toISOString(),
          requestedBy: "local-operator",
          source: "start-run",
          family: "start",
          type: "start-run",
          target: { workflowId: "fixture-graph", startPlanId: plan.startPlanId, expectedVersion: plan.expectedVersion },
          payload: {
            descriptorFingerprint: fingerprints.descriptorFingerprint,
            configFingerprint: fingerprints.configFingerprint,
            ingressSchemaHash: fingerprints.ingressSchemaHash,
            canonicalInputSchemaHash: fingerprints.canonicalInputSchemaHash,
            inputFingerprint: fingerprints.inputFingerprint,
          },
        }),
      });
      assert.equal((await json(started)).state, "applied");
      return (plan.planned as { runId: string }[])[0].runId;
    };
    const runA = await startRun("10873698", "1a000000-0000-4000-8000-000000000001");
    const runB = await startRun("10002296", "1a000000-0000-4000-8000-000000000002");
    const runC = await startRun("10873700", "1a000000-0000-4000-8000-000000000003");
    const versionOf = (runId: string): number => {
      const run = h.database.authority.runs.get(runId);
      assert.notEqual(run, undefined, `run ${runId} exists in authority`);
      return (run as { version: number }).version;
    };

    // runC is cancelled up front so its bulk child exercises the REFUSED arm
    // through the same kernel precondition a single press would hit.
    const soloCancel = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        commandId: "1a000000-0000-4000-8000-000000000004",
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "local-operator",
        source: "queue",
        family: "run",
        type: "cancel",
        target: { runId: runC, expectedVersion: versionOf(runC) },
      }),
    });
    assert.equal((await json(soloCancel)).state, "applied");

    // Whole-request refusals reach NO target: an empty batch, a duplicated
    // target, and the all-or-none mode this runtime deliberately refuses.
    const envelope = {
      commandId: "1a000000-0000-4000-8000-00000000000b",
      requestedAt: h.clock.now().toISOString(),
      requestedBy: "local-operator",
      source: "queue",
      family: "run",
      type: "cancel",
      bulkCommandId: "1a000000-0000-4000-8000-00000000000b",
      mode: "best-effort",
    } as const;
    const postBulk = async (body: unknown): Promise<{ status: number; payload: Record<string, unknown> }> => {
      const response = await h.app.request("/api/v1/commands/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: response.status, payload: await json(response) };
    };

    const empty = await postBulk({ ...envelope, targets: [] });
    assert.equal(empty.status, 422);
    assert.equal(empty.payload.state, "refused");
    assert.equal(empty.payload.code, "schema-mismatch");

    const duplicated = await postBulk({
      ...envelope,
      targets: [{ runId: runA, expectedVersion: 1 }, { runId: runA, expectedVersion: 1 }],
    });
    assert.equal(duplicated.payload.state, "refused");
    assert.match(String(duplicated.payload.message), /more than once/);

    const allOrNone = await postBulk({ ...envelope, mode: "all-or-none", targets: [{ runId: runA, expectedVersion: 1 }] });
    assert.equal(allOrNone.payload.state, "refused");
    assert.equal(allOrNone.payload.code, "capability-unavailable");
    assert.match(String(allOrNone.payload.message), /Nothing was\s+attempted/);

    // The mixed vector: one applied, one conflict (stale version, with the
    // server's currentVersion), one refused by the kernel's own precondition.
    const bulkBody = {
      ...envelope,
      targets: [
        { runId: runA, expectedVersion: versionOf(runA) },
        { runId: runB, expectedVersion: 999 },
        { runId: runC, expectedVersion: versionOf(runC) },
      ],
    };
    const first = await postBulk(bulkBody);
    assert.equal(first.status, 200);
    assert.equal(first.payload.state, "vector");
    assert.equal(first.payload.requestedCount, 3);
    const results = first.payload.results as Record<string, unknown>[];
    assert.deepEqual(results.map(({ outcome }) => outcome), ["applied", "conflict", "refused"]);
    assert.equal(results[0].runId, runA);
    assert.equal(results[0].replayed, false);
    assert.equal(results[1].runId, runB);
    assert.equal(results[1].currentVersion, versionOf(runB), "conflict carries the server's own current version");
    assert.equal(results[2].runId, runC);
    assert.equal(typeof results[2].code, "string");
    const childIds = new Set(results.map(({ commandId }) => commandId));
    assert.equal(childIds.size, 3, "each target's child command has its own derived identity");

    // Re-delivering the SAME bulk envelope replays the applied child rather
    // than filing a second cancel: the child ids are derived, not minted.
    const replay = await postBulk(bulkBody);
    assert.equal(replay.payload.state, "vector");
    const replayed = replay.payload.results as Record<string, unknown>[];
    assert.deepEqual(replayed.map(({ outcome }) => outcome), ["applied", "conflict", "refused"]);
    assert.equal(replayed[0].replayed, true, "the applied child is answered from the journal, not re-executed");
    assert.equal(replayed[0].commandId, results[0].commandId);
  });
});

/**
 * The phone-host gate (ref operator-trust §7, D174) — never exercised at runtime before this case.
 * The gate identifies a phone request by the `Host` header ALONE (see the design caveat recorded
 * on the `capture.ingress` config leaf and ref frontend-backend-integration §6.9): a request whose Host matches
 * `capturePhoneHost` may reach only ref data-intake-and-edit-data §5.1's closed capture-phone route union and its
 * declared asset paths — an operator route on that same Host answers the identical `ROUTE_NOT_FOUND`
 * body an unrouted path gets, so the ingress cannot be used to enumerate the dashboard.
 */
describe("the capture phone-host gate (D174, ref operator-trust §7)", () => {
  const PHONE_HOST = "phone.example";
  const OPERATOR_HOST = "dashboard.example";

  it("blocks the SAME path byte-identically whether the gate refuses it or the path is genuinely unrouted", async () => {
    const h = harness({ capturePhoneHost: PHONE_HOST });

    // Neither request's path is in the closed capture-phone route union, so the
    // FIRST is refused by the Host-gate middleware itself (before any route
    // match is attempted) and the SECOND falls through to the app's own
    // `app.notFound` for a path that genuinely does not exist. Both must be
    // byte-identical — the whole point of D174's design is that a phone
    // request cannot distinguish "the gate blocked me" from "nothing is here".
    const gated = await h.app.request("/api/v1/no-such-route", { headers: { host: PHONE_HOST } });
    const unrouted = await h.app.request("/api/v1/no-such-route", { headers: { host: OPERATOR_HOST } });

    assert.equal(gated.status, 404);
    assert.equal(unrouted.status, 404);
    assert.deepEqual(await gated.json(), await unrouted.json());
  });

  it("blocks a REAL operator route on the phone Host with the same ROUTE_NOT_FOUND shape", async () => {
    const h = harness({ capturePhoneHost: PHONE_HOST });

    const response = await h.app.request("/api/v1/bootstrap", { headers: { host: PHONE_HOST } });

    assert.equal(response.status, 404);
    const body = await json(response);
    assert.equal(body.code, "ROUTE_NOT_FOUND");
  });

  it("keeps diagnostic artifact bytes opaque on the phone Host", async () => {
    const h = harness({ capturePhoneHost: PHONE_HOST });
    const bundle = await captureDiagnosticBundle(h);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    const path = `/artifacts/v1/${attachment.artifactId}`;

    const gated = await h.app.request(path, { headers: { host: PHONE_HOST } });
    const gatedBytes = await gated.text();
    const operator = await h.app.request(path, { headers: { host: OPERATOR_HOST } });

    assert.equal(gated.status, 404);
    assert.equal(gatedBytes, JSON.stringify({
      state: "error",
      code: "ROUTE_NOT_FOUND",
      message: `no route serves GET ${path}`,
      retryable: false,
    }));
    assert.equal(operator.status, 200);
    await operator.body?.cancel();
  });

  it("keeps exact bundle metadata, manifests and attachment bytes opaque on the capture Host", async () => {
    let authorityReads = 0;
    const h = harness({ capturePhoneHost: PHONE_HOST, diagnosticBundles: (real) => ({
      ...real, authority: { ...real.authority,
        get: (id) => { authorityReads += 1; return real.authority.get(id); },
      },
    }) });
    const bundle = await captureDiagnosticBundle(h);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    for (const suffix of ["", "/manifest", `/attachments/${attachment.artifactId}`]) {
      const path = `/api/v1/diagnostic-bundles/${bundle.bundleId}${suffix}`;
      const gated = await h.app.request(path, { headers: { host: PHONE_HOST.toUpperCase(), range: "bytes=0-0" } });
      assert.equal(gated.status, 404);
      assert.equal(await gated.text(), JSON.stringify({ state: "error", code: "ROUTE_NOT_FOUND",
        message: `no route serves GET ${path}`, retryable: false }));
      assert.equal(gated.headers.get("content-range"), null);
      assert.equal(gated.headers.get("cache-control"), null, "private route middleware must not disclose a route on the capture Host");
    }
    assert.equal(authorityReads, 0);
  });

  it("passes an operator route through when the request arrives on the operator Host", async () => {
    const h = harness({ capturePhoneHost: PHONE_HOST });

    const response = await h.app.request("/api/v1/bootstrap", { headers: { host: OPERATOR_HOST } });

    assert.equal(response.status, 200);
  });

  it("passes every Host through when no capturePhoneHost is configured", async () => {
    const h = harness();

    const onPhoneWord = await h.app.request("/api/v1/bootstrap", { headers: { host: PHONE_HOST } });
    const onOperatorWord = await h.app.request("/api/v1/bootstrap", { headers: { host: OPERATOR_HOST } });

    assert.equal(onPhoneWord.status, 200);
    assert.equal(onOperatorWord.status, 200);
  });
});
