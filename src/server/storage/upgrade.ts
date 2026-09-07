/** D336 stopped conversion: SQLite settles first; credentials settle independently. */
import { existsSync, readdirSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Clock } from "../../domain/clock.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../domain/ids.js";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import { AuthorityUpgradeRecordSchema, TombstoneBackfillCountsSchema } from "../../domain/authority.js";
import { ProtectedSettingsCommandRequestSchema } from "../../domain/commands.js";
import { derivePersistedSettingsFingerprint } from "../../domain/config/settings.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../domain/config/protected-settings.js";
import { createCredentialStore } from "../../infra/config/credential-store.js";
import { AuthorityDatabase } from "../../infra/sqlite/authority-database.js";
import { AuthorityBackupService, verifyBackupManifestAtPath } from "../../infra/sqlite/backup-service.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../infra/sqlite/migrations.js";
import { acquireRuntimeRestoreAdmission, observeRuntimeLockSnapshot } from "../../infra/sqlite/runtime-process-locks.js";
import { executeSettingsCommand } from "../../core/command-kernel.js";
import { createSettingsApplicationExecutor } from "../dashboard/commands/settings-service.js";
import { resolveConfigWithProvenance } from "../../domain/config/resolve.js";

export const StorageUpgradeReportSchema = z.strictObject({
  state: z.enum(["planned", "converted", "already-upgraded"]),
  fromSchemaVersion: z.number().int().nonnegative(),
  toSchemaVersion: z.literal(32),
  importedKeys: z.array(z.string()), sourceFiles: z.array(z.string()),
  envKeysToRemove: z.array(z.string()),
  backupManifest: z.string().optional(),
  credentials: z.enum(["pending", "empty", "verified"]),
  historicalExposure: z.array(z.literal("operator.timekeeperName")),
  tombstoneBackfill: TombstoneBackfillCountsSchema,
  orphanGateRecordsRemoved: z.number().int().nonnegative(),
});
export type StorageUpgradeReport = z.infer<typeof StorageUpgradeReportSchema>;
export interface StorageUpgradeInput {
  readonly stateRoot: string;
  readonly processLockRoot: string;
  readonly environmentFile: string;
  readonly plan: boolean;
  readonly hooks?: Readonly<{ beforeCommit?(): void; afterCommit?(): void; afterCredentialRename?(): void }>;
}

function requireStopped(input: StorageUpgradeInput, clock: Clock): void {
  const snapshot = observeRuntimeLockSnapshot({ processLockRoot: input.processLockRoot,
    sourceDatabaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(join(input.stateRoot, "state.db")) }, clock);
  if (Object.values(snapshot.processLocks).some((lock) => lock.state === "active")) throw new Error("runtime-active: stop server and workers before storage upgrade");
}

/** Read-only legacy source for the existing explicit backup writer. No credential access. */
export async function backupStoppedAuthority(stateRoot: string, clock: Clock) {
  const path = join(stateRoot, "state.db");
  const { openAuthorityBackupSourceReadOnly } = await import("../../infra/compat/backup-inspection.js");
  const source = openAuthorityBackupSourceReadOnly(path);
  try {
    const service = new AuthorityBackupService(source, { directory: join(stateRoot, "backups", "authority") }, clock);
    return await service.request({ trigger: "operator", requiredGeneration: source.getMeta().authorityGeneration });
  } finally { source.close(); }
}

async function requiredBackup(stateRoot: string, generation: number, fingerprint: string) {
  const directory = join(stateRoot, "backups", "authority");
  if (!existsSync(directory)) throw new Error("backup-required: run storage backup first");
  const names = readdirSync(directory).filter((name) => name.endsWith(".manifest.json")).sort();
  let matching: Awaited<ReturnType<typeof verifyBackupManifestAtPath>> | undefined;
  for (const name of names) {
    const verified = await verifyBackupManifestAtPath(join(directory, name), AuthorityDatabase.sourceDatabaseIdentity(join(stateRoot, "state.db")));
    if (verified.manifest.authorityGeneration === generation && verified.manifest.authorityContentFingerprint === fingerprint) matching = verified;
  }
  if (matching === undefined) throw new Error("backup-stale: run storage backup against the current authority first");
  return matching;
}

