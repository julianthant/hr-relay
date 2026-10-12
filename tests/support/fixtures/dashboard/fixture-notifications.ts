import { at,uuidOf } from "./fixture-identity.js";
import { createFixtureNotificationsSetup } from "../../helpers/dashboard/profiles/fixture-notifications-setup.js";

export const {
  FIXTURE_NOTIFICATIONS,
  FIXTURE_BACKFILL_NOTIFICATIONS
} = createFixtureNotificationsSetup( {
  parkedSeverity: "error",
  parkedTitle: "Write parked",
  completionTitle: "Verified completion",
  at,
  uuidOf
});
