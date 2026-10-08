import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { describe, it } from "vitest";
import ts from "typescript";
import { AuthorityTableNameSchema } from "../../../src/models/config/authority.js";
import { SettingsCurrentRecordSchema } from "../../../src/models/config/settings-current.js";
import { derivePersistedSettingsFingerprint } from "../../../src/models/config/settings.js";
import {
  CURRENT_AUTHORITY_SCHEMA_VERSION,
  SQLITE_MIGRATIONS,
} from "../../../src/backend/storage/sqlite/migrations.js";
import { walkFiles } from "../support/helpers/guard-files.js";

/** D336: ordinary settings are SQLite authority; file formats survive only as frozen readers. */
const REPO_ROOT = resolve(import.meta.dirname, "../../..");

const RETIRED_RUNTIME_MODULES = new Set([
  "src/domain/config/settings-root.ts",
  "src/infra/config/protected-settings-journal.ts",
  "src/infra/config/settings-file.ts",
]);

const RETIRED_FILE_AUTHORITY_EXPORTS = new Set([
  "AppliedSettingsFileUpdate",
  "MAX_PROTECTED_SETTINGS_BYTES",
  "MAX_SETTINGS_FILE_BYTES",
  "ProtectedSettingsAdmissionOutcome",
  "ProtectedSettingsFileAuthority",
  "ProtectedSettingsFileAuthorityOptions",
  "SettingsDocumentTarget",
  "SettingsDocumentTargetSchema",
  "SettingsFileAuthority",
  "SettingsFileAuthorityHooks",
  "SettingsFileAuthorityOptions",
  "SettingsFileApplyOutcome",
  "SettingsFileOperations",
  "SettingsPrepareResolution",
  "SettingsPreparedUpdate",
  "SettingsRootAuthority",
  "SettingsRootAuthoritySchema",
  "SettingsRootBackupSnapshot",
  "SettingsRootPaths",
  "SettingsRootPathsSchema",
  "createProtectedSettingsFileAuthority",
  "createSettingsFileAuthority",
  "inspectProtectedSettingsFilesReadOnly",
  "observeJournaledProtectedSettings",
  "requireJournaledProtectedSettings",
  "settingsRootAuthority",
  "settingsRootPaths",
  "settingsRootPathsFromOrdinaryPath",
]);

/** These modules read frozen migration or backup formats; none is ordinary authority. */
const HISTORICAL_SETTINGS_FILE_READERS = new Set([
  "src/backend/storage/compatibility/backup-inspection.ts",
  "src/backend/storage/compatibility/d331-protected-journal.ts",
  "src/backend/storage/compatibility/d331-settings-current.ts",
  "src/backend/storage/compatibility/d331-settings-root.ts",
  "src/backend/storage/sqlite/backup-service.ts",
]);

const FILESYSTEM_PATH_CONSUMERS = new Set([
  "accessSync",
  "appendFileSync",
  "copyFileSync",
  "existsSync",
  "lstatSync",
  "mkdirSync",
  "openSync",
  "readFileSync",
  "readdirSync",
  "realpathSync",
  "renameSync",
  "rmSync",
  "statSync",
  "unlinkSync",
  "writeFileSync",
]);

interface ParsedSource {
  readonly path: string;
  readonly source: ts.SourceFile;
}

function parse(path: string, text: string): ts.SourceFile {
  const kind = path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
}

function visit(node: ts.Node, callback: (node: ts.Node) => void): void {
  callback(node);
  ts.forEachChild(node, (child) => {
    visit(child, callback);
  });
}

function repoPath(root: string, absolute: string): string {
  return relative(root, absolute).replaceAll("\\", "/");
}

function sourceFiles(root: string): readonly ParsedSource[] {
  return ["src", "scripts"].flatMap((directory) =>
    walkFiles(resolve(root, directory), { missing: "planned-empty" }).map((absolute) => {
      const path = repoPath(root, absolute);
      return { path, source: parse(path, readFileSync(absolute, "utf8")) };
    })
  );
}

function literalValue(node: ts.Node | undefined): string | undefined {
  return node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
}

function moduleSpecifiers(source: ts.SourceFile): readonly string[] {
  const specifiers: string[] = [];
  visit(source, (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const specifier = literalValue(node.moduleSpecifier);
      if (specifier !== undefined) specifiers.push(specifier);
    }
    if (ts.isCallExpression(node)
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || ts.isIdentifier(node.expression) && node.expression.text === "require")) {
      const specifier = literalValue(node.arguments[0]);
      if (specifier !== undefined) specifiers.push(specifier);
    }
  });
  return specifiers;
}

