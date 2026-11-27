import { createFixtureSettingsSetup } from "../profiles/fixture-settings-setup.js";
import { FIXTURE_NOW } from "./fixture-identity.js";

export const {
  fixtureSettingsDocument,
  FIXTURE_EDITABLE_SETTINGS
} = createFixtureSettingsSetup( {
  FIXTURE_NOW
});
