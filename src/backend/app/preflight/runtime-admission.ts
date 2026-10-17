import { executePreflightRunner, requiredPreflightChecks } from "../../../models/preflight/preflight.js";
import { dirname, join } from "node:path";
import type { AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { selectActiveRunSettings, selectRunSettings } from "../../runs/settings/run-settings.js";
import type { RuntimeIsolation } from "../../../models/config/define-runtime-isolation.js";
import type { Clock } from "../../../rules/time/clock.js";
import type { BrowserSystemId } from "../../../rules/identity/ids.js";
import { RuntimeCapabilitySchema } from "../../../models/preflight/preflight-contract.js";
import { StoredConfigSchema } from "../../../models/config/snapshot.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { createPreflightAdmission, PreflightAdmissionRefusal, PreflightAdmissionScopeSchema, type PreflightAdmissionScope } from "../../../rules/preflight/preflight-admission.js";
import { protectedSecretRevision, type ProtectedSecretSource } from "../../../models/config/secrets.js";
import type { InstanceSelection, RunEnvelope } from "../../../models/run/envelope.js";
import { AuthorityHealthPreflightRunner, type AuthorityDatabase } from "../../storage/sqlite/index.js";
import { requireRuntimeAdmission, type RuntimeAdmission } from "../../storage/admission/admission.js";
import { workflowPreflightScope } from "../../runs/start/preflight-scope.js";
import { createTimeoutDeadlineScheduler } from "../../runtime/scheduling/timeout-deadline-scheduler.js";
import { createRuntimePreflightRunners, type RuntimePreflightRunnerFactory } from "./runtime-runners.js";

export function composeRuntimePreflight(input: Readonly<{
  admission?: RuntimeAdmission;
  database: AuthorityDatabase; clock: Clock; repoRoot: string; isolation: RuntimeIsolation;
  descriptors: { resolve(workflowId: string): AnyWorkflowDescriptor | undefined };
  descriptorSetHash: string; protectedSecrets: ProtectedSecretSource;
  environment: Readonly<Record<string, string | undefined>>;
  runnerFactory?: RuntimePreflightRunnerFactory;
}>) {
  const { database, clock } = input;
  const runtimeAdmission = requireRuntimeAdmission(input.admission);
  const stateRoot = runtimeAdmission.stateRoot;
  const readConfig = (scope: PreflightAdmissionScope) => {
    const snapshot = selectRunSettings(database.authority, scope);
    if (sha256Hex(canonicalJsonStringify(snapshot.config)) !== snapshot.fingerprint) {
      throw new PreflightAdmissionRefusal("scope-mismatch", "Preflight retained configuration is unavailable.");
    }
    return StoredConfigSchema.parse(snapshot.config);
  };
  const scheduler = createTimeoutDeadlineScheduler(clock);
  const observationIdentity = (scope: PreflightAdmissionScope): string => {
    if (!requiredPreflightChecks(scope.requestedCapabilities).some(check => check.startsWith("secrets."))) return "no-protected-dependency";
    try { return String(protectedSecretRevision(input.protectedSecrets)); }
    catch { throw new PreflightAdmissionRefusal("unavailable", "Protected settings presence could not be verified."); }
  };
  const runners = (scope: PreflightAdmissionScope) => {
    const config = readConfig(scope);
    return (input.runnerFactory ?? createRuntimePreflightRunners)({
      scope, config, protectedSecrets: input.protectedSecrets,
      providerAvailability: { "census/geocode.census": true, "nominatim/geocode.nominatim": true },
      dashboard: {
        repoRoot: input.repoRoot, stateRoot, artifactRoot: runtimeAdmission.artifactRoot,
        backendPort: input.isolation.backendPort, frontendPort: input.isolation.frontendPort,
        processLockRoot: join(input.repoRoot, input.isolation.processLockRoot), clock,
        authorityHealth: new AuthorityHealthPreflightRunner(runtimeAdmission, { stateRootTrustAnchor: dirname(stateRoot), stateRoot,
          authorityPath: join(stateRoot, "state.db"), backupDirectory: join(stateRoot, "backups", "authority"), busyTimeoutMs: 5000 }, clock),
        listLiveWorkerProcesses: () => database.authority.workerLeases.listLive().map(lease => ({ workerId: lease.workerId, processId: lease.processId })),
      },
    });
  };
  const admission = createPreflightAdmission({
    clock, scheduler, validate: scope => { readConfig(scope); }, observationIdentity, runners,
  });
  const prepareSession = async (scope: PreflightAdmissionScope, system: BrowserSystemId, signal: AbortSignal): Promise<void> => {
    const capability = RuntimeCapabilitySchema.parse(`system.${system}.prod`);
    if (!scope.requestedCapabilities.includes(capability)) {
      throw new PreflightAdmissionRefusal("scope-mismatch", "Browser request differs from its admitted preflight scope.");
    }
    const sessionScope = { ...scope, requestedCapabilities: ["executor.run" as const, capability] };
    try {
      readConfig(scope);
      const revision = observationIdentity(sessionScope);
      const available = runners(sessionScope);
      const selected = ["browser.assets" as const, ...requiredPreflightChecks([capability])].map(check => {
        const matches = available.filter(runner => runner.check === check);
        if (matches.length !== 1) throw new PreflightAdmissionRefusal("unavailable", `Session readiness requires exactly one detector for ${check}.`);
        return matches[0];
      });
      for (const runner of selected) {
        const observation = await executePreflightRunner(runner, signal, clock, scheduler);
        if (observation.state !== "healthy") throw new PreflightAdmissionRefusal("blocked", `Preflight blocks this session: ${observation.check}.`);
      }
      readConfig(scope);
      if (observationIdentity(sessionScope) !== revision) throw new PreflightAdmissionRefusal("stale", "Protected settings changed during preflight; re-check readiness.");
    } catch (error) {
      if (error instanceof PreflightAdmissionRefusal) throw error;
      throw new PreflightAdmissionRefusal("unavailable", "Session detectors could not verify readiness.", { cause: error });
    }
  };
  const descriptor = (workflowId: string): AnyWorkflowDescriptor => {
    const found = input.descriptors.resolve(workflowId);
    if (found === undefined) throw new PreflightAdmissionRefusal("scope-mismatch", "Preflight workflow is not registered.");
    return found;
  };
  const currentScope = (workflowId?: string, requestedInstance?: InstanceSelection): PreflightAdmissionScope => {
    if (requestedInstance !== undefined && Object.values(requestedInstance).includes("test")) {
      throw new PreflightAdmissionRefusal("scope-mismatch", "Test-instance targets are retired.");
    }
    const snapshot = database.withAuthorityTransaction(repositories => {
      repositories.runtimeConfig.requireSettingsCurrent();
      return selectActiveRunSettings(repositories);
    });
    const identity = { configSnapshotId: snapshot.configSnapshotId, configFingerprint: snapshot.fingerprint };
    return workflowId === undefined
      ? PreflightAdmissionScopeSchema.parse({ ...identity, descriptorFingerprint: input.descriptorSetHash, requestedCapabilities: ["executor.run"] })
      : workflowPreflightScope(descriptor(workflowId), { ...identity, ...(requestedInstance === undefined ? {} : { resolvedInstance: requestedInstance }) });
  };
  const runScope = (envelope: RunEnvelope): PreflightAdmissionScope => workflowPreflightScope(descriptor(envelope.workflow), {
    configSnapshotId: envelope.configSnapshotId, configFingerprint: envelope.configFingerprint,
    descriptorFingerprint: envelope.contractFingerprint, resolvedInstance: envelope.resolvedInstance,
  });
  return Object.freeze({ admission, prepareSession, currentScope, runScope, descriptor });
}
export type RuntimePreflight = ReturnType<typeof composeRuntimePreflight>;
