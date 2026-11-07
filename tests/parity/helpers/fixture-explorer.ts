import { FIXTURE_DAY,FIXTURE_DESCRIPTOR_HASH } from "./fixture-identity.js";
import { createFixtureExplorerSetup } from "../../support/helpers/dashboard/profiles/fixture-explorer-setup.js";

export const {
  FIXTURE_EXPLORER_WIRE,
  FIXTURE_EXPLORER_WORKFLOW_ID
} = createFixtureExplorerSetup( {
  FIXTURE_DAY,
  FIXTURE_DESCRIPTOR_HASH
});

export const FIXTURE_CATALOG_QUERY = "kuali";
