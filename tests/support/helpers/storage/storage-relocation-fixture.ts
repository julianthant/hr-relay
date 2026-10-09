import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { executeSettingsCommand, executeStorageRelocationCommand } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createStorageRelocationPlanReader } from "../../../../src/backend/storage/maintenance/storage-relocation-plans.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { sealArchiveReport } from "../../../../src/models/archive/report.js";
import { StorageRelocationCommandRequestSchema, storageRelocationDesiredDigest,
  storageRelocationRequestFingerprint } from "../../../../src/rules/commands/commands.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint } from "../../../../src/models/config/settings.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH, ProtectedSettingsApplyInputSchema } from "../../../../src/models/config/protected-settings.js";
import { FingerprintSchema, LOCAL_OPERATOR_ACTOR_ID, NonNegativeIntSchema } from "../../../../src/rules/identity/ids.js";
import { ArchiveDatabase } from "../../../../src/backend/storage/sqlite/archive-database.js";
import { createContentAddressedArtifactWriter } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AUTHORITY_APPLICATION_ID, SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import { createRunSearchIndex } from "../../../../src/backend/storage/sqlite/run-search-index.js";
import { createCredentialStore } from "../../../../src/backend/storage/configuration/credential-store.js";
import { acquireExclusiveRuntimeAdmission, acquireInitialRuntimeAdmission, acquireSharedRuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { readSettings } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { runOfflineStorageRelocation, StorageRelocationIncompleteError } from "../../../../src/backend/app/composition/storage/relocate.js";

export const clock = manualClock(new Date("2026-09-26T12:00:00.000Z"));
export const WAL_NOTIFICATION_TITLE = "Synthetic WAL-backed relocation notice";
const cleanup: string[] = [];
export function cleanupFixtureRoots(): void { for (const root of cleanup.splice(0)) rmSync(root, { recursive: true, force: true }); }

export async function installation(version: 55 | 56 = 56) {
  const root = mkdtempSync(join(tmpdir(), "storage-relocation-offline-"));
  cleanup.push(root);
  const workspace = join(root, "workspace");
  mkdirSync(workspace, { mode: 0o700 });
  const source = { stateRoot: join(workspace, rebuildRuntimeIsolation.stateRoot),
    artifactRoot: join(workspace, rebuildRuntimeIsolation.artifactRoot) };
  const authorityPath = join(source.stateRoot, "state.db");
  const admission = acquireInitialRuntimeAdmission(workspace,
    (pair, inspection) => ({ kind: "verified-existing", pair,
      authorityGeneration: AuthorityDatabase.inspectExistingReadOnly(inspection, authorityPath).authorityGeneration,
      databaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(authorityPath) }),
    (_pair, initialization) => {
      if (version === 55) {
        const raw = new DatabaseSync(authorityPath);
        raw.exec("BEGIN EXCLUSIVE");
        for (const migration of SQLITE_MIGRATIONS.filter(entry => entry.version <= 55)) {
          for (const statement of migration.statements) raw.exec(statement);
        }
        raw.prepare("INSERT INTO database_state(singleton_id,schema_version,authority_generation,updated_at,migration_owner,migration_started_at) VALUES (1,55,0,?,NULL,NULL)")
          .run(clock.now().toISOString());
        const baseline = { recordKey: randomUUID(), upgradeId: "fresh", phase: "baseline",
          fromSchemaVersion: 0, toSchemaVersion: 55, by: LOCAL_OPERATOR_ACTOR_ID, recordedAt: clock.now().toISOString() };
        raw.prepare("INSERT INTO database_upgrades(record_key,upgrade_id,phase,record_json,created_at) VALUES (?,?,?,?,?)")
          .run(baseline.recordKey, baseline.upgradeId, baseline.phase, canonicalJsonStringify(baseline), clock.now().toISOString());
        createRunSearchIndex(raw).initialize(0, clock.now().toISOString());
        raw.exec(`PRAGMA application_id = ${String(AUTHORITY_APPLICATION_ID)}; PRAGMA user_version = 55; COMMIT`);
        raw.close();
        return;
      }
      AuthorityDatabase.open(initialization, { path: authorityPath, busyTimeoutMs: 250,
        migrationOwner: "offline-relocation-fixture" }, clock).close();
    });
  const database = AuthorityDatabase.open(admission, { path: authorityPath, busyTimeoutMs: 250,
    migrationOwner: "offline-relocation-fixture" }, clock);
  const credentials = createCredentialStore({ admission, stateRoot: source.stateRoot });
  const credentialWrite = credentials.apply(ProtectedSettingsApplyInputSchema.parse({ commandId: randomUUID(),
    commandFingerprint: "1".repeat(64), expectedRevision: credentials.read().revision,
    protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: randomUUID(),
    entries: { ucpathPassword: { set: "synthetic-offline-relocation-value" } }, updatedAt: clock.now().toISOString() }));
  assert.equal(credentialWrite.state, "applied");
  const patch = { "display.screenWidth": { set: 1980 }, "display.screenHeight": { set: 1080 } } as const;
  const ordinary = executeSettingsCommand({ authority: database, clock, ids: { uuid: randomUUID },
    settings: createSettingsApplicationExecutor((value) => resolveConfigWithProvenance(value,
      hostConfigFacts({}), clock), credentials) }, {
    family: "settings", type: "apply-settings", commandId: randomUUID(), requestedAt: clock.now().toISOString(),
    requestedBy: "local-operator", source: "settings-surface",
    target: { expectedRevision: readSettings(database.authority).revision },
    payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH,
      patchFingerprint: deriveSettingsPatchFingerprint(patch), patch },
  });
  assert.equal(ordinary.state, "applied", JSON.stringify(ordinary));
  const archivePath = join(source.stateRoot, "archive.sqlite");
  const archivedRunId = randomUUID();
  const archiveFileBytes = Buffer.from("synthetic archived attachment");
  const archiveFile = { digest: FingerprintSchema.parse(createHash("sha256").update(archiveFileBytes).digest("hex")),
    byteLength: archiveFileBytes.byteLength, mediaType: "text/plain", name: "synthetic-archive.txt" };
  const archive = new ArchiveDatabase(admission, archivePath);
  try {
    archive.retainFile(archiveFile, archiveFileBytes);
    const report = sealArchiveReport({ schemaVersion: 1, runId: archivedRunId, transferId: randomUUID(),
      workflow: "person-lookup", itemId: "synthetic", attempt: 1, runNumber: null,
      title: "Synthetic archive", descriptorVersion: "1", outcome: "done",
      completedAt: clock.now().toISOString(), capturedAt: clock.now().toISOString(),
      sourceDigest: "a".repeat(64), sources: [], sections: [], files: [archiveFile] });
    archive.capture(report);
    archive.verify(archivedRunId, report.digest);
    archive.publish(archivedRunId, report.digest);
  } finally { archive.close(); }
  mkdirSync(join(source.stateRoot, "verified-byte-scratch"), { mode: 0o700 });
  const artifacts = createContentAddressedArtifactWriter({ admission });
  await artifacts.ready;
  const artifact = await artifacts.put(Buffer.from("synthetic-artifact-bytes"), { mediaType: "application/octet-stream" });
  database.close();
  admission.release();
  return { root, workspace, source, authorityPath, archivedRunId, archivePath,
    credentialFile: join(source.stateRoot, "credentials", "protected.json"),
    artifactFile: join(source.artifactRoot, `${artifact.sha256}.artifact`), artifact };
}

