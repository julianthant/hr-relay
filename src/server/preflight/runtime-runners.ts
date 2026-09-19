import type { Config } from "../../domain/config/schema.js";
import type { PreflightAdmissionScope } from "../../domain/preflight-admission.js";
import { requiredPreflightChecks, type PreflightRunner } from "../../domain/preflight.js";
import { PREFLIGHT_CHECKS } from "../../domain/runtime-dependencies.js";
import type { ProtectedSecretSource } from "../../domain/secrets.js";
import { createDashboardPreflightRunners, type DashboardPreflightRunnerInput } from "./dashboard-runners.js";

/** Stable Setup detector port. Protected values remain inside the registered secret reader. */
export interface RuntimePreflightRunnerInput {
  readonly scope: PreflightAdmissionScope;
  readonly config: Config;
  readonly dashboard: Omit<DashboardPreflightRunnerInput, "config">;
  readonly protectedSecrets: ProtectedSecretSource;
  readonly providerAvailability: Readonly<Record<string, boolean>>;
}
export type RuntimePreflightRunnerFactory = (input: RuntimePreflightRunnerInput) => readonly PreflightRunner[];

/** Setup extends this factory; absent implementations are truthful, registry-shaped observations. */
export const createRuntimePreflightRunners: RuntimePreflightRunnerFactory = input => {
  const available = new Map(createDashboardPreflightRunners({ ...input.dashboard, config: input.config }).runners.map(runner => [runner.check, runner]));
  return requiredPreflightChecks(input.scope.requestedCapabilities).map(check => {
    const runner = available.get(check);
    if (runner !== undefined) return runner;
    const spec = PREFLIGHT_CHECKS.find(candidate => candidate.id === check);
    if (spec === undefined) throw new Error(`preflight registry omits ${check}`);
    return { check, kind: spec.runner, async run() {
      return { check, state: "unhealthy" as const, summary: `${check} detector is unavailable.`, impact: "Readiness cannot be verified until this registered detector is available." };
    } };
  });
};
