import { FIXTURE_EXPLORER_WIRE } from "./fixture-explorer.js";
import { createFixtureExplorerRoutesSetup } from "../../support/helpers/dashboard/profiles/fixture-explorer-routes-setup.js";

export const {
  registerFixtureExplorerRoutes
} = createFixtureExplorerRoutesSetup( {
  FIXTURE_EXPLORER_WIRE
});
