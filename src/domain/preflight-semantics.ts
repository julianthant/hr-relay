/**
 * Browser-safe semantic authority for preflight reports.
 *
 * This module names only the closed report identity, mandatory authority and
 * feature expansion rules. Runtime detectors, paths, secrets and runner
 * mechanics remain in `runtime-dependencies.ts`; that registry is audited
 * against these expectations instead of becoming a browser import.
 */
import { z } from "zod";
import { deepFreeze } from "./immutability.js";

export const RuntimeCapabilitySchema = z.enum([
  "dashboard.serve",
  "executor.run",
  "workflow.kuali-fill",
  "workflow.sharepoint-download",
  "feature.capture",
  "feature.ocr",
  "feature.ai-advisory",
  "system.ucpath.prod", "system.ucpath.test",
  "system.crm.prod", "system.crm.test",
  "system.onbase.prod", "system.onbase.test",
  "system.kuali.prod", "system.kuali.test",
  "system.servicenow.prod", "system.servicenow.test",
  "system.i9.prod", "system.i9.test",
  "system.new-kronos.prod", "system.new-kronos.test",
  "system.old-kronos.prod", "system.old-kronos.test",
  "system.sharepoint.prod", "system.sharepoint.test",
  "provider.gemini", "provider.groq", "provider.mistral", "provider.openrouter", "provider.sambanova",
  "provider.census", "provider.nominatim",
]);

export const PreflightCheckIdSchema = z.string()
  .regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/)
  .brand<"PreflightCheckId">();

export type RuntimeCapability = z.infer<typeof RuntimeCapabilitySchema>;
export type PreflightCheckId = z.infer<typeof PreflightCheckIdSchema>;

const PreflightCheckSemanticExpectationSchema = z.strictObject({
  id: PreflightCheckIdSchema,
  /** Capabilities that select this check after feature expansion. */
  selectedFor: RuntimeCapabilitySchema.array().min(1),
  /** Requested capabilities this check must block when its result fails. */
  mandatoryFor: RuntimeCapabilitySchema.array(),
});
export type PreflightCheckSemanticExpectation = z.infer<typeof PreflightCheckSemanticExpectationSchema>;

const ProviderCapabilities = [
  "provider.gemini",
  "provider.groq",
  "provider.mistral",
  "provider.openrouter",
  "provider.sambanova",
] as const satisfies readonly RuntimeCapability[];

const SystemIds = [
  "ucpath",
  "crm",
  "onbase",
  "kuali",
  "servicenow",
  "i9",
  "new-kronos",
  "old-kronos",
  "sharepoint",
] as const;

function expectation(
  id: string,
  selectedFor: readonly RuntimeCapability[],
  mandatoryFor: readonly RuntimeCapability[],
): PreflightCheckSemanticExpectation {
  return PreflightCheckSemanticExpectationSchema.parse({ id, selectedFor, mandatoryFor });
}

function systemExpectations(): readonly PreflightCheckSemanticExpectation[] {
  return SystemIds.flatMap((system) => (["prod", "test"] as const).map((instance) => {
    const capability = RuntimeCapabilitySchema.parse(`system.${system}.${instance}`);
    return expectation(`endpoint.${system}.${instance}`, [capability], [capability]);
  }));
}

function providerExpectations(): readonly PreflightCheckSemanticExpectation[] {
  return RuntimeCapabilitySchema.options
    .filter((capability) => capability.startsWith("provider."))
    .map((capability) => expectation(capability, [capability], []));
}

