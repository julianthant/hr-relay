import { CLOCK, testRoot, baselineGeneration, admissionFor, openDatabase, backupDirectory, createBackup } from "./storage-recovery-fixtures.js";
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { COMMAND_FIXTURES, HASH_B, NOTIFICATION, UUID_1 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import assert from "node:assert/strict";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "vitest";
import { AuthorityBackupService, verifyBackupManifestAtPath } from "../../../../src/backend/storage/sqlite/index.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";

describe("verified native online backups", () => {

  it("backs up through the private native handle and self-observes the completed copy", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);

    const { report, manifestPath } = await createBackup(database, directory);
    assert.equal(report.followUpPerformed, false);
    assert.equal(report.finalGeneration, baselineGeneration(root) + 1);
    assert.equal(report.manifests[0].verification.observedFrom, "backup-copy");
    assert.equal(report.manifests[0].verification.authorityGeneration, baselineGeneration(root) + 1);
    const verified = await verifyBackupManifestAtPath(
      admissionFor(manifestPath), manifestPath,
    );
    assert.equal(verified.manifest.sha256.length, 64);
    assert.equal(verified.manifest.byteSize > 0, true);
    assert.equal(AuthorityDatabase.inspectExistingReadOnly(admissionFor(verified.backupPath), verified.backupPath).authorityGeneration, baselineGeneration(root) + 1);

    database.authority.notifications.create(NOTIFICATION);
    assert.equal(database.getMeta().authorityGeneration, baselineGeneration(root) + 2);
    assert.equal((await verifyBackupManifestAtPath(admissionFor(manifestPath), manifestPath)).manifest.authorityGeneration, baselineGeneration(root) + 1);
  });

  it("coalesces concurrent requests and performs one generation follow-up", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
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
    const service = new AuthorityBackupService(admissionFor(directory), source, { directory }, CLOCK);
    const first = service.request({ trigger: "interval", requiredGeneration: 1 });
    const second = service.request({ trigger: "schema-migration", requiredGeneration: 1 });
    assert.equal(first, second);
    const report = await first;
    assert.equal(report.coalescedRequests, 2);
    assert.equal(report.followUpPerformed, true);
    assert.equal(report.manifests.length, 2);
    assert.equal(report.manifests[0].authorityGeneration, baselineGeneration(root) + 1);
    assert.equal(report.manifests[1].authorityGeneration, baselineGeneration(root) + 2);
    assert.equal(copies, 2);
  });

  it("fails loud and removes its unique temporary target when native backup fails", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
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
    const service = new AuthorityBackupService(admissionFor(directory), failingSource, { directory }, CLOCK);
    await assert.rejects(
      service.request({ trigger: "schema-migration", requiredGeneration: 0 }),
      /injected native backup failure/,
    );
    assert.deepEqual(readdirSync(directory), []);
  });

  it("rejects tampered backup bytes and a tampered manifest", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    const { manifestPath } = await createBackup(database, directory);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { backupFileName: string; sha256: string };
    const backupPath = join(directory, manifest.backupFileName);
    appendFileSync(backupPath, "tamper");
    await assert.rejects(verifyBackupManifestAtPath(admissionFor(manifestPath), manifestPath), /byte size does not match/);

    const secondRoot = await testRoot();
    const secondPath = join(secondRoot, "state.db");
    const secondDirectory = backupDirectory(secondRoot);
    const secondDatabase = openDatabase(secondPath);
    const second = await createBackup(secondDatabase, secondDirectory);
    const parsed = JSON.parse(readFileSync(second.manifestPath, "utf8")) as Record<string, unknown>;
    writeFileSync(second.manifestPath, JSON.stringify({
      ...parsed,
      sha256: HASH_B,
    }));
    await assert.rejects(verifyBackupManifestAtPath(admissionFor(second.manifestPath), second.manifestPath), /checksum does not match/);
  });

  it("rejects a native backup whose JSON-valid command record fails its strict schema", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    const corruption = new DatabaseSync(authorityPath);
    corruption.prepare("UPDATE commands SET request_json = ? WHERE id = ?")
      .run(JSON.stringify({ family: "start" }), UUID_1);
    corruption.close();

    await assert.rejects(createBackup(database, directory), /authority table commands failed native record validation/);
    assert.deepEqual(readdirSync(directory), []);
  });
});
