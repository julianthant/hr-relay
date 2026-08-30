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
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Hono } from "hono";
import { canonicalJsonStringify } from "../../../src/domain/canonical-json.js";
import { manualClock } from "../../../src/domain/clock.js";
import {
  SETTINGS_SCHEMA_HASH,
  SettingsFileRecordSchema,
  initialSettingsFileRecord,
  settingsRuntimeIdentity,
  deriveSettingsPatchFingerprint,
} from "../../../src/domain/config/settings.js";
import { requiredPreflightChecks } from "../../../src/domain/preflight.js";
import { ActivityReportWireSchema } from "../../../src/domain/dashboard/activity.js";
import { DiagnosticBundleIdSchema } from "../../../src/domain/ids.js";
import { StorageDoctorWireSchema } from "../../../src/domain/dashboard/storage.js";
import { EditableSettingsWireSchema } from "../../../src/domain/dashboard/settings-editor.js";
import { defineWorkflowRole } from "../../../src/domain/workflow/module-role.js";
import { createCommandKernel } from "../../../src/core/command-kernel.js";
import { createSettingsFileAuthority } from "../../../src/infra/config/settings-file.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/index.js";
import { createContentAddressedArtifactWriter } from "../../../src/infra/artifacts/content-addressed-artifact-writer.js";
import { createNoteJsonlWriter } from "../../../src/infra/events/note-jsonl-writer.js";
import { createSpanJsonlWriter } from "../../../src/infra/events/span-jsonl-writer.js";
import { readEventStreamLines } from "../../../src/infra/events/jsonl-streams.js";
import {
  createDashboardCommandService,
  deriveBulkChildCommandId,
} from "../../../src/server/dashboard/commands/command-service.js";
import type { IntakeService } from "../../../src/server/dashboard/commands/intake-service.js";
import { createSettingsApplicationExecutor } from "../../../src/server/dashboard/commands/settings-service.js";
import { createStartPlanService } from "../../../src/server/dashboard/commands/start-plan-service.js";
import { descriptorSetHash } from "../../../src/server/dashboard/compose.js";
import { createReceiptService } from "../../../src/server/trust/receipt-service.js";
import { createDashboardApp } from "../../../src/server/dashboard/routes/api.js";
import type { DiagnosticBundleQueryDeps } from "../../../src/server/dashboard/queries/diagnostic-bundle.js";
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
import { healthyDashboardPreflightExecutor, healthyDashboardPreflightReport } from "../../fixtures/preflight-seams.js";

interface Harness {
  readonly app: Hono;
  readonly database: AuthorityDatabase;
  readonly settingsPath: string;
  readonly stateRoot: string;
  readonly clock: ReturnType<typeof manualClock>;
  readonly noteWriter: ReturnType<typeof createNoteJsonlWriter>;
  readonly hub: DashboardStreamHub;
  readonly projection: ReturnType<typeof createRunQueueProjection>;
  readonly artifacts: ReturnType<typeof createContentAddressedArtifactWriter>;
}

