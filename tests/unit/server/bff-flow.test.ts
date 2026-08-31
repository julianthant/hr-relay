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
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import readXlsxFile from "read-excel-file/node";
import { canonicalJsonStringify } from "../../../src/domain/canonical-json.js";
import { manualClock } from "../../../src/domain/clock.js";
import {
  SETTINGS_SCHEMA_HASH,
  SettingsFileRecordSchema,
  initialSettingsFileRecord,
  settingsRuntimeIdentity,
  deriveSettingsPatchFingerprint,
} from "../../../src/domain/config/settings.js";
import {
  requiredPreflightChecks,
  type PreflightDeadlineScheduler,
} from "../../../src/domain/preflight.js";
import {
  archivedRunContentDigest,
  ArchivedRunContentSchema,
  VersionBumpApplicationSchema,
  VersionBumpPlanSchema,
  versionBumpPlanFingerprint,
} from "../../../src/domain/archive/model.js";
import { ActivityReportWireSchema } from "../../../src/domain/dashboard/activity.js";
import { CrossDateSearchPageSchema } from "../../../src/domain/dashboard/search.js";
import { DiagnosticBundleIdSchema, RunIdSchema } from "../../../src/domain/ids.js";
import { RunRecordSchema, type RunRecord } from "../../../src/domain/run/record.js";
import { RunEvidenceReceiptSchema, type RunEvidenceReceipt } from "../../../src/domain/trust/evidence.js";
import { defineReceiptComparisonRegistry } from "../../../src/domain/trust/receipt-comparison.js";
import { StorageDoctorWireSchema } from "../../../src/domain/dashboard/storage.js";
import { EditableSettingsWireSchema } from "../../../src/domain/dashboard/settings-editor.js";
import { createActivityPersonPseudonymDomain } from "../../../src/domain/trust/activity-person-pseudonym.js";
import { createPreflightHarness } from "../../fixtures/preflight-seams.js";
import { PreflightRerunCommandResultSchema } from "../../../src/domain/preflight.js";
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
import type { RunReceiptComparisonQueryDeps } from "../../../src/server/dashboard/queries/run-comparison.js";
import { createCrossDateSearchService } from "../../../src/server/dashboard/queries/search.js";
import { createOperatorXlsxExportService } from "../../../src/server/dashboard/exports/operator-xlsx-export-service.js";
import { createSoloRequestIdentityCheckpoint } from "../../../src/server/dashboard/request-identity.js";
import type { RequestIdentityCheckpoint } from "../../../src/server/dashboard/request-identity.js";
import { RequestIdentityRefusedError } from "../../../src/server/failures.js";
import { createDiagnosticCaptureService } from "../../../src/services/trust/diagnostic-capture.js";
import { activityReportCsv } from "../../../src/server/dashboard/queries/activity-export.js";
import { activityReportCaveats } from "../../../src/domain/dashboard/activity.js";
import { createRunQueueProjection } from "../../../src/server/dashboard/projectors/run-queue-projection.js";
import { createDashboardStreamHub, type DashboardStreamHub } from "../../../src/server/dashboard/subscriptions/dashboard-stream.js";
import { fixtureDescriptor } from "../architecture/helpers/descriptor-fixtures.js";
import { separationsDescriptor } from "../../../src/workflows/separations/descriptor.js";
import {
  ACTIVITY_PERSON_PSEUDONYM_KEY_HEX,
  activityPersonPseudonymResultRecord,
  CURRENT_SEPARATIONS_RESULT,
  seedSeparationsRunAuthority,
  TERMINAL_SEPARATIONS_RUN,
} from "../fixtures/activity-person-pseudonym-fixtures.js";
import {
  ARCHIVED_RUN,
  VERSION_BUMP_APPLICATION,
  VERSION_PLAN_ROW,
} from "../fixtures/archive-fixtures.js";
import { HASH_B, UUID_4 } from "../fixtures/phase1c-contract-fixtures.js";
import { RUN_ID, sequentialIdFactory } from "../fixtures/phase1f-run-fixtures.js";
import { personLookupQueuedRun } from "../fixtures/phase1f-executor-harness.js";
import { AT, cleanReceiptOf, DAY, runRecordOf, traceOf, uuidOf } from "./helpers/dashboard-harness.js";
import { insertMeasuredSearchRun } from "./helpers/cross-date-search-harness.js";
import { NO_INTAKE_PROJECTIONS, UNSTORED_CONFIG_IDENTITY, UNWIRED_INTAKE_PARSER, UNWIRED_INTAKE_SERVICE } from "../../fixtures/intake-kernel-seams.js";
import { resolveConfig } from "../../../src/domain/config/resolve.js";
import { UNWIRED_CAPTURE_SERVICE } from "../../fixtures/capture-surface-seams.js";
import { explorerQueryDeps, uiCatalogQueryDeps } from "../../fixtures/explorer-seams.js";
import { archiveQueryDeps, archiveSnapshots } from "../../fixtures/archive-seams.js";
import { createLedgerReadThrough } from "../../../src/infra/ledger/ledger-read-through.js";
import { UNOBSERVED_BACKFILL_GAP_NOTIFIER } from "../../fixtures/dashboard-stream-seams.js";
import { createDashboardClient, DashboardClientError } from "../../../src/dashboard/client/index.js";

interface Harness {
  readonly app: ReturnType<typeof createDashboardApp>;
  readonly database: AuthorityDatabase;
  readonly settingsPath: string;
  readonly stateRoot: string;
  readonly clock: ReturnType<typeof manualClock>;
  readonly noteWriter: ReturnType<typeof createNoteJsonlWriter>;
  readonly hub: DashboardStreamHub;
  readonly projection: ReturnType<typeof createRunQueueProjection>;
  readonly artifacts: ReturnType<typeof createContentAddressedArtifactWriter>;
  readonly preflight: ReturnType<typeof createPreflightHarness>;
}

const cleanups: (() => void)[] = [];
const OPERATOR_JSON_HEADERS = Object.freeze({
  host: "localhost",
  origin: "http://localhost",
  "content-type": "application/json",
});

