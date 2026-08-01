import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { describe, it } from "vitest";
import { walkFiles } from "./helpers/guard-files.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

function auditTaskContractSources(root: string): readonly string[] {
  const issues: string[] = [];
  const contractRoot = resolve(root, "src/domain/contracts");
  const files = walkFiles(contractRoot, { missing: "planned-empty" });
  if (files.length === 0) issues.push("task-contract source family is empty");
  for (const file of files) {
    const path = relative(root, file).replaceAll("\\", "/");
    const content = readFileSync(file, "utf8");
    if (/from\s+["'](?:node:|playwright|\.\.\/\.\.\/base|\.\.\/\.\.\/stores)/u.test(content)) {
      issues.push(`${path}: bundle-safe task contracts import server/runtime infrastructure`);
    }
    if (/\bz\.object\s*\(/u.test(content)) issues.push(`${path}: task boundaries must use z.strictObject`);
    if (path !== "src/domain/contracts/base.ts" && /__sealed\s*:\s*true/u.test(content)) {
      issues.push(`${path}: only defineTaskContract may mint a sealed contract`);
    }
  }
  return issues;
}

describe("task contract sealing architecture", () => {
  it("keeps task contracts bundle-safe and factory-sealed", () => {
    assert.deepEqual(auditTaskContractSources(REPO_ROOT), []);
    const base = readFileSync(resolve(REPO_ROOT, "src/domain/contracts/base.ts"), "utf8");
    for (const effect of ["read", "prepare", "commit"]) {
      assert.match(base, new RegExp(`readonly effect: ["']${effect}["']`, "u"));
    }
    assert.match(base, /Object\.freeze\(\{ \.\.\.contract, __sealed: true \}\)/u);
  });

  it("pins compile-time denial of undeclared errors, unsafe outputs, and read mutation", () => {
    const fixture = readFileSync(resolve(REPO_ROOT, "tests/types/task-contracts.typecheck.ts"), "utf8");
    assert.match(fixture, /undeclared task error codes must not compile/u);
    assert.match(fixture, /read contexts cannot acquire mutation capability/u);
    assert.match(fixture, /z\.any cannot be a canonical task output schema/u);
  });

  it("catches infrastructure imports and direct sealed-contract forgery", () => {
    const root = resolve(tmpdir(), `hrauto-task-contract-${String(process.pid)}-${String(Date.now())}`);
    const file = resolve(root, "src/domain/contracts/ucpath/bad.ts");
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(
        file,
        'import type { Page } from "playwright";\nexport const forged = { __sealed: true, page: undefined as Page | undefined };\n',
      );
      assert.match(auditTaskContractSources(root).join("\n"), /infrastructure|mint a sealed contract/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
