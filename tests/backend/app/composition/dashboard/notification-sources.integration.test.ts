import { createProfileFixtureSet } from "../../../../support/helpers/admission-fixture.js";
import { copyFileSync, cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createNotificationCompositionTestWorld } from "../../../../support/helpers/backend/notification-composition-world.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../../../src/models/failures/error-catalog.js";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createLaneNotificationSourceReader, readNotificationSources } from "../../../../../src/backend/app/composition/dashboard/notification-sources.js";
import { createTrustNotifications } from "../../../../../src/backend/app/composition/dashboard/notifications.js";
import { RunRecordService } from "../../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createNotificationObserver } from "../../../../../src/backend/runs/notifications/observation.js";
import type { RunRecord } from "../../../../../src/models/run/record.js";
import { sequentialIdFactory } from "../../../../support/fixtures/phase1f-run-fixtures.js";
import { seedPersonLookupExitRun } from "../../../../support/fixtures/receipt-run-fixtures.js";
import { cleanReceiptOf, failureRecordOf, runRecordOf } from "../../../../support/helpers/backend/dashboard-harness.js";
import { personLookupDescriptor } from "../../../../support/helpers/registered-workflows.js";
import { AuthorityDatabase, syntheticStateRoot } from "../../../../support/helpers/synthetic-storage-admission.js";
import { createDashboardReadHost } from "../../../../../src/backend/storage/sqlite/dashboard-read-host.js";
import { sha256Hex } from "../../../../../src/rules/validation/sha256.js";
import { measureNotificationScan } from "../../../../../scripts/bench/notification-scan.js";
import { createDashboardPortTestWorld } from "../../../../support/helpers/backend/dashboard-port-world.js";
import { writeDashboardBuildIdentity } from "../../../../../src/backend/app/composition/dashboard/build-identity.js";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";
import { CONFIG_SNAPSHOT } from "../../../../support/fixtures/phase1c-contract-fixtures.js";
import { admitFixtureSlot, testRunService } from "../../../../support/fixtures/run-lifecycle-fixtures.js";
import { scaledMs } from "../../../../support/time-scale.js";

const profileFixtures = createProfileFixtureSet();
afterAll(() => profileFixtures.close());

const { fixture, seedRun } = createNotificationCompositionTestWorld(profileFixtures.create);


