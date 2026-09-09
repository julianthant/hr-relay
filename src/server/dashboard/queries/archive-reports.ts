import type { createRunLifecycleStorage } from "../../../core/run-lifecycle-storage.js";
import type { ArchiveReport } from "../../../domain/archive/report.js";

/** Generic viewing imports no source/workflow parser and never returns original source JSON. */
export function projectArchiveReport(report: ArchiveReport | undefined) {
  if (report === undefined) return { state: "unavailable" as const };
  const { runId, title, workflow, descriptorVersion, outcome, completedAt, capturedAt, sections, files } = report.content;
  return { state: "available" as const, runId, title, workflow, descriptorVersion, outcome, completedAt, capturedAt, sections, files };
}

/** The served baseline resolves live/archive/deleted ownership before reading bytes. */
export function readArchiveReport(storage: Pick<ReturnType<typeof createRunLifecycleStorage>, "readReport">, runId: string) {
  return projectArchiveReport(storage.readReport(runId));
}
