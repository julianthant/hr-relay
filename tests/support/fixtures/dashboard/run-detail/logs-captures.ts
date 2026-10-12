import { at,uuidOf } from "../fixture-identity.js";
import { FIXTURE_IDS } from "../fixture-queue.js";
import { createLogsCapturesSetup } from "../../../helpers/dashboard/profiles/run-detail/logs-captures-setup.js";

export const {
  FIXTURE_LOG_SECTIONS
} = createLogsCapturesSetup( {
  at,
  uuidOf,
  FIXTURE_IDS
});
