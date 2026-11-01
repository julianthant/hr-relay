import { accessSync, constants, statSync } from "node:fs";
import { join } from "node:path";
import { bundledChromiumExecutablePath } from "../../runtime/browser/executable-path.js";
import { requireAnnualDates } from "../../../models/config/fiscal-year.js";
import { CONFIG_ROUTE_SCHEMAS } from "../../../models/config/schema.js";
import { PreflightObservationSchema, requiredPreflightChecks, type PreflightRunner } from "../../../models/preflight/preflight.js";
import { PREFLIGHT_CHECKS, RUNTIME_DEPENDENCIES, SYSTEM_RUNTIME_SPECS } from "../../../models/runtime/runtime-dependencies.js";
import { inspectSecret } from "../../../models/config/secrets.js";
import type { RuntimePreflightRunnerInput } from "./runtime-runners.js";

function result(check: PreflightRunner["check"], ready: boolean, summary: string) {
  return PreflightObservationSchema.parse(ready
    ? { check, state: "healthy", summary }
    : { check, state: "unhealthy", summary, impact: "The selected capability cannot run until this prerequisite is verified." });
}

/** Read-only leaf detectors. Selection, deadlines, severity and remedies belong to the registry. */
export function createWorkflowPreflightRunners(input: RuntimePreflightRunnerInput): readonly PreflightRunner[] {
  return requiredPreflightChecks(input.scope.requestedCapabilities).flatMap(check => {
    const spec = PREFLIGHT_CHECKS.find(candidate => candidate.id === check);
    if (spec === undefined) throw new Error(`preflight registry omits ${check}`);
    let inspect: (() => ReturnType<typeof result>) | undefined;
    if (check === "browser.assets") inspect = () => {
      try {
        const executable = (input.browserExecutablePath ?? bundledChromiumExecutablePath)();
        if (!statSync(executable).isFile()) return result(check, false, "Chromium executable is unavailable.");
        accessSync(executable, constants.R_OK | constants.X_OK);
      } catch {
        return result(check, false, "Chromium executable is unavailable.");
      }
      if (!input.config.features.duoWebAuthn) return result(check, true, "Chromium is installed; Fast Duo is disabled in the retained settings.");
      try {
        const manifest = join(input.config.paths.duoExtensionDir, "workflow-manifest.json");
        if (!statSync(manifest).isFile()) return result(check, false, "Duo extension manifest is unavailable.");
        accessSync(manifest, constants.R_OK);
      } catch {
        return result(check, false, "Duo extension manifest is unavailable.");
      }
      try {
        if (input.duo === undefined) throw new Error("duo-signing-source-required");
        input.duo.assertCurrent(); input.duo.credentials();
      } catch {
        return result(check, false, "Duo backend signing source is unavailable.");
      }
      return result(check, true, "Chromium, Duo extension and backend signing source are present.");
    };
    if (check === "fiscal.current") inspect = () => {
      const year = `FY${String(input.dashboard.clock.fiscalYear())}`;
      try {
        requireAnnualDates(input.config, input.dashboard.clock);
        return result(check, true, `${year} annual dates are configured and current.`);
      } catch {
        return result(check, false, `${year} annual dates are missing, invalid or stale.`);
      }
    };
    if (check.startsWith("secrets.")) inspect = () => {
      const names = RUNTIME_DEPENDENCIES.filter(dependency => dependency.check === check).flatMap(dependency => dependency.secretNames ?? []);
      if (names.length === 0) throw new Error(`preflight registry has no protected names for ${check}`);
      const presence = names.map(name => inspectSecret(name, input.protectedSecrets));
      return result(check, presence.every(leaf => leaf.state === "present"), presence.map(leaf => `${leaf.name}: ${leaf.state}`).join("; "));
    };
    if (check.startsWith("endpoint.")) inspect = () => {
      const system = SYSTEM_RUNTIME_SPECS.find(candidate => check === `endpoint.${candidate.system}.prod`);
      if (system === undefined) throw new Error(`preflight registry has no endpoint owner for ${check}`);
      const selected = CONFIG_ROUTE_SCHEMAS[system.configKey].safeParse(input.config.urls[system.configKey].prod);
      if (!selected.success) return result(check, false, `${system.system} route set is missing or invalid.`);
      return result(check, true, `${system.system} route set is complete.`);
    };
    if (inspect === undefined) return [];
    const detector = inspect;
    return [{ check, kind: spec.runner, async run(context) {
      if (context.signal.aborted) throw new Error(`preflight ${check} was aborted`);
      return detector();
    } }];
  });
}
