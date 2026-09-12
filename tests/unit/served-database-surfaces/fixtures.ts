import { FingerprintSchema } from "../../../src/domain/ids.js";
import { foundationFixture, id, HASH } from "../database-foundation/fixtures.js";
import { RunRecordService } from "../../../src/core/run-record-service.js";
import { createOperatorProjection } from "../../../src/server/dashboard/compose/operator.js";
import { createTransactionHistory } from "../../../src/infra/sqlite/transaction-history.js";
import { queryQueueSummaries, queryActivitySummaries } from "../../../src/server/dashboard/queries/run-summaries.js";
import type { ServedSummaryQueries } from "../../../src/server/dashboard/projectors/run-queue-projection.js";

export function summaryFixture() {
  const f = foundationFixture();
  const reader = new RunRecordService({ database: f.db, clock: f.clock, ids: { uuid: () => id(9901) }, publishQueued: () => {} });
  const ledger = createTransactionHistory(f.db.authority);
  const descriptors = { resolve: () => undefined };
  const summaries: ServedSummaryQueries = {
    withSnapshot: read => f.db.withAuthorityReadSnapshot(read),
    queue: query => queryQueueSummaries(f.db, query),
    activity: (from, to) => queryActivitySummaries(f.db, { from, to, generatedAt: f.clock.now().toISOString() }, { descriptors, ledger }),
  };
  const servedReader = { read: reader.read.bind(reader), list: reader.list.bind(reader), summaries };
  const projection = createOperatorProjection({ database: f.db, stateRoot: f.root, clock: f.clock,
    appVersion: "0.1.0", descriptorSetHash: FingerprintSchema.parse(HASH), ledger, descriptors, reader: servedReader });
  f.db.refreshRunSummaries();
  return { ...f, reader, servedReader, projection, summaries, ledger };
}

import { archiveFixture } from "../archive-transfer/fixtures.js";
import { createRunLifecycleStorage } from "../../../src/core/run-lifecycle-storage.js";
import { createDashboardApp, type DashboardAppDeps } from "../../../src/server/dashboard/routes/api.js";
import { createSoloRequestIdentityCheckpoint } from "../../../src/server/dashboard/request-identity.js";
import { createDashboardCommandService } from "../../../src/server/dashboard/commands/command-service.js";
/** Real HTTP composition with deliberately absent current workflow/detail providers. */
export function savedHttpFixture() {
  const f = archiveFixture();
  const app = () => createDashboardApp({
    requestIdentity: createSoloRequestIdentityCheckpoint({ id: "local-operator", label: "Local operator" }),
    bootstrap: { clock: f.base.clock }, commandJournal: { get: () => undefined },
    protectedCommandAcceptedAt: () => undefined,
    bulkCommandAcceptances: { withTransaction: () => { throw new Error("unexpected-bulk-command"); } },
    intake: { prepare: async () => {} },
    commands: createDashboardCommandService({ kernel: f.kernel, versionChanges: createRunLifecycleStorage(f.database),
      projection: { ingestFromTimeline() { throw new Error("archive-command-ingested-timeline"); }, refreshRun() { throw new Error("archive-command-refreshed-run"); } } }),
    archive: { storage: createRunLifecycleStorage(f.database),
      reader: new RunRecordService({ database: f.database, clock: f.base.clock,
        ids: { uuid: () => { throw new Error("read-allocated-id"); } }, publishQueued: () => { throw new Error("read-published-run"); } }),
      clock: f.base.clock, appVersion: "0.1.0", descriptors: { list: () => [] },
      get authority() { throw new Error("saved-report-read-old-mirror"); },
      get ledger() { throw new Error("saved-report-read-live-ledger"); },
    },
    get runDetail() { throw new Error("saved-report-read-live-detail"); },
  } as unknown as DashboardAppDeps);
  return { ...f, get database() { return f.database; }, get kernel() { return f.kernel; }, app };
}
