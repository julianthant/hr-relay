import { FIXTURE_START_PLAN } from "./fixture-start.js";
import { createFixtureStartRoutesSetup } from "../../support/helpers/dashboard/profiles/fixture-start-routes-setup.js";

export const {
  registerFixtureStartRoutes
} = createFixtureStartRoutesSetup( {
  FIXTURE_START_PLAN
});
