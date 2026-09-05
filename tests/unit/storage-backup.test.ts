import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
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
  ProtectedStoreRecordSchema,
  protectedSettingsReadback,
} from "../../src/domain/config/protected-settings.js";
import {
  CURRENT_SETTINGS_SCHEMA_HASH,
  SettingsFileRecordSchema,
  derivePersistedSettingsFingerprint,
  deriveSettingsPatchFingerprint,
} from "../../src/domain/config/settings.js";
import {
  SettingsRootAuthoritySchema,
  settingsRootPaths,
} from "../../src/domain/config/settings-root.js";
import {
  ProtectedSettingsCommandRequestSchema,
  SettingsCommandRequestSchema,
  deriveSettingsCommandFingerprint,
  markSettingsCommand,
} from "../../src/domain/commands.js";
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
const roots: string[] = [];
const databases: AuthorityDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function world(protectedValue: string, journal = true) {
  const root = mkdtempSync(join(tmpdir(), "hrauto-settings-backup-"));
  roots.push(root);
  const stateRoot = join(root, ".tracker");
  const paths = settingsRootPaths(stateRoot);
  const ordinaryStore = createSettingsFileAuthority({ path: paths.ordinary, validateCandidate: () => undefined });
  const ordinaryPatch = { "browser.headless": { set: false } };
  const ordinaryCommand = SettingsCommandRequestSchema.parse({
    commandId: "00000000-0000-4000-8000-000000000003",
    requestedAt: NOW,
    requestedBy: "local-operator",
    source: "dashboard",
    family: "settings",
    type: "apply-settings",
    target: { expectedRevision: 1 },
    payload: {
      settingsSchemaHash: CURRENT_SETTINGS_SCHEMA_HASH,
      patchFingerprint: deriveSettingsPatchFingerprint(ordinaryPatch),
      patch: ordinaryPatch,
    },
  });
  const ordinaryCommandFingerprint = deriveSettingsCommandFingerprint(ordinaryCommand);
  const ordinaryApplied = ordinaryStore.apply({
    commandId: ordinaryCommand.commandId,
    commandFingerprint: ordinaryCommandFingerprint,
    expectedRevision: 1,
    ...ordinaryCommand.payload,
  });
  assert.equal(ordinaryApplied.state, "applied");
  if (ordinaryApplied.state === "applied") ordinaryApplied.commit();
  const protectedStore = createProtectedSettingsFileAuthority({
    path: paths.ordinary,
    assertWriteIdAvailable: () => undefined,
  });
  protectedStore.read();
  const protectedCommand = ProtectedSettingsCommandRequestSchema.parse({
    commandId: "00000000-0000-4000-8000-000000000001",
    requestedAt: NOW,
    requestedBy: "local-operator",
    source: "settings-surface",
    family: "settings",
    type: "apply-protected-settings",
    target: { expectedRevision: 1 },
    payload: {
      protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
      writeId: "00000000-0000-4000-8000-000000000002",
      entries: { ucpathPassword: { set: protectedValue } },
    },
  });
  const protectedCommandFingerprint = deriveSettingsCommandFingerprint(protectedCommand);
  const applied = protectedStore.apply({
    commandId: protectedCommand.commandId,
    commandFingerprint: protectedCommandFingerprint,
    expectedRevision: 1,
    ...protectedCommand.payload,
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
  if (journal) database.withAuthorityTransaction((repositories) => {
    const ordinaryTarget = { family: "settings" as const, revision: 2 };
    const ordinaryAuditId = "00000000-0000-4000-8000-000000000004";
    repositories.commands.insert(ordinaryCommand);
    repositories.commandAudits.insert({
      auditId: ordinaryAuditId,
      request: ordinaryCommand,
      result: {
        state: "applied",
        commandId: ordinaryCommand.commandId,
        affectedTargets: [ordinaryTarget],
        restartRequired: true,
        settingsRevision: 2,
        settingsFingerprint: ordinaryApplied.record.settingsFingerprint,
      },
      completedAt: NOW,
      versionChanges: [{ target: ordinaryTarget, before: 1, after: 2 }],
      affectedDependencyIds: [],
    });
    repositories.settingsCurrent.advance({
      revision: 2,
      settingsFingerprint: ordinaryApplied.record.settingsFingerprint,
      commandId: ordinaryCommand.commandId,
      commandFingerprint: ordinaryCommandFingerprint,
      auditId: ordinaryAuditId,
      committedAt: NOW,
    });

    const marked = markSettingsCommand(protectedCommand);
    const protectedTarget = { family: "protected-settings" as const, revision: 2 };
    const protectedAuditId = "00000000-0000-4000-8000-000000000005";
    const readback = protectedSettingsReadback(applied.record);
    repositories.commands.insert(marked);
    repositories.commandAudits.insert({
      auditId: protectedAuditId,
      request: marked,
      result: {
        state: "applied",
        commandId: protectedCommand.commandId,
        affectedTargets: [protectedTarget],
        restartRequired: false,
        revision: 2,
        entries: readback.entries,
      },
      completedAt: NOW,
      versionChanges: [{ target: protectedTarget, before: 1, after: 2 }],
      affectedDependencyIds: [],
    });
    repositories.protectedSettingsCurrent.advanceInTransaction({
      revision: 2,
      commandId: protectedCommand.commandId,
      commandFingerprint: protectedCommandFingerprint,
      auditId: protectedAuditId,
      committedAt: NOW,
      entries: [{
        name: "ucpathPassword",
        valueId: applied.record.entries.ucpathPassword?.valueId,
        updatedAt: NOW,
      }],
    });
  });
  return {
    root,
    stateRoot,
    paths,
    database,
    ordinaryStore,
    protectedStore,
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
  it("refuses revision-2 settings files beside an empty copied command journal", async () => {
    const w = world("unjournaled-backup-canary", false);

    await assert.rejects(
      backup(w),
      /settings revision 2 has no durable command journal/u,
    );
    assert.deepEqual(readdirSync(w.backupDirectory), []);
  });

  it("backs up a fresh composition after it materializes both revision-1 baselines", async () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-fresh-settings-backup-"));
    roots.push(root);
    const stateRoot = join(root, ".tracker");
    mkdirSync(stateRoot, { mode: 0o700 });
    const paths = settingsRootPaths(stateRoot);
    const database = AuthorityDatabase.open({
      path: join(stateRoot, "state.db"),
      busyTimeoutMs: 250,
      migrationOwner: "fresh-settings-backup-test",
    }, manualClock(new Date(NOW)));
    databases.push(database);
    const ordinary = createSettingsFileAuthority({
      path: paths.ordinary,
      validateCandidate: () => undefined,
    });
    const protectedStore = createProtectedSettingsFileAuthority({
      path: paths.ordinary,
      assertWriteIdAvailable: () => undefined,
    });

    assert.equal(ordinary.read().revision, 1);
    assert.equal(SettingsFileRecordSchema.parse(JSON.parse(readFileSync(paths.ordinary, "utf8"))).revision, 1);
    assert.deepEqual(ProtectedStoreRecordSchema.parse(JSON.parse(readFileSync(paths.protected, "utf8"))).entries, {});
    const authority = SettingsRootAuthoritySchema.parse(JSON.parse(readFileSync(paths.authority, "utf8")));
    assert.deepEqual({ ordinary: authority.ordinary, protected: authority.protected }, {
      ordinary: "initialized",
      protected: "initialized",
    });

    const { manifest } = await backup({
      root,
      stateRoot,
      paths,
      database,
      ordinaryStore: ordinary,
      protectedStore,
      backupDirectory: join(stateRoot, "backups", "authority"),
    });
    assert.equal(manifest.manifestVersion, 2);
    if (manifest.manifestVersion === 2) {
      assert.deepEqual(manifest.protectedSettings, { revision: 1, entries: [] });
    }
  });

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

  it("holds the shared settings lock while it copies and authenticates SQLite", async () => {
    const w = world("lock-held-backup-canary");
    let lockObserved = false;
    const service = new AuthorityBackupService({
      getMeta: () => w.database.getMeta(),
      getSourceDatabaseIdentity: () => w.database.getSourceDatabaseIdentity(),
      onlineBackupTo: async (destination) => {
        assert.throws(() => w.ordinaryStore.read(), /exclusive settings authority/u);
        assert.throws(() => w.protectedStore.read(), /exclusive settings authority/u);
        lockObserved = true;
        return w.database.onlineBackupTo(destination);
      },
    }, {
      directory: w.backupDirectory,
      settingsRoot: w.paths.root,
    }, manualClock(new Date(NOW)));

    const report = await service.request({
      trigger: "operator",
      requiredGeneration: w.database.getMeta().authorityGeneration,
    });

    assert.equal(report.state, "verified");
    assert.equal(lockObserved, true);
  });

  it("rejects a parseable checksummed settings copy that does not match the copied journal", async () => {
    const w = world("verification-authentication-canary");
    const { manifest, manifestPath } = await backup(w);
    assert.equal(manifest.manifestVersion, 2);
    if (manifest.manifestVersion !== 2) return;
    const ordinaryIdentity = manifest.files[1];
    const ordinaryPath = join(w.backupDirectory, ordinaryIdentity.backupFileName);
    const ordinary = SettingsFileRecordSchema.parse(JSON.parse(readFileSync(ordinaryPath, "utf8")));
    const settings = { ...ordinary.settings, browser: { ...ordinary.settings.browser, headless: true } };
    const forgedBytes = Buffer.from(`${JSON.stringify(SettingsFileRecordSchema.parse({
      ...ordinary,
      settings,
      settingsFingerprint: derivePersistedSettingsFingerprint(settings),
    }))}\n`);
    writeFileSync(ordinaryPath, forgedBytes);
    const forgedManifest = AuthorityBackupManifestSchema.parse({
      ...manifest,
      files: [
        manifest.files[0],
        {
          ...ordinaryIdentity,
          byteSize: forgedBytes.byteLength,
          sha256: createHash("sha256").update(forgedBytes).digest("hex"),
        },
        manifest.files[2],
      ],
    });
    writeFileSync(manifestPath, `${JSON.stringify(forgedManifest)}\n`);

    await assert.rejects(
      verifyBackupManifestAtPath(manifestPath),
      /settings revision 2 command .* has a mismatched durable audit/u,
    );
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
