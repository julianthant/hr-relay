import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import {
  buildPreflightReport,
  executePreflightRunner,
  PreflightReportSchema,
  requiredPreflightChecks,
} from "../../src/domain/preflight.js";
import {
  RUNTIME_ENVIRONMENT_REGISTRY,
  auditRuntimeEnvironmentInventory,
} from "../../src/domain/runtime-environment.js";
import {
  auditRuntimeDependencyCoverage,
  PREFLIGHT_CHECKS,
  PreflightCheckIdSchema,
  RUNTIME_DEPENDENCIES,
  RUNTIME_DEPENDENCY_REGISTRY,
  RuntimeCapabilitySchema,
  type RuntimeCapability,
} from "../../src/domain/runtime-dependencies.js";

const CLOCK = manualClock(new Date("2026-08-10T12:00:00-07:00"));
const CONFIG_FINGERPRINT = "a".repeat(64);
const CONFIG_VALID_CHECK = PreflightCheckIdSchema.parse("config.valid");

function reportFor(
  capabilities: readonly RuntimeCapability[],
  unhealthyChecks: ReadonlySet<string> = new Set(),
) {
  return buildPreflightReport({
    configFingerprint: CONFIG_FINGERPRINT,
    requestedCapabilities: capabilities,
    observations: requiredPreflightChecks(capabilities).map((check) => unhealthyChecks.has(check)
      ? { check, state: "unhealthy" as const, summary: `${check} unavailable`, impact: `${check} cannot be used` }
      : { check, state: "healthy" as const, summary: `${check} healthy` }),
    clock: CLOCK,
  });
}

function resultFor(report: ReturnType<typeof reportFor>, check: string) {
  const result = report.results.find((candidate) => candidate.check === check);
  assert.ok(result, `missing result for ${check}`);
  return result;
}

