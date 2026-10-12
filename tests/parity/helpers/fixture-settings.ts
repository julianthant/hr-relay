import { FIXTURE_NOW } from "./fixture-identity.js";
import { createFixtureSettingsSetup } from "../../support/helpers/dashboard/profiles/fixture-settings-setup.js";

export const {
  FIXTURE_SETTINGS_FACTS,
  fixtureSettingsDocument,
  FIXTURE_EDITABLE_SETTINGS,
  FIXTURE_STORAGE_RELOCATION
} = createFixtureSettingsSetup( {
  FIXTURE_NOW
});
