import type { ProfileBrowserClosure } from "../maintenance/profile-inventory.js";
import { RuntimeLifetimeLock } from "./lifetime-lock.js";
import { retainAuthoritySourceClosure, hasUnprovedSourceClosure } from "../source-closure.js";
import { RuntimeAdmission } from "./admission.js";

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
    if (hasUnprovedSourceClosure(error)) throw retainAuthoritySourceClosure([error], { admission });
    try { admission.release(); }
    catch (cleanup) { throw retainAuthoritySourceClosure([error, cleanup], { admission }); }
    throw error;
  }
  admission.release();
  const stopped = RuntimeAdmission.acquireStoppedMachineControlMaintenance(workspace, lifetime);
  try { await stopped.startCleanFlatStore(browserClosure); }
  catch (error) {
    if (hasUnprovedSourceClosure(error)) throw retainAuthoritySourceClosure([error], { admission: stopped });
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
