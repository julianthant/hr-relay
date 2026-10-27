import { AuthoritySourceClosureUnprovedError, retainAuthoritySourceClosure } from "../source-closure.js";
import { systemClock } from "../../../rules/time/clock.js";
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

export async function acquireDashboardEntrypointAdmission(workspace: string, mode: "shared" | "exclusive"): Promise<RuntimeAdmission> {
  const { flatProfileClaimNeedsRecovery, resumeFlatProfileClaim } = await import("../maintenance/flat-profile-claim.js");
  const admission = acquireDashboard(workspace, mode);
  try {
    if (!flatProfileClaimNeedsRecovery(admission)) return admission;
  } catch (error) {
    if (error instanceof AuthoritySourceClosureUnprovedError) throw retainAuthoritySourceClosure([error], { admission });
    try { admission.release(); }
    catch (cleanup) { throw retainAuthoritySourceClosure([error, cleanup], { admission }); }
    throw error;
  }
  admission.release();
  const stopped = RuntimeAdmission.acquireStoppedMachineControlMaintenance(workspace);
  try { await resumeFlatProfileClaim(stopped, systemClock); }
  catch (error) {
    if (error instanceof AuthoritySourceClosureUnprovedError) throw retainAuthoritySourceClosure([error], { admission: stopped });
    try { stopped.release(); }
    catch (cleanup) { throw retainAuthoritySourceClosure([error, cleanup], { admission: stopped }); }
    throw error;
  }
  stopped.release();
  return acquireDashboard(workspace, mode);
}

function acquireDashboard(workspace: string, mode: "shared" | "exclusive"): RuntimeAdmission {
  try { return RuntimeAdmission.acquireDashboard(workspace, mode); }
  catch (error) {
    if (!(error instanceof AdmissionMutexBusyError) || !admissionMutexOwnerProvenDead(workspace)) throw error;
    recoverAbandonedAdmissionMutexAtStartup(workspace);
    return RuntimeAdmission.acquireDashboard(workspace, mode);
  }
}
