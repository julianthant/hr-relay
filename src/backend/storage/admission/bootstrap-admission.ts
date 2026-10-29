import type { ProfileBrowserClosure } from "../maintenance/profile-inventory.js";
import { RuntimeLifetimeLock } from "./lifetime-lock.js";
import { AuthoritySourceClosureUnprovedError, retainAuthoritySourceClosure } from "../source-closure.js";
import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { RuntimeAdmission } from "./admission.js";
import { acquireInstallation } from "./installation.js";

export function acquireEntrypointAdmission(workspace: string, mode: "shared" | "exclusive", lifetime: RuntimeLifetimeLock): RuntimeAdmission {
  if (!(lifetime instanceof RuntimeLifetimeLock)) throw new Error("runtime-lifetime-required");
  lifetime.assertHeld();
  return RuntimeAdmission.acquireMachine(workspace, mode, lifetime);
}

export async function acquireDashboardEntrypointAdmission(browserClosure: ProfileBrowserClosure, workspace: string, mode: "shared" | "exclusive", lifetime: RuntimeLifetimeLock): Promise<RuntimeAdmission> {
  const admission = acquireDashboard(workspace, mode, lifetime);
  try {
    if (!admission.requiresFlatStoreMigration()) return admission;
  } catch (error) {
    if (error instanceof AuthoritySourceClosureUnprovedError) throw retainAuthoritySourceClosure([error], { admission });
    try { admission.release(); }
    catch (cleanup) { throw retainAuthoritySourceClosure([error, cleanup], { admission }); }
    throw error;
  }
  admission.release();
  const stopped = RuntimeAdmission.acquireStoppedMachineControlMaintenance(workspace, lifetime);
  try { await stopped.startCleanFlatStore(browserClosure); }
  catch (error) {
    if (error instanceof AuthoritySourceClosureUnprovedError) throw retainAuthoritySourceClosure([error], { admission: stopped });
    try { stopped.release(); }
    catch (cleanup) { throw retainAuthoritySourceClosure([error, cleanup], { admission: stopped }); }
    throw error;
  }
  stopped.release();
  return acquireDashboard(workspace, mode, lifetime);
}

function acquireDashboard(workspace: string, mode: "shared" | "exclusive", lifetime: RuntimeLifetimeLock): RuntimeAdmission {
  return RuntimeAdmission.acquireDashboard(workspace, mode, lifetime);
}

export async function acquireStorageBackupEntrypointAdmission(workspace: string, lifetime: RuntimeLifetimeLock): Promise<RuntimeAdmission> {
  if (!(lifetime instanceof RuntimeLifetimeLock)) throw new Error("runtime-lifetime-required");
  lifetime.assertHeld();
  if (!existsSync(resolve(workspace, ".tracker/control/installation.json"))) return acquireEntrypointAdmission(workspace, "exclusive", lifetime);
  const canonical = realpathSync(workspace);
  const observed = RuntimeAdmission.fromInstallationLease(acquireInstallation(canonical, "exclusive", lifetime));
  try { if (!observed.requiresFlatStoreMigration()) return observed; }
  catch (error) {
    if (error instanceof AuthoritySourceClosureUnprovedError) throw retainAuthoritySourceClosure([error], { admission: observed });
    observed.release(); throw error;
  }
  observed.release();
  const machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(canonical, lifetime);
  try { return await machine.forStoppedFlatBackup(); }
  catch (error) {
    if (error instanceof AuthoritySourceClosureUnprovedError) throw retainAuthoritySourceClosure([error], { admission: machine });
    machine.release(); throw error;
  }
}
