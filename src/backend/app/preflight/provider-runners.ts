import { FEATURE_RUNTIME_SPECS, PREFLIGHT_CHECKS, PROVIDER_ADAPTER_SPECS } from "../../../models/runtime/runtime-dependencies.js";
import { PreflightObservationSchema, requiredPreflightChecks, type PreflightRunner } from "../../../models/preflight/preflight.js";
import type { RuntimePreflightRunnerInput } from "./runtime-runners.js";

/** Executable adapter availability is supplied by the composition; keys alone never imply readiness. */
export function createProviderPreflightRunners(input: RuntimePreflightRunnerInput): readonly PreflightRunner[] {
  const availability = (provider: (typeof PROVIDER_ADAPTER_SPECS)[number]) => {
    return provider.capabilities.filter(capability => input.providerAvailability[`${provider.provider}/${capability}`] === true);
  };
  return requiredPreflightChecks(input.scope.requestedCapabilities).flatMap(check => {
    const provider = PROVIDER_ADAPTER_SPECS.find(candidate => check === `provider.${candidate.provider}`);
    const feature = FEATURE_RUNTIME_SPECS.find(candidate => candidate.check === check);
    if (provider === undefined && feature === undefined) return [];
    const spec = PREFLIGHT_CHECKS.find(candidate => candidate.id === check);
    if (spec === undefined) throw new Error(`preflight registry omits ${check}`);
    return [{ check, kind: spec.runner, async run(context) {
      if (context.signal.aborted) throw new Error(`preflight ${check} was aborted`);
      if (provider !== undefined) {
        const capabilities = availability(provider);
        const availableFor = FEATURE_RUNTIME_SPECS.filter(candidate => capabilities.includes(candidate.providerCapability)).map(candidate => candidate.feature);
        return PreflightObservationSchema.parse(capabilities.length > 0
          ? { check, state: "healthy", summary: `${provider.provider}: executable ${capabilities.join(", ")} available.`, ...(availableFor.length === 0 ? {} : { availableFor }) }
          : { check, state: "unhealthy", summary: `${provider.provider}: no configured executable adapter is available.`, impact: "This optional provider cannot execute its declared capabilities." });
      }
      if (feature === undefined) throw new Error(`preflight feature owner vanished for ${check}`);
      const count = PROVIDER_ADAPTER_SPECS.filter(candidate => availability(candidate).includes(feature.providerCapability)).length;
      return PreflightObservationSchema.parse(count >= feature.minimumHealthyProviders
        ? { check, state: "healthy", summary: `${feature.providerCapability}: ${String(count)} executable provider(s) available.` }
        : { check, state: "unhealthy", summary: `${feature.providerCapability}: insufficient executable providers.`, impact: "This selected feature cannot execute until a configured adapter is available." });
    } }];
  });
}
