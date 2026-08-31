import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { CONFIG_ENV_BINDINGS } from "../../../src/domain/config/resolve.js";
import {
  ACTIVITY_PERSON_PSEUDONYM_SECRET_REFERENCE,
  SECRET_FAMILY_SPECS,
  SECRET_SPECS,
  TEST_TARGET_SECRET_SPECS,
} from "../../../src/domain/secrets.js";
import {
  ENVIRONMENT_SOURCE_EXTENSIONS,
  inventoryEnvironmentAccesses,
  type EnvironmentAccessOccurrence,
} from "./helpers/environment-read-audit.js";
import {
  auditCountAllowlist,
  gitVisibleFiles,
  REPO_ROOT,
  type CountAllowlist,
} from "./helpers/guard-files.js";
import {
  auditSoleRunnerInvocation,
  packageDeclaredExternalProductionSources,
} from "./helpers/runner-invocation-audit.js";

/**
 * Guard (roadmap §Phases at a glance · ref clock-config-secrets §5): the rebuild runtime reads `process.env` through
 * ONE owner.
 *
 * Doc 01 §Phase summary's critical-path justification is explicit — "building 01+ on raw
 * `new Date()`/`process.env` would require re-threading later; the
 * `clock-single-source` and `secrets-single-source` guards must be green from
 * the first `src` file." A second credential reader is not a style
 * problem: it is a value that never passes through `domain/secrets.ts`'s
 * classification, so ref clock-config-secrets's redaction contract cannot see it and it reaches
 * a log, an evidence record, or a diagnostic bundle unredacted.
 *
 * The rule, per ref clock-config-secrets §5:
 *
 * - `src/domain/secrets.ts` is the sole *credential* reader. Every other
 *   consumer receives an already-resolved value.
 * - `src/domain/config/**` may read the environment, because the config
 *   resolver's `env > settings.json > default` precedence is a distinct
 *   concern from secret values — but ONLY for keys the config binding table
 *   owns. A config-owned read of a `SECRET_SPECS` / `SECRET_FAMILY_SPECS` key
 *   is the exact confusion this guard exists to reject, so membership (not
 *   directory) decides.
 * - Everywhere else in `src/**`, ANY environment access fails —
 *   read, write, or delete; exact, computed, or bulk.
 *
 * Today `src/domain/config/resolve.ts` takes `env: NodeJS.ProcessEnv` as
 * an injected parameter and reads nothing itself, so the tree is stricter than
 * the contract requires. The allowlist below is the shrink-only ported-leaf
 * escape hatch the other ratchets use and is deliberately EMPTY: new
 * `src` code gets zero tolerance (ref clock-config-secrets §2).
 */

const SECRET_OWNER = "src/domain/secrets.ts";
const CONFIG_OWNER_PREFIX = "src/domain/config/";

/** file (relative to repo root) -> { count, reason }; empty = no ported leaf owes an exception. */
const ALLOWLIST: CountAllowlist = {};

const CREDENTIAL_KEYS: ReadonlySet<string> = new Set(
  [
    ...SECRET_SPECS.filter((spec) => spec.source === "environment").map((spec) => spec.env),
    ...TEST_TARGET_SECRET_SPECS.map((spec) => spec.env),
    ACTIVITY_PERSON_PSEUDONYM_SECRET_REFERENCE.key.env,
  ],
);
const CREDENTIAL_FAMILIES: readonly { readonly prefix: string; readonly maximum: number }[] =
  SECRET_FAMILY_SPECS.map(({ envPrefix, maximum }) => ({ prefix: envPrefix, maximum }));
const CONFIG_KEYS: ReadonlySet<string> = new Set(CONFIG_ENV_BINDINGS.map(({ env }) => env));

function isCredentialKey(key: string): boolean {
  if (CREDENTIAL_KEYS.has(key)) return true;
  return CREDENTIAL_FAMILIES.some(({ prefix, maximum }) => {
    if (key === prefix) return true;
    const suffix = key.slice(prefix.length);
    return key.startsWith(prefix) && /^\d+$/.test(suffix)
      && Number(suffix) >= 2 && Number(suffix) <= maximum;
  });
}

