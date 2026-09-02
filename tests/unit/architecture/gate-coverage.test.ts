import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./helpers/guard-files.js";

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
/** Root TS configs included by the sole tsconfig program require the same lint gate. */
const ROOT_TYPESCRIPT_CONFIG_FILES = [
  "vitest.config.ts",
  "vite.dashboard.config.ts",
  "playwright.parity.config.ts",
] as const;

describe("gate coverage", () => {
  it("keeps every authored root inside the single type program", () => {
    for (const root of AUTHORED_ROOTS) {
      assert.ok(
        tsconfig.include.some((pattern) => pattern === `${root}/**/*`),
        `tsconfig include must carry ${root}/**/* — an un-included root is un-typechecked`,
      );
    }
    assert.match(pkg.scripts.typecheck ?? "", /tsc --noEmit/);
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
    for (const configFile of ROOT_TYPESCRIPT_CONFIG_FILES) {
      assert.ok(
        tsconfig.include.includes(configFile),
        `tsconfig must include ${configFile}; this gate only names root configs the type program owns`,
      );
      assert.match(
        lint,
        new RegExp(`(^|\\s)${configFile.replace(/\\./g, "\\\\.")}(\\s|$)`),
        `lint must target ${configFile}; otherwise a root config is typechecked but escapes lint`,
      );
      assert.match(
        eslintConfig,
        new RegExp(`files:\\s*\\[[^\\]]*"${configFile.replace(/\\./g, "\\\\.")}"`),
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

  it("keeps the architecture and coverage lanes registered", () => {
    assert.equal(
      pkg.scripts["test:architecture"],
      "vitest run --project architecture --reporter=dot",
      "the architecture lane must stay addressable by its exact project name",
    );
    assert.match(pkg.scripts["test:coverage"] ?? "", /--coverage/);
    assert.match(pkg.scripts["test:coverage"] ?? "", /suite-size\.ts/);
    assert.match(pkg.scripts.test ?? "", /vitest run/);
  });
});
