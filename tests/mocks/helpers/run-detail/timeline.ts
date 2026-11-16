import { at,traceOf,uuidOf,WORKFLOW_ID } from "../fixture-identity.js";
import { absent,FIXTURE_IDS } from "../fixture-queue.js";
import { createTimelineSetup } from "../../../support/helpers/dashboard/profiles/run-detail/timeline-setup.js";

export const {
  FIXTURE_RUN_DETAILS
} = createTimelineSetup( {
  at,
  traceOf,
  uuidOf,
  WORKFLOW_ID,
  absent,
  FIXTURE_IDS
});
