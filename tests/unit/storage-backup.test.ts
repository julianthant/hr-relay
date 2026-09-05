import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import {
  PROTECTED_SETTINGS_SCHEMA_HASH,
} from "../../src/domain/config/protected-settings.js";
import {
  CURRENT_SETTINGS_SCHEMA_HASH,
  deriveSettingsPatchFingerprint,
} from "../../src/domain/config/settings.js";
import { settingsRootPaths } from "../../src/domain/config/settings-root.js";
import {
  createProtectedSettingsFileAuthority,
  createSettingsFileAuthority,
} from "../../src/infra/config/settings-file.js";
import {
  AuthorityBackupService,
  verifyBackupManifestAtPath,
} from "../../src/infra/sqlite/backup-service.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/authority-database.js";
import { AuthorityBackupManifestSchema } from "../../src/infra/sqlite/recovery-contracts.js";

const NOW = "2026-09-04T20:00:00.000Z";
const HASH = "a".repeat(64);
const roots: string[] = [];
const databases: AuthorityDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function world(protectedValue: string) {
  const root = mkdtempSync(join(tmpdir(), "hrauto-settings-backup-"));
  roots.push(root);
  const stateRoot = join(root, ".tracker");
  const paths = settingsRootPaths(stateRoot);
  const ordinaryStore = createSettingsFileAuthority({ path: paths.ordinary, validateCandidate: () => undefined });
  const ordinaryPatch = { "browser.headless": { set: false } };
  const ordinaryApplied = ordinaryStore.apply({
    commandId: "00000000-0000-4000-8000-000000000003",
    commandFingerprint: HASH,
    expectedRevision: 1,
    settingsSchemaHash: CURRENT_SETTINGS_SCHEMA_HASH,
    patchFingerprint: deriveSettingsPatchFingerprint(ordinaryPatch),
    patch: ordinaryPatch,
  });
  assert.equal(ordinaryApplied.state, "applied");
  if (ordinaryApplied.state === "applied") ordinaryApplied.commit();
  const protectedStore = createProtectedSettingsFileAuthority({
    path: paths.ordinary,
    assertWriteIdAvailable: () => undefined,
  });
  protectedStore.read();
  const applied = protectedStore.apply({
    commandId: "00000000-0000-4000-8000-000000000001",
    commandFingerprint: HASH,
    expectedRevision: 1,
    protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
    writeId: "00000000-0000-4000-8000-000000000002",
    entries: { ucpathPassword: { set: protectedValue } },
    updatedAt: NOW,
  });
  assert.equal(applied.state, "applied");
  if (applied.state === "applied") applied.commit();
  const database = AuthorityDatabase.open({
    path: join(stateRoot, "state.db"),
    busyTimeoutMs: 250,
    migrationOwner: "settings-backup-test",
  }, manualClock(new Date(NOW)));
  databases.push(database);
  return {
    root,
    stateRoot,
    paths,
    database,
    backupDirectory: join(stateRoot, "backups", "authority"),
  };
}

async function backup(w: ReturnType<typeof world>) {
  const service = new AuthorityBackupService(w.database, {
    directory: w.backupDirectory,
    settingsRoot: w.paths.root,
  }, manualClock(new Date(NOW)));
  const report = await service.request({
    trigger: "operator",
    requiredGeneration: w.database.getMeta().authorityGeneration,
  });
  const manifest = report.manifests[0];
  assert.ok(manifest !== undefined);
  const manifestPath = join(w.backupDirectory, `${manifest.backupFileName}.manifest.json`);
  return { report, manifest, manifestPath };
}

