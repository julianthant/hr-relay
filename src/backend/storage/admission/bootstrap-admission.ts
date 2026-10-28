import { AuthoritySourceClosureUnprovedError, retainAuthoritySourceClosure } from "../source-closure.js";
import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { RuntimeAdmission } from "./admission.js";
import { acquireInstallation, type RuntimePair } from "./installation.js";
import { rebuildRuntimeIsolation } from "../../app/config/runtime-isolation.js";

export function acquireEntrypointAdmission(workspace: string, mode: "shared" | "exclusive",
  beforeInitialAuthorityOpen?: (pair: RuntimePair) => void): RuntimeAdmission {
  beforeInitialAuthorityOpen?.({ stateRoot: resolve(workspace, rebuildRuntimeIsolation.stateRoot), artifactRoot: resolve(workspace, rebuildRuntimeIsolation.artifactRoot) });
  return RuntimeAdmission.acquireMachine(workspace, mode);
}

export async function acquireDashboardEntrypointAdmission(workspace: string, mode: "shared" | "exclusive"): Promise<RuntimeAdmission> {
  const admission = acquireDashboard(workspace, mode);
  try {
    if (!admission.requiresFlatStoreMigration()) return admission;
  } catch (error) {
    if (error instanceof AuthoritySourceClosureUnprovedError) throw retainAuthoritySourceClosure([error], { admission });
    try { admission.release(); }
    catch (cleanup) { throw retainAuthoritySourceClosure([error, cleanup], { admission }); }
    throw error;
  }
  admission.release();
  const stopped = RuntimeAdmission.acquireStoppedMachineControlMaintenance(workspace);
  try { await stopped.startCleanFlatStore(); }
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
  return RuntimeAdmission.acquireDashboard(workspace, mode);
}

export async function acquireStorageBackupEntrypointAdmission(workspace: string): Promise<RuntimeAdmission> {
  if (!existsSync(resolve(workspace, ".tracker/control/installation.json"))) return acquireEntrypointAdmission(workspace, "exclusive");
  const canonical = realpathSync(workspace);
  const observed = RuntimeAdmission.fromInstallationLease(acquireInstallation(canonical, "exclusive"));
  try { if (!observed.requiresFlatStoreMigration()) return observed; }
  catch (error) {
    if (error instanceof AuthoritySourceClosureUnprovedError) throw retainAuthoritySourceClosure([error], { admission: observed });
    observed.release(); throw error;
  }
  observed.release();
  const machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(canonical);
  try { return await machine.forStoppedFlatBackup(); }
  catch (error) {
    if (error instanceof AuthoritySourceClosureUnprovedError) throw retainAuthoritySourceClosure([error], { admission: machine });
    machine.release(); throw error;
  }
}