const COMPARISON_REGISTRY = defineReceiptComparisonRegistry(separationsDescriptor, {
  workflowId: "separations",
  facts: [{
    id: "separations.action.document-number",
    label: "Document number",
    disclosure: { posture: "allow", classification: "safe-diagnostic", transform: "allow" },
    binding: {
      collection: "observations",
      sourceKinds: ["system", "checkpoint"],
      nodeId: "resolve-action",
      taskId: "kuali/search-separation-action",
      fieldPath: "documentNumber",
    },
  }],
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function harness(options: {
  readonly capturePhoneHost?: string;
  readonly capturePhoneAssetPaths?: ReadonlySet<string>;
  readonly diagnosticBundles?: (real: DiagnosticBundleQueryDeps) => DiagnosticBundleQueryDeps;
  readonly receiptComparison?: RunReceiptComparisonQueryDeps;
  readonly requestIdentity?: RequestIdentityCheckpoint;
  readonly intake?: IntakeService;
  readonly preflightBeforeRun?: () => Promise<void>;
  readonly preflightScheduler?: PreflightDeadlineScheduler;
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
  const searchDescriptors = {
    resolve: (workflowId: string) => workflowId === "separations"
      ? { id: "separations", label: "Separations", code: "sp", category: "separation" }
      : undefined,
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
      listActivityPersonPseudonyms: (runIds: readonly string[]) => database.authority.activityPersonPseudonyms.listByRuns(runIds),
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
  const preflight = createPreflightHarness(clock, HASH_B, options.preflightBeforeRun, options.preflightScheduler);


  const search = createCrossDateSearchService({
    clock,
    sourceIdentity: database.getSourceDatabaseIdentity(),
    cursorSigningKey: new Uint8Array(32).fill(0x42),
    descriptors: searchDescriptors,
    authority: {
      readSnapshot: (read) => database.withAuthorityReadSnapshot(() => read({
        authorityGeneration: database.getMeta().authorityGeneration,
        searchRuns: (input) => database.authority.runs.search(input),
      })),
    },
  });
  const app = createDashboardApp({
    requestIdentity: options.requestIdentity ?? createSoloRequestIdentityCheckpoint({
      id: "local-operator",
      label: "Local operator",
    }),
    intake: options.intake ?? UNWIRED_INTAKE_SERVICE,
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
      preflightReport: () => preflight.report,
    },
    preflight: preflight.authority,
    projection,
    search,
    xlsxExports: createOperatorXlsxExportService({
      clock,
      ids,
      sourceIdentity: database.getSourceDatabaseIdentity(),
      artifacts,
      authority: database.authority.operatorXlsxExports,
      search,
      activityReport: (from, to) => projection.buildActivityReportWire(from, to),
    }),
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
    receiptComparison: options.receiptComparison,
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
        stateRootTrustAnchor: root,
        stateRoot,
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
  return {
    app,
    database,
    settingsPath,
    stateRoot,
    clock,
    noteWriter,
    hub,
    projection,
    artifacts,
    preflight,
  };
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

function comparisonRunPair(): readonly [RunRecord, RunRecord] {
  const prior = runRecordOf({ seed: 641, workflow: "separations" });
  const currentBase = runRecordOf({ seed: 642, workflow: "separations" });
  return [prior, RunRecordSchema.parse({
    ...currentBase,
    envelope: {
      ...currentBase.envelope,
      itemId: prior.envelope.itemId,
      retryOf: prior.envelope.runId,
      attempt: 2,
    },
  })];
}

function comparisonReceipt(run: RunRecord, value: string): RunEvidenceReceipt {
  return RunEvidenceReceiptSchema.parse({
    ...cleanReceiptOf({ seed: Number(String(run.envelope.runId).slice(0, 4)), workflow: "separations" }),
    runId: run.envelope.runId,
    workflowId: run.envelope.workflow,
    attempt: run.envelope.attempt,
    retryOf: run.envelope.retryOf === undefined
      ? { state: "absent" }
      : { state: "present", value: run.envelope.retryOf },
    observations: [{
      id: uuidOf(run.envelope.attempt + 8640),
      field: "documentNumber",
      mandatory: true,
      source: {
        kind: "system",
        taskId: "kuali/search-separation-action",
        observedAt: "2026-08-28T12:00:00.000Z",
      },
      state: "satisfied",
      value: {
        key: "documentNumber",
        state: "allowed",
        classification: "safe-diagnostic",
        transform: "allow",
        value,
      },
    }],
  });
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

/**
 * D288's real storage-to-route proof needs current Separations authority rows,
 * not the projection fake used by the fold unit tests. These rows retain the
 * current descriptor identity and canonical result shape that the production
 * pseudonym write capability revalidates before it persists evidence.
 */
function currentSeparationsRun(input: Readonly<{
  seed: number;
  shape: "single" | "operation" | "operation-member";
  parent?: RunRecord;
  runId?: string;
}>): RunRecord {
  return RunRecordSchema.parse({
    ...TERMINAL_SEPARATIONS_RUN,
    envelope: {
      ...TERMINAL_SEPARATIONS_RUN.envelope,
      runId: input.runId ?? uuidOf(input.seed),
      itemId: uuidOf(input.seed + 5_000),
      traceId: traceOf(input.seed),
      shape: input.shape,
      ...(input.parent === undefined ? {} : {
        parent: {
          runId: input.parent.envelope.runId,
          tracePrefix: input.parent.envelope.traceId,
          edgeId: "members",
        },
      }),
    },
  });
}

function seedCurrentSeparationsRun(
  h: Harness,
  run: RunRecord,
  canonicalSubject = "10800000",
): void {
  const result = activityPersonPseudonymResultRecord(run, {
    ...CURRENT_SEPARATIONS_RESULT,
    approved: { ...CURRENT_SEPARATIONS_RESULT.approved, emplId: canonicalSubject },
  });
  seedSeparationsRunAuthority(h.database, join(h.stateRoot, "..", "state.db"), run, result);
}

function persistCurrentSeparationsEvidence(
  h: Harness,
  generation: string,
  runs: readonly RunRecord[],
): void {
  const capability = h.database.createActivityPersonPseudonymBackfillWriteCapability(
    createActivityPersonPseudonymDomain({
      keyGeneration: generation,
      keyHex: ACTIVITY_PERSON_PSEUDONYM_KEY_HEX,
    }),
  );
  const outcomes = capability.reviewAndInsert(runs.map((run) => run.envelope.runId));
  assert.deepEqual(outcomes.map((outcome) => outcome.state), runs.map(() => "inserted"));
}

function projectCurrentSeparationsRuns(h: Harness, runs: readonly RunRecord[]): void {
  const writer = createSpanJsonlWriter({ stateRoot: h.stateRoot, clock: h.clock, pid: 4_243 });
  for (const run of runs) {
    writer.emit({
      t: "run.queued",
      kind: "run",
      ts: h.clock.now().toISOString(),
      workflow: run.envelope.workflow,
      runId: run.envelope.runId,
      attempt: run.envelope.attempt,
      traceId: run.envelope.traceId,
      spanPath: run.envelope.traceId,
      itemId: run.envelope.itemId,
      ...(run.envelope.parent === undefined ? {} : { parentRunId: run.envelope.parent.runId }),
      shape: run.envelope.shape,
      priority: run.envelope.priority,
      dryRun: run.envelope.dryRun,
      actorId: "local-operator",
      title: `Separations proof ${run.envelope.runId.slice(0, 8)}`,
      descriptorVersion: run.envelope.descriptorVersion,
      contractFingerprint: run.envelope.contractFingerprint,
      resolvedInstance: run.envelope.resolvedInstance,
      configFingerprint: run.envelope.configFingerprint,
      configSnapshotId: run.envelope.configSnapshotId,
    });
  }
  h.projection.ingestFromDisk();
}

function archiveCurrentSeparationsRun(h: Harness, run: RunRecord): void {
  const plan = VersionBumpPlanSchema.parse({
    ...VERSION_PLAN_ROW.plan,
    scope: { kind: "workflows", workflowIds: [run.envelope.workflow] },
    observedIdentities: [{
      workflowId: run.envelope.workflow,
      descriptorVersion: run.envelope.descriptorVersion,
      contractFingerprint: run.envelope.contractFingerprint,
    }],
    candidates: [{
      runId: run.envelope.runId,
      traceId: run.envelope.traceId,
      workflowId: run.envelope.workflow,
      title: "Archived Separations proof",
      enqueuedAt: run.envelope.enqueuedAt,
      drift: ["descriptor-version"],
    }],
  });
  h.database.authority.versionPlans.insert({
    ...VERSION_PLAN_ROW,
    plan,
    planFingerprint: versionBumpPlanFingerprint(plan),
  });
  h.database.authority.versionBumpApplications.insert(VersionBumpApplicationSchema.parse({
    ...VERSION_BUMP_APPLICATION,
    scope: plan.scope,
    appliedIdentities: plan.observedIdentities,
    archivedRunIds: [run.envelope.runId],
  }));
  const { contentDigest: _ignoredContentDigest, ...template } = ARCHIVED_RUN;
  const content = ArchivedRunContentSchema.parse({
    ...template,
    runId: run.envelope.runId,
    workflowId: run.envelope.workflow,
    workflowLabel: { state: "present", value: "Separations" },
    traceId: run.envelope.traceId,
    archivedIdentity: {
      workflowId: run.envelope.workflow,
      descriptorVersion: run.envelope.descriptorVersion,
      contractFingerprint: run.envelope.contractFingerprint,
    },
    row: {
      ...template.row,
      runId: run.envelope.runId,
      itemId: run.envelope.itemId,
      workflowId: run.envelope.workflow,
      traceId: run.envelope.traceId,
      descriptorVersion: run.envelope.descriptorVersion,
      descriptorHash: run.envelope.contractFingerprint,
      configFingerprint: run.envelope.configFingerprint,
      dryRun: run.envelope.dryRun,
      priority: run.envelope.priority,
    },
    detail: {
      ...template.detail,
      runId: run.envelope.runId,
      header: {
        ...template.detail.header,
        runId: run.envelope.runId,
        traceId: run.envelope.traceId,
        workflowId: run.envelope.workflow,
      },
    },
    input: run.input,
  });
  h.database.authority.archivedRuns.insert({
    ...content,
    contentDigest: archivedRunContentDigest(content),
  });
}

async function activityPeople(h: Harness): Promise<unknown> {
  const response = await h.app.request(`/api/v1/reports/activity?from=${DAY}&to=${DAY}`);
  assert.equal(response.status, 200);
  return ActivityReportWireSchema.parse(await response.json()).people;
}

describe("BFF spine flow (start plan -> kernel -> spans -> projection)", () => {
  it("serves strict cross-date search from durable run authority", async () => {
    const h = harness();
    insertMeasuredSearchRun(h.database, { seed: 77, enqueuedAt: "2026-08-28T15:00:00.000Z" });

    const response = await h.app.request("/api/v1/search?q=separations&scope=workflow&limit=1");

    assert.equal(response.status, 200);
    const page = CrossDateSearchPageSchema.parse(await response.json());
    assert.equal(page.totalMatches, 1);
    assert.equal(page.results[0]?.workflowId, "separations");

    const duplicate = await h.app.request("/api/v1/search?q=separations&q=other");
    assert.equal(duplicate.status, 400);
    const unknown = await h.app.request("/api/v1/search?q=separations&title=unsafe");
    assert.equal(unknown.status, 400);
    for (const parameter of [
      "workflow=person-lookup",
      "state=queued",
      "shape=preview",
      "dryRun=false",
      "system=crm",
      "priority=interactive",
    ]) {
      const unmeasured = await h.app.request(`/api/v1/search?q=separations&${parameter}`);
      assert.equal(unmeasured.status, 400, parameter);
    }
    const maximum = await h.app.request(`/api/v1/search?q=${"x".repeat(160)}&limit=50`);
    assert.equal(maximum.status, 200);
  });

  it("serves an exact People count from persisted current Separations standalone and member evidence only", async () => {
    const h = harness();
    const standalone = currentSeparationsRun({ seed: 310, shape: "single" });
    const operation = currentSeparationsRun({ seed: 311, shape: "operation" });
    const firstMember = currentSeparationsRun({ seed: 312, shape: "operation-member", parent: operation });
    const secondMember = currentSeparationsRun({ seed: 313, shape: "operation-member", parent: operation });
    // This persisted row deliberately has no current projection row. If the
    // repository ignores its requested run ids, the route sees foreign
    // evidence and must become unavailable instead of returning this count.
    const foreign = currentSeparationsRun({ seed: 314, shape: "single" });

    seedCurrentSeparationsRun(h, standalone, "10800000");
    seedCurrentSeparationsRun(h, operation, "10800000");
    seedCurrentSeparationsRun(h, firstMember, "10800000");
    seedCurrentSeparationsRun(h, secondMember, "10800001");
    seedCurrentSeparationsRun(h, foreign, "10800002");
    persistCurrentSeparationsEvidence(h, "activity-person-g1", [standalone, firstMember, secondMember, foreign]);
    projectCurrentSeparationsRuns(h, [standalone, operation, firstMember, secondMember]);

    assert.deepEqual(await activityPeople(h), {
      state: "present",
      distinct: 2,
      evidenceRows: 3,
    });
  });

  it("marks the People axis unavailable when one current Separations row lacks persisted evidence", async () => {
    const h = harness();
    const evidenced = currentSeparationsRun({ seed: 320, shape: "single" });
    const missing = currentSeparationsRun({ seed: 321, shape: "single" });

    seedCurrentSeparationsRun(h, evidenced);
    seedCurrentSeparationsRun(h, missing);
    persistCurrentSeparationsEvidence(h, "activity-person-g1", [evidenced]);
    projectCurrentSeparationsRuns(h, [evidenced, missing]);

    assert.deepEqual(await activityPeople(h), {
      state: "absent",
      evidenceRows: 1,
      unavailableRows: 1,
      reason: "1 of 2 current Separations run/member rows lack pseudonym evidence; distinct people is unavailable",
    });
  });

  it("marks the People axis unavailable when current Separations evidence spans generations", async () => {
    const h = harness();
    const first = currentSeparationsRun({ seed: 330, shape: "single" });
    const second = currentSeparationsRun({ seed: 331, shape: "single" });

    seedCurrentSeparationsRun(h, first, "10800000");
    seedCurrentSeparationsRun(h, second, "10800001");
    persistCurrentSeparationsEvidence(h, "activity-person-g1", [first]);
    persistCurrentSeparationsEvidence(h, "activity-person-g2", [second]);
    projectCurrentSeparationsRuns(h, [first, second]);

    assert.deepEqual(await activityPeople(h), {
      state: "absent",
      evidenceRows: 2,
      unavailableRows: 0,
      reason: "current Separations run/member rows use mixed pseudonym key generations; distinct people is unavailable",
    });
  });

  it("excludes archived Separations rows and their evidence from the current People corpus", async () => {
    const h = harness();
    const current = currentSeparationsRun({ seed: 340, shape: "single" });
    const archived = currentSeparationsRun({
      seed: 341,
      shape: "single",
      runId: ARCHIVED_RUN.runId,
    });

    seedCurrentSeparationsRun(h, current, "10800000");
    seedCurrentSeparationsRun(h, archived, "10800001");
    persistCurrentSeparationsEvidence(h, "activity-person-g1", [current, archived]);
    archiveCurrentSeparationsRun(h, archived);
    projectCurrentSeparationsRuns(h, [current, archived]);

    assert.deepEqual(await activityPeople(h), {
      state: "present",
      distinct: 1,
      evidenceRows: 1,
    });
  });

  it("fails loud without echoing any observed value outside the closed search corpus", async () => {
    const cases: readonly Readonly<{
      dimension: string;
      observed: string;
      mutate: (record: RunRecord) => RunRecord;
    }>[] = [
      {
        dimension: "workflow",
        observed: "eid-10873698",
        mutate: (record) => RunRecordSchema.parse({
          ...record,
          envelope: { ...record.envelope, workflow: "eid-10873698" },
        }),
      },
      {
        dimension: "shape",
        observed: "preview",
        mutate: (record) => RunRecordSchema.parse({
          ...record,
          envelope: { ...record.envelope, shape: "preview" },
        }),
      },
      {
        dimension: "dry-run",
        observed: "false",
        mutate: (record) => RunRecordSchema.parse({
          ...record,
          envelope: { ...record.envelope, dryRun: false },
        }),
      },
      {
        dimension: "resolved systems",
        observed: "crm",
        mutate: (record) => RunRecordSchema.parse({
          ...record,
          envelope: {
            ...record.envelope,
            resolvedInstance: { ...record.envelope.resolvedInstance, crm: "prod" },
          },
        }),
      },
      {
        dimension: "lifecycle/outcome",
        observed: "queued",
        mutate: (record) => RunRecordSchema.parse({ ...record, lifecycle: { state: "queued" } }),
      },
    ];

    for (const [index, corpusCase] of cases.entries()) {
      const h = harness();
      const run = insertMeasuredSearchRun(h.database, {
        seed: 80 + index,
        enqueuedAt: "2026-08-28T15:00:00.000Z",
      });
      const corrupted = corpusCase.mutate(run);
      const raw = new DatabaseSync(join(h.stateRoot, "..", "state.db"));
      try {
        raw.prepare("UPDATE tasks SET workflow = ?, state = ?, record_json = ? WHERE record_key = ?")
          .run(
            corrupted.envelope.workflow,
            corrupted.lifecycle.state,
            JSON.stringify(corrupted),
            corrupted.envelope.runId,
          );
      } finally {
        raw.close();
      }

      const response = await h.app.request("/api/v1/search?q=separations&limit=1");
      const body = await json(response);

      assert.equal(response.status, 500, corpusCase.dimension);
      assert.equal(body.code, "INTERNAL_FAILURE", corpusCase.dimension);
      assert.equal(
        body.message,
        `search corpus run ${run.envelope.runId} has ${corpusCase.dimension} outside the closed D283 corpus`,
        corpusCase.dimension,
      );
      assert.doesNotMatch(String(body.message), new RegExp(corpusCase.observed, "u"), corpusCase.dimension);
    }
  });

  it("refuses corrupt search authority without exposing its sensitive bytes", async () => {
    const h = harness();
    const run = insertMeasuredSearchRun(h.database, { seed: 78, enqueuedAt: "2026-08-28T15:00:00.000Z" });
    const sensitiveNodeId = "ssn-951-57-1700-eid-10873698";
    const sensitivePatch = {
      nodeId: sensitiveNodeId,
      fieldPath: "identifier",
      value: "redacted",
      correctedAt: run.createdAt,
      reason: "corrupt fixture",
    };
    const raw = new DatabaseSync(join(h.stateRoot, "..", "state.db"));
    try {
      raw.prepare("UPDATE tasks SET record_json = ? WHERE record_key = ?")
        .run(JSON.stringify({
          ...run,
          envelope: { ...run.envelope, injected: [sensitivePatch, sensitivePatch] },
        }), run.envelope.runId);
    } finally {
      raw.close();
    }

    const response = await h.app.request("/api/v1/search?q=separations&scope=workflow&limit=1");
    const body = await json(response);

    assert.equal(response.status, 500);
    assert.equal(body.code, "INTERNAL_FAILURE");
    assert.equal(body.message, `search corpus run ${run.envelope.runId} failed strict run validation`);
    assert.doesNotMatch(JSON.stringify(body), new RegExp(sensitiveNodeId, "u"));
  });

  it("reruns the one strict preflight authority through its command route", async () => {
    const h = harness();
    const command = {
      commandId: "00000000-0000-4000-8000-000000000010",
      requestedAt: h.clock.now().toISOString(),
      requestedBy: "local-operator",
      source: "settings-surface",
      type: "rerun-preflight",
      target: { expectedConfigFingerprint: HASH_B },
    } as const;

    const response = await h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1:3938" },
      body: JSON.stringify(command),
    });

    assert.equal(response.status, 200);
    const result = PreflightRerunCommandResultSchema.parse(await response.json());
    assert.equal(result.state, "completed");
    assert.deepEqual(result.report.results.map(({ check }) => check), [
      "runtime.compatibility",
      "config.valid",
      "filesystem.health",
      "authority.health",
      "ports.available",
      "process.orphans",
    ]);
    assert.equal(JSON.stringify(h.preflight.authority.readLatest()), JSON.stringify(result.report));

    const malformed = await h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1:3938" },
      body: JSON.stringify({ ...command, commandId: "00000000-0000-4000-8000-000000000011", extra: true }),
    });
    assert.equal(malformed.status, 400);
  });

  it("refuses preflight reruns outside the loopback Host and Origin boundary", async () => {
    const h = harness();
    const command = {
      commandId: "00000000-0000-4000-8000-000000000012",
      requestedAt: h.clock.now().toISOString(),
      requestedBy: "local-operator",
      source: "settings-surface",
      type: "rerun-preflight",
      target: { expectedConfigFingerprint: HASH_B },
    } as const;
    const cases = [
      { host: "attacker.example", origin: "http://127.0.0.1:5174" },
      { host: "127.0.0.1:3938", origin: "https://attacker.example" },
    ];

    for (const headers of cases) {
      const response = await h.app.request("/api/v1/preflight/rerun", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(command),
      });
      assert.equal(response.status, 403);
      assert.equal((await json(response)).code, "PREFLIGHT_INGRESS_FORBIDDEN");
    }

    const malformedOrigin = await h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: { host: "127.0.0.1:3938", origin: "not an absolute origin", "content-type": "application/json" },
      body: JSON.stringify(command),
    });
    assert.equal(malformedOrigin.status, 400);
    assert.equal((await json(malformedOrigin)).code, "PREFLIGHT_ORIGIN_INVALID");
  });

  it("keeps preflight body transport and decoding refusals distinguishable", async () => {
    const h = harness();
    const wrongType = await h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "text/plain", host: "127.0.0.1:3938" },
      body: "{}",
    });
    assert.equal(wrongType.status, 400);
    assert.equal((await json(wrongType)).code, "PREFLIGHT_CONTENT_TYPE_INVALID");

    const invalidJson = await h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1:3938" },
      body: "{",
    });
    assert.equal(invalidJson.status, 400);
    assert.equal((await json(invalidJson)).code, "PREFLIGHT_BODY_JSON_INVALID");

    const invalidUtf8 = await h.app.request(new Request("http://127.0.0.1:3938/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1:3938" },
      body: new Uint8Array([0xff]),
    }));
    assert.equal(invalidUtf8.status, 400);
    assert.equal((await json(invalidUtf8)).code, "PREFLIGHT_BODY_UTF8_INVALID");
  });

  it("distinguishes malformed lengths, missing bodies, and failed body streams", async () => {
    const h = harness();
    for (const contentLength of ["01", "9007199254740992"]) {
      const response = await h.app.request("/api/v1/preflight/rerun", {
        method: "POST",
        headers: {
          "content-length": contentLength,
          "content-type": "application/json",
          host: "127.0.0.1:3938",
        },
        body: "{}",
      });
      assert.equal(response.status, 400);
      assert.equal((await json(response)).code, "PREFLIGHT_CONTENT_LENGTH_INVALID");
    }

    const missingBody = await h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1:3938" },
    });
    assert.equal(missingBody.status, 400);
    assert.equal((await json(missingBody)).code, "PREFLIGHT_BODY_MISSING");

    const failedBody = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("injected request-stream failure"));
      },
    });
    const streamRequestInit: RequestInit & { readonly duplex: "half" } = {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1:3938" },
      body: failedBody,
      duplex: "half",
    };
    const readFailed = await h.app.request(new Request(
      "http://127.0.0.1:3938/api/v1/preflight/rerun",
      streamRequestInit,
    ));
    assert.equal(readFailed.status, 400);
    assert.equal((await json(readFailed)).code, "PREFLIGHT_BODY_READ_FAILED");
  });

  it("refuses a preflight rerun body beyond its strict byte limit", async () => {
    const h = harness();
    const response = await h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1:3938" },
      body: JSON.stringify({ padding: "x".repeat(4096) }),
    });

    assert.equal(response.status, 413);
    assert.equal((await json(response)).code, "PREFLIGHT_BODY_TOO_LARGE");
  });

  it("rate-bounds preflight rerun starts within one monotonic window", async () => {
    const h = harness();
    const request = (index: number) => h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1:3938" },
      body: JSON.stringify({
        commandId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "local-operator",
        source: "settings-surface",
        type: "rerun-preflight",
        target: { expectedConfigFingerprint: HASH_B },
      }),
    });

    for (let index = 20; index < 26; index += 1) assert.equal((await request(index)).status, 200);
    const refused = await request(26);
    assert.equal(refused.status, 429);
    assert.equal((await json(refused)).code, "PREFLIGHT_RATE_LIMITED");
  });

  it("admits only one preflight rerun while detector work is active", async () => {
    let release = (): void => undefined;
    let markStarted = (): void => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const h = harness({ preflightBeforeRun: async () => {
      markStarted();
      await gate;
    } });
    const request = (commandId: string) => h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1:3938" },
      body: JSON.stringify({
        commandId,
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "local-operator",
        source: "settings-surface",
        type: "rerun-preflight",
        target: { expectedConfigFingerprint: HASH_B },
      }),
    });

    const firstPending = request("00000000-0000-4000-8000-000000000030");
    await started;
    const secondPending = request("00000000-0000-4000-8000-000000000031");
    release();
    const [first, second] = await Promise.all([firstPending, secondPending]);

    assert.equal(first.status, 200);
    assert.equal(second.status, 429);
    assert.equal((await json(second)).code, "PREFLIGHT_RERUN_ACTIVE");
  });

  it("keeps rerun admission held after deadlines until all detector callbacks actually settle", async () => {
    const deadlines = new Set<() => void>();
    const began = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const h = harness({
      preflightScheduler: {
        schedule(_at, onDeadline) {
          deadlines.add(onDeadline);
          return { cancel: () => { deadlines.delete(onDeadline); } };
        },
      },
      preflightBeforeRun: async () => { began.resolve(); await release.promise; },
    });
    const request = (suffix: string) => h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1:3938" },
      body: JSON.stringify({
        commandId: `00000000-0000-4000-8000-0000000000${suffix}`,
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "local-operator", source: "settings-surface", type: "rerun-preflight",
        target: { expectedConfigFingerprint: HASH_B },
      }),
    });
    const first = Promise.resolve(request("40"));
    await began.promise;
    assert.equal(deadlines.size, requiredPreflightChecks(["dashboard.serve"]).length);
    for (const deadline of deadlines) deadline();
    let settled = false;
    void first.then(() => { settled = true; }, () => { settled = true; });
    const refused = await request("41");
    assert.equal(refused.status, 429);
    assert.equal((await json(refused)).code, "PREFLIGHT_RERUN_ACTIVE");
    assert.equal(settled, false);
    release.resolve();
    assert.equal((await first).status, 500, "late healthy returns cannot publish a report");
    assert.equal(deadlines.size, 0);
    assert.equal((await request("42")).status, 200, "actual settlement releases admission");
  });

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

  it("serves the exact comparison through createDashboardApp and the typed client", async () => {
    const [prior, current] = comparisonRunPair();
    const priorReceipt = comparisonReceipt(prior, "4502");
    const currentReceipt = comparisonReceipt(current, "4537");
    const runs = new Map<string, RunRecord>([
      [prior.envelope.runId, prior],
      [current.envelope.runId, current],
    ]);
    const receipts = new Map<string, readonly RunEvidenceReceipt[]>([
      [prior.envelope.runId, [priorReceipt]],
      [current.envelope.runId, [currentReceipt]],
    ]);
    const served = harness({
      receiptComparison: {
        registry: COMPARISON_REGISTRY,
        authority: {
          getRun: (runId) => runs.get(runId),
          listReceiptsByRun: (runId) => receipts.get(runId) ?? [],
        },
      },
    });
    const servedClient = createDashboardClient({
      baseUrl: "http://bff.test",
      fetchImpl: async (input, init) => served.app.request(input, init),
    });
    const comparisonTarget = {
      runId: current.envelope.runId,
      retryOf: prior.envelope.runId,
      workflowId: current.envelope.workflow,
      currentReceiptId: currentReceipt.receiptId,
    };

    assert.deepEqual(await servedClient.runReceiptComparison(comparisonTarget), {
      wireVersion: 1,
      runId: current.envelope.runId,
      retryOf: prior.envelope.runId,
      workflowId: "separations",
      currentReceiptId: currentReceipt.receiptId,
      priorReceiptId: priorReceipt.receiptId,
      facts: [{
        state: "changed",
        factId: "separations.action.document-number",
        label: "Document number",
        before: "4502",
        after: "4537",
      }],
    });

    await assert.rejects(
      servedClient.runReceiptComparison({ ...comparisonTarget, runId: RunIdSchema.parse(uuidOf(9991)) }),
      (error: unknown) => error instanceof DashboardClientError
        && error.status === 404
        && error.code === "TARGET_NOT_FOUND",
    );

    const unavailable = harness();
    const unavailableClient = createDashboardClient({
      baseUrl: "http://bff.test",
      fetchImpl: async (input, init) => unavailable.app.request(input, init),
    });
    await assert.rejects(
      unavailableClient.runReceiptComparison(comparisonTarget),
      (error: unknown) => error instanceof DashboardClientError
        && error.status === 409
        && error.code === "SECTION_UNAVAILABLE",
    );

    const refused = harness({
      receiptComparison: {
        registry: COMPARISON_REGISTRY,
        authority: {
          getRun: (runId) => runs.get(runId),
          listReceiptsByRun: (runId) => runId === current.envelope.runId ? [] : [priorReceipt],
        },
      },
    });
    const refusedClient = createDashboardClient({
      baseUrl: "http://bff.test",
      fetchImpl: async (input, init) => refused.app.request(input, init),
    });
    await assert.rejects(
      refusedClient.runReceiptComparison(comparisonTarget),
      (error: unknown) => error instanceof DashboardClientError
        && error.status === 409
        && error.code === "COMPARISON_IDENTITY_REFUSED",
    );

    const broken = harness({
      receiptComparison: {
        registry: COMPARISON_REGISTRY,
        authority: {
          getRun: (runId) => runs.get(runId),
          listReceiptsByRun: () => {
            throw new Error("receipt database read exploded");
          },
        },
      },
    });
    const brokenClient = createDashboardClient({
      baseUrl: "http://bff.test",
      fetchImpl: async (input, init) => broken.app.request(input, init),
    });
    await assert.rejects(
      brokenClient.runReceiptComparison(comparisonTarget),
      (error: unknown) => error instanceof DashboardClientError
        && error.status === 500
        && error.code === "INTERNAL_FAILURE",
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
        requestedBy: "local-operator",
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
      requestedBy: "local-operator",
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

    const accepted = h.database.authority.commands.get(commandId);
    const generationBeforeMismatch = h.database.getMeta().authorityGeneration;
    const mismatchedReplay = await h.app.request("http://localhost/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({ ...command, requestedBy: "other-operator" }),
    });
    assert.equal(mismatchedReplay.status, 403);
    assert.equal((await json(mismatchedReplay)).code, "REQUEST_IDENTITY_REFUSED");
    assert.deepEqual(h.database.authority.commands.get(commandId), accepted);
    assert.equal(h.database.getMeta().authorityGeneration, generationBeforeMismatch);
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
      requestedBy: "local-operator",
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

  it("refuses a command whose requested actor disagrees with BFF admission before authority changes", async () => {
    const h = harness();
    const commandId = "00000000-0000-4000-8000-000000000095";
    const patch = { display: { screenWidth: 1980 } };

    const response = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        commandId,
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "other-operator",
        source: "settings-surface",
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

    assert.equal(response.status, 403);
    assert.equal((await json(response)).code, "REQUEST_IDENTITY_REFUSED");
    assert.equal(h.database.authority.commands.get(commandId), undefined);

    const preflightResponse = await h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        commandId: "00000000-0000-4000-8000-000000000096",
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "other-operator",
        source: "settings-surface",
        type: "rerun-preflight",
        target: {
          expectedConfigFingerprint: "a".repeat(64),
          expectedDescriptorFingerprint: "b".repeat(64),
        },
      }),
    });
    assert.equal(preflightResponse.status, 403);
    assert.equal((await json(preflightResponse)).code, "REQUEST_IDENTITY_REFUSED");

    const bulkResponse = await h.app.request("/api/v1/commands/bulk", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        commandId: "00000000-0000-4000-8000-000000000097",
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "other-operator",
        source: "queue",
        family: "run",
        type: "cancel",
        bulkCommandId: "00000000-0000-4000-8000-000000000097",
        targets: [{ runId: UUID_4, expectedVersion: 1 }],
        mode: "best-effort",
      }),
    });
    assert.equal(bulkResponse.status, 403);
    assert.equal((await json(bulkResponse)).code, "REQUEST_IDENTITY_REFUSED");
  });

  it("crosses one request-identity checkpoint on every registered route and refuses before effects", async () => {
    let checkpointCalls = 0;
    const h = harness({
      requestIdentity: {
        identify: () => {
          checkpointCalls += 1;
          throw new RequestIdentityRefusedError("the request identity checkpoint refused this caller");
        },
      },
    });
    const generationBefore = h.database.getMeta().authorityGeneration;
    const materializePath = (path: string): string => path.replaceAll(/:[^/]+/gu, UUID_4);
    const routes = h.app.routes.filter((route) => route.method !== "ALL");

    assert.ok(routes.length > 0);
    for (const route of routes) {
      checkpointCalls = 0;
      const response = await h.app.request(materializePath(route.path), {
        method: route.method,
        ...(route.method === "GET" || route.method === "HEAD"
          ? {}
          : { headers: { "content-type": "application/json" }, body: "{}" }),
      });
      assert.equal(response.status, 403, `${route.method} ${route.path}`);
      assert.equal(checkpointCalls, 1, `${route.method} ${route.path}`);
      assert.equal((await json(response)).code, "REQUEST_IDENTITY_REFUSED");
    }

    checkpointCalls = 0;
    const unknownResponse = await h.app.request("/api/v1/not-registered");
    assert.equal(unknownResponse.status, 403);
    assert.equal(checkpointCalls, 1);
    assert.equal((await json(unknownResponse)).code, "REQUEST_IDENTITY_REFUSED");

    assert.equal(h.database.getMeta().authorityGeneration, generationBefore);
    const artifactRoot = join(h.stateRoot, "artifacts");
    assert.deepEqual(existsSync(artifactRoot) ? readdirSync(artifactRoot) : [], []);
    const inspection = new DatabaseSync(join(h.stateRoot, "..", "state.db"), { readOnly: true });
    try {
      const row = inspection.prepare("SELECT count(*) AS count FROM operator_xlsx_exports").get();
      assert.equal(Reflect.get(row ?? {}, "count"), 0);
    } finally {
      inspection.close();
    }
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
      state: "unavailable",
      cause: {
        code: "span-stream-invalid",
        summary: "span corpus parent .tracker-rebuild could not be inspected (ENOENT)",
      },
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

  it("serves a sanitized span-stream structural diagnosis through the real storage doctor", async () => {
    const h = harness();
    const run = RunRecordSchema.parse(personLookupQueuedRun({ runId: RUN_ID }));
    h.database.authority.runs.enqueue(run);
    createSpanJsonlWriter({ stateRoot: h.stateRoot, clock: h.clock, pid: 4242 }).emit({
      t: "run.queued",
      kind: "run",
      ts: run.envelope.enqueuedAt,
      workflow: run.envelope.workflow,
      runId: run.envelope.runId,
      attempt: run.envelope.attempt,
      traceId: run.envelope.traceId,
      spanPath: `${run.envelope.traceId}/foreign-root`,
      itemId: run.envelope.itemId,
      shape: run.envelope.shape,
      priority: run.envelope.priority,
      dryRun: run.envelope.dryRun,
      actorId: "local-operator",
      title: "malformed root path fixture",
      descriptorVersion: run.envelope.descriptorVersion,
      contractFingerprint: run.envelope.contractFingerprint,
      resolvedInstance: run.envelope.resolvedInstance,
      configFingerprint: run.envelope.configFingerprint,
      configSnapshotId: run.envelope.configSnapshotId,
    });

    const response = await h.app.request("/api/v1/storage/doctor");

    assert.equal(response.status, 200);
    const report = StorageDoctorWireSchema.parse(await response.json());
    assert.equal(report.spanAuthority.state, "degraded");
    if (report.spanAuthority.state !== "degraded") throw new Error("span structural corruption must degrade the doctor wire");
    assert.deepEqual(report.spanAuthority.problems, [{
      state: "malformed",
      runId: run.envelope.runId,
      table: "span_stream",
      summary: "run.queued root spanPath does not equal traceId",
    }]);
  });

  it("reruns preflight through the closed read-only command and returns the exact report", async () => {
    const h = harness();
    const response = await h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1:3938" },
      body: JSON.stringify({
        commandId: "00000000-0000-4000-8000-000000000091",
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "local-operator",
        source: "settings-surface",
        type: "rerun-preflight",
        target: {
          expectedConfigFingerprint: HASH_B,
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

  it("serves one dedicated XLSX download only after its exact evidence is durable", async () => {
    const h = harness();

    const response = await h.app.request("/api/v1/exports/xlsx", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ selection: { kind: "activity", from: DAY, to: DAY } }),
    });

    assert.equal(response.status, 200);
    const exportId = response.headers.get("x-operator-export-id");
    assert.ok(exportId);
    const evidence = h.database.authority.operatorXlsxExports.get(exportId);
    assert.ok(evidence);
    assert.equal(evidence.workbookVersion, 2);
    assert.equal(evidence.requestedBy, "local-operator");
    assert.equal(response.headers.get("content-type"), evidence.download.mediaType);
    assert.equal(response.headers.get("content-disposition"), evidence.download.contentDisposition);
    assert.equal(response.headers.get("content-length"), String(evidence.download.byteLength));
    assert.equal(response.headers.get("etag"), `"${evidence.download.sha256}"`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.byteLength, evidence.download.byteLength);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), evidence.download.sha256);

    const genericRead = await h.app.request(`/artifacts/v1/${evidence.artifact.id}`);
    assert.equal(genericRead.status, 404);

    const malformed = await h.app.request("/api/v1/exports/xlsx", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ selection: { kind: "activity", from: DAY, to: DAY, latest: true } }),
    });
    assert.equal(malformed.status, 400);
    assert.equal((await json(malformed)).code, "SCHEMA_INVALID");

    const smuggledActor = await h.app.request("/api/v1/exports/xlsx", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestedBy: "other-operator",
        selection: { kind: "activity", from: DAY, to: DAY },
      }),
    });
    assert.equal(smuggledActor.status, 400);
    assert.equal((await json(smuggledActor)).code, "SCHEMA_INVALID");
  });

  it("exports every page of one real signed cross-date search selection as evidenced XLSX", async () => {
    const h = harness();
    insertMeasuredSearchRun(h.database, { seed: 201, enqueuedAt: "2026-08-28T15:00:00.000Z" });
    insertMeasuredSearchRun(h.database, { seed: 202, enqueuedAt: "2026-08-28T14:00:00.000Z" });

    const firstSearch = await h.app.request("/api/v1/search?q=separations&scope=workflow&limit=1");
    assert.equal(firstSearch.status, 200);
    const selectionPage = CrossDateSearchPageSchema.parse(await firstSearch.json());
    assert.equal(selectionPage.totalMatches, 2);
    assert.equal(selectionPage.results.length, 1);
    assert.equal(selectionPage.nextCursor.state, "present");

    const response = await h.app.request("/api/v1/exports/xlsx", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        selection: {
          kind: "search",
          query: { q: "separations", scope: "workflow", facets: {}, limit: 1 },
          snapshot: selectionPage.snapshot,
        },
      }),
    });

    assert.equal(response.status, 200);
    const exportId = response.headers.get("x-operator-export-id");
    assert.ok(exportId);
    const evidence = h.database.authority.operatorXlsxExports.get(exportId);
    assert.ok(evidence);
    assert.equal(evidence.workbookVersion, 2);
    assert.equal(evidence.requestedBy, "local-operator");
    assert.equal(evidence.selection.kind, "search");
    assert.equal(evidence.workbook.rowCount, 2);
    assert.equal(response.headers.get("content-type"), evidence.download.mediaType);
    assert.equal(response.headers.get("content-length"), String(evidence.download.byteLength));
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(createHash("sha256").update(bytes).digest("hex"), evidence.download.sha256);
    const workbook = await readXlsxFile(bytes);
    assert.deepEqual(workbook.map(({ sheet }) => sheet), ["Read Me", "Runs"]);
    assert.equal(workbook[1]?.data.length, 3);
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
      requestedBy: "local-operator",
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
