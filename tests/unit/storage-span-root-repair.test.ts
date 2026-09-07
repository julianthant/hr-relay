import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import { RunRecordSchema } from "../../src/domain/run/record.js";
import { createSpanJsonlWriter } from "../../src/infra/events/span-jsonl-writer.js";
import { SpanEventWireSchema } from "../../src/events/types.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/authority-database.js";
import { RecoveryStopProofStore } from "../../src/infra/sqlite/recovery-stop-proof.js";
import { observeRuntimeLockSnapshot } from "../../src/infra/sqlite/runtime-process-locks.js";
import { doctorAuthorityStorage } from "../../src/infra/sqlite/storage-doctor.js";
import { OfflineSpanRootRepairService } from "../../src/server/storage/span-root-repair.js";
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
  } finally {
    database.close();
  }
  createSpanJsonlWriter({ stateRoot, clock, pid: 4242 }).emit({
    t: "run.claimed",
    ts: LATER,
    workflow: run.envelope.workflow,
    runId: run.envelope.runId,
    attempt: run.envelope.attempt,
    traceId: run.envelope.traceId,
    spanPath: run.envelope.traceId,
    workerId: "worker-1",
  });
  const streamPath = join(stateRoot, "spans", `${run.envelope.workflow}-${NOW.slice(0, 10)}.jsonl`);
  const sourceDatabaseIdentity = AuthorityDatabase.sourceDatabaseIdentity(authorityPath);
  const snapshot = observeRuntimeLockSnapshot({ processLockRoot, sourceDatabaseIdentity }, clock);
  const proofs = new RecoveryStopProofStore({ processLockRoot, maxProofAgeMs: 300_000 }, clock);
  proofs.recordRuntimeState(snapshot);
  const stoppedSystemProof = proofs.issue({ observedBy: "local-operator", sourceDatabaseIdentity });
  const service = new OfflineSpanRootRepairService({
    stateRoot,
    authorityPath,
    processLockRoot,
    stoppedProofMaxAgeMs: 300_000,
    busyTimeoutMs: 500,
  }, clock);
  return { repoRoot, stateRoot, authorityPath, processLockRoot, clock, run, streamPath, service, stoppedSystemProof };
}

describe("offline missing run.queued recovery", () => {
  it("appends one authority-derived marked root without changing prior stream bytes", async () => {
    const f = fixture();
    const before = readFileSync(f.streamPath);
    const report = f.service.repair({ runId: f.run.envelope.runId, stoppedSystemProof: f.stoppedSystemProof });
    assert.equal(report.state, "repaired");
    const after = readFileSync(f.streamPath);
    assert.deepEqual(after.subarray(0, before.byteLength), before);
    const appended = SpanEventWireSchema.parse(
      JSON.parse(after.subarray(before.byteLength).toString("utf8")),
    );
    if (appended.t !== "run.queued" || appended.repair === undefined) {
      throw new Error("span root repair did not append its marked run.queued event");
    }
    assert.equal(appended.t, "run.queued");
    assert.equal(appended.pid, process.pid);
    assert.equal(appended.repair.kind, "authority-reconstruction");
    assert.equal(appended.repair.priorStreamBytes, before.byteLength);
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
