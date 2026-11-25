import { CLOCK, AFTER_NOW, seedTerminalAuthority, testRoot, admissionFor, openDatabase, restoreMissingTriggers, backupDirectory, createBackup } from "./storage-recovery-fixtures.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { existsSync, readFileSync, truncateSync, utimesSync, writeFileSync } from "node:fs";
import { fenceWriteFixture } from "../../../support/helpers/write-fence-fixture.js";
import { ATOMIC_WRITE_COMMIT as HISTORICAL_ATOMIC_WRITE_COMMIT, COMMAND_FIXTURES, HASH_A, HASH_B, NOW, UUID_1, UUID_2, UUID_7, UUID_8, WRITE_ATTEMPT, WRITE_INTENT_ATTEMPTING } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { completionFromAuthorization } from "../../../../src/models/run/completion.js";
import { currentAtomicWriteFixture, atomicWriteCheckpoint, releaseSeededWriteOwners, seedAtomicWriteOwner } from "../../../support/helpers/timeline-write-fixture.js";
import assert from "node:assert/strict";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "vitest";
import {
  deriveRunResultDigest,
  deriveTerminalDependencyDigest,
} from "../../../../src/models/run/result.js";
import { RunRecordSchema, type RunRecord } from "../../../../src/models/run/record.js";
import { TerminalAuthorizationRecordSchema } from "../../../../src/models/run/terminal-authorization.js";
import { RUN_RECORD_JSON_SQL } from "../../../../src/backend/storage/sqlite/run-record-row.js";
import { storageHealthCauseOf } from "../../../../src/backend/storage/sqlite/storage-doctor.js";
import type { StorageHealthCause } from "../../../../src/models/storage/storage-status.js";
import { doctorAuthorityStorage } from "../../../../src/backend/storage/sqlite/index.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import {
  QUEUED_RUN,
} from "../../../support/fixtures/phase1f-run-fixtures.js";
import {
  CURRENT_AUTHORITY_SCHEMA_VERSION,
} from "../../../../src/backend/storage/sqlite/migrations.js";

const ATOMIC_WRITE_COMMIT = currentAtomicWriteFixture(HISTORICAL_ATOMIC_WRITE_COMMIT);
const SCHEMA_BOUND_VALUE = { schemaHash: HASH_A, value: { verified: true } };
const ARTIFACT_OUTBOX = {
  outboxId: UUID_7,
  artifactId: UUID_8,
  projectionId: "retention-record",
  stableKeyFingerprint: HASH_B,
  keyValues: [{ field: "subject", value: "10456712" }],
  sinkId: "xlsx-retention",
  sourceRunId: UUID_7,
  sourceNodeId: "extract",
  state: "pending",
  payload: SCHEMA_BOUND_VALUE,
  createdAt: NOW,
};

function corruptTerminalRun(
  path: string,
  runId: string,
  mutate: ((run: RunRecord) => unknown) | RunRecord,
): void {
  const raw = new DatabaseSync(path);
  const triggers = raw.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger'").all();
  try {
    // Model offline corruption after write-time guards have run while keeping
    // each strict record mismatch independent of an artificial version bump.
    raw.exec("DROP TRIGGER runs_completion_update; DROP TRIGGER runs_completion_immutable");
    const row = raw.prepare(`SELECT ${RUN_RECORD_JSON_SQL} AS record_json FROM runs WHERE id = ?`)
      .get(runId) as { record_json: string } | undefined;
    if (row === undefined) throw new Error(`run ${runId} is absent from corruption fixture`);
    const corrupted = typeof mutate === "function"
      ? mutate(RunRecordSchema.parse(JSON.parse(row.record_json))) as RunRecord
      : RunRecordSchema.parse(mutate);
    const ownerWorkerId = "workerId" in corrupted.lifecycle ? corrupted.lifecycle.workerId : null;
    const heartbeatAt = "heartbeatAt" in corrupted.lifecycle ? corrupted.lifecycle.heartbeatAt : null;
    const { envelope, ...lifecycle } = corrupted;
    raw.prepare(`UPDATE runs SET envelope_json=?, lifecycle_json=?,version=?,claim_generation=?,state=?,outcome=?,
      owner_worker_id=?,heartbeat_at=?,updated_at=? WHERE id=?`).run(JSON.stringify(envelope),JSON.stringify(lifecycle),
      corrupted.version,corrupted.claimGeneration,corrupted.lifecycle.state,
      corrupted.lifecycle.state === "terminal" ? corrupted.lifecycle.outcome : null,ownerWorkerId,heartbeatAt,corrupted.updatedAt,runId);
  } finally {
    restoreMissingTriggers(raw,triggers);
    raw.close();
  }
}

