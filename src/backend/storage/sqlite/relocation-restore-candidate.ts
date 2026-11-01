import { AuthorityDatabase } from "./authority-database.js";
import type { VerifiedBackup } from "./backup-service.js";
import { assertProfileRestoreDatabaseBinding } from "./profile-local-databases.js";
import { join, resolve } from "node:path";
import type { StorageRelocationPlanView } from "../../../rules/commands/commands.js";
import { type RuntimeAdmission } from "../admission/admission.js";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";

function refuse(reason: string): never { throw new Error(`relocation-restore-candidate: ${reason}`); }

export function validateStorageRelocationRestoreCandidate(input: Readonly<{
  admission: RuntimeAdmission;
  activeAuthorityPath: string;
  verifiedBackup: VerifiedBackup;
}>): StorageRelocationPlanView | undefined {
  const admission = requireRuntimeAdmission(input.admission);
  const context = admission.readInstallationContext();
  if (context === undefined) refuse("profile installation context required");
  const binding = admission.profileBinding;
  const activeAuthorityPath = resolve(input.activeAuthorityPath);
  if (binding.installationId !== context.locator.installationId || activeAuthorityPath !== join(context.locator.stateRoot, "profiles", binding.profileId, "state.db")) refuse("active authority path differs from issued profile");
  assertProfileRestoreDatabaseBinding(activeAuthorityPath, binding);
  if (input.verifiedBackup.manifest.installationId !== binding.installationId || input.verifiedBackup.manifest.profileId !== binding.profileId) refuse("backup profile binding differs from issued profile");
  if (input.verifiedBackup.manifest.sourceDatabaseIdentity !== AuthorityDatabase.sourceDatabaseIdentity(admission.authorityBackupExpectedSource())) refuse("logical authority identity differs from issued profile");
  if (context.locator.generation === 0) return undefined;
  refuse("profile restore after full-machine relocation is unsupported");
}
