import type { CredentialStore } from "../../../../models/config/credential-store.js";
import { dirname, join } from "node:path";
import type { Clock } from "../../../../rules/time/clock.js";
import type { RuntimeAdmission } from "../../../storage/admission/admission.js";
import type { StorageRouteDeps } from "../../../transports/http/routes/storage-types.js";
export function composeStorage(input: { credentials: CredentialStore; admission: RuntimeAdmission; repoRoot: string; stateRoot: string; backupDirectory: string; clock: Clock;
  serviceState: StorageRouteDeps["storage"]["serviceState"] }): StorageRouteDeps {
  return { storage: { credentials: input.credentials, admission: input.admission, doctorOptions: { stateRootTrustAnchor: dirname(input.stateRoot), stateRoot: input.stateRoot,
    authorityPath: join(input.stateRoot, "state.db"), backupDirectory: input.backupDirectory, busyTimeoutMs: 5000 },
    clock: input.clock, serviceState: input.serviceState } };
}
