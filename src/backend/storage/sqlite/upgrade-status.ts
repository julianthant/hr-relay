import type { Clock } from "../../../rules/time/clock.js";
import { isAuthoritySourceChanged, withAuthorityDatabaseReadOnly } from "./readonly-authority-snapshot.js";
import { AuthorityUpgradeRecordSchema } from "../../../models/config/authority.js";
import { nativeOrdinaryRecordFromRow } from "./native-record-row.js";
import type { RuntimeAdmission } from "../admission/admission.js";
import { AuthorityUpgradeInspectionSchema } from "../../../models/storage/storage-status.js";
import { authorityUpgradeJournalOf } from "../../../rules/storage/upgrade-journal.js";

/** A doctor observation, with no journal identity, private path, digest or settings payload. */
export function inspectAuthorityUpgradeStatus(admission: RuntimeAdmission, path: string, busyTimeoutMs: number, _clock: Clock) {
  try {
    return withAuthorityDatabaseReadOnly(admission, path, database => {
      const records = database.prepare("SELECT * FROM database_upgrades ORDER BY rowid").all()
        .map(raw => AuthorityUpgradeRecordSchema.parse(nativeOrdinaryRecordFromRow("database_upgrades", raw)));
      if (authorityUpgradeJournalOf(records).journal === "empty") return AuthorityUpgradeInspectionSchema.parse({ state: "absent", reason: "journal-empty" });
      const phases = records.map(({ phase, fromSchemaVersion, toSchemaVersion, recordedAt }) => ({ phase, fromSchemaVersion, toSchemaVersion, recordedAt }));
      return AuthorityUpgradeInspectionSchema.parse({ state: "available", phases });
    }, busyTimeoutMs);
  } catch (error) {
    if (isAuthoritySourceChanged(error)) throw error;
    // Parsing/storage diagnostics can include the private row; expose a closed unavailable state.
    return AuthorityUpgradeInspectionSchema.parse({ state: "unavailable",
      cause: { code: "authority-unavailable", summary: "authority upgrade journal could not be verified" },
    });
  }
}