const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
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
describe("canonical notification producers", () => {
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
    } finally { await f.close(); }
  });
  it("reads the runs once while the store key is unchanged and again after a write", async () => {
    const f = await fixture();
    try {
      seedRun(f, runRecordOf({ seed: 1, lifecycle: { state: "parked-gate", gateId: "confirm", parkedAt: f.clock.now().toISOString(), resumeAt: "collect" } }));
      const list = vi.spyOn(f.reader, "list");
      const first = readNotificationSources(f.db, f.reader);
      const reads = list.mock.calls.length;
      expect(first.observations).toHaveLength(1);
      expect(readNotificationSources(f.db, f.reader)).toEqual({ observations: [], diagnostics: first.diagnostics });
      expect(list).toHaveBeenCalledTimes(reads);
      seedRun(f, runRecordOf({ seed: 2, lifecycle: { state: "parked-gate", gateId: "confirm", parkedAt: f.clock.now().toISOString(), resumeAt: "collect" } }));
      expect(readNotificationSources(f.db, f.reader).observations).toHaveLength(2);
      expect(list.mock.calls.length).toBeGreaterThan(reads);
    } finally { await f.close(); }
  });
  it("reuses the scan across its own health writes and unrelated generation changes", async () => {
    const f = await fixture();
    try {
      seedRun(f, runRecordOf({ seed: 1, lifecycle: { state: "parked-gate", gateId: "confirm",
        parkedAt: f.clock.now().toISOString(), resumeAt: "collect" } }));
      const list = vi.spyOn(f.reader, "list");
      expect(readNotificationSources(f.db, f.reader).observations).toHaveLength(1);
      const generation = f.db.getMeta().authorityGeneration;
      const now = f.clock.now().toISOString();
      f.db.withAuthorityTransaction(repos => repos.notificationHealth.put({ concern: "disk-space", active: false,
        occurrence: 0, observedAt: now, createdAt: now, samples: [] }));
      expect(f.db.getMeta().authorityGeneration).toBeGreaterThan(generation);
      expect(readNotificationSources(f.db, f.reader)).toEqual({ observations: [], diagnostics: [] });
      expect(list).toHaveBeenCalledTimes(1);
    } finally { await f.close(); }
  });
  it("fails the whole scan if a later canonical page refuses its cursor and starts over on the next tick", async () => {
    const f = await fixture();
    try {
      for (const seed of [1, 2]) seedRun(f, runRecordOf({ seed, lifecycle: { state: "parked-gate", gateId: "confirm",
        parkedAt: f.clock.now().toISOString(), resumeAt: "collect" } }));
      const list = f.reader.list.bind(f.reader);
      const expected = list({ disposition: "live", limit: 2 });
      if (expected.state !== "listed") throw new Error("fixture run list refused");
      const pages = vi.spyOn(f.reader, "list")
        .mockImplementationOnce(input => list({ ...input, limit: 1 }))
        .mockImplementationOnce(input => {
          if (input.cursor === undefined) throw new Error("fixture expected a continuation cursor");
          return list({ ...input, cursor: { ...input.cursor, generation: input.cursor.generation + 1 } });
        });
      expect(() => readNotificationSources(f.db, f.reader)).toThrow("notification-scan-cursor-stale");
      expect(pages).toHaveBeenCalledTimes(2);
      expect(readNotificationSources(f.db, f.reader).observations.map(item => item.event)).toEqual(
        expected.rows.map(run => ({ kind: "gate-opened", runId: run.envelope.runId, workflowId: run.envelope.workflow, gateId: "confirm" })),
      );
    } finally { await f.close(); }
  });
  it("reuses the lane scan after an unrelated commit and delivers an intervening publication in failure order", async () => {
    const f = await fixture();
    try {
      for (const seed of [1, 2, 3]) {
        f.clock.advanceWall(1000);
        failRun(f, seed, "REPEATED_TEST_FAILURE");
      }
      const lanes = createDashboardReadHost({ admission: syntheticStateRoot(f.root), database: f.db, clock: f.clock, lanes: ["navigation"],
        entry: new URL("../../../../../src/backend/app/composition/dashboard/read-lane-entry.js", import.meta.url) });
      try {
        const read = createLaneNotificationSourceReader(lanes);
        const first = await read();
        expect(first.observations.map(item => item.event.kind)).toEqual(["run-failed", "run-failed", "run-failed", "repeating-failure"]);

        const now = f.clock.now().toISOString();
        const generation = f.db.getMeta().authorityGeneration;
        f.db.withAuthorityTransaction(repos => repos.notificationHealth.put({ concern: "disk-space", active: false,
          occurrence: 0, observedAt: now, createdAt: now, samples: [] }));
        expect(f.db.getMeta().authorityGeneration).toBeGreaterThan(generation);
        expect(await read()).toEqual({ observations: [], diagnostics: [] });

        const earlier = first.observations[0], repeated = first.observations[3].event;
        if (earlier.event.kind !== "run-failed" || repeated.kind !== "repeating-failure") throw new Error("fixture failure observations missing");
        const { failureId, runId } = earlier.event;
        const event = { ...repeated, failureId, runId };
        const source = { identity: sha256Hex(`notification-occurrence:repeating-failure:${failureId}`), occurredAt: earlier.source.occurredAt };
        await f.inbox.publish(event, source);
        expect((await read()).observations).toEqual(first.observations);
        await f.inbox.publish(earlier.event, earlier.source);
        expect((await read()).observations).toEqual(first.observations.slice(1));
      } finally { await lanes.close(); }
    } finally { await f.close(); }
  });
  it("measures the G2-4 lane scenario with real seeded evidence and a queued interactive read", async () => {
    const f = await fixture();
    try {
      failRun(f, 1, "REPEATED_TEST_FAILURE");
      const { run } = seedPersonLookupExitRun(f.db);
      f.db.authority.evidenceReceipts.insert(receiptOf(run, 3));
      const [failed] = readNotificationSources(f.db, f.reader).observations.filter(item => item.event.kind === "run-failed");
      if (failed === undefined) throw new Error("fixture failure observation missing");
      await f.inbox.publish(failed.event, failed.source);

      const report = await measureNotificationScan(syntheticStateRoot(f.root), f.db, 1);
      expect(report.counts).toEqual({ runs: 2, failures: 1, receipts: 1, publications: 1 });
      expect(report.samples).toHaveLength(1);
      const [sample] = report.samples;
      expect(sample.order).toEqual(["click", "scan", "rerun"]);
      expect(sample.scanMs).toBeGreaterThan(0);
      expect(sample.clickMs).toBeGreaterThan(0);
    } finally { await f.close(); }
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
    } finally { await f.close(); }
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
    } finally { await f.close(); }
  });
  it("keeps the run-failed publication an interrupted profile already committed for a mismatch failure", async () => {
    const f = await fixture();
    try {
      failRun(f, 3, "SUBJECT_MISMATCH");
      const [mismatch] = readNotificationSources(f.db, f.reader).observations;
      if (mismatch?.event.kind !== "subject-mismatch") throw new Error("fixture mismatch observation missing");
      const { kind: _kind, ...shared } = mismatch.event;
      await f.inbox.publish({ kind: "run-failed", ...shared, code: "SUBJECT_MISMATCH" }, { identity: sha256Hex(`notification-occurrence:run-failed:${mismatch.event.failureId}`), occurredAt: mismatch.source.occurredAt });
      const upgraded = readNotificationSources(f.db, f.reader);
      expect(upgraded.observations.map(row => row.event.kind)).toEqual(["run-failed"]);
      for (const row of upgraded.observations) await f.inbox.publish(row.event, row.source);
      expect(f.inbox.list("local-operator")).toHaveLength(1);
    } finally { await f.close(); }
  });
  it("publishes one failure notice for a real failure and none for a cancelled run", async () => {
    const f = await fixture();
    try {
      const queued = seedRun(f, runRecordOf({ seed: 5 }));
      expect(testRunService(f.db, f.clock).transition({ commandId: id(5), runId: queued.envelope.runId, expectedVersion: queued.version,
        lifecycle: { state: "terminal", outcome: "cancelled", endedAt: f.clock.now().toISOString() } }).state).toBe("applied");
      expect(readNotificationSources(f.db, f.reader).observations).toEqual([]);
      failRun(f, 6, "SUBJECT_MISMATCH");
      for (const row of readNotificationSources(f.db, f.reader).observations) await f.inbox.publish(row.event, row.source);
      expect(f.inbox.list("local-operator").map(row => row.trigger)).toEqual(["failed"]);
    } finally { await f.close(); }
  });
  it("publishes only verified canonical receipts and refuses mismatched evidence", async () => {
    const f = await fixture();
    try {
      expect(readNotificationSources(f.db, f.reader).observations).toEqual([]);
      const { run } = seedPersonLookupExitRun(f.db);
      f.db.authority.evidenceReceipts.insert(receiptOf(run, 1));
      expect(readNotificationSources(f.db, f.reader).observations.map(row => row.event.kind)).toEqual(["verified-done"]);
    } finally { await f.close(); }
  });
  it("reads retained native failures and receipts across reopen without replay", async () => {
    const f = await fixture();
    try {
      const { run } = seedPersonLookupExitRun(f.db);
      f.db.authority.evidenceReceipts.insert(receiptOf(run, 3));
      failRun(f, 3, "SUBJECT_MISMATCH");
      const before = readNotificationSources(f.db, f.reader);
      expect(before.observations.map(row => row.event.kind)).toEqual(["verified-done", "subject-mismatch"]);
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
    } finally { await f.close(); }
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
    } finally { await f.close(); }
  });
});

