import { createGuardProgram } from "../../support/helpers/caching-compiler-host.js";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import { describe, it } from "vitest";
import { gitVisibleFiles, REPO_ROOT } from "../support/helpers/guard-files.js";


const PRIVATE_SQLITE_ADAPTERS = [
  "src/backend/storage/sqlite/assistant-authorization.ts",
  "src/backend/storage/sqlite/assistant-model-preference.ts",
  "src/backend/storage/sqlite/authority-database.ts",
  "src/backend/storage/sqlite/backup-inspection.ts",
  "src/backend/storage/sqlite/command-record-row.ts",
  "src/backend/storage/sqlite/failure-resolution.ts",
  "src/backend/storage/sqlite/generated-artifacts.ts",
  "src/backend/storage/sqlite/imported-artifacts.ts",
  "src/backend/storage/sqlite/native-run-deletion.ts",
  "src/backend/storage/sqlite/notification-publications.ts",
  "src/backend/storage/sqlite/profile-local-databases.ts",
  "src/backend/storage/sqlite/readonly-authority-snapshot.ts",
  "src/backend/storage/sqlite/run-search-index.ts",
  "src/backend/storage/sqlite/run-summaries.ts",
  "src/backend/storage/sqlite/settings-activation.ts",
  "src/backend/storage/sqlite/settings-storage.ts",
  "src/backend/storage/sqlite/timeline-repository.ts",
  "src/backend/storage/sqlite/transaction-selection.ts",
  "src/backend/storage/sqlite/workbook-library-repository.ts",
  "src/backend/storage/sqlite/worker-control.ts",
  "src/backend/storage/sqlite/worker-slots.ts",
];
const ADAPTER_PATH = "src/backend/storage/sqlite/authority-database.ts";

function isPrivateMember(member: ts.ClassElement): boolean {
  const hashPrivate = member.name !== undefined && ts.isPrivateIdentifier(member.name);
  const keywordPrivate = ts.canHaveModifiers(member)
    && ts.getModifiers(member)?.some(({ kind }) => kind === ts.SyntaxKind.PrivateKeyword) === true;
  return hashPrivate || keywordPrivate;
}

function publicSqliteLeaks(file: string): readonly string[] {
  const program = createGuardProgram([file], { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, skipLibCheck: true });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(file);
  if (source === undefined) throw new Error(`missing SQLite boundary source ${file}`);
  const issues: string[] = [];
  function rawType(type: ts.Type, location: ts.Node, seen = new Set<ts.Type>(), activeSymbols = new Set<ts.Symbol>()): boolean {
    if (seen.has(type)) return false;
    seen.add(type);
    const symbol = type.getSymbol();
    if (symbol?.name === "DatabaseSync" || type.aliasSymbol?.name === "DatabaseSync") return true;
    if (type.isUnionOrIntersection()) return type.types.some(member => rawType(member, location, seen, activeSymbols));
    if (type.aliasTypeArguments?.some(argument => rawType(argument, location, seen, activeSymbols))) return true;
    if ((type.flags & ts.TypeFlags.TypeParameter) !== 0) {
      const constraint = checker.getBaseConstraintOfType(type);
      return constraint !== undefined && rawType(constraint, location, seen, activeSymbols);
    }
    if ((type.flags & ts.TypeFlags.Conditional) !== 0) {
      const { trueType, falseType } = (type as ts.ConditionalType).root.node;
      return [trueType, falseType].some(branch => rawType(checker.getTypeFromTypeNode(branch), branch, seen, activeSymbols));
    }
    if ((type.flags & ts.TypeFlags.IndexedAccess) !== 0) {
      return rawType((type as ts.IndexedAccessType).objectType, location, seen, activeSymbols);
    }
    if ((type.flags & ts.TypeFlags.Object) === 0) return false;
    if (((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Mapped) !== 0) {
      for (const declaration of symbol?.declarations ?? []) {
        const mapped = ts.isMappedTypeNode(declaration) ? declaration
          : ts.isTypeAliasDeclaration(declaration) && ts.isMappedTypeNode(declaration.type) ? declaration.type : undefined;
        if (mapped?.type !== undefined && rawType(checker.getTypeFromTypeNode(mapped.type), mapped.type, seen, activeSymbols)) return true;
      }
    }
    // Check each concrete payload, then visit the generic declaration instead of fluent wrapper permutations.
    if (((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference) !== 0) {
      const reference = type as ts.TypeReference;
      if (checker.getTypeArguments(reference).some(argument => rawType(argument, location, seen, activeSymbols))) return true;
      if (reference.target !== type) return rawType(reference.target, location, seen, activeSymbols);
    }
    if (symbol !== undefined && (activeSymbols.has(symbol)
      || symbol.declarations?.every(declaration => /\/typescript\/lib\/lib\.[^/]+\.d\.ts$/u.test(declaration.getSourceFile().fileName.replaceAll("\\", "/"))) === true)) return false;
    if (symbol !== undefined) activeSymbols.add(symbol);
    try {
      for (const signature of type.getCallSignatures()) {
        if (rawType(signature.getReturnType(), location, seen, activeSymbols)
          || signature.parameters.some(parameter => rawType(checker.getTypeOfSymbolAtLocation(parameter, location), location, seen, activeSymbols))) return true;
      }
      return type.getProperties().some(property => {
        if (property.declarations?.some(declaration => ts.isClassDeclaration(declaration.parent) && isPrivateMember(declaration as ts.ClassElement)) === true) return false;
        return rawType(checker.getTypeOfSymbolAtLocation(property, location), location, seen, activeSymbols);
      });
    } finally { if (symbol !== undefined) activeSymbols.delete(symbol); }
  }
  function returnedRaw(node: ts.Node): boolean {
    if (ts.isReturnStatement(node) && node.expression !== undefined) {
      let expression = node.expression;
      while (ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression) || ts.isParenthesizedExpression(expression)) expression = expression.expression;
      if (rawType(checker.getTypeAtLocation(expression), expression)) return true;
    }
    return ts.forEachChild(node, returnedRaw) === true;
  }
  for (const statement of source.statements) {
    if (!ts.isClassDeclaration(statement) || statement.name?.text !== "AuthorityDatabase") continue;
    for (const member of statement.members) {
      if (isPrivateMember(member)) continue;
      const name = member.name?.getText(source) ?? "constructor";
      if (ts.isConstructorDeclaration(member)) {
        if (member.parameters.some(parameter => rawType(checker.getTypeAtLocation(parameter), parameter))) issues.push(`${name}: raw SQLite parameter`);
      } else if (rawType(checker.getTypeAtLocation(member), member) || returnedRaw(member)) issues.push(`${name}: public SQLite handle escapes`);
    }
  }
  return issues;
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
    assert.deepEqual(nodeSqliteImports.sort(), [...PRIVATE_SQLITE_ADAPTERS].sort());
    assert.deepEqual(databaseSyncIdentifiers.sort(), [...PRIVATE_SQLITE_ADAPTERS].sort());
  });

  it("exports repositories and inspections without a raw connection or SQL escape hatch", () => {
    const entrypoint = readFileSync(join(REPO_ROOT, "src/backend/storage/sqlite/index.ts"), "utf8");
    assert.doesNotMatch(entrypoint, /node:sqlite|DatabaseSync|\b(exec|prepare|connection|rawDatabase)\b/);

    const adapterText = readFileSync(join(REPO_ROOT, ADAPTER_PATH), "utf8");
    const source = ts.createSourceFile(ADAPTER_PATH, adapterText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const authorityClass = source.statements.find(
      (statement): statement is ts.ClassDeclaration => ts.isClassDeclaration(statement)
        && statement.name?.text === "AuthorityDatabase",
    );
    assert.ok(authorityClass, "AuthorityDatabase class must exist");
    assert.deepEqual(publicSqliteLeaks(join(REPO_ROOT, ADAPTER_PATH)), []);

    const publicEscapeHatches = authorityClass.members
      .filter((member) => !isPrivateMember(member))
      .map((member) => member.name)
      .filter((name): name is ts.Identifier => name !== undefined && ts.isIdentifier(name))
      .map(({ text }) => text)
      .filter((name) => ["database", "connection", "exec", "prepare", "query", "raw"].includes(name));
    assert.deepEqual(publicEscapeHatches, []);
  });
});

