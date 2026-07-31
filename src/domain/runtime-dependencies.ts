import { z } from "zod";
import { CONFIG_ROUTE_KEYS } from "./config/schema.js";
import { deepFreeze } from "./immutability.js";
import {
  RUNTIME_ENVIRONMENT_REGISTRY,
  RuntimeEnvironmentRegistrySchema,
  auditRuntimeEnvironmentInventory,
} from "./runtime-environment.js";
import {
  BrowserSystemIdSchema,
  ProviderCapabilityIdSchema,
  ScenarioIdSchema,
} from "./ids.js";
import {
  SECRET_FAMILY_SPECS,
  SECRET_FILE_SPECS,
  SECRET_SPECS,
  SecretFamilyNameSchema,
  SecretFileNameSchema,
  SecretNameSchema,
} from "./secrets.js";
import {
  PREFLIGHT_SCENARIO_MANIFESTS,
  PreflightScenarioIdSchema,
} from "./trust/preflight-scenarios.js";

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
export const RuntimeDependencyIdSchema = z.string()
  .regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/)
  .brand<"RuntimeDependencyId">();
export { PreflightScenarioIdSchema } from "./trust/preflight-scenarios.js";

export const RuntimeConsumerIdSchema = z.enum([
  "runtime-composition",
  "system-driver",
  "provider-adapter",
  "workflow-enqueue",
  "dashboard-startup",
  "settings-health",
  "cli-doctor",
  "test-login",
  "capture-session",
  "authority-storage",
  "artifact-storage",
  "recovery-service",
]);
export const RuntimeConsumerSpecSchema = z.strictObject({
  id: RuntimeConsumerIdSchema,
  kind: z.enum(["composition", "driver", "adapter", "command", "projection", "storage", "recovery"]),
  owner: z.string().regex(/^src\/[a-z0-9/_-]+$/),
});
export const RUNTIME_CONSUMERS = deepFreeze(RuntimeConsumerSpecSchema.array().parse([
  { id: "runtime-composition", kind: "composition", owner: "src/core" },
  { id: "system-driver", kind: "driver", owner: "src/stores" },
  { id: "provider-adapter", kind: "adapter", owner: "src/infra/providers" },
  { id: "workflow-enqueue", kind: "command", owner: "src/control" },
  { id: "dashboard-startup", kind: "composition", owner: "src/server" },
  { id: "settings-health", kind: "projection", owner: "src/server/dashboard" },
  { id: "cli-doctor", kind: "projection", owner: "src/cli" },
  { id: "test-login", kind: "command", owner: "src/control" },
  { id: "capture-session", kind: "command", owner: "src/control/capture" },
  { id: "authority-storage", kind: "storage", owner: "src/infra/sqlite" },
  { id: "artifact-storage", kind: "storage", owner: "src/infra/artifacts" },
  { id: "recovery-service", kind: "recovery", owner: "src/control/recovery" },
]));

const SystemConfigKeySchema = z.enum([
  "ucpath",
  "crm",
  "onbase",
  "kuali",
  "servicenow",
  "i9",
  "newKronos",
  "oldKronos",
  "sharepoint",
]);
const SystemCredentialSchema = z.enum(["ucpath-sso", "sharepoint-url"]);

const SYSTEM_CONFIG_KEY_BY_ID = {
  ucpath: "ucpath",
  crm: "crm",
  onbase: "onbase",
  kuali: "kuali",
  servicenow: "servicenow",
  i9: "i9",
  "new-kronos": "newKronos",
  "old-kronos": "oldKronos",
  sharepoint: "sharepoint",
} as const satisfies Record<z.infer<typeof BrowserSystemIdSchema>, z.infer<typeof SystemConfigKeySchema>>;

const SYSTEM_CREDENTIAL_BY_ID = {
  ucpath: "ucpath-sso",
  crm: "ucpath-sso",
  onbase: "ucpath-sso",
  kuali: "ucpath-sso",
  servicenow: "ucpath-sso",
  i9: "ucpath-sso",
  "new-kronos": "ucpath-sso",
  "old-kronos": "ucpath-sso",
  sharepoint: "sharepoint-url",
} as const satisfies Record<z.infer<typeof BrowserSystemIdSchema>, z.infer<typeof SystemCredentialSchema>>;

export const SystemRuntimeSpecSchema = z.strictObject({
  system: BrowserSystemIdSchema,
  configKey: SystemConfigKeySchema,
  routes: z.array(z.string().regex(/^[a-z][A-Za-z0-9]*$/)).min(1),
  credential: SystemCredentialSchema,
  consumer: RuntimeConsumerIdSchema,
});

export const SYSTEM_RUNTIME_SPECS = deepFreeze(SystemRuntimeSpecSchema.array().parse([
  { system: "ucpath", configKey: "ucpath", routes: ["smartHr", "jobSummary", "personalData", "personProfile"], credential: "ucpath-sso", consumer: "system-driver" },
  { system: "crm", configKey: "crm", routes: ["entry", "onboardingSearch", "ucPathEntrySheet", "onboardingHistory", "idocsViewer"], credential: "ucpath-sso", consumer: "system-driver" },
  { system: "onbase", configKey: "onbase", routes: ["entry"], credential: "ucpath-sso", consumer: "system-driver" },
  { system: "kuali", configKey: "kuali", routes: ["entry"], credential: "ucpath-sso", consumer: "system-driver" },
  { system: "servicenow", configKey: "servicenow", routes: ["entry"], credential: "ucpath-sso", consumer: "system-driver" },
  { system: "i9", configKey: "i9", routes: ["entry", "app"], credential: "ucpath-sso", consumer: "system-driver" },
  { system: "new-kronos", configKey: "newKronos", routes: ["entry"], credential: "ucpath-sso", consumer: "system-driver" },
  { system: "old-kronos", configKey: "oldKronos", routes: ["entry"], credential: "ucpath-sso", consumer: "system-driver" },
  { system: "sharepoint", configKey: "sharepoint", routes: ["entry"], credential: "sharepoint-url", consumer: "system-driver" },
]));

