import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../support/helpers/guard-files.js";



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
  "vite.parity.config.ts",
] as const;

/** Root TS inputs are explicit tsconfig entries, never a broad lint glob. */
const rootTypeScriptConfigFiles = tsconfig.include
  .filter((pattern) => !pattern.includes("/") && pattern.endsWith(".ts"))
  .toSorted();

const EXACT_GATE_COMMANDS = {
  typecheck: "tsc --noEmit",
  lint: "node --max-old-space-size=6144 node_modules/eslint/bin/eslint.js --cache --cache-strategy content --cache-location node_modules/.cache/eslint/ src tests scripts vitest.config.ts vite.dashboard.config.ts vite.parity.config.ts --max-warnings 0",
  test: "tsx scripts/test/runner.ts run",
  "test:coverage": "tsx scripts/test/runner.ts run --coverage --project unit --project integration --project architecture && tsx scripts/test/suite-size.ts",
  "test:perf": "tsx scripts/test/runner.ts run --project perf --passWithNoTests=false",
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
      ["test:perf", "tsx scripts/test/runner.ts run --project perf --passWithNoTests=false && echo bypass"],
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

    const scripts = Object.keys(pkg.scripts).join("\n");
    assert.doesNotMatch(scripts, /legacy-tests-ratchet/);
    assert.doesNotMatch(scripts, /:rebuild/, "the gate family uses plain script names");
  });

});
