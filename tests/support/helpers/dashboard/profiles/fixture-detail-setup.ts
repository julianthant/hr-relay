import type { RunDetailSectionResponse } from "../../../../../src/models/dashboard/run-detail.js";
import type * as ContextDataTypes from "../../../fixtures/dashboard/run-detail/context-data.js";
import type * as ReceiptsFailuresTypes from "../../../fixtures/dashboard/run-detail/receipts-failures.js";
import type * as GatesParkTypes from "../../../fixtures/dashboard/run-detail/gates-park.js";
import type * as LogsCapturesTypes from "../../../fixtures/dashboard/run-detail/logs-captures.js";
import type * as TimelineTypes from "../../../fixtures/dashboard/run-detail/timeline.js";


export function createFixtureDetailSetup({ FIXTURE_CONTEXT_DATA_SECTIONS, FIXTURE_FAILURE_SECTIONS, FIXTURE_RECEIPT_SECTIONS, FIXTURE_GATE_PARK_SECTIONS, FIXTURE_LOG_SECTIONS, FIXTURE_RUN_DETAILS }: {
  FIXTURE_CONTEXT_DATA_SECTIONS: typeof ContextDataTypes.FIXTURE_CONTEXT_DATA_SECTIONS;
  FIXTURE_FAILURE_SECTIONS: typeof ReceiptsFailuresTypes.FIXTURE_FAILURE_SECTIONS;
  FIXTURE_RECEIPT_SECTIONS: typeof ReceiptsFailuresTypes.FIXTURE_RECEIPT_SECTIONS;
  FIXTURE_GATE_PARK_SECTIONS: typeof GatesParkTypes.FIXTURE_GATE_PARK_SECTIONS;
  FIXTURE_LOG_SECTIONS: typeof LogsCapturesTypes.FIXTURE_LOG_SECTIONS;
  FIXTURE_RUN_DETAILS: typeof TimelineTypes.FIXTURE_RUN_DETAILS;
}) {
  const sectionContributions = [
    FIXTURE_LOG_SECTIONS,
    FIXTURE_RECEIPT_SECTIONS,
    FIXTURE_CONTEXT_DATA_SECTIONS,
    FIXTURE_FAILURE_SECTIONS,
    FIXTURE_GATE_PARK_SECTIONS,
  ] as const;

  const FIXTURE_SECTIONS: Readonly<Record<string, Readonly<Record<string, RunDetailSectionResponse>>>> = Object.freeze(
    Object.fromEntries(Object.keys(FIXTURE_RUN_DETAILS).map((runId) => [
      runId,
      Object.freeze(Object.assign({}, ...sectionContributions.map((contribution) => contribution[runId] ?? {}))),
    ])),
  );

  return { FIXTURE_SECTIONS };
}
