import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { composeActivity } from "../../../../src/backend/app/composition/dashboard/activity.js";
import { composeQueueSummaries } from "../../../../src/backend/app/composition/dashboard/queue-summaries.js";
import { createOperatorProjection } from "../../../../src/backend/app/composition/dashboard/queue.js";
import { runQueuedSpanEvent } from "../../../../src/backend/runs/commands/run-queued-span.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { importIsolatedProfileData } from "../../../../src/backend/storage/maintenance/isolated-library-import.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { createTransactionHistory } from "../../../../src/backend/storage/sqlite/transaction-history.js";
import { createDashboardStreamHub } from "../../../../src/backend/transports/http/subscriptions/dashboard-stream.js";
import { searchPartitionDay } from "../../../../src/models/dashboard/search-calendar.js";
import { ConfigSnapshotIdSchema, LOCAL_OPERATOR_ACTOR_ID } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { CONFIG_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { DESCRIPTOR_SET_HASH, runRecordOf } from "../../../support/helpers/backend/dashboard-harness.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { createBackupFixtures } from "../../../support/helpers/storage/backup-fixtures.js";

const clock = manualClock(new Date("2026-11-25T12:00:00.000Z"));
const day = searchPartitionDay(clock.now());
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanups.splice(0).reverse()) await close(); });
const { openCurrentWorld, takeBackup } = createBackupFixtures(cleanups, clock);

/** A copy that serves an imported archive, and a worker's own connection committing to the same store. */
async function importedCopy() {
  const source = await openCurrentWorld(), copy = await openCurrentWorld();
  const configSnapshotId = ConfigSnapshotIdSchema.parse(randomUUID());
  source.database.authority.runtimeConfig.initialize({ ...CONFIG_SNAPSHOT, configSnapshotId });
  copy.database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  const archived = runRecordOf({ seed: 884, enqueuedAt: clock.now().toISOString() });
  archived.envelope.configSnapshotId = configSnapshotId;
  source.database.authority.runs.enqueue(archived);
  createTimelineEmitter({ repository: source.database.authority.timelineEvents, clock })
    .emit(runQueuedSpanEvent({ run: archived, actorId: LOCAL_OPERATOR_ACTOR_ID, title: "Archived fixture" }));
  const backup = await takeBackup(source);
  await importIsolatedProfileData(copy.admission, copy.database, { source: { manifestPath: backup.manifestPath,
    binding: source.admission.profileBinding }, destination: copy.admission.profileBinding }, clock);
  const peer = AuthorityDatabase.open(copy.admission, { path: copy.authorityPath, busyTimeoutMs: 250, migrationOwner: "history-peer" },
    clock, undefined, undefined, undefined, copy.credentials);
  cleanups.push(() => { peer.close(); });
  let seed = 885;
  const commit = () => { peer.authority.runs.enqueue(runRecordOf({ seed: seed++, enqueuedAt: clock.now().toISOString() })); };
  return { copy, history: copy.database.dashboardHistory(), archivedId: archived.envelope.runId, commit };
}

it("opens the queue stream while a worker commits during its day read", async () => {
  const { copy, history, archivedId, commit } = await importedCopy();
  const descriptors = { resolve: () => personLookupDescriptor };
  const ledger = createTransactionHistory(history.authority);
  const { activity } = composeActivity({ database: history, clock, descriptors, ledger });
  const service = new RunRecordService({ database: history, clock, ids: { uuid: randomUUID }, publishQueued: () => {} });
  const reader = { read: service.read.bind(service), list: service.list.bind(service), withRunTreeSnapshot: service.withRunTreeSnapshot.bind(service),
    summaries: { ...composeQueueSummaries(history), queue(input: Parameters<ReturnType<typeof composeQueueSummaries>["queue"]>[0]) {
      commit(); commits += 1; return composeQueueSummaries(history).queue(input);
    }, activity: (from: string, to: string) => activity.read(from, to) } };
  let commits = 0;
  const projection = createOperatorProjection({ database: history, reader, clock, stateRoot: copy.stateRoot, appVersion: "0.1.0",
    descriptorSetHash: DESCRIPTOR_SET_HASH, descriptors, ledger });
  projection.rebuildFromTimeline();
  expect(projection.health().state).toBe("live");
  const hub = createDashboardStreamHub({ projection, backfillGaps: { detected: () => Promise.reject(new Error("unexpected-backfill-gap")) } });
  cleanups.push(() => { hub.close(); });

  const connection = await hub.connect({ day });

  expect(commits).toBeGreaterThan(0);
  const snapshot = connection.initial.find(envelope => envelope.type === "snapshot");
  expect(snapshot?.payload.queueSurfaces.map(row => row.runId)).toEqual([archivedId]);
  expect(history.authority.runs.listByWorkflow("person-lookup")).toHaveLength(1 + commits);
});

it("starts a history read over when a worker commits between opening its two snapshots", async () => {
  const { copy, history, commit } = await importedCopy();
  const getMeta = copy.database.getMeta.bind(copy.database);
  const commitAfter = () => { const meta = getMeta(); commit(); return meta; };
  const spy = vi.spyOn(copy.database, "getMeta").mockImplementationOnce(commitAfter);
  expect(history.withAuthorityReadSnapshot(() => history.authority.runs.listByWorkflow("person-lookup").length)).toBe(2);
  spy.mockImplementation(commitAfter);
  let reads = 0;
  expect(() => history.withAuthorityReadSnapshot(() => { reads += 1; })).toThrow("isolated-history-snapshot-changed");
  expect(reads).toBe(0);
  spy.mockRestore();
  expect(history.summaryWorkflows()).toEqual(["person-lookup"]);
});
