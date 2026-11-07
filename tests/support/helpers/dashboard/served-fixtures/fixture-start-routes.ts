import { FIXTURE_START_PLAN } from "../../../fixtures/dashboard/fixture-start.js";
import { createFixtureStartRoutesSetup } from "../profiles/fixture-start-routes-setup.js";

export const {
  registerFixtureStartRoutes
} = createFixtureStartRoutesSetup( {
  FIXTURE_START_PLAN
});