export const PREFLIGHT_CHECK_EXPECTATIONS = deepFreeze(PreflightCheckSemanticExpectationSchema.array().parse([
  expectation("runtime.compatibility", ["dashboard.serve", "executor.run"], ["dashboard.serve", "executor.run"]),
  expectation("browser.assets", ["executor.run"], ["executor.run"]),
  expectation("config.valid", ["dashboard.serve", "executor.run"], ["dashboard.serve", "executor.run"]),
  expectation("filesystem.health", ["dashboard.serve", "executor.run"], ["dashboard.serve", "executor.run"]),
  expectation("authority.health", ["dashboard.serve", "executor.run"], ["dashboard.serve", "executor.run"]),
  expectation("ports.available", ["dashboard.serve"], ["dashboard.serve"]),
  expectation("fiscal.current", ["workflow.kuali-fill"], ["workflow.kuali-fill"]),
  expectation("secrets.ucpath-sso", [
    "system.ucpath.prod", "system.ucpath.test", "system.crm.prod", "system.crm.test",
    "system.onbase.prod", "system.onbase.test", "system.kuali.prod", "system.kuali.test",
    "system.servicenow.prod", "system.servicenow.test", "system.i9.prod", "system.i9.test",
    "system.new-kronos.prod", "system.new-kronos.test", "system.old-kronos.prod", "system.old-kronos.test",
  ], [
    "system.ucpath.prod", "system.ucpath.test", "system.crm.prod", "system.crm.test",
    "system.onbase.prod", "system.onbase.test", "system.kuali.prod", "system.kuali.test",
    "system.servicenow.prod", "system.servicenow.test", "system.i9.prod", "system.i9.test",
    "system.new-kronos.prod", "system.new-kronos.test", "system.old-kronos.prod", "system.old-kronos.test",
  ]),
  expectation("secrets.timekeeper", ["workflow.kuali-fill"], ["workflow.kuali-fill"]),
  expectation("secrets.sharepoint-roster", ["workflow.sharepoint-download", "system.sharepoint.prod", "system.sharepoint.test"], ["workflow.sharepoint-download", "system.sharepoint.prod", "system.sharepoint.test"]),
  expectation("capture.ingress", ["feature.capture"], ["feature.capture"]),
  expectation("process.orphans", ["dashboard.serve"], []),
  expectation("feature.ocr.providers", ["feature.ocr"], ["feature.ocr"]),
  expectation("feature.ai-advisory.providers", ["feature.ai-advisory"], ["feature.ai-advisory"]),
  ...systemExpectations(),
  ...providerExpectations(),
]));

const FeatureProviderExpansionSchema = z.strictObject({
  feature: z.enum(["feature.ocr", "feature.ai-advisory"]),
  providerChecks: PreflightCheckIdSchema.array().min(1),
  minimumHealthyProviders: z.number().int().positive(),
});
type FeatureProviderExpansion = z.infer<typeof FeatureProviderExpansionSchema>;

export const PREFLIGHT_FEATURE_PROVIDER_EXPANSIONS = deepFreeze(FeatureProviderExpansionSchema.array().parse([
  {
    feature: "feature.ocr",
    providerChecks: ProviderCapabilities.map((capability) => PreflightCheckIdSchema.parse(capability)),
    minimumHealthyProviders: 1,
  },
  {
    feature: "feature.ai-advisory",
    providerChecks: ProviderCapabilities.map((capability) => PreflightCheckIdSchema.parse(capability)),
    minimumHealthyProviders: 1,
  },
]));

function duplicateValues(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  return [...new Set(values.filter((value) => {
    if (seen.has(value)) return true;
    seen.add(value);
    return false;
  }))];
}

function expandedCapabilities(capabilities: readonly RuntimeCapability[]): ReadonlySet<RuntimeCapability> {
  const expanded = new Set(capabilities);
  for (const expansion of PREFLIGHT_FEATURE_PROVIDER_EXPANSIONS) {
    if (!expanded.has(expansion.feature)) continue;
    for (const providerCheck of expansion.providerChecks) {
      expanded.add(RuntimeCapabilitySchema.parse(providerCheck));
    }
  }
  return expanded;
}

export function expectedPreflightChecks(capabilities: readonly RuntimeCapability[]): readonly PreflightCheckSemanticExpectation[] {
  const expanded = expandedCapabilities(capabilities);
  return PREFLIGHT_CHECK_EXPECTATIONS.filter((check) => check.selectedFor.some((capability) => expanded.has(capability)));
}

export function preflightExpectation(check: PreflightCheckId): PreflightCheckSemanticExpectation | undefined {
  return PREFLIGHT_CHECK_EXPECTATIONS.find((expectation) => expectation.id === check);
}

export function mandatoryCapabilitiesForPreflightCheck(
  check: PreflightCheckId,
  requestedCapabilities: readonly RuntimeCapability[],
): readonly RuntimeCapability[] {
  const expectation = preflightExpectation(check);
  if (expectation === undefined) throw new Error(`unregistered preflight check ${check}`);
  return expectation.mandatoryFor.filter((capability) => requestedCapabilities.includes(capability));
}

