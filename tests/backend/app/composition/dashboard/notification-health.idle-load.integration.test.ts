import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ownedDiagnostics } from "../../../../../src/backend/app/composition/dashboard/notification-health.js";
import { createTrustNotifications } from "../../../../../src/backend/app/composition/dashboard/notifications.js";
import { GATE_PARK_WATCH_MS } from "../../../../../src/backend/app/composition/dashboard/timeline.js";
import { AuthorityDatabase } from "../../../../../src/backend/storage/sqlite/authority-database.js";
import * as backupInspection from "../../../../../src/backend/storage/sqlite/backup-inspection.js";
import * as canonicalRuns from "../../../../../src/backend/runs/queries/canonical-runs.js";
import { createDebugEventWriter } from "../../../../../src/backend/logs/debug-events.js";
import { RunRecordSchema } from "../../../../../src/models/run/record.js";
import { QUEUED_RUN, sequentialIdFactory } from "../../../../support/fixtures/phase1f-run-fixtures.js";
import { createNotificationCompositionTestWorld } from "../../../../support/helpers/backend/notification-composition-world.js";
import { AuthorityBackupService, syntheticStateRoot } from "../../../../support/helpers/synthetic-storage-admission.js";

const { fixture, seedRun } = createNotificationCompositionTestWorld();
const IDLE_MS = 10 * 60_000;
/** One source read, then one live-lease check per 60 s health pass. */
const IDLE = { wholeStore: 1, liveRunLists: 1 + (IDLE_MS / 60_000 + 1) };

/** Store reads the gate watch makes over an idle period on a store holding a queued run and `backups` verified backups, optionally logging an event-loop stall each minute. */
async function idleReads(backups: number, stalls = false): Promise<typeof IDLE> {
  const f = await fixture();
  try {
    seedRun(f, RunRecordSchema.parse(QUEUED_RUN));
    const directory = join(f.root, "backups", "authority"); mkdirSync(directory, { recursive: true });
    const service = new AuthorityBackupService(f.db, { directory }, f.clock);
    for (let index = 0; index < backups; index++) {
      f.db.withAuthorityTransaction(repos => repos.notificationHealth.put({ concern: "disk-space", active: false, occurrence: index,
        observedAt: f.clock.now().toISOString(), createdAt: f.clock.now().toISOString(), samples: [] }));
      await service.request({ trigger: "operator", requiredGeneration: f.db.getMeta().authorityGeneration });
      f.clock.advanceWall(1_000);
    }
    const stores = vi.spyOn(AuthorityDatabase, "inspectExistingReadOnly");
    const backupCopies = vi.spyOn(backupInspection, "inspectAuthorityBackupReadOnly");
    const liveRunLists = vi.spyOn(canonicalRuns, "listCanonicalRuns");
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
  it("costs the same bounded number of store reads over an idle period whatever the store holds", async () => {
    const small = await idleReads(1);
    const large = await idleReads(4);
    expect({ small, large }).toEqual({ small: IDLE, large: IDLE });
  });

  it("does not re-read the store because of its own event-loop stall lines", async () => {
    expect(await idleReads(1, true)).toEqual(IDLE);
  });
});
