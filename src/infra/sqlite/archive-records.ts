import type { createRunLifecycleStorage } from "../../core/run-lifecycle-storage.js";

/** A uses the shared transfer fence for publication and canonical ownership for reads. */
export function createArchiveRecords(storage: ReturnType<typeof createRunLifecycleStorage>) {
  return Object.freeze({
    capture: storage.saveReport,
    verify: storage.verifyReport,
    publish: storage.publishReport,
    read: storage.readReport,
  });
}
