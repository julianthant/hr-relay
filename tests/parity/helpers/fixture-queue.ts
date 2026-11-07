import { at,CONFIG_FINGERPRINT,FIXTURE_APP_VERSION,FIXTURE_DAY,FIXTURE_DESCRIPTOR_HASH,traceOf,uuidOf,WORKFLOW_ID } from "./fixture-identity.js";
import { FIXTURE_BACKFILL_NOTIFICATIONS,FIXTURE_NOTIFICATIONS } from "./fixture-notifications.js";
import { createFixtureQueueSetup } from "../../support/helpers/dashboard/profiles/fixture-queue-setup.js";

export type { Status } from "../../support/helpers/dashboard/profiles/fixture-queue-setup.js";

export const {
  absent,
  FIXTURE_DAY_WIRE,
  BACKFILL_GAP_DAY_WIRE,
  FIXTURE_IDS
} = createFixtureQueueSetup( {
  at,
  CONFIG_FINGERPRINT,
  FIXTURE_APP_VERSION,
  FIXTURE_DAY,
  FIXTURE_DESCRIPTOR_HASH,
  traceOf,
  uuidOf,
  WORKFLOW_ID,
  FIXTURE_BACKFILL_NOTIFICATIONS,
  FIXTURE_NOTIFICATIONS
});
