import { dirname, join } from "node:path";
import type { Clock } from "../../../domain/clock.js";
import type { RuntimeAdmission } from "../../../infra/runtime-control/admission.js";
import type { StorageRouteDeps } from "../routes/storage-types.js";
export function composeStorage(input: { admission: RuntimeAdmission; repoRoot: string; stateRoot: string; backupDirectory: string; clock: Clock;
  serviceState: StorageRouteDeps["storage"]["serviceState"] }): StorageRouteDeps {
  return { storage: { admission: input.admission, doctorOptions: { stateRootTrustAnchor: dirname(input.stateRoot), stateRoot: input.stateRoot,
    authorityPath: join(input.stateRoot, "state.db"), backupDirectory: input.backupDirectory, busyTimeoutMs: 5000 },
    clock: input.clock, serviceState: input.serviceState } };
}
