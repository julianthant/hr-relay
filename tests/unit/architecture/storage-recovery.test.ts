import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs, {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it, vi } from "vitest";
import { buildRunResult } from "../../../src/core/run-result.js";
import { manualClock } from "../../../src/domain/clock.js";
import { ReadActiveStatus } from "../../../src/domain/contracts/person-lookup/read-active-status.js";
import { executePreflightRunner } from "../../../src/domain/preflight.js";
import {
  deriveRunResultDigest,
  deriveTerminalDependencyDigest,
} from "../../../src/domain/run/result.js";
import { RunRecordSchema, type RunRecord } from "../../../src/domain/run/record.js";
import { deriveSchemaHash } from "../../../src/domain/schema-bound-value.js";
import { TerminalAuthorizationRecordSchema } from "../../../src/domain/run/terminal-authorization.js";
import { FailureRecordSchema } from "../../../src/domain/trust/failure.js";
import { RunCheckpointRecordSchema } from "../../../src/domain/workflow/checkpoint.js";
import { createSpanJsonlWriter } from "../../../src/infra/events/span-jsonl-writer.js";
import {
  AuthorityBackupService,
  AuthorityBootStore,
  AuthorityDatabase,
  AuthorityHealthPreflightRunner,
  AuthorityMutationUnavailableError,
  OfflineAuthorityRestoreService,
  OfflineRestoreFailure,
  RecoveryStopProofStore,
  doctorAuthorityStorage,
  verifyBackupManifestAtPath,
} from "../../../src/infra/sqlite/index.js";
import {
  acquireRuntimeProcessLock,
  acquireRuntimeRestoreAdmission,
  observeRuntimeLockSnapshot,
} from "../../../src/infra/sqlite/runtime-process-locks.js";
import {
  ATOMIC_WRITE_COMMIT,
  COMMAND_FIXTURES,
  HASH_A,
  HASH_B,
  NOTIFICATION,
  NOW,
  UUID_1,
  UUID_2,
  UUID_3,
  UUID_7,
  UUID_8,
  WRITE_ATTEMPT,
  WRITE_INTENT_ATTEMPTING,
} from "../fixtures/phase1c-contract-fixtures.js";
import {
  QUEUED_RUN,
  WORKER_START_REQUEST,
} from "../fixtures/phase1f-run-fixtures.js";
import {
  ARCHIVED_RUN,
  VERSION_BUMP_APPLICATION,
  VERSION_PLAN_ROW,
} from "../fixtures/archive-fixtures.js";
import {
  CURRENT_AUTHORITY_SCHEMA_VERSION,
  SQLITE_MIGRATIONS,
} from "../../../src/infra/sqlite/migrations.js";
import {
  PersonLookupCanonicalInput,
  personLookupDescriptor,
} from "../../../src/workflows/person-lookup/descriptor.js";
import { gitVisibleFiles, REPO_ROOT } from "./helpers/guard-files.js";

const roots: string[] = [];
const databases: AuthorityDatabase[] = [];
const bootStores: AuthorityBootStore[] = [];
const CLOCK = manualClock(new Date(NOW));
const AFTER_NOW = "2026-07-31T17:01:00.000Z";
const SCHEMA_BOUND_VALUE = { schemaHash: HASH_A, value: { verified: true } };
const PROJECTION_RECORD = { projectionKey: HASH_A, payload: SCHEMA_BOUND_VALUE, updatedAt: NOW };
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
const ACTIVE_STATUS = {
  state: "active" as const,
  reason: "UCPath reports an active HDH appointment and CRM onboarding is complete",
  hdh: true,
};

function runningTerminalFixture(
  database: AuthorityDatabase,
  runId: string,
  itemId: string,
  traceId: string,
  nodeId: "active-status" | "crm-dates",
) {
  const workerId = `worker-${runId.slice(0, 4)}`;
  database.authority.runs.enqueue({
    ...QUEUED_RUN,
    envelope: {
      ...QUEUED_RUN.envelope,
      runId,
      itemId,
      traceId,
      workflow: personLookupDescriptor.id,
      descriptorVersion: personLookupDescriptor.version,
      contractFingerprint: personLookupDescriptor.contractFingerprint,
    },
    input: {
      ...QUEUED_RUN.input,
      parsed: {
        schemaHash: deriveSchemaHash(PersonLookupCanonicalInput, "output"),
        value: { emplId: "10873698", keepNonHdh: false, includeCrmDates: false },
      },
    },
  });
  const claimed = database.authority.runs.claimNext({
    workflow: personLookupDescriptor.id,
    workerId,
    now: NOW,
  });
  if (claimed.state !== "claimed" || claimed.run.envelope.runId !== runId) {
    throw new Error(`terminal recovery fixture did not claim ${runId}`);
  }
  const claim = { workerId, claimGeneration: claimed.run.claimGeneration };
  const validating = database.authority.runs.transition({
    runId,
    expectedVersion: claimed.run.version,
    claim,
    lifecycle: { state: "validating", workerId, claimedAt: NOW, heartbeatAt: NOW },
    now: NOW,
  });
  if (validating.state !== "applied") throw new Error(`terminal recovery fixture did not validate ${runId}`);
  const running = database.authority.runs.transition({
    runId,
    expectedVersion: validating.run.version,
    claim,
    lifecycle: {
      state: "running",
      workerId,
      claimedAt: NOW,
      heartbeatAt: NOW,
      currentNodeId: nodeId,
    },
    now: NOW,
  });
  if (running.state !== "applied") throw new Error(`terminal recovery fixture did not run ${runId}`);
  return { run: running.run, claim };
}

function seedTerminalAuthority(database: AuthorityDatabase) {
  const failed = runningTerminalFixture(
    database,
    UUID_1,
    UUID_3,
    "pl-170000-aaaa",
    "crm-dates",
  );
  const failure = {
    failureId: UUID_8,
    fingerprint: HASH_B,
    runId: failed.run.envelope.runId,
    traceId: failed.run.envelope.traceId,
    attempt: failed.run.envelope.attempt,
    workflowId: failed.run.envelope.workflow,
    nodeId: "crm-dates",
    taskId: "crm/read-onboarding-dates",
    code: "CRM_UNAVAILABLE",
    summary: "CRM onboarding dates were unavailable",
    transient: true,
    writeState: "not-attempted",
    causeChain: [{
      code: "CRM_UNAVAILABLE",
      summary: "CRM returned an unavailable response",
      role: "primary",
      transient: true,
    }],
    remediation: [{ kind: "retry-when-served", message: "Retry after CRM is available" }],
    occurredAt: NOW,
  } as const;
  const failureAuthorization = {
    kind: "failed" as const,
    runId: failed.run.envelope.runId,
    workflowId: failed.run.envelope.workflow,
    attempt: failed.run.envelope.attempt,
    descriptorVersion: failed.run.envelope.descriptorVersion,
    contractFingerprint: failed.run.envelope.contractFingerprint,
    expectedVersion: failed.run.version,
    claim: failed.claim,
    authorizedAt: NOW,
    failureId: failure.failureId,
  };
  database.terminalizeFailure(personLookupDescriptor, {
    failure,
    authorization: failureAuthorization,
  });

  const done = runningTerminalFixture(
    database,
    UUID_2,
    UUID_7,
    "pl-170001-bbbb",
    "active-status",
  );
  const checkpoint = RunCheckpointRecordSchema.parse({
    workflowId: done.run.envelope.workflow,
    itemId: done.run.envelope.itemId,
    nodeId: "active-status",
    attempt: done.run.envelope.attempt,
    claimGeneration: 1,
    runId: done.run.envelope.runId,
    output: {
      schemaHash: deriveSchemaHash(ReadActiveStatus.output, "output"),
      value: ACTIVE_STATUS,
    },
    descriptorVersion: done.run.envelope.descriptorVersion,
    contractFingerprint: done.run.envelope.contractFingerprint,
    implFingerprint: HASH_A,
    provenance: [{ path: "state", source: "derived", observedAt: NOW, originalObservedAt: NOW }],
    writtenAt: NOW,
  });
  database.authority.runCheckpoints.insert(checkpoint);
  const built = buildRunResult(personLookupDescriptor, done.run, [
    { state: "resolved", nodeId: "active-status", checkpoint },
    { state: "not-run", nodeId: "crm-dates", reason: "condition-false" },
  ], CLOCK);
  const outbox = {
    outboxId: UUID_7,
    payload: {
      kind: "run-terminal-result" as const,
      runId: built.record.runId,
      workflowId: built.record.workflowId,
      attempt: built.record.attempt,
      resultDigest: built.record.resultDigest,
    },
    projection: { state: "pending" as const },
    createdAt: NOW,
  };
  const successAuthorization = {
    kind: "done" as const,
    runId: built.record.runId,
    workflowId: built.record.workflowId,
    attempt: built.record.attempt,
    descriptorVersion: built.record.descriptorVersion,
    contractFingerprint: built.record.contractFingerprint,
    expectedVersion: done.run.version,
    claim: done.claim,
    authorizedAt: NOW,
    resultDigest: built.record.resultDigest,
    outboxId: outbox.outboxId,
  };
  database.terminalizeSuccess({
    result: built.record,
    outbox,
    authorization: successAuthorization,
  }, built.authorization);
  return { failure, failureAuthorization, result: built.record, outbox, successAuthorization };
}

function testRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "hrauto-storage-recovery-"));
  roots.push(root);
  return root;
}

function databaseOptions(path: string) {
  return { path, busyTimeoutMs: 100, migrationOwner: "storage-recovery-test" };
}

function openDatabase(path: string): AuthorityDatabase {
  const database = AuthorityDatabase.open(databaseOptions(path), CLOCK);
  databases.push(database);
  return database;
}

function corruptTerminalRun(
  path: string,
  runId: string,
  mutate: (run: RunRecord) => unknown,
): void {
  const raw = new DatabaseSync(path);
  try {
    // Model offline corruption after write-time guards have run while keeping
    // each strict record mismatch independent of an artificial version bump.
    raw.exec("DROP TRIGGER tasks_monotonic_counters_update");
    const row = raw.prepare("SELECT record_json FROM tasks WHERE record_key = ?")
      .get(runId) as { record_json: string } | undefined;
    if (row === undefined) throw new Error(`run ${runId} is absent from corruption fixture`);
    const current = RunRecordSchema.parse(JSON.parse(row.record_json));
    const corrupted = RunRecordSchema.parse(mutate(current));
    const ownerWorkerId = "workerId" in corrupted.lifecycle ? corrupted.lifecycle.workerId : null;
    const heartbeatAt = "heartbeatAt" in corrupted.lifecycle ? corrupted.lifecycle.heartbeatAt : null;
    raw.prepare("UPDATE tasks SET record_json = ? WHERE record_key = ?")
      .run(JSON.stringify(corrupted), runId);
    if (corrupted.version !== current.version) {
      raw.prepare("UPDATE tasks SET version = ? WHERE record_key = ?").run(corrupted.version, runId);
    }
    if (corrupted.claimGeneration !== current.claimGeneration) {
      raw.prepare("UPDATE tasks SET claim_generation = ? WHERE record_key = ?")
        .run(corrupted.claimGeneration, runId);
    }
    if (corrupted.lifecycle.state !== current.lifecycle.state) {
      raw.prepare(`
        UPDATE tasks SET state = ?, owner_worker_id = ?, heartbeat_at = ? WHERE record_key = ?
      `).run(corrupted.lifecycle.state, ownerWorkerId, heartbeatAt, runId);
    }
  } finally {
    raw.close();
  }
}

