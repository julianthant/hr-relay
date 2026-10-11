import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { BrowserSystemIdSchema } from "../../../src/rules/identity/ids.js";
import { auditRuntimeDependencyCoverage, PREFLIGHT_CHECKS, ProviderIdSchema, RUNTIME_DEPENDENCY_REGISTRY, RuntimeCapabilitySchema, SYSTEM_RUNTIME_SPECS } from "../../../src/models/runtime/runtime-dependencies.js";




function capabilitiesFor(prefix: string): readonly string[] {
  return RuntimeCapabilitySchema.options.filter((capability) => capability.startsWith(prefix));
}

/** Membership by value, so a drifted id is a data mismatch rather than a type error. */
const RUNTIME_CAPABILITY_IDS: ReadonlySet<string> = new Set<string>(RuntimeCapabilitySchema.options);

describe("runtime dependency coverage", () => {
  it("keeps the registry closed against itself inside the architecture lane", () => {
    assert.deepEqual(auditRuntimeDependencyCoverage(RUNTIME_DEPENDENCY_REGISTRY), []);
  });

  it("gives every browser system a production route and credential", () => {
    const rebuild = [...BrowserSystemIdSchema.options].sort();

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


});
