import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { foundationFixture, id, HASH } from "../database-foundation/fixtures.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createOperatorProjection } from "../../../../src/backend/app/composition/dashboard/operator.js";
import { createTransactionHistory } from "../../../../src/backend/storage/sqlite/transaction-history.js";
import { queryQueueSummaries, queryActivitySummaries } from "../../../../src/backend/runs/queries/run-summaries.js";
import type { ServedSummaryQueries } from "../../../../src/backend/runs/projections/run-queue-projection.js";

export function summaryFixture() {
  const f = foundationFixture();
  const reader = new RunRecordService({ database: f.db, clock: f.clock, ids: { uuid: () => id(9901) }, publishQueued: () => {} });
  const ledger = createTransactionHistory(f.db.authority);
  const descriptors = { resolve: () => undefined };
  const summaries: ServedSummaryQueries = {
    itemAttempts: (day, items) => f.db.listQueueItemAttempts(day, items),
    withSnapshot: read => f.db.withAuthorityReadSnapshot(read),
    queue: query => queryQueueSummaries(f.db, query),
    activity: (from, to) => queryActivitySummaries(f.db, { from, to, generatedAt: f.clock.now().toISOString() }, { descriptors, ledger }),
  };
  const servedReader = { read: reader.read.bind(reader), list: reader.list.bind(reader), withRunTreeSnapshot: reader.withRunTreeSnapshot.bind(reader), summaries };
  const projection = createOperatorProjection({ database: f.db, stateRoot: f.root, clock: f.clock,
    appVersion: "0.1.0", descriptorSetHash: FingerprintSchema.parse(HASH), ledger, descriptors, reader: servedReader });
  return { ...f, reader, servedReader, projection, summaries, ledger };
}