export const ProviderIdSchema = z.enum(["gemini", "groq", "mistral", "openrouter", "sambanova", "census", "nominatim"]);

export const ProviderAdapterSpecSchema = z.strictObject({
  provider: ProviderIdSchema,
  capabilities: z.array(ProviderCapabilityIdSchema).min(1),
  endpoint: z.url(),
  secretFamily: SecretFamilyNameSchema.optional(),
  modelsEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/).optional(),
  legacyModelEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/).optional(),
  consumer: RuntimeConsumerIdSchema,
});

export const PROVIDER_ADAPTER_SPECS = deepFreeze(ProviderAdapterSpecSchema.array().parse([
  { provider: "gemini", capabilities: ["ocr.extract", "ai.advisory"], endpoint: "https://generativelanguage.googleapis.com/v1beta", secretFamily: "geminiApiKeys", modelsEnv: "OCR_GEMINI_MODELS", legacyModelEnv: "OCR_GEMINI_MODEL", consumer: "provider-adapter" },
  { provider: "groq", capabilities: ["ocr.extract", "ai.advisory"], endpoint: "https://api.groq.com/openai/v1/chat/completions", secretFamily: "groqApiKeys", modelsEnv: "OCR_GROQ_MODELS", legacyModelEnv: "OCR_GROQ_MODEL", consumer: "provider-adapter" },
  { provider: "mistral", capabilities: ["ocr.extract", "ai.advisory"], endpoint: "https://api.mistral.ai/v1/chat/completions", secretFamily: "mistralApiKeys", modelsEnv: "OCR_MISTRAL_MODELS", legacyModelEnv: "OCR_MISTRAL_MODEL", consumer: "provider-adapter" },
  { provider: "openrouter", capabilities: ["ocr.extract", "ai.advisory"], endpoint: "https://openrouter.ai/api/v1/chat/completions", secretFamily: "openRouterApiKeys", modelsEnv: "OCR_OPENROUTER_MODELS", legacyModelEnv: "OCR_OPENROUTER_MODEL", consumer: "provider-adapter" },
  { provider: "sambanova", capabilities: ["ocr.extract", "ai.advisory"], endpoint: "https://api.sambanova.ai/v1/chat/completions", secretFamily: "sambaNovaApiKeys", modelsEnv: "OCR_SAMBANOVA_MODELS", legacyModelEnv: "OCR_SAMBANOVA_MODEL", consumer: "provider-adapter" },
  { provider: "census", capabilities: ["geocode.census"], endpoint: "https://geocoding.geo.census.gov/geocoder/locations", consumer: "provider-adapter" },
  { provider: "nominatim", capabilities: ["geocode.nominatim"], endpoint: "https://nominatim.openstreetmap.org/search", consumer: "provider-adapter" },
]));

const ProviderBackedFeatureCapabilitySchema = z.enum(["feature.ocr", "feature.ai-advisory"]);

export const FeatureRuntimeSpecSchema = z.strictObject({
  feature: ProviderBackedFeatureCapabilitySchema,
  providerCapability: ProviderCapabilityIdSchema,
  dependency: RuntimeDependencyIdSchema,
  check: PreflightCheckIdSchema,
  minimumHealthyProviders: z.number().int().positive(),
  consumer: RuntimeConsumerIdSchema,
  scenario: PreflightScenarioIdSchema,
  justification: z.string().min(1),
});

export const FEATURE_RUNTIME_SPECS = deepFreeze(FeatureRuntimeSpecSchema.array().parse([
  {
    feature: "feature.ocr",
    providerCapability: "ocr.extract",
    dependency: "feature.ocr-provider-set",
    check: "feature.ocr.providers",
    minimumHealthyProviders: 1,
    consumer: "workflow-enqueue",
    scenario: "preflight/ocr-provider-unavailable",
    justification: "OCR execution requires at least one registered extraction provider, while each provider cell remains globally optional.",
  },
  {
    feature: "feature.ai-advisory",
    providerCapability: "ai.advisory",
    dependency: "feature.ai-advisory-provider-set",
    check: "feature.ai-advisory.providers",
    minimumHealthyProviders: 1,
    consumer: "workflow-enqueue",
    scenario: "preflight/ai-provider-unavailable",
    justification: "A descriptor selecting advisory AI requires at least one registered advisory provider, without making AI a dashboard boot prerequisite.",
  },
]));

export const RuntimeDependencySpecSchema = z.strictObject({
  id: RuntimeDependencyIdSchema,
  kind: z.enum(["runtime", "browser", "config", "path", "storage", "port", "endpoint", "secret", "provider", "feature", "process"]),
  requirement: z.enum(["blocking", "optional"]),
  capabilities: z.array(RuntimeCapabilitySchema).min(1),
  check: PreflightCheckIdSchema,
  consumer: RuntimeConsumerIdSchema,
  scenario: PreflightScenarioIdSchema,
  justification: z.string().min(1),
  secretNames: z.array(SecretNameSchema).optional(),
  secretFamilies: z.array(SecretFamilyNameSchema).optional(),
  secretFiles: z.array(SecretFileNameSchema).optional(),
});

