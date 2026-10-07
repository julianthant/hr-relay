import { requiredPreflightChecks } from "../../../models/preflight/preflight.js";
import { dirname, join } from "node:path";
import type { AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { selectActiveRunSettings, selectRunSettings } from "../../runs/settings/run-settings.js";
import type { RuntimeIsolation } from "../../../models/config/define-runtime-isolation.js";
import type { Clock } from "../../../rules/time/clock.js";
import { configSnapshotAbsentLeaves, executionConfigFromStored } from "../../../models/config/snapshot-generations.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { createPreflightAdmission, PreflightAdmissionRefusal, PreflightAdmissionScopeSchema, type PreflightAdmissionScope } from "../../../rules/preflight/preflight-admission.js";
import { optionalSecretFamily, providerModelChain, protectedSecretRevision, type ProtectedSecretSource } from "../../../models/config/secrets.js";
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
    if (sha256Hex(canonicalJsonStringify(snapshot.config)) !== snapshot.fingerprint || configSnapshotAbsentLeaves(snapshot.config).length > 0) {
      throw new PreflightAdmissionRefusal("scope-mismatch", "Preflight retained configuration is unavailable.");
    }
    return executionConfigFromStored(snapshot.config);
  };
  const admission = createPreflightAdmission({
    clock, scheduler: createTimeoutDeadlineScheduler(clock),
    validate: scope => { readConfig(scope); },
    observationIdentity: scope => {
      if (!requiredPreflightChecks(scope.requestedCapabilities).some(check => check.startsWith("secrets."))) return "no-protected-dependency";
      try { return String(protectedSecretRevision(input.protectedSecrets)); }
      catch { throw new PreflightAdmissionRefusal("unavailable", "Protected settings presence could not be verified."); }
    },
    runners: scope => {
      const config = readConfig(scope);
      const gemini = optionalSecretFamily("geminiApiKeys", input.environment).length > 0 && providerModelChain("geminiApiKeys", config).length > 0;
      return (input.runnerFactory ?? createRuntimePreflightRunners)({
        scope, config, protectedSecrets: input.protectedSecrets,
        providerAvailability: { "gemini/ocr.extract": gemini, "gemini/ai.advisory": false, "census/geocode.census": true, "nominatim/geocode.nominatim": true },
        dashboard: {
          repoRoot: input.repoRoot, stateRoot, artifactRoot: runtimeAdmission.artifactRoot,
          backendPort: input.isolation.backendPort, frontendPort: input.isolation.frontendPort,
          processLockRoot: join(input.repoRoot, input.isolation.processLockRoot), clock,
          authorityHealth: new AuthorityHealthPreflightRunner(runtimeAdmission, { stateRootTrustAnchor: dirname(stateRoot), stateRoot,
            authorityPath: join(stateRoot, "state.db"), backupDirectory: join(stateRoot, "backups", "authority"), busyTimeoutMs: 5000 }, clock),
          listLiveWorkerProcesses: () => database.authority.workerLeases.listLive().map(lease => ({ workerId: lease.workerId, processId: lease.processId })),
        },
      });
    },
  });
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
  return Object.freeze({ admission, currentScope, runScope, descriptor });
}
export type RuntimePreflight = ReturnType<typeof composeRuntimePreflight>;
