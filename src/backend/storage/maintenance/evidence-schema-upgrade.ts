import { basename, join } from "node:path";
import type { RuntimeAdmission } from "../admission/admission.js";
import type { OfflineMaintenanceOperation } from "../admission/lifetime-lock.js";
import type { Clock } from "../../../rules/time/clock.js";
import type { AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { AuthorityDatabase } from "../sqlite/authority-database.js";
import { verifyStoppedBackupManifestAtPath } from "../sqlite/backup-service.js";
import { assertStoppedBackupClosure, prepareStoppedBackupClosure, type ProfileBrowserClosure } from "./profile-inventory.js";
import { readFixedLayoutIntent } from "./fixed-layout.js";
import { backupStoppedAuthority } from "./upgrade.js";

export async function upgradeEvidenceSchemas(admission: RuntimeAdmission, descriptors: readonly AnyWorkflowDescriptor[], browserClosure: ProfileBrowserClosure,
  operation: OfflineMaintenanceOperation, clock: Clock, processLockRoot: string): Promise<"current" | "upgraded"> {
  let result: "current" | "upgraded" = "current";
  // Each pending conversion is published behind its own verified backup of the source it converts.
  for (;;) {
    const plan = AuthorityDatabase.inspectEvidenceSchemaUpgrade(admission, descriptors);
    for (const record of plan.records) {
      const reference = record.backup.manifestPath;
      const name = basename(reference);
      if (!name.endsWith(".sqlite.manifest.json") || name.includes("\\")) throw new Error("evidence-schema-conversion-backup-path-invalid");
      const relative = `backups/authority/${name}`;
      const target = join(admission.stateRoot, relative);
      if (reference !== relative && reference !== target) {
        const context = admission.readInstallationContext();
        const move = context && readFixedLayoutIntent(context.workspace);
        const profile = move?.profiles.find(entry => entry.profileId === record.evidenceSchemas.profileId);
        if (move?.phase !== "complete" || move.installationId !== record.evidenceSchemas.installationId
          || profile?.authorityPath !== join(admission.stateRoot, "state.db") || reference !== join(profile.sourceRoot, relative))
          throw new Error("evidence-schema-conversion-backup-path-unproved");
      }
      const backup = verifyStoppedBackupManifestAtPath(admission, target);
      if (name !== `${backup.manifest.backupFileName}.manifest.json` || backup.manifest.schemaVersion !== record.fromSchemaVersion
        || backup.manifest.authorityContentFingerprint !== record.upgradeId || backup.manifest.sha256 !== record.backup.sha256
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
