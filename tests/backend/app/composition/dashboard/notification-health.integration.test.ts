import { createNotificationCompositionTestWorld } from "../../../../support/helpers/backend/notification-composition-world.js";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { RunRecordSchema } from "../../../../../src/models/run/record.js";
import { QUEUED_RUN, sequentialIdFactory } from "../../../../support/fixtures/phase1f-run-fixtures.js";
import { createTrustNotifications } from "../../../../../src/backend/app/composition/dashboard/notifications.js";
import { describe, expect, it, vi } from "vitest";
import { createNotificationHealthObserver, readNotificationHealth } from "../../../../../src/backend/app/composition/dashboard/notification-health.js";
import { AuthorityDatabase } from "../../../../../src/backend/storage/sqlite/authority-database.js";
import * as backupInspection from "../../../../../src/backend/storage/sqlite/backup-inspection.js";
import * as backupInspectionWorker from "../../../../../src/backend/storage/sqlite/backup-inspection-worker.js";
import { parseBackupManifestFile } from "../../../../../src/backend/storage/sqlite/backup-service.js";
import { AuthorityBackupService, syntheticStateRoot } from "../../../../support/helpers/synthetic-storage-admission.js";
import { releaseSeededWriteOwners } from "../../../../support/helpers/timeline-write-fixture.js";

