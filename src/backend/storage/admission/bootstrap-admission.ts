import { lstatSync } from "node:fs";
import { join, resolve } from "node:path";
import { AuthorityDatabase } from "../sqlite/authority-database.js";
import { acquireExclusiveRuntimeAdmission, acquireInitialRuntimeAdmission, acquireSharedRuntimeAdmission,
  type RuntimeAdmission } from "./admission.js";
import { AdmissionMutexBusyError, admissionMutexOwnerProvenDead, recoverAbandonedAdmissionMutexAtStartup, type ExistingAuthorityEvidence, type RuntimePair } from "./installation.js";

function verifyKnownDefaultAuthority(pair: RuntimePair, inspection: RuntimeAdmission): ExistingAuthorityEvidence {
  const path = join(pair.stateRoot, "state.db");
  const authority = AuthorityDatabase.inspectExistingReadOnly(inspection, path);
  return Object.freeze({ kind: "verified-existing", pair, authorityGeneration: authority.authorityGeneration,
    databaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(path) });
}

function initializeKnownDefaultAuthority(pair: RuntimePair, initialization: RuntimeAdmission): void {
  const authority = AuthorityDatabase.open(initialization, {
    path: join(pair.stateRoot, "state.db"), busyTimeoutMs: 5000, migrationOwner: "runtime-bootstrap",
  });
  authority.close();
}

export function acquireEntrypointAdmission(workspace: string, mode: "shared" | "exclusive",
  beforeInitialAuthorityOpen?: (pair: RuntimePair) => void): RuntimeAdmission {
  const control = resolve(workspace, ".tracker/control");
  if (lstatSync(control, { throwIfNoEntry: false }) === undefined) {
    const first = acquireInitialRuntimeAdmission(workspace,
      (pair, inspection) => { beforeInitialAuthorityOpen?.(pair); return verifyKnownDefaultAuthority(pair, inspection); },
      (pair, initialization) => { beforeInitialAuthorityOpen?.(pair); initializeKnownDefaultAuthority(pair, initialization); });
    if (mode === "exclusive") return first;
    first.release();
  }
  const acquire = (): RuntimeAdmission => mode === "exclusive"
    ? acquireExclusiveRuntimeAdmission(workspace) : acquireSharedRuntimeAdmission(workspace);
  try { return acquire(); }
  catch (error) {
    if (!(error instanceof AdmissionMutexBusyError) || !admissionMutexOwnerProvenDead(workspace)) throw error;
    recoverAbandonedAdmissionMutexAtStartup(workspace);
    return acquire();
  }
}