const cleanups: (() => void)[] = [];
const OPERATOR_JSON_HEADERS = Object.freeze({
  host: "localhost",
  origin: "http://localhost",
  "content-type": "application/json",
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function harness(options: {
  readonly capturePhoneHost?: string;
  readonly capturePhoneAssetPaths?: ReadonlySet<string>;
  readonly diagnosticBundles?: (real: DiagnosticBundleQueryDeps) => DiagnosticBundleQueryDeps;
  readonly intake?: IntakeService;
} = {}): Harness {
  const root = mkdtempSync(join(tmpdir(), "hrauto-bff-"));
  const stateRoot = join(root, ".tracker-rebuild");
  const settingsPath = join(root, "config", "settings.json");
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
  };

  const activeSettingsIdentity = settingsRuntimeIdentity(initialSettingsFileRecord(), HASH_B);
  const settingsAuthority = createSettingsFileAuthority({
    path: settingsPath,
    validateCandidate: (settings) => { resolveConfig({}, settings, clock); },
  });
  const settingsFile = {
    read: () => {
      // Applying a revision does not mutate the running process. This test
      // harness therefore models the same persisted/active split as the real
      // runtime instead of serving a stale identity as a false "current".
      const record = settingsAuthority.read();
      const persisted = settingsRuntimeIdentity(record, HASH_B);
      if (
        persisted.settingsRevision === activeSettingsIdentity.settingsRevision
        && persisted.settingsSchemaHash === activeSettingsIdentity.settingsSchemaHash
        && persisted.settingsFingerprint === activeSettingsIdentity.settingsFingerprint
      ) {
        return { record, runtimeStatus: { state: "current" as const, identity: activeSettingsIdentity } };
      }
      return { record, runtimeStatus: { state: "restart-required" as const, active: activeSettingsIdentity, persisted } };
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
    settings: createSettingsApplicationExecutor(settingsAuthority),
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
    intake: options.intake ?? UNWIRED_INTAKE_SERVICE,
    capture: UNWIRED_CAPTURE_SERVICE,
    capturePhoneHost: options.capturePhoneHost,
    capturePhoneAssetPaths: options.capturePhoneAssetPaths,
    preflight: healthyDashboardPreflightExecutor(clock),
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
      preflightReport: () => healthyDashboardPreflightReport(clock),
      // No advisory provider is composed in this harness (D178).
      advisoryAvailability: () => ({
        state: "unavailable",
        code: "not-configured",
        reason: "no ai.advisory provider is composed in this harness",
      }),
    },
    projection,
    commandJournal: database.authority.commands,
    bulkCommandAcceptances: {
      withTransaction: (work) => database.withAuthorityTransaction((repositories) =>
        work(repositories.bulkCommandAcceptances)),
    },
    diagnosticBundles: options.diagnosticBundles?.({
      authority: database.authority.diagnosticBundles,
      artifacts,
    }) ?? {
      authority: database.authority.diagnosticBundles,
      artifacts,
    },
    runDetail: runDetailDeps,
    archive: archiveQueryDeps({ database, clock, appVersion: "0.1.0", descriptors: [fixtureDescriptor] }),
    commands,
    startPlans,
    hub,
    // D274 item 6 — the read-only Settings status sections read the SAME
    // resolved config and descriptor tuple this harness composes everything else
    // from, so nothing on that page can be true here and false in production.
    settings: { config: resolveConfig({}, {}, clock), descriptors: [fixtureDescriptor] },
    settingsEditor: { settings: settingsFile, environment: {}, clock },
    storage: {
      doctorOptions: {
        // The harness database lives at the temp ROOT, not under stateRoot.
        authorityPath: join(root, "state.db"),
        spanRoot: stateRoot,
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
  return { app, database, settingsPath, stateRoot, clock, noteWriter, hub, projection, artifacts };
}

function optionalFileBytes(path: string): Buffer | undefined {
  return existsSync(path) ? readFileSync(path) : undefined;
}

function settingsAuthoritySnapshot(h: Harness, commandId: string) {
  return {
    settingsBytes: optionalFileBytes(h.settingsPath),
    initializationBytes: optionalFileBytes(`${h.settingsPath}.authority.json`),
    lockBytes: optionalFileBytes(`${h.settingsPath}.lock`),
    prepareBytes: optionalFileBytes(`${h.settingsPath}.prepare.json`),
    current: h.database.authority.settingsCurrent.get(),
    journal: h.database.authority.commands.get(commandId),
    audit: h.database.authority.commandAudits.findByCommand(commandId),
    runtimeGeneration: h.database.authority.runtimeConfig.get()?.generation,
    authorityGeneration: h.database.getMeta().authorityGeneration,
  };
}

async function captureDiagnosticBundle(h: Harness) {
  h.database.authority.runs.enqueue(personLookupQueuedRun({ runId: RUN_ID }));
  return createDiagnosticCaptureService({
    authority: h.database.authority,
    artifacts: h.artifacts,
    clock: h.clock,
    ids: sequentialIdFactory("d"),
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
      bytes: new TextEncoder().encode("[]"),
      sensitivity: "redacted",
    }],
  });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("BFF spine flow (start plan -> kernel -> spans -> projection)", () => {
  it.each([
    ["mutated", false],
    ["missing", true],
  ] as const)("returns typed path-free corruption when a real diagnostic artifact is %s", async (_case, removeArtifact) => {
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
    assert.equal(body.code, "DIAGNOSTIC_BUNDLE_CORRUPT");
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

  it("plans, starts, projects, and serves the run through the one payload", async () => {
    const h = harness();

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
      headers: OPERATOR_JSON_HEADERS,
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
      headers: OPERATOR_JSON_HEADERS,
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
      headers: OPERATOR_JSON_HEADERS,
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
      headers: OPERATOR_JSON_HEADERS,
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

  it("refuses a foreign-origin settings command before any authority effect", async () => {
    const h = harness();
    const commandId = "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b79";
    const patch = { browser: { headless: false } } as const;
    const command = {
      commandId,
      requestedAt: "2020-01-01T00:00:00.000Z",
      requestedBy: "forged-actor",
      source: "hostile-page",
      family: "settings",
      type: "apply-settings",
      target: { expectedRevision: 1 },
      payload: {
        settingsSchemaHash: SETTINGS_SCHEMA_HASH,
        patchFingerprint: deriveSettingsPatchFingerprint(patch),
        patch,
      },
    };
    const before = settingsAuthoritySnapshot(h, commandId);

    const response = await h.app.request("http://localhost/api/v1/commands", {
      method: "POST",
      headers: {
        host: "localhost",
        origin: "https://hostile.example",
        "content-type": "application/json",
      },
      body: JSON.stringify(command),
    });

    assert.equal(response.status, 403);
    assert.equal((await json(response)).code, "OPERATOR_MUTATION_ORIGIN_REFUSED");
    assert.deepEqual(settingsAuthoritySnapshot(h, commandId), before);
  });

  it.each([
    ["missing Origin", { host: "localhost", "content-type": "application/json" }, 403, "OPERATOR_MUTATION_ORIGIN_REFUSED"],
    ["foreign Origin", { ...OPERATOR_JSON_HEADERS, origin: "https://hostile.example" }, 403, "OPERATOR_MUTATION_ORIGIN_REFUSED"],
    ["text/plain", { ...OPERATOR_JSON_HEADERS, "content-type": "text/plain" }, 415, "OPERATOR_MUTATION_MEDIA_TYPE_REFUSED"],
  ] as const)("refuses %s without consuming either command body or changing authority", async (_label, headers, status, code) => {
    const h = harness();
    const commandId = "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b74";
    const bulkCommandId = "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b73";
    const patch = { browser: { headless: false } };
    h.database.authority.runs.enqueue(personLookupQueuedRun({ runId: RUN_ID }));
    const snapshot = () => ({
      settings: settingsAuthoritySnapshot(h, commandId),
      run: h.database.authority.runs.get(RUN_ID),
      parent: h.database.authority.bulkCommandAcceptances.get(bulkCommandId),
      child: settingsAuthoritySnapshot(h, deriveBulkChildCommandId(bulkCommandId, RUN_ID)),
    });
    const before = snapshot();
    for (const [path, body] of [
      ["/api/v1/commands", {
        commandId, family: "settings", type: "apply-settings",
        target: { expectedRevision: 1 },
        payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch },
      }],
      ["/api/v1/commands/bulk", {
        commandId, bulkCommandId, family: "run", type: "cancel", mode: "best-effort",
        targets: [{ runId: RUN_ID, expectedVersion: 1 }],
      }],
    ] as const) {
      // Pass this exact Request to Hono: spies wrap the real raw-body methods,
      // and valid JSON makes early consumption observable even if refusal still wins.
      const request = new Request(`http://localhost${path}`, {
        method: "POST", headers, body: JSON.stringify(body),
      });
      const reads = (["json", "text", "arrayBuffer", "blob", "formData"] as const)
        .map((method) => vi.spyOn(request, method));

      const response = await h.app.request(request);

      assert.equal(response.status, status, path);
      assert.equal((await json(response)).code, code, path);
      for (const read of reads) expect(read).not.toHaveBeenCalled();
      assert.equal(request.bodyUsed, false, path);
      assert.deepEqual(snapshot(), before, `${path} has zero authority effects`);
    }
  });

  it.each([
    ["unknown envelope field", { extra: true }, { extra: true }],
    ["unknown target field", { target: { expectedRevision: 1, extra: true } }, { targets: [{ runId: RUN_ID, expectedVersion: 1, extra: true }] }],
    ["wrong target type", { target: { expectedRevision: "1" } }, { targets: [{ runId: RUN_ID, expectedVersion: "1" }] }],
    ["wrong action", { type: "cancel" }, { type: "apply-settings" }],
    ["wrong command id", { commandId: "invalid" }, { bulkCommandId: "invalid" }],
    ["unknown nested payload field", { payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: "a".repeat(64), patch: { browser: { extra: true } } } }, { targets: [] }],
  ] as const)("refuses %s through strict command ingress with zero effects", async (_label, singleChange, bulkChange) => {
    const h = harness();
    const commandId = "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b72";
    const bulkCommandId = "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b71";
    const patch = { browser: { headless: false } };
    h.database.authority.runs.enqueue(personLookupQueuedRun({ runId: RUN_ID }));
    const snapshot = () => ({
      settings: settingsAuthoritySnapshot(h, commandId),
      run: h.database.authority.runs.get(RUN_ID),
      parent: h.database.authority.bulkCommandAcceptances.get(bulkCommandId),
      child: settingsAuthoritySnapshot(h, deriveBulkChildCommandId(bulkCommandId, RUN_ID)),
    });
    const before = snapshot();
    const single = {
      commandId, family: "settings", type: "apply-settings",
      target: { expectedRevision: 1 },
      payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch },
    };
    const bulk = {
      commandId, bulkCommandId, family: "run", type: "cancel", mode: "best-effort",
      targets: [{ runId: RUN_ID, expectedVersion: 1 }],
    };
    for (const [path, body, status, code] of [
      ["/api/v1/commands", { ...single, ...singleChange }, 400, "SCHEMA_INVALID"],
      ["/api/v1/commands/bulk", { ...bulk, ...bulkChange }, 422, "schema-mismatch"],
    ] as const) {
      const response = await h.app.request(path, {
        method: "POST", headers: OPERATOR_JSON_HEADERS, body: JSON.stringify(body),
      });
      assert.equal(response.status, status, path);
      assert.equal((await json(response)).code, code, path);
      assert.deepEqual(snapshot(), before, `${path} has zero authority effects`);
    }
  });

  it.each([[null], [[]], ["command"], [1]])("refuses a non-object command body (%j) without authority effects", async (body) => {
    const h = harness();
    const commandId = "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b70";
    const before = settingsAuthoritySnapshot(h, commandId);
    for (const [path, status, code] of [
      ["/api/v1/commands", 400, "SCHEMA_INVALID"],
      ["/api/v1/commands/bulk", 422, "schema-mismatch"],
    ] as const) {
      const response = await h.app.request(path, {
        method: "POST", headers: OPERATOR_JSON_HEADERS, body: JSON.stringify(body),
      });
      assert.equal(response.status, status, path);
      assert.equal((await json(response)).code, code, path);
      assert.deepEqual(settingsAuthoritySnapshot(h, commandId), before, path);
    }
  });

  it("stamps accepted command provenance from the server-owned operator session", async () => {
    const h = harness();
    const commandId = "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b78";
    const patch = { browser: { headless: false } } as const;
    const acceptedAt = h.clock.now().toISOString();

    const response = await h.app.request("http://localhost/api/v1/commands", {
      method: "POST",
      headers: {
        host: "localhost",
        origin: "http://localhost",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        commandId,
        requestedAt: "2020-01-01T00:00:00.000Z",
        requestedBy: "forged-actor",
        source: "hostile-page",
        family: "settings",
        type: "apply-settings",
        target: { expectedRevision: 1 },
        payload: {
          settingsSchemaHash: SETTINGS_SCHEMA_HASH,
          patchFingerprint: deriveSettingsPatchFingerprint(patch),
          patch,
        },
      }),
    });

    assert.equal(response.status, 200);
    assert.equal((await json(response)).state, "applied");
    const expectedCommand = {
      commandId,
      requestedAt: acceptedAt,
      requestedBy: "local-operator",
      source: "dashboard",
      family: "settings",
      type: "apply-settings",
      target: { expectedRevision: 1 },
      payload: {
        settingsSchemaHash: SETTINGS_SCHEMA_HASH,
        patchFingerprint: deriveSettingsPatchFingerprint(patch),
        patch,
      },
    };
    assert.deepEqual(h.database.authority.commands.get(commandId), expectedCommand);
    assert.deepEqual(h.database.authority.commandAudits.findByCommand(commandId)?.request, expectedCommand);
    const persisted = SettingsFileRecordSchema.parse(
      JSON.parse(readFileSync(h.settingsPath, "utf8")),
    );
    assert.equal(
      persisted.lastApplied?.commandFingerprint,
      createHash("sha256")
        .update("hrauto:settings-command:v1\0")
        .update(canonicalJsonStringify(expectedCommand))
        .digest("hex"),
    );
  });

  it("replays the first server-accepted canonical command after the clock advances", async () => {
    const h = harness();
    const commandId = "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b77";
    const acceptedAt = h.clock.now().toISOString();
    const patch = { browser: { headless: false } } as const;
    const command = {
      commandId,
      requestedAt: "2020-01-01T00:00:00.000Z",
      requestedBy: "forged-actor",
      source: "hostile-page",
      family: "settings",
      type: "apply-settings",
      target: { expectedRevision: 1 },
      payload: {
        settingsSchemaHash: SETTINGS_SCHEMA_HASH,
        patchFingerprint: deriveSettingsPatchFingerprint(patch),
        patch,
      },
    };
    const request = () => h.app.request("http://localhost/api/v1/commands", {
      method: "POST",
      headers: {
        host: "localhost",
        origin: "http://localhost",
        "content-type": "application/json",
      },
      body: JSON.stringify(command),
    });
    assert.equal((await json(await request())).state, "applied");
    h.clock.advanceWall(1_000);

    const replay = await request();

    assert.equal(replay.status, 200);
    assert.equal((await json(replay)).state, "already-applied");
    assert.equal(h.database.authority.commands.get(commandId)?.requestedAt, acceptedAt);
  });

  it("serializes concurrent acceptance of one command id around the server clock", async () => {
    let firstPrepareReached: (() => void) | undefined;
    const firstPrepare = new Promise<void>((resolve) => {
      firstPrepareReached = resolve;
    });
    let prepares = 0;
    const intake: IntakeService = {
      ...UNWIRED_INTAKE_SERVICE,
      async prepare(): Promise<void> {
        prepares += 1;
        if (prepares !== 1) return;
        firstPrepareReached?.();
        await new Promise<void>((resolve) => setImmediate(resolve));
      },
    };
    const h = harness({ intake });
    const commandId = "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b75";
    const acceptedAt = h.clock.now().toISOString();
    const patch = { browser: { headless: false } } as const;
    const command = {
      commandId,
      requestedAt: "2020-01-01T00:00:00.000Z",
      requestedBy: "forged-actor",
      source: "hostile-page",
      family: "settings",
      type: "apply-settings",
      target: { expectedRevision: 1 },
      payload: {
        settingsSchemaHash: SETTINGS_SCHEMA_HASH,
        patchFingerprint: deriveSettingsPatchFingerprint(patch),
        patch,
      },
    };
    const request = () => h.app.request("http://localhost/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify(command),
    });
    const first = request();
    await firstPrepare;
    h.clock.advanceWall(1_000);

    const responses = await Promise.all([first, request()]);

    assert.deepEqual(responses.map(({ status }) => status), [200, 200]);
    assert.deepEqual(
      await Promise.all(responses.map(async (response) => (await json(response)).state)),
      ["applied", "already-applied"],
    );
    assert.equal(h.database.authority.commands.get(commandId)?.requestedAt, acceptedAt);
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
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({ family: "start", type: "start-run" }),
    });
    assert.equal(badCommand.status, 400);

    const settingsCommandId = "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b7b";
    const settingsPatch = {};
    const mismatchedCommand = {
      commandId: settingsCommandId,
      requestedAt: h.clock.now().toISOString(),
      requestedBy: "local-operator",
      source: "settings-surface",
      family: "settings",
      type: "apply-settings",
      target: { expectedRevision: 1 },
      payload: {
        settingsSchemaHash: "a".repeat(64),
        patchFingerprint: deriveSettingsPatchFingerprint(settingsPatch),
        patch: settingsPatch,
      },
    };
    const settingsBefore = settingsAuthoritySnapshot(h, settingsCommandId);

    const mismatchedSettingsSchema = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify(mismatchedCommand),
    });
    assert.equal(mismatchedSettingsSchema.status, 422);
    const rejection = await json(mismatchedSettingsSchema);
    assert.equal(rejection.state, "rejected");
    assert.equal(rejection.code, "schema-mismatch");
    assert.deepEqual(
      settingsAuthoritySnapshot(h, settingsCommandId),
      settingsBefore,
      "a schema-mismatched settings command must leave file, prepare, current, journal, audit, and generations byte-exactly unchanged",
    );

    const unknownWorkflowPlan = await h.app.request("/api/v1/start-plans", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
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
    assert.deepEqual(report.spanAuthority, {
      state: "complete",
      counts: { current: 0, archived: 0, missingSpan: 0, unaccounted: 0 },
      findings: [],
    });
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

  it("reruns preflight through the closed read-only command and returns the exact report", async () => {
    const h = harness();
    const response = await h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        commandId: "00000000-0000-4000-8000-000000000091",
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "local-operator",
        source: "settings-surface",
        type: "rerun-preflight",
        target: {
          expectedConfigFingerprint: "a".repeat(64),
          expectedDescriptorFingerprint: "b".repeat(64),
        },
      }),
    });

    assert.equal(response.status, 200);
    const result = await json(response);
    assert.equal(result.state, "completed");
    assert.equal(result.commandId, "00000000-0000-4000-8000-000000000091");
    assert.deepEqual(
      (result.report as { results: { check: string }[] }).results.map(({ check }) => check),
      requiredPreflightChecks(["dashboard.serve"]),
    );
  });

  it("serves the resolver-owned editor inventory and reads the persisted settings revision back", async () => {
    const h = harness();
    const initial = EditableSettingsWireSchema.parse(await json(await h.app.request("/api/v1/settings/editable")));
    assert.equal(initial.revision, 1);
    assert.deepEqual(initial.sections.map((section) => section.id), ["general", "display", "performance", "paths"]);
    const initialWidth = initial.sections.flatMap((section) => section.leaves).find((leaf) => leaf.path === "display.screenWidth");
    assert.equal(initialWidth?.source, "default");

    const patch = { display: { screenWidth: 1980 } };
    const applied = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        commandId: "00000000-0000-4000-8000-000000000096",
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "local-operator",
        source: "settings-surface",
        family: "settings",
        type: "apply-settings",
        target: { expectedRevision: initial.revision },
        payload: {
          settingsSchemaHash: initial.settingsSchemaHash,
          patchFingerprint: deriveSettingsPatchFingerprint(patch),
          patch,
        },
      }),
    });
    assert.equal(applied.status, 200);
    const readback = EditableSettingsWireSchema.parse(await json(await h.app.request("/api/v1/settings/editable")));
    assert.equal(readback.revision, 2);
    const persistedWidth = readback.sections.flatMap((section) => section.leaves).find((leaf) => leaf.path === "display.screenWidth");
    assert.equal(persistedWidth?.source, "settings");
    assert.equal(persistedWidth?.effectiveValue, 1980);
    assert.equal(persistedWidth?.settingsValue, 1980);
  });

  it("refuses an unavailable run-detail section by name and serves failure only when real", async () => {
    const h = harness();
    const planResponse = await json(await h.app.request("/api/v1/start-plans", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({ workflowId: "fixture-graph", submissions: [{ eid: "10873698", mode: "read-only" }], dryRun: false }),
    }));
    const fingerprints = planResponse.fingerprints as Record<string, string>;
    await h.app.request("/api/v1/commands", {
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
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({ workflowId: "fixture-graph", submissions: [{ eid: "10873698", mode: "read-only" }], dryRun: false }),
    }));
    await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
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
        headers: OPERATOR_JSON_HEADERS,
        body: JSON.stringify({ workflowId: "fixture-graph", submissions: [{ eid, mode: "read-only" }], dryRun: false }),
      });
      assert.equal(planResponse.status, 200);
      const plan = await json(planResponse);
      const fingerprints = plan.fingerprints as Record<string, string>;
      const started = await h.app.request("/api/v1/commands", {
        method: "POST",
        headers: OPERATOR_JSON_HEADERS,
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
    const runD = await startRun("10873701", "1a000000-0000-4000-8000-000000000005");
    const versionOf = (runId: string): number => {
      const run = h.database.authority.runs.get(runId);
      assert.notEqual(run, undefined, `run ${runId} exists in authority`);
      return (run as { version: number }).version;
    };

    // runC is cancelled up front so its bulk child exercises the REFUSED arm
    // through the same kernel precondition a single press would hit.
    const soloCancel = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
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
      requestedAt: "2020-01-01T00:00:00.000Z",
      requestedBy: "forged-actor",
      source: "hostile-page",
      family: "run",
      type: "cancel",
      bulkCommandId: "1a000000-0000-4000-8000-00000000000b",
      mode: "best-effort",
    } as const;
    const postBulk = async (body: unknown): Promise<{ status: number; payload: Record<string, unknown> }> => {
      const response = await h.app.request("/api/v1/commands/bulk", {
        method: "POST",
        headers: OPERATOR_JSON_HEADERS,
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
      commandId: "1a000000-0000-4000-8000-00000000000c",
      bulkCommandId: "1a000000-0000-4000-8000-00000000000c",
      targets: [{ runId: runA, expectedVersion: 1 }, { runId: runA, expectedVersion: 1 }],
    });
    assert.equal(duplicated.payload.state, "refused");
    assert.match(String(duplicated.payload.message), /more than once/);

    const allOrNone = await postBulk({
      ...envelope,
      commandId: "1a000000-0000-4000-8000-00000000000d",
      bulkCommandId: "1a000000-0000-4000-8000-00000000000d",
      mode: "all-or-none",
      targets: [{ runId: runA, expectedVersion: 1 }],
    });
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
    const acceptedChild = h.database.authority.commands.get(String(results[0].commandId));
    assert.equal(acceptedChild?.requestedAt, h.clock.now().toISOString());
    assert.equal(acceptedChild?.requestedBy, "local-operator");
    assert.equal(acceptedChild?.source, "dashboard");
    const acceptedParent = h.database.authority.bulkCommandAcceptances.get(envelope.bulkCommandId);
    assert.notEqual(acceptedParent, undefined);
    assert.deepEqual(acceptedParent?.request.targets, bulkBody.targets);
    assert.equal(acceptedParent?.request.requestedAt, h.clock.now().toISOString());
    assert.equal(acceptedParent?.request.requestedBy, "local-operator");
    assert.equal(acceptedParent?.request.source, "dashboard");

    // Re-delivering the SAME bulk envelope replays the applied child rather
    // than filing a second cancel: the child ids are derived, not minted.
    h.clock.advanceWall(1_000);
    const replay = await postBulk(bulkBody);
    assert.equal(replay.payload.state, "vector");
    const replayed = replay.payload.results as Record<string, unknown>[];
    assert.deepEqual(replayed.map(({ outcome }) => outcome), ["applied", "conflict", "refused"]);
    assert.equal(replayed[0].replayed, true, "the applied child is answered from the journal, not re-executed");
    assert.equal(replayed[0].commandId, results[0].commandId);
    assert.deepEqual(
      h.database.authority.bulkCommandAcceptances.get(envelope.bulkCommandId),
      acceptedParent,
      "exact replay reuses the byte-exact accepted parent and its original accepted time",
    );

    const snapshot = (): unknown => ({
      generation: h.database.getMeta().authorityGeneration,
      parent: h.database.authority.bulkCommandAcceptances.get(envelope.bulkCommandId),
      runs: [runA, runB, runC, runD].map((runId) => h.database.authority.runs.get(runId)),
      children: [runA, runB, runC, runD].map((runId) => {
        const childId = deriveBulkChildCommandId(envelope.bulkCommandId, runId);
        return {
          command: h.database.authority.commands.get(childId),
          audit: h.database.authority.commandAudits.findByCommand(childId),
        };
      }),
    });
    const divergentReplays = [
      {
        label: "adds an old+new target",
        body: {
          ...bulkBody,
          targets: [...bulkBody.targets, { runId: runD, expectedVersion: versionOf(runD) }],
        },
      },
      {
        label: "omits an accepted target",
        body: { ...bulkBody, targets: bulkBody.targets.slice(0, -1) },
      },
      {
        label: "reorders the accepted targets",
        body: { ...bulkBody, targets: [...bulkBody.targets].reverse() },
      },
      {
        label: "changes one accepted child",
        body: {
          ...bulkBody,
          targets: [
            { ...bulkBody.targets[0], expectedVersion: bulkBody.targets[0].expectedVersion + 1 },
            ...bulkBody.targets.slice(1),
          ],
        },
      },
    ] as const;
    for (const divergent of divergentReplays) {
      const before = snapshot();
      const refusal = await postBulk(divergent.body);
      assert.equal(refusal.status, 422, divergent.label);
      assert.equal(refusal.payload.state, "refused", divergent.label);
      assert.equal(refusal.payload.code, "schema-mismatch", divergent.label);
      assert.deepEqual(snapshot(), before, `${divergent.label} has byte-exact zero child effects`);
    }
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
