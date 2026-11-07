import { FIXTURE_BOOTSTRAP } from "./fixture-bootstrap.js";
import { FIXTURE_DESCRIPTOR_HASH } from "./fixture-identity.js";
import { FIXTURE_DAY_WIRE } from "./fixture-queue.js";
import { createFixtureProfileSetup } from "../../helpers/dashboard/profiles/fixture-profile-setup.js";

export type { FixtureDashboardProfile, FixtureBffOptions } from "../../helpers/dashboard/profiles/fixture-profile-setup.js";

export const {
  DEFAULT_DASHBOARD_PROFILE
} = createFixtureProfileSetup( {
  FIXTURE_BOOTSTRAP,
  FIXTURE_DESCRIPTOR_HASH,
  FIXTURE_DAY_WIRE
});
