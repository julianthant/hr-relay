import type { createRunLifecycleStorage } from "../../core/run-lifecycle-storage.js";
import type { ArchiveReport } from "../../domain/archive/report.js";

/** Resumable A baseline: every cross-store boundary is durable and replay-bound. */
export function transferArchiveReport(storage: ReturnType<typeof createRunLifecycleStorage>, report: ArchiveReport,
  expectedVersion: number, afterStep?: (step: "captured" | "verified" | "cleaned" | "published") => void) {
  storage.saveReport(report); afterStep?.("captured");
  storage.verifyReport(report.content.runId,report.digest); afterStep?.("verified");
  storage.transfer({runId:report.content.runId,digest:report.digest,expectedVersion}); afterStep?.("cleaned");
  storage.publishReport(report.content.runId,report.digest); afterStep?.("published");
  return storage.readReport(report.content.runId);
}