describe("D331 P15 settings-aware authority backups", () => {
  it("writes manifest v2 with ordinary files and value-free protected presence only", async () => {
    const canary = "CANARY-PROTECTED-PASSWORD-must-not-enter-backup";
    const w = world(canary);
    const { report, manifest, manifestPath } = await backup(w);

    assert.equal(report.manifests.every((entry) => entry.manifestVersion === 2), true);
    assert.equal(manifest.manifestVersion, 2);
    if (manifest.manifestVersion !== 2) return;
    assert.deepEqual(manifest.files.map(({ role, sourceFileName }) => ({ role, sourceFileName })), [
      { role: "authority-database", sourceFileName: "state.db" },
      { role: "ordinary-settings", sourceFileName: "settings.json" },
      { role: "settings-root-authority", sourceFileName: "authority.json" },
    ]);
    assert.deepEqual(manifest.protectedSettings, {
      revision: 2,
      entries: [{
        name: "ucpathPassword",
        valueId: manifest.protectedSettings.entries[0]?.valueId,
        updatedAt: NOW,
      }],
    });
    assert.match(manifest.protectedSettings.entries[0]?.valueId ?? "", /^[0-9a-f-]{36}$/u);
    const entries = readdirSync(w.backupDirectory).sort();
    assert.equal(entries.length, 4);
    assert.equal(entries.some((name) => name.includes("protected")), false);
    assert.equal(entries.some((name) => name.includes("prepare") || name.includes("rollback") || name.includes("lock")), false);
    const allBackupBytes = entries.map((name) => readFileSync(join(w.backupDirectory, name))).join("\n");
    assert.equal(allBackupBytes.includes(canary), false);
    assert.equal(allBackupBytes.includes("protected.json"), false);
    assert.equal(JSON.stringify(manifest).includes("value\""), false);
    assert.doesNotMatch(JSON.stringify(manifest), /prepare|rollback/u);
    assert.equal(AuthorityBackupManifestSchema.safeParse({
      ...manifest,
      protectedSettings: {
        ...manifest.protectedSettings,
        entries: manifest.protectedSettings.entries.map((entry) => ({ ...entry, value: canary })),
      },
    }).success, false);
    await verifyBackupManifestAtPath(manifestPath, w.database.getSourceDatabaseIdentity());
  });

  it("keeps authority.json value-independent and fails verification if an ordinary copy is changed", async () => {
    const first = world("first protected value");
    const second = world("second protected value");
    const firstAuthority = JSON.parse(readFileSync(first.paths.authority, "utf8")) as { rootFingerprint: string };
    const secondAuthority = JSON.parse(readFileSync(second.paths.authority, "utf8")) as { rootFingerprint: string };
    assert.equal(firstAuthority.rootFingerprint, secondAuthority.rootFingerprint);

    const { manifest, manifestPath } = await backup(first);
    assert.equal(manifest.manifestVersion, 2);
    if (manifest.manifestVersion !== 2) return;
    writeFileSync(join(first.backupDirectory, manifest.files[1].backupFileName), "tampered settings");
    await assert.rejects(verifyBackupManifestAtPath(manifestPath), /byte size does not match verified manifest/u);
  });

  it("reads a strict legacy v1 manifest but never emits one", async () => {
    const w = world("legacy-read-canary");
    const { manifest, manifestPath } = await backup(w);
    assert.equal(manifest.manifestVersion, 2);
    const legacyPath = join(w.backupDirectory, "legacy-v1.manifest.json");
    const legacy = {
      kind: manifest.kind,
      manifestVersion: 1,
      backupFileName: manifest.backupFileName,
      sourceDatabaseIdentity: manifest.sourceDatabaseIdentity,
      applicationId: manifest.applicationId,
      schemaVersion: manifest.schemaVersion,
      pageCount: manifest.pageCount,
      authorityGeneration: manifest.authorityGeneration,
      authorityContentFingerprint: manifest.authorityContentFingerprint,
      createdAt: manifest.createdAt,
      byteSize: manifest.byteSize,
      sha256: manifest.sha256,
      verification: manifest.verification,
    };
    writeFileSync(legacyPath, JSON.stringify(legacy), { mode: 0o600 });
    assert.equal((await verifyBackupManifestAtPath(legacyPath)).manifest.manifestVersion, 1);
    assert.equal(AuthorityBackupManifestSchema.safeParse({ ...legacy, files: [] }).success, false);
    assert.equal((await verifyBackupManifestAtPath(manifestPath)).manifest.manifestVersion, 2);
  });

  it("fails loud and removes copied database bytes when the settings root is absent", async () => {
    const w = world("missing-root-canary");
    rmSync(w.paths.root, { recursive: true, force: true });
    await assert.rejects(
      backup(w),
      /settings root is unavailable for verified backup/u,
    );
    assert.deepEqual(readdirSync(w.backupDirectory), []);
  });
});
