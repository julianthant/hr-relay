import { lstatSync } from "node:fs";
import { join, resolve } from "node:path";
import { ArchiveDatabase } from "../sqlite/archive-database.js";
import { AuthorityDatabase } from "../sqlite/authority-database.js";
import { acquireExclusiveRuntimeAdmission, acquireInitialRuntimeAdmission, acquireSharedRuntimeAdmission,
  type RuntimeAdmission } from "./admission.js";
import type { ExistingAuthorityEvidence, RuntimePair } from "./installation.js";
import { rebuildRuntimeIsolation } from "../../config/runtime-isolation.js";

function verifyKnownDefaultAuthority(pair: RuntimePair, inspection: RuntimeAdmission): ExistingAuthorityEvidence {
  const path = join(pair.stateRoot, "state.db");
  const authority = AuthorityDatabase.inspectExistingReadOnly(inspection, path);
  const archivePath = join(pair.stateRoot, rebuildRuntimeIsolation.archiveDatabaseFile);
  if (lstatSync(archivePath, { throwIfNoEntry: false }) !== undefined) {
    const archive = new ArchiveDatabase(inspection, archivePath, { readOnly: true });
    archive.close();
  }
  return Object.freeze({ kind: "verified-existing", pair, authorityGeneration: authority.authorityGeneration,
    databaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(path) });
}

export function acquireEntrypointAdmission(workspace: string, mode: "shared" | "exclusive"): RuntimeAdmission {
  const control = resolve(workspace, ".runtime-control");
  if (lstatSync(control, { throwIfNoEntry: false }) === undefined) {
    const first = acquireInitialRuntimeAdmission(workspace, verifyKnownDefaultAuthority);
    if (mode === "exclusive") return first;
    first.release();
  }
  return mode === "exclusive" ? acquireExclusiveRuntimeAdmission(workspace) : acquireSharedRuntimeAdmission(workspace);
}
