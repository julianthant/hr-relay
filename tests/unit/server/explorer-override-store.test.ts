/** Replaces the retired file-claim writer's proofs with stopped conversion safety. */
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "vitest";
import { canonicalJsonStringify } from "../../../src/domain/canonical-json.js";
import { AuthorityDatabase } from "../../helpers/synthetic-storage-admission.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION, UPGRADE_FLOOR_SCHEMA_VERSION } from "../../../src/infra/sqlite/migrations.js";
import { readLatestDatabaseUpgrade } from "../../helpers/synthetic-storage-admission.js";
import { inspectAuthorityBackupReadOnly } from "../../helpers/synthetic-storage-admission.js";
import { acquireRuntimeRestoreAdmission } from "../../../src/infra/sqlite/runtime-process-locks.js";
import { upgradeStorage } from "../../helpers/synthetic-storage-admission.js";
import { storageRecoveryFixture, storageTree } from "../helpers/storage-recovery-fixture.js";
import { explorerAuthorityFixture } from "../../fixtures/explorer-authority.js";

function historical(version = 50) {
  const f = storageRecoveryFixture(version);
  const live = explorerAuthorityFixture();
  try {
    const command = live.command("11111111-1111-4111-8111-111111111111");
    assert.equal(live.kernel.execute(command).state, "applied");
    const override = live.database.authority.explorerOverrides.read(command.target.workflowId);
    const audit = live.database.authority.commandAudits.findByCommand(command.commandId);
    assert.ok(override && audit);
    const database = new DatabaseSync(f.path);
    try {
      database.prepare("INSERT INTO commands(record_key,family,record_json,created_at) VALUES (?,?,?,?)").run(command.commandId, command.family, canonicalJsonStringify(command), command.requestedAt);
      database.prepare("INSERT INTO command_audits(record_key,command_id,record_json,created_at) VALUES (?,?,?,?)").run(audit.auditId, command.commandId, canonicalJsonStringify(audit), audit.completedAt);
    } finally { database.close(); }
    const sourcePath = join(f.root, "explorer-overrides.json");
    const document = { documentVersion: 1, workflows: [override] };
    writeFileSync(sourcePath, canonicalJsonStringify(document));
    return { ...f, command, override, audit, document, sourcePath };
  } catch (error) { f.dispose(); throw error; }
  finally { live.dispose(); }
}

