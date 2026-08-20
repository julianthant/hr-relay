import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, it } from "vitest";
import { BrowserSystemIdSchema } from "../../../src/domain/ids.js";
import {
  auditRuntimeDependencyCoverage,
  PREFLIGHT_CHECKS,
  PROVIDER_ADAPTER_SPECS,
  ProviderIdSchema,
  RUNTIME_DEPENDENCY_REGISTRY,
  RuntimeCapabilitySchema,
  SYSTEM_RUNTIME_SPECS,
} from "../../../src/domain/runtime-dependencies.js";
import {
  isRegisteredEnvironmentKey,
  RUNTIME_ENVIRONMENT_EXACT,
  RUNTIME_ENVIRONMENT_FAMILIES,
} from "../../../src/domain/runtime-environment.js";
import { SECRET_FAMILY_SPECS } from "../../../src/domain/secrets.js";
import { LEGACY_REPO_ROOT, gitVisibleFilesIn } from "./helpers/guard-files.js";

/**
 * Guard (ref guards-and-tests §3.12 — D68): the rebuild's closed runtime-dependency sets
 * agree with the legacy inventory they replace, in BOTH directions.
 *
 * `auditRuntimeDependencyCoverage` already closes the registry against itself
 * — every capability has a check, every check a consumer and scenario, every
 * secret an owning dependency — and the rebuild lane exercises that with
 * mutation fixtures. What no lane covered is the direction that actually goes
 * stale in a coexistence program: **legacy grew a system or a provider and the
 * rebuild registry did not notice.** Ref guards-and-tests names the failure exactly — "a
 * missing ServiceNow/SharePoint/Old-Kronos endpoint or provider key ... fails
 * with the exact owner."
 *
 * Legacy is read as SOURCE TEXT (directory names, a parsed union type), never
 * imported: after D93 they are two repositories, and this guard is a
 * comparison of inventories, not a bridge between them.
 *
 * This guard also re-runs the registry audit inside `test:architecture`. Ref guards-and-tests
 * §5.1 registers `runtime-dependency-coverage` as a guard-of-guards entry, so
 * the gate that fails on registry drift must be the architecture lane — not
 * only the unit lane, which a legacy-only maintenance pass would not run.
 */

/** Legacy browser systems = the driver directories under the LEGACY `src/systems/`. */
function legacySystemIds(): readonly string[] {
  const shared = new Set(["common"]);
  const ids = new Set<string>();
  for (const path of gitVisibleFilesIn(LEGACY_REPO_ROOT, ["src/systems"])) {
    const rest = path.slice("src/systems/".length);
    const [directory] = rest.split("/");
    if (directory !== undefined && rest.includes("/") && !shared.has(directory)) ids.add(directory);
  }
  return [...ids].sort();
}