/**
 * Classifies one environment access against the single-source rule. Exported so
 * the negative controls below can exercise it on synthetic sources rather than
 * only on a tree that happens to be clean today.
 */
export function auditSecretsSingleSource(
  occurrences: readonly EnvironmentAccessOccurrence[],
): readonly string[] {
  const violations: string[] = [];
  for (const occurrence of occurrences) {
    const where = `${occurrence.path}:${String(occurrence.line)}:${String(occurrence.column)}`;
    if (occurrence.path === SECRET_OWNER) continue;
    if (!occurrence.path.startsWith(CONFIG_OWNER_PREFIX)) {
      violations.push(
        `${where}: environment ${occurrence.operation} in ${occurrence.enclosingSymbol} — only ${SECRET_OWNER} and ${CONFIG_OWNER_PREFIX}** may touch process.env`,
      );
      continue;
    }
    if (occurrence.operation !== "read") {
      violations.push(`${where}: config owner may only read the environment, never ${occurrence.operation} it`);
      continue;
    }
    if (occurrence.accessKind !== "exact" || occurrence.key === undefined) {
      violations.push(
        `${where}: config owner environment access is ${occurrence.accessKind}; only statically resolved keys are reviewable`,
      );
      continue;
    }
    if (isCredentialKey(occurrence.key)) {
      violations.push(`${where}: ${occurrence.key} is a credential key and belongs to ${SECRET_OWNER}, not the config resolver`);
      continue;
    }
    if (!CONFIG_KEYS.has(occurrence.key)) {
      violations.push(`${where}: ${occurrence.key} has no CONFIG_ENV_BINDINGS entry`);
    }
  }
  return violations;
}

function rebuildOccurrences(): readonly EnvironmentAccessOccurrence[] {
  return gitVisibleFiles(["src"])
    .filter((path) => ENVIRONMENT_SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension)))
    .flatMap((path) => inventoryEnvironmentAccesses(path, readFileSync(join(REPO_ROOT, path), "utf8")));
}

function runnerInvocationProductionSources(): readonly { readonly path: string; readonly content: string }[] {
  const rooted = gitVisibleFiles(["src", "scripts"])
    .filter((path) => ENVIRONMENT_SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension)));
  const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
    readonly scripts?: Record<string, string>;
  };
  if (packageJson.scripts === undefined) throw new Error("package.json has no scripts map");
  return [
    ...rooted.map((path) => ({ path, content: readFileSync(join(REPO_ROOT, path), "utf8") })),
    ...packageDeclaredExternalProductionSources(
      packageJson.scripts,
      (path) => readFileSync(join(REPO_ROOT, path), "utf8"),
    ),
  ];
}

