import { join } from "node:path";
import type { RuntimeAdmission } from "../admission/admission.js";
import type { OfflineMaintenanceOperation } from "../admission/lifetime-lock.js";
import type { Clock } from "../../../rules/time/clock.js";
import type { AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { AuthorityDatabase } from "../sqlite/authority-database.js";
import { verifyStoppedBackupManifestAtPath } from "../sqlite/backup-service.js";
import { assertStoppedBackupClosure, prepareStoppedBackupClosure, type ProfileBrowserClosure } from "./profile-inventory.js";
import { backupStoppedAuthority } from "./upgrade.js";

export async function upgradeEvidenceSchemas(admission: RuntimeAdmission, descriptors: readonly AnyWorkflowDescriptor[], browserClosure: ProfileBrowserClosure,
  operation: OfflineMaintenanceOperation, clock: Clock, processLockRoot: string): Promise<"current" | "upgraded"> {
  const plan = AuthorityDatabase.inspectEvidenceSchemaUpgrade(admission, descriptors);
  if (plan.record !== undefined && "backup" in plan.record) {
    const backup = verifyStoppedBackupManifestAtPath(admission, plan.record.backup.manifestPath);
    if (backup.manifest.authorityContentFingerprint !== plan.record.upgradeId || backup.manifest.sha256 !== plan.record.backup.sha256
      || backup.manifest.authorityGeneration !== plan.record.backup.authorityGeneration) throw new Error("evidence-schema-conversion-backup-changed");
    return "current";
  }
  if (plan.admissions.length === 0) return "current";
  const closure = await prepareStoppedBackupClosure(browserClosure, admission, operation, clock, processLockRoot);
  const backed = await backupStoppedAuthority(closure, admission, admission.stateRoot, clock, processLockRoot, operation, "schema-migration");
  const manifest = backed.manifests.at(-1);
  if (manifest === undefined) throw new Error("evidence-schema-conversion-backup-missing");
  const backup = verifyStoppedBackupManifestAtPath(admission, join(admission.stateRoot, "backups", "authority", `${manifest.backupFileName}.manifest.json`));
  assertStoppedBackupClosure(closure, admission, operation);
  await admission.qualifyStoppedProtectedSettingsUpgrade({ closure, operation, clock, processLockRoot, backupManifestPath: backup.manifestPath });
  AuthorityDatabase.convertEvidenceSchemas(admission, descriptors, processLockRoot, clock, plan.inspection.authorityContentFingerprint, backup, verifyStoppedBackupManifestAtPath);
  assertStoppedBackupClosure(closure, admission, operation);
  if (AuthorityDatabase.inspectEvidenceSchemaUpgrade(admission, descriptors).record === undefined) throw new Error("evidence-schema-conversion-readback-missing");
  return "upgraded";
}
