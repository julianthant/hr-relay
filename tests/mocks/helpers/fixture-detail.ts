import { FIXTURE_CONTEXT_DATA_SECTIONS } from "./run-detail/context-data.js";
import { FIXTURE_FAILURE_SECTIONS,FIXTURE_RECEIPT_SECTIONS } from "./run-detail/receipts-failures.js";
import { FIXTURE_GATE_PARK_SECTIONS } from "./run-detail/gates-park.js";
import { FIXTURE_LOG_SECTIONS } from "./run-detail/logs-captures.js";
import { FIXTURE_RUN_DETAILS } from "./run-detail/timeline.js";
import { createFixtureDetailSetup } from "../../support/helpers/dashboard/profiles/fixture-detail-setup.js";

export const {
  FIXTURE_SECTIONS
} = createFixtureDetailSetup( {
  FIXTURE_CONTEXT_DATA_SECTIONS,
  FIXTURE_FAILURE_SECTIONS,
  FIXTURE_RECEIPT_SECTIONS,
  FIXTURE_GATE_PARK_SECTIONS,
  FIXTURE_LOG_SECTIONS,
  FIXTURE_RUN_DETAILS
});

export {
  FIXTURE_IDENTITY_GATE,
  FIXTURE_IDENTITY_GATE_NAME_MISMATCH,
  FIXTURE_PARKED_WRITE,
} from "./run-detail/gates-park.js";
export { FIXTURE_RUN_DETAILS } from "./run-detail/timeline.js";
