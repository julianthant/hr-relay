import { join } from "node:path";
import type { RuntimeAdmission } from "../admission/admission.js";
import { AuthorityDatabase } from "./authority-database.js";
import { parseBackupManifestFile, verifyBackupManifestAtPath } from "./backup-service.js";
import { requireDatabaseSourcePath } from "./recovery-admission.js";
import { inspectDoctorPairWithOrigin } from "./storage-recovery-status.js";

export type BackupLocationOrigin = "current" | "previous-location";

/** A settled locator receipt can authenticate old backup provenance, never restore eligibility. */
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
  const classify = (identity: string) => classifyBackupLocationOrigin(admission, activeAuthorityPath, identity);
  if (manifestPath.endsWith(".lifecycle.json")) {
    const inspected = await inspectDoctorPairWithOrigin(admission, manifestPath, classify);
    return { ...inspected, selection: "lifecycle-pair" as const };
  }
  const manifest = parseBackupManifestFile(manifestPath);
  const origin = classify(manifest.sourceDatabaseIdentity);
  const verified = await verifyBackupManifestAtPath(admission, manifestPath, manifest.sourceDatabaseIdentity);
  return { verified, origin, selection: "single-database" as const };
}
