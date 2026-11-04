import { join } from "node:path";
import type { Clock } from "../../../rules/time/clock.js";
import type { RuntimeAdmission } from "../admission/admission.js";
import type { OfflineMaintenanceOperation } from "../admission/lifetime-lock.js";
import { createStoppedProtectedSettingsStore } from "../configuration/canonical-credential-store.js";
import { authenticateDocument } from "../configuration/credential-store.js";
import { inspectProtectedSettingsSource } from "../configuration/protected-settings-upgrade.js";
import { assertStoppedBackupClosure, prepareStoppedBackupClosure, type ProfileBrowserClosure } from "./profile-inventory.js";
import { backupStoppedAuthority } from "./upgrade.js";

export async function upgradeProtectedSettings(admission: RuntimeAdmission, browserClosure: ProfileBrowserClosure,
  operation: OfflineMaintenanceOperation, clock: Clock, processLockRoot: string): Promise<"current" | "upgraded"> {
  admission.assertStoppedProtectedSettingsUpgrade();
  const owner = createStoppedProtectedSettingsStore(admission), source = owner.read();
  if (source === undefined) throw new Error("protected-settings-upgrade-source-missing");
  if (typeof source.value === "object" && source.value !== null && Reflect.get(source.value, "schemaVersion") === 5) {
    const document = authenticateDocument(source.value);
    if (document.record.revision !== source.revision) throw new Error("protected-settings-upgrade-revision-mismatch");
    return "current";
  }
  const prior = inspectProtectedSettingsSource(source.value);
  if (prior.record.revision !== source.revision || !Number.isSafeInteger(source.revision + 1)) throw new Error("protected-settings-upgrade-revision-mismatch");
  const closure = await prepareStoppedBackupClosure(browserClosure, admission, operation, clock, processLockRoot);
  const assertStopped = () => {
    admission.assertStoppedProtectedSettingsUpgrade();
    assertStoppedBackupClosure(closure, admission, operation);
  };
  const backed = await backupStoppedAuthority(closure, admission, admission.stateRoot, clock, processLockRoot, operation, "schema-migration");
  const manifest = backed.manifests.at(-1);
  if (manifest === undefined) throw new Error("protected-settings-upgrade-backup-missing");
  await admission.qualifyStoppedProtectedSettingsUpgrade({ closure, operation, clock, processLockRoot,
    backupManifestPath: join(admission.stateRoot, "backups", "authority", `${manifest.backupFileName}.manifest.json`) });
  assertStopped();
  admission.assertStoppedProfileUpgrade(join(admission.stateRoot, "state.db"), processLockRoot);
  const result = await owner.convert(source, clock.now().toISOString());
  if (authenticateDocument(result.value).record.revision !== source.revision + 1) throw new Error("protected-settings-upgrade-readback-invalid");
  assertStopped();
  return "upgraded";
}
