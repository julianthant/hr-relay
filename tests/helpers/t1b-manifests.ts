/**
 * Evaluate a T1b declaration WITHOUT importing it (ref guards-and-tests §10.4/§10.9).
 *
 * A vitest-collected file may not import a `dry-run.scenario.ts` manifest —
 * every workflow's structural scenario proves nothing does, in both static and
 * dynamic form — so a test that needs the exact checked-in declaration
 * transpiles it and runs it in an isolated `node:vm` context whose only
 * reachable module is the real manifest parser. Reading the file as text and
 * re-deriving its object literal would re-implement zod; running it is what
 * proves the checked-in declaration parses.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import {
  parseDryRunScenarioManifest,
  type DryRunScenarioManifest,
} from "../../src/domain/trust/dry-run-scenario.js";

/** The one module a manifest may import: the parser that seals it. */
export const T1B_MANIFEST_PARSER_MODULE = "domain/trust/dry-run-scenario.js";

export function evaluateT1bManifest(repoRoot: string, path: string): DryRunScenarioManifest {
  const transpiled = ts.transpileModule(readFileSync(join(repoRoot, path), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: path,
  }).outputText;
  const moduleRecord = { exports: {} as Record<string, unknown> };
  const context = vm.createContext({
    module: moduleRecord,
    exports: moduleRecord.exports,
    require: (specifier: string): unknown => {
      if (!specifier.endsWith(T1B_MANIFEST_PARSER_MODULE)) {
        throw new Error(`${path} may only import the manifest parser, not ${specifier}`);
      }
      return { parseDryRunScenarioManifest };
    },
  });
  vm.runInContext(transpiled, context, { filename: path });
  const exported = Object.values(moduleRecord.exports);
  const only = exported[0];
  if (exported.length !== 1 || only === undefined) {
    throw new Error(`${path} must export exactly one manifest; it exports ${String(exported.length)}`);
  }
  return parseDryRunScenarioManifest(only);
}