export async function relocate(workspace: string, requestId: string) {
  const admission = acquireExclusiveRuntimeAdmission(workspace);
  try {
    return await runOfflineStorageRelocation({ workspace,
      command: { kind: "plan", id: requestId, json: false }, admission, clock, hostFacts: hostConfigFacts({}) });
  } finally { admission.release(); }
}

export async function interruptedRelocation(workspace: string, requestId: string,
  fault: "afterNativePublish" | "afterActivationIntent" | "beforeActivationTransaction" | "afterActivationWrite"
    | "afterFinalBackup" | "afterVerifiedStage"
    | "afterFence" | "afterRetention" | "afterSwitch") {
  const admission = acquireExclusiveRuntimeAdmission(workspace);
  let operationId: string | undefined;
  try {
    await assert.rejects(runOfflineStorageRelocation({ workspace,
      command: { kind: "plan", id: requestId, json: false }, admission, clock, hostFacts: hostConfigFacts({}),
      faults: { [fault]: () => { throw new Error(`synthetic-interruption-${fault}`); } } }), error => {
      assert.ok(error instanceof StorageRelocationIncompleteError);
      assert.match(String(error.cause), new RegExp(`synthetic-interruption-${fault}`, "u"));
      operationId = error.operationId;
      return true;
    });
  } finally { admission.release(); }
  assert.ok(operationId);
  return runOfflineStorageRelocation({ workspace,
    command: { kind: "resume", id: operationId, json: false }, clock, hostFacts: hostConfigFacts({}) });
}