/** Members of a legacy string-literal union type, read from the LEGACY repo's source. */
export function unionMembers(path: string, typeName: string): readonly string[] {
  const content = readFileSync(join(LEGACY_REPO_ROOT, path), "utf8");
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const members: string[] = [];
  let found = false;
  function visit(node: ts.Node): void {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === typeName) {
      found = true;
      const arms = ts.isUnionTypeNode(node.type) ? node.type.types : [node.type];
      for (const arm of arms) {
        if (ts.isLiteralTypeNode(arm) && ts.isStringLiteral(arm.literal)) members.push(arm.literal.text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!found) throw new Error(`${path} no longer declares the type ${typeName}`);
  return [...members].sort();
}

function capabilitiesFor(prefix: string): readonly string[] {
  return RuntimeCapabilitySchema.options.filter((capability) => capability.startsWith(prefix));
}

/** Membership by value, so a drifted id is a data mismatch rather than a type error. */
const RUNTIME_CAPABILITY_IDS: ReadonlySet<string> = new Set<string>(RuntimeCapabilitySchema.options);

describe("runtime dependency coverage", () => {
  it("keeps the registry closed against itself inside the architecture lane", () => {
    assert.deepEqual(auditRuntimeDependencyCoverage(RUNTIME_DEPENDENCY_REGISTRY), []);
  });

  it("matches the legacy browser-system inventory in both directions", () => {
    const legacy = legacySystemIds();
    assert.equal(legacy.length > 0, true, "src/systems resolved zero driver directories");

    const rebuild = [...BrowserSystemIdSchema.options].sort();
    assert.deepEqual(
      rebuild,
      legacy,
      `browser-system inventory drifted; owner src/domain/ids.ts (BrowserSystemIdSchema) vs src/systems/`,
    );

    // Each system must be reachable end to end: a runtime spec, a credential,
    // and BOTH instance capabilities with a registered preflight endpoint check.
    const checkIds = new Set(PREFLIGHT_CHECKS.map(({ id }) => String(id)));
    for (const system of rebuild) {
      const spec = SYSTEM_RUNTIME_SPECS.find((candidate) => String(candidate.system) === system);
      assert.ok(spec, `${system}: no SystemRuntimeSpec; owner src/domain/runtime-dependencies.ts`);
      assert.equal(spec.routes.length > 0, true, `${system}: no declared routes`);
      for (const instance of ["prod", "test"] as const) {
        assert.equal(
          RUNTIME_CAPABILITY_IDS.has(`system.${system}.${instance}`),
          true,
          `${system}: missing ${instance} runtime capability`,
        );
        assert.equal(
          checkIds.has(`endpoint.${system}.${instance}`),
          true,
          `${system}: missing endpoint.${system}.${instance} preflight check`,
        );
      }
    }
  });

  it("matches the legacy vision-provider inventory and closes each provider over its environment", () => {
    const legacy = unionMembers("src/services/ocr/provider-limits.ts", "VisionProviderId");
    const visionProviders = PROVIDER_ADAPTER_SPECS
      .filter(({ capabilities }) => capabilities.includes("ocr.extract"))
      .map(({ provider }) => provider)
      .sort();
    assert.deepEqual(
      visionProviders,
      legacy,
      "vision-provider inventory drifted; owner src/domain/runtime-dependencies.ts (PROVIDER_ADAPTER_SPECS) vs src/services/ocr/provider-limits.ts",
    );

    const families = new Map(SECRET_FAMILY_SPECS.map((family) => [family.name, family]));
    const activeModelKeys = new Set(RUNTIME_ENVIRONMENT_EXACT
      .filter((spec) => spec.disposition === "active" && spec.channel === "provider-model")
      .map(({ key }) => key));

    for (const provider of PROVIDER_ADAPTER_SPECS) {
      const capability = `provider.${provider.provider}`;
      assert.equal(
        RUNTIME_CAPABILITY_IDS.has(capability),
        true,
        `${provider.provider}: no runtime capability`,
      );
      if (provider.secretFamily === undefined) {
        // A keyless provider must not claim a model environment either.
        assert.equal(provider.modelsEnv, undefined, `${provider.provider}: models env without a secret family`);
        continue;
      }
      const family = families.get(provider.secretFamily);
      assert.ok(family, `${provider.provider}: unknown secret family ${provider.secretFamily}`);
      assert.equal(
        RUNTIME_ENVIRONMENT_FAMILIES.some(({ prefix, disposition }) =>
          prefix === family.envPrefix && disposition === "active"),
        true,
        `${provider.provider}: ${family.envPrefix} is not an active environment family`,
      );
      assert.ok(provider.modelsEnv, `${provider.provider}: keyed provider declares no models env`);
      assert.equal(activeModelKeys.has(provider.modelsEnv), true,
        `${provider.provider}: ${provider.modelsEnv} is not an active provider-model environment key`);
      assert.equal(isRegisteredEnvironmentKey(family.envPrefix), true, family.envPrefix);
    }

    // Reverse: no orphan provider-model key without a provider claiming it.
    const claimed = new Set(PROVIDER_ADAPTER_SPECS.flatMap(({ modelsEnv }) => modelsEnv ? [modelsEnv] : []));
    assert.deepEqual([...activeModelKeys].filter((key) => !claimed.has(key)), []);
  });

  it("gives every runtime capability a blocking-or-optional preflight path", () => {
    const checkCapabilities = new Set(PREFLIGHT_CHECKS.flatMap(({ capabilities }) => capabilities.map(String)));
    const uncovered = RuntimeCapabilitySchema.options.filter((capability) => !checkCapabilities.has(capability));
    assert.deepEqual(uncovered, [], "capabilities with no preflight check; owner src/domain/runtime-dependencies.ts");
    assert.equal(capabilitiesFor("system.").length, BrowserSystemIdSchema.options.length * 2);
    assert.equal(capabilitiesFor("provider.").length, ProviderIdSchema.options.length);
  });

  it("reads legacy unions from source and fails loudly when one is renamed away", () => {
    assert.deepEqual(
      unionMembers("src/services/ocr/provider-limits.ts", "VisionProviderId"),
      ["gemini", "groq", "mistral", "openrouter", "sambanova"],
    );
    assert.throws(
      () => unionMembers("src/services/ocr/provider-limits.ts", "NoSuchTypeAlias"),
      /no longer declares the type NoSuchTypeAlias/,
    );
  });
});