function openBootStore(path: string): AuthorityBootStore {
  const store = AuthorityBootStore.open(databaseOptions(path), CLOCK);
  bootStores.push(store);
  return store;
}

function backupDirectory(root: string): string {
  return join(root, "backups");
}

function emitQueuedSpan(stateRoot: string, run = QUEUED_RUN): void {
  createSpanJsonlWriter({ stateRoot, clock: CLOCK, pid: 4242 }).emit({
    t: "run.queued",
    kind: "run",
    ts: run.envelope.enqueuedAt,
    workflow: run.envelope.workflow,
    runId: run.envelope.runId,
    attempt: run.envelope.attempt,
    traceId: run.envelope.traceId,
    spanPath: run.envelope.traceId,
    itemId: run.envelope.itemId,
    shape: run.envelope.shape,
    priority: run.envelope.priority,
    dryRun: run.envelope.dryRun,
    actorId: "local-operator",
    title: "storage reconciliation fixture",
    descriptorVersion: run.envelope.descriptorVersion,
    contractFingerprint: run.envelope.contractFingerprint,
    resolvedInstance: run.envelope.resolvedInstance,
    configFingerprint: run.envelope.configFingerprint,
    configSnapshotId: run.envelope.configSnapshotId,
  });
}

function manifestPaths(directory: string): string[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".manifest.json"))
    .sort()
    .map((name) => join(directory, name));
}

function restoreOptions(root: string, authorityPath: string, suspects = join(root, "suspects")) {
  return {
    authorityPath,
    suspectDirectory: suspects,
    busyTimeoutMs: 100,
    processLockRoot: join(root, "locks"),
    stoppedProofMaxAgeMs: 60_000,
  };
}

function stoppedProof(root: string, authorityPath: string, clock = CLOCK) {
  const sourceDatabaseIdentity = AuthorityDatabase.sourceDatabaseIdentity(authorityPath);
  const store = new RecoveryStopProofStore({
    processLockRoot: join(root, "locks"),
    maxProofAgeMs: 60_000,
  }, clock);
  store.recordRuntimeState(observeRuntimeLockSnapshot({
    processLockRoot: join(root, "locks"),
    sourceDatabaseIdentity,
  }, clock));
  return store.issue({ observedBy: "local-operator", sourceDatabaseIdentity });
}

async function createBackup(database: AuthorityDatabase, directory: string) {
  const service = new AuthorityBackupService(database, { directory }, CLOCK);
  const report = await service.request({
    trigger: "operator",
    requiredGeneration: database.getMeta().authorityGeneration,
  });
  const paths = manifestPaths(directory);
  assert.equal(paths.length, report.manifests.length);
  return { report, manifestPath: paths.at(-1) ?? "" };
}

