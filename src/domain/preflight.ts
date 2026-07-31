import { z } from "zod";
import type { Clock } from "./clock.js";
import { FingerprintSchema, IsoInstantSchema } from "./ids.js";
import {
  FEATURE_RUNTIME_SPECS,
  PREFLIGHT_CHECKS,
  PROVIDER_ADAPTER_SPECS,
  PreflightCheckIdSchema,
  RUNTIME_DEPENDENCIES,
  RuntimeCapabilitySchema,
  type PreflightCheckId,
  type RuntimeCapability,
} from "./runtime-dependencies.js";

export const PreflightObservationSchema = z.discriminatedUnion("state", [
  z.strictObject({ check: PreflightCheckIdSchema, state: z.literal("healthy"), summary: z.string().min(1) }),
  z.strictObject({
    check: PreflightCheckIdSchema,
    state: z.literal("unhealthy"),
    summary: z.string().min(1),
    impact: z.string().min(1),
  }),
]);

export interface PreflightRunnerContext {
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  readonly deadlineMonotonicMs: number;
  readonly redaction: "safe-summary" | "path-basename" | "presence-only";
}

export interface PreflightRunner {
  readonly check: PreflightCheckId;
  readonly kind: "pure" | "io";
  run(context: PreflightRunnerContext): Promise<z.input<typeof PreflightObservationSchema>>;
}

/** Executes one injected detector against the registered runner contract; report projection stays separate. */
export async function executePreflightRunner(runner: PreflightRunner, signal: AbortSignal, clock: Clock) {
  const check = PREFLIGHT_CHECKS.find(({ id }) => id === runner.check);
  if (check === undefined) throw new Error(`preflight runner names unknown check ${runner.check}`);
  if (check.runner !== runner.kind) throw new Error(`preflight runner ${runner.check} kind ${runner.kind} does not match ${check.runner}`);
  const observation = PreflightObservationSchema.parse(await runner.run({
    signal,
    timeoutMs: check.timeoutMs,
    deadlineMonotonicMs: clock.monotonicMs() + check.timeoutMs,
    redaction: check.redaction,
  }));
  if (observation.check !== check.id) {
    throw new Error(`preflight runner ${runner.check} returned observation for ${observation.check}`);
  }
  return observation;
}

export const PreflightResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("pass"), check: PreflightCheckIdSchema, summary: z.string().min(1) }),
  z.strictObject({
    status: z.literal("warning"),
    check: PreflightCheckIdSchema,
    summary: z.string().min(1),
    impact: z.string().min(1),
    remediation: z.string().min(1),
  }),
  z.strictObject({
    status: z.literal("fail"),
    check: PreflightCheckIdSchema,
    summary: z.string().min(1),
    blocks: z.array(RuntimeCapabilitySchema).min(1),
    remediation: z.string().min(1),
  }),
]);

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
  for (const feature of FEATURE_RUNTIME_SPECS) {
    if (!expanded.has(feature.feature)) continue;
    for (const provider of PROVIDER_ADAPTER_SPECS) {
      if (!provider.capabilities.includes(feature.providerCapability)) continue;
      expanded.add(RuntimeCapabilitySchema.parse(`provider.${provider.provider}`));
    }
  }
  return expanded;
}

function selectedChecks(capabilities: readonly RuntimeCapability[]) {
  const expanded = expandedCapabilities(capabilities);
  return PREFLIGHT_CHECKS.filter((check) => check.capabilities.some((capability) => expanded.has(capability)));
}

function providerCheckIdsForFeature(feature: (typeof FEATURE_RUNTIME_SPECS)[number]): readonly PreflightCheckId[] {
  return PROVIDER_ADAPTER_SPECS
    .filter(({ capabilities }) => capabilities.includes(feature.providerCapability))
    .map(({ provider }) => PreflightCheckIdSchema.parse(`provider.${provider}`));
}

function blockingCapabilitiesForCheck(
  check: (typeof PREFLIGHT_CHECKS)[number],
  requestedCapabilities: readonly RuntimeCapability[],
): readonly RuntimeCapability[] {
  const requested = new Set(requestedCapabilities);
  const dependencies = new Map(RUNTIME_DEPENDENCIES.map((dependency) => [dependency.id, dependency]));
  const blocked = new Set<RuntimeCapability>();
  for (const dependencyId of check.dependencies) {
    const dependency = dependencies.get(dependencyId);
    if (dependency?.requirement !== "blocking") continue;
    for (const capability of dependency.capabilities) {
      if (requested.has(capability)) blocked.add(capability);
    }
  }
  return [...blocked];
}