describe("runtime dependency registry", () => {
  it("covers every runtime capability with dependency-backed preflight metadata", () => {
    assert.deepEqual(auditRuntimeDependencyCoverage(RUNTIME_DEPENDENCY_REGISTRY), []);
    for (const capability of RuntimeCapabilitySchema.options) {
      assert.equal(requiredPreflightChecks([capability]).length > 0, true, capability);
    }
    assert.equal(PREFLIGHT_CHECKS.every(({ severity }) => severity === "warning" || severity === "error"), true);
    assert.deepEqual(new Set(PREFLIGHT_CHECKS.map(({ runner }) => runner)), new Set(["pure", "io"]));
    assert.equal(RUNTIME_DEPENDENCIES.every(({ consumer, scenario, justification }) => (
      consumer.length > 0 && scenario.startsWith("preflight/") && justification.length > 0
    )), true);
  });

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

  it("reverse-audits secrets, model envs, capabilities, consumers, and scenarios", () => {
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

    const typoModelEnv = {
      ...RUNTIME_DEPENDENCY_REGISTRY,
      providers: RUNTIME_DEPENDENCY_REGISTRY.providers.map((provider) => provider.provider === "gemini"
        ? { ...provider, modelsEnv: "OCR_GEMINI_MODELZ" }
        : provider),
    };
    assert.equal(
      auditRuntimeDependencyCoverage(typoModelEnv).some((violation) => violation.includes("does not match secret inventory OCR_GEMINI_MODELS")),
      true,
    );

    const missingCapabilityCheck = {
      ...RUNTIME_DEPENDENCY_REGISTRY,
      checks: RUNTIME_DEPENDENCY_REGISTRY.checks.filter(({ id }) => id !== "feature.ai-advisory.providers"),
    };
    const capabilityViolations = auditRuntimeDependencyCoverage(missingCapabilityCheck);
    assert.equal(capabilityViolations.some((violation) => violation.includes("feature.ai-advisory has no registered preflight check")), true);
    assert.equal(capabilityViolations.some((violation) => violation.includes("names missing check feature.ai-advisory.providers")), true);

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

  it("detects provider-closure registry mutations", () => {
    const mutation = {
      ...RUNTIME_DEPENDENCY_REGISTRY,
      providers: RUNTIME_DEPENDENCY_REGISTRY.providers.map((provider) => ({
        ...provider,
        capabilities: provider.capabilities.filter((capability) => capability !== "ai.advisory"),
      })),
    };
    const violations = auditRuntimeDependencyCoverage(mutation);
    assert.equal(violations.some((violation) => violation.includes("provider capability ai.advisory has no adapter")), true);
    assert.equal(violations.some((violation) => violation.includes("feature feature.ai-advisory has 0 providers")), true);
  });

  it("rejects wrong credential ownership, aggregate-only secret coverage, and coherent provider removal", () => {
    const wrongCredential = {
      ...RUNTIME_DEPENDENCY_REGISTRY,
      systems: RUNTIME_DEPENDENCY_REGISTRY.systems.map((system) => system.system === "ucpath"
        ? { ...system, credential: "sharepoint-url" }
        : system),
    };
    assert.equal(auditRuntimeDependencyCoverage(wrongCredential).some((violation) => violation.includes("expected ucpath-sso")), true);

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

    const withoutGemini = {
      ...RUNTIME_DEPENDENCY_REGISTRY,
      providers: RUNTIME_DEPENDENCY_REGISTRY.providers.filter(({ provider }) => provider !== "gemini"),
      dependencies: RUNTIME_DEPENDENCY_REGISTRY.dependencies.filter(({ id }) => id !== "provider.gemini"),
      checks: RUNTIME_DEPENDENCY_REGISTRY.checks
        .filter(({ id }) => id !== "provider.gemini")
        .map((check) => ({ ...check, dependencies: check.dependencies.filter((id) => id !== "provider.gemini") })),
    };
    assert.equal(
      auditRuntimeDependencyCoverage(withoutGemini).some((violation) => violation.includes("provider gemini has no adapter or explicit target disposition")),
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

  it("keeps validated registry exports recursively immutable", () => {
    assert.equal(Object.isFrozen(RUNTIME_DEPENDENCY_REGISTRY), true);
    assert.equal(Object.isFrozen(RUNTIME_DEPENDENCY_REGISTRY.providers), true);
    assert.equal(Object.isFrozen(RUNTIME_DEPENDENCY_REGISTRY.providers[0]), true);
    assert.equal(Object.isFrozen(RUNTIME_DEPENDENCY_REGISTRY.checks[0]?.dependencies), true);
  });
});

describe("runtime environment inventory", () => {
  it("is bidirectionally complete for config, secret, family, and model environment inputs", () => {
    assert.deepEqual(auditRuntimeEnvironmentInventory(RUNTIME_ENVIRONMENT_REGISTRY), []);
    assert.equal(Object.isFrozen(RUNTIME_ENVIRONMENT_REGISTRY.exact), true);
  });

  it("rejects missing config bindings and stale model metadata", () => {
    const withoutConfig = {
      ...RUNTIME_ENVIRONMENT_REGISTRY,
      exact: RUNTIME_ENVIRONMENT_REGISTRY.exact.filter(({ key }) => key !== "HRAUTO_NAVIGATION_RETRIES"),
    };
    assert.equal(
      auditRuntimeEnvironmentInventory(withoutConfig).some((violation) => violation.includes("config binding HRAUTO_NAVIGATION_RETRIES")),
      true,
    );
    const staleModel = {
      ...RUNTIME_ENVIRONMENT_REGISTRY,
      exact: RUNTIME_ENVIRONMENT_REGISTRY.exact.map((spec) => spec.key === "OCR_GEMINI_MODELS"
        ? { key: spec.key, classification: "retired-in-target", disposition: "retired-in-target", reason: "incorrect mutation", documented: false }
        : spec),
    };
    assert.equal(
      auditRuntimeEnvironmentInventory(staleModel).some((violation) => violation.includes("provider model environment OCR_GEMINI_MODELS")),
      true,
    );
  });
});

describe("preflight selection and reports", () => {
  it("executes an injected detector through the registered runner contract before report projection", async () => {
    const controller = new AbortController();
    const observation = await executePreflightRunner({
      check: CONFIG_VALID_CHECK,
      kind: "pure",
      async run(context) {
        assert.equal(context.timeoutMs, 1_000);
        assert.equal(context.redaction, "safe-summary");
        assert.equal(context.deadlineMonotonicMs, CLOCK.monotonicMs() + 1_000);
        return { check: "config.valid", state: "healthy", summary: "config parsed" };
      },
    }, controller.signal, CLOCK);
    assert.equal(observation.state, "healthy");
    await assert.rejects(executePreflightRunner({
      check: CONFIG_VALID_CHECK,
      kind: "io",
      async run() {
        return { check: "config.valid", state: "healthy", summary: "wrong runner kind" };
      },
    }, controller.signal, CLOCK), /kind io does not match pure/);
  });
  it("rejects duplicate requested capabilities and unknown, duplicate, missing, or unrequested observations", () => {
    assert.throws(() => requiredPreflightChecks(["dashboard.serve", "dashboard.serve"]), /requested capabilities contain duplicates/);
    assert.throws(() => buildPreflightReport({
      configFingerprint: CONFIG_FINGERPRINT,
      requestedCapabilities: ["provider.gemini"],
      observations: [{ check: "unknown.check", state: "healthy", summary: "unknown" }],
      clock: CLOCK,
    }), /unknown checks: unknown.check/);
    assert.throws(() => buildPreflightReport({
      configFingerprint: CONFIG_FINGERPRINT,
      requestedCapabilities: ["provider.gemini"],
      observations: [
        { check: "provider.gemini", state: "healthy", summary: "first" },
        { check: "provider.gemini", state: "healthy", summary: "second" },
      ],
      clock: CLOCK,
    }), /duplicate check ids: provider.gemini/);
    assert.throws(() => buildPreflightReport({
      configFingerprint: CONFIG_FINGERPRINT,
      requestedCapabilities: ["provider.gemini"],
      observations: [],
      clock: CLOCK,
    }), /omit selected checks: provider.gemini/);
    assert.throws(() => buildPreflightReport({
      configFingerprint: CONFIG_FINGERPRINT,
      requestedCapabilities: ["provider.gemini"],
      observations: [{ check: "capture.ingress", state: "healthy", summary: "capture healthy" }],
      clock: CLOCK,
    }), /unrequested checks: capture.ingress/);
  });

  it.each([
    ["missing browser", ["executor.run"], "browser.assets", "executor.run"],
    ["stale fiscal year", ["workflow.kuali-fill"], "fiscal.current", "workflow.kuali-fill"],
    ["bad test URL", ["system.ucpath.test"], "endpoint.ucpath.test", "system.ucpath.test"],
    ["low disk", ["dashboard.serve"], "filesystem.health", "dashboard.serve"],
    ["corrupt DB", ["dashboard.serve"], "authority.health", "dashboard.serve"],
    ["missing workflow secret", ["workflow.sharepoint-download"], "secrets.sharepoint-roster", "workflow.sharepoint-download"],
    ["unavailable ngrok/capture ingress", ["feature.capture"], "capture.ingress", "feature.capture"],
  ] as const)("blocks the exact selected capability for %s", (_label, capabilities, check, blocked) => {
    const report = reportFor(capabilities, new Set([check]));
    const result = resultFor(report, check);
    assert.equal(result.status, "fail");
    if (result.status === "fail") assert.deepEqual(result.blocks, [blocked]);
  });

  it("keeps provider cells optional but closes selected OCR and advisory features over their providers", () => {
    const optionalProvider = reportFor(["provider.gemini"], new Set(["provider.gemini"]));
    assert.equal(resultFor(optionalProvider, "provider.gemini").status, "warning");

    const ocrChecks = requiredPreflightChecks(["feature.ocr"]);
    assert.equal(ocrChecks.some((check) => check === "feature.ocr.providers"), true);
    for (const provider of ["gemini", "groq", "mistral", "openrouter", "sambanova"]) {
      assert.equal(ocrChecks.some((check) => check === `provider.${provider}`), true, provider);
    }
    const partiallyAvailable = reportFor(["feature.ocr"], new Set(["provider.gemini"]));
    assert.equal(resultFor(partiallyAvailable, "provider.gemini").status, "warning");
    assert.equal(resultFor(partiallyAvailable, "feature.ocr.providers").status, "pass");

    const unavailable = reportFor(["feature.ocr"], new Set([
      "feature.ocr.providers",
      "provider.gemini",
      "provider.groq",
      "provider.mistral",
      "provider.openrouter",
      "provider.sambanova",
    ]));
    const featureResult = resultFor(unavailable, "feature.ocr.providers");
    assert.equal(featureResult.status, "fail");
    if (featureResult.status === "fail") assert.deepEqual(featureResult.blocks, ["feature.ocr"]);
    assert.equal(resultFor(unavailable, "provider.groq").status, "warning");

    assert.throws(() => reportFor(["feature.ocr"], new Set([
      "provider.gemini",
      "provider.groq",
      "provider.mistral",
      "provider.openrouter",
      "provider.sambanova",
    ])), /provider-set observation contradicts 0 healthy provider/);

    const advisory = reportFor(["feature.ai-advisory"]);
    assert.equal(advisory.results.every(({ status }) => status === "pass"), true);
  });

  it("produces a healthy report with unique selected results and no impact fields", () => {
    const report = reportFor(["dashboard.serve"]);
    assert.equal(report.results.every(({ status }) => status === "pass"), true);
    assert.equal(new Set(report.results.map(({ check }) => check)).size, report.results.length);
    assert.equal(JSON.stringify(report).includes("impact"), false);
    assert.equal(PreflightReportSchema.safeParse(report).success, true);
  });

  it("semantically rejects duplicate/unregistered results, invalid blocks, and healthy impact", () => {
    const report = reportFor(["dashboard.serve"]);
    const first = report.results[0];
    assert.notEqual(first, undefined);
    if (first === undefined) return;

    assert.equal(PreflightReportSchema.safeParse({
      ...report,
      requestedCapabilities: [...report.requestedCapabilities, "dashboard.serve"],
    }).success, false);
    assert.equal(PreflightReportSchema.safeParse({
      ...report,
      results: [...report.results, first],
    }).success, false);
    assert.equal(PreflightReportSchema.safeParse({
      ...report,
      results: report.results.map((result, index) => index === 0 ? { ...result, check: "unknown.check" } : result),
    }).success, false);
    assert.equal(PreflightReportSchema.safeParse({
      ...report,
      results: report.results.map((result, index) => index === 0
        ? { status: "fail", check: result.check, summary: "bad", blocks: ["feature.capture"], remediation: "repair" }
        : result),
    }).success, false);
    assert.equal(PreflightReportSchema.safeParse({
      ...report,
      results: report.results.map((result, index) => index === 0 ? { ...result, impact: "healthy cannot have impact" } : result),
    }).success, false);
  });
});
