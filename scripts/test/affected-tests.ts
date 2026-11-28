import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import ts from "typescript";
import { z } from "zod";
import { LINUX_NATIVE_FILES, NATIVE_FILES, SERIAL_FILES, SERIAL_STORAGE_FILES } from "./ci-files.js";
import { isDirectExecution } from "./scope-files.js";

const shardSeconds = 300;
const shardLimit = 8;
const durationsSchema = z.record(z.string().startsWith("tests/"), z.number().nonnegative());
const tsconfigSchema = z.object({ compilerOptions: z.record(z.string(), z.unknown()).optional() });
const sourcePattern = /\.(?:[cm]?[jt]s|[jt]sx)$/u;
const declarationPattern = /\.d\.[cm]?ts$/u;
const globalInputs = [
  "vitest.config.ts",
  "tests/support/duo-ceremony-setup.ts",
  "tests/support/private-temp-setup.ts",
];
const workflowExplorerTest = /^tests\/backend\/transports\/http\/routes\/explorer\.[^/]+\.integration\.test\.ts$/u;
const workflowFacts = "src/backend/assistant/plugins/workflows/facts.json";
const workflowFactsTest = "tests/backend/assistant/plugins/workflows/facts.integration.test.ts";
const excludedTests = new Set([...NATIVE_FILES, ...SERIAL_FILES, ...SERIAL_STORAGE_FILES]);

type FileTree = ReadonlyMap<string, string>;
type Importers = ReadonlyMap<string, readonly string[]>;

export type AffectedTestsPlan = {
  core: boolean;
  // Count before the task shard limit, so replay can measure the full workload.
  shardCount: number;
  shards: string[][];
};

