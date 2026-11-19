import { resolve } from "node:path";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";
import type { RuntimeAdmission } from "../admission/admission.js";
import { inspectBackupFileOffThread } from "./backup-inspection-worker.js";
import type { BackupCopyInspection } from "./backup-inspection.js";
import { AuthoritySourceChangedError } from "./readonly-authority-snapshot.js";

/**
 * The whole read-only inspection AuthorityDatabase.inspectExistingReadOnly runs, of a consistent copy of the store, admitted here
 * and run on a worker thread. A write that lands on the store while it runs rejects with AuthoritySourceChangedError: that copy
 * judged nothing about the store as it is now. An abort rejects at once.
 */
export async function inspectAuthorityOffThread(admission: RuntimeAdmission, pathInput: string,
  options: Readonly<{ signal?: AbortSignal }> = {}): Promise<BackupCopyInspection> {
  const path = resolve(pathInput);
  requireRuntimeAdmission(admission).assertReadOnlyAuthorityDatabase(path);
  try { return await inspectBackupFileOffThread(path, undefined, options); }
  catch (error) {
    // The worker's reply carries the name and message only; a damaged store that also changed arrives as an AggregateError instead.
    if (error instanceof Error && error.message === new AuthoritySourceChangedError().message) throw new AuthoritySourceChangedError();
    throw error;
  }
}