const { fixture, seedRun } = createNotificationCompositionTestWorld();

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
      const backupFile = join(directory, files.find(name => !name.endsWith(".manifest.json"))!), bytes = readFileSync(backupFile);
      bytes[bytes.length - 1] ^= 0xff; writeFileSync(backupFile, bytes);
      expect((await read()).backupFailed).toBe(true);
      bytes[bytes.length - 1] ^= 0xff; writeFileSync(backupFile, bytes);
      expect((await read()).backupFailed).toBe(false);
      writeFileSync(`${backupFile}-wal`, Buffer.alloc(4096, 1));
      expect((await read()).backupFailed).toBe(true);
      rmSync(`${backupFile}-wal`);
      expect((await read()).backupFailed).toBe(false);
      const manifestFile = join(directory, files.find(name => name.endsWith(".manifest.json"))!), manifestText = readFileSync(manifestFile, "utf8");
      const seeded = parseBackupManifestFile(manifestFile);
      writeFileSync(manifestFile, JSON.stringify({ ...seeded, pageCount: seeded.pageCount + 1, verification: { ...seeded.verification, pageCount: seeded.verification.pageCount + 1 } }));
      expect((await read()).backupFailed).toBe(true);
      writeFileSync(manifestFile, manifestText);
      expect((await read()).backupFailed).toBe(false);
      writeFileSync(join(directory, "corrupt.manifest.json"), "not a manifest");
      expect((await read()).backupFailed).toBe(true);
    } finally { await f.close(); }
  });

  it("inspects the store once while its change key is unchanged and again after a write", async () => {
    const f = await fixture();
    const inspect = vi.spyOn(AuthorityDatabase, "inspectExistingReadOnly");
    try {
      const read = () => readNotificationHealth({ admission: syntheticStateRoot(f.root), database: f.db, reader: f.reader, stateRoot: f.root, clock: f.clock });
      await read();
      await read();
      expect(inspect).toHaveBeenCalledTimes(1);
      f.db.withAuthorityTransaction(repos => repos.notificationHealth.put({ concern: "disk-space", active: false, occurrence: 0, observedAt: f.clock.now().toISOString(), createdAt: f.clock.now().toISOString(), samples: [] }));
      await read();
      expect(inspect).toHaveBeenCalledTimes(2);
    } finally { inspect.mockRestore(); await f.close(); }
  });

  it("inspects once across idle observations and again after an external commit or a store write", async () => {
    const f = await fixture();
    const inspect = vi.spyOn(AuthorityDatabase, "inspectExistingReadOnly");
    const other = new DatabaseSync(f.path);
    try {
      const observe = createNotificationHealthObserver({ database: f.db, clock: f.clock, inbox: f.inbox, read: () => readNotificationHealth({ admission: syntheticStateRoot(f.root), database: f.db, reader: f.reader, stateRoot: f.root, clock: f.clock }) });
      await observe();
      f.clock.advanceWall(60_000);
      await observe();
      expect(inspect).toHaveBeenCalledTimes(1);
      other.exec("CREATE TABLE external_probe(x); DROP TABLE external_probe");
      f.clock.advanceWall(60_000);
      await observe();
      expect(inspect).toHaveBeenCalledTimes(2);
      f.db.withAuthorityTransaction(repos => repos.notificationHealth.put({ concern: "disk-space", active: false, occurrence: 0, observedAt: f.clock.now().toISOString(), createdAt: f.clock.now().toISOString(), samples: [] }));
      f.clock.advanceWall(60_000);
      await observe();
      expect(inspect).toHaveBeenCalledTimes(3);
    } finally { inspect.mockRestore(); other.close(); await f.close(); }
  });
  it("inspects again after a peer connection commits right after the observer's own health write", async () => {
    const f = await fixture();
    const inspect = vi.spyOn(AuthorityDatabase, "inspectExistingReadOnly");
    const other = new DatabaseSync(f.path);
    try {
      const observe = createNotificationHealthObserver({ database: f.db, clock: f.clock, inbox: f.inbox, read: () => readNotificationHealth({ admission: syntheticStateRoot(f.root), database: f.db, reader: f.reader, stateRoot: f.root, clock: f.clock }) });
      await observe();
      expect(inspect).toHaveBeenCalledTimes(1);
      const transaction = f.db.withAuthorityTransaction.bind(f.db);
      let peerCommitted = false;
      const spy = vi.spyOn(f.db, "withAuthorityTransaction").mockImplementation((work: Parameters<typeof transaction>[0]) => {
        const result = transaction(work);
        if (!peerCommitted) { peerCommitted = true; other.exec("CREATE TABLE peer_probe(x); DROP TABLE peer_probe"); }
        return result;
      });
      f.clock.advanceWall(60_000);
      await observe();
      expect(peerCommitted).toBe(true);
      expect(inspect).toHaveBeenCalledTimes(1);
      spy.mockRestore();
      f.clock.advanceWall(60_000);
      await observe();
      expect(inspect).toHaveBeenCalledTimes(2);
    } finally { inspect.mockRestore(); other.close(); await f.close(); }
  });
  it("inspects again after an owner write lands while backup verification is suspended", async () => {
    const f = await fixture();
    const inspect = vi.spyOn(AuthorityDatabase, "inspectExistingReadOnly");
    try {
      const directory = join(f.root, "backups", "authority"); mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, "corrupt.manifest.json"), "not a manifest");
      const read = () => readNotificationHealth({ admission: syntheticStateRoot(f.root), database: f.db, reader: f.reader, stateRoot: f.root, clock: f.clock });
      const pending = read();
      f.db.withAuthorityTransaction(repos => repos.notificationHealth.put({ concern: "disk-space", active: false, occurrence: 0, observedAt: f.clock.now().toISOString(), createdAt: f.clock.now().toISOString(), samples: [] }));
      await pending;
      await read();
      expect(inspect).toHaveBeenCalledTimes(2);
      await read();
      expect(inspect).toHaveBeenCalledTimes(2);
    } finally { inspect.mockRestore(); await f.close(); }
  });
  it("inspects again after an owner write lands while inbox publication is suspended", async () => {
    const f = await fixture();
    const inspect = vi.spyOn(AuthorityDatabase, "inspectExistingReadOnly");
    const publish = f.inbox.publish.bind(f.inbox);
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let published = false;
    const inbox = { ...f.inbox, publish: async (...args: Parameters<typeof publish>) => {
      if (!published) {
        published = true;
        f.db.withAuthorityTransaction(repos => repos.notificationHealth.put({ concern: "backup", active: false, occurrence: 0, observedAt: f.clock.now().toISOString(), createdAt: f.clock.now().toISOString(), samples: [] }));
        await gate;
      }
      return publish(...args);
    } };
    try {
      const observe = createNotificationHealthObserver({ database: f.db, clock: f.clock, inbox, read: async () => ({ ...(await readNotificationHealth({ admission: syntheticStateRoot(f.root), database: f.db, reader: f.reader, stateRoot: f.root, clock: f.clock })), freeBytes: 0 }) });
      const pending = observe();
      release();
      await pending;
      expect(inspect).toHaveBeenCalledTimes(1);
      f.clock.advanceWall(60_000);
      await observe();
      expect(inspect).toHaveBeenCalledTimes(2);
      f.clock.advanceWall(60_000);
      await observe();
      expect(inspect).toHaveBeenCalledTimes(2);
    } finally { inspect.mockRestore(); await f.close(); }
  });
  it("observes a claimed run's heartbeat expiry strictly after sixty seconds", async () => {
    const f = await fixture();
    try {
      seedRun(f, RunRecordSchema.parse({ ...QUEUED_RUN, lifecycle: { state: "running", workerId: "person-lookup-worker-1", claimedAt: QUEUED_RUN.envelope.enqueuedAt,
        heartbeatAt: QUEUED_RUN.envelope.enqueuedAt, currentNodeId: "searching" }, claimGeneration: 1 }));
      const read = () => readNotificationHealth({ admission: syntheticStateRoot(f.root), database: f.db, reader: f.reader, stateRoot: f.root, clock: f.clock });
      f.clock.advanceWall(60_000); expect((await read()).leaseExpired).toBe(false);
      f.clock.advanceWall(1); expect((await read()).leaseExpired).toBe(true);
    } finally { releaseSeededWriteOwners(f.db, f.clock.now().toISOString()); await f.close(); }
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

/** Holds each off-thread backup inspection until the test settles it; the stand-in verdict is the synchronous full inspection. */
function holdBackupInspections() {
  const held: Array<{ settle(outcome: "inspect" | Error): void; signal: AbortSignal | undefined }> = [];
  const spy = vi.spyOn(backupInspectionWorker, "inspectAuthorityBackupOffThread").mockImplementation((admission, path, expectedSchemaVersion, options) =>
    new Promise((resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new DOMException("stopped", "AbortError")), { once: true });
      held.push({ signal: options?.signal, settle: outcome => {
        if (outcome instanceof Error) reject(outcome);
        else resolve(backupInspection.inspectAuthorityBackupReadOnly(admission, path, expectedSchemaVersion));
      } });
    }));
  return { held, restore: () => spy.mockRestore() };
}
async function withOneBackup(f: Awaited<ReturnType<typeof fixture>>) {
  const directory = join(f.root, "backups", "authority"); mkdirSync(directory, { recursive: true });
  await new AuthorityBackupService(f.db, { directory }, f.clock).request({ trigger: "operator", requiredGeneration: f.db.getMeta().authorityGeneration });
}
const settledYet = (promise: Promise<unknown>) => { let settled = false; void promise.then(() => { settled = true; }, () => { settled = true; }); return () => settled; };

