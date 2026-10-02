import type { Clock } from "../../../rules/time/clock.js";
import { AuthorityDatabase } from "./authority-database.js";
import type { RuntimeAdmission } from "../admission/admission.js";
import { AuthorityUpgradeInspectionSchema } from "./recovery-contracts.js";

/** A doctor observation, with no journal identity, private path, digest or settings payload. */
export function inspectAuthorityUpgradeStatus(admission: RuntimeAdmission, path: string, busyTimeoutMs: number, clock: Clock) {
  try {
    const database = AuthorityDatabase.open(admission, { path, busyTimeoutMs,
      migrationOwner: "storage-doctor", openMode: "storage-doctor-read-only-no-migrate",
    }, clock);
    try {
      return AuthorityUpgradeInspectionSchema.parse(database.readUpgradePhases());
    } finally { database.close(); }
  } catch {
    // Parsing/storage diagnostics can include the private row; expose a closed unavailable state.
    return AuthorityUpgradeInspectionSchema.parse({ state: "unavailable",
      cause: { code: "authority-unavailable", summary: "authority upgrade journal could not be verified" },
    });
  }
}
