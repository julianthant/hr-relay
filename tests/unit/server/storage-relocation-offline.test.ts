import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, it } from "vitest";
import { executeSettingsCommand, executeStorageRelocationCommand } from "../../../src/core/command-kernel.js";
import { createStorageRelocationPlanReader } from "../../../src/core/storage-relocation-plans.js";
import { rebuildRuntimeIsolation } from "../../../src/config/runtime-isolation.js";
import { manualClock } from "../../../src/domain/clock.js";
import { sealArchiveReport } from "../../../src/domain/archive/report.js";
import { StorageRelocationCommandRequestSchema, storageRelocationDesiredDigest,
  storageRelocationRequestFingerprint } from "../../../src/domain/commands.js";
import { hostConfigFacts } from "../../../src/domain/config/host-display.js";
import { resolveConfigWithProvenance } from "../../../src/domain/config/resolve.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint } from "../../../src/domain/config/settings.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH, ProtectedSettingsApplyInputSchema } from "../../../src/domain/config/protected-settings.js";
import { ArchiveDatabase } from "../../../src/infra/sqlite/archive-database.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/authority-database.js";
import { createCredentialStore } from "../../../src/infra/config/credential-store.js";
import { acquireInitialRuntimeAdmission, acquireSharedRuntimeAdmission } from "../../../src/infra/runtime-control/admission.js";
import { createSettingsApplicationExecutor } from "../../../src/server/dashboard/commands/settings-service.js";
import { readSettings } from "../../../src/server/settings-runtime.js";

const clock = manualClock(new Date("2026-09-26T12:00:00.000Z"));
const WAL_TIMESTAMP = "2026-09-26T12:01:00.000Z";
const cleanup: string[] = [];
afterEach(() => { for (const root of cleanup.splice(0)) rmSync(root, { recursive: true, force: true }); });

function installation() {
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
  const archiveFile = { digest: createHash("sha256").update(archiveFileBytes).digest("hex"),
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
  mkdirSync(join(source.stateRoot, "empty-managed"), { mode: 0o700 });
  mkdirSync(join(source.artifactRoot, "empty-artifacts"), { mode: 0o700 });
  writeFileSync(join(source.artifactRoot, "fixture-artifact.bin"), "synthetic-artifact-bytes", { mode: 0o600 });
  database.close();
  admission.release();
  return { root, workspace, source, authorityPath, archivedRunId, archivePath,
    credentialFile: join(source.stateRoot, "credentials", "protected.json"),
    artifactFile: join(source.artifactRoot, "fixture-artifact.bin") };
}

function plan(workspace: string, desiredPair: Readonly<{ stateRoot: string; artifactRoot: string }>) {
  const admission = acquireSharedRuntimeAdmission(workspace);
  try {
    const authority = AuthorityDatabase.open(admission, { path: join(admission.stateRoot, "state.db"),
      busyTimeoutMs: 250, migrationOwner: "offline-relocation-fixture" }, clock);
    try {
      const reader = createStorageRelocationPlanReader({ authority, admission, workspace });
      const view = reader.read();
      const target = { installationId: admission.locator.installationId,
        sourceGeneration: admission.locator.generation,
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

function leaveStoppedWal(authorityPath: string): void {
  const script = `const { DatabaseSync } = require("node:sqlite");
    const database = new DatabaseSync(process.argv[1]);
    database.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;");
    database.prepare("UPDATE database_state SET updated_at = ? WHERE singleton_id = 1").run(${JSON.stringify(WAL_TIMESTAMP)});
    process.exit(0);`;
  const result = spawnSync(process.execPath, ["-e", script, authorityPath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(`${authorityPath}-wal`), true);
}

function durableSnapshot(authorityPath: string, credentialFile: string, artifactFile: string) {
  const database = new DatabaseSync(authorityPath, { readOnly: true });
  try {
    const rows = (table: "app_settings" | "commands" | "command_audits") => database.prepare(
      `SELECT record_json FROM ${table} ORDER BY rowid`,
    ).all().map(row => String(row.record_json));
    return { appSettings: rows("app_settings"), commands: rows("commands"), audits: rows("command_audits"),
      walTimestamp: String(database.prepare("SELECT updated_at FROM database_state WHERE singleton_id = 1").get()?.updated_at),
      credentialDigest: createHash("sha256").update(readFileSync(credentialFile)).digest("hex"),
      artifactDigest: createHash("sha256").update(readFileSync(artifactFile)).digest("hex") };
  } finally { database.close(); }
}

it("prepares a genuine offline relocation fixture with settings, protected data, archive and managed artifacts", () => {
  const f = installation();
  const request = plan(f.workspace, { stateRoot: join(f.root, "new-state"), artifactRoot: join(f.root, "new-artifacts") });
  const admission = acquireSharedRuntimeAdmission(f.workspace);
  try {
    const database = AuthorityDatabase.open(admission, { path: f.authorityPath, busyTimeoutMs: 250,
      migrationOwner: "offline-relocation-fixture" }, clock);
    try {
      const reader = createStorageRelocationPlanReader({ authority: database, admission, workspace: f.workspace });
      assert.equal(reader.read().pending?.commandId, request.commandId);
      assert.equal(readSettings(database.authority).revision, 2);
      assert.equal(readFileSync(f.artifactFile, "utf8"), "synthetic-artifact-bytes");
      assert.ok(readFileSync(f.credentialFile).byteLength > 0);
      const archive = new ArchiveDatabase(admission, f.archivePath, { readOnly: true });
      try {
        assert.equal(archive.readPublished(f.archivedRunId)?.content.files.length, 1);
      } finally { archive.close(); }
    } finally { database.close(); }
  } finally { admission.release(); }
  leaveStoppedWal(f.authorityPath);
  const before = durableSnapshot(f.authorityPath, f.credentialFile, f.artifactFile);
  assert.equal(before.walTimestamp, WAL_TIMESTAMP);
  assert.equal(before.appSettings.length, 1);
  assert.equal(before.commands.length, 2);
  assert.equal(before.audits.length, 2);
});
