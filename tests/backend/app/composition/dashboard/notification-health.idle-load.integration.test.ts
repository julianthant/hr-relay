import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ownedDiagnostics } from "../../../../../src/backend/app/composition/dashboard/notification-health.js";
import { createTrustNotifications } from "../../../../../src/backend/app/composition/dashboard/notifications.js";
import { GATE_PARK_WATCH_MS } from "../../../../../src/backend/app/composition/dashboard/timeline.js";
import * as authorityInspection from "../../../../../src/backend/storage/sqlite/authority-inspection-off-thread.js";
import { inspectOpenDatabase } from "../../../../../src/backend/storage/sqlite/backup-inspection.js";
import * as backupInspectionWorker from "../../../../../src/backend/storage/sqlite/backup-inspection-worker.js";
import { withReadonlyAuthoritySnapshot } from "../../../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";
import { createDebugEventWriter } from "../../../../../src/backend/logs/debug-events.js";
import { RunRecordSchema } from "../../../../../src/models/run/record.js";
import { QUEUED_RUN, sequentialIdFactory } from "../../../../support/fixtures/phase1f-run-fixtures.js";
import { createNotificationCompositionTestWorld } from "../../../../support/helpers/backend/notification-composition-world.js";
import { AuthorityBackupService, syntheticStateRoot } from "../../../../support/helpers/synthetic-storage-admission.js";

const { fixture, seedRun } = createNotificationCompositionTestWorld();
const IDLE_MS = 10 * 60_000;
/** The first pass reads the store once for integrity, each backup once, and the runs once each for notification sources and live-run leases; idle passes after it read nothing. */
const idle = (backups: number) => ({ wholeStore: 1 + backups, liveRunLists: 2 });

/** Store reads the gate watch makes over an idle period on a store holding a queued run and `backups` verified backups, optionally logging an event-loop stall each minute. */
async function idleReads(backups: number, stalls = false): Promise<ReturnType<typeof idle>> {
  const f = await fixture();
  try {
    seedRun(f, RunRecordSchema.parse(QUEUED_RUN));
    const directory = join(f.root, "backups", "authority"); mkdirSync(directory, { recursive: true });
    const service = new AuthorityBackupService(f.db, { directory }, f.clock);
    for (let index = 0; index < backups; index++) {
      f.db.withAuthorityTransaction(repos => repos.notificationHealth.put({ concern: "disk-space", active: false, occurrence: index,
        observedAt: f.clock.now().toISOString(), createdAt: f.clock.now().toISOString(), samples: [] }));
      await service.request({ trigger: "schema-migration", requiredGeneration: f.db.getMeta().authorityGeneration });
      f.clock.advanceWall(1_000);
    }
    // Counted through the synchronous inspection: the worker thread start is not what this measures.
    const stores = vi.spyOn(authorityInspection, "inspectAuthorityOffThread").mockImplementation(async (_admission, path) =>
      withReadonlyAuthoritySnapshot(path, database => inspectOpenDatabase(database)));
    const backupCopies = vi.spyOn(backupInspectionWorker, "inspectAuthorityBackupOffThread");
    const liveRunLists = vi.spyOn(f.reader, "list");
    try {
      const { observer } = createTrustNotifications({ admission: syntheticStateRoot(f.root), database: f.db, clock: f.clock,
        ids: sequentialIdFactory("idle"), reader: f.reader, stateRoot: f.root });
      const debugEvents = ownedDiagnostics(f.db, createDebugEventWriter({ repository: f.db.authority.timelineEvents, clock: f.clock, build: "test", development: false }));
      for (let elapsed = 0; elapsed <= IDLE_MS; elapsed += GATE_PARK_WATCH_MS) {
        if (stalls && elapsed % 60_000 === 0) debugEvents.emit({ category: "boot", phase: "settled", area: "event-loop", reason: "event-loop-stall", correlationId: `00000000-0000-4000-8000-${String(elapsed).padStart(12, "0")}`, durationMs: 250 });
        await observer.observe();
        f.clock.advanceWall(GATE_PARK_WATCH_MS);
      }
      await observer.stop();
      expect(observer.status().state).toBe("stopped");
      return { wholeStore: stores.mock.calls.length + backupCopies.mock.calls.length, liveRunLists: liveRunLists.mock.calls.length };
    } finally { stores.mockRestore(); backupCopies.mockRestore(); liveRunLists.mockRestore(); }
  } finally { await f.close(); }
}

describe("dashboard idle load", () => {
  it("reads the store and each backup once over an idle period, not once a minute", async () => {
    const small = await idleReads(1);
    const large = await idleReads(4);
    expect({ small, large }).toEqual({ small: idle(1), large: idle(4) });
  });

  it("does not re-read the store because of its own event-loop stall lines", async () => {
    expect(await idleReads(1, true)).toEqual(idle(1));
  });
});
