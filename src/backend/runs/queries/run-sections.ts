import {
  type RunDetailSectionResponse,
} from "../../../models/dashboard/run-detail.js";
import { RunIdSchema } from "../../../rules/identity/ids.js";
import { SectionUnavailableError } from "../commands/refusals.js";
import type { RunDetailQueryDeps } from "./run-detail-types.js";
import { SectionNameSchema } from "./run-read.js";
import { requireTrustRun } from "../trust/run-reader.js";
import { readRunCaptureSection } from "./run-captures.js";
import { buildDataSection } from "./data.js";
import { availableSections } from "./run-detail/availability.js";
import { buildGateParkSection } from "./run-detail/gate-park.js";
import { buildLogsSection } from "./run-detail/logs.js";
import { buildReceiptFailureSection } from "./run-detail/receipts-failures.js";
import type { RunNoteScanCache } from "./run-logs.js";

/** The one live section dispatcher. Every arm names its exclusive projector. */
export async function readRunSection(
  deps: RunDetailQueryDeps,
  runId: string,
  sectionInput: string,
  cursorInput?: string,
  signal?: AbortSignal,
): Promise<RunDetailSectionResponse> {
  RunIdSchema.parse(runId);
  const section = SectionNameSchema.parse(sectionInput);
  if (section === "captures") return readRunCaptureSection(deps, runId, signal);
  return buildRunSection(deps, runId, section, cursorInput);
}

/** Synchronous projector entry used by archive freezes and compatibility callers. */
export function buildRunSection(
  deps: RunDetailQueryDeps,
  runId: string,
  sectionInput: string,
  cursorInput?: string,
  noteScanCache?: RunNoteScanCache,
): RunDetailSectionResponse {
  const section = SectionNameSchema.parse(sectionInput);
  switch (section) {
    case "context-data":
    case "context-attempts":
      return buildDataSection(deps, runId, section);
    case "logs":
      return buildLogsSection(deps, runId, cursorInput, noteScanCache);
    case "receipt":
    case "failure":
      return buildReceiptFailureSection(deps, runId, section);
    case "parked-write":
    case "identity-gate":
      return buildGateParkSection(deps, runId, section);
    case "captures":
    case "review":
    case "people":
    case "context-evidence": {
      const authority = requireTrustRun(deps.runReader, runId);
      const served = availableSections(undefined, authority, deps.trust);
      throw new SectionUnavailableError(
        `section ${section} is not available for run ${runId}; served sections are ${served.join(", ")}`,
      );
    }
  }
}


export function buildTrustSection(
  deps: RunDetailQueryDeps,
  runId: string,
  sectionInput: string,
  cursorInput?: string,
  noteScanCache?: RunNoteScanCache,
): RunDetailSectionResponse {
  const section = SectionNameSchema.parse(sectionInput);
  return buildRunSection(deps, runId, section, cursorInput, noteScanCache);
}