export function plan(workspace: string, desiredPair: Readonly<{ stateRoot: string; artifactRoot: string }>) {
  const admission = acquireSharedRuntimeAdmission(workspace);
  try {
    const authority = AuthorityDatabase.open(admission, { path: join(admission.stateRoot, "state.db"),
      busyTimeoutMs: 250, migrationOwner: "offline-relocation-fixture" }, clock);
    try {
      const reader = createStorageRelocationPlanReader({ authority, admission, workspace });
      const view = reader.read();
      const target = { installationId: admission.locator.installationId,
        sourceGeneration: NonNegativeIntSchema.parse(admission.locator.generation),
        sourcePair: { stateRoot: admission.stateRoot, artifactRoot: admission.artifactRoot },
        expectedRevision: view.revision };
      const draft = StorageRelocationCommandRequestSchema.parse({ family: "storage-relocation",
        type: "plan-storage-relocation", commandId: randomUUID(), requestedAt: clock.now().toISOString(),
        requestedBy: "local-operator", source: "settings-surface", target,
        payload: { writeId: randomUUID(), desiredPair,
          desiredDigest: storageRelocationDesiredDigest(target, desiredPair), requestFingerprint: "0".repeat(64) } });
      const request = StorageRelocationCommandRequestSchema.parse({ ...draft, payload: { ...draft.payload,
        requestFingerprint: storageRelocationRequestFingerprint(draft) } });
      const result = executeStorageRelocationCommand({ authority, clock, ids: { uuid: randomUUID },
        storageRelocationPlans: reader }, request);
      assert.equal(result.state, "applied");
      return request;
    } finally { authority.close(); }
  } finally { admission.release(); }
}

export function leaveStoppedWal(workspace: string, authorityPath: string): string {
  const notificationId = randomUUID();
  const script = `const { AuthorityDatabase } = await import("./src/backend/storage/sqlite/authority-database.ts");
    const { acquireSharedRuntimeAdmission } = await import("./src/backend/storage/admission/admission.ts");
    const { NotificationRecordSchema } = await import("./src/models/notifications/notifications.ts");
    const { manualClock } = await import("./src/rules/time/clock.ts");
    const admission = acquireSharedRuntimeAdmission(process.argv[1]);
    const database = AuthorityDatabase.open(admission,
      { path: process.argv[2], busyTimeoutMs: 250, migrationOwner: "offline-relocation-wal-child" },
      manualClock(new Date("2026-09-26T12:01:00.000Z")));
    const record = NotificationRecordSchema.parse({ notificationId: process.argv[3], actorId: "local-operator",
      dedupeFingerprint: "b".repeat(64), trigger: "backfill-gap", channel: "ping", status: "unread",
      snooze: { state: "not-snoozed" }, title: ${JSON.stringify(WAL_NOTIFICATION_TITLE)},
      summary: "Synthetic notice retained in WAL", links: [], count: 1, version: 1,
      createdAt: "2026-09-26T12:01:00.000Z", lastSeenAt: "2026-09-26T12:01:00.000Z",
      updatedAt: "2026-09-26T12:01:00.000Z" });
    database.withAuthorityTransaction(({ notifications }) => notifications.create(record));
    process.exit(0);`;
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script,
    workspace, authorityPath, notificationId], { encoding: "utf8", cwd: process.cwd() });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(`${authorityPath}-wal`), true);
  return notificationId;
}

export function durableSnapshot(authorityPath: string, credentialFile: string, artifactFile: string) {
  const database = new DatabaseSync(authorityPath, { readOnly: true });
  try {
    const rows = (table: "app_settings" | "settings_snapshots" | "commands" | "command_audits" | "notifications") => database.prepare(
      `SELECT record_json FROM ${table} ORDER BY rowid`,
    ).all().map(row => String(row.record_json));
    return { appSettings: rows("app_settings"), settingsSnapshots: rows("settings_snapshots"),
      commands: rows("commands"), audits: rows("command_audits"),
      notifications: rows("notifications"),
      credentialDigest: createHash("sha256").update(readFileSync(credentialFile)).digest("hex"),
      artifactDigest: createHash("sha256").update(readFileSync(artifactFile)).digest("hex") };
  } finally { database.close(); }
}