function localModuleCandidate(root: string, fromPath: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const withoutRuntimeExtension = specifier.replace(/\.(?:[cm]?js|jsx)$/u, "");
  const base = resolve(root, dirname(fromPath), withoutRuntimeExtension);
  return repoPath(root, `${base}.ts`);
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    && ts.getModifiers(node)?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword) === true;
}

function exportedNames(source: ts.SourceFile): readonly string[] {
  const names: string[] = [];
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement) && statement.exportClause !== undefined
      && ts.isNamedExports(statement.exportClause)) {
      names.push(...statement.exportClause.elements.map(({ name }) => name.text));
      continue;
    }
    if (!hasExportModifier(statement)) continue;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.push(declaration.name.text);
      }
      continue;
    }
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)
        || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)
        || ts.isEnumDeclaration(statement)) && statement.name !== undefined) {
      names.push(statement.name.text);
    }
  }
  return names;
}

function importedPathBindings(source: ts.SourceFile): Readonly<{
  functions: ReadonlySet<string>;
  namespaces: ReadonlySet<string>;
}> {
  const functions = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || literalValue(statement.moduleSpecifier) !== "node:path") continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined) continue;
    if (ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
      continue;
    }
    for (const element of bindings.elements) {
      const imported = element.propertyName?.text ?? element.name.text;
      if (imported === "join" || imported === "resolve") functions.add(element.name.text);
    }
  }
  return { functions, namespaces };
}

function callName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  return ts.isPropertyAccessExpression(expression) ? expression.name.text : undefined;
}

function containsSettingsJsonPathSegment(node: ts.Node): boolean {
  let found = false;
  visit(node, (candidate) => {
    if (ts.isStringLiteral(candidate) || ts.isNoSubstitutionTemplateLiteral(candidate)) {
      if (candidate.text === "settings.json" || candidate.text.includes("/settings.json")) found = true;
    }
    if (ts.isTemplateHead(candidate) || ts.isTemplateMiddle(candidate) || ts.isTemplateTail(candidate)) {
      if (candidate.text.includes("/settings.json")) found = true;
    }
  });
  return found;
}

function settingsPathConstructionLines(parsed: ParsedSource): readonly number[] {
  const lines = new Set<number>();
  const bindings = importedPathBindings(parsed.source);
  const record = (node: ts.Node): void => {
    lines.add(parsed.source.getLineAndCharacterOfPosition(node.getStart(parsed.source)).line + 1);
  };
  visit(parsed.source, (node) => {
    if (ts.isCallExpression(node)) {
      const name = callName(node.expression);
      const namespacePathCall = ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression)
        && bindings.namespaces.has(node.expression.expression.text)
        && (name === "join" || name === "resolve");
      const importedPathCall = name !== undefined && bindings.functions.has(name);
      const directFilesystemPath = name !== undefined && FILESYSTEM_PATH_CONSUMERS.has(name);
      if ((namespacePathCall || importedPathCall || directFilesystemPath)
        && node.arguments.some(containsSettingsJsonPathSegment)) record(node);
    }
    if (ts.isNewExpression(node) && callName(node.expression) === "URL"
      && node.arguments?.some(containsSettingsJsonPathSegment) === true) record(node);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken
      && containsSettingsJsonPathSegment(node)) record(node);
    if (ts.isTemplateExpression(node) && containsSettingsJsonPathSegment(node)) record(node);
  });
  return [...lines].sort((left, right) => left - right);
}

function protectedSingletonApiLines(parsed: ParsedSource): readonly number[] {
  const lines = new Set<number>();
  visit(parsed.source, (node) => {
    const name = ts.isPropertyAccessExpression(node) || ts.isPropertySignature(node)
      || ts.isPropertyDeclaration(node) || ts.isPropertyAssignment(node)
      ? node.name
      : undefined;
    if (name !== undefined && (ts.isIdentifier(name) || ts.isStringLiteral(name))
      && name.text === "protectedSettingsCurrent") {
      lines.add(parsed.source.getLineAndCharacterOfPosition(node.getStart(parsed.source)).line + 1);
    }
  });
  return [...lines].sort((left, right) => left - right);
}

