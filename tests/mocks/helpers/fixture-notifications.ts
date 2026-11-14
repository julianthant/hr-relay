import { at,uuidOf } from "./fixture-identity.js";
import { createFixtureNotificationsSetup } from "../../support/helpers/dashboard/profiles/fixture-notifications-setup.js";

export const {
  FIXTURE_NOTIFICATIONS,
  FIXTURE_BACKFILL_NOTIFICATIONS
} = createFixtureNotificationsSetup( {
  parkedSeverity: "warning",
  parkedTitle: "A write to UCPath is parked pending proof",
  completionTitle: "Onboarding cohort — July stragglers completed",
  at,
  uuidOf
});
