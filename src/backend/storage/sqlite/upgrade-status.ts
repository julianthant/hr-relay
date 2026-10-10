import type { Clock } from "../../../rules/time/clock.js";
import { withAuthorityDatabaseReadOnly } from "./backup-inspection.js";
import { AuthorityUpgradeRecordSchema } from "../../../models/config/authority.js";
import { nativeOrdinaryRecordFromRow } from "./native-record-row.js";
import type { RuntimeAdmission } from "../admission/admission.js";
import { AuthorityUpgradeInspectionSchema } from "./recovery-contracts.js";

/** A doctor observation, with no journal identity, private path, digest or settings payload. */
export function inspectAuthorityUpgradeStatus(admission: RuntimeAdmission, path: string, busyTimeoutMs: number, _clock: Clock) {
  try {
    return withAuthorityDatabaseReadOnly(admission, path, database => {
      const phases = database.prepare("SELECT * FROM database_upgrades ORDER BY rowid").all().map(raw => {
        const record = AuthorityUpgradeRecordSchema.parse(nativeOrdinaryRecordFromRow("database_upgrades", raw));
        return { phase: record.phase, fromSchemaVersion: record.fromSchemaVersion,
          toSchemaVersion: record.toSchemaVersion, recordedAt: record.recordedAt };
      });
      return AuthorityUpgradeInspectionSchema.parse(phases.length === 0
        ? { state: "absent", reason: "journal-empty" } : { state: "available", phases });
    }, busyTimeoutMs);
  } catch {
    // Parsing/storage diagnostics can include the private row; expose a closed unavailable state.
    return AuthorityUpgradeInspectionSchema.parse({ state: "unavailable",
      cause: { code: "authority-unavailable", summary: "authority upgrade journal could not be verified" },
    });
  }
}