describe("backup inspection off the main thread", () => {
  it("returns to the event loop while a backup inspection runs and waits for its verdict", async () => {
    const f = await fixture();
    const inspections = holdBackupInspections();
    try {
      await withOneBackup(f);
      const reading = readNotificationHealth({ admission: syntheticStateRoot(f.root), database: f.db, reader: f.reader, stateRoot: f.root, clock: f.clock });
      const settled = settledYet(reading);
      await vi.waitFor(() => expect(inspections.held).toHaveLength(1));
      await new Promise(resolve => setTimeout(resolve, 5));
      expect(settled()).toBe(false);
      inspections.held[0].settle("inspect");
      expect((await reading).backupFailed).toBe(false);
    } finally { inspections.restore(); await f.close(); }
  });

  it("raises nothing while an inspection is pending and fails the backup when the inspection throws, without remembering it", async () => {
    const f = await fixture();
    const inspections = holdBackupInspections();
    try {
      await withOneBackup(f);
      const read = () => readNotificationHealth({ admission: syntheticStateRoot(f.root), database: f.db, reader: f.reader, stateRoot: f.root, clock: f.clock });
      const pass = createNotificationHealthObserver({ database: f.db, clock: f.clock, inbox: f.inbox, read })();
      await vi.waitFor(() => expect(inspections.held).toHaveLength(1));
      expect(f.inbox.list("local-operator")).toEqual([]);
      expect(f.db.authority.notificationHealth.get("backup")).toBeUndefined();
      inspections.held[0].settle(new Error("backup-inspection-worker-exited: 1"));
      await pass;
      expect(f.db.authority.notificationHealth.get("backup")?.active).toBe(true);
      expect(f.inbox.list("local-operator").filter(row => row.title.includes("backup"))).toHaveLength(1);
      const again = read();
      await vi.waitFor(() => expect(inspections.held).toHaveLength(2));
      inspections.held[1].settle("inspect");
      expect((await again).backupFailed).toBe(false);
    } finally { inspections.restore(); await f.close(); }
  });

  it("a stop during a pending inspection ends it, writes nothing and is not a failed observation", async () => {
    const f = await fixture();
    const inspections = holdBackupInspections();
    try {
      await withOneBackup(f);
      const { observer, inbox } = createTrustNotifications({ admission: syntheticStateRoot(f.root), database: f.db, clock: f.clock, ids: sequentialIdFactory("stop"), reader: f.reader, stateRoot: f.root });
      const pass = observer.observe();
      await vi.waitFor(() => expect(inspections.held).toHaveLength(1));
      await observer.stop();
      expect(inspections.held[0].signal?.aborted).toBe(true);
      await pass;
      expect(observer.status().state).toBe("stopped");
      expect(inbox.list("local-operator")).toEqual([]);
      expect(f.db.authority.notificationHealth.get("backup")).toBeUndefined();
    } finally { inspections.restore(); await f.close(); }
  });
});