describe("secrets single source", () => {
  it("admits the fixed local environment before importing either allowlisted runtime", () => {
    const cli = readFileSync(join(REPO_ROOT, "src/cli.ts"), "utf8");
    const smoke = readFileSync(join(REPO_ROOT, "scripts/smoke-test-target-person-secrets.ts"), "utf8");
    assert.equal(cli.includes("assertLocalEnvironmentFile"), false);
    assert.equal(smoke.includes("assertLocalEnvironmentFile"), false);
    assert.equal(cli.includes("process.argv[1]"), false);
    assert.equal(smoke.includes("process.argv[1]"), false);

    assert.deepEqual(auditSoleRunnerInvocation(runnerInvocationProductionSources()), []);
  });

  it("rejects every AST-level attempt to invoke or relay an admitted runner", () => {
    const violations = [
      'import { runCli as start } from "../cli.js"; start();',
      'import { runCli } from "../cli.js"; runCli ( );',
      'import * as runtime from "../cli.js"; runtime.runCli();',
      'void (await import("../cli.js")).runCli();',
      'void import("../cli.js").then(({ runCli }) => runCli());',
      'const root = "../"; const specifier = root + "cli.js"; void (await import(specifier)).runCli();',
      'declare const atRuntime: string; void (await import(atRuntime)).runCli();',
      'import { runCli } from "../cli.js"; runCli.call(undefined);',
      'import { runCli } from "../cli.js"; runCli.apply(undefined, []);',
      'import { runCli } from "../cli.js"; runCli.bind(undefined)();',
      'export { runCli as start } from "../cli.js";',
      'import { runCli } from "../cli.js"; const invoke = runCli; invoke();',
    ].map((content, index) => auditSoleRunnerInvocation([
      { path: "src/core/bypass.ts", content },
      { path: "src/cli.ts", content: "export function runCli(): void {}" },
      {
        path: "scripts/smoke-test-target-person-secrets.ts",
        content: "export async function runTestTargetPersonSecretsSmoke(): Promise<number> { return 0; }",
      },
    ]).join("\n") || `fixture ${String(index + 1)} was accepted`);

    for (const violation of violations) {
      assert.match(violation, /secure-env-bootstrap\.ts|runner|dynamic import specifier/u);
      assert.equal(violation.includes("was accepted"), false, violation);
    }
  });

  it("counts runner invocations recovered from object and array payloads inside the bootstrap", () => {
    for (const packedInvocation of [
      "const payload = { runCli: cli.runCli }; payload.runCli();",
      "const payload = [cli.runCli]; payload[0]();",
    ]) {
      const bootstrap = [
        'import { admitLocalEnvironmentFile } from "../src/domain/secrets.js";',
        "declare function repositoryEnvironmentFilePath(): string;",
        "export async function main(): Promise<void> {",
        "  const path = repositoryEnvironmentFilePath();",
        "  admitLocalEnvironmentFile(path);",
        '  const cli = await import("../src/cli.js");',
        "  await cli.runCli();",
        `  ${packedInvocation}`,
        '  const smoke = await import("./smoke-test-target-person-secrets.js");',
        "  await smoke.runTestTargetPersonSecretsSmoke();",
        "}",
      ].join("\n");
      assert.match(
        auditSoleRunnerInvocation([
          { path: "scripts/secure-env-bootstrap.ts", content: bootstrap },
          { path: "src/cli.ts", content: "export function runCli(): void {}" },
          {
            path: "scripts/smoke-test-target-person-secrets.ts",
            content: "export async function runTestTargetPersonSecretsSmoke(): Promise<number> { return 0; }",
          },
          {
            path: "src/domain/secrets.ts",
            content: "export function admitLocalEnvironmentFile(path: string): void { void path; }",
          },
        ]).join("\n"),
        /runCli must have one canonical dynamic import and one direct invocation/u,
        packedInvocation,
      );
    }
  });

  it("counts runner invocations recovered after object and array destructuring", () => {
    for (const packedInvocation of [
      "const payload = { invoke: cli.runCli }; const { invoke } = payload; invoke();",
      "const payload = [cli.runCli]; const [invoke] = payload; invoke();",
      "const runtimeKey = String(Date.now()); const payload = { [runtimeKey]: cli.runCli }; const { invoke } = payload; invoke();",
    ]) {
      const bootstrap = [
        'import { admitLocalEnvironmentFile } from "../src/domain/secrets.js";',
        "declare function repositoryEnvironmentFilePath(): string;",
        "export async function main(): Promise<void> {",
        "  const path = repositoryEnvironmentFilePath();",
        "  admitLocalEnvironmentFile(path);",
        '  const cli = await import("../src/cli.js");',
        "  await cli.runCli();",
        `  ${packedInvocation}`,
        '  const smoke = await import("./smoke-test-target-person-secrets.js");',
        "  await smoke.runTestTargetPersonSecretsSmoke();",
        "}",
      ].join("\n");
      assert.match(
        auditSoleRunnerInvocation([
          { path: "scripts/secure-env-bootstrap.ts", content: bootstrap },
          { path: "src/cli.ts", content: "export function runCli(): void {}" },
          {
            path: "scripts/smoke-test-target-person-secrets.ts",
            content: "export async function runTestTargetPersonSecretsSmoke(): Promise<number> { return 0; }",
          },
          {
            path: "src/domain/secrets.ts",
            content: "export function admitLocalEnvironmentFile(path: string): void { void path; }",
          },
        ]).join("\n"),
        /runCli must have one canonical dynamic import and one direct invocation/u,
        packedInvocation,
      );
    }
  });

  it("derives every declared external Vite config from package scripts and pins the current boundary", () => {
    const sources = runnerInvocationProductionSources();
    assert.deepEqual(
      sources.filter(({ path }) => !path.startsWith("src/") && !path.startsWith("scripts/"))
        .map(({ path }) => path),
      ["vite.dashboard.config.ts"],
    );
  });

  it("includes each package-declared Vite config outside src/scripts in runner admission enforcement", () => {
    const sources = [
      {
        path: "vite.dashboard.config.ts",
        content: 'void (await import("./src/cli.js")).runCli();',
      },
      { path: "src/cli.ts", content: "export function runCli(): void {}" },
      {
        path: "scripts/smoke-test-target-person-secrets.ts",
        content: "export async function runTestTargetPersonSecretsSmoke(): Promise<number> { return 0; }",
      },
    ];
    assert.match(
      auditSoleRunnerInvocation(sources).join("\n"),
      /vite\.dashboard\.config\.ts:1: admitted runner is reachable outside scripts\/secure-env-bootstrap\.ts/u,
    );
  });

  it("scans the static local import and re-export closure of each external Vite config", () => {
    const files: Readonly<Record<string, string>> = {
      "vite.dashboard.config.ts": [
        'import { defineConfig } from "vite";',
        'import { config } from "./vite-support/config-helper.js";',
        "export default defineConfig(config);",
      ].join("\n"),
      "vite-support/config-helper.ts": [
        'export { config } from "./nested-config.js";',
      ].join("\n"),
      "vite-support/nested-config.ts": [
        'import { runCli } from "../src/cli.js";',
        "export const config = runCli();",
      ].join("\n"),
      "src/cli.ts": "export function runCli(): void {}",
    };
    const reads: string[] = [];
    const sources = packageDeclaredExternalProductionSources(
      { web: "vite --config vite.dashboard.config.ts" },
      (path) => {
        reads.push(path);
        const content = files[path];
        if (content === undefined) throw new Error("ENOENT");
        return content;
      },
    );

    assert.deepEqual(
      sources.map(({ path }) => path),
      [
        "vite.dashboard.config.ts",
        "vite-support/config-helper.ts",
        "vite-support/nested-config.ts",
        "src/cli.ts",
      ],
    );
    assert.equal(reads.includes("vite"), false, "package dependencies are intentionally outside the local closure");
    assert.match(
      auditSoleRunnerInvocation(sources).join("\n"),
      /vite-support\/nested-config\.ts:1: admitted runner is reachable outside scripts\/secure-env-bootstrap\.ts/u,
    );
  });

  it("scans CommonJS and TypeScript import-equals requires from cts Vite configs", () => {
    const files: Readonly<Record<string, string>> = {
      "vite.dashboard.config.cts": [
        'import helper = require("./vite-support/config-helper.cjs");',
        "export = helper;",
      ].join("\n"),
      "vite-support/config-helper.cts": [
        'const nested = require("./nested-config.cjs");',
        "export = nested;",
      ].join("\n"),
      "vite-support/nested-config.cts": [
        'import { runCli } from "../src/cli.js";',
        "export const config = runCli();",
      ].join("\n"),
      "src/cli.ts": "export function runCli(): void {}",
    };
    const sources = packageDeclaredExternalProductionSources(
      { web: "vite --config vite.dashboard.config.cts" },
      (path) => {
        const content = files[path];
        if (content === undefined) throw new Error("ENOENT");
        return content;
      },
    );

    assert.deepEqual(
      sources.map(({ path }) => path),
      [
        "vite.dashboard.config.cts",
        "vite-support/config-helper.cts",
        "vite-support/nested-config.cts",
        "src/cli.ts",
      ],
    );
    assert.match(
      auditSoleRunnerInvocation(sources).join("\n"),
      /vite-support\/nested-config\.cts:1: admitted runner is reachable outside scripts\/secure-env-bootstrap\.ts/u,
    );
  });

  it("admits a path-invoked Vite binary as the package script executable", () => {
    const sources = packageDeclaredExternalProductionSources(
      { web: "./node_modules/.bin/vite --config vite.dashboard.config.ts" },
      (path) => {
        if (path === "vite.dashboard.config.ts") return "export default {};";
        throw new Error("ENOENT");
      },
    );

    assert.deepEqual(sources.map(({ path }) => path), ["vite.dashboard.config.ts"]);
  });

  it("refuses package scripts with unresolved executable config paths", () => {
    assert.throws(
      () => packageDeclaredExternalProductionSources(
        { web: "vite --config missing.dashboard.config.ts" },
        () => { throw new Error("ENOENT"); },
      ),
      /package-declared executable source missing\.dashboard\.config\.ts could not be read: ENOENT/u,
    );
    assert.throws(
      () => packageDeclaredExternalProductionSources(
        { web: "vite --config $VITE_CONFIG" },
        () => "",
      ),
      /cannot statically resolve/u,
    );
  });

  it("refuses unresolved, escaping, and unbounded local config closures", () => {
    assert.throws(
      () => packageDeclaredExternalProductionSources(
        { web: "vite --config vite.dashboard.config.ts" },
        (path) => {
          if (path === "vite.dashboard.config.ts") return 'import "./missing-helper.js";';
          throw new Error("ENOENT");
        },
      ),
      /vite\.dashboard\.config\.ts has unresolved local import "\.\/missing-helper\.js"/u,
    );
    assert.throws(
      () => packageDeclaredExternalProductionSources(
        { web: "vite --config vite.dashboard.config.ts" },
        (path) => path === "vite.dashboard.config.ts" ? 'export * from "../outside.ts";' : "",
      ),
      /imports outside the repository/u,
    );
    assert.throws(
      () => packageDeclaredExternalProductionSources(
        { web: "vite --config module-0.ts" },
        (path) => {
          const match = /^module-(\d+)\.ts$/u.exec(path);
          if (match === null) throw new Error("ENOENT");
          const index = Number(match[1]);
          return index < 256 ? `import "./module-${String(index + 1)}.js";` : "export {};";
        },
      ),
      /exceeds 256 files/u,
    );
  });

  it("refuses executable shell segments chained after an admitted Vite command", () => {
    for (const command of [
      "vite --config vite.dashboard.config.ts && tsx scripts/bypass.ts",
      "vite --config vite.dashboard.config.ts ; tsx scripts/bypass.ts",
      "vite --config vite.dashboard.config.ts | tsx scripts/bypass.ts",
    ]) {
      assert.throws(
        () => packageDeclaredExternalProductionSources(
          { web: command },
          () => "export default {};",
        ),
        /executable shell chain/u,
        command,
      );
    }
  });

  it("ignores runner-shaped strings, comments, and type-only imports", () => {
    assert.deepEqual(auditSoleRunnerInvocation([
      {
        path: "src/core/harmless.ts",
        content: [
          'import type { CliShape } from "../cli.js";',
          'export const doc = "runCli();";',
          "// runTestTargetPersonSecretsSmoke.call(undefined)",
        ].join("\n"),
      },
      { path: "src/cli.ts", content: "export interface CliShape {}\nexport function runCli(): void {}" },
      {
        path: "scripts/smoke-test-target-person-secrets.ts",
        content: "export async function runTestTargetPersonSecretsSmoke(): Promise<number> { return 0; }",
      },
    ]), []);
  });

  it("scans a non-vacuous rebuild tree and finds the owner actually reading the environment", () => {
    const files = gitVisibleFiles(["src"])
      .filter((path) => ENVIRONMENT_SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension)));
    assert.equal(files.length > 0, true, "src resolved zero scannable source files");
    assert.equal(files.includes(SECRET_OWNER), true, `${SECRET_OWNER} is missing from the scan set`);

    // Non-vacuity for the SCANNER, not just the tree: if the AST walker silently
    // stopped resolving `process.env`, an all-clean result would be a false pass.
    const owner = rebuildOccurrences().filter(({ path }) => path === SECRET_OWNER);
    assert.equal(owner.length > 0, true, `${SECRET_OWNER} reads no environment; the access scanner is not resolving reads`);
  });

  it("keeps every rebuild environment access inside its declared owner", () => {
    assert.deepEqual(auditSecretsSingleSource(rebuildOccurrences()), []);
  });

  it("keeps the ported-leaf allowlist shrink-only and non-stale", () => {
    const counts = new Map<string, number>();
    for (const { path } of rebuildOccurrences()) {
      if (path === SECRET_OWNER || path.startsWith(CONFIG_OWNER_PREFIX)) continue;
      counts.set(path, (counts.get(path) ?? 0) + 1);
    }
    assert.deepEqual(
      auditCountAllowlist(counts, ALLOWLIST, {
        unallowlisted: (file, count) => `${file}: ${String(count)} unallowlisted environment access(es); route them through ${SECRET_OWNER}.`,
        changed: (file, expected, actual) => `${file}: allowlisted ${String(expected)} environment access(es) but found ${String(actual)}.`,
        stale: (file, expected) => `${file}: allowlist claims ${String(expected)} environment access(es) but none remain; drop the entry.`,
      }),
      [],
    );
  });

  it("rejects direct, aliased, destructured, global, imported, and mutating access outside the owner", () => {
    const fixture = [
      'import proc, { env as importedEnv } from "node:process";',
      "const alias = process.env;",
      "const { UCPATH_PASSWORD } = process.env;",
      "const { ...rest } = process.env;",
      "export function leak(key: string) {",
      "  return [",
      "    process.env.UCPATH_PASSWORD,",
      "    alias.GEMINI_API_KEY,",
      "    importedEnv.TIMEKEEPER_NAME,",
      "    proc.env.ONBOARDING_ROSTER_URL,",
      "    globalThis.process.env.UCPATH_USER_ID,",
      "    process.env[key],",
      "    UCPATH_PASSWORD,",
      "    rest,",
      "  ];",
      "}",
      'process.env.HRAUTO_NAVIGATION_RETRIES = "3";',
      "delete process.env.TIMEKEEPER_NAME;",
    ].join("\n");
    const violations = auditSecretsSingleSource(
      inventoryEnvironmentAccesses("src/core/leak.ts", fixture),
    );
    // Two destructures (named + rest), six resolved/computed/aliased/imported
    // reads, one write, one delete. Pinned exactly so a scanner regression that
    // stops resolving one of these forms fails here instead of going quiet.
    assert.equal(violations.length, 10, violations.join("\n"));
    assert.equal(violations.every((violation) => violation.includes("only src/domain/secrets.ts")), true);
    assert.equal(violations.some((violation) => violation.includes("environment write")), true);
    assert.equal(violations.some((violation) => violation.includes("environment delete")), true);
  });

  it("rejects a credential key read from the config owner but accepts its own bound keys", () => {
    const credential = auditSecretsSingleSource(
      inventoryEnvironmentAccesses(
        "src/domain/config/resolve.ts",
        "export const leaked = process.env.UCPATH_PASSWORD;\nexport const pool = process.env.GEMINI_API_KEY2;\n",
      ),
    );
    assert.equal(credential.length, 2, credential.join("\n"));
    assert.equal(credential.every((violation) => violation.includes("belongs to src/domain/secrets.ts")), true);

    assert.deepEqual(
      auditSecretsSingleSource(inventoryEnvironmentAccesses(
        "src/domain/config/resolve.ts",
        "export const retries = process.env.HRAUTO_NAVIGATION_RETRIES;\n",
      )),
      [],
    );
    assert.equal(
      auditSecretsSingleSource(inventoryEnvironmentAccesses(
        "src/domain/config/resolve.ts",
        "export const unknownKey = process.env.HRAUTO_NOT_A_BINDING;\n",
      )).some((violation) => violation.includes("no CONFIG_ENV_BINDINGS entry")),
      true,
    );
    assert.equal(
      auditSecretsSingleSource(inventoryEnvironmentAccesses(
        "src/domain/config/instance.ts",
        "export const computed = (key: string) => process.env[key];\n",
      )).some((violation) => violation.includes("only statically resolved keys")),
      true,
    );
  });

  it("ignores shadowed bindings and source-shaped text", () => {
    assert.deepEqual(
      auditSecretsSingleSource(inventoryEnvironmentAccesses("src/core/shadow.ts", [
        "export function read(process: { env: Record<string, string> }) {",
        "  return process.env.UCPATH_PASSWORD;",
        "}",
        'export const doc = "process.env.UCPATH_PASSWORD"; // process.env.TIMEKEEPER_NAME',
      ].join("\n"))),
      [],
    );
  });
});