it("reports a real successful run's missing completion receipt through observer status without read writes", async () => {
  const f = await fixture();
  try {
    const { run } = seedPersonLookupExitRun(f.db);
    expect(run.envelope.dryRun).toBe(false);
    expect(run.lifecycle).toMatchObject({ state: "terminal", outcome: "done" });
    expect(f.db.authority.runResults.get(run.envelope.runId)).toBeDefined();
    expect(f.db.authority.evidenceReceipts.listByRun(run.envelope.runId)).toEqual([]);
    const before = f.db.getMeta();
    const first = readNotificationSources(f.db, f.reader);
    expect.soft(first).toEqual({ observations: [], diagnostics: ["NOTIFICATION_RECEIPT_MISSING"] });
    expect(readNotificationSources(f.db, f.reader)).toEqual(first);
    expect(f.db.getMeta()).toEqual(before);
    expect(f.db.authority.evidenceReceipts.listByRun(run.envelope.runId)).toEqual([]);
    const observer = createNotificationObserver({ read: () => readNotificationSources(f.db, f.reader), inbox: f.inbox, health: async () => undefined });
    try {
      await observer.observe();
      expect.soft(observer.status()).toEqual({ state: "failed", code: "NOTIFICATION_RECEIPT_MISSING", pending: 1 });
      expect(formatErrorCatalogFailure(createErrorCatalogFailure("NOTIFICATION_RECEIPT_MISSING", {})).text).toBe("Some notifications may be missing.");
      expect(f.inbox.list("local-operator")).toEqual([]);
      expect(f.db.getMeta()).toEqual(before);
      f.db.authority.evidenceReceipts.insert(receiptOf(run, 7));
      await observer.observe();
      expect(observer.status()).toEqual({ state: "ready", pending: 0 });
      expect(f.inbox.list("local-operator").map(row => row.trigger)).toEqual(["verified-done"]);
      const settled = f.db.getMeta();
      expect(readNotificationSources(f.db, f.reader).diagnostics).toEqual([]);
      expect(f.db.getMeta()).toEqual(settled);
    } finally { await observer.stop(); }
  } finally { await f.close(); }
});

