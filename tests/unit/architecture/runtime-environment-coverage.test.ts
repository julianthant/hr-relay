import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "vitest";
import {
  auditRuntimeEnvironmentInventory,
  COMPUTED_ENVIRONMENT_READERS,
  EXACT_ENVIRONMENT_READER_OWNERS,
  isRegisteredEnvironmentKey,
  RUNTIME_ENVIRONMENT_EXACT,
  RUNTIME_ENVIRONMENT_FAMILIES,
  RUNTIME_ENVIRONMENT_REGISTRY,
  runtimeEnvironmentFamilyForKey,
} from "../../../src/domain/runtime-environment.js";
import {
  ENVIRONMENT_SOURCE_EXTENSIONS,
  inventoryEnvironmentAccesses,
  type EnvironmentAccessOccurrence,
} from "./helpers/environment-read-audit.js";
import {
  gitVisibleFiles,
  isLegacyPath,
  REPO_ROOT,
} from "./helpers/guard-files.js";

interface ExampleEnvironmentInventory {
  readonly keys: readonly string[];
  readonly violations: readonly string[];
}

/**
 * Every environment access in THIS repository.
 *
 * It scanned the legacy repo too until D150 (2026-08-06). That coupling had to
 * go for the same reason change accounting did: a new environment key added to
 * the PRODUCTION repo — `SHRED_AUDIT_WORKERS`, while this session was running —
 * turned a rebuild gate red for work that has nothing to do with the rebuild.
 * The two repositories touch each other in neither direction.
 *
 * The claim narrows honestly with the scan: this guard now says "every
 * environment read in the REBUILD is registered, owned and classified", which
 * is the part that governs what this runtime does. The `legacy:`-scheme entries
 * that remain in the inventory are a historical record of what legacy reads;
 * nothing verifies them, and nothing should extend them.
 */
function repositoryOccurrences(): readonly EnvironmentAccessOccurrence[] {
  const scannable = (path: string): boolean =>
    ENVIRONMENT_SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension));
  return gitVisibleFiles(["."])
    .filter(scannable)
    .flatMap((path) => inventoryEnvironmentAccesses(path, readFileSync(resolve(REPO_ROOT, path), "utf8")));
}

