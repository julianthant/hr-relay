
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import {
  parseDryRunScenarioManifest,
  type DryRunScenarioManifest,
} from "../../../src/models/trust/dry-run-scenario.js";

/** The one module a manifest may import: the parser that seals it. */
export const T1B_MANIFEST_PARSER_MODULE = "models/trust/dry-run-scenario.js";

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
