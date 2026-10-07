import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../support/helpers/guard-files.js";

/**
 * Gate-coverage guard, re-derived for this repository (D93, ref guards-and-tests §5 #6/#8).
 *
 * The legacy original exists because the dashboard spent months excluded from
 * every type gate: the root tsconfig excluded it and `typecheck:all` was
 * byte-identical to `typecheck`, so the "full" gate never checked the frontend
 * (100 errors accumulated invisibly while Vite's type-blind build stayed
 * green). Same story for lint: warnings were reported but never failed, so 375
 * piled up. The lesson is not about the dashboard — it is that a gate whose
 * SCOPE nobody pins will quietly stop covering things.
 *
 * This repo has one tsc program and no debt manifest, so the shape it must pin
 * is different from the legacy one: every authored root is inside the type
 * program AND the lint command AND the typed ESLint config, warnings are fatal,
 * and the coverage lane is registered. The `*:rebuild` script names retire with
 * D93 — the plain family IS the gate family here.
 */

const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};
const eslintConfig = readFileSync(join(REPO_ROOT, "eslint.config.js"), "utf8");
const tsconfig = JSON.parse(readFileSync(join(REPO_ROOT, "tsconfig.json"), "utf8")) as {
  include: string[];
  exclude?: string[];
};

/** Every root this repo authors code in. Adding one means gating it. */
const AUTHORED_ROOTS = ["src", "tests", "scripts"] as const;
/** The approved root TS inputs in the sole tsconfig program. */
const EXPECTED_ROOT_TYPESCRIPT_CONFIG_FILES = [
  "vitest.config.ts",
  "vite.dashboard.config.ts",
] as const;

/** Root TS inputs are explicit tsconfig entries, never a broad lint glob. */
const rootTypeScriptConfigFiles = tsconfig.include
  .filter((pattern) => !pattern.includes("/") && pattern.endsWith(".ts"))
  .toSorted();

const EXACT_GATE_COMMANDS = {
  typecheck: "tsc --noEmit",
  lint: "eslint src tests scripts vitest.config.ts vite.dashboard.config.ts --max-warnings 0",
  test: "tsx scripts/test/runner.ts run",
  "test:coverage": "tsx scripts/test/runner.ts run --coverage && tsx scripts/test/suite-size.ts",
} as const;

export function gateCommandViolations(scripts: Readonly<Record<string, string>>): string[] {
  return Object.entries(EXACT_GATE_COMMANDS).flatMap(([name, expected]) =>
    scripts[name] === expected
      ? []
      : [`${name} must be exactly '${expected}'; found '${scripts[name] ?? "<missing>"}'`]
  );
}

describe("gate coverage", () => {
  it("rejects inert wrappers around every per-commit gate", () => {
    assert.deepEqual(gateCommandViolations(pkg.scripts), []);
    for (const [name, command] of [
      ["typecheck", "echo tsc --noEmit"],
      ["lint", `echo ${EXACT_GATE_COMMANDS.lint}`],
      ["test", "true && vitest run"],
      ["test:coverage", "vitest run --coverage && echo tsx scripts/test/suite-size.ts"],
    ] as const) {
      const mutated = { ...pkg.scripts, [name]: command };
      assert.match(gateCommandViolations(mutated).join("\n"), new RegExp(`^${name.replace(":", "\\:")}`));
    }
  });

  it("keeps every authored root inside the single type program", () => {
    for (const root of AUTHORED_ROOTS) {
      assert.ok(
        tsconfig.include.some((pattern) => pattern === `${root}/**/*`),
        `tsconfig include must carry ${root}/**/* — an un-included root is un-typechecked`,
      );
    }
    // The legacy repo needed `typecheck:all` because it had TWO programs and
    // the composite gate silently dropped one. One program, one gate here — so
    // a resurrected `typecheck:all` would mean a second program appeared
    // without this guard being told about it.
    assert.equal(pkg.scripts["typecheck:all"], undefined,
      "a second tsc program appeared; pin its composition here before adding the script");
    assert.equal(tsconfig.exclude, undefined,
      "tsconfig exclude re-appeared; an excluded authored root is exactly the legacy dashboard bug");
  });

  it("lints every authored root and fails on warnings", () => {
    const lint = pkg.scripts.lint ?? "";
    assert.match(lint, /--max-warnings 0/,
      "npm run lint must carry --max-warnings 0; without it new warnings accumulate invisibly");
    for (const root of AUTHORED_ROOTS) {
      assert.match(lint, new RegExp(`(^|\\s)${root}(\\s|$)`), `lint must target ${root}`);
    }
    assert.doesNotMatch(
      Object.values(pkg.scripts).join("\n"),
      /--no-error-on-unmatched-pattern/,
      "an unmatched lint pattern must fail, never silently lint nothing",
    );
  });

  it("lints every root TypeScript config the type program includes", () => {
    const lint = pkg.scripts.lint ?? "";
    assert.deepEqual(
      rootTypeScriptConfigFiles,
      [...EXPECTED_ROOT_TYPESCRIPT_CONFIG_FILES].toSorted(),
      "root TypeScript entries in tsconfig must remain the approved exact set; a new typechecked root config requires deliberate lint coverage",
    );
    for (const configFile of rootTypeScriptConfigFiles) {
      assert.match(
        lint,
        new RegExp(`(^|\\s)${configFile.replace(/\./g, "\\.")}(\\s|$)`),
        `lint must target ${configFile}; otherwise a root config is typechecked but escapes lint`,
      );
      assert.match(
        eslintConfig,
        new RegExp(`files:\\s*\\[[^\\]]*"${configFile.replace(/\./g, "\\.")}"`),
        `the typed ESLint config must explicitly cover ${configFile}; a command target without a strict block passes vacuously`,
      );
    }
  });

  it("keeps the typed ESLint config covering the same roots the CLI targets", () => {
    // CLI target and typed rule block must BOTH cover a root: linting a file
    // with no matching typed block reports nothing and passes vacuously.
    assert.match(eslintConfig, /files:\s*\["src\/\*\*\/\*\.ts"\]/);
    assert.match(eslintConfig, /files:\s*\["scripts\/\*\*\/\*\.ts"\]/);
    assert.match(eslintConfig, /files:\s*\["tests\/\*\*\/\*\.ts",\s*"tests\/\*\*\/\*\.tsx"\]/);
    assert.match(eslintConfig, /src\/dashboard\/\*\*\/\*\.tsx/);
    assert.match(eslintConfig, /recommendedTypeChecked/);
  });

  it("carries no legacy debt-manifest escape hatch", () => {
    // D93 §1.1: this tree is zero-debt from its first file. The legacy repo
    // keeps the fingerprint ratchet; a copy appearing HERE would mean debt was
    // imported along with the code.
    const scripts = Object.keys(pkg.scripts).join("\n");
    assert.doesNotMatch(scripts, /legacy-tests-ratchet/);
    assert.doesNotMatch(scripts, /:rebuild/, "the *:rebuild script names retire with D93");
  });

});
