import { composeActivity } from "../../../src/server/dashboard/compose/activity.js";
import { createTransactionHistory } from "../../../src/infra/sqlite/transaction-history.js";
import type { DashboardAppDeps } from "../../../src/server/dashboard/routes/api-types.js";
import { createCalendarQuery } from "../../../src/server/dashboard/queries/calendar.js";
import { createProtectedSettingsRuntimeReader } from "../../../src/server/settings-runtime.js";
import { initialProtectedStoreRecord } from "../../../src/domain/config/protected-settings.js";
import { join } from "node:path";
import { createCommandKernel } from "../../../src/core/command-kernel.js";
import { RunRecordService } from "../../../src/core/run-record-service.js";
import type { Clock } from "../../../src/domain/clock.js";
import { hostConfigFacts } from "../../../src/domain/config/host-display.js";
import { resolveConfigWithProvenance } from "../../../src/domain/config/resolve.js";
import { initialSettingsFileRecord,settingsRuntimeIdentity } from "../../../src/domain/config/settings.js";
import { ActorIdSchema as PublicationActorIdSchema } from "../../../src/domain/ids.js";
import { defineWorkflowRole } from "../../../src/domain/workflow/module-role.js";
import { createTimelineEmitter } from "../../../src/infra/events/timeline-emitter.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/index.js";
import { createDashboardCommandService } from "../../../src/server/dashboard/commands/command-service.js";
import { runQueuedSpanEvent } from "../../../src/server/dashboard/commands/run-queued-span.js";
import { createStartPlanService } from "../../../src/server/dashboard/commands/start-plan-service.js";
import { descriptorSetHash } from "../../../src/server/dashboard/compose.js";
import { createRunQueueProjection } from "../../../src/server/dashboard/projectors/run-queue-projection.js";
import { createCrossDateSearchService } from "../../../src/server/dashboard/queries/search.js";
import { createSoloRequestIdentityCheckpoint } from "../../../src/server/dashboard/request-identity.js";
import { createDashboardApp } from "../../../src/server/dashboard/routes/api.js";
import { createDashboardStreamHub } from "../../../src/server/dashboard/subscriptions/dashboard-stream.js";
import { createReceiptService } from "../../../src/server/trust/receipt-service.js";
import { archiveQueryDeps,archiveSnapshots } from "../../fixtures/archive-seams.js";
import { UNOBSERVED_BACKFILL_GAP_NOTIFIER } from "../../fixtures/dashboard-stream-seams.js";
import { explorerQueryDeps,uiCatalogQueryDeps } from "../../fixtures/explorer-seams.js";
import { NO_INTAKE_PROJECTIONS,UNSTORED_CONFIG_IDENTITY,UNWIRED_INTAKE_PARSER,UNWIRED_INTAKE_SERVICE } from "../../fixtures/intake-kernel-seams.js";
import { sequentialIdFactory } from "../../fixtures/phase1f-run-fixtures.js";
import { healthyDashboardPreflightExecutor,healthyDashboardPreflightReport } from "../../fixtures/preflight-seams.js";
import { sqliteRunReader } from "../../helpers/canonical-run-reader.js";
import { personLookupDescriptor } from "../../helpers/registered-workflows.js";
import { CONFIG_FINGERPRINT,CONFIG_SNAPSHOT_ID,CONTRACT_FINGERPRINT,SEEDED_APP_VERSION } from "./seeded-identity.js";
import { uuidOf } from "./seeded-lifecycle.js";
/** Real service composition; HTTP lifetime and disposable authority custody stay with the caller. */
export function composeSeededServices({ database, clock, stateRoot, root, projection, spans, descriptors, runIds, selectionServices }: {
 selectionServices?: Pick<DashboardAppDeps,"activity"|"search"|"xlsxExports"|"searchMetadataExports">;
 database: AuthorityDatabase; clock: Clock; stateRoot: string; root: string;
 projection: ReturnType<typeof createRunQueueProjection>; spans: ReturnType<typeof createTimelineEmitter>;
 descriptors: {resolve: (workflowId: string) => typeof personLookupDescriptor | undefined}; runIds: Record<string,string>;
}) {
  const trust = createReceiptService({ database, runReader: sqliteRunReader(database, clock), descriptors: [personLookupDescriptor] });

  /**
   * THE DONE RUN'S EVIDENCE RECEIPT IS PART OF THE SEED, not a side effect of
   * whoever loaded a page first.
   *
   * The queue row's D7 outcome chips come from `#facts` in
   * `run-queue-projection.ts`, which looks a receipt UP (`getReceipt`) and never
   * derives one — D141 makes derivation an act that writes an authority row, and
   * a projection may not write. The only thing that derives one here is the
   * panel's own `GET /api/v1/runs/:runId/receipt`, and that request lands AFTER
   * the day snapshot `/events/v1` built for the page it is opening. So without
   * this line the row's chips depend on whether an EARLIER page load against
   * this same server happened to derive the receipt first, and the seeded server
   * lives for a whole Playwright worker — which Playwright replaces after any
   * failed test. That is exactly how the corpus came to hold two references for
   * ONE state that disagree: `run-receipt-populated--graphite-warm` (captured
   * first, on a cold server) records the row with no chips, and
   * `--paper-ink` (captured second, on the warm one) records them.
   *
   * Deriving it here through the production `ReceiptService` — the same thing
   * `tests/perf/dashboard-fixture.ts` does — makes the state determinate and
   * matches what the state CLAIMS to be: a run whose receipt is populated and on
   * screen. The assertion is the point: a seed that silently produced a
   * receipt with no output facts would photograph an empty row and call it a
   * populated receipt.
   */
  const doneReceipt = trust.ensureReceipt(runIds.doneRun);
  if (doneReceipt.output.length === 0) {
    throw new Error(
      `the seeded done run ${runIds.doneRun} derived an evidence receipt with no output fact; `
      + "the run-receipt-populated state photographs a queue row that states what the run produced",
    );
  }

  const runDetailDeps = { runReader: sqliteRunReader(database, clock),
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
      resolve: (workflowId: string) =>
        (workflowId === personLookupDescriptor.id ? personLookupDescriptor : undefined),
    },
    canonical: {
      reader: sqliteRunReader(database, clock),
      database,
      descriptors: {
        resolve: (workflowId: string) =>
          (workflowId === personLookupDescriptor.id ? personLookupDescriptor : undefined),
      },
    },
    trust,
  };

  const kernel = createCommandKernel({
    lifecycle: new RunRecordService({ database: database, clock: clock, ids: sequentialIdFactory("e"), publishQueued: (run, publication) => {
      if (publication === undefined) throw new Error("command-created run lacks queue presentation");
      spans.emit(runQueuedSpanEvent({ run, ...publication, actorId: PublicationActorIdSchema.parse(publication.actorId) }));
    } }),
    appVersion: SEEDED_APP_VERSION,
    archiveSnapshots: archiveSnapshots(runDetailDeps),
    configIdentity: UNSTORED_CONFIG_IDENTITY,
    intakeParser: UNWIRED_INTAKE_PARSER,
    intakeProjections: NO_INTAKE_PROJECTIONS,
    authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
    clock,
    ids: { uuid: () => uuidOf(7000) },
    descriptors,
    writeResolution: {
      resolvePresent: () => {
        throw new Error("write resolution is not wired in the parity seed");
      },
      resolveAbsent: () => {
        throw new Error("write resolution is not wired in the parity seed");
      },
    },
    workerRuntime: {
      planWorkerCount: () => ({ state: "accepted", workerIds: ["person-lookup-worker-1"] }),
      spawnWorker: () => ({ state: "accepted" }),
      refreshBrowser: () => ({ state: "accepted" }),
      reopenBrowser: () => ({ state: "accepted" }),
    },
  });
  const commands = createDashboardCommandService({ kernel, projection });
  const startPlans = createStartPlanService({
    authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
    authorityRead: database,
    descriptors,
    clock,
    ids: { uuid: () => uuidOf(8000) },
    planTtlMs: 10 * 60 * 1000,
    configFingerprint: CONFIG_FINGERPRINT,
    configSnapshotId: CONFIG_SNAPSHOT_ID,
    plannedBy: "local-operator",
  });
  const hub = createDashboardStreamHub({ projection, backfillGaps: UNOBSERVED_BACKFILL_GAP_NOTIFIER });

  const app = createDashboardApp({
    requestIdentity: createSoloRequestIdentityCheckpoint({
      id: "local-operator",
      label: "Local operator",
    }),
    intake: UNWIRED_INTAKE_SERVICE,
    commandJournal: database.authority.commands,
    protectedCommandAcceptedAt: () => { throw new Error("seeded BFF has no credential command authority"); },
    bulkCommandAcceptances: {
      withTransaction: (work) => database.withAuthorityTransaction((repositories) =>
        work({ get: repositories.commands.getBulk, insert: repositories.commands.acceptBulk })),
    },
    preflight: healthyDashboardPreflightExecutor(clock),
    bootstrap: {
      appVersion: SEEDED_APP_VERSION,
      clock,
      // D219 — the bootstrap document is built from MODULE views now, because
      // the served `role` is the module's declaration. This harness serves the
      // one standalone workflow the parity corpus runs.
      modules: [{ descriptor: personLookupDescriptor, role: defineWorkflowRole({ kind: "standalone" }) }],
      descriptorSetHash: descriptorSetHash([CONTRACT_FINGERPRINT]),
      settingsSchemaHash: descriptorSetHash(["settings-schema"]),
      projection,
      authorityMeta: () => database.getMeta(),
      // The seeded adapter runs no backup lane; "missing" is its true state.
      backupSummary: () => "missing",
      preflightReport: () => healthyDashboardPreflightReport(clock),
      // The parity corpus never composes a provider (D178): a reference must
      // not depend on a key being present in the environment that captured it.
      advisoryAvailability: () => ({
        state: "unavailable",
        code: "not-configured",
        reason: "no ai.advisory provider is composed in this harness",
      }),
    },
    projection,
    calendar: createCalendarQuery(database, clock),
    search: createCrossDateSearchService({
      clock,
      sourceIdentity: database.getSourceDatabaseIdentity(),
      cursorSigningKey: new Uint8Array(32).fill(0x50),
      descriptors,
      authority: {
        readSnapshot: (read) => database.withAuthorityReadSnapshot(() => read({
          authorityGeneration: database.getMeta().authorityGeneration,
          searchRuns: (input) => database.authority.runs.search(input),
        })),
      },
    }),
    activity:composeActivity({database,clock,descriptors,ledger:createTransactionHistory(database.authority)}),
    ...selectionServices,
    runDetail: runDetailDeps,
    archive: archiveQueryDeps({
      database,
      clock,
      appVersion: SEEDED_APP_VERSION,
      descriptors: [personLookupDescriptor],
    }),
    commands,
    startPlans,
    hub,
    // D274 item 6 — the read-only Settings status sections read the SAME
    // resolved config and descriptor tuple this harness composes everything else
    // from, so nothing on that page can be true here and false in production.
    settings: { config: resolveConfigWithProvenance({}, hostConfigFacts({}), clock).config, descriptors: [personLookupDescriptor] },
    settingsEditor: {
      protectedSettings: createProtectedSettingsRuntimeReader({ read: initialProtectedStoreRecord }),
      settings: {
        read: () => {
          const record = initialSettingsFileRecord();
          return { record, runtimeStatus: { state: "current", identity: settingsRuntimeIdentity(record, resolveConfigWithProvenance({}, hostConfigFacts({}), clock).fingerprint) } };
        },
      },
      environment: {},
      clock,
    },
    storage: {
      doctorOptions: {
        stateRootTrustAnchor: root,
        stateRoot,
        // The seeded database lives at the temp ROOT, not under stateRoot.
        authorityPath: join(root, "authority.sqlite"),
        backupDirectory: join(stateRoot, "backups", "authority"),
        maxBackupAgeMs: 45 * 60 * 1000,
        busyTimeoutMs: 1000,
      },
      clock,
      serviceState: () => ({
        state: "never-run",
        reason: "the seeded adapter runs no backup lane",
      }),
    },
    explorer: explorerQueryDeps(clock, descriptorSetHash([CONTRACT_FINGERPRINT])),
    uiCatalog: uiCatalogQueryDeps(),
  });


return { app, hub };
}
