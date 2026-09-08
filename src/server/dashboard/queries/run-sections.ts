import {
  type RunDetailSectionResponse,
} from "../../../domain/dashboard/run-detail.js";
import { RunIdSchema } from "../../../domain/ids.js";


import type { RunDetailQueryDeps } from "./run-detail-types.js";
import { SectionNameSchema } from "./run-read.js";
import { readRunCaptureSection } from "./run-captures.js";
import { buildDataSection } from "./data.js";
import { buildTrustSection } from "./run-trust.js";
import type { RunNoteScanCache } from "./run-logs.js";

/** The live route's lazy section read; capture metadata never rides the initial detail. */
export async function readRunSection(
  deps: RunDetailQueryDeps,
  runId: string,
  sectionInput: string,
  cursorInput?: string,
  signal?: AbortSignal,
): Promise<RunDetailSectionResponse> {
  RunIdSchema.parse(runId);
  const section = SectionNameSchema.parse(sectionInput);
  if (section !== "captures") {
    return buildRunSection(deps, runId, section, cursorInput);
  }
  return readRunCaptureSection(deps, runId, signal);
}

/* ── lazy sections ───────────────────────────────────────────────────────── */

export function buildRunSection(
  deps: RunDetailQueryDeps,
  runId: string,
  sectionInput: string,
  cursorInput?: string,
  /** D5/L3: immutable combined-log snapshots across a page walk. */
  noteScanCache?: RunNoteScanCache,
): RunDetailSectionResponse {
  const section = SectionNameSchema.parse(sectionInput);
  if (section === "context-data" || section === "context-attempts") {
    return buildDataSection(deps, runId, section);
  }
  return buildTrustSection(deps, runId, section, cursorInput, noteScanCache);
}
