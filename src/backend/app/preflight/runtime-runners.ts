import type { DuoSigningSource } from "../../storage/configuration/duo-signing.js";
import { createProviderPreflightRunners } from "./provider-runners.js";
import { createWorkflowPreflightRunners } from "./workflow-runners.js";
import type { Config } from "../../../models/config/schema.js";
import type { PreflightAdmissionScope } from "../../../rules/preflight/preflight-admission.js";
import { requiredPreflightChecks, type PreflightRunner } from "../../../models/preflight/preflight.js";
import { PREFLIGHT_CHECKS } from "../../../models/runtime/runtime-dependencies.js";
import type { ProtectedSecretSource } from "../../../models/config/secrets.js";
import { createDashboardPreflightRunners, type DashboardPreflightRunnerInput } from "./dashboard-runners.js";

/** Stable Setup detector port. Protected values remain inside the registered secret reader. */
export interface RuntimePreflightRunnerInput {
  readonly scope: PreflightAdmissionScope;
  readonly config: Config;
  readonly dashboard: Omit<DashboardPreflightRunnerInput, "config">;
  readonly protectedSecrets: ProtectedSecretSource;
  readonly duo?: DuoSigningSource;
  /** Read-only local asset lookup, independently injectable without launching Chromium. */
  readonly browserExecutablePath?: () => string;
  readonly providerAvailability: Readonly<Record<string, boolean>>;
}
export type RuntimePreflightRunnerFactory = (input: RuntimePreflightRunnerInput) => readonly PreflightRunner[];

/** The registered factory covers exactly the checks selected for this retained scope. */
export const createRuntimePreflightRunners: RuntimePreflightRunnerFactory = input => {
  const available = new Map(createDashboardPreflightRunners({ ...input.dashboard, config: input.config }).runners.map(runner => [runner.check, runner]));
  for (const runner of [...createWorkflowPreflightRunners(input), ...createProviderPreflightRunners(input)]) available.set(runner.check, runner);
  return requiredPreflightChecks(input.scope.requestedCapabilities).map(check => {
    const runner = available.get(check);
    if (runner !== undefined) return runner;
    const spec = PREFLIGHT_CHECKS.find(candidate => candidate.id === check);
    if (spec === undefined) throw new Error(`preflight registry omits ${check}`);
    throw new Error(`preflight detector is not implemented for ${spec.id}`);
  });
};