function endpointDependencies() {
  return SYSTEM_RUNTIME_SPECS.flatMap(({ system, consumer }) => ([
    {
      id: `endpoint.${system}.prod`,
      kind: "endpoint",
      requirement: "blocking",
      capabilities: [`system.${system}.prod`],
      check: `endpoint.${system}.prod`,
      consumer,
      scenario: "preflight/endpoint-prod",
      justification: `the ${system} production driver requires its complete registered production route set`,
    },
    {
      id: `endpoint.${system}.test`,
      kind: "endpoint",
      requirement: "blocking",
      capabilities: [`system.${system}.test`],
      check: `endpoint.${system}.test`,
      consumer,
      scenario: "preflight/endpoint-test",
      justification: `an explicitly selected ${system} test instance requires a complete route set distinct from production`,
    },
  ]));
}

function providerDependencies() {
  return PROVIDER_ADAPTER_SPECS.map(({ provider, consumer, secretFamily }) => ({
    id: `provider.${provider}`,
    kind: "provider",
    requirement: "optional",
    capabilities: [`provider.${provider}`],
    check: `provider.${provider}`,
    consumer,
    scenario: "preflight/provider-unavailable",
    justification: `${provider} is an optional provider cell and becomes relevant only through an explicitly selected provider-backed feature`,
    ...(secretFamily === undefined ? {} : { secretFamilies: [secretFamily] }),
  }));
}

function featureDependencies() {
  return FEATURE_RUNTIME_SPECS.map((feature) => ({
    id: feature.dependency,
    kind: "feature",
    requirement: "blocking",
    capabilities: [feature.feature],
    check: feature.check,
    consumer: feature.consumer,
    scenario: feature.scenario,
    justification: feature.justification,
  }));
}

export const RUNTIME_DEPENDENCIES = deepFreeze(RuntimeDependencySpecSchema.array().parse([
  { id: "runtime.node", kind: "runtime", requirement: "blocking", capabilities: ["dashboard.serve", "executor.run"], check: "runtime.compatibility", consumer: "runtime-composition", scenario: "preflight/runtime-mismatch", justification: "both runtime surfaces require the pinned Node engine" },
  { id: "runtime.package-lock", kind: "runtime", requirement: "blocking", capabilities: ["dashboard.serve", "executor.run"], check: "runtime.compatibility", consumer: "runtime-composition", scenario: "preflight/runtime-mismatch", justification: "both runtime surfaces require dependencies matching the reviewed package lock" },
  { id: "browser.chromium", kind: "browser", requirement: "blocking", capabilities: ["executor.run"], check: "browser.assets", consumer: "system-driver", scenario: "preflight/browser-missing", justification: "executor tasks cannot launch their isolated browser without Chromium" },
  { id: "browser.duo-extension", kind: "browser", requirement: "blocking", capabilities: ["executor.run"], check: "browser.assets", consumer: "system-driver", scenario: "preflight/browser-missing", justification: "authenticated executor tasks require the registered isolated Duo credential asset", secretFiles: ["duoWebauthnCredential"] },
  { id: "config.resolved", kind: "config", requirement: "blocking", capabilities: ["dashboard.serve", "executor.run"], check: "config.valid", consumer: "runtime-composition", scenario: "preflight/config-invalid", justification: "dashboard and executor decisions require one strict resolved config snapshot" },
  { id: "path.state", kind: "path", requirement: "blocking", capabilities: ["dashboard.serve", "executor.run"], check: "filesystem.health", consumer: "authority-storage", scenario: "preflight/low-disk", justification: "runtime authority requires a writable isolated state root" },
  { id: "path.artifact", kind: "path", requirement: "blocking", capabilities: ["dashboard.serve", "executor.run"], check: "filesystem.health", consumer: "artifact-storage", scenario: "preflight/low-disk", justification: "runtime evidence requires a writable isolated artifact root" },
  { id: "storage.disk-space", kind: "storage", requirement: "blocking", capabilities: ["dashboard.serve", "executor.run"], check: "filesystem.health", consumer: "authority-storage", scenario: "preflight/low-disk", justification: "authority and evidence writes must not start without sufficient disk capacity" },
  { id: "storage.sqlite", kind: "storage", requirement: "blocking", capabilities: ["dashboard.serve", "executor.run"], check: "authority.health", consumer: "authority-storage", scenario: "preflight/corrupt-db", justification: "dashboard projections and executor transitions both depend on valid authority state" },
  { id: "storage.backup", kind: "storage", requirement: "blocking", capabilities: ["executor.run"], check: "authority.health", consumer: "recovery-service", scenario: "preflight/corrupt-db", justification: "write-capable execution requires a verified recovery path" },
  { id: "port.backend", kind: "port", requirement: "blocking", capabilities: ["dashboard.serve"], check: "ports.available", consumer: "dashboard-startup", scenario: "preflight/port-busy", justification: "the isolated dashboard backend cannot serve on an occupied reserved port" },
  { id: "port.frontend", kind: "port", requirement: "blocking", capabilities: ["dashboard.serve"], check: "ports.available", consumer: "dashboard-startup", scenario: "preflight/port-busy", justification: "the isolated dashboard frontend cannot serve on an occupied reserved port" },
  { id: "fiscal.current", kind: "config", requirement: "blocking", capabilities: ["workflow.kuali-fill"], check: "fiscal.current", consumer: "workflow-enqueue", scenario: "preflight/fiscal-stale", justification: "Kuali date fills require the current fiscal-year values and must never reuse stale dates" },
  { id: "secret.ucpath-sso", kind: "secret", requirement: "blocking", capabilities: ["system.ucpath.prod", "system.ucpath.test", "system.crm.prod", "system.crm.test", "system.onbase.prod", "system.onbase.test", "system.kuali.prod", "system.kuali.test", "system.servicenow.prod", "system.servicenow.test", "system.i9.prod", "system.i9.test", "system.new-kronos.prod", "system.new-kronos.test", "system.old-kronos.prod", "system.old-kronos.test"], check: "secrets.ucpath-sso", consumer: "workflow-enqueue", scenario: "preflight/workflow-secret-missing", justification: "selected SSO-backed system instances require both UCPath SSO credential fields", secretNames: ["ucpathUserId", "ucpathPassword"] },
  { id: "secret.timekeeper", kind: "secret", requirement: "blocking", capabilities: ["workflow.kuali-fill"], check: "secrets.timekeeper", consumer: "workflow-enqueue", scenario: "preflight/workflow-secret-missing", justification: "Kuali fill descriptors require an operator timekeeper identity", secretNames: ["timekeeperName"] },
  { id: "secret.sharepoint-roster", kind: "secret", requirement: "blocking", capabilities: ["workflow.sharepoint-download", "system.sharepoint.prod", "system.sharepoint.test"], check: "secrets.sharepoint-roster", consumer: "workflow-enqueue", scenario: "preflight/workflow-secret-missing", justification: "the selected roster download requires its registered SharePoint source URL", secretNames: ["sharepointOnboardingRosterUrl"] },
  { id: "capture.ingress", kind: "feature", requirement: "blocking", capabilities: ["feature.capture"], check: "capture.ingress", consumer: "capture-session", scenario: "preflight/capture-unavailable", justification: "a selected capture session requires a usable configured forwarded ingress or an on-demand ngrok credential", secretNames: ["ngrokCredential"] },
  { id: "process.orphans", kind: "process", requirement: "optional", capabilities: ["dashboard.serve"], check: "process.orphans", consumer: "cli-doctor", scenario: "preflight/orphan-process", justification: "stale processes are operator-visible health debt but do not make authority unreadable" },
  ...featureDependencies(),
  ...endpointDependencies(),
  ...providerDependencies(),
]));

