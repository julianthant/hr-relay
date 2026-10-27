import { createNotificationCompositionTestWorld } from "../../../../support/helpers/backend/notification-composition-world.js";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createNotificationHealthObserver, readNotificationHealth } from "../../../../../src/backend/app/composition/dashboard/notification-health.js";
import { AuthorityBackupService, syntheticStateRoot } from "../../../../support/helpers/synthetic-storage-admission.js";

const { fixture } = createNotificationCompositionTestWorld();

describe("canonical notification producers", () => {
  it("reads actual backup verification, accepts stale generations, and never creates a backup", async () => {
    const f = await fixture();
    try {
      const read = () => readNotificationHealth({ admission: syntheticStateRoot(f.root), database: f.db, reader: f.reader, stateRoot: f.root, clock: f.clock });
      expect((await read()).backupFailed).toBe(false); expect((await read()).integrityFailed).toBe(false);
      const directory = join(f.root, "backups", "authority"); mkdirSync(directory, { recursive: true });
      const backup = new AuthorityBackupService(f.db, { directory }, f.clock);
      await backup.request({ trigger: "operator", requiredGeneration: f.db.getMeta().authorityGeneration });
      const files = readdirSync(directory);
      f.db.withAuthorityTransaction(repos => repos.notificationHealth.put({ concern: "disk-space", active: false, occurrence: 0, observedAt: f.clock.now().toISOString(), createdAt: f.clock.now().toISOString(), samples: [] }));
      expect((await read()).backupFailed).toBe(false); expect(readdirSync(directory)).toEqual(files);
      writeFileSync(join(directory, "corrupt.manifest.json"), "not a manifest");
      expect((await read()).backupFailed).toBe(true);
    } finally { await f.close(); }
  });
  it("observes real worker lease expiry strictly after sixty seconds", async () => {
    const f = await fixture();
    try {
      const lease = f.db.authority.workerLeases.get(f.db.authority.workerSlots.list("person-lookup")[0].workerId)!;
      expect(f.db.authority.workerLeases.reportLifecycle({ workerId: lease.workerId, leaseGeneration: lease.leaseGeneration,
        lifecycle: { state: "idle", startedAt: lease.lifecycle.startedAt, heartbeatAt: f.clock.now().toISOString() }, now: f.clock.now().toISOString() }).state).toBe("applied");
      const read = () => readNotificationHealth({ admission: syntheticStateRoot(f.root), database: f.db, reader: f.reader, stateRoot: f.root, clock: f.clock });
      f.clock.advanceWall(60_000); expect((await read()).leaseExpired).toBe(false);
      f.clock.advanceWall(1); expect((await read()).leaseExpired).toBe(true);
    } finally { await f.close(); }
  });
  it("persists health thresholds and clear/re-enter without treating absent backups or retired outbox as failures", async () => {
    const f = await fixture();
    try {
      const reading = { freeBytes: 2 * 1024 ** 3, walBytes: 256 * 1024 ** 2, integrityFailed: false, backupFailed: false, leaseExpired: false };
      const observe = () => createNotificationHealthObserver({ database: f.db, clock: f.clock, inbox: f.inbox, read: async () => reading })();
      await observe(); expect(f.inbox.list("local-operator")).toEqual([]);
      f.clock.advanceWall(60_000); reading.walBytes += 1; await observe(); expect(f.inbox.list("local-operator")).toEqual([]);
      f.clock.advanceWall(60_000); reading.walBytes += 1; await observe(); expect(f.inbox.list("local-operator")).toHaveLength(1);
      f.clock.advanceWall(60_000); reading.freeBytes = 1024 ** 3 - 1; reading.integrityFailed = true; reading.backupFailed = true; reading.leaseExpired = true; await observe();
      expect(f.inbox.list("local-operator")).toHaveLength(5);
      f.clock.advanceWall(60_000); reading.freeBytes = 1024 ** 3; await observe();
      f.clock.advanceWall(60_000); reading.freeBytes -= 1; await observe();
      expect(f.inbox.list("local-operator").find(row => row.title.includes("disk-space"))?.count).toBe(2);
      expect(f.db.authority.notificationHealth.get("outbox-stalled")).toBeUndefined();
    } finally { await f.close(); }
  });
});
