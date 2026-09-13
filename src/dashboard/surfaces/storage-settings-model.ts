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