export const PreflightCheckSpecSchema = z.strictObject({
  id: PreflightCheckIdSchema,
  scope: z.enum(["dashboard", "executor", "workflow", "system", "feature"]),
  severity: z.enum(["warning", "error"]),
  runner: z.enum(["pure", "io"]),
  dependencies: z.array(RuntimeDependencyIdSchema).min(1),
  capabilities: z.array(RuntimeCapabilitySchema).min(1),
  consumer: RuntimeConsumerIdSchema,
  scenarios: z.array(PreflightScenarioIdSchema).min(1),
  timeoutMs: z.number().int().positive(),
  redaction: z.enum(["safe-summary", "path-basename", "presence-only"]),
  remediation: z.string().min(1),
});

function endpointChecks() {
  return SYSTEM_RUNTIME_SPECS.flatMap(({ system, consumer }) => (["prod", "test"] as const).map((instance) => ({
    id: `endpoint.${system}.${instance}`,
    scope: "system",
    severity: "error",
    runner: "pure",
    dependencies: [`endpoint.${system}.${instance}`],
    capabilities: [`system.${system}.${instance}`],
    consumer,
    scenarios: [`preflight/endpoint-${instance}`],
    timeoutMs: 1_000,
    redaction: "safe-summary",
    remediation: instance === "prod" ? "repair the registered production endpoint" : "configure a complete test route set distinct from production",
  })));
}

function providerChecks() {
  return PROVIDER_ADAPTER_SPECS.map(({ provider, consumer }) => ({
    id: `provider.${provider}`,
    scope: "feature",
    severity: "warning",
    runner: "pure",
    dependencies: [`provider.${provider}`],
    capabilities: [`provider.${provider}`],
    consumer,
    scenarios: ["preflight/provider-unavailable"],
    timeoutMs: 1_000,
    redaction: "presence-only",
    remediation: "configure a registered provider cell or leave the optional capability unavailable",
  }));
}

function providersForFeature(feature: z.infer<typeof FeatureRuntimeSpecSchema>) {
  return PROVIDER_ADAPTER_SPECS
    .filter(({ capabilities }) => capabilities.includes(feature.providerCapability))
    .map(({ provider }) => `provider.${provider}`);
}

function featureChecks() {
  return FEATURE_RUNTIME_SPECS.map((feature) => ({
    id: feature.check,
    scope: "feature",
    severity: "error",
    runner: "pure",
    dependencies: [feature.dependency, ...providersForFeature(feature)],
    capabilities: [feature.feature],
    consumer: feature.consumer,
    scenarios: [feature.scenario],
    timeoutMs: 1_000,
    redaction: "presence-only",
    remediation: `configure at least ${String(feature.minimumHealthyProviders)} registered provider cell for ${feature.providerCapability}`,
  }));
}

