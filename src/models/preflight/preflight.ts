import { z } from "zod";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import type { Clock } from "../../rules/time/clock.js";
import {
  FingerprintSchema,
} from "../../rules/identity/ids.js";
import {
  FEATURE_RUNTIME_SPECS,
  PREFLIGHT_CHECKS,
  PROVIDER_ADAPTER_SPECS,
  RUNTIME_DEPENDENCIES,
} from "../runtime/runtime-dependencies.js";
import {
  PreflightCheckIdSchema,
  PreflightReportWireSchema,
  PreflightRerunCommandRequestSchema,
  RuntimeCapabilitySchema,
  createPreflightRerunCommandResultSchema,
  type PreflightCheckId,
  type RuntimeCapability,
} from "./preflight-contract.js";
import {
  auditPreflightSemanticRegistry,
  expectedPreflightChecks,
  mandatoryCapabilitiesForPreflightCheck,
  providerChecksForFeature,
  providerSupportsFeature,
  PreflightProviderFeaturesSchema,
} from "../../rules/preflight/preflight-semantics.js";

export {
  PreflightResultWireSchema as PreflightResultSchema,
  PreflightRerunCommandRequestSchema,
} from "./preflight-contract.js";

export const PreflightObservationSchema = z.discriminatedUnion("state", [
  z.strictObject({ check: PreflightCheckIdSchema, state: z.literal("healthy"), summary: z.string().min(1), availableFor: PreflightProviderFeaturesSchema.optional() }),
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

export interface PreflightDeadlineHandle {
  cancel(): void;
}

/** Injected monotonic deadline arm; production composes the process timer once. */
export interface PreflightDeadlineScheduler {
  schedule(deadlineMonotonicMs: number, onDeadline: () => void): PreflightDeadlineHandle;
}

export interface PreflightRunner {
  readonly check: PreflightCheckId;
  readonly kind: "pure" | "io";
  run(context: PreflightRunnerContext): Promise<z.input<typeof PreflightObservationSchema>>;
}

/** Executes one detector under its registered deadline: a timeout rejects the eventual return rather than racing the runner promise away. */
export async function executePreflightRunner(
  runner: PreflightRunner,
  signal: AbortSignal,
  clock: Clock,
  scheduler: PreflightDeadlineScheduler,
) {
  const check = PREFLIGHT_CHECKS.find(({ id }) => id === runner.check);
  if (check === undefined) throw new Error(`preflight runner names unknown check ${runner.check}`);
  if (check.runner !== runner.kind) throw new Error(`preflight runner ${runner.check} kind ${runner.kind} does not match ${check.runner}`);
  const deadlineMonotonicMs = clock.monotonicMs() + check.timeoutMs;
  const controller = new AbortController();
  const parentAbortError = (): Error => signal.reason instanceof Error
    ? signal.reason
    : new Error(`preflight runner ${runner.check} was aborted`);
  const forwardAbort = (): void => {
    controller.abort(parentAbortError());
  };
  if (signal.aborted) forwardAbort();
  signal.addEventListener("abort", forwardAbort, { once: true });
  let timedOut = false;
  const timeoutError = new Error(
    `preflight runner ${runner.check} exceeded its registered ${String(check.timeoutMs)}ms timeout`,
  );
  const deadline = scheduler.schedule(deadlineMonotonicMs, () => {
    timedOut = true;
    controller.abort(timeoutError);
  });
  let raw: z.input<typeof PreflightObservationSchema>;
  try {
    raw = await runner.run({
      signal: controller.signal,
      timeoutMs: check.timeoutMs,
      deadlineMonotonicMs,
      redaction: check.redaction,
    });
    if (timedOut) throw timeoutError;
    if (signal.aborted) throw parentAbortError();
  } catch (error) {
    if (timedOut) throw timeoutError;
    if (signal.aborted) throw parentAbortError();
    throw error;
  } finally {
    deadline.cancel();
    signal.removeEventListener("abort", forwardAbort);
  }
  const observation = PreflightObservationSchema.parse(raw);
  if (observation.check !== check.id) {
    throw new Error(`preflight runner ${runner.check} returned observation for ${observation.check}`);
  }
  return observation;
}

function duplicateValues(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  return [...new Set(values.filter((value) => {
    if (seen.has(value)) return true;
    seen.add(value);
    return false;
  }))];
}

function selectedChecks(capabilities: readonly RuntimeCapability[]) {
  const registered = new Map(PREFLIGHT_CHECKS.map((check) => [check.id, check]));
  return expectedPreflightChecks(capabilities).map((expectation) => {
    const check = registered.get(expectation.id);
    if (check === undefined) throw new Error(`preflight registry omits semantic check ${expectation.id}`);
    return check;
  });
}

function blockingCapabilitiesForCheck(
  check: (typeof PREFLIGHT_CHECKS)[number],
  requestedCapabilities: readonly RuntimeCapability[],
): readonly RuntimeCapability[] {
  return mandatoryCapabilitiesForPreflightCheck(check.id, requestedCapabilities);
}

/** Browser and server parse one semantic report contract; the runner registry is separately bound below. */
export const PreflightReportSchema = PreflightReportWireSchema;

export const PreflightRerunCommandResultSchema = createPreflightRerunCommandResultSchema(PreflightReportSchema);

export interface BuildPreflightReportInput {
  readonly configFingerprint: string;
  readonly descriptorFingerprint?: string;
  readonly requestedCapabilities: readonly RuntimeCapability[];
  readonly observations: readonly z.input<typeof PreflightObservationSchema>[];
  readonly clock: Clock;
}

function assertPreflightSemanticRegistry(): void {
  const violations = auditPreflightSemanticRegistry({
    checks: PREFLIGHT_CHECKS,
    dependencies: RUNTIME_DEPENDENCIES,
    features: FEATURE_RUNTIME_SPECS,
    providers: PROVIDER_ADAPTER_SPECS,
  });
  if (violations.length > 0) {
    throw new Error(`preflight runtime registry contradicts browser-safe semantic authority: ${violations.join("; ")}`);
  }
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
    const providerObservations = providerChecksForFeature(feature.feature).map((check) => byCheck.get(check));
    const healthyProviders = providerObservations.filter((observation) => observation?.state === "healthy" && providerSupportsFeature(observation.availableFor, feature.feature)).length;
    const shouldBeHealthy = healthyProviders >= feature.minimumHealthyProviders;
    const featureObservation = byCheck.get(feature.check);
    if (featureObservation === undefined || (featureObservation.state === "healthy") !== shouldBeHealthy) {
      throw new Error(
        `${String(feature.feature)} provider-set observation contradicts ${String(healthyProviders)} healthy provider observation(s)`,
      );
    }
  }
  const results = selected.map((check) => {
    const observation = byCheck.get(check.id);
    if (observation === undefined) throw new Error(`selected preflight check ${check.id} has no observation`);
    if (observation.state === "healthy") return { status: "pass" as const, check: check.id, summary: observation.summary, ...(observation.availableFor === undefined ? {} : { availableFor: observation.availableFor }) };
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

interface PreflightAuthority {
  execute(input: unknown, signal: AbortSignal): Promise<z.infer<typeof PreflightRerunCommandResultSchema>>;
  refresh(signal: AbortSignal): Promise<z.infer<typeof PreflightReportSchema>>;
  readLatest(): z.infer<typeof PreflightReportSchema>;
}

interface CreatePreflightAuthorityInput {
  readonly configFingerprint: string;
  readonly descriptorFingerprint?: string;
  readonly requestedCapabilities: readonly RuntimeCapability[];
  readonly runners: readonly PreflightRunner[];
  readonly clock: Clock;
  readonly scheduler: PreflightDeadlineScheduler;
}

/** The one runtime preflight authority: selection comes from the strict dependency registry, and a rerun is read-only but idempotent by command id. */
export function createPreflightAuthority(input: CreatePreflightAuthorityInput): PreflightAuthority {
  assertPreflightSemanticRegistry();
  const configFingerprint = FingerprintSchema.parse(input.configFingerprint);
  const descriptorFingerprint = input.descriptorFingerprint === undefined
    ? undefined
    : FingerprintSchema.parse(input.descriptorFingerprint);
  const requestedCapabilities = parseRequestedCapabilities(input.requestedCapabilities);
  const selectedChecks = requiredPreflightChecks(requestedCapabilities);
  const runners = new Map<PreflightCheckId, PreflightRunner>();
  for (const runner of input.runners) {
    if (runners.has(runner.check)) {
      throw new Error(`preflight runner registry contains duplicate check ${runner.check}`);
    }
    runners.set(runner.check, runner);
  }
  const missingRunners = selectedChecks.filter((check) => !runners.has(check));
  if (missingRunners.length > 0) {
    throw new Error(`preflight authority has no runner for selected checks: ${missingRunners.join(", ")}`);
  }
  const extra = [...runners.keys()].filter((check) => !selectedChecks.includes(check));
  if (extra.length > 0) throw new Error(`preflight authority received extra runners: ${extra.join(", ")}`);

  let latest: z.infer<typeof PreflightReportSchema> | undefined;
  const completed = new Map<string, Readonly<{
    request: string;
    result: z.infer<typeof PreflightRerunCommandResultSchema>;
  }>>();
  const failed = new Map<string, Readonly<{ request: string; error: unknown }>>();
  const inFlight = new Map<string, Readonly<{
    request: string;
    result: Promise<z.infer<typeof PreflightRerunCommandResultSchema>>;
  }>>();

  const runRefresh = async (signal: AbortSignal): Promise<z.infer<typeof PreflightReportSchema>> => {
    const settlements = await Promise.allSettled(selectedChecks.map(async (check) => {
      const runner = runners.get(check);
      if (runner === undefined) throw new Error(`preflight authority runner ${check} vanished after composition`);
      return executePreflightRunner(runner, signal, input.clock, input.scheduler);
    }));
    const observations: z.infer<typeof PreflightObservationSchema>[] = [];
    const failures: unknown[] = [];
    for (const settlement of settlements) {
      if (settlement.status === "fulfilled") observations.push(settlement.value);
      else {
        const failure: unknown = settlement.reason;
        failures.push(failure);
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(
        failures,
        `preflight authority failed ${String(failures.length)} selected runners`,
        { cause: failures[0] },
      );
    }
    latest = buildPreflightReport({
      configFingerprint,
      ...(descriptorFingerprint === undefined ? {} : { descriptorFingerprint }),
      requestedCapabilities,
      observations,
      clock: input.clock,
    });
    return latest;
  };

  // Serialize the actual settlement boundary, not a deadline-race response.
  let refreshTail = Promise.resolve();
  const refresh = (signal: AbortSignal): Promise<z.infer<typeof PreflightReportSchema>> => {
    const admission = Promise.withResolvers<void>();
    const predecessor = refreshTail;
    refreshTail = admission.promise;
    return predecessor.then(() => runRefresh(signal)).finally(() => admission.resolve());
  };

  return Object.freeze({
    async execute(commandInput: unknown, signal: AbortSignal) {
      const command = PreflightRerunCommandRequestSchema.parse(commandInput);
      const request = canonicalJsonStringify(command);
      const priorFailure = failed.get(command.commandId);
      if (priorFailure !== undefined) {
        if (priorFailure.request !== request) {
          throw new Error(`preflight command ${command.commandId} was replayed with a divergent request`);
        }
        throw priorFailure.error;
      }
      const prior = completed.get(command.commandId);
      if (prior !== undefined) {
        if (prior.request !== request) {
          throw new Error(`preflight command ${command.commandId} was replayed with a divergent request`);
        }
        return prior.result;
      }
      const pending = inFlight.get(command.commandId);
      if (pending !== undefined) {
        if (pending.request !== request) {
          throw new Error(`preflight command ${command.commandId} was replayed with a divergent request`);
        }
        return pending.result;
      }
      if (completed.size + failed.size + inFlight.size >= 256) {
        throw new Error("preflight retained command identity capacity 256 is exhausted; "
          + "restart the local dashboard before admitting another unique rerun command");
      }
      const deferred = Promise.withResolvers<z.infer<typeof PreflightRerunCommandResultSchema>>();
      inFlight.set(command.commandId, { request, result: deferred.promise });
      void (async (): Promise<void> => {
        try {
          if (command.target.expectedConfigFingerprint !== configFingerprint) {
            throw new Error(
              `preflight command ${command.commandId} expected config ${command.target.expectedConfigFingerprint} `
              + `but current config is ${configFingerprint}`,
            );
          }
          if (command.target.expectedDescriptorFingerprint !== descriptorFingerprint) {
            throw new Error(
              `preflight command ${command.commandId} expected descriptor `
              + `${command.target.expectedDescriptorFingerprint ?? "absent"} but current descriptor is `
              + `${descriptorFingerprint ?? "absent"}`,
            );
          }
          const result = PreflightRerunCommandResultSchema.parse({
            state: "completed",
            commandId: command.commandId,
            report: await refresh(signal),
          });
          latest = result.report;
          completed.set(command.commandId, { request, result });
          inFlight.delete(command.commandId);
          deferred.resolve(result);
        } catch (error) {
          failed.set(command.commandId, { request, error });
          inFlight.delete(command.commandId);
          deferred.reject(error);
        }
      })();
      return deferred.promise;
    },
    refresh,
    readLatest() {
      if (latest === undefined) throw new Error("preflight authority has not completed an initial report");
      return latest;
    },
  });
}
