import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { CONFIG_ENV_BINDINGS } from "../../../src/domain/config/resolve.js";
import {
  ACTIVITY_PERSON_PSEUDONYM_SECRET_REFERENCE,
  SECRET_FAMILY_SPECS,
  SECRET_SPECS,
  TEST_TARGET_EID_SECRET_SPECS,
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
    ...TEST_TARGET_EID_SECRET_SPECS.map((spec) => spec.env),
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

describe("secrets single source", () => {
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
