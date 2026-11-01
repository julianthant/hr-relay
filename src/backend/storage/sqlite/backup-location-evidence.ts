import { join } from "node:path";
import type { RuntimeAdmission } from "../admission/admission.js";
import { AuthorityDatabase } from "./authority-database.js";
import { verifyBackupManifestAtPath } from "./backup-service.js";
import { requireDatabaseSourcePath } from "./recovery-admission.js";

export function classifyBackupLocationOrigin(
  admission: RuntimeAdmission,
  activeAuthorityPath: string,
  backupSourceIdentity: string,
): "current" {
  if (activeAuthorityPath !== join(admission.stateRoot, "state.db")) throw new Error("backup-location-active-path-mismatch");
  const expected = admission.authorityBackupExpectedSource();
  if (expected.kind !== "profile" || backupSourceIdentity !== AuthorityDatabase.sourceDatabaseIdentity(expected)) {
    throw new Error("backup-profile-binding-mismatch");
  }
  return "current";
}

/** Full byte and semantic proof for a copied backup; the result never grants restore admission. */
export async function verifyBackupLocationEvidence(admission: RuntimeAdmission,
  activeAuthorityPath: string, manifestPath: string) {
  requireDatabaseSourcePath(manifestPath);
  const verified = await verifyBackupManifestAtPath(admission, manifestPath);
  const origin = classifyBackupLocationOrigin(admission, activeAuthorityPath, verified.manifest.sourceDatabaseIdentity);
  return { verified, origin, selection: "single-database" as const };
}
