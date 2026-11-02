import { join,resolve } from "node:path";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";
import { type RuntimeAdmission } from "../admission/admission.js";
import { AuthorityDatabase } from "./authority-database.js";
import { hasUnprovedSourceClosure, retainUnprovedSourceOwners } from "../source-closure.js";
import type { VerifiedBackup } from "./backup-service.js";
import { assertProfileRestoreDatabaseBinding } from "./profile-local-databases.js";

function refuse(reason: string): never { throw new Error(`same-person-restore-candidate: ${reason}`); }

export function validateSamePersonRestoreCandidate(input: Readonly<{
  admission: RuntimeAdmission;
  activeAuthorityPath: string;
  verifiedBackup: VerifiedBackup;
}>): void {
  const admission = requireRuntimeAdmission(input.admission);
  const context = admission.readInstallationContext();
  if (context === undefined) refuse("profile installation context required");
  const binding = admission.profileBinding;
  const activeAuthorityPath = resolve(input.activeAuthorityPath);
  if (binding.installationId !== context.locator.installationId || activeAuthorityPath !== join(context.locator.stateRoot, "profiles", binding.profileId, "state.db")) refuse("active authority path differs from issued profile");
  try { assertProfileRestoreDatabaseBinding(activeAuthorityPath, binding); }
  catch (error) {
    if (hasUnprovedSourceClosure(error)) { admission.retainSourceClosure(error); retainUnprovedSourceOwners(error, { admission }); }
    throw error;
  }
  if (input.verifiedBackup.manifest.installationId !== binding.installationId || input.verifiedBackup.manifest.profileId !== binding.profileId) refuse("backup profile binding differs from issued profile");
  if (input.verifiedBackup.manifest.sourceDatabaseIdentity !== AuthorityDatabase.sourceDatabaseIdentity(admission.authorityBackupExpectedSource())) refuse("logical authority identity differs from issued profile");
}
