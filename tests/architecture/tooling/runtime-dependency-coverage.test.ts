import assert from "node:assert/strict";
import ts from "typescript";
import { describe, it } from "vitest";
import { BrowserSystemIdSchema } from "../../../src/rules/identity/ids.js";
import { auditRuntimeDependencyCoverage, PREFLIGHT_CHECKS, ProviderIdSchema, RUNTIME_DEPENDENCY_REGISTRY, RuntimeCapabilitySchema, SYSTEM_RUNTIME_SPECS } from "../../../src/models/runtime/runtime-dependencies.js";
import { FROZEN_LEGACY_ARCHITECTURE_PROVENANCE, frozenLegacyPaths } from "../support/helpers/frozen-legacy-architecture-provenance.js";




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
      `browser-system inventory drifted; owner src/rules/identity/ids.ts (BrowserSystemIdSchema) vs src/systems/`,
    );

    // Each system must be reachable through its production route and credential.
    const checkIds = new Set(PREFLIGHT_CHECKS.map(({ id }) => String(id)));
    for (const system of rebuild) {
      const spec = SYSTEM_RUNTIME_SPECS.find((candidate) => String(candidate.system) === system);
      assert.ok(spec, `${system}: no SystemRuntimeSpec; owner src/models/runtime/runtime-dependencies.ts`);
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

  it("gives every runtime capability a blocking-or-optional preflight path", () => {
    const checkCapabilities = new Set(PREFLIGHT_CHECKS.flatMap(({ capabilities }) => capabilities.map(String)));
    const uncovered = RuntimeCapabilitySchema.options.filter((capability) => !checkCapabilities.has(capability));
    assert.deepEqual(uncovered, [], "capabilities with no preflight check; owner src/models/runtime/runtime-dependencies.ts");
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
