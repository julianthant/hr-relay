import { at, CONTRACT_FINGERPRINT, uuidOf } from "../fixture-identity.js";
import { FIXTURE_IDS } from "../fixture-queue.js";
import { createContextDataSetup } from "../../../helpers/dashboard/profiles/run-detail/context-data-setup.js";

export const {
  FIXTURE_CONTEXT_DATA_SECTIONS
} = createContextDataSetup( {
  at,
  CONTRACT_FINGERPRINT,
  uuidOf,
  FIXTURE_IDS
});
