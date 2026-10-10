import { fixtureDuoCeremonyGates } from "../../../../../support/helpers/duo-ceremony-fixtures.js";
import { runWorkerLoop } from "../../../../../../src/backend/runtime/workers/worker-loop.js";
import { createWriteSequencer } from "../../../../../../src/backend/runtime/writes/write-sequencer.js";
import { testRunLifecycle } from "../../../../../support/fixtures/run-lifecycle-fixtures.js";
import { ManualScheduler, recordingEmitter, recordingLogger } from "../../../../../support/helpers/phase1f-executor-harness.js";
import { WorkerIdSchema, WorkflowIdSchema } from "../../../../../../src/rules/identity/ids.js";
import { createWriteFixtureWorld, buildWriteFixtureRegistry, writeFixtureSessions, writeFixtureDescriptor,
  writeFixtureQueuedRun, absentProbeEvidence, WRITE_FIXTURE_WORKFLOW_ID,
  WRITE_FIXTURE_IMPL_FINGERPRINT } from "../../../../../support/fixtures/write-sequencer-fixtures.js";
import { CONFIG_SNAPSHOT } from "../../../../../support/fixtures/phase1c-contract-fixtures.js";
import { testWorkerPorts } from "../../../../../support/fixtures/run-lifecycle-fixtures.js";
import { personLookupDescriptor } from "../../../../../support/helpers/registered-workflows.js";
import { seedPersonLookupExitRun } from "../../../../../support/fixtures/receipt-run-fixtures.js";
import { describe, expect, it } from "vitest";
import { syntheticStateRoot } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { storageRecoveryFixture } from "../../../../../support/helpers/integration/storage-recovery-fixture.js";
import { AuthorityDatabase } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { RunRecordService } from "../../../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createTrustNotifications } from "../../../../../../src/backend/app/composition/dashboard/notifications.js";
import { createNotificationObserver } from "../../../../../../src/backend/runs/notifications/observation.js";
import { mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { AuthorityBackupService } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { createNotificationHealthObserver, readNotificationHealth } from "../../../../../../src/backend/app/composition/dashboard/notification-health.js";
import { createNotificationInbox } from "../../../../../../src/backend/runs/notifications/inbox.js";
import { sequentialIdFactory, QUEUED_RUN } from "../../../../../support/fixtures/phase1f-run-fixtures.js";
import type { RunRecord } from "../../../../../../src/models/run/record.js";
import { failureRecordOf, cleanReceiptOf, runRecordOf } from "../../../../../support/helpers/backend/dashboard-harness.js";
import { join } from "node:path";
import { readNotificationSources } from "../../../../../../src/backend/app/composition/dashboard/notification-sources.js";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function seedRun(f: Awaited<ReturnType<typeof fixture>>, desired: RunRecord) {
  const active = f.db.authority.runtimeConfig.get();
  if (active === undefined) throw new Error("missing fixture settings");
  const queued = { ...QUEUED_RUN, envelope: { ...QUEUED_RUN.envelope,
    runId: desired.envelope.runId, itemId: desired.envelope.itemId,
    traceId: desired.envelope.traceId, contractFingerprint: personLookupDescriptor.contractFingerprint,
    configFingerprint: active.configFingerprint, configSnapshotId: active.configSnapshotId } };
  f.db.authority.runs.enqueue(queued);
  if (desired.lifecycle.state === "queued") return f.db.authority.runs.get(queued.envelope.runId)!;
  const slot = f.db.authority.workerSlots.list("person-lookup")[0];
  const claim = f.db.authority.runs.claimNext({ workflow: "person-lookup", workerId: slot.workerId, now: f.clock.now().toISOString() });
  if (claim.state !== "claimed") throw new Error("fixture claim refused");
  let run = claim.run;
  for (const state of ["validating", "running"] as const) {
    const result = f.db.authority.runs.transition({ runId: run.envelope.runId, expectedVersion: run.version,
      claim: { workerId: slot.workerId, claimGeneration: run.claimGeneration }, now: f.clock.now().toISOString(),
      lifecycle: { state, ...(state === "running" ? { currentNodeId: "searching" } : {}), workerId: slot.workerId, claimedAt: run.lifecycle.state === "claimed" ? run.lifecycle.claimedAt : f.clock.now().toISOString(), heartbeatAt: f.clock.now().toISOString() } });
    if (result.state !== "applied") throw new Error("fixture transition refused");
    run = result.run;
  }
  if (desired.lifecycle.state === "parked-gate") {
    const result = f.db.authority.runs.transition({ runId: run.envelope.runId, expectedVersion: run.version,
      claim: { workerId: slot.workerId, claimGeneration: run.claimGeneration }, now: f.clock.now().toISOString(), lifecycle: desired.lifecycle });
    if (result.state !== "applied") throw new Error("fixture park refused");
    return result.run;
  }
  return run;
}
function retainedFailure(f: Awaited<ReturnType<typeof fixture>>, run: RunRecord, seed: number, code: string) {
  return { ...failureRecordOf({ seed, code }), runId: run.envelope.runId,
    workflowId: run.envelope.workflow, traceId: run.envelope.traceId, attempt: run.envelope.attempt,
    occurredAt: f.clock.now().toISOString() };
}
function receiptOf(run: RunRecord, seed: number) {
  return { ...cleanReceiptOf({ seed }), runId: run.envelope.runId, workflowId: run.envelope.workflow,
    traceId: run.envelope.traceId, attempt: run.envelope.attempt, descriptorFingerprint: run.envelope.contractFingerprint,
    configFingerprint: run.envelope.configFingerprint };
}
function failRun(f: Awaited<ReturnType<typeof fixture>>, seed: number, code: string) {
  const run = seedRun(f, runRecordOf({ seed, claimGeneration: 1, lifecycle: { state: "running",
    workerId: "person-lookup-worker-1", claimedAt: f.clock.now().toISOString(), heartbeatAt: f.clock.now().toISOString() } }));
  const failure = { ...retainedFailure(f, run, seed, code), nodeId: "searching", taskId: "ucpath/search-person-org" };
  if (run.lifecycle.state !== "running") throw new Error("fixture not running");
  f.db.terminalizeFailure(personLookupDescriptor, { failure, authorization: { kind: "failed", runId: run.envelope.runId,
    workflowId: run.envelope.workflow, attempt: run.envelope.attempt, descriptorVersion: run.envelope.descriptorVersion,
    contractFingerprint: run.envelope.contractFingerprint, expectedVersion: run.version,
    claim: { workerId: run.lifecycle.workerId, claimGeneration: run.claimGeneration }, authorizedAt: f.clock.now().toISOString(), failureId: failure.failureId } });
}
async function fixture() {
  const f = storageRecoveryFixture(); await f.run();
  const db = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "notification-producers" }, f.clock);
  db.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  testWorkerPorts(db, f.clock, { path: f.path, descriptor: personLookupDescriptor, poolIndex: 1 });
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
      seedRun(f, runRecordOf({ seed: 1, lifecycle: { state: "parked-gate", gateId: "confirm", parkedAt: f.clock.now().toISOString(), resumeAt: "collect" } }));
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
      seedRun(f, runRecordOf({ seed: 1, lifecycle: { state: "parked-gate", gateId: "confirm", parkedAt: f.clock.now().toISOString(), resumeAt: "collect" } }));
      const composition = () => createTrustNotifications({ database: f.db, clock: f.clock, ids: sequentialIdFactory("b"), reader: f.reader });
      await composition().observer.observe();
      const row = f.inbox.list("local-operator")[0]; f.inbox.markRead(row.notificationId, 1);
      await composition().observer.observe(); expect(f.inbox.get(row.notificationId)?.status).toBe("read"); expect(f.inbox.get(row.notificationId)?.count).toBe(1);
    } finally { f.close(); }
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
    } finally { f.close(); }
  });
  it("crosses the third-failure threshold and publishes each captured native observation", async () => {
    const f = await fixture();
    try {
      for (let seed = 10; seed <= 12; seed += 1) {
        failRun(f, seed, "REPEATED_TEST_FAILURE");
        const before = readNotificationSources(f.db, f.reader);
        expect(before.observations.filter(item => item.event.kind === "repeating-failure")).toHaveLength(seed === 12 ? 1 : 0);
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
      for (let n = 1; n <= 4; n += 1) {
        failRun(f, n, "SUBJECT_MISMATCH");
        const rows = readNotificationSources(f.db, f.reader).observations;
        expect(rows.filter(row => row.event.kind === "repeating-failure")).toHaveLength(Math.max(0, n - 2));
        for (const row of rows) await f.inbox.publish(row.event, row.source);
      }
      const rows = f.inbox.list("local-operator"); expect(rows.find(row => row.trigger === "repeating")?.count).toBe(2);
      for (const row of readNotificationSources(f.db, f.reader).observations) await f.inbox.publish(row.event, row.source);
      expect(f.inbox.list("local-operator").find(row => row.trigger === "repeating")?.count).toBe(2);
      expect(JSON.stringify(rows)).not.toContain(failureRecordOf({ seed: 1, code: "SUBJECT_MISMATCH" }).summary);
    } finally { f.close(); }
  });
  it("publishes only verified canonical receipts and refuses mismatched evidence", async () => {
    const f = await fixture();
    try {
      expect(readNotificationSources(f.db, f.reader).observations).toEqual([]);
      const { run } = seedPersonLookupExitRun(f.db);
      f.db.authority.evidenceReceipts.insert(receiptOf(run, 1));
      expect(readNotificationSources(f.db, f.reader).observations.map(row => row.event.kind)).toEqual(["verified-done"]);
    } finally { f.close(); }
  });
  it("reads retained native failures and receipts across reopen without replay", async () => {
    const f = await fixture();
    try {
      const { run } = seedPersonLookupExitRun(f.db);
      f.db.authority.evidenceReceipts.insert(receiptOf(run, 3));
      failRun(f, 3, "SUBJECT_MISMATCH");
      const before = readNotificationSources(f.db, f.reader);
      expect(before.observations.map(row => row.event.kind)).toEqual(["verified-done", "run-failed", "subject-mismatch"]);
      for (const row of before.observations) await f.inbox.publish(row.event, row.source);
      const rows = f.inbox.list("local-operator");
      const reopened = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "notification-reopen" }, f.clock);
      try {
        const reader = new RunRecordService({ database: reopened, clock: f.clock, ids: sequentialIdFactory("e"), publishQueued: () => {} });
        expect(readNotificationSources(reopened, reader)).toEqual(before);
      } finally { reopened.close(); }
      const after = readNotificationSources(f.db, f.reader);
      expect(after).toEqual(before);
      for (const row of after.observations) await f.inbox.publish(row.event, row.source);
      expect(f.inbox.list("local-operator")).toEqual(rows);
    } finally { f.close(); }
  });
  it.each(["dry-run", "warnings", "missing", "mismatch", "corrupt"])("does not invent verified completion from %s canonical evidence", async kind => {
    const f = await fixture();
    try {
      if (kind === "dry-run") {
        const { run } = seedPersonLookupExitRun(f.db, { dryRun: true });
        f.db.authority.evidenceReceipts.insert(receiptOf(run, 4));
        expect(readNotificationSources(f.db, f.reader).observations).toEqual([]);
      } else {
        const run = kind === "missing" ? seedRun(f, runRecordOf({ seed: 4, lifecycle: { state: "queued" } })) : seedPersonLookupExitRun(f.db).run;
        if (kind === "missing") {
          expect(() => f.db.authority.runs.transition({ runId: run.envelope.runId, expectedVersion: run.version,
            now: f.clock.now().toISOString(), lifecycle: { state: "terminal", outcome: "done", endedAt: f.clock.now().toISOString() } })).toThrow();
        } else {
          const receipt = { ...cleanReceiptOf({ seed: 4 }), runId: run.envelope.runId, workflowId: run.envelope.workflow,
            traceId: run.envelope.traceId, attempt: run.envelope.attempt, descriptorFingerprint: run.envelope.contractFingerprint,
            configFingerprint: run.envelope.configFingerprint,
            ...(kind === "warnings" ? { result: "done-with-warnings", confidence: "partial", warnings: [{ id: id(700), code: "WARN", summary: "private receipt", loadBearing: false, evidence: [] }] } : {}),
            ...(kind === "mismatch" ? { configFingerprint: "cd".repeat(32) } : {}),
            ...(kind === "corrupt" ? { confidence: "invalid" } : {}) };
          if (kind === "corrupt") expect(() => f.db.authority.evidenceReceipts.insert(receipt)).toThrow();
          else f.db.authority.evidenceReceipts.insert(receipt);
        }
        if (kind === "mismatch") expect(() => readNotificationSources(f.db, f.reader)).toThrow(/NOTIFICATION_RECEIPT_IDENTITY_MISMATCH/);
        else expect(readNotificationSources(f.db, f.reader).observations).toEqual([]);
        expect(f.inbox.list("local-operator")).toEqual([]);
      }
    } finally { f.close(); }
  });
  it("reads a write park through the production composition", async () => {
    const f = await fixture();
    try {
      const world = createWriteFixtureWorld();
      const stores = buildWriteFixtureRegistry(world);
      const sessions = writeFixtureSessions(world);
      const scheduler = new ManualScheduler(f.clock);
      const ids = sequentialIdFactory("c");
      const log = recordingLogger().log;
      const emitter = recordingEmitter().emitter;
      f.db.authority.runs.enqueue(writeFixtureQueuedRun());
      world.probeResults.push(absentProbeEvidence(f.clock.now().toISOString()));
      world.commitThrows = new Error("private park");
      await runWorkerLoop({
        ...testWorkerPorts(f.db, f.clock, { path: f.path, descriptor: writeFixtureDescriptor, poolIndex: 1 }),
        workflowId: WorkflowIdSchema.parse(WRITE_FIXTURE_WORKFLOW_ID), workerId: WorkerIdSchema.parse(f.db.authority.workerSlots.list(WRITE_FIXTURE_WORKFLOW_ID)[0].workerId),
        descriptor: writeFixtureDescriptor, stores, authority: f.db, sessionFactory: sessions.factory, emitter,
        clock: f.clock, ids, scheduler, taskDeadlineMs: 60_000, sessionAcquireMs: 20_000,
        duoCeremony: fixtureDuoCeremonyGates(f.clock), heartbeatIntervalMs: 600_000, idleRepollMs: 1_000,
        log, stopSignal: new AbortController().signal, exitWhenIdle: true,
        writeSequencerFor: manager => createWriteSequencer({ lifecycle: testRunLifecycle(f.db, f.clock), stores,
          authority: f.db, sessions: manager, emitter, clock: f.clock, ids, scheduler, taskDeadlineMs: 60_000,
          operator: "local-operator", log, resolveImplFingerprint: () => WRITE_FIXTURE_IMPL_FINGERPRINT }),
      });
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
