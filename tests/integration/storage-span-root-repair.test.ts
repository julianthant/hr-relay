import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import { RunRecordSchema } from "../../src/domain/run/record.js";
import { createTimelineEmitter } from "../../src/backend/storage/events/timeline-emitter.js";
import { SpanEventWireSchema } from "../../src/domain/events/types.js";
import { AuthorityDatabase, syntheticStateRoot } from "../helpers/synthetic-storage-admission.js";
import { RecoveryStopProofStore } from "../../src/backend/storage/sqlite/recovery-stop-proof.js";
import { observeRuntimeLockSnapshot } from "../../src/backend/storage/sqlite/runtime-process-locks.js";
import { doctorAuthorityStorage } from "../helpers/synthetic-storage-admission.js";
import { OfflineSpanRootRepairService } from "../../src/backend/runs/recovery/span-root-repair.js";
import {
  LATER,
  NOW,
  UUID_1,
} from "../fixtures/phase1c-contract-fixtures.js";
import {
  QUEUED_RUN,
  RUN_SESSION,
  RUN_SESSION_ID,
  START_PLAN,
} from "../fixtures/phase1f-run-fixtures.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-span-root-repair-"));
  roots.push(repoRoot);
  const stateRoot = join(repoRoot, ".tracker");
  mkdirSync(stateRoot);
  const authorityPath = join(stateRoot, "state.db");
  const processLockRoot = join(stateRoot, "locks");
  const clock = manualClock(new Date(NOW));
  const database = AuthorityDatabase.open({
    path: authorityPath,
    busyTimeoutMs: 500,
    migrationOwner: "span-root-repair-test",
  }, clock);
  const run = RunRecordSchema.parse({ ...QUEUED_RUN, sessionId: RUN_SESSION_ID });
  try {
    database.authority.startPlans.create(START_PLAN);
    const consumed = database.authority.startPlans.consume({
      startPlanId: START_PLAN.startPlanId,
      expectedVersion: START_PLAN.version,
      commandId: UUID_1,
      descriptorFingerprint: START_PLAN.descriptorFingerprint,
      configFingerprint: START_PLAN.configFingerprint,
      ingressSchemaHash: START_PLAN.ingressSchemaHash,
      canonicalInputSchemaHash: START_PLAN.canonicalInputSchemaHash,
      inputFingerprint: START_PLAN.inputFingerprint,
      now: NOW,
    });
    assert.equal(consumed.state, "consumed");
    database.authority.runSessions.insert(RUN_SESSION);
    database.authority.runs.enqueue(run);
  } catch (error) { database.close(); throw error; }
  createTimelineEmitter({ repository: database.authority.timelineEvents, clock, pid: 4242 }).emit({
    t: "run.claimed",
    ts: LATER,
    workflow: run.envelope.workflow,
    runId: run.envelope.runId,
    attempt: run.envelope.attempt,
    traceId: run.envelope.traceId,
    spanPath: run.envelope.traceId,
    workerId: "worker-1",
  });
  database.close();
  const sourceDatabaseIdentity = AuthorityDatabase.sourceDatabaseIdentity(authorityPath);
  const snapshot = observeRuntimeLockSnapshot({ processLockRoot, sourceDatabaseIdentity }, clock);
  const proofs = new RecoveryStopProofStore({ processLockRoot, maxProofAgeMs: 300_000 }, clock);
  proofs.recordRuntimeState(snapshot);
  const stoppedSystemProof = proofs.issue({ observedBy: "local-operator", sourceDatabaseIdentity });
  const service = new OfflineSpanRootRepairService(syntheticStateRoot(stateRoot),{
    stateRoot,
    authorityPath,
    processLockRoot,
    stoppedProofMaxAgeMs: 300_000,
    busyTimeoutMs: 500,
  }, clock);
  return { repoRoot, stateRoot, authorityPath, processLockRoot, clock, run, service, stoppedSystemProof };
}

describe("offline missing run.queued recovery", () => {
  it("appends one authority-derived marked SQLite root without changing prior records", async () => {
    const f = fixture();
    const read = () => {
      const db = AuthorityDatabase.open({ path: f.authorityPath, busyTimeoutMs: 500, migrationOwner: "repair-verifier" }, f.clock);
      try { return db.authority.timelineEvents.page({}); } finally { db.close(); }
    };
    const before = read();
    const report = f.service.repair({ runId: f.run.envelope.runId, stoppedSystemProof: f.stoppedSystemProof });
    assert.equal(report.state, "repaired");
    const after = read();
    assert.deepEqual(after.slice(0, before.length), before);
    assert.equal(after.length, before.length + 1);
    const payload = after.at(-1)?.payload;
    if (payload?.kind !== "span") throw new Error("missing repaired span");
    const appended = SpanEventWireSchema.parse(payload.event);
    if (appended.t !== "run.queued" || appended.repair?.kind !== "timeline-authority-reconstruction") {
      throw new Error("timeline root repair did not append its marked run.queued event");
    }
    assert.equal(appended.pid, process.pid);
    assert.equal(appended.repair.priorCursor, before.at(-1)?.cursor);
    assert.equal(appended.title, START_PLAN.planned[0]?.title);

    const doctor = await doctorAuthorityStorage({
      stateRootTrustAnchor: f.repoRoot,
      stateRoot: f.stateRoot,
      authorityPath: f.authorityPath,
      backupDirectory: join(f.stateRoot, "backups"),
      maxBackupAgeMs: 60_000,
      busyTimeoutMs: 500,
    }, f.clock);
    assert.equal(doctor.spanAuthority.state, "reconciled");
  });

  it("refuses when a required start-plan authority binding is absent", () => {
    const f = fixture();
    const database = AuthorityDatabase.open({
      path: f.authorityPath,
      busyTimeoutMs: 500,
      migrationOwner: "span-root-repair-test-mutate",
    }, f.clock);
    try {
      // A different run has no session/plan chain. The repair must not infer a
      // title or actor from the span stream.
      const orphan = RunRecordSchema.parse({
        ...QUEUED_RUN,
        envelope: {
          ...QUEUED_RUN.envelope,
          runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          itemId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          traceId: "pl-170001-aaaa",
        },
      });
      database.authority.runs.enqueue(orphan);
    } finally {
      database.close();
    }
    // The stopped proof excludes runtime writers; reconstruction still refuses
    // because no authoritative session/plan chain can supply actor and title.
    assert.throws(
      () => f.service.repair({
        runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        stoppedSystemProof: f.stoppedSystemProof,
      }),
      /has no durable run session/u,
    );
  });
});
