import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { it } from "vitest";
import { BuildIdError, computeBuildId, unscannedLoadForms } from "../../../src/backend/app/build-id.js";
import { REPO_ROOT, walkFiles } from "../support/helpers/guard-files.js";

const HASHED_ROOTS = ["src/backend", "src/workflow-kit", "src/workflows", "src/models", "src/rules"];
const HASHED_FILES = ["src/cli.ts"];

function hashedSources(): string[] {
  return [...HASHED_ROOTS.flatMap(root => walkFiles(join(REPO_ROOT, root))), ...HASHED_FILES.map(file => join(REPO_ROOT, file))];
}

function excludedDashboard(repoRelativePath: string): string | undefined {
  const target = repoRelativePath.replaceAll("\\", "/");
  return target.startsWith("src/dashboard/") ? target : undefined;
}

function valueSpecifiers(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/(?<![.\w$])import\(\s*["'](\.[^"']+)["']\s*\)|(?<![.\w$])require\(\s*["'](\.[^"']+)["']\s*\)/gu)) {
    const specifier = match[1] ?? match[2];
    if (specifier !== undefined) found.push(specifier);
  }
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const sideEffect = /^\s*import\s+["'](\.[^"']+)["']/u.exec(line);
    if (sideEffect?.[1] !== undefined) found.push(sideEffect[1]);
    const from = /\bfrom\s+["'](\.[^"']+)["']/u.exec(line);
    if (from?.[1] === undefined) continue;
    let start = index;
    while (start > 0 && !/^\s*(?:import|export)\b/u.test(lines[start] ?? "")) start -= 1;
    if (/^\s*(?:import|export)\s+type\b/u.test(lines[start] ?? "")) continue;
    found.push(from[1]);
  }
  return found;
}

function dashboardViolations(file: string, text: string): string[] {
  const source = relative(REPO_ROOT, file).replaceAll("\\", "/");
  return valueSpecifiers(text).flatMap(specifier => {
    const target = excludedDashboard(relative(REPO_ROOT, resolve(dirname(file), specifier)));
    return target === undefined ? [] : [`${source} -> ${target}`];
  });
}

it("keeps worker code, including the CLI, from importing the dashboard tree the build id excludes", () => {
  assert.deepEqual(hashedSources().flatMap(file => dashboardViolations(file, readFileSync(file, "utf8"))), []);
  const cli = join(REPO_ROOT, "src/cli.ts");
  assert.deepEqual(dashboardViolations(cli, 'import "./dashboard/panel.js";'), ["src/cli.ts -> src/dashboard/panel.js"]);
  assert.deepEqual(dashboardViolations(cli, 'require("./dashboard/panel.js");'), ["src/cli.ts -> src/dashboard/panel.js"]);
  assert.deepEqual(dashboardViolations(cli, 'void import("./dashboard/panel.js");'), ["src/cli.ts -> src/dashboard/panel.js"]);
  assert.deepEqual(dashboardViolations(cli, "void import(\n  \"./dashboard/panel.js\"\n)"), ["src/cli.ts -> src/dashboard/panel.js"]);
  assert.deepEqual(dashboardViolations(cli, "require(\n  \"./dashboard/panel.js\"\n)"), ["src/cli.ts -> src/dashboard/panel.js"]);
  assert.deepEqual(dashboardViolations(cli, 'import type { Panel } from "./dashboard/panel.js";'), []);
  assert.equal("src\\dashboard\\panel.tsx".startsWith("src/dashboard/"), false);
  assert.equal(excludedDashboard("src\\dashboard\\panel.tsx"), "src/dashboard/panel.tsx");
});

it("computes the checkout's build id without an unresolved dependency or specifier", () => {
  assert.match(computeBuildId(REPO_ROOT), /^[0-9a-f]{64}$/u);
});

it("rejects dynamic imports and requires the build id's specifier scan cannot see", () => {
  const violations = hashedSources().flatMap(file => unscannedLoadForms(readFileSync(file, "utf8")).map(form => `${relative(REPO_ROOT, file)}: ${form}`));
  assert.deepEqual(violations, []);
  assert.deepEqual(unscannedLoadForms([
    'const a = await import("hono");', "const b = require('zod');", 'import type { X } from "react";',
    "ObjC.import('AppKit');", "module.require('x');",
  ].join("\n")), []);
  assert.equal(unscannedLoadForms("const name = 'pdf-lib';\nconst c = await import(name);").length, 1);
  assert.equal(unscannedLoadForms("const d = require(`${base}/x`);").length, 1);
  assert.equal(unscannedLoadForms('const e = await import("./" + name);').length, 1);
  const root = mkdtempSync(join(tmpdir(), "relay-build-id-roots-"));
  try {
    for (const directory of HASHED_ROOTS) mkdirSync(join(root, directory), { recursive: true });
    writeFileSync(join(root, "src/cli.ts"), "export {}\n");
    writeFileSync(join(root, "src/backend/computed.ts"), "const name = \"zod\";\nvoid import(name);\n");
    writeFileSync(join(root, "package-lock.json"), JSON.stringify({ packages: { "": { name: "fixture" } } }));
    assert.throws(() => computeBuildId(root), (error: unknown) => error instanceof BuildIdError
      && error.code === "relay-build-id-dependency-unresolved" && error.message.includes("computed specifier"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