export const PREFLIGHT_CHECKS = deepFreeze(PreflightCheckSpecSchema.array().parse([
  { id: "runtime.compatibility", scope: "dashboard", severity: "error", runner: "io", dependencies: ["runtime.node", "runtime.package-lock"], capabilities: ["dashboard.serve", "executor.run"], consumer: "runtime-composition", scenarios: ["preflight/runtime-mismatch"], timeoutMs: 1_000, redaction: "safe-summary", remediation: "install the pinned Node and package-lock dependencies" },
  { id: "browser.assets", scope: "executor", severity: "error", runner: "io", dependencies: ["browser.chromium", "browser.duo-extension"], capabilities: ["executor.run"], consumer: "system-driver", scenarios: ["preflight/browser-missing"], timeoutMs: 5_000, redaction: "path-basename", remediation: "install Chromium and the registered Duo extension asset" },
  { id: "config.valid", scope: "dashboard", severity: "error", runner: "pure", dependencies: ["config.resolved"], capabilities: ["dashboard.serve", "executor.run"], consumer: "runtime-composition", scenarios: ["preflight/config-invalid"], timeoutMs: 1_000, redaction: "safe-summary", remediation: "repair the strict settings/config input" },
  { id: "filesystem.health", scope: "dashboard", severity: "error", runner: "io", dependencies: ["path.state", "path.artifact", "storage.disk-space"], capabilities: ["dashboard.serve", "executor.run"], consumer: "authority-storage", scenarios: ["preflight/low-disk"], timeoutMs: 5_000, redaction: "path-basename", remediation: "repair rebuild directory permissions or free disk space" },
  { id: "authority.health", scope: "dashboard", severity: "error", runner: "io", dependencies: ["storage.sqlite", "storage.backup"], capabilities: ["dashboard.serve", "executor.run"], consumer: "authority-storage", scenarios: ["preflight/corrupt-db"], timeoutMs: 10_000, redaction: "path-basename", remediation: "run the explicit authority recovery procedure" },
  { id: "ports.available", scope: "dashboard", severity: "error", runner: "io", dependencies: ["port.backend", "port.frontend"], capabilities: ["dashboard.serve"], consumer: "dashboard-startup", scenarios: ["preflight/port-busy"], timeoutMs: 1_000, redaction: "safe-summary", remediation: "free the reserved rebuild ports" },
  { id: "fiscal.current", scope: "workflow", severity: "error", runner: "pure", dependencies: ["fiscal.current"], capabilities: ["workflow.kuali-fill"], consumer: "workflow-enqueue", scenarios: ["preflight/fiscal-stale"], timeoutMs: 1_000, redaction: "safe-summary", remediation: "configure a non-stale current-fiscal-year entry" },
  { id: "secrets.ucpath-sso", scope: "system", severity: "error", runner: "pure", dependencies: ["secret.ucpath-sso"], capabilities: ["system.ucpath.prod", "system.ucpath.test", "system.crm.prod", "system.crm.test", "system.onbase.prod", "system.onbase.test", "system.kuali.prod", "system.kuali.test", "system.servicenow.prod", "system.servicenow.test", "system.i9.prod", "system.i9.test", "system.new-kronos.prod", "system.new-kronos.test", "system.old-kronos.prod", "system.old-kronos.test"], consumer: "workflow-enqueue", scenarios: ["preflight/workflow-secret-missing"], timeoutMs: 1_000, redaction: "presence-only", remediation: "configure UCPATH_USER_ID and UCPATH_PASSWORD" },
  { id: "secrets.timekeeper", scope: "workflow", severity: "error", runner: "pure", dependencies: ["secret.timekeeper"], capabilities: ["workflow.kuali-fill"], consumer: "workflow-enqueue", scenarios: ["preflight/workflow-secret-missing"], timeoutMs: 1_000, redaction: "presence-only", remediation: "configure TIMEKEEPER_NAME" },
  { id: "secrets.sharepoint-roster", scope: "workflow", severity: "error", runner: "pure", dependencies: ["secret.sharepoint-roster"], capabilities: ["workflow.sharepoint-download", "system.sharepoint.prod", "system.sharepoint.test"], consumer: "workflow-enqueue", scenarios: ["preflight/workflow-secret-missing"], timeoutMs: 1_000, redaction: "presence-only", remediation: "configure ONBOARDING_ROSTER_URL" },
  { id: "capture.ingress", scope: "feature", severity: "error", runner: "io", dependencies: ["capture.ingress"], capabilities: ["feature.capture"], consumer: "capture-session", scenarios: ["preflight/capture-unavailable"], timeoutMs: 5_000, redaction: "safe-summary", remediation: "configure the selected forwarded ingress or install/configure ngrok" },
  { id: "process.orphans", scope: "dashboard", severity: "warning", runner: "io", dependencies: ["process.orphans"], capabilities: ["dashboard.serve"], consumer: "cli-doctor", scenarios: ["preflight/orphan-process"], timeoutMs: 2_000, redaction: "safe-summary", remediation: "review and explicitly clear stale rebuild processes or leases" },
  ...featureChecks(),
  ...endpointChecks(),
  ...providerChecks(),
]));

export const RuntimeDependencyRegistrySchema = z.strictObject({
  environment: RuntimeEnvironmentRegistrySchema,
  consumers: z.array(RuntimeConsumerSpecSchema).min(1),
  scenarios: z.array(ScenarioIdSchema).min(1),
  systems: z.array(SystemRuntimeSpecSchema).min(1),
  providers: z.array(ProviderAdapterSpecSchema).min(1),
  features: z.array(FeatureRuntimeSpecSchema).min(1),
  dependencies: z.array(RuntimeDependencySpecSchema).min(1),
  checks: z.array(PreflightCheckSpecSchema).min(1),
});

