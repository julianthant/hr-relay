import { CLOCK, AFTER_NOW, testRoot, fixtureFor, admissionFor, openDatabase, restoreMissingTriggers, backupDirectory, createImportedTimelineFixtureWriter, emitQueuedSpan, createBackup } from "./storage-recovery-fixtures.js";
import { copyFileSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import * as readonlySnapshots from "../../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";
import { testRunService } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { COMMAND_FIXTURES, NOTIFICATION, NOW, UUID_7, UUID_8 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { DatabaseSync, StatementSync } from "node:sqlite";
import { describe, it, vi } from "vitest";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { AuthorityDatabase as RealAuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { SpanAuthorityRunRootSchema, doctorAuthorityStorage } from "../../../../src/backend/storage/sqlite/index.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import {
  QUEUED_RUN,
} from "../../../support/fixtures/phase1f-run-fixtures.js";

function spanAuthorityRoot(runInput: unknown = QUEUED_RUN) {
  const run = RunRecordSchema.parse(runInput);
  return SpanAuthorityRunRootSchema.parse({
    runId: run.envelope.runId,
    workflow: run.envelope.workflow,
    itemId: run.envelope.itemId,
    traceId: run.envelope.traceId,
    spanPath: run.envelope.traceId,
    parentRunId: run.envelope.parent?.runId,
    shape: run.envelope.shape,
    priority: run.envelope.priority,
    dryRun: run.envelope.dryRun,
    retryOf: run.envelope.retryOf,
    descriptorVersion: run.envelope.descriptorVersion,
    contractFingerprint: run.envelope.contractFingerprint,
    resolvedInstance: run.envelope.resolvedInstance,
    configFingerprint: run.envelope.configFingerprint,
    configSnapshotId: run.envelope.configSnapshotId,
    queuedAt: run.envelope.enqueuedAt,
    reconstructed: false,
    initialAttempt: run.envelope.attempt,
    finalAttempt: run.envelope.attempt,
    streamIssues: [],
  });
}

function inspectNativeSpanAuthorityReads<Result>(inspect: () => Result): Result {
  const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
  const exec = vi.spyOn(DatabaseSync.prototype, "exec");
  const readers = [vi.spyOn(StatementSync.prototype, "all"), vi.spyOn(StatementSync.prototype, "get"),
    vi.spyOn(StatementSync.prototype, "iterate"), vi.spyOn(StatementSync.prototype, "run")];
  try {
    const snapshot = inspect();
    const attemptedSql = [...prepare.mock.calls, ...exec.mock.calls].map(([sql]) => sql);
    const retiredSql = attemptedSql.filter(sql => /\b(?:archived_runs|workflow_runs)\b/iu.test(sql)
      || (/\bdeleted_runs\b/iu.test(sql) && /\brecord_(?:key|json)\b/iu.test(sql)));
    assert.deepEqual(retiredSql, [], "retired archive SQL");

    const sqlByStatement = new Map<StatementSync, string>();
    for (const [index, result] of prepare.mock.results.entries()) {
      const sql = prepare.mock.calls[index]?.[0];
      if (result.type === "return" && sql !== undefined) sqlByStatement.set(result.value, sql);
    }
    const executedSql = [...readers.flatMap(reader => reader.mock.contexts.map(statement => {
      assert.ok(statement instanceof StatementSync);
      const sql = sqlByStatement.get(statement);
      assert.ok(sql, "SQLite statement was prepared inside the inspection");
      return sql;
    })), ...exec.mock.calls.map(([sql]) => sql)];
    assert.deepEqual(executedSql.filter(sql => /\bFROM\s+runs\b|\bFROM\s+deleted_runs\s+WHERE\b/iu.test(sql)), [
      "SELECT * FROM runs ORDER BY id LIMIT 500",
      "SELECT * FROM deleted_runs WHERE run_id=?",
      "SELECT * FROM deleted_runs WHERE run_id=?",
      "SELECT * FROM runs ORDER BY id",
    ], "native span authority reads");
    return snapshot;
  } finally {
    for (const reader of readers) reader.mockRestore();
    exec.mockRestore();
    prepare.mockRestore();
  }
}

describe("fail-closed degraded boot and read-only doctor", () => {
  it("returns span resolutions with the authority identity from their read snapshot", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const database = openDatabase(authorityPath);
    database.authority.runs.enqueue(QUEUED_RUN);
    const authority = AuthorityDatabase.inspectExistingReadOnly(admissionFor(authorityPath), authorityPath);

    const snapshot = AuthorityDatabase.inspectSpanRunAuthorityReadOnly(
      admissionFor(authorityPath), authorityPath,
      [spanAuthorityRoot()],
    );

    assert.deepEqual(snapshot, {
      tombstoneOrdinalFindings: [],
      authorityGeneration: authority.authorityGeneration,
      authorityContentFingerprint: authority.authorityContentFingerprint,
      liveRunCount: 1,
      missingSpanRunIds: [],
      malformedRecords: [],
      resolutions: [{ state: "live", runId: QUEUED_RUN.envelope.runId }],
    });
  });

  it("uses native run and tombstone queries without retired archive SQL", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const database = openDatabase(authorityPath);
    const secondRun = RunRecordSchema.parse({
      ...QUEUED_RUN,
      envelope: {
        ...QUEUED_RUN.envelope,
        runId: UUID_7,
        itemId: UUID_8,
        traceId: "pl-170000-7777",
      },
    });
    database.authority.runs.enqueue(QUEUED_RUN);
    database.authority.runs.enqueue(secondRun);
    const snapshot = inspectNativeSpanAuthorityReads(() => AuthorityDatabase.inspectSpanRunAuthorityReadOnly(
      admissionFor(authorityPath), authorityPath,
      [spanAuthorityRoot(QUEUED_RUN), spanAuthorityRoot(secondRun)],
    ));
    assert.deepEqual(snapshot.resolutions.map(({ state }) => state), ["live", "live"]);
  });

  it.each(["queue", "storage"] as const)("resolves a span root whose run carries a %s tombstone as deleted", async (origin) => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const database = openDatabase(authorityPath);
    database.authority.runs.enqueue(QUEUED_RUN);
    const terminal = database.authority.runs.transition({
      runId: QUEUED_RUN.envelope.runId,
      expectedVersion: QUEUED_RUN.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW },
      now: NOW,
    });
    if (terminal.state !== "applied") throw new Error("delete fixture could not terminalize its run");
    if (origin === "queue") {
      database.authority.commands.insert({commandId:UUID_7,requestedAt:NOW,requestedBy:"local-operator",source:"queue",
        family:"run",type:"delete",target:{runId:QUEUED_RUN.envelope.runId,expectedVersion:terminal.run.version}});
      database.authority.runs.delete({
        runId: QUEUED_RUN.envelope.runId, origin, commandId: UUID_7, cascadeRunIds: [QUEUED_RUN.envelope.runId], now: NOW,
      });
    } else {
      assert.equal(testRunService(database, CLOCK).clearHistory({ commandId: UUID_7 }).state, "cleared");
    }

    const snapshot = AuthorityDatabase.inspectSpanRunAuthorityReadOnly(admissionFor(authorityPath), authorityPath, [spanAuthorityRoot()]);

    assert.equal(snapshot.liveRunCount, 0);
    assert.deepEqual(snapshot.missingSpanRunIds, []);
    assert.deepEqual(snapshot.malformedRecords, []);
    assert.deepEqual(snapshot.resolutions, [{
      state: "deleted",
      runId: QUEUED_RUN.envelope.runId,
      workflow: QUEUED_RUN.envelope.workflow,
      traceId: QUEUED_RUN.envelope.traceId,
      origin,
      commandId: UUID_7,
      deletedAt: NOW,
    }]);
  });

  it("refuses a tombstone whose stored record fails its strict schema", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const database = openDatabase(authorityPath);
    database.authority.runs.enqueue(QUEUED_RUN);
    const terminal = database.authority.runs.transition({
      runId: QUEUED_RUN.envelope.runId,
      expectedVersion: QUEUED_RUN.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW },
      now: NOW,
    });
    if (terminal.state !== "applied") throw new Error("delete fixture could not terminalize its run");
    database.authority.commands.insert({commandId:UUID_7,requestedAt:NOW,requestedBy:"local-operator",source:"queue",
      family:"run",type:"delete",target:{runId:QUEUED_RUN.envelope.runId,expectedVersion:terminal.run.version}});
    database.authority.runs.delete({
      runId: QUEUED_RUN.envelope.runId, origin: "queue", commandId: UUID_7, cascadeRunIds: [QUEUED_RUN.envelope.runId], now: NOW,
    });
    const raw = new DatabaseSync(authorityPath);
    // The tombstone is immutable in authority; only corruption below it can
    // produce this row, so the trigger is dropped to simulate exactly that.
    const deletedTrigger = raw.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND name='deleted_runs_identity'").all();
    raw.exec("DROP TRIGGER deleted_runs_identity");
    raw.prepare("UPDATE deleted_runs SET receipt_json = ? WHERE run_id = ?")
      .run(JSON.stringify({ family: "deleted" }), QUEUED_RUN.envelope.runId);
    restoreMissingTriggers(raw,deletedTrigger);
    raw.close();

    const snapshot = AuthorityDatabase.inspectSpanRunAuthorityReadOnly(admissionFor(authorityPath), authorityPath, [spanAuthorityRoot()]);

    assert.deepEqual(snapshot.resolutions, [{
      state: "malformed",
      runId: QUEUED_RUN.envelope.runId,
      table: "deleted_runs",
      summary: "deletion receipt failed native row or span identity validation",
    }]);
  });

  it("refuses a source commit during read-only snapshot inspection", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const database = openDatabase(authorityPath);
    const baseline = AuthorityDatabase.inspectExistingReadOnly(admissionFor(authorityPath), authorityPath);
    // Capture the unbound method before the probe; invoke it with its actual database receiver.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const nativePrepare = DatabaseSync.prototype.prepare;
    const observation = fixtureFor(root).machine.verifiedReadOnlyCopy(authorityPath, createHash("sha256").update(readFileSync(authorityPath)).digest("hex"));
    const createSnapshot = readonlySnapshots.createReadonlyAuthoritySnapshot;
    let targetSnapshotPath: string | undefined;
    const snapshotProbe = vi.spyOn(readonlySnapshots, "createReadonlyAuthoritySnapshot").mockImplementation(path => {
      const snapshot = createSnapshot(path);
      if (path === authorityPath && targetSnapshotPath === undefined) targetSnapshotPath = snapshot.path;
      return snapshot;
    });
    let injected = false;
    const probe = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function prepareWithCommit(
      this: DatabaseSync,
      sql: string,
    ) {
      if (!injected && targetSnapshotPath !== undefined && sql.startsWith("SELECT schema_version,authority_generation,updated_at")) {
        const source = nativePrepare.call(this, "PRAGMA database_list").all().find(row => row.name === "main");
        if (source?.file !== targetSnapshotPath) return nativePrepare.call(this, sql);
        injected = true;
        database.authority.notifications.create(NOTIFICATION);
      }
      return nativePrepare.call(this, sql);
    });
    try {
      assert.throws(() => AuthorityDatabase.inspectExistingReadOnly(observation, authorityPath), /authority-readonly-source-changed/);
      assert.equal(injected, true);
      assert.equal(database.getMeta().authorityGeneration, baseline.authorityGeneration + 1);
    } finally {
      probe.mockRestore(); snapshotProbe.mockRestore(); observation.release();
    }
  });

  it("refuses a missing span corpus when exact authority proves runs already exist", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const database = openDatabase(authorityPath);
    database.authority.runs.enqueue(QUEUED_RUN);

    const report = await doctorAuthorityStorage(admissionFor(root), {
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: backupDirectory(root),
      busyTimeoutMs: 100,
    }, CLOCK);

    assert.deepEqual(report.spanAuthority, {
      state: "degraded", streamRunCount: 0, liveRunCount: 0, deleted: [],
      problems: [{ state: "missing-span", runId: QUEUED_RUN.envelope.runId }],
    });
  });

  it("accepts a missing span corpus only for the exact never-produced authority baseline", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    openDatabase(authorityPath);

    const report = await doctorAuthorityStorage(admissionFor(root), {
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: backupDirectory(root),
      busyTimeoutMs: 100,
    }, CLOCK);

    assert.deepEqual(report.spanAuthority, {
      state: "reconciled",
      streamRunCount: 0,
      liveRunCount: 0,
      deleted: [],
    });
  });

  it("refuses a symlinked state-root parent before native evidence inspection", async () => {
    const root = await testRoot(); const admission = admissionFor(root);
    const authorityPath = join(root, "state.db"); openDatabase(authorityPath).close();
    const parent = dirname(root); const retained = parent + "-retained";
    renameSync(parent, retained); symlinkSync(retained, parent);
    const evidence = vi.spyOn(AuthorityDatabase, "inspectExistingReadOnly");
    const bytes = readFileSync(join(retained, root.slice(parent.length + 1), "state.db"));
    try {
      await assert.rejects(doctorAuthorityStorage(admission, {
        stateRootTrustAnchor: dirname(parent), stateRoot: root, authorityPath,
        backupDirectory: backupDirectory(root), busyTimeoutMs: 100,
      }, CLOCK), /directory-integrity: credential path ancestry contains a symbolic link/u);
      assert.equal(evidence.mock.calls.length, 0);
      assert.equal(readFileSync(authorityPath).equals(bytes), true);
    } finally { evidence.mockRestore(); rmSync(parent); renameSync(retained,parent); }
  });

  it("refuses an intermediate state-root component replaced by a symlink while the doctor awaits", async () => {
    const root = await testRoot(); const admission = admissionFor(root);
    const authorityPath = join(root, "state.db"); const database = openDatabase(authorityPath);
    database.authority.runs.enqueue(QUEUED_RUN); emitQueuedSpan(root);
    await createBackup(database, backupDirectory(root)); database.close();
    const parent = dirname(root); const retained = parent + "-retained";
    const pending = doctorAuthorityStorage(admission, {
      stateRootTrustAnchor: dirname(parent), stateRoot: root, authorityPath,
      backupDirectory: backupDirectory(root), busyTimeoutMs: 100,
    }, CLOCK);
    renameSync(parent,retained); symlinkSync(retained,parent);
    try { await assert.rejects(pending,/authority changed while the storage doctor awaited external evidence/); }
    finally { rmSync(parent); renameSync(retained,parent); }
  });

  it("refuses a doctor report assembled across different authority snapshots", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    await createBackup(database, directory);

    const pendingDoctor = doctorAuthorityStorage(admissionFor(root), {
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: directory,
      busyTimeoutMs: 100,
    }, CLOCK);
    database.authority.notifications.create(NOTIFICATION);

    await assert.rejects(
      pendingDoctor,
      /authority changed while the storage doctor awaited external evidence/,
    );
  });

  it("performs one broad authority inspection and one span snapshot per doctor run", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    openDatabase(authorityPath);
    const broadProbe = vi.spyOn(AuthorityDatabase, "inspectExistingReadOnly");
    const spanProbe = vi.spyOn(AuthorityDatabase, "inspectSpanRunAuthorityReadOnly");
    const identityProbe = vi.spyOn(AuthorityDatabase, "inspectAuthorityReadIdentityReadOnly");
    let broadCalls: number;
    let spanCalls: number;
    let identityCalls: number;
    try {
      const report = await doctorAuthorityStorage(admissionFor(root), {
        stateRootTrustAnchor: root,
        stateRoot: root,
        authorityPath,
        backupDirectory: backupDirectory(root),
        busyTimeoutMs: 100,
      }, CLOCK);
      assert.equal(report.authority.state, "healthy");
    } finally {
      broadCalls = broadProbe.mock.calls.length;
      spanCalls = spanProbe.mock.calls.length;
      identityCalls = identityProbe.mock.calls.length;
      broadProbe.mockRestore();
      spanProbe.mockRestore();
      identityProbe.mockRestore();
    }

    assert.equal(broadCalls, 1);
    assert.equal(spanCalls, 1);
    assert.equal(identityCalls, 1);
  });

  it("refuses a transient A-to-B-to-A authority swap during span resolution", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const originalPath = join(root, "backups", "authority-a.sqlite");
    const replacementPath = join(root, "replacement-authority.sqlite");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    database.authority.runs.enqueue(QUEUED_RUN);
    emitQueuedSpan(root);
    await createBackup(database, directory);
    database.close();
    copyFileSync(authorityPath, originalPath);
    copyFileSync(authorityPath, replacementPath);
    const replacement = new DatabaseSync(replacementPath);
    try {
      replacement.exec("BEGIN");
      replacement.prepare("INSERT INTO notifications(id,actor_id,dedupe_fingerprint,status,seen_count,version,run_id,payload_json,publications_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,'[]',?,?)")
        .run(NOTIFICATION.notificationId, NOTIFICATION.actorId, NOTIFICATION.dedupeFingerprint, NOTIFICATION.status,
          NOTIFICATION.count, NOTIFICATION.version, null, JSON.stringify(NOTIFICATION), NOTIFICATION.createdAt, NOTIFICATION.updatedAt);
      replacement.prepare("UPDATE database_states SET authority_generation=authority_generation+1,updated_at=?,search_state='invalid',search_generation=NULL WHERE id=1").run(NOW);
      replacement.exec("COMMIT");
    } finally { replacement.close(); }
    const inspectSpanAuthority = RealAuthorityDatabase.inspectSpanRunAuthorityReadOnly.bind(RealAuthorityDatabase);
    let restoredOriginal = false;
    const probe = vi.spyOn(RealAuthorityDatabase, "inspectSpanRunAuthorityReadOnly").mockImplementation(
      (admission, path, runIds, busyTimeoutMs) => {
        const snapshot = inspectSpanAuthority(admission, path, runIds, busyTimeoutMs);
        if (runIds.length > 0) {
          copyFileSync(originalPath, authorityPath);
          restoredOriginal = true;
        }
        return snapshot;
      },
    );
    try {
      const pendingDoctor = doctorAuthorityStorage(admissionFor(root), {
        stateRootTrustAnchor: root,
        stateRoot: root,
        authorityPath,
        backupDirectory: directory,
        busyTimeoutMs: 100,
      }, CLOCK);
      copyFileSync(replacementPath, authorityPath);

      await assert.rejects(
        pendingDoctor,
        /span authority snapshot does not match the storage doctor's initial authority identity/,
      );
      assert.equal(restoredOriginal, true);
    } finally {
      probe.mockRestore();
    }
  });

  it("refuses when an initially degraded authority changes during external verification", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const healthyPath = join(root, "healthy-authority.sqlite");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    await createBackup(database, directory);
    database.close();
    copyFileSync(authorityPath, healthyPath);
    writeFileSync(authorityPath, "corrupt authority before doctor");

    const pendingDoctor = doctorAuthorityStorage(admissionFor(root), {
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: directory,
      busyTimeoutMs: 100,
    }, CLOCK);
    copyFileSync(healthyPath, authorityPath);

    await assert.rejects(
      pendingDoctor,
      /authority changed while the storage doctor awaited external evidence/,
    );
  });

  it("preserves a failed final identity read as named transition evidence", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    openDatabase(authorityPath);
    const identityProbe = vi.spyOn(AuthorityDatabase, "inspectAuthorityReadIdentityReadOnly")
      .mockImplementation(() => {
        throw new Error("injected final authority identity read failure");
      });
    try {
      await assert.rejects(
        doctorAuthorityStorage(admissionFor(root), {
          stateRootTrustAnchor: root,
          stateRoot: root,
          authorityPath,
          backupDirectory: backupDirectory(root),
          busyTimeoutMs: 100,
        }, CLOCK),
        (error: unknown) => {
          if (!(error instanceof Error)) return false;
          assert.match(error.message, /initial=available; final=authority-unavailable/u);
          assert.ok(typeof error.cause === "object" && error.cause !== null);
          const final: unknown = Reflect.get(error.cause, "final");
          assert.ok(typeof final === "object" && final !== null);
          assert.equal(Reflect.get(final, "state"), "unavailable");
          const finalCause: unknown = Reflect.get(final, "cause");
          assert.ok(typeof finalCause === "object" && finalCause !== null);
          assert.equal(Reflect.get(finalCause, "summary"), "injected final authority identity read failure");
          return true;
        },
      );
    } finally {
      identityProbe.mockRestore();
    }
  });

  it("preserves both failed identity reads when degraded evidence changes", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    openDatabase(authorityPath);
    const broadProbe = vi.spyOn(AuthorityDatabase, "inspectExistingReadOnly")
      .mockImplementation(() => { throw new Error("injected broad authority read failure"); });
    const spanProbe = vi.spyOn(AuthorityDatabase, "inspectSpanRunAuthorityReadOnly")
      .mockImplementation(() => { throw new Error("injected span authority read failure"); });
    let identityRead = 0;
    const identityProbe = vi.spyOn(AuthorityDatabase, "inspectAuthorityReadIdentityReadOnly")
      .mockImplementation(() => {
        identityRead += 1;
        throw new Error(identityRead === 1
          ? "injected initial authority identity read failure"
          : "injected final authority identity read failure");
      });
    try {
      await assert.rejects(
        doctorAuthorityStorage(admissionFor(root), {
          stateRootTrustAnchor: root,
          stateRoot: root,
          authorityPath,
          backupDirectory: backupDirectory(root),
          busyTimeoutMs: 100,
        }, CLOCK),
        (error: unknown) => {
          if (!(error instanceof Error)) return false;
          assert.match(error.message, /initial=authority-unavailable; final=authority-unavailable/u);
          assert.ok(typeof error.cause === "object" && error.cause !== null);
          for (const [phase, expected] of [
            ["initial", "injected initial authority identity read failure"],
            ["final", "injected final authority identity read failure"],
          ] as const) {
            const read: unknown = Reflect.get(error.cause, phase);
            assert.ok(typeof read === "object" && read !== null);
            const readCause: unknown = Reflect.get(read, "cause");
            assert.ok(typeof readCause === "object" && readCause !== null);
            assert.equal(Reflect.get(readCause, "summary"), expected);
          }
          return true;
        },
      );
    } finally {
      broadProbe.mockRestore();
      spanProbe.mockRestore();
      identityProbe.mockRestore();
    }
  });

  it("names a span-known run missing from exact live and archived authority", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    openDatabase(authorityPath);
    emitQueuedSpan(root);

    const report = await doctorAuthorityStorage(admissionFor(root), {
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: backupDirectory(root),
      busyTimeoutMs: 100,
    }, CLOCK);

    assert.deepEqual(report.spanAuthority, {
      state: "degraded",
      streamRunCount: 1,
      liveRunCount: 0,
      deleted: [],
      problems: [{ state: "missing", runId: QUEUED_RUN.envelope.runId }],
    });
  });

  it("classifies priority drift in the exact live task tuple", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const database = openDatabase(authorityPath);
    database.authority.runs.enqueue(QUEUED_RUN);
    emitQueuedSpan(root, {
      ...QUEUED_RUN,
      envelope: { ...QUEUED_RUN.envelope, priority: "interactive" },
    });

    const report = await doctorAuthorityStorage(admissionFor(root), {
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: backupDirectory(root),
      busyTimeoutMs: 100,
    }, CLOCK);

    assert.equal(report.spanAuthority.state, "degraded");
    if (report.spanAuthority.state !== "degraded") throw new Error("live priority drift must degrade reconciliation");
    const problem = report.spanAuthority.problems[0];
    assert.equal(problem?.state, "malformed");
    if (problem?.state !== "malformed") throw new Error("expected live priority mismatch diagnosis");
    assert.equal(problem.table, "runs");
    assert.match(problem.summary, /priority "interactive" does not match runs authority "bulk"/);
  });

  it("classifies a full queued-root tuple that disagrees with its exact live authority", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const database = openDatabase(authorityPath);
    database.authority.runs.enqueue(QUEUED_RUN);
    emitQueuedSpan(root, {
      ...QUEUED_RUN,
      envelope: {
        ...QUEUED_RUN.envelope,
        workflow: "foreign-workflow",
        traceId: "fw-170001-1111",
        attempt: 2,
      },
    }, true);

    const report = await doctorAuthorityStorage(admissionFor(root), {
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: backupDirectory(root),
      busyTimeoutMs: 100,
    }, CLOCK);

    assert.equal(report.spanAuthority.state, "degraded");
    if (report.spanAuthority.state !== "degraded") throw new Error("foreign queued root must degrade reconciliation");
    assert.equal(report.spanAuthority.liveRunCount, 0);
    assert.equal(report.spanAuthority.problems.length, 1);
    const problem = report.spanAuthority.problems[0];
    assert.equal(problem?.state, "malformed");
    if (problem?.state !== "malformed") throw new Error("expected malformed full-tuple diagnosis");
    assert.equal(problem.table, "runs");
    assert.match(problem.summary, /workflow.*foreign-workflow.*person-lookup/);
    assert.match(problem.summary, /traceId.*fw-170001-1111.*pl-170000-2222/);
    assert.match(problem.summary, /finalAttempt 2.*runs authority 1/);
  });

  it("classifies a queued root whose span path is not its frozen trace root", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const database = openDatabase(authorityPath);
    database.authority.runs.enqueue(QUEUED_RUN);
    createImportedTimelineFixtureWriter({ stateRoot: root, clock: CLOCK, pid: 4242 }).emit({
      t: "run.queued",
      kind: "run",
      ts: QUEUED_RUN.envelope.enqueuedAt,
      workflow: QUEUED_RUN.envelope.workflow,
      runId: QUEUED_RUN.envelope.runId,
      attempt: QUEUED_RUN.envelope.attempt,
      traceId: QUEUED_RUN.envelope.traceId,
      spanPath: `${QUEUED_RUN.envelope.traceId}/foreign-root`,
      itemId: QUEUED_RUN.envelope.itemId,
      shape: QUEUED_RUN.envelope.shape,
      priority: QUEUED_RUN.envelope.priority,
      dryRun: QUEUED_RUN.envelope.dryRun,
      actorId: "local-operator",
      title: "malformed root path fixture",
      descriptorVersion: QUEUED_RUN.envelope.descriptorVersion,
      contractFingerprint: QUEUED_RUN.envelope.contractFingerprint,
      resolvedInstance: QUEUED_RUN.envelope.resolvedInstance,
      configFingerprint: QUEUED_RUN.envelope.configFingerprint,
      configSnapshotId: QUEUED_RUN.envelope.configSnapshotId,
    });

    const report = await doctorAuthorityStorage(admissionFor(root), {
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: backupDirectory(root),
      busyTimeoutMs: 100,
    }, CLOCK);

    assert.equal(report.spanAuthority.state, "degraded");
    if (report.spanAuthority.state !== "degraded") throw new Error("foreign root path must degrade reconciliation");
    const problem = report.spanAuthority.problems[0];
    assert.equal(problem?.state, "malformed");
    if (problem?.state !== "malformed") throw new Error("expected malformed root-path diagnosis");
    assert.equal(problem.table, "span_stream");
    assert.match(problem.summary, /root spanPath does not equal traceId/);
  });

  it("classifies task identity that does not remain beneath its exact queued root", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const database = openDatabase(authorityPath);
    database.authority.runs.enqueue(QUEUED_RUN);
    emitQueuedSpan(root);
    createImportedTimelineFixtureWriter({ stateRoot: root, clock: CLOCK, pid: 4242 }).emit({
      t: "span.started",
      kind: "task",
      ts: QUEUED_RUN.envelope.enqueuedAt,
      workflow: QUEUED_RUN.envelope.workflow,
      runId: QUEUED_RUN.envelope.runId,
      attempt: QUEUED_RUN.envelope.attempt,
      traceId: "pl-170003-9999",
      spanPath: "pl-170003-9999/foreign-task#1.1",
      parentSpanPath: "pl-170003-9999",
      name: "foreign-task",
    });

    const report = await doctorAuthorityStorage(admissionFor(root), {
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: backupDirectory(root),
      busyTimeoutMs: 100,
    }, CLOCK);

    assert.equal(report.spanAuthority.state, "degraded");
    if (report.spanAuthority.state !== "degraded") throw new Error("foreign task identity must degrade reconciliation");
    const problem = report.spanAuthority.problems[0];
    assert.equal(problem?.state, "malformed");
    if (problem?.state !== "malformed") throw new Error("expected malformed task-root diagnosis");
    assert.equal(problem.table, "span_stream");
    assert.match(problem.summary, /span\.started.*traceId.*does not match root/);
    assert.match(problem.summary, /spanPath is not beneath the run root spanPath/);
    assert.match(problem.summary, /parentSpanPath is outside the run root spanPath/);
  });

  it("classifies duplicate run.queued roots instead of collapsing them to one live run id", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const database = openDatabase(authorityPath);
    database.authority.runs.enqueue(QUEUED_RUN);
    emitQueuedSpan(root);
    emitQueuedSpan(root);

    const report = await doctorAuthorityStorage(admissionFor(root), {
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: backupDirectory(root),
      busyTimeoutMs: 100,
    }, CLOCK);

    assert.equal(report.spanAuthority.state, "degraded");
    if (report.spanAuthority.state !== "degraded") throw new Error("duplicate queued roots must degrade reconciliation");
    assert.equal(report.spanAuthority.streamRunCount, 2);
    assert.equal(report.spanAuthority.liveRunCount, 0);
    assert.equal(report.spanAuthority.problems.length, 2);
    for (const problem of report.spanAuthority.problems) {
      assert.equal(problem.state, "malformed");
      if (problem.state !== "malformed") throw new Error("expected duplicate-root malformed diagnosis");
      assert.equal(problem.table, "span_stream");
      assert.match(problem.summary, /duplicate run\.queued root/);
    }
  });

  it("classifies queued roots whose item attempts appear out of authority order", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const database = openDatabase(authorityPath);
    const laterRunId = "99999999-0009-4000-8000-999900000099";
    const laterRun = RunRecordSchema.parse({
      ...QUEUED_RUN,
      envelope: {
        ...QUEUED_RUN.envelope,
        runId: laterRunId,
        traceId: "pl-170002-9999",
        attempt: 2,
        enqueuedAt: AFTER_NOW,
      },
      version: 1,
      createdAt: AFTER_NOW,
      updatedAt: AFTER_NOW,
    });
    database.authority.runs.enqueue(QUEUED_RUN);
    database.authority.runs.enqueue(laterRun);
    emitQueuedSpan(root, laterRun);
    emitQueuedSpan(root, QUEUED_RUN);

    const report = await doctorAuthorityStorage(admissionFor(root), {
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: backupDirectory(root),
      busyTimeoutMs: 100,
    }, CLOCK);

    assert.equal(report.spanAuthority.state, "degraded");
    if (report.spanAuthority.state !== "degraded") throw new Error("out-of-order queued roots must degrade reconciliation");
    assert.equal(report.spanAuthority.streamRunCount, 2);
    const problem = report.spanAuthority.problems.find((problem) => "runId" in problem && problem.runId === QUEUED_RUN.envelope.runId);
    assert.equal(problem?.state, "malformed");
    if (problem?.state !== "malformed") throw new Error("expected out-of-order malformed diagnosis");
    assert.equal(problem.table, "span_stream");
    assert.match(problem.summary, /item attempt 1 did not strictly increase after 2/);
  });

  it("accepts a native requeue retaining the immutable run attempt", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const database = openDatabase(authorityPath);
    database.authority.runs.enqueue(QUEUED_RUN);
    emitQueuedSpan(root);
    createImportedTimelineFixtureWriter({ stateRoot: root, clock: CLOCK, pid: 4242 }).emit({
      t: "run.requeued",
      ts: QUEUED_RUN.envelope.enqueuedAt,
      workflow: QUEUED_RUN.envelope.workflow,
      runId: QUEUED_RUN.envelope.runId,
      attempt: QUEUED_RUN.envelope.attempt,
      traceId: QUEUED_RUN.envelope.traceId,
      spanPath: QUEUED_RUN.envelope.traceId,
      cause: "reassign",
      nextAttempt: QUEUED_RUN.envelope.attempt,
    });

    const report = await doctorAuthorityStorage(admissionFor(root), {
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: backupDirectory(root),
      busyTimeoutMs: 100,
    }, CLOCK);

    assert.deepEqual(report.spanAuthority,{state:"reconciled",streamRunCount:1,liveRunCount: 1, deleted:[]});
  });

  it("names malformed exact task authority instead of selecting another row", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const database = openDatabase(authorityPath);
    database.authority.runs.enqueue(QUEUED_RUN);
    emitQueuedSpan(root);
    const raw = new DatabaseSync(authorityPath);
    raw.prepare("UPDATE runs SET lifecycle_json = ? WHERE id = ?")
      .run(JSON.stringify({ malformed: true }), QUEUED_RUN.envelope.runId);
    raw.close();

    const report = await doctorAuthorityStorage(admissionFor(root), {
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: backupDirectory(root),
      busyTimeoutMs: 100,
    }, CLOCK);

    assert.equal(report.spanAuthority.state, "degraded");
    if (report.spanAuthority.state !== "degraded") throw new Error("malformed task authority must degrade reconciliation");
    assert.equal(report.spanAuthority.streamRunCount, 1);
    assert.equal(report.spanAuthority.liveRunCount, 0);
    assert.equal(report.spanAuthority.problems.length, 1);
    const problem = report.spanAuthority.problems[0];
    assert.equal(problem?.state, "malformed");
    if (problem?.state !== "malformed") throw new Error("expected exact malformed task diagnosis");
    assert.equal(problem.runId, QUEUED_RUN.envelope.runId);
    assert.equal(problem.table, "runs");
    assert.equal(problem.summary, "runs authority failed its strict native row validation");
  });
});
