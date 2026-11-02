import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import type { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { hasUnprovedSourceClosure, retainAuthoritySourceClosure } from "../../../../src/backend/storage/source-closure.js";

export async function acquireFlatArchiveFixture(workspace: string, lifetime: RuntimeLifetimeLock): Promise<RuntimeAdmission> {
  const machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(workspace, lifetime);
  try { return await machine.forStoppedFlatBackup(); }
  catch (error) {
    if (hasUnprovedSourceClosure(error)) throw retainAuthoritySourceClosure([error], { admission: machine });
    try { machine.release(); }
    catch (cleanup) { throw retainAuthoritySourceClosure([error, cleanup], { admission: machine }); }
    throw error;
  }
}
