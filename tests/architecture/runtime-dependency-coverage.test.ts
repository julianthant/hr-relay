import assert from "node:assert/strict";
import ts from "typescript";
import { describe, it } from "vitest";
import { BrowserSystemIdSchema } from "../../src/domain/ids.js";
import { SETTINGS_CATALOG } from "../../src/domain/config/catalog.js";
import {
  auditRuntimeDependencyCoverage,
  PREFLIGHT_CHECKS,
  PROVIDER_ADAPTER_SPECS,
  ProviderIdSchema,
  RUNTIME_DEPENDENCY_REGISTRY,
  RuntimeCapabilitySchema,
  SYSTEM_RUNTIME_SPECS,
} from "../../src/domain/runtime-dependencies.js";
import {
  isRegisteredEnvironmentKey,
  RUNTIME_ENVIRONMENT_EXACT,
  RUNTIME_ENVIRONMENT_FAMILIES,
} from "../../src/domain/runtime-environment.js";
import { SECRET_FAMILY_SPECS } from "../../src/domain/secrets.js";
import {
  FROZEN_LEGACY_ARCHITECTURE_PROVENANCE,
  frozenLegacyPaths,
} from "./helpers/frozen-legacy-architecture-provenance.js";

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

/** Legacy browser systems = frozen driver directories at the recorded legacy commit. */
function legacySystemIds(): readonly string[] {
  const shared = new Set(["common"]);
  const ids = new Set<string>();
  for (const path of frozenLegacyPaths(FROZEN_LEGACY_ARCHITECTURE_PROVENANCE.runtime.browserSystemFiles)) {
    const rest = path.slice("src/systems/".length);
    const [directory] = rest.split("/");
    if (directory !== undefined && rest.includes("/") && !shared.has(directory)) ids.add(directory);
  }
  return [...ids].sort();
}

/** Members of a string-literal union type in the checked-in frozen source. */
export function unionMembers(content: string, path: string, typeName: string): readonly string[] {
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

    // Each system must be reachable through its production route and credential.
    const checkIds = new Set(PREFLIGHT_CHECKS.map(({ id }) => String(id)));
    for (const system of rebuild) {
      const spec = SYSTEM_RUNTIME_SPECS.find((candidate) => String(candidate.system) === system);
      assert.ok(spec, `${system}: no SystemRuntimeSpec; owner src/domain/runtime-dependencies.ts`);
      assert.equal(spec.routes.length > 0, true, `${system}: no declared routes`);
      assert.equal(RUNTIME_CAPABILITY_IDS.has(`system.${system}.prod`), true,
        `${system}: missing production runtime capability`);
      assert.equal(checkIds.has(`endpoint.${system}.prod`), true,
        `${system}: missing production endpoint preflight check`);
      assert.equal(RUNTIME_CAPABILITY_IDS.has(`system.${system}.test`), false,
        `${system}: retired test runtime capability must stay absent`);
      assert.equal(checkIds.has(`endpoint.${system}.test`), false,
        `${system}: retired test endpoint preflight check must stay absent`);
    }
  });

  it("matches the legacy vision-provider inventory and closes each provider over its settings model chain", () => {
    const provider = FROZEN_LEGACY_ARCHITECTURE_PROVENANCE.runtime.visionProvider;
    const legacy = unionMembers(provider.text, provider.path, "VisionProviderId");
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
    const catalogModelKeys = new Set(SETTINGS_CATALOG
      .filter(({ key }) => /^providers\.(?:gemini|groq|mistral|openRouter|sambanova)\.models$/u.test(key))
      .map(({ key }) => key));

    for (const provider of PROVIDER_ADAPTER_SPECS) {
      const capability = `provider.${provider.provider}`;
      assert.equal(
        RUNTIME_CAPABILITY_IDS.has(capability),
        true,
        `${provider.provider}: no runtime capability`,
      );
      if (provider.secretFamily === undefined) {
        assert.equal(provider.modelsConfigKey, undefined, `${provider.provider}: models config without a secret family`);
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
      assert.equal(provider.modelsConfigKey, family.modelsConfigKey,
        `${provider.provider}: model settings key differs from its secret-family inventory`);
      assert.equal(catalogModelKeys.has(`providers.${family.modelsConfigKey}.models`), true,
        `${provider.provider}: provider model chain has no settings catalog row`);
      assert.equal(isRegisteredEnvironmentKey(family.envPrefix), true, family.envPrefix);
    }

    const claimed = new Set(PROVIDER_ADAPTER_SPECS.flatMap(({ modelsConfigKey }) =>
      modelsConfigKey === undefined ? [] : [`providers.${modelsConfigKey}.models`]));
    assert.deepEqual([...catalogModelKeys].filter((key) => !claimed.has(key)), []);
    assert.deepEqual(
      RUNTIME_ENVIRONMENT_EXACT.filter((spec) =>
        spec.disposition === "active" && spec.channel === "provider-model"),
      [],
    );
  });

  it("gives every runtime capability a blocking-or-optional preflight path", () => {
    const checkCapabilities = new Set(PREFLIGHT_CHECKS.flatMap(({ capabilities }) => capabilities.map(String)));
    const uncovered = RuntimeCapabilitySchema.options.filter((capability) => !checkCapabilities.has(capability));
    assert.deepEqual(uncovered, [], "capabilities with no preflight check; owner src/domain/runtime-dependencies.ts");
    assert.equal(capabilitiesFor("system.").length, BrowserSystemIdSchema.options.length);
    assert.equal(capabilitiesFor("provider.").length, ProviderIdSchema.options.length);
  });

  it("reads legacy unions from source and fails loudly when one is renamed away", () => {
    const provider = FROZEN_LEGACY_ARCHITECTURE_PROVENANCE.runtime.visionProvider;
    assert.deepEqual(
      unionMembers(provider.text, provider.path, "VisionProviderId"),
      ["gemini", "groq", "mistral", "openrouter", "sambanova"],
    );
    assert.throws(
      () => unionMembers(provider.text, provider.path, "NoSuchTypeAlias"),
      /no longer declares the type NoSuchTypeAlias/,
    );
  });

});
