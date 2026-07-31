import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isDirectExecution, resolveScopeFiles } from "./scope-files.js";

const ROOT = process.cwd();
// D93: the rebuild's own roots. `unit` deliberately EXCLUDES the architecture
// subtree so the two numbers stay independently reviewable at a phase exit.
const FAMILIES = [
  ["unit", "tests/unit"],
  ["scenario", "tests/scenario"],
  ["architecture", "tests/unit/architecture"],
] as const;

export interface SuiteSize {
  readonly family: string;
  readonly files: number;
  readonly lines: number;
  readonly state: "active" | "planned-absent";
}

export function measureSuiteSize(): SuiteSize[] {
  return FAMILIES.map(([family, path]) => {
    const root = resolve(ROOT, path);
    if (!existsSync(root)) {
      return { family, files: 0, lines: 0, state: "planned-absent" };
    }
    const scope = resolveScopeFiles(root, [".ts", ".tsx"]);
    const architecture = resolve(ROOT, "tests/unit/architecture");
    const files = scope.files
      .filter((file) => file.endsWith(".test.ts") || file.endsWith(".test.tsx"))
      .filter((file) => family !== "unit" || !file.startsWith(`${architecture}/`));
    return {
      family,
      files: files.length,
      lines: files.reduce((sum, file) => sum + readFileSync(file, "utf8").split("\n").length, 0),
      state: "active",
    };
  });
}

if (isDirectExecution(import.meta.url)) {
  console.log("Rebuild suite size (reviewed at phase exits; not a hard gate):");
  for (const row of measureSuiteSize()) {
    console.log(
      `  ${row.family}: ${row.files} file(s), ${row.lines} line(s) [${row.state}]`,
    );
  }
}
