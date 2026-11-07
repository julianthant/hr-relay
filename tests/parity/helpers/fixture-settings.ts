import { createFixtureSettingsSetup } from "../../support/helpers/dashboard/profiles/fixture-settings-setup.js";
import { FIXTURE_NOW } from "./fixture-identity.js";

export const {
  FIXTURE_SETTINGS_FACTS,
  fixtureSettingsDocument,
  FIXTURE_EDITABLE_SETTINGS
} = createFixtureSettingsSetup( {
  FIXTURE_NOW
});
