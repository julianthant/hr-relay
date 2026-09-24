import { projectArchiveReport } from "../../../infra/sqlite/archive-records.js";
export { projectArchiveReport } from "../../../infra/sqlite/archive-records.js";
import type { createRunLifecycleStorage } from "../../../infra/sqlite/lifecycle-storage.js";
import { ArchiveQuerySchema, type ArchiveQuery } from "../../../domain/archive/report.js";

export function readArchiveReport(storage: Pick<ReturnType<typeof createRunLifecycleStorage>, "readReport">, runId: string) {
  return projectArchiveReport(storage.readReport(runId));
}

/** Each workflow contributes at most one selected page. Global ties use run ID. */
export function queryArchiveReports(storage: Pick<ReturnType<typeof createRunLifecycleStorage>, "archiveWorkflows" | "listReports">,
  input: Omit<ArchiveQuery, "workflow"> & { workflow?: string }) {
  const workflows = input.workflow === undefined ? storage.archiveWorkflows() : [input.workflow];
  // Validate even an empty archive; invalid limits must not become an empty success.
  ArchiveQuerySchema.partial({ workflow: true }).parse(input);
  const pages = workflows.map(workflow => storage.listReports({ ...input, workflow }));
  const candidates = pages.flatMap(page => page.items);
  candidates.sort((a, b) => a.content.completedAt.localeCompare(b.content.completedAt) || a.content.runId.localeCompare(b.content.runId));
  const items = candidates.slice(0, input.limit);
  const last = items.at(-1);
  return { items: items.map(projectArchiveReport), next: last !== undefined && (candidates.length > input.limit || pages.some(page => page.next !== null))
    ? { completedAt: last.content.completedAt, runId: last.content.runId } : null };
}
