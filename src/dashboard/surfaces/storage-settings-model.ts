import { z } from "zod";
import type {
StorageHealthSummaryWireSchema
} from "../../domain/dashboard/bootstrap.js";
import type { StorageDoctorWire } from "../../domain/dashboard/storage.js";


export type StorageHealthSummary = z.infer<typeof StorageHealthSummaryWireSchema>;


type DegradedSpanAuthority = Extract<StorageDoctorWire["spanAuthority"], { state: "degraded" }>;

export type SpanAuthorityProblem = DegradedSpanAuthority["problems"][number];


/**
 * The strict degraded union's operator facts. The discriminant is rendered
 * separately, so this fold carries only that arm's safe identifying detail.
 */
export function spanAuthorityProblemDetail(problem: SpanAuthorityProblem): string {
  switch (problem.state) {
    case "missing":
    case "restore-loss":
      return `run ${problem.runId}${problem.possibleExternalWrite === true ? " · possible external write" : ""}`;
    case "missing-span":
      return `run ${problem.runId}`;
    case "malformed-authority":
      return `source ${problem.source} · record ${problem.recordKey} · ${problem.summary}`;
    case "malformed":
      return `table ${problem.table} · run ${problem.runId} · ${problem.summary}`;
  }
}


/** True when the top-bar gear should carry the attention dot. */
export function storageNeedsAttention(storage: StorageHealthSummary): boolean {
  return storage.authority !== "healthy" || storage.backup !== "current";
}

/** Existing explicit CLI actions. Instructions never select or execute recovery. */
export const STORAGE_RECOVERY_GUIDANCE = [
  { title: "Inspect first", command: "npm run cli -- storage doctor --json",
    detail: "Read-only. The summary uses write-time backup metadata; the doctor authenticates current bytes. Clear markers and healthy integrity do not grant runtime admission." },
  { title: "Create an explicit backup", command: "npm run cli -- storage backup --json",
    detail: "Backups run only when requested, with no automatic cadence. Stop the dashboard, BFF and workers before this stopped-storage command. Keep the returned manifest and all paired databases and retained capture/report files together." },
  { title: "Plan an upgrade", command: "npm run cli -- storage upgrade --plan --json",
    detail: "Stop the dashboard, BFF and workers first. Inspect the source version, recovery floor and refusals. A missing or stale backup is information during ordinary work; upgrade requires a verified backup of the current authority generation." },
  { title: "Apply an upgrade", command: "npm run cli -- storage upgrade --json",
    detail: "Keep all services stopped. Apply only after the plan and explicit backup checks succeed. Below-floor or unsupported sources require the original compatible release to restore and upgrade, or an explicitly chosen fresh root." },
  { title: "Restore an exact backup", command: "npm run cli -- storage restore --from <exact-manifest-path> --json",
    detail: "Replace the placeholder with the deliberately selected manifest path. Keep the dashboard, BFF and workers stopped. Use the exact .lifecycle.json manifest when archive custody exists; an individual database is not the complete pair. Restore replaces runs and ordinary settings together; independent credentials stay unchanged." },
] as const;
