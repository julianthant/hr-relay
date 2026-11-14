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
  let result: "current" | "upgraded" = "current";
  // Each pending conversion is published behind its own verified backup of the source it converts.
  for (;;) {
    const plan = AuthorityDatabase.inspectEvidenceSchemaUpgrade(admission, descriptors);
    for (const record of plan.records) {
      const backup = verifyStoppedBackupManifestAtPath(admission, record.backup.manifestPath);
      if (backup.manifest.authorityContentFingerprint !== record.upgradeId || backup.manifest.sha256 !== record.backup.sha256
        || backup.manifest.authorityGeneration !== record.backup.authorityGeneration) throw new Error("evidence-schema-conversion-backup-changed");
    }
    const conversion = plan.pending[0];
    if (conversion === undefined) return result;
    const closure = await prepareStoppedBackupClosure(browserClosure, admission, operation, clock, processLockRoot);
    const backed = await backupStoppedAuthority(closure, admission, admission.stateRoot, clock, processLockRoot, operation, "schema-migration");
    const manifest = backed.manifests.at(-1);
    if (manifest === undefined) throw new Error("evidence-schema-conversion-backup-missing");
    const backup = verifyStoppedBackupManifestAtPath(admission, join(admission.stateRoot, "backups", "authority", `${manifest.backupFileName}.manifest.json`));
    assertStoppedBackupClosure(closure, admission, operation);
    await admission.qualifyStoppedProtectedSettingsUpgrade({ closure, operation, clock, processLockRoot, backupManifestPath: backup.manifestPath });
    AuthorityDatabase.convertEvidenceSchemas(admission, descriptors, processLockRoot, clock, plan.inspection.authorityContentFingerprint, backup, verifyStoppedBackupManifestAtPath);
    assertStoppedBackupClosure(closure, admission, operation);
    if (AuthorityDatabase.inspectEvidenceSchemaUpgrade(admission, descriptors).pending.some(pending => pending.id === conversion.id))
      throw new Error("evidence-schema-conversion-readback-missing");
    result = "upgraded";
  }
}