it("allows closed results from private local SQLite use and rejects direct, aliased, field, getter and nested handles", () => {
  const root = resolve(tmpdir(), `hrauto-sqlite-api-${String(process.pid)}-${String(Date.now())}`);
  const file = join(root, "boundary.ts");
  const header = 'declare class DatabaseSync { close(): void; } export class AuthorityDatabase {';
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, header + ' classify(): "prestate" | "committed" { const database = new DatabaseSync(); try { return "prestate"; } finally { database.close(); } } }');
    assert.deepEqual(publicSqliteLeaks(file), []);
    for (const body of [
      'open() { const connection = new DatabaseSync(); return Promise.resolve({ wrapped: new Map([["raw", connection]]) }); }',
      'open() { const connection = new DatabaseSync(); const cycle: { next?: typeof cycle; raw: DatabaseSync } = { raw: connection }; cycle.next = cycle; return cycle; }',
      'open() { return new DatabaseSync(); }',
      'open() { const connection = new DatabaseSync(); const alias = connection; return alias; }',
      'readonly connection = new DatabaseSync();',
      '#connection = new DatabaseSync(); get value() { return this.#connection; }',
      'open() { const connection = new DatabaseSync(); return { nested: [connection] }; }',
      'open(connection: DatabaseSync) { return "prestate"; }',
      'open() { const connection = new DatabaseSync(); return connection as any; }',
    ]) {
      writeFileSync(file, header + body + '}');
      assert.ok(publicSqliteLeaks(file).length > 0, body);
    }
    for (const body of [
      'open<T>(): T extends string ? { raw: DatabaseSync } : string { throw new Error("fixture"); }',
      'open() { class Holder<T> { readonly value?: T; readonly raw = new DatabaseSync(); } return new Holder<string>(); }',
      'open() { class Holder<T> { value!: { [K in keyof T]: DatabaseSync }; } return new Holder<{ safe: string }>(); }',
      'open() { type Fields<T> = { [K in keyof T]: DatabaseSync }; class Holder<T> { value!: Fields<T>; } return new Holder<{ safe: string }>(); }',
      'open() { class Holder<T> { value!: { [K in keyof T]: K extends string ? DatabaseSync : never }[keyof T]; } return new Holder<{ safe: string }>(); }',
      'open<T extends { nested: DatabaseSync }>(input: T) { return Promise.resolve(new Map([["raw", input]])); }',
    ]) {
      writeFileSync(file, header + body + '}');
      assert.ok(publicSqliteLeaks(file).length > 0, body);
    }
    writeFileSync(file, header + 'open() { class Holder<T> { value!: { [K in keyof T]: T[K] }; } return new Holder<{ safe: string }>(); } }');
    assert.deepEqual(publicSqliteLeaks(file), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
