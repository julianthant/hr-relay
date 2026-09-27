import { AuthorityUpgradeRecordSchema } from "../../src/domain/authority.js";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "vitest";
import { storageRecoveryFixture, storageTree, credentialTrap } from "./helpers/storage-recovery-fixture.js";
import { upgradeStorage } from "../helpers/synthetic-storage-admission.js";
import { inspectAuthorityBackupReadOnly } from "../helpers/synthetic-storage-admission.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION, UPGRADE_FLOOR_SCHEMA_VERSION } from "../../src/infra/sqlite/migrations.js";
import { readLatestDatabaseUpgrade } from "../helpers/synthetic-storage-admission.js";
import { AuthorityDatabase } from "../helpers/synthetic-storage-admission.js";
import { readSettings } from "../../src/server/settings-runtime.js";

describe("supported stopped database recovery after settings import expiry", () => {
  it.each(Array.from({ length: UPGRADE_FLOOR_SCHEMA_VERSION - 1 }, (_, index) => index + 1))("refuses schema %s before backup, conversion, locks or credentials", async version => {
    const f = storageRecoveryFixture(version);
    try {
      credentialTrap(f.root); writeFileSync(f.input.environmentFile, "malformed obsolete environment");
      const before = storageTree(f.root);
      for (const plan of [true, false]) await assert.rejects(f.run(plan), new RegExp(`authority-below-floor \\{ schemaVersion: ${String(version)}, floor: 46 \\}.*original compatible release`, "u"));
      assert.deepEqual(storageTree(f.root), before); assert.equal(existsSync(f.input.processLockRoot), false);
    } finally { f.dispose(); }
  });
  it.each([46, 47, 48, 49])("converts supported schema %s with a verified backup, preserves settings and repeats without writes", async version => {
    const f = storageRecoveryFixture(version);
    try {
      credentialTrap(f.root);
      const before = storageTree(f.root); await assert.rejects(f.run(true), /backup-required/u); assert.deepEqual(storageTree(f.root), before);
      await f.backup(); const backed = storageTree(f.root);
      assert.equal((await f.run(true)).state, "planned"); assert.deepEqual(storageTree(f.root), backed);
      assert.equal((await f.run()).state, "converted"); assert.equal(inspectAuthorityBackupReadOnly(f.path).schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
      const converted = storageTree(f.root); assert.equal((await f.run()).state, "already-upgraded"); assert.deepEqual(storageTree(f.root), converted);
      const pending = readLatestDatabaseUpgrade(f.path); assert.ok(pending && "format" in pending);
      assert.equal(pending.phase, "settled"); assert.deepEqual(pending.importedKeys, []); assert.deepEqual(pending.sourceFiles, []);
    } finally { f.dispose(); }
  });
  it.each(["beforeCommit", "afterCommit"] as const)("fresh initialization survives %s without importing displaced sources", async boundary => {
    const f = storageRecoveryFixture();
    try {
      writeFileSync(f.input.environmentFile, "HRAUTO_DEFAULT_WORKERS=17\nUCPATH_PASSWORD=synthetic-retired-input\n");
      writeFileSync(join(f.root, "settings.json"), "corrupt old authority"); credentialTrap(f.root);
      const before = storageTree(f.root); assert.equal((await f.run(true)).state, "planned"); assert.deepEqual(storageTree(f.root), before);
      await assert.rejects(upgradeStorage({ ...f.input, hooks: { [boundary]: () => { throw new Error("injected-interruption"); } } }, f.clock), /injected-interruption/u);
      assert.equal(existsSync(f.path), boundary === "afterCommit");
      assert.equal((await f.run()).state, "converted");
      const db = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "supported-proof" }, f.clock);
      try { assert.deepEqual(readSettings(db.authority).settings, {}); } finally { db.close(); }
      assert.equal(readFileSync(f.input.environmentFile, "utf8"), "HRAUTO_DEFAULT_WORKERS=17\nUCPATH_PASSWORD=synthetic-retired-input\n");
    } finally { f.dispose(); }
  });
  it("refuses an unfinished expired settings receipt without rewriting it", async () => {
    const f = storageRecoveryFixture();
    try {
      await f.run();
      const pending = readLatestDatabaseUpgrade(f.path); assert.ok(pending && "format" in pending);
      const db = new DatabaseSync(f.path);
      try { db.prepare("INSERT INTO database_upgrades(record_key,upgrade_id,phase,record_json,created_at) VALUES (?,?,?,?,?)").run("00000000-0000-4000-8000-000000000199", "a".repeat(64), "committed", JSON.stringify({ ...pending, upgradeId: "a".repeat(64), recordKey: "00000000-0000-4000-8000-000000000199", phase: "committed", importedKeys: ["concurrency.defaultWorkers"] }), pending.recordedAt); } finally { db.close(); }
      const before = storageTree(f.root);
      for (const plan of [true, false]) await assert.rejects(f.run(plan), /upgrade-pending:.*original compatible release/u);
      assert.deepEqual(storageTree(f.root), before);
    } finally { f.dispose(); }
  });
  it("refuses an older journal grammar pending receipt instead of skipping it for an earlier settled receipt", async () => {
    const f = storageRecoveryFixture();
    try {
      await f.run();
      const pending = AuthorityUpgradeRecordSchema.parse({ recordKey: "00000000-0000-4000-8000-000000000198", upgradeId: "b".repeat(64),
        fromSchemaVersion: 29, toSchemaVersion: 31, by: "local-operator", recordedAt: f.clock.now().toISOString(), phase: "committed",
        planDigest: "a".repeat(64), backup: { manifestPath: "historical-manifest.json", sha256: "a".repeat(64), authorityGeneration: 7 },
        settings: { ordinaryRevisionBefore: 1, ordinaryRevisionAfter: 2, settingsFingerprintAfter: "a".repeat(64), settingsSchemaHashAfter: "a".repeat(64), protectedRevisionAfter: 2, protectedEntryNames: ["ucpathPassword"] },
        tombstoneBackfill: { fromRoots: 0, fromReconstructedRoots: 0, unknown: 0 }, orphanGateRecordsRemoved: 0,
        historicalExposure: [], envKeysToRemove: ["UCPATH_PASSWORD"] });
      const database = new DatabaseSync(f.path);
      try { database.prepare("INSERT INTO database_upgrades(record_key,upgrade_id,phase,record_json,created_at) VALUES (?,?,?,?,?)").run(pending.recordKey, pending.upgradeId, pending.phase, JSON.stringify(pending), pending.recordedAt); }
      finally { database.close(); }
      const before = storageTree(f.root);
      for (const plan of [true, false]) await assert.rejects(f.run(plan), /upgrade-pending:.*original compatible release/u);
      assert.deepEqual(storageTree(f.root), before);
    } finally { f.dispose(); }
  });
  it("refuses an aliased database before conversion", async () => {
    const f = storageRecoveryFixture(), source = storageRecoveryFixture(48);
    try { symlinkSync(source.path, f.path); const before = storageTree(source.root); await assert.rejects(f.run(), /source-integrity/u); assert.deepEqual(storageTree(source.root), before); }
    finally { f.dispose(); source.dispose(); }
  });
});
