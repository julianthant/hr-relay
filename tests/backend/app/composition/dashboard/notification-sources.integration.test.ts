import { createNotificationCompositionTestWorld } from "../../../../support/helpers/backend/notification-composition-world.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../../../src/models/failures/error-catalog.js";
import { describe, expect, it } from "vitest";
import { readNotificationSources } from "../../../../../src/backend/app/composition/dashboard/notification-sources.js";
import { createTrustNotifications } from "../../../../../src/backend/app/composition/dashboard/notifications.js";
import { RunRecordService } from "../../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createNotificationObserver } from "../../../../../src/backend/runs/notifications/observation.js";
import type { RunRecord } from "../../../../../src/models/run/record.js";
import { sequentialIdFactory } from "../../../../support/fixtures/phase1f-run-fixtures.js";
import { seedPersonLookupExitRun } from "../../../../support/fixtures/receipt-run-fixtures.js";
import { cleanReceiptOf, failureRecordOf, runRecordOf } from "../../../../support/helpers/backend/dashboard-harness.js";
import { personLookupDescriptor } from "../../../../support/helpers/registered-workflows.js";
import { AuthorityDatabase } from "../../../../support/helpers/synthetic-storage-admission.js";

const { fixture, seedRun } = createNotificationCompositionTestWorld();


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
      expect(formatErrorCatalogFailure(createErrorCatalogFailure("NOTIFICATION_RECEIPT_MISSING", {})).text).toMatch(/receipt/i);
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
  } finally { f.close(); }
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
  } finally { f.close(); }
});
