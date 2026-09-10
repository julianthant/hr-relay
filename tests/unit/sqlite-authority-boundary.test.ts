import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, it } from "vitest";
import { gitVisibleFiles, REPO_ROOT } from "./architecture/helpers/guard-files.js";

// Private adapter modules have no raw connection in the public SQLite entrypoint.
// D336 historical backup readers remain; stopped conversion adapters expire in 2.6.
const PRIVATE_SQLITE_ADAPTERS = [
  "src/infra/compat/archive-upgrade-journal.ts",
  "src/infra/compat/backup-inspection.ts",
  "src/infra/compat/settings-database-upgrade.ts",
  "src/infra/compat/upgrade-sources.ts",
  "src/infra/sqlite/archive-compatibility.ts",
  "src/infra/sqlite/archive-database.ts",
  "src/infra/sqlite/authority-database.ts",
  "src/infra/sqlite/backup-service.ts",
  "src/infra/sqlite/completion-conversion.ts",
  "src/infra/sqlite/failure-resolution.ts",
  "src/infra/sqlite/foundation-retirement.ts",
  "src/infra/sqlite/generated-artifacts.ts",
  "src/infra/sqlite/generated-conversion.ts",
  "src/infra/sqlite/imported-artifacts.ts",
  "src/infra/sqlite/provider-accounting.ts",
  "src/infra/sqlite/provider-storage.ts",
  "src/infra/sqlite/run-evidence-ownership.ts",
  "src/infra/sqlite/run-summaries.ts",
  "src/infra/sqlite/settings-activation.ts",
  "src/infra/sqlite/settings-storage.ts",
  "src/infra/sqlite/timeline-conversion.ts",
  "src/infra/sqlite/timeline-repository.ts"
];
const ADAPTER_PATH = "src/infra/sqlite/authority-database.ts";

function isPrivateMember(member: ts.ClassElement): boolean {
  const hashPrivate = member.name !== undefined && ts.isPrivateIdentifier(member.name);
  const keywordPrivate = ts.canHaveModifiers(member)
    && ts.getModifiers(member)?.some(({ kind }) => kind === ts.SyntaxKind.PrivateKeyword) === true;
  return hashPrivate || keywordPrivate;
}

describe("SQLite authority boundary", () => {
  it("keeps node:sqlite and DatabaseSync private to the adapter implementation", () => {
    const sourceFiles = gitVisibleFiles(["src"]).filter((path) => path.endsWith(".ts") || path.endsWith(".tsx"));
    const nodeSqliteImports: string[] = [];
    const databaseSyncIdentifiers: string[] = [];
    for (const path of sourceFiles) {
      const source = readFileSync(join(REPO_ROOT, path), "utf8");
      if (/from\s+["']node:sqlite["']/.test(source)) nodeSqliteImports.push(path);
      if (/\bDatabaseSync\b/.test(source)) databaseSyncIdentifiers.push(path);
    }
    assert.deepEqual(nodeSqliteImports, PRIVATE_SQLITE_ADAPTERS);
    assert.deepEqual(databaseSyncIdentifiers, PRIVATE_SQLITE_ADAPTERS);
  });

  it("exports repositories and inspections without a raw connection or SQL escape hatch", () => {
    const entrypoint = readFileSync(join(REPO_ROOT, "src/infra/sqlite/index.ts"), "utf8");
    assert.doesNotMatch(entrypoint, /node:sqlite|DatabaseSync|\b(exec|prepare|connection|rawDatabase)\b/);

    const adapterText = readFileSync(join(REPO_ROOT, ADAPTER_PATH), "utf8");
    const source = ts.createSourceFile(ADAPTER_PATH, adapterText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const authorityClass = source.statements.find(
      (statement): statement is ts.ClassDeclaration => ts.isClassDeclaration(statement)
        && statement.name?.text === "AuthorityDatabase",
    );
    assert.ok(authorityClass, "AuthorityDatabase class must exist");
    const publicLeaks = authorityClass.members
      .filter((member) => !isPrivateMember(member))
      .filter((member) => /DatabaseSync|node:sqlite/.test(member.getText(source)))
      .map((member) => member.getText(source));
    assert.deepEqual(publicLeaks, []);

    const publicEscapeHatches = authorityClass.members
      .filter((member) => !isPrivateMember(member))
      .map((member) => member.name)
      .filter((name): name is ts.Identifier => name !== undefined && ts.isIdentifier(name))
      .map(({ text }) => text)
      .filter((name) => ["database", "connection", "exec", "prepare", "query", "raw"].includes(name));
    assert.deepEqual(publicEscapeHatches, []);
  });
});
