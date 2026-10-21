import { resolve } from "node:path";
import { RuntimeAdmission } from "./admission.js";
import { AdmissionMutexBusyError, admissionMutexOwnerProvenDead, recoverAbandonedAdmissionMutexAtStartup, type RuntimePair } from "./installation.js";
import { rebuildRuntimeIsolation } from "../../app/config/runtime-isolation.js";

export function acquireEntrypointAdmission(workspace: string, mode: "shared" | "exclusive",
  beforeInitialAuthorityOpen?: (pair: RuntimePair) => void): RuntimeAdmission {
  beforeInitialAuthorityOpen?.({ stateRoot: resolve(workspace, rebuildRuntimeIsolation.stateRoot), artifactRoot: resolve(workspace, rebuildRuntimeIsolation.artifactRoot) });
  try { return RuntimeAdmission.acquireMachine(workspace, mode); }
  catch (error) {
    if (!(error instanceof AdmissionMutexBusyError) || !admissionMutexOwnerProvenDead(workspace)) throw error;
    recoverAbandonedAdmissionMutexAtStartup(workspace);
    return RuntimeAdmission.acquireMachine(workspace, mode);
  }
}