afterEach(() => {
  for (const store of bootStores.splice(0)) store.close();
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("verified native online backups", () => {
  it("backs up and restores an exact v7 authority only after its immutable v8 upgrade", async () => {
    const root = testRoot();
    const authorityPath = join(root, "released-v7.sqlite");
    const legacy = new DatabaseSync(authorityPath);
    legacy.exec("BEGIN EXCLUSIVE");
    for (const migration of SQLITE_MIGRATIONS.filter(({ version }) => version <= 7)) {
      for (const statement of migration.statements) legacy.exec(statement);
    }
    legacy.prepare(`
      INSERT INTO authority_meta (
        singleton_id, schema_version, authority_generation, updated_at,
        migration_owner, migration_started_at
      ) VALUES (1, 7, 0, ?, NULL, NULL)
    `).run(NOW);
    legacy.exec("PRAGMA application_id = 1217249861");
    legacy.exec("PRAGMA user_version = 7");
    legacy.exec("COMMIT");
    assert.equal(
      legacy.prepare(`
        SELECT count(*) AS count FROM sqlite_master
        WHERE type = 'table' AND name = 'run_terminal_authorizations'
      `).get()?.count,
      0,
    );
    legacy.close();

    const database = openDatabase(authorityPath);
    assert.equal(database.getMeta().schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    const { manifestPath } = await createBackup(database, backupDirectory(root));
    const verified = await verifyBackupManifestAtPath(manifestPath);
    assert.equal(verified.manifest.schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    database.close();
    const reopened = openDatabase(authorityPath);
    assert.equal(reopened.inspectSchema().schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    reopened.close();

    writeFileSync(authorityPath, "corrupt after migrated backup");
    const restore = new OfflineAuthorityRestoreService(
      restoreOptions(root, authorityPath),
      async () => undefined,
      CLOCK,
    );
    await restore.restore({
      manifestPath,
      stoppedSystemProof: stoppedProof(root, authorityPath),
    });
    assert.equal(
      AuthorityDatabase.inspectExistingReadOnly(authorityPath).schemaVersion,
      CURRENT_AUTHORITY_SCHEMA_VERSION,
    );
  });

  it("backs up through the private native handle and self-observes the completed copy", async () => {
    const root = testRoot();
    const authorityPath = join(root, "state.sqlite");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);

    const { report, manifestPath } = await createBackup(database, directory);
    assert.equal(report.followUpPerformed, false);
    assert.equal(report.finalGeneration, 1);
    assert.equal(report.manifests[0].verification.observedFrom, "backup-copy");
    assert.equal(report.manifests[0].verification.authorityGeneration, 1);
    const verified = await verifyBackupManifestAtPath(
      manifestPath,
      database.getSourceDatabaseIdentity(),
    );
    assert.equal(verified.manifest.sha256.length, 64);
    assert.equal(verified.manifest.byteSize > 0, true);
    assert.equal(AuthorityDatabase.inspectExistingReadOnly(verified.backupPath).authorityGeneration, 1);

    database.authority.notifications.create(NOTIFICATION);
    assert.equal(database.getMeta().authorityGeneration, 2);
    assert.equal((await verifyBackupManifestAtPath(manifestPath)).manifest.authorityGeneration, 1);
  });

  it("coalesces concurrent requests and performs one generation follow-up", async () => {
    const root = testRoot();
    const authorityPath = join(root, "state.sqlite");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    let copies = 0;
    const source = {
      getMeta: () => database.getMeta(),
      getSourceDatabaseIdentity: () => database.getSourceDatabaseIdentity(),
      onlineBackupTo: async (destinationPath: string) => {
        copies += 1;
        const pages = await database.onlineBackupTo(destinationPath);
        if (copies === 1) database.authority.notifications.create(NOTIFICATION);
        return pages;
      },
    };
    const service = new AuthorityBackupService(source, { directory }, CLOCK);
    const first = service.request({ trigger: "interval", requiredGeneration: 1 });
    const second = service.request({ trigger: "external-write", requiredGeneration: 1 });
    assert.equal(first, second);
    const report = await first;
    assert.equal(report.coalescedRequests, 2);
    assert.equal(report.followUpPerformed, true);
    assert.equal(report.manifests.length, 2);
    assert.equal(report.manifests[0].authorityGeneration, 1);
    assert.equal(report.manifests[1].authorityGeneration, 2);
    assert.equal(copies, 2);
  });

  it("fails loud and removes its unique temporary target when native backup fails", async () => {
    const root = testRoot();
    const authorityPath = join(root, "state.sqlite");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    const failingSource = {
      getMeta: () => database.getMeta(),
      getSourceDatabaseIdentity: () => database.getSourceDatabaseIdentity(),
      onlineBackupTo: (destinationPath: string) => {
        mkdirSync(directory, { recursive: true });
        writeFileSync(destinationPath, "partial backup");
        return Promise.reject(new Error("injected native backup failure"));
      },
    };
    const service = new AuthorityBackupService(failingSource, { directory }, CLOCK);
    await assert.rejects(
      service.request({ trigger: "operator", requiredGeneration: 0 }),
      /injected native backup failure/,
    );
    assert.deepEqual(readdirSync(directory), []);
  });

  it("rejects tampered backup bytes and a tampered manifest", async () => {
    const root = testRoot();
    const authorityPath = join(root, "state.sqlite");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    const { manifestPath } = await createBackup(database, directory);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { backupFileName: string; sha256: string };
    const backupPath = join(directory, manifest.backupFileName);
    appendFileSync(backupPath, "tamper");
    await assert.rejects(verifyBackupManifestAtPath(manifestPath), /byte size does not match/);

    const secondRoot = testRoot();
    const secondPath = join(secondRoot, "state.sqlite");
    const secondDirectory = backupDirectory(secondRoot);
    const secondDatabase = openDatabase(secondPath);
    const second = await createBackup(secondDatabase, secondDirectory);
    const parsed = JSON.parse(readFileSync(second.manifestPath, "utf8")) as Record<string, unknown>;
    writeFileSync(second.manifestPath, JSON.stringify({ ...parsed, sha256: HASH_B }));
    await assert.rejects(verifyBackupManifestAtPath(second.manifestPath), /checksum does not match/);
  });

  it("rejects a native backup whose JSON-valid command record fails its strict schema", async () => {
    const root = testRoot();
    const authorityPath = join(root, "state.sqlite");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    const corruption = new DatabaseSync(authorityPath);
    corruption.prepare("UPDATE commands SET record_json = ? WHERE record_key = ?")
      .run(JSON.stringify({ family: "start" }), UUID_1);
    corruption.close();

    await assert.rejects(createBackup(database, directory), /commands record .* failed strict record schema validation/);
    assert.deepEqual(readdirSync(directory), []);
  });
});

describe("fail-closed degraded boot and read-only doctor", () => {
  it("returns span resolutions with the authority identity from their read snapshot", () => {
    const root = testRoot();
    const authorityPath = join(root, "state.sqlite");
    const database = openDatabase(authorityPath);
    database.authority.runs.enqueue(QUEUED_RUN);
    const authority = AuthorityDatabase.inspectExistingReadOnly(authorityPath);

    const snapshot = AuthorityDatabase.inspectSpanRunAuthorityReadOnly(
      authorityPath,
      [QUEUED_RUN.envelope.runId],
    );

    assert.deepEqual(snapshot, {
      authorityGeneration: authority.authorityGeneration,
      authorityContentFingerprint: authority.authorityContentFingerprint,
      resolutions: [{ state: "live", runId: QUEUED_RUN.envelope.runId }],
    });
  });

  it("returns one authority identity when a commit lands between metadata and fingerprint reads", () => {
    const root = testRoot();
    const authorityPath = join(root, "state.sqlite");
    const database = openDatabase(authorityPath);
    const baseline = AuthorityDatabase.inspectExistingReadOnly(authorityPath);
    // Captured before the prototype probe and invoked below with its original
    // DatabaseSync receiver; binding here would bind the wrong connection.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const nativePrepare = DatabaseSync.prototype.prepare;
    let injected = false;
    const probe = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function prepareWithCommit(
      this: DatabaseSync,
      sql: string,
    ) {
      if (!injected && sql.includes("SELECT singleton_id, schema_version")) {
        injected = true;
        database.authority.notifications.create(NOTIFICATION);
      }
      return nativePrepare.call(this, sql);
    });
    try {
      const inspection = AuthorityDatabase.inspectExistingReadOnly(authorityPath);

      assert.equal(injected, true);
      assert.deepEqual(
        {
          authorityGeneration: inspection.authorityGeneration,
          authorityContentFingerprint: inspection.authorityContentFingerprint,
        },
        {
          authorityGeneration: baseline.authorityGeneration,
          authorityContentFingerprint: baseline.authorityContentFingerprint,
        },
      );
    } finally {
      probe.mockRestore();
    }
  });

  it("serves only a span basename and sanitized issue for malformed JSON", async () => {
    const root = testRoot();
    const authorityPath = join(root, "state.sqlite");
    openDatabase(authorityPath);
    const spans = join(root, "spans");
    mkdirSync(spans);
    const fileName = "person-lookup-2026-07-31.jsonl";
    writeFileSync(join(spans, fileName), "{ definitely-not-json\n");

    const report = await doctorAuthorityStorage({
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: backupDirectory(root),
      maxBackupAgeMs: 60_000,
      busyTimeoutMs: 100,
    }, CLOCK);

    assert.equal(report.spanAuthority.state, "unavailable");
    if (report.spanAuthority.state !== "unavailable") throw new Error("malformed JSON must refuse span authority");
    assert.match(report.spanAuthority.cause.summary, new RegExp(`^span file ${fileName} line 1 is invalid JSON`));
    assert.equal(report.spanAuthority.cause.summary.includes(root), false);
  });

  it("refuses a symlinked span corpus file instead of following it", async () => {
    const root = testRoot();
    const authorityPath = join(root, "state.sqlite");
    openDatabase(authorityPath);
    emitQueuedSpan(root);
    const spans = join(root, "spans");
    const fileName = readdirSync(spans)[0];
    if (fileName === undefined) throw new Error("span fixture emitted no file");
    const ownedPath = join(spans, fileName);
    const targetPath = join(root, "outside-span-corpus.jsonl");
    renameSync(ownedPath, targetPath);
    symlinkSync(targetPath, ownedPath);

    const report = await doctorAuthorityStorage({
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: backupDirectory(root),
      maxBackupAgeMs: 60_000,
      busyTimeoutMs: 100,
    }, CLOCK);

    assert.equal(report.spanAuthority.state, "unavailable");
    if (report.spanAuthority.state !== "unavailable") throw new Error("symlinked span corpus must be unavailable");
    assert.equal(report.spanAuthority.cause.code, "span-stream-invalid");
    assert.match(report.spanAuthority.cause.summary, new RegExp(`^span file ${fileName} is not a regular no-follow file`));
    assert.equal(report.spanAuthority.cause.summary.includes(root), false);
  });

  it("refuses a symlinked span corpus directory before enumeration", async () => {
    const root = testRoot();
    const authorityPath = join(root, "state.sqlite");
    openDatabase(authorityPath);
    emitQueuedSpan(root);
    const spans = join(root, "spans");
    const foreignSpans = join(root, "foreign-spans");
    renameSync(spans, foreignSpans);
    symlinkSync(foreignSpans, spans);

    const report = await doctorAuthorityStorage({
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: backupDirectory(root),
      maxBackupAgeMs: 60_000,
      busyTimeoutMs: 100,
    }, CLOCK);

    assert.equal(report.spanAuthority.state, "unavailable");
    if (report.spanAuthority.state !== "unavailable") throw new Error("symlinked span corpus must be unavailable");
    assert.equal(report.spanAuthority.cause.code, "span-stream-invalid");
    assert.equal(report.spanAuthority.cause.summary, "span corpus directory spans is not a regular no-follow directory");
    assert.equal(report.spanAuthority.cause.summary.includes(root), false);
  });

  it("refuses a symlinked state-root parent before span enumeration", async () => {
    const root = testRoot();
    const stateRoot = join(root, "real-state");
    const linkedStateRoot = join(root, "linked-state");
    mkdirSync(stateRoot);
    const authorityPath = join(stateRoot, "state.sqlite");
    openDatabase(authorityPath);
    emitQueuedSpan(stateRoot);
    symlinkSync(stateRoot, linkedStateRoot);

    const report = await doctorAuthorityStorage({
      stateRootTrustAnchor: root,
      stateRoot: linkedStateRoot,
      authorityPath,
      backupDirectory: backupDirectory(root),
      maxBackupAgeMs: 60_000,
      busyTimeoutMs: 100,
    }, CLOCK);

    assert.equal(report.spanAuthority.state, "unavailable");
    if (report.spanAuthority.state !== "unavailable") throw new Error("symlinked state root must be unavailable");
    assert.equal(report.spanAuthority.cause.code, "span-stream-invalid");
    assert.equal(
      report.spanAuthority.cause.summary,
      "span corpus parent linked-state is not a regular no-follow directory",
    );
    assert.equal(report.spanAuthority.cause.summary.includes(root), false);
  });

  it("closes an acquired corpus descriptor when its post-open identity check fails", async () => {
    const root = testRoot();
    const authorityPath = join(root, "authority.sqlite");
    openDatabase(authorityPath);
    emitQueuedSpan(root);
    await doctorAuthorityStorage({
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: backupDirectory(root),
      maxBackupAgeMs: 60_000,
      busyTimeoutMs: 100,
    }, CLOCK);
    const descriptorsBefore = readdirSync("/dev/fd").length;
    const nativeLstat = fs.lstatSync.bind(fs);
    const nativeStat = fs.statSync.bind(fs);
    let rootIdentityChecks = 0;
    let cwdIdentityChecks = 0;
    let injected = false;
    const lstatProbe = vi.spyOn(fs, "lstatSync").mockImplementation((path) => {
      if (String(path) === root && ++rootIdentityChecks === 3) {
        injected = true;
        throw new Error("injected post-open directory identity failure");
      }
      return nativeLstat(path);
    });
    const statProbe = vi.spyOn(fs, "statSync").mockImplementation((path) => {
      if (String(path) === "." && ++cwdIdentityChecks === 3) {
        injected = true;
        throw new Error("injected post-open directory identity failure");
      }
      return nativeStat(path);
    });
    syncBuiltinESMExports();
    let report: Awaited<ReturnType<typeof doctorAuthorityStorage>> | undefined;
    try {
      report = await doctorAuthorityStorage({
        stateRootTrustAnchor: root,
        stateRoot: root,
        authorityPath,
        backupDirectory: backupDirectory(root),
        maxBackupAgeMs: 60_000,
        busyTimeoutMs: 100,
      }, CLOCK);
    } finally {
      lstatProbe.mockRestore();
      statProbe.mockRestore();
      syncBuiltinESMExports();
    }

    assert.equal(injected, true);
    assert.equal(report?.spanAuthority.state, "unavailable");
    assert.equal(readdirSync("/dev/fd").length, descriptorsBefore);
  });

  it("refuses an intermediate state-root component replaced by a symlink while the doctor awaits", async () => {
    const root = testRoot();
    const authorityPath = join(root, "authority.sqlite");
    openDatabase(authorityPath);
    const stateRootGrandparent = join(root, "span-authority-root");
    const stateRoot = join(stateRootGrandparent, "intermediate", "state");
    mkdirSync(stateRoot, { recursive: true });
    emitQueuedSpan(stateRoot);

    const pendingDoctor = doctorAuthorityStorage({
      stateRootTrustAnchor: root,
      stateRoot,
      authorityPath,
      backupDirectory: backupDirectory(root),
      maxBackupAgeMs: 60_000,
      busyTimeoutMs: 100,
    }, CLOCK);
    const retainedGrandparent = join(root, "retained-span-authority-root");
    renameSync(stateRootGrandparent, retainedGrandparent);
    symlinkSync(retainedGrandparent, stateRootGrandparent);

    const report = await pendingDoctor;

    assert.equal(report.spanAuthority.state, "unavailable");
    if (report.spanAuthority.state !== "unavailable") throw new Error("redirected span corpus must be unavailable");
    assert.equal(report.spanAuthority.cause.code, "span-stream-invalid");
    assert.equal(
      report.spanAuthority.cause.summary,
      "span corpus path component span-authority-root is not a regular no-follow directory",
    );
    assert.equal(report.spanAuthority.cause.summary.includes(root), false);
  });

  it("refuses a span file beyond the explicit byte bound before parsing it", async () => {
    const root = testRoot();
    const authorityPath = join(root, "state.sqlite");
    openDatabase(authorityPath);
    const spans = join(root, "spans");
    mkdirSync(spans);
    const fileName = "person-lookup-2026-07-31.jsonl";
    const spanPath = join(spans, fileName);
    writeFileSync(spanPath, "");
    truncateSync(spanPath, 8 * 1024 * 1024 + 1);

    const report = await doctorAuthorityStorage({
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: backupDirectory(root),
      maxBackupAgeMs: 60_000,
      busyTimeoutMs: 100,
    }, CLOCK);

    assert.equal(report.spanAuthority.state, "unavailable");
    if (report.spanAuthority.state !== "unavailable") throw new Error("oversized span corpus must be unavailable");
    assert.match(report.spanAuthority.cause.summary, new RegExp(`^span file ${fileName} exceeds the 8388608-byte file limit`));
    assert.equal(report.spanAuthority.cause.summary.includes(root), false);
  });

  it("refuses a doctor report assembled across different authority snapshots", async () => {
    const root = testRoot();
    const authorityPath = join(root, "state.sqlite");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    await createBackup(database, directory);

    const pendingDoctor = doctorAuthorityStorage({
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: directory,
      maxBackupAgeMs: 60_000,
      busyTimeoutMs: 100,
    }, CLOCK);
    database.authority.notifications.create(NOTIFICATION);

    await assert.rejects(
      pendingDoctor,
      /authority changed while the storage doctor awaited external evidence/,
    );
  });

  it("refuses a transient A-to-B-to-A authority swap during span resolution", async () => {
    const root = testRoot();
    const authorityPath = join(root, "state.sqlite");
    const originalPath = join(root, "authority-a.sqlite");
    const replacementPath = join(root, "authority-b.sqlite");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    database.authority.runs.enqueue(QUEUED_RUN);
    emitQueuedSpan(root);
    await createBackup(database, directory);
    database.close();
    copyFileSync(authorityPath, originalPath);
    copyFileSync(authorityPath, replacementPath);
    const replacement = openDatabase(replacementPath);
    replacement.authority.notifications.create(NOTIFICATION);
    replacement.close();
    const inspectSpanAuthority = AuthorityDatabase.inspectSpanRunAuthorityReadOnly.bind(AuthorityDatabase);
    const probe = vi.spyOn(AuthorityDatabase, "inspectSpanRunAuthorityReadOnly").mockImplementation(
      (path, runIds, busyTimeoutMs) => {
        const snapshot = inspectSpanAuthority(path, runIds, busyTimeoutMs);
        if (runIds.length > 0) copyFileSync(originalPath, authorityPath);
        return snapshot;
      },
    );
    try {
      const pendingDoctor = doctorAuthorityStorage({
        stateRootTrustAnchor: root,
        stateRoot: root,
        authorityPath,
        backupDirectory: directory,
        maxBackupAgeMs: 60_000,
        busyTimeoutMs: 100,
      }, CLOCK);
      copyFileSync(replacementPath, authorityPath);

      await assert.rejects(
        pendingDoctor,
        /span authority snapshot does not match the storage doctor's initial authority identity/,
      );
    } finally {
      probe.mockRestore();
    }
  });

  it("refuses when an initially degraded authority changes during external verification", async () => {
    const root = testRoot();
    const authorityPath = join(root, "state.sqlite");
    const healthyPath = join(root, "healthy-authority.sqlite");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    await createBackup(database, directory);
    database.close();
    copyFileSync(authorityPath, healthyPath);
    writeFileSync(authorityPath, "corrupt authority before doctor");

    const pendingDoctor = doctorAuthorityStorage({
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: directory,
      maxBackupAgeMs: 60_000,
      busyTimeoutMs: 100,
    }, CLOCK);
    copyFileSync(healthyPath, authorityPath);

    await assert.rejects(
      pendingDoctor,
      /authority changed while the storage doctor awaited external evidence/,
    );
  });

  it("names a span-known run missing from exact live and archived authority", async () => {
    const root = testRoot();
    const authorityPath = join(root, "state.sqlite");
    openDatabase(authorityPath);
    emitQueuedSpan(root);

    const report = await doctorAuthorityStorage({
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: backupDirectory(root),
      maxBackupAgeMs: 60_000,
      busyTimeoutMs: 100,
    }, CLOCK);

    assert.deepEqual(report.spanAuthority, {
      state: "degraded",
      streamRunCount: 1,
      liveRunCount: 0,
      archived: [],
      problems: [{ state: "missing", runId: QUEUED_RUN.envelope.runId }],
    });
  });

  it("names exact archived authority without treating it as a missing run", async () => {
    const root = testRoot();
    const authorityPath = join(root, "state.sqlite");
    const database = openDatabase(authorityPath);
    database.withAuthorityTransaction((repositories) => {
      repositories.runs.enqueue(QUEUED_RUN);
      repositories.versionPlans.insert(VERSION_PLAN_ROW);
      repositories.versionBumpApplications.insert(VERSION_BUMP_APPLICATION);
      repositories.archivedRuns.insert(ARCHIVED_RUN);
      return undefined;
    });
    emitQueuedSpan(root);

    const report = await doctorAuthorityStorage({
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: backupDirectory(root),
      maxBackupAgeMs: 60_000,
      busyTimeoutMs: 100,
    }, CLOCK);

    assert.deepEqual(report.spanAuthority, {
      state: "reconciled",
      streamRunCount: 1,
      liveRunCount: 0,
      archived: [{ runId: ARCHIVED_RUN.runId, archivedAt: ARCHIVED_RUN.archivedAt }],
    });
  });

  it("names malformed exact task authority instead of selecting another row", async () => {
    const root = testRoot();
    const authorityPath = join(root, "state.sqlite");
    const database = openDatabase(authorityPath);
    database.authority.runs.enqueue(QUEUED_RUN);
    emitQueuedSpan(root);
    const raw = new DatabaseSync(authorityPath);
    raw.prepare("UPDATE tasks SET record_json = ? WHERE record_key = ?")
      .run(JSON.stringify({ malformed: true }), QUEUED_RUN.envelope.runId);
    raw.close();

    const report = await doctorAuthorityStorage({
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: backupDirectory(root),
      maxBackupAgeMs: 60_000,
      busyTimeoutMs: 100,
    }, CLOCK);

    assert.equal(report.spanAuthority.state, "degraded");
    if (report.spanAuthority.state !== "degraded") throw new Error("malformed task authority must degrade reconciliation");
    assert.equal(report.spanAuthority.streamRunCount, 1);
    assert.equal(report.spanAuthority.liveRunCount, 0);
    assert.deepEqual(report.spanAuthority.archived, []);
    assert.equal(report.spanAuthority.problems.length, 1);
    const problem = report.spanAuthority.problems[0];
    assert.equal(problem?.state, "malformed");
    if (problem?.state !== "malformed") throw new Error("expected exact malformed task diagnosis");
    assert.equal(problem.runId, QUEUED_RUN.envelope.runId);
    assert.equal(problem.table, "tasks");
    assert.match(problem.summary, /Invalid input/);
  });

  it("rejects NULL/nonterminal partial authorization, failure, result, and outbox settlements read-only", () => {
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
    const partialOutbox = {
      outboxId: UUID_7,
      payload: {
        kind: "run-terminal-result",
        runId: partialResult.runId,
        workflowId: partialResult.workflowId,
        attempt: partialResult.attempt,
        resultDigest: partialResult.resultDigest,
      },
      projection: { state: "pending" },
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
        name: "authorization",
        insert: (raw: DatabaseSync) => raw.prepare(`
          INSERT INTO run_terminal_authorizations
            (record_key, kind, expected_version, worker_id, claim_generation, record_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          partialAuthorization.runId,
          partialAuthorization.kind,
          partialAuthorization.expectedVersion,
          partialAuthorization.claim.workerId,
          partialAuthorization.claim.claimGeneration,
          JSON.stringify(partialAuthorization),
          NOW,
        ),
        violation: /terminal-authorization-binds-exact-terminal-authority/,
      },
      {
        name: "failure",
        insert: (raw: DatabaseSync) => raw.prepare(`
          INSERT INTO failures (record_key, run_id, fingerprint, record_json, created_at)
          VALUES (?, ?, ?, ?, ?)
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
        insert: (raw: DatabaseSync) => raw.prepare(`
          INSERT INTO run_results
            (record_key, workflow, attempt, result_digest, record_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          partialResult.runId,
          partialResult.workflowId,
          partialResult.attempt,
          partialResult.resultDigest,
          JSON.stringify(partialResult),
          NOW,
        ),
        violation: /results-bind-done-run/,
      },
      {
        name: "outbox",
        insert: (raw: DatabaseSync) => {
          raw.prepare(`
            INSERT INTO run_results
              (record_key, workflow, attempt, result_digest, record_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(
            partialResult.runId,
            partialResult.workflowId,
            partialResult.attempt,
            partialResult.resultDigest,
            JSON.stringify(partialResult),
            NOW,
          );
          return raw.prepare(`
            INSERT INTO run_terminal_outbox
              (record_key, run_id, state, record_json, created_at)
            VALUES (?, ?, ?, ?, ?)
          `).run(
            partialOutbox.outboxId,
            partialOutbox.payload.runId,
            partialOutbox.projection.state,
            JSON.stringify(partialOutbox),
            NOW,
          );
        },
        violation: /results-bind-done-run/,
      },
    ] as const;

    for (const fixture of cases) {
      const path = join(testRoot(), `${fixture.name}.sqlite`);
      const database = openDatabase(path);
      database.authority.runs.enqueue(QUEUED_RUN);
      database.close();
      const raw = new DatabaseSync(path);
      fixture.insert(raw);
      raw.close();
      assert.throws(
        () => AuthorityDatabase.inspectExistingReadOnly(path),
        fixture.violation,
        fixture.name,
      );
    }
  });

  it("degrades read-only for every schema-valid authorization/consequence mismatch in both arms", () => {
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
      for (const [name, mutate] of arm.cases) {
        const path = join(testRoot(), `${arm.name}-${name}.sqlite`);
        const database = openDatabase(path);
        seedTerminalAuthority(database);
        database.close();
        corruptTerminalRun(path, arm.runId, mutate);
        assert.throws(
          () => AuthorityDatabase.inspectExistingReadOnly(path),
          /terminal-authorization-binds-exact-terminal-authority/,
          `${arm.name}/${name}`,
        );
        const store = openBootStore(path);
        const report = store.report();
        assert.equal(report.state, "degraded-read-only", `${arm.name}/${name}`);
        if (report.state !== "degraded-read-only") throw new Error("expected degraded terminal authority");
        assert.equal(report.cause.code, "authority-invariant", `${arm.name}/${name}`);
        assert.match(report.cause.summary, /terminal-authorization-binds-exact-terminal-authority/);
      }
    }
  });

  it("degrades read-only for every authorization column and arm-specific authority mismatch", () => {
    type SeededTerminalAuthority = ReturnType<typeof seedTerminalAuthority>;
    const columnCases = [
      {
        name: "worker-id-column",
        mutate: (raw: DatabaseSync, runId: string) => raw.prepare(`
          UPDATE run_terminal_authorizations SET worker_id = ? WHERE record_key = ?
        `).run("worker-corrupt", runId),
      },
      {
        name: "expected-version-column",
        mutate: (raw: DatabaseSync, runId: string) => raw.prepare(`
          UPDATE run_terminal_authorizations
          SET expected_version = expected_version + 1 WHERE record_key = ?
        `).run(runId),
      },
      {
        name: "authorized-at-column",
        mutate: (raw: DatabaseSync, runId: string) => raw.prepare(`
          UPDATE run_terminal_authorizations SET created_at = ? WHERE record_key = ?
        `).run(AFTER_NOW, runId),
      },
    ] as const;
    for (const arm of [
      { name: "failed", runId: UUID_1 },
      { name: "done", runId: UUID_2 },
    ] as const) {
      for (const fixture of columnCases) {
        const path = join(testRoot(), `${arm.name}-${fixture.name}.sqlite`);
        const database = openDatabase(path);
        seedTerminalAuthority(database);
        database.close();
        const raw = new DatabaseSync(path);
        fixture.mutate(raw, arm.runId);
        raw.close();
        assert.throws(
          () => AuthorityDatabase.inspectExistingReadOnly(path),
          /terminal-authorization-columns-match-record/,
          `${arm.name}/${fixture.name}`,
        );
        const report = openBootStore(path).report();
        assert.equal(report.state, "degraded-read-only", `${arm.name}/${fixture.name}`);
        if (report.state !== "degraded-read-only") throw new Error("expected degraded authorization columns");
        assert.match(report.cause.summary, /terminal-authorization-columns-match-record/);
      }
    }

    const associatedRecordCases: ReadonlyArray<Readonly<{
      name: string;
      violation: RegExp;
      mutate(raw: DatabaseSync, seeded: SeededTerminalAuthority): void;
    }>> = [
      {
        name: "failed-run-error-summary",
        violation: /terminal-authorization-binds-exact-terminal-authority/,
        mutate: (raw) => {
          const row = raw.prepare("SELECT record_json FROM tasks WHERE record_key = ?")
            .get(UUID_1) as { record_json: string } | undefined;
          if (row === undefined) throw new Error("failed run is absent from summary corruption fixture");
          const run = RunRecordSchema.parse(JSON.parse(row.record_json));
          if (run.lifecycle.state !== "terminal" || run.lifecycle.outcome !== "failed") {
            throw new Error("summary corruption fixture requires a failed terminal run");
          }
          const corrupted = RunRecordSchema.parse({
            ...run,
            lifecycle: { ...run.lifecycle, errorSummary: "Different display-safe failure summary" },
          });
          raw.prepare("UPDATE tasks SET record_json = ? WHERE record_key = ?")
            .run(JSON.stringify(corrupted), UUID_1);
        },
      },
      {
        name: "failure-record-summary",
        violation: /terminal-authorization-binds-exact-terminal-authority/,
        mutate: (raw, seeded) => {
          const row = raw.prepare("SELECT record_json FROM failures WHERE record_key = ?")
            .get(seeded.failure.failureId) as { record_json: string } | undefined;
          if (row === undefined) throw new Error("failure is absent from summary corruption fixture");
          const failure = FailureRecordSchema.parse(JSON.parse(row.record_json));
          const corrupted = FailureRecordSchema.parse({
            ...failure,
            summary: "Different structured failure summary",
          });
          raw.prepare("UPDATE failures SET record_json = ? WHERE record_key = ?")
            .run(JSON.stringify(corrupted), failure.failureId);
        },
      },
      {
        name: "done-authorization-result-digest",
        violation: /results-bind-terminal-authorization/,
        mutate: (raw, seeded) => {
          const row = raw.prepare(`
            SELECT record_json FROM run_terminal_authorizations WHERE record_key = ?
          `).get(seeded.result.runId) as { record_json: string } | undefined;
          if (row === undefined) throw new Error("done authorization is absent from digest corruption fixture");
          const authorization = TerminalAuthorizationRecordSchema.parse(JSON.parse(row.record_json));
          if (authorization.kind !== "done") throw new Error("digest corruption fixture requires done authorization");
          const corrupted = TerminalAuthorizationRecordSchema.parse({
            ...authorization,
            resultDigest: authorization.resultDigest === HASH_A ? HASH_B : HASH_A,
          });
          raw.prepare(`
            UPDATE run_terminal_authorizations SET record_json = ? WHERE record_key = ?
          `).run(JSON.stringify(corrupted), authorization.runId);
        },
      },
      {
        name: "done-authorization-outbox-id",
        violation: /terminal-outbox-binds-terminal-authorization/,
        mutate: (raw, seeded) => {
          const row = raw.prepare(`
            SELECT record_json FROM run_terminal_authorizations WHERE record_key = ?
          `).get(seeded.result.runId) as { record_json: string } | undefined;
          if (row === undefined) throw new Error("done authorization is absent from outbox corruption fixture");
          const authorization = TerminalAuthorizationRecordSchema.parse(JSON.parse(row.record_json));
          if (authorization.kind !== "done") throw new Error("outbox corruption fixture requires done authorization");
          const corrupted = TerminalAuthorizationRecordSchema.parse({
            ...authorization,
            outboxId: UUID_8,
          });
          raw.prepare(`
            UPDATE run_terminal_authorizations SET record_json = ? WHERE record_key = ?
          `).run(JSON.stringify(corrupted), authorization.runId);
        },
      },
    ];
    for (const fixture of associatedRecordCases) {
      const path = join(testRoot(), `${fixture.name}.sqlite`);
      const database = openDatabase(path);
      const seeded = seedTerminalAuthority(database);
      database.close();
      const raw = new DatabaseSync(path);
      fixture.mutate(raw, seeded);
      raw.close();
      assert.throws(
        () => AuthorityDatabase.inspectExistingReadOnly(path),
        fixture.violation,
        fixture.name,
      );
      const report = openBootStore(path).report();
      assert.equal(report.state, "degraded-read-only", fixture.name);
      if (report.state !== "degraded-read-only") throw new Error("expected degraded associated authority");
      assert.match(report.cause.summary, fixture.violation);
    }
  });

  it("opens corrupt, truncated, newer, foreign-key-invalid, invariant-invalid, and record-invalid files degraded", async () => {
    const root = testRoot();
    const paths: Array<readonly [string, string]> = [];

    const corruptPath = join(root, "corrupt.sqlite");
    writeFileSync(corruptPath, "not a sqlite database");
    paths.push([corruptPath, "authority-not-sqlite"]);

    const truncatedPath = join(root, "truncated.sqlite");
    openDatabase(truncatedPath).close();
    truncateSync(truncatedPath, 128);
    paths.push([truncatedPath, "authority-corrupt"]);

    const newerPath = join(root, "newer.sqlite");
    openDatabase(newerPath).close();
    const newer = new DatabaseSync(newerPath);
    newer.exec(`PRAGMA user_version = ${String(CURRENT_AUTHORITY_SCHEMA_VERSION + 1)}`);
    newer.close();
    paths.push([newerPath, "authority-schema-newer"]);

    const foreignKeyPath = join(root, "foreign-key.sqlite");
    openDatabase(foreignKeyPath).close();
    const badForeignKey = new DatabaseSync(foreignKeyPath, { enableForeignKeyConstraints: false });
    badForeignKey.prepare(`
      INSERT INTO command_audits (record_key, command_id, record_json, created_at)
      VALUES (?, ?, ?, ?)
    `).run(UUID_2, UUID_8, JSON.stringify({ invalid: "but valid JSON" }), NOW);
    badForeignKey.close();
    paths.push([foreignKeyPath, "authority-foreign-key"]);

    const invariantPath = join(root, "invariant.sqlite");
    const invariantDatabase = openDatabase(invariantPath);
    invariantDatabase.authority.commands.insert(COMMAND_FIXTURES[0]);
    invariantDatabase.close();
    const badInvariant = new DatabaseSync(invariantPath);
    badInvariant.prepare("UPDATE commands SET family = ? WHERE record_key = ?").run("run", UUID_1);
    badInvariant.close();
    paths.push([invariantPath, "authority-invariant"]);

    const recordSchemaPath = join(root, "record-schema.sqlite");
    const recordSchemaDatabase = openDatabase(recordSchemaPath);
    recordSchemaDatabase.authority.writeIntents.fenceAttempt({ intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT });
    recordSchemaDatabase.close();
    const badRecordSchema = new DatabaseSync(recordSchemaPath);
    badRecordSchema.prepare("UPDATE write_intents SET record_json = ? WHERE record_key = ?")
      .run(JSON.stringify({ status: "attempting" }), WRITE_INTENT_ATTEMPTING.writeIntentId);
    badRecordSchema.close();
    paths.push([recordSchemaPath, "authority-record-invalid"]);

    for (const [path, expectedCode] of paths) {
      const before = readFileSync(path);
      const store = openBootStore(path);
      const report = store.report();
      assert.equal(report.state, "degraded-read-only", path);
      if (report.state !== "degraded-read-only") throw new Error("expected degraded report");
      assert.equal(report.cause.code, expectedCode, path);
      for (const operation of ["enqueue", "claim", "commit", "control"] as const) {
        assert.throws(
          () => store.requireWritable(operation),
          (error: unknown) => error instanceof AuthorityMutationUnavailableError
            && error.operation === operation
            && error.health.code === expectedCode,
        );
      }
      assert.deepEqual(readFileSync(path), before, `${path} was modified during degraded boot`);
    }
    const doctor = await doctorAuthorityStorage({
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath: recordSchemaPath,
      backupDirectory: backupDirectory(root),
      maxBackupAgeMs: 60_000,
      busyTimeoutMs: 100,
    }, CLOCK);
    assert.equal(doctor.authority.state, "degraded");
    if (doctor.authority.state !== "degraded") throw new Error("record-invalid authority must degrade doctor");
    assert.equal(doctor.authority.cause.code, "authority-record-invalid");
  });

  it("reports counts, backup freshness/gap, candidates, and a newer bad manifest without mutation", async () => {
    const root = testRoot();
    const authorityPath = join(root, "state.sqlite");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    database.authority.writeIntents.fenceAttempt({ intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT });
    database.commitWriteAttempt(ATOMIC_WRITE_COMMIT);
    database.authority.workerLeases.start(WORKER_START_REQUEST);
    database.authority.artifactOutbox.insert(ARTIFACT_OUTBOX);
    await createBackup(database, directory);
    const generationBeforeDoctor = database.getMeta().authorityGeneration;
    const report = await doctorAuthorityStorage({
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: directory,
      maxBackupAgeMs: 60_000,
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
      leases: 1,
      durableOutbox: 2,
      runTerminalOutbox: 0,
      providerReservations: 0,
      artifactOutbox: 1,
      captureFinalizationOutboxes: 0,
    });
    assert.equal(report.restoreCandidates.length, 1);
    assert.equal(database.getMeta().authorityGeneration, generationBeforeDoctor);

    const newestBadPath = join(directory, "newest-bad.manifest.json");
    writeFileSync(newestBadPath, "{ definitely-not-json");
    const future = new Date("2030-08-01T00:00:00.000Z");
    utimesSync(newestBadPath, future, future);
    const badReport = await doctorAuthorityStorage({
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: directory,
      maxBackupAgeMs: 60_000,
      busyTimeoutMs: 100,
    }, CLOCK);
    assert.equal(badReport.backup.state, "invalid");
    assert.equal(badReport.restoreCandidates[0].state, "invalid");
  });

  it("reports a verified restore candidate even when the live authority becomes corrupt", async () => {
    const root = testRoot();
    const authorityPath = join(root, "state.sqlite");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    await createBackup(database, directory);
    database.close();
    writeFileSync(authorityPath, "corrupted after verified backup");
    const report = await doctorAuthorityStorage({
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: directory,
      maxBackupAgeMs: 60_000,
      busyTimeoutMs: 100,
    }, CLOCK);
    assert.equal(report.authority.state, "degraded");
    assert.equal(report.counts.state, "unavailable");
    assert.equal(report.restoreCandidates.some(({ state }) => state === "verified-compatible"), true);
  });
});

describe("offline exact-backup restore", () => {
  it("consumes the exact issued proof when the wall clock advances before exclusive verification", async () => {
    const root = testRoot();
    const authorityPath = join(root, "state.sqlite");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    const { manifestPath } = await createBackup(database, directory);
    database.close();
    const advancingClock = manualClock(new Date(NOW));
    const proof = stoppedProof(root, authorityPath, advancingClock);
    advancingClock.advanceWall(1);
    const restore = new OfflineAuthorityRestoreService(
      restoreOptions(root, authorityPath),
      async () => undefined,
      advancingClock,
    );
    await assert.doesNotReject(restore.restore({ manifestPath, stoppedSystemProof: proof }));
  });

  it("preserves nonempty failure, result, terminal-outbox, and authorization authority", async () => {
    const root = testRoot();
    const authorityPath = join(root, "terminal-state.sqlite");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    const seeded = seedTerminalAuthority(database);
    const generation = database.getMeta().authorityGeneration;
    const { manifestPath } = await createBackup(database, directory);
    database.close();

    const restore = new OfflineAuthorityRestoreService(
      restoreOptions(root, authorityPath),
      async () => undefined,
      CLOCK,
    );
    const report = await restore.restore({
      manifestPath,
      stoppedSystemProof: stoppedProof(root, authorityPath),
    });
    assert.equal(report.authorityGeneration, generation);
    const restored = openDatabase(authorityPath);
    assert.deepEqual(restored.authority.failures.get(seeded.failure.failureId), seeded.failure);
    assert.deepEqual(restored.authority.runResults.get(seeded.result.runId), seeded.result);
    assert.deepEqual(
      restored.authority.runTerminalOutbox.get(seeded.outbox.outboxId),
      seeded.outbox,
    );
    assert.deepEqual(
      restored.authority.terminalAuthorizations.get(seeded.failure.runId),
      seeded.failureAuthorization,
    );
    assert.deepEqual(
      restored.authority.terminalAuthorizations.get(seeded.result.runId),
      seeded.successAuthorization,
    );
  });

  it("preserves the suspect DB, rebuilds projections only, and atomically restores authority", async () => {
    const root = testRoot();
    const authorityPath = join(root, "state.sqlite");
    const directory = backupDirectory(root);
    const suspects = join(root, "suspects");
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    const { manifestPath } = await createBackup(database, directory);
    database.authority.notifications.create(NOTIFICATION);
    database.close();
    writeFileSync(`${authorityPath}-wal`, "suspect wal bytes");
    writeFileSync(`${authorityPath}-shm`, "suspect shm bytes");

    const restore = new OfflineAuthorityRestoreService(restoreOptions(root, authorityPath, suspects), async (stagedPath) => {
      const staged = AuthorityDatabase.open(databaseOptions(stagedPath), CLOCK);
      staged.projections.spans.upsert(PROJECTION_RECORD);
      staged.close();
    }, CLOCK);
    const report = await restore.restore({ manifestPath, stoppedSystemProof: stoppedProof(root, authorityPath) });
    assert.equal(report.state, "restored");
    assert.equal(report.authorityGeneration, 1);
    assert.equal(existsSync(join(suspects, report.suspectFileName)), true);
    assert.equal(readFileSync(join(suspects, `${report.suspectFileName}-wal`), "utf8"), "suspect wal bytes");
    assert.equal(readFileSync(join(suspects, `${report.suspectFileName}-shm`), "utf8"), "suspect shm bytes");
    assert.equal(existsSync(`${authorityPath}-wal`), false);
    assert.equal(existsSync(`${authorityPath}-shm`), false);
    const restored = openDatabase(authorityPath);
    assert.deepEqual(restored.authority.commands.get(UUID_1), COMMAND_FIXTURES[0]);
    assert.equal(restored.authority.notifications.get(UUID_3), undefined);
    assert.deepEqual(restored.projections.spans.get(HASH_A), PROJECTION_RECORD);
  });

  it("refuses restore without the explicit stopped-system proof before preserving or swapping", async () => {
    const root = testRoot();
    const authorityPath = join(root, "state.sqlite");
    const directory = backupDirectory(root);
    const suspects = join(root, "suspects");
    const database = openDatabase(authorityPath);
    const { manifestPath } = await createBackup(database, directory);
    database.close();
    const before = readFileSync(authorityPath);
    const restore = new OfflineAuthorityRestoreService(restoreOptions(root, authorityPath, suspects), async () => undefined, CLOCK);
    const proof = stoppedProof(root, authorityPath);
    await assert.rejects(restore.restore({
      manifestPath,
      stoppedSystemProof: { ...proof, runtimeGeneration: proof.runtimeGeneration + 1 },
    }), /does not match its issued one-time record/);
    assert.deepEqual(readFileSync(authorityPath), before);
    assert.equal(existsSync(suspects), false);
  });

  it("refuses when a worker starts after the stopped proof was issued", async () => {
    const root = testRoot();
    const authorityPath = join(root, "state.sqlite");
    const directory = backupDirectory(root);
    const suspects = join(root, "suspects");
    const database = openDatabase(authorityPath);
    const { manifestPath } = await createBackup(database, directory);
    database.close();
    const proof = stoppedProof(root, authorityPath);
    const worker = acquireRuntimeProcessLock({
      processLockRoot: join(root, "locks"),
      name: "workers",
      workerId: "person-lookup-worker-2",
      pid: process.pid,
    }, CLOCK);
    try {
      const restore = new OfflineAuthorityRestoreService(
        restoreOptions(root, authorityPath, suspects),
        async () => undefined,
        CLOCK,
      );
      await assert.rejects(
        restore.restore({ manifestPath, stoppedSystemProof: proof }),
        /workers process lock generation .* is active for pid/u,
      );
      assert.equal(existsSync(suspects), false);
      assert.equal(AuthorityDatabase.inspectExistingReadOnly(authorityPath).authorityGeneration, 0);
    } finally {
      worker.release();
    }
  });

  it("refuses a never-run proof after the first singleton starts and releases", async () => {
    const root = testRoot();
    const authorityPath = join(root, "state.sqlite");
    const directory = backupDirectory(root);
    const suspects = join(root, "suspects");
    const database = openDatabase(authorityPath);
    const { manifestPath } = await createBackup(database, directory);
    database.close();
    const authorityBytes = readFileSync(authorityPath);
    const proof = stoppedProof(root, authorityPath);
    const server = acquireRuntimeProcessLock({
      processLockRoot: join(root, "locks"),
      name: "server",
      pid: process.pid,
    }, CLOCK);
    assert.equal(server.generation, 2);
    server.release();

    const restore = new OfflineAuthorityRestoreService(
      restoreOptions(root, authorityPath, suspects),
      async () => undefined,
      CLOCK,
    );
    await assert.rejects(
      restore.restore({ manifestPath, stoppedSystemProof: proof }),
      /does not match current runtime and process-lock generations/u,
    );
    assert.deepEqual(readFileSync(authorityPath), authorityBytes);
    assert.equal(existsSync(suspects), false);
  });

  it("holds exclusive admission through verification and authority replacement", async () => {
    const root = testRoot();
    const authorityPath = join(root, "state.sqlite");
    const directory = backupDirectory(root);
    const suspects = join(root, "suspects");
    const database = openDatabase(authorityPath);
    const { manifestPath } = await createBackup(database, directory);
    database.close();
    const proof = stoppedProof(root, authorityPath);
    const restore = new OfflineAuthorityRestoreService(
      restoreOptions(root, authorityPath, suspects),
      async () => {
        const worker = acquireRuntimeProcessLock({
          processLockRoot: join(root, "locks"),
          name: "workers",
          workerId: "person-lookup-worker-2",
          pid: process.pid,
        }, CLOCK);
        worker.release();
      },
      CLOCK,
    );
    await assert.rejects(
      restore.restore({ manifestPath, stoppedSystemProof: proof }),
      /restore admission .* is held by live pid/u,
    );
    assert.equal(AuthorityDatabase.inspectExistingReadOnly(authorityPath).authorityGeneration, 0);
  });

  it("does not fall back when the exact newest manifest is bad", async () => {
    const root = testRoot();
    const authorityPath = join(root, "state.sqlite");
    const directory = backupDirectory(root);
    const suspects = join(root, "suspects");
    const database = openDatabase(authorityPath);
    await createBackup(database, directory);
    database.close();
    const badManifestPath = join(directory, "newest-bad.manifest.json");
    writeFileSync(badManifestPath, "{ invalid");
    const restore = new OfflineAuthorityRestoreService(restoreOptions(root, authorityPath, suspects), async () => undefined, CLOCK);
    await assert.rejects(
      restore.restore({ manifestPath: badManifestPath, stoppedSystemProof: stoppedProof(root, authorityPath) }),
    );
    assert.equal(manifestPaths(directory).length, 2);
    assert.equal(existsSync(suspects), false);
    assert.equal(AuthorityDatabase.inspectExistingReadOnly(authorityPath).authorityGeneration, 0);
  });

  it("keeps live and suspect recoverable when projection rebuild fails", async () => {
    const root = testRoot();
    const authorityPath = join(root, "state.sqlite");
    const directory = backupDirectory(root);
    const suspects = join(root, "suspects");
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    const { manifestPath } = await createBackup(database, directory);
    database.authority.notifications.create(NOTIFICATION);
    database.close();
    const liveGeneration = AuthorityDatabase.inspectExistingReadOnly(authorityPath).authorityGeneration;
    writeFileSync(`${authorityPath}-wal`, "live wal bytes");
    writeFileSync(`${authorityPath}-shm`, "live shm bytes");
    const restore = new OfflineAuthorityRestoreService(restoreOptions(root, authorityPath, suspects), () => Promise.reject(new Error("injected projection rebuild failure")), CLOCK);
    await assert.rejects(
      restore.restore({ manifestPath, stoppedSystemProof: stoppedProof(root, authorityPath) }),
      /injected projection rebuild failure/,
    );
    assert.equal(AuthorityDatabase.inspectExistingReadOnly(authorityPath).authorityGeneration, liveGeneration);
    assert.equal(readdirSync(suspects).length > 0, true);
    assert.equal(readdirSync(root).some((name) => name.startsWith(".restore-")), false);
  });

  it("leaves live authority untouched on an injected atomic-swap failure", async () => {
    const root = testRoot();
    const authorityPath = join(root, "state.sqlite");
    const directory = backupDirectory(root);
    const suspects = join(root, "suspects");
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    const { manifestPath } = await createBackup(database, directory);
    database.authority.notifications.create(NOTIFICATION);
    database.close();
    const liveGeneration = AuthorityDatabase.inspectExistingReadOnly(authorityPath).authorityGeneration;
    writeFileSync(`${authorityPath}-wal`, "live wal bytes");
    writeFileSync(`${authorityPath}-shm`, "live shm bytes");
    const restore = new OfflineAuthorityRestoreService(
      restoreOptions(root, authorityPath, suspects),
      async () => undefined,
      CLOCK,
      {
        copyFile: copyFileSync,
        atomicReplace: () => { throw new Error("injected atomic swap failure"); },
      },
    );
    await assert.rejects(
      restore.restore({ manifestPath, stoppedSystemProof: stoppedProof(root, authorityPath) }),
      /injected atomic swap failure/,
    );
    assert.equal(readFileSync(`${authorityPath}-wal`, "utf8"), "live wal bytes");
    assert.equal(readFileSync(`${authorityPath}-shm`, "utf8"), "live shm bytes");
    assert.equal(AuthorityDatabase.inspectExistingReadOnly(authorityPath).authorityGeneration, liveGeneration);
    assert.equal(readdirSync(suspects).length > 0, true);
  });

  it("restores a companion when its displacement rename throws after moving it", async () => {
    const root = testRoot();
    const authorityPath = join(root, "state.sqlite");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    const { manifestPath } = await createBackup(database, directory);
    database.close();
    writeFileSync(`${authorityPath}-wal`, "live wal bytes");
    const restore = new OfflineAuthorityRestoreService(
      restoreOptions(root, authorityPath),
      async () => undefined,
      CLOCK,
      {
        copyFile: copyFileSync,
        atomicReplace: renameSync,
        renamePath: (source, destination) => {
          renameSync(source, destination);
          if (source === `${authorityPath}-wal` && destination.endsWith(".live-companion")) {
            throw new Error("injected displacement error after rename");
          }
        },
      },
    );

    let failure: unknown;
    try {
      await restore.restore({ manifestPath, stoppedSystemProof: stoppedProof(root, authorityPath) });
    } catch (error) {
      failure = error;
    }

    assert.ok(failure instanceof OfflineRestoreFailure);
    assert.equal(failure.authorityState, "unchanged");
    assert.match(failure.message, /injected displacement error after rename/u);
    assert.ok(failure.cause instanceof Error);
    assert.equal(failure.cause.message, "injected displacement error after rename");
    assert.equal(readFileSync(`${authorityPath}-wal`, "utf8"), "live wal bytes");
    assert.equal(readdirSync(root).some((name) => name.endsWith(".live-companion")), false);
  });

  it("reports authority replaced when atomic swap throws after replacing it", async () => {
    const root = testRoot();
    const authorityPath = join(root, "state.sqlite");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    const backupGeneration = database.getMeta().authorityGeneration;
    const { manifestPath } = await createBackup(database, directory);
    database.authority.notifications.create(NOTIFICATION);
    database.close();
    const restore = new OfflineAuthorityRestoreService(
      restoreOptions(root, authorityPath),
      async () => undefined,
      CLOCK,
      {
        copyFile: copyFileSync,
        atomicReplace: (source, destination) => {
          renameSync(source, destination);
          throw new Error("injected atomic swap error after rename");
        },
      },
    );

    let failure: unknown;
    try {
      await restore.restore({ manifestPath, stoppedSystemProof: stoppedProof(root, authorityPath) });
    } catch (error) {
      failure = error;
    }

    assert.ok(failure instanceof OfflineRestoreFailure);
    assert.equal(failure.authorityState, "replaced");
    assert.match(failure.message, /injected atomic swap error after rename/u);
    assert.ok(failure.cause instanceof Error);
    assert.equal(failure.cause.message, "injected atomic swap error after rename");
    assert.equal(
      AuthorityDatabase.inspectExistingReadOnly(authorityPath).authorityGeneration,
      backupGeneration,
    );
  });

  it("reports cleanup-only failure after authority replacement and names the staged path", async () => {
    const root = testRoot();
    const authorityPath = join(root, "state.sqlite");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    const { manifestPath } = await createBackup(database, directory);
    database.close();
    let cleanupPath = "";
    const restore = new OfflineAuthorityRestoreService(
      restoreOptions(root, authorityPath),
      async () => undefined,
      CLOCK,
      {
        copyFile: copyFileSync,
        atomicReplace: (source, destination) => {
          renameSync(source, destination);
          cleanupPath = `${source}-wal`;
          writeFileSync(cleanupPath, "staged cleanup bytes");
        },
        removePath: (path) => {
          if (path === cleanupPath) throw new Error("injected staged cleanup failure");
          rmSync(path);
        },
      },
    );

    let failure: unknown;
    try {
      await restore.restore({ manifestPath, stoppedSystemProof: stoppedProof(root, authorityPath) });
    } catch (error) {
      failure = error;
    }

    assert.ok(failure instanceof OfflineRestoreFailure);
    assert.equal(failure.authorityState, "replaced");
    assert.match(failure.message, /injected staged cleanup failure/u);
    assert.match(failure.message, new RegExp(cleanupPath, "u"));
    assert.equal(existsSync(cleanupPath), true);
  });

  it("preserves primary failure before staged cleanup failure", async () => {
    const root = testRoot();
    const authorityPath = join(root, "state.sqlite");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    const { manifestPath } = await createBackup(database, directory);
    database.close();
    let stagedPath = "";
    const primaryError = new Error("injected primary projection failure");
    const restore = new OfflineAuthorityRestoreService(
      restoreOptions(root, authorityPath),
      async (path) => {
        stagedPath = path;
        throw primaryError;
      },
      CLOCK,
      {
        copyFile: copyFileSync,
        atomicReplace: renameSync,
        removePath: (path) => {
          if (path === stagedPath) throw new Error("injected cleanup after primary failure");
          rmSync(path);
        },
      },
    );

    let failure: unknown;
    try {
      await restore.restore({ manifestPath, stoppedSystemProof: stoppedProof(root, authorityPath) });
    } catch (error) {
      failure = error;
    }

    assert.ok(failure instanceof OfflineRestoreFailure);
    assert.equal(failure.authorityState, "unchanged");
    assert.match(failure.message, /injected primary projection failure/u);
    assert.match(failure.message, /injected cleanup after primary failure/u);
    assert.match(failure.message, new RegExp(stagedPath, "u"));
    assert.ok(failure.cause instanceof AggregateError);
    assert.equal(failure.cause.cause, primaryError);
    assert.equal(failure.cause.errors[0], primaryError);
    assert.equal(existsSync(stagedPath), true);
  });

  it.each([
    { operation: "rename", expectedLiveCompanion: false },
    { operation: "fsync", expectedLiveCompanion: false },
    { operation: "unlink", expectedLiveCompanion: true },
  ] as const)("reports uncertain companion state when rollback $operation fails", async ({
    operation,
    expectedLiveCompanion,
  }) => {
    const root = testRoot();
    const authorityPath = join(root, "state.sqlite");
    const directory = backupDirectory(root);
    const suspects = join(root, "suspects");
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    const { manifestPath } = await createBackup(database, directory);
    database.authority.notifications.create(NOTIFICATION);
    database.close();
    const liveAuthorityBytes = readFileSync(authorityPath);
    writeFileSync(`${authorityPath}-wal`, "live wal bytes");
    let swapAttempted = false;
    const rollbackMessage = `injected rollback ${operation} failure`;
    const restore = new OfflineAuthorityRestoreService(
      restoreOptions(root, authorityPath, suspects),
      async () => undefined,
      CLOCK,
      {
        copyFile: copyFileSync,
        atomicReplace: () => {
          swapAttempted = true;
          throw new Error("injected atomic swap failure");
        },
        renamePath: (source, destination) => {
          if (operation === "rename" && swapAttempted && source.endsWith(".rollback.tmp")) {
            throw new Error(rollbackMessage);
          }
          renameSync(source, destination);
        },
        removePath: (path) => {
          if (operation === "unlink" && path.endsWith(".live-companion")) {
            throw new Error(rollbackMessage);
          }
          rmSync(path);
        },
        syncPath: (path) => {
          if (operation === "fsync" && swapAttempted && path.endsWith(".rollback.tmp")) {
            throw new Error(rollbackMessage);
          }
        },
      },
    );

    let failure: unknown;
    try {
      await restore.restore({ manifestPath, stoppedSystemProof: stoppedProof(root, authorityPath) });
    } catch (error) {
      failure = error;
    }

    assert.ok(failure instanceof OfflineRestoreFailure);
    assert.equal(String(failure.authorityState), "companion-state-uncertain");
    assert.match(failure.message, /injected atomic swap failure/u);
    assert.match(failure.message, new RegExp(rollbackMessage, "u"));
    assert.ok(failure.cause instanceof AggregateError);
    assert.equal(
      failure.cause.errors.some((error) => error instanceof Error && error.message === rollbackMessage),
      true,
    );
    assert.deepEqual(readFileSync(authorityPath), liveAuthorityBytes);
    assert.equal(existsSync(`${authorityPath}-wal`), expectedLiveCompanion);
    if (expectedLiveCompanion) {
      assert.equal(readFileSync(`${authorityPath}-wal`, "utf8"), "live wal bytes");
    }
    assert.equal(
      readdirSync(root).some((name) => name.endsWith(".live-companion")),
      true,
    );
  });

  it("refuses when verified backup bytes mutate during the staged copy", async () => {
    const root = testRoot();
    const authorityPath = join(root, "state.sqlite");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    const { manifestPath } = await createBackup(database, directory);
    database.authority.notifications.create(NOTIFICATION);
    database.close();
    const liveBytes = readFileSync(authorityPath);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { backupFileName: string };
    const backupPath = join(directory, manifest.backupFileName);
    const restore = new OfflineAuthorityRestoreService(
      restoreOptions(root, authorityPath),
      async () => undefined,
      CLOCK,
      {
        copyFile: (source, destination) => {
          if (source === backupPath) {
            const bytes = readFileSync(source);
            bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff;
            writeFileSync(source, bytes);
          }
          copyFileSync(source, destination);
        },
        atomicReplace: renameSync,
      },
    );
    await assert.rejects(
      restore.restore({ manifestPath, stoppedSystemProof: stoppedProof(root, authorityPath) }),
      /staged restore .* checksum does not match verified manifest/u,
    );
    assert.deepEqual(readFileSync(authorityPath), liveBytes);
  });

  it("classifies post-swap directory fsync failure as authority replaced", async () => {
    const root = testRoot();
    const authorityPath = join(root, "state.sqlite");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    const generation = database.getMeta().authorityGeneration;
    const { manifestPath } = await createBackup(database, directory);
    database.close();
    let swapped = false;
    const restore = new OfflineAuthorityRestoreService(
      restoreOptions(root, authorityPath),
      async () => undefined,
      CLOCK,
      {
        copyFile: copyFileSync,
        atomicReplace: (source, destination) => {
          renameSync(source, destination);
          swapped = true;
        },
        syncPath: () => {
          if (swapped) throw new Error("injected post-swap directory fsync failure");
        },
      },
    );
    await assert.rejects(
      restore.restore({ manifestPath, stoppedSystemProof: stoppedProof(root, authorityPath) }),
      replacedFailure(/post-swap directory fsync failure/u),
    );
    assert.equal(AuthorityDatabase.inspectExistingReadOnly(authorityPath).authorityGeneration, generation);
  });

  it("classifies post-swap report validation failure as authority replaced", async () => {
    const root = testRoot();
    const authorityPath = join(root, "state.sqlite");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    const { manifestPath } = await createBackup(database, directory);
    database.close();
    let swapped = false;
    const reportClock = {
      ...CLOCK,
      now: (): Date => swapped ? new Date(Number.NaN) : CLOCK.now(),
    };
    const restore = new OfflineAuthorityRestoreService(
      restoreOptions(root, authorityPath),
      async () => undefined,
      reportClock,
      {
        copyFile: copyFileSync,
        atomicReplace: (source, destination) => {
          renameSync(source, destination);
          swapped = true;
        },
      },
    );
    await assert.rejects(
      restore.restore({ manifestPath, stoppedSystemProof: stoppedProof(root, authorityPath, reportClock) }),
      replacedFailure(/Invalid time value/u),
    );
  });

  it("classifies exclusive-admission release failure after swap as authority replaced", async () => {
    const root = testRoot();
    const authorityPath = join(root, "state.sqlite");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    const { manifestPath } = await createBackup(database, directory);
    database.close();
    const restore = new OfflineAuthorityRestoreService(
      restoreOptions(root, authorityPath),
      async () => undefined,
      CLOCK,
      undefined,
      (input, clock) => {
        const admission = acquireRuntimeRestoreAdmission(input, clock);
        return Object.freeze({
          admissionId: admission.admissionId,
          release: (): void => {
            admission.release();
            throw new Error("injected admission release failure");
          },
        });
      },
    );
    await assert.rejects(
      restore.restore({ manifestPath, stoppedSystemProof: stoppedProof(root, authorityPath) }),
      replacedFailure(/admission release failure/u),
    );
  });

  it("rejects stale, replayed, generation-mismatched, and currently-active process-lock proofs", async () => {
    const root = testRoot();
    const authorityPath = join(root, "state.sqlite");
    const directory = backupDirectory(root);
    const suspects = join(root, "suspects");
    const database = openDatabase(authorityPath);
    const { manifestPath } = await createBackup(database, directory);
    database.close();

    const staleClock = manualClock(new Date(NOW));
    const staleProof = stoppedProof(root, authorityPath, staleClock);
    staleClock.advanceWall(60_001);
    const staleRestore = new OfflineAuthorityRestoreService(
      restoreOptions(root, authorityPath, suspects),
      async () => undefined,
      staleClock,
    );
    await assert.rejects(
      staleRestore.restore({ manifestPath, stoppedSystemProof: staleProof }),
      /proof .* is stale/,
    );
    assert.equal(existsSync(suspects), false);

    const currentProof = stoppedProof(root, authorityPath);
    const startedAndStopped = acquireRuntimeProcessLock({
      processLockRoot: join(root, "locks"),
      name: "workers",
      workerId: "person-lookup-worker-1",
      pid: process.pid,
    }, CLOCK);
    startedAndStopped.release();
    const mismatchedRestore = new OfflineAuthorityRestoreService(
      restoreOptions(root, authorityPath, suspects),
      async () => undefined,
      CLOCK,
    );
    await assert.rejects(
      mismatchedRestore.restore({ manifestPath, stoppedSystemProof: currentProof }),
      /does not match current runtime and process-lock generations/,
    );
    assert.equal(existsSync(suspects), false);

    const activeProof = stoppedProof(root, authorityPath);
    const activeServer = acquireRuntimeProcessLock({
      processLockRoot: join(root, "locks"),
      name: "server",
      pid: process.pid,
    }, CLOCK);
    const activeRestore = new OfflineAuthorityRestoreService(
      restoreOptions(root, authorityPath, suspects),
      async () => undefined,
      CLOCK,
    );
    try {
      await assert.rejects(
        activeRestore.restore({ manifestPath, stoppedSystemProof: activeProof }),
        /server process lock generation .* is active for pid/,
      );
    } finally {
      activeServer.release();
    }
    assert.equal(existsSync(suspects), false);

    const replayProof = stoppedProof(root, authorityPath);
    const replayRestore = new OfflineAuthorityRestoreService(
      restoreOptions(root, authorityPath, suspects),
      async () => undefined,
      CLOCK,
    );
    await replayRestore.restore({ manifestPath, stoppedSystemProof: replayProof });
    const suspectsAfterFirstRestore = readdirSync(suspects).length;
    await assert.rejects(
      replayRestore.restore({ manifestPath, stoppedSystemProof: replayProof }),
      /was already consumed/,
    );
    assert.equal(readdirSync(suspects).length, suspectsAfterFirstRestore);
  });

  it("rejects a checksum-valid restore copy whose authority record is schema-invalid", async () => {
    const root = testRoot();
    const authorityPath = join(root, "state.sqlite");
    const directory = backupDirectory(root);
    const suspects = join(root, "suspects");
    const database = openDatabase(authorityPath);
    const { manifestPath } = await createBackup(database, directory);
    database.close();
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown> & { backupFileName: string };
    const backupPath = join(directory, manifest.backupFileName);
    const corruptBackup = new DatabaseSync(backupPath);
    // Columns the v4 triggers demand are all present and plausible; only the
    // record JSON is not a run. Corruption that satisfies the column contract
    // is exactly what record-schema validation exists to catch — a shape check
    // at the column level would wave this row through.
    corruptBackup.prepare(`
      INSERT INTO tasks (
        record_key, workflow, item_id, state, priority, attempt,
        claim_generation, version, record_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(UUID_8, "person-lookup", UUID_8, "queued", "bulk", 1, 0, 1, JSON.stringify({ recordId: UUID_8 }), NOW);
    corruptBackup.close();
    const bytes = readFileSync(backupPath);
    writeFileSync(manifestPath, JSON.stringify({
      ...manifest,
      byteSize: statSync(backupPath).size,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    }));

    const restore = new OfflineAuthorityRestoreService(
      restoreOptions(root, authorityPath, suspects),
      async () => undefined,
      CLOCK,
    );
    await assert.rejects(
      restore.restore({ manifestPath, stoppedSystemProof: stoppedProof(root, authorityPath) }),
      /tasks record .* failed strict record schema validation/,
    );
    assert.equal(existsSync(suspects), false);
  });
});

function replacedFailure(message: RegExp): (error: unknown) => boolean {
  return (error: unknown): boolean => error instanceof OfflineRestoreFailure
    && error.authorityState === "replaced"
    && message.test(error.message);
}

describe("authority.health preflight and static recovery boundary", () => {
  it("fails authority.health when a span-known run has no exact authority", async () => {
    const root = testRoot();
    const authorityPath = join(root, "state.sqlite");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    await createBackup(database, directory);
    emitQueuedSpan(root);
    const runner = new AuthorityHealthPreflightRunner({
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: directory,
      maxBackupAgeMs: 60_000,
      busyTimeoutMs: 100,
    }, CLOCK);

    const observation = await executePreflightRunner(runner, new AbortController().signal, CLOCK);

    assert.equal(observation.state, "unhealthy");
    assert.match(observation.summary, /span authority is degraded/);
  });

  it("projects doctor health through the registered authority.health runner", async () => {
    const root = testRoot();
    const authorityPath = join(root, "state.sqlite");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    await createBackup(database, directory);
    const runner = new AuthorityHealthPreflightRunner({
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: directory,
      maxBackupAgeMs: 60_000,
      busyTimeoutMs: 100,
    }, CLOCK);
    const healthy = await executePreflightRunner(runner, new AbortController().signal, CLOCK);
    assert.equal(healthy.state, "healthy");

    rmSync(directory, { recursive: true });
    const unhealthy = await executePreflightRunner(runner, new AbortController().signal, CLOCK);
    assert.equal(unhealthy.state, "unhealthy");
    assert.match(unhealthy.summary, /backup state is missing/);
  });

  it("keeps the native handle private and bans live-copy or VACUUM backup fallbacks", () => {
    const adapterPath = "src/infra/sqlite/authority-database.ts";
    const sourceFiles = gitVisibleFiles(["src"]).filter((path) => path.endsWith(".ts") || path.endsWith(".tsx"));
    const sqliteImports: string[] = [];
    const nativeHandleMentions: string[] = [];
    for (const path of sourceFiles) {
      const source = readFileSync(join(REPO_ROOT, path), "utf8");
      if (/from\s+["']node:sqlite["']/.test(source)) sqliteImports.push(path);
      if (/\bDatabaseSync\b/.test(source)) nativeHandleMentions.push(path);
      assert.doesNotMatch(source, /VACUUM\s+INTO/i, path);
    }
    assert.deepEqual(sqliteImports, [adapterPath]);
    assert.deepEqual(nativeHandleMentions, [adapterPath]);
    const adapter = readFileSync(join(REPO_ROOT, adapterPath), "utf8");
    const backupService = readFileSync(join(REPO_ROOT, "src/infra/sqlite/backup-service.ts"), "utf8");
    assert.match(adapter, /backup as sqliteBackup/);
    assert.doesNotMatch(`${adapter}\n${backupService}`, /\bcopyFile(?:Sync)?\b/);
    assert.doesNotMatch(readFileSync(join(REPO_ROOT, "src/infra/sqlite/index.ts"), "utf8"), /DatabaseSync|node:sqlite/);
  });
});