export async function upgradeStorage(input: StorageUpgradeInput, clock: Clock): Promise<StorageUpgradeReport> {
  requireStopped(input, clock);
  const path = join(input.stateRoot, "state.db");
  const existed = existsSync(path);
  const { inspectAuthorityBackupReadOnly } = await import("../../infra/compat/backup-inspection.js");
  const { requireMigrationSourcePath } = await import("../../infra/compat/upgrade-sources.js");
  const { readLatestSettingsUpgrade, readSettingsUpgradeSources, convertSettingsDatabase, settleSettingsUpgrade, countOrphanGateRecords, inspectTombstoneBackfill, inspectHistoricalSettingsExposure } = await import("../../infra/compat/settings-database-upgrade.js");
  requireMigrationSourcePath(path);
  const inspection = existed ? inspectAuthorityBackupReadOnly(path) : undefined;
  const from = inspection?.schemaVersion ?? 0;
  let pending: z.infer<typeof AuthorityUpgradeRecordSchema> | undefined;
  let historicalPath: string | undefined;
  if (from === CURRENT_AUTHORITY_SCHEMA_VERSION) {
    pending = readLatestSettingsUpgrade(path);
    if (pending === undefined || pending.phase === "settled") {
      const credentials = createCredentialStore({ stateRoot: input.stateRoot }).read();
      return StorageUpgradeReportSchema.parse({ state: "already-upgraded", fromSchemaVersion: from, toSchemaVersion: 32,
        historicalExposure: pending !== undefined && "format" in pending ? pending.historicalExposure : [],
        tombstoneBackfill: pending !== undefined && "format" in pending ? pending.tombstoneBackfill : { fromRoots: 0, fromReconstructedRoots: 0, unknown: 0, missingRunNumber: 0 },
        orphanGateRecordsRemoved: pending !== undefined && "format" in pending ? pending.orphanGateRecordsRemoved : 0,
        importedKeys: pending !== undefined && "format" in pending ? pending.importedKeys : [],
        sourceFiles: pending !== undefined && "format" in pending ? pending.sourceFiles : [],
        envKeysToRemove: pending?.phase === "settled" ? pending.envKeysToRemove : [], credentials: credentials.revision === 1 ? "empty" : "verified" });
    }
    if ("format" in pending && pending.backupManifest !== "fresh") {
      const original = await verifyBackupManifestAtPath(pending.backupManifest, AuthorityDatabase.sourceDatabaseIdentity(path));
      historicalPath = original.backupPath;
    }
  }
  const sources = readSettingsUpgradeSources(input.stateRoot, input.environmentFile, from === 32 ? historicalPath : existed ? path : undefined, clock);
  if (pending !== undefined && "format" in pending
    && (pending.ordinaryFingerprint !== derivePersistedSettingsFingerprint(sources.settings)
      || canonicalJsonStringify(pending.importedKeys) !== canonicalJsonStringify(sources.importedKeys))) throw new Error("source-changed: committed SQLite conversion requires its original import sources");
  const backupEvidence = inspection !== undefined && from !== 32
    ? await requiredBackup(input.stateRoot, inspection.authorityGeneration, inspection.authorityContentFingerprint) : undefined;
  const orphanGateRecords = from === 32 && pending !== undefined && "format" in pending ? pending.orphanGateRecordsRemoved : countOrphanGateRecords(existed ? path : undefined);
  const tombstones = inspectTombstoneBackfill(from === 32 ? undefined : existed ? path : undefined, input.stateRoot);
  const historicalExposure = pending !== undefined && "format" in pending ? pending.historicalExposure : inspectHistoricalSettingsExposure(existed ? path : undefined);
  const report = StorageUpgradeReportSchema.parse({ historicalExposure, tombstoneBackfill: pending !== undefined && "format" in pending ? pending.tombstoneBackfill : tombstones.counts, orphanGateRecordsRemoved: orphanGateRecords, state: "planned", fromSchemaVersion: from, toSchemaVersion: 32,
    importedKeys: sources.importedKeys, sourceFiles: sources.sourceFiles, envKeysToRemove: sources.envKeysToRemove,
    ...(backupEvidence === undefined ? {} : { backupManifest: basename(backupEvidence.manifestPath) }), credentials: Object.keys(sources.protectedPatch).length === 0 ? "empty" : "pending" });
  const store = createCredentialStore({ stateRoot: input.stateRoot, hooks: { afterRename: input.hooks?.afterCredentialRename } });
  const priorCredentials = store.read();
  if (from !== 32 && Object.keys(sources.protectedPatch).length > 0 && priorCredentials.revision !== 1) {
    throw new Error("credential-source-conflict: existing independent credentials must not be overwritten by legacy import");
  }
  if (from !== 32) {
    const planned = convertSettingsDatabase({ input, path, existed, from, inspection, backupEvidence, sources, orphanGateRecords, tombstones, historicalExposure, verifyOnly: true }, clock);
    store.verifyUpgradePreflight(planned.upgradeId, sources.protectedPatch);
  }
  if (from === 32 && pending !== undefined && "format" in pending && Object.keys(sources.protectedPatch).length > 0) {
    store.verifyUpgradeBinding(pending.upgradeId, sources.protectedPatch);
  }
  if (input.plan) return report;
  mkdirSync(input.stateRoot, { recursive: true, mode: 0o700 });
  const admission = acquireRuntimeRestoreAdmission({ processLockRoot: input.processLockRoot, pid: process.pid }, clock);
  try {
    requireStopped(input, clock);
    if (from !== 32) {
      pending = convertSettingsDatabase({ input, path, existed, from, inspection, backupEvidence, sources, orphanGateRecords, tombstones, historicalExposure,
        bindCredentials: (upgradeId) => { if (Object.keys(sources.protectedPatch).length > 0) store.bindUpgrade(upgradeId, sources.protectedPatch); } }, clock);
    }
    if (pending === undefined || !("format" in pending)) throw new Error("upgrade-evidence-missing");
    const database = AuthorityDatabase.open({ path, busyTimeoutMs: 5000, migrationOwner: "storage-upgrade-audit" }, clock);
    try {
      if (Object.keys(sources.protectedPatch).length > 0) {
        store.verifyUpgradeBinding(pending.upgradeId, sources.protectedPatch);
        const request = ProtectedSettingsCommandRequestSchema.parse({ family: "settings", type: "apply-protected-settings", commandId: pending.credentialCommandId,
          requestedAt: pending.recordedAt, requestedBy: LOCAL_OPERATOR_ACTOR_ID, source: "storage-upgrade", reason: pending.upgradeId,
          target: { expectedRevision: 1 }, payload: { protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: pending.credentialWriteId, entries: sources.protectedPatch } });
        const result = executeSettingsCommand({ authority: database, clock, ids: { uuid: randomUUID },
          settings: createSettingsApplicationExecutor((settings) => { resolveConfigWithProvenance(settings, { primaryDisplay: null }, clock); }, store) }, request);
        if (result.state !== "applied" && result.state !== "already-applied") throw new Error("credential-import-refused: SQLite conversion remains committed");
      }
      database.close();
      settleSettingsUpgrade(path, pending, clock.now().toISOString());
    } finally { database.close(); }
    return { ...report, state: "converted", credentials: Object.keys(sources.protectedPatch).length === 0 ? "empty" : "verified" };
  } finally { admission.release(); }
}