function parseExampleEnvironment(content: string): ExampleEnvironmentInventory {
  const keys: string[] = [];
  const violations: string[] = [];
  const assignment = /^\s*(?:#\s*)?(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(?:(?:"(?:[^"\\]|\\.)*")|(?:'(?:[^'\\]|\\.)*')|(?:[^#\r\n]*?))(?:\s+#.*)?\s*$/;
  const candidate = /^\s*(?:#\s*)?(?:export\s+)?[A-Z][A-Z0-9_]*\s*=/;

  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (!line.trim() || (/^\s*#/.test(line) && !candidate.test(line))) continue;
    const match = assignment.exec(line);
    if (!match) {
      if (candidate.test(line) || !/^\s*#/.test(line)) violations.push(`line ${index + 1}: malformed environment assignment`);
      continue;
    }
    keys.push(match[1]);
  }
  const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
  if (duplicates.length > 0) violations.push(`duplicate .env.example keys: ${[...new Set(duplicates)].join(", ")}`);
  return { keys, violations };
}

/** Test-lane paths on either side, which own their own environment reads. */
function isTestPath(path: string): boolean {
  return path.startsWith("tests/") || path.startsWith("legacy:tests/");
}

/** This repo's runtime — unprefixed, and never the legacy side's `src/`. */
function isRebuildRuntimePath(path: string): boolean {
  return path.startsWith("src/");
}

function computedIdentity(occurrence: Pick<EnvironmentAccessOccurrence,
  "path" | "enclosingSymbol" | "accessKind" | "operation" | "expressionFingerprint"
>): string {
  return [occurrence.path, occurrence.enclosingSymbol, occurrence.accessKind,
    occurrence.operation, occurrence.expressionFingerprint].join("|");
}

function aggregateComputed(occurrences: readonly EnvironmentAccessOccurrence[]) {
  const result = new Map<string, number>();
  for (const occurrence of occurrences) {
    if (occurrence.accessKind === "exact") continue;
    const identity = computedIdentity(occurrence);
    result.set(identity, (result.get(identity) ?? 0) + 1);
  }
  return result;
}

function auditOccurrences(occurrences: readonly EnvironmentAccessOccurrence[]): readonly string[] {
  const violations: string[] = [];
  const exactSpecs = new Map(RUNTIME_ENVIRONMENT_EXACT.map((spec) => [spec.key, spec]));
  const exactOwners = new Map(EXACT_ENVIRONMENT_READER_OWNERS.map((entry) => [entry.key, new Set(entry.paths)]));

  for (const occurrence of occurrences) {
    if (occurrence.accessKind !== "exact" || occurrence.key === undefined) continue;
    if (!isRegisteredEnvironmentKey(occurrence.key)) {
      violations.push(`${occurrence.path}:${occurrence.line}: unregistered environment key ${occurrence.key}`);
      continue;
    }
    if (occurrence.operation !== "read" || isTestPath(occurrence.path)) continue;

    const exact = exactSpecs.get(occurrence.key);
    if (exact) {
      if (exact.disposition === "test-only" && !exact.owners.includes(occurrence.path)) {
        violations.push(`${occurrence.path}: undeclared production owner for test-only key ${occurrence.key}`);
      }
      if (!exactOwners.get(occurrence.key)?.has(occurrence.path)) {
        violations.push(`${occurrence.path}: exact read of ${occurrence.key} is not pinned to its owner`);
      }
      if (isRebuildRuntimePath(occurrence.path) && exact.disposition === "retired-in-target") {
        violations.push(`${occurrence.path}: target runtime reads retired key ${occurrence.key}`);
      }
      continue;
    }

    const family = runtimeEnvironmentFamilyForKey(occurrence.key);
    if (!family?.owners.includes(occurrence.path)) {
      violations.push(`${occurrence.path}: exact family read of ${occurrence.key} is not pinned to its owner`);
    }
  }

  const actualExactReaders = new Map<string, Set<string>>();
  for (const occurrence of occurrences) {
    if (occurrence.accessKind !== "exact" || occurrence.operation !== "read"
      || occurrence.key === undefined || isTestPath(occurrence.path)) continue;
    const paths = actualExactReaders.get(occurrence.key) ?? new Set<string>();
    paths.add(occurrence.path);
    actualExactReaders.set(occurrence.key, paths);
  }
  for (const expected of EXACT_ENVIRONMENT_READER_OWNERS) {
    // Only this repo is scanned (D150), so only this repo's owners can be
    // checked. A `legacy:` owner is a historical record; comparing it against a
    // scan that never looks there would report drift on every one of them and
    // say nothing true about either repository.
    const expectedPaths = expected.paths.filter((path) => !isLegacyPath(path)).toSorted();
    if (expectedPaths.length === 0) continue;
    const actualPaths = [...(actualExactReaders.get(expected.key) ?? [])].sort();
    if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
      violations.push(`${expected.key} exact reader ownership drifted: expected ${expectedPaths.join(", ")}; actual ${actualPaths.join(", ")}`);
    }
  }
  const unexpectedExactOwnerKeys = [...actualExactReaders.keys()]
    .filter((key) => exactSpecs.has(key) && !exactOwners.has(key));
  if (unexpectedExactOwnerKeys.length > 0) {
    violations.push(`exact reader ownership is missing keys: ${unexpectedExactOwnerKeys.sort().join(", ")}`);
  }

  const productionComputed = occurrences.filter((occurrence) =>
    occurrence.accessKind !== "exact" && occurrence.operation === "read" && !isTestPath(occurrence.path)
  );
  const actualComputed = aggregateComputed(productionComputed);
  // Legacy computed readers are historical too (D150): only this repo is
  // scanned, so only this repo's registrations can be checked against it.
  const expectedComputed = new Map(COMPUTED_ENVIRONMENT_READERS
    .filter((reader) => !isLegacyPath(reader.path))
    .map((reader) => [computedIdentity(reader), reader.occurrenceCount]));
  for (const [identity, count] of actualComputed) {
    if (expectedComputed.get(identity) !== count) violations.push(`unregistered or changed computed reader ${identity} (${count})`);
  }
  for (const [identity, count] of expectedComputed) {
    if (actualComputed.get(identity) !== count) violations.push(`stale computed reader registration ${identity} (${count})`);
  }
  return violations;
}

describe("runtime environment inventory coverage", () => {
  it("strictly validates the closed registry and every repository occurrence", () => {
    assert.deepEqual(auditRuntimeEnvironmentInventory(RUNTIME_ENVIRONMENT_REGISTRY), []);
    assert.deepEqual(auditOccurrences(repositoryOccurrences()), []);
  });

  it("parses .env.example grammar without ever retaining values and pins documented exactness", () => {
    const actual = parseExampleEnvironment(readFileSync(resolve(REPO_ROOT, ".env.example"), "utf8"));
    assert.deepEqual(actual.violations, []);
    assert.deepEqual(
      [...actual.keys].sort(),
      RUNTIME_ENVIRONMENT_FAMILIES
        .filter(({ disposition }) => disposition === "active")
        .map(({ prefix }) => prefix)
        .sort(),
    );
    assert.deepEqual(parseExampleEnvironment([
      "export ALPHA = value # explanation",
      " # BRAVO='quoted empty is allowed'",
      "CHARLIE=\"value with # hash\"",
      "DELTA=",
      "# prose is ignored",
    ].join("\n")), { keys: ["ALPHA", "BRAVO", "CHARLIE", "DELTA"], violations: [] });
    assert.deepEqual(parseExampleEnvironment("ALPHA=x\nALPHA=y\nBROKEN KEY=x").violations, [
      "line 3: malformed environment assignment",
      "duplicate .env.example keys: ALPHA",
    ]);
  });

  it("resolves only the bare family key and numeric suffixes 2 through maximum", () => {
    for (const family of RUNTIME_ENVIRONMENT_FAMILIES) {
      assert.equal(isRegisteredEnvironmentKey(family.prefix), true);
      assert.equal(isRegisteredEnvironmentKey(`${family.prefix}0`), false);
      assert.equal(isRegisteredEnvironmentKey(`${family.prefix}1`), false);
      assert.equal(isRegisteredEnvironmentKey(`${family.prefix}2`), family.maximum >= 2);
      assert.equal(isRegisteredEnvironmentKey(`${family.prefix}${family.maximum}`), true);
      assert.equal(isRegisteredEnvironmentKey(`${family.prefix}${family.maximum + 1}`), false);
    }
  });

  it("recognizes aliases, imports, destructuring, computed keys, bulk reads, writes, and deletes", () => {
    const source = [
      'import proc, { env as importedEnv } from "node:process";',
      "const p = proc; const env = p[\"env\"];",
      "const STATIC = `UCPATH_${\"USER_ID\"}`;",
      "const PREFIX = \"TIMEKEEPER\"; const SUFFIX = \"NAME\";",
      "const a = process.env.UCPATH_PASSWORD;",
      "const b = process[\"env\"][STATIC];",
      "const c = globalThis.process.env[PREFIX + \"_\" + SUFFIX];",
      "const d = importedEnv.ONBOARDING_ROSTER_URL;",
      "const { DEBUG_SCREENSHOTS: shot } = env;",
      "const copy = { ...env }; Object.keys(env);",
      "env.ANNUAL_DATES_END = \"x\"; delete env.KRONOS_DEFAULT_END_DATE;",
      "function defaults(e = process.env) { return e.OCR_SECOND_OPINION_MAX; }",
      "function family(key: string) { return env[key]; }",
    ].join("\n");
    const occurrences = inventoryEnvironmentAccesses("fixture.ts", source);
    assert.deepEqual(
      occurrences.filter(({ accessKind }) => accessKind === "exact").map(({ key, operation }) => `${key}:${operation}`).sort(),
      [
        "ANNUAL_DATES_END:write", "DEBUG_SCREENSHOTS:read", "KRONOS_DEFAULT_END_DATE:delete",
        "OCR_SECOND_OPINION_MAX:read", "ONBOARDING_ROSTER_URL:read", "TIMEKEEPER_NAME:read",
        "UCPATH_PASSWORD:read", "UCPATH_USER_ID:read",
      ].sort(),
    );
    assert.equal(occurrences.filter(({ accessKind }) => accessKind === "bulk").length, 2);
    assert.equal(occurrences.filter(({ accessKind }) => accessKind === "unresolved").length, 1);
  });

  it("ignores shadowed globals and source-shaped strings, comments, and regular expressions", () => {
    const occurrences = inventoryEnvironmentAccesses("fixture.ts", [
      "// process.env.COMMENTED",
      "const text = 'process.env.IN_A_STRING';",
      "const regex = /process\\.env\\.IN_A_REGEX/;",
      "function local(process: { env: { SHADOWED: string } }) { return process.env.SHADOWED; }",
      "function localGlobal(globalThis: unknown) { return globalThis.process.env.SHADOWED_TOO; }",
    ].join("\n"));
    assert.deepEqual(occurrences, []);
  });

  it("fails closed for new exact, computed, relocated, or changed readers", () => {
    const exact = inventoryEnvironmentAccesses("src/new-reader.ts", "export const value = process.env.NEW_KEY;");
    assert.match(auditOccurrences(exact).join("\n"), /unregistered environment key NEW_KEY/);

    const computed = inventoryEnvironmentAccesses("src/new-reader.ts", "export const value = process.env[key];");
    assert.match(auditOccurrences(computed).join("\n"), /unregistered or changed computed reader/);

    const relocated = inventoryEnvironmentAccesses("src/elsewhere.ts", "export const value = process.env.UCPATH_PASSWORD;");
    assert.match(auditOccurrences(relocated).join("\n"), /not pinned to its owner/);
  });

  it("rejects a target-bootstrap reader whose owner differs from its source", () => {
    const wrongBootstrapOwner = {
      ...RUNTIME_ENVIRONMENT_REGISTRY,
      computedReaders: RUNTIME_ENVIRONMENT_REGISTRY.computedReaders.map((reader) =>
        reader.path === "scripts/dev-dashboard.ts"
          ? { ...reader, owner: "src/domain/secrets.ts" }
          : reader),
    };
    assert.match(
      auditRuntimeEnvironmentInventory(wrongBootstrapOwner).join("\n"),
      /runtime environment registry failed strict parsing/,
    );
  });

  it("rejects a target-bootstrap reader on the wrong child-process boundary", () => {
    const wrongBootstrapBoundary = {
      ...RUNTIME_ENVIRONMENT_REGISTRY,
      computedReaders: RUNTIME_ENVIRONMENT_REGISTRY.computedReaders.map((reader) =>
        reader.path === "scripts/dev-dashboard.ts" && reader.targets.kind === "bulk-pass-through"
          ? { ...reader, targets: { ...reader.targets, boundary: "legacy-daemon-child" as const } }
          : reader),
    };
    assert.match(
      auditRuntimeEnvironmentInventory(wrongBootstrapBoundary).join("\n"),
      /target bootstrap reader is outside the exact dashboard launcher\/Vite contract: scripts\/dev-dashboard\.ts/,
    );
  });

  it.each([
    ["owner", { owner: "src/domain/secrets.ts" }],
    ["channel", { channel: "secret" as const }],
  ] as const)("rejects the process-ownership nonce with the wrong %s", (_label, exactMutation) => {
    const wrongProcessOwnership = {
      ...RUNTIME_ENVIRONMENT_REGISTRY,
      exact: RUNTIME_ENVIRONMENT_REGISTRY.exact.map((entry) =>
        entry.key === "HRAUTO_DASHBOARD_LAUNCH_NONCE"
          ? { ...entry, ...exactMutation }
          : entry),
    };
    assert.match(
      auditRuntimeEnvironmentInventory(wrongProcessOwnership).join("\n"),
      /HRAUTO_DASHBOARD_LAUNCH_NONCE (?:is owned by .*; expected src\/domain\/dashboard-frontend-owner\.ts|retains forbidden active secret environment ownership)/,
    );
  });
});