it("does not report a missing completion receipt for queued or dry-run success", async () => {
  const f = await fixture();
  try {
    const queued = seedRun(f, runRecordOf({ seed: 91, lifecycle: { state: "queued" } }));
    const { run } = seedPersonLookupExitRun(f.db, { dryRun: true });
    expect(f.db.authority.evidenceReceipts.listByRun(queued.envelope.runId)).toEqual([]);
    expect(f.db.authority.evidenceReceipts.listByRun(run.envelope.runId)).toEqual([]);
    const before = f.db.getMeta();
    expect(readNotificationSources(f.db, f.reader)).toEqual({ observations: [], diagnostics: [] });
    expect(f.db.getMeta()).toEqual(before);
  } finally { await f.close(); }
});

it("publishes through the real app lane entry in built-bundle dashboard composition", async () => {
  const world = createDashboardPortTestWorld(() => {}, () => {});
  const clock = manualClock(new Date("2026-09-10T20:00:00.000Z"));
  try {
    const f = await world.createProfileFixture(clock);
    const repoRoot = f.workspace;
    cpSync("src", join(repoRoot, "src"), { recursive: true });
    mkdirSync(join(repoRoot, "config"), { recursive: true });
    for (const file of ["vite.dashboard.config.ts", "tsconfig.json", "config/dashboard-workflow-sources.json"]) copyFileSync(file, join(repoRoot, file));
    const distDir = join(repoRoot, "dist", "dashboard");
    mkdirSync(distDir, { recursive: true });
    writeFileSync(join(distDir, "index.html"), "<!doctype html><title>Built dashboard</title>");
    writeDashboardBuildIdentity({ repoRoot, distDir });

    const { profile } = f.dashboardInput;
    const { database } = profile.runtime.selectedContext(profile.token);
    if (database.authority.runtimeConfig.get() === undefined) database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    const now = clock.now().toISOString();
    const workflow = personLookupDescriptor.id;
    const slot = database.withAuthorityTransaction(repos => admitFixtureSlot(repos, workflow, 1, now));
    const { run } = seedPersonLookupExitRun(database);
    database.authority.evidenceReceipts.insert(receiptOf(run, 5));
    database.withAuthorityTransaction(repos => {
      const pool = repos.workerPools.get(workflow);
      if (pool === undefined) throw new Error("fixture worker pool missing");
      const plan = repos.workerPools.plan({ workflow, expectedVersion: pool.version, desiredWorkers: 0, requestedBy: "local-operator", now });
      if (plan.state !== "applied") throw new Error("fixture worker pool reset refused");
      repos.workerSlots.retire({ workerId: slot.workerId, now });
    });
    expect(database.authority.notificationPublications.list()).toEqual([]);

    const dashboard = await world.composeDashboardRuntime({ ...f.dashboardInput, lifetimeLock: f.lifetime, repoRoot,
      isolation: rebuildRuntimeIsolation, env: {}, frontend: "built-bundle", preflightRunnerFactory: healthyRuntimePreflightRunners });
    try {
      await expect.poll(() => database.authority.notificationPublications.list().map(row => row.event), { timeout: scaledMs(10_000) })
        .toContainEqual({ kind: "verified-done", runId: run.envelope.runId, workflowId: run.envelope.workflow });
    } finally { await dashboard.stop(); }
  } finally { await world.cleanup(); }
}, scaledMs(20_000));
