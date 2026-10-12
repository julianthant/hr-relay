import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { auditRuntimeDependencyCoverage,RUNTIME_DEPENDENCY_REGISTRY } from "../../../src/models/runtime/runtime-dependencies.js";
import { directIdentifierDisplay } from "../../../src/rules/redaction/redaction.js";

describe("runtime dependency registry", () => {

  it("audits ConfigSchema routes in both directions and rejects typo routes", () => {
    const mutation = {
      ...RUNTIME_DEPENDENCY_REGISTRY,
      systems: RUNTIME_DEPENDENCY_REGISTRY.systems.map((system) => system.system === "ucpath"
        ? { ...system, routes: system.routes.map((route) => route === "smartHr" ? "smartHR" : route) }
        : system),
    };
    const violations = auditRuntimeDependencyCoverage(mutation);
    assert.equal(violations.some((violation) => violation.includes("unknown ConfigSchema route smartHR")), true);
    assert.equal(violations.some((violation) => violation.includes("omits ConfigSchema route smartHr")), true);
  });

  it("reverse-audits secrets, model settings, capabilities, consumers, and scenarios", () => {
    const missingSecret = {
      ...RUNTIME_DEPENDENCY_REGISTRY,
      dependencies: RUNTIME_DEPENDENCY_REGISTRY.dependencies.map((dependency) => dependency.id === "secret.timekeeper"
        ? { ...dependency, secretNames: [] }
        : dependency),
    };
    assert.equal(
      auditRuntimeDependencyCoverage(missingSecret).some((violation) => violation.includes("secret timekeeperName has no runtime dependency consumer")),
      true,
    );

    const mismatchedScenario = {
      ...RUNTIME_DEPENDENCY_REGISTRY,
      dependencies: RUNTIME_DEPENDENCY_REGISTRY.dependencies.map((dependency) => dependency.id === "browser.chromium"
        ? { ...dependency, scenario: "preflight/config-invalid" }
        : dependency),
    };
    assert.equal(
      auditRuntimeDependencyCoverage(mismatchedScenario).some((violation) => violation.includes("omits dependency scenario preflight/config-invalid")),
      true,
    );

    const missingConsumer = {
      ...RUNTIME_DEPENDENCY_REGISTRY,
      checks: RUNTIME_DEPENDENCY_REGISTRY.checks.map((check) => check.id === "browser.assets"
        ? { ...check, consumer: "" }
        : check),
    };
    assert.deepEqual(auditRuntimeDependencyCoverage(missingConsumer), ["runtime dependency registry failed strict parsing"]);
  });

  it("rejects wrong credential ownership, aggregate-only secret coverage, and coherent provider removal", () => {
    const wrongCredential = {
      ...RUNTIME_DEPENDENCY_REGISTRY,
      systems: RUNTIME_DEPENDENCY_REGISTRY.systems.map((system) => system.system === "ucpath"
        ? { ...system, credential: "sharepoint-url" }
        : system),
    };
    const credentialViolations = auditRuntimeDependencyCoverage(wrongCredential);
    assert.equal(credentialViolations.some((violation) => violation.includes(
      `expected ${directIdentifierDisplay("ucpath-sso")}`,
    )), true);
    assert.ok(credentialViolations.some(violation => violation.includes("uses credential sharepoint-url, expected ucpath-sso")));

    const movedSecrets = {
      ...RUNTIME_DEPENDENCY_REGISTRY,
      dependencies: RUNTIME_DEPENDENCY_REGISTRY.dependencies.map((dependency) => {
        if (dependency.id === "secret.ucpath-sso") return { ...dependency, secretNames: [] };
        if (dependency.id === "path.state") return { ...dependency, secretNames: ["ucpathUserId", "ucpathPassword"] };
        return dependency;
      }),
    };
    const secretViolations = auditRuntimeDependencyCoverage(movedSecrets);
    assert.equal(secretViolations.some((violation) => violation.includes("ucpathUserId is not owned by dependency secret.ucpath-sso")), true);
    assert.equal(secretViolations.some((violation) => violation.includes("path.state cannot own secret ucpathPassword")), true);

    const withoutCensus = {
      ...RUNTIME_DEPENDENCY_REGISTRY,
      providers: RUNTIME_DEPENDENCY_REGISTRY.providers.filter(({ provider }) => provider !== "census"),
      dependencies: RUNTIME_DEPENDENCY_REGISTRY.dependencies.filter(({ id }) => id !== "provider.census"),
      checks: RUNTIME_DEPENDENCY_REGISTRY.checks
        .filter(({ id }) => id !== "provider.census")
        .map((check) => ({ ...check, dependencies: check.dependencies.filter((id) => id !== "provider.census") })),
    };
    assert.equal(
      auditRuntimeDependencyCoverage(withoutCensus).some((violation) => violation.includes("provider census has no adapter or explicit target disposition")),
      true,
    );
  });

  it("requires real scenario/consumer registrations and consistent severity semantics", () => {
    const missingScenario = {
      ...RUNTIME_DEPENDENCY_REGISTRY,
      scenarios: RUNTIME_DEPENDENCY_REGISTRY.scenarios.filter((scenario) => scenario !== "preflight/runtime-mismatch"),
    };
    assert.equal(
      auditRuntimeDependencyCoverage(missingScenario).some((violation) => violation.includes("ScenarioManifest preflight/runtime-mismatch is absent")),
      true,
    );
    const missingConsumer = {
      ...RUNTIME_DEPENDENCY_REGISTRY,
      consumers: RUNTIME_DEPENDENCY_REGISTRY.consumers.filter(({ id }) => id !== "system-driver"),
    };
    assert.equal(
      auditRuntimeDependencyCoverage(missingConsumer).some((violation) => violation.includes("runtime consumer system-driver has no registered owner")),
      true,
    );
    const wrongSeverity = {
      ...RUNTIME_DEPENDENCY_REGISTRY,
      checks: RUNTIME_DEPENDENCY_REGISTRY.checks.map((check) => check.id === "browser.assets"
        ? { ...check, severity: "warning" }
        : check),
    };
    assert.equal(
      auditRuntimeDependencyCoverage(wrongSeverity).some((violation) => violation.includes("severity warning contradicts error")),
      true,
    );
  });

  it("binds the server runner registry to the browser-safe check identities, mandatory authority, and feature expansions in both directions", () => {
    const missingSemanticCheck = {
      ...RUNTIME_DEPENDENCY_REGISTRY,
      checks: RUNTIME_DEPENDENCY_REGISTRY.checks.filter((check) => check.id !== "config.valid"),
    };
    assert.equal(
      auditRuntimeDependencyCoverage(missingSemanticCheck).some((violation) => violation.includes("omits semantic check config.valid")),
      true,
    );

    const inventedSemanticCheck = {
      ...RUNTIME_DEPENDENCY_REGISTRY,
      checks: [...RUNTIME_DEPENDENCY_REGISTRY.checks, {
        ...RUNTIME_DEPENDENCY_REGISTRY.checks[0],
        id: "invented.check",
      }],
    };
    assert.equal(
      auditRuntimeDependencyCoverage(inventedSemanticCheck).some((violation) => violation.includes("unmodeled semantic check invented.check")),
      true,
    );

    const wrongAuthority = {
      ...RUNTIME_DEPENDENCY_REGISTRY,
      dependencies: RUNTIME_DEPENDENCY_REGISTRY.dependencies.map((dependency) => (
        dependency.id === "runtime.node" || dependency.id === "runtime.package-lock"
        ? { ...dependency, capabilities: ["dashboard.serve"] }
        : dependency)),
    };
    assert.equal(
      auditRuntimeDependencyCoverage(wrongAuthority).some((violation) => violation.includes("runtime.compatibility blocking authority contradicts")),
      true,
    );


  });

  it("keeps validated registry exports recursively immutable", () => {
    assert.equal(Object.isFrozen(RUNTIME_DEPENDENCY_REGISTRY), true);
    assert.equal(Object.isFrozen(RUNTIME_DEPENDENCY_REGISTRY.providers), true);
    assert.equal(Object.isFrozen(RUNTIME_DEPENDENCY_REGISTRY.providers[0]), true);
    assert.equal(Object.isFrozen(RUNTIME_DEPENDENCY_REGISTRY.checks[0]?.dependencies), true);
  });
});
