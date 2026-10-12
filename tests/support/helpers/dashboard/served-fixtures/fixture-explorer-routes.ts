import { FIXTURE_EXPLORER_WIRE } from "../../../fixtures/dashboard/fixture-explorer.js";
import { createFixtureExplorerRoutesSetup } from "../profiles/fixture-explorer-routes-setup.js";

export const {
  registerFixtureExplorerRoutes
} = createFixtureExplorerRoutesSetup( {
  FIXTURE_EXPLORER_WIRE
});