export const PreflightReportSchema = z.strictObject({
  configFingerprint: FingerprintSchema,
  descriptorFingerprint: FingerprintSchema.optional(),
  checkedAt: IsoInstantSchema,
  requestedCapabilities: z.array(RuntimeCapabilitySchema).min(1),
  results: z.array(PreflightResultSchema).min(1),
}).superRefine((report, context) => {
  const duplicateCapabilities = duplicateValues(report.requestedCapabilities);
  if (duplicateCapabilities.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["requestedCapabilities"],
      message: `requested capabilities contain duplicates: ${duplicateCapabilities.join(", ")}`,
    });
  }
  const resultIds = report.results.map(({ check }) => check);
  const duplicateResults = duplicateValues(resultIds);
  if (duplicateResults.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["results"],
      message: `preflight results contain duplicate check ids: ${duplicateResults.join(", ")}`,
    });
  }

  const registered = new Map(PREFLIGHT_CHECKS.map((check) => [check.id, check]));
  const expected = selectedChecks(report.requestedCapabilities);
  const expectedIds = new Set(expected.map(({ id }) => id));
  const resultByCheck = new Map(report.results.map((result) => [result.check, result]));
  for (const [index, result] of report.results.entries()) {
    const check = registered.get(result.check);
    if (check === undefined) {
      context.addIssue({ code: "custom", path: ["results", index, "check"], message: `unregistered preflight check ${result.check}` });
      continue;
    }
    if (!expectedIds.has(result.check)) {
      context.addIssue({ code: "custom", path: ["results", index, "check"], message: `unrequested preflight check ${result.check}` });
    }
    const expectedBlocks = blockingCapabilitiesForCheck(check, report.requestedCapabilities);
    if (result.status === "warning" && expectedBlocks.length > 0) {
      context.addIssue({ code: "custom", path: ["results", index, "status"], message: `blocking check ${result.check} cannot be a warning` });
    }
    if (result.status === "fail") {
      const duplicateBlocks = duplicateValues(result.blocks);
      if (duplicateBlocks.length > 0) {
        context.addIssue({ code: "custom", path: ["results", index, "blocks"], message: `blocks contain duplicates: ${duplicateBlocks.join(", ")}` });
      }
      for (const capability of result.blocks) {
        if (!report.requestedCapabilities.includes(capability)) {
          context.addIssue({ code: "custom", path: ["results", index, "blocks"], message: `blocked capability ${capability} was not requested` });
        }
        if (!expectedBlocks.includes(capability)) {
          context.addIssue({ code: "custom", path: ["results", index, "blocks"], message: `check ${result.check} cannot block ${capability}` });
        }
      }
      for (const capability of expectedBlocks) {
        if (!result.blocks.includes(capability)) {
          context.addIssue({ code: "custom", path: ["results", index, "blocks"], message: `check ${result.check} omitted blocked capability ${capability}` });
        }
      }
      if (expectedBlocks.length === 0) {
        context.addIssue({ code: "custom", path: ["results", index, "status"], message: `optional check ${result.check} cannot fail` });
      }
    }
  }
  for (const check of expected) {
    if (!resultIds.includes(check.id)) {
      context.addIssue({ code: "custom", path: ["results"], message: `preflight report omits selected check ${check.id}` });
    }
  }
  for (const feature of FEATURE_RUNTIME_SPECS) {
    if (!report.requestedCapabilities.includes(feature.feature)) continue;
    const providerResults = providerCheckIdsForFeature(feature)
      .map((check) => resultByCheck.get(check))
      .filter((result) => result !== undefined);
    const healthyProviders = providerResults.filter(({ status }) => status === "pass").length;
    const shouldPass = healthyProviders >= feature.minimumHealthyProviders;
    const featureResult = resultByCheck.get(feature.check);
    if (featureResult !== undefined && (featureResult.status === "pass") !== shouldPass) {
      context.addIssue({
        code: "custom",
        path: ["results"],
        message: `${feature.feature} provider-set result contradicts ${String(healthyProviders)} healthy provider result(s)`,
      });
    }
  }
});