function runtimeSpecifiers(path: string, content: string): string[] {
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest);
  const specifiers = new Set<string>();
  const add = (node: ts.Node | undefined) => {
    if (node && ts.isStringLiteralLike(node)) specifiers.add(node.text);
  };
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      if (!clause?.isTypeOnly && (clause?.name || !bindings || !ts.isNamedImports(bindings)
        || bindings.elements.length === 0 || bindings.elements.some(element => !element.isTypeOnly))) {
        add(node.moduleSpecifier);
      }
    } else if (ts.isExportDeclaration(node)) {
      const clause = node.exportClause;
      if (!node.isTypeOnly && (!clause || !ts.isNamedExports(clause)
        || clause.elements.length === 0 || clause.elements.some(element => !element.isTypeOnly))) {
        add(node.moduleSpecifier);
      }
    } else if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly
      && ts.isExternalModuleReference(node.moduleReference)) {
      add(node.moduleReference.expression);
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      add(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return [...specifiers];
}

function distancesFrom(changed: readonly string[], importers: Importers): Map<string, number> {
  const distances = new Map(changed.map(file => [file, 0]));
  const queue = [...distances];
  for (const [file, distance] of queue) {
    for (const importer of importers.get(file) ?? []) {
      if (distances.has(importer)) continue;
      distances.set(importer, distance + 1);
      queue.push([importer, distance + 1]);
    }
  }
  return distances;
}

function pack(files: readonly string[], durations: Readonly<Record<string, number>>): string[][] {
  const measured = Object.values(durations).filter(seconds => seconds > 0).sort((a, b) => a - b);
  const middle = (measured.length - 1) / 2;
  const fallback = ((measured[Math.floor(middle)] ?? 1) + (measured[Math.ceil(middle)] ?? 1)) / 2;
  const shards: string[][] = [];
  let shard: string[] | undefined;
  let load = 0;
  for (const file of files) {
    const seconds = Math.max(0.1, durations[file] ?? fallback);
    if (shard === undefined || load + seconds > shardSeconds || seconds > shardSeconds) {
      shard = [];
      shards.push(shard);
      load = 0;
    }
    shard.push(file);
    load += seconds;
    if (seconds > shardSeconds) shard = undefined;
  }
  return shards;
}

export function createAffectedTestsPlanner(root: string): (base: string, head: string, limit?: number) => AffectedTestsPlan {
  const durations = durationsSchema.parse(JSON.parse(readFileSync(join(root, "scripts/test/ci-durations.json"), "utf8")));
  const parsedBlobs = new Map<string, readonly string[]>();
  const git = (args: string[], input?: string) =>
    execFileSync("git", args, { cwd: root, input, maxBuffer: 128 * 1024 * 1024 });
  const commit = (ref: string) =>
    git(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]).toString().trim();

  function tree(sha: string): FileTree {
    const files = new Map<string, string>();
    for (const entry of git(["ls-tree", "-r", "-z", sha]).toString().split("\0")) {
      const tab = entry.indexOf("\t");
      if (entry.startsWith("100") && tab >= 0) files.set(entry.slice(tab + 1), entry.slice(12, tab));
    }
    return files;
  }

  function readNewSpecifiers(files: FileTree): void {
    const pending = new Map<string, { path: string; blob: string }>();
    for (const [path, blob] of files) {
      if (!sourcePattern.test(path) || declarationPattern.test(path)) continue;
      const key = blob + posix.extname(path);
      if (!parsedBlobs.has(key)) pending.set(key, { path, blob });
    }
    if (pending.size === 0) return;
    const data = git(["cat-file", "--batch"], [...pending.values()].map(({ blob }) => blob + "\n").join(""));
    let start = 0;
    for (const [key, { path, blob }] of pending) {
      const newline = data.indexOf(10, start);
      const header = data.toString("utf8", start, newline).match(/^(\S+) blob (\d+)$/u);
      const end = newline + 1 + Number(header?.[2]);
      if (header?.[1] !== blob || data[end] !== 10) throw new Error(`Invalid Git blob response for ${path}`);
      parsedBlobs.set(key, runtimeSpecifiers(path, data.toString("utf8", newline + 1, end)));
      start = end + 1;
    }
  }

  function reverseImports(sha: string, files: FileTree): Importers {
    readNewSpecifiers(files);
    const options: ts.CompilerOptions = { moduleResolution: ts.ModuleResolutionKind.Bundler, resolveJsonModule: true };
    if (files.has("tsconfig.json")) {
      const parsed = ts.parseConfigFileTextToJson("tsconfig.json", git(["show", `${sha}:tsconfig.json`]).toString());
      if (parsed.error) throw new Error(ts.flattenDiagnosticMessageText(parsed.error.messageText, "\n"));
      const { compilerOptions } = tsconfigSchema.parse(parsed.config);
      const converted = ts.convertCompilerOptionsFromJson(compilerOptions ?? {}, "/");
      if (converted.errors.length > 0) {
        throw new Error(converted.errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, "\n")).join("\n"));
      }
      Object.assign(options, converted.options);
    }
    const host = {
      fileExists: (file: string) => files.has(file.slice(1)),
      getCurrentDirectory: () => "/",
      readFile: (file: string) => files.has(file.slice(1)) ? git(["show", `${sha}:${file.slice(1)}`]).toString() : undefined,
    };
    const cache = ts.createModuleResolutionCache("/", file => file, options);
    const result = new Map<string, string[]>();
    for (const [file, blob] of files) {
      for (const specifier of parsedBlobs.get(blob + posix.extname(file)) ?? []) {
        const resolved = ts.resolveModuleName(specifier, "/" + file, options, host, cache).resolvedModule?.resolvedFileName.slice(1);
        const exact = specifier.startsWith(".") ? posix.join(posix.dirname(file), specifier) : "";
        const dependency = resolved && !declarationPattern.test(resolved) ? resolved : exact;
        if (!files.has(dependency)) continue;
        const current = result.get(dependency);
        if (current) current.push(file);
        else result.set(dependency, [file]);
      }
    }
    return result;
  }

  return (base, head, limit = shardLimit) => {
    const before = commit(base);
    const after = commit(head);
    const changed = git(["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-only", "-z", before, after, "--"])
      .toString().split("\0").filter(Boolean);
    if (changed.length === 0) return { core: false, shardCount: 0, shards: [] };

    const files = tree(after);
    const distances = distancesFrom(changed, reverseImports(after, files));
    const removed = changed.filter(file => !files.has(file));
    if (removed.length > 0) {
      for (const [file, distance] of distancesFrom(removed, reverseImports(before, tree(before)))) {
        if (distance < (distances.get(file) ?? Infinity)) distances.set(file, distance);
      }
    }
    // Explorer and committed-facts tests assert whole workflow definitions but import them many hops away; rank them first so the shard limit keeps them.
    if (changed.some(file => file.startsWith("src/workflows/"))) {
      for (const file of files.keys()) if (workflowExplorerTest.test(file) || file === workflowFactsTest) distances.set(file, 0);
    }
    // The facts test reads the committed file from disk, so no import edge selects it.
    if (changed.includes(workflowFacts) && files.has(workflowFactsTest)) distances.set(workflowFactsTest, 0);
    const global = changed.some(file => /^(?:package(?:-lock)?\.json|(?:vitest\.config|tsconfig)(?:\.[\w-]+)*\.[\w]+)$/u.test(file))
      || globalInputs.some(file => distances.has(file));
    const ordered = [...files.keys()].filter(file =>
      file.startsWith("tests/") && !file.startsWith("tests/perf/") && file.endsWith(".integration.test.ts")
      && (!excludedTests.has(file) || changed.includes(file) && LINUX_NATIVE_FILES.includes(file))
      && (global || distances.has(file)))
      .sort((a, b) => (distances.get(a) ?? Infinity) - (distances.get(b) ?? Infinity) || a.localeCompare(b));
    const shards = pack(ordered, durations);
    return { core: global || shards.length > limit, shardCount: shards.length, shards: shards.slice(0, limit) };
  };
}

if (isDirectExecution(import.meta.url)) {
  const [base, head, ...extra] = process.argv.slice(2);
  if (!base || !head || extra.length > 0) {
    throw new Error("Usage: affected-tests <base-ref> <head-ref>");
  }
  process.stdout.write(JSON.stringify(createAffectedTestsPlanner(process.cwd())(base, head)) + "\n");
}
