import type { RunDetailSectionResponse } from "../../../../src/models/dashboard/run-detail.js";
import { FIXTURE_CONTEXT_DATA_SECTIONS } from "./run-detail/context-data.js";
import { FIXTURE_FAILURE_SECTIONS,FIXTURE_RECEIPT_SECTIONS } from "./run-detail/receipts-failures.js";
import { FIXTURE_GATE_PARK_SECTIONS } from "./run-detail/gates-park.js";
import { FIXTURE_LOG_SECTIONS } from "./run-detail/logs-captures.js";
import { FIXTURE_RUN_DETAILS } from "./run-detail/timeline.js";

export {
  FIXTURE_IDENTITY_GATE,
  FIXTURE_IDENTITY_GATE_TYPED_EID,
  FIXTURE_PARKED_WRITE,
} from "./run-detail/gates-park.js";
export { FIXTURE_RUN_DETAILS } from "./run-detail/timeline.js";

const sectionContributions = [
  FIXTURE_LOG_SECTIONS,
  FIXTURE_RECEIPT_SECTIONS,
  FIXTURE_CONTEXT_DATA_SECTIONS,
  FIXTURE_FAILURE_SECTIONS,
  FIXTURE_GATE_PARK_SECTIONS,
] as const;

export const FIXTURE_SECTIONS: Readonly<Record<string, Readonly<Record<string, RunDetailSectionResponse>>>> = Object.freeze(
  Object.fromEntries(Object.keys(FIXTURE_RUN_DETAILS).map((runId) => [
    runId,
    Object.freeze(Object.assign({}, ...sectionContributions.map((contribution) => contribution[runId] ?? {}))),
  ])),
);