function auditSqliteSettingsAuthority(root: string): readonly string[] {
  const issues: string[] = [];
  const sources = sourceFiles(root);
  for (const path of RETIRED_RUNTIME_MODULES) {
    if (sources.some((entry) => entry.path === path)) {
      issues.push(`${path}: retired settings file authority module still exists`);
    }
  }
  for (const parsed of sources) {
    for (const specifier of moduleSpecifiers(parsed.source)) {
      const candidate = localModuleCandidate(root, parsed.path, specifier);
      if (candidate !== undefined && RETIRED_RUNTIME_MODULES.has(candidate)) {
        issues.push(`${parsed.path}: imports retired settings file authority module ${candidate}`);
      }
    }
    if (!HISTORICAL_SETTINGS_FILE_READERS.has(parsed.path)) {
      for (const name of exportedNames(parsed.source)) {
        if (RETIRED_FILE_AUTHORITY_EXPORTS.has(name)) {
          issues.push(`${parsed.path}: exports retired settings file authority API ${name}`);
        }
      }
      for (const line of settingsPathConstructionLines(parsed)) {
        issues.push(`${parsed.path}:${String(line)}: constructs a settings.json authority path outside a migration or historical backup reader`);
      }
      for (const line of protectedSingletonApiLines(parsed)) {
        issues.push(`${parsed.path}:${String(line)}: exposes retired protectedSettingsCurrent singleton API`);
      }
    }
  }
  return [...new Set(issues)].sort();
}

describe("sqlite-settings-authority", () => {
  it("keeps ordinary runtime on SQLite and leaves file readers only in historical compatibility", () => {
    assert.deepEqual(auditSqliteSettingsAuthority(REPO_ROOT), []);
  });

  it("catches a retired module import, API, pathname construction, and protected singleton", () => {
    const root = resolve(tmpdir(), `hrauto-sqlite-settings-guard-${String(process.pid)}-${String(Date.now())}`);
    const file = resolve(root, "src/backend/app/composition/dashboard/compose.ts");
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, [
        'import { join } from "node:path";',
        'import { createSettingsFileAuthority as legacy } from "../../../../infra/config/settings-file.js";',
        'export const authorityPath = join(stateRoot, "settings.json");',
        'export const createProtectedSettingsFileAuthority = legacy;',
        'export interface Repositories { protectedSettingsCurrent: unknown }',
        "",
      ].join("\n"));
      const issues = auditSqliteSettingsAuthority(root).join("\n");
      assert.match(issues, /imports retired settings file authority module/u);
      assert.match(issues, /exports retired settings file authority API createProtectedSettingsFileAuthority/u);
      assert.match(issues, /constructs a settings\.json authority path/u);
      assert.match(issues, /exposes retired protectedSettingsCurrent singleton API/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("pins v32 values in settings_current and removes the protected singleton", () => {
    assert.equal(CURRENT_AUTHORITY_SCHEMA_VERSION, 56);
    assert.equal(SQLITE_MIGRATIONS.at(-1)?.version, CURRENT_AUTHORITY_SCHEMA_VERSION);
    const v32 = SQLITE_MIGRATIONS.find(({ version }) => version === 32);
    assert.ok(v32 !== undefined);
    assert.ok(v32.statements.some((statement) => statement.includes("json_type(record_json, '$.settings')")));
    assert.ok(v32.statements.some((statement) => statement === "DROP TABLE protected_settings_current"));
    assert.ok(AuthorityTableNameSchema.options.includes("app_settings"));
    assert.equal(AuthorityTableNameSchema.options.includes("protected_settings_current" as never), false);

    const settings = { concurrency: { defaultWorkers: 3 } };
    const current = {
      revision: 2,
      settings,
      settingsFingerprint: derivePersistedSettingsFingerprint(settings),
      commandId: "00000000-0000-4000-8000-000000000001",
      commandFingerprint: "1".repeat(64),
      auditId: "00000000-0000-4000-8000-000000000002",
      committedAt: "2026-09-06T12:00:00.000Z",
    };
    assert.equal(SettingsCurrentRecordSchema.safeParse(current).success, true);
    const { settings: _settings, ...withoutSettings } = current;
    assert.equal(SettingsCurrentRecordSchema.safeParse(withoutSettings).success, false);

    const database = new DatabaseSync(":memory:");
    try {
      for (const migration of SQLITE_MIGRATIONS) {
        for (const statement of migration.statements) database.exec(statement);
      }
      assert.equal(database.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='protected_settings_current'",
      ).get(), undefined);
      assert.ok(database.prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='app_settings'",
      ).get() !== undefined);
    } finally {
      database.close();
    }
  });
});
