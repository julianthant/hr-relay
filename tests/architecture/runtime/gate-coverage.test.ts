import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import oxlintConfig from "../../../.oxlintrc.json" with { type: "json" };
import { gitVisibleFiles, repoRelative, REPO_ROOT } from "../support/helpers/guard-files.js";

const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};
const tsconfig = JSON.parse(readFileSync(join(REPO_ROOT, "tsconfig.json"), "utf8")) as {
  include: string[];
  exclude?: string[];
};

/** Every root this repo authors code in. Adding one means gating it. */
const AUTHORED_ROOTS = ["src", "tests", "scripts"] as const;
const LINT_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"]);
/** The approved root TS inputs in the sole tsconfig program. */
const EXPECTED_ROOT_TYPESCRIPT_CONFIG_FILES = [
  "vitest.config.ts",
  "vite.dashboard.config.ts",
  "vite.mocks.config.ts",
] as const;

/** Root TS inputs are explicit tsconfig entries, never a broad lint glob. */
const rootTypeScriptConfigFiles = tsconfig.include
  .filter((pattern) => !pattern.includes("/") && pattern.endsWith(".ts"))
  .toSorted();

const EXACT_GATE_COMMANDS = {
  typecheck: "node node_modules/@typescript/native/bin/tsc --noEmit",
  lint: "oxlint --type-aware --max-warnings 0 src scripts tests vitest.config.ts vite.dashboard.config.ts vite.mocks.config.ts",
  test: "vitest run --project unit --project integration --project architecture --project perf",
  "test:coverage": "vitest run --coverage --project unit --project integration --project architecture",
  "test:perf": "vitest run --project perf --passWithNoTests=false",
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
      ["typecheck", `echo ${EXACT_GATE_COMMANDS.typecheck}`],
      ["lint", `echo ${EXACT_GATE_COMMANDS.lint}`],
      ["test", "true && vitest run"],
      ["test:coverage", `${EXACT_GATE_COMMANDS["test:coverage"]} && echo bypass`],
      ["test:perf", "vitest run --project perf --passWithNoTests=false && echo bypass"],
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

  it("selects every authored lint input, including the root TypeScript configs", () => {
    assert.deepEqual(
      rootTypeScriptConfigFiles,
      [...EXPECTED_ROOT_TYPESCRIPT_CONFIG_FILES].toSorted(),
      "a new typechecked root config requires deliberate lint coverage",
    );
    assert.doesNotMatch(Object.values(pkg.scripts).join("\n"), /--no-error-on-unmatched-pattern/);

    const args = EXACT_GATE_COMMANDS.lint.split(" ").slice(1);
    const actual = execFileSync(process.execPath, [
      join(REPO_ROOT, "node_modules/oxlint/bin/oxlint"), ...args, "--debug", "files",
    ], { cwd: REPO_ROOT, encoding: "utf8" }).trimEnd().split(/\r?\n/u)
      .map((file) => repoRelative(resolve(REPO_ROOT, file)));
    const authored = gitVisibleFiles(AUTHORED_ROOTS).filter((file) => LINT_EXTENSIONS.has(extname(file)));
    assert.deepEqual(actual.toSorted(), [...authored, ...rootTypeScriptConfigFiles].toSorted());
  });

  it("keeps typed rules, globals, and unused bindings scoped", () => {
    const [plainJs, typed, tuned, node, dashboard, tests] = oxlintConfig.overrides;
    assert.ok(plainJs && typed && tuned && node && dashboard && tests);
    assert.deepEqual(plainJs.files, ["**/*.{js,cjs,mjs}"]);
    assert.equal(plainJs.rules["no-undef"], "error");
    assert.ok(!("typescript/no-floating-promises" in plainJs.rules));
    assert.equal(oxlintConfig.rules["no-useless-assignment"], "error");
    assert.deepEqual(typed.files, ["**/*.{ts,tsx,mts,cts}"]);
    assert.equal(typed.rules["typescript/no-floating-promises"], "error");
    assert.deepEqual(tuned.files.toSorted(), [
      "src/**/*.ts", "src/dashboard/**/*.tsx", "scripts/**/*.ts", "tests/**/*.{ts,tsx}",
      ...rootTypeScriptConfigFiles,
    ].toSorted());
    assert.deepEqual(node.files.toSorted(), ["src/**/*.ts", "scripts/**/*.ts", ...rootTypeScriptConfigFiles].toSorted());
    assert.deepEqual(node.env, { node: true });
    assert.deepEqual(node.excludeFiles, ["src/dashboard/**"]);
    assert.deepEqual(dashboard.files, ["src/dashboard/**/*.{ts,tsx}"]);
    assert.deepEqual(dashboard.env, { browser: true });
    assert.equal(dashboard.rules["react/rules-of-hooks"], "error");
    assert.equal(dashboard.rules["react/exhaustive-deps"], "error");
    assert.deepEqual(tests.files, ["tests/**/*.{ts,tsx}"]);
    assert.deepEqual(tests.env, { node: true });
    for (const [override, severity, args] of [
      [node, "warn", "all"], [dashboard, "warn", "all"], [tests, "error", "after-used"],
    ] as const) {
      assert.deepEqual(override.rules["no-unused-vars"], [
        severity, { vars: "all", args, caughtErrors: "all", reportVarsOnlyUsedAsTypes: true,
          varsIgnorePattern: "^_", argsIgnorePattern: "^_" },
      ]);
    }
    assert.equal(oxlintConfig.options.reportUnusedDisableDirectives, "warn");
    assert.equal(oxlintConfig.rules["no-debugger"], "error");
  });

  it("carries no legacy debt-manifest escape hatch", () => {

    const scripts = Object.keys(pkg.scripts).join("\n");
    assert.doesNotMatch(scripts, /legacy-tests-ratchet/);
    assert.doesNotMatch(scripts, /:rebuild/, "the gate family uses plain script names");
  });

});
