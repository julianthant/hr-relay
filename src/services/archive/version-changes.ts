import type { createRunLifecycleStorage } from "../../core/run-lifecycle-storage.js";
/** A owns reviewed selection policy; shared storage owns immutable membership and progress fencing. */
export function createVersionChanges(storage: ReturnType<typeof createRunLifecycleStorage>) {
  return Object.freeze({read:storage.readVersionChange,write:storage.writeVersionChange});
}
