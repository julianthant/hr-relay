import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const typedExtensions = new Set([".ts", ".tsx", ".mts", ".cts"]);
const lintExtensions = new Set([...typedExtensions, ".js", ".mjs", ".cjs"]);
const ignoredDirectories = new Set(["dist", "node_modules", "coverage", ".work"]);

export function lintBatches(root: string): { name: string; targets: string[] }[] {
  const entries = readdirSync(join(root, "tests"), { withFileTypes: true });
  const topLevelFiles = entries
    .filter((entry) => !entry.isDirectory() && lintExtensions.has(extname(entry.name)))
    .map((entry) => `tests/${entry.name}`);
  return [
    { name: "source", targets: ["src", "scripts", "vitest.config.ts", "vite.dashboard.config.ts", "vite.mocks.config.ts"] },
    ...entries
      .filter((entry) => entry.isDirectory() && !ignoredDirectories.has(entry.name))
      .map((entry) => ({ name: `tests-dir-${entry.name}`, targets: [`tests/${entry.name}`] })),
    ...(topLevelFiles.length ? [{ name: "tests-files", targets: topLevelFiles }] : []),
  ];
}

function typedRoots(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return ignoredDirectories.has(entry.name) ? [] : typedRoots(path);
    }
    return typedExtensions.has(extname(entry.name)) ? [path] : [];
  });
}

function lint(root: string): number {
  const cacheDirectory = join(root, "node_modules", ".cache", "eslint");
  const baseConfigUrl = pathToFileURL(join(root, "eslint.config.js")).href;
  mkdirSync(cacheDirectory, { recursive: true });
  const scratch = mkdtempSync(join(cacheDirectory, ".lint-"));
  const pendingFile = join(scratch, "pending");
  let exitCode = 0;
  try {
    for (const { name, targets } of lintBatches(root)) {
      const files = targets.flatMap((target) => {
        const path = join(root, target);
        if (statSync(path).isDirectory()) return typedRoots(path);
        return typedExtensions.has(extname(path)) ? [path] : [];
      });
      const project = join(cacheDirectory, `${name}.tsconfig.json`);
      const config = join(cacheDirectory, `${name}.config.mjs`);
      // Stable paths keep the lint cache reusable. Atomic replacement keeps concurrent readers safe.
      writeFileSync(pendingFile, JSON.stringify({ extends: join(root, "tsconfig.json"), files, include: [] }));
      renameSync(pendingFile, project);
      writeFileSync(pendingFile, `import { createEslintConfig } from ${JSON.stringify(baseConfigUrl)};
export default createEslintConfig(${JSON.stringify(project)});
`);
      renameSync(pendingFile, config);

      const result = spawnSync(process.execPath, [
        "--max-old-space-size=6144", "node_modules/eslint/bin/eslint.js",
        "--config", config,
        "--cache", "--cache-strategy", "content", "--cache-location", join(cacheDirectory, name),
        "--max-warnings", "0", "--", ...targets,
      ], { cwd: root, stdio: "inherit" });
      if (result.status !== 0) {
        const detail = result.error?.message ?? result.signal ?? `exit ${result.status}`;
        process.stderr.write(`Lint batch ${name} failed (${detail})\n`);
        exitCode ||= result.status || 1;
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return exitCode;
}

if (import.meta.main) {
  process.exitCode = lint(resolve(import.meta.dirname, "../.."));
}
