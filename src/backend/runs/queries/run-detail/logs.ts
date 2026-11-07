import type { RunDetailSectionResponse } from "../../../../models/dashboard/run-detail.js";
import type { RunDetailQueryDeps } from "../run-detail-types.js";
import { requireTrustRun } from "../../trust/run-reader.js";
import { buildRunLogsSection, type RunNoteScanCache } from "../run-logs.js";

export function buildLogsSection(
  deps: RunDetailQueryDeps,
  runId: string,
  cursorInput?: string,
  noteScanCache?: RunNoteScanCache,
): RunDetailSectionResponse {
  const authority = requireTrustRun(deps.runReader, runId);
  return buildRunLogsSection(
    deps,
    runId,
    deps.projection.runFold(runId),
    authority,
    cursorInput,
    noteScanCache,
  );
}
