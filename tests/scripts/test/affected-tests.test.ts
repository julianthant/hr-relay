import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAffectedTestsPlanner } from "../../../scripts/test/affected-tests.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(durations: Record<string, number> = {}) {
  const root = mkdtempSync(join(tmpdir(), "affected-tests-"));
  roots.push(root);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  function write(path: string, content: string): void {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  function commit(): string {
    git("add", ".");
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "-c",
      "commit.gpgsign=false", "commit", "--quiet", "-m", "fixture");
    return git("rev-parse", "HEAD");
  }
  git("init", "--quiet");
  write("scripts/test/ci-durations.json", JSON.stringify(durations));
  return { root, git, write, commit };
}

describe("affected integration tests", () => {
  it("ranks direct importers ahead of transitive importers and ignores type-only edges", () => {
    const { root, write, commit } = fixture();
    write("tsconfig.json", JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }));
    write("src/source.ts", "export const value = 1; export type Shape = number;");
    write("src/barrel.ts", 'export { value } from "./source.js";');
    write("src/types.ts", 'export { type Shape } from "./source.js";');
    write("tests/z-direct.integration.test.ts", 'import { value, type Shape } from "@/source.js";');
    write("tests/a-transitive.integration.test.ts", 'await import("../src/barrel.js");');
    write("tests/b-types.integration.test.ts", 'import type { Shape } from "../src/source.js";');
    write("tests/c-types.integration.test.ts", 'import { type Shape } from "../src/source.js";');
    write("tests/d-types.integration.test.ts", 'import "../src/types.js";');
    write("tests/unit.test.ts", 'import "../src/source.js";');
    const base = commit();
    write("src/source.ts", "export const value = 2; export type Shape = string;");
    const head = commit();
    write("tests/z-direct.integration.test.ts", "");

    expect(createAffectedTestsPlanner(root)(base, head)).toEqual({
      core: false,
      shardCount: 1,
      shards: [["tests/z-direct.integration.test.ts", "tests/a-transitive.integration.test.ts"]],
    });
  });

  it("packs in dependency order using the median and caps the returned shards at eight", () => {
    const { root, write, commit } = fixture({
      "tests/a.integration.test.ts": 100,
      "tests/b.integration.test.ts": 200,
      "tests/c.integration.test.ts": 190,
      "tests/unaffected.integration.test.ts": 110,
    });
    write("src/source.ts", "export const value = 1;");
    const name = (letter: string) => `tests/${letter}.integration.test.ts`;
    for (const letter of "abcdefghijklmnopqr") write(name(letter), 'import "../src/source.js";');
    const base = commit();
    write("src/source.ts", "export const value = 2;");
    const head = commit();

    expect(createAffectedTestsPlanner(root)(base, head)).toEqual({
      core: true,
      shardCount: 10,
      shards: ["ab", "c", "de", "fg", "hi", "jk", "lm", "no"].map(group => [...group].map(name)),
    });
  });

  it.each(["package.json", "package-lock.json", "vitest.config.ts", "tsconfig.json",
    "tests/support/private-temp-setup.ts", "tests/support/setup-helper.ts"])("marks %s as core", path => {
    const { root, write, commit } = fixture();
    write("tests/portable.integration.test.ts", "");
    write("tests/perf/bench.integration.test.ts", "");
    write("tests/backend/app/composition/storage-compose.integration.test.ts", "");
    write("tests/backend/storage/browser-roots.native.integration.test.ts", "");
    write("tests/support/private-temp-setup.ts", 'import "./setup-helper.js";');
    write("tests/support/setup-helper.ts", "export const setup = 1;");
    const base = commit();
    write(path, path.endsWith(".json") ? "{}" : 'import "./setup-helper.js"; export const setup = 2;');
    const head = commit();

    expect(createAffectedTestsPlanner(root)(base, head)).toEqual({
      core: true,
      shardCount: 1,
      shards: [["tests/portable.integration.test.ts"]],
    });
  });

  it("keeps surviving importers of a deleted module and skips the deleted test", () => {
    const { root, git, write, commit } = fixture();
    write("src/removed.ts", "export const value = 1;");
    write("tests/surviving.integration.test.ts", 'import "../src/removed.js";');
    write("tests/removed.integration.test.ts", 'import "../src/removed.js";');
    const base = commit();
    git("rm", "src/removed.ts", "tests/removed.integration.test.ts");
    const head = commit();

    expect(createAffectedTestsPlanner(root)(base, head)).toEqual({
      core: false,
      shardCount: 1,
      shards: [["tests/surviving.integration.test.ts"]],
    });
  });

  it("selects a changed integration test with no imports", () => {
    const { root, write, commit } = fixture();
    write("tests/changed.integration.test.ts", "");
    const base = commit();
    write("tests/changed.integration.test.ts", "export const fixture = 1;");
    const head = commit();

    expect(createAffectedTestsPlanner(root)(base, base)).toEqual({ core: false, shardCount: 0, shards: [] });
    expect(createAffectedTestsPlanner(root)(base, head).shards).toEqual([["tests/changed.integration.test.ts"]]);
  });
});
