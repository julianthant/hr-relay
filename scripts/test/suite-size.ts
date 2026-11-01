import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REBUILD_TEST_PROJECTS } from "../../vitest.config.js";
import { isDirectExecution } from "./scope-files.js";

export interface SuiteSize {
  readonly family: string;
  readonly files: number;
  readonly lines: number;
  readonly state: "active";
}

export function measureSuiteSize(root = process.cwd()): SuiteSize[] {
  return REBUILD_TEST_PROJECTS.flatMap(({ name, include, exclude }) => {
    const excluded = new Set(globSync([...exclude], { cwd: root }));
    const files = [...new Set(globSync([...include], { cwd: root }))]
      .filter((file) => !excluded.has(file)).sort();
    if (files.length === 0) {
      // Empty local means no operator-machine test exists yet.
      if (name === "local") return [];
      throw new Error(`${name}: project collects no tests`);
    }
    return [{
      family: name,
      files: files.length,
      lines: files.reduce((sum, file) => sum + readFileSync(join(root, file), "utf8").split("\n").length, 0),
      state: "active" as const,
    }];
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