/** The health cause the classifier gives the error a read-only inspection of the file throws. */
function inspectionCause(path: string): StorageHealthCause {
  let failure: { error: unknown } | undefined;
  try { AuthorityDatabase.inspectExistingReadOnly(admissionFor(path), path); } catch (error) { failure = { error }; }
  if (failure === undefined) throw new Error(`expected ${path} to fail read-only inspection`);
  return storageHealthCauseOf(failure.error);
}

describe("fail-closed degraded boot and read-only doctor", () => {

  it("rejects NULL/nonterminal partial completion, failure and result settlements read-only", async () => {
    const terminalValue = { schemaHash: HASH_A, value: { complete: true } };
    const partialResult = {
      runId: QUEUED_RUN.envelope.runId,
      attempt: QUEUED_RUN.envelope.attempt,
      workflowId: QUEUED_RUN.envelope.workflow,
      descriptorVersion: QUEUED_RUN.envelope.descriptorVersion,
      contractFingerprint: QUEUED_RUN.envelope.contractFingerprint,
      configFingerprint: QUEUED_RUN.envelope.configFingerprint,
      configSnapshotId: QUEUED_RUN.envelope.configSnapshotId,
      resultSchemaHash: HASH_A,
      result: terminalValue,
      resultDigest: deriveRunResultDigest(terminalValue),
      dependencies: [],
      dependencyDigest: deriveTerminalDependencyDigest([]),
      createdAt: NOW,
    };
    const partialFailure = {
      failureId: UUID_8,
      fingerprint: HASH_B,
      runId: QUEUED_RUN.envelope.runId,
      traceId: QUEUED_RUN.envelope.traceId,
      attempt: QUEUED_RUN.envelope.attempt,
      workflowId: QUEUED_RUN.envelope.workflow,
      code: "UNEXPECTED_PAGE_STATE",
      summary: "The terminal failure transition is missing",
      transient: false,
      writeState: "not-attempted",
      causeChain: [{
        code: "UNEXPECTED_PAGE_STATE",
        summary: "The terminal failure transition is missing",
        role: "primary",
        transient: false,
      }],
      remediation: [{ kind: "code-change", message: "Repair the partial settlement" }],
      occurredAt: NOW,
    };
    const partialAuthorization = {
      kind: "failed",
      runId: QUEUED_RUN.envelope.runId,
      workflowId: QUEUED_RUN.envelope.workflow,
      attempt: QUEUED_RUN.envelope.attempt,
      descriptorVersion: QUEUED_RUN.envelope.descriptorVersion,
      contractFingerprint: QUEUED_RUN.envelope.contractFingerprint,
      expectedVersion: QUEUED_RUN.version,
      claim: { workerId: "worker-1", claimGeneration: 1 },
      authorizedAt: NOW,
      failureId: partialFailure.failureId,
    };
    const cases = [
      {
        name: "completion",
        insert: (raw: DatabaseSync) => {
          raw.exec("DROP TRIGGER runs_completion_update; DROP TRIGGER runs_completion_immutable");
          return raw.prepare("UPDATE runs SET lifecycle_json=json_set(lifecycle_json,'$.completion',json(?))")
            .run(JSON.stringify(completionFromAuthorization(TerminalAuthorizationRecordSchema.parse(partialAuthorization))));
        },
        violation: /authority table runs failed native record validation.*|completion/,
      },
      {
        name: "failure",
        insert: (raw: DatabaseSync) => raw.prepare(`
          INSERT INTO run_failures (id, run_id, fingerprint, code, payload_json, resolution_json, resolution_version, created_at)
          VALUES (?, ?, ?, 'UNEXPECTED_PAGE_STATE', ?, '{"status":"unresolved","version":1}', 1, ?)
        `).run(
          partialFailure.failureId,
          partialFailure.runId,
          partialFailure.fingerprint,
          JSON.stringify(partialFailure),
          NOW,
        ),
        violation: /failures-bind-failed-run/,
      },
      {
        name: "result",
        insert: (raw: DatabaseSync) => {
          const owner = RunRecordSchema.parse({ ...QUEUED_RUN, claimGeneration: 1, version: QUEUED_RUN.version + 1, updatedAt: NOW,
            lifecycle: { state: "terminal", outcome: "done", endedAt: NOW }, completion: { schemaVersion: 1, kind: "done",
              expectedVersion: QUEUED_RUN.version, claim: partialAuthorization.claim, authorizedAt: NOW, resultDigest: partialResult.resultDigest } });
          return raw.prepare(`INSERT INTO run_results (id,run_id,settlement_version,terminal_run_json,workflow,attempt,result_digest,payload_json,created_at)
            VALUES(?,?,?,?,?,?,?,?,?)`).run(`${partialResult.runId}:${owner.version}`,partialResult.runId,owner.version,
              canonicalJsonStringify(owner),partialResult.workflowId,partialResult.attempt,partialResult.resultDigest,JSON.stringify(partialResult),NOW);
        },
        violation: /run-settlement-owner-mismatch/,
      },
    ] as const;

    for (const fixture of cases) {
      const path = join(await testRoot(), "state.db");
      const database = openDatabase(path);
      database.authority.runs.enqueue(QUEUED_RUN);
      database.close();
      const raw = new DatabaseSync(path);
      const triggers = raw.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger'").all();
      fixture.insert(raw);
      restoreMissingTriggers(raw,triggers);
      raw.close();
      assert.throws(
        () => AuthorityDatabase.inspectExistingReadOnly(admissionFor(path), path),
        fixture.violation,
        fixture.name,
      );
    }
  });

  it("degrades read-only for every schema-valid authorization/consequence mismatch in both arms", async () => {
    const commonCases: ReadonlyArray<readonly [string, (run: RunRecord) => unknown]> = [
      ["version", (run) => ({ ...run, version: run.version + 1 })],
      ["claim-generation", (run) => ({ ...run, claimGeneration: run.claimGeneration + 1 })],
      ["lifecycle-state", (run) => ({ ...run, lifecycle: { state: "queued" } })],
      ["outcome", (run) => ({
        ...run,
        lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW },
      })],
      ["ended-at", (run) => ({
        ...run,
        lifecycle: run.lifecycle.state === "terminal"
          ? { ...run.lifecycle, endedAt: AFTER_NOW }
          : run.lifecycle,
      })],
      ["updated-at", (run) => ({ ...run, updatedAt: AFTER_NOW })],
    ];
    const arms = [
      {
        name: "failed",
        runId: UUID_1,
        cases: [
          ...commonCases,
          ["failure-id", (run: RunRecord): unknown => ({
            ...run,
            lifecycle: run.lifecycle.state === "terminal"
              ? { ...run.lifecycle, failureId: UUID_7 }
              : run.lifecycle,
          })] as const,
        ],
      },
      { name: "done", runId: UUID_2, cases: commonCases },
    ] as const;

    for (const arm of arms) {
      const path = join(await testRoot(), "state.db");
      const database = openDatabase(path);
      seedTerminalAuthority(database);
      const originalRun = database.authority.runs.get(arm.runId);
      assert.ok(originalRun);
      database.close();
      corruptTerminalRun(path, arm.runId, originalRun);
      const baseline = AuthorityDatabase.inspectExistingReadOnly(admissionFor(path), path);
      const assertBaseline = (): void => {
        const current = AuthorityDatabase.inspectExistingReadOnly(admissionFor(path), path);
        assert.equal(current.authorityGeneration, baseline.authorityGeneration);
        assert.equal(current.authorityContentFingerprint, baseline.authorityContentFingerprint);
        assert.deepEqual(current.counts, baseline.counts);
        assert.deepEqual(current.tables, baseline.tables);
      };
      for (const [name, mutate] of arm.cases) {
        assertBaseline();
        corruptTerminalRun(path, arm.runId, mutate);
        assert.throws(
          () => AuthorityDatabase.inspectExistingReadOnly(admissionFor(path), path),
          /completion|strict|schema|native record validation/,
          `${arm.name}/${name}`,
        );
        const cause = inspectionCause(path);
        assert.ok(["authority-invariant", "authority-record-invalid"].includes(cause.code), `${arm.name}/${name}: ${cause.code}`);
        assert.match(cause.summary, /completion|strict|schema|native record validation/);
        corruptTerminalRun(path, arm.runId, originalRun);
        assertBaseline();
      }
    }
  });

  it("protects every completion field and detects offline consequence corruption", async () => {
    for (const arm of [{ runId: UUID_1, kind: "failed" }, { runId: UUID_2, kind: "done" }]) {
      const path = join(await testRoot(), "state.db");
      const database = openDatabase(path); const seeded = seedTerminalAuthority(database); database.close();
      const raw = new DatabaseSync(path);
      const triggers = raw.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger'").all();
      try {
        for (const [field, value] of [
          ["claim.workerId", "worker-corrupt"], ["expectedVersion", 99], ["authorizedAt", AFTER_NOW],
          [arm.kind === "done" ? "resultDigest" : "failureId", arm.kind === "done" ? HASH_B : UUID_7],
        ] as const) {
          const before = raw.prepare("SELECT lifecycle_json FROM runs WHERE id=?").get(arm.runId);
          assert.throws(() => raw.prepare("UPDATE runs SET lifecycle_json=json_set(lifecycle_json,?,?) WHERE id=?")
            .run(`$.completion.${field}`, value, arm.runId), /completion/);
          assert.deepEqual(raw.prepare("SELECT lifecycle_json FROM runs WHERE id=?").get(arm.runId), before);
        }
        raw.exec("DROP TRIGGER runs_completion_update; DROP TRIGGER runs_completion_immutable");
        if (arm.kind === "done") {
          raw.prepare("UPDATE runs SET lifecycle_json=json_set(lifecycle_json,'$.completion.resultDigest',?) WHERE id=?").run(HASH_B, arm.runId);
        } else {
          raw.exec("DROP TRIGGER run_failures_evidence");
          raw.prepare("UPDATE run_failures SET payload_json=json_set(payload_json,'$.summary','Changed summary') WHERE id=?").run(seeded.failure.failureId);
        }
      } finally { restoreMissingTriggers(raw,triggers); raw.close(); }
      assert.throws(() => AuthorityDatabase.inspectExistingReadOnly(admissionFor(path), path), /run-completion|native record validation|strict|schema/);
    }
    const path = join(await testRoot(), "state.db"); const database = openDatabase(path); database.close();
    const raw = new DatabaseSync(path);
    try { for (const table of ["run_terminal_authorizations", "run_terminal_outbox"]) assert.throws(() => raw.prepare(`SELECT * FROM ${table}`), /no such table/); }
    finally { raw.close(); }
  });

  it("classifies corrupt, truncated, newer, foreign-key-invalid, invariant-invalid, and record-invalid files without modifying them", async () => {
    const root = await testRoot(), path = join(root, "state.db");
    openDatabase(path).close();
    const baseline = readFileSync(path);
    const assertClosedCompanions = () => {
      for (const suffix of ["-wal", "-shm", "-journal"]) assert.equal(existsSync(path + suffix), false);
    };
    assertClosedCompanions();
    const corruptions: ReadonlyArray<readonly [string, () => void]> = [
      ["authority-not-sqlite", () => { writeFileSync(path, "not a sqlite database"); }],
      ["authority-corrupt", () => { truncateSync(path, 128); }],
      ["authority-schema-mismatch", () => {
        const newer = new DatabaseSync(path);
        try { newer.exec(`PRAGMA user_version = ${String(CURRENT_AUTHORITY_SCHEMA_VERSION + 1)}`); }
        finally { newer.close(); }
      }],
      ["authority-foreign-key", () => {
        const badForeignKey = new DatabaseSync(path, { enableForeignKeyConstraints: false });
        try {
          badForeignKey.prepare(`
            INSERT INTO command_audits (id, command_id, payload_json, created_at)
            VALUES (?, ?, ?, ?)
          `).run(UUID_2, UUID_8, JSON.stringify({ invalid: "but valid JSON" }), NOW);
        } finally { badForeignKey.close(); }
      }],
      ["authority-record-invalid", () => {
        const invariantDatabase = openDatabase(path);
        try { invariantDatabase.authority.commands.insert(COMMAND_FIXTURES[0]); }
        finally { invariantDatabase.close(); }
        const badInvariant = new DatabaseSync(path);
        try { badInvariant.prepare("UPDATE commands SET family = ? WHERE id = ?").run("run", UUID_1); }
        finally { badInvariant.close(); }
      }],
      ["authority-record-invalid", () => {
        const recordSchemaDatabase = openDatabase(path);
        try {
          fenceWriteFixture(recordSchemaDatabase, { intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT }, path);
          releaseSeededWriteOwners(recordSchemaDatabase, CLOCK.now().toISOString());
        } finally { recordSchemaDatabase.close(); }
        const badRecordSchema = new DatabaseSync(path);
        try {
          badRecordSchema.prepare("UPDATE write_intents SET payload_json = ? WHERE id = ?")
            .run(JSON.stringify({ status: "attempting" }), WRITE_INTENT_ATTEMPTING.writeIntentId);
        } finally { badRecordSchema.close(); }
      }],
    ];
    for (const [expectedCode, corrupt] of corruptions) {
      assertClosedCompanions();
      writeFileSync(path, baseline);
      assert.deepEqual(readFileSync(path), baseline);
      corrupt();
      assertClosedCompanions();
      const before = readFileSync(path);
      assert.equal(inspectionCause(path).code, expectedCode, path);
      assert.deepEqual(readFileSync(path), before, `${path} was modified during inspection`);
      assertClosedCompanions();
    }
    const doctorPath = path;
    const beforeDoctor = readFileSync(doctorPath);
    const doctor = await doctorAuthorityStorage(admissionFor(root), {
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath: doctorPath,
      backupDirectory: backupDirectory(root),
      busyTimeoutMs: 100,
    }, CLOCK);
    assert.equal(doctor.authority.state, "degraded");
    if (doctor.authority.state !== "degraded") throw new Error("record-invalid authority must degrade doctor");
    assert.equal(doctor.authority.cause.code, "authority-record-invalid");
    assert.deepEqual(readFileSync(doctorPath), beforeDoctor);
  });

  it("reports counts, backup freshness/gap, candidates, and a newer bad manifest without mutation", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    fenceWriteFixture(database, { intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT }, authorityPath);
    seedAtomicWriteOwner(database, ATOMIC_WRITE_COMMIT, authorityPath);
    database.commitWriteAttempt(ATOMIC_WRITE_COMMIT, atomicWriteCheckpoint(ATOMIC_WRITE_COMMIT));
    database.authority.artifactOutbox.insert({...ARTIFACT_OUTBOX,sourceRunId:ATOMIC_WRITE_COMMIT.transaction.runId});
    await createBackup(database, directory);
    const generationBeforeDoctor = database.getMeta().authorityGeneration;
    const report = await doctorAuthorityStorage(admissionFor(root), {
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: directory,
      busyTimeoutMs: 100,
    }, CLOCK);
    assert.equal(report.mode, "read-only");
    assert.equal(report.authority.state, "healthy");
    assert.equal(report.backup.state, "current");
    assert.equal(report.counts.state, "available");
    if (report.counts.state !== "available") throw new Error("doctor counts should be available");
    assert.deepEqual(report.counts.values, {
      pendingCommands: 1,
      unresolvedWriteIntents: 0,
      providerReservations: 0,
      artifactOutbox: 1,
    });
    assert.equal(report.restoreCandidates.length, 1);
    assert.equal(database.getMeta().authorityGeneration, generationBeforeDoctor);

    const newestBadPath = join(directory, "newest-bad.manifest.json");
    writeFileSync(newestBadPath, "{ definitely-not-json");
    const future = new Date("2030-08-01T00:00:00.000Z");
    utimesSync(newestBadPath, future, future);
    const badReport = await doctorAuthorityStorage(admissionFor(root), {
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: directory,
      busyTimeoutMs: 100,
    }, CLOCK);
    assert.equal(badReport.backup.state, "invalid");
    assert.equal(badReport.restoreCandidates[0].state, "invalid");
  });

  it("reports a verified restore candidate even when the live authority becomes corrupt", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    await createBackup(database, directory);
    database.close();
    writeFileSync(authorityPath, "corrupted after verified backup");
    const report = await doctorAuthorityStorage(admissionFor(root), {
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: directory,
      busyTimeoutMs: 100,
    }, CLOCK);
    assert.equal(report.authority.state, "degraded");
    assert.equal(report.counts.state, "unavailable");
    assert.equal(report.restoreCandidates.some(({ state }) => state === "verified-compatible"), true);
  });
});