describe("Explorer override stopped SQLite conversion", () => {
  it.each([46, 47, 48, 49, 50])("imports schema %s once with source and backup identity, then ignores obsolete files", async version => {
    const f = historical(version);
    try {
      assert.throws(() => AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "ordinary-start" }, f.clock), /upgrade-required/u);
      await f.backup();
      const before = storageTree(f.root);
      assert.equal((await f.run(true)).state, "planned");
      assert.deepEqual(storageTree(f.root), before);
      assert.equal((await f.run()).state, "converted");
      assert.equal(inspectAuthorityBackupReadOnly(f.path).schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
      const receipt = readLatestDatabaseUpgrade(f.path);
      assert.ok(receipt && "format" in receipt && receipt.explorerImport);
      assert.equal(receipt.explorerImport.sourceDatabaseIdentity, AuthorityDatabase.sourceDatabaseIdentity(f.path));
      assert.notEqual(receipt.explorerImport.backupSha256, "fresh");
      assert.deepEqual(receipt.explorerImport.source.state === "present" ? receipt.explorerImport.source.document : null, f.document);
      for (const suffix of ["", ".claim", ".pending", ".claim.pending"]) writeFileSync(`${f.sourcePath}${suffix}`, "untrusted retired bytes");
      assert.equal((await f.run()).state, "already-upgraded");
      const database = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "converted" }, f.clock);
      try {
        assert.deepEqual(database.authority.explorerOverrides.read(f.command.target.workflowId), f.override);
        assert.deepEqual(database.authority.commands.get(f.command.commandId), f.command);
        assert.deepEqual(database.authority.commandAudits.findByCommand(f.command.commandId), f.audit);
      } finally { database.close(); }
    } finally { f.dispose(); }
  });

  it.each([".claim", ".claim.pending", ".pending"])("refuses pending %s with compatible-release recovery before effects", async suffix => {
    const f = historical();
    try {
      await f.backup();
      writeFileSync(`${f.sourcePath}${suffix}`, "pending, including malformed claims");
      const before = storageTree(f.root);
      for (const plan of [true, false]) await assert.rejects(f.run(plan), /explorer-override-pending:.*original compatible release/u);
      assert.deepEqual(storageTree(f.root), before);
      assert.equal(existsSync(f.input.processLockRoot), false);
    } finally { f.dispose(); }
  });

  it.each(["malformed", "duplicate", "wrong-fingerprint", "wrong-value", "missing-workflow", "extra-carried-value"])("refuses %s source with the database unchanged", async corruption => {
    const f = historical();
    try {
      await f.backup();
      const workflows = corruption === "duplicate" ? [f.override, f.override] : corruption === "missing-workflow" ? []
        : [{ ...f.override, ...(corruption === "wrong-fingerprint" ? { commandFingerprint: "0".repeat(64) } : {}),
          presentation: corruption === "wrong-value" ? { label: "Tampered label" }
            : corruption === "extra-carried-value" ? { ...f.override.presentation, icon: "Search" } : f.override.presentation }];
      writeFileSync(f.sourcePath, corruption === "malformed" ? "{invalid" : JSON.stringify({ documentVersion: 1, workflows }));
      const before = storageTree(f.root);
      await assert.rejects(f.run(), /JSON|unique|explorer-override-source-command-conflict/u);
      assert.deepEqual(storageTree(f.root), before);
    } finally { f.dispose(); }
  });

  it("refuses absent source with successful command history and present values without matching history", async () => {
    const f = historical();
    try {
      await f.backup();
      rmSync(f.sourcePath);
      const before = storageTree(f.root);
      await assert.rejects(f.run(), /explorer-override-source-command-conflict/u);
      assert.deepEqual(storageTree(f.root), before);
    } finally { f.dispose(); }
    const empty = storageRecoveryFixture(50);
    const source = historical();
    try {
      writeFileSync(join(empty.root, "explorer-overrides.json"), canonicalJsonStringify(source.document));
      await empty.backup();
      const before = storageTree(empty.root);
      await assert.rejects(empty.run(), /explorer-override-source-command-conflict/u);
      assert.deepEqual(storageTree(empty.root), before);
    } finally { empty.dispose(); source.dispose(); }
  });

  it.each(["missing-audit", "divergent-audit", "revision-gap"])("refuses %s evidence before importing any override", async corruption => {
    const f = historical();
    try {
      const database = new DatabaseSync(f.path);
      try {
        // Corruption fixtures deliberately bypass released immutability triggers.
        const triggers = database.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name IN ('commands','command_audits')").all();
        for (const row of triggers) {
          assert.equal(typeof row.name, "string");
          database.exec(`DROP TRIGGER "${String(row.name).replaceAll('"', '""')}"`);
        }
        if (corruption === "missing-audit") database.prepare("DELETE FROM command_audits WHERE command_id=?").run(f.command.commandId);
        if (corruption === "divergent-audit") database.prepare("UPDATE command_audits SET record_json=? WHERE command_id=?")
          .run(canonicalJsonStringify({ ...f.audit, request: { ...f.audit.request, reason: "Divergent audit" } }), f.command.commandId);
        if (corruption === "revision-gap") database.prepare("UPDATE commands SET record_json=? WHERE record_key=?")
          .run(canonicalJsonStringify({ ...f.command, target: { ...f.command.target, expectedOverrideRevision: 4 } }), f.command.commandId);
        // Restore original trigger DDL, so the failure concerns evidence, not missing schema.
        for (const row of triggers) { assert.equal(typeof row.sql, "string"); database.exec(String(row.sql)); }
      } finally { database.close(); }
      await f.backup();
      const before = storageTree(f.root);
      await assert.rejects(f.run(), /explorer-override-(?:command-audit|source-revision)/u);
      assert.deepEqual(storageTree(f.root), before);
    } finally { f.dispose(); }
  });

  it("refuses an aliased source and source changes between preflight and admission", async () => {
    const f = historical();
    try {
      await f.backup();
      const original = readFileSync(f.sourcePath);
      await assert.rejects(upgradeStorage(f.input, f.clock, (input, clock) => {
        const admission = acquireRuntimeRestoreAdmission(input, clock);
        writeFileSync(f.sourcePath, Buffer.concat([original, Buffer.from("\n")]));
        return admission;
      }), /explorer-override-source-changed/u);
      assert.equal(inspectAuthorityBackupReadOnly(f.path).schemaVersion, 50);
      const alias = join(f.root, "source-alias");
      symlinkSync(f.sourcePath, alias);
      // The source itself becomes an alias, never dereferenced by conversion.
      const { renameSync } = await import("node:fs");
      renameSync(f.sourcePath, `${f.sourcePath}.original`);
      symlinkSync(`${f.sourcePath}.original`, f.sourcePath);
      await assert.rejects(f.run(), /source-integrity/u);
    } finally { f.dispose(); }
  });

  it.each(["beforeCommit", "afterCommit"] as const)("recovers %s interruption without a partial import or file replay", async boundary => {
    const f = historical();
    try {
      await f.backup();
      await assert.rejects(upgradeStorage({ ...f.input, hooks: { [boundary]: () => { throw new Error("injected-conversion-stop"); } } }, f.clock), /injected-conversion-stop/u);
      assert.equal(inspectAuthorityBackupReadOnly(f.path).schemaVersion, boundary === "beforeCommit" ? 50 : CURRENT_AUTHORITY_SCHEMA_VERSION);
      if (boundary === "afterCommit") writeFileSync(`${f.sourcePath}.claim`, "old claim after SQL commit");
      assert.equal((await f.run()).state, "converted");
      const database = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "recovery" }, f.clock);
      try { assert.deepEqual(database.authority.explorerOverrides.readAll(), [f.override]); }
      finally { database.close(); }
      assert.equal((await f.run()).state, "already-upgraded");
    } finally { f.dispose(); }
  });

  it("rechecks source identity after the pre-commit hook and rolls back the whole schema", async () => {
    const f = historical();
    try {
      await f.backup();
      await assert.rejects(upgradeStorage({ ...f.input, hooks: { beforeCommit: () => writeFileSync(f.sourcePath, `${canonicalJsonStringify(f.document)}\n`) } }, f.clock), /explorer-override-source-changed/u);
      assert.equal(inspectAuthorityBackupReadOnly(f.path).schemaVersion, 50);
      assert.equal((await f.run()).state, "converted");
    } finally { f.dispose(); }
  });

  it.each(["", ".claim", ".pending", ".claim.pending"])("refuses ordinary fresh startup over orphan Explorer %s evidence before creating authority", suffix => {
    const f = storageRecoveryFixture();
    try {
      writeFileSync(join(f.root, `explorer-overrides.json${suffix}`), "retained source");
      const before = storageTree(f.root);
      assert.throws(() => AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "orphan-proof" }, f.clock), /explorer-override-upgrade-required/u);
      assert.equal(existsSync(f.path), false);
      assert.deepEqual(storageTree(f.root), before);
    } finally { f.dispose(); }
  });

  it("initializes fresh with an absent receipt and preserves the recovery floor", async () => {
    const f = storageRecoveryFixture();
    try {
      assert.equal(UPGRADE_FLOOR_SCHEMA_VERSION, 46);
      assert.equal((await f.run()).state, "converted");
      const receipt = readLatestDatabaseUpgrade(f.path);
      assert.ok(receipt && "format" in receipt);
      assert.deepEqual(receipt.explorerImport?.source, { state: "absent" });
      assert.equal(receipt.explorerImport?.backupSha256, "fresh");
    } finally { f.dispose(); }
  });
});