export function providerChecksForFeature(feature: "feature.ocr" | "feature.ai-advisory"): readonly PreflightCheckId[] {
  const expansion = PREFLIGHT_FEATURE_PROVIDER_EXPANSIONS.find((candidate) => candidate.feature === feature);
  if (expansion === undefined) throw new Error(`preflight feature ${feature} has no provider expansion`);
  return expansion.providerChecks;
}

interface PreflightResultSemanticView {
  readonly status: "pass" | "warning" | "fail";
  readonly check: PreflightCheckId;
  readonly blocks?: readonly RuntimeCapability[];
}

interface PreflightReportSemanticView {
  readonly requestedCapabilities: readonly RuntimeCapability[];
  readonly results: readonly PreflightResultSemanticView[];
}

function issue(context: z.RefinementCtx, path: readonly (string | number)[], message: string): void {
  context.addIssue({ code: "custom", path: [...path], message });
}

/** Shared wire/server semantic check; structure is parsed by the owning wire first. */
export function validatePreflightReportSemantics(report: PreflightReportSemanticView, context: z.RefinementCtx): void {
  const registered = new Set(PREFLIGHT_CHECK_EXPECTATIONS.map(({ id }) => id));
  const expected = expectedPreflightChecks(report.requestedCapabilities);
  const expectedIds = new Set(expected.map(({ id }) => id));
  const resultByCheck = new Map(report.results.map((result) => [result.check, result]));

  for (const [index, result] of report.results.entries()) {
    if (!registered.has(result.check)) {
      issue(context, ["results", index, "check"], `unregistered preflight check ${result.check}`);
      continue;
    }
    if (!expectedIds.has(result.check)) {
      issue(context, ["results", index, "check"], `unrequested preflight check ${result.check}`);
    }
  }
  for (const expectation of expected) {
    if (!resultByCheck.has(expectation.id)) {
      issue(context, ["results"], `preflight report omits selected check ${expectation.id}`);
    }
  }
  if (report.results.length === expected.length) {
    for (const [index, expectation] of expected.entries()) {
      const actual = report.results[index];
      if (actual !== undefined && actual.check !== expectation.id) {
        issue(context, ["results", index, "check"], `preflight report check order expects ${expectation.id}, received ${actual.check}`);
      }
    }
  }

  for (const [index, result] of report.results.entries()) {
    const expectation = preflightExpectation(result.check);
    if (expectation === undefined) continue;
    const mandatory = mandatoryCapabilitiesForPreflightCheck(result.check, report.requestedCapabilities);
    if (result.status === "warning" && mandatory.length > 0) {
      issue(context, ["results", index, "status"], `blocking check ${result.check} cannot be a warning`);
    }
    if (result.status !== "fail") continue;
    const blocks = result.blocks;
    if (blocks === undefined) continue;
    const duplicateBlocks = duplicateValues(blocks);
    if (duplicateBlocks.length > 0) {
      issue(context, ["results", index, "blocks"], `blocks contain duplicates: ${duplicateBlocks.join(", ")}`);
    }
    for (const capability of blocks) {
      if (!report.requestedCapabilities.includes(capability)) {
        issue(context, ["results", index, "blocks"], `blocked capability ${capability} was not requested`);
      }
      if (!mandatory.includes(capability)) {
        issue(context, ["results", index, "blocks"], `check ${result.check} cannot block ${capability}`);
      }
    }
    for (const capability of mandatory) {
      if (!blocks.includes(capability)) {
        issue(context, ["results", index, "blocks"], `check ${result.check} omitted blocked capability ${capability}`);
      }
    }
    if (mandatory.length === 0) {
      issue(context, ["results", index, "status"], `optional check ${result.check} cannot fail`);
    } else if (blocks.length === mandatory.length && !blocks.every((capability, blockIndex) => capability === mandatory[blockIndex])) {
      issue(context, ["results", index, "blocks"], `check ${result.check} blocks are not in expected authority order`);
    }
  }

  for (const expansion of PREFLIGHT_FEATURE_PROVIDER_EXPANSIONS) {
    if (!report.requestedCapabilities.includes(expansion.feature)) continue;
    const providerResults = expansion.providerChecks
      .map((check) => resultByCheck.get(check))
      .filter((result): result is PreflightResultSemanticView => result !== undefined);
    const healthyProviders = providerResults.filter(({ status }) => status === "pass").length;
    const featureResult = resultByCheck.get(PreflightCheckIdSchema.parse(`${expansion.feature}.providers`));
    if (featureResult !== undefined && (featureResult.status === "pass") !== (healthyProviders >= expansion.minimumHealthyProviders)) {
      issue(
        context,
        ["results"],
        `${expansion.feature} provider-set result contradicts ${String(healthyProviders)} healthy provider result(s)`,
      );
    }
  }
}

