import { describe, expect, it } from "vitest";
import { syntheticStateRoot } from "../../helpers/synthetic-storage-admission.js";
import { storageRecoveryFixture } from "../helpers/storage-recovery-fixture.js";
import { AuthorityDatabase } from "../../helpers/synthetic-storage-admission.js";
import { RunRecordService } from "../../../src/core/run-record-service.js";
import { createTrustNotifications } from "../../../src/server/dashboard/compose/notifications.js";
import { createNotificationObserver } from "../../../src/services/notifications/observation.js";
import { mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { AuthorityBackupService } from "../../helpers/synthetic-storage-admission.js";
import { createNotificationHealthObserver, readNotificationHealth } from "../../../src/server/dashboard/compose/notification-health.js";
import { createNotificationInbox } from "../../../src/services/notifications/inbox.js";
import { sequentialIdFactory, QUEUED_RUN, WORKER_START_REQUEST } from "../../fixtures/phase1f-run-fixtures.js";
import type { RunRecord } from "../../../src/domain/run/record.js";
import { failureRecordOf, cleanReceiptOf, runRecordOf } from "./helpers/dashboard-harness.js";
import { captureArchiveReport } from "../../../src/services/archive/report-capture.js";
import { transferArchiveReport } from "../../../src/services/archive/archive-transfer.js";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readNotificationSources } from "../../../src/server/dashboard/compose/notification-sources.js";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function seedRun(path: string, run: RunRecord) {
  const raw = new DatabaseSync(path);
  try {
    raw.prepare(`INSERT INTO workflow_runs(record_key,workflow,item_id,state,priority,attempt,not_before,owner_worker_id,claim_generation,heartbeat_at,parent_run_id,run_number,session_id,version,record_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      run.envelope.runId, run.envelope.workflow, run.envelope.itemId, run.lifecycle.state, run.envelope.priority, run.envelope.attempt, null, null, run.claimGeneration, null, null, null, null, run.version, JSON.stringify(run), run.createdAt);
  } finally { raw.close(); }
}
async function fixture() {
  const f = storageRecoveryFixture(); await f.run();
  const db = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "notification-producers" }, f.clock);
  const reader = new RunRecordService({ database: db, clock: f.clock, ids: sequentialIdFactory("e"), publishQueued: () => {} });
  const inbox = createNotificationInbox({ authority: db, clock: f.clock, ids: sequentialIdFactory("a"), actorId: "local-operator", runReader: reader });
  return { ...f, db, reader, inbox, close: () => { db.close(); f.dispose(); } };
}
describe("canonical notification producers", () => {
  it("serializes reads, exposes publication failure, retries and drains shutdown", async () => {
    let release: (() => void) | undefined; let reads = 0; let fail = true;
    const observer = createNotificationObserver({ read: () => { reads += 1; return { observations: [], diagnostics: [] }; }, health: async () => { await new Promise<void>(resolve => { release = resolve; }); if (fail) throw new Error("private diagnostic"); }, inbox: { publish: async () => { throw new Error("unused"); } } });
    const first = observer.observe(); expect(observer.observe()).toBe(first); expect(reads).toBe(1); release?.(); await first;
    expect(observer.status()).toEqual({ state: "failed", code: "NOTIFICATION_OBSERVATION_FAILED", pending: 1 });
    fail = false; const next = observer.observe(); let stopped = false; const stop = observer.stop().then(() => { stopped = true; });
    await Promise.resolve(); expect(stopped).toBe(false); release?.(); await next; await stop; expect(stopped).toBe(true);
    await observer.observe(); expect(reads).toBe(2);
  });
  it("retries an actual failed publication without folding its source twice", async () => {
    const f = await fixture();
    try {
      seedRun(f.path, runRecordOf({ seed: 1, lifecycle: { state: "parked-gate", gateId: "confirm", parkedAt: f.clock.now().toISOString(), resumeAt: "collect" } }));
      let fail = true, healthReads = 0, reads = 0;
      const observer = createNotificationObserver({ read: () => ++reads === 1 ? readNotificationSources(f.db, f.reader) : { observations: [], diagnostics: [] }, health: async () => { healthReads += 1; }, inbox: { publish: async (event, source) => { if (fail) throw new Error("private publication error"); return f.inbox.publish(event, source); } } });
      await observer.observe(); expect(observer.status()).toEqual({ state: "failed", code: "NOTIFICATION_OBSERVATION_FAILED", pending: 1 }); expect(healthReads).toBe(1);
      fail = false; await observer.observe(); await observer.observe();
      expect(observer.status()).toEqual({ state: "ready", pending: 0 }); expect(f.inbox.list("local-operator")[0].count).toBe(1);
      await observer.stop();
    } finally { f.close(); }
  });
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
    } finally { f.close(); }
  });
  it("publishes gate and write occurrences once across observation restarts", async () => {
    const f = await fixture();
    try {
      seedRun(f.path, runRecordOf({ seed: 1, lifecycle: { state: "parked-gate", gateId: "confirm", parkedAt: f.clock.now().toISOString(), resumeAt: "collect" } }));
      const composition = () => createTrustNotifications({ database: f.db, clock: f.clock, ids: sequentialIdFactory("b"), reader: f.reader });
      await composition().observer.observe();
      const row = f.inbox.list("local-operator")[0]; f.inbox.markRead(row.notificationId, 1);
      await composition().observer.observe(); expect(f.inbox.get(row.notificationId)?.status).toBe("read"); expect(f.inbox.get(row.notificationId)?.count).toBe(1);
    } finally { f.close(); }
  });
  it("observes real worker lease expiry strictly after sixty seconds", async () => {
    const f = await fixture();
    try {
      const started = f.db.authority.workerLeases.start({ ...WORKER_START_REQUEST, now: f.clock.now().toISOString() });
      expect(started.state).toBe("started");
      if (started.state !== "started") throw new Error("worker did not start");
      expect(f.db.authority.workerLeases.reportLifecycle({ workerId: started.lease.workerId, leaseGeneration: started.lease.leaseGeneration,
        lifecycle: { state: "idle", startedAt: started.lease.lifecycle.startedAt, heartbeatAt: f.clock.now().toISOString() }, now: f.clock.now().toISOString() }).state).toBe("applied");
      const read = () => readNotificationHealth({ admission: syntheticStateRoot(f.root), database: f.db, reader: f.reader, stateRoot: f.root, clock: f.clock });
      f.clock.advanceWall(60_000); expect((await read()).leaseExpired).toBe(false);
      f.clock.advanceWall(1); expect((await read()).leaseExpired).toBe(true);
    } finally { f.close(); }
  });
  it("crosses the third-failure threshold with archived sources and publishes an observation captured before transfer", async () => {
    const f = await fixture();
    try {
      for (let seed = 10; seed <= 12; seed += 1) {
        const failure = failureRecordOf({ seed, code: "REPEATED_TEST_FAILURE" });
        const run = runRecordOf({ seed, lifecycle: { state: "terminal", outcome: "failed", failureId: failure.failureId, endedAt: f.clock.now().toISOString() } });
        seedRun(f.path, run);
        const raw = new DatabaseSync(f.path);
        try { raw.prepare("INSERT INTO run_failures(record_key,run_id,fingerprint,record_json,created_at) VALUES (?,?,?,?,?)").run(failure.failureId, failure.runId, failure.fingerprint, JSON.stringify(failure), failure.occurredAt); } finally { raw.close(); }
        const before = readNotificationSources(f.db, f.reader);
        expect(before.observations.filter(item => item.event.kind === "repeating-failure")).toHaveLength(seed === 12 ? 1 : 0);
        const storage = f.reader.lifecycleStorage(), snapshot = storage.capture(run.envelope.runId);
        const report = captureArchiveReport({ snapshot, transferId: id(800 + seed), capturedAt: f.clock.now().toISOString(), sections: [], files: [] });
        transferArchiveReport(storage, report, snapshot.run.version);
        // Publication must use current canonical archive membership even though
        // its source was observed while this run was live.
        for (const item of before.observations) await f.inbox.publish(item.event, item.source);
        expect(readNotificationSources(f.db, f.reader)).toEqual(before);
      }
      const beforeRestart = f.inbox.list("local-operator");
      await createTrustNotifications({ database: f.db, clock: f.clock, ids: sequentialIdFactory("b"), reader: f.reader }).observer.observe();
      expect(f.inbox.list("local-operator")).toEqual(beforeRestart);
      expect(beforeRestart.find(row => row.trigger === "repeating")?.count).toBe(1);
    } finally { f.close(); }
  });
  it("counts distinct retained failure IDs and begins one repeating alert at three", async () => {
    const f = await fixture();
    try {
      f.db.authority.runs.enqueue(QUEUED_RUN);
      const raw = new DatabaseSync(f.path);
      try {
        for (let n = 1; n <= 4; n += 1) {
          const failure = { ...failureRecordOf({ seed: 1, code: "SUBJECT_MISMATCH" }), failureId: id(n), runId: QUEUED_RUN.envelope.runId, workflowId: QUEUED_RUN.envelope.workflow, traceId: QUEUED_RUN.envelope.traceId, attempt: QUEUED_RUN.envelope.attempt, nodeId: "collect", occurredAt: f.clock.now().toISOString() };
          raw.prepare("INSERT INTO run_failures(record_key,run_id,fingerprint,record_json,created_at) VALUES (?,?,?,?,?)").run(failure.failureId, failure.runId, failure.fingerprint, JSON.stringify(failure), failure.occurredAt);
          const rows = readNotificationSources(f.db, f.reader).observations;
          expect(rows.filter(row => row.event.kind === "repeating-failure")).toHaveLength(Math.max(0, n - 2));
          for (const row of rows) await f.inbox.publish(row.event, row.source);
        }
      } finally { raw.close(); }
      const rows = f.inbox.list("local-operator"); expect(rows.find(row => row.trigger === "repeating")?.count).toBe(2);
      for (const row of readNotificationSources(f.db, f.reader).observations) await f.inbox.publish(row.event, row.source);
      expect(f.inbox.list("local-operator").find(row => row.trigger === "repeating")?.count).toBe(2);
      expect(JSON.stringify(rows)).not.toContain(failureRecordOf({ seed: 1, code: "SUBJECT_MISMATCH" }).summary);
    } finally { f.close(); }
  });
  it("publishes only verified canonical receipts and refuses mismatched evidence", async () => {
    const f = await fixture();
    try {
      const run = runRecordOf({ seed: 1, dryRun: false, lifecycle: { state: "terminal", outcome: "done", endedAt: f.clock.now().toISOString() } });
      seedRun(f.path, run);
      const receipt = { ...cleanReceiptOf({ seed: 1 }), runId: run.envelope.runId, workflowId: run.envelope.workflow, traceId: run.envelope.traceId, attempt: run.envelope.attempt, descriptorFingerprint: run.envelope.contractFingerprint, configFingerprint: run.envelope.configFingerprint, generatedAt: f.clock.now().toISOString() };
      expect(readNotificationSources(f.db, f.reader).observations).toEqual([]);
      f.db.authority.evidenceReceipts.insert(receipt);
      expect(readNotificationSources(f.db, f.reader).observations.map(row => row.event.kind)).toEqual(["verified-done"]);
    } finally { f.close(); }
  });
  it("reads frozen failures and receipts after real transfer without replay, and deletes owned metadata", async () => {
    const f = await fixture();
    try {
      const run = runRecordOf({ seed: 3, lifecycle: { state: "terminal", outcome: "done", endedAt: f.clock.now().toISOString() } });
      seedRun(f.path, run);
      const failure = failureRecordOf({ seed: 3, code: "SUBJECT_MISMATCH" });
      const raw = new DatabaseSync(f.path);
      try { raw.prepare("INSERT INTO run_failures(record_key,run_id,fingerprint,record_json,created_at) VALUES (?,?,?,?,?)").run(failure.failureId, failure.runId, failure.fingerprint, JSON.stringify(failure), failure.occurredAt); } finally { raw.close(); }
      f.db.authority.evidenceReceipts.insert(cleanReceiptOf({ seed: 3 }));
      const before = readNotificationSources(f.db, f.reader);
      expect(before.observations.map(row => row.event.kind)).toEqual(["verified-done", "run-failed", "subject-mismatch"]);
      for (const row of before.observations) await f.inbox.publish(row.event, row.source);
      const rows = f.inbox.list("local-operator");
      const storage = f.reader.lifecycleStorage(), snapshot = storage.capture(run.envelope.runId);
      const report = captureArchiveReport({ snapshot, transferId: id(600), capturedAt: f.clock.now().toISOString(), sections: [], files: [] });
      transferArchiveReport(storage, report, snapshot.run.version);
      const after = readNotificationSources(f.db, f.reader);
      expect(after).toEqual(before);
      for (const row of after.observations) await f.inbox.publish(row.event, row.source);
      expect(f.inbox.list("local-operator")).toEqual(rows);
      storage.deleteArchive({ commandId: id(601), runId: run.envelope.runId, archiveFingerprint: report.digest });
      expect(f.inbox.list("local-operator")).toEqual([]);
      expect(f.db.authority.notificationPublications.list()).toEqual([]);
    } finally { f.close(); }
  });
  it.each(["dry-run", "warnings", "missing", "mismatch", "corrupt"])("does not invent verified completion from %s archive evidence", async kind => {
    const f = await fixture();
    try {
      const run = runRecordOf({ seed: 4, dryRun: kind === "dry-run", lifecycle: { state: "terminal", outcome: "done", endedAt: f.clock.now().toISOString() } });
      seedRun(f.path, run);
      if (kind !== "missing") f.db.authority.evidenceReceipts.insert({ ...cleanReceiptOf({ seed: 4 }), ...(kind === "warnings" ? { result: "done-with-warnings", confidence: "partial", warnings: [{ id: id(700), code: "WARN", summary: "private receipt", loadBearing: false, evidence: [] }] } : {}), ...(kind === "mismatch" ? { configFingerprint: "cd".repeat(32) } : {}) });
      const storage = f.reader.lifecycleStorage(), snapshot = storage.capture(run.envelope.runId);
      const report = captureArchiveReport({ snapshot, transferId: id(602), capturedAt: f.clock.now().toISOString(), sections: [], files: [] });
      transferArchiveReport(storage, report, snapshot.run.version);
      if (kind === "corrupt") {
        const archive = new DatabaseSync(join(dirname(f.path), "archive.sqlite"));
        try { archive.exec("DROP TRIGGER archive_records_delete_receipt; DELETE FROM archive_records"); } finally { archive.close(); }
      }
      if (kind === "mismatch" || kind === "corrupt") expect(() => readNotificationSources(f.db, f.reader)).toThrow();
      else {
        const read = readNotificationSources(f.db, f.reader);
        expect(read.observations).toEqual([]);
        expect(read.diagnostics).toEqual(kind === "missing" ? ["NOTIFICATION_RECEIPT_MISSING"] : []);
      }
    } finally { f.close(); }
  });
  it("reads a write park through the production composition", async () => {
    const f = await fixture();
    try {
      seedRun(f.path, runRecordOf({ seed: 5, lifecycle: { state: "parked-write", writeIntentId: id(500), intentGeneration: 1, parkedAt: f.clock.now().toISOString(), code: "unknown", message: "private park" } }));
      await createTrustNotifications({ database: f.db, reader: f.reader, clock: f.clock, ids: sequentialIdFactory("b") }).observer.observe();
      expect(f.inbox.list("local-operator").map(row => row.trigger)).toEqual(["write-parked"]);
      expect(JSON.stringify(f.inbox.list("local-operator"))).not.toContain("private park");
    } finally { f.close(); }
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
    } finally { f.close(); }
  });
});
