import { join } from "node:path";
import type { RuntimeAdmission } from "../admission/admission.js";
import { AuthorityDatabase } from "./authority-database.js";
import { parseBackupManifestFile, verifyBackupManifestAtPath } from "./backup-service.js";
import { requireDatabaseSourcePath } from "./recovery-admission.js";

export type BackupLocationOrigin = "current" | "previous-location";

// A settled locator receipt authenticates backup provenance, never restore eligibility.
export function classifyBackupLocationOrigin(
  admission: RuntimeAdmission,
  activeAuthorityPath: string,
  backupSourceIdentity: string,
): BackupLocationOrigin {
  if (activeAuthorityPath !== join(admission.stateRoot, "state.db")) throw new Error("backup-location-active-path-mismatch");
  const currentIdentity = AuthorityDatabase.sourceDatabaseIdentity(activeAuthorityPath);
  if (backupSourceIdentity === currentIdentity) return "current";
  const locator = admission.locator;
  if (activeAuthorityPath !== join(locator.stateRoot, "state.db")) throw new Error("backup-location-active-path-mismatch");
  const receipts = admission.readRelocationReceipts();
  if (receipts.some((receipt) => AuthorityDatabase.sourceDatabaseIdentity(join(receipt.source.stateRoot, "state.db")) === backupSourceIdentity)) {
    return "previous-location";
  }
  throw new Error("backup-origin-outside-settled-relocation-history");
}

/** Full byte and semantic proof for a copied backup; the result never grants restore admission. */
export async function verifyBackupLocationEvidence(admission: RuntimeAdmission,
  activeAuthorityPath: string, manifestPath: string) {
  requireDatabaseSourcePath(manifestPath);
  const manifest = parseBackupManifestFile(manifestPath);
  const origin = classifyBackupLocationOrigin(admission, activeAuthorityPath, manifest.sourceDatabaseIdentity);
  const verified = await verifyBackupManifestAtPath(admission, manifestPath, manifest.sourceDatabaseIdentity);
  return { verified, origin, selection: "single-database" as const };
}
