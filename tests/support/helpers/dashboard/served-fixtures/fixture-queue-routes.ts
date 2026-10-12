import { FIXTURE_DAY } from "../../../fixtures/dashboard/fixture-identity.js";
import { createFixtureQueueRoutesSetup } from "../profiles/fixture-queue-routes-setup.js";

export const {
  registerFixtureQueueRoutes
} = createFixtureQueueRoutesSetup( {
  FIXTURE_DAY
});