export interface BuildPreflightReportInput {
  readonly configFingerprint: string;
  readonly descriptorFingerprint?: string;
  readonly requestedCapabilities: readonly RuntimeCapability[];
  readonly observations: readonly z.input<typeof PreflightObservationSchema>[];
  readonly clock: Clock;
}

function parseRequestedCapabilities(capabilitiesInput: readonly RuntimeCapability[]): readonly RuntimeCapability[] {
  const capabilities = z.array(RuntimeCapabilitySchema).min(1).parse(capabilitiesInput);
  const duplicates = duplicateValues(capabilities);
  if (duplicates.length > 0) throw new Error(`requested capabilities contain duplicates: ${duplicates.join(", ")}`);
  return capabilities;
}

export function requiredPreflightChecks(capabilitiesInput: readonly RuntimeCapability[]): readonly PreflightCheckId[] {
  const capabilities = parseRequestedCapabilities(capabilitiesInput);
  return selectedChecks(capabilities).map(({ id }) => id);
}

export function buildPreflightReport(input: BuildPreflightReportInput): z.infer<typeof PreflightReportSchema> {
  const requestedCapabilities = parseRequestedCapabilities(input.requestedCapabilities);
  const observations = z.array(PreflightObservationSchema).parse(input.observations);
  const checkIds = observations.map(({ check }) => check);
  const duplicateChecks = duplicateValues(checkIds);
  if (duplicateChecks.length > 0) {
    throw new Error(`preflight observations contain duplicate check ids: ${duplicateChecks.join(", ")}`);
  }

  const registeredIds = new Set(PREFLIGHT_CHECKS.map(({ id }) => id));
  const unknown = checkIds.filter((id) => !registeredIds.has(id));
  if (unknown.length > 0) throw new Error(`preflight observations contain unknown checks: ${unknown.join(", ")}`);

  const selected = selectedChecks(requestedCapabilities);
  const selectedIds = new Set(selected.map(({ id }) => id));
  const unrequested = checkIds.filter((id) => !selectedIds.has(id));
  if (unrequested.length > 0) throw new Error(`preflight observations contain unrequested checks: ${unrequested.join(", ")}`);
  const missing = selected.filter(({ id }) => !checkIds.includes(id)).map(({ id }) => id);
  if (missing.length > 0) throw new Error(`preflight observations omit selected checks: ${missing.join(", ")}`);

  const byCheck = new Map(observations.map((observation) => [observation.check, observation]));
  for (const feature of FEATURE_RUNTIME_SPECS) {
    if (!requestedCapabilities.includes(feature.feature)) continue;
    const providerObservations = providerCheckIdsForFeature(feature).map((check) => byCheck.get(check));
    const healthyProviders = providerObservations.filter((observation) => observation?.state === "healthy").length;
    const shouldBeHealthy = healthyProviders >= feature.minimumHealthyProviders;
    const featureObservation = byCheck.get(feature.check);
    if (featureObservation === undefined || (featureObservation.state === "healthy") !== shouldBeHealthy) {
      throw new Error(
        `${feature.feature} provider-set observation contradicts ${String(healthyProviders)} healthy provider observation(s)`,
      );
    }
  }
  const results = selected.map((check) => {
    const observation = byCheck.get(check.id);
    if (observation === undefined) throw new Error(`selected preflight check ${check.id} has no observation`);
    if (observation.state === "healthy") return { status: "pass" as const, check: check.id, summary: observation.summary };
    const blocks = blockingCapabilitiesForCheck(check, requestedCapabilities);
    if (check.severity === "warning") return {
      status: "warning" as const,
      check: check.id,
      summary: observation.summary,
      impact: observation.impact,
      remediation: check.remediation,
    };
    if (blocks.length === 0) throw new Error(`error-severity preflight check ${check.id} resolves no requested blocking capability`);
    return {
      status: "fail" as const,
      check: check.id,
      summary: observation.summary,
      blocks,
      remediation: check.remediation,
    };
  });
  return PreflightReportSchema.parse({
    configFingerprint: input.configFingerprint,
    descriptorFingerprint: input.descriptorFingerprint,
    checkedAt: input.clock.now().toISOString(),
    requestedCapabilities,
    results,
  });
}