interface RuntimeCheckSemanticView {
  readonly id: PreflightCheckId;
  readonly severity: "warning" | "error";
  readonly capabilities: readonly RuntimeCapability[];
}

interface RuntimeDependencySemanticView {
  readonly check: PreflightCheckId;
  readonly requirement: "blocking" | "optional";
  readonly capabilities: readonly RuntimeCapability[];
}

interface RuntimeFeatureSemanticView {
  readonly feature: "feature.ocr" | "feature.ai-advisory";
  readonly check: PreflightCheckId;
  readonly minimumHealthyProviders: number;
  readonly providerCapability: string;
}

interface RuntimeProviderSemanticView {
  readonly provider: string;
  readonly capabilities: readonly string[];
}

interface PreflightSemanticRegistryView {
  readonly checks: readonly RuntimeCheckSemanticView[];
  readonly dependencies: readonly RuntimeDependencySemanticView[];
  readonly features: readonly RuntimeFeatureSemanticView[];
  readonly providers: readonly RuntimeProviderSemanticView[];
}

function sameOrderedValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Ensures the Node-only runtime registry cannot drift from browser-safe semantics in either direction. */
export function auditPreflightSemanticRegistry(registry: PreflightSemanticRegistryView): readonly string[] {
  const violations: string[] = [];
  const checks = new Map(registry.checks.map((check) => [check.id, check]));
  const expectations = new Map(PREFLIGHT_CHECK_EXPECTATIONS.map((expectation) => [expectation.id, expectation]));
  for (const expectation of PREFLIGHT_CHECK_EXPECTATIONS) {
    const check = checks.get(expectation.id);
    if (check === undefined) {
      violations.push(`preflight registry omits semantic check ${expectation.id}`);
      continue;
    }
    const expectedSeverity = expectation.mandatoryFor.length === 0 ? "warning" : "error";
    if (check.severity !== expectedSeverity) {
      violations.push(`preflight check ${expectation.id} severity ${check.severity} contradicts ${expectedSeverity}`);
    }
    if (!sameOrderedValues(check.capabilities, expectation.selectedFor)) {
      violations.push(`preflight check ${expectation.id} capabilities contradict semantic selection`);
    }
    const blocking = [...new Set(registry.dependencies
      .filter((dependency) => dependency.check === expectation.id && dependency.requirement === "blocking")
      .flatMap((dependency) => dependency.capabilities))];
    if (!sameOrderedValues(blocking, expectation.mandatoryFor)) {
      violations.push(`preflight check ${expectation.id} blocking authority contradicts semantic mandatory capabilities`);
    }
  }
  for (const check of registry.checks) {
    if (!expectations.has(check.id)) {
      violations.push(`preflight registry names unmodeled semantic check ${check.id}`);
    }
  }
  for (const expansion of PREFLIGHT_FEATURE_PROVIDER_EXPANSIONS) {
    const feature = registry.features.find((candidate) => candidate.feature === expansion.feature);
    if (feature === undefined) {
      violations.push(`preflight registry omits semantic feature ${expansion.feature}`);
      continue;
    }
    if (feature.check !== `${expansion.feature}.providers`) {
      violations.push(`preflight feature ${expansion.feature} check contradicts semantic feature check`);
    }
    if (feature.minimumHealthyProviders !== expansion.minimumHealthyProviders) {
      violations.push(`preflight feature ${expansion.feature} minimum healthy providers contradicts semantic expectation`);
    }
    const providerChecks = registry.providers
      .filter((provider) => provider.capabilities.includes(feature.providerCapability))
      .map((provider) => PreflightCheckIdSchema.parse(`provider.${provider.provider}`));
    if (!sameOrderedValues(providerChecks, expansion.providerChecks)) {
      violations.push(`preflight feature ${expansion.feature} provider authority contradicts semantic expansion`);
    }
  }
  for (const feature of registry.features) {
    if (!PREFLIGHT_FEATURE_PROVIDER_EXPANSIONS.some((expectation) => expectation.feature === feature.feature)) {
      violations.push(`preflight registry names unmodeled semantic feature ${feature.feature}`);
    }
  }
  return violations;
}
