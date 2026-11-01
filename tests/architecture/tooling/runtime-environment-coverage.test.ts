import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "vitest";
import { auditRuntimeEnvironmentInventory, COMPUTED_ENVIRONMENT_READERS, EXACT_ENVIRONMENT_READER_OWNERS, isRegisteredEnvironmentKey, RUNTIME_ENVIRONMENT_EXACT, RUNTIME_ENVIRONMENT_FAMILIES, RUNTIME_ENVIRONMENT_REGISTRY, runtimeEnvironmentFamilyForKey } from "../../../src/models/runtime/runtime-environment.js";
import { ENVIRONMENT_SOURCE_EXTENSIONS, inventoryEnvironmentAccesses, type EnvironmentAccessOccurrence } from "../runtime/helpers/environment-read-audit.js";
import { gitVisibleFiles, REPO_ROOT } from "../support/helpers/guard-files.js";

function repositoryOccurrences(): readonly EnvironmentAccessOccurrence[] {
  const scannable = (path: string): boolean =>
    ENVIRONMENT_SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension));
  return gitVisibleFiles(["."])
    .filter(scannable)
    .flatMap((path) => inventoryEnvironmentAccesses(path, readFileSync(resolve(REPO_ROOT, path), "utf8")));
}

/** Test-lane paths on either side, which own their own environment reads. */
function isTestPath(path: string): boolean {
  return path.startsWith("tests/");
}


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

    const expectedPaths = expected.paths.toSorted();
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

  const expectedComputed = new Map(COMPUTED_ENVIRONMENT_READERS
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

  it("refuses restored config channels and requires every migrated key's refusal", () => {
    const forbidden = ["config", "config-and-secret", "secret", "provider-model"];
    assert.deepEqual(RUNTIME_ENVIRONMENT_EXACT.filter(spec => spec.disposition === "active"
      && forbidden.includes(spec.channel)), []);
    for (const channel of forbidden) {
      const restored = { ...RUNTIME_ENVIRONMENT_REGISTRY, exact: [
        ...RUNTIME_ENVIRONMENT_REGISTRY.exact,
        { key: "HRAUTO_RESTORED_SETTING", classification: "non-secret-config", disposition: "active",
          channel, owner: "src/backend/app/config/resolve.ts", documented: false },
      ] };
      assert.match(auditRuntimeEnvironmentInventory(restored).join("\n"), new RegExp(`forbidden active ${channel} environment ownership`, "u"));
    }
    for (const spec of RUNTIME_ENVIRONMENT_EXACT.filter(candidate => candidate.disposition === "migrated-refused")) {
      const restored = { ...RUNTIME_ENVIRONMENT_REGISTRY,
        exact: RUNTIME_ENVIRONMENT_REGISTRY.exact.filter(candidate => candidate.key !== spec.key) };
      assert.match(auditRuntimeEnvironmentInventory(restored).join("\n"), /is not explicitly refused/u, spec.key);
    }
  });

  it("keeps the current family inventory empty and unknown keys unregistered", () => {
    assert.deepEqual(RUNTIME_ENVIRONMENT_FAMILIES, []);
    for (const key of ["UNKNOWN_KEY", "UNKNOWN_KEY2"]) {
      assert.equal(runtimeEnvironmentFamilyForKey(key), undefined);
      assert.equal(isRegisteredEnvironmentKey(key), false);
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

  it("pins worker mechanics to a closed non-secret set and the exact accessor", () => {
    const change = (targets: unknown, enclosingSymbol = "workerBootstrapEnvironment") => ({
      ...RUNTIME_ENVIRONMENT_REGISTRY,
      computedReaders: RUNTIME_ENVIRONMENT_REGISTRY.computedReaders.map((reader) =>
        reader.targets.kind === "closed-process-mechanics" ? { ...reader, targets, enclosingSymbol } : reader),
    });
    const mechanics = RUNTIME_ENVIRONMENT_REGISTRY.computedReaders.find((reader) => reader.targets.kind === "closed-process-mechanics");
    assert.ok(mechanics?.targets.kind === "closed-process-mechanics");
    assert.match(auditRuntimeEnvironmentInventory(change({ ...mechanics.targets,
      exact: ["UCPATH_PASSWORD", ...mechanics.targets.exact.slice(1)] })).join("\n"), /strict parsing/u);
    assert.match(auditRuntimeEnvironmentInventory(change(mechanics.targets, "unrelatedAccessor")).join("\n"),
      /closed process mechanics belong only to the worker bootstrap accessor/u);
  });

  it("rejects a target-bootstrap reader whose owner differs from its source", () => {
    const wrongBootstrapOwner = {
      ...RUNTIME_ENVIRONMENT_REGISTRY,
      computedReaders: RUNTIME_ENVIRONMENT_REGISTRY.computedReaders.map((reader) =>
        reader.path === "scripts/dev/dashboard.ts"
          ? { ...reader, owner: "src/models/config/secrets.ts" }
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
        reader.path === "scripts/dev/dashboard.ts" && reader.targets.kind === "bulk-pass-through"
          ? { ...reader, targets: { ...reader.targets, boundary: "test-command-child" as const } }
          : reader),
    };
    assert.match(
      auditRuntimeEnvironmentInventory(wrongBootstrapBoundary).join("\n"),
      /target bootstrap reader is outside the exact dashboard launcher\/Vite contract: scripts\/dev\/dashboard\.ts/,
    );
  });

  it.each([
    ["owner", { owner: "src/models/config/secrets.ts" }],
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
      /HRAUTO_DASHBOARD_LAUNCH_NONCE (?:is owned by .*; expected src\/models\/dashboard\/dashboard-frontend-owner\.ts|retains forbidden active secret environment ownership)/,
    );
  });
});