export const RUNTIME_DEPENDENCY_REGISTRY = deepFreeze(RuntimeDependencyRegistrySchema.parse({
  environment: RUNTIME_ENVIRONMENT_REGISTRY,
  consumers: RUNTIME_CONSUMERS,
  scenarios: PREFLIGHT_SCENARIO_MANIFESTS.map(({ id }) => id),
  systems: SYSTEM_RUNTIME_SPECS,
  providers: PROVIDER_ADAPTER_SPECS,
  features: FEATURE_RUNTIME_SPECS,
  dependencies: RUNTIME_DEPENDENCIES,
  checks: PREFLIGHT_CHECKS,
}));

function duplicateValues(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  return [...new Set(values.filter((value) => {
    if (seen.has(value)) return true;
    seen.add(value);
    return false;
  }))];
}

function sameMembers(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

export function auditRuntimeDependencyCoverage(input: unknown): readonly string[] {
  const parsed = RuntimeDependencyRegistrySchema.safeParse(input);
  if (!parsed.success) return ["runtime dependency registry failed strict parsing"];
  const registry = parsed.data;
  const violations: string[] = [];
  violations.push(...auditRuntimeEnvironmentInventory(registry.environment));
  const unique = (values: readonly string[], label: string): void => {
    const duplicates = duplicateValues(values);
    if (duplicates.length > 0) violations.push(`${label} contains duplicates: ${duplicates.join(", ")}`);
  };
  unique(registry.systems.map(({ system }) => system), "systems");
  unique(registry.systems.map(({ configKey }) => configKey), "system config keys");
  unique(registry.providers.map(({ provider }) => provider), "providers");
  unique(registry.features.map(({ feature }) => feature), "provider-backed features");
  unique(registry.dependencies.map(({ id }) => id), "dependencies");
  unique(registry.checks.map(({ id }) => id), "checks");
  unique(registry.consumers.map(({ id }) => id), "consumers");
  unique(registry.scenarios, "scenarios");

  const registeredConsumers = new Set(registry.consumers.map(({ id }) => id));
  for (const consumer of RuntimeConsumerIdSchema.options) {
    if (!registeredConsumers.has(consumer)) violations.push(`runtime consumer ${consumer} has no registered owner`);
  }
  const canonicalScenarios = new Set(PREFLIGHT_SCENARIO_MANIFESTS.map(({ id }) => id));
  const registeredScenarioIds = new Set<string>(registry.scenarios);
  for (const scenario of registry.scenarios) {
    if (!canonicalScenarios.has(scenario)) violations.push(`preflight scenario ${scenario} has no ScenarioManifest`);
  }
  for (const scenario of canonicalScenarios) {
    if (!registry.scenarios.includes(scenario)) violations.push(`ScenarioManifest ${scenario} is absent from the runtime registry`);
  }

  const systems = new Map(registry.systems.map((system) => [system.system, system]));
  for (const system of BrowserSystemIdSchema.options) {
    const spec = systems.get(system);
    if (spec === undefined) {
      violations.push(`system ${system} has no runtime spec`);
      continue;
    }
    const expectedConfigKey = SYSTEM_CONFIG_KEY_BY_ID[system];
    if (spec.configKey !== expectedConfigKey) {
      violations.push(`system ${system} maps to ${spec.configKey}, expected ConfigSchema urls.${expectedConfigKey}`);
    }
    // Named `credentialId`, not `credential`: this holds a SystemCredentialId,
    // and the redaction canary (`no-secret-values-in-logs`) reads binding names
    // to decide what may be interpolated into a diagnostic. A binding whose name
    // claims to be a credential must never be spliced into a message, so the
    // name has to say that it is an identifier.
    const credentialId = spec.credential;
    if (credentialId !== SYSTEM_CREDENTIAL_BY_ID[system]) {
      violations.push(`system ${system} uses credential ${credentialId}, expected ${SYSTEM_CREDENTIAL_BY_ID[system]}`);
    }
    const configRoutes: readonly string[] = CONFIG_ROUTE_KEYS[expectedConfigKey];
    unique(spec.routes, `system ${system} routes`);
    for (const route of spec.routes) {
      if (!configRoutes.includes(route)) violations.push(`system ${system} names unknown ConfigSchema route ${route}`);
    }
    for (const route of configRoutes) {
      if (!spec.routes.includes(route)) violations.push(`system ${system} omits ConfigSchema route ${route}`);
    }
    for (const instance of ["prod", "test"] as const) {
      if (!registry.dependencies.some(({ id }) => id === `endpoint.${system}.${instance}`)) {
        violations.push(`system ${system} has no ${instance} endpoint dependency`);
      }
    }
  }
  for (const configKey of Object.keys(CONFIG_ROUTE_KEYS)) {
    if (!registry.systems.some((system) => system.configKey === configKey)) {
      violations.push(`ConfigSchema route family ${configKey} has no system runtime consumer`);
    }
  }

  const providerCapabilities = new Set(registry.providers.flatMap(({ capabilities }) => capabilities));
  const providersById = new Map(registry.providers.map((provider) => [provider.provider, provider]));
  for (const provider of ProviderIdSchema.options) {
    if (!providersById.has(provider)) violations.push(`provider ${provider} has no adapter or explicit target disposition`);
  }
  for (const capability of ProviderCapabilityIdSchema.options) {
    if (!providerCapabilities.has(capability)) violations.push(`provider capability ${capability} has no adapter`);
  }
  for (const provider of registry.providers) {
    unique(provider.capabilities, `provider ${provider.provider} capabilities`);
    const family = provider.secretFamily === undefined
      ? undefined
      : SECRET_FAMILY_SPECS.find(({ name }) => name === provider.secretFamily);
    if (family === undefined && provider.secretFamily !== undefined) {
      violations.push(`provider ${provider.provider} names unknown secret family ${provider.secretFamily}`);
    } else if (family !== undefined) {
      if (provider.modelsEnv !== family.modelsEnv) {
        violations.push(`provider ${provider.provider} models env ${String(provider.modelsEnv)} does not match secret inventory ${family.modelsEnv}`);
      }
      if (provider.legacyModelEnv !== family.legacyModelEnv) {
        violations.push(`provider ${provider.provider} legacy model env ${String(provider.legacyModelEnv)} does not match secret inventory ${family.legacyModelEnv}`);
      }
    }
    const needsModelInventory = provider.capabilities.some((capability) => capability === "ocr.extract" || capability === "ai.advisory");
    if (needsModelInventory && family === undefined) violations.push(`provider ${provider.provider} has no key-family/model-env inventory`);
    if (!needsModelInventory && (provider.secretFamily !== undefined || provider.modelsEnv !== undefined || provider.legacyModelEnv !== undefined)) {
      violations.push(`provider ${provider.provider} has unexpected keyed-model environment metadata`);
    }
  }
  unique(registry.providers.flatMap(({ modelsEnv }) => modelsEnv === undefined ? [] : [modelsEnv]), "provider model env inventory");
  unique(registry.providers.flatMap(({ legacyModelEnv }) => legacyModelEnv === undefined ? [] : [legacyModelEnv]), "provider legacy model env inventory");

  const featureByCapability = new Map(registry.features.map((feature) => [feature.feature, feature]));
  for (const feature of ProviderBackedFeatureCapabilitySchema.options) {
    if (!featureByCapability.has(feature)) violations.push(`provider-backed feature ${feature} has no runtime spec`);
  }
  for (const feature of registry.features) {
    const providers = registry.providers.filter(({ capabilities }) => capabilities.includes(feature.providerCapability));
    if (providers.length < feature.minimumHealthyProviders) {
      violations.push(`feature ${feature.feature} has ${String(providers.length)} providers for ${feature.providerCapability}, needs ${String(feature.minimumHealthyProviders)}`);
    }
    const check = registry.checks.find(({ id }) => id === feature.check);
    const expectedDependencies = providers.map(({ provider }) => RuntimeDependencyIdSchema.parse(`provider.${provider}`));
    if (check !== undefined) {
      for (const dependency of expectedDependencies) {
        if (!check.dependencies.includes(dependency)) violations.push(`feature check ${check.id} omits provider dependency ${dependency}`);
      }
      for (const dependency of check.dependencies.filter((id) => id.startsWith("provider."))) {
        if (!expectedDependencies.includes(dependency)) violations.push(`feature check ${check.id} includes unrelated provider dependency ${dependency}`);
      }
    }
  }

  const dependencies = new Map(registry.dependencies.map((dependency) => [dependency.id, dependency]));
  const checks = new Map(registry.checks.map((check) => [check.id, check]));
  for (const system of registry.systems) {
    const credentialDependencyId = system.credential === "ucpath-sso" ? "secret.ucpath-sso" : "secret.sharepoint-roster";
    const credentialDependency = dependencies.get(RuntimeDependencyIdSchema.parse(credentialDependencyId));
    for (const instance of ["prod", "test"] as const) {
      const capability = RuntimeCapabilitySchema.parse(`system.${system.system}.${instance}`);
      if (!credentialDependency?.capabilities.includes(capability)) {
        violations.push(`system ${system.system} ${instance} capability is not covered by credential dependency ${credentialDependencyId}`);
      }
    }
  }
  for (const dependency of registry.dependencies) {
    unique(dependency.capabilities, `dependency ${dependency.id} capabilities`);
    unique(dependency.secretNames ?? [], `dependency ${dependency.id} secret names`);
    unique(dependency.secretFamilies ?? [], `dependency ${dependency.id} secret families`);
    unique(dependency.secretFiles ?? [], `dependency ${dependency.id} secret files`);
    if (!registeredConsumers.has(dependency.consumer)) violations.push(`dependency ${dependency.id} names missing consumer ${dependency.consumer}`);
    const check = checks.get(dependency.check);
    if (check === undefined) {
      violations.push(`dependency ${dependency.id} names missing check ${dependency.check}`);
      continue;
    }
    if (!check.dependencies.includes(dependency.id)) violations.push(`check ${check.id} omits dependency ${dependency.id}`);
    if (!check.scenarios.includes(dependency.scenario)) {
      violations.push(`check ${check.id} omits dependency scenario ${dependency.scenario}`);
    }
    if (!registeredScenarioIds.has(dependency.scenario)) {
      violations.push(`dependency ${dependency.id} names unregistered scenario ${dependency.scenario}`);
    }
    for (const capability of dependency.capabilities) {
      if (!check.capabilities.includes(capability)) {
        violations.push(`dependency ${dependency.id} capability ${capability} is not consumed by primary check ${check.id}`);
      }
    }
  }
  for (const check of registry.checks) {
    unique(check.dependencies, `check ${check.id} dependencies`);
    unique(check.capabilities, `check ${check.id} capabilities`);
    unique(check.scenarios, `check ${check.id} scenarios`);
    if (!registeredConsumers.has(check.consumer)) violations.push(`check ${check.id} names missing consumer ${check.consumer}`);
    if (!check.dependencies.some((id) => dependencies.get(id)?.consumer === check.consumer)) {
      violations.push(`check ${check.id} consumer ${check.consumer} is not justified by a dependency`);
    }
    for (const scenario of check.scenarios) {
      if (!registeredScenarioIds.has(scenario)) violations.push(`check ${check.id} names unregistered scenario ${scenario}`);
    }
    for (const id of check.dependencies) {
      if (!dependencies.has(id)) violations.push(`check ${check.id} names missing dependency ${id}`);
    }
    for (const capability of check.capabilities) {
      if (!check.dependencies.some((id) => dependencies.get(id)?.capabilities.includes(capability))) {
        violations.push(`check ${check.id} capability ${capability} has no justified dependency relationship`);
      }
    }
    const expectedSeverity = check.dependencies.some((id) => dependencies.get(id)?.requirement === "blocking")
      ? "error"
      : "warning";
    if (check.severity !== expectedSeverity) {
      violations.push(`check ${check.id} severity ${check.severity} contradicts ${expectedSeverity} dependency requirements`);
    }
  }
  for (const capability of RuntimeCapabilitySchema.options) {
    if (!registry.checks.some(({ capabilities }) => capabilities.includes(capability))) {
      violations.push(`runtime capability ${capability} has no registered preflight check`);
    }
  }

  const secretDependencyByName = {
    ucpathUserId: "secret.ucpath-sso",
    ucpathPassword: "secret.ucpath-sso",
    timekeeperName: "secret.timekeeper",
    sharepointOnboardingRosterUrl: "secret.sharepoint-roster",
    ngrokCredential: "capture.ingress",
  } as const satisfies Record<z.infer<typeof SecretNameSchema>, string>;
  const secretFileDependencyByName = {
    duoWebauthnCredential: "browser.duo-extension",
  } as const satisfies Record<z.infer<typeof SecretFileNameSchema>, string>;
  const referencedSecretNames = registry.dependencies.flatMap(({ secretNames }) => secretNames ?? []);
  const referencedSecretFamilies = registry.dependencies.flatMap(({ secretFamilies }) => secretFamilies ?? []);
  const referencedSecretFiles = registry.dependencies.flatMap(({ secretFiles }) => secretFiles ?? []);
  unique(referencedSecretNames, "runtime secret-name references");
  unique(referencedSecretFamilies, "runtime secret-family references");
  unique(referencedSecretFiles, "runtime secret-file references");
  for (const secret of SECRET_SPECS) {
    if (!referencedSecretNames.includes(secret.name)) violations.push(`secret ${secret.name} has no runtime dependency consumer`);
    const owner = secretDependencyByName[secret.name];
    if (!dependencies.get(RuntimeDependencyIdSchema.parse(owner))?.secretNames?.includes(secret.name)) {
      violations.push(`secret ${secret.name} is not owned by dependency ${owner}`);
    }
  }
  for (const family of SECRET_FAMILY_SPECS) {
    if (!referencedSecretFamilies.includes(family.name)) violations.push(`secret family ${family.name} has no runtime dependency consumer`);
  }
  for (const secretFile of SECRET_FILE_SPECS) {
    if (!referencedSecretFiles.includes(secretFile.name)) violations.push(`secret file ${secretFile.name} has no runtime dependency consumer`);
    const owner = secretFileDependencyByName[secretFile.name];
    if (!dependencies.get(RuntimeDependencyIdSchema.parse(owner))?.secretFiles?.includes(secretFile.name)) {
      violations.push(`secret file ${secretFile.name} is not owned by dependency ${owner}`);
    }
  }
  for (const dependency of registry.dependencies) {
    for (const secret of dependency.secretNames ?? []) {
      if (secretDependencyByName[secret] !== dependency.id) {
        violations.push(`dependency ${dependency.id} cannot own secret ${secret}`);
      }
    }
    for (const secretFile of dependency.secretFiles ?? []) {
      if (secretFileDependencyByName[secretFile] !== dependency.id) {
        violations.push(`dependency ${dependency.id} cannot own secret file ${secretFile}`);
      }
    }
  }
  for (const provider of registry.providers) {
    const dependency = dependencies.get(RuntimeDependencyIdSchema.parse(`provider.${provider.provider}`));
    const dependencyFamilies = dependency?.secretFamilies ?? [];
    const expectedFamilies = provider.secretFamily === undefined ? [] : [provider.secretFamily];
    if (!sameMembers(dependencyFamilies, expectedFamilies)) {
      violations.push(`provider ${provider.provider} dependency secret families do not match its adapter inventory`);
    }
  }
  for (const dependency of registry.dependencies.filter(({ id }) => id.startsWith("provider."))) {
    const provider = dependency.id.slice("provider.".length);
    const parsedProvider = ProviderIdSchema.safeParse(provider);
    if (!parsedProvider.success) {
      violations.push(`provider dependency ${dependency.id} has no closed provider id`);
    } else if (!providersById.has(parsedProvider.data)) {
      violations.push(`provider dependency ${dependency.id} has no adapter`);
    }
  }
  return violations;
}

export type RuntimeCapability = z.infer<typeof RuntimeCapabilitySchema>;
export type PreflightCheckId = z.infer<typeof PreflightCheckIdSchema>;
export type RuntimeDependencyId = z.infer<typeof RuntimeDependencyIdSchema>;
export type PreflightScenarioId = z.infer<typeof PreflightScenarioIdSchema>;
