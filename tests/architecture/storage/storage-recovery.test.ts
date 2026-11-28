import ts from "typescript";
import { existsSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "vitest";
import { gitVisibleFiles, REPO_ROOT } from "../support/helpers/guard-files.js";

describe("authority.health preflight and static recovery boundary", () => {

  it("keeps native browser preparation outside stopped backup IO", () => {
    const sourceFile = (path: string) => ts.createSourceFile(path, readFileSync(join(REPO_ROOT, path), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const nativeCalls = (node: ts.Node) => {
      const calls: string[] = [];
      const visit = (child: ts.Node): void => {
        if (ts.isCallExpression(child)) {
          const target = child.expression;
          const name = ts.isIdentifier(target) ? target.text : ts.isPropertyAccessExpression(target) ? target.name.text : "";
          if (["prepareStoppedBackupClosure", "probeClosed", "assertClosed", "probeStoppedProfileBrowsersClosed",
            "probeRestoreProfileBrowsersClosed", "probeClosedBrowserProfile", "assertNativeBrowserProfilesClosed", "runNativeProfileProbeChild", "launch", "launchPersistentContext"].includes(name)) calls.push(name);
        }
        ts.forEachChild(child, visit);
      };
      visit(node); return calls;
    };
    for (const [path, names] of [
      ["src/backend/storage/maintenance/upgrade.ts", ["backupStoppedAuthority"]],
      ["src/backend/storage/maintenance/existing-data-backup.ts", ["backupFlatStorage"]],
      ["src/backend/storage/maintenance/existing-data-backup-files.ts", ["captureFlatArchiveSource", "writeFlatArchiveCopies"]],
      ["src/backend/storage/maintenance/flat-start-clean.ts", ["assertFlatStartCleanCredentials", "flatStartCleanPlan", "readFlatStartCleanSource", "assertFlatStartCleanFiles"]],
    ] as const) {
      const source = sourceFile(path);
      for (const name of names) {
        const owner = source.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
        assert.ok(owner && ts.isFunctionDeclaration(owner) && owner.body);
        assert.deepEqual(nativeCalls(owner.body), [], name);
      }
    }
    for (const method of ["probeClosed", "assertClosed", "prepareStoppedBackupClosure", "assertNativeBrowserProfilesClosed"]) {
      const control = ts.createSourceFile("bad-backup.ts", `function backup() { browser.${method}(); }`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      assert.deepEqual(nativeCalls(control), [method]);
    }
  });

  it("keeps native SQLite use in the reviewed recovery boundaries and bans copy or VACUUM fallbacks", () => {
    const adapterPath = "src/backend/storage/sqlite/authority-database.ts";
    const sqliteBoundaryPaths = [
      "src/backend/storage/sqlite/assistant-applied-edits.ts",
      "src/backend/storage/sqlite/assistant-attachments.ts",
      "src/backend/storage/sqlite/assistant-authorization.ts",
      "src/backend/storage/sqlite/assistant-effort-migration.ts",
      "src/backend/storage/sqlite/assistant-grant-retirement.ts",
      "src/backend/storage/sqlite/assistant-history.ts",
      "src/backend/storage/sqlite/assistant-model-preference.ts",
      "src/backend/storage/sqlite/assistant-proposals.ts",
      "src/backend/storage/sqlite/authority-change-admission.ts",
      "src/backend/storage/sqlite/authority-connection.ts",
      "src/backend/storage/sqlite/authority-dashboard-snapshot.ts",
      "src/backend/storage/sqlite/authority-database.ts",
      "src/backend/storage/sqlite/authority-inspection.ts",
      "src/backend/storage/sqlite/authority-run-evidence.ts",
      "src/backend/storage/sqlite/authority-stopped-reads.ts",
      "src/backend/storage/sqlite/authority-stored-rows.ts",
      "src/backend/storage/sqlite/authority-upgrades.ts",
      "src/backend/storage/sqlite/backup-inspection.ts",
      "src/backend/storage/sqlite/command-record-row.ts",
      "src/backend/storage/sqlite/dashboard-read-host.ts",
      "src/backend/storage/sqlite/exclusive-session-leases.ts",
      "src/backend/storage/sqlite/failure-note-removal-migration.ts",
      "src/backend/storage/sqlite/failure-resolution.ts",
      "src/backend/storage/sqlite/generated-artifacts.ts",
      "src/backend/storage/sqlite/imported-artifacts.ts",
      "src/backend/storage/sqlite/isolated-history-store.ts",
      "src/backend/storage/sqlite/native-run-deletion.ts",
      "src/backend/storage/sqlite/notification-publications.ts",
      "src/backend/storage/sqlite/pre-build-run-deletion.ts",
      "src/backend/storage/sqlite/worker-custody-migration.ts",
      "src/backend/storage/sqlite/ocr-review.ts",
      "src/backend/storage/sqlite/profile-local-databases.ts",
      "src/backend/storage/sqlite/readonly-authority-snapshot.ts",
      "src/backend/storage/sqlite/run-record-row.ts",
      "src/backend/storage/sqlite/run-search-index.ts",
      "src/backend/storage/sqlite/run-settlement-row.ts",
      "src/backend/storage/sqlite/run-summaries.ts",
      "src/backend/storage/sqlite/settings-activation.ts",
      "src/backend/storage/sqlite/settings-storage.ts",
      "src/backend/storage/sqlite/timeline-repository.ts",
      "src/backend/storage/sqlite/transaction-selection.ts",
      "src/backend/storage/sqlite/workbook-library-repository.ts",
      "src/backend/storage/sqlite/worker-slots.ts",
    ].sort();
    const sourceFiles = gitVisibleFiles(["src"]).filter(
      (path) => (path.endsWith(".ts") || path.endsWith(".tsx"))
        && existsSync(join(REPO_ROOT, path)),
    );
    const sqliteImports: string[] = [];
    const nativeHandleMentions: string[] = [];
    for (const path of sourceFiles) {
      const source = readFileSync(join(REPO_ROOT, path), "utf8");
      if (/from\s+["']node:sqlite["']/.test(source)) sqliteImports.push(path);
      if (/\bDatabaseSync\b/.test(source)) nativeHandleMentions.push(path);
      assert.doesNotMatch(source, /VACUUM\s+INTO/i, path);
    }
    assert.deepEqual(sqliteImports, sqliteBoundaryPaths);
    assert.deepEqual(nativeHandleMentions, sqliteBoundaryPaths);
    const adapter = readFileSync(join(REPO_ROOT, adapterPath), "utf8");
    const boundarySources = sqliteBoundaryPaths
      .map((path) => readFileSync(join(REPO_ROOT, path), "utf8"))
      .join("\n");
    assert.match(adapter, /backup as sqliteBackup/);
    assert.doesNotMatch(boundarySources, /\bcopyFile(?:Sync)?\b/);
    assert.doesNotMatch(readFileSync(join(REPO_ROOT, "src/backend/storage/sqlite/index.ts"), "utf8"), /DatabaseSync|node:sqlite/);
  });
});
