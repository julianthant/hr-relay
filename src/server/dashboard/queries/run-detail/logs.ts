import type { RunDetailSectionResponse } from "../../../../domain/dashboard/run-detail.js";
import { SectionUnavailableError } from "../../../failures.js";
import type { RunDetailQueryDeps } from "../run-detail-types.js";
import { requireTrustRun } from "../../../trust/run-reader.js";
import { buildRunLogsSection, type RunNoteScanCache } from "../run-logs.js";
import { availableSections } from "./availability.js";

export function buildLogsSection(
  deps: RunDetailQueryDeps,
  runId: string,
  cursorInput?: string,
  noteScanCache?: RunNoteScanCache,
): RunDetailSectionResponse {
  const authority = requireTrustRun(deps.runReader, runId);
  const served = availableSections(undefined, authority, deps.trust);
  if (!served.includes("logs")) {
    throw new SectionUnavailableError(
      `section logs is not available for run ${runId}; served sections are ${served.join(", ")}`,
    );
  }
  return buildRunLogsSection(
    deps,
    runId,
    deps.projection.runFold(runId),
    authority,
    cursorInput,
    noteScanCache,
  );
}
